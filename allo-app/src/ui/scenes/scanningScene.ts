// 受け取るシーン（scanning）。
// 現状は白プレーン画面＋戻るボタンのみ。BLE（SCANNING / onPacket）の制御は
// 各シーンのコントローラー側で行うため、ここでは配線しない。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";

export const buildScanningScene: SceneBuilder = async (ctx) => {
  const view = buildPlainScene("受け取る", () => ctx.goTo("title"));
  return { view };
};
