// 送るシーン（advertise）。
// BLE 送信コントローラ＋ベルト UI。シーン中だけベースライン・16 分ハイハットを重ねる。
// プレス作動音は beltView がベルト接触時に鳴らす。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";
import { getSequence } from "../../audio/sequence";
import { createAdvertiseController } from "./advertiseController";
import { buildAdvertiseBeltView } from "./advertiseBeltView";

export const buildAdvertiseScene: SceneBuilder = async (ctx) => {
  const beltView = await buildAdvertiseBeltView();

  // シーン中だけ重ねる追加レイヤ（ベース＋16 分ハイハット）。
  // 終了演出のギミック停止と同時に外して BGM を通常へ戻す。二重解除は無害化。
  const seq = getSequence();
  const removeBass = seq.addBass();
  const removeBusyHats = seq.addBusyHats();
  let bgmRestored = false;
  const restoreBgm = () => {
    if (bgmRestored) return;
    bgmRestored = true;
    removeBass();
    removeBusyHats();
  };

  const controller = createAdvertiseController({
    onComplete: () => ctx.goTo("title"),
    onRestoreBgm: restoreBgm,
  });

  const view = buildPlainScene("送る", () => controller.requestExit(() => ctx.goTo("title")));
  view.addChildAt(beltView.view, 0);
  view.addChild(beltView.flashOverlay);

  await controller.start(beltView);

  return {
    view,
    dispose: async () => {
      restoreBgm();
      // 順序: controller.cleanup（拍購読解除 → DB flush → setIdle）→ ベルト rAF 停止。
      await controller.dispose();
      beltView.dispose();
    },
  };
};
