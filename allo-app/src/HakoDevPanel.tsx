import { useEffect, useState } from "react";

// window.ble (薄い BLE I/O) を手で叩くためのモックパネル。
// codec / pack / 重複除去 / スケジューラ / 永続化 は一切持たない。
// 「任意の生データを撒く / 拾った生データを見る」だけの API ラッパー確認ハーネス。
// URL に ?mock-ble を付けたときだけ表示する。

type BleStatus = "IDLE" | "ADVERTISE" | "SCANNING";

interface ReceivedPacket {
  at: number;
  serviceUuids: string[];
}

const wrap: React.CSSProperties = {
  font: "13px/1.6 monospace",
  maxWidth: 720,
  margin: "0 auto",
  padding: 16,
  color: "#111",
  background: "#fff",
};
const card: React.CSSProperties = {
  background: "rgba(0,0,0,0.03)",
  border: "1px solid rgba(0,0,0,0.18)",
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
};
const btn: React.CSSProperties = { margin: "2px 6px 2px 0", padding: "6px 12px", cursor: "pointer" };
const input: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  font: "13px monospace",
  boxSizing: "border-box",
};

/** 32 桁 hex (16Byte = Service UUID 1 個ぶん) をランダム生成。送信ロジックは持たないので確認用の素材だけ。 */
function randomHex32(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function HakoDevPanel() {
  const [status, setStatus] = useState<BleStatus>("IDLE");
  const [uuid, setUuid] = useState(randomHex32);
  const [packets, setPackets] = useState<ReceivedPacket[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (line: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [`${ts}  ${line}`, ...prev].slice(0, 100));
  };

  useEffect(() => {
    if (!window.ble) {
      addLog("window.ble が無い (Electron 以外で起動?)");
      return;
    }
    const off = window.ble.onPacket((serviceUuids) => {
      setPackets((prev) => [{ at: Date.now(), serviceUuids }, ...prev].slice(0, 200));
    });
    return off;
  }, []);

  const changeStatus = async (next: BleStatus) => {
    if (!window.ble) return;
    const r = await window.ble.setStatus(next);
    addLog(`setStatus(${next}) -> ${r.ok ? "ok" : `NG: ${r.error ?? ""}`}`);
    if (r.ok) setStatus(next);
  };

  const sendAdvertise = async () => {
    if (!window.ble) return;
    const r = await window.ble.advertise([uuid]);
    addLog(`advertise([${uuid.slice(0, 8)}…]) -> ${r.ok ? "ok" : `NG: ${r.error ?? ""}`}`);
  };

  return (
    <div style={wrap}>
      <h2 style={{ marginTop: 0 }}>HAKO · BLE I/O モック</h2>

      {/* ステータス (排他) */}
      <div style={card}>
        <div style={{ marginBottom: 6, opacity: 0.7 }}>ステータス (排他)</div>
        {(["IDLE", "ADVERTISE", "SCANNING"] as const).map((s) => (
          <button
            key={s}
            style={{
              ...btn,
              fontWeight: status === s ? "bold" : "normal",
              outline: status === s ? "2px solid #5bd" : "none",
            }}
            onClick={() => changeStatus(s)}
          >
            {s}
          </button>
        ))}
        <span style={{ marginLeft: 8, opacity: 0.7 }}>現在: {status}</span>
      </div>

      {/* 発信 (生データを撒く) */}
      <div style={card}>
        <div style={{ marginBottom: 6, opacity: 0.7 }}>
          発信 — 任意の Service UUID (32 桁 hex) を撒く。ADVERTISE 中のみ有効
        </div>
        <input
          style={input}
          value={uuid}
          onChange={(e) => setUuid(e.target.value.trim().toLowerCase())}
          spellCheck={false}
        />
        <div style={{ marginTop: 8 }}>
          <button style={btn} onClick={() => setUuid(randomHex32())}>
            ランダム生成
          </button>
          <button style={btn} disabled={status !== "ADVERTISE"} onClick={sendAdvertise}>
            撒く (advertise)
          </button>
        </div>
      </div>

      {/* 受信 (生のまま全部) */}
      <div style={card}>
        <div style={{ marginBottom: 6, opacity: 0.7 }}>
          受信 — onPacket の生データ (重複除去なし) · {packets.length} 件
          <button style={{ ...btn, marginLeft: 8 }} onClick={() => setPackets([])}>
            クリア
          </button>
        </div>
        <div style={{ maxHeight: 200, overflow: "auto" }}>
          {packets.map((p, i) => (
            <div key={i} style={{ wordBreak: "break-all", marginBottom: 4 }}>
              <span style={{ opacity: 0.5 }}>{new Date(p.at).toLocaleTimeString()} </span>
              <span style={{ color: "#137333" }}>uuids=[{p.serviceUuids.join(", ")}]</span>
            </div>
          ))}
        </div>
      </div>

      {/* 操作ログ */}
      <div style={card}>
        <div style={{ marginBottom: 6, opacity: 0.7 }}>ログ</div>
        <div style={{ maxHeight: 160, overflow: "auto" }}>
          {log.map((line, i) => (
            <div key={i} style={{ opacity: 0.85 }}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
