/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string;
    /** /dist/ or /public/ */
    VITE_PUBLIC: string;
  }
}

/** BLE ステータス (排他)。ADVERTISE=発信 / SCANNING=受信 / IDLE=停止 */
type BleStatus = "IDLE" | "ADVERTISE" | "SCANNING";

interface BleResult {
  ok: boolean;
  error?: string;
}

/**
 * preload で `window.ble` として公開される薄い BLE I/O。
 * codec / pack / 重複除去 / スケジューラ / 永続化 は持たない (全部 Renderer)。
 */
interface BleApi {
  setStatus(status: BleStatus): Promise<BleResult>;
  advertise(serviceUuids: string[]): Promise<BleResult>;
  /** HAKO 広告ヒットごとに生の serviceUuids を通知 (decode/重複除去なし)。戻り値で解除 */
  onPacket(callback: (serviceUuids: string[]) => void): () => void;
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import("electron").IpcRenderer;
  ble: BleApi;
}
