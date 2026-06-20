import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import CodecDemo from "./CodecDemo.tsx";
import HakoDevPanel from "./HakoDevPanel.tsx";
import "./index.css";

// URL クエリで画面を切り替える。
//   ?demo … コーデック確認デモ
//   ?mock … window.ble (BLE I/O) を手で叩くモックパネル
// 既定は本番 UI（PixiJS の App）。
const params = new URLSearchParams(window.location.search);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {params.has("demo") ? <CodecDemo /> : params.has("mock") ? <HakoDevPanel /> : <App />}
  </React.StrictMode>,
);

// Use contextBridge (Electron 以外 = ブラウザでは ipcRenderer が無いのでガード)
window.ipcRenderer?.on("main-process-message", (_event, message) => {
  console.log(message);
});
