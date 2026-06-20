// 荷物一覧シーン向けのシーケンス検証デモ。
// 棚に並んだ段ボール箱が拍ごとに順番にハイライトされる。
// 動きは getSequence() の単一クロックから導出する。

import { Container, Graphics } from "pixi.js";
import { COLOR, DESIGN_W } from "../theme";
import { label, wireRect } from "../wireframe";
import { getSequence } from "../../audio/sequence";

const CENTER_X = DESIGN_W / 2;
const SHELF_Y = 700;
const BOX_W = 200;
const BOX_H = 160;
const BOX_GAP = 60;
/** 4/4 一連の符に合わせて 4 箱（毎拍 1 箱ずつハイライト）。 */
const BOX_COUNT = 4;
const LABELS = ["A", "B", "C", "D"];

export interface DemoHandle {
  view: Container;
  dispose: () => void;
}

/** 棚＋段ボール箱の検証デモを構築する。 */
export function buildListShelfDemo(): DemoHandle {
  const seq = getSequence();
  const view = new Container();

  const totalW = BOX_COUNT * BOX_W + (BOX_COUNT - 1) * BOX_GAP;
  const startX = CENTER_X - totalW / 2;

  const shelf = new Container();
  view.addChild(shelf);

  const boxes: Container[] = [];
  const fills: Graphics[] = [];
  for (let i = 0; i < BOX_COUNT; i++) {
    const bx = startX + i * (BOX_W + BOX_GAP);
    const box = new Container();
    const fill = new Graphics()
      .roundRect(bx, SHELF_Y - BOX_H, BOX_W, BOX_H, 12)
      .fill({ color: COLOR.ink, alpha: 0 });
    const outline = wireRect(bx, SHELF_Y - BOX_H, BOX_W, BOX_H, { radius: 12 });
    box.addChild(fill, outline);
    box.addChild(
      label(LABELS[i], bx + BOX_W / 2, SHELF_Y - BOX_H / 2, {
        size: 64,
        anchorX: 0.5,
        anchorY: 0.5,
        weight: "700",
      }),
    );
    shelf.addChild(box);
    boxes.push(box);
    fills.push(fill);
  }

  shelf.addChildAt(wireRect(startX - 40, SHELF_Y + BOX_H - 8, totalW + 80, 12, { radius: 4 }), 0);

  view.addChild(
    label("♪ BPM 110 / groove", CENTER_X, 200, { size: 48, anchorX: 0.5, weight: "600" }),
  );

  let beatT0 = -Infinity;
  let activeBox = 0;
  const unsubDraw = seq.onBeat((beat) => {
    beatT0 = performance.now();
    activeBox = beat.index % BOX_COUNT;
  });

  // 1 拍の長さに合わせたパルス（110 BPM ≒ 545ms/拍）。
  const pulseMs = (60 / 110) * 1000 * 0.55;
  let raf = 0;
  const frame = () => {
    const elapsed = performance.now() - beatT0;
    const pulse = elapsed < pulseMs ? Math.sin((Math.PI * elapsed) / pulseMs) : 0;

    fills.forEach((fill, i) => {
      const on = i === activeBox;
      fill.alpha = on ? 0.08 + 0.12 * pulse : 0;
    });
    boxes.forEach((box, i) => {
      const on = i === activeBox;
      box.scale.set(on ? 1 + 0.06 * pulse : 1);
      box.rotation = on ? 0.02 * pulse * (i % 2 === 0 ? 1 : -1) : 0;
    });

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    view,
    dispose: () => {
      unsubDraw();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
