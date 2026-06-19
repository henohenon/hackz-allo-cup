'use strict';

// ===== 受信側 / Scanner (@abandonware/noble) =====
// Mac B で実行。Service UUID に magic を持つ広告だけ拾い、
//   Local Name  = デバイス識別子
//   Service UUID = ペイロード
// を分離して取り出す。
//
//   node mock/scanner.js

const noble = require('@abandonware/noble');
const { MAGIC, pickOurUuid, decodeUuid } = require('./packet');

const seen = new Map(); // peripheral.id -> "seq:body"（重複ログ抑制）

noble.on('stateChange', (state) => {
  console.log('[noble] stateChange ->', state);
  if (state === 'poweredOn') {
    console.log(`[noble] scanning... (serviceUuid が "${MAGIC}" で始まる広告だけ拾う)`);
    // UUID が seq/body で毎回変わるため HW フィルタは使えない → 全スキャンして JS 側で magic 判定
    noble.startScanning([], true, (err) => {
      if (err) console.error('[noble] startScanning error:', err);
    });
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', (peripheral) => {
  const adv = peripheral.advertisement || {};
  const ourUuid = pickOurUuid(adv.serviceUuids);
  if (!ourUuid) return; // データチャンネル(magic UUID)が無ければ無視

  const pkt = decodeUuid(ourUuid);
  const key = `${pkt.seq}:${pkt.bodyUtf8}`;
  if (seen.get(peripheral.id) === key) return; // 同一内容の連続表示を抑制
  seen.set(peripheral.id, key);

  console.log(
    `[noble] recv  name(識別)="${adv.localName || ''}"  ` +
      `seq=${pkt.seq}  body(データ)="${pkt.bodyUtf8}"  ` +
      `rssi=${peripheral.rssi}`
  );
});

process.on('SIGINT', () => {
  console.log('\n[noble] stopping...');
  noble.stopScanning();
  setTimeout(() => process.exit(0), 300);
});
