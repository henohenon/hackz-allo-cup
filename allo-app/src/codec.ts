// codec ファサード。電子側の pure-JS codec（electron/codec）を再利用し、
// 「sessionId(4B) → seed(string)」規約をここ 1 箇所に集約する。
//
// 規約: seed = toHex(sessionId の 4 バイト)（小文字・2 桁ゼロ詰め、8 hex 文字）。
// 送信側・受信側とも UUID 文字列ではなく unpack 後のバイト列を toHex して seed にする
// （大文字/ダッシュ等のフォーマット差を吸収。prng は大小文字で別テーブルになるため）。

import { createCodec, type Codec } from "../electron/codec/codec";
import { tableFromSeed, toHex } from "../electron/codec/table";

export type { Codec };
export { toHex };

/** sessionId(4B) → codec seed 文字列。 */
export function seedFromSessionId(sessionId: Uint8Array): string {
  return toHex(sessionId);
}

// seed ごとの codec キャッシュ（tableFromSeed は 121 文字分の生成コストがある）。
const codecCache = new Map<string, Codec>();

/** sessionId に対応する codec を返す（seed が同じなら同一インスタンスを再利用）。 */
export function codecForSession(sessionId: Uint8Array): Codec {
  const seed = seedFromSessionId(sessionId);
  let codec = codecCache.get(seed);
  if (!codec) {
    codec = createCodec(tableFromSeed(seed));
    codecCache.set(seed, codec);
  }
  return codec;
}
