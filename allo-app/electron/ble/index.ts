import { BrowserWindow, ipcMain } from "electron";
import * as transmitter from "./transmitter";
import * as receiver from "./receiver";

export interface BleResult {
  ok: boolean;
  error?: string;
}

function toResult(promise: Promise<unknown>): Promise<BleResult> {
  return promise.then(
    () => ({ ok: true }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[BLE] error:", message);
      return { ok: false, error: message };
    },
  );
}

/** 全ウィンドウへイベントを送る */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

let registered = false;

/** BLE 用の IPC ハンドラを登録する。main プロセスの起動時に一度だけ呼ぶ */
export function registerBle(): void {
  if (registered) return;
  registered = true;

  // 発信 (bleno)
  ipcMain.handle("ble:start-advertise", (_event, localName?: string, serviceUuids?: string[]) =>
    toResult(transmitter.startAdvertising(localName ?? transmitter.LOCAL_NAME, serviceUuids ?? [])),
  );
  ipcMain.handle("ble:stop-advertise", () => toResult(transmitter.stopAdvertising()));

  // 受信 (noble)
  ipcMain.handle("ble:start-scan", () =>
    toResult(
      receiver.startScanning((device) => {
        console.log(
          `[BLE] discover: ${device.localName ?? "(no name)"} ${device.id} rssi=${device.rssi} uuids=[${device.serviceUuids.join(",")}]`,
        );
        broadcast("ble:discover", device);
      }),
    ),
  );
  ipcMain.handle("ble:stop-scan", () => toResult(receiver.stopScanning()));
}

/** アプリ終了時に発信・受信を止める */
export async function shutdownBle(): Promise<void> {
  await toResult(transmitter.stopAdvertising());
  await toResult(receiver.stopScanning());
}
