// 惰性结算（TECH_DESIGN §6.5）：任何挂牌相关请求与 cron tick 都先跑一遍 settleOverdue。
// 1) bidding 且交易时段静默满 3h → pending_review（transfer + 审核任务一并建好，UNIQUE 幂等）
// 2) 挂牌所属窗口已 closed：listed（无人出价）→ delisted + 下架费；bidding → 强制进入待审
// 3) 激活挂牌（4.4.2.2）出价窗已过而激活方未落价 → 激活无效（不收费，球员还原训练营态）
// 4) pending_review 缺单据的自愈（结算与建单非原子崩溃后补齐）
// 全部幂等：状态迁移走守卫 UPDATE，重复执行无副作用。
import type { Env } from './env.ts';
import { bidDeadline, delistFee, type TradeCalendar } from '../core/market-rules.ts';
import { ledgerMovement } from './ledger.ts';
import { loadMarketContext, type MarketContext } from './market-context.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { detectBidAlerts } from './bid-alerts.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface SettleSummary {
  settled: number;
  delisted: number;
  voided: number;
  notesUpdated: number;
  healed: number;
}

interface ActiveListingRow {
  id: number;
  player_id: number;
  seller_club_id: number;
  type: string;
  ask_price: number;
  status: string;
  listed_day: string | null;
  last_bid_at: string | null;
  season: number | null;
  window_seq: number | null;
  window_status: string | null;
}

export interface ListingCore {
  id: number;
  player_id: number;
  seller_club_id: number;
  type?: string;
  ask_price: number;
  season: number | null;
  window_seq: number | null;
}

// listings.type → transfers.type 词汇映射（激活挂牌成单记 activation、强制拍卖记 forced_auction，
// 其余按普通转会）
export function transferTypeFor(listingType: string | null | undefined): string {
  if (listingType === 'activation') return 'activation';
  if (listingType === 'forced') return 'forced_auction';
  return 'transfer';
}

// → pending_review：transfer（idempotency_key = listing:{id}，UNIQUE 幂等）+ 审核任务
// 成交买方/价格在 batch 执行时用子查询取「当时的活跃最高出价」，与并发出价请求在 D1 单写者下
// 天然串行，不会漏掉刚落库的更高价。fromStatus 允许从 matched_pending（匹配放行/到期）收口。
export async function settleListingForReview(
  db: D1Database,
  listing: ListingCore,
  actor: number | null,
  fromStatus: 'bidding' | 'matched_pending' | 'listed' = 'bidding',
): Promise<'settled' | 'already'> {
  const audit = createAuditStatement(db);
  const key = `listing:${listing.id}`;
  // 增量 10：成交前异常出价打标（大额/连续抬价/最小步长拉锯）——只进审核单与审计，不拦结算
  const alerts = await detectBidAlerts(db, listing.id);
  const alertsJson = JSON.stringify(alerts);
  const statements = [
    db.prepare(`UPDATE listings SET status = 'pending_review', match_deadline = NULL WHERE id = ? AND status = ?`).bind(listing.id, fromStatus),
    db
      .prepare(
        `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
         SELECT CASE l.type WHEN 'activation' THEN 'activation' WHEN 'forced' THEN 'forced_auction' ELSE 'transfer' END,
                l.player_id, l.seller_club_id,
                (SELECT club_id FROM bids WHERE listing_id = l.id AND status = 'active' ORDER BY amount DESC, id DESC LIMIT 1),
                (SELECT amount FROM bids WHERE listing_id = l.id AND status = 'active' ORDER BY amount DESC, id DESC LIMIT 1),
                'pending_review', l.season, l.window_seq, ?, ${nowSql()}
         FROM listings l
         WHERE l.id = ? AND l.status = 'pending_review'
           AND EXISTS (SELECT 1 FROM bids WHERE listing_id = l.id AND status = 'active')`,
      )
      .bind(key, listing.id),
    db
      .prepare(
        `INSERT INTO review_tasks (type, ref_id, payload, status)
         SELECT 'transfer_confirm', t.id,
                json_object('listingId', CAST(substr(t.idempotency_key, 9) AS INTEGER), 'playerId', t.player_id,
                            'sellerClubId', t.from_club_id, 'buyerClubId', t.to_club_id, 'amount', t.fee,
                            'season', t.season, 'windowSeq', t.window_seq, 'alerts', json(?)),
                'open'
         FROM transfers t
         WHERE t.idempotency_key = ? AND t.status = 'pending_review'`,
      )
      .bind(alertsJson, key),
    db
      .prepare(
        `UPDATE transfers SET review_task_id =
           (SELECT MAX(id) FROM review_tasks
            WHERE ref_id = (SELECT id FROM transfers WHERE idempotency_key = ?) AND type = 'transfer_confirm')
         WHERE idempotency_key = ? AND status = 'pending_review'`,
      )
      .bind(key, key),
    audit({
      actor,
      action: 'listing_settle',
      targetType: 'listing',
      targetId: listing.id,
      after: { playerId: listing.player_id, season: listing.season, windowSeq: listing.window_seq },
    }),
    ...(alerts.length > 0
      ? [
          audit({
            actor,
            action: 'bid_pattern_alert',
            targetType: 'listing',
            targetId: listing.id,
            after: { alerts },
          }),
        ]
      : []),
  ];
  try {
    const results = await db.batch(statements);
    // 首句变更 = 正常结算；次句变更 = 自愈补建（listing 已是 pending_review，只缺单据）
    const changed = (results[0]?.meta.changes ?? 0) > 0 || (results[1]?.meta.changes ?? 0) > 0;
    return changed ? 'settled' : 'already';
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return 'already'; // 并发已结算
    throw err;
  }
}

// 无人出价的挂牌在窗尾下架（4.4.7）：挂牌方付下架费（流水幂等闸防重复扣）。
// 激活挂牌例外：卖家没主动挂牌，激活失效/窗尾收口都不收下架费，球员还原训练营态。
export async function delistUnbid(
  db: D1Database,
  listing: ListingCore,
  ctx: MarketContext,
  actor: number | null,
): Promise<'delisted' | 'already'> {
  const isActivation = listing.type === 'activation';
  const fee = isActivation ? 0 : delistFee(listing.ask_price, ctx.delistFeeRate);
  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(
        `UPDATE listings SET status = 'delisted', deadline_note = ? WHERE id = ? AND status = 'listed'`,
      )
      .bind(isActivation ? '窗口结束激活方仍未落价，激活无效' : '窗口结束无人出价', listing.id),
    db
      .prepare(
        `UPDATE players SET status = CASE WHEN (
           SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1
         ) = 'trainee' THEN 'trainee' ELSE 'normal' END, updated_at = ${nowSql()}
         WHERE id = ? AND status = 'listed'`,
      )
      .bind(listing.player_id, listing.player_id),
    ...(fee > 0
      ? ledgerMovement(db, {
          clubId: listing.seller_club_id,
          delta: -fee,
          kind: 'delist_fee',
          refType: 'listing',
          refId: listing.id,
          memo: '无人出价下架费',
          guardSql: `(SELECT status FROM listings WHERE id = ?) = 'delisted'`,
          guardParams: [listing.id],
        })
      : []),
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'`)
      .bind(listing.id),
    audit({
      actor,
      action: 'listing_delist',
      targetType: 'listing',
      targetId: listing.id,
      after: { fee, reason: isActivation ? 'activation_invalid' : 'window_end_no_bid' },
    }),
  ];
  const results = await db.batch(statements);
  return (results[0]?.meta.changes ?? 0) > 0 ? 'delisted' : 'already';
}

// 激活出价窗失效（4.4.2.2）：激活方未在窗口内落价 → 激活无效。卖家没收下架费，
// 球员按合同类型还原（训练营→trainee、正式→normal）；一窗一次额度已消耗（§6.2 假设，文档定稿口径）。
export async function voidExpiredActivation(db: D1Database, listingId: number, playerId: number, actor: number | null): Promise<boolean> {
  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(
        `UPDATE listings SET status = 'delisted', deadline_note = '激活方未在出价窗内落价，激活无效', activation_deadline = NULL
         WHERE id = ? AND status = 'listed'`,
      )
      .bind(listingId),
    db
      .prepare(
        `UPDATE players SET status = CASE WHEN (
           SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1
         ) = 'trainee' THEN 'trainee' ELSE 'normal' END, updated_at = ${nowSql()}
         WHERE id = ? AND status = 'listed'`,
      )
      .bind(playerId, playerId),
    audit({
      actor,
      action: 'activation_void',
      targetType: 'listing',
      targetId: listingId,
      after: { playerId, reason: 'activator_no_bid' },
    }),
  ];
  const results = await db.batch(statements);
  return (results[0]?.meta.changes ?? 0) > 0;
}

function noteText(day: string, hours: [number, number], calendar: TradeCalendar): string {
  const suffix = calendar === 'none' ? '' : '（按交易日历顺延）';
  const [, m, d] = day.split('-');
  return `截止判定：${Number(m)}月${Number(d)}日 ${hours[0]}:00-${hours[1]}:00${suffix}`;
}

// 全量惰性结算入口：市场相关请求与 cron tick 都走这里
export async function settleOverdue(env: Env, opts: { now?: Date; actor?: number | null } = {}): Promise<SettleSummary> {
  const db = env.DB;
  const ctx = await loadMarketContext(db);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? null;
  const summary: SettleSummary = { settled: 0, delisted: 0, voided: 0, notesUpdated: 0, healed: 0 };

  // 激活首价窗失效（4.4.2.2）：先于窗尾收口处理，避免给卖家误收下架费
  const expired = await db
    .prepare(
      `SELECT l.id, l.player_id FROM listings l
       WHERE l.type = 'activation' AND l.status = 'listed'
         AND l.activated_by IS NOT NULL AND l.activation_deadline IS NOT NULL AND l.activation_deadline < ?
         AND NOT EXISTS (SELECT 1 FROM bids WHERE listing_id = l.id)
       ORDER BY l.id LIMIT 100`,
    )
    .bind(now.toISOString())
    .all<{ id: number; player_id: number }>();
  for (const row of expired.results) {
    if (await voidExpiredActivation(db, row.id, row.player_id, actor)) summary.voided++;
  }

  // 激活首价已落但未收口（收口前崩溃的残留）：listed 已过期且带出价、或 bidding → 直接进待审
  const remnants = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.ask_price, l.status, l.season, l.window_seq
       FROM listings l
       WHERE l.type = 'activation' AND (
         (l.status = 'listed' AND l.activation_deadline IS NOT NULL AND l.activation_deadline < ?
           AND EXISTS (SELECT 1 FROM bids WHERE listing_id = l.id))
         OR l.status = 'bidding'
       )
       ORDER BY l.id LIMIT 100`,
    )
    .bind(now.toISOString())
    .all<ListingCore & { status: string }>();
  for (const row of remnants.results) {
    if ((await settleListingForReview(db, row, actor, row.status === 'bidding' ? 'bidding' : 'listed')) === 'settled') {
      summary.settled++;
    }
  }

  // 匹配窗到期（4.4.2.4）：被激活方 24h 内未提交匹配 → 按激活价（首价）成交进待审
  const matchExpired = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.ask_price, l.season, l.window_seq
       FROM listings l
       WHERE l.type = 'activation' AND l.status = 'matched_pending'
         AND l.match_deadline IS NOT NULL AND l.match_deadline < ?
       ORDER BY l.id LIMIT 100`,
    )
    .bind(now.toISOString())
    .all<ListingCore>();
  for (const row of matchExpired.results) {
    if ((await settleListingForReview(db, row, actor, 'matched_pending')) === 'settled') summary.settled++;
  }

  const active = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_day, l.last_bid_at, l.season, l.window_seq,
              sw.status AS window_status
       FROM listings l
       LEFT JOIN season_windows sw ON sw.season = l.season AND sw.window_seq = l.window_seq
       WHERE l.status IN ('listed', 'bidding')
       ORDER BY l.id LIMIT 200`,
    )
    .all<ActiveListingRow>();

  for (const row of active.results) {
    const core: ListingCore = {
      id: row.id,
      player_id: row.player_id,
      seller_club_id: row.seller_club_id,
      type: row.type,
      ask_price: row.ask_price,
      season: row.season,
      window_seq: row.window_seq,
    };
    const windowClosed = row.window_status === 'closed';
    if (windowClosed) {
      // 窗尾收口：没人出价的下架收费；还有竞价的强制进待审（成交确认交管理组裁量）
      if (row.status === 'listed') {
        if ((await delistUnbid(db, core, ctx, actor)) === 'delisted') summary.delisted++;
      } else if ((await settleListingForReview(db, core, actor)) === 'settled') summary.settled++;
      continue;
    }
    if (row.status !== 'bidding') continue; // listed 且窗未关：等窗尾
    if (row.listed_day === null) continue;
    const deadline = bidDeadline({
      lastBidAt: row.last_bid_at,
      listedDay: row.listed_day,
      now,
      deadlineHours: ctx.deadlineHours,
      silenceHours: ctx.silenceHours,
      calendar: ctx.calendar,
    });
    if (deadline.met) {
      if ((await settleListingForReview(db, core, actor)) === 'settled') summary.settled++;
      continue;
    }
    const note = noteText(deadline.deadlineDay, ctx.deadlineHours, ctx.calendar);
    const r = await db
      .prepare(`UPDATE listings SET deadline_note = ? WHERE id = ? AND status = 'bidding' AND (deadline_note IS NULL OR deadline_note != ?)`)
      .bind(note, row.id, note)
      .run();
    if (r.meta.changes > 0) summary.notesUpdated++;
  }

  // 自愈：pending_review 但单据缺失（结算建单跨语句崩溃的残留），补齐 transfer + 审核任务
  const broken = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.ask_price, l.season, l.window_seq
       FROM listings l
       LEFT JOIN transfers t ON t.idempotency_key = 'listing:' || l.id
       WHERE l.status = 'pending_review' AND t.id IS NULL
       ORDER BY l.id LIMIT 100`,
    )
    .all<ListingCore>();
  for (const row of broken.results) {
    if ((await settleListingForReview(db, row, actor)) === 'settled') summary.healed++;
  }

  return summary;
}
