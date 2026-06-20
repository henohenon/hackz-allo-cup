// 会話データの LocalStorage 永続化。
//
// 仕様: sessionId(hex) をキーに「文章(text)」を保存する。
//   - body(コード)は保存しない（decode 済みの文字/文章だけ持つ。ALPHABET 改版でも壊れない）。
//   - chars は歯抜け再結合のため併せて保持（seq → 文字）。
//   - 書き込みは throttle（反復ヒットごとに書かない）。flush() で即時確定。
//
// Storage は注入可能（テストはインメモリの fake を渡す。既定は globalThis.localStorage）。

import { assembleText, maxSeqOf } from "../receiver/assembler";

const STORAGE_KEY = "allo:sessions";
const SCHEMA_VERSION = 1;

export type SessionRole = "rx" | "tx";

/** 永続化される 1 セッション。 */
export interface StoredSession {
  /** sessionId(hex)。 */
  id: string;
  role: SessionRole;
  updatedAt: number;
  /** 受信済みの最大 seq。 */
  maxSeq: number;
  /** seq 昇順で連結した会話文章（欠番はプレースホルダ）。読み出しはこれを使う。 */
  text: string;
  /** seq → 1 文字。歯抜け再結合のため保持。 */
  chars: Record<number, string>;
}

interface StoreShape {
  v: number;
  sessions: Record<string, StoredSession>;
}

export interface SessionStore {
  /** 文字を seq 位置に置き、text を再構築して保存する。更新後のセッションを返す。 */
  upsertChar(id: string, role: SessionRole, seq: number, char: string): StoredSession;
  /** セッションを取得。 */
  get(id: string): StoredSession | undefined;
  /** sessionId をキーに会話文章を取得。 */
  getText(id: string): string | undefined;
  /** 全セッション（updatedAt 降順）。 */
  list(): StoredSession[];
  /** 保留中の書き込みを即時確定。 */
  flush(): void;
  /** 全消去。 */
  clear(): void;
}

export interface SessionStoreOptions {
  storage?: Storage;
  now?: () => number;
  /** 書き込み throttle(ms)。0 で即時書き込み（テスト向け）。既定 300。 */
  throttleMs?: number;
}

function emptyShape(): StoreShape {
  return { v: SCHEMA_VERSION, sessions: {} };
}

function charsToMap(chars: Record<number, string>): Map<number, string> {
  const map = new Map<number, string>();
  for (const [seq, char] of Object.entries(chars)) {
    map.set(Number(seq), char);
  }
  return map;
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const storage = options.storage ?? globalThis.localStorage;
  const now = options.now ?? (() => Date.now());
  const throttleMs = options.throttleMs ?? 300;

  const state = load();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function load(): StoreShape {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyShape();
      const parsed = JSON.parse(raw) as StoreShape;
      if (parsed?.v !== SCHEMA_VERSION || typeof parsed.sessions !== "object") {
        return emptyShape(); // スキーマ不一致はリセット
      }
      return parsed;
    } catch {
      return emptyShape();
    }
  }

  function persist(): void {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function scheduleFlush(): void {
    if (throttleMs <= 0) {
      persist();
      return;
    }
    if (timer) return; // leading なし trailing throttle
    timer = setTimeout(() => {
      timer = null;
      persist();
    }, throttleMs);
  }

  function flush(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    persist();
  }

  return {
    upsertChar(id, role, seq, char) {
      let session = state.sessions[id];
      if (!session) {
        session = { id, role, updatedAt: now(), maxSeq: -1, text: "", chars: {} };
        state.sessions[id] = session;
      }
      session.chars[seq] = char; // 同 seq は上書きで冪等
      const map = charsToMap(session.chars);
      session.maxSeq = maxSeqOf(map);
      session.text = assembleText(map);
      session.updatedAt = now();
      scheduleFlush();
      return session;
    },
    get(id) {
      return state.sessions[id];
    },
    getText(id) {
      return state.sessions[id]?.text;
    },
    list() {
      return Object.values(state.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    flush,
    clear() {
      state.sessions = {};
      flush();
    },
  };
}
