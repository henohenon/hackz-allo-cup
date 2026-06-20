// 論理座標（DESIGN_W x DESIGN_H）を canvas 上の画面ピクセルへ変換する。

import { DESIGN_H, DESIGN_W } from "./theme";

export interface DesignRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** canvas のスケールと左上オフセット（レターボックス込み・App.fit と同じ整数丸め）。 */
export function getCanvasLayout(): { scale: number; offsetX: number; offsetY: number } | null {
  const canvas = document.querySelector(".pixi-host canvas");
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / DESIGN_W, rect.height / DESIGN_H);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return {
    scale,
    offsetX: Math.round(rect.left + (rect.width - DESIGN_W * scale) / 2),
    offsetY: Math.round(rect.top + (rect.height - DESIGN_H * scale) / 2),
  };
}

/** 論理矩形を fixed 配置用の画面座標へ変換する。 */
export function designRectToScreen(d: DesignRect): DesignRect | null {
  const layout = getCanvasLayout();
  if (!layout) return null;
  const { scale, offsetX, offsetY } = layout;
  return {
    x: offsetX + d.x * scale,
    y: offsetY + d.y * scale,
    w: d.w * scale,
    h: d.h * scale,
  };
}
