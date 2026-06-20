# 通信・連携 仕様（BLE すれ違いタイピング）

実装に必要な仕様。文字コードの内部仕様は [charcode-codec.md](./charcode-codec.md)、
macOS の BLE 制約の経緯は [\_archive/docs](../../_archive/docs/) を参照。
方針の変遷（なぜ今の形か）は [communication-log.md](./communication-log.md)。

## 概要

同じアプリを持つ端末同士が、BLE 広告ブロードキャストで文字をやり取りする。
送信側は「いま打った最新の 1 文字」を撒き続け、受信側は拾って `seq` 順に並べる。
接続しない撃ちっぱ通信なので**ロスあり** ＝ 途中から受信すれば途中からしか見えない、
リアルタイムなライブ・タイピング。送信と受信は**排他**（1 台が同時に両方はしない）。

## 構成

```
[Renderer]  React / PixiJS        UI + 全ロジック（codec・再結合・送信スケジューラ・永続化）
    │   window.ble  (IPC: invoke=要求 / on=push)
[Utility]   Electron main / Node   薄い BLE I/O（bleno/noble）。中身は知らない
    │   BLE 広告ブロードキャスト（ロスあり・順不同）
[別の HAKO 端末]
```

**Utility は薄い BLE インターフェースに徹し、ロジックは全部 Renderer**。

- **Utility（薄い BLE I/O）**: ステータス制御（IDLE/ADVERTISE/SCANNING）、広告に**渡された生データを
  セットする**だけ（CoreBluetooth の撒き直し機構は内部で面倒見る）、受信は **localName "HAKO" で
  フィルタして生のまま全部通知**。**decode も pack/unpack も重複除去もしない**。BLE の中身は知らない。
- **Renderer（全ロジック）**: encode/decode（codec）、ServiceUUIDs の組立/分解（pack/unpack）、
  **送信スタック・latest-wins・文字送り最低保証(T)・50 文字制限**、セッション管理・再結合・重複除去、
  **localStorage 永続化**、`BTアドレス⊕sessionId` の seed 計算。

> 「何を・いつ撒くか（ポリシー）」は Renderer、「どう撒くか（BLE メカニクス）」は Utility。
> 経緯: 一度ロジックを Utility に集約したが（log #12）、**再び Renderer 集約へ揺り戻した**（log #14）。

## パケット（16 バイト = Service UUID 1 個）

広告の Service UUID(128bit) に 1 文字を載せる。**この 16B の構造は Renderer 側の取り決め**で、
Utility からは不透明な UUID 文字列として扱う（Utility は中身を解釈しない）。
macOS の広告に載せられるのは Local Name と Service UUID のみ（Manufacturer Data 不可）。

```
[0..3]   sessionId  4B   送信セッション識別。codec seed の素も兼ねる
[4..5]   seq        2B   文字順 (big-endian)。受信側の並べ替えキー
[6..15]  body      10B   その 1 文字のコード (codec)
```

Local Name は `"HAKO"` 固定（Utility が付ける）。受信側は `localName === "HAKO"` の広告だけ拾う。

## 送信（最新文字ビーコン・スケジューラは Renderer）

1. `setStatus("ADVERTISE")` で発信モードに入る。
2. 打鍵ごとに **Renderer が** `encode(char)` → `body`、`{ sessionId, seq, body }` を 16B UUID hex に
   pack し、**送信スタック**に積む。`seq` 採番・`sessionId` 生成・`BTアドレス⊕sessionId` seed も Renderer。
3. Renderer の送信スケジューラが `ble.advertise([uuid])` で**撒く生データをセット**する。
   OS が同じ広告を反復するので、次の `advertise` が来るまでそれが撒かれ続ける。
4. **latest-wins**: 次の文字で差し替える。古い文字は再送しない（差し替え判断は Renderer）。
5. **文字送り最低保証(T)**: 各文字を最低 T だけ滞空させる責務も Renderer のスケジューラが持つ
   （打鍵が T より速い時の間引き/キューも Renderer。方式・T は未決・要実機検証）。
6. **1 セッション最大 50 文字**: Renderer が enforce（51 文字目以降は撒かない）。
7. 無入力が一定時間続いたら `setStatus("IDLE")`（タイムアウトは Renderer 判断）。

Utility 側の `advertise` は**渡された UUID をそのまま広告にセットするだけ**。ただし CoreBluetooth は
広告中の差し替えに猶予が要るため、**stop→150ms→start の撒き直し機構は Utility 内で吸収**する（懸念事項）。

## 受信（HAKO フィルタのみ・再結合は Renderer）

1. `setStatus("SCANNING")` でスキャン開始。
2. Utility は `localName === "HAKO"` の広告**だけ**を拾い、`{ address, serviceUuids }` を **`onPacket` で
   生のまま push**する。**decode しない・重複除去しない**（OS の反復で同じものが何度来ても全部流す）。
3. **Renderer が** 各 `serviceUuid` を unpack → `{ sessionId, seq, body }`、decode（seed =
   `BTアドレス⊕sessionId`・要検討）して文字に戻す。
4. `sessionId + seq` で**重複除去**し、`seq` 位置へ置いて再結合。**歯抜けは `□`、decode 失敗は `�`**。
5. session ごとに本文を組み立て、**localStorage に保存**（下記「永続化」）。複数 session は**並列表示**。

全文の到達は保証しない（設計どおりのロス）。末尾欠落は受信側から検出できない。

## IPC 契約（`window.ble`）

```ts
type BleStatus = "IDLE" | "ADVERTISE" | "SCANNING";

// 操作の成否（ok が成否を表す bool）。BT 不可（権限/電源）/ 排他違反などは ok:false + error
type Result = { ok: boolean; error?: string };

interface Ble {
  // BLE インターフェースのステータス更新（単一状態・排他）。
  // ADVERTISE=発信 / SCANNING=受信 / IDLE=停止。BT 不可なら ok:false。
  setStatus(status: BleStatus): Promise<Result>;

  // 撒く生データ（ServiceUUIDs に入れる 128bit UUID hex の配列）をセットする。ADVERTISE 中のみ有効。
  // 次の advertise までこれが撒かれ続ける（latest-wins の差し替え判断は Renderer）。
  // CoreBluetooth の撒き直し機構（stop→150ms→start）は Utility 内で吸収する。localName は "HAKO" 固定。
  advertise(serviceUuids: string[]): Promise<Result>;

  // パケットヒット通知。localName==="HAKO" の広告だけを拾い、生のまま全部流す（decode/重複除去なし）。
  onPacket(cb: (p: { address: string; serviceUuids: string[] }) => void): () => void;
}
```

- **Utility は中身を知らない**: codec・pack/unpack・seq・重複除去・再結合・50 文字・送信スケジューラ・
  永続化は**一切持たない**。BLE の I/O（ステータス・広告セット・HAKO フィルタ通知）だけ。
- **ロジックは全部 Renderer**: 上記を全部 Renderer が持つ。codec も Renderer 側のモジュール。
- `address` フィールドが **peripheral.id か peripheral.address か**は要検討（macOS では MAC が隠れる・懸念事項）。
- ステータス取得/購読 API（getStatus 等）は**一旦持たない**。status は Renderer 自身が `setStatus` で
  駆動するので把握でき、BT 不可は `setStatus` の `Result` で分かる。必要になったら追加。
- デバッグ用 IPC は置かない。BLE の動き（撒き直し等）は Utility から `console.log` でターミナルへ出す。

## 永続化（Renderer / localStorage）

セッション・本文の扱いと永続化は **Renderer（Chromium の localStorage）**で行う。

- 受信して組み立てた session ごとの本文を localStorage に保存する。読み書きとも Renderer。
- 「メッセージ完了の厳密判定」は持たない（撃ちっぱで終端が無いため・スコープ外）。最新本文を保存する。
- view モードでは localStorage から読んで一覧表示する（Utility を介さない）。

## 制約・前提

- **送信/受信は排他**: macOS での広告+受信の同時動作が未検証のため分離する（同時化は実機確認後）。
- **BT 状態ゲート**: TCC 権限が下りないと BLE が動かない。状態購読は持たないので、`setStatus` の
  `Result`（`ok:false` + error）で BT 不可を検知して UI 側でガードする。
- **seed = `BTアドレス⊕sessionId`（要検討）**: 「同じアプリ同士だけ復号」を狙う元案。受信側は電波層から
  得た `address` を seed に混ぜる。ただし macOS は MAC を隠すため値がズレる懸念（懸念事項）。MVP は
  `sessionId` のみで疎通優先も可。seed 計算は Renderer。
- **編集は放送に反映しない**: 最新文字を前進で撒くだけ。バックスペースは送信ストリームに乗せない（MVP）。

## 懸念事項（未検証・要注意）

- **同時送受信の可否**: advertise+scan の同時動作は未検証。現状はモード分離で回避。同時化するなら実機確認が必要。
- **ロスの偏り**: 打鍵が速い／受信開始が遅いほど取りこぼしが増える。**末尾文字の欠落は受信側から検出できない**。
- **BTアドレス seed（id vs address）**: macOS は MAC を隠すため、`peripheral.address` は空、`peripheral.id`
  はスキャン側ホスト依存で送受で不一致になる恐れ。**seed に使うと復号がズレる**。採用前に実機で
  `id`/`address` の実値と送受一致を確認する（**`onPacket` の `address` が id/address どちらかも要検討**）。
- **sessionId 衝突**: 4 バイト乱数。稀だが 2 送信者が同一 ID を引くとストリームが混ざる。
- **poweredOn 待ちにタイムアウト無し（issue #3 → 対応済み）**: bleno/noble の `waitForPoweredOn` に 10s
  タイムアウトと state ログを追加。state が unknown のまま無反応だと静かにハングしていたのを明示エラーに。
- **撒き直しには isAdvertising が落ちる猶予が要る**: macOS ネイティブの `startAdvertising` は
  `isAdvertising==true` だと何もせず return する。`stopAdvertising`（CoreBluetooth）は即座に false にならない
  ため、stop 直後に start すると無視され `advertisingStart` が来ずハングする。→ **stop 完了を待ち、stop と
  start の間に 150ms 空ける**で回避（Utility 内・実装値）。`startAdvertising` にも 3s タイムアウトの安全網。
- **BLE は GUI 文脈から起動して権限許可が要る**: 非 GUI（エージェント等）から起動すると TCC が権限プロンプトを
  出せず SIGABRT する。GUI ターミナルから起動して Bluetooth を許可する。
- **文字送り最低保証 T は未決（Renderer のスケジューラ）**: 各文字を最低 T 滞空させる責務は Renderer が持つ。
  打鍵が T より速い時の方針（最新優先＋最低滞空で間引く / キューで全文字保証）と T の値は実機計測で詰める。
  なお Utility の撒き直し猶予 150ms が物理的な下限になる。

## スコープ外

演出（解読アニメ等）、メッセージ完了の厳密判定、送受信の同時化、秘匿化の強化。
