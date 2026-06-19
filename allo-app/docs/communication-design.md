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

BLE・codec・送信時の seq 採番は Utility 側。受信の再結合（seq 並べ替え・連結・歯抜けの扱い）は
Renderer 側。Utility は decode 済みの文字を 1 文字ずつ流すだけの薄い層に保つ。

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

Utility は拾った文字を 1 文字ずつ流すだけ。並べ替え・連結・歯抜けの扱い・
session ごとの管理は Renderer 側で行う。

1. スキャンして `localName === "ALLO"` の広告を拾う。
2. unpack → `body` を decode（seed は受信した `sessionId`）して文字に戻す。
3. `{ sessionId, seq, char }` を `onChar` で Renderer へ push する。

全文の到達は保証しない（設計どおりのロス）。歯抜け・末尾欠落の見せ方は Renderer の裁量。

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

  // 受信した 1 文字の購読（再結合は Renderer 側）
  onChar(cb: (c: { sessionId: string; seq: number; char: string }) => void): () => void;
}
```

- Utility は BLE と codec だけの薄い層。受信の再結合（seq 並べ替え・連結・歯抜け・複数 session 管理）は Renderer 側。
- Renderer は `sessionId` / `seq` を受け取るが、UUID / codec の内部は知らない。
- 送信中の全文表示は Renderer が自前のテキスト欄で保持する（Utility は最新 1 文字のみ）。

## 制約・前提

- **送信/受信は排他**: macOS での広告+受信の同時動作が未検証のため分離する（同時化は実機確認後）。
- **BT 状態ゲート**: TCC 権限が下りないと BLE が動かない。`onState` の `bt` を監視して UI でガードする。
- **seed = sessionId のみ (MVP)**: 平文なので秘匿性なし。事前共有鍵 / BT アドレス混ぜは拡張（要実機検証）。
- **編集は放送に反映しない**: 最新文字を前進で撒くだけ。バックスペースは送信ストリームに乗せない（MVP）。

## スコープ外

演出（解読アニメ等）、受信の永続化、メッセージ完了の厳密判定、送受信の同時化、秘匿化。
