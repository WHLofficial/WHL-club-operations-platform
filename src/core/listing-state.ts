// 挂单终态转移表（v6.83.0）：listings 状态迁移的语义唯一真源。
// 只声明「哪些 (from, cause) 合法、落到哪个状态」——零 IO、不抛错、可表驱动测试。
// 运行时执行真源是 src/worker/listing-ops.ts 里每条 UPDATE 的 WHERE 守卫：
// (from, cause) 不匹配时 changes=0 静默 no-op，调用方按 changes 分支，不靠本表判错。
export type ListingStatus = 'listed' | 'bidding' | 'matched_pending' | 'pending_review' | 'delisted';

// 12 个收口 cause（v6.83.0 收编范围）；顺序与 listing-ops / 测试矩阵一致。
export const LISTING_CLOSE_CAUSES = [
  'first_bid',
  'activation_match_start',
  'settle_for_review',
  'unbid_expired',
  'activation_price_expired',
  'admin_reset',
  'admin_cancel',
  'forced_cancel',
  'matched_kept',
  'negotiation_closed',
  'review_rejected',
  'deal_done',
] as const;

export type ListingCloseCause = (typeof LISTING_CLOSE_CAUSES)[number];

export interface ListingCloseTransition {
  readonly cause: ListingCloseCause;
  /** 合法起始态；不在此列的 (from, cause) 在 SQL 守卫下静默 no-op */
  readonly from: readonly ListingStatus[];
  readonly to: ListingStatus;
}

export const LISTING_CLOSE_TRANSITIONS: readonly ListingCloseTransition[] = [
  // first_bid 是「重写式」转移：listed/bidding 都允许，bidding 上再落价仍走同一条 UPDATE
  { cause: 'first_bid', from: ['listed', 'bidding'], to: 'bidding' },
  // 激活挂牌首价落定 → 匹配等待（fromStatus 由调用方按当前行状态选 listed/bidding）
  { cause: 'activation_match_start', from: ['listed', 'bidding'], to: 'matched_pending' },
  // bidding/matched_pending/listed → 待审（后两句建单据/审核任务以首句确实改到行为前提）
  { cause: 'settle_for_review', from: ['bidding', 'matched_pending', 'listed'], to: 'pending_review' },
  { cause: 'unbid_expired', from: ['listed'], to: 'delisted' },
  { cause: 'activation_price_expired', from: ['listed'], to: 'delisted' },
  { cause: 'admin_reset', from: ['bidding'], to: 'listed' },
  { cause: 'admin_cancel', from: ['listed', 'matched_pending'], to: 'delisted' },
  { cause: 'forced_cancel', from: ['listed', 'bidding'], to: 'delisted' },
  { cause: 'matched_kept', from: ['matched_pending'], to: 'delisted' },
  { cause: 'negotiation_closed', from: ['pending_review'], to: 'delisted' },
  { cause: 'review_rejected', from: ['pending_review'], to: 'delisted' },
  // deal_done 是四态 catch-all（v6.66.0 疤痕，刻意不收敛，见 docs/test-plans/v6.83.0-listing-closeout.md L8）
  { cause: 'deal_done', from: ['listed', 'bidding', 'matched_pending', 'pending_review'], to: 'delisted' },
];

const TRANSITION_BY_CAUSE: ReadonlyMap<ListingCloseCause, ListingCloseTransition> = new Map(
  LISTING_CLOSE_TRANSITIONS.map((transition) => [transition.cause, transition]),
);

/** 纯函数：给定起点与 cause，返回合法目标态；不在转移表内（含未知状态）返回 null。 */
export function advanceTarget(from: string, cause: ListingCloseCause): ListingStatus | null {
  const transition = TRANSITION_BY_CAUSE.get(cause);
  if (transition === undefined) return null;
  return (transition.from as readonly string[]).includes(from) ? transition.to : null;
}
