'use strict';

// ===== デバッグ受信: 全広告の生ダンプ =====
// Mac B で実行。フィルタせず、Local Name か Service UUID を持つ広告を全部出す。
// 自分の broadcaster（MAGIC 付き UUID / DEVICE_NAME）には "<-- MINE" を付ける。
// scanner.js が何も拾わないときの切り分け用。
//
//   node mock/debug-scan.js

const noble = require('@abandonware/noble');
const { DEVICE_NAME, pickOurUuid } = require('./packet');

noble.on('stateChange', (state) => {
  console.log('[noble] stateChange ->', state);
  if (state === 'poweredOn') {
    console.log('[noble] scanning ALL (raw dump)...');
    noble.startScanning([], true);
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', (peripheral) => {
  const adv = peripheral.advertisement || {};
  if (!adv.localName && !(adv.serviceUuids && adv.serviceUuids.length)) return; // 完全無名は省略

  const ours = pickOurUuid(adv.serviceUuids) || adv.localName === DEVICE_NAME;
  console.log(
    `localName=${JSON.stringify(adv.localName)}  ` +
      `serviceUuids=${JSON.stringify(adv.serviceUuids)}  ` +
      `rssi=${peripheral.rssi}${ours ? '  <-- MINE' : ''}`
  );
});

process.on('SIGINT', () => {
  noble.stopScanning();
  setTimeout(() => process.exit(0), 300);
});
