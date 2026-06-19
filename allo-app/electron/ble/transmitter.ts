import { createRequire } from "node:module";
import type { BleState, BlenoModule } from "./types";

// bleno はネイティブモジュールなので、バンドラにインライン化されないよう実行時 require する。
const require = createRequire(import.meta.url);
const bleno = require("@stoprocent/bleno") as BlenoModule;

/** 仕様上の LocalName (README 参照) */
export const LOCAL_NAME = "ALLO";

let advertising = false;

/** Bluetooth が poweredOn になるまで待つ */
function waitForPoweredOn(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (bleno.state === "poweredOn") {
      resolve();
      return;
    }
    const onState = (state: BleState) => {
      if (state === "poweredOn") {
        bleno.removeListener("stateChange", onState);
        resolve();
      } else if (state === "unauthorized" || state === "unsupported" || state === "poweredOff") {
        bleno.removeListener("stateChange", onState);
        reject(new Error(`bleno が利用できません (state: ${state})`));
      }
    };
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
    bleno.startAdvertising(localName, serviceUuids, (error) => {
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    });
  });
  advertising = true;
}

/** 発信を停止する */
export function stopAdvertising(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      advertising = false;
      resolve();
    };
    // 停止は同期的に行われるため、advertisingStop コールバックと呼び出し直後の
    // 即時解決のどちらでも解決する (settled ガードで二重解決を防ぐ)。
    bleno.stopAdvertising(done);
    done();
  });
}

export function isAdvertising(): boolean {
  return advertising;
}
