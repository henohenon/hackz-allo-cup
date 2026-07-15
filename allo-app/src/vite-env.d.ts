/// <reference types="vite-plus/client" />

import type { BleApi } from "./ble/types";

declare global {
  interface Window {
    /** Electron preload 経由。ブラウザ単体起動時は undefined。 */
    ipcRenderer?: import("electron").IpcRenderer;
    /** Electron preload または Capacitor ブリッジ。未注入時は undefined。 */
    ble?: BleApi;
  }
}

export {};
