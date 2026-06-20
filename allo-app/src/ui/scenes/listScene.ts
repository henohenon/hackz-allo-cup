// 荷物一覧シーン（list）。
// 白プレーン画面＋戻るボタンに、シーケンス検証用の棚デモを載せる。
// このシーンの間だけ、4/4 向けファンクグルーヴ（8 分ベース + チーム + スタブ + ハイハット）を重ねる。BLE 非依存。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";
import { buildListShelfDemo } from "./listShelfDemo";
import { getSequence } from "../../audio/sequence";

export const buildListScene: SceneBuilder = async (ctx) => {
  const view = buildPlainScene("荷物一覧", () => ctx.goTo("title"));

  const demo = buildListShelfDemo();
  view.addChild(demo.view);

  const seq = getSequence();
  const removeGroove = seq.addListGroove();

  return {
    view,
    dispose: () => {
      removeGroove();
      demo.dispose();
    },
  };
};
