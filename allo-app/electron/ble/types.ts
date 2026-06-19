// noble / bleno (@stoprocent fork) の最小型定義。
// 本プロジェクトで使う API だけを宣言する (実行時 require のため型が付かない)。

/** 発信側 (bleno) の状態 / 受信側 (noble) の状態で共通して使われる文字列 */
export type BleState =
  | "unknown"
  | "resetting"
  | "unsupported"
  | "unauthorized"
  | "poweredOff"
  | "poweredOn";

type StateChangeListener = (state: BleState) => void;

/** bleno: BLE 発信 (ペリフェラル) */
export interface BlenoModule {
  readonly state: BleState;
  on(event: "stateChange", listener: StateChangeListener): void;
  on(event: "advertisingStart", listener: (error?: Error | null) => void): void;
  removeListener(event: "stateChange", listener: StateChangeListener): void;
  removeAllListeners(event?: string): void;
  startAdvertising(
    name: string,
    serviceUuids: string[],
    callback?: (error?: Error | null) => void,
  ): void;
  stopAdvertising(callback?: () => void): void;
}

/** noble が discover イベントで渡すペリフェラル */
export interface NoblePeripheral {
  id: string;
  address: string;
  rssi: number;
  advertisement: {
    localName?: string;
    manufacturerData?: Buffer;
    serviceUuids?: string[];
  };
}

type DiscoverListener = (peripheral: NoblePeripheral) => void;

/** noble: BLE 受信 (セントラル) */
export interface NobleModule {
  readonly state: BleState;
  on(event: "stateChange", listener: StateChangeListener): void;
  on(event: "discover", listener: DiscoverListener): void;
  removeListener(event: "stateChange", listener: StateChangeListener): void;
  removeListener(event: "discover", listener: DiscoverListener): void;
  startScanningAsync(serviceUuids: string[], allowDuplicates: boolean): Promise<void>;
  stopScanningAsync(): Promise<void>;
}

/** 受信したデバイス情報 (レンダラーへ渡す形) */
export interface DiscoveredDevice {
  id: string;
  address: string;
  localName: string | null;
  rssi: number;
  /** 広告された Service UUID 一覧。ここにペイロード (16Byte = 128bit UUID) を載せる */
  serviceUuids: string[];
  /** manufacturerData を 16 進文字列にしたもの (無ければ null) */
  manufacturerDataHex: string | null;
}
