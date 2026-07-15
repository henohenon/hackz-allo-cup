import type { BleCapabilities } from "./types";

/** Electron / ブラウザプレビュー既定（発信・受信 UI を出す）。 */
const FULL: BleCapabilities = { advertise: true, scan: true };

/**
 * 現在の `window.ble` から発信/受信の可否を返す。
 * - Capacitor Android: bridge が `advertise: false` をセット
 * - Electron: preload が両方 true
 * - ble 未注入（ブラウザ）: UI 確認用に両方 true（実 BLE は動かない）
 */
export function getBleCapabilities(): BleCapabilities {
  return window.ble?.capabilities ?? FULL;
}
