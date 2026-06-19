import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import BleDevPanel from './BleDevPanel.tsx'
import CodecDemo from './CodecDemo.tsx'
import './index.css'

// URL に ?demo を付けたときだけコーデック確認デモを表示する。
// デフォルトは本番 UI（PixiJS の App + BleDevPanel）。
const isDemo = new URLSearchParams(window.location.search).has('demo')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDemo ? (
      <CodecDemo />
    ) : (
      <>
        <App />
        <BleDevPanel />
      </>
    )}
  </React.StrictMode>,
)

// Use contextBridge (Electron 以外 = ブラウザでは ipcRenderer が無いのでガード)
window.ipcRenderer?.on('main-process-message', (_event, message) => {
  console.log(message)
})
