import { describe, expect, test } from "vite-plus/test";

import { GAP_PLACEHOLDER, assembleText, maxSeqOf, placeChar } from "./assembler";

describe("placeChar（dedup）", () => {
  test("新規 seq は true、同 seq の再投入は false（1 スロット）", () => {
    const chars = new Map<number, string>();
    expect(placeChar(chars, 0, "あ")).toBe(true);
    expect(placeChar(chars, 0, "あ")).toBe(false);
    expect(chars.size).toBe(1);
  });

  test("同 seq の上書きは冪等（最後の値が残る）", () => {
    const chars = new Map<number, string>();
    placeChar(chars, 1, "い");
    placeChar(chars, 1, "う");
    expect(chars.get(1)).toBe("う");
    expect(chars.size).toBe(1);
  });
});

describe("assembleText", () => {
  test("順不同で投入しても seq 昇順で連結（reorder）", () => {
    const chars = new Map<number, string>();
    placeChar(chars, 2, "2");
    placeChar(chars, 0, "0");
    placeChar(chars, 1, "1");
    expect(assembleText(chars)).toBe("012");
  });

  test("歯抜けはプレースホルダで埋まる（gap）", () => {
    const chars = new Map<number, string>();
    placeChar(chars, 0, "0");
    placeChar(chars, 2, "2");
    expect(assembleText(chars)).toBe(`0${GAP_PLACEHOLDER}2`);
  });

  test("空なら空文字", () => {
    expect(assembleText(new Map())).toBe("");
  });
});

describe("maxSeqOf", () => {
  test("空は -1、最大 seq を返す", () => {
    expect(maxSeqOf(new Map())).toBe(-1);
    const chars = new Map<number, string>([
      [0, "a"],
      [5, "b"],
      [3, "c"],
    ]);
    expect(maxSeqOf(chars)).toBe(5);
  });
});
