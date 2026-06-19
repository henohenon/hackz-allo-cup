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

/** Bluetooth が poweredOn になるまで待つ */
function waitForPoweredOn(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (noble.state === "poweredOn") {
      resolve();
      return;
    }
    const onState = (state: BleState) => {
      if (state === "poweredOn") {
        noble.removeListener("stateChange", onState);
        resolve();
      } else if (state === "unauthorized" || state === "unsupported" || state === "poweredOff") {
        noble.removeListener("stateChange", onState);
        reject(new Error(`noble が利用できません (state: ${state})`));
      }
    };
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
