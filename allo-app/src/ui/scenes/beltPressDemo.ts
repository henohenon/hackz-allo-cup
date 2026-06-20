// シーケンスコントローラの検証用デモ。
// ベルトコンベア上を文字が左へ流れ、2 拍（プレス拍）ごとにプレス機の頭が落ちて
// 中央の文字を潰す。テンポ・音（square）の同期確認用。
//
// 動きは全て getSequence() の単一クロックから導出するため、シーン遷移しても
// 再入のたびに常に同じタイミングに揃う（ベルトの位相も拍も共有クロック基準）。
//
// ベルトは「はみ出たタイルを反対側へ送る」連続スクロール。巻き戻し周期を文字
// パターンの長さに合わせてあるため、各タイルの文字が入れ替わって見える「リセット」
// は起きない（タイルは TILE_CHARS の周期で並び、ちょうど 1 周ぶんで折り返す）。

import { Container, Graphics, Text } from "pixi.js";
import { COLOR, DESIGN_W, FONT_FAMILY, STROKE } from "../theme";
import { label } from "../wireframe";
import { getSequence, SEC_PER_BEAT } from "../../audio/sequence";

/** ベルトを流す文字（この並びで繰り返す）。 */
const TILE_CHARS = ["コ", "ト", "ハ", "コ", "ビ"];
/** 文字 1 マスの横幅（px・論理座標）。 */
const TILE_W = 260;
/** プレス周期（2 拍で 1 マスぶん進み、中央でプレスされる）。 */
const BEATS_PER_TILE = 2;

const CENTER_X = DESIGN_W / 2;
/** ベルト面（文字の下端が乗る高さ）。 */
const BELT_Y = 760;
/** プレス頭の待機 / 最下点の上端 y。 */
const PRESS_REST_Y = 360;
const PRESS_DOWN_Y = 540;
const PRESS_W = 240;
const PRESS_H = 150;
/** プレス動作の長さ（ms）。落ちて戻るまで。 */
const PRESS_MS = 240;

/** 正の剰余（負数でも 0..n に収める）。 */
const posmod = (a: number, n: number) => ((a % n) + n) % n;

export interface DemoHandle {
  view: Container;
  dispose: () => void;
}

/** ベルト＋プレスの検証デモを構築する。 */
export function buildBeltPressDemo(): DemoHandle {
  const seq = getSequence();
  const view = new Container();

  // ベルト面（コンベアの天面ライン）。
  const belt = new Graphics()
    .moveTo(0, BELT_Y)
    .lineTo(DESIGN_W, BELT_Y)
    .stroke({ width: STROKE.base, color: COLOR.ink });
  view.addChild(belt);

  // タイル数: 画面を覆える数を文字パターン長の倍数に切り上げる。
  // 倍数にすることで、折り返し（STRIP ぶん移動）しても文字の並びが連続する。
  const pattern = TILE_CHARS.length;
  const visible = Math.ceil(DESIGN_W / TILE_W) + 2;
  const count = Math.ceil(visible / pattern) * pattern;
  const strip = count * TILE_W;

  const beltLayer = new Container();
  view.addChild(beltLayer);
  const tiles: Container[] = [];
  for (let i = 0; i < count; i++) {
    const tile = new Container();
    const t = new Text({
      text: TILE_CHARS[i % pattern],
      style: { fill: COLOR.ink, fontSize: 130, fontFamily: FONT_FAMILY, fontWeight: "700" },
    });
    t.anchor.set(0.5, 1); // 下端基準（潰すと下に沈む）
    tile.y = BELT_Y;
    tile.addChild(t);
    beltLayer.addChild(tile);
    tiles.push(tile);
  }

  // プレス機（頭＋軸）。黒塗りの頭が落ちる。
  const press = new Container();
  const head = new Graphics().rect(CENTER_X - PRESS_W / 2, 0, PRESS_W, PRESS_H).fill(COLOR.ink);
  const stem = new Graphics().rect(CENTER_X - 24, -200, 48, 200).fill(COLOR.ink);
  press.addChild(stem, head);
  press.y = PRESS_REST_Y;
  view.addChild(press);

  // キャプション。
  view.addChild(
    label("♪ BPM 110 / square", CENTER_X, 200, { size: 48, anchorX: 0.5, weight: "600" }),
  );

  // プレス拍を受けて落下を開始する（音はコントローラが常時発音）。pressT0 を基準に rAF で補間。
  let pressT0 = -Infinity;
  const unsubDraw = seq.onBeat((beat) => {
    if (beat.isPress) pressT0 = performance.now();
  });

  // 連続アニメーション（共有クロックの連続秒から毎フレーム算出）。
  const cycleSec = SEC_PER_BEAT * BEATS_PER_TILE;
  // バンドの中心を画面中央に置く（左右に strip/2 ぶん伸び、折り返しの継ぎ目は画面外）。
  const bandLeft = CENTER_X - strip / 2;
  let raf = 0;
  const frame = () => {
    // 1 周期で 1 マスぶん左へ進む連続距離。巻き戻らない。
    const travel = (seq.nowSeconds() / cycleSec) * TILE_W;

    for (let i = 0; i < count; i++) {
      // 各タイルの中心 x を strip の幅で折り返して配置（継ぎ目は画面外）。
      const x = bandLeft + posmod(CENTER_X + i * TILE_W - travel - bandLeft, strip);
      tiles[i].x = x;
    }

    // プレス: 落ちて戻る（0→1→0 の山）。待機中は最上点。
    const elapsed = performance.now() - pressT0;
    const drop = elapsed < PRESS_MS ? Math.sin((Math.PI * elapsed) / PRESS_MS) : 0;
    press.y = PRESS_REST_Y + (PRESS_DOWN_Y - PRESS_REST_Y) * drop;

    // 中央に最も近い文字を、落下量に応じて縦に潰す。
    for (const tile of tiles) {
      const centered = Math.abs(tile.x - CENTER_X) < TILE_W / 2;
      tile.scale.y = centered ? 1 - 0.5 * drop : 1;
    }

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    view,
    dispose: () => {
      unsubDraw();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
