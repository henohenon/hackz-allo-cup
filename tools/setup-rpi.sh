#!/usr/bin/env bash
# Raspberry Pi 4B / Raspberry Pi OS Lite 用セットアップスクリプト。
# BlueZ・ビルドツール・Node.js を入れ、依存をインストールし、
# root なしで BLE(HCI) を使えるよう node に権限を付与する。
#
# 使い方:  cd tools && ./setup-rpi.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> apt パッケージを更新・インストール"
sudo apt-get update
# bluez: BLE スタック / libbluetooth-dev: bleno/noble のネイティブビルドに必要
sudo apt-get install -y bluetooth bluez libbluetooth-dev build-essential python3

echo "==> Node.js を確認"
if ! command -v node >/dev/null 2>&1; then
  echo "    Node.js 未導入 → NodeSource (LTS) を導入します"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    node $(node -v)"

echo "==> 依存をインストール (ネイティブモジュールのビルドに数分かかる場合あり)"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
else
  npm install
fi

echo "==> node に BLE 権限を付与 (root なしで HCI を開けるようにする)"
NODE_BIN="$(readlink -f "$(command -v node)")"
sudo setcap cap_net_raw,cap_net_admin+eip "$NODE_BIN"
echo "    setcap -> $NODE_BIN"

cat <<'EOS'

==> 完了

起動:
    npm start
  または
    node ble-relay-tui.mjs

注意:
  - 単一アダプタ(hci0)で発信+受信を同時に行うと bluetoothd と競合する場合があります。
    その場合は  sudo systemctl stop bluetooth  で常駐を止めてから起動してください。
  - 単一アダプタで不安定なら USB BLE ドングルを挿し、アダプタを分けて起動:
        TX_ADAPTER=0 RX_ADAPTER=1 node ble-relay-tui.mjs
EOS
