// 送信側ロジック。sessionId 生成・seq 採番・encode→pack→advertise を担う。
//
// latest-wins: start() で ADVERTISE に入り、打鍵ごとに最新 1 文字を advertise([uuid]) で差し替える。
// OS が同じ広告を反復、次の文字で差し替わる（反復・最低発信時間 T の保証は Utility 責務）。

import { codecForSession, seedFromSessionId } from "./codec";
import { packServiceUuid } from "./ble/packet";
import type { BleTransport, Result } from "./ble/contract";
import type { SessionStore } from "./session/store";

/** crypto.getRandomValues で 4 バイトの sessionId を生成（Chromium context）。 */
export function newSessionId(): Uint8Array {
  const id = new Uint8Array(4);
  crypto.getRandomValues(id);
  return id;
}

export interface Sender {
  /** この送信セッションの sessionId(hex)。 */
  readonly sessionIdHex: string;
  /** ADVERTISE に入る（発信開始）。 */
  start(): Promise<Result>;
  /** 1 文字を送る（encode→pack→advertise）。成功時のみ seq を進め保存する。 */
  sendChar(char: string): Promise<Result>;
  /** 送信停止（IDLE）。 */
  stop(): Promise<Result>;
}

export interface SenderOptions {
  /** 既存セッションを再開する場合に渡す。省略時は新規生成。 */
  sessionId?: Uint8Array;
  /** 再開時の開始 seq。省略時は 0。 */
  startSeq?: number;
}

export function createSender(
  transport: BleTransport,
  store: SessionStore,
  options: SenderOptions = {},
): Sender {
  const sessionId = options.sessionId ?? newSessionId();
  const sessionIdHex = seedFromSessionId(sessionId);
  const codec = codecForSession(sessionId);
  let seq = options.startSeq ?? 0;

  return {
    sessionIdHex,

    async start() {
      return transport.setStatus("ADVERTISE");
    },

    async sendChar(char) {
      let body: Uint8Array;
      try {
        body = codec.encodeChar(char); // 文字セット外は例外
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      const uuid = packServiceUuid({ sessionId, seq, body });
      const res = await transport.advertise([uuid]);
      if (res.ok) {
        store.upsertChar(sessionIdHex, "tx", seq, char);
        seq++;
      }
      return res;
    },

    async stop() {
      store.flush();
      return transport.setStatus("IDLE");
    },
  };
}
