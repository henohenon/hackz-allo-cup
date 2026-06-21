// 受け取るシーンのメカニズム UI（送るシーンと対になる搬入ライン）。
// 左右のベルトコンベアが中央向きに稼働し、パケット受信ごとに段ボールが
// ランダムな側から運ばれてきて、中央の「蓋の開いた集荷箱」へ落ちて入る。
// コンベアは画面の左右外から見切れて入ってくる。
// BLE / DB の制御は controller 側。ここは見た目だけを持つ。

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { COLOR, DESIGN_W, STROKE } from "../theme";
import { wireRect } from "../wireframe";
import { loadSvgTexture } from "../svgTexture";
import { getSequence, SEC_PER_BEAT } from "../../audio/sequence";
import beltSvgRaw from "../../assets/advertise/belt.svg?raw";
import cardboardSvgRaw from "../../assets/advertise/cardboard.svg?raw";

interface ScanningTextures {
  belt: Texture;
  cardboard: Texture;
}

async function loadScanningTextures(): Promise<ScanningTextures> {
  const [belt, cardboard] = await Promise.all([
    loadSvgTexture(beltSvgRaw),
    loadSvgTexture(cardboardSvgRaw),
  ]);
  return { belt, cardboard };
}

/** SVG を論理幅 w で配置するスプライトを作る（テクスチャ実寸に依らず等倍化）。 */
function makeSvgSprite(texture: Texture, w: number, anchorX: number, anchorY: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(anchorX, anchorY);
  sprite.scale.set(w / texture.width);
  return sprite;
}

const CENTER_X = DESIGN_W / 2;

// メカニズム領域（フレーム）。寄りの絵に合わせ画面いっぱい近くまで広げて要素を大きく囲む。
const FRAME_X = 60;
const FRAME_Y = 250;
const FRAME_W = DESIGN_W - FRAME_X * 2;
const FRAME_H = 850;

// ベルト（左右が中央へ向かって稼働）。
const BELT_Y = 560; // ベルト上面（段ボールの底が乗る高さ）
// 外端は画面の外へ出す。角丸の端を画面外に追い出し、画面端で断ち切られて
// 「外から搬入されてくる」ように見せる（生えているような端を見せない）。
const BELT_OUTER_LEFT = -120; // 左ベルトの外端（搬入の起点／画面左外）
const BELT_OUTER_RIGHT = DESIGN_W + 120; // 右ベルトの外端（画面右外）

/** ベルト搬送速度（px/秒）。トレッドの流れもこの速度に揃える。 */
const BELT_SPEED = 360;

// 中央の集荷箱（蓋の開いた段ボール箱）。コンベアの内端はこの箱の口の真上に置き、
// 運ばれてきた段ボールが開いた口へ落ちて沈んでいく。
const BOX_W = 460;
const BOX_H = 280;
const BOX_TOP = 800; // 箱の口（上辺）の高さ
const FLAP_LEN_X = 150; // 開いた蓋が外へ張り出す量
const FLAP_LEN_Y = 150; // 開いた蓋が上へ立ち上がる量
/** 蓋の開閉スピード（1 秒あたりの開度。約 0.2 秒で開閉）。タイトル画面と同じ体感。 */
const LID_SPEED = 5;
/** 拍頭からのもちもち脈動の減衰時間（1 拍の約 40%・次の拍までに収まる）。 */
const BOX_PULSE_MS = SEC_PER_BEAT * 1000 * 0.2;
/** 拍頭スカッシュ（底を軸に横広がり / 縦潰れ）。 */
const BOX_SQUASH_X = 0.06;
const BOX_SQUASH_Y = 0.06;
/** 跳ね返りストレッチ（潰れの直後に縦へ伸びる）。 */
const BOX_BOUNCE_X = 0.045;
const BOX_BOUNCE_Y = 0.08;

/** 経過 ms から底軸スカッシュの scale オフセット (sx, sy) を求める。 */
function boxMochiPulse(elapsedMs: number): { sx: number; sy: number } {
  const w = elapsedMs / BOX_PULSE_MS;
  if (w >= 1) return { sx: 0, sy: 0 };
  // 拍に即応する急峻な立ち上がり。
  const snap = 1 - Math.exp(-w * 40);
  const squash = Math.sin(Math.PI * w * 0.88) * snap;
  // 潰れの直後（w≈0.15〜）に縦へ跳ね返る。
  const bounce = w > 0.12 ? Math.sin(((w - 0.12) / 0.48) * Math.PI) * (1 - w) ** 0.45 : 0;
  return {
    sx: BOX_SQUASH_X * squash - BOX_BOUNCE_X * bounce,
    sy: -BOX_SQUASH_Y * squash + BOX_BOUNCE_Y * bounce,
  };
}

/** 落下の重力加速度。 */
const FALL_ACCEL = 2400;
/** 落下中に箱の口中央へ横位置を寄せる率（1/秒）。 */
const FALL_CENTER_PULL = 10;
/** 箱の口を越えたあと、さらに中央へ寄せる倍率。 */
const FALL_CENTER_PULL_IN_BOX = 3;

// ベルトトレッド。
const TREAD_GAP = 36;
const TREAD_H = 7;

// 運ばれてくる段ボール。
const CARDBOARD_W = 140;

/** 同時に場へ出せる段ボールの上限（受信が殺到しても描画負荷を抑える）。 */
const MAX_ACTIVE = 28;

const posmod = (a: number, n: number) => ((a % n) + n) % n;

export interface ScanningBeltHandle {
  view: Container;
  /** パケット受信時に段ボールを 1 つ流す（左右ランダム）。 */
  spawnArrival(): void;
  /** ギミック（ベルト・落下・パルス）を止めて最後の絵を固める。view は残す。 */
  stopMechanism(): void;
  /** 集荷箱の蓋を開くアニメーション。完了後に resolve する。 */
  playOpenLid(): Promise<void>;
  /** 集荷箱の蓋を閉じるアニメーション。完了後に resolve する。 */
  playCloseLid(): Promise<void>;
  dispose(): void;
}

type ArrivalPhase = "belt" | "fall";

interface ActiveArrival {
  container: Container;
  /** +1=左ベルト（右へ進む）/ -1=右ベルト（左へ進む）。中央へ寄せる向きと一致。 */
  dir: 1 | -1;
  innerX: number;
  phase: ArrivalPhase;
  x: number;
  y: number;
  vy: number;
  alpha: number;
  /** 箱の口を一度くぐったか（飲み込みパルスの一回発火用）。 */
  entered: boolean;
}

/** 受け取るシーンの左右ベルト＋中央の集荷箱を構築する。SVG 読込のため非同期。 */
export async function buildScanningBeltView(): Promise<ScanningBeltHandle> {
  const seq = getSequence();
  const tx = await loadScanningTextures();
  const view = new Container();

  // フレーム。
  view.addChild(wireRect(FRAME_X, FRAME_Y, FRAME_W, FRAME_H));

  // 集荷箱の主要座標。
  const boxLeft = CENTER_X - BOX_W / 2;
  const boxRight = CENTER_X + BOX_W / 2;
  const boxBottom = BOX_TOP + BOX_H;

  // コンベアの内端は箱の口の真上（左右の角）に置く。
  const leftInner = boxLeft;
  const rightInner = boxRight;

  // ベルト寸法はテクスチャ比から決める（左右同寸）。
  const beltWidth = leftInner - BELT_OUTER_LEFT; // = 右ベルトと同じ
  const beltScale = beltWidth / tx.belt.width;
  const beltHeight = tx.belt.height * beltScale;

  // ベルトのトレッドマーク（毎フレーム再描画）。
  const beltMarks = new Graphics();
  view.addChild(beltMarks);

  // ベルトコンベア本体（SVG・白塗り）。左右に 1 本ずつ。
  const leftBelt = makeSvgSprite(tx.belt, beltWidth, 0, 0);
  leftBelt.position.set(BELT_OUTER_LEFT, BELT_Y);
  const rightBelt = makeSvgSprite(tx.belt, beltWidth, 0, 0);
  rightBelt.position.set(rightInner, BELT_Y);
  view.addChild(leftBelt, rightBelt);

  // 落下中の段ボール（搬送中より背面。後から来た荷物が手前に重なる）。
  const fallLayer = new Container();
  view.addChild(fallLayer);

  // ベルト上を搬送中の段ボール（ベルトより前面）。
  const beltLayer = new Container();
  view.addChild(beltLayer);

  // 集荷箱＋飲み込みパルスをまとめ、拍に合わせてビクつかせる。
  const boxLayer = new Container();
  // 中央の集荷箱（蓋の開いた段ボール箱・線画）。荷物より前面に置き、
  // 箱へ入った荷物が縁の内側＝箱の中に入り込んで見えるようにする
  //（荷物が箱の上に重なって見えないように、必ず荷物レイヤーの後で addChild）。
  const collectBox = new Graphics();
  /** 蓋の開度（1=開いた / 0=閉じた）。入室時は閉じ、BGM 開始と同時に開く。 */
  let lidOpen = 0;
  const drawCollectBox = (open: number) => {
    if (collectBox.destroyed) return;
    const leftEndX = CENTER_X + (boxLeft - FLAP_LEN_X - CENTER_X) * open;
    const leftEndY = BOX_TOP - FLAP_LEN_Y * open;
    const rightEndX = CENTER_X + (boxRight + FLAP_LEN_X - CENTER_X) * open;
    const rightEndY = BOX_TOP - FLAP_LEN_Y * open;
    collectBox
      .clear()
      // 箱本体（口の縁・左右壁・底）。
      .rect(boxLeft, BOX_TOP, BOX_W, BOX_H)
      // 正面のテープ（口から少し下へ）。
      .moveTo(CENTER_X, BOX_TOP)
      .lineTo(CENTER_X, BOX_TOP + 48)
      // 左の蓋（開度で外側↔中央を補間）。
      .moveTo(boxLeft, BOX_TOP)
      .lineTo(leftEndX, leftEndY)
      // 右の蓋。
      .moveTo(boxRight, BOX_TOP)
      .lineTo(rightEndX, rightEndY)
      .stroke({ width: STROKE.base, color: COLOR.ink, alignment: 0.5 });
  };
  drawCollectBox(lidOpen);

  // 飲み込み時のパルス（箱の口の輪・最前面）。
  const pulseGfx = new Graphics();
  pulseGfx.eventMode = "none";
  boxLayer.addChild(collectBox, pulseGfx);
  // 底辺中央を軸にスカッシュして、右上へズレないもちもち拍動にする。
  boxLayer.pivot.set(CENTER_X, boxBottom);
  boxLayer.position.set(CENTER_X, boxBottom);
  view.addChild(boxLayer);
  let pulse = 0;

  let beatT0 = -Infinity;
  const unsubBeat = seq.onBeat(() => {
    beatT0 = performance.now();
  });

  const active: ActiveArrival[] = [];
  let killed = false;
  let halted = false;
  let lidAnimRaf = 0;
  let lidAnimLastMs = 0;

  const cancelLidAnim = () => {
    if (lidAnimRaf) cancelAnimationFrame(lidAnimRaf);
    lidAnimRaf = 0;
    lidAnimLastMs = 0;
  };

  const animateLidTo = (target: number): Promise<void> => {
    cancelLidAnim();
    if (killed || lidOpen === target) {
      lidOpen = target;
      drawCollectBox(lidOpen);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const animate = (now: number) => {
        const dt = lidAnimLastMs ? (now - lidAnimLastMs) / 1000 : 0;
        lidAnimLastMs = now;
        if (lidOpen < target) lidOpen = Math.min(target, lidOpen + LID_SPEED * dt);
        else lidOpen = Math.max(target, lidOpen - LID_SPEED * dt);
        drawCollectBox(lidOpen);
        if (lidOpen !== target && !killed) {
          lidAnimRaf = requestAnimationFrame(animate);
        } else {
          cancelLidAnim();
          lidOpen = target;
          drawCollectBox(lidOpen);
          resolve();
        }
      };
      lidAnimRaf = requestAnimationFrame(animate);
    });
  };

  const makeCardboard = (): Container => {
    const container = new Container();
    const cardboard = makeSvgSprite(tx.cardboard, CARDBOARD_W, 0.5, 1);
    container.addChild(cardboard);
    return container;
  };

  /** 1 つの段ボールを更新。true なら搬送完了で破棄する。 */
  const updateArrival = (a: ActiveArrival, delta: number): boolean => {
    if (a.phase === "belt") {
      a.x += BELT_SPEED * a.dir * delta;
      const reached = a.dir > 0 ? a.x >= a.innerX : a.x <= a.innerX;
      if (reached) {
        a.x = a.innerX;
        a.phase = "fall";
        a.vy = 0;
        // 搬送レイヤーから落下レイヤー（背面）へ移し、後続の荷物を手前に重ねる。
        fallLayer.addChild(a.container);
      }
    } else {
      a.vy += FALL_ACCEL * delta;
      a.y += a.vy * delta;
      const depth = a.y - BOX_TOP;
      // コンベア端から落ち始めても、口の中央へ向かって落ちるように横位置を寄せる。
      const centerPull = depth > 0 ? FALL_CENTER_PULL * FALL_CENTER_PULL_IN_BOX : FALL_CENTER_PULL;
      a.x += (CENTER_X - a.x) * centerPull * delta;
      if (depth > 0) {
        if (!a.entered) {
          a.entered = true;
          pulse = 1; // 箱の口へ初めて入った瞬間に飲み込みパルス。
        }
        a.alpha = Math.max(0, 1 - depth / (boxBottom - BOX_TOP));
      }
    }

    a.container.x = a.x;
    a.container.y = a.y;
    a.container.alpha = a.alpha;
    return a.alpha <= 0 || a.y >= boxBottom;
  };

  // 連続アニメ（常駐 rAF）。
  let raf = 0;
  let lastFrameMs = performance.now();
  const frame = () => {
    if (killed) return;

    const frameMs = performance.now();
    const delta = Math.min(0.05, (frameMs - lastFrameMs) / 1000);
    lastFrameMs = frameMs;

    const now = seq.nowSeconds();

    // 1) トレッドマーク（左ベルトは右流れ・右ベルトは左流れ）。
    const travel = now * BELT_SPEED;
    const yTop = BELT_Y;
    const yBot = BELT_Y + beltHeight;
    beltMarks.clear();
    // 左ベルト：上面が右へ、下面が左へ。
    const lTop = posmod(travel, TREAD_GAP);
    const lBot = posmod(-travel, TREAD_GAP);
    for (let x = BELT_OUTER_LEFT + lTop; x < leftInner; x += TREAD_GAP) {
      beltMarks.moveTo(x, yTop).lineTo(x, yTop + TREAD_H);
    }
    for (let x = BELT_OUTER_LEFT + lBot; x < leftInner; x += TREAD_GAP) {
      beltMarks.moveTo(x, yBot).lineTo(x, yBot - 4);
    }
    // 右ベルト：上面が左へ、下面が右へ。
    const rTop = posmod(-travel, TREAD_GAP);
    const rBot = posmod(travel, TREAD_GAP);
    for (let x = rightInner + rTop; x < BELT_OUTER_RIGHT; x += TREAD_GAP) {
      beltMarks.moveTo(x, yTop).lineTo(x, yTop + TREAD_H);
    }
    for (let x = rightInner + rBot; x < BELT_OUTER_RIGHT; x += TREAD_GAP) {
      beltMarks.moveTo(x, yBot).lineTo(x, yBot - 4);
    }
    beltMarks.stroke({ width: STROKE.thin, color: COLOR.ink, alpha: 0.5 });

    // 2) 段ボール搬送・落下。
    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i]!;
      if (updateArrival(a, delta)) {
        a.container.destroy({ children: true });
        active.splice(i, 1);
      }
    }

    // 3) 飲み込みパルス（箱の口の輪・急速減衰）。
    pulseGfx.clear();
    if (pulse > 0.01) {
      pulseGfx
        .circle(CENTER_X, BOX_TOP, 30 + 130 * pulse)
        .fill({ color: COLOR.ink, alpha: 0.16 * pulse });
      pulse *= Math.pow(0.02, delta);
    } else {
      pulse = 0;
    }

    // 4) 集荷箱のもちもち拍動（蓋が開いている間だけキック拍に同期）。
    if (lidOpen >= 1) {
      const { sx, sy } = boxMochiPulse(performance.now() - beatT0);
      boxLayer.scale.set(1 + sx, 1 + sy);
    } else {
      boxLayer.scale.set(1);
    }

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const resetBoxJiggle = () => {
    boxLayer.scale.set(1);
  };

  const haltAnimation = () => {
    if (halted) return;
    halted = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pulse = 0;
    pulseGfx.clear();
    resetBoxJiggle();
  };

  return {
    view,

    spawnArrival() {
      if (killed || halted || lidOpen < 1) return;
      if (active.length >= MAX_ACTIVE) return; // 殺到時は描画を間引く（DB は controller 側で記録済み）。
      const fromLeft = Math.random() < 0.5;
      const container = makeCardboard();
      const startX = fromLeft ? BELT_OUTER_LEFT : BELT_OUTER_RIGHT;
      container.x = startX;
      container.y = BELT_Y;
      beltLayer.addChild(container);
      active.push({
        container,
        dir: fromLeft ? 1 : -1,
        innerX: fromLeft ? leftInner : rightInner,
        phase: "belt",
        x: startX,
        y: BELT_Y,
        vy: 0,
        alpha: 1,
        entered: false,
      });
    },

    stopMechanism() {
      haltAnimation();
    },

    playOpenLid() {
      return animateLidTo(1);
    },

    playCloseLid() {
      haltAnimation();
      return animateLidTo(0);
    },

    dispose() {
      killed = true;
      unsubBeat();
      cancelLidAnim();
      haltAnimation();
      for (const a of active) a.container.destroy({ children: true });
      active.length = 0;
    },
  };
}
