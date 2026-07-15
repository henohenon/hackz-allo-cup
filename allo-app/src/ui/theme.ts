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

/**
 * M PLUS 1p が提供するウェイト（ローカル同梱は 400/500/700）。
 * 未ロードのウェイトを使うと合成ボールドやフォールバックで太さがブレる。
 */
export const FONT_WEIGHTS = ["400", "500", "700"] as const;

/** document.fonts 判定用（フォールバック無し）。 */
const FONT_FACE_ONLY = '"M PLUS 1p"';

/** 日本語グリフを確実にロードするためのサンプル（タイトル UI で使う文字を含む）。 */
const FONT_SAMPLE_JA = "あいうえお送り受け取る荷物一覧←戻る♪";

/** フォント読み込み完了を待つ（使用する全ウェイト＋日本語グリフ）。失敗してもフォールバックで継続。 */
export async function loadFont(): Promise<void> {
  try {
    // フォールバック無し + 日本語サンプルで、CJK サブセット／未ロードを防ぐ。
    await Promise.all(
      FONT_WEIGHTS.map((w) => document.fonts.load(`${w} 1em ${FONT_FACE_ONLY}`, FONT_SAMPLE_JA)),
    );
    await document.fonts.ready;
  } catch {
    // フォント読み込みに失敗してもフォールバックフォントで描画を続ける
  }
}
