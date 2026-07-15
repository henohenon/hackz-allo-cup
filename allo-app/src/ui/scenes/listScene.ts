// 荷物一覧シーン（list）。
// 白プレーン画面＋戻るボタン＋上中央から落ちる荷物箱。
// 箱は画面四辺の見えない壁（端+1px）と箱同士でぶつかって積もる。
// Android では加速度センサーで重力方向が傾きに追従する（画面向きは landscape 固定）。
// 箱はこのシーン特有のグルーヴの拍に合わせて落ちる。BLE 非依存。
// レイヤー順（背面→前面）: 箱 → 吹き出し → タイトル/戻る。

import { Container } from "pixi.js";
import type { SceneBuilder } from "./types";
import { buildPlainScene } from "./common";
import { buildListBoxDrop } from "./listBoxDrop";
import { getSequence } from "../../audio/sequence";
import { getRecent } from "../../db/sessionStore";

export const buildListScene: SceneBuilder = async (ctx) => {
  const view = new Container();

  // 直近 50 件のセッション履歴を取得し、各レコードの content を 1 箱に 1 つ割り当てる。
  // 取得失敗（private モード等）でも画面は出せるよう空配列で続行する。
  const records = await getRecent(50).catch(() => []);
  const texts = records.map((r) => r.content);

  // 箱（最背面）。壁は描画せず、画面端の見えない物理境界で閉じ込める。
  const drop = buildListBoxDrop(texts);
  view.addChild(drop.view);

  // 吹き出しは箱より前面。
  view.addChild(drop.overlay);

  // タイトル「荷物一覧」＋戻るボタンは最前面（箱・吹き出しより手前）に置く。
  view.addChild(buildPlainScene("荷物一覧", () => ctx.goTo("title")));

  const seq = getSequence();
  const removeGroove = seq.addListGroove();

  return {
    view,
    dispose: () => {
      removeGroove();
      drop.dispose();
    },
  };
};
