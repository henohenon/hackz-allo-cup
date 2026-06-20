import { describe, expect, test } from "vite-plus/test";

import {
  CHAR_FIELD_BYTES,
  createSessionId,
  isPackableChar,
  packAdvertise,
  sessionIdKey,
  toHex,
  unpackAdvertise,
} from "./pack";

describe("packAdvertise / unpackAdvertise", () => {
  const sessionId = new Uint8Array([0x12, 0x34, 0x56, 0x78]);

  test("round-trip: ひらがな", () => {
    const hex = packAdvertise(sessionId, 0, "あ");
    expect(hex).toHaveLength(32);
    expect(unpackAdvertise(hex)).toEqual({ sessionId: "12345678", seq: 0, char: "あ" });
  });

  test("round-trip: 漢字・英字・記号・絵文字", () => {
    for (const char of ["漢", "A", "！", "🎵", "が", "①"]) {
      const hex = packAdvertise(sessionId, 1, char);
      expect(unpackAdvertise(hex).char).toBe(char);
    }
  });

  test("round-trip: seq 境界", () => {
    const lo = unpackAdvertise(packAdvertise(sessionId, 0, "い"));
    const hi = unpackAdvertise(packAdvertise(sessionId, 0xffff, "う"));
    expect(lo.seq).toBe(0);
    expect(hi.seq).toBe(0xffff);
  });

  test("createSessionId / sessionIdKey", () => {
    const id = createSessionId();
    expect(id).toHaveLength(4);
    expect(sessionIdKey(id)).toBe(toHex(id));
    expect(sessionIdKey(id)).toHaveLength(8);
  });

  test("isPackableChar: UTF-8 が領域内なら true", () => {
    expect(isPackableChar("あ")).toBe(true);
    expect(isPackableChar("🎵")).toBe(true);
    expect(isPackableChar("")).toBe(false);
    expect(isPackableChar("ab")).toBe(false);
  });

  test("UTF-8 が CHAR_FIELD_BYTES を超える文字は throw", () => {
    // U+1F3F4 U+E0067 U+E0062 U+E0065 U+E006E U+E007F = 28 bytes in UTF-8
    const longChar = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E007F}";
    expect(new TextEncoder().encode(longChar).length).toBeGreaterThan(CHAR_FIELD_BYTES);
    expect(() => packAdvertise(sessionId, 0, longChar)).toThrow();
  });
});
