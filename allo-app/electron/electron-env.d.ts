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

/** BLE 受信で発見したデバイス情報 (preload 経由でレンダラーへ渡る形) */
interface BleDiscoveredDevice {
  id: string;
  address: string;
  localName: string | null;
  rssi: number;
  serviceUuids: string[];
  manufacturerDataHex: string | null;
}

interface BleResult {
  ok: boolean;
  error?: string;
}

/** preload で `window.ble` として公開される BLE API */
interface BleApi {
  startAdvertise(localName?: string, serviceUuids?: string[]): Promise<BleResult>;
  stopAdvertise(): Promise<BleResult>;
  startScan(): Promise<BleResult>;
  stopScan(): Promise<BleResult>;
  onDiscover(callback: (device: BleDiscoveredDevice) => void): () => void;
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import("electron").IpcRenderer;
  ble: BleApi;
}
