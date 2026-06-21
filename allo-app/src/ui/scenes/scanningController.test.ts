import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Node 上の vp test 用: scanningController が参照する window.ble を polyfill する。
const globalWindow = globalThis as typeof globalThis & { window?: Window & { ble?: BleApi } };
if (!globalWindow.window) globalWindow.window = globalThis as Window & typeof globalThis;

const playBlip = vi.fn();
vi.mock("../../audio/sequence", () => ({
  getSequence: () => ({ playBlip }),
}));

const saved: { session_id: string; content: string; created_at: Date }[] = [];
vi.mock("../../db/sessionStore", () => ({
  save: vi.fn((session_id: string, content: string, created_at: Date) => {
    saved.push({ session_id, content, created_at });
    return Promise.resolve(session_id);
  }),
}));

import { packAdvertise } from "../../ble/pack";
import { configure, flushAll } from "../../db/sessionBuffer";
import { createScanningController, ingestSeqChar } from "./scanningController";

const sessionId = new Uint8Array([0xab, 0xcd, 0xef, 0x01]);

describe("createScanningController → sessionBuffer → IndexedDB", () => {
  let packetHandler: ((uuids: string[]) => void) | null = null;
  const beltView = { spawnArrival: vi.fn() };

  beforeEach(async () => {
    saved.length = 0;
    playBlip.mockClear();
    beltView.spawnArrival.mockClear();
    packetHandler = null;
    await flushAll();
    configure({ idleMs: 8000, maxWaitMs: 30000 });

    window.ble = {
      setStatus: vi.fn().mockResolvedValue({ ok: true }),
      onPacket: vi.fn((cb: (uuids: string[]) => void) => {
        packetHandler = cb;
        return () => {
          packetHandler = null;
        };
      }),
      advertise: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  function emit(uuid: string) {
    if (!packetHandler) throw new Error("onPacket not subscribed");
    packetHandler([uuid]);
  }

  test("新規 seq の文字を追記し dispose で flushAll → save される", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);

    emit(packAdvertise(sessionId, 0, "あ"));
    emit(packAdvertise(sessionId, 1, "い"));

    await ctrl.dispose();

    expect(saved).toHaveLength(1);
    expect(saved[0]!.session_id).toBe("abcdef01");
    expect(saved[0]!.content).toBe("あい");
    expect(beltView.spawnArrival).toHaveBeenCalledTimes(2);
    expect(playBlip).toHaveBeenCalledTimes(2);
  });

  test("同一 UUID 連続は演出・DB ともスキップ", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);

    const uuid = packAdvertise(sessionId, 0, "あ");
    emit(uuid);
    emit(uuid);

    await ctrl.dispose();

    expect(saved[0]!.content).toBe("あ");
    expect(beltView.spawnArrival).toHaveBeenCalledTimes(1);
    expect(playBlip).toHaveBeenCalledTimes(1);
  });

  test("逆順到着でも seq 順に DB へ蓄積する", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);

    emit(packAdvertise(sessionId, 1, "い"));
    emit(packAdvertise(sessionId, 0, "あ"));

    await ctrl.dispose();

    expect(saved[0]!.content).toBe("あい");
    expect(beltView.spawnArrival).toHaveBeenCalledTimes(2);
    expect(playBlip).toHaveBeenCalledTimes(2);
  });

  test("欠番がある間は後続 seq を保留し、埋まったら連続確定する", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);

    emit(packAdvertise(sessionId, 0, "あ"));
    emit(packAdvertise(sessionId, 2, "う"));
    emit(packAdvertise(sessionId, 1, "い"));

    await ctrl.dispose();

    expect(saved[0]!.content).toBe("あいう");
    expect(playBlip).toHaveBeenCalledTimes(3);
  });

  test("欠番が埋まらない seq は DB に積まない", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);

    emit(packAdvertise(sessionId, 0, "あ"));
    emit(packAdvertise(sessionId, 2, "う"));

    await ctrl.dispose();

    expect(saved[0]!.content).toBe("あ");
    expect(playBlip).toHaveBeenCalledTimes(1);
  });

  test("requestExit 後のパケットは無視し、既存 draft は dispose で保存", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);
    const handler = packetHandler!;

    emit(packAdvertise(sessionId, 0, "あ"));
    ctrl.requestExit(() => {});
    // 購読解除後も届き得る遅延パケットを直接流す。
    handler([packAdvertise(sessionId, 1, "い")]);

    await ctrl.dispose();

    expect(saved[0]!.content).toBe("あ");
    expect(beltView.spawnArrival).toHaveBeenCalledTimes(1);
  });

  test("同一 seq の再送は DB に重複しない", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);

    const uuid0 = packAdvertise(sessionId, 0, "あ");
    emit(uuid0);
    emit(packAdvertise(sessionId, 0, "あ"));

    await ctrl.dispose();

    expect(saved[0]!.content).toBe("あ");
    expect(playBlip).toHaveBeenCalledTimes(1);
  });

  test("ハイフン付き UUID も正規化して unpack できる", async () => {
    const ctrl = createScanningController();
    await ctrl.start(beltView);

    const hex = packAdvertise(sessionId, 0, "A");
    const hyphenated = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    emit(hyphenated);

    await ctrl.dispose();

    expect(saved[0]!.content).toBe("A");
  });
});

describe("ingestSeqChar", () => {
  test("連続 seq をそのまま確定する", () => {
    const state = { nextExpected: 0, pending: new Map<number, string>() };
    expect(ingestSeqChar(state, 0, "あ")).toBe("あ");
    expect(ingestSeqChar(state, 1, "い")).toBe("い");
    expect(state.nextExpected).toBe(2);
  });

  test("飛び番到着後に欠番が埋まればまとめて確定する", () => {
    const state = { nextExpected: 0, pending: new Map<number, string>() };
    expect(ingestSeqChar(state, 2, "う")).toBe("");
    expect(ingestSeqChar(state, 0, "あ")).toBe("あ");
    expect(ingestSeqChar(state, 1, "い")).toBe("いう");
    expect(state.nextExpected).toBe(3);
  });
});
