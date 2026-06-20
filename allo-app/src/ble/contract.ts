// レンダラー内部の BLE トランスポート抽象。
//
// 実体は transport.ts（preload の window.ble = 薄い BLE I/O 層のラッパー）。
// window.ble の契約は electron/electron-env.d.ts の BleApi / BlePacket を参照。
//   - 責務はすべてレンダラー（codec / pack / 重複除去 / スケジューラ / 永続化）。
//   - Utility 側は HAKO のみを生のまま全部流す（LocalName "HAKO" 固定は Utility が持つ）。
//
// この抽象を挟むのは sender/receiver を window 非依存にしてテスト・差し替え可能にするため。

/** BLE インタフェースの状態（排他）。window.ble の BleStatus と同形。 */
export type BleInterfaceStatus = "IDLE" | "ADVERTISE" | "SCANNING";

/** パケットヒット時に届く生データ。window.ble の BlePacket と同形。 */
export interface PacketHit {
  /** noble の peripheral.id（macOS はホスト依存 UUID・送受で不一致）。 */
  id: string;
  /** Bluetooth アドレス（macOS では常に空）。dedup には使わない。 */
  address: string;
  /** 広告された Service UUID 一覧（生データ・未整形）。 */
  serviceUuids: string[];
}

/** 操作の成否。window.ble の BleResult と同形。 */
export interface Result {
  ok: boolean;
  error?: string;
}

/**
 * レンダラーが叩く BLE トランスポート。window.ble を 1:1 でラップする。
 * setStatus（排他制御）と advertise（撒く生データ更新）は分離。
 */
export interface BleTransport {
  /** インタフェースステータスを更新（排他）。 */
  setStatus(status: BleInterfaceStatus): Promise<Result>;
  /** 撒く生データ（128bit UUID hex 配列）をセット。ADVERTISE 中のみ有効。 */
  advertise(serviceUuids: string[]): Promise<Result>;
  /** パケットヒットの購読。戻り値を呼ぶと解除。 */
  onPacket(cb: (hit: PacketHit) => void): () => void;
}
