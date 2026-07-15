# ハックツハッカソン アロカップ

![TITLE](docs/kotohakobi.webp)

## 概要

- インターネット接続を必要としないメッセージ交換アプリ
- Bluetoothを使ったローカル通信
- アソビ心

## 詳細

### 技術スタック

#### アプリ

- [Electron](https://www.electronjs.org/ja/) (デスクトップ: 発信・受信)
  - [React](https://ja.react.dev/) (レンダラー側)
    - [PixiJS](https://pixijs.com/) (WebGLレンダラー)
  - [Node.js](https://nodejs.org/ja) (ユーティリティ側)
    - [stoprocent/bleno (fork)](https://github.com/stoprocent/bleno) (BLE発信側)
    - [stoprocent/noble (fork)](https://github.com/stoprocent/noble) (BLE受信側)
- [Capacitor](https://capacitorjs.com/) (Android: **受信専用**)
  - 同じ React + PixiJS フロントを WebView で表示
  - ネイティブ `HakoBle` プラグインが `window.ble` 互換のスキャナを提供

#### 開発環境

- [Vite+](https://viteplus.dev/)
- [pnpm](https://pnpm.io/ja/)

### 用語整理

- **レンダラー側**：ElectronのChromium / Capacitor WebView, React等の見える部分 (フロントエンド)
- **ユーティリティ側**：ElectronのNode.js等のデータ処理を行う部分 (バックエンド)。Android では BLE I/O のみネイティブプラグイン

## 環境構築

### 事前準備

以下のツールの事前導入が必要です。
- Node.js (npm)
- pnpm
- Vite+

#### 簡単インストール(for macOS)

```zsh
# Node.js
brew install node

# pnpm
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Vite+
curl -fsSL https://vite.plus | bash
```

#### (追加) PixiJS Skills
```zsh
# https://pixijs.com/llms
npx skills add https://github.com/pixijs/pixijs-skills
```

### アプリ構築 (Electron)

```zsh
# アプリディレクトリに移動
cd allo-app/

# パッケージインストール
vp install

# 開発サーバー起動 (Electronアプリも起動します)
vp dev

```

### Android (受信専用)

Android アプリは **受け取りのみ** です。「送る」ボタンは表示されません。発信は Electron 側の端末で行います。

#### 追加の事前準備

- [Android Studio](https://developer.android.com/studio)（SDK / 実機デバッグ）
- JDK 21（Capacitor 7 / Android Gradle Plugin 推奨）

#### ビルドと実機インストール

```zsh
cd allo-app/

# Web ビルド → android/ へ同期
vp run cap:sync

# Android Studio で開く（必ず allo-app/android を開く）
vp run android:open
```

Android Studio 側:

1. 初回は **File → Sync Project with Gradle Files** を待つ
2. 上部の Run Configuration で **app** を選ぶ（共有設定済み）
3. 実機/エミュレータを選んで ▶ Run
4. Gradle JDK は **jbr-21**（Android Studio 同梱）を使う

初回の「受け取る」で Bluetooth スキャン権限ダイアログが出ます。

#### 通し確認 (Electron 発信 × Android 受信)

1. PC で `vp dev`（または配布ビルド）し、タイトルから「送る」でメッセージを発信する
2. Android 実機でアプリを起動し、「受け取る」を開く（BT オン・権限許可）
3. 近くで発信中の端末があると、ベルトに荷物が到着し、荷物一覧へ蓄積される

LocalName `"HAKO"` の BLE 広告と、Service UUID に載せた 16 バイトペイロードを Android スキャナが拾い、既存の `pack.ts` / `scanningController` で復元します。

---

# その他情報

## チーム 「づらパごスらぼ」

### メンバー / Member

- @henohenon
- @kurazuuuuuu

---

> [!NOTE]
> Doorkeeperにてイベント情報が確認可能です。<br>
> https://hackz-community.doorkeeper.jp/events/196580

---
