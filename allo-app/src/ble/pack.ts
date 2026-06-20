// MVP 平文パケット: 16Byte → 32 桁 hex Service UUID。
// sessionId(4) + seq(2) + char UTF-8(10)。codec は使わない。

const PAYLOAD_BYTES = 16;
const SESSION_BYTES = 4;
const SEQ_BYTES = 2;
/** 1 文字の UTF-8 を載せる領域（バイト）。 */
export const CHAR_FIELD_BYTES = 10;

/** バイト列を小文字 hex に。 */
export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** 32 桁 hex を 16Byte に。 */
function fromHex(hex: string): Uint8Array {
  const normalized = hex.replace(/-/g, "").toLowerCase();
  if (normalized.length !== PAYLOAD_BYTES * 2) {
    throw new Error(`hex は ${PAYLOAD_BYTES * 2} 桁である必要があります: ${hex}`);
  }
  const out = new Uint8Array(PAYLOAD_BYTES);
  for (let i = 0; i < PAYLOAD_BYTES; i++) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 4Byte の sessionId を新規生成する。 */
export function createSessionId(): Uint8Array {
  const id = new Uint8Array(SESSION_BYTES);
  crypto.getRandomValues(id);
  return id;
}

/** sessionId の DB キー文字列（8 桁 hex）。 */
export function sessionIdKey(sessionId: Uint8Array): string {
  if (sessionId.length !== SESSION_BYTES) {
    throw new Error(`sessionId は ${SESSION_BYTES} バイトである必要があります`);
  }
  return toHex(sessionId);
}

// 書記素クラスタ単位で長さを数えるための Segmenter（再利用）。
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * UI/受理層から渡された 1 書記素が pack 可能か判定する。
 * - ちょうど 1 書記素（家族絵文字や ZWJ シーケンスは 1 単位）
 * - UTF-8 が CHAR_FIELD_BYTES 以内
 * - 制御/書式/サロゲート/私用などの非印字文字は不可（受信側で空に化けたり拍に乗らない）
 */
export function isPackableChar(char: string): boolean {
  if (char.length === 0) return false;
  if (/\p{C}/u.test(char)) return false;
  const segments = Array.from(graphemeSegmenter.segment(char));
  if (segments.length !== 1) return false;
  return new TextEncoder().encode(char).length <= CHAR_FIELD_BYTES;
}

/** 1 文字を 10Byte 領域に UTF-8 エンコード（ゼロパディング）。 */
function encodeCharField(char: string): Uint8Array {
  if (!isPackableChar(char)) {
    throw new Error(`送信できない文字です (1 文字・UTF-8 ${CHAR_FIELD_BYTES}B 以内): "${char}"`);
  }
  const encoded = new TextEncoder().encode(char);
  const field = new Uint8Array(CHAR_FIELD_BYTES);
  field.set(encoded);
  return field;
}

/** 10Byte 領域から 1 文字を UTF-8 デコード。 */
function decodeCharField(field: Uint8Array): string {
  let end = field.length;
  while (end > 0 && field[end - 1] === 0) end--;
  if (end === 0) return "";
  return new TextDecoder().decode(field.subarray(0, end));
}

/**
 * 平文パケットを 32 桁 hex Service UUID に pack する。
 * @param sessionId 4 バイト
 * @param seq 0..65535
 * @param char 1 文字（UTF-8 で CHAR_FIELD_BYTES 以内）
 */
export function packAdvertise(sessionId: Uint8Array, seq: number, char: string): string {
  if (sessionId.length !== SESSION_BYTES) {
    throw new Error(`sessionId は ${SESSION_BYTES} バイトである必要があります`);
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffff) {
    throw new Error(`seq は 0..65535 の整数である必要があります: ${seq}`);
  }

  const payload = new Uint8Array(PAYLOAD_BYTES);
  payload.set(sessionId, 0);
  payload[4] = (seq >> 8) & 0xff;
  payload[5] = seq & 0xff;
  payload.set(encodeCharField(char), SESSION_BYTES + SEQ_BYTES);
  return toHex(payload);
}

/** 32 桁 hex Service UUID から平文パケットを unpack する。 */
export function unpackAdvertise(hex32: string): {
  sessionId: string;
  seq: number;
  char: string;
} {
  const payload = fromHex(hex32);
  const sessionId = toHex(payload.subarray(0, SESSION_BYTES));
  const seq = (payload[4]! << 8) | payload[5]!;
  const char = decodeCharField(payload.subarray(SESSION_BYTES + SEQ_BYTES));
  return { sessionId, seq, char };
}
