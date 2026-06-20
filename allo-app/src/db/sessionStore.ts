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
    // 失敗した Promise をキャッシュし続けると、private モード/quota などの
    // 一時要因でも以降ずっと失敗する。クリアして次回リトライ可能にする。
    req.onerror = () => {
      dbPromise = undefined;
      reject(req.error);
    };
    // version を上げたとき、別タブが旧 version の接続を握っていると発火する。
    // DB_VERSION=1 の今は起きないが、将来上げたら success/error が出ず無言で
    // ハングするので、ここで気づけるよう reject しておく。
    req.onblocked = () => {
      dbPromise = undefined;
      reject(new Error("IndexedDB open blocked: 別タブが旧バージョンの接続を保持しています"));
    };
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
    // commit 中の quota 超過など、request error を伴わない abort も拾う。
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * 追加 or 上書き (同じ session_id は上書き)。
 * created_at は必ず呼び出し側で指定する。トランザクションをまたいで時刻が
 * ブレるのを避けるため、ストア側で new Date() の自動付与はしない。
 */
export function save(session_id: string, content: string, created_at: Date): Promise<IDBValidKey> {
  return run("readwrite", (s) => s.put({ session_id, content, created_at }));
}

/** 降順カーソルを最大 limit 件まで辿って配列に集める。 */
function collectCursor(req: IDBRequest<IDBCursorWithValue | null>, limit: number) {
  return new Promise<SessionRecord[]>((resolve, reject) => {
    const out: SessionRecord[] = [];
    req.onsuccess = () => {
      const cur = req.result;
      if (cur && out.length < limit) {
        out.push(cur.value as SessionRecord);
        cur.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * created_at の新しい順に最大 limit 件。
 * getAll().slice より、件数が増えてもインデックスのカーソルで limit 件だけ
 * 辿るので効率が良い ('prev' = 降順)。
 */
export async function getRecent(limit = 50): Promise<SessionRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const cursor = tx.objectStore(STORE).index("by_created_at").openCursor(null, "prev");
  return collectCursor(cursor, limit);
}

/** 全消し (テスト用リセット)。 */
export function clear(): Promise<void> {
  return run("readwrite", (s) => s.clear());
}
