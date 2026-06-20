import { useEffect, useRef } from "react";
import { Application, Container } from "pixi.js";
import { COLOR, DESIGN_H, DESIGN_W, loadFont } from "./ui/theme";
import { createSceneManager } from "./ui/scenes/SceneManager";
import { getSequence } from "./audio/sequence";
import "./App.css";

function App() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    let disposed = false;
    let ready = false;
    let observer: ResizeObserver | undefined;
    let scenes: ReturnType<typeof createSceneManager> | undefined;

    // アプリ共有のシーケンスを起動時に一度だけ開始する。
    // シーン遷移では止めない（クロックを保持してタイミングのズレを防ぐ）。
    void getSequence().start();

    const setup = async () => {
      // フォント読み込みを待ってから Text を生成する（M PLUS 1p）
      await loadFont();

      await app.init({
        // 地色は白（画面の地）。ウィンドウは setAspectRatio で 5:3 固定だが、
        // タイトルバー分だけコンテンツ領域が 5:3 から僅かに横長になる。
        // その差分（左右の余白）を白で埋めて不可視化する。
        background: COLOR.paper,
        // 初期サイズはホスト（= ウィンドウ内容領域）の実測値。
        // 確定後のズレは下の ResizeObserver が補正する。
        width: host.clientWidth || window.innerWidth,
        height: host.clientHeight || window.innerHeight,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        antialias: true,
      });
      // StrictMode の二重実行などで init 完了前にアンマウントされた場合の後始末
      if (disposed) {
        app.destroy(true);
        return;
      }
      ready = true;
      app.canvas.tabIndex = 0;
      host.appendChild(app.canvas);

      // ルート: デザイン解像度(5:3)の論理座標で UI を組み、ウィンドウに合わせて拡縮する
      const root = new Container();
      app.stage.addChild(root);

      // シーン管理（遷移・トランジション・初期化）を root 配下にマウントする。
      // overlay も root の子になるので fit() のスケールに自動追従する。
      scenes = createSceneManager(app);
      root.addChild(scenes.view);

      await scenes.start("title");
      // start 後の await 中にアンマウントされた場合の後始末
      if (disposed) {
        scenes.destroy();
        app.destroy(true, { children: true });
        return;
      }

      // 5:3 を保ったままウィンドウにフィット（レターボックス・中央寄せ）
      const fit = () => {
        const { width, height } = app.screen;
        const scale = Math.min(width / DESIGN_W, height / DESIGN_H);
        root.scale.set(scale);
        root.x = Math.round((width - DESIGN_W * scale) / 2);
        root.y = Math.round((height - DESIGN_H * scale) / 2);
      };

      // ホスト（= ウィンドウ内容領域）の実サイズに追従してレンダラーを採寸する。
      // Electron の setAspectRatio によるサイズ確定が init より遅れても、
      // ResizeObserver が確定後に発火して初期表示のズレ（左右の余白）を解消する。
      observer = new ResizeObserver((entries) => {
        if (disposed) return;
        const { width, height } = entries[0].contentRect;
        if (width === 0 || height === 0) return;
        app.renderer.resize(width, height);
        fit();
      });
      observer.observe(host);
      fit();
    };

    void setup();

    return () => {
      disposed = true;
      observer?.disconnect();
      // 先に現シーンを dispose（タイトルのホバー RAF cancel 等）してから破棄する。
      scenes?.destroy();
      // init 完了済みのときだけ破棄する (init 中の破棄は ResizePlugin で落ちる)
      if (ready) {
        app.destroy(true, { children: true });
      }
    };
  }, []);

  return <div ref={hostRef} className="pixi-host" />;
}

export default App;
