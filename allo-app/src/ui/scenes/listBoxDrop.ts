// 荷物一覧シーンの「箱降らし」。
// 上中央から、このシーンのグルーヴ（addListGroove）の拍に合わせて荷物箱（正方形）を 1 個ずつ落とす。
// 箱は matter-js の物理で落下し、お椀の壁・床・箱同士とぶつかって積もる。
// 見た目は他シーンの箱モチーフに倣ったワイヤーフレーム（白塗り＋黒枠の角丸正方形）。
// 箱にカーソルがホバーすると、その箱から吹き出し（中身は仮テキスト）が出る。

import { Container, Graphics, Rectangle } from "pixi.js";
import { Bodies, Body, Composite, Engine, type Body as MatterBody } from "matter-js";
import { COLOR, DESIGN_H, DESIGN_W, STROKE } from "../theme";
import { label, wireRect } from "../wireframe";
import { getSequence } from "../../audio/sequence";

export interface BoxDropHandle {
  /** 箱本体のレイヤー。 */
  view: Container;
  /** 吹き出しのレイヤー（箱より前面に置く）。 */
  overlay: Container;
  dispose: () => void;
}

interface BoxEntity {
  body: MatterBody;
  sprite: Container;
  size: number;
  /** ホバー時に吹き出しへ出す仮テキスト。 */
  text: string;
}

// 箱の一辺（少しばらつかせる）。
const BOX_MIN = 130;
const BOX_MAX = 170;
// 同時に存在できる箱の上限。超えたら古いものから消す（お椀から溢れさせない）。
const MAX_BOXES = 28;
// 物理の固定タイムステップ（ms）。
const FIXED_DT = 1000 / 60;

// 壁の内面を画面端から内側 1px に置く（＝ほぼ端ぴったり・見えない）。
const EDGE = 1;
// 壁の厚み。画面外へ十分はみ出させ、高速な箱のすり抜けを防ぐ。
const WALL_THICK = 400;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 仮テキスト入りの吹き出し（下向きの尻尾の先端が原点 (0,0)）。 */
function buildBubble(text: string): Container {
  const c = new Container();
  const t = label(text, 0, 0, { size: 30, anchorX: 0.5, anchorY: 0.5, weight: "500" });

  const padX = 30;
  const padY = 20;
  const w = t.width + padX * 2;
  const h = t.height + padY * 2;
  const tail = 22;
  const bodyTop = -(tail + h); // 本体上端（尻尾の先端 y=0 から上へ）

  const g = new Graphics();
  // 本体（角丸）＋下中央の尻尾を一筆で塗り、まとめて枠線を引く。
  g.roundRect(-w / 2, bodyTop, w, h, 16);
  g.moveTo(-tail, -tail).lineTo(0, 0).lineTo(tail, -tail).closePath();
  g.fill(COLOR.paper).stroke({ width: STROKE.base, color: COLOR.ink });

  t.position.set(0, bodyTop + h / 2);
  c.addChild(g, t);
  return c;
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

  const engine = Engine.create();
  engine.gravity.y = 1.4;

  // 壁・床の静的ボディ。内面を画面端（端+1px）に置き、本体は画面外へはみ出させる＝見えない。
  // 箱を画面内に閉じ込めるためだけの境界（描画はしない）。
  const leftWall = Bodies.rectangle(EDGE - WALL_THICK / 2, DESIGN_H / 2, WALL_THICK, DESIGN_H * 2, {
    isStatic: true,
  });
  const rightWall = Bodies.rectangle(
    DESIGN_W - EDGE + WALL_THICK / 2,
    DESIGN_H / 2,
    WALL_THICK,
    DESIGN_H * 2,
    { isStatic: true },
  );
  const floor = Bodies.rectangle(
    DESIGN_W / 2,
    DESIGN_H - EDGE + WALL_THICK / 2,
    DESIGN_W * 2,
    WALL_THICK,
    { isStatic: true },
  );
  Composite.add(engine.world, [leftWall, rightWall, floor]);

  const boxes: BoxEntity[] = [];

  // ホバー状態と、現在表示中の吹き出し。
  let hovered: BoxEntity | null = null;
  let bubble: Container | null = null;

  const hideBubble = () => {
    if (bubble) {
      bubble.destroy({ children: true });
      bubble = null;
    }
    hovered = null;
  };

  const showBubble = (entity: BoxEntity) => {
    if (bubble) bubble.destroy({ children: true });
    hovered = entity;
    bubble = buildBubble(entity.text);
    overlay.addChild(bubble);
  };

  let spawnCount = 0;
  const spawnBox = () => {
    // データ件数ぶんだけ落とす。生成 i 番目の箱 = texts[i]（1:1）。
    if (spawnCount >= texts.length) return;
    const size = rand(BOX_MIN, BOX_MAX);
    const text = texts[spawnCount++];
    // 上中央から。横位置と回転を少しばらつかせて自然に積ませる。
    const x = DESIGN_W / 2 + rand(-120, 120);
    const y = -size;

    const body = Bodies.rectangle(x, y, size, size, {
      restitution: 0.15,
      friction: 0.5,
      angle: rand(-0.3, 0.3),
    });
    Body.setVelocity(body, { x: rand(-2, 2), y: 0 });
    Body.setAngularVelocity(body, rand(-0.08, 0.08));
    Composite.add(engine.world, body);

    const sprite = new Container();
    sprite.addChild(wireRect(-size / 2, -size / 2, size, size, { radius: 12, fillPaper: true }));
    // ホバー検知（クリックではないので cursor は既定のまま）。
    sprite.eventMode = "static";
    sprite.hitArea = new Rectangle(-size / 2, -size / 2, size, size);
    view.addChild(sprite);

    const entity: BoxEntity = { body, sprite, size, text };
    sprite.on("pointerover", () => showBubble(entity));
    sprite.on("pointerout", () => {
      if (hovered === entity) hideBubble();
    });

    boxes.push(entity);

    // 上限を超えたら最古を物理・描画ともに撤去する。
    if (boxes.length > MAX_BOXES) {
      const oldest = boxes.shift();
      if (oldest) {
        if (hovered === oldest) hideBubble();
        Composite.remove(engine.world, oldest.body);
        oldest.sprite.destroy({ children: true });
      }
    }
  };

  // このシーン特有の音（グルーヴ）の拍に同期して 1 拍 1 箱。
  const unsubBeat = seq.onBeat(() => spawnBox());

  // 物理を固定ステップで進め、各箱のスプライトをボディに同期する。
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const frame = () => {
    const now = performance.now();
    acc += now - last;
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
    // 吹き出しはホバー中の箱の上に追従させる（箱が微動しても付いていく）。
    if (bubble && hovered) {
      const halfW = bubble.width / 2 + 20;
      const x = Math.min(DESIGN_W - halfW, Math.max(halfW, hovered.body.position.x));
      bubble.position.set(x, hovered.body.position.y - hovered.size / 2);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    view,
    overlay,
    dispose: () => {
      unsubBeat();
      if (raf) cancelAnimationFrame(raf);
      hideBubble();
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}
