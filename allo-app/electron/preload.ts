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

// --------- BLE (発信: bleno / 受信: noble) ---------
contextBridge.exposeInMainWorld("ble", {
  /** 発信開始 (LocalName 省略時は 'ALLO'。serviceUuids に 128bit UUID=16Byte でペイロードを載せる) */
  startAdvertise: (localName?: string, serviceUuids?: string[]) =>
    ipcRenderer.invoke("ble:start-advertise", localName, serviceUuids),
  /** 発信停止 */
  stopAdvertise: () => ipcRenderer.invoke("ble:stop-advertise"),
  /** 受信 (スキャン) 開始 */
  startScan: () => ipcRenderer.invoke("ble:start-scan"),
  /** 受信 (スキャン) 停止 */
  stopScan: () => ipcRenderer.invoke("ble:stop-scan"),
  /** デバイス発見時のコールバックを登録。戻り値を呼ぶと解除できる */
  onDiscover: (callback: (device: unknown) => void) => {
    const listener = (_event: unknown, device: unknown) => callback(device);
    ipcRenderer.on("ble:discover", listener);
    return () => ipcRenderer.off("ble:discover", listener);
  },
});
