# allo-app

「ハックツハッカソン アロカップ」のアプリ本体（Electron + React + PixiJS）。
プロジェクト全体の概要・技術スタック・環境構築は [ルート README](../README.md) を参照。

## ドキュメント

- [docs/communication-design.md](docs/communication-design.md) — 通信・連携の仕様（BLE すれ違いタイピング）
- [docs/charcode-codec.md](docs/charcode-codec.md) — 文字コードコーデックの設計（思想・判断の根拠）
- [docs/communication-log.md](docs/communication-log.md) — 通信まわりの決定ログ（経緯・没案）

## 開発コマンド（Vite+ / `vp`）

```zsh
vp install   # 依存インストール
vp dev       # 開発サーバー + Electron 起動
vp check     # format / lint / 型チェック
vp test      # テスト（Vitest）
```

- コーデック変換の確認デモは開発サーバーで `?demo` を付けて開く（`src/main.tsx`）。
- エージェント向けの作業ルールは [AGENTS.md](AGENTS.md)（= [CLAUDE.md](CLAUDE.md)）を参照。
