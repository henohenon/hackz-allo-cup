import { useEffect, useState } from "react";

// BLE の発信・受信を手動で確認するための簡易デバッグパネル。
// 動作確認用なので、不要になったら main.tsx から外してよい。

interface DiscoveredDevice {
  id: string;
  localName: string | null;
  rssi: number;
  serviceUuids: string[];
  manufacturerDataHex: string | null;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  width: 280,
  maxHeight: "80vh",
  overflow: "auto",
  padding: 12,
  borderRadius: 8,
  background: "rgba(0, 0, 0, 0.72)",
  color: "#fff",
  font: "12px/1.5 monospace",
  zIndex: 9999,
};

const buttonStyle: React.CSSProperties = {
  margin: "2px 4px 2px 0",
  padding: "4px 8px",
  cursor: "pointer",
};

export default function BleDevPanel() {
  const [advertising, setAdvertising] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [devices, setDevices] = useState<Record<string, DiscoveredDevice>>({});

  const addLog = (line: string) => setLog((prev) => [line, ...prev].slice(0, 30));

  useEffect(() => {
    if (!window.ble) {
      addLog("window.ble が無い (Electron 以外で起動?)");
      return;
    }
    const off = window.ble.onDiscover((device) => {
      setDevices((prev) => ({ ...prev, [device.id]: device }));
    });
    return off;
  }, []);

  const handle = async (action: () => Promise<{ ok: boolean; error?: string }>, label: string) => {
    const result = await action();
    addLog(result.ok ? `${label}: OK` : `${label}: NG (${result.error ?? ""})`);
    return result.ok;
  };

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: "bold", marginBottom: 6 }}>BLE Debug</div>

      <div style={{ marginBottom: 6 }}>
        <div>発信 (bleno)</div>
        <button
          style={buttonStyle}
          disabled={advertising}
          onClick={async () => {
            if (await handle(() => window.ble.startAdvertise(), "発信開始")) setAdvertising(true);
          }}
        >
          開始
        </button>
        <button
          style={buttonStyle}
          disabled={!advertising}
          onClick={async () => {
            if (await handle(() => window.ble.stopAdvertise(), "発信停止")) setAdvertising(false);
          }}
        >
          停止
        </button>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div>受信 (noble)</div>
        <button
          style={buttonStyle}
          disabled={scanning}
          onClick={async () => {
            if (await handle(() => window.ble.startScan(), "受信開始")) setScanning(true);
          }}
        >
          開始
        </button>
        <button
          style={buttonStyle}
          disabled={!scanning}
          onClick={async () => {
            if (await handle(() => window.ble.stopScan(), "受信停止")) setScanning(false);
          }}
        >
          停止
        </button>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div>発見デバイス ({Object.keys(devices).length})</div>
        {Object.values(devices).map((d) => (
          <div key={d.id} style={{ color: d.localName === "ALLO" ? "#7CFC9B" : "#ccc" }}>
            <div>
              {d.localName} / rssi {d.rssi}
            </div>
            {d.serviceUuids.length > 0 && (
              <div style={{ wordBreak: "break-all", color: "#9ab" }}>
                uuid: {d.serviceUuids.join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>

      <div>
        <div>log</div>
        {log.map((line, i) => (
          <div key={i} style={{ color: "#9ab" }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
