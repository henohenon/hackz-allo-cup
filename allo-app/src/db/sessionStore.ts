// セッション履歴の永続化 (IndexedDB)。
//   session_id : string   主キー
//   content    : string
//   created_at : Date      ※ IndexedDB は構造化複製で Date を保持するので文字列化不要
//
// テーブル(オブジェクトストア)は open 時に無ければ自動生成する。
// ライブラリには頼らず生 IndexedDB を薄くラップしただけ。スコープが小さいので十分。

const DB_NAME = "kotohakobi";
const DB_VERSION = 1;
const STORE = "sessions";

/** 1 セッションのレコード。 */
export interface SessionRecord {
  session_id: string;
  content: string;
  created_at: Date;
}

// 一度開いた接続は使い回す (open は毎回 onupgradeneeded 判定が走るので無駄)。
let dbPromise: Promise<IDBDatabase> | undefined;

/**
 * DB を開く。ストアが無ければ生成する。
 * onupgradeneeded は「DB 新規作成時」と「version が上がった時」に走る。
 * 既存ストアの有無を見てから作るので、二重作成にはならない。
 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "session_id" });
        // created_at の範囲クエリ・並び替え用インデックス
        store.createIndex("by_created_at", "created_at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** トランザクションを 1 つ張って fn を実行し、リクエスト結果を await できる形で返す。 */
async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 追加 or 上書き (同じ session_id は上書き)。
 * created_at は必ず呼び出し側で指定する。トランザクションをまたいで時刻が
 * ブレるのを避けるため、ストア側で new Date() の自動付与はしない。
 */
export function save(
  session_id: string,
  content: string,
  created_at: Date,
): Promise<IDBValidKey> {
  return run("readwrite", (s) => s.put({ session_id, content, created_at }));
}

/** 主キーで 1 件取得。無ければ undefined。 */
export function get(session_id: string): Promise<SessionRecord | undefined> {
  return run("readonly", (s) => s.get(session_id) as IDBRequest<SessionRecord | undefined>);
}

/** 全件取得 (created_at の昇順)。 */
export function all(): Promise<SessionRecord[]> {
  return run(
    "readonly",
    (s) => s.index("by_created_at").getAll() as IDBRequest<SessionRecord[]>,
  );
}

/** created_at が from〜to (両端含む) のレコードを取得。 */
export function between(from: Date, to: Date): Promise<SessionRecord[]> {
  return run(
    "readonly",
    (s) =>
      s.index("by_created_at").getAll(IDBKeyRange.bound(from, to)) as IDBRequest<
        SessionRecord[]
      >,
  );
}

/** content の部分一致検索。インデックス外なので全件走査して JS で絞る。 */
export async function search(keyword: string): Promise<SessionRecord[]> {
  const rows = await all();
  return rows.filter((r) => r.content.includes(keyword));
}

/** 1 件削除。 */
export function remove(session_id: string): Promise<void> {
  return run("readwrite", (s) => s.delete(session_id));
}

/** 全消し。 */
export function clear(): Promise<void> {
  return run("readwrite", (s) => s.clear());
}
