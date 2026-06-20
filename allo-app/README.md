# allo-app

「ハックツハッカソン アロカップ」のアプリ本体（Electron + React + PixiJS）。
プロジェクト全体の概要・技術スタック・環境構築は [ルート README](../README.md) を参照。

## 開発コマンド（Vite+ / `vp`）

```zsh
vp install   # 依存インストール
vp dev       # 開発サーバー + Electron 起動
vp check     # format / lint / 型チェック
vp test      # テスト（Vitest）
```

- コーデック変換の確認デモは開発サーバーで `?demo` を付けて開く（`src/main.tsx`）。
- エージェント向けの作業ルールは [AGENTS.md](AGENTS.md)（= [CLAUDE.md](CLAUDE.md)）を参照。
