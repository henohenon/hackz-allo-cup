// SVG -> 透明 PNG を Electron でレンダリングする使い捨てスクリプト。
//   pnpm exec electron scripts/render-icon.mjs <input.svg> <output.png> [size]
// qlmanage/sips は透明を白で潰すため、角丸の外側を透過させる用途で使う。
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

const [, , inSvg, outPng, sizeArg] = process.argv;
const size = Number(sizeArg) || 1024;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });

  const svg = fs.readFileSync(inSvg, "utf8");
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));

  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, img.toPNG());
  console.log(`wrote ${outPng} (${size}x${size})`);
  app.quit();
});
