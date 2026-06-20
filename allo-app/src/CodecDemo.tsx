import { useMemo, useState } from "react";
import { ALPHABET } from "../electron/codec/alphabet";
import { createCodec } from "../electron/codec/codec";
import { tableFromSeed, toHex } from "../electron/codec/table";

// コーデック変換確認デモ。codec は純 JS なのでレンダラーから直接 import（IPC 不要）。
// 確認したい 4 性質: 1文字=10B / N文字=Nパケット / 同seedで往復一致 / 別seedで読めない。

const ALPHABET_SET = new Set(ALPHABET);

/** 文字セット内/外で文字列を仕分ける。 */
function splitByAlphabet(text: string): { valid: string; invalid: string[] } {
  let valid = "";
  const invalid: string[] = [];
  for (const ch of Array.from(text)) {
    if (ALPHABET_SET.has(ch)) valid += ch;
    else invalid.push(ch);
  }
  return { valid, invalid };
}

export default function CodecDemo() {
  const [seed, setSeed] = useState("あいことば");
  const [text, setText] = useState("こんにちは");
  const [eveSeed, setEveSeed] = useState("ちがうあいことば");
  const [showTable, setShowTable] = useState(false);

  const { valid, invalid } = useMemo(() => splitByAlphabet(text), [text]);

  // 送信者テーブルは 1 回だけ作り、encode とプレビューの両方で使い回す。
  const table = useMemo(() => tableFromSeed(seed), [seed]);
  const codec = useMemo(() => createCodec(table), [table]);
  const chars = useMemo(() => Array.from(valid), [valid]);
  const codes = useMemo(() => chars.map((c) => codec.encodeChar(c)), [chars, codec]);

  // 同 seed の往復・別 seed の盗み見。
  const decoded = useMemo(() => codec.decode(codes), [codec, codes]);
  const eveDecoded = useMemo(
    () => createCodec(tableFromSeed(eveSeed)).decode(codes),
    [eveSeed, codes],
  );

  return (
    <div style={styles.page}>
      <div style={styles.inner}>
        <h1 style={styles.h1}>コーデック変換確認</h1>

        <section style={styles.card}>
          <label style={styles.label}>
            🔑 共有 seed（合言葉）
            <input style={styles.input} value={seed} onChange={(e) => setSeed(e.target.value)} />
          </label>
          <label style={styles.label}>
            ✍️ 本文
            <input style={styles.input} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p style={styles.meta}>
            {chars.length} 文字 / {codes.length} パケット
            {invalid.length > 0 && (
              <span style={styles.warn}> ・ セット外文字（除外）: {invalid.join(" ")}</span>
            )}
          </p>
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>① エンコード（1 文字 → 10 バイト）</h2>
          {chars.length === 0 ? (
            <p style={styles.dim}>（本文が空、またはセット外文字のみ）</p>
          ) : (
            <ul style={styles.codeList}>
              {chars.map((c, i) => (
                <li key={i} style={styles.codeRow}>
                  <span style={styles.codeChar}>{c}</span>
                  <span style={styles.arrow}>→</span>
                  <code style={styles.hex}>{toHex(codes[i])}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>② デコード（同じ seed）</h2>
          <p>
            <code style={styles.result}>{decoded || "　"}</code>{" "}
            {decoded === valid ? (
              <span style={styles.ok}>✓ 一致</span>
            ) : (
              <span style={styles.warn}>✗ 不一致</span>
            )}
          </p>
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>③ 盗み見デモ（別 seed）</h2>
          <label style={styles.label}>
            傍受者 seed
            <input
              style={styles.input}
              value={eveSeed}
              onChange={(e) => setEveSeed(e.target.value)}
            />
          </label>
          <p>
            <code style={styles.result}>{eveDecoded || "　"}</code>{" "}
            {eveDecoded === valid && valid.length > 0 ? (
              <span style={styles.warn}>⚠ 同じ seed では読めてしまう</span>
            ) : (
              <span style={styles.ok}>✗ 読めない（鍵が違う）</span>
            )}
          </p>
        </section>

        <section style={styles.card}>
          <button style={styles.button} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "▼" : "▶"} テーブルプレビュー（seed: {seed || "(空)"} ・ {ALPHABET.length}{" "}
            字）
          </button>
          {showTable && (
            <ul style={styles.tableList}>
              {ALPHABET.map((c) => (
                <li key={c} style={styles.tableRow}>
                  <span style={styles.codeChar}>{c}</span>
                  <code style={styles.hexSmall}>{toHex(table.charToCode.get(c)!)}</code>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    // index.css が body を overflow:hidden にしている（PixiJS 全画面用）ため、
    // デモ画面はコンテナ自身をスクロール可能にする。
    height: "100vh",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: 24,
    fontFamily: "sans-serif",
    color: "#e8e8e8",
  },
  inner: { maxWidth: 720, margin: "0 auto" },
  h1: { fontSize: 22, marginBottom: 16 },
  h2: { fontSize: 15, margin: "0 0 8px" },
  card: {
    background: "#1f1b33",
    border: "1px solid #3a3458",
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
  },
  label: { display: "block", fontSize: 13, marginBottom: 10 },
  input: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    marginTop: 4,
    padding: "8px 10px",
    fontSize: 15,
    background: "#12101f",
    color: "#fff",
    border: "1px solid #4a4470",
    borderRadius: 6,
  },
  meta: { fontSize: 12, color: "#a9a4c7", margin: "4px 0 0" },
  warn: { color: "#ffb454" },
  ok: { color: "#7ee787" },
  dim: { color: "#8a85a8", fontSize: 13 },
  codeList: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 },
  codeRow: { display: "flex", alignItems: "center", gap: 8 },
  codeChar: {
    display: "inline-block",
    minWidth: 24,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
  },
  arrow: { color: "#8a85a8" },
  hex: { fontFamily: "monospace", fontSize: 13, color: "#9ad", letterSpacing: 1 },
  hexSmall: { fontFamily: "monospace", fontSize: 11, color: "#9ad" },
  result: { fontSize: 18, background: "#12101f", padding: "4px 8px", borderRadius: 4 },
  button: {
    background: "transparent",
    color: "#c7ccff",
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    padding: 0,
  },
  tableList: {
    listStyle: "none",
    margin: "12px 0 0",
    padding: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
    gap: 2,
  },
  tableRow: { display: "flex", alignItems: "center", gap: 6 },
};
