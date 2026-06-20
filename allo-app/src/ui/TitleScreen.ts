// タイトル画面のワイヤーフレームを組み立てる。
// 外枠 / 工場（背景・横幅いっぱい）/ 中央上のロゴ / 下部の 2 ボタン。
// 入力・遷移ロジックは含まない（ベースデザインのみ）。

import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import logoSvgRaw from "../assets/kotohakobi.svg?raw";
import factorySvgRaw from "../assets/factory.svg?raw";
import { COLOR, DESIGN_H, DESIGN_W, STROKE } from "./theme";
import { label } from "./wireframe";

// ロゴの表示幅（フレーム幅の約 43%）
const LOGO_W = 820;

export interface Screen {
  view: Container;
}

/** タイトル画面を構築する。SVG の読み込みがあるため非同期。 */
export async function buildTitleScreen(): Promise<Screen> {
  const view = new Container();

  // ※ 画面の地（白）はアプリ背景（App.tsx の background=paper）が担う。

  // 工場（背景）: SVG 内に地平線まで含まれているので、横幅いっぱいにそのまま表示する。
  const factory = new Sprite(await loadSvgTexture(factorySvgRaw));
  factory.scale.set(DESIGN_W / factory.texture.width);
  factory.x = 0;
  factory.y = 0;
  view.addChild(factory);

  // ロゴ（中央上寄り）
  const logo = new Sprite(await loadSvgTexture(logoSvgRaw));
  logo.anchor.set(0.5);
  logo.scale.set(LOGO_W / logo.texture.width);
  logo.x = DESIGN_W / 2;
  logo.y = 300;
  view.addChild(logo);

  // 下部: シーン選択ボタン（左から「送る」「受け取る」「荷物一覧」）
  // サイズは従来比およそ 0.9 倍にコンパクト化。
  const labels = ["送る", "受け取る", "荷物一覧"];
  const btnW = 350;
  const btnH = 125;
  const gap = 150;
  const totalW = btnW * labels.length + gap * (labels.length - 1);
  const startX = (DESIGN_W - totalW) / 2;
  const btnY = 900;

  labels.forEach((text, i) => {
    view.addChild(buildButton(text, startX + i * (btnW + gap), btnY, btnW, btnH));
  });

  return { view };
}

// 蓋を開ききったときの回転角（水平=0、90°で真上、それ以上で外側へ開く）
const LID_OPEN_ANGLE = (120 * Math.PI) / 180;
// 蓋の開閉スピード（1 秒あたりの開度。約 0.2 秒で開閉）
const LID_SPEED = 5;

/**
 * ラベル付きのワイヤーフレームボタン（= 段ボール箱）。
 * 本体は左・下・右の 3 辺。上辺は左右 2 枚の蓋として描き、
 * ホバー中はコーナーを軸に外側へ広がって開く（離すと閉じる）。
 */
function buildButton(text: string, x: number, y: number, w: number, h: number): Container {
  const c = new Container();

  // 箱本体（左・下・右の 3 辺）。上辺は蓋として別に描く。
  const body = new Graphics();
  body
    .moveTo(x, y)
    .lineTo(x, y + h)
    .lineTo(x + w, y + h)
    .lineTo(x + w, y)
    .stroke({ width: STROKE.base, color: COLOR.ink });
  c.addChild(body);

  // 上蓋（左右 2 枚）。各蓋は幅の半分で、閉時は中央で合わさり水平な上辺になる。
  const half = w / 2;
  const lid = new Graphics();
  const drawLid = (open: number) => {
    const phi = open * LID_OPEN_ANGLE;
    const dx = half * Math.cos(phi);
    const dy = half * Math.sin(phi);
    lid
      .clear()
      .moveTo(x, y) // 左コーナーが蝶番
      .lineTo(x + dx, y - dy)
      .moveTo(x + w, y) // 右コーナーが蝶番
      .lineTo(x + w - dx, y - dy)
      .stroke({ width: STROKE.base, color: COLOR.ink });
  };
  drawLid(0);
  c.addChild(lid);

  c.addChild(
    label(text, x + w / 2, y + h / 2, {
      size: 50,
      anchorX: 0.5,
      anchorY: 0.5,
      weight: "600",
    }),
  );

  // ホバーで上蓋を開閉アニメーション。
  // （線のみの矩形は内部が当たり判定に入らないため hitArea を明示）
  c.eventMode = "static";
  c.cursor = "pointer";
  c.hitArea = new Rectangle(x, y, w, h);

  let open = 0;
  let target = 0;
  let raf = 0;
  let last = 0;
  const animate = (now: number) => {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (open < target) open = Math.min(target, open + LID_SPEED * dt);
    else open = Math.max(target, open - LID_SPEED * dt);
    drawLid(open);
    if (open !== target) {
      raf = requestAnimationFrame(animate);
    } else {
      raf = 0;
      last = 0;
    }
  };
  const startAnim = () => {
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(animate);
    }
  };
  c.on("pointerover", () => {
    target = 1;
    startAnim();
  });
  c.on("pointerout", () => {
    target = 0;
    startAnim();
  });

  return c;
}

/**
 * SVG 文字列をテクスチャとして読み込む。
 * SVG が width/height="100%" で intrinsic サイズが定まらないため、
 * viewBox の寸法を採寸サイズに使ってから Blob 経由で Image にデコードする。
 */
async function loadSvgTexture(raw: string): Promise<Texture> {
  const viewBox = raw.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const w = viewBox ? Number(viewBox[1]) : DESIGN_W;
  const h = viewBox ? Number(viewBox[2]) : DESIGN_H;
  const svg = raw.replace(/width="100%"\s+height="100%"/, `width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image(w, h);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("failed to load svg"));
      img.src = url;
    });
    return Texture.from(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
