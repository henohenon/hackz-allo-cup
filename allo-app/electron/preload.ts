import { ipcRenderer, contextBridge } from "electron";

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },

  // You can expose other APTs you need here.
  // ...
});

// --------- BLE (薄い I/O 層・発信: bleno / 受信: noble) ---------
// codec / pack / 重複除去 / スケジューラ は持たない (全部 Renderer)。
contextBridge.exposeInMainWorld("ble", {
  /** ステータス更新 (排他)。ADVERTISE=発信 / SCANNING=受信 / IDLE=停止 */
  setStatus: (status: "IDLE" | "ADVERTISE" | "SCANNING") =>
    ipcRenderer.invoke("ble:set-status", status),
  /** 撒く生データ (128bit UUID hex の配列) をセット。ADVERTISE 中のみ有効。localName は "HAKO" 固定 */
  advertise: (serviceUuids: string[]) => ipcRenderer.invoke("ble:advertise", serviceUuids),
  /** パケットヒット通知 (HAKO だけ・生の serviceUuids のまま全部)。戻り値を呼ぶと解除できる */
  onPacket: (callback: (serviceUuids: string[]) => void) => {
    const listener = (_event: unknown, serviceUuids: string[]) => callback(serviceUuids);
    ipcRenderer.on("ble:packet", listener);
    return () => ipcRenderer.off("ble:packet", listener);
  },
});
