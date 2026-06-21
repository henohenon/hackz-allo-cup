import { app, BrowserWindow, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { registerBle, shutdownBle } from "./ble";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// 内部名は ASCII (userData パス等を packaged の productName と揃える)。
// 表示名「コトハコビ」は packaged の CFBundleDisplayName で出る。
app.setName("Kotohakobi");

let win: BrowserWindow | null;

// アプリアイコン (dev 含む)。本番ビルドは electron-builder が build/ のアイコンを差し込む。
// Windows は OS が角丸/余白を付けないためフルブリード版を使う。
const APP_ICON = path.join(
  process.env.VITE_PUBLIC ?? "",
  process.platform === "win32" ? "icon-win.png" : "icon.png",
);

// ウィンドウの固定縦横比（5:3 = 3DS 同等）
const ASPECT_RATIO = 5 / 3;

function createWindow() {
  win = new BrowserWindow({
    icon: APP_ICON,
    width: 900,
    height: 540,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // リサイズ時も 5:3 を保つようウィンドウ自体の縦横比を固定する
  win.setAspectRatio(ASPECT_RATIO);

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    void win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("before-quit", () => {
  void shutdownBle();
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

void app.whenReady().then(() => {
  // macOS の Dock アイコンを差し替える (dev では既定の Electron アイコンのため)
  if (process.platform === "darwin") {
    const dockIcon = nativeImage.createFromPath(APP_ICON);
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
  }
  registerBle();
  createWindow();
});
