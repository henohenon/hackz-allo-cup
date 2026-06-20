// SceneKey と SceneBuilder の対応表。
// 各シーンと TitleScreen の相互 import 循環を断つ集約点。
// SceneManager はここだけを参照して目的のシーンを生成する。

import type { SceneBuilder, SceneKey } from "./types";
import { buildTitleScreen } from "../TitleScreen";
import { buildAdvertiseScene } from "./advertiseScene";
import { buildScanningScene } from "./scanningScene";
import { buildListScene } from "./listScene";

export const registry: Record<SceneKey, SceneBuilder> = {
  title: buildTitleScreen,
  advertise: buildAdvertiseScene,
  scanning: buildScanningScene,
  list: buildListScene,
};
