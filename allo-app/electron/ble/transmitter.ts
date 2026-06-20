import { createRequire } from "node:module";
import type { BleState, BlenoModule } from "./types";

// bleno はネイティブモジュールなので、バンドラにインライン化されないよう実行時 require する。
const require = createRequire(import.meta.url);
const bleno = require("@stoprocent/bleno") as BlenoModule;

/** 仕様上の LocalName。広告とスキャンフィルタの両方でこの値を使う。 */
export const LOCAL_NAME = "HAKO";

let advertising = false;

/** Bluetooth が poweredOn になるまで待つ (タイムアウト付き・issue #3) */
function waitForPoweredOn(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[bleno] waitForPoweredOn: 現在 state=${bleno.state}`);
    if (bleno.state === "poweredOn") {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      bleno.removeListener("stateChange", onState);
    };
    const onState = (state: BleState) => {
      console.log(`[bleno] stateChange -> ${state}`);
      if (state === "poweredOn") {
        cleanup();
        resolve();
      } else if (state === "unauthorized" || state === "unsupported" || state === "poweredOff") {
        cleanup();
        reject(new Error(`bleno が利用できません (state: ${state})`));
      }
    };
    // state が unknown のまま無反応だと永久に待つため、上限を設ける。
    timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `bleno poweredOn 待ちタイムアウト (${timeoutMs}ms, state=${bleno.state})。` +
            `BT がオフ、または Bluetooth 権限が未許可の可能性`,
        ),
      );
    }, timeoutMs);
    bleno.on("stateChange", onState);
  });
}

/**
 * 発信 (アドバタイズ) を開始する。
 *
 * @param localName 広告する LocalName (既定: 'ALLO')
 * @param serviceUuids 広告に載せる Service UUID。128bit UUID = 16Byte なので、
 *   ここにペイロード (sessionId 4 + seq 2 + body 10 = 16Byte) を 32 桁の 16 進文字列として渡す。
 *   macOS の CoreBluetooth では LocalName と Service UUID のみ広告可能。
 */
export async function startAdvertising(
  localName: string = LOCAL_NAME,
  serviceUuids: string[] = [],
): Promise<void> {
  await waitForPoweredOn();
  await new Promise<void>((resolve, reject) => {
    // 既に広告中だとネイティブが startAdvertising を無視して advertisingStart が
    // 来ない場合がある。ハングしないようタイムアウトで打ち切る。
    const timer = setTimeout(() => {
      reject(new Error("advertisingStart が来ません (既に広告中で無視された可能性)"));
    }, 3000);
    bleno.startAdvertising(localName, serviceUuids, (error) => {
      clearTimeout(timer);
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    });
  });
  advertising = true;
}

/**
 * 発信を停止する。
 *
 * bleno は発信操作を onceExclusive で直列化しているため、停止の完了(advertisingStop)を
 * 待たずに次の startAdvertising を呼ぶと排他ロックが解けずハングする。
 * そこで advertisingStop コールバックを待ってから解決する(latest-wins の撒き直し対策)。
 * 万一イベントが来ない場合に備えてタイムアウトでフォールバックする。
 */
export function stopAdvertising(timeoutMs = 3000): Promise<void> {
  // まだ一度も発信していない (bleno 未初期化) 場合、native の peripheralManager が
  // nil のため stopAdvertising を呼ぶと "BLEManager has already been cleaned up" で
  // throw する。receiver.stopScanning と同様、広告していなければ何もしない。
  if (!advertising) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      advertising = false;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    bleno.stopAdvertising(done); // 実際に停止した(advertisingStop)ら done
  });
}

export function isAdvertising(): boolean {
  return advertising;
}

/** bleno (発信アダプタ) の現在の BT 状態。 */
export function getState(): BleState {
  return bleno.state;
}

/** bleno の状態変化を購読する。戻り値で解除。 */
export function onStateChange(listener: (state: BleState) => void): () => void {
  bleno.on("stateChange", listener);
  return () => bleno.removeListener("stateChange", listener);
}
