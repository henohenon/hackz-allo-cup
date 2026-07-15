// 荷物一覧シーンの「箱降らし」。
// 上中央から、このシーンのグルーヴ（addListGroove）の拍に合わせて荷物箱（正方形）を 1 個ずつ落とす。
// 箱は matter-js の物理で落下し、画面四辺の見えない壁・床・箱同士とぶつかって積もる。
// Android では加速度センサー（DeviceMotion）で重力方向を実機の傾きに合わせる。
// 見た目は他シーンの箱モチーフに倣ったワイヤーフレーム（白塗り＋黒枠の角丸正方形）。
// 箱にカーソルがホバーすると、その箱からタグ（中身はテキスト）が出る。

import { Capacitor } from "@capacitor/core";
import { Container, Graphics, Rectangle } from "pixi.js";
import { Bodies, Body, Composite, Engine, Sleeping, type Body as MatterBody } from "matter-js";
import { COLOR, DESIGN_H, DESIGN_W, STROKE } from "../theme";
import { label, wireRect } from "../wireframe";
import { getSequence } from "../../audio/sequence";

/** 重力の強さ（matter-js の gravity.y 既定スケール向け）。 */
export const GRAVITY_MAG = 5.0;
/** 傾き変化がこれ以上ならスリープ中の箱を起こす。 */
const GRAVITY_WAKE_DELTA = 0.04;
/** 標準重力加速度 (m/s²)。 */
export const STANDARD_G = 9.80665;

export interface BoxDropHandle {
  /** 箱本体のレイヤー。 */
  view: Container;
  /** タグのレイヤー（箱より前面に置く）。 */
  overlay: Container;
  dispose: () => void;
}

interface BoxEntity {
  body: MatterBody;
  sprite: Container;
  size: number;
  /** ホバー時にタグへ出すテキスト。 */
  text: string;
}

// 箱の一辺は文字数に応じて拡大縮小する。
const BOX_SIZE_MIN = 90; // 短いテキストの最小辺
const BOX_SIZE_MAX = 230; // 長いテキストの最大辺
const CHARS_AT_MIN = 1; // この文字数以下で最小サイズ
const CHARS_AT_MAX = 14; // この文字数以上で最大サイズ
// 同時に存在できる箱の上限。超えたら古いものから消す（お椀から溢れさせない）。
const MAX_BOXES = 28;
// 物理の固定タイムステップ（ms）。
const FIXED_DT = 1000 / 60;

// 壁の内面を画面端から内側 1px に置く（＝ほぼ端ぴったり・見えない）。
const EDGE = 1;
// 壁の厚み。画面外へ十分はみ出させ、高速な箱のすり抜けを防ぐ。
const WALL_THICK = 400;

// タグのポップイン/アウト時間（ms）。
const TAG_POP_MS = 150;
// タグ右端がここまで来たら左右反転して左へ逃がす（画面端の余白）。
const TAG_EDGE_MARGIN = 20;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// ポップイン用の軽いオーバーシュート（弾むような出方）。
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

/**
 * テキストの文字数から箱の一辺を求める。文字数が多いほど大きい。
 * 質量は matter-js が密度×面積で自動算出するので、サイズに連動して重さも変わる
 * （面積比なので大きい箱ほど顕著に重い）。書記素ではなくコードポイント数で十分。
 */
function sizeForText(text: string): number {
  const len = Array.from(text).length;
  const t = clamp((len - CHARS_AT_MIN) / (CHARS_AT_MAX - CHARS_AT_MIN), 0, 1);
  return BOX_SIZE_MIN + (BOX_SIZE_MAX - BOX_SIZE_MIN) * t;
}

/**
 * 荷物に付く荷札タグ。原点 (0,0) が箱との接点（＝紐の付け根）。
 * 読みやすさ優先で本体は角丸カードのまま、下辺にハトメ穴と箱へ伸びる紐を足して
 * 「荷物に結ばれた札」に見せる。原点を軸にポップするので紐の付け根から開く。
 */
function buildTag(text: string, flip: boolean): Container {
  const c = new Container();
  const t = label(text, 0, 0, { size: 30, anchorX: 0.5, anchorY: 0.5, weight: "500" });

  const padX = 30;
  const padY = 20;
  const w = t.width + padX * 2;
  const ARC_R = 42; // 紐（4分の1円）の半径
  const HOLE_R = 8; // ハトメ穴の半径
  const HOLE_INSET = 18; // 穴をカード左下から内側に置く距離

  // 紐の終点＝ハトメ穴。原点(0,0)から右上へ 4分の1円で結ぶ。
  const holeX = ARC_R;
  const holeY = -ARC_R;
  // カードは穴を左下に内側 HOLE_INSET で抱える＝原点より少し右へずれる。
  const cardLeft = ARC_R - HOLE_INSET;
  const cardBottom = -ARC_R + HOLE_INSET;
  const bodyH = t.height + padY * 2;
  const cardTop = cardBottom - bodyH;

  // 形状（紐・カード・穴）はまとめて、右へ張り出すのが定位置。
  // flip 時は scale.x=-1 で左右反転（原点 x=0＝箱との接点は不動）。
  const shapes = new Container();

  // 紐: 箱との接点(0,0)から穴へ 4分の1円の弧で。
  // 中心(ARC_R,0)・半径 ARC_R、角度 π→1.5π。接点では鉛直、穴では水平に接する。
  const string = new Graphics()
    .arc(ARC_R, 0, ARC_R, Math.PI, Math.PI * 1.5)
    .stroke({ width: STROKE.base, color: COLOR.ink });

  // タグ本体（角丸カード）。原点より右へずらす。
  const body = new Graphics()
    .roundRect(cardLeft, cardTop, w, bodyH, 16)
    .fill(COLOR.paper)
    .stroke({ width: STROKE.base, color: COLOR.ink });

  // ハトメ穴（紐を通す穴）。カード左下に。細線のリングで「穴」を表す。
  const hole = new Graphics()
    .circle(holeX, holeY, HOLE_R)
    .fill(COLOR.paper)
    .stroke({ width: STROKE.thin, color: COLOR.ink });

  shapes.addChild(string, body, hole);
  if (flip) shapes.scale.x = -1;
  c.addChild(shapes);

  // 文字は反転させない（常に左→右で読めるまま）。反転時は中心 x だけ左へ移す。
  const cx = cardLeft + w / 2;
  t.position.set(flip ? -cx : cx, cardTop + bodyH / 2);
  c.addChild(t);

  return c;
}

/**
 * DeviceMotion の加速度（重力込み）を matter-js の画面座標重力へ写す。
 *
 * DeviceMotion の軸は端末の自然向き（縦）に固定されたままなので、
 * 横画面（orientationAngle=90/270）では画面の右・上へ揃える回転が必要。
 * 静止時の accelerationIncludingGravity は「空側」（支持力方向）を指す。
 * Matter: +x 右 / +y 下。
 *
 * @param orientationAngle `screen.orientation.angle`（0/90/180/270）
 */
export function gravityFromAcceleration(
  ax: number,
  ay: number,
  orientationAngle = 0,
): { x: number; y: number } {
  // 端末座標 → 画面座標（+x 右 / +y 上）
  let sx = ax;
  let sy = ay;
  const angle = ((Math.round(orientationAngle) % 360) + 360) % 360;
  if (angle === 90) {
    // landscape-primary（android:screenOrientation="landscape"）
    sx = ay;
    sy = -ax;
  } else if (angle === 180) {
    sx = -ax;
    sy = -ay;
  } else if (angle === 270) {
    // landscape-secondary
    sx = -ay;
    sy = ax;
  }
  return {
    x: (sx / STANDARD_G) * GRAVITY_MAG,
    y: (-sy / STANDARD_G) * GRAVITY_MAG,
  };
}

/** Android 横画面アプリ向け。orientation が取れないときは landscape-primary とみなす。 */
function currentOrientationAngle(): number {
  return screen.orientation?.angle ?? 90;
}

/**
 * 画面の端を見えない壁にして、拍に合わせて荷物箱を落とす物理デモを構築する。
 * @param texts 直近セッションの content 配列。箱 i にテキスト i を 1:1 で割り当てる。
 *   全件落とし終えたらスポーンを止める（箱の数 = データ件数）。
 */
export function buildListBoxDrop(texts: string[]): BoxDropHandle {
  const seq = getSequence();
  const view = new Container();
  const overlay = new Container();
  const isAndroid = Capacitor.getPlatform() === "android";

  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.x = 0;
  engine.gravity.y = GRAVITY_MAG;

  // 壁・床・天井の静的ボディ。内面を画面端（端+1px）に置き、本体は画面外へはみ出させる＝見えない。
  // 箱を画面内に閉じ込めるためだけの境界（描画はしない）。天井は傾きで重力が反転しても逃がさない。
  // 摩擦は「滑るが角が引っかかって転がる」程度。低すぎるとスライドだけで転がらなくなる。
  const wallOpts = { isStatic: true, friction: 0.06, frictionStatic: 0.12 };
  const leftWall = Bodies.rectangle(
    EDGE - WALL_THICK / 2,
    DESIGN_H / 2,
    WALL_THICK,
    DESIGN_H * 2,
    wallOpts,
  );
  const rightWall = Bodies.rectangle(
    DESIGN_W - EDGE + WALL_THICK / 2,
    DESIGN_H / 2,
    WALL_THICK,
    DESIGN_H * 2,
    wallOpts,
  );
  const floor = Bodies.rectangle(
    DESIGN_W / 2,
    DESIGN_H - EDGE + WALL_THICK / 2,
    DESIGN_W * 2,
    WALL_THICK,
    wallOpts,
  );
  const ceiling = Bodies.rectangle(
    DESIGN_W / 2,
    EDGE - WALL_THICK / 2,
    DESIGN_W * 2,
    WALL_THICK,
    wallOpts,
  );
  Composite.add(engine.world, [leftWall, rightWall, floor, ceiling]);

  const boxes: BoxEntity[] = [];

  // 現在カーソル下の箱と、表示中のタグ（尖り＝原点を軸にポップする）。
  let hovered: BoxEntity | null = null;
  interface TagState {
    view: Container;
    entity: BoxEntity; // 追従先の箱
    dir: 1 | -1; // 1=ポップイン中 / -1=ポップアウト中
    t: number; // 0..1 のアニメ進行
  }
  let tag: TagState | null = null;

  /** タグを即時破棄する。 */
  const destroyTag = () => {
    if (tag) {
      tag.view.destroy({ children: true });
      tag = null;
    }
  };

  const showTag = (entity: BoxEntity) => {
    // 同じ箱に再ホバーしたら、ポップアウト中でもポップインへ戻す。
    if (tag && tag.entity === entity) {
      tag.dir = 1;
      return;
    }
    destroyTag();
    // まず右張り出しで仮ビルドして幅を測り、画面右にはみ出すなら左右反転して左へ逃がす。
    // （タグの原点 x=0 は箱との接点なので、view.width ≒ 右への張り出し量）
    let view = buildTag(entity.text, false);
    const flip = entity.body.position.x + view.width > DESIGN_W - TAG_EDGE_MARGIN;
    if (flip) {
      view.destroy({ children: true });
      view = buildTag(entity.text, true);
    }
    view.scale.set(0); // 紐の付け根（原点）から開く
    // 追加直後の1フレーム、左上(原点)に出ないよう箱の上へ即配置する。
    view.position.set(entity.body.position.x, entity.body.position.y - entity.size / 2);
    overlay.addChild(view);
    tag = { view, entity, dir: 1, t: 0 };
  };

  /** entity のタグをポップアウトさせる（破棄はアニメ完了時）。 */
  const hideTag = (entity: BoxEntity) => {
    if (tag && tag.entity === entity) tag.dir = -1;
  };

  let spawnCount = 0;
  const spawnBox = () => {
    // データ件数ぶんだけ落とす。生成 i 番目の箱 = texts[i]（1:1）。
    if (spawnCount >= texts.length) return;
    const text = texts[spawnCount++];
    // 文字数に応じて拡大縮小（質量も面積比で連動）。
    const size = sizeForText(text);
    // 上中央（天井のすぐ内側）から。横位置と回転を少しばらつかせて自然に積ませる。
    const x = DESIGN_W / 2 + rand(-120, 120);
    const y = EDGE + size / 2 + 8;

    const body = Bodies.rectangle(x, y, size, size, {
      restitution: 0.15,
      friction: 0.16,
      frictionStatic: 0.28,
      frictionAir: 0.001,
      angle: rand(-0.3, 0.3),
    });
    Body.setVelocity(body, { x: rand(-2, 2), y: 0 });
    Body.setAngularVelocity(body, rand(-0.08, 0.08));
    Composite.add(engine.world, body);

    const sprite = new Container();
    sprite.addChild(wireRect(-size / 2, -size / 2, size, size, { radius: 12, fillPaper: true }));
    // 上中央の装飾長方形（模様・物理なし）。幅=箱の1/8、上辺を箱の上辺に合わせる。
    // 高さ=「箱の1/3」を基準にした、その3/4。
    const decoW = size / 8;
    const decoH = ((size / 3) * 3) / 4;
    sprite.addChild(wireRect(-decoW / 2, -size / 2, decoW, decoH));
    // ホバー検知（クリックではないので cursor は既定のまま）。
    sprite.eventMode = "static";
    sprite.hitArea = new Rectangle(-size / 2, -size / 2, size, size);
    // 追加直後の1フレーム、位置同期前に原点(左上)へ描画されるのを防ぐため初期位置を即同期する。
    sprite.position.set(body.position.x, body.position.y);
    sprite.rotation = body.angle;
    view.addChild(sprite);

    const entity: BoxEntity = { body, sprite, size, text };
    sprite.on("pointerover", () => {
      hovered = entity;
      showTag(entity);
    });
    sprite.on("pointerout", () => {
      if (hovered === entity) hovered = null;
      hideTag(entity);
    });

    boxes.push(entity);

    // 上限を超えたら最古を物理・描画ともに撤去する。
    if (boxes.length > MAX_BOXES) {
      const oldest = boxes.shift();
      if (oldest) {
        // 撤去対象に紐づくタグは追従先が消えるので即破棄する。
        if (tag && tag.entity === oldest) destroyTag();
        if (hovered === oldest) hovered = null;
        Composite.remove(engine.world, oldest.body);
        oldest.sprite.destroy({ children: true });
      }
    }
  };

  // このシーン特有の音（グルーヴ）の拍に同期して 1 拍 1 箱。
  const unsubBeat = seq.onBeat(() => spawnBox());

  // Android のみ: 加速度センサーで重力方向を更新する（Electron / ブラウザは下向き固定）。
  let lastGx = 0;
  let lastGy = GRAVITY_MAG;
  const onDeviceMotion = (e: DeviceMotionEvent) => {
    const ag = e.accelerationIncludingGravity;
    if (!ag || ag.x == null || ag.y == null) return;
    const { x, y } = gravityFromAcceleration(ag.x, ag.y, currentOrientationAngle());
    engine.gravity.x = x;
    engine.gravity.y = y;
    // 傾きが変わったらスリープ中の箱を起こし、積み上がったまま固まらないようにする。
    if (Math.hypot(x - lastGx, y - lastGy) > GRAVITY_WAKE_DELTA) {
      lastGx = x;
      lastGy = y;
      for (const body of Composite.allBodies(engine.world)) {
        if (!body.isStatic) Sleeping.set(body, false);
      }
    }
  };
  if (isAndroid) {
    window.addEventListener("devicemotion", onDeviceMotion);
  }

  // 物理を固定ステップで進め、各箱のスプライトをボディに同期する。
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const frame = () => {
    const now = performance.now();
    const dt = now - last;
    acc += dt;
    last = now;
    // 大きなフレーム飛び（タブ復帰など）で一気に進めすぎないよう上限を設ける。
    acc = Math.min(acc, FIXED_DT * 5);
    while (acc >= FIXED_DT) {
      Engine.update(engine, FIXED_DT);
      acc -= FIXED_DT;
    }
    for (const { body, sprite } of boxes) {
      sprite.position.set(body.position.x, body.position.y);
      sprite.rotation = body.angle;
    }
    // タグ: ポップイン/アウトを進め、ホバー中の箱の上に追従させる。
    if (tag) {
      tag.t = clamp(tag.t + (tag.dir * Math.min(dt, 50)) / TAG_POP_MS, 0, 1);
      if (tag.dir === -1 && tag.t <= 0) {
        destroyTag();
      } else {
        // 紐の付け根（原点）を軸に拡縮。イン=オーバーシュート、アウト=素直に縮む。
        const s = tag.dir === 1 ? easeOutBack(tag.t) : tag.t * tag.t;
        tag.view.scale.set(Math.max(0, s));
        // 紐の付け根を箱の上端に追従させる（はみ出しは反転で解決済み）。
        const b = tag.entity;
        tag.view.position.set(b.body.position.x, b.body.position.y - b.size / 2);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    view,
    overlay,
    dispose: () => {
      unsubBeat();
      if (isAndroid) {
        window.removeEventListener("devicemotion", onDeviceMotion);
      }
      if (raf) cancelAnimationFrame(raf);
      destroyTag();
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}
