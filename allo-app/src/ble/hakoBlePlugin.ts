import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { BleResult, BleStatus } from "./types";

/** Capacitor ネイティブ側 `HakoBle` プラグインの型。 */
export interface HakoBlePlugin {
  setStatus(options: { status: BleStatus }): Promise<BleResult>;
  advertise(options: { serviceUuids: string[] }): Promise<BleResult>;
  addListener(
    eventName: "packet",
    listenerFunc: (event: { serviceUuids: string[] }) => void,
  ): Promise<PluginListenerHandle>;
}

export const HakoBle = registerPlugin<HakoBlePlugin>("HakoBle");
