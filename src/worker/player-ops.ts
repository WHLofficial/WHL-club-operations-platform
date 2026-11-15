// players.status 写侧唯一入口（v6.87.0）：还原类 6 cause 与 pure 类 10 cause 的
// `UPDATE players SET status` 只在本文件构造。调用方把语句按原下标放回自己的 db.batch
// （资金/过户/通知的副作用顺序不变）；只有独立语句场景才用 advance(...)（内部 .run()）。
// 分层镜像 src/worker/listing-ops.ts（v6.83.0）：core/player-state.ts 是语义真源（零 IO），
// 本文件每条 SQL 的 WHERE 守卫是执行真源——(from, cause) 不匹配时 changes=0 静默 no-op，
// 不抛 409；调用方照旧按 changes 分支。
//
// 命名冲突注意：listing-ops.ts 也有同名 advanceStatement / advance。后续批迁移 pure 写点时，
// 两个收编文件将同时 import 两个同名符号——统一用别名 `advancePlayerStatement` /
// `advancePlayer`（v6.87.0 测试计划 TC-SRC-03 的按来源归组计数依据）。
import type { PurePlayerCause } from '../core/player-state.ts';

/** 与 market-settle.ts / listing-ops.ts 同口径的 SQL 时刻表达式（秒级毫秒 + Z） */
function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface MarketListParams {
  playerId: number;
  clubId: number;
}

export interface OfferAcceptedListParams {
  playerId: number;
  /** 卖方俱乐部（= 球员现行归属，守卫 club_id = ? 用它） */
  sellerClubId: number;
}

export interface ActivationListParams {
  playerId: number;
  clubId: number;
}

export interface ForcedAuctionListParams {
  playerId: number;
  /** null = 自由身强拍（club_id IS NULL + status='free' 分支）；非空 = 在册分支（status='normal'） */
  clubId: number | null;
}

export interface ForcedAuctionCancelParams {
  playerId: number;
  /** null = 自由身单还原 free；非空 = 在册单还原 normal（bypass.ts:832/835 分支） */
  sellerClubId: number | null;
}

export interface DemoteParams {
  playerId: number;
  clubId: number;
  /** 调用方构造好的复合守卫（statusGuard + 幂等键 EXISTS），字符串透传不重写（promotion.ts:202-206 现状） */
  settledGuard: string;
}

export interface PlayerOnlyParams {
  playerId: number;
}

export interface TransferTermsParams {
  playerId: number;
  clubId: number;
  /** 目标态由成约条款决定（terms.contractType 三元），同值重写幂等靠入口 terms_applied 短路 */
  to: 'trainee' | 'normal';
}

export interface ImportSyncParams {
  playerId: number;
  /** 反向自限：目标≠现态才生效（守卫 status = from），不碰挂牌等状态 */
  to: 'trainee' | 'normal';
  from: 'trainee' | 'normal';
}

export interface PlayerCauseParamsMap {
  market_list: MarketListParams;
  offer_accepted_list: OfferAcceptedListParams;
  activation_list: ActivationListParams;
  forced_auction_list: ForcedAuctionListParams;
  forced_auction_cancel: ForcedAuctionCancelParams;
  demote: DemoteParams;
  promotion_complete: PlayerOnlyParams;
  match_terms: PlayerOnlyParams;
  transfer_terms: TransferTermsParams;
  import_sync: ImportSyncParams;
}

export type PlayerCauseParams<C extends PurePlayerCause> = PlayerCauseParamsMap[C];

interface AdvanceSpec {
  sql: string;
  bind: unknown[];
}

// 按 cause 的构造器表：映射类型把每个 cause 与自己的 params 类型关联起来，
// 各构造器拿到的 params 都是其确切接口（无 as / any，仓库铁律）。
const STATEMENT_BUILDERS: { [C in PurePlayerCause]: (playerId: number, params: PlayerCauseParamsMap[C]) => AdvanceSpec } = {
  market_list: (playerId, params) => ({
    sql: `UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`,
    bind: [playerId, params.clubId],
  }),
  offer_accepted_list: (playerId, params) => ({
    // not_for_sale = 0 与同批 INSERT 的 EXISTS 守卫对齐（offers.ts:461）——非卖品失败时不得翻转 listed
    sql: `UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal' AND not_for_sale = 0`,
    bind: [playerId, params.sellerClubId],
  }),
  activation_list: (playerId, params) => ({
    sql: `UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status IN ('normal', 'trainee')`,
    bind: [playerId, params.clubId],
  }),
  // 双分支（bypass.ts:754/757 三元收编）：自由身只吃 free、在册只吃 normal
  forced_auction_list: (playerId, params) =>
    params.clubId === null
      ? {
          sql: `UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id IS NULL AND status = 'free'`,
          bind: [playerId],
        }
      : {
          sql: `UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`,
          bind: [playerId, params.clubId],
        },
  // 双分支（bypass.ts:832/835 三元收编）：自由身单还原 free、在册单还原 normal
  forced_auction_cancel: (playerId, params) =>
    params.sellerClubId === null
      ? {
          sql: `UPDATE players SET status = 'free', updated_at = ${nowSql()} WHERE id = ? AND club_id IS NULL AND status = 'listed'`,
          bind: [playerId],
        }
      : {
          sql: `UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'listed'`,
          bind: [playerId, params.sellerClubId],
        },
  demote: (playerId, params) => ({
    sql: `UPDATE players SET status = 'trainee', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND ${params.settledGuard}`,
    bind: [playerId, params.clubId],
  }),
  promotion_complete: (playerId) => ({
    sql: `UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND status = 'trainee'`,
    bind: [playerId],
  }),
  // 与 promotion_complete 同 SQL（transfers.ts:673/:1084 两处逐字同）
  match_terms: (playerId) => ({
    sql: `UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND status = 'trainee'`,
    bind: [playerId],
  }),
  // 不挂 gate：幂等靠入口 terms_applied 短路 + 同批合同语句带 gate（分层原样，transfers.ts:1118-1126）
  transfer_terms: (playerId, params) => ({
    sql: `UPDATE players SET status = ?, updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status IN ('normal', 'trainee')`,
    bind: [params.to, playerId, params.clubId],
  }),
  import_sync: (playerId, params) => ({
    sql: `UPDATE players SET status = ?, updated_at = ${nowSql()} WHERE id = ? AND status = ?`,
    bind: [params.to, playerId, params.from],
  }),
};

/**
 * 语句构造器：返回一条 D1PreparedStatement，调用方保持它在原批内的位置与顺序。
 * 状态/归属守卫全在 SQL 里，(from, cause) 不匹配时执行结果为 changes=0。
 * 构造器零 IO（不预热、不 run、不 batch），批内下标耦合（activations.ts:301 的 results[2]、
 * offers.ts:536 的 results[1] 等）不容平移。
 */
export function advanceStatement<C extends PurePlayerCause>(
  db: D1Database,
  playerId: number,
  cause: C,
  params: PlayerCauseParams<C>,
): D1PreparedStatement {
  const builder = STATEMENT_BUILDERS[cause];
  if (!builder) throw new Error(`未知的球员状态 cause：${String(cause)}`);
  const spec = builder(playerId, params);
  return db.prepare(spec.sql).bind(...spec.bind);
}

/** 便捷执行版：独立语句场景直接跑，返回 meta.changes（0 = 状态不匹配的静默 no-op）。 */
export async function advance<C extends PurePlayerCause>(
  db: D1Database,
  playerId: number,
  cause: C,
  params: PlayerCauseParams<C>,
): Promise<number> {
  const result = await advanceStatement(db, playerId, cause, params).run();
  return result.meta.changes ?? 0;
}

// ---- 还原统一口径（v6.87.0 批 1 收编六处还原写点） ----

// 还原 CASE 母本（src/worker/market-settle.ts:184-190 逐字）：分支顺序 club_id 优先于合同判定。
// 把合同判定挪前的实现在 free + 残留 active trainee 合同的脏行上会落 trainee（幽灵复活）。
const RESTORE_CASE_SQL = `CASE
   WHEN club_id IS NULL THEN 'free'
   WHEN (SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1) = 'trainee' THEN 'trainee'
   ELSE 'normal' END`;

/**
 * 挂牌相关收口后的球员还原（母本 = delistUnbid 的 P1-1 修复形态）：
 * `status='listed'` 闸 + listingId 非 null 时的 `EXISTS(listings id=? status='delisted')` 守卫。
 * EXISTS 读同批先行 listings 收口语句的落库值（D1 batch 串行可见，先例 delistUnbid
 * `market-settle.ts:179→184`）——并发出价/结算交错致挂牌没改成 delisted 时不再无脑还原（防幻影）。
 * listingId 传 null（match 单 / 无关联挂牌单据）= 同值透传不加 EXISTS：恒假 EXISTS 会把还原吞掉。
 */
export function restoreAfterListing(db: D1Database, playerId: number, listingId: number | null): D1PreparedStatement {
  // 两形态共享同一模板：listingId null 形态 = 守卫形态剥掉 EXISTS 行的其余文本逐字相同
  //（tests/player-state.test.ts TC-CTX-03 文本级锁依赖这条关系）
  const guard = listingId === null ? '' : `\n         AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'delisted')`;
  const bind = listingId === null ? [playerId, playerId] : [playerId, playerId, listingId];
  return db
    .prepare(
      `UPDATE players SET status = ${RESTORE_CASE_SQL}, updated_at = ${nowSql()}
       WHERE id = ? AND status = 'listed'${guard}`,
    )
    .bind(...bind);
}

/** 谈判作废收口的还原 = 无守卫等价形态（与 restoreAfterListing(listingId=null) 文本全等）。 */
export function restoreAfterNegotiation(db: D1Database, playerId: number): D1PreparedStatement {
  return restoreAfterListing(db, playerId, null);
}
