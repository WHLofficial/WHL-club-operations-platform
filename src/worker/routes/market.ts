// 转会市场路由（附录 A〔3〕）：转会区（公开）、挂牌/出价（教练）、我的出价、单据详情。
// 惰性结算（§6.5）在列表与出价入口先跑；挂牌校验全在 core/market-rules，
// 出价的资金/步长闸由 0005 触发器在同一事务兜底，路由层做可读的前置校验。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { createAuditStatement } from '../../lib/audit.ts';
import {
  bidDeadline,
  listingPriceBounds,
  shanghaiDateStr,
  validateBidAmount,
  round2,
  TRAINEE_ACTIVATION_FEE,
} from '../../core/market-rules.ts';
import { getOpenWindow, isWindowOpen } from '../seasons.ts';
import { loadMarketContext } from '../market-context.ts';
import { createConfigService } from '../../core/config.ts';
import { availableBalance } from '../ledger.ts';
import { sqlDisplayName } from '../../core/player-name.ts';
import { settleOverdue, settleListingForReview } from '../market-settle.ts';
import { rollbackRcChangeForPlayer } from '../bypass.ts';
import { createActivation } from '../activations.ts';
import { queueClubNotification } from '../notify.ts';
import { getBoundClub, assertTradable } from '../binding.ts';

const app = new Hono<{ Bindings: Env }>();

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

const LISTING_STATUSES = ['listed', 'bidding', 'matched_pending', 'pending_review', 'delisted'] as const;

/** 海捞名单上限：两分支各自取这么多再合并（见 /market/free-agents 的 top-N 重写） */
const FREE_AGENT_LIMIT = 300;

interface ListingRow {
  id: number;
  player_id: number;
  player_fc_id: number | null;
  seller_club_id: number;
  type: string;
  ask_price: number;
  status: string;
  listed_at: string;
  last_bid_at: string | null;
  listed_day: string | null;
  deadline_at: string | null;
  deadline_note: string | null;
  season: number | null;
  window_seq: number | null;
  activated_by: number | null;
  activation_deadline: string | null;
  match_deadline: string | null;
  bid_paused?: number;
  activator_name?: string | null;
  player_name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  seller_name: string;
}

function statusFilter(raw: string | undefined): string[] {
  switch (raw) {
    case undefined:
    case '':
    case 'active':
      return ['listed', 'bidding', 'matched_pending'];
    case 'pending_review':
      return ['pending_review'];
    case 'ended':
      return ['delisted'];
    case 'all':
      return [...LISTING_STATUSES];
    default:
      throw new HttpError(400, 'status 只能是 active / pending_review / ended / all');
  }
}

// GET /api/market/listings?status=&cursor= —— 转会区（卡柜）
app.get('/market/listings', async (c) => {
  await settleOverdue(c.env, { origin: 'lazy_settle' });
  const statuses = statusFilter(c.req.query('status'));
  const cursorRaw = c.req.query('cursor');
  let cursor: number | null = null;
  if (cursorRaw !== undefined) {
    const n = Number(cursorRaw);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'cursor 不对');
    cursor = n;
  }
  const ph = statuses.map(() => '?').join(', ');
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_at, l.last_bid_at,
            l.listed_day, l.deadline_at, l.deadline_note, l.season, l.window_seq, l.activated_by, l.activation_deadline, l.match_deadline, l.bid_paused,
            ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id, p.position, p.age, p.ca, p.pa,
            cl.name AS seller_name
     FROM listings l
     JOIN players p ON p.id = l.player_id
     JOIN clubs cl ON cl.id = l.seller_club_id
     WHERE l.status IN (${ph}) ${cursor !== null ? 'AND l.id < ?' : ''}
     ORDER BY l.id DESC LIMIT 50`,
  )
    .bind(...statuses, ...(cursor !== null ? [cursor] : []))
    .all<ListingRow>();

  // 出价聚合（最高价 + 出价次数），IN 分块 ≤90（§17）
  const ids = rows.results.map((r) => r.id);
  const agg = new Map<number, { highest: number; count: number }>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const ph2 = slice.map(() => '?').join(', ');
    const bidRows = await c.env.DB.prepare(
      `SELECT listing_id, MAX(amount) AS highest, COUNT(*) AS count FROM bids WHERE listing_id IN (${ph2}) GROUP BY listing_id`,
    )
      .bind(...slice)
      .all<{ listing_id: number; highest: number; count: number }>();
    for (const b of bidRows.results) agg.set(b.listing_id, { highest: b.highest, count: b.count });
  }

  const ctx = await loadMarketContext(c.env.DB);
  const now = new Date();
  return c.json({
    listings: rows.results.map((r) => {
      const a = agg.get(r.id) ?? null;
      let deadlineAt: string | null = null;
      if (r.status === 'bidding' && r.listed_day !== null) {
        // 截止绝对时刻化（v6.4.0）：优先读落库列（出价时按 bidDeadline 算定），存量行 NULL 回落实时算
        deadlineAt =
          r.deadline_at ??
          bidDeadline({
            lastBidAt: r.last_bid_at,
            listedDay: r.listed_day,
            now,
            deadlineHours: ctx.deadlineHours,
            silenceHours: ctx.silenceHours,
            calendar: ctx.calendar,
          }).deadlineAt;
      }
      return {
        id: r.id,
        player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, age: r.age, ca: r.ca, pa: r.pa },
        sellerClub: { id: r.seller_club_id, name: r.seller_name },
        type: r.type,
        askPrice: r.ask_price,
        status: r.status,
        listedAt: r.listed_at,
        lastBidAt: r.last_bid_at,
        bidPaused: r.bid_paused === 1,
        highestBid: a?.highest ?? null,
        bidCount: a?.count ?? 0,
        activatedBy: r.activated_by,
        activationDeadline: r.activation_deadline,
        matchDeadline: r.match_deadline,
        matchPhase:
          r.type === 'activation'
            ? r.status === 'listed'
              ? 'first_bid'
              : r.status === 'matched_pending'
                ? 'matching'
                : null
            : null,
        firstBidPending: r.type === 'activation' && (a?.count ?? 0) === 0 && r.activated_by !== null,
        deadlineAt,
        deadlineNote: r.deadline_note,
      };
    }),
    cursor: rows.results.length === 50 ? rows.results[rows.results.length - 1].id : null,
  });
});

// POST /api/market/listings —— 挂牌（价格校验 4.4.1.1）
app.post('/market/listings', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);

  const body = (await c.req.raw.json().catch(() => null)) as { playerId?: unknown; askPrice?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const playerId = Number(body.playerId);
  const askPrice = Number(body.askPrice);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  if (!Number.isFinite(askPrice) || askPrice <= 0) throw new HttpError(400, '挂牌价须为正数（单位 m）');

  const win = await getOpenWindow(c.env.DB);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能挂牌', 'no_window');

  const player = await c.env.DB.prepare('SELECT id, name, club_id, status, market_value FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: number; name: string; club_id: number | null; status: string; market_value: number | null }>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== club.id) throw new HttpError(400, '只能挂牌自己队里的球员');
  if (player.status !== 'normal') {
    throw new HttpError(
      400,
      player.status === 'listed'
        ? '这名球员已经在挂牌流程里了'
        : player.status === 'trainee'
          ? '训练营球员不挂牌：只能被其他球队按激活转会带走（固定 5m）'
          : '当前状态不能挂牌',
    );
  }

  const dup = await c.env.DB.prepare(`SELECT id FROM listings WHERE player_id = ? AND status IN ('listed', 'bidding', 'pending_review') LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (dup) throw new HttpError(400, '这名球员已经有一单在市场里了，等它结束再挂');

  // 训练营球员不可自行挂牌（4.3.4 合同固定、4.4.2 只走激活转会），唯一出口是激活挂牌
  const trainee = await c.env.DB.prepare(`SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1`)
    .bind(playerId)
    .first<{ contract_type: string }>();
  if (trainee?.contract_type === 'trainee') {
    throw new HttpError(400, '训练营球员不挂牌：只能被其他球队按激活转会带走（固定 5m）');
  }

  const contract = await c.env.DB.prepare('SELECT release_fee FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null }>();
  const rc = contract?.release_fee ?? null;
  if (rc === null || rc <= 0) throw new HttpError(400, '球员没有含违约金的现行合同，先让管理组补合同');

  const bounds = listingPriceBounds(rc, player.market_value);
  if (!bounds) throw new HttpError(400, '违约金太低，挂不出符合规则的价格（上限不足 1m）');
  if (askPrice < bounds.min) {
    throw new HttpError(400, `挂牌价不能低于 ${bounds.min} m（下限：违约金/身价五折取低，且不低于 1m）`);
  }
  if (askPrice > bounds.max) {
    throw new HttpError(400, `挂牌价不能超过 ${bounds.max} m（违约金 1.5 倍上限）`);
  }

  const audit = createAuditStatement(c.env.DB);
  const listedAt = new Date().toISOString();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, season, window_seq)
       VALUES (?, ?, 'normal', ?, 'listed', ${nowSql()}, ?, ?, ?)`,
    ).bind(playerId, club.id, round2(askPrice), shanghaiDateStr(Date.parse(listedAt)), win.season, win.windowSeq),
    c.env.DB.prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`).bind(
      playerId,
      club.id,
    ),
    audit({
      actor: user.id,
      action: 'listing_create',
      targetType: 'listing',
      targetId: null,
      origin: 'user',
      after: { playerId, clubId: club.id, askPrice, season: win.season, windowSeq: win.windowSeq },
    }),
  ];
  const results = await c.env.DB.batch(statements);
  const inserted = results[0].meta.changes > 0;
  if (!inserted) throw new HttpError(409, '挂牌没落库，球员状态可能刚被改过，刷新再试');
  const listingId = Number(results[0].meta.last_row_id);

  // 4.4.10：挂牌提交即触发本窗续约回滚（触发 ref = 转会区挂牌记录）
  await rollbackRcChangeForPlayer(c.env, playerId, user.id, { refType: 'listing', refId: listingId });

  return c.json({ ok: true, listingId, min: bounds.min, max: bounds.max }, 201);
});

// GET /api/market/free-agents —— 自由球员（可海捞名单，教练侧）；本窗被解约的标禁签
app.get('/market/free-agents', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, freeAgents: [] });

  const win = await getOpenWindow(c.env.DB);
  // 名单 = 真无归属的球员 + CPU 队球员（v2.0.0：CPU 队有 clubs 行、其球员带 club_id，但照旧可海捞）
  // 上限 300：海捞池含 4 支 CPU 队约 107 人 + 待业球员（v3.2.0 步骤 6 普查时生产已有 17,731 名自由身，
  //   即 LIMIT 300 只露 CA 最高的那 300 人 —— 池子规模与「藏起低 CA 那半截」的老理由已不成比例，
  //   分页/筛选是产品决策，登记在案未在本增量处理）
  //
  // 两分支 top-N 重写（v3.2.0 步骤 6）：普查实测这条查询单次 36,274 行，是全站最大读放大器。
  //   原写法 (club_id IS NULL OR club_id IN ...) 让 SQLite 走 MULTI-INDEX OR + 临时排序，必须读出
  //   全部 17,731 名自由身球员再排序，索引救不了它。拆成两支各取 top-N 再合并后（生产实测）：
  //   · 无归属支 300 行 —— 沿 idx_players_club_ca(club_id, ca DESC, id) 走 ca 序、第 300 行即停（迁移 0030）
  //   · CPU 队支 239 行 —— 必须让 clubs 当驱动表（CROSS JOIN 固定连接顺序）。写成 `club_id IN (子查询)`
  //     时优化器会改用 idx_players_status 扫全部自由身球员（18,540 行）再过滤，CROSS JOIN 才把它掰过来。
  //   等价性：club_id IS NULL 与 club_id ∈ CPU 队互斥（NULL 不等于任何值），两分支无重叠，
  //   且全局 top-300 必然包含在各分支的 top-300 之内。
  const nullClubBranch =
    `SELECT p.id, p.fc_id, ${sqlDisplayName('p')} AS name, p.position, p.age, p.ca, p.pa, cl.name AS club_name
     FROM players p
     LEFT JOIN clubs cl ON cl.id = p.club_id
     WHERE p.club_id IS NULL AND p.status IN ('free', 'normal')
     ORDER BY p.ca DESC, p.id LIMIT ${FREE_AGENT_LIMIT}`;
  // CPU 队球员的东家就是 cp 本身，所以 club_name 取 cp.name，不必再 LEFT JOIN 一次 clubs
  const cpuClubBranch =
    `SELECT p.id, p.fc_id, ${sqlDisplayName('p')} AS name, p.position, p.age, p.ca, p.pa, cp.name AS club_name
     FROM clubs cp CROSS JOIN players p ON p.club_id = cp.id
     WHERE cp.is_cpu = 1 AND p.status IN ('free', 'normal')
     ORDER BY p.ca DESC, p.id LIMIT ${FREE_AGENT_LIMIT}`;
  const rows = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT * FROM (${nullClubBranch})
       UNION ALL
       SELECT * FROM (${cpuClubBranch})
     ) ORDER BY ca DESC, id LIMIT ${FREE_AGENT_LIMIT}`,
  ).all<{ id: number; fc_id: number | null; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null; club_name: string | null }>();

  const banned = new Set<number>();
  if (win && rows.results.length > 0) {
    const ids = rows.results.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 90) {
      const slice = ids.slice(i, i + 90);
      const rowsBanned = await c.env.DB.prepare(
        `SELECT DISTINCT player_id FROM transfers
         WHERE type = 'termination' AND status = 'completed' AND season = ? AND window_seq = ?
           AND player_id IN (${slice.map(() => '?').join(', ')})`,
      )
        .bind(win.season, win.windowSeq, ...slice)
        .all<{ player_id: number }>();
      for (const r of rowsBanned.results) banned.add(r.player_id);
    }
  }

  return c.json({
    club: { id: club.id, name: club.name },
    freeAgents: rows.results.map((r) => ({
      id: r.id,
      fcId: r.fc_id,
      name: r.name,
      position: r.position,
      age: r.age,
      ca: r.ca,
      pa: r.pa,
      clubName: r.club_name,
      bannedThisWindow: banned.has(r.id),
    })),
  });
});

// GET /api/market/trainees —— 各队训练营球员（可被激活名单，教练侧）
app.get('/market/trainees', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, trainees: [] });

  const win = await getOpenWindow(c.env.DB);
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.fc_id, ${sqlDisplayName('p')} AS name, p.position, p.age, p.ca, p.pa, p.club_id, cl.name AS club_name
     FROM players p JOIN clubs cl ON cl.id = p.club_id
     WHERE p.status = 'trainee' AND p.club_id IS NOT NULL AND p.club_id != ?
     ORDER BY cl.name, p.id LIMIT 50`,
  )
    .bind(club.id)
    .all<{ id: number; fc_id: number | null; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null; club_id: number; club_name: string }>();

  // 本窗口已被激活过的标记（4.4.2.1 一窗一次；失效激活也占额）
  const activated = new Set<number>();
  if (win) {
    const used = await c.env.DB.prepare(
      `SELECT player_id FROM listings WHERE type = 'activation' AND season = ? AND window_seq = ? AND player_id IN (${rows.results.map(() => '?').join(', ') || 'NULL'})`,
    )
      .bind(win.season, win.windowSeq, ...rows.results.map((r) => r.id))
      .all<{ player_id: number }>();
    for (const r of used.results) activated.add(r.player_id);
  }

  return c.json({
    club: { id: club.id, name: club.name },
    trainees: rows.results.map((r) => ({
      id: r.id,
      fcId: r.fc_id,
      name: r.name,
      position: r.position,
      age: r.age,
      ca: r.ca,
      pa: r.pa,
      club: { id: r.club_id, name: r.club_name },
      activationFee: TRAINEE_ACTIVATION_FEE,
      activatedThisWindow: activated.has(r.id),
    })),
  });
});

// POST /api/market/activations —— 激活挂牌（4.4.2）：训练营球员固定 5m、普通球员按保护期
// 倍数价；激活方须在出价窗内落首价（期间他队出价无效），否则激活无效。
// 与 POST /api/transfers/activation 同源（见 activations.ts）。
app.post('/market/activations', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);

  const body = (await c.req.raw.json().catch(() => null)) as { playerId?: unknown; proofMediaKey?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  return c.json(await createActivation(c.env, club.id, user.id, body.playerId, body.proofMediaKey), 201);
});

// POST /api/market/listings/:id/activation-report —— 激活通知举报（v6.4.0 改动 4，仅被激活方）
// 用户裁决：被激活方可以举报「没在 QQ 收到激活通知」。举报只建管理核查任务 + 通知激活方，
// 不改挂牌状态、不冻结匹配窗（匹配与到期照常走）；是否影响成交由管理组裁量（不自动改数据）。
app.post('/market/listings/:id/activation-report', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');

  const listing = await c.env.DB.prepare(
    `SELECT id, player_id, seller_club_id, activated_by, status, activation_proof FROM listings WHERE id = ? AND type = 'activation'`,
  )
    .bind(id)
    .first<{ id: number; player_id: number; seller_club_id: number; activated_by: number | null; status: string; activation_proof: string | null }>();
  if (!listing) throw new HttpError(404, '这单激活挂牌不存在');
  if (listing.seller_club_id !== club.id) throw new HttpError(403, '只有被激活方可以举报这份激活通知');
  if (listing.activated_by === null || !['listed', 'bidding', 'matched_pending'].includes(listing.status)) {
    throw new HttpError(409, '这单激活已经结束，不用再举报了');
  }
  const dup = await c.env.DB
    .prepare(`SELECT id FROM review_tasks WHERE type = 'activation_report' AND ref_id = ? AND status = 'open' LIMIT 1`)
    .bind(id)
    .first<{ id: number }>();
  if (dup) throw new HttpError(409, '这单激活已经有人在核查了，等管理组处理');

  const audit = createAuditStatement(c.env.DB);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO review_tasks (type, ref_id, payload, status) VALUES ('activation_report', ?, ?, 'open')`,
    ).bind(
      id,
      JSON.stringify({ listingId: id, playerId: listing.player_id, activatorClubId: listing.activated_by, sellerClubId: listing.seller_club_id, proofKey: listing.activation_proof }),
    ),
    audit({
      actor: user.id,
      action: 'activation_report',
      targetType: 'listing',
      targetId: id,
      origin: 'user',
      after: { playerId: listing.player_id, activatorClubId: listing.activated_by, byClubId: club.id },
    }),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) throw new HttpError(409, '举报没落库，刷新再试');
  await queueClubNotification(c.env, listing.activated_by, 'activation_reported', { listingId: id });
  return c.json({ ok: true }, 201);
});

// GET /api/market/listings/:id —— 详情 + 出价历史
app.get('/market/listings/:id', async (c) => {
  await settleOverdue(c.env, { origin: 'lazy_settle' });
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
  const listing = await c.env.DB.prepare(
    `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_at, l.last_bid_at,
            l.listed_day, l.deadline_at, l.deadline_note, l.season, l.window_seq, l.activated_by, l.activation_deadline, l.match_deadline, l.bid_paused,
            ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id, p.position, p.age, p.ca, p.pa,
            cl.name AS seller_name, ca2.name AS activator_name
     FROM listings l
     JOIN players p ON p.id = l.player_id
     JOIN clubs cl ON cl.id = l.seller_club_id
     LEFT JOIN clubs ca2 ON ca2.id = l.activated_by
     WHERE l.id = ?`,
  )
    .bind(id)
    .first<ListingRow>();
  if (!listing) throw new HttpError(404, '这单挂牌不存在（或还没产生）');

  const [contract, bids, ctx, windowOpen] = await Promise.all([
    c.env.DB.prepare('SELECT release_fee, wage, contract_type FROM contracts WHERE player_id = ? AND is_active = 1')
      .bind(listing.player_id)
      .first<{ release_fee: number | null; wage: number | null; contract_type: string }>(),
    c.env.DB.prepare(
      `SELECT b.id, b.club_id, b.amount, b.created_at, b.status, cl.name AS club_name
       FROM bids b JOIN clubs cl ON cl.id = b.club_id
       WHERE b.listing_id = ? ORDER BY b.id DESC LIMIT 50`,
    )
      .bind(id)
      .all<{ id: number; club_id: number; amount: number; created_at: string; status: string; club_name: string }>(),
    loadMarketContext(c.env.DB),
    isWindowOpen(c.env.DB, listing.season, listing.window_seq),
  ]);

  let deadlineAt: string | null = null;
  if (listing.status === 'bidding' && listing.listed_day !== null) {
    // 优先读落库列（v6.4.0 改动 A），存量行 NULL 回落实时算
    deadlineAt =
      listing.deadline_at ??
      bidDeadline({
        lastBidAt: listing.last_bid_at,
        listedDay: listing.listed_day,
        now: new Date(),
        deadlineHours: ctx.deadlineHours,
        silenceHours: ctx.silenceHours,
        calendar: ctx.calendar,
      }).deadlineAt;
  }
  const highestActive = await c.env.DB
    .prepare(`SELECT MAX(amount) AS highest FROM bids WHERE listing_id = ? AND status = 'active'`)
    .bind(id)
    .first<{ highest: number | null }>();
  const nextMinBid =
    highestActive?.highest !== null && highestActive?.highest !== undefined
      ? round2(highestActive.highest + ctx.bidStepMin)
      : round2(listing.ask_price);

  return c.json({
    marketBidPaused: (await createConfigService(c.env.DB).get('market_bid_paused')) === 'true',
    listing: {
      id: listing.id,
      player: { id: listing.player_id, fcId: listing.player_fc_id, name: listing.player_name, position: listing.position, age: listing.age, ca: listing.ca, pa: listing.pa },
      sellerClub: { id: listing.seller_club_id, name: listing.seller_name },
      type: listing.type,
      askPrice: listing.ask_price,
      status: listing.status,
      listedAt: listing.listed_at,
      lastBidAt: listing.last_bid_at,
      bidPaused: listing.bid_paused === 1,
      releaseFee: contract?.release_fee ?? null,
      deadlineAt,
      deadlineNote: listing.deadline_note,
      windowOpen,
      nextMinBid,
      bidStepMin: ctx.bidStepMin,
      activatedBy: listing.activated_by,
      activatorName: listing.activator_name ?? null,
      activationDeadline: listing.activation_deadline,
      matchDeadline: listing.match_deadline,
      matchPhase:
        listing.type === 'activation'
          ? listing.status === 'listed'
            ? 'first_bid'
            : listing.status === 'matched_pending'
              ? 'matching'
              : null
          : null,
      firstBidPending: listing.type === 'activation' && bids.results.length === 0 && listing.activated_by !== null,
    },
    bids: bids.results.map((b) => ({
      id: b.id,
      clubId: b.club_id,
      clubName: b.club_name,
      amount: b.amount,
      createdAt: b.created_at,
      status: b.status,
    })),
  });
});

// POST /api/market/listings/:id/bids —— 出价（资金冻结先行，§6.4-1）
app.post('/market/listings/:id/bids', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { amount?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, '出价金额须为正数（单位 m）');

  // 惰性结算先跑：可能这单刚好截止，出价要被拒
  await settleOverdue(c.env, { origin: 'lazy_settle' });

  // 全局暂停出价（管理端干预开关；已出的价与到期结算不受影响）
  if ((await createConfigService(c.env.DB).get('market_bid_paused')) === 'true') {
    throw new HttpError(423, '全市场出价已暂停（管理组干预中），恢复后再来', 'bid_paused');
  }

  const listing = await c.env.DB.prepare(
    `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_day, l.deadline_at, l.activated_by, l.activation_deadline, l.season, l.window_seq, l.bid_paused,
            ct.contract_type AS player_contract_type
     FROM listings l
     LEFT JOIN contracts ct ON ct.player_id = l.player_id AND ct.is_active = 1
     WHERE l.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      player_id: number;
      seller_club_id: number;
      type: string;
      ask_price: number;
      status: string;
      listed_day: string | null;
      deadline_at: string | null;
      activated_by: number | null;
      activation_deadline: string | null;
      season: number | null;
      window_seq: number | null;
      bid_paused: number;
      player_contract_type: string | null;
    }>();
  if (!listing) throw new HttpError(404, '这单挂牌不存在');
  if (listing.bid_paused === 1) throw new HttpError(423, '这单被管理组暂停出价，恢复后再来', 'listing_bid_paused');
  // 截止绝对时刻化（v6.4.0）：过线可读拒绝（触发器 fund_holds_bid_deadline_guard 在事务内兜底）
  if (listing.deadline_at !== null && listing.deadline_at <= new Date().toISOString()) {
    throw new HttpError(409, '这单竞价已截止，等结算进审核', 'bid_deadline_passed');
  }
  if (listing.seller_club_id === club.id) throw new HttpError(403, '不能对自己俱乐部的挂牌出价');
  if (listing.type === 'activation' && listing.status === 'matched_pending') {
    throw new HttpError(409, '首价已落定，被激活方正在考虑是否匹配，这单不开放竞价');
  }
  if (listing.status !== 'listed' && listing.status !== 'bidding') {
    throw new HttpError(409, listing.status === 'pending_review' ? '这单已经截止，正在等管理组审核' : '这单已经结束，不能再出价');
  }
  if (!(await isWindowOpen(c.env.DB, listing.season, listing.window_seq))) {
    throw new HttpError(409, '这单所属的转会窗口已经关了');
  }

  const isActivation = listing.type === 'activation';
  const bidStats = await c.env.DB.prepare(`SELECT MAX(amount) AS highest, COUNT(*) AS total FROM bids WHERE listing_id = ?`)
    .bind(id)
    .first<{ highest: number | null; total: number }>();
  const highest = bidStats?.highest ?? null;
  const firstBidPending = isActivation && (bidStats?.total ?? 0) === 0;
  if (isActivation && !firstBidPending) {
    // 4.4.2.3：激活金额按公式定死，激活挂牌不开放后续竞价（首价即成交价）
    throw new HttpError(409, '激活挂牌不开放竞价：激活方的首价就是成交价，等匹配窗结束');
  }
  if (firstBidPending) {
    // 4.4.2.2：出价窗内只有激活方能落首价，他队出价无效；出价窗已过则该单已被惰性结算作废
    if (listing.activated_by !== club.id) {
      throw new HttpError(403, '激活挂牌的首价窗内只有激活方可以出价，等激活方落价后再看结果');
    }
    if (amount !== listing.ask_price) {
      throw new HttpError(400, `激活出价固定为 ${listing.ask_price} m（激活金额按规则计算，不受竞价调整）`);
    }
  }

  const bidError = validateBidAmount(amount, highest, listing.ask_price);
  if (bidError) throw new HttpError(400, bidError);

  // 可用余额预检（触发器 0005 在事务内兜底同一公式，这里给可读报错）
  const myHold = await c.env.DB
    .prepare(`SELECT amount FROM fund_holds WHERE club_id = ? AND ref_type = 'listing' AND ref_id = ? AND status = 'held' LIMIT 1`)
    .bind(club.id, id)
    .first<{ amount: number }>();
  const available = await availableBalance(c.env.DB, club.id);
  const effectiveAvailable = available + (myHold?.amount ?? 0);
  if (amount > round2(effectiveAvailable + Number.EPSILON)) {
    throw new HttpError(400, `可用资金不足：可支配 ${round2(effectiveAvailable)} m，出价需要 ${round2(amount)} m（出价即冻结）`);
  }

  const audit = createAuditStatement(c.env.DB);
  // 激活首价落定后的去向：训练营合同直接进待审（固定条款无匹配可言）；
  // 正式合同进匹配等待（被激活方 24h 匹配窗，4.4.2.4）。普通挂牌照旧进竞价。
  const activationTrainee = isActivation && listing.player_contract_type === 'trainee';
  const mctx = await loadMarketContext(c.env.DB);
  let matchDeadlineIso: string | null = null;
  let nextDeadlineIso: string | null = null;
  if (isActivation) {
    if (!activationTrainee) {
      matchDeadlineIso = new Date(Date.now() + mctx.matchWindowHours * 3600_000).toISOString();
    }
  } else if (listing.listed_day !== null) {
    // 改动 A：出价成功即把新一段静默期的绝对截止时刻落库（以本次出价为静默起点），
    // 此后展示与结算都读列，不再各自实时计算（5 分钟漂移归零）
    nextDeadlineIso = bidDeadline({
      lastBidAt: new Date().toISOString(),
      listedDay: listing.listed_day,
      now: new Date(),
      deadlineHours: mctx.deadlineHours,
      silenceHours: mctx.silenceHours,
      calendar: mctx.calendar,
    }).deadlineAt;
  }
  // 普通出价推进带过线守卫（deadline_at 已过 = 拒绝刷新；触发器 WHL_BID_REJECT_DEADLINE 先行拦截）
  const listingAdvance = isActivation
    ? activationTrainee
      ? `UPDATE listings SET status = 'bidding', last_bid_at = ${nowSql()}, activation_deadline = NULL, deadline_at = NULL
         WHERE id = ? AND status IN ('listed', 'bidding')`
      : `UPDATE listings SET status = 'matched_pending', last_bid_at = ${nowSql()}, activation_deadline = NULL, match_deadline = ?, deadline_at = NULL
         WHERE id = ? AND status IN ('listed', 'bidding')`
    : `UPDATE listings SET status = 'bidding', last_bid_at = ${nowSql()}, deadline_at = ?
       WHERE id = ? AND status IN ('listed', 'bidding') AND (deadline_at IS NULL OR deadline_at > ${nowSql()})`;
  const statements = [
    // 1) 冻结：触发器校验挂牌在竞价/金额达步长/可用资金，任一不满足 ABORT 回滚整批
    c.env.DB.prepare(
      `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
       VALUES (?, ?, 'held', 'listing', ?, ${nowSql()})`,
    ).bind(club.id, round2(amount), id),
    // 2) 出价落库，hold_id 指回刚建的冻结（同事务可见；金额+挂牌唯一确定）
    c.env.DB.prepare(
      `INSERT INTO bids (listing_id, club_id, amount, created_at, status, hold_id)
       SELECT ?, ?, ?, ${nowSql()}, 'active',
              (SELECT id FROM fund_holds WHERE club_id = ? AND ref_type = 'listing' AND ref_id = ? AND status = 'held' AND amount = ? ORDER BY id DESC LIMIT 1)`,
    ).bind(id, club.id, round2(amount), club.id, id, round2(amount)),
    // 3) 之前的活跃出价全部作废（含自己旧价）
    c.env.DB.prepare(`UPDATE bids SET status = 'superseded' WHERE listing_id = ? AND status = 'active' AND id != last_insert_rowid()`).bind(id),
    // 4) 落选出价的冻结解冻
    c.env.DB.prepare(
      `UPDATE fund_holds SET status = 'released'
       WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'
         AND id NOT IN (SELECT hold_id FROM bids WHERE listing_id = ? AND status = 'active' AND hold_id IS NOT NULL)`,
    ).bind(id, id),
    // 5) 挂牌推进（普通 → 竞价并落新截止时刻；激活训练营 → 待审中转；激活正式 → 匹配等待）
    isActivation
      ? matchDeadlineIso !== null
        ? c.env.DB.prepare(listingAdvance).bind(matchDeadlineIso, id)
        : c.env.DB.prepare(listingAdvance).bind(id)
      : c.env.DB.prepare(listingAdvance).bind(nextDeadlineIso, id),
    audit({
      actor: user.id,
      action: 'bid_place',
      targetType: 'listing',
      targetId: id,
      origin: 'user',
      after: { clubId: club.id, amount: round2(amount) },
    }),
  ];
  try {
    const results = await c.env.DB.batch(statements);
    if ((results[1].meta.changes ?? 0) !== 1) throw new HttpError(409, '出价没落库，行情刚变过，刷新再试');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('WHL_BID_REJECT_FUNDS')) throw new HttpError(400, '可用资金不足：出价即冻结，冻结没过账这单就不算数');
    if (msg.includes('WHL_BID_REJECT_AMOUNT')) throw new HttpError(409, '出价没赶上：刚有人出了更高的价，或金额没达到当前最低要求');
    if (msg.includes('WHL_BID_REJECT_DEADLINE')) throw new HttpError(409, '这单竞价刚好截止，出价没赶上，等结算进审核', 'bid_deadline_passed');
    if (msg.includes('WHL_BID_REJECT_CLOSED')) throw new HttpError(409, '这单刚好不在竞价状态了，刷新看看');
    throw err;
  }

  const bid = await c.env.DB
    .prepare(`SELECT id, amount, created_at FROM bids WHERE listing_id = ? AND club_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(id, club.id)
    .first<{ id: number; amount: number; created_at: string }>();

  // 训练营激活首价落定即收口进待审（同请求内收口，崩溃由惰性结算自愈兜底）
  let settledForReview = false;
  if (activationTrainee) {
    const settled = await settleListingForReview(
      c.env.DB,
      { id, player_id: listing.player_id, seller_club_id: listing.seller_club_id, ask_price: listing.ask_price, season: listing.season, window_seq: listing.window_seq },
      user.id,
      'user',
      'bidding',
    );
    settledForReview = settled === 'settled';
  }

  return c.json(
    { ok: true, bid, ...(isActivation ? { matchPhase: activationTrainee ? 'review' : 'matching', matchDeadline: matchDeadlineIso, settledForReview } : {}) },
    201,
  );
});

// GET /api/me/bids —— 我的出价（含冻结状态章）
app.get('/me/bids', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, bids: [] });
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.listing_id, b.amount, b.created_at, b.status AS bid_status,
            f.status AS hold_status, l.status AS listing_status, l.ask_price,
            p.id AS player_id, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name, p.position, p.ca, p.pa,
            cl.name AS seller_name
     FROM bids b
     JOIN listings l ON l.id = b.listing_id
     JOIN players p ON p.id = l.player_id
     JOIN clubs cl ON cl.id = l.seller_club_id
     LEFT JOIN fund_holds f ON f.id = b.hold_id
     WHERE b.club_id = ?
     ORDER BY b.id DESC LIMIT 100`,
  )
    .bind(club.id)
    .all<{
      id: number;
      listing_id: number;
      amount: number;
      created_at: string;
      bid_status: string;
      hold_status: string | null;
      listing_status: string;
      ask_price: number;
      player_id: number;
      player_fc_id: number | null;
      player_name: string;
      position: string | null;
      ca: number | null;
      pa: number | null;
      seller_name: string;
    }>();
  return c.json({
    club: { id: club.id, name: club.name },
    bids: rows.results.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      amount: r.amount,
      createdAt: r.created_at,
      status: r.bid_status,
      holdStatus: r.hold_status,
      listingStatus: r.listing_status,
      askPrice: r.ask_price,
      player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa },
      sellerClubName: r.seller_name,
    })),
  });
});

// GET /api/transfers/:id —— 单据详情（公开）
app.get('/transfers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '单据 ID 不对');
  const t = await c.env.DB.prepare(
    `SELECT t.id, t.type, t.player_id, t.from_club_id, t.to_club_id, t.fee, t.tax, t.extra_fee, t.matched,
            t.status, t.season, t.window_seq, t.created_at, t.completed_at,
            ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id,
            cf.name AS from_name, ct.name AS to_name
     FROM transfers t
     JOIN players p ON p.id = t.player_id
     LEFT JOIN clubs cf ON cf.id = t.from_club_id
     LEFT JOIN clubs ct ON ct.id = t.to_club_id
     WHERE t.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      type: string;
      player_id: number;
      from_club_id: number | null;
      to_club_id: number | null;
      fee: number | null;
      tax: number | null;
      extra_fee: number | null;
      matched: number;
      status: string;
      season: number | null;
      window_seq: number | null;
      created_at: string | null;
      completed_at: string | null;
      player_name: string;
      player_fc_id: number | null;
      from_name: string | null;
      to_name: string | null;
    }>();
  if (!t) throw new HttpError(404, '单据不存在');
  return c.json({
    transfer: {
      id: t.id,
      type: t.type,
      status: t.status,
      player: { id: t.player_id, fcId: t.player_fc_id, name: t.player_name },
      fromClub: t.from_club_id === null ? null : { id: t.from_club_id, name: t.from_name },
      toClub: t.to_club_id === null ? null : { id: t.to_club_id, name: t.to_name },
      fee: t.fee,
      tax: t.tax,
      extraFee: t.extra_fee,
      matched: t.matched === 1,
      season: t.season,
      windowSeq: t.window_seq,
      createdAt: t.created_at,
      completedAt: t.completed_at,
    },
  });
});

export default app;
