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
- 最新文字ビーコンは OS が同じ広告を反復するので、`onChar` は同一 `{sessionId, seq}` を繰り返し発火する
  前提。**重複除去も Renderer 責務**に含める（`sessionId+seq` でデデュープ・同位置上書きで冪等）。
- `sendChar(char)` → **`sendChar(body: Uint8Array)`（encode 済みの生 10B）** に変更。`onChar` が生 10B を渡すのと
  対称にし、Utility を「生バイトの純粋転送」に統一（encode も Renderer へ。decode 移譲と同じ理屈）。
  代償: Renderer が encode する seed が要るので、`changeState('sending')` が**新 sessionId を Renderer へ返す**契約を追加。
  秘匿化する時は encode/decode を両方 Utility へ戻すのも対称。
- 結論: **`changeState` / `sendChar` / `getState` / `onState` / `onChar`** の 5 つ。
  send/receive が **`sendChar(body)`/`onChar(body)` で生 10B 対称**。

## 6. 不要にした API

- `getAlphabet`: 文字セットは静的データ。共有モジュール import で真実源を 1 つにすれば IPC 不要。
- `getMessages`: （当時）受信再結合が Renderer 側になり、store が保持するので取りに行く必要がない。
  → **#13 で復活**。再結合も永続化も Utility に寄せたため、view モードで Renderer が取りに来る形に戻った。

## 7. ドキュメント方針

- 仕様（design）は**実装に必要なことだけを論理順**に。経緯・没案・演出はこの log に分離。
- 図表は意味のある所だけ（システム構成・パケット・IPC インターフェース）。

## 8. 送信の最低発信時間（要件のみ確定・方式未決）

- 最新文字ビーコン（#3）は latest-wins で古い文字を撒き直さないため、打鍵が速いと 1 文字の滞空が
  短く、ロスありの受信側で取りこぼしやすい。**各文字に最低発信時間を保証したい**という要求が出た。
- 責務の置き場所は **Utility の送信スケジューラ**で確定（ビーコンのタイミングを握るのは Utility。
  Renderer は打鍵を渡すだけ）。
- 打鍵が滞空時間 T より速い時の方針（最新優先＋最低滞空で間引く / キューで全文字保証）と T の値は
  **未決**。アーカイブ #3 の「数百 ms 滞空」案が参考。実機計測してから決める（仕様の懸念事項に記録）。

## 9. allo 層の実装と実 BLE 結線（mock を経由しない）

- `window.allo`（changeState/sendChar/getState/onState/onChar）を Utility に実装。BLE 実体は
  `AlloTransport` 抽象の裏に隔離し、現状は実 BLE（bleno/noble）の `BleTransport` を使う。
- 一度「プロセス内ループバックのモック transport」を作ったが**廃棄**。理由: モックすべきは
  フロント（手で叩く dev パネル）であって、通信機能は本番のまま持たせたい。電波の代役
  （loopback / バス / UDP）は不要、すれ違いは**実機 2 台**で見る（同一 Mac は自己受信不可）。
- BT は通常 UI 起動でいきなり握らないよう、**send/receive に入った時だけ遅延初期化**
  （stateChange 購読が CoreBluetooth 初期化＝TCC 権限要求のトリガ）。

## 10. 実 BLE 結線で踏んだ罠（macOS・実測）

- **TCC で SIGABRT**: BLE を触る Electron を**非 GUI 文脈（エージェント/harness）から起動すると
  権限プロンプトが出せずプロセスごと abort**。GUI ターミナルからユーザが起動して許可する必要が
  ある（アーカイブ investigation #2 の再現）。Info.plist のキー有無は無関係だった。
- **poweredOn 待ちの無限ハング（issue #3）**: `bleno.state` が unknown のまま変化しないと
  `startAdvertising` が静かに待ち続ける。`waitForPoweredOn` に 10s タイムアウトと state ログを入れ、
  「静かなハング」を state 付きの明示エラーに変えて切り分け可能にした。
- **最新文字ビーコンの撒き直しハング（本丸）**: ネイティブ `startAdvertising` は
  `isAdvertising==true` だと**何もせず return**。CoreBluetooth の `stopAdvertising` は即座に
  `isAdvertising=false` にならないので、stop 直後に start すると「既に広告中」と無視され
  `advertisingStart` が来ずハング。→ **stop 完了を待つ + stop と start の間に 150ms の猶予**で解決。
  併せて `startAdvertising` にも 3s タイムアウト（安全網）。
- 切り分けの肝は**ターミナルの `[allo/ble] 要求/反映` ログ**。`要求` は出るが `反映` が出ない＝
  start がハング、という形で原因が一目で分かった。

## 11. 送信の観測性とデバッグ UI

- **発信(on-air)イベント `onBeacon` を追加**。latest-wins で間引かれず**実際に広告へ載った**
  パケットだけを Renderer へ push（`allo:beacon`）。これで「打鍵＝送ろうとした」と
  「発信＝実際に撒いた」を区別でき、生ログを **打鍵 ≥ 発信 ≥ 受信** の 3 レイヤで正直に併記できる。
  （以前は Renderer 発の楽観的 TX しか出ておらず「よしなに解釈」していた。）
- **dev パネルの送信入力は文字ボタン**に。テキスト欄の onChange 差分計算＋IME 合成イベントが
  不安定で、デバッグ harness には不向きだったため。1 クリック=1 文字 sendChar で明示的・決定的。
- **最低発信時間 T（#8）に事実上の下限ができた**: 撒き直し猶予 150ms により、各文字は少なくとも
  ~150ms は最新ビーコンとして滞空する。正式な T と方針は引き続き実機計測で詰める。

## 12. 境界を裏返す：ロジックを全部 Utility へ（#5 のちゃぶ台返し）

- #5 では「Utility=生バイトの純粋転送 / encode・decode・再結合=Renderer」に寄せた。が、**逆**にする。
  **codec・seq 採番・送信スケジューラ・重複除去・seq 再結合・session 管理・歯抜け表示まで全部 Utility**。
  Renderer は**文字を投げて本文を表示するだけ**の薄い層にする。
- 理由: ① 通信ロジックの所在を Utility に一本化（フロントに散らさない）。② codec を Utility に置けば
  seed/鍵が DOM に出ず**秘匿化が素直**。③ README のユーティリティ側責務（「エンコード・デコードを行う」）
  とも一致する（design 側が Renderer に寄せていたのが乖離だった）。
- **API の変化**:
  - `sendChar(body: Uint8Array)` → **`sendChar(char: string)`**（encode が Utility へ）。戻りは `Result`（ok が成否 bool）。
  - `changeState` の **sessionId 返しを廃止**（Renderer は encode しないので不要）。`AlloState` からも sessionId を削除。
  - `onChar`(生 body) → **`onMessage({ sessionId, text })`**。Utility が組み立てた本文スナップショットを
    変化時のみ push。Renderer は session ごとに上書き表示（複数 session は並列表示）。歯抜け=`□` / decode 失敗=`�` は Utility が埋める。
  - **送信内部（sessionId / seq / 送信スタック）は Renderer に出さない**。受信 sessionId のみ `onMessage` で識別用に渡す。
  - **`getState` / `onState`（bt / mode）は一旦持たない**（提供形態が諸説あるため保留）。mode は Renderer 自身が
    `changeState` で駆動するので把握でき、BT の可否は `changeState` の `Result` で分かる。状態 UI が要るなら後で設計し直す。
- **新規要件: 1 セッション最大 50 文字**。送信側 `sendChar` で enforce（51 文字目以降は `ok:false`）。
- 据え置き: 最低発信時間 T の方式・値は未決（置き場所は Utility 確定）。撒き直し 150ms が暫定下限（#11）。
- `onBeacon`（#11）は一度コア契約外の演出用・デバッグ用 API に切り出したが、**最終的に廃止**。
  デバッグ用の IPC は置かず、送信スケジューラの動きは **Utility から `console.log` でターミナルへ出す**方針に統一
  （Renderer に観測用 API を生やさない＝境界を薄く保つ）。

## 13. 受信メッセージの永続化（#6 の getMessages 復活）

- 獲得したメッセージを残したい、という要求。**保存も Utility のロジック**として持つ（#12 の方針に従い、
  Renderer の localStorage は使わない）。
- **方式は JSON ファイル @ Utility**（`app.getPath('userData')/messages.json`）。
  - localStorage: Renderer 寄りで方針と逆 → 不採用。
  - SQLite/better-sqlite3: **native ビルド依存が増える**（bleno/noble のビルド地獄を増やしたくない）。
    データは極小（1 メッセージ ≤ 50 字）なので過剰 → 不採用。
  - 自前 JSON ファイル: native 依存ゼロ・人間が読める・データ極小で十分 → **採用**。
- **確定タイミング = onMessage と同時**（session ごとに最新スナップショットを上書き保存）。
  保存は Utility が握るので、**Renderer が購読していない mode（view 以外）でも取りこぼさない**
  （onMessage は state 次第でフロントに届かないことがある、という懸念への回答）。
- **メッセージ単位**: session 1 つ = 1 メッセージ `{ sessionId, text, updatedAt }`。同 sessionId は上書き。
  終端判定は持たない（撃ちっぱ・スコープ外）。最新本文をそのまま記録。
- **読み出し**: view モードで Renderer が `getMessages()`。保存は Utility・表示は Renderer。

## 14. 再構築：Utility を薄い BLE I/O に・ロジックは全部 Renderer（#12/#13 の揺り戻し）

- #12 で「ロジック全部 Utility」に振ったが、**再び逆へ**。**Utility は薄い BLE インターフェース**に徹し、
  **codec・pack/unpack・送信スケジューラ・セッション/再結合/重複除去・永続化は全部 Renderer**。
  高レベル `window.allo`（changeState/sendChar/onChar/onMessage/getMessages）は**破棄**し、
  低レベル `window.ble` に作り直す（既存の低レベル BLE API の進化形）。
- **新 API（`window.ble`）**:
  - `setStatus(IDLE | ADVERTISE | SCANNING)`: BLE インターフェースのステータス更新（排他）。
  - `advertise(serviceUuids: string[])`: 撒く生データ（ServiceUUIDs の中身）をセット。Utility は**渡された
    まま広告に載せるだけ**（中身を解釈しない）。localName は "HAKO" 固定。
  - `onPacket({ address, serviceUuids })`: `localName==="HAKO"` でフィルタした広告を**生のまま全部** push
    （decode も重複除去もしない・OS 反復の重複も全部渡す）。
- **責務の置き場所（確定）**:
  - **Renderer**: encode/decode、pack/unpack(16B)、**送信スタック・latest-wins・文字送り最低保証(T)・
    50 文字制限**、セッション管理・再結合・重複除去、**localStorage 永続化**、`BTアドレス⊕sessionId` seed。
  - **Utility**: ステータス制御、広告セット（CoreBluetooth の撒き直し機構 stop→150ms→start だけは吸収）、
    HAKO フィルタ、最小整形して `{ address, serviceUuids }` 通知。**中身は知らない**。
- 切り分けのキモ: **「何を・いつ撒くか（ポリシー）」= Renderer / 「どう撒くか（BLE メカニクス）」= Utility**。
- 受信ペイロードに **BTアドレス** を載せる狙いは、charcode-codec 元案 `BTアドレス⊕sessionId` の seed を
  Renderer で計算するため。ただし **macOS は MAC を隠す**ので、`address` が `peripheral.id`/`address` の
  どちらか・送受で一致するかは**要検討**（懸念事項）。
- **LocalName を `ALLO` → `HAKO` にリネーム**（プロトコル識別子）。広告/フィルタはすべて `"HAKO"` で扱う。
  ※ハッカソンのイベント名「アロカップ」は実イベント名なので据え置き。
- これに伴い #12（Utility 集約）・#13（Utility 永続化・getMessages）・onMessage・sendChar(char)・
  Utility 側 50 文字は**全て取り消し**。getMessages は再び不要（Renderer が localStorage を直接読む）。
- 影響: 既に実装した allo 層（changeState/sendChar/onChar/onBeacon + Utility codec）はこの設計に**未追従**。
  実装は本設計に合わせて作り直す。

## 関連

- マージ済み: PR #1（BLE セットアップ）/ #2（charcode-codec）
- 進行中: `feat/allo-comm-mock`。**API は #14 で再構築**（高レベル allo 破棄 → 低レベル `window.ble`）。
  docs 先行・**コードは旧 allo 層のままで未追従**（実装は #14 に合わせて作り直し）
- issue: #3（poweredOn タイムアウト → **対応済み**: #10）/ #4（ipcRenderer 素通し）/ #5（暗号強度 doc）/ #6（HAKO フィルタ）
- 仕様: [communication-design.md](./communication-design.md) / [charcode-codec.md](./charcode-codec.md)
