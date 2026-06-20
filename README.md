# ハックツハッカソン アロカップ

## 概要

- インターネット接続を必要としないメッセージ交換アプリ
- Bluetoothを使ったローカル通信
- アソビ心

## 詳細

### 技術スタック

#### アプリ

- [Electron](https://www.electronjs.org/ja/) (メインフレームワーク)
  - [React](https://ja.react.dev/) (レンダラー側)
    - [PixiJS](https://pixijs.com/) (WebGLレンダラー)
  - [Node.js](https://nodejs.org/ja) (ユーティリティ側)
    - [stoprocent/bleno (fork)](https://github.com/stoprocent/bleno) (BLE発信側)
    - [stoprocent/noble (fork)](https://github.com/stoprocent/noble) (BLE受信側)

#### 開発環境

- [Vite+](https://viteplus.dev/)
- [pnpm](https://pnpm.io/ja/)

### 用語整理

- **レンダラー側**：ElectronのChromium, React等の見える部分 (フロントエンド)
- **ユーティリティ側**：ElectronのNode.js等のデータ処理を行う部分 (バックエンド)

#### レンダラー側 (フロントエンド ＋ 通信ロジック全般)

- UIを表示する
  - メイン画面比率：5:3 (3DSと同じ)
- 入力を処理する
  - 独自実装のソフトウェアキーボードで入力 (現状: ひらがな・全角カタカナ・全角数字・記号。全角アルファベット／制御コードは将来追加予定で現状未対応)
- 文字コードの生成・エンコード／デコード (codec) を行う
  - ひらがな・カタカナ・全角数字・記号(！？、。〜ー等, すべて全角で扱う)。制御コード(開始・終了)は保留
  - codec の seed 生成 (`BTアドレス⊕sessionID`・要検討) と自然乱数 (sessionID) もこちら
- ServiceUUIDs (16Byte) の組立／分解 (pack/unpack) を行う
- 送信スケジューラ: 最新文字ビーコン (latest-wins)・文字送り最低保証・1セッション最大50文字
- 受信の再結合: セッション管理・seq 並べ替え・重複除去・歯抜け表示
- メッセージの永続化 (localStorage)
- ユーティリティ (`window.ble`) を呼び出す
- レンダリング解像度を低くして3DSみたいにしたい

#### ユーティリティ側 (薄い BLE I/O・中身は解釈しない)

- Bluetooth関連のプロセスを管理する
  - BLE のステータス制御 (IDLE / ADVERTISE / SCANNING)
    - `LocalName: HAKO`
    - 1パケットにつき自由に動かせるのは16Byte (Service UUID 128bit)
    - パケット構造 (セッションID 4Byte / 文字順 seq 2Byte / 文字コード body 10Byte) は**レンダラー側の取り決め**
  - 発信: レンダラーから渡された生データ (ServiceUUIDs) をそのまま広告にセット (撒き直し機構のみ吸収)
  - 受信: `LocalName: HAKO` のパケットだけ拾い、生のまま全部レンダラーへ通知 (decode・重複除去はしない)

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

### アプリ構築

```zsh
# アプリディレクトリに移動
cd allo-app/

# パッケージインストール
vp install

# 開発サーバー起動 (Electronアプリも起動します)
vp dev

```

---

# その他情報

## チーム 「ガらパごスらぼ」

### メンバー / Member

- @henohenon
- @kurazuuuuuu

---

> [!NOTE]
> Doorkeeperにてイベント情報が確認可能です。<br>
> https://hackz-community.doorkeeper.jp/events/196580

---