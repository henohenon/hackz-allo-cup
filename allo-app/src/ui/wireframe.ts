// ワイヤーフレーム描画の小さな再利用ヘルパー群。
// すべて論理座標（DESIGN_W x DESIGN_H 基準）で描く。塗りは基本なしの線画。

import { Container, Graphics, Text, type TextStyleOptions } from "pixi.js";
import { COLOR, FONT_FAMILY, STROKE } from "./theme";

interface RectOptions {
  /** 角丸の半径（既定 0 = 直角） */
  radius?: number;
  /** 線幅（既定 STROKE.base） */
  width?: number;
  /** 白で塗りつぶすか（既定 false = 塗りなし） */
  fillPaper?: boolean;
}

/** 黒い細線の矩形（ワイヤーフレームの基本部品）を描いて返す。 */
export function wireRect(
  x: number,
  y: number,
  w: number,
  h: number,
  options: RectOptions = {},
): Graphics {
  const { radius = 0, width = STROKE.base, fillPaper = false } = options;
  const g = new Graphics();
  if (radius > 0) {
    g.roundRect(x, y, w, h, radius);
  } else {
    g.rect(x, y, w, h);
  }
  if (fillPaper) {
    g.fill(COLOR.paper);
  }
  g.stroke({ width, color: COLOR.ink, alignment: 0.5 });
  return g;
}

interface LabelOptions {
  size?: number;
  /** 0=左, 0.5=中央, 1=右（縦も同様） */
  anchorX?: number;
  anchorY?: number;
  weight?: TextStyleOptions["fontWeight"];
}

/** M PLUS 1p の黒文字テキストを生成して返す。 */
export function label(text: string, x: number, y: number, options: LabelOptions = {}): Text {
  const { size = 16, anchorX = 0, anchorY = 0, weight = "400" } = options;
  const t = new Text({
    text,
    style: {
      fill: COLOR.ink,
      fontSize: size,
      fontFamily: FONT_FAMILY,
      fontWeight: weight,
    },
  });
  t.anchor.set(anchorX, anchorY);
  t.x = x;
  t.y = y;
  return t;
}

/** 子要素をまとめて持つ Container を作るだけの薄いヘルパー。 */
export function group(...children: Container[]): Container {
  const c = new Container();
  c.addChild(...children);
  return c;
}
