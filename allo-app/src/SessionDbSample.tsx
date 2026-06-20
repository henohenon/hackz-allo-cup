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
    code: `await db.save('s-001', 'コトハコビ起動', new Date('2026-06-20T11:30:00'));`,
  },
  {
    label: "まとめて 10 件投入 (動作確認用ダミー)",
    code: `await (async () => {
  const base = new Date('2026-06-20T00:00:00');
  for (let i = 0; i < 10; i++) {
    const at = new Date(base.getTime() + i * 60 * 60 * 1000); // 1 時間刻み
    await db.save(\`dummy-\${String(i).padStart(2, '0')}\`, \`ダミー \${i}\`, at);
  }
})();`,
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
    label: "直近 50 件 (getRecent · created_at 降順カーソル)",
    code: `await db.getRecent();        // 既定 50 件
// await db.getRecent(10);   // 件数指定`,
  },
  {
    label: "今日のぶんだけ",
    code: `await (async () => {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  // between は両端 inclusive なので、翌日 0:00 の 1ms 手前までを範囲にする
  const e = new Date(s); e.setDate(e.getDate() + 1); e.setMilliseconds(-1);
  return db.between(s, e);
})();`,
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
  {
    label: "② バッファ読み込み (ストリーミング入力の確認用。先に ① も)",
    code: `const buf = await import('/src/db/sessionBuffer.ts');`,
  },
  {
    label: "1 文字ずつ push (idle 8s で自動確定。短く試すなら configure)",
    code: `buf.configure({ idleMs: 1500, maxWaitMs: 5000 }); // 試験用に短縮
for (const ch of 'こんにちは') buf.push('live-1', ch);
// 1.5 秒放置 → 自動フラッシュ。db.get('live-1') で確認`,
  },
  {
    label: "全 draft を即確定 (flushAll · 画面遷移用)",
    code: `await buf.flushAll();`,
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
            <div style={{ opacity: 0.7 }}>
              {s.label}
              {copied === i && <span style={{ color: "#137333" }}> ✓ copied</span>}
            </div>
            <pre style={pre} onClick={() => copy(s.code, i)} title="クリックでコピー">
              {s.code}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
