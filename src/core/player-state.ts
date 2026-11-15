// players.status 转移表（v6.87.0 批 1）：18 个收编 cause 的语义唯一真源。
// 分层镜像 v6.83.0 的 listing 双件套：本文件零 IO、不抛错、可表驱动测试；
// 运行时执行真源是 src/worker/player-ops.ts 里每条 UPDATE 的 WHERE 守卫——
// (from, cause) 不匹配时 changes=0 静默 no-op，调用方按 changes 分支，不靠本表判错。
//
// 三处例外不收编（登记见 docs/test-plans/v6.87.0-player-ops-state.md L8）：
// revert_snapshot（deal-revert.ts 快照还原两列、零守卫）、admin_set（routes/admin/players.ts
// 动态白名单列，retired 唯一写通道）、retire（无生命周期写点，I4 后台手工态）——均不进本表。
export type PlayerStatus = 'normal' | 'listed' | 'trainee' | 'free' | 'retired';

// 10 个 pure cause：SQL 单列 SET，目标态静态或由 params 定（随后续批迁入 player-ops）。
export type PurePlayerCause =
  | 'market_list'
  | 'offer_accepted_list'
  | 'activation_list'
  | 'forced_auction_list'
  | 'forced_auction_cancel'
  | 'demote'
  | 'promotion_complete'
  | 'match_terms'
  | 'transfer_terms'
  | 'import_sync';

// 6 个还原 cause：目标态按行上下文派生（CASE 母本），SQL 只在 player-ops.ts 的
// restoreAfterListing / restoreAfterNegotiation 构造（批 1 已收编六处还原写点）。
export type RestorePlayerCause =
  | 'listing_expire_unbid'
  | 'activation_price_expired'
  | 'admin_void_restore'
  | 'negotiation_void_restore'
  | 'review_reject_restore'
  | 'activation_matched_kept';

export const PLAYER_PURE_CAUSES: readonly PurePlayerCause[] = [
  'market_list',
  'offer_accepted_list',
  'activation_list',
  'forced_auction_list',
  'forced_auction_cancel',
  'demote',
  'promotion_complete',
  'match_terms',
  'transfer_terms',
  'import_sync',
];

export const PLAYER_RESTORE_CAUSES: readonly RestorePlayerCause[] = [
  'listing_expire_unbid',
  'activation_price_expired',
  'admin_void_restore',
  'negotiation_void_restore',
  'review_reject_restore',
  'activation_matched_kept',
];

// 18 个收编 cause = 10 pure + 6 restore + 2 compound（transfers.ts 多列 SQL 原位保留，
// status 目标值由 resolveTarget 运行时产出）。
export type PlayerCause = PurePlayerCause | RestorePlayerCause | 'transfer_complete' | 'terminate';

// 目标态需要上下文派生的 cause：还原类 6 + compound 2（resolveTarget 的定义域）。
export type DerivedTargetCause = RestorePlayerCause | 'transfer_complete' | 'terminate';

// 还原类上下文：hasClub = club_id 是否非 NULL；contractType = 现行 active 合同类型（无合同为 null）。
export interface PlayerRestoreCtx {
  hasClub: boolean;
  contractType: string | null;
}

// transfer_complete 上下文（transfers.ts:369-375 三元等价）：dealTermsContractType 缺省
//（undefined）= A 分支无成约条款，按现行合同判定；currentContractType = 现行合同类型（无合同 null）。
export interface TransferCompleteCtx {
  dealTermsContractType?: 'trainee' | 'formal';
  currentContractType?: string | null;
}

// 目标态规格：静态值 / 还原类上下文派生 / compound 两式 / params 定（分支与 to 参数）。
export type PlayerTargetSpec =
  | { mode: 'static'; value: PlayerStatus }
  | { mode: 'restore' }
  | { mode: 'transfer_complete' }
  | { mode: 'terminate' }
  | { mode: 'club_branch' }
  | { mode: 'to_param' };

export interface PlayerCauseMeta {
  kind: 'pure' | 'restore' | 'compound';
  /** status 守卫的合法 from 集；null = 不设 status 守卫（compound 两 cause，守卫轴是 club 归属） */
  readonly from: readonly PlayerStatus[] | null;
  readonly target: PlayerTargetSpec;
  /**
   * 双分支 cause（params 选分支）各分支各自的合法 from 集：branch 'free' = clubId/sellerClubId
   * 为 null 的分支，'club' = 非空分支。单分支 cause 无此字段（from 即唯一分支的合法集）。
   */
  readonly branchFrom?: { free: readonly PlayerStatus[]; club: readonly PlayerStatus[] };
}

export const PLAYER_TRANSITIONS: Record<PlayerCause, PlayerCauseMeta> = {
  market_list: { kind: 'pure', from: ['normal'], target: { mode: 'static', value: 'listed' } },
  offer_accepted_list: { kind: 'pure', from: ['normal'], target: { mode: 'static', value: 'listed' } },
  // 唯一允许 trainee 起点的 list cause（activations.ts:122）
  activation_list: { kind: 'pure', from: ['normal', 'trainee'], target: { mode: 'static', value: 'listed' } },
  // 双分支：clubId=null 吃 free / clubId≠null 吃 normal（bypass.ts:754/757，分支由 params 选定）
  forced_auction_list: {
    kind: 'pure',
    from: ['free', 'normal'],
    target: { mode: 'static', value: 'listed' },
    branchFrom: { free: ['free'], club: ['normal'] },
  },
  // 双分支：sellerClubId=null → free / 非空 → normal（bypass.ts:832/835）；两分支起点都是 listed
  forced_auction_cancel: {
    kind: 'pure',
    from: ['listed'],
    target: { mode: 'club_branch' },
    branchFrom: { free: ['listed'], club: ['listed'] },
  },
  demote: { kind: 'pure', from: ['normal'], target: { mode: 'static', value: 'trainee' } },
  promotion_complete: { kind: 'pure', from: ['trainee'], target: { mode: 'static', value: 'normal' } },
  match_terms: { kind: 'pure', from: ['trainee'], target: { mode: 'static', value: 'normal' } },
  // 目标 = params.to（terms.contractType 三元），同值重写幂等靠入口 terms_applied 短路
  transfer_terms: { kind: 'pure', from: ['normal', 'trainee'], target: { mode: 'to_param' } },
  // 目标 = params.to，反向自限（守卫 status = params.from，目标≠现态才生效）
  import_sync: { kind: 'pure', from: ['normal', 'trainee'], target: { mode: 'to_param' } },
  listing_expire_unbid: { kind: 'restore', from: ['listed'], target: { mode: 'restore' } },
  activation_price_expired: { kind: 'restore', from: ['listed'], target: { mode: 'restore' } },
  admin_void_restore: { kind: 'restore', from: ['listed'], target: { mode: 'restore' } },
  negotiation_void_restore: { kind: 'restore', from: ['listed'], target: { mode: 'restore' } },
  review_reject_restore: { kind: 'restore', from: ['listed'], target: { mode: 'restore' } },
  activation_matched_kept: { kind: 'restore', from: ['listed'], target: { mode: 'restore' } },
  transfer_complete: { kind: 'compound', from: null, target: { mode: 'transfer_complete' } },
  terminate: { kind: 'compound', from: null, target: { mode: 'terminate' } },
};

/**
 * 还原统一口径（语义真源，与 player-ops.ts 的 CASE 母本同判据）：
 * club_id IS NULL → 'free'；active 合同 trainee → 'trainee'；否则 'normal'。
 * 分支顺序 club_id 优先于合同判定（母本 src/worker/market-settle.ts:184-190 逐字为据）——
 * 把合同判定挪前的实现在 free + 残留 active trainee 合同的脏行上会落 trainee（幽灵复活）。
 */
function deriveRestoreTarget(ctx: PlayerRestoreCtx): PlayerStatus {
  if (!ctx.hasClub) return 'free';
  return ctx.contractType === 'trainee' ? 'trainee' : 'normal';
}

/**
 * 上下文派生目标态（纯函数、零 IO、运行时不抛）。还原类必须看 ctx，不能只按 (from, cause)；
 * terminate 恒 'free'；transfer_complete 按「dealTerms 优先、否则现行合同、无合同回 normal」。
 */
export function resolveTarget(cause: RestorePlayerCause, ctx: PlayerRestoreCtx): PlayerStatus;
export function resolveTarget(cause: 'transfer_complete', ctx: TransferCompleteCtx): PlayerStatus;
export function resolveTarget(cause: 'terminate'): PlayerStatus;
export function resolveTarget(cause: DerivedTargetCause, ctx?: PlayerRestoreCtx | TransferCompleteCtx): PlayerStatus {
  if (cause === 'terminate') return 'free';
  if (cause === 'transfer_complete') {
    const terms = ctx && 'dealTermsContractType' in ctx ? ctx.dealTermsContractType : undefined;
    if (terms !== undefined) return terms === 'trainee' ? 'trainee' : 'normal';
    const current = ctx && 'currentContractType' in ctx ? (ctx.currentContractType ?? null) : null;
    return current === 'trainee' ? 'trainee' : 'normal';
  }
  // 还原类：类型层经重载保证 ctx 形状；走不到重载的调用在实现签名里按无归属兜底（不抛）
  const hasClub = ctx !== undefined && 'hasClub' in ctx ? ctx.hasClub === true : false;
  const contractType = ctx !== undefined && 'contractType' in ctx ? (ctx.contractType ?? null) : null;
  return deriveRestoreTarget({ hasClub, contractType });
}
