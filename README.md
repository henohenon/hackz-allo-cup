# hackz-allo-cup — BLE ブロードキャスト通信モック

`@abandonware/bleno`（発信）と `@abandonware/noble`（受信）で、BLE 広告ブロードキャストによる
パケット通信が成立するかを確認するモック。将来的に Electron/React アプリへ組み込む前提。

- **発信**: `@abandonware/bleno`（Peripheral / Advertiser）
- **受信**: `@abandonware/noble`（Central / Scanner）

> 設計の根拠は [docs/design.md](docs/design.md)、調査の経緯（回り道・実測）は
> [docs/investigation.md](docs/investigation.md) を参照。

## 通信方式（設計）

macOS では広告に載せられるフィールドが限られるため（後述）、**名前とデータを別フィールドに分離**する：

| フィールド | 用途 | 中身 |
| --- | --- | --- |
| **Local Name** | デバイス識別子 | 短い名前（例 `ALLO`）。8 バイト以内推奨 |
| **Service UUID (128bit)** | データチャンネル | ペイロードを符号化（Manufacturer Data の代わり） |

Service UUID(16 byte) のレイアウト（`mock/packet.js`）:

```
[0..3]  magic : 固定マーカー a110cafe（受信側フィルタ用）
[4]     seq   : シーケンス番号 (0-255)
[5]     len   : body の有効バイト長
[6..15] body  : ペイロード本体（最大 10 バイト、ゼロ埋め）
```

例: `data="HELLO"` → UUID `a110cafe0105`**`48454c4c4f`**`0000000000`
（`a110cafe`=目印 / `01`=seq / `05`=長さ / `48454c4c4f`="HELLO"）

主パケット使用量: `flags(3) + UUID(18) + name "ALLO"(2+4) = 27 ≤ 31` バイト → 名前と UUID が
両方とも主パケットに収まる。

## macOS の制約（実測で確定したこと）

- **同一 Mac 内では送受信できない。** CoreBluetooth は自ホストの広告を自分のスキャナへ返さない。
  → テストには **Mac 2 台**が必要（または受信を別デバイスに）。
- **広告に載せられるのは Local Name と Service UUID だけ。**
  **Manufacturer Data は OS が拒否**する（bleno の `startAdvertisingWithEIRData` は mac ではスタブ＝無動作）。
- **レガシー広告は 1 パケット 31 バイト上限。** 長い Local Name と 128bit UUID を併用すると名前が
  スキャンレスポンスに追い出され、LightBlue 等では「unnamed」に見える（noble では読める）。
  → 名前を短く保つことで両方を主パケットに収める。
- **Bluetooth 権限が必要。** GUI の Terminal.app / iTerm から起動し、初回の許可ダイアログを許可する。
  VS Code 統合ターミナル等では権限プロンプトが出ず `poweredOn` にならないことがある。

## セットアップ

```bash
bun install
bun pm trust --all   # ネイティブビルド（node-gyp）を許可
```

### ネイティブビルドが `distutils` エラーで失敗する場合

Python 3.12+ は `distutils` を削除済みで、同梱の古い node-gyp が動かない。Python 3.11 でビルドし直す:

```bash
export PYTHON=/opt/homebrew/bin/python3.11
export npm_config_python=/opt/homebrew/bin/python3.11
(cd node_modules/xpc-connect       && npx node-gyp rebuild)
(cd node_modules/@abandonware/bleno && npx node-gyp rebuild)
(cd node_modules/@abandonware/noble && npx node-gyp rebuild)  # node 22 は prebuilt 無し
```

（`brew install python@3.11` で導入可能）

## 実行

ヘルパ `ble.sh` 経由が簡単（`doctor` で事前チェック可）:

```bash
./ble.sh doctor                    # ランタイム/依存/Bluetooth の確認
./ble.sh broadcast NODE1 WORLD     # Mac A: 発信
./ble.sh scan                      # Mac B: 受信
```

直接実行する場合:

```bash
# Mac A（発信）  引数: <name> <data>
node mock/broadcaster.js                 # name="ALLO"  data="HELLO"
node mock/broadcaster.js NODE1 WORLD     # name="NODE1" data="WORLD"

# Mac B（受信）
node mock/scanner.js
```

### 期待する出力

Mac A:
```
[args] NAME (識別) = "NODE1" (5B)
[args] DATA (本文) = "WORLD" (5B)
[bleno] stateChange -> poweredOn
[bleno] advertisingStart OK
[bleno] advertising
         localName  (識別) = "NODE1"
         serviceUuid(データ) = a110cafe0105574f524c440000000000
```

Mac B:
```
[noble] stateChange -> poweredOn
[noble] recv  name(識別)="NODE1"  seq=1  body(データ)="WORLD"  rssi=-52
```

受信側で `name` と `body` が分離して出れば、ブロードキャスト通信成立。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `mock/packet.js` | 共有設定。Service UUID への encode/decode、識別子定義 |
| `mock/broadcaster.js` | 発信側 (bleno)。`<name> <data>` を広告。**Mac A** |
| `mock/scanner.js` | 受信側 (noble)。magic UUID で絞って復号。**Mac B** |
| `mock/debug-scan.js` | デバッグ用。全広告の生ダンプ（受信が拾えない時の切り分け） |
| `ble.sh` | broadcast/scan/both/doctor のヘルパ |

## 制限と次のステップ

- 現状ペイロードは **1 広告あたり最大 10 バイト**（Service UUID の空き）。
- **数十バイトを送るには**、`seq` を使ったフラグメント分割（複数広告へ分割→受信側で再結合）が必要。
- その先で **Electron/React** の main プロセスへ `bleno`/`noble` を組み込み、UI と接続する。
