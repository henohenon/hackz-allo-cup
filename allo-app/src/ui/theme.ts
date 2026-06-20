// モノクロ・ワイヤーフレーム UI の共通定数。
// 配色は白・黒の2色のみ。レターボックス外側=黒、画面領域=白、線/文字=黒。

/** デザイン基準解像度（横 1920px / 5:3 = 3DS 同等の比率）。UI は全てこの論理座標で組む。 */
export const DESIGN_W = 1920;
export const DESIGN_H = 1152;

/** 配色（PixiJS の数値カラー） */
export const COLOR = {
  /** レターボックス・線・文字 */
  ink: 0x000000,
  /** 画面の地（白） */
  paper: 0xffffff,
} as const;

/** ワイヤーフレームの線幅（論理座標基準 1920px） */
export const STROKE = {
  thin: 2,
  base: 4,
} as const;

/** M PLUS 1p を最優先に。読み込み前のフォールバックとして sans-serif。 */
export const FONT_FAMILY = '"M PLUS 1p", sans-serif';

/** フォント読み込み完了を待つ（M PLUS 1p）。失敗してもフォールバックで継続。 */
export async function loadFont(): Promise<void> {
  try {
    await document.fonts.load(`1em ${FONT_FAMILY}`);
    await document.fonts.ready;
  } catch {
    // フォント読み込みに失敗してもフォールバックフォントで描画を続ける
  }
}
