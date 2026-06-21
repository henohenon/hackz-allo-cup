import { useState } from "react";
import * as db from "./db/sessionStore";
import * as buf from "./db/sessionBuffer";

// セッション履歴ストア (sessionStore / sessionBuffer) を手で叩くモックパネル。
// 各関数を入力付きのフォームから実行し、結果とログを表示する。
// URL に ?mock-db を付けたときだけ表示。

const wrap: React.CSSProperties = {
  font: "13px/1.6 monospace",
  color: "#111",
  background: "#fff",
  // html,body が overflow:hidden (Pixi 用) なので、このページ自身で縦スクロールを持つ
  height: "100vh",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: 16,
};
const inner: React.CSSProperties = { maxWidth: 760, margin: "0 auto" };
const card: React.CSSProperties = {
  background: "rgba(0,0,0,0.03)",
  border: "1px solid rgba(0,0,0,0.18)",
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
};
const btn: React.CSSProperties = {
  margin: "2px 6px 2px 0",
  padding: "6px 12px",
  cursor: "pointer",
};
const input: React.CSSProperties = {
  padding: "6px 8px",
  font: "13px monospace",
  boxSizing: "border-box",
  marginRight: 6,
};
const head: React.CSSProperties = { marginBottom: 8, opacity: 0.7 };

// まとめて追加用の内容プール。文字数をばらけさせて、荷物一覧の箱サイズ変化も確認しやすくする。
const SAMPLE_CONTENTS = [
  "鍵",
  "本",
  "充電器",
  "おにぎり",
  "USBメモリ",
  "予備の乾電池",
  "母からの手紙",
  "会議資料一式",
  "旅行用の歯ブラシ",
  "薬と保険証とお薬手帳",
  "実家から届いたみかん箱",
  "冬物のコートとマフラー",
  "カメラのレンズ三本セット",
  "観葉植物の鉢植えセット一式",
  "ノートパソコンと充電ケーブル",
  "誕生日プレゼントのぬいぐるみ",
];

export default function MockDbPanel() {
  // 各操作の入力欄
  const [sid, setSid] = useState("s-001");
  const [content, setContent] = useState("コトハコビ起動");
  const [createdAt, setCreatedAt] = useState("2026-06-20T11:30");
  const [limit, setLimit] = useState("50");
  const [pushSid, setPushSid] = useState("live-1");
  const [pushText, setPushText] = useState("こんにちは");
  const [idleMs, setIdleMs] = useState("8000");
  const [maxWaitMs, setMaxWaitMs] = useState("30000");
  const [seedCount, setSeedCount] = useState("50");

  const [log, setLog] = useState<string[]>([]);

  // ダミーセッションを n 件まとめて保存する。
  // session_id は実行ごとにユニーク、created_at は新しい順に過去へずらす（getRecent 降順と整合）。
  const seed = async (n: number) => {
    const base = Date.now();
    const runTag = base.toString(36);
    let last = "";
    for (let i = 0; i < n; i++) {
      const session_id = `seed-${runTag}-${String(i).padStart(3, "0")}`;
      const content = SAMPLE_CONTENTS[i % SAMPLE_CONTENTS.length];
      const createdAt = new Date(base - i * 60_000); // i 分ずつ過去へ
      await db.save(session_id, content, createdAt);
      last = session_id;
    }
    return { added: n, firstId: `seed-${runTag}-000`, lastId: last };
  };

  // 関数を実行し、結果(またはエラー)をログ先頭に積む。
  const exec = async (label: string, fn: () => unknown) => {
    const ts = new Date().toLocaleTimeString();
    try {
      const result = await fn();
      const body = result === undefined ? "ok" : JSON.stringify(result, null, 2);
      setLog((prev) => [`${ts}  ${label}\n${body}`, ...prev].slice(0, 50));
    } catch (e) {
      setLog((prev) => [`${ts}  ${label}\nERROR: ${String(e)}`, ...prev].slice(0, 50));
    }
  };

  return (
    <div style={wrap}>
      <div style={inner}>
        <h2 style={{ marginTop: 0 }}>MOCK · セッション履歴ストア</h2>

        {/* save */}
        <div style={card}>
          <div style={head}>save — 保存 / 上書き (created_at 必須)</div>
          <input
            style={{ ...input, width: 110 }}
            value={sid}
            onChange={(e) => setSid(e.target.value)}
            placeholder="session_id"
          />
          <input
            style={{ ...input, width: 200 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="content"
          />
          <input
            style={{ ...input, width: 170 }}
            type="datetime-local"
            value={createdAt}
            onChange={(e) => setCreatedAt(e.target.value)}
          />
          <button
            style={btn}
            onClick={() => exec(`save(${sid})`, () => db.save(sid, content, new Date(createdAt)))}
          >
            save
          </button>
        </div>

        {/* seed */}
        <div style={card}>
          <div style={head}>まとめて追加 — ダミーセッションを n 件保存 (内容は文字数バラけ)</div>
          <input
            style={{ ...input, width: 70 }}
            value={seedCount}
            onChange={(e) => setSeedCount(e.target.value)}
            placeholder="件数"
          />
          <button
            style={btn}
            onClick={() => {
              const n = Math.max(1, Math.min(200, Math.floor(Number(seedCount) || 0)));
              void exec(`seed(${n})`, () => seed(n));
            }}
          >
            n 件まとめて追加
          </button>
        </div>

        {/* read */}
        <div style={card}>
          <div style={head}>getRecent — 直近 limit 件 (created_at 降順)</div>
          <input
            style={{ ...input, width: 70 }}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="limit"
          />
          <button
            style={btn}
            onClick={() => exec(`getRecent(${limit})`, () => db.getRecent(Number(limit)))}
          >
            getRecent
          </button>
        </div>

        {/* streaming buffer */}
        <div style={card}>
          <div style={head}>sessionBuffer — 1 文字ずつ push (idle/maxWait でフラッシュ)</div>
          <div style={{ marginBottom: 6 }}>
            idle
            <input
              style={{ ...input, width: 80, marginLeft: 6 }}
              value={idleMs}
              onChange={(e) => setIdleMs(e.target.value)}
            />
            maxWait
            <input
              style={{ ...input, width: 80, marginLeft: 6 }}
              value={maxWaitMs}
              onChange={(e) => setMaxWaitMs(e.target.value)}
            />
            <button
              style={btn}
              onClick={() =>
                exec("configure", () => {
                  buf.configure({ idleMs: Number(idleMs), maxWaitMs: Number(maxWaitMs) });
                })
              }
            >
              configure
            </button>
          </div>
          <div>
            <input
              style={{ ...input, width: 110 }}
              value={pushSid}
              onChange={(e) => setPushSid(e.target.value)}
              placeholder="session_id"
            />
            <input
              style={{ ...input, width: 200 }}
              value={pushText}
              onChange={(e) => setPushText(e.target.value)}
              placeholder="送る文字列"
            />
            <button
              style={btn}
              onClick={() =>
                exec(`push(${pushSid}) 1文字ずつ`, () => {
                  for (const ch of pushText) buf.push(pushSid, ch);
                })
              }
            >
              1 文字ずつ push
            </button>
            <button style={btn} onClick={() => exec("flushAll()", () => buf.flushAll())}>
              flushAll
            </button>
          </div>
        </div>

        {/* danger */}
        <div style={card}>
          <div style={head}>破壊系</div>
          <button style={btn} onClick={() => exec("clear()", () => db.clear())}>
            clear (全消し)
          </button>
        </div>

        {/* output */}
        <div style={card}>
          <div style={head}>
            結果 / ログ
            <button style={{ ...btn, marginLeft: 8 }} onClick={() => setLog([])}>
              クリア
            </button>
          </div>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            {log.map((line, i) => (
              <pre
                key={i}
                style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
              >
                {line}
              </pre>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
