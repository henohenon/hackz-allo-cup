import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import CodecDemo from "./CodecDemo.tsx";
import "./index.css";

// URL に ?demo を付けたときだけコーデック確認デモを表示する。
// デフォルトは本番 UI（PixiJS の App）。
// ※ BleDevPanel（HTML デバッグUI）はベースデザイン確認のため一旦非表示。
//    機能側のコードは src/BleDevPanel.tsx に残してある。
const isDemo = new URLSearchParams(window.location.search).has("demo");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isDemo ? <CodecDemo /> : <App />}</React.StrictMode>,
);

// Use contextBridge (Electron 以外 = ブラウザでは ipcRenderer が無いのでガード)
window.ipcRenderer?.on("main-process-message", (_event, message) => {
  console.log(message);
});
