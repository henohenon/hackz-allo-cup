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
 * start が無視されてハングするため gap を入れる (実測の暫定値)。
 */
const REBROADCAST_GAP_MS = 150;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let status: BleStatus = "IDLE";

function fail(error: unknown): BleResult {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[BLE] error:", message);
  return { ok: false, error: message };
}

/** 全ウィンドウへイベントを送る */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** SCANNING 時の discover ハンドラ。HAKO だけ通し、生のまま (重複除去なし) push する。 */
function onDiscover(device: import("./types").DiscoveredDevice): void {
  if (device.localName !== LOCAL_NAME) return;
  // address は macOS だと空、id はホスト依存。seed 用に両方ログへ出して実機で確認できるようにする。
  console.log(
    `[BLE] packet: id=${device.id} address=${device.address || "(empty)"} rssi=${device.rssi} uuids=[${device.serviceUuids.join(",")}]`,
  );
  broadcast("ble:packet", { address: device.address, serviceUuids: device.serviceUuids });
}

/**
 * ステータスを更新する (排他)。遷移のたび現在の動作を止めてから次へ移る。
 * ADVERTISE は最初の advertise() まで何も撒かない。
 */
export async function setStatus(next: BleStatus): Promise<BleResult> {
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
    console.log(`[BLE] status -> ${status}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * 撒く生データ (Service UUIDs) を差し替える。ADVERTISE 中のみ有効。
 * latest-wins / 文字送り最低保証 の判断は Renderer 側。ここは来たものをそのまま撒くだけ。
 */
export async function advertise(serviceUuids: string[]): Promise<BleResult> {
  console.log(`[BLE] advertise 要求: uuids=[${serviceUuids.join(",")}]`);
  if (status !== "ADVERTISE") {
    const error = `advertise は ADVERTISE 中のみ有効 (現在: ${status})`;
    console.warn(`[BLE] advertise 却下: ${error}`);
    return { ok: false, error };
  }
  try {
    if (transmitter.isAdvertising()) {
      console.log(`[BLE] advertise 撒き直し: stop -> ${REBROADCAST_GAP_MS}ms gap -> start`);
      await transmitter.stopAdvertising(); // 完了待ち込み
      await delay(REBROADCAST_GAP_MS); // isAdvertising が落ちる猶予 (必須)
    }
    await transmitter.startAdvertising(LOCAL_NAME, serviceUuids); // 3s タイムアウト込み
    console.log(`[BLE] advertise 反映: name=${LOCAL_NAME} uuids=[${serviceUuids.join(",")}]`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

let registered = false;

/** BLE 用の IPC ハンドラを登録する。main プロセスの起動時に一度だけ呼ぶ */
export function registerBle(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("ble:set-status", (_event, next: BleStatus) => setStatus(next));
  ipcMain.handle("ble:advertise", (_event, serviceUuids: string[]) =>
    advertise(serviceUuids ?? []),
  );
}

/** アプリ終了時に発信・受信を止める */
export async function shutdownBle(): Promise<void> {
  await setStatus("IDLE");
}
