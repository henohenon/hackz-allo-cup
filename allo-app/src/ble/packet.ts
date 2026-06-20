// ServiceUUID パケットの pack/unpack（レンダラー責務）。
//
// レイアウト（16Byte = 128bit UUID 1 個）:
//   [0..3]   sessionId 4B   送信セッション識別 + codec seed 兼用
//   [4..5]   seq       2B   文字順（big-endian）。受信側の並べ替えキー
//   [6..15]  body     10B   その 1 文字の codec コード
//
// 【重要】送信形と受信形は非対称。
//   - 送信(bleno)は 32 桁 hex(小文字・ダッシュ無し)を受理する。
//   - 受信(noble/macOS)は CBUUID.UUIDString の生値 = 大文字・ダッシュ付き 36 文字で返る。
//   よって unpack は必ず正規化（ダッシュ除去 + 小文字化）してから解釈する。

import { toHex } from "../../electron/codec/table";

export const SESSION_BYTES = 4;
export const SEQ_BYTES = 2;
export const BODY_BYTES = 10; // = codec の CODE_BYTES
export const PACKET_BYTES = SESSION_BYTES + SEQ_BYTES + BODY_BYTES; // 16

const SEQ_OFFSET = SESSION_BYTES; // 4
const BODY_OFFSET = SESSION_BYTES + SEQ_BYTES; // 6
const MAX_SEQ = 0xffff;

/** unpack した結果。pack の入力と同形。 */
export interface PacketFields {
  /** 4 バイト。 */
  sessionId: Uint8Array;
  /** 0..65535。 */
  seq: number;
  /** 10 バイト。 */
  body: Uint8Array;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * パケットを 128bit ServiceUUID 文字列（32 桁小文字 hex・ダッシュ無し）に pack する。
 * @throws sessionId/body の長さや seq 範囲が不正なとき。
 */
export function packServiceUuid({ sessionId, seq, body }: PacketFields): string {
  if (sessionId.length !== SESSION_BYTES) {
    throw new Error(`sessionId は ${SESSION_BYTES} バイト必須: ${sessionId.length}`);
  }
  if (body.length !== BODY_BYTES) {
    throw new Error(`body は ${BODY_BYTES} バイト必須: ${body.length}`);
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    throw new Error(`seq は 0..${MAX_SEQ} の整数必須: ${seq}`);
  }
  const buf = new Uint8Array(PACKET_BYTES);
  buf.set(sessionId, 0);
  new DataView(buf.buffer).setUint16(SEQ_OFFSET, seq, false); // big-endian
  buf.set(body, BODY_OFFSET);
  return toHex(buf);
}

/**
 * ServiceUUID 文字列を unpack する。大文字・ダッシュ付き(36 文字)も受理。
 * 正規化後 32 桁 hex でない（破損・16bit 縮約・他広告）場合は null。
 */
export function unpackServiceUuid(uuid: string): PacketFields | null {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  if (hex.length !== PACKET_BYTES * 2) return null;
  if (!/^[0-9a-f]+$/.test(hex)) return null;

  const buf = hexToBytes(hex);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    sessionId: buf.slice(0, SESSION_BYTES),
    seq: view.getUint16(SEQ_OFFSET, false),
    body: buf.slice(BODY_OFFSET),
  };
}
