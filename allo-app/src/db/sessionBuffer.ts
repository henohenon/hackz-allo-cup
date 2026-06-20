// 1 文字ずつ届くテキストを、セッション単位でメモリ上に貯めてから IndexedDB に
// フラッシュするバッファ。
//
// IndexedDB の IDBTransaction は寝かせられない (リクエストが無いと即 commit して
// 閉じる) ので、「入力中ずっと開いた transaction」は持てない。代わりにここでメモリ
// 下書き(draft)を保持し、落ち着いたタイミングでだけ短い put を 1 発撃つ。
//
//   push(session_id, text) … 文字が来るたび呼ぶ。初回は created_at を自動付与し、
//                            以降は text を追記して育てる。
//   - idleMs    : 最後の push から無入力が続いたら確定フラッシュ (= 入力完了とみなす)
//   - maxWaitMs : 入力が続いても上限で一旦フラッシュ (天井。put は上書きなので無害)
//   flushAll()  … 画面遷移などで全 draft を即確定。

import { save } from "./sessionStore";

interface FlushOptions {
  /** 無入力がこの ms 続いたら確定フラッシュ。 */
  idleMs: number;
  /** 入力が続いてもこの ms ごとに一旦フラッシュ (天井)。 */
  maxWaitMs: number;
}

interface Draft {
  content: string;
  created_at: Date;
  idleTimer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout>;
}

let options: FlushOptions = { idleMs: 8000, maxWaitMs: 30000 };
const drafts = new Map<string, Draft>();

/** フラッシュ間隔を変更する (未指定の項目は据え置き)。 */
export function configure(opts: Partial<FlushOptions>): void {
  options = { ...options, ...opts };
}

/**
 * 文字の到着。初回 session_id なら draft を作って created_at を打ち、
 * 既存なら text を追記。毎回 idle タイマーを張り直す。
 */
export function push(session_id: string, text: string): void {
  let d = drafts.get(session_id);
  if (!d) {
    d = {
      content: "",
      created_at: new Date(),
      idleTimer: setTimeout(() => {}, 0),
      // 天井タイマーは draft 生成時に 1 回だけ仕掛ける (入力が続いても更新しない)
      maxTimer: setTimeout(() => flush(session_id, false), options.maxWaitMs),
    };
    drafts.set(session_id, d);
  }
  d.content += text;

  // idle タイマーは push のたびにリセット (= 無入力が続いて初めて発火)
  clearTimeout(d.idleTimer);
  d.idleTimer = setTimeout(() => flush(session_id, true), options.idleMs);
}

/**
 * draft を DB に書く。
 * final=true (idle 確定 or flushAll): タイマーを止めて draft を破棄。
 * final=false (maxWait 天井): 書くだけで draft は残し、天井タイマーを張り直す。
 */
function flush(session_id: string, final: boolean): void {
  const d = drafts.get(session_id);
  if (!d) return;
  void save(session_id, d.content, d.created_at);
  if (final) {
    clearTimeout(d.idleTimer);
    clearTimeout(d.maxTimer);
    drafts.delete(session_id);
  } else {
    d.maxTimer = setTimeout(() => flush(session_id, false), options.maxWaitMs);
  }
}

/** 全 draft を即確定フラッシュ (画面遷移用)。書き込み完了まで待てる。 */
export async function flushAll(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const [session_id, d] of drafts) {
    clearTimeout(d.idleTimer);
    clearTimeout(d.maxTimer);
    pending.push(save(session_id, d.content, d.created_at));
  }
  drafts.clear();
  await Promise.all(pending);
}
