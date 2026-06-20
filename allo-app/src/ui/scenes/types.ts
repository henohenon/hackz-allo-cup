// シーン基盤の最小契約。
// 既存の Screen = { view: Container } を構造互換のまま最小拡張し、
// 「シーン = 非同期ファクトリ関数 (ctx) => Promise<Scene>」「後始末 = dispose?()」に統一する。

import type { Container } from "pixi.js";

/** 遷移先を識別するキー（値は固定 4 種・union で網羅チェックが効く）。 */
export type SceneKey = "title" | "advertise" | "scanning" | "list";

/** シーンへ渡す最小コンテキスト。遷移要求のみを公開する。 */
export interface SceneContext {
  /** 遷移要求。トランジション中（busy）は SceneManager 側で無視される。 */
  goTo(key: SceneKey): void;
}

/**
 * 既存 Screen = { view: Container } を構造互換のまま最小拡張したもの。
 * dispose は「外部副作用の解放」専用（RAF cancel / 購読解除 / 将来の BLE 解放）。
 * view の removeChild / destroy は SceneManager が行うので dispose では触らない。
 */
export interface Scene {
  view: Container;
  dispose?: () => void | Promise<void>;
}

/** シーン生成＝初期化のワンショット。重い init（SVG ロード等）もこの中で完了させる。 */
export type SceneBuilder = (ctx: SceneContext) => Promise<Scene>;
