// 荷物一覧シーン（list）。
// 現状は白プレーン画面＋戻るボタンのみ。BLE 非依存。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";

export const buildListScene: SceneBuilder = async (ctx) => {
  const view = buildPlainScene("荷物一覧", () => ctx.goTo("title"));
  return { view };
};
