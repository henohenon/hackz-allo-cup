import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import { PixelateFilter } from 'pixi-filters'

// ピクセル化の粗さ (大きいほどカクカク = 3DS 風)
const PIXEL_SIZE = 5

function App() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const app = new Application()
    let disposed = false
    let ready = false

    const setup = async () => {
      await app.init({
        background: '#1a1530',
        resizeTo: window,
        antialias: false,
      })
      // StrictMode の二重実行などで init 完了前にアンマウントされた場合の後始末
      if (disposed) {
        app.destroy(true)
        return
      }
      ready = true
      hostRef.current?.appendChild(app.canvas)

      const cx = app.screen.width / 2
      const cy = app.screen.height / 2

      const scene = new Container()
      app.stage.addChild(scene)

      // サンプル: パネル
      const panel = new Graphics()
      panel.roundRect(-220, -150, 440, 300, 28).fill(0x4044ff)
      panel.roundRect(-220, -150, 440, 300, 28).stroke({ width: 8, color: 0x9aa0ff })
      panel.x = cx
      panel.y = cy - 40
      scene.addChild(panel)

      // サンプル: 回転する菱形 (動きでピクセル化の見え方を確認)
      const gem = new Graphics()
      gem.poly([0, -40, 40, 0, 0, 40, -40, 0]).fill(0xffd23f)
      gem.x = cx
      gem.y = cy - 120
      scene.addChild(gem)

      const title = new Text({
        text: 'コトハコビ',
        style: { fill: 0xffffff, fontSize: 88, fontWeight: 'bold', fontFamily: 'sans-serif' },
      })
      title.anchor.set(0.5)
      title.x = cx
      title.y = cy - 40
      scene.addChild(title)

      const sub = new Text({
        text: 'PRESS START',
        style: { fill: 0xc7ccff, fontSize: 34, fontWeight: 'bold' },
      })
      sub.anchor.set(0.5)
      sub.x = cx
      sub.y = cy + 130
      scene.addChild(sub)

      // ポストプロセス: ステージ全体をピクセル化
      app.stage.filters = [new PixelateFilter(PIXEL_SIZE)]

      // 点滅と回転のアニメーション
      app.ticker.add((ticker) => {
        gem.rotation += 0.02 * ticker.deltaTime
        sub.alpha = 0.5 + 0.5 * Math.abs(Math.sin(ticker.lastTime / 400))
      })
    }

    setup()

    return () => {
      disposed = true
      // init 完了済みのときだけ破棄する (init 中の破棄は ResizePlugin で落ちる)
      if (ready) {
        app.destroy(true, { children: true })
      }
    }
  }, [])

  return <div ref={hostRef} className="pixi-host" />
}

export default App
