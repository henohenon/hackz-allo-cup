// 依存ゼロの ANSI TUI。上部にデバイス情報ヘッダー、下部を左右 2 ペイン
// (発信 TX / 受信 RX) に分割してログを流す。SSH 越しの Pi OS Lite でも動くよう
// 外部ライブラリは使わず素の ANSI エスケープのみで描画する。
//
// 非 TTY (パイプ / systemd など) のときは画面制御をやめ、行ログを素直に流す。

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR_BELOW = "\x1b[J";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

const MAX_LINES = 2000;

function timeStr(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// East Asian Width を考慮した 1 文字の表示桁数 (全角=2, 半角=1)。
// 端末でのカラムずれを防ぐため、日本語などの全角文字を 2 桁として数える。
function charWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // ハングル字母
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首 / 記号
    (cp >= 0x3041 && cp <= 0x33ff) || // ひらがな・カタカナ・CJK 記号
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 拡張 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 統合漢字
    (cp >= 0xa000 && cp <= 0xa4cf) || // イ文字
    (cp >= 0xac00 && cp <= 0xd7a3) || // ハングル音節
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 互換漢字
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 互換形
    (cp >= 0xff00 && cp <= 0xff60) || // 全角英数記号
    (cp >= 0xffe0 && cp <= 0xffe6) || // 全角記号
    (cp >= 0x1f300 && cp <= 0x1faff) || // 絵文字
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK 拡張 B 以降
  ) {
    return 2;
  }
  return 1;
}

/** 文字列の表示桁数 (全角を 2 桁として合計)。 */
function strWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0));
  return w;
}

/** 制御文字を除き、表示幅 width 桁に収める (溢れたら末尾を … にする)。 */
function clip(s, width) {
  const clean = String(s)
    .replace(/\t/g, "  ")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  if (strWidth(clean) <= width) return clean;
  let out = "";
  let w = 0;
  for (const ch of clean) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > width - 1) break; // … (1 桁) の分を残す
    out += ch;
    w += cw;
  }
  return out + "…";
}

/** clip した上で width 桁まで空白で埋める (表示幅基準)。 */
function cell(s, width) {
  const v = clip(s, width);
  return v + " ".repeat(Math.max(0, width - strWidth(v)));
}

export function createTui({ title = "ALLO BLE relay" } = {}) {
  const isTty = Boolean(process.stdout.isTTY);
  let header = [];
  const tx = [];
  const rx = [];

  function pushLine(arr, tag, msg) {
    const line = `${timeStr()} ${msg}`;
    arr.push(line);
    if (arr.length > MAX_LINES) arr.splice(0, arr.length - MAX_LINES);
    if (!isTty) process.stdout.write(`[${tag}] ${line}\n`);
  }

  function frame() {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    if (cols < 24 || rows < 8) {
      return HOME + CLEAR_BELOW + `端末が小さすぎます (${cols}x${rows})`;
    }

    const leftW = Math.floor((cols - 3) / 2);
    const rightW = cols - 3 - leftW;
    const line = (l, m, r, fill) => l + fill.repeat(leftW) + m + fill.repeat(rightW) + r;

    const out = [];
    // ── ヘッダー枠 (タイトル付き上枠) ───────────────────────────────
    const titleText = ` ${title} `;
    const topInner = cols - 2;
    const dashL = 1;
    const topBar =
      "─" + titleText + "─".repeat(Math.max(0, topInner - dashL - strWidth(titleText)));
    out.push(C.cyan + "┌" + clip(topBar, topInner) + "┐" + C.reset);
    for (const h of header) {
      out.push(C.cyan + "│" + C.reset + " " + cell(h, cols - 3) + C.cyan + "│" + C.reset);
    }
    // ── ペイン見出し ────────────────────────────────────────────
    out.push(C.cyan + line("├", "┬", "┤", "─") + C.reset);
    out.push(
      C.cyan +
        "│" +
        C.green +
        C.bold +
        cell(" 発信 TX ▶", leftW) +
        C.reset +
        C.cyan +
        "│" +
        C.yellow +
        C.bold +
        cell(" ◀ RX 受信", rightW) +
        C.reset +
        C.cyan +
        "│" +
        C.reset,
    );
    out.push(C.cyan + line("├", "┼", "┤", "─") + C.reset);

    // ── ログ本体 (下から詰める) ──────────────────────────────────
    const used = out.length + 1; // +1 = 下枠
    const bodyRows = Math.max(0, rows - used);
    const txView = tx.slice(-bodyRows);
    const rxView = rx.slice(-bodyRows);
    for (let i = 0; i < bodyRows; i++) {
      const l = txView[i - (bodyRows - txView.length)] ?? "";
      const r = rxView[i - (bodyRows - rxView.length)] ?? "";
      out.push(
        C.cyan +
          "│" +
          C.green +
          cell(" " + l, leftW) +
          C.reset +
          C.cyan +
          "│" +
          C.yellow +
          cell(" " + r, rightW) +
          C.reset +
          C.cyan +
          "│" +
          C.reset,
      );
    }
    out.push(C.cyan + line("└", "┴", "┘", "─") + C.reset);

    // 画面行数ちょうどに収め、末尾改行でスクロールしないようにする
    const lines = out.slice(0, rows);
    while (lines.length < rows) lines.push("");
    return HOME + lines.map((s) => s + "\x1b[K").join("\n");
  }

  return {
    isTty,
    setHeader(lines) {
      header = lines;
      if (!isTty) {
        // 非 TTY ではヘッダーを 1 行サマリで出す (毎 tick 出すと煩いので変化検知)
        const flat = lines.join(" | ");
        if (flat !== this._lastHeader) {
          this._lastHeader = flat;
          process.stdout.write(`[HDR] ${flat}\n`);
        }
      }
    },
    logTx(msg) {
      pushLine(tx, "TX", msg);
    },
    logRx(msg) {
      pushLine(rx, "RX", msg);
    },
    render() {
      if (!isTty) return;
      process.stdout.write(frame());
    },
    start() {
      if (!isTty) return;
      process.stdout.write(ALT_ON + CURSOR_HIDE + HOME + CLEAR_BELOW);
    },
    stop() {
      if (!isTty) return;
      process.stdout.write(CURSOR_SHOW + ALT_OFF);
    },
  };
}
