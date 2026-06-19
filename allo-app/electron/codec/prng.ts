// 決定的 PRNG。同じ seed からは必ず同じ乱数列が出る（再現性が命）。
// テーブル生成専用。自然乱数（Math.random / crypto）とは役割が真逆なので混ぜない。
// 設計の根拠は docs/charcode-codec.md（判断3）を参照。

/**
 * 文字列 seed を 32bit 整数のシード値に潰すハッシュ（xmur3）。
 * 返り値を呼ぶたびに次の 32bit 値を返すジェネレータを返す。
 */
function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * 32bit シードから [0, 1) の乱数を返す軽量 PRNG（mulberry32）。
 */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * seed（文字列）から決定的な乱数生成関数 `() => [0, 1)` を作る。
 * 同じ seed → 同じ乱数列。両端（ユーティリティ側・レンダラー側）で同じ結果になるよう純 JS。
 */
export function createRng(seed: string): () => number {
  const seedGen = xmur3(seed);
  return mulberry32(seedGen());
}

/**
 * rng を使って [0, max) の整数を返す。
 */
export function randInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}
