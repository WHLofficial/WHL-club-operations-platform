// 球员引用解析（增量 32）：球员页 URL 是裸数字 fc_id（`/players/222665`），而平台内部主键是 `players.id`。
// 两个编号空间零重叠（fc_id 19541–279948 / 内部 id 1–18301），但这里不靠区间判断，而是
// 「先按 fc_id 点查、未命中再按内部 id 点查」——两次都是主键/唯一索引点查，不落全表扫；
// 命中 fc_id 是常态，所以正常路径只有一次查询。保留 id 回落是因为老分享链接与前端缓存里
// 可能还是内部 id，不能断。
//
// 写端点（PATCH /players/:id、POST /growth/levelup/:playerId…）一律只收内部 id：调用方手上就有
// 详情载荷里的 `id`，让写路径只认一种编号，比两套都认好排查。
import type { D1Database } from '@cloudflare/workers-types';

/** 按 fc_id 优先、内部 id 兜底取球员行；命中 fc_id 时只查一次。`columns` 必须是代码里的字面量。 */
export async function firstPlayerByRef<T>(db: D1Database, columns: string, ref: number): Promise<T | null> {
  const sql = `SELECT ${columns} FROM players WHERE `;
  const byFcId = await db.prepare(`${sql}fc_id = ?`).bind(ref).first<T>();
  if (byFcId) return byFcId;
  return await db.prepare(`${sql}id = ?`).bind(ref).first<T>();
}
