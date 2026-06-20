# 引き継ぎ: 新モック UI（Renderer 側ロジック）の構築

この 1 枚で**他の情報なしに**モック UI ＋ Renderer 側の通信ロジックを実装できることを目指す。
正典は [communication-design.md](./communication-design.md)、経緯は [communication-log.md](./communication-log.md)（#14）。
先に [handoff-utility.md](./handoff-utility.md)（`window.ble`）を読むと境界が分かりやすい。

---

## 0. これは何 / ゴール

- **本番のゲーム UI ではなく、開発用ハーネス**（dev パネル）。`window.ble` を手で叩いて、
  **Renderer 側の通信ロジック全部**（codec・pack/unpack・送信スケジューラ・受信再結合・永続化）を実装・検証する。
- **Renderer がロジックの主役**。Utility（`window.ble`）は薄い BLE I/O で、生データを撒く/拾うだけ。
  だから Renderer 側にやることが多い ＝ この UI が「実質の通信実装」になる。
- URL クエリで dev 画面を出す（既存の `?demo` と同じ流儀。例: `?hako`）。本番 UI とは別物。

## 1. Renderer の責務（全部ここ）

| 処理 | 内容 |
|---|---|
| encode / decode | 文字 ↔ 10B コード（codec。`electron/codec/` を import して使う） |
| pack / unpack | `{sessionId, seq, body}` ↔ 32 桁 hex(16B = Service UUID 1 個) |
| sessionId / seq | 送信開始時に sessionId を自然乱数で生成、seq は 0 から採番 |
| 送信スケジューラ | 送信スタック・**latest-wins**・**文字送り最低保証 T**・**1 セッション最大 50 文字** |
| 受信再結合 | 重複除去（sessionId+seq）・seq 順連結・歯抜け(`□`)・decode 失敗(`�`)・session 管理 |
| 永続化 | **localStorage**（session ごとの本文）。view モードで読む |
| seed | `BTアドレス⊕sessionId`（要検討）。MVP は sessionId のみで可 |

## 2. `window.ble`（Utility）— 叩く相手

```ts
type BleStatus = "IDLE" | "ADVERTISE" | "SCANNING";
type Result = { ok: boolean; error?: string };

interface Ble {
  setStatus(status: BleStatus): Promise<Result>;          // 排他。ADVERTISE=発信 / SCANNING=受信 / IDLE=停止
  advertise(serviceUuids: string[]): Promise<Result>;     // 撒く生データをセット（ADVERTISE 中のみ）。localName は Utility が "HAKO" 固定
  onPacket(cb: (p: { address: string; serviceUuids: string[] }) => void): () => void; // HAKO だけ・生のまま全部
}
```

- Utility は decode も重複除去もしない。**onPacket は OS の反復ぶん同じものが何度も来る**前提
  → 重複除去は Renderer がやる。

## 3. データ仕様（Renderer が pack/unpack する）

### パケット（16B = Service UUID 1 個・32 桁 hex）

```
[0..3]   sessionId 4B   先頭 8 桁 hex。送信セッション識別＋codec seed の素
[4..5]   seq       2B   次 4 桁 hex（big-endian）。文字順
[6..15]  body     10B   残り 20 桁 hex。その 1 文字の codec コード
```

- **pack**: `sessionId(8hex) + seq.toString(16).padStart(4,'0') + bodyHex(20)` → 小文字 32 桁。
  これを `advertise([uuid])` で渡す（Service UUID は dash 無し 32 桁 hex）。
- **unpack**: 受信 `serviceUuids` の各要素から先頭 8 / 次 4 / 残り 20 を切り出す。
  長さ 32・hex 以外は無視（自分宛でない広告の混入よけ）。
- 旧ブランチ `feat/allo-comm-mock` の `electron/allo/packet.ts`（`packPacket`/`unpackPacket`＋テスト）が
  ほぼそのまま使える。Renderer 側へ持ってくる（例: `src/lib/packet.ts`）。

### codec（`electron/codec/` を import）

```ts
import { tableFromSeed, toHex } from "../electron/codec/table";
import { createCodec } from "../electron/codec/codec";
import { ALPHABET } from "../electron/codec/alphabet";

const codec = createCodec(tableFromSeed(seed)); // seed は文字列
codec.encodeChar("あ");        // -> Uint8Array(10)
codec.decodeChar(bodyBytes);   // -> string | null（未知コードは null → "�" を当てる）
```

- 文字セットは `ALPHABET`（ひらがな・全角カナ・全角数字・記号、計 121）。送信ボタンはこれを並べる。
- **同じ seed で両端が同じテーブル**になる（決定的）。送信側 seed と受信側 seed が一致しないと decode 全滅。
- **seed**: 設計上は `BTアドレス⊕sessionId`。ただし macOS は BT アドレスを隠す（送受で値がズレる恐れ）ので、
  **MVP は seed = sessionId のみ**で疎通優先。address を混ぜるのは実機で id/address を確認してから（要検討）。

## 4. 送信の実装

1. UI で `setStatus("ADVERTISE")`。同時に **sessionId を生成**（`crypto.getRandomValues` で 4B → 8 hex）、`seq=0`、
   `codec = createCodec(tableFromSeed(seed))` を構築。
2. **入力は文字ボタン**（テキスト欄にしない）。理由: onChange 差分計算＋IME 合成イベントが不安定で
   デバッグに不向き（旧実装の教訓）。**ボタン 1 クリック = 1 文字**。
3. 1 文字ぶん: `body = codec.encodeChar(char)` → `uuid = pack(sessionId, seq, body)` → seq++。
   **送信スタック**に積む。**50 文字制限**: seq が 50 に達したら以降は弾く（UI でも止める）。
4. **送信スケジューラ**（latest-wins ＋ 文字送り最低保証 T）:
   - latest-wins: 常に「最新の 1 文字」を撒く。`ble.advertise([latestUuid])` で差し替える。
   - 文字送り最低保証 T: 各文字を最低 T だけ滞空させてから次へ差し替える（速い打鍵は間引く or キュー）。
     T の値・方式は未決（実機計測）。Utility 側に撒き直し 150ms の物理下限があるので、T ≥ 150ms 程度から。
   - スケジューラ・スタック・T は**全部 Renderer**。Utility の `advertise` は「来たものをそのまま撒く」だけ。
5. 無入力が続いたら `setStatus("IDLE")`（タイムアウトは Renderer 判断）。

## 5. 受信の実装

1. UI で `setStatus("SCANNING")`。`ble.onPacket(cb)` を購読。
2. cb で `{ address, serviceUuids }` を受ける。各 `serviceUuid` を **unpack** → `{ sessionId, seq, body }`
   （長さ/hex 不正は捨てる）。
3. **seed = sessionId（MVP）** で `codec = createCodec(tableFromSeed(seed))`（session ごとに作ってキャッシュ）。
   `char = codec.decodeChar(body) ?? "�"`。
4. **重複除去**: session ごとに `Map<seq, char>` を持ち、`sessionId+seq` で上書き（OS 反復ぶんは同じ位置に冪等）。
5. **再結合**: seq 0..max を走査し、欠けは `"□"`、ある所は char で連結 → そのセッションの本文。
6. 本文を **localStorage に保存**（下記）。複数 session は**並列表示**（送信者ごとに別欄）。

## 6. 永続化（localStorage）

- セッション・本文の扱いと保存は **Renderer の localStorage**。
- 形（例）: キー `hako:messages` に `Record<sessionId, { text: string; updatedAt: number }>` を JSON で。
  受信で本文が変わるたび上書き保存。
- 終端判定は持たない（撃ちっぱ・最新本文をそのまま保存）。
- **view モード**: localStorage を読んで保存済みメッセージ一覧を表示（Utility を介さない）。

## 7. UI 構成（dev パネル）

- **ステータス**: `IDLE / ADVERTISE / SCANNING` ボタン（排他・現在値を強調）。
- **送信**: `ADVERTISE` 中に `ALPHABET` の文字ボタン群。クリックで 1 文字送信。撒いた数・最新文字を表示。
- **受信**: session ごとに「再結合本文」を表示（並列）。
- **生ログ**: 操作・送信(打鍵/実際に撒いた)・受信を時系列でダンプ（デバッグ用）。hex/連結 UUID を出すとスマホ照合が楽。
- **view**: localStorage の保存メッセージ一覧。
- 画面切替は URL クエリ（`?hako` 等）。本番 UI と分ける。

## 8. 流用元（作り直さない）

- `electron/codec/`（alphabet/prng/table/codec）: そのまま import。
- 旧 `feat/allo-comm-mock` ブランチの:
  - `electron/allo/packet.ts`（pack/unpack＋テスト）→ Renderer 側へ移植。
  - `src/AlloDevPanel.tsx` / `src/DevNav.tsx`: **UI の参考**（ただし旧 `window.allo` 前提なので、
    `window.ble`＋Renderer ロジックに合わせて作り直す）。文字ボタン・生ログ・URL ナビの作りは流用可。

## 9. macOS / 確認の前提（必読）

- **同一 Mac で自己受信は不可**。1 台では送信が撒けていても自分の受信欄には出ない（正常）。
  確認はスマホ **LightBlue**（"HAKO" が見える＝送信 OK）か**実機 2 台**（送信機 / 受信機）。
- `vp dev` は **GUI ターミナル**から（非 GUI だと TCC で落ちる）。初回 Bluetooth 許可を承認。
- 文字セット外（半角英数など）は encode で例外 → UI で弾くかログに出す。

## 10. 完了の定義

- `?hako` の dev パネルで `ADVERTISE`→文字ボタンで撒ける（スマホ LightBlue で `HAKO`＋UUID 変化が見える）。
- 別端末 `SCANNING` で `onPacket` を受け、unpack→decode→再結合→localStorage まで通り、本文が表示される。
- 重複除去・seq 再結合・歯抜け表示・複数 session 並列・永続化が Renderer 側で動く。
- `vp check` / `vp test`（codec・packet のテスト）が緑。
