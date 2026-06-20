// テーブルを使う側。1 文字 ↔ 10 バイトコードの encode/decode。
// 1 パケット = 1 文字。複数文字は複数パケット（順序は seq で復元・パケット層の責務）。
// テーブルの作り方（seed / 鍵+salt / 直接共有）には依存しない。

import type { CodecTable } from "./table";
import { toHex } from "./table";

/** 復号できなかったコード（破損 or 鍵違い）を表す置換文字。 */
export const REPLACEMENT = "�";

/** encode/decode を提供するコーデック。テーブルだけ受け取って動く。 */
export interface Codec {
  /** 1 文字を 10 バイトコードに符号化する。 */
  encodeChar(char: string): Uint8Array;
  /** 10 バイトコードを 1 文字に復号する。未知のコードは null。 */
  decodeChar(code: Uint8Array): string | null;
  /** 文字列を 1 文字ずつコード化し、コード配列（= body 列）にする。 */
  encode(text: string): Uint8Array[];
  /** コード配列を文字列に復号する。未知コードは置換文字に。 */
  decode(codes: Uint8Array[]): string;
}

/**
 * テーブルから Codec を作る。
 *
 * @throws encodeChar で文字セット外の文字が来たとき。
 */
export function createCodec(table: CodecTable): Codec {
  const encodeChar = (char: string): Uint8Array => {
    const code = table.charToCode.get(char);
    if (code === undefined) {
      throw new Error(`文字セット外の文字です: "${char}"`);
    }
    // テーブル内のバッファを外部に晒さないようコピーを返す。
    return Uint8Array.from(code);
  };

  const decodeChar = (code: Uint8Array): string | null => {
    return table.codeToChar.get(toHex(code)) ?? null;
  };

  return {
    encodeChar,
    decodeChar,
    encode(text: string): Uint8Array[] {
      return Array.from(text).map(encodeChar);
    },
    decode(codes: Uint8Array[]): string {
      let result = "";
      for (const code of codes) {
        result += decodeChar(code) ?? REPLACEMENT;
      }
      return result;
    },
  };
}
