// 送るシーンの送信コントローラ。
// 入力 → キュー → 4 拍ごとに場に出す → 右端発送で pack + BLE advertise + sessionBuffer。
// シーン入室で UI 準備 → トランジション後に sessionId 生成 + タイマー + ADVERTISE。離脱で IDLE + DB flush。

import { createSessionId, isPackableChar, packAdvertise, sessionIdKey } from "../../ble/pack";
import { getSequence } from "../../audio/sequence";
import { configure as configureBuffer, flushAll, push as pushBuffer } from "../../db/sessionBuffer";
import { designRectToScreen } from "../designToScreen";
import { FONT_FAMILY } from "../theme";
import {
  ADVERTISE_DISPATCH_BEATS,
  ADVERTISE_INPUT_RECT,
  ADVERTISE_MAX_CHARS,
  ADVERTISE_SESSION_SECONDS,
  ADVERTISE_SESSION_START_DELAY_MS,
} from "./advertiseBeltView";

export interface AdvertiseBeltView {
  setQueue(chars: string[]): void;
  beginTransmit(char: string, startSec?: number): void;
  setOnShipped(handler: (char: string) => void): void;
  isTransmitting(): boolean;
  stopMechanism(): void;
  setSessionRemaining(seconds: number): void;
}

export interface AdvertiseControllerOptions {
  /** 一連の終了演出が終わってタイトルへ戻すとき。 */
  onComplete: () => void;
  /** ギミック停止と同時に BGM を通常へ戻すとき（ベース・ハイハット等の追加レイヤ解除）。 */
  onRestoreBgm?: () => void;
}

/** 最終文字の発信完了 → ギミック停止までの待ち時間。 */
const FINISH_HALT_DELAY_MS = 2000;
/** ギミック停止 → タイトルへ戻るまでの待ち時間。 */
const FINISH_EXIT_DELAY_MS = 5000;
/** 送るセッションの最大稼働時間（ms）。表示の初期値と一致。 */
const SESSION_MAX_MS = ADVERTISE_SESSION_SECONDS * 1000;
/** 残り時間表示の更新間隔（ms）。 */
const SESSION_TICK_MS = 200;

export interface AdvertiseController {
  start(view: AdvertiseBeltView): Promise<void>;
  refocusInput(): void;
  requestExit(onGone: () => void): void;
  dispose(): Promise<void>;
}

// 書記素クラスタ単位で文字を受理する（合字・家族絵文字は 1 文字扱い）。
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function createAdvertiseController(
  options: AdvertiseControllerOptions,
): AdvertiseController {
  let beltView: AdvertiseBeltView | null = null;
  let sessionId!: Uint8Array;
  let sessionKey = "";
  let nextSeq = 0;
  const pendingQueue: string[] = [];
  let acceptedCount = 0;
  let finishing = false;
  let finishStarted = false;
  let haltTimer: ReturnType<typeof setTimeout> | null = null;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionDeadlineMs = 0;
  let sessionTicker: ReturnType<typeof setInterval> | null = null;
  let exited = false;
  let cleanupDone = false;
  let cleanupPromise: Promise<void> | null = null;
  let composing = false;
  let unsubDispatch: (() => void) | null = null;
  let sessionStartTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionStarted = false;
  let inputEl: HTMLInputElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let syncInputLayout: (() => void) | null = null;

  // sessionBuffer はモジュールグローバル設定なので、シーン入室時に伸ばし退出時に戻す。
  let prevBufferOpts: { idleMs: number; maxWaitMs: number } | null = null;

  const focusInput = () => {
    if (!exited && inputEl) inputEl.focus({ preventScroll: true });
  };

  const onCompositionStart = () => {
    composing = true;
  };
  const onCompositionEnd = (e: CompositionEvent) => {
    composing = false;
    if (e.data) acceptText(e.data);
    if (inputEl) inputEl.value = "";
    focusInput();
  };
  const onInput = () => {
    if (composing || exited || !inputEl) return;
    const value = inputEl.value;
    if (!value) return;
    acceptText(value);
    inputEl.value = "";
  };
  const onPointerDown = (e: PointerEvent) => {
    if (exited || !inputEl) return;
    if (e.target === inputEl) return;
    focusInput();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (exited || !inputEl) return;
    if (e.key !== "Backspace" || composing) return;
    // 未確定の文字があるときは通常の Backspace に任せる。
    if (inputEl.value.length > 0) return;
    // 左端（次に送る 1 文字）はロック。末尾だけ取り消せる。
    if (pendingQueue.length <= 1) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    pendingQueue.pop();
    acceptedCount = Math.max(0, acceptedCount - 1);
    if (acceptedCount < ADVERTISE_MAX_CHARS) finishing = false;
    beltView?.setQueue(pendingQueue);
    syncInputLocked();
  };

  // 50 文字（上限）到達中は入力欄をグレーアウトして追加入力を止める。
  // 末尾取り消しの Backspace は readOnly でも届くので、上限を割れば自動で解除される。
  const syncInputLocked = () => {
    if (!inputEl) return;
    const locked = finishing;
    inputEl.readOnly = locked;
    inputEl.style.background = locked ? "#dcdcdc" : "#fff";
    inputEl.style.color = locked ? "#888" : "#000";
    inputEl.style.cursor = locked ? "not-allowed" : "text";
    inputEl.placeholder = locked ? "50文字に達しました" : "文字を入力して確定";
  };

  function attachInput() {
    // Pixi の canvas だけでは IME が効かない。下部キュー直下の DOM input を基点に変換 UI を出す。
    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.setAttribute("aria-label", "送る文字を入力");
    inputEl.placeholder = "文字を入力して確定";
    inputEl.autocomplete = "off";
    inputEl.autocapitalize = "off";
    inputEl.spellcheck = false;
    Object.assign(inputEl.style, {
      position: "fixed",
      zIndex: "20",
      pointerEvents: "auto",
      border: "2px solid #000",
      borderRadius: "0",
      background: "#fff",
      color: "#000",
      fontFamily: FONT_FAMILY,
      padding: "0 16px",
      margin: "0",
      boxSizing: "border-box",
      outline: "none",
      caretColor: "#000",
    });
    document.body.appendChild(inputEl);

    syncInputLayout = () => {
      if (!inputEl) return;
      const screen = designRectToScreen(ADVERTISE_INPUT_RECT);
      if (!screen) return;
      inputEl.style.left = `${screen.x}px`;
      inputEl.style.top = `${screen.y}px`;
      inputEl.style.width = `${screen.w}px`;
      inputEl.style.height = `${screen.h}px`;
      inputEl.style.fontSize = `${Math.max(16, Math.round(32 * (screen.w / ADVERTISE_INPUT_RECT.w)))}px`;
    };
    syncInputLayout();

    const host = document.querySelector(".pixi-host");
    if (host) {
      resizeObserver = new ResizeObserver(() => syncInputLayout?.());
      resizeObserver.observe(host);
    }
    window.addEventListener("resize", syncInputLayout);

    inputEl.addEventListener("compositionstart", onCompositionStart);
    inputEl.addEventListener("compositionend", onCompositionEnd);
    inputEl.addEventListener("input", onInput);
    inputEl.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);

    requestAnimationFrame(() => {
      syncInputLayout?.();
      focusInput();
    });
  }

  function detachInput() {
    document.removeEventListener("pointerdown", onPointerDown, true);
    if (syncInputLayout) window.removeEventListener("resize", syncInputLayout);
    resizeObserver?.disconnect();
    resizeObserver = null;
    syncInputLayout = null;
    if (inputEl) {
      inputEl.removeEventListener("compositionstart", onCompositionStart);
      inputEl.removeEventListener("compositionend", onCompositionEnd);
      inputEl.removeEventListener("input", onInput);
      inputEl.removeEventListener("keydown", onKeyDown);
      inputEl.remove();
      inputEl = null;
    }
  }

  function acceptText(text: string) {
    if (exited) return;
    let accepted = false;
    for (const seg of graphemeSegmenter.segment(text)) {
      if (acceptedCount >= ADVERTISE_MAX_CHARS) {
        finishing = true;
        break;
      }
      const ch = seg.segment;
      if (!isPackableChar(ch)) continue;
      pendingQueue.push(ch);
      acceptedCount++;
      accepted = true;
      if (acceptedCount >= ADVERTISE_MAX_CHARS) finishing = true;
    }
    if (accepted) beltView?.setQueue(pendingQueue);
    syncInputLocked();
  }

  function maybeComplete() {
    if (finishing && pendingQueue.length === 0 && !beltView?.isTransmitting()) {
      startFinishSequence();
    }
  }

  /**
   * 最終文字の発信完了後の終了演出を開始する。
   * 2 秒後にギミック停止＋BGM 通常化、さらに 5 秒後にタイトルへ戻す。
   */
  function startFinishSequence() {
    if (finishStarted || cleanupDone) return;
    finishStarted = true;
    stopSessionTicker(); // 残り時間表示は終了演出の開始で停止（最後の値で固定）。
    haltTimer = setTimeout(() => {
      haltTimer = null;
      beltView?.stopMechanism();
      options.onRestoreBgm?.();
      exitTimer = setTimeout(() => {
        exitTimer = null;
        void completeAndExit();
      }, FINISH_EXIT_DELAY_MS);
    }, FINISH_HALT_DELAY_MS);
  }

  function clearFinishTimers() {
    if (haltTimer != null) {
      clearTimeout(haltTimer);
      haltTimer = null;
    }
    if (exitTimer != null) {
      clearTimeout(exitTimer);
      exitTimer = null;
    }
  }

  function clearSessionStartTimer() {
    if (sessionStartTimer != null) {
      clearTimeout(sessionStartTimer);
      sessionStartTimer = null;
    }
  }

  /** トランジション完了後に sessionId 生成・タイマー・BLE・拍購読・入力を開始する。 */
  async function beginSession() {
    if (exited || cleanupDone || sessionStarted) return;
    sessionStarted = true;

    sessionId = createSessionId();
    sessionKey = sessionIdKey(sessionId);
    nextSeq = 0;
    startSessionTimer();

    attachInput();
    unsubDispatch = getSequence().onBeatAudio(dispatchOnBeat);

    if (window.ble) {
      const r = await window.ble.setStatus("ADVERTISE");
      if (!r.ok) console.warn("[advertise] setStatus(ADVERTISE) failed:", r.error);
    }
  }

  // --- セッション稼働タイマー（最大 1 分）---

  /** sessionId 生成時に開始。残り時間を表示し、0 で終了演出をトリガーする。 */
  function startSessionTimer() {
    sessionDeadlineMs = performance.now() + SESSION_MAX_MS;
    beltView?.setSessionRemaining(SESSION_MAX_MS / 1000);
    sessionTicker = setInterval(() => {
      const remainingMs = Math.max(0, sessionDeadlineMs - performance.now());
      beltView?.setSessionRemaining(remainingMs / 1000);
      if (remainingMs <= 0) onSessionTimeout();
    }, SESSION_TICK_MS);
  }

  function stopSessionTicker() {
    if (sessionTicker != null) {
      clearInterval(sessionTicker);
      sessionTicker = null;
    }
  }

  /** 稼働時間切れ。入力を締めて終了演出（ギミック停止→BGM→タイトル）へ。 */
  function onSessionTimeout() {
    if (finishStarted || cleanupDone || exited) return;
    finishing = true;
    syncInputLocked();
    startFinishSequence();
  }

  function onCharShipped(char: string) {
    // DB 蓄積（離脱時の flushAll で確定）。
    pushBuffer(sessionKey, char);

    // BLE 送出（右端発送タイミング）。
    const uuid = packAdvertise(sessionId, nextSeq++, char);
    if (window.ble) {
      void window.ble.advertise([uuid]).then((r) => {
        if (!r.ok) console.warn("[advertise] advertise failed:", r.error);
      });
    } else {
      console.log("[advertise]", uuid, char);
    }

    maybeComplete();
  }

  function dispatchOnBeat(beat: { index: number; time: number }) {
    if (exited || !beltView || finishStarted) return;
    if (beat.index % ADVERTISE_DISPATCH_BEATS === 0 && pendingQueue.length > 0) {
      const char = pendingQueue.shift()!;
      beltView.setQueue(pendingQueue);
      beltView.beginTransmit(char, beat.time);
    }
    // 最後の箱が場から消えた（発信完了）後に終了演出へ入るため毎拍ポーリング。
    maybeComplete();
  }

  async function completeAndExit() {
    await cleanup();
    options.onComplete();
  }

  function cleanup(): Promise<void> {
    if (cleanupPromise) return cleanupPromise;
    cleanupDone = true;
    exited = true;
    clearFinishTimers();
    clearSessionStartTimer();
    stopSessionTicker();
    if (unsubDispatch) {
      unsubDispatch();
      unsubDispatch = null;
    }
    detachInput();
    if (prevBufferOpts) {
      configureBuffer(prevBufferOpts);
      prevBufferOpts = null;
    }
    const flushP = flushAll().catch((e) => console.warn("[advertise] flushAll 失敗:", e));
    const idleP = window.ble
      ? window.ble
          .setStatus("IDLE")
          .catch((e) => console.warn("[advertise] setStatus(IDLE) 失敗:", e))
      : Promise.resolve();
    cleanupPromise = Promise.all([flushP, idleP]).then(() => undefined);
    return cleanupPromise;
  }

  return {
    async start(view: AdvertiseBeltView) {
      beltView = view;
      beltView.setOnShipped(onCharShipped);
      beltView.setQueue(pendingQueue);

      // シーン尺中は idle/maxWait による中間 flush を抑え、離脱の flushAll に一本化する。
      prevBufferOpts = { idleMs: 8000, maxWaitMs: 30000 };
      configureBuffer({ idleMs: 24 * 60 * 60 * 1000, maxWaitMs: 24 * 60 * 60 * 1000 });

      // build は覆い中に走る。タイマー・BLE・入力は蓋が開いて見える頃まで遅らせる。
      sessionStartTimer = setTimeout(() => {
        sessionStartTimer = null;
        void beginSession();
      }, ADVERTISE_SESSION_START_DELAY_MS);
    },

    refocusInput() {
      syncInputLayout?.();
      focusInput();
    },

    requestExit(onGone: () => void) {
      if (exited) {
        onGone();
        return;
      }
      exited = true;
      clearFinishTimers();
      clearSessionStartTimer();
      stopSessionTicker();
      if (unsubDispatch) {
        unsubDispatch();
        unsubDispatch = null;
      }
      detachInput();
      // 実 IDLE/flush/configure 戻しは scene.dispose の中の cleanup() で行う。
      onGone();
    },

    async dispose() {
      await cleanup();
    },
  };
}
