# 調査記録（経緯・実測・回り道）

「なぜそう言えるのか」を後から辿れるようにした記録。回り道や誤った結論も、再発防止のため残す。
結論だけ欲しい場合は [design.md](./design.md) へ。

## 環境

- macOS 26.0.1 / Apple Silicon
- Node v22.9.0 / bun 1.1.40
- Bluetooth: 内蔵（BCM_4387）

## 1. ネイティブビルドの壁（distutils）

`bun install` 後、`@abandonware/bleno` / `noble` / `xpc-connect` の postinstall（node-gyp）が
`ModuleNotFoundError: No module named 'distutils'` で失敗。

- 原因: システム既定が **Python 3.13**。3.12+ で `distutils` が標準ライブラリから削除され、
  同梱の古い node-gyp が動かない。
- 対処: **Python 3.11** を node-gyp に使わせて rebuild。

```bash
export PYTHON=/opt/homebrew/bin/python3.11
export npm_config_python=/opt/homebrew/bin/python3.11
(cd node_modules/<pkg> && npx node-gyp rebuild)
```

- noble は node 22 (ABI 127) の prebuilt が無く、必ずソースビルドが要る。

## 2. Bluetooth 権限（TCC）

エージェント（非 GUI）のシェルから起動すると `stateChange` が `poweredOn` にならず、
`noble.state` は `unknown` のまま **SIGABRT でクラッシュ**。

- 原因: macOS の Bluetooth 権限プロンプトは GUI に紐づくプロセスにしか出ない。
- 結論: **GUI の Terminal.app / iTerm から起動**して許可する必要がある。CI 等では不可。

## 3. 「同一 Mac で送受信」は不可

bleno と noble を同じ Mac で動かしても受信側に出ない。

- CoreBluetooth は自ホストの広告を自分のスキャナへ返さない仕様。
- 結論: テストは **Mac 2 台**（または受信を別デバイス）。

## 4. 回り道：Local Name が「unnamed」問題（重要・反省点）

LightBlue（スマホ）で発信機を探すと、Service UUID（`FFE0CAFE...`）は見えるのに
**名前が "unnamed"** だった。

### 誤った結論（一度ここで間違えた）

> 「macOS は bleno が指定した Local Name を広告できない」

…と早合点し、UUID 符号化方式へ切り替えようとした。**LightBlue の表示だけを根拠にしたのが誤り。**

### 検証して分かった真相

ソースを直接読んだ：

- `bleno/lib/mac/src/ble_peripheral_manager.mm` → `startAdvertising` は
  `CBAdvertisementDataLocalNameKey: name` を**ちゃんと渡している**。
- `noble/lib/mac/src/ble_manager.mm:54` → 受信時に `CBAdvertisementDataLocalNameKey` を
  **読んで `localName` にしている**。

つまり bleno→noble なら名前は届く。"unnamed" の正体は **31 バイト超過**だった：

```
flags(3) + 128bit UUID(18) = 21 → 残り 10 バイト
"ALLO-TEST"(9文字) は AD で 11 バイト → 主パケットに入らず
→ Local Name がスキャンレスポンスへ追い出される
→ LightBlue はそれを安定表示せず "unnamed"
```

### 実証

`Service UUID を外して名前だけ`で広告 → LightBlue に「ALLOAPP」が**出た**。
名前は飛ばせる。前回の失敗は UUID 併用による溢れだったと確定。

### 教訓

- **1 つの曖昧なツール（LightBlue）の表示だけで結論を出さない。**
- **ソースを読む＋実測で裏を取る。** 特に「できない」と言う前に。

## 5. Manufacturer Data は mac では送れない

「名前とデータを分けたいなら Manufacturer Data では？」を検証。

- `bleno/lib/mac/src/bleno_mac.mm:89` → `StartAdvertisingWithEIRData` は
  **`NSLog` して `return` するだけのスタブ**。iBeacon も同様。
- mac で実際に動く広告は `startAdvertising(name, serviceUuids)` のみで、これは
  `CBAdvertisementDataLocalNameKey` と `CBAdvertisementDataServiceUUIDsKey` しか設定しない。
- これは bleno の都合ではなく **Apple の制約**（Peripheral 広告に載るキーは Local Name と
  Service UUID の 2 つだけ）。

逆に **受信側（noble）は Manufacturer Data を読める**（`ble_manager.mm:65`）。
→ 将来 Manufacturer Data を使うなら、**発信機を Mac 以外**（Linux/RaspberryPi 等）にする必要がある。

### 切り分け（よくある誤解）

「使えない」理由は規格でもライブラリの未実装でもなく、**macOS / CoreBluetooth の API 制約**。

- **規格の問題ではない**: Manufacturer Specific Data は AD type `0xFF` として BLE 初期（レガシー広告）から存在し、
  レガシー広告は全 Bluetooth バージョンでサポートされる。「古い規格に Manufacturer Data がない」は誤り。
  （Bluetooth 5.0 の extended advertising は 31B→255B の拡張で、Manufacturer Data の有無とは別の話。）
- **ライブラリの未実装でもない**: bleno は `startAdvertisingWithEIRData`（生 EIR＝Manufacturer Data 含む）を
  **Linux では実装している**。やれるならやっている。mac だけスタブ（上記 `bleno_mac.mm:89`）なのは、
  CoreBluetooth(XPC) 経由で生 EIR を渡す口を **Apple が用意していない**から。
- 結論: **Apple が `CBPeripheralManager.startAdvertising` で Local Name / Service UUID 以外のキーを
  受け付けない**ことが根本原因。bleno が新しくなっても macOS では解決しない（OS 側の API 追加待ち）。

参考: bleno README（`startAdvertisingWithEIRData` は Linux only）、
Apple Developer Forums（CoreBluetooth advertisement RAW data）、Silicon Labs / Novel Bits（AD type と広告基礎）。

## 6. 着地点

Mac で使える 2 フィールドを役割分担：**Local Name=識別子 / Service UUID=データ**。
名前を短く（≤8B）保てば名前と UUID が両方主パケットに収まり（27/31 バイト）、
LightBlue でも noble でも両方見える。詳細は [design.md](./design.md)。
