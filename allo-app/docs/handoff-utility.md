# 引き継ぎ: 新ユーティリティ層（`window.ble`）の構築

**この 1 枚が新ユーティリティ層の仕様**。他の情報なしに実装着手できることを目指す。
（リポジトリ内の旧 docs〔communication-design / log / charcode-codec〕は集約のため削除済み。
設計判断の経緯はチームの設計メモを参照。本書は実装に必要な内容を自己完結で再掲している。）

---

## 0. 前提（プロジェクト全体像・最小）

- **何を作るか**: 同じアプリを持つ端末同士が、BLE 広告ブロードキャストで 1 文字ずつ撒き合う
  「すれ違いタイピング」。接続しない撃ちっぱ通信＝**ロスあり・順不同**。送信と受信は**排他**。
- **構成**: Electron。**Renderer**（React, Chromium）と **Utility**（main, Node.js）が IPC で通信。
  - Renderer ⇄ Utility: `window.ble`（preload の contextBridge 経由）。
  - Utility ⇄ 別端末: BLE 広告（bleno=発信 / noble=受信、`@stoprocent` fork）。
- **この層の役割**: **Utility = 薄い BLE I/O だけ**。中身（codec・文字・パケット構造）は**一切解釈しない**。
  ロジックは全部 Renderer。Utility は「ステータス制御・生データを撒く・拾った生データを通知」のみ。

## 1. スコープ（やること / やらないこと）

**やること（Utility）**
- BLE のステータス制御: `IDLE` / `ADVERTISE` / `SCANNING`（排他）
- 渡された生データ（Service UUIDs）を広告にセット（中身は見ない）
- `localName === "HAKO"` の広告だけ拾い、生のまま Renderer へ通知

**やらないこと（全部 Renderer の責務・ここには書かない）**
- encode/decode（codec）、Service UUID の pack/unpack（16B 構造の解釈）
- seq 採番・送信スタック・latest-wins・文字送り最低保証(T)・1 セッション 50 文字制限
- 受信の重複除去・seq 再結合・session 管理・歯抜け表示
- 永続化（localStorage）、`BTアドレス⊕sessionId` の seed 計算

> 合言葉: **「何を・いつ撒くか」は Renderer、「どう撒くか（BLE メカニクス）」だけ Utility。**

## 2. API 契約（`window.ble`）

```ts
type BleStatus = "IDLE" | "ADVERTISE" | "SCANNING";
type Result = { ok: boolean; error?: string }; // ok が成否。BT 不可/排他違反などは ok:false + error

interface Ble {
  // ステータス更新（排他）。ADVERTISE=発信 / SCANNING=受信 / IDLE=停止。BT 不可なら ok:false。
  setStatus(status: BleStatus): Promise<Result>;

  // 撒く生データ（128bit UUID hex の配列）をセット。ADVERTISE 中のみ有効。
  // 次の advertise までこれが撒かれ続ける（差し替え=latest-wins の判断は Renderer）。localName は "HAKO" 固定。
  advertise(serviceUuids: string[]): Promise<Result>;

  // パケットヒット通知。localName==="HAKO" だけ拾い、生のまま全部 push（decode/重複除去なし）。
  onPacket(cb: (p: { address: string; serviceUuids: string[] }) => void): () => void;
}
```

- ステータス取得/購読 API（getStatus 等）は**持たない**。Renderer が `setStatus` で駆動するので自前で把握でき、
  BT 不可は `Result` で分かる。必要になったら追加。
- デバッグ用 IPC も**持たない**。動作は Utility から `console.log` でターミナルへ出す。

## 3. ファイル構成

```
electron/
  ble/
    types.ts        # bleno/noble の最小型・DiscoveredDevice（既存・流用）
    transmitter.ts  # bleno ラッパ（既存・修正済みを流用）
    receiver.ts     # noble ラッパ（既存・修正済みを流用）
    index.ts        # ← ここを window.ble 新形式に書き換える（旧 start/stop verb を置換）
  preload.ts        # ← window.ble を setStatus/advertise/onPacket に
  electron-env.d.ts # ← window.ble の型を更新
  main.ts           # registerBle()/shutdownBle() を呼ぶ（既存のまま）
```

**既存で再利用できるもの（重要・作り直さない）**
- `transmitter.ts`: `startAdvertising(localName, serviceUuids)` / `stopAdvertising()` / `LOCAL_NAME`。
  既に **poweredOn タイムアウト・stopAdvertising 完了待ち・startAdvertising タイムアウト**の修正入り（#10 の罠対策）。
- `receiver.ts`: `startScanning(onDiscover)` / `stopScanning()`。`DiscoveredDevice` を渡す。waitForPoweredOn タイムアウト入り。
- `DiscoveredDevice` の形: `{ id, address, localName, rssi, serviceUuids, manufacturerDataHex }`。

## 4. 実装の要点

### setStatus(status)（排他ステートマシン）
- `IDLE`: `stopAdvertising()` ＋ `stopScanning()`。
- `ADVERTISE`: 受信を止める。発信は**まだ何も撒かない**（最初の `advertise()` まで待つ）。
- `SCANNING`: 発信を止め、`startScanning` を開始。discover を **HAKO フィルタ**して `onPacket` へ。
- 遷移のたび現在の動作を止めてから次へ（排他保証）。BT 不可（権限/電源 off）の場合 `transmitter`/`receiver` の
  `waitForPoweredOn` が reject するので、それを `{ ok:false, error }` に変換して返す。

### advertise(serviceUuids)（生データを撒く）
- `ADVERTISE` 中のみ有効（それ以外は `ok:false`）。
- localName は `"HAKO"` 固定で `transmitter.startAdvertising("HAKO", serviceUuids)`。
- **撒き直しの罠（必読）**: macOS ネイティブの `startAdvertising` は **`isAdvertising==true` だと何もせず return**。
  `stopAdvertising`（CoreBluetooth）は即座に `isAdvertising=false` にならないため、**stop 直後に start すると
  無視され `advertisingStart` が来ずハングする**。→ 既に撒いていれば **`stopAdvertising()` → 150ms 待ち →
  `startAdvertising()`** の順にする（150ms は実測の暫定値）。`transmitter.stopAdvertising` は完了待ち済み・
  `startAdvertising` は 3s タイムアウト済みなので、**index 側で 150ms の gap だけ入れれば良い**。
- 実装スケッチ（latest-wins 判断は Renderer なので、ここは「来た serviceUuids をそのまま差し替える」だけ）:

  ```ts
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function setAdvertise(serviceUuids: string[]) {
    if (transmitter.isAdvertising()) {
      await transmitter.stopAdvertising();        // 完了待ち込み
      await delay(150);                            // isAdvertising が落ちる猶予（必須）
    }
    await transmitter.startAdvertising("HAKO", serviceUuids); // 3s タイムアウト込み
  }
  ```

### onPacket（HAKO フィルタして生 push）
- `receiver.startScanning((device) => {...})` の中で **`device.localName === "HAKO"` だけ**通す。
- 通すデータ: `{ address, serviceUuids: device.serviceUuids }`。**decode しない・重複除去しない**
  （OS の反復で同じものが何度来ても全部 push する＝Renderer が捌く）。
- `address` は `peripheral.id` か `peripheral.address` か**要検討**（macOS は MAC を隠す。`address` は空、
  `id` はスキャン側ホスト依存で送受不一致の恐れ → seed に使う Renderer 側で問題になる）。
  まず両方ログに出して実機で確認できるようにしておくと良い。
- discover は `BrowserWindow` 全ウィンドウへ `webContents.send("ble:packet", payload)` で broadcast。

### preload / 型
- `contextBridge.exposeInMainWorld("ble", { setStatus, advertise, onPacket })`。
- `onPacket` は `ipcRenderer.on("ble:packet", listener)` を張り、解除関数を返す。
- `electron-env.d.ts` の `Window["ble"]` を新 API に更新。

## 5. macOS の前提（実測・必読）

- **広告に載るのは LocalName と Service UUID のみ**（Manufacturer Data 不可）。LocalName は短く（"HAKO"=4B で OK。
  31B 制約: flags3 + UUID18 + name6 = 27 ≤ 31）。
- **同一 Mac で送受信不可**: CoreBluetooth は自分の広告を自分のスキャナに返さない。**動作確認は実機 2 台**
  （または送信を Mac・受信をスマホの LightBlue で「電波が出てるか」だけ確認）。
- **TCC 権限は GUI 文脈から**: 非 GUI（エージェント/CI）から起動すると権限プロンプトが出せず **SIGABRT**。
  必ず GUI ターミナル（Terminal.app / iTerm）から `vp dev` し、初回の Bluetooth 許可ダイアログを承認する。
- **ネイティブビルド**: `@stoprocent/bleno`/`noble` は node-gyp。Python 3.11 が要る環境がある
  （`export PYTHON=/opt/homebrew/bin/python3.11`）。`vp install` で入る想定。

## 6. テスト（vitest / `vite-plus/test`）

native（bleno/noble）に依存しない純ロジックを対象にする。**transmitter/receiver をモック**して `ble/index` を検証。

- **ステータス排他**: `setStatus("ADVERTISE")` 後に `setStatus("SCANNING")` で発信が止まり受信が始まる、等。
- **HAKO フィルタ**: discover に `localName="HAKO"` の device を渡すと `onPacket` が発火、`"OTHER"` や無名は無視。
- **重複は素通し**: 同じ device を複数回 discover させると **その回数だけ** `onPacket` が発火する（重複除去しない）。
- **advertise の前提**: `ADVERTISE` 以外で `advertise()` を呼ぶと `ok:false`。
- 撒き直し gap（150ms）はタイマー絡みなので、`vi.useFakeTimers()` で stop→gap→start の順序を検証できると良い。

実行: `vp test`。型/lint: `vp check`（または `vp lint --type-aware`）。

## 7. 動作確認

1. **GUI ターミナル**から `cd allo-app && vp dev`（エージェント経由では TCC で落ちる）。
2. 初回 `ADVERTISE` 時に **Bluetooth 許可ダイアログ**が出たら承認。
3. スマホに **LightBlue** を入れてスキャン → `"HAKO"` が見えれば発信成功。
4. 受信は**実機 2 台**で。1 台 `ADVERTISE`・もう 1 台 `SCANNING`。
5. ターミナルに `console.log` を仕込み、`要求→反映`（advertise）や discover を追えるようにする。

## 8. 完了の定義

- `window.ble`（setStatus/advertise/onPacket）が型付きで生え、`vp check`/`vp test` が緑。
- `vp dev`（GUI）でスマホに `HAKO` 広告が見え、`SCANNING` で別端末の広告が `onPacket` に生で届く。
- decode/再結合/重複除去/codec は**一切持っていない**（Renderer の責務）ことを確認。
