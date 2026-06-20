import { useState } from "react";

// セッション履歴ストア (src/db/sessionStore.ts) を DevTools コンソールで叩くための
// コマンド見本ページ。フォームは無く、コピペして使う生コマンドを列挙するだけ。
// URL に ?db-sample を付けたときだけ表示。
//
// まず先頭の「読み込み」を 1 回流すと、以降 db.xxx() が使える。

interface Snippet {
  label: string;
  code: string;
}

const SNIPPETS: Snippet[] = [
  {
    label: "① 読み込み (最初に 1 回。以降 db.xxx() で叩ける)",
    code: `const db = await import('/src/db/sessionStore.ts');`,
  },
  {
    label: "保存 (save · 同じ session_id は上書き。created_at は必須)",
    code: `await db.save('s-001', 'こんにちは', new Date());`,
  },
  {
    label: "保存 (created_at を明示指定)",
    code: `await db.save('s-002', 'コトハコビ起動', new Date('2026-06-20T11:30:00'));`,
  },
  {
    label: "主キーで 1 件取得 (get)",
    code: `await db.get('s-001');`,
  },
  {
    label: "全件 (all · created_at 昇順)",
    code: `await db.all();`,
  },
  {
    label: "created_at の範囲 (between · 両端含む)",
    code: `await db.between(new Date('2026-06-20'), new Date('2026-06-21'));`,
  },
  {
    label: "content 部分一致 (search)",
    code: `await db.search('こん');`,
  },
  {
    label: "最新 5 件 (created_at 降順)",
    code: `(await db.all()).slice(-5).reverse();`,
  },
  {
    label: "今日のぶんだけ",
    code: `await (async () => {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(s); e.setDate(e.getDate() + 1);
  return db.between(s, e);
})();`,
  },
  {
    label: "期間 × content の複合 (between で粗く絞って JS で filter)",
    code: `(await db.between(new Date('2026-06-20'), new Date('2026-06-21')))
  .filter(r => r.content.includes('コト'));`,
  },
  {
    label: "session_id 前方一致",
    code: `(await db.all()).filter(r => r.session_id.startsWith('s-'));`,
  },
  {
    label: "件数 (count)",
    code: `(await db.all()).length;`,
  },
  {
    label: "1 件削除 (remove)",
    code: `await db.remove('s-001');`,
  },
  {
    label: "全消し (clear)",
    code: `await db.clear();`,
  },
];

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
const row: React.CSSProperties = { marginBottom: 12 };
const pre: React.CSSProperties = {
  background: "rgba(0,0,0,0.05)",
  border: "1px solid rgba(0,0,0,0.18)",
  borderRadius: 6,
  padding: "8px 10px",
  margin: "4px 0 0",
  overflowX: "auto",
  cursor: "pointer",
  whiteSpace: "pre",
};

export default function SessionDbSample() {
  const [copied, setCopied] = useState<number | null>(null);

  const copy = (code: string, i: number) => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
    });
  };

  return (
    <div style={wrap}>
      <div style={inner}>
      <h2 style={{ marginTop: 0 }}>セッション履歴ストア · コンソールコマンド集</h2>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        DevTools の Console に貼って使う。クリックでコピー。まず ① を 1 回流すこと。
      </p>
      {SNIPPETS.map((s, i) => (
        <div key={i} style={row}>
          <div style={{ opacity: 0.7 }}>{s.label}</div>
          <pre style={pre} onClick={() => copy(s.code, i)} title="クリックでコピー">
            {s.code}
            {copied === i && <span style={{ color: "#137333" }}>  ← copied</span>}
          </pre>
        </div>
      ))}
      </div>
    </div>
  );
}
