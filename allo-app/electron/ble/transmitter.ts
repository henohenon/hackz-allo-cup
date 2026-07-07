import { createRequire } from "node:module";
import type { BleState, BlenoModule } from "./types";

// bleno はネイティブモジュールなので、バンドラにインライン化されないよう実行時 require する。
const require = createRequire(import.meta.url);
const bleno = require("@stoprocent/bleno") as BlenoModule;

/** 仕様上の LocalName。広告とスキャンフィルタの両方でこの値を使う。 */
export const LOCAL_NAME = "HAKO";

let advertising = false;
// bleno は stateChange リスナー登録の時点でネイティブの PeripheralManager を
// 遅延初期化する。未初期化のまま bleno.stop() を呼ぶと throw し得るため、
// 初期化を踏んだかどうかを記録し shutdown() で解放要否を判断する。
let nativeInitialized = false;
let isShutdown = false;

/** Bluetooth が poweredOn になるまで待つ (タイムアウト付き・issue #3) */
function waitForPoweredOn(timeoutMs = 10000): Promise<void> {
  nativeInitialized = true;
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
 * @param localName 広告する LocalName (既定: 'HAKO')
 * @param serviceUuids 広告に載せる Service UUID。128bit UUID = 16Byte なので、
 *   ここにペイロード (sessionId 4 + seq 2 + body 10 = 16Byte) を 32 桁の 16 進文字列として渡す。
 *   macOS の CoreBluetooth では LocalName と Service UUID のみ広告可能。
 */
export async function startAdvertising(
  localName: string = LOCAL_NAME,
  serviceUuids: string[] = [],
  timeoutMs = 3000,
): Promise<void> {
  if (isShutdown) throw new Error("transmitter は shutdown 済みです");
  await waitForPoweredOn();
  await new Promise<void>((resolve, reject) => {
    // 既に広告中だとネイティブが startAdvertising を無視して advertisingStart が
    // 来ない場合がある。ハングしないようタイムアウトで打ち切る。
    const timer = setTimeout(() => {
      // タイムアウトでもネイティブは実際には広告中の可能性がある。advertising を
      // 立てておかないと、次の advertise() で stop を挟まず再 start してハングが連鎖する。
      advertising = true;
      reject(new Error("advertisingStart が来ません (既に広告中で無視された可能性)"));
    }, timeoutMs);
    bleno.startAdvertising(localName, serviceUuids, (error) => {
      clearTimeout(timer);
      if (error) {
        advertising = false;
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        advertising = true;
        resolve();
      }
    });
  });
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

/**
 * 発信側を破棄する。アプリ終了時に一度だけ呼ぶ (以降 startAdvertising は不可)。
 *
 * stopAdvertising は「広告動作」を止めるだけで、CoreBluetooth の PeripheralManager と
 * それが保持する N-API ThreadSafeFunction (= イベントループへの生存参照) は残る。
 * bleno.stop() でマネージャを解放しないとプロセスが自然終了できない。
 */
export async function shutdown(): Promise<void> {
  if (isShutdown) return;
  isShutdown = true;
  await stopAdvertising();
  if (!nativeInitialized) return; // 未初期化なら解放対象が無い (stop() は throw し得る)
  try {
    bleno.stop();
    console.log("[bleno] shutdown: PeripheralManager を解放");
  } catch (error) {
    console.warn("[bleno] shutdown: bleno.stop() 失敗:", error);
  }
}
