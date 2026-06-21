import { createRequire } from "node:module";
import type { BleState, NobleModule, NoblePeripheral } from "./types";
import { LOCAL_NAME } from "./transmitter";

// noble はネイティブモジュールなので、バンドラにインライン化されないよう実行時 require する。
const require = createRequire(import.meta.url);
const noble = require("@stoprocent/noble") as NobleModule;

let scanning = false;
let discoverListener: ((peripheral: NoblePeripheral) => void) | null = null;

/** Bluetooth が poweredOn になるまで待つ (タイムアウト付き・issue #3) */
function waitForPoweredOn(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[noble] waitForPoweredOn: 現在 state=${noble.state}`);
    if (noble.state === "poweredOn") {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      noble.removeListener("stateChange", onState);
    };
    const onState = (state: BleState) => {
      console.log(`[noble] stateChange -> ${state}`);
      if (state === "poweredOn") {
        cleanup();
        resolve();
      } else if (state === "unauthorized" || state === "unsupported" || state === "poweredOff") {
        cleanup();
        reject(new Error(`noble が利用できません (state: ${state})`));
      }
    };
    // state が unknown のまま無反応だと永久に待つため、上限を設ける。
    timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `noble poweredOn 待ちタイムアウト (${timeoutMs}ms, state=${noble.state})。` +
            `BT がオフ、または Bluetooth 権限が未許可の可能性`,
        ),
      );
    }, timeoutMs);
    noble.on("stateChange", onState);
  });
}

/** 受信 (スキャン) を開始する。HAKO の serviceUuids のみ onDiscover で通知する */
export async function startScanning(onDiscover: (serviceUuids: string[]) => void): Promise<void> {
  if (scanning) return;
  await waitForPoweredOn();

  discoverListener = (peripheral) => {
    // HAKO 以外は noble の discover 頻度が高い環境で main を圧迫するため、
    // ここで早期に捨てる (toDevice / IPC / ログを一切走らせない)。
    const ad = peripheral.advertisement;
    if (ad.localName !== LOCAL_NAME) return;
    const serviceUuids = ad.serviceUuids;
    if (!serviceUuids?.length) return;
    onDiscover(serviceUuids);
  };
  noble.on("discover", discoverListener);

  // allowDuplicates = true: 同じデバイスの広告を繰り返し受信する (RSSI 更新など)
  await noble.startScanningAsync([], true);
  scanning = true;
}

/** 受信を停止する */
export async function stopScanning(): Promise<void> {
  if (!scanning) return;
  if (discoverListener) {
    noble.removeListener("discover", discoverListener);
    discoverListener = null;
  }
  await noble.stopScanningAsync();
  scanning = false;
}

export function isScanning(): boolean {
  return scanning;
}
