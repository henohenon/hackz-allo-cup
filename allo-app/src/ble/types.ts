/** BLE ステータス (排他)。ADVERTISE=発信 / SCANNING=受信 / IDLE=停止 */
export type BleStatus = "IDLE" | "ADVERTISE" | "SCANNING";

export interface BleResult {
  ok: boolean;
  error?: string;
}

/** プラットフォームが提供する BLE 能力。 */
export interface BleCapabilities {
  advertise: boolean;
  scan: boolean;
}

/**
 * `window.ble` として公開される薄い BLE I/O。
 * codec / pack / 重複除去 / スケジューラ / 永続化 は持たない (全部 Renderer)。
 */
export interface BleApi {
  setStatus(status: BleStatus): Promise<BleResult>;
  advertise(serviceUuids: string[]): Promise<BleResult>;
  /** HAKO 広告ヒットごとに生の serviceUuids を通知 (decode/重複除去なし)。戻り値で解除 */
  onPacket(callback: (serviceUuids: string[]) => void): () => void;
  /**
   * プラットフォーム能力。未指定時は Electron 互換（advertise/scan 両方 true）とみなす。
   * Android (Capacitor) は advertise: false。
   */
  readonly capabilities?: BleCapabilities;
}
