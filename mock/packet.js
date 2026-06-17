'use strict';

// ===== 共有設定 / Shared config =====
//
// 【macOS で実測した事実】
//   - Local Name : 広告できる（noble で読める）
//   - Service UUID: 広告できる（noble で読める）
//   - Manufacturer Data: OS が拒否（bleno の EIR 経路は mac ではスタブ＝送れない）
//
// よって名前とデータを「別フィールド」に分離する設計:
//   - Local Name  = デバイス識別子（短く固定。データは載せない）
//   - Service UUID = データチャンネル（Manufacturer Data の代わり）
//
// 31 バイト制約の収まり: flags(3) + UUID(18) + name("ALLO"=2+4) = 27 ≤ 31 →
// 名前と UUID が両方とも主パケットに収まる（前回の overflow を回避）。
//
// Service UUID(16 byte) のレイアウト:
//   [0..3]  magic : データチャンネルの目印（固定）。受信側のフィルタに使う
//   [4]     seq   : シーケンス番号 (0-255)
//   [5]     len   : body の有効バイト長
//   [6..15] body  : ペイロード本体（最大 10 バイト、ゼロ埋め）

const DEVICE_NAME = 'ALLO'; // Local Name（識別子・4 バイト＝短く保つ）
const MAGIC = 'a110cafe'; // Service UUID 先頭 4 バイト（hex）
const UUID_BYTES = 16;
const HEADER_BYTES = 4 + 1 + 1; // magic + seq + len
const MAX_BODY = UUID_BYTES - HEADER_BYTES; // 10

function normalizeUuid(uuid) {
  return (uuid || '').toLowerCase().replace(/-/g, '');
}

function encodeUuid(seq, body) {
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (bodyBuf.length > MAX_BODY) {
    throw new Error(`body too long: ${bodyBuf.length} > ${MAX_BODY} bytes（フラグメント分割が必要）`);
  }
  const buf = Buffer.alloc(UUID_BYTES); // ゼロ埋め
  Buffer.from(MAGIC, 'hex').copy(buf, 0);
  buf[4] = seq & 0xff;
  buf[5] = bodyBuf.length;
  bodyBuf.copy(buf, 6);
  return buf.toString('hex'); // 32 文字小文字・dash 無し
}

function isOurUuid(uuid) {
  return normalizeUuid(uuid).startsWith(MAGIC);
}

function pickOurUuid(serviceUuids) {
  return (serviceUuids || []).map(normalizeUuid).find(isOurUuid) || null;
}

function decodeUuid(uuid) {
  if (!isOurUuid(uuid)) return null;
  const buf = Buffer.from(normalizeUuid(uuid), 'hex');
  const seq = buf[4];
  const len = Math.min(buf[5], MAX_BODY);
  const body = buf.subarray(6, 6 + len);
  return { seq, len, body, bodyUtf8: body.toString('utf8'), uuid: normalizeUuid(uuid) };
}

module.exports = {
  DEVICE_NAME, MAGIC, MAX_BODY,
  encodeUuid, decodeUuid, isOurUuid, pickOurUuid, normalizeUuid,
};
