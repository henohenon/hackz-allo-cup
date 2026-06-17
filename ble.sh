#!/usr/bin/env bash
#
# ble.sh — Macbook で BLE ブロードキャスト通信を試すためのヘルパ
#
# 使い方:
#   ./ble.sh broadcast [NAME] [DATA]  発信側 (Mac A)。例: ./ble.sh broadcast NODE1 WORLD
#   ./ble.sh scan                     受信側 (Mac B) を起動
#   ./ble.sh both [NAME] [DATA]       同一 Mac で発信+受信を同時起動（後述の注意あり）
#   ./ble.sh doctor                   実行前チェック（ランタイム/依存/Bluetooth）
#
# 注意:
#   - 本来は 2 台構成（Mac A=broadcast / Mac B=scan）で試すのが確実。
#   - 1 台で `both` を使っても、CoreBluetooth は自機の広告を自機の
#     スキャナへ通常渡さないため、受信側に出ないことが多い（仕様）。
#   - 初回は macOS の Bluetooth 権限ダイアログが出る。許可しないと動かない。
#     拒否してしまった場合: システム設定 > プライバシーとセキュリティ >
#     Bluetooth でターミナル/iTerm を有効化する。

set -euo pipefail

cd "$(dirname "$0")"

# bun があれば bun、無ければ node を使う
if command -v bun >/dev/null 2>&1; then
  RUN="bun"
elif command -v node >/dev/null 2>&1; then
  RUN="node"
else
  echo "✗ bun も node も見つからない。どちらかをインストールして。" >&2
  exit 1
fi

ensure_deps() {
  if [ ! -d node_modules/@abandonware ]; then
    echo "→ 依存が未インストール。'$RUN install' を実行..."
    "$RUN" install
  fi
}

bt_state() {
  # blueutil があれば正確に、無ければ system_profiler で粗くチェック
  if command -v blueutil >/dev/null 2>&1; then
    [ "$(blueutil -p)" = "1" ] && echo on || echo off
  elif system_profiler SPBluetoothDataType 2>/dev/null | grep -qi "State: On"; then
    echo on
  else
    echo unknown
  fi
}

doctor() {
  echo "ランタイム : $RUN ($("$RUN" --version))"
  echo "依存       : $([ -d node_modules/@abandonware ] && echo インストール済み || echo 未インストール)"
  echo "Bluetooth  : $(bt_state)"
  echo
  echo "Service UUID は mock/packet.js を参照。"
  echo "Bluetooth が off / unknown の場合はメニューバーから ON にしてから実行。"
}

case "${1:-}" in
  broadcast)
    ensure_deps
    shift || true
    exec "$RUN" mock/broadcaster.js "${1:-ALLO}" "${2:-HELLO}"
    ;;
  scan)
    ensure_deps
    exec "$RUN" mock/scanner.js
    ;;
  both)
    ensure_deps
    shift || true
    NAME="${1:-ALLO}"
    DATA="${2:-HELLO}"
    echo "⚠ 1 台での同時起動はループバック非対応のことが多い（仕様）。"
    echo "  動作確認は 2 台（broadcast / scan）推奨。"
    echo
    # 受信側をバックグラウンド、発信側をフォアグラウンドで起動。
    # Ctrl-C で両方落とす。
    "$RUN" mock/scanner.js &
    SCAN_PID=$!
    trap 'kill "$SCAN_PID" 2>/dev/null || true' EXIT INT TERM
    "$RUN" mock/broadcaster.js "$NAME" "$DATA"
    ;;
  doctor)
    doctor
    ;;
  *)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
