import { describe, expect, test } from "vite-plus/test";

import { ALPHABET, ALPHABET_SIZE } from "./alphabet";
import { CODE_BYTES, tableFromSeed, toHex } from "./table";
import { REPLACEMENT, createCodec } from "./codec";

describe("alphabet", () => {
  test("121 文字・重複なし・256 未満", () => {
    expect(ALPHABET_SIZE).toBe(121);
    expect(new Set(ALPHABET).size).toBe(121);
    expect(ALPHABET_SIZE).toBeLessThan(256);
  });
});

describe("tableFromSeed", () => {
  test("同じ seed なら同じ割り当て（決定的）", () => {
    const a = tableFromSeed("あいことば");
    const b = tableFromSeed("あいことば");
    for (const char of ALPHABET) {
      expect(toHex(a.charToCode.get(char)!)).toBe(toHex(b.charToCode.get(char)!));
    }
  });

  test("違う seed なら別の割り当て", () => {
    const a = tableFromSeed("seed-A");
    const b = tableFromSeed("seed-B");
    expect(toHex(a.charToCode.get("あ")!)).not.toBe(toHex(b.charToCode.get("あ")!));
  });

  test("全文字に 10 バイトコードが付き、重複しない", () => {
    const { charToCode, codeToChar } = tableFromSeed("zzz");
    expect(charToCode.size).toBe(ALPHABET_SIZE);
    expect(codeToChar.size).toBe(ALPHABET_SIZE); // 衝突なし
    for (const code of charToCode.values()) {
      expect(code.length).toBe(CODE_BYTES);
    }
  });

  test("charToCode と codeToChar が逆写像", () => {
    const { charToCode, codeToChar } = tableFromSeed("zzz");
    for (const [char, code] of charToCode) {
      expect(codeToChar.get(toHex(code))).toBe(char);
    }
  });
});

describe("encodeChar / decodeChar（1 文字 ↔ 10 バイト）", () => {
  const codec = createCodec(tableFromSeed("あいことば"));

  test("1 文字が 10 バイトに化け、戻る", () => {
    const code = codec.encodeChar("あ");
    expect(code.length).toBe(CODE_BYTES);
    expect(codec.decodeChar(code)).toBe("あ");
  });

  test("全文字ラウンドトリップ", () => {
    for (const char of ALPHABET) {
      expect(codec.decodeChar(codec.encodeChar(char))).toBe(char);
    }
  });

  test("返すコードはテーブル内部のコピー（外部から壊せない）", () => {
    const a = codec.encodeChar("あ");
    a[0] ^= 0xff; // 改変しても
    expect(codec.decodeChar(codec.encodeChar("あ"))).toBe("あ"); // テーブルは無傷
  });

  test("未知のコードは null", () => {
    expect(codec.decodeChar(new Uint8Array(CODE_BYTES))).toBe(null);
  });
});

describe("encode / decode（文字列 ↔ コード列）", () => {
  const codec = createCodec(tableFromSeed("あいことば"));

  test("N 文字 → N コード → 元の文字列", () => {
    const text = "こんにちは";
    const codes = codec.encode(text);
    expect(codes).toHaveLength(5);
    expect(codes.every((c) => c.length === CODE_BYTES)).toBe(true);
    expect(codec.decode(codes)).toBe(text);
  });

  test("カタカナ・数字・記号も通る", () => {
    const text = "アロ１２３ー！";
    expect(codec.decode(codec.encode(text))).toBe(text);
  });

  test("空文字列 → 空コード列 → 空", () => {
    expect(codec.encode("")).toHaveLength(0);
    expect(codec.decode([])).toBe("");
  });
});

describe("異常系", () => {
  const codec = createCodec(tableFromSeed("key"));

  test("文字セット外の文字は例外", () => {
    expect(() => codec.encodeChar("が")).toThrow(); // 濁音は初版に無い
    expect(() => codec.encodeChar("A")).toThrow(); // 半角英字は無い
  });
});

describe("鍵がなければ読めない（共有者だけ復号）", () => {
  test("別 seed のテーブルで復号すると元文に戻らず置換文字になる", () => {
    const sender = createCodec(tableFromSeed("正しいあいことば"));
    const attacker = createCodec(tableFromSeed("ちがうあいことば"));

    const text = "ひみつのはなし"; // 清音のみ
    const codes = sender.encode(text);
    const decoded = attacker.decode(codes);
    expect(decoded).not.toBe(text);
    expect(decoded).toBe(REPLACEMENT.repeat(text.length)); // 全コードが未知
  });
});
