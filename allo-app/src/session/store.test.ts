import { describe, expect, test } from "vite-plus/test";

import { createSessionStore } from "./store";

// インメモリの Storage fake（jsdom 不要）。
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

const opts = (storage: Storage) => ({ storage, throttleMs: 0, now: () => 1000 });

describe("createSessionStore", () => {
  test("sessionId をキーに text を保存・取得", () => {
    const storage = fakeStorage();
    const store = createSessionStore(opts(storage));
    store.upsertChar("aabbccdd", "rx", 0, "こ");
    store.upsertChar("aabbccdd", "rx", 1, "ん");
    expect(store.getText("aabbccdd")).toBe("こん");
  });

  test("text は seq 昇順で再構築（順不同投入・歯抜け）", () => {
    const store = createSessionStore(opts(fakeStorage()));
    store.upsertChar("s1", "rx", 2, "う");
    store.upsertChar("s1", "rx", 0, "あ");
    expect(store.get("s1")!.text).toBe("あ□う");
    expect(store.get("s1")!.maxSeq).toBe(2);
  });

  test("同 seq は冪等（重複投入で増えない）", () => {
    const store = createSessionStore(opts(fakeStorage()));
    store.upsertChar("s1", "rx", 0, "あ");
    store.upsertChar("s1", "rx", 0, "あ");
    expect(store.get("s1")!.text).toBe("あ");
    expect(Object.keys(store.get("s1")!.chars)).toHaveLength(1);
  });

  test("別ストアで再読込しても復元できる（直列化往復）", () => {
    const storage = fakeStorage();
    const a = createSessionStore(opts(storage));
    a.upsertChar("s1", "tx", 0, "は");
    a.upsertChar("s1", "tx", 1, "こ");
    a.flush();

    const b = createSessionStore(opts(storage));
    expect(b.getText("s1")).toBe("はこ");
    expect(b.get("s1")!.role).toBe("tx");
  });

  test("list は updatedAt 降順", () => {
    const storage = fakeStorage();
    let t = 0;
    const store = createSessionStore({ storage, throttleMs: 0, now: () => ++t });
    store.upsertChar("old", "rx", 0, "あ");
    store.upsertChar("new", "rx", 0, "い");
    expect(store.list().map((s) => s.id)).toEqual(["new", "old"]);
  });

  test("スキーマ版不一致はリセット扱い", () => {
    const storage = fakeStorage();
    storage.setItem("allo:sessions", JSON.stringify({ v: 999, sessions: { x: {} } }));
    const store = createSessionStore(opts(storage));
    expect(store.list()).toHaveLength(0);
  });

  test("clear で全消去", () => {
    const storage = fakeStorage();
    const store = createSessionStore(opts(storage));
    store.upsertChar("s1", "rx", 0, "あ");
    store.clear();
    expect(store.list()).toHaveLength(0);
    expect(createSessionStore(opts(storage)).list()).toHaveLength(0);
  });
});
