import { Capacitor } from "@capacitor/core";
import { HakoBle } from "./hakoBlePlugin";
import type { BleApi } from "./types";

/**
 * Capacitor ネイティブ上で `window.ble` を注入する（受信専用）。
 * Electron preload と同じ契約なので scanningController はそのまま動く。
 */
export function installCapacitorBleBridge(): void {
  if (!Capacitor.isNativePlatform()) return;
  if (window.ble) return;

  const api: BleApi = {
    capabilities: { advertise: false, scan: true },
    setStatus: (status) => HakoBle.setStatus({ status }),
    advertise: (serviceUuids) => HakoBle.advertise({ serviceUuids }),
    onPacket: (callback) => {
      let handle: Awaited<ReturnType<typeof HakoBle.addListener>> | null = null;
      let removed = false;
      void HakoBle.addListener("packet", (event) => {
        callback(event.serviceUuids ?? []);
      }).then((h) => {
        if (removed) {
          void h.remove();
        } else {
          handle = h;
        }
      });
      return () => {
        removed = true;
        void handle?.remove();
      };
    },
  };

  window.ble = api;
}
