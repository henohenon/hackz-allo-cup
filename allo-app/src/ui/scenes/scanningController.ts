// 受け取るシーンの受信コントローラ。
// シーン入室で SCANNING へ → window.ble.onPacket で生 UUID を受け取り unpack。
// パケットごとに段ボール演出を 1 つ流し、seq 順に並べ替えてから DB へ蓄積する。
// 離脱（戻る）で必ず flushAll → IDLE。データを取りこぼさない。

import { unpackAdvertise } from "../../ble/pack";
import { getSequence } from "../../audio/sequence";
import { configure as configureBuffer, flushAll, push as pushBuffer } from "../../db/sessionBuffer";

export interface ScanningBeltView {
  /** パケット受信時に段ボールを 1 つ流す（左右ランダム）。 */
  spawnArrival(): void;
}

export interface ScanningController {
  start(view: ScanningBeltView): Promise<void>;
  requestExit(onGone: () => void): void;
  dispose(): Promise<void>;
}

/** セッション単位の seq 復元状態。nextExpected から連続する分だけ DB へ流す。 */
interface SessionSeqState {
  nextExpected: number;
  pending: Map<number, string>;
}

/**
 * 1 パケット分の文字を seq 復元バッファへ投入し、確定できた文字列を返す。
 * - seq < nextExpected … 既に確定済みの再送。無視。
 * - seq === nextExpected … 確定し、pending から連続分をまとめて返す。
 * - seq > nextExpected … 欠番待ちのため pending へ保留（同一 seq の再送は無視）。
 */
export function ingestSeqChar(state: SessionSeqState, seq: number, char: string): string {
  if (seq < state.nextExpected || state.pending.has(seq)) return "";

  if (seq > state.nextExpected) {
    state.pending.set(seq, char);
    return "";
  }

  let out = char;
  state.nextExpected += 1;
  while (state.pending.has(state.nextExpected)) {
    out += state.pending.get(state.nextExpected)!;
    state.pending.delete(state.nextExpected);
    state.nextExpected += 1;
  }
  return out;
}

export function createScanningController(): ScanningController {
  let beltView: ScanningBeltView | null = null;
  let exited = false;
  let cleanupDone = false;
  let cleanupPromise: Promise<void> | null = null;
  let unsubPacket: (() => void) | null = null;

  // 直前に処理した Service UUID（32桁hex・正規化済み）。allowDuplicates により
  // 全く同じパケット（= 同一 UUID）が連続で大量に届くので、直前と同一なら丸ごと捨てる。
  let lastUuid: string | null = null;

  // セッションごとの seq 復元状態。到着順ではなく seq 0,1,2… の連続が揃った分だけ DB へ積む。
  const seqStateBySession = new Map<string, SessionSeqState>();

  // sessionBuffer はモジュールグローバル設定。受信中は中間フラッシュを抑え（append+上書き
  // モデルで途中保存すると先行内容を切り詰めるため）、離脱時の flushAll に一本化する。
  let prevBufferOpts: { idleMs: number; maxWaitMs: number } | null = null;

  /** 生 serviceUuids 配列を受け取り、新規パケットのみ演出＋（新規 seq なら）DB 蓄積。 */
  function onPacket(serviceUuids: string[]) {
    if (exited || cleanupDone) return;
    for (const raw of serviceUuids) {
      // 比較・unpack 用に正規化（ハイフン除去・小文字化）。
      const uuid = raw.replace(/-/g, "").toLowerCase();
      // 全く同じ UUID は同一パケットの重複受信。演出も蓄積もせず丸ごとスルー。
      if (uuid === lastUuid) continue;
      lastUuid = uuid;

      let decoded: { sessionId: string; seq: number; char: string };
      try {
        decoded = unpackAdvertise(uuid);
      } catch {
        continue; // HAKO 以外・規格外長の UUID 等は無視。
      }
      const { sessionId, seq, char } = decoded;
      if (!char) continue; // パディングのみ等の空文字は捨てる。

      // 荷物が届いた演出は「新規 UUID のパケット」ごとに 1 回行う。
      beltView?.spawnArrival();

      let seqState = seqStateBySession.get(sessionId);
      if (!seqState) {
        seqState = { nextExpected: 0, pending: new Map() };
        seqStateBySession.set(sessionId, seqState);
      }
      const confirmed = ingestSeqChar(seqState, seq, char);
      if (confirmed) {
        pushBuffer(sessionId, confirmed);
        // 1 パケットで複数文字が連続確定した場合も、確定文字数ぶん鳴らす。
        for (let i = 0; i < confirmed.length; i++) {
          getSequence().playBlip("A5", "32n");
        }
      }
    }
  }

  function cleanup(): Promise<void> {
    if (cleanupPromise) return cleanupPromise;
    cleanupDone = true;
    exited = true;
    if (unsubPacket) {
      unsubPacket();
      unsubPacket = null;
    }
    if (prevBufferOpts) {
      configureBuffer(prevBufferOpts);
      prevBufferOpts = null;
    }
    // 保持している全データを必ず IndexedDB へ確定してから IDLE に戻す。
    const flushP = flushAll().catch((e) => console.warn("[scanning] flushAll 失敗:", e));
    const idleP = window.ble
      ? window.ble
          .setStatus("IDLE")
          .catch((e) => console.warn("[scanning] setStatus(IDLE) 失敗:", e))
      : Promise.resolve();
    cleanupPromise = Promise.all([flushP, idleP]).then(() => undefined);
    return cleanupPromise;
  }

  return {
    async start(view: ScanningBeltView) {
      beltView = view;

      // 受信中は中間フラッシュを抑止し、離脱の flushAll に一本化する。
      prevBufferOpts = { idleMs: 8000, maxWaitMs: 30000 };
      configureBuffer({ idleMs: 24 * 60 * 60 * 1000, maxWaitMs: 24 * 60 * 60 * 1000 });

      // 取りこぼしを避けるため、購読は入室直後に同期で張る
      // （トランジションの覆い中に来たパケットも DB へ記録する）。
      // setStatus は BLE 起動待ち（最大数秒）があり得るので await せず、
      // トランジションのめくりをブロックしない。
      if (window.ble) {
        unsubPacket = window.ble.onPacket(onPacket);
        void window.ble
          .setStatus("SCANNING")
          .then((r) => {
            if (!r.ok) console.warn("[scanning] setStatus(SCANNING) failed:", r.error);
          })
          .catch((e) => console.warn("[scanning] setStatus(SCANNING) 失敗:", e));
      } else {
        console.log("[scanning] window.ble 不在（ブラウザ起動）。受信演出のみ。");
      }
    },

    requestExit(onGone: () => void) {
      if (exited) {
        onGone();
        return;
      }
      exited = true;
      // 購読だけは即解除し、これ以上の演出・蓄積を止める。
      if (unsubPacket) {
        unsubPacket();
        unsubPacket = null;
      }
      // 実 flush/IDLE/configure 戻しは scene.dispose の cleanup() で行う。
      onGone();
    },

    async dispose() {
      await cleanup();
    },
  };
}
