import { expect, test } from "vite-plus/test";
import { GRAVITY_MAG, STANDARD_G, gravityFromAcceleration } from "./listBoxDrop";

const near = (v: number, expected: number) => expect(v).toBeCloseTo(expected, 5);

test("landscape-primary: 通常の横持ちでは下へ落ちる", () => {
  // 端末自然座標で +x が画面上（空側）= Android landscape
  const g = gravityFromAcceleration(STANDARD_G, 0, 90);
  near(g.x, 0);
  near(g.y, GRAVITY_MAG);
});

test("landscape-primary: 逆さでは上へ落ちる", () => {
  const g = gravityFromAcceleration(-STANDARD_G, 0, 90);
  near(g.x, 0);
  near(g.y, -GRAVITY_MAG);
});

test("landscape-primary: 短辺側へ倒すと左右へ落ちる", () => {
  const right = gravityFromAcceleration(0, STANDARD_G, 90);
  near(right.x, GRAVITY_MAG);
  near(right.y, 0);

  const left = gravityFromAcceleration(0, -STANDARD_G, 90);
  near(left.x, -GRAVITY_MAG);
  near(left.y, 0);
});

test("landscape-secondary: 通常の横持ちでは下へ落ちる", () => {
  // reverse landscape では静止時の空側が端末 -x
  const g = gravityFromAcceleration(-STANDARD_G, 0, 270);
  near(g.x, 0);
  near(g.y, GRAVITY_MAG);
});

test("軸回転なしだと横持ちが右落ちになる（バグ再現）", () => {
  const g = gravityFromAcceleration(STANDARD_G, 0, 0);
  near(g.x, GRAVITY_MAG);
  near(g.y, 0);
});
