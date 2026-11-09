// 挂单终态写侧唯一入口（v6.83.0）：12 个收口 cause 的 `UPDATE listings SET status` 只在本文件构造。
// 调用方把 advanceStatement 返回的语句按原下标放回自己的 db.batch（资金/过户/通知的副作用顺序不变）；
// 只有独立语句场景才用 advance(...)（内部 .run()，返回 meta.changes）。
//
// 执行真源是每条 SQL 的 WHERE 守卫：状态不在合法起点、时间窗已过、类型不符时 changes=0 静默 no-op，
// 不抛 409；调用方照旧按 changes 分支。core/listing-state.ts 的转移表只作语义真源与测试验证器。
import type { ListingCloseCause } from '../core/listing-state.ts';

/** 与 market-settle.ts / routes/admin/shared.ts 同口径的 SQL 时刻表达式（秒级毫秒 + Z） */
function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface FirstBidParams {
  /** 出价后的静默期截止时刻（null = 无窗口，照旧落 NULL） */
  deadlineAt: string | null;
}

export interface ActivationMatchStartParams {
  /** 从哪个状态转入匹配等待（调用方按当前行状态选） */
  fromStatus: 'listed' | 'bidding';
  /** 匹配窗截止（调用方算好的绝对时刻） */
  matchDeadline: string;
}

export interface SettleForReviewParams {
  fromStatus: 'bidding' | 'matched_pending' | 'listed';
}

export interface UnbidExpiredParams {
  isActivation: boolean;
  /** deadline = 竞价截止到点；window_end = 挂牌所属窗口已关 */
  source: 'deadline' | 'window_end';
}

export interface AdminCancelParams {
  reason: string;
}

export interface NegotiationClosedParams {
  /** 调用方已定稿的文案，原样落库（零加工、不 trim） */
  deadlineNote: string;
}

export type EmptyListingCloseParams = Record<string, never>;

export interface ListingCloseParamsMap {
  first_bid: FirstBidParams;
  activation_match_start: ActivationMatchStartParams;
  settle_for_review: SettleForReviewParams;
  unbid_expired: UnbidExpiredParams;
  activation_price_expired: EmptyListingCloseParams;
  admin_reset: EmptyListingCloseParams;
  admin_cancel: AdminCancelParams;
  forced_cancel: EmptyListingCloseParams;
  matched_kept: EmptyListingCloseParams;
  negotiation_closed: NegotiationClosedParams;
  review_rejected: EmptyListingCloseParams;
  deal_done: EmptyListingCloseParams;
}

export type ListingCloseParams<C extends ListingCloseCause> = ListingCloseParamsMap[C];

interface AdvanceSpec {
  sql: string;
  bind: unknown[];
}

function buildSpec(
  listingId: number,
  cause: ListingCloseCause,
  params: ListingCloseParams<ListingCloseCause>,
): AdvanceSpec {
  switch (cause) {
    case 'first_bid': {
      const { deadlineAt } = params as FirstBidParams;
      return {
        sql: `UPDATE listings SET status = 'bidding', last_bid_at = ${nowSql()}, activation_deadline = NULL, deadline_at = ?
       WHERE id = ? AND status IN ('listed', 'bidding')
         AND (deadline_at IS NULL OR deadline_at > ${nowSql()})
         AND (activation_deadline IS NULL OR activation_deadline > ${nowSql()})`,
        bind: [deadlineAt, listingId],
      };
    }
    case 'activation_match_start': {
      const { fromStatus, matchDeadline } = params as ActivationMatchStartParams;
      return {
        sql: `UPDATE listings SET status = 'matched_pending', match_deadline = ?, deadline_at = NULL, deadline_note = NULL
       WHERE id = ? AND status = ?`,
        bind: [matchDeadline, listingId, fromStatus],
      };
    }
    case 'settle_for_review': {
      const { fromStatus } = params as SettleForReviewParams;
      return {
        sql: `UPDATE listings SET status = 'pending_review', match_deadline = NULL, deadline_at = NULL WHERE id = ? AND status = ?`,
        bind: [listingId, fromStatus],
      };
    }
    case 'unbid_expired': {
      const { isActivation, source } = params as UnbidExpiredParams;
      const unbidNote = source === 'deadline' ? '截止时刻无人出价' : '窗口结束无人出价';
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = ? WHERE id = ? AND status = 'listed'`,
        bind: [isActivation ? '窗口结束激活方仍未落价，激活无效' : unbidNote, listingId],
      };
    }
    case 'activation_price_expired':
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = '激活方未在出价窗内落价，激活无效', activation_deadline = NULL
       WHERE id = ? AND status = 'listed'`,
        bind: [listingId],
      };
    case 'admin_reset':
      return {
        sql: `UPDATE listings SET status = 'listed', last_bid_at = NULL
       WHERE id = ? AND status = 'bidding'
         AND NOT EXISTS (SELECT 1 FROM bids WHERE listing_id = ? AND status = 'active')`,
        bind: [listingId, listingId],
      };
    case 'admin_cancel': {
      const { reason } = params as AdminCancelParams;
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = ?, activation_deadline = NULL, match_deadline = NULL
       WHERE id = ? AND status IN ('listed', 'matched_pending')`,
        bind: [`管理组作废：${reason}`, listingId],
      };
    }
    case 'forced_cancel':
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = '管理组取消强制拍卖'
       WHERE id = ? AND type = 'forced' AND status IN ('listed', 'bidding')`,
        bind: [listingId],
      };
    case 'matched_kept':
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = '被匹配，球员留队' WHERE id = ? AND status = 'matched_pending'`,
        bind: [listingId],
      };
    case 'negotiation_closed': {
      const { deadlineNote } = params as NegotiationClosedParams;
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = ? WHERE id = ? AND status = 'pending_review'`,
        bind: [deadlineNote, listingId],
      };
    }
    case 'review_rejected':
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = '审核驳回' WHERE id = ? AND status = 'pending_review'`,
        bind: [listingId],
      };
    case 'deal_done':
      return {
        sql: `UPDATE listings SET status = 'delisted', deadline_note = '已成交'
       WHERE id = ? AND status IN ('listed', 'bidding', 'matched_pending', 'pending_review')`,
        bind: [listingId],
      };
    default:
      throw new Error(`未知的挂单收口 cause：${String(cause)}`);
  }
}

/**
 * 语句构造器：返回一条 D1PreparedStatement，调用方保持它在原批内的位置与顺序。
 * 状态/时间窗/类型守卫全在 SQL 里，(from, cause) 不匹配时执行结果为 changes=0。
 */
export function advanceStatement<C extends ListingCloseCause>(
  db: D1Database,
  listingId: number,
  cause: C,
  params: ListingCloseParams<C>,
): D1PreparedStatement {
  const spec = buildSpec(listingId, cause, params as ListingCloseParams<ListingCloseCause>);
  return db.prepare(spec.sql).bind(...spec.bind);
}

/** 便捷执行版：独立语句场景直接跑，返回 meta.changes（0 = 状态不匹配的静默 no-op）。 */
export async function advance<C extends ListingCloseCause>(
  db: D1Database,
  listingId: number,
  cause: C,
  params: ListingCloseParams<C>,
): Promise<number> {
  const result = await advanceStatement(db, listingId, cause, params).run();
  return result.meta.changes ?? 0;
}
