# 通信・連携 設計メモ（BLE すれ違い通信）

BLE 通信そのもの／レンダラ⇄ユーティリティ連携の設計と、その判断根拠の記録。
文字コードコーデックの設計は [charcode-codec.md](./charcode-codec.md)、
BLE の macOS 制約と実測経緯は [\_archive/docs](../../_archive/docs/) を参照。

> [!NOTE]
> このドキュメントは設計確定分の記録。実装は未着手。未決事項は末尾にまとめる。

---

## 1. コンセプト

- **すれ違い通信**（StreetPass 的）。**同じアプリを持つ者同士だけ**が参加する。
- 「秘密の共有」: seed から決定的にテーブルを生成し、送信者・受信者の両方が同じ
  テーブルを再現して encode/decode する。鍵（seed の素）を共有した者だけ復号できる。
- アソビ枠。ガラパゴスな独自符号・難読化が目的の一部（暗号ではない）。

---

## 2. レイヤ構成（全体像）

```
[Renderer: React / PixiJS]   ← UI・ソフトキーボード・描画・(表示用 store)
        │  contextBridge (window.allo) 経由の IPC
        │   ├─ invoke  (要求→応答)
        │   └─ on      (push イベント)
        ▼
[Utility: Electron main / Node]
   状態機械(state) ── codec(encode/decode/table) ── BLE transport(bleno/noble)
        │
        ▼  BLE 空中（コネクションレス広告ブロードキャスト）
[別の ALLO 端末]
```

- 通信は 2 種類あり別物:
  - **アプリ内 (renderer⇄utility)**: IPC。ローカル・確実・速い。REST/HTTP は不要。
  - **端末間 (ALLO⇄ALLO)**: BLE 撃ちっぱ。ロスる・順不同。
- 責務分担（README 準拠）: **codec・自然乱数・BLE は全部ユーティリティ側**。
  レンダラは UI・入力・呼び出し・描画のみ。

---

## 3. 確定事項（決定と根拠）

### D1. 符号化は charcode-codec 方式（10B/字・1 パケット 1 文字）
- 1 文字 = 10 バイトのランダムコード。1 広告 = 1 文字。
- 「12 文字/パケット（1B/字）」案は不採用。難読化（共有者だけ復号）を優先。
- 代償: N 文字メッセージ = N 広告（巡回送信が必要）。

### D2. パケットレイアウト（16 バイト = 128bit Service UUID 1 個）
```
[0..3]   sessionId (4B)  テーブル salt。平文で送る
[4..5]   seq       (2B)  文字順（big-endian）。再結合インデックス
[6..15]  body      (10B) その 1 文字の 10 バイトコード
```
- BLE 上は 32 桁 hex の Service UUID として広告に載せる。
- macOS は広告に Local Name と Service UUID しか載せられない（Manufacturer Data 不可）。

### D3. seed = ランダム sessionId のみ（MVP）
- `sessionId = crypto.randomBytes(4)`。table = `tableFromSeed(seed)` を送受信で再現。
- **MVP は sessionId が平文なので秘匿性ゼロ**（誰でも復号可）。秘密化は拡張フェーズ。
- 拡張候補: seed に BT アドレスや APP_SECRET を混ぜて「同じアプリ同士だけ復号」を担保。
  → BT アドレス案は macOS リスクあり（§6）、後回し。

### D4. フィルタ = `localName === "ALLO"` 固定
- Local Name は全端末共通の固定値（README 仕様）。フィルタ専用。
- magic マーカーは廃止（UUID 16B をフルに payload で使うため）。
- 送信者の区別は sessionId（＋ peripheral.id）で行う。

### D5. 送信方式 = A（全文ループ）
- N 文字を巡回広告。各文字を ~150–250ms 滞空させ、アクティブな間ずっと全文を周回。
- 「文字ごとに連射（B）」は不採用。
- 根拠: すれ違いは遭遇時間が短く読めない／ロスは固まって起きる。
  リトライは**時間的に分散**する方が全文字を拾われる確率が高い（B は遭遇終了までに
  後半文字の連射ターンへ到達できず全ロスの恐れ）。
- T（滞空）・R（周回）は実機で詰めるパラメータ（macOS の広告差し替え速度依存）。

### D6. コア = 発信／受信モードの分離（排他）
- 1 台は **`sending`（発信ループ）** か **`receiving`（スキャン+再結合）** の排他モード。
- **同時（advertise+scan）は後回し**（§6 のリスク回避）。
- 過去アーカイブの「A=発信機 / B=受信機」構成と一致＝検証が楽。

### D7. 連携の境界 = アプリレベル（`window.allo`）
- レンダラは「メッセージ」と「すれ違い相手」しか知らない。
  BLE / UUID / seq / codec / seed はユーティリティに隠蔽。
- 再結合（fragment→文章）の**真実はユーティリティが持つ**。
- レンダラ側に表示用の薄いラップ/キャッシュ層（store）が乗る可能性あり（演出とセットで後決め）。

### D8. IPC は Electron 公式推奨どおり
- `contextBridge.exposeInMainWorld` で必要 API だけ公開。
- コマンド = `ipcRenderer.invoke` ⇄ `ipcMain.handle`、push = `webContents.send` ⇄ `ipcRenderer.on`。
- contextIsolation / sandbox は既定 ON のまま。
- 生 `ipcRenderer` 素通し（現 preload の `window.ipcRenderer`）はアンチパターン → issue #4。

### D9. 受信はリアルタイム push + 連結
- 1 文字届くたびに seq で再結合し、`onMessage` で「今の連結結果」を push。
- レンダラは push を受けて store を更新（画面が伸びる）。
- **`getMessages`（一覧取得）は不要**（レンダラ store が受信中ずっと連結を保持）。
  例外: アプリ再起動後も残す（ディスク永続化）なら復活。MVP では持たない。

### D10. 文字セットは共有静的モジュール（`getAlphabet` IPC は不要）
- ソフトキーボードのレイアウトはどのみちレンダラで手組み（五十音 2D 配置）。
- `alphabet.ts` はただの静的データ（秘密でもネイティブ依存でもない）→ 共有 import で
  真実源を 1 つにする。IPC で取りに行く必要なし。

### D11. 状態モデル（単一）とコマンド API（操作別）は別層
- **排他は「ユーティリティが単一の `state` 変数を持つ状態機械であること」で保証**する。
  API を 1 verb に統合する必要はなかった（統合しても安全性は増えない）。
- コマンドは操作ごとに分ける。状態は `getState`/`onState` で単一の真実を観測する。

### D12. 送信ページの主機能 = リアルタイム発信更新（`setOutgoing`）
- 作成ページは「打ち終わってから一発送信」ではなく、**入力に追従して発信内容が
  リアルタイムに更新・連結される**。
- よって `startSend(完成text)` のような開始イベントは不採用。
- 主役 IPC は `setOutgoing(text)`（入力/削除のたびに今の全文を渡す）。停止 = `setOutgoing("")`。
- 全文を毎回渡す（差分 `appendChar` ではない）→ レンダラとユーティリティのバッファがズレない。

---

## 4. IPC 契約

### 送信側（確定）
```ts
interface AlloSend {
  // 発信文をリアルタイム更新。入力/削除のたびに今の全文を渡す。
  // 空文字なら発信停止。utility が encode し直し→ループ広告(A)を更新。
  // 文字セット外文字・BT オフは Result で弾く。
  setOutgoing(text: string): Promise<Result>;

  // 状態（mount 初期同期）
  getState(): Promise<{ bt: BleState; state: "idle" | "sending" | "receiving"; outgoing?: string }>;
  onState(cb: (s: AlloStateSnapshot) => void): () => void; // 変化を push、戻り値で解除
}
```
- レンダラは sessionId / UUID / encode 結果を一切知らない（text を渡すだけ）。
- seq 採番・差分・再エンコード・巡回広告はすべて utility 側。

### 受信側（方向のみ・未確定）
```ts
interface AlloReceive {
  // 受信モード開始/停止（呼称・形は受信側設計で再考。state 機械に統合）
  // ...startReceive / stopReceive 相当...
  onIncoming(cb): () => void; // 1 文字単位（創発演出用、生 10B を載せるかは演出方針次第）
  onMessage(cb): () => void;  // 連結スナップショット { sessionId, text, complete }
}
```
- 受信側はこれから詰める（次回の議題）。

---

## 5. 画面構成（案）

```
        ┌─────────────┐
        │ ホーム       │  モード選択（発信する / 受信する）・状態・導線
        └──┬───────┬──┘
   作成へ │       │ 受信箱へ
     ┌────▼───┐ ┌─▼────────┐
     │ 作成    │ │ 受信箱    │→ 詳細（解読演出）
     │(キーボード│ │(すれ違い  │
     │ +ﾘｱﾙﾀｲﾑ発信)│ 結果)    │
     └────────┘ └──────────┘
   ＋ 横断: [BT 未許可オーバーレイ]（onState 監視、macOS TCC 的に必須）
```

| 画面 | 役割 | 主な IPC |
| --- | --- | --- |
| ホーム | モード選択・状態・新着バッジ・導線 | getState / onState |
| 作成 | キーボード＋リアルタイム発信 | **setOutgoing** / getState / onState |
| 受信箱＋詳細 | 拾った文の一覧→解読演出 | onMessage / onIncoming（受信側設計で確定） |
| 設定（任意） | BT 状態、将来: 合言葉/ニックネーム | getState / onState |
| BT ゲート（横断） | bt≠poweredOn でオーバーレイ | onState |

---

## 6. リスク・要実機検証

- **macOS で advertise + scan 同時動作**: たぶん可能（mac bindings はサポート、CoreBluetooth は
  CBPeripheralManager/CBCentralManager を別個に持てる。コネクションレス広告のみなら既知制約も無関係）
  だが**実機未検証**。→ だから D6 で発信/受信を分離。同時化は後で実機確認してから。
- **BT アドレスを seed に使う案**: macOS は MAC を隠す（`bleno.address` は大抵 'unknown'、noble の
  `peripheral.id` はスキャン側ホスト依存 UUID、`peripheral.address` は空になりがち）。
  → 送信者が使った値と受信者が見る値が一致せず seed がズレてデコード全滅の恐れ。
  Mac 2 台の devパネルで `peripheral.id`/`address` の実値を確認してから判断。
- **waitForPoweredOn にタイムアウト無し**（既存コード）→ issue #3。

---

## 7. 未決事項（次回以降）

- [ ] 受信側 IPC の確定（startReceive 相当の形、onIncoming/onMessage のペイロード）
- [ ] 発信モデル: 1 つの常設メッセージ（StreetPass 流）か複数逐次か
      （※ D12 のリアルタイム setOutgoing は「現在の 1 文」なので実質 1 常設寄り）
- [ ] 画面レイアウト: 単一画面遷移 か 3DS 風上下 2 画面か
- [ ] 受信メッセージの永続化: メモリのみ（MVP）か ディスク保存か
- [ ] メッセージ完了判定: 無音タイムアウト か END 制御文字か（16B に total 枠なし）
- [ ] 演出方針: 創発型（実受信に連動）か 台本型（集めてから再生）か
      → `onIncoming` に生 10B を載せるか・`onSendProgress` の要否がこれで決まる
- [ ] codec doc の暗号強度表現の整合（issue #5）／生 ipcRenderer 素通しの除去（issue #4）

---

## 8. 関連

- マージ済み PR: #1 BLE 発信・受信セットアップ / #2 文字コードコーデック
- low issue: #3（poweredOn タイムアウト）/ #4（ipcRenderer 素通し）/ #5（暗号強度 doc）/ #6（ALLO フィルタ）
- 既存設計: [charcode-codec.md](./charcode-codec.md) / [\_archive/docs/design.md](../../_archive/docs/design.md)
