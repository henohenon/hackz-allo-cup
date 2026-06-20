// 送るシーン（advertise）。
// 白プレーン画面＋戻るボタンに、シーケンス検証用のベルト＋プレスデモを載せる。
// このシーンの間だけ、共有ビートにベースライン・16 分ハイハット・プレス拍の重キックを重ねる。
// BLE（ADVERTISE）の制御は各シーンのコントローラー側で行うため、ここでは配線しない。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";
import { buildBeltPressDemo } from "./beltPressDemo";
import { getSequence } from "../../audio/sequence";

export const buildAdvertiseScene: SceneBuilder = async (ctx) => {
  const view = buildPlainScene("送る", () => ctx.goTo("title"));

  // 共有クロック駆動のデモ（2 拍ごとにプレスが落ちて中央の文字を潰す）。
  const demo = buildBeltPressDemo();
  view.addChild(demo.view);

  // このシーン専用の追加レイヤー（離脱時に解除）。
  const seq = getSequence();
  const removeBass = seq.addBass();
  const removeBusyHats = seq.addBusyHats();
  const removePressKick = seq.addPressKick();

  return {
    view,
    dispose: () => {
      removeBass();
      removeBusyHats();
      removePressKick();
      demo.dispose();
    },
  };
};
