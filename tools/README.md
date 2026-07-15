# tools — ALLO BLE リレー TUI テストツール

メンバー 2 人の間に **Raspberry Pi 4B (Raspberry Pi OS Lite)** を設置し、
BLE 広告ブロードキャストの **発信・受信をひたすら同時に行う** ための疎通テスト用ツール。

`allo-app` (Electron) とは独立した最小パッケージで、依存は BLE ネイティブモジュール
(`@stoprocent/bleno` / `@stoprocent/noble`) のみ。Electron や Pixi は入れずに済む。
ビルド不要の素の Node ESM (`.mjs`) なので、Pi 上で `node` 一発で動く。

## 画面

```
┌─ ALLO BLE relay  (TX:hci0 / RX:hci0) ───────────────────────────┐
│ host : allopi   uptime 1234s                                    │
│ IPv4 : eth0 192.168.0.42  wlan0 192.168.0.43                    │
│ BT   : TX hci0 DC:A6:32:..  |  RX hci0 DC:A6:32:..  (単一…)      │
│ TX   : ADVERTISING  name=ALLO session=a1b2c3d4 seq=37 …         │
│ RX   : SCANNING  devices=2 ads=512  bt(tx=poweredOn rx=power…)  │
├───────────────────────────────┬─────────────────────────────────┤
│ 発信 TX ▶                      │ ◀ RX 受信                       │
├───────────────────────────────┼─────────────────────────────────┤
│ 12:00:01 発信 seq=37 body=…    │ 12:00:01 e8:.. rssi=-58 seq=12  │
│ 12:00:02 発信 seq=38 body=…    │ 12:00:02 f1:.. rssi=-71 seq=5   │
└───────────────────────────────┴─────────────────────────────────┘
```

- **ヘッダー**: ホスト名 / IPv4 アドレス / Bluetooth アドレス / TX・RX の状態
- **左ペイン (発信 TX)**: 1 秒ごとに `seq` を進めてパケットを撒き直したログ
- **右ペイン (受信 RX)**: 1 秒ごとに、その間に受信した `localName === "ALLO"` 広告を集約

パケットは `allo-app/docs/communication-design.md` の仕様に準拠
(`sessionId 4B + seq 2B + body 10B = 16B` を 128bit Service UUID に載せる)。
`body` はこのツールでは確認用ダミー (`"RPI"` + seq パターン)。

## セットアップ (Raspberry Pi OS Lite)

```bash
git clone <repo> && cd hackz-allo-cup/tools
./setup-rpi.sh        # BlueZ / Node.js / pnpm / 依存 / node への BLE 権限付与
pnpm start            # = node ble-relay-tui.mjs
```

`setup-rpi.sh` がやること:
1. `bluetooth bluez libbluetooth-dev build-essential` を apt で導入
2. Node.js が無ければ NodeSource (LTS) を導入
3. pnpm を用意（無ければ corepack で有効化）し `pnpm install`（bleno/noble のネイティブビルド。数分かかることあり）
4. `setcap cap_net_raw,cap_net_admin+eip` を `node` に付与（root なしで HCI を開く）

> プロジェクトに合わせて pnpm を使う（`packageManager: pnpm@11.8.0`）。`node` で直接動かすので npm でも可。

## 起動オプション

環境変数 / フラグどちらでも指定可。

| 環境変数 | フラグ | 既定 | 説明 |
| --- | --- | --- | --- |
| `TX_ADAPTER` | `--tx-adapter <n>` | `0` | 発信に使う hci 番号 |
| `RX_ADAPTER` | `--rx-adapter <n>` | `0` | 受信に使う hci 番号 |
| `INTERVAL_MS` | `--interval <ms>` | `1000` | 発信更新・画面更新の間隔 |
| `LOCAL_NAME` | `--name <str>` | `ALLO` | 広告 Local Name |
| `NO_TUI=1` | `--no-tui` | — | TUI を使わず行ログを流す (systemd / パイプ向け) |

```bash
# 例: アダプタを分けて 0.5 秒間隔
TX_ADAPTER=0 RX_ADAPTER=1 INTERVAL_MS=500 node ble-relay-tui.mjs
```

`Ctrl-C` で発信・受信を止めて終了する。

## 単一アダプタ同時送受信について（重要）

Pi 4B の内蔵 Bluetooth はアダプタ 1 つ (`hci0`)。**発信(bleno)と受信(noble)を
同一アダプタで同時に動かす**のがこのツールの狙いだが、これは
`communication-design.md` の「懸念事項: 同時送受信の可否」に当たる未検証領域。

うまく動かないとき:

1. **bluetoothd と競合**している → 常駐を止める
   ```bash
   sudo systemctl stop bluetooth
   ```
2. **権限エラー** (`Operation not permitted` / `EPERM`) → `setcap` 済みか確認、
   または `sudo node ble-relay-tui.mjs` で起動。
3. それでも単一アダプタで不安定なら → **USB BLE ドングルを増設**して役割を分離
   ```bash
   TX_ADAPTER=0 RX_ADAPTER=1 node ble-relay-tui.mjs   # 発信=内蔵, 受信=ドングル
   ```

受信ログで `session` が自分の TX セッション ID と一致する行には `(self)` が付く
（2 アダプタ構成のとき、自分の発信を自分で受信できているかの確認に使える）。

## 常駐させる (任意)

systemd で起動させる例 (`/etc/systemd/system/allo-relay.service`):

```ini
[Unit]
Description=ALLO BLE relay
After=bluetooth.target

[Service]
Type=simple
WorkingDirectory=/home/pi/hackz-allo-cup/tools
Environment=NO_TUI=1
ExecStart=/usr/bin/node ble-relay-tui.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`NO_TUI=1` だと画面制御をやめ、`[TX]` / `[RX]` 付きの行ログを journal に流す。
```bash
sudo systemctl enable --now allo-relay
journalctl -u allo-relay -f
```
