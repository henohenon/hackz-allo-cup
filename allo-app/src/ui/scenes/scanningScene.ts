// 受け取るシーン（scanning）。
// 左右コンベア＋中央の集荷箱の搬入ライン UI と、BLE 受信コントローラを束ねる。
// 入室直後は集荷箱の蓋を閉じたまま。トランジション完了＋1 秒後に蓋を開きレーダー BGM を重ねる。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";
import { getSequence } from "../../audio/sequence";
import { buildScanningBeltView } from "./scanningBeltView";
import { createScanningController } from "./scanningController";
import { SCENE_REVEAL_AFTER_BUILD_MS } from "./sceneTransition";

/** トランジション完了（蓋が開ききる）後、BGM を変えるまでの待ち（ms）。 */
const SCANNING_BGM_DELAY_AFTER_REVEAL_MS = 1000;
/** build 完了からレーダー BGM を重ね始めるまで（覆い中の build 分を差し引いた実時間）。 */
const SCANNING_BGM_START_DELAY_MS =
  SCENE_REVEAL_AFTER_BUILD_MS + SCANNING_BGM_DELAY_AFTER_REVEAL_MS;

/** 戻る押下からタイトル遷移までの尺（蓋を閉じたあと蓋閉じ状態で待つ）。 */
const SCANNING_EXIT_MS = 3000;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const buildScanningScene: SceneBuilder = async (ctx) => {
  const beltView = await buildScanningBeltView();
  const controller = createScanningController();

  // トランジション完了＋1 秒後にレーダー BGM と集荷箱の蓋開きを同時に始める。
  const seq = getSequence();
  let removeRadar: (() => void) | null = null;
  let bgmTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    bgmTimer = null;
    removeRadar = seq.addScanRadar();
    void beltView.playOpenLid();
  }, SCANNING_BGM_START_DELAY_MS);
  let bgmRestored = false;
  const restoreBgm = () => {
    if (bgmRestored) return;
    bgmRestored = true;
    if (bgmTimer != null) {
      clearTimeout(bgmTimer);
      bgmTimer = null;
    }
    removeRadar?.();
    removeRadar = null;
  };

  let exiting = false;
  const view = buildPlainScene("受け取る", () => {
    if (exiting) return;
    exiting = true;
    // 受信は即停止。蓋を閉じて BGM をアイドルへ戻し、蓋閉じ状態を見せてから遷移する。
    controller.requestExit(() => {});
    void (async () => {
      await beltView.playCloseLid();
      restoreBgm();
      await delay(SCANNING_EXIT_MS);
      ctx.goTo("title");
    })();
  });
  view.addChildAt(beltView.view, 0);

  await controller.start(beltView);

  return {
    view,
    dispose: async () => {
      restoreBgm();
      // 順序: controller.cleanup（購読解除 → DB flush → setIdle）→ ベルト rAF 停止。
      await controller.dispose();
      beltView.dispose();
    },
  };
};
