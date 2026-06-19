// seed → 「1 文字 ↔ 10 バイトのランダムコード」テーブルを決定的に生成する。
// 「テーブルを作る側」。encode/decode（テーブルを使う側）とは分離している。
// 設計の根拠は docs/charcode-codec.md（判断3・判断4）を参照。

import { ALPHABET, ALPHABET_SIZE } from "./alphabet";
import { createRng, randInt } from "./prng";

/** 1 文字あたりのコード長（バイト）。パケット body 長（4/2/10 の 10）と一致。 */
export const CODE_BYTES = 10;

/**
 * 文字コードテーブル。encode/decode はこれだけ受け取れば動く。
 * - `charToCode`: 文字 → 10 バイトコード
 * - `codeToChar`: コード(hex 文字列) → 文字（完全一致の逆引き用）
 */
export interface CodecTable {
  readonly size: number;
  readonly codeBytes: number;
  readonly charToCode: ReadonlyMap<string, Uint8Array>;
  readonly codeToChar: ReadonlyMap<string, string>;
}

/** バイト列を小文字 hex に。codeToChar のキーに使う。 */
export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * 確定文字セットの各文字に、seed から決定的に「重複しない 10 バイト乱数」を割り当てる。
 * 同じ seed → 必ず同じ割り当て（両端で再現可能）。
 *
 * 10 バイト = 80bit の空間に 121 文字を散らすので、傍受者は鍵（seed）なしに逆引きできない。
 */
export function tableFromSeed(seed: string): CodecTable {
  const rng = createRng(seed);
  const charToCode = new Map<string, Uint8Array>();
  const codeToChar = new Map<string, string>();

  for (const char of ALPHABET) {
    let code: Uint8Array;
    let hex: string;
    // 80bit 空間なので衝突は実質起きないが、念のため重複したら引き直す（決定的）。
    do {
      code = new Uint8Array(CODE_BYTES);
      for (let i = 0; i < CODE_BYTES; i++) code[i] = randInt(rng, 256);
      hex = toHex(code);
    } while (codeToChar.has(hex));
    charToCode.set(char, code);
    codeToChar.set(hex, char);
  }

  return {
    size: ALPHABET_SIZE,
    codeBytes: CODE_BYTES,
    charToCode,
    codeToChar,
  };
}
