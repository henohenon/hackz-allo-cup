# 通信・連携 決定ログ（経緯・判断の根拠）

[communication-design.md](./communication-design.md) は「何を作るか」の仕様。
こちらは「**なぜそうなったか**」の記録（没案・ちゃぶ台返し含む）。仕様の意図を後から辿るため。

## 1. 符号化方式：charcode-codec（10B/字）を採用

- 候補: ① 1B/字で 12 文字/パケット ② charcode-codec の 10B/字で 1 文字/パケット。
- 結論: **②**。難読化（seed 共有者だけ復号）を優先。1 文字 = 1 パケットが Service UUID
  (16B) の元設計と素直に噛み合う。
- 代償: N 文字メッセージ = N 広告。スループットは犠牲。

## 2. seed：BT アドレス案 → MVP は random sessionId のみ

- 当初狙い: 「同じアプリ同士だけ復号」を `BTアドレス ⊕ sessionId` で担保。受信側は電波層から
  BT アドレスを得られるので追加バイト無しで両端が同じ seed に到達する、という絵。
- 問題: macOS は MAC を隠す（`bleno.address` は 'unknown'、noble の `peripheral.id` はスキャン側
  ホスト依存で送受信不一致、`peripheral.address` は空）。→ seed がズレてデコード全滅の恐れ。
- 結論: **BT アドレス案は後回し（要実機検証）**。MVP は秘匿性を捨てて `sessionId` のみで疎通優先。

## 3. 送信方式：全文ループ → 最新文字ビーコン（ちゃぶ台返し）

- 一度は **A=全文ループ**（N 文字を巡回広告・各文字を数百 ms 滞空・周回）を採用。
  理由は「リトライは連射(B)より時間的に分散する方が、遭遇が短くても全文字を拾われる」。
- その後 **最新文字ビーコンへ変更**。理由: 実装が単純（巡回スケジューラ不要）・元々 1 文字ずつの
  思想だった・そっちが丸い。
- 結果: 古い文字を再送しない＝**ロスあり**。途中から受信すれば途中からしか見えない
  ライブ・タイピングになる（これは仕様として受け入れる）。

## 4. 同時送受信：分離（モード排他）

- macOS は noble+bleno 同一プロセスでの同時動作を一応サポートし、CoreBluetooth も
  central/peripheral を別個に持てる（コネクションレス広告のみなら既知制約も無関係）。
- だが**実機未検証**。リスク回避で MVP は **発信/受信モードを排他**にする。
  アーカイブの「A=発信機 / B=受信機」構成と一致して検証も楽。同時化は実機確認後。

## 5. IPC 設計の変遷（→ 5 つに収束）

- 初期は高レベル多 verb（send / startReceive / getMessages / getAlphabet …）を想定。
- 「理論上 sending と receiving が両方 ON になり得る」→ 状態を単一の state machine で持つべき
  という話に。`changeState` 案が出る。
- 一度 `changeState(mode, {text})` の **god-verb に過剰統合**して否決。
  → 教訓: **「状態モデル（単一）」と「コマンド API（操作別）」は別層**。排他は state machine が
  保証するので API を 1 verb にする必要はない。
- 送信ペイロードの形と命名で議論（`setOutgoing` 全文 / `sendMessage` 離散 / `outgoing` 命名）。
  「リアルタイム入力」は**受信側**の話で、送信は離散でよいと整理 → 最新文字ビーコン化に伴い
  **`sendChar`（1 文字ずつ）** に着地。
- 受信は `onMessage`（Utility が連結スナップショットを push）→ **`onChar`（生 10B を push・
  decode と再結合は Renderer）** に変更。境界を薄く保ち、decode・歯抜け・複数 session・表示は
  フロントの裁量へ。`char` でなく生 `body` を渡す理由: フロントが decode/演出 を担うため
  （受信した実データそのもの）。codec は送受で使う**共有 pure-JS モジュール**に。
  将来 APP_SECRET を入れて秘匿化するなら、鍵を Node に留めるため decode を Utility へ戻す。
- 結論: **`changeState` / `sendChar` / `getState` / `onState` / `onChar`** の 5 つ。
  send/receive が `sendChar`/`onChar` で対称。

## 6. 不要にした API

- `getAlphabet`: 文字セットは静的データ。共有モジュール import で真実源を 1 つにすれば IPC 不要。
- `getMessages`: 受信再結合が Renderer 側になり、store が保持するので取りに行く必要がない。

## 7. ドキュメント方針

- 仕様（design）は**実装に必要なことだけを論理順**に。経緯・没案・演出はこの log に分離。
- 図表は意味のある所だけ（システム構成・パケット・IPC インターフェース）。

## 関連

- マージ済み: PR #1（BLE セットアップ）/ #2（charcode-codec）
- low issue: #3（poweredOn タイムアウト）/ #4（ipcRenderer 素通し）/ #5（暗号強度 doc）/ #6（ALLO フィルタ）
- 仕様: [communication-design.md](./communication-design.md) / [charcode-codec.md](./charcode-codec.md)
