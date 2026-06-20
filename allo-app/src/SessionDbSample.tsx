import { useEffect, useState } from "react";
import * as sessionStore from "./db/sessionStore";
import type { SessionRecord } from "./db/sessionStore";

// セッション履歴ストア (src/db/sessionStore.ts) の最小サンプル。
// テーブルは初回 open 時に自動生成される。URL に ?db-sample を付けたときだけ表示。

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
  marginBottom: 6,
};

export default function SessionDbSample() {
  const [sessionId, setSessionId] = useState("s-001");
  const [content, setContent] = useState("こんにちは");
  const [rows, setRows] = useState<SessionRecord[]>([]);

  // 一覧を読み直す。
  const refresh = () => void sessionStore.all().then(setRows);

  useEffect(refresh, []);

  const onSave = async () => {
    await sessionStore.save(sessionId, content);
    refresh();
  };

  const onDelete = async (id: string) => {
    await sessionStore.remove(id);
    refresh();
  };

  const onClear = async () => {
    await sessionStore.clear();
    refresh();
  };

  return (
    <div style={wrap}>
      <h2 style={{ marginTop: 0 }}>セッション履歴ストア · サンプル</h2>

      <div style={card}>
        <div style={{ marginBottom: 6, opacity: 0.7 }}>保存 (save) — 同じ session_id は上書き</div>
        <input
          style={input}
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="session_id"
          spellCheck={false}
        />
        <input
          style={input}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="content"
          spellCheck={false}
        />
        <button style={btn} onClick={onSave}>
          保存
        </button>
      </div>

      <div style={card}>
        <div style={{ marginBottom: 6, opacity: 0.7 }}>
          一覧 (all · created_at 昇順) · {rows.length} 件
          <button style={{ ...btn, marginLeft: 8 }} onClick={refresh}>
            再読込
          </button>
          <button style={btn} onClick={onClear}>
            全消し
          </button>
        </div>
        <div style={{ maxHeight: 260, overflow: "auto" }}>
          {rows.map((r) => (
            <div key={r.session_id} style={{ wordBreak: "break-all", marginBottom: 4 }}>
              <span style={{ opacity: 0.5 }}>{r.created_at.toLocaleString()} </span>
              <b>{r.session_id}</b>: {r.content}
              <button style={{ ...btn, marginLeft: 8, padding: "1px 8px" }} onClick={() => onDelete(r.session_id)}>
                削除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
