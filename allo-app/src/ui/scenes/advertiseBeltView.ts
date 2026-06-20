// 送るシーンのメカニズム UI（JSAB 工場パート inspired）。
// 幾何学図形のみ・拍完全同期・パイプライン加工。
// 左右プレスは 2 拍ごとに入れ替え、打撃は偶数拍境界に完全一致。
// controller が 4 拍ごとに場に出す。1拍ジャンプ＋3拍で左プレス到達。
// 文字はコライダーでプレスに反応して潰れ／箱詰め。右端通過で onShipped。

import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { COLOR, DESIGN_H, DESIGN_W, FONT_FAMILY, STROKE } from "../theme";
import { wireRect } from "../wireframe";
import { loadSvgTexture } from "../svgTexture";
import { getSequence, SEC_PER_BEAT } from "../../audio/sequence";
import pressSvgRaw from "../../assets/advertise/press.svg?raw";
import boxerSvgRaw from "../../assets/advertise/boxer.svg?raw";
import beltSvgRaw from "../../assets/advertise/belt.svg?raw";
import cardboardSvgRaw from "../../assets/advertise/cardboard.svg?raw";
import pipeSvgRaw from "../../assets/advertise/pipe.svg?raw";

/** 機械類・段ボール・パイプの SVG テクスチャ一式（全て論理座標と等倍）。 */
interface AdvertiseTextures {
  press: Texture;
  boxer: Texture;
  belt: Texture;
  cardboard: Texture;
  pipe: Texture;
}

async function loadAdvertiseTextures(): Promise<AdvertiseTextures> {
  const [press, boxer, belt, cardboard, pipe] = await Promise.all([
    loadSvgTexture(pressSvgRaw),
    loadSvgTexture(boxerSvgRaw),
    loadSvgTexture(beltSvgRaw),
    loadSvgTexture(cardboardSvgRaw),
    loadSvgTexture(pipeSvgRaw),
  ]);
  return { press, boxer, belt, cardboard, pipe };
}

/** SVG を論理幅 w で配置するスプライトを作る（テクスチャ実寸に依らず等倍化）。 */
function makeSvgSprite(texture: Texture, w: number, anchorX: number, anchorY: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(anchorX, anchorY);
  sprite.scale.set(w / texture.width);
  return sprite;
}

const CENTER_X = DESIGN_W / 2;

// メカニズム領域（フレーム）。
const FRAME_X = 240;
const FRAME_Y = 240;
const FRAME_W = 1440;
const FRAME_H = 540;

/** メカ一群（ベルト・プレス・パイプ）の横シフト量。配置関係は保ったまま左右の余白を均す。 */
const MECH_SHIFT_X = 80;

// 天井（プレス軸の付け根）。
const CEILING_Y = FRAME_Y + 40;

// ベルト（部屋いっぱい。搬送距離を短くして同拍数でより遅く見せる）。
const BELT_Y = 620;
const BELT_LEFT = 400 + MECH_SHIFT_X;
const BELT_RIGHT = 1200 + MECH_SHIFT_X;
const ROLLER_R = 28;

// パイプ（シュート）— ベルト右端のさらに右に置いた落とし口。
const PIPE_CENTER_X = BELT_RIGHT + 80;
const PIPE_MOUTH_RY = 18; // 口の楕円の縦半径（SVG リムと一致）
const PIPE_TOP = BELT_Y + 2 * ROLLER_R;
const PIPE_BOTTOM = FRAME_Y + FRAME_H;
/** 落下の重力加速度。 */
const FALL_ACCEL = 2400;
/** ベルト端から横に押し出す初速（パイプへ滑り込ませる）。 */
const FALL_PUSH = 250;

// プレス（左=圧縮機、右=箱詰機）。
const PRESS_LEFT_X = 600 + MECH_SHIFT_X;
/** 左到達から右プレス打撃までの拍数（beat 4→10）。 */
const BEATS_LEFT_TO_RIGHT = 6;
const PRESS_W = 140;
const PRESS_H = 110;
const PRESS_STEM_W = 22;
const PRESS_REST_Y = 350; // 頭の上端（待機）
const PRESS_DOWN_Y = 510; // 頭の上端（最下点）

// 下部キュー。
const QUEUE_Y = 880;
const QUEUE_BOX_W = 116;
const QUEUE_BOX_H = 116;
const QUEUE_GAP = 20;
const QUEUE_VISIBLE = 10;
/** 先頭マスの二重枠。外枠との隙間（論理 px）。 */
const QUEUE_HEAD_INSET = 8;

/** 1 セッションで送れる最大文字数（pendingQueue とも整合）。 */
export const ADVERTISE_MAX_CHARS = 50;

/** IME 入力欄の論理座標（下部キューの直下）。 */
export const ADVERTISE_INPUT_RECT = {
  x: CENTER_X - 280,
  y: QUEUE_Y + QUEUE_BOX_H + 24,
  w: 560,
  h: 64,
};

/** 文字を場に出す間隔（拍）。左プレスの打撃リズムと噛み合わせる。 */
export const ADVERTISE_DISPATCH_BEATS = 4;

/** ジャンプに使う拍数（残りはベルト移動で左プレスへ）。 */
const JUMP_BEATS = 1;
const JUMP_DURATION_SEC = SEC_PER_BEAT * JUMP_BEATS;
/** ジャンプ後、左プレスまでのベルト移動拍数（4拍送出 − ジャンプ1拍）。 */
const BEATS_TO_LEFT_PRESS = ADVERTISE_DISPATCH_BEATS - JUMP_BEATS;
const DIST_TO_LEFT_PRESS = PRESS_LEFT_X - BELT_LEFT;
/** 拍同期ベルト速度（3拍で左プレス到達）。距離を短くして視覚速度を抑える。 */
const BELT_SPEED = DIST_TO_LEFT_PRESS / (BEATS_TO_LEFT_PRESS * SEC_PER_BEAT);
/** 左到達拍数に連動して右 X を決める（拍ズレ防止）。 */
const PRESS_RIGHT_X =
  PRESS_LEFT_X + (DIST_TO_LEFT_PRESS / BEATS_TO_LEFT_PRESS) * BEATS_LEFT_TO_RIGHT;
/** プレスが文字に効く最低押下量（0..1）。 */
const PRESS_HIT_DROP = 0.35;
/** 発送トリガー位置（ベルト右端手前）。 */
const SHIP_X = BELT_RIGHT - 60;

// プレス常時稼働（2 拍周期・打撃はブロック先頭の拍に同期）。
const PRESS_CYCLE_BEATS = 2;
/** 打撃直前の入れ替えに使う拍数（短いほどメリハリが強い）。 */
const PRESS_SWAP_BEATS = 0.06;
/** 打撃時の白フラッシュ強度（画面全体オーバーレイ）。 */
const IMPACT_PULSE_PEAK = 0.22;

// ベルト接触時の火花パーティクル。
const SPARK_BURST_MIN = 14;
const SPARK_BURST_MAX = 22;

// ベルトトレッド（搬送速度と同期）。
const TREAD_GAP = 36;
const TREAD_H = 7;
const BEATS_PER_TREAD = TREAD_GAP / (BELT_SPEED * SEC_PER_BEAT);

// 文字（anchor 0.5, 1, y=0）と段ボール箱の寸法。
const BELT_CHAR_FONT_SIZE = 80;
const BELT_CHAR_COMPRESS = 0.2; // 圧縮後の縦倍率
const CARDBOARD_W = 75; // cardboard.svg の viewBox 幅と一致（高さは比率で決まる）

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (p: number) => 1 - Math.pow(1 - p, 2);
const easeInQuart = (p: number) => p * p * p * p;
const posmod = (a: number, n: number) => ((a % n) + n) % n;

interface RectCollider {
  cx: number;
  halfW: number;
  top: number;
  bottom: number;
}

function getPressCollider(pressX: number, headTopY: number, isLeft: boolean): RectCollider {
  const halfW = PRESS_W / 2 + (isLeft ? 10 : 8);
  const bottom = headTopY + PRESS_H + (isLeft ? 14 : 12);
  return { cx: pressX, halfW, top: headTopY, bottom };
}

function getCharCollider(x: number, y: number, scaleX: number, scaleY: number): RectCollider {
  const halfW = BELT_CHAR_FONT_SIZE * scaleX * 0.48;
  const h = BELT_CHAR_FONT_SIZE * scaleY;
  return { cx: x, halfW, top: y - h, bottom: y };
}

function collidersOverlap(a: RectCollider, b: RectCollider): boolean {
  return Math.abs(a.cx - b.cx) < a.halfW + b.halfW && a.top < b.bottom && a.bottom > b.top;
}

/**
 * 2 拍ブロックごとに左右が同時入れ替え。
 * 打撃（drop=1）はブロック境界＝偶数拍に完全一致。直前の短い区間でスナップして入れ替える。
 */
function alternatingPressDrops(now: number): { left: number; right: number } {
  const beatPhase = now / SEC_PER_BEAT;
  const block = Math.floor(beatPhase / PRESS_CYCLE_BEATS);
  const leftActive = block % 2 === 0;
  const phaseInBlock = posmod(beatPhase, PRESS_CYCLE_BEATS);
  const swapStart = PRESS_CYCLE_BEATS - PRESS_SWAP_BEATS;

  if (phaseInBlock < swapStart) {
    return leftActive ? { left: 1, right: 0 } : { left: 0, right: 1 };
  }

  const u = Math.min(1, (phaseInBlock - swapStart) / PRESS_SWAP_BEATS);
  const snap = u * u * u * u * u;
  const nextLeftActive = !leftActive;
  return nextLeftActive ? { left: snap, right: 1 - snap } : { left: 1 - snap, right: snap };
}

function pressImpactIsLeft(beatIndex: number): boolean {
  return Math.floor(beatIndex / PRESS_CYCLE_BEATS) % 2 === 0;
}

export interface AdvertiseBeltHandle {
  view: Container;
  /** 打撃フラッシュ（シーン最前面に載せる）。 */
  flashOverlay: Graphics;
  /** controller が真実の源。配列のスナップショットを渡して再描画する。 */
  setQueue(chars: string[]): void;
  /** 1 文字のベルト搬送開始（startSec は Transport 秒・拍境界）。 */
  beginTransmit(char: string, startSec?: number): void;
  /** 右端発送フェーズに入ったタイミングで 1 回だけ呼ばれる。 */
  setOnShipped(handler: (char: string) => void): void;
  /** ベルト上を搬送中か。 */
  isTransmitting(): boolean;
  /** 工場のギミック（プレス・ベルト・火花・打撃音）を停止し最後の絵を固める。view は残す。 */
  stopMechanism(): void;
  /** セッション残り時間（秒）を画面表示へ反映する。 */
  setSessionRemaining(seconds: number): void;
  dispose(): void;
}

interface QueueSlot {
  box: Container;
  outline: Graphics;
  /** 先頭マスだけ二重枠の内側線（座標は他マスと揃える）。 */
  innerOutline: Graphics | null;
  fill: Graphics;
  text: Text;
}

interface BeltItemVisual {
  container: Container;
  text: Text;
  cardboard: Sprite;
}

type SendPhase = "jump" | "belt" | "fall";

interface ActiveSend {
  char: string;
  jumpT0: number;
  shipped: boolean;
  visual: BeltItemVisual;
  phase: SendPhase;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  cardboardAlpha: number;
  alpha: number;
  vx: number;
  vy: number;
  compressed: boolean;
  boxed: boolean;
}

function makeBeltItemVisual(layer: Container, cardboardTexture: Texture): BeltItemVisual {
  const container = new Container();
  const text = new Text({
    text: "",
    style: {
      fill: COLOR.ink,
      fontSize: BELT_CHAR_FONT_SIZE,
      fontFamily: FONT_FAMILY,
      fontWeight: "700",
    },
  });
  text.anchor.set(0.5, 1);
  // 段ボール（SVG）。原点を箱の下端中央に合わせる。
  const cardboard = makeSvgSprite(cardboardTexture, CARDBOARD_W, 0.5, 1);
  cardboard.alpha = 0;
  container.addChild(cardboard, text);
  container.y = BELT_Y;
  container.visible = false;
  layer.addChild(container);
  return { container, text, cardboard };
}

function applySendVisual(send: ActiveSend) {
  const { container, text, cardboard } = send.visual;
  text.text = send.char;
  container.visible = true;
  container.x = send.x;
  container.y = send.y;
  container.alpha = send.alpha;
  text.visible = !send.boxed;
  text.scale.set(send.scaleX, send.scaleY);
  cardboard.alpha = send.boxed ? 1 : send.cardboardAlpha;
}

/** 1 文字を更新。true なら搬送完了で破棄する。 */
function updateSend(
  send: ActiveSend,
  delta: number,
  now: number,
  jumpStartX: number,
  jumpStartY: number,
  leftY: number,
  rightY: number,
  leftDrop: number,
  rightDrop: number,
  onShipped: ((char: string) => void) | null,
): boolean {
  if (send.phase === "jump") {
    const u = Math.min(1, (now - send.jumpT0) / JUMP_DURATION_SEC);
    send.x = lerp(jumpStartX, BELT_LEFT, easeOut(u));
    send.y = lerp(jumpStartY, BELT_Y, u) - Math.sin(Math.PI * u) * 200;
    const s = lerp(0.55, 1, u);
    send.scaleX = send.scaleY = s;
    if (u >= 1) {
      send.phase = "belt";
      send.x = BELT_LEFT;
      send.y = BELT_Y;
      send.scaleX = send.scaleY = 1;
    }
    applySendVisual(send);
    return false;
  }

  if (send.phase === "fall") {
    send.vy += FALL_ACCEL * delta;
    send.vx *= Math.pow(0.05, delta); // 横初速を素早く減衰させ縦落下へ移行
    send.x = Math.min(PIPE_CENTER_X, send.x + send.vx * delta);
    send.y += send.vy * delta;
    // パイプに入った深さに応じてフェード（飲み込まれる演出）。
    const depth = send.y - PIPE_TOP;
    if (depth > 0) send.alpha = Math.max(0, 1 - depth / (PIPE_BOTTOM - PIPE_TOP));
    applySendVisual(send);
    return send.alpha <= 0 || send.y >= PIPE_BOTTOM;
  }

  send.x += BELT_SPEED * delta;
  send.y = BELT_Y;

  const leftCol = getPressCollider(PRESS_LEFT_X, leftY, true);
  const rightCol = getPressCollider(PRESS_RIGHT_X, rightY, false);
  let charCol = getCharCollider(send.x, send.y, send.scaleX, send.scaleY);

  if (send.compressed) {
    send.scaleY = BELT_CHAR_COMPRESS;
  } else if (collidersOverlap(charCol, leftCol) && leftDrop >= PRESS_HIT_DROP) {
    const crush = (leftDrop - PRESS_HIT_DROP) / (1 - PRESS_HIT_DROP);
    send.scaleY = lerp(1, BELT_CHAR_COMPRESS, easeInQuart(crush));
    if (leftDrop >= 0.92) send.compressed = true;
    charCol = getCharCollider(send.x, send.y, send.scaleX, send.scaleY);
  }

  if (send.boxed) {
    send.cardboardAlpha = 1;
  } else if (send.compressed && collidersOverlap(charCol, rightCol) && rightDrop >= PRESS_HIT_DROP) {
    const pack = (rightDrop - PRESS_HIT_DROP) / (1 - PRESS_HIT_DROP);
    send.cardboardAlpha = Math.max(send.cardboardAlpha, easeInQuart(pack));
    if (rightDrop >= 0.92) send.boxed = true;
  }

  if (send.x >= SHIP_X && !send.shipped && send.boxed) {
    send.shipped = true;
    onShipped?.(send.char);
  }

  if (send.x >= BELT_RIGHT) {
    send.phase = "fall";
    send.vx = FALL_PUSH;
    send.vy = 0;
  }

  applySendVisual(send);
  return false;
}

function disposeBeltItemVisual(visual: BeltItemVisual) {
  visual.container.visible = false;
  visual.container.parent?.removeChild(visual.container);
  visual.container.destroy({ children: true });
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  len: number;
  angle: number;
  width: number;
}

/** プレスがベルトに当たった位置で火花を噴出する。 */
function spawnBeltSparks(sparks: Spark[], cx: number, cy: number) {
  const count =
    SPARK_BURST_MIN + Math.floor(Math.random() * (SPARK_BURST_MAX - SPARK_BURST_MIN + 1));
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI + Math.random() * Math.PI * 1.15;
    const speed = 160 + Math.random() * 340;
    sparks.push({
      x: cx + (Math.random() - 0.5) * PRESS_W * 0.7,
      y: cy + (Math.random() - 0.5) * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      maxLife: 0.12 + Math.random() * 0.22,
      len: 5 + Math.random() * 14,
      angle,
      width: Math.random() < 0.4 ? 2.5 : 1,
    });
  }
}

function updateSparks(sparks: Spark[], gfx: Graphics, delta: number) {
  gfx.clear();

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]!;
    s.life += delta;
    if (s.life >= s.maxLife) {
      sparks.splice(i, 1);
      continue;
    }

    s.x += s.vx * delta;
    s.y += s.vy * delta;
    s.vy += 480 * delta;
    s.vx *= 0.94;

    const t = s.life / s.maxLife;
    const alpha = (1 - t) * (1 - t);
    const len = s.len * (1 - t * 0.55);
    gfx
      .moveTo(s.x, s.y)
      .lineTo(s.x + Math.cos(s.angle) * len, s.y + Math.sin(s.angle) * len)
      .stroke({ width: s.width, color: COLOR.ink, alpha });
  }
}

interface PressUnit {
  unit: Container;
  redrawStem: () => void;
}

/** 頭の上端 y に合わせて天井から軸を伸ばす（頭と一体で追従）。 */
function makeStemGraphics(): Graphics {
  return new Graphics();
}

const pressPartStroke = { width: STROKE.base, color: COLOR.ink, alignment: 0.5 as const };

function attachStem(stem: Graphics, headTopY: number) {
  stem.clear();
  const stemH = headTopY - CEILING_Y;
  if (stemH <= 0) return;
  stem
    .rect(-PRESS_STEM_W / 2, CEILING_Y - headTopY, PRESS_STEM_W, stemH)
    .fill(COLOR.paper)
    .stroke(pressPartStroke);
}

/** プレスの頭部（SVG）＋天井から伸びるステム（コードで伸縮）を組む。 */
function makePress(x: number, headTexture: Texture): PressUnit {
  const unit = new Container();
  unit.x = x;
  unit.y = PRESS_REST_Y;

  const stem = makeStemGraphics();
  // 頭部は上端中央を基準（unit 原点＝頭の上端＝コライダー headTopY と一致）。
  const head = makeSvgSprite(headTexture, headTexture.width, 0.5, 0);
  unit.addChild(stem, head);
  return { unit, redrawStem: () => attachStem(stem, unit.y) };
}

/** セッション残り時間を "残り M:SS" 形式に整形する。 */
function formatSessionRemaining(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `残り ${m}:${ss.toString().padStart(2, "0")}`;
}

/** セッション最大稼働時間（秒）。表示の初期値・コントローラの上限と一致させる。 */
export const ADVERTISE_SESSION_SECONDS = 45;

/** シーン遷移（覆い保持＋蓋開き）が終わるまでセッション開始を遅らせる時間（ms）。 */
export { SCENE_REVEAL_AFTER_BUILD_MS as ADVERTISE_SESSION_START_DELAY_MS } from "./sceneTransition";

/** 送るシーンのベルト＋圧縮機/箱詰機＋下部キューを構築する。SVG 読込のため非同期。 */
export async function buildAdvertiseBeltView(): Promise<AdvertiseBeltHandle> {
  const seq = getSequence();
  const tx = await loadAdvertiseTextures();
  const view = new Container();

  // フレーム。
  view.addChild(wireRect(FRAME_X, FRAME_Y, FRAME_W, FRAME_H));

  // セッション残り時間（タイトルと同じ高度、右上）。コントローラが毎秒更新する。
  const sessionTimerText = new Text({
    text: formatSessionRemaining(ADVERTISE_SESSION_SECONDS),
    style: { fill: COLOR.ink, fontSize: 52, fontFamily: FONT_FAMILY, fontWeight: "600" },
  });
  sessionTimerText.anchor.set(1, 0.5);
  sessionTimerText.position.set(DESIGN_W - 100, 130);
  view.addChild(sessionTimerText);

  // 天井ライン（プレス軸の付け根）。
  view.addChild(
    new Graphics()
      .moveTo(FRAME_X + 60, CEILING_Y)
      .lineTo(FRAME_X + FRAME_W - 60, CEILING_Y)
      .stroke({ width: STROKE.thin, color: COLOR.ink, alpha: 0.5 }),
  );

  // ベルトのトレッドマーク（毎フレーム再描画）。
  const beltMarks = new Graphics();
  view.addChild(beltMarks);

  // 落下中の箱を載せる背面レイヤ（ベルト面より背面＝端の裏に隠れて落ちる）。
  const beltLayerBack = new Container();
  view.addChild(beltLayerBack);

  // ベルトコンベア本体（SVG・白塗り）。背面の落下物をベルト端で隠す。
  const belt = makeSvgSprite(tx.belt, BELT_RIGHT - BELT_LEFT, 0, 0);
  belt.position.set(BELT_LEFT, BELT_Y);
  view.addChild(belt);

  // ベルト上の搬送物（プレスより背面＝機械の下を通過）。
  const beltLayer = new Container();
  view.addChild(beltLayer);

  // パイプ（シュート・SVG）— ベルト右端のさらに右に置いた縦管。
  // 内部は透明なので、背面レイヤを落ちる段ボールが管の中に見える。
  const pipe = makeSvgSprite(tx.pipe, tx.pipe.width, 0.5, 0);
  pipe.position.set(PIPE_CENTER_X, PIPE_TOP - PIPE_MOUTH_RY);
  view.addChild(pipe);

  // プレス（頭部は SVG、軸は頭に追従して伸縮）。
  const leftPress = makePress(PRESS_LEFT_X, tx.press);
  const rightPress = makePress(PRESS_RIGHT_X, tx.boxer);
  view.addChild(leftPress.unit, rightPress.unit);
  leftPress.redrawStem();
  rightPress.redrawStem();

  const sparks: Spark[] = [];
  const sparkGfx = new Graphics();
  view.addChild(sparkGfx);

  // 打撃時の白フラッシュ（シーン最前面に載せるオーバーレイ）。
  const impactPulseGfx = new Graphics();
  impactPulseGfx.eventMode = "none";
  let impactPulse = 0;

  // 下部キュー。
  const queueTotalW = QUEUE_VISIBLE * QUEUE_BOX_W + (QUEUE_VISIBLE - 1) * QUEUE_GAP;
  const queueStartX = CENTER_X - queueTotalW / 2;
  const queueLayer = new Container();
  view.addChild(queueLayer);

  const slots: QueueSlot[] = [];
  for (let i = 0; i < QUEUE_VISIBLE; i++) {
    const bx = queueStartX + i * (QUEUE_BOX_W + QUEUE_GAP);
    const box = new Container();
    const fill = new Graphics()
      .rect(bx, QUEUE_Y, QUEUE_BOX_W, QUEUE_BOX_H)
      .fill({ color: COLOR.ink, alpha: 0 });
    const outline = wireRect(bx, QUEUE_Y, QUEUE_BOX_W, QUEUE_BOX_H);
    const innerOutline =
      i === 0
        ? wireRect(
            bx + QUEUE_HEAD_INSET,
            QUEUE_Y + QUEUE_HEAD_INSET,
            QUEUE_BOX_W - QUEUE_HEAD_INSET * 2,
            QUEUE_BOX_H - QUEUE_HEAD_INSET * 2,
          )
        : null;
    if (innerOutline) innerOutline.alpha = 0;
    const text = new Text({
      text: "",
      style: { fill: COLOR.ink, fontSize: 64, fontFamily: FONT_FAMILY, fontWeight: "700" },
    });
    text.anchor.set(0.5);
    text.position.set(bx + QUEUE_BOX_W / 2, QUEUE_Y + QUEUE_BOX_H / 2);
    box.addChild(fill, outline, ...(innerOutline ? [innerOutline] : []), text);
    queueLayer.addChild(box);
    slots.push({ box, outline, innerOutline, fill, text });
  }

  // ジャンプの起点（キュー先頭マスの中心）。
  const jumpStartX = queueStartX + QUEUE_BOX_W / 2;
  const jumpStartY = QUEUE_Y + QUEUE_BOX_H / 2;

  const active: ActiveSend[] = [];
  let onShipped: ((char: string) => void) | null = null;
  let killed = false;
  let halted = false;
  const dropMax = PRESS_DOWN_Y - PRESS_REST_Y;

  // 打撃の音・火花は拍グリッドで発火（映像は alternatingPressDrops と同位相）。
  const onPressImpactBeat = (beat: { index: number }) => {
    if (beat.index % PRESS_CYCLE_BEATS !== 0) return;
    const cx = pressImpactIsLeft(beat.index) ? PRESS_LEFT_X : PRESS_RIGHT_X;
    spawnBeltSparks(sparks, cx, BELT_Y);
    impactPulse = IMPACT_PULSE_PEAK;
  };
  const onPressImpactAudio = (beat: { index: number; time: number }) => {
    if (beat.index % PRESS_CYCLE_BEATS !== 0) return;
    seq.playMachineImpact(beat.time);
  };
  const unsubImpactAudio = seq.onBeatAudio(onPressImpactAudio);
  const unsubImpactDraw = seq.onBeat(onPressImpactBeat);

  // 連続アニメ（常駐 rAF）。
  let raf = 0;
  let lastFrameMs = performance.now();
  const frame = () => {
    if (killed) return;

    const frameMs = performance.now();
    const delta = Math.min(0.05, (frameMs - lastFrameMs) / 1000);
    lastFrameMs = frameMs;

    const now = seq.nowSeconds();

    // 1) ベルトトレッドマーク＋ローラースポーク。
    const travel = (now / (SEC_PER_BEAT * BEATS_PER_TREAD)) * TREAD_GAP;
    const topOffset = posmod(travel, TREAD_GAP);
    const botOffset = posmod(-travel, TREAD_GAP);
    beltMarks.clear();
    const yTop = BELT_Y;
    const yBot = BELT_Y + 2 * ROLLER_R;
    for (let x = BELT_LEFT + topOffset; x < BELT_RIGHT; x += TREAD_GAP) {
      beltMarks.moveTo(x, yTop).lineTo(x, yTop + TREAD_H);
    }
    for (let x = BELT_LEFT + botOffset; x < BELT_RIGHT; x += TREAD_GAP) {
      beltMarks.moveTo(x, yBot).lineTo(x, yBot - 4);
    }
    beltMarks.stroke({ width: STROKE.thin, color: COLOR.ink, alpha: 0.5 });

    // 2) プレス常時稼働（2 拍ごとに左右同時入れ替え・スナップ＋ホールド）。
    const { left: leftDrop, right: rightDrop } = alternatingPressDrops(now);
    const leftY = PRESS_REST_Y + dropMax * leftDrop;
    const rightY = PRESS_REST_Y + dropMax * rightDrop;

    // 3) 送出進行（コライダー反応・複数同時）。
    for (let i = active.length - 1; i >= 0; i--) {
      const send = active[i]!;
      const done = updateSend(
        send,
        delta,
        now,
        jumpStartX,
        jumpStartY,
        leftY,
        rightY,
        leftDrop,
        rightDrop,
        onShipped,
      );
      if (done) {
        disposeBeltItemVisual(send.visual);
        active.splice(i, 1);
      } else if (send.phase === "fall" && send.visual.container.parent === beltLayer) {
        // 落下に入った瞬間にベルト面の背面へ移す（端の裏に隠れて落ちる）。
        beltLayerBack.addChild(send.visual.container);
      }
    }

    // 4) プレス位置反映（軸は頭の上端まで追従）。
    leftPress.unit.y = leftY;
    rightPress.unit.y = rightY;
    leftPress.redrawStem();
    rightPress.redrawStem();

    // 5) ベルト接触火花。
    updateSparks(sparks, sparkGfx, delta);

    // 6) 打撃フラッシュ（白・画面全体・急速減衰）。
    if (impactPulse > 0.002) {
      impactPulseGfx
        .clear()
        .rect(0, 0, DESIGN_W, DESIGN_H)
        .fill({ color: COLOR.paper, alpha: impactPulse });
      impactPulse *= Math.pow(0.06, delta);
    } else {
      impactPulse = 0;
      impactPulseGfx.clear();
    }

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // --- 公開 API ---

  // アニメ・打撃音を止めて場を固める（view は残す）。stopMechanism / dispose 共用。
  const haltAnimation = () => {
    if (halted) return;
    halted = true;
    unsubImpactAudio();
    unsubImpactDraw();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    sparks.length = 0;
    sparkGfx.clear();
    impactPulse = 0;
    impactPulseGfx.clear();
  };

  const renderQueue = (chars: string[]) => {
    const overflow = Math.max(0, chars.length - QUEUE_VISIBLE);
    for (let i = 0; i < QUEUE_VISIBLE; i++) {
      const slot = slots[i]!;
      const ch = chars[i] ?? "";
      const isOverflowMarker = overflow > 0 && i === QUEUE_VISIBLE - 1;
      if (isOverflowMarker) {
        slot.text.text = `+${overflow + 1}`;
        slot.text.style.fontSize = 40;
      } else {
        if (slot.text.text !== ch) slot.text.text = ch;
        slot.text.style.fontSize = 64;
      }
      const isEmpty = ch === "" && !isOverflowMarker;
      const isHead = i === 0 && ch !== "";
      slot.fill.alpha = 0;
      slot.outline.alpha = isEmpty ? 0.3 : 1;
      if (slot.innerOutline) slot.innerOutline.alpha = isHead ? 1 : 0;
    }
  };

  return {
    view,
    flashOverlay: impactPulseGfx,

    setQueue(chars: string[]) {
      renderQueue(chars);
    },

    beginTransmit(char: string, startSec?: number) {
      active.push({
        char,
        jumpT0: startSec ?? seq.nowSeconds(),
        shipped: false,
        visual: makeBeltItemVisual(beltLayer, tx.cardboard),
        phase: "jump",
        x: jumpStartX,
        y: jumpStartY,
        scaleX: 0.55,
        scaleY: 0.55,
        cardboardAlpha: 0,
        alpha: 1,
        vx: 0,
        vy: 0,
        compressed: false,
        boxed: false,
      });
    },

    setOnShipped(handler: (char: string) => void) {
      onShipped = handler;
    },

    isTransmitting() {
      return active.length > 0;
    },

    stopMechanism() {
      // 工場のギミック（プレス・ベルト・火花・打撃音）を止め、最後の絵を固める。
      haltAnimation();
    },

    setSessionRemaining(seconds: number) {
      sessionTimerText.text = formatSessionRemaining(seconds);
    },

    dispose() {
      killed = true;
      haltAnimation();
      for (const send of active) disposeBeltItemVisual(send.visual);
      active.length = 0;
    },
  };
}
