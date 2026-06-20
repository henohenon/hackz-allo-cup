// タイトル画面のワイヤーフレームを組み立てる。
// 外枠 / 工場（背景・横幅いっぱい）/ 中央上のロゴ / 下部の 3 ボタン。
// ボタンは押下で対応シーンへ遷移する（遷移自体は SceneManager が担う）。

import { Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import logoSvgRaw from "../assets/kotohakobi.svg?raw";
import factorySvgRaw from "../assets/factory.svg?raw";
import { COLOR, DESIGN_H, DESIGN_W, FONT_FAMILY, STROKE } from "./theme";
import { label } from "./wireframe";
import type { Scene, SceneBuilder, SceneKey } from "./scenes/types";
import { getSequence } from "../audio/sequence";

// ロゴの表示幅（フレーム幅の約 43%）
const LOGO_W = 820;

/** タイトル画面を構築する。SVG の読み込みがあるため非同期。 */
export const buildTitleScreen: SceneBuilder = async (ctx): Promise<Scene> => {
  const view = new Container();

  // ※ 画面の地（白）はアプリ背景（App.tsx の background=paper）が担う。

  // 工場（背景）: SVG 内に地平線まで含まれているので、横幅いっぱいにそのまま表示する。
  const factory = new Sprite(await loadSvgTexture(factorySvgRaw));
  factory.scale.set(DESIGN_W / factory.texture.width);
  factory.x = 0;
  factory.y = 0;
  view.addChild(factory);

  // 地平線を転がるひらがな（砂漠のタンブルウィード風）。共有クロックに同期。
  const tumble = buildTumbleweed(getSequence());
  view.addChild(tumble.view);

  // ロゴ（中央上寄り）— 4/4 ビートに合わせてゆらゆら＋拡大縮小。
  const logo = new Sprite(await loadSvgTexture(logoSvgRaw));
  logo.anchor.set(0.5);
  const logoX = DESIGN_W / 2;
  const logoY = 300;
  const logoBaseScale = LOGO_W / logo.texture.width;
  logo.scale.set(logoBaseScale);
  logo.x = logoX;
  logo.y = logoY;
  view.addChild(logo);

  const seq = getSequence();
  let logoRaf = 0;
  const animateLogo = () => {
    const t = seq.phase(4) * Math.PI * 2;
    const sway = Math.sin(t);
    const breath = Math.sin(t + Math.PI / 3);
    logo.x = logoX + sway * 10;
    logo.y = logoY + Math.sin(t + 0.6) * 6;
    logo.rotation = sway * 0.04;
    logo.scale.set(logoBaseScale * (1 + 0.06 * breath));
    logoRaf = requestAnimationFrame(animateLogo);
  };
  logoRaf = requestAnimationFrame(animateLogo);

  // 下部: シーン選択ボタン（左から「送る」「受け取る」「荷物一覧」）
  // サイズは従来比およそ 0.9 倍にコンパクト化。
  const labels = ["送る", "受け取る", "荷物一覧"];
  const targets: SceneKey[] = ["advertise", "scanning", "list"];
  const btnW = 350;
  const btnH = 125;
  const gap = 150;
  const totalW = btnW * labels.length + gap * (labels.length - 1);
  const startX = (DESIGN_W - totalW) / 2;
  const btnY = 900;

  // 各ボタンの後始末（ホバー RAF の cancel）を集約して dispose で呼ぶ。
  const disposers: Array<() => void> = [];
  labels.forEach((text, i) => {
    const btn = buildButton(text, startX + i * (btnW + gap), btnY, btnW, btnH, () =>
      ctx.goTo(targets[i]),
    );
    view.addChild(btn.view);
    disposers.push(btn.dispose);
  });

  return {
    view,
    dispose: () => {
      if (logoRaf) cancelAnimationFrame(logoRaf);
      tumble.dispose();
      disposers.forEach((d) => d());
    },
  };
};

// 地平線 y（factory.svg の viewBox=デザイン解像度なので等倍。M-2000,812... の 812）。
const HORIZON_Y = 823;
// ひらがな五十音（基本 46 字）。ここから 1 文字ずつ拾う。
const GOJUON = "へのへのもへじいろはにほへと";
const TUMBLE_SIZE = 50; // 文字サイズ
const TUMBLE_RADIUS = TUMBLE_SIZE * 0.46; // 転がり半径の目安（着地高さ）
const TUMBLE_STEP = 150; // 1 拍で右へ進む距離
const TUMBLE_ROLL = TUMBLE_STEP / TUMBLE_RADIUS; // 転がり角 = 距離 / 半径
const TUMBLE_BOUNCE = 22; // ホップの高さ
const TUMBLE_START_X = -TUMBLE_SIZE; // 左の画面外スタート
// 工場の左壁。ここで工場に入って消える。
const TUMBLE_ENTER_X = 1550;
// 入口手前でフェードアウトを始める距離（工場に吸い込まれる感じ）。
const TUMBLE_FADE_DIST = 50;

const pickKana = () => GOJUON[Math.floor(Math.random() * GOJUON.length)];
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/**
 * 地平線上を 1 拍ごとに右へ転がるひらがな（タンブルウィード風）。
 * 1 拍で 1 ステップ（少し跳ねつつ回転して右へ）。右へ抜けたら左外から
 * ランダムな別の 1 文字で再登場する（瞬間移動は画面外なので見えない）。
 */
function buildTumbleweed(seq: ReturnType<typeof getSequence>): ButtonHandle {
  const glyph = new Text({
    text: pickKana(),
    style: { fill: COLOR.ink, fontSize: TUMBLE_SIZE, fontFamily: FONT_FAMILY, fontWeight: "500" },
  });
  glyph.anchor.set(0.5);
  glyph.x = TUMBLE_START_X;
  glyph.y = HORIZON_Y - TUMBLE_RADIUS;

  // 1 拍ごとのホップ（from→to を rAF で補間）。
  let fromX = TUMBLE_START_X;
  let toX = TUMBLE_START_X;
  let fromRot = 0;
  let toRot = 0;
  let hopT0 = -Infinity;
  const unsubBeat = seq.onBeat(() => {
    if (toX >= TUMBLE_ENTER_X) {
      // 工場へ入って消えたので、左外から新しい文字で再登場する。
      glyph.text = pickKana();
      fromX = TUMBLE_START_X;
      fromRot = 0;
      toX = TUMBLE_START_X + TUMBLE_STEP;
      toRot = TUMBLE_ROLL;
    } else {
      fromX = toX;
      fromRot = toRot;
      toX = toX + TUMBLE_STEP;
      toRot = toRot + TUMBLE_ROLL;
    }
    hopT0 = performance.now();
  });

  const beatMs = (60 / 110) * 1000;
  const hopMs = beatMs * 0.9; // 残りは着地の余韻
  let raf = 0;
  const frame = () => {
    if (glyph.destroyed) return;
    const p = Math.min(1, Math.max(0, (performance.now() - hopT0) / hopMs));
    const e = easeOutCubic(p);
    glyph.x = fromX + (toX - fromX) * e;
    glyph.rotation = fromRot + (toRot - fromRot) * e;
    glyph.y = HORIZON_Y - TUMBLE_RADIUS - Math.sin(Math.PI * p) * TUMBLE_BOUNCE;
    // 工場入口に近づくほどフェードして「工場に入って消える」。
    glyph.alpha = Math.min(1, Math.max(0, (TUMBLE_ENTER_X - glyph.x) / TUMBLE_FADE_DIST));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    view: glyph,
    dispose: () => {
      unsubBeat();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

// 蓋を開ききったときの回転角（水平=0、90°で真上、それ以上で外側へ開く）
const LID_OPEN_ANGLE = (120 * Math.PI) / 180;
// 蓋の開閉スピード（1 秒あたりの開度。約 0.2 秒で開閉）
const LID_SPEED = 5;

interface ButtonHandle {
  view: Container;
  /** ホバーアニメの RAF を確実に停止する。 */
  dispose: () => void;
}

/**
 * ラベル付きのワイヤーフレームボタン（= 段ボール箱）。
 * 本体は左・下・右の 3 辺。上辺は左右 2 枚の蓋として描き、
 * ホバー中はコーナーを軸に外側へ広がって開く（離すと閉じる）。
 * 押下で onTap を呼ぶ。
 */
function buildButton(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  onTap: () => void,
): ButtonHandle {
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
    // シーン破棄後に未完了 RAF が呼ばれても落ちないようガードする。
    if (lid.destroyed) return;
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
  c.on("pointertap", () => onTap());

  return {
    view: c,
    dispose: () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}

/**
 * SVG 文字列をテクスチャとして読み込む。
 * SVG が width/height="100%" で intrinsic サイズが定まらないため、
 * viewBox の寸法を採寸サイズに使ってから Blob 経由で Image にデコードする。
 * タイトルへ戻るたびに再デコードしないよう、生 SVG 文字列をキーにメモ化する。
 */
const textureCache = new Map<string, Promise<Texture>>();

function loadSvgTexture(raw: string): Promise<Texture> {
  const cached = textureCache.get(raw);
  if (cached) return cached;
  const promise = decodeSvgTexture(raw);
  textureCache.set(raw, promise);
  return promise;
}

async function decodeSvgTexture(raw: string): Promise<Texture> {
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
