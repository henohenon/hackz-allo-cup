import { BrowserWindow, ipcMain } from "electron";
import * as transmitter from "./transmitter";
import * as receiver from "./receiver";

// 薄い BLE I/O 層 (window.ble)。
// 役割は「ステータス制御・生データを撒く・拾った生データを通知」のみ。
// codec / pack / 重複除去 / スケジューラ / 永続化 は一切持たない (全部 Renderer の責務)。

export type BleStatus = "IDLE" | "ADVERTISE" | "SCANNING";

export interface BleResult {
  ok: boolean;
  error?: string;
}

/** 広告・スキャンフィルタに使う LocalName (固定)。 */
const LOCAL_NAME = "HAKO";

/**
 * 撒き直し時の stop→start の隙間 (ms)。
 * macOS の CoreBluetooth は stopAdvertising 直後だと isAdvertising が落ちきっておらず、
 * start が無視されてハングするため gap を入れる。
 * まず BLE 仕様下限 (20ms) で試し、失敗時のみ長めのフォールバックへ退避する。
 */
const REBROADCAST_GAP_MIN_MS = 20;
const REBROADCAST_GAP_FALLBACK_MS = 150;
/** 短いギャップ試行時の advertisingStart 待ち (ms)。失敗を素早く検知してリトライする。 */
const REBROADCAST_START_TIMEOUT_FAST_MS = 400;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let status: BleStatus = "IDLE";
// 直近に撒いた (撒こうとした) Service UUIDs。BT リセットからの poweredOn 復帰時に
// これを自動で撒き直す。ADVERTISE を抜けたら破棄する。
let lastAdvertiseUuids: string[] | null = null;

function fail(error: unknown): BleResult {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[BLE] error:", message);
  return { ok: false, error: message };
}

// setStatus / advertise を直列化する。stop/start (特に撒き直しの stop→gap→start) が
// 交錯すると bleno の排他ロックが崩れてハングし得るため、操作を 1 本のチェーンに並べる。
let opChain: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const next = opChain.then(op, op);
  opChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 全ウィンドウへイベントを送る */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** SCANNING 時の discover ハンドラ。HAKO だけ通し、生のまま (重複除去なし) push する。 */
function onDiscover(serviceUuids: string[]): void {
  // Renderer へは生の serviceUuids (= 撒かれた生バイナリ) だけ渡す。
  // id/address は macOS で当てにならず、重複除去/識別は payload ベースで Renderer がやる。
  broadcast("ble:packet", serviceUuids);
}

/** 撒き直し: stop 後に短いギャップで start を試し、失敗時のみ長いギャップでリトライする。 */
async function restartAdvertising(serviceUuids: string[]): Promise<void> {
  await transmitter.stopAdvertising();
  const gaps = [REBROADCAST_GAP_MIN_MS, REBROADCAST_GAP_FALLBACK_MS];
  for (let i = 0; i < gaps.length; i++) {
    const gapMs = gaps[i]!;
    if (gapMs > 0) await delay(gapMs);
    try {
      const timeoutMs = i === 0 ? REBROADCAST_START_TIMEOUT_FAST_MS : 3000;
      await transmitter.startAdvertising(LOCAL_NAME, serviceUuids, timeoutMs);
      return;
    } catch (error) {
      if (i === gaps.length - 1) throw error;
      await transmitter.stopAdvertising().catch(() => undefined);
    }
  }
}

/**
 * ステータスを更新する (排他)。遷移のたび現在の動作を止めてから次へ移る。
 * ADVERTISE は最初の advertise() まで何も撒かない。
 */
export function setStatus(next: BleStatus): Promise<BleResult> {
  return serialize(() => doSetStatus(next));
}

async function doSetStatus(next: BleStatus): Promise<BleResult> {
  if (isShutdown) return { ok: false, error: "BLE は shutdown 済みです" };
  console.log(`[BLE] setStatus 要求: ${status} -> ${next}`);
  try {
    switch (next) {
      case "IDLE":
        console.log("[BLE] setStatus: 発信・受信を停止");
        await transmitter.stopAdvertising();
        await receiver.stopScanning();
        break;
      case "ADVERTISE":
        // 受信を止める。発信はまだ何も撒かない (advertise() を待つ)。
        console.log("[BLE] setStatus: 受信を停止 (発信は advertise() 待ち)");
        await receiver.stopScanning();
        break;
      case "SCANNING":
        console.log("[BLE] setStatus: 発信を停止し受信を開始");
        await transmitter.stopAdvertising();
        await receiver.startScanning(onDiscover);
        break;
    }
    status = next;
    if (next !== "ADVERTISE") lastAdvertiseUuids = null;
    console.log(`[BLE] status -> ${status}`);
    return { ok: true };
  } catch (error) {
    // 部分失敗 (片方止めて片方 throw 等) で内部状態と実ハードが乖離するのを防ぐため、
    // 両方止めて IDLE に倒す。
    console.warn("[BLE] setStatus 失敗 → IDLE へフォールバック");
    try {
      await transmitter.stopAdvertising();
      await receiver.stopScanning();
    } catch (cleanupError) {
      console.error("[BLE] フォールバック停止も失敗:", cleanupError);
    }
    status = "IDLE";
    lastAdvertiseUuids = null;
    return fail(error);
  }
}

/**
 * 撒く生データ (Service UUIDs) を差し替える。ADVERTISE 中のみ有効。
 * latest-wins / 文字送り最低保証 の判断は Renderer 側。ここは来たものをそのまま撒くだけ。
 */
export function advertise(serviceUuids: string[]): Promise<BleResult> {
  return serialize(() => doAdvertise(serviceUuids));
}

async function doAdvertise(serviceUuids: string[]): Promise<BleResult> {
  if (isShutdown) return { ok: false, error: "BLE は shutdown 済みです" };
  if (status !== "ADVERTISE") {
    const error = `advertise は ADVERTISE 中のみ有効 (現在: ${status})`;
    console.warn(`[BLE] advertise 却下: ${error}`);
    return { ok: false, error };
  }
  lastAdvertiseUuids = serviceUuids;
  try {
    if (transmitter.isAdvertising()) {
      await restartAdvertising(serviceUuids);
    } else {
      await transmitter.startAdvertising(LOCAL_NAME, serviceUuids);
    }
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

let registered = false;
let isShutdown = false;

/** BLE 用の IPC ハンドラを登録する。main プロセスの起動時に一度だけ呼ぶ (shutdownBle と対) */
export function registerBle(): void {
  if (registered || isShutdown) return;
  registered = true;

  ipcMain.handle("ble:set-status", (_event, next: BleStatus) => setStatus(next));
  ipcMain.handle("ble:advertise", (_event, serviceUuids: string[]) =>
    advertise(serviceUuids ?? []),
  );

  // BT リセット (オフ→オン・スリープ復帰) からの自動復帰。
  // poweredOn 復帰時、現在の status に応じて広告の撒き直し / スキャン再開を行う。
  // 初回の poweredOn でも発火するが、動作中なら isAdvertising / isScanning で弾かれる。
  transmitter.setRecoveryCallback(() => {
    void serialize(async () => {
      if (isShutdown || status !== "ADVERTISE") return;
      if (!lastAdvertiseUuids || transmitter.isAdvertising()) return;
      console.log("[BLE] poweredOn 復帰: 広告を自動再開");
      try {
        await restartAdvertising(lastAdvertiseUuids);
      } catch (error) {
        console.warn("[BLE] 広告の自動再開に失敗:", error);
      }
    });
  });
  receiver.setRecoveryCallback(() => {
    void serialize(async () => {
      if (isShutdown || status !== "SCANNING" || receiver.isScanning()) return;
      console.log("[BLE] poweredOn 復帰: スキャンを自動再開");
      try {
        await receiver.startScanning(onDiscover);
      } catch (error) {
        console.warn("[BLE] スキャンの自動再開に失敗:", error);
      }
    });
  });
}

/**
 * BLE を完全に停止・破棄する。アプリ終了時に一度だけ呼ぶ (registerBle と対)。
 *
 * IPC の受付を閉じてから、発信・受信の順に「動作停止 → ネイティブマネージャ解放」まで畳む。
 * 解放 (noble.stop / bleno.stop) を怠るとイベントループへの生存参照が残り、
 * ウィンドウを閉じてもプロセスが常駐する。以降の setStatus / advertise は受け付けない。
 */
export function shutdownBle(): Promise<void> {
  // serialize に乗せ、実行中の setStatus / advertise が完了してから畳む。
  return serialize(async () => {
    if (isShutdown) return;
    isShutdown = true;
    console.log("[BLE] shutdown 開始");

    if (registered) {
      ipcMain.removeHandler("ble:set-status");
      ipcMain.removeHandler("ble:advertise");
      registered = false;
    }

    await transmitter.shutdown();
    await receiver.shutdown();
    status = "IDLE";
    console.log("[BLE] shutdown 完了");
  });
}
