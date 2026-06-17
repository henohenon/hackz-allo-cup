# 設計ノート（思想・判断の根拠）

このモックがなぜ今の形になっているか、の記録。経緯は [investigation.md](./investigation.md) を参照。

## 目的

`@abandonware/bleno`（発信）と `@abandonware/noble`（受信）で、**BLE 広告ブロードキャストによる
パケット通信が成立するか**を最小構成で確認する。最終的には Electron/React アプリの main プロセスへ
組み込む前提だが、まずは「届くか」を Node スクリプトで切り分ける。

## 前提制約（macOS）

設計はすべてこの制約から逆算されている。詳細・実測の経緯は investigation.md。

1. **同一 Mac 内ループバック不可** — CoreBluetooth は自ホストの広告を自分のスキャナに返さない。
   → 動作確認は最低 **Mac 2 台**。
2. **広告に載せられるのは Local Name と Service UUID のみ** — Manufacturer Data は OS が拒否
   （bleno の EIR 経路 `startAdvertisingWithEIRData` は mac ではスタブ＝無動作）。
3. **レガシー広告 31 バイト上限** — フィールドを詰め込むと溢れる。
4. **Bluetooth 権限（TCC）** — GUI Terminal から起動して許可しないと `poweredOn` にならない。

## 主要な設計判断

### 判断1: 名前とデータを「別フィールド」に分離する

ペイロードを Local Name に hex で詰める案もあったが、**デバイス名とデータを混在させるのは筋が悪い**
（名前が識別子として機能しなくなる、可読性が落ちる）。本来 Manufacturer Data でやりたいが mac では不可。

→ Mac で使える 2 フィールドを役割分担させる：

| フィールド | 役割 |
| --- | --- |
| **Local Name** | デバイス識別子（短い固定名） |
| **Service UUID (128bit)** | データチャンネル（Manufacturer Data の代替） |

### 判断2: Local Name は短く保つ（8 バイト以内）

31 バイト制約の中で **名前と UUID を両方とも主パケットに収める**ため。

```
flags(3) + Service UUID(2+16=18) + Local Name AD(2+N)  ≤ 31
→ N ≤ 8
```

名前が長いと名前がスキャンレスポンスに追い出され、LightBlue 等のスキャナで「unnamed」に見える
（noble は読めるが、デバッグ時に混乱する）。識別子は短い方が確実。

### 判断3: ペイロードは Service UUID に符号化（magic + seq + len + body）

```
[0..3]  magic a110cafe : 固定マーカー。受信側が自分宛だけ拾うため
[4]     seq            : シーケンス番号（将来のフラグメント分割の土台）
[5]     len            : body 有効長
[6..15] body           : 本体（最大 10 バイト）
```

- **magic を先頭に置く理由**: ペイロードが変わると UUID 全体が変わるため、noble のハードウェア
  フィルタ（固定 UUID 指定）が使えない。全スキャンして JS 側で先頭 4 バイトを見て自分宛を判定する。
- **seq を持つ理由**: 今は 1 固定だが、数十バイトを送るときの分割・再結合のキーになる。

### 判断4: 動作確認の「正」は noble であって LightBlue ではない

LightBlue（スマホ）はスキャンレスポンスの内容を安定表示しないことがあり、検証ツールとしては不正確。
最終的な受信判定は **noble（2 台目の Mac）** で行う。LightBlue は「電波が出ているか」の粗い確認まで。

## 既知の制限と次段階

- ペイロードは **1 広告あたり最大 10 バイト**（Service UUID の空き）。
- **数十バイト**送るには `seq` ベースのフラグメント分割（複数広告へ分割→受信側で再結合）が必要。
- その後 Electron/React の main プロセスへ `bleno`/`noble` を載せ、UI と接続する。
