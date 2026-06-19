import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import BleDevPanel from "./BleDevPanel.tsx";
import CodecDemo from "./CodecDemo.tsx";
import "./index.css";

// 一時的にコーデック確認デモを表示中（本UIに戻すときは <App /> + <BleDevPanel /> へ）
void App;
void BleDevPanel;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CodecDemo />
  </React.StrictMode>,
);

// Use contextBridge (Electron 以外 = ブラウザでは ipcRenderer が無いのでガード)
window.ipcRenderer?.on("main-process-message", (_event, message) => {
  console.log(message);
});
