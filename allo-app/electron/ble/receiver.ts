import { createRequire } from "node:module";
import type { BleState, DiscoveredDevice, NobleModule, NoblePeripheral } from "./types";

// noble はネイティブモジュールなので、バンドラにインライン化されないよう実行時 require する。
const require = createRequire(import.meta.url);
const noble = require("@stoprocent/noble") as NobleModule;

let scanning = false;
let discoverListener: ((peripheral: NoblePeripheral) => void) | null = null;

function toDevice(p: NoblePeripheral): DiscoveredDevice {
  const ad = p.advertisement;
  return {
    id: p.id,
    address: p.address,
    localName: ad.localName ?? null,
    rssi: p.rssi,
    // 128bit Service UUID にペイロードを載せて運ぶ (16Byte = UUID 1個)
    serviceUuids: ad.serviceUuids ?? [],
    manufacturerDataHex: ad.manufacturerData ? ad.manufacturerData.toString("hex") : null,
  };
}

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

/** 受信 (スキャン) を開始する。発見したデバイスは onDiscover で通知する */
export async function startScanning(onDiscover: (device: DiscoveredDevice) => void): Promise<void> {
  if (scanning) return;
  await waitForPoweredOn();

  discoverListener = (peripheral) => {
    const device = toDevice(peripheral);
    // LocalName が無い (noname) デバイスは無視する
    if (!device.localName) return;
    onDiscover(device);
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

/** noble (受信アダプタ) の現在の BT 状態。 */
export function getState(): BleState {
  return noble.state;
}

/** noble の状態変化を購読する。戻り値で解除。 */
export function onStateChange(listener: (state: BleState) => void): () => void {
  noble.on("stateChange", listener);
  return () => noble.removeListener("stateChange", listener);
}
