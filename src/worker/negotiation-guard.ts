// 「谈判在途」的唯一判据（v6.66.0 §D3，见 memory/design-transfer-before-negotiation.md）。
//
// v6.65 及以前，全仓用 `transfers.status = 'signing'` 表达「这名球员有一场没结束的签约谈判」：
// 审核通过把单据从 pending_review 推到 signing，成交才推到 completed，于是「signing 单据」
// 与「未结束的谈判会话」恰好一一对应，用哪个都行。
//
// v6.66.0 起把过户提前到审核通过：扣款、挪球员、改合同归属都在开谈**之前**跑完，单据在开谈
// 那一刻就是 completed（signing 对换队类不再出现）。此后仍按单据状态判在途的闸会一律静默失效
// ——球员人能走、钱能付，闸却认为「什么都没发生」。故判据统一改看会话本身：
// 有 status = 'active' 的 negotiation_sessions 行，就算谈判在途。
//
// 用法：单球员前置检查走下面两个 helper；批量查询把 ACTIVE_SESSION_SQL 拼进 WHERE
// （别名固定为 s），保证下一轮口径调整只需要改这一个文件。
import type { Env } from './env.ts';

/** 批量查询里的「谈判在途」谓词（要求 FROM 里以 `s` 作 negotiation_sessions 的别名）。 */
export const ACTIVE_SESSION_SQL = `s.status = 'active'`;

/** 该球员是否有未结束的签约谈判（任意类型）。命中返回会话 id。 */
export async function findActiveNegotiationSession(
  db: Env['DB'],
  playerId: number,
): Promise<{ id: number } | null> {
  return db
    .prepare(`SELECT s.id FROM negotiation_sessions s WHERE s.player_id = ? AND ${ACTIVE_SESSION_SQL} LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
}

/**
 * 海捞 / 出标用的「谈判在途」：会话 active，或单据已到 `signing` 而会话还没建出来。
 * 后者正常路径不会出现（开谈是一个 batch），只作历史残留兜底；两者通常同时存在，
 * 所以这条判据在过户提前前后都成立（v6.66.0 起换队单在开谈那刻已 completed，靠前半句命中）。
 */
export async function findNegotiationInFlight(
  db: Env['DB'],
  playerId: number,
): Promise<{ id: number } | null> {
  const session = await findActiveNegotiationSession(db, playerId);
  if (session) return session;
  return db
    .prepare(`SELECT id FROM transfers WHERE player_id = ? AND status = 'signing' LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
}

/** 该球员是否有未结束的**上调**谈判（type='promotion'，合同正在被改写成正式条款）。 */
export async function findActivePromotionSession(
  db: Env['DB'],
  playerId: number,
): Promise<{ id: number } | null> {
  return db
    .prepare(
      `SELECT s.id FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id
       WHERE s.player_id = ? AND ${ACTIVE_SESSION_SQL} AND t.type = 'promotion' LIMIT 1`,
    )
    .bind(playerId)
    .first<{ id: number }>();
}
