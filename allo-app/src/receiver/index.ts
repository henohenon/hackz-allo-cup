// 受信側ロジックの配線。transport 購読 → unpack → decode → dedup → 永続化。
//
// Utility は「ALLO/HAKO の必要パケットを重複込みで全部」流す。
// 重複除去(sessionId+seq)・unpack・decode・並べ替え・連結はすべてここ（レンダラー）。

import { unpackServiceUuid } from "../ble/packet";
import { codecForSession, seedFromSessionId } from "../codec";
import type { BleTransport, PacketHit } from "../ble/contract";
import type { SessionStore } from "../session/store";

export interface Receiver {
  /** スキャン開始（SCANNING）。 */
  start(): Promise<void>;
  /** スキャン停止（IDLE）。 */
  stop(): Promise<void>;
}

/**
 * @param onUpdate セッションが更新されたときに呼ばれる（id = sessionId hex）。UI 再描画用。
 */
export function createReceiver(
  transport: BleTransport,
  store: SessionStore,
  onUpdate?: (sessionIdHex: string) => void,
): Receiver {
  // dedup: 同 {sessionId, seq} の反復ヒットを decode/persist する前に弾く。
  const seen = new Set<string>();
  let off: (() => void) | null = null;

  function handleHit(hit: PacketHit): void {
    for (const raw of hit.serviceUuids) {
      const fields = unpackServiceUuid(raw);
      if (!fields) continue; // 正規化後 32 桁でない = 破損 / 他広告

      const sessionIdHex = seedFromSessionId(fields.sessionId);
      const key = `${sessionIdHex}:${fields.seq}`;
      if (seen.has(key)) continue; // 重複除去

      const char = codecForSession(fields.sessionId).decodeChar(fields.body);
      if (char === null) continue; // 鍵違い / 未知コードは捨てる

      seen.add(key);
      store.upsertChar(sessionIdHex, "rx", fields.seq, char);
      onUpdate?.(sessionIdHex);
    }
  }

  return {
    async start() {
      if (!off) off = transport.onPacket(handleHit);
      await transport.setStatus("SCANNING");
    },
    async stop() {
      off?.();
      off = null;
      store.flush();
      await transport.setStatus("IDLE");
    },
  };
}
