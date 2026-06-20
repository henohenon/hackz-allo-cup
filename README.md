# ハックツハッカソン アロカップ

![TITLE](docs/kotohakobi.webp)

## 概要

- インターネット接続を必要としないメッセージ交換アプリ
- Bluetoothを使ったローカル通信
- アソビ心

技術スタック: Electron / React / PixiJS / Node.js（BLE）。開発環境は [Vite+](https://viteplus.dev/) + [pnpm](https://pnpm.io/ja/)。

## 環境構築

### 事前準備

以下のツールの事前導入が必要です（macOS）。

```zsh
# Node.js
brew install node

# pnpm
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Vite+
curl -fsSL https://vite.plus | bash
```

### 起動

```zsh
cd allo-app/
vp install   # パッケージインストール
vp dev       # 開発サーバー起動（Electronアプリも起動）
```

---

## チーム 「ガらパごスらぼ」

- @henohenon
- @kurazuuuuuu

> [!NOTE]
> Doorkeeperにてイベント情報が確認可能です。<br>
> https://hackz-community.doorkeeper.jp/events/196580
