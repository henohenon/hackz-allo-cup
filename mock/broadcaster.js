'use strict';

// ===== 発信側 / Broadcaster (@abandonware/bleno) =====
// Mac A で実行。
//   Local Name   = 第1引数（識別子）
//   Service UUID  = 第2引数を符号化（データチャンネル）
// の 2 フィールドに分離して広告する。
//
//   node mock/broadcaster.js                 → name="ALLO"  data="HELLO"
//   node mock/broadcaster.js NODE1           → name="NODE1" data="HELLO"
//   node mock/broadcaster.js NODE1 WORLD     → name="NODE1" data="WORLD"
//   node mock/broadcaster.js "ALLO" "hi all" → 空白入りは引用符で

const bleno = require('@abandonware/bleno');
const { DEVICE_NAME, MAX_BODY, encodeUuid, decodeUuid } = require('./packet');

// 位置引数: [name] [data]
const NAME = process.argv[2] || DEVICE_NAME;
const DATA = process.argv[3] !== undefined ? process.argv[3] : 'HELLO';

// 名前は短く保つ（主パケットに名前と UUID を同居させる上限）:
//   31 - flags(3) - uuid AD(18) - name AD header(2) = 8 バイト
const MAX_NAME = 8;

const nameBytes = Buffer.byteLength(NAME);
const dataBytes = Buffer.byteLength(DATA);

// 起動直後に「受け取った引数」をエコー（BLE 状態に関係なく必ず出る）
console.log('========================================');
console.log('[args] raw argv :', JSON.stringify(process.argv.slice(2)));
console.log(`[args] NAME (識別) = "${NAME}" (${nameBytes}B)`);
console.log(`[args] DATA (本文) = "${DATA}" (${dataBytes}B)`);
console.log('========================================');

if (dataBytes > MAX_BODY) {
  console.error(`data が長すぎます: ${dataBytes}B > ${MAX_BODY}B（フラグメント分割は次段階）`);
  process.exit(1);
}
if (nameBytes > MAX_NAME) {
  console.warn(
    `[警告] name が ${nameBytes}B で ${MAX_NAME}B 超過 → 名前がスキャンレスポンスに回り、LightBlue では見えにくい` +
      `（noble では引き続き読めます）`
  );
}

const SEQ = 1;
const dataUuid = encodeUuid(SEQ, DATA);

bleno.on('stateChange', (state) => {
  console.log('[bleno] stateChange ->', state);
  if (state === 'poweredOn') {
    bleno.startAdvertising(NAME, [dataUuid], (err) => {
      if (err) return console.error('[bleno] startAdvertising error:', err);
      const dec = decodeUuid(dataUuid);
      console.log('[bleno] advertising');
      console.log(`         localName  (識別) = "${NAME}" (${nameBytes}B)`);
      console.log(`         serviceUuid(データ) = ${dataUuid}`);
      console.log(`         → seq=${dec.seq} len=${dec.len} body="${dec.bodyUtf8}"`);
      console.log('Ctrl+C で停止');
    });
  } else {
    bleno.stopAdvertising();
  }
});

bleno.on('advertisingStart', (err) => {
  if (err) console.error('[bleno] advertisingStart error:', err);
  else console.log('[bleno] advertisingStart OK');
});

process.on('SIGINT', () => {
  console.log('\n[bleno] stopping...');
  bleno.stopAdvertising(() => process.exit(0));
  setTimeout(() => process.exit(0), 300);
});
