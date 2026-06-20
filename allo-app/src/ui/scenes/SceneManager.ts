// シーン遷移の中核。
// - 箱モチーフのトランジション（上下の黒い蓋が中央へ閉じる → 裏でシーン差替 → 開く）
// - 最低再生時間の担保（処理が早くても瞬間遷移しない）
// - 旧シーン dispose → 新シーン build の直列順序（副作用を確実に解放してから初期化）
// - 遷移中の入力遮断・多重発火ガード
// - StrictMode / アンマウント時の後始末（killed ガード・ticker 掃除）

import { Application, Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import { COLOR, DESIGN_H, DESIGN_W } from "../theme";
import type { Scene, SceneContext, SceneKey } from "./types";
import { registry } from "./registry";
import { FLAP_MS, MIN_HOLD_MS } from "./sceneTransition";

export interface SceneManager {
  /** root に addChild される唯一の Container（sceneLayer + 蓋オーバーレイを内包）。 */
  readonly view: Container;
  /** 初期シーンを表示（蓋アニメなしで即表示）。 */
  start(key: SceneKey): Promise<void>;
  /** 遷移トリガ（多重発火ガード付き・fire-and-forget）。 */
  goTo(key: SceneKey): void;
  /** アンマウント時の後始末（killed を立て、現シーンを dispose）。 */
  destroy(): void;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** easeInOutQuad */
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export function createSceneManager(app: Application): SceneManager {
  const view = new Container();
  const sceneLayer = new Container();
  // 上下 2 枚の黒い蓋を progress で描くオーバーレイ。常に最前面（addChild 順を固定）。
  const overlay = new Graphics();
  view.addChild(sceneLayer, overlay);

  let current: Scene | null = null;
  let busy = false;
  let killed = false;
  // 蓋の現在の開度（0=全開で見えない / 1=中央で合わさり全画面を黒で占有）。
  let progress = 0;

  const drawFlaps = (p: number) => {
    progress = p;
    const h = (DESIGN_H / 2) * p;
    overlay
      .clear()
      .rect(0, 0, DESIGN_W, h) // 上の蓋（上端から下りる）
      .rect(0, DESIGN_H - h, DESIGN_W, h) // 下の蓋（下端から昇る）
      .fill(COLOR.ink);
  };

  // 遷移中のみ overlay を当たり判定化して下のシーンへの入力を遮断する。
  // idle 時は none にしてシーン側のボタン（戻る等）に入力を貫通させる。
  const setBlocking = (on: boolean) => {
    overlay.eventMode = on ? "static" : "none";
    overlay.hitArea = on ? new Rectangle(0, 0, DESIGN_W, DESIGN_H) : null;
  };

  // app.ticker ベースで蓋の開度を to までトゥイーンする。
  // killed（アンマウント）時も必ず resolve + remove して Promise の宙吊りを防ぐ。
  const animate = (to: number) =>
    new Promise<void>((resolve) => {
      const from = progress;
      let elapsed = 0;
      const tick = (ticker: Ticker) => {
        elapsed += ticker.deltaMS;
        const p = Math.min(1, elapsed / FLAP_MS);
        drawFlaps(from + (to - from) * ease(p));
        if (p >= 1 || killed) {
          app.ticker.remove(tick);
          resolve();
        }
      };
      app.ticker.add(tick);
    });

  async function transition(key: SceneKey, initial: boolean) {
    if (busy || killed) return;
    busy = true;
    setBlocking(true);

    // 1) 蓋を閉じて覆う（初回は覆わず即表示する）。
    if (!initial) await animate(1);
    if (killed) {
      busy = false;
      return;
    }

    // 2) 旧シーンを先に dispose（副作用解放）→ view 破棄。build より前に直列で行う。
    if (current) {
      await current.dispose?.();
      sceneLayer.removeChild(current.view);
      current.view.destroy({ children: true });
      current = null;
    }

    // 3) 新シーン init と最低保持時間を両待ち（覆い中なのでチラつかない）。race ではなく all。
    const [next] = await Promise.all([
      registry[key]({ goTo } satisfies SceneContext),
      delay(MIN_HOLD_MS),
    ]);

    // 4) build 中にアンマウントされていたら、作ったシーンを後始末して中止。
    if (killed) {
      await next.dispose?.();
      next.view.destroy({ children: true });
      busy = false;
      return;
    }

    // 5) 差し替え。
    sceneLayer.addChild(next.view);
    current = next;

    // 6) 蓋を開いて入力解放。
    if (!initial) await animate(0);
    setBlocking(false);
    busy = false;
  }

  const goTo = (key: SceneKey) => void transition(key, false);

  return {
    view,
    start: (key) => transition(key, true),
    goTo,
    destroy: () => {
      killed = true;
      void current?.dispose?.();
    },
  };
}
