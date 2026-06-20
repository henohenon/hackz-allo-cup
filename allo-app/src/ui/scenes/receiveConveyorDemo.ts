// 受信シーン向けデモ。
// 斜めの左右コンベアからパケットが中央の箱へ流れ込む。
// 左は偶数拍・右は奇数拍に出発し、毎拍到着（2 拍シフト）の交互パターン。
// 動きは getSequence() の単一クロックから導出する。

import { Container, Graphics } from "pixi.js";
import { COLOR, DESIGN_W, STROKE } from "../theme";
import { label, wireRect } from "../wireframe";
import { getSequence, SEC_PER_BEAT } from "../../audio/sequence";

const CENTER_X = DESIGN_W / 2;
const BOX_W = 200;
const BOX_H = 160;
const BOX_CY = 580;
const PACKET_R = 14;
/** 端から箱までの移動時間（2 拍）。左右は 1 拍ずらして毎拍到着。 */
const BEATS_TRAVEL = 2;

const LEFT_A = { x: 80, y: 640 };
const LEFT_B = { x: CENTER_X - BOX_W / 2 - 28, y: 720 };
const RIGHT_A = { x: DESIGN_W - 80, y: 640 };
const RIGHT_B = { x: CENTER_X + BOX_W / 2 + 28, y: 720 };

const posmod = (a: number, n: number) => ((a % n) + n) % n;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const along = (ax: number, ay: number, bx: number, by: number, t: number) => ({
  x: lerp(ax, bx, t),
  y: lerp(ay, by, t),
});

export interface DemoHandle {
  view: Container;
  dispose: () => void;
}

function makePacket(): Graphics {
  return new Graphics()
    .roundRect(-PACKET_R, -PACKET_R, PACKET_R * 2, PACKET_R * 2, 5)
    .fill(COLOR.ink);
}

/** 左右コンベア＋中央受信箱のデモを構築する。 */
export function buildReceiveConveyorDemo(): DemoHandle {
  const seq = getSequence();
  const view = new Container();

  view.addChild(
    new Graphics()
      .moveTo(LEFT_A.x, LEFT_A.y)
      .lineTo(LEFT_B.x, LEFT_B.y)
      .moveTo(RIGHT_A.x, RIGHT_A.y)
      .lineTo(RIGHT_B.x, RIGHT_B.y)
      .stroke({ width: STROKE.base, color: COLOR.ink }),
  );

  const leftPacket = makePacket();
  const rightPacket = makePacket();
  view.addChild(leftPacket, rightPacket);

  const box = new Container();
  box.x = CENTER_X;
  box.y = BOX_CY;
  box.addChild(wireRect(-BOX_W / 2, -BOX_H / 2, BOX_W, BOX_H, { radius: 12 }));
  box.addChild(label("受信", 0, 0, { size: 52, anchorX: 0.5, anchorY: 0.5, weight: "700" }));
  const arriveFlash = new Graphics();
  view.addChild(arriveFlash, box);

  view.addChild(
    label("♪ BPM 110 / radar", CENTER_X, 200, { size: 48, anchorX: 0.5, weight: "600" }),
  );

  let arriveT0 = -Infinity;
  let arriveFromLeft = true;
  const unsubDraw = seq.onBeat((beat) => {
    arriveT0 = performance.now();
    arriveFromLeft = beat.index % 2 === 0;
  });

  const cycleSec = SEC_PER_BEAT * BEATS_TRAVEL;
  const arriveMs = 220;
  let raf = 0;
  const frame = () => {
    const travel = seq.nowSeconds() / cycleSec;
    const leftT = posmod(travel, 1);
    const rightT = posmod(travel + 0.5, 1);

    const lp = along(LEFT_A.x, LEFT_A.y, LEFT_B.x, LEFT_B.y, leftT);
    leftPacket.position.set(lp.x, lp.y);
    leftPacket.alpha = leftT > 0.94 ? 1 - (leftT - 0.94) / 0.06 : 1;
    leftPacket.visible = leftT > 0.02;

    const rp = along(RIGHT_A.x, RIGHT_A.y, RIGHT_B.x, RIGHT_B.y, rightT);
    rightPacket.position.set(rp.x, rp.y);
    rightPacket.alpha = rightT > 0.94 ? 1 - (rightT - 0.94) / 0.06 : 1;
    rightPacket.visible = rightT > 0.02;

    const elapsed = performance.now() - arriveT0;
    const pulse = elapsed < arriveMs ? Math.sin((Math.PI * elapsed) / arriveMs) : 0;
    box.scale.set(1 + 0.07 * pulse);
    box.y = BOX_CY - 10 * pulse;

    arriveFlash.clear();
    if (pulse > 0.01) {
      const dest = arriveFromLeft ? LEFT_B : RIGHT_B;
      arriveFlash
        .circle(dest.x, dest.y, 10 + 34 * pulse)
        .fill({ color: COLOR.ink, alpha: 0.18 * pulse });
    }

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
