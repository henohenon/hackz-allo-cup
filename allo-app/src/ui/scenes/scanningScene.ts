// 受け取るシーン（scanning）。
// 左右コンベアから中央の箱へパケットが流れ込むデモ＋レーダー風ソナー音。
// BLE（SCANNING / onPacket）の制御は各シーンのコントローラー側で行うため、ここでは配線しない。

import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";
import { buildReceiveConveyorDemo } from "./receiveConveyorDemo";
import { getSequence } from "../../audio/sequence";

export const buildScanningScene: SceneBuilder = async (ctx) => {
  const view = buildPlainScene("受け取る", () => ctx.goTo("title"));

  const demo = buildReceiveConveyorDemo();
  view.addChild(demo.view);

  const seq = getSequence();
  const removeRadar = seq.addScanRadar();

  return {
    view,
    dispose: () => {
      removeRadar();
      demo.dispose();
    },
  };
};
