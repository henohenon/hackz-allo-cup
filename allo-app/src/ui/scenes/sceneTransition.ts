// シーン遷移タイミングの共有定数（SceneManager と各シーンの初期化ディレイで参照）。

/** 蓋の閉じ／開き 片道の時間（ms）。タイトルの蓋開閉（約 0.2s）と体感を合わせる。 */
export const FLAP_MS = 220;
/** 遷移全体（閉じ + 保持 + 開き）の最低時間（ms）。 */
export const MIN_TRANSITION_MS = 1000;
/** 完全に覆っている最低保持時間（ms）。閉じ・開きを除いた分を確保する。 */
export const MIN_HOLD_MS = MIN_TRANSITION_MS - FLAP_MS * 2;

/**
 * シーン build が覆い中に終わってからユーザーに見えるまでの最大時間（保持 + 開き）。
 * build 末尾でセッション初期化を始めた場合、タイマー開始をこの分だけ遅らせると
 * トランジション中の経過をカウントしない。
 */
export const SCENE_REVEAL_AFTER_BUILD_MS = MIN_HOLD_MS + FLAP_MS;