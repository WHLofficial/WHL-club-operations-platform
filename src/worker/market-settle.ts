// 惰性结算（TECH_DESIGN §6.5）：任何挂牌相关请求与 cron tick 都先跑一遍 settleOverdue。
// 1) bidding 且交易时段静默满 3h → pending_review（transfer + 审核任务一并建好，UNIQUE 幂等）；
//    v6.24.0 起挂牌即落 deadline_at，listed 也走同一到期判定：到期无人出价 → 提前下架收费
// 2) 挂牌所属窗口已 closed：listed（无人出价）→ delisted + 下架费；bidding → 强制进入待审
// 3) 激活挂牌（4.4.2.2）出价窗已过而激活方未落价 → 激活无效（不收费，球员还原训练营态）；
//    激活方落价后转公开竞价，截止后按被激活方合同类型分流（训练营 → 待审；正式 → 24h 匹配等待）
// 4) pending_review 缺单据的自愈（结算与建单非原子崩溃后补齐）
// 全部幂等：状态迁移走守卫 UPDATE，重复执行无副作用。
import type { Env } from './env.ts';
import { bidDeadline, delistFee, shanghaiDateStr, type TradeCalendar } from '../core/market-rules.ts';
import { ledgerMovement } from './ledger.ts';
import { loadMarketContext, type MarketContext } from './market-context.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { detectBidAlerts } from './bid-alerts.ts';
import { expireStaleOffers } from './offers.ts';
import { queueClubNotification } from './notify.ts';
import { sqlDisplayName } from '../core/player-name.ts';

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
  deadline_at: string | null;
  season: number | null;
  window_seq: number | null;
  window_status: string | null;
  bid_count: number;
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

// → pending_review：transfer（idempotency_key = listing:{id}，UNIQUE 幂等）+ 审核任务
// 成交买方/价格在 batch 执行时用子查询取「当时的活跃最高出价」，与并发出价请求在 D1 单写者下
// 天然串行，不会漏掉刚落库的更高价。fromStatus 允许从 matched_pending（匹配放行/到期）收口。
export async function settleListingForReview(
  db: D1Database,
  listing: ListingCore,
  actor: number | null,
  origin: AuditOrigin,
  fromStatus: 'bidding' | 'matched_pending' | 'listed' = 'bidding',
): Promise<'settled' | 'already'> {
  const audit = createAuditStatement(db);
  const key = `listing:${listing.id}`;
  // v1.3.0：成交前异常出价打标（大额/连续抬价/最小步长拉锯）——只进审核单与审计，不拦结算
  const alerts = await detectBidAlerts(db, listing.id);
  const alertsJson = JSON.stringify(alerts);
  const statements = [
    db.prepare(`UPDATE listings SET status = 'pending_review', match_deadline = NULL, deadline_at = NULL WHERE id = ? AND status = ?`).bind(listing.id, fromStatus),
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
      origin,
      after: { playerId: listing.player_id, season: listing.season, windowSeq: listing.window_seq },
      // 评审修复（P1-2）：只有本批确实把挂牌收到 pending_review（或自愈补单场景下它已是
      // pending_review）才写审计——空跑（守卫 0 行、单据没动）不留幻影审计
      guardSql: `(SELECT status FROM listings WHERE id = ?) = 'pending_review'`,
      guardParams: [listing.id],
    }),
    ...(alerts.length > 0
      ? [
          audit({
            actor,
            action: 'bid_pattern_alert',
            targetType: 'listing',
            targetId: listing.id,
            origin,
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

// 无人出价的挂牌下架（4.4.7）：挂牌方付下架费（流水幂等闸防重复扣）。
// 激活挂牌例外：卖家没主动挂牌，激活失效/窗尾收口都不收下架费，球员还原训练营态。
// source（评审修复 P2-④）：'deadline' = 截止时刻到点无人出价；'window_end' = 转会窗关闭收口。
export async function delistUnbid(
  db: D1Database,
  listing: ListingCore,
  ctx: MarketContext,
  actor: number | null,
  origin: AuditOrigin,
  source: 'deadline' | 'window_end' = 'window_end',
): Promise<'delisted' | 'already'> {
  const isActivation = listing.type === 'activation';
  const fee = isActivation ? 0 : delistFee(listing.ask_price, ctx.delistFeeRate);
  const audit = createAuditStatement(db);
  const unbidNote = source === 'deadline' ? '截止时刻无人出价' : '窗口结束无人出价';
  const statements = [
    db
      .prepare(
        `UPDATE listings SET status = 'delisted', deadline_note = ? WHERE id = ? AND status = 'listed'`,
      )
      .bind(isActivation ? '窗口结束激活方仍未落价，激活无效' : unbidNote, listing.id),
    // 评审修复（P1-1）：球员还原/解冻/审计都必须以「本批确实把挂牌改成 delisted」为前提。
    // 与并发出价交错（本句 0 行改）时，旧版会把球员还原成非挂牌态、把冻结放掉、写幻影审计
    db
      .prepare(
        `UPDATE players SET status = CASE WHEN (
           SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1
         ) = 'trainee' THEN 'trainee' ELSE 'normal' END, updated_at = ${nowSql()}
         WHERE id = ? AND status = 'listed'
           AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'delisted')`,
      )
      .bind(listing.player_id, listing.player_id, listing.id),
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
      .prepare(
        `UPDATE fund_holds SET status = 'released'
         WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'
           AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'delisted')`,
      )
      .bind(listing.id, listing.id),
    audit({
      actor,
      action: 'listing_delist',
      targetType: 'listing',
      targetId: listing.id,
      origin,
      after: { fee, reason: isActivation ? 'activation_invalid' : source === 'deadline' ? 'deadline_no_bid' : 'window_end_no_bid' },
      guardSql: `(SELECT status FROM listings WHERE id = ?) = 'delisted'`,
      guardParams: [listing.id],
    }),
  ];
  const results = await db.batch(statements);
  return (results[0]?.meta.changes ?? 0) > 0 ? 'delisted' : 'already';
}

// 激活出价窗失效（4.4.2.2）：激活方未在窗口内落价 → 激活无效。卖家没收下架费，
// 球员按合同类型还原（训练营→trainee、正式→normal）；一窗一次额度已消耗（§6.2 假设，文档定稿口径）。
export async function voidExpiredActivation(
  db: D1Database,
  listingId: number,
  playerId: number,
  actor: number | null,
  origin: AuditOrigin,
): Promise<boolean> {
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
         WHERE id = ? AND status = 'listed'
           AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'delisted')`,
      )
      .bind(playerId, playerId, listingId),
    audit({
      actor,
      action: 'activation_void',
      targetType: 'listing',
      targetId: listingId,
      origin,
      after: { playerId, reason: 'activator_no_bid' },
      guardSql: `(SELECT status FROM listings WHERE id = ?) = 'delisted'`,
      guardParams: [listingId],
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

// v6.24.0：截止后按合同类型分流（只对激活挂牌）——被激活方对该球员的现行合同是正式合同
// （即非训练营）时，先给 24h 匹配等待（match_deadline = now + matchWindowHours，匹配基准 = 竞价最高价）；
// 训练营合同条款固定（固定 5m，无匹配可言）与普通挂牌照旧直接进待审。
// 返回 matching = 已转匹配等待，settled/already 与 settleListingForReview 同义。
async function settleByContractType(
  env: Env,
  core: ListingCore,
  actor: number | null,
  origin: AuditOrigin,
  fromStatus: 'bidding' | 'listed',
  ctx: MarketContext,
): Promise<'settled' | 'matching' | 'already'> {
  if (core.type === 'activation') {
    const contract = await env.DB.prepare('SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1 LIMIT 1')
      .bind(core.player_id)
      .first<{ contract_type: string | null }>();
    if (contract?.contract_type !== 'trainee') {
      const matchDeadline = new Date(Date.now() + ctx.matchWindowHours * 3600_000).toISOString();
      const r = await env.DB.prepare(
        `UPDATE listings SET status = 'matched_pending', match_deadline = ?, deadline_at = NULL, deadline_note = NULL
         WHERE id = ? AND status = ?`,
      )
        .bind(matchDeadline, core.id, fromStatus)
        .run();
      return (r.meta.changes ?? 0) > 0 ? 'matching' : 'already';
    }
  }
  return settleListingForReview(env.DB, core, actor, origin, fromStatus);
}

// 全量惰性结算入口：市场相关请求与 cron tick 都走这里。
// origin 必填：这条结算到底是哪条入口触发的，由调用方声明（见 lib/audit.ts 的通道取值）。
export async function settleOverdue(
  env: Env,
  opts: { origin: AuditOrigin; now?: Date; actor?: number | null },
): Promise<SettleSummary> {
  const db = env.DB;
  const ctx = await loadMarketContext(db);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? null;
  const origin = opts.origin;
  const summary: SettleSummary = { settled: 0, delisted: 0, voided: 0, notesUpdated: 0, healed: 0 };

  // 报价惰性过期 + 自愈（v6.3.0）：窗关 / 球员已不在卖方 / 同球员已挂牌的 pending 单收口；
  // 先于市场结算跑（过期释放冻结，别让出价预检读到没释放的冻结）
  await expireStaleOffers(env, { actor, origin });

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
    if (await voidExpiredActivation(db, row.id, row.player_id, actor, origin)) summary.voided++;
  }

  // 激活首价已落但未收口（收口前崩溃的残留）：listed 已过期且带出价（v6.24.0 后新单不会停在此态，
  // 仅存量/异常残留）→ 与正常截止同口径分流（正式合同进匹配等待，训练营直接进待审）
  const remnants = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.season, l.window_seq
       FROM listings l
       WHERE l.type = 'activation' AND l.status = 'listed'
         AND l.activation_deadline IS NOT NULL AND l.activation_deadline < ?
         AND EXISTS (SELECT 1 FROM bids WHERE listing_id = l.id)
       ORDER BY l.id LIMIT 100`,
    )
    .bind(now.toISOString())
    .all<ListingCore & { status: string }>();
  for (const row of remnants.results) {
    const r = await settleByContractType(env, row, actor, origin, 'listed', ctx);
    if (r === 'settled') summary.settled++;
  }

  // 匹配窗到期（4.4.2.4）：被激活方 24h 内未提交匹配 → 按竞价最高价成交进待审
  const matchExpired = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.ask_price, l.activated_by, l.season, l.window_seq,
              ${sqlDisplayName('p')} AS player_name
       FROM listings l
       JOIN players p ON p.id = l.player_id
       WHERE l.type = 'activation' AND l.status = 'matched_pending'
         AND l.match_deadline IS NOT NULL AND l.match_deadline < ?
       ORDER BY l.id LIMIT 100`,
    )
    .bind(now.toISOString())
    .all<ListingCore & { activated_by: number | null; player_name: string }>();
  for (const row of matchExpired.results) {
    if ((await settleListingForReview(db, row, actor, origin, 'matched_pending')) === 'settled') {
      summary.settled++;
      // 证据制配套通知（v6.4.0 改动 4）：匹配窗到期未匹配，两边各知会一声
      await queueClubNotification(env, row.activated_by, 'activation_match_expired', { listingId: row.id, player: row.player_name });
      await queueClubNotification(env, row.seller_club_id, 'activation_match_expired', { listingId: row.id, player: row.player_name });
    }
  }

  const active = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_day, l.last_bid_at, l.deadline_at, l.season, l.window_seq,
              sw.status AS window_status,
              (SELECT COUNT(*) FROM bids WHERE listing_id = l.id AND status = 'active') AS bid_count
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
      // 窗尾收口：没人出价的下架收费；还有竞价的强制收口（成交确认交管理组裁量）
      if (row.status === 'listed') {
        if ((await delistUnbid(db, core, ctx, actor, origin)) === 'delisted') summary.delisted++;
      } else {
        const r = await settleByContractType(env, core, actor, origin, 'bidding', ctx);
        if (r === 'settled') summary.settled++;
      }
      continue;
    }
    // v6.24.0 评审修复（P0-2）：listed 的提前收口只对普通挂牌生效。激活挂牌首价窗由上方
    // expired / remnants 两段处理；强制拍卖挂牌不落 deadline_at（首笔出价才落），
    // 若按实时算会被判「挂牌次日 21:00 到期」而提前下架收费——它的合法出口只有窗尾收口与管理方取消
    if (row.status === 'listed' && row.type !== 'normal') continue;
    // 改动 A 两级判定：落库列优先（出价时刻算定的绝对截止，不容漂移），存量行 NULL 回落实时算
    let met: boolean;
    let noteDay: string;
    if (row.deadline_at !== null) {
      met = row.deadline_at <= now.toISOString();
      noteDay = shanghaiDateStr(Date.parse(row.deadline_at));
    } else {
      if (row.listed_day === null) continue;
      const deadline = bidDeadline({
        lastBidAt: row.last_bid_at,
        listedDay: row.listed_day,
        now,
        deadlineHours: ctx.deadlineHours,
        silenceHours: ctx.silenceHours,
        calendar: ctx.calendar,
      });
      met = deadline.met;
      noteDay = deadline.deadlineDay;
    }
    if (met) {
      // v6.24.0：listed 到期同样收口——无人（活跃）出价 → 提前下架（原窗尾口径）；
      // 有人出价（报价成交自动挂牌等特殊路径）走原静默结算并按合同类型分流
      if (row.status === 'listed' && row.bid_count === 0) {
        if ((await delistUnbid(db, core, ctx, actor, origin, 'deadline')) === 'delisted') summary.delisted++;
      } else {
        const r = await settleByContractType(env, core, actor, origin, row.status === 'bidding' ? 'bidding' : 'listed', ctx);
        if (r === 'settled') summary.settled++;
      }
      continue;
    }
    const note = noteText(noteDay, ctx.deadlineHours, ctx.calendar);
    const r = await db
      .prepare(`UPDATE listings SET deadline_note = ? WHERE id = ? AND status IN ('listed', 'bidding') AND (deadline_note IS NULL OR deadline_note != ?)`)
      .bind(note, row.id, note)
      .run();
    if (r.meta.changes > 0) summary.notesUpdated++;
  }

  // 自愈：pending_review 但单据缺失（结算建单跨语句崩溃的残留），补齐 transfer + 审核任务。
  // 评审修复（P1-2）：必须还有 active 出价才有单据可补——没有 active 出价的残留行（旧口径卡出来的
  // 无单据 pending_review）补 0 行，若仍留在扫描集里会让 settleListingForReview 每次空跑写审计
  const broken = await db
    .prepare(
      `SELECT l.id, l.player_id, l.seller_club_id, l.ask_price, l.season, l.window_seq
       FROM listings l
       LEFT JOIN transfers t ON t.idempotency_key = 'listing:' || l.id
       WHERE l.status = 'pending_review' AND t.id IS NULL
         AND EXISTS (SELECT 1 FROM bids WHERE listing_id = l.id AND status = 'active')
       ORDER BY l.id LIMIT 100`,
    )
    .all<ListingCore>();
  for (const row of broken.results) {
    if ((await settleListingForReview(db, row, actor, origin)) === 'settled') summary.healed++;
  }

  return summary;
}
