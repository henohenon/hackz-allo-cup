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

BLE・seq 採番・ビーコン制御は Utility 側で、**encode/decode は Renderer 側**（codec を Renderer が持つ）。
送信は Renderer が encode した生 10B を Utility が撒き、受信は Utility が拾った生 10B を 1 文字分ずつ Renderer へ流す。
**再結合**（seq 並べ替え・連結・歯抜け）も Renderer 側。codec は送受で使う共有 pure-JS モジュール。

## パケット（16 バイト = Service UUID 1 個）

広告の Service UUID(128bit) に 1 文字を載せる。
macOS の広告に載せられるのは Local Name と Service UUID のみ（Manufacturer Data 不可）。

```
[0..3]   sessionId  4B   送信セッション識別。codec の seed も兼ねる(MVP)
[4..5]   seq        2B   文字順 (big-endian)。受信側の並べ替えキー
[6..15]  body      10B   その 1 文字のコード (codec)
```

Local Name は `"ALLO"` 固定。受信側は `localName === "ALLO"` の広告だけ拾う。

## 送信（最新文字ビーコン）

1. 送信開始（`changeState('sending')`）で Utility が `sessionId = crypto.randomBytes(4)` を生成、`seq = 0`。
   この **sessionId を Renderer へ返す**（Renderer が encode 用テーブルの seed に使う）。
2. Renderer が 1 文字を `body = encode(char)`（seed = 受け取った sessionId）して `sendChar(body)`。
   Utility は `seq++` → `{ sessionId, seq, body }` を UUID に pack → 広告に設定する。
   OS が同じ広告を反復するので、その文字は「最新」の間ずっと撒かれる。
3. 次の文字でパケットが差し替わる（latest-wins）。**古い文字は再送しない。**
4. 無入力が一定時間続いたら広告停止（タイムアウト）。

巡回送信は不要。常に「最新の 1 パケット」を広告し続けるだけ。
ただし latest-wins は打鍵が速いほど 1 文字の滞空が短くロスしやすい。
**各文字に最低発信時間を保証する責務を Utility の送信スケジューラに持たせる**（方式・T は未決・要実機検証。懸念事項を参照）。

## 受信

Utility は拾った生データを 1 文字分ずつ流すだけ。decode・重複除去・並べ替え・連結・歯抜けの扱い・
session ごとの管理は Renderer 側で行う。

1. スキャンして `localName === "ALLO"` の広告を拾う。
2. unpack して `{ sessionId, seq, body }` を `onChar` で Renderer へ push する。
3. Renderer が `body`(10B) を decode（seed = 受信した `sessionId`）して文字に戻し、`seq` 位置へ置く。

最新文字ビーコンは OS が同じ広告を反復するため、`onChar` は**同じ `{ sessionId, seq }` を繰り返し発火する**。
Renderer は `sessionId + seq` で**重複除去**してから `seq` 位置へ置く（同位置は上書きで冪等）。

全文の到達は保証しない（設計どおりのロス）。decode 失敗（破損コード）・歯抜け・末尾欠落の見せ方は Renderer の裁量。

## IPC 契約（`window.allo`）

```ts
type AlloMode = "idle" | "sending" | "receiving";

// 操作の成否。Utility 側の BleResult と同形で統一する
type Result = { ok: boolean; error?: string };

// アプリ状態。sessionId は 'sending' のとき Renderer が encode の seed に使う（それ以外は undefined）
// bt は electron/ble/types.ts の BleState を再利用
type AlloState = { bt: BleState; mode: AlloMode; sessionId?: string };

interface Allo {
  // モード遷移（単一状態・排他）。'sending' で新 sessionId 開始(送信)、'receiving' でスキャン開始(受信)、'idle' で停止。
  // 'sending' 遷移時は新 sessionId を返す（Renderer の encode seed 用）
  changeState(mode: AlloMode): Promise<Result & { sessionId?: string }>;

  // 打鍵ごとに最新の 1 文字を「encode 済みの生 10B(body)」で渡す。mode !== 'sending' のとき Utility が弾く (Result.ok=false)。
  // encode は Renderer（seed = changeState で得た sessionId）。seq 採番・ビーコン・タイムアウト・最低発信時間は Utility
  sendChar(body: Uint8Array): Promise<Result>;

  // 状態の取得と購読
  getState(): Promise<AlloState>;
  onState(cb: (s: AlloState) => void): () => void;

  // 受信した 1 文字分の生データの購読（decode・再結合は Renderer 側）
  onChar(cb: (c: { sessionId: string; seq: number; body: Uint8Array }) => void): () => void;
}
```

- Utility は BLE と seq 採番・ビーコン・最低発信時間の制御だけ。送受とも生 10B を運ぶ純粋な転送で、**encode/decode・再結合**（seq 並べ替え・連結・歯抜け・複数 session 管理）は Renderer 側。
- codec は送受信で使う**共有 pure-JS モジュール**（native 依存なし）。Renderer が encode/decode の両方に使う。UUID の組立/分解は Utility 内。
- Renderer は `sessionId` / `seq` / 生 `body` を受け取る。送信時は `changeState('sending')` で得た sessionId を encode の seed にする。
- 送信中の全文表示は Renderer が自前のテキスト欄で保持する（Utility は最新 1 文字のみ）。
- 演出用・その他の API（例: 生 10 バイト付きの char、送信進捗）は**必要になった時点で追加**する。境界は薄く保ち、フロント駆動で拡張する。

## 制約・前提

- **送信/受信は排他**: macOS での広告+受信の同時動作が未検証のため分離する（同時化は実機確認後）。
- **BT 状態ゲート**: TCC 権限が下りないと BLE が動かない。`onState` の `bt` を監視して UI でガードする。
- **seed = sessionId のみ (MVP)**: 平文なので秘匿性なし。事前共有鍵 / BT アドレス混ぜは拡張（要実機検証）。
- **編集は放送に反映しない**: 最新文字を前進で撒くだけ。バックスペースは送信ストリームに乗せない（MVP）。

## 懸念事項（未検証・要注意）

- **同時送受信の可否**: advertise+scan の同時動作は未検証。現状はモード分離で回避。同時化するなら実機確認が必要。
- **ロスの偏り**: 打鍵が速い／受信開始が遅いほど取りこぼしが増える。**末尾文字の欠落は受信側から検出できない**。
- **sessionId 衝突**: 4 バイト乱数。稀だが 2 送信者が同一 ID を引くとストリームが混ざる。
- **BT アドレス seed 拡張**: macOS は MAC を隠すため、送信者の値と受信者が見る値が不一致になる恐れ。採用前に実機で `peripheral.id`/`address` を確認。
- **poweredOn 待ちにタイムアウト無し**（既存実装・issue #3）。
- **seq 上限 2B**: seq 0..65535 = 1 セッション最大 65,536 文字。MVP では非現実的な長さだが、到達時の挙動（巻き戻し / 新 session）は未定義。要考慮。
- **encode/decode が Renderer 側**: 将来 APP_SECRET 等で秘匿化するなら鍵が DOM に出る。その時は encode/decode を両方 Utility へ戻す。
- **最低発信時間の方式が未決**: 各文字に最低発信時間 T を保証する責務は Utility の送信スケジューラに持たせるが、打鍵が T より速い時の方針（最新優先＋最低滞空で間引く / キューで全文字保証）と T の値は未決。要実機検証。

## スコープ外

演出（解読アニメ等）、受信の永続化、メッセージ完了の厳密判定、送受信の同時化、秘匿化。
