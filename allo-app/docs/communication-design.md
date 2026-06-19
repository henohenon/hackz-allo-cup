# 通信・連携 仕様（BLE すれ違いタイピング）

実装に必要な仕様。文字コードの内部仕様は [charcode-codec.md](./charcode-codec.md)、
macOS の BLE 制約の経緯は [\_archive/docs](../../_archive/docs/) を参照。

## 概要

同じアプリを持つ端末同士が、BLE 広告ブロードキャストで文字をやり取りする。
送信側は「いま打った最新の 1 文字」を撒き続け、受信側は拾って `seq` 順に並べる。
接続しない撃ちっぱ通信なので**ロスあり** ＝ 途中から受信すれば途中からしか見えない、
リアルタイムなライブ・タイピング。送信と受信は**排他**（1 台が同時に両方はしない）。

## 構成

```
[Renderer]  React / PixiJS        UI・ソフトキーボード・表示
    │   window.allo  (IPC: invoke=要求 / on=push)
[Utility]   Electron main / Node   状態機械 + codec + BLE(bleno/noble)
    │   BLE 広告ブロードキャスト（ロスあり・順不同）
[別の ALLO 端末]
```

codec・seq 採番・BLE はすべて Utility 側に閉じる。Renderer は文字と状態だけを扱う。

## パケット（16 バイト = Service UUID 1 個）

広告の Service UUID(128bit) に 1 文字を載せる。
macOS の広告に載せられるのは Local Name と Service UUID のみ（Manufacturer Data 不可）。

```
[0..3]   sessionId  4B   送信セッション識別。codec の seed も兼ねる(MVP)
[4..5]   seq        2B   文字位置 (big-endian)。受信側の並べ替えキー
[6..15]  body      10B   その 1 文字のコード (codec)
```

Local Name は `"ALLO"` 固定。受信側は `localName === "ALLO"` の広告だけ拾う。

## 送信（最新文字ビーコン）

1. 送信開始で `sessionId = crypto.randomBytes(4)` を生成、`seq = 0`。
2. 1 文字打つごとに `seq++` → `body = encode(char)` → パケットを広告に設定する。
   OS が同じ広告を反復するので、その文字は「最新」の間ずっと撒かれる。
3. 次の文字でパケットが差し替わる（latest-wins）。**古い文字は再送しない。**
4. 無入力が一定時間続いたら広告停止（タイムアウト）。

巡回送信は不要。常に「最新の 1 パケット」を広告し続けるだけ。

## 受信

1. スキャンして `localName === "ALLO"` の広告を拾う。
2. unpack → `sessionId` ごとにバッファし、`seq` の位置へ文字を置く。
3. `body` を decode（seed は受信した `sessionId`）して文字に戻す。
4. 拾うたびに連結結果を Renderer へ push する。欠けた `seq` は穴のまま。

全文の到達は保証しない（設計どおりのロス）。

## IPC 契約（`window.allo`）

```ts
type AlloMode = "idle" | "sending" | "receiving";

interface Allo {
  // モード遷移（単一状態・排他）。'sending' で新 sessionId 開始、'idle' で停止
  changeState(mode: AlloMode): Promise<Result>;

  // 打鍵ごとに最新の 1 文字を渡す（sending 中）。seq 採番・ビーコン・タイムアウトは Utility
  sendChar(char: string): Promise<Result>;

  // 状態の取得と購読
  getState(): Promise<{ bt: BleState; mode: AlloMode }>;
  onState(cb: (s: { bt: BleState; mode: AlloMode }) => void): () => void;

  // 受信メッセージ（連結スナップショット）の購読
  onMessage(cb: (m: { sessionId: string; text: string }) => void): () => void;
}
```

- Renderer は sessionId / seq / UUID / codec を知らない。文字と状態だけ。
- 受信の再結合の真実は Utility が持ち、Renderer は push を表示するだけ。
- 送信中の全文表示は Renderer が自前のテキスト欄で保持する（Utility は最新 1 文字のみ）。

## 制約・前提

- **送信/受信は排他**: macOS での広告+受信の同時動作が未検証のため分離する（同時化は実機確認後）。
- **BT 状態ゲート**: TCC 権限が下りないと BLE が動かない。`onState` の `bt` を監視して UI でガードする。
- **seed = sessionId のみ (MVP)**: 平文なので秘匿性なし。事前共有鍵 / BT アドレス混ぜは拡張（要実機検証）。
- **編集は放送に反映しない**: 最新文字を前進で撒くだけ。バックスペースは送信ストリームに乗せない（MVP）。

## スコープ外

演出（解読アニメ等）、受信の永続化、メッセージ完了の厳密判定、送受信の同時化、秘匿化。
