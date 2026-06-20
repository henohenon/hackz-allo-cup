// 生 SVG 文字列（`import x from "*.svg?raw"`）を PixiJS の Texture へデコードする共通ヘルパー。
// viewBox の寸法を採寸サイズに使ってから Blob 経由で Image にデコードする。
// 同じ SVG を何度も再デコードしないよう、生 SVG 文字列をキーにメモ化する。

import { Texture } from "pixi.js";
import { DESIGN_H, DESIGN_W } from "./theme";

const textureCache = new Map<string, Promise<Texture>>();

export function loadSvgTexture(raw: string): Promise<Texture> {
  const cached = textureCache.get(raw);
  if (cached) return cached;
  const promise = decodeSvgTexture(raw);
  textureCache.set(raw, promise);
  return promise;
}

async function decodeSvgTexture(raw: string): Promise<Texture> {
  const viewBox = raw.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const w = viewBox ? Number(viewBox[1]) : DESIGN_W;
  const h = viewBox ? Number(viewBox[2]) : DESIGN_H;
  const svg = raw.replace(/width="100%"\s+height="100%"/, `width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image(w, h);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("failed to load svg"));
      img.src = url;
    });
    return Texture.from(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
