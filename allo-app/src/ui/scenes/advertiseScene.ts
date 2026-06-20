// 送るシーン（advertise）。
// 現状は白プレーン画面＋戻るボタンのみ。BLE（ADVERTISE）の制御は各シーンの
// コントローラー側で行うため、ここでは配線しない。副作用を持つようになったら
// dispose を返してそこで解放する。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";

export const buildAdvertiseScene: SceneBuilder = async (ctx) => {
  const view = buildPlainScene("送る", () => ctx.goTo("title"));
  return { view };
};
