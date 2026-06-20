#!/usr/bin/env node
// ALLO BLE リレー TUI テストツール (Raspberry Pi 4B / Raspberry Pi OS Lite 前提)
//
// メンバー 2 人の間に Pi を置き、BLE 広告ブロードキャストの「発信」と「受信」を
// ひたすら同時に行うための疎通テスト用ツール。
//   - ヘッダー: 本体のホスト名 / IP アドレス / Bluetooth アドレス / 各状態
//   - ボディ : 左ペイン=発信ログ、右ペイン=受信ログ
//   - 1 秒間隔のポーリングで TX は新パケットを撒き直し、RX は受信状況を集約表示
//
// 発信(bleno)と受信(noble)を 1 プロセスで動かす。Pi の内蔵アダプタは 1 つ(hci0)
// なので、単一アダプタでの同時送受信が不安定な場合は USB BLE ドングルを追加し、
// 環境変数で TX/RX のアダプタを分けること (README 参照)。
//
//   TX_ADAPTER / RX_ADAPTER ... 使用する hci 番号 (既定 0)
//   INTERVAL_MS ............... 発信パケット更新 & 画面更新の間隔 (既定 1000)
//   LOCAL_NAME ............... 広告する Local Name (既定 ALLO)
//   NO_TUI=1 ................. TUI を使わず行ログを流す (systemd / パイプ向け)

import { createRequire } from "node:module";
import os from "node:os";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  LOCAL_NAME as DEFAULT_LOCAL_NAME,
  pack,
  toServiceUuid,
  unpack,
  makeTestBody,
} from "./lib/packet.mjs";
import { createTui } from "./lib/tui.mjs";

// ── 設定 (引数 / 環境変数) ───────────────────────────────────────
function parseArgs(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tx-adapter") opt.txAdapter = argv[++i];
    else if (a === "--rx-adapter") opt.rxAdapter = argv[++i];
    else if (a === "--interval") opt.interval = argv[++i];
    else if (a === "--name") opt.name = argv[++i];
    else if (a === "--no-tui") opt.noTui = true;
    else if (a === "-h" || a === "--help") opt.help = true;
  }
  return opt;
}
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(
    [
      "使い方: node ble-relay-tui.mjs [options]",
      "  --tx-adapter <n>  発信に使う hci 番号 (既定 0 / 環境変数 TX_ADAPTER)",
      "  --rx-adapter <n>  受信に使う hci 番号 (既定 0 / 環境変数 RX_ADAPTER)",
      "  --interval <ms>   発信更新・画面更新の間隔 (既定 1000)",
      "  --name <str>      広告 Local Name (既定 ALLO)",
      "  --no-tui          TUI を使わず行ログを流す",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const TX_ADAPTER = String(args.txAdapter ?? process.env.TX_ADAPTER ?? "0");
const RX_ADAPTER = String(args.rxAdapter ?? process.env.RX_ADAPTER ?? "0");
const INTERVAL_MS = Number(args.interval ?? process.env.INTERVAL_MS ?? 1000);
const LOCAL_NAME = String(args.name ?? process.env.LOCAL_NAME ?? DEFAULT_LOCAL_NAME);
if (args.noTui) process.env.NO_TUI = "1";

// bleno / noble はネイティブモジュール。require 前にアダプタを環境変数で割り当てる。
process.env.BLENO_HCI_DEVICE_ID = TX_ADAPTER;
process.env.NOBLE_HCI_DEVICE_ID = RX_ADAPTER;

const require = createRequire(import.meta.url);
const bleno = require("@stoprocent/bleno");
const noble = require("@stoprocent/noble");

const tui = createTui({ title: `ALLO BLE relay  (TX:hci${TX_ADAPTER} / RX:hci${RX_ADAPTER})` });

// ── デバイス情報 ────────────────────────────────────────────────
function ipv4List() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(`${name} ${a.address}`);
    }
  }
  return out.length ? out.join("  ") : "(なし)";
}

// hciconfig から各アダプタの BD Address を 1 回だけ読む (取得できなければ空)。
function readHciAddresses() {
  const map = {};
  try {
    const out = execSync("hciconfig", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    let cur = null;
    for (const line of out.split("\n")) {
      const dev = line.match(/^(hci\d+):/);
      if (dev) cur = dev[1];
      const bd = line.match(/BD Address:\s*([0-9A-Fa-f:]+)/);
      if (cur && bd) map[cur] = bd[1];
    }
  } catch {
    // hciconfig が無い / 権限不足 → bleno/noble の address にフォールバック
  }
  return map;
}
const hciAddrs = readHciAddresses();

function btAddr(adapterId, libAddr) {
  const fromHci = hciAddrs[`hci${adapterId}`];
  const a = fromHci || libAddr;
  return a && a !== "unknown" ? a : "??:??:??:??:??:??";
}

// ── 状態 ───────────────────────────────────────────────────────
const sessionId = randomBytes(4);
const sessionHex = sessionId.toString("hex");
let txState = "init"; // init | advertising | error | off
let txErr = "";
let seq = 0;
let lastUuid = "";

let rxState = "init"; // init | scanning | error | off
let rxErr = "";
let totalAds = 0; // 受信した ALLO 広告の総数
const seen = new Map(); // id -> { address, rssi, sessionHex, seq, hits }
const tickSeen = new Map(); // この tick で受信した分 (id -> info)

function updateHeader() {
  const txAddr = btAddr(TX_ADAPTER, bleno.address);
  const rxAddr = btAddr(RX_ADAPTER, noble.address);
  const sameAdapter = TX_ADAPTER === RX_ADAPTER;
  tui.setHeader([
    `host : ${os.hostname()}   uptime ${Math.floor(os.uptime())}s`,
    `IPv4 : ${ipv4List()}`,
    `BT   : TX hci${TX_ADAPTER} ${txAddr}  |  RX hci${RX_ADAPTER} ${rxAddr}` +
      (sameAdapter ? "  (単一アダプタ同時送受信)" : "  (アダプタ分離)"),
    `TX   : ${txState.toUpperCase()}${txErr ? " " + txErr : ""}  name=${LOCAL_NAME} ` +
      `session=${sessionHex} seq=${seq} interval=${INTERVAL_MS}ms`,
    `RX   : ${rxState.toUpperCase()}${rxErr ? " " + rxErr : ""}  devices=${seen.size} ads=${totalAds} ` +
      `bt(tx=${bleno.state} rx=${noble.state})`,
  ]);
}

// ── 発信 (bleno) ───────────────────────────────────────────────
function blenoPoweredOn() {
  return new Promise((resolve, reject) => {
    if (bleno.state === "poweredOn") return resolve();
    const onState = (state) => {
      if (state === "poweredOn") {
        bleno.removeListener("stateChange", onState);
        resolve();
      } else if (["unauthorized", "unsupported", "poweredOff"].includes(state)) {
        bleno.removeListener("stateChange", onState);
        reject(new Error(`bleno 利用不可 (state: ${state})`));
      }
    };
    bleno.on("stateChange", onState);
  });
}

function advertiseOnce() {
  seq = (seq + 1) & 0xffff;
  const body = makeTestBody(seq);
  const packet = pack({ sessionId, seq, body });
  const uuid = toServiceUuid(packet);
  lastUuid = uuid;
  bleno.startAdvertising(LOCAL_NAME, [uuid], (error) => {
    if (error) {
      txState = "error";
      txErr = `(${error.message || error})`;
      tui.logTx(`発信失敗 seq=${seq} ${txErr}`);
    } else {
      txState = "advertising";
      txErr = "";
      tui.logTx(`発信 seq=${seq} body=${body.toString("hex")} uuid=${uuid}`);
    }
  });
}

async function startTx() {
  try {
    await blenoPoweredOn();
    tui.logTx(`bleno poweredOn (hci${TX_ADAPTER} ${btAddr(TX_ADAPTER, bleno.address)})`);
    advertiseOnce();
  } catch (e) {
    txState = "error";
    txErr = `(${e.message})`;
    tui.logTx(`発信開始エラー ${txErr}`);
  }
}

// ── 受信 (noble) ───────────────────────────────────────────────
function noblePoweredOn() {
  return new Promise((resolve, reject) => {
    if (noble.state === "poweredOn") return resolve();
    const onState = (state) => {
      if (state === "poweredOn") {
        noble.removeListener("stateChange", onState);
        resolve();
      } else if (["unauthorized", "unsupported", "poweredOff"].includes(state)) {
        noble.removeListener("stateChange", onState);
        reject(new Error(`noble 利用不可 (state: ${state})`));
      }
    };
    noble.on("stateChange", onState);
  });
}

function onDiscover(peripheral) {
  const name = peripheral.advertisement?.localName;
  if (name !== LOCAL_NAME) return; // ALLO 以外は無視
  totalAds++;
  const uuids = peripheral.advertisement?.serviceUuids ?? [];
  const parsed = uuids.map(unpack).find(Boolean);
  const info = {
    address: peripheral.address || peripheral.id,
    rssi: peripheral.rssi,
    sessionHex: parsed ? parsed.sessionId.toString("hex") : "--------",
    seq: parsed ? parsed.seq : -1,
    self: parsed ? parsed.sessionId.toString("hex") === sessionHex : false,
  };
  const prev = seen.get(peripheral.id);
  seen.set(peripheral.id, { ...info, hits: (prev?.hits ?? 0) + 1 });
  tickSeen.set(peripheral.id, info);
}

async function startRx() {
  try {
    await noblePoweredOn();
    tui.logRx(`noble poweredOn (hci${RX_ADAPTER} ${btAddr(RX_ADAPTER, noble.address)})`);
    noble.on("discover", onDiscover);
    await noble.startScanningAsync([], true); // allowDuplicates=true で反復受信
    rxState = "scanning";
    rxErr = "";
    tui.logRx("スキャン開始 (localName=ALLO のみ表示)");
  } catch (e) {
    rxState = "error";
    rxErr = `(${e.message})`;
    tui.logRx(`受信開始エラー ${rxErr}`);
  }
}

// ── 1 秒ティック ───────────────────────────────────────────────
function tick() {
  // TX: 新しい seq で撒き直す (latest-wins ビーコンの疎通確認)
  if (bleno.state === "poweredOn") advertiseOnce();

  // RX: この tick で受信したデバイスを 1 行ずつ集約表示
  for (const [, info] of tickSeen) {
    const tag = info.self ? " (self)" : "";
    tui.logRx(
      `${info.address} rssi=${info.rssi} session=${info.sessionHex} seq=${info.seq}${tag}`,
    );
  }
  if (rxState === "scanning" && tickSeen.size === 0) {
    tui.logRx("(この 1 秒間に ALLO 広告なし)");
  }
  tickSeen.clear();

  updateHeader();
  tui.render();
}

// ── 起動 & 後始末 ──────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  try {
    bleno.stopAdvertising?.();
  } catch {}
  try {
    await noble.stopScanningAsync?.();
  } catch {}
  tui.stop();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (e) => {
  tui.stop();
  process.stderr.write(`\nuncaughtException: ${e?.stack || e}\n`);
  process.exit(1);
});

tui.start();
updateHeader();
tui.render();
startTx();
startRx();
const timer = setInterval(tick, INTERVAL_MS);
