import { describe, expect, test } from "vite-plus/test";

import {
  BODY_BYTES,
  PACKET_BYTES,
  SESSION_BYTES,
  packServiceUuid,
  unpackServiceUuid,
} from "./packet";

function bytes(...vals: number[]): Uint8Array {
  return Uint8Array.from(vals);
}

function randomBody(): Uint8Array {
  const b = new Uint8Array(BODY_BYTES);
  for (let i = 0; i < BODY_BYTES; i++) b[i] = (i * 37 + 13) & 0xff;
  return b;
}

describe("packServiceUuid", () => {
  test("32 桁小文字 hex・ダッシュ無しで返る", () => {
    const uuid = packServiceUuid({ sessionId: bytes(1, 2, 3, 4), seq: 0, body: randomBody() });
    expect(uuid).toMatch(/^[0-9a-f]{32}$/);
    expect(uuid.length).toBe(PACKET_BYTES * 2);
  });

  test("seq は big-endian で [4..5] に入る", () => {
    const uuid = packServiceUuid({
      sessionId: bytes(0, 0, 0, 0),
      seq: 0x0102,
      body: new Uint8Array(BODY_BYTES),
    });
    // offset 4,5 = hex index 8..12
    expect(uuid.slice(8, 12)).toBe("0102");
  });

  test("不正入力は例外", () => {
    expect(() =>
      packServiceUuid({ sessionId: bytes(1, 2, 3), seq: 0, body: randomBody() }),
    ).toThrow();
    expect(() =>
      packServiceUuid({ sessionId: bytes(1, 2, 3, 4), seq: -1, body: randomBody() }),
    ).toThrow();
    expect(() =>
      packServiceUuid({ sessionId: bytes(1, 2, 3, 4), seq: 0x10000, body: randomBody() }),
    ).toThrow();
    expect(() =>
      packServiceUuid({ sessionId: bytes(1, 2, 3, 4), seq: 0, body: new Uint8Array(9) }),
    ).toThrow();
  });
});

describe("round-trip", () => {
  test("seq 境界(0, 65535)を含め完全一致", () => {
    for (const seq of [0, 1, 255, 256, 65535]) {
      const sessionId = bytes(0xde, 0xad, 0xbe, 0xef);
      const body = randomBody();
      const got = unpackServiceUuid(packServiceUuid({ sessionId, seq, body }));
      expect(got).not.toBeNull();
      expect([...got!.sessionId]).toEqual([...sessionId]);
      expect(got!.seq).toBe(seq);
      expect([...got!.body]).toEqual([...body]);
    }
  });
});

describe("unpack 正規化耐性", () => {
  const sessionId = bytes(0xaa, 0xbb, 0xcc, 0xdd);
  const body = randomBody();
  const packed = packServiceUuid({ sessionId, seq: 42, body }); // 小文字 32 桁

  test("小文字 32 桁・大文字・ダッシュ付き 36 文字がすべて同一結果", () => {
    const dashed = `${packed.slice(0, 8)}-${packed.slice(8, 12)}-${packed.slice(12, 16)}-${packed.slice(16, 20)}-${packed.slice(20)}`;
    const upperDashed = dashed.toUpperCase();

    const a = unpackServiceUuid(packed);
    const b = unpackServiceUuid(upperDashed);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.seq).toBe(42);
    expect([...b!.sessionId]).toEqual([...a!.sessionId]);
    expect([...b!.body]).toEqual([...a!.body]);
  });
});

describe("unpack 異常系 → null", () => {
  test("32 桁未満", () => {
    expect(unpackServiceUuid("00112233")).toBeNull();
  });
  test("16bit 縮約(4 文字)", () => {
    expect(unpackServiceUuid("180a")).toBeNull();
  });
  test("非 hex 文字", () => {
    expect(unpackServiceUuid("zz112233445566778899aabbccddeeff")).toBeNull();
  });
  test("空文字", () => {
    expect(unpackServiceUuid("")).toBeNull();
  });
});

describe("定数", () => {
  test("16 バイト = 4 + 2 + 10", () => {
    expect(PACKET_BYTES).toBe(16);
    expect(SESSION_BYTES).toBe(4);
    expect(BODY_BYTES).toBe(10);
  });
});
