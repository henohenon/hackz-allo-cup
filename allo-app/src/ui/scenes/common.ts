// 新規シーン共通のワイヤーフレーム部品。
// 「真っ白なプレーン画面＋戻るボタン」を最小コードで組むためのヘルパー。
// 地色（白）はアプリ背景（App.tsx の background=paper）が担うので塗りは置かない。

import { Container, Rectangle } from "pixi.js";
import { DESIGN_W } from "../theme";
import { label, wireRect } from "../wireframe";

/** 左上の「← 戻る」ボタン（ワイヤーフレーム枠＋ラベル）。タップで onTap を呼ぶ。 */
export function buildBackButton(onTap: () => void): Container {
  const x = 80;
  const y = 80;
  const w = 260;
  const h = 100;

  const c = new Container();
  c.addChild(wireRect(x, y, w, h));
  c.addChild(
    label("← 戻る", x + w / 2, y + h / 2, {
      size: 44,
      anchorX: 0.5,
      anchorY: 0.5,
      weight: "700",
    }),
  );

  // 線のみの矩形は内部が当たり判定に入らないため hitArea を明示する。
  c.eventMode = "static";
  c.cursor = "pointer";
  c.hitArea = new Rectangle(x, y, w, h);
  c.on("pointertap", () => onTap());

  return c;
}

/** 白地＋中央タイトル＋左上の戻るボタンだけのプレーン画面を組む。
 * タイトルは戻るボタンと同じ高度 (中心 y=130) に置き、下部のメカニズム描画と重ねない。 */
export function buildPlainScene(title: string, onBack: () => void): Container {
  const view = new Container();
  view.addChild(
    label(title, DESIGN_W / 2, 130, {
      size: 80,
      anchorX: 0.5,
      anchorY: 0.5,
      weight: "700",
    }),
  );
  view.addChild(buildBackButton(onBack));
  return view;
}
