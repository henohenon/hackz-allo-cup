// ALLO パケット (16 バイト = 128bit Service UUID 1 個) の pack/unpack。
// レイアウトは allo-app/docs/communication-design.md に準拠する:
//   [0..3]   sessionId 4B  送信セッション識別 (codec の seed も兼ねる)
//   [4..5]   seq       2B  文字順 (big-endian)
//   [6..15]  body     10B  その 1 文字のコード (このテストでは確認用ダミー)
// 広告の Local Name は "ALLO" 固定。受信側は localName === "ALLO" だけ拾う。

export const LOCAL_NAME = "ALLO";
export const PACKET_BYTES = 16;

/**
 * @param {{ sessionId: Buffer, seq: number, body: Buffer }} fields
 * @returns {Buffer} 16 バイトのパケット
 */
export function pack({ sessionId, seq, body }) {
  const buf = Buffer.alloc(PACKET_BYTES);
  sessionId.copy(buf, 0, 0, 4);
  buf.writeUInt16BE(seq & 0xffff, 4);
  body.copy(buf, 6, 0, 10);
  return buf;
}

/** 16 バイトのパケットを 128bit Service UUID 用の 32 桁 16 進文字列にする。 */
export function toServiceUuid(packet) {
  return packet.toString("hex");
}

/**
 * noble が返す Service UUID 文字列 (32 桁 hex、ダッシュ有無どちらも可) を分解する。
 * @returns {{ sessionId: Buffer, seq: number, body: Buffer } | null} 16 バイトでなければ null
 */
export function unpack(uuidHex) {
  const buf = Buffer.from(String(uuidHex).replace(/-/g, ""), "hex");
  if (buf.length !== PACKET_BYTES) return null;
  return {
    sessionId: buf.subarray(0, 4),
    seq: buf.readUInt16BE(4),
    body: buf.subarray(6, 16),
  };
}

/** このテスト用の確認しやすい body を作る。先頭 "RPI" + seq を埋めた 10B。 */
export function makeTestBody(seq) {
  const body = Buffer.alloc(10);
  body.write("RPI", 0, "ascii");
  body.writeUInt16BE(seq & 0xffff, 3);
  // 残り 5 バイトは seq から決まるパターン (受信側で変化が見える)
  for (let i = 5; i < 10; i++) body[i] = (seq + i) & 0xff;
  return body;
}
