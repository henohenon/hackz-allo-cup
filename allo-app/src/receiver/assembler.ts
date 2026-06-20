// 受信文字の組み立て（純関数・I/O なし）。
//
// session ごとに「seq → decode 済み 1 文字」の Map を持ち、
//   - dedup     : 同 seq は冪等（上書き）
//   - 並べ替え  : seq 昇順
//   - 歯抜け    : 0..maxSeq の欠番をプレースホルダで埋める
// を行う。transport 購読や永続化は receiver/index.ts と session/store.ts の責務。

/** 歯抜け（未受信 seq）の表示文字。 */
export const GAP_PLACEHOLDER = "□";

/**
 * 文字を seq 位置に置く。
 * @returns 新規配置なら true、既出 seq の上書きなら false（dedup 判定に使える）。
 */
export function placeChar(chars: Map<number, string>, seq: number, char: string): boolean {
  const isNew = !chars.has(seq);
  chars.set(seq, char); // 同位置は上書きで冪等
  return isNew;
}

/** 受信済みの最大 seq。空なら -1。 */
export function maxSeqOf(chars: Map<number, string>): number {
  let max = -1;
  for (const seq of chars.keys()) {
    if (seq > max) max = seq;
  }
  return max;
}

/** seq 昇順で連結した文章。欠番は GAP_PLACEHOLDER。 */
export function assembleText(chars: Map<number, string>): string {
  const max = maxSeqOf(chars);
  let out = "";
  for (let i = 0; i <= max; i++) {
    out += chars.get(i) ?? GAP_PLACEHOLDER;
  }
  return out;
}
