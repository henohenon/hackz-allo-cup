// BleTransport を preload の window.ble（薄い BLE I/O 層）の上に実装するアダプタ。
//
//   setStatus → window.ble.setStatus  （排他制御）
//   advertise → window.ble.advertise  （撒く生データ更新。ADVERTISE 中のみ有効）
//   onPacket  → window.ble.onPacket   （HAKO のみ生のまま全部。重複除去なし）
// window.ble 不在（ブラウザ起動）時はモック（操作は ok:false / 何も流さない）。

import type { BleTransport, PacketHit, Result } from "./contract";

const UNAVAILABLE: Result = {
  ok: false,
  error: "window.ble が利用できません（Electron 以外で起動?）",
};

function getApi(): BleApi | undefined {
  return typeof window !== "undefined" ? window.ble : undefined;
}

export function createTransport(): BleTransport {
  const api = getApi();

  return {
    async setStatus(status) {
      return api ? api.setStatus(status) : UNAVAILABLE;
    },

    async advertise(serviceUuids) {
      return api ? api.advertise(serviceUuids) : UNAVAILABLE;
    },

    onPacket(cb: (hit: PacketHit) => void) {
      if (!api) return () => {};
      // Utility が HAKO のみ・生のまま全部流す。unpack/重複除去は receiver の責務。
      return api.onPacket((p) => cb(p));
    },
  };
}
