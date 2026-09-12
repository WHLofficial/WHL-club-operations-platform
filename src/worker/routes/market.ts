// 转会市场路由（附录 A〔3〕）：挂牌板（公开）、挂牌/出价（教练）、我的出价、单据详情。
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
} from '../../core/market-rules.ts';
import { getOpenWindow, isWindowOpen } from '../seasons.ts';
import { loadMarketContext } from '../market-context.ts';
import { availableBalance } from '../ledger.ts';
import { settleOverdue } from '../market-settle.ts';
import { getBoundClub } from '../binding.ts';

const app = new Hono<{ Bindings: Env }>();

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

const LISTING_STATUSES = ['listed', 'bidding', 'pending_review', 'delisted'] as const;

interface ListingRow {
  id: number;
  player_id: number;
  seller_club_id: number;
  type: string;
  ask_price: number;
  status: string;
  listed_at: string;
  last_bid_at: string | null;
  listed_day: string | null;
  deadline_note: string | null;
  season: number | null;
  window_seq: number | null;
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
      return ['listed', 'bidding'];
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

// GET /api/market/listings?status=&cursor= —— 挂牌板（卡柜）
app.get('/market/listings', async (c) => {
  await settleOverdue(c.env);
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
            l.listed_day, l.deadline_note, l.season, l.window_seq,
            p.name AS player_name, p.position, p.age, p.ca, p.pa,
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
        deadlineAt = bidDeadline({
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
        player: { id: r.player_id, name: r.player_name, position: r.position, age: r.age, ca: r.ca, pa: r.pa },
        sellerClub: { id: r.seller_club_id, name: r.seller_name },
        type: r.type,
        askPrice: r.ask_price,
        status: r.status,
        listedAt: r.listed_at,
        lastBidAt: r.last_bid_at,
        highestBid: a?.highest ?? null,
        bidCount: a?.count ?? 0,
        deadlineAt,
        deadlineNote: r.deadline_note,
      };
    }),
    cursor: rows.results.length === 50 ? rows.results[rows.results.length - 1].id : null,
  });
});

// POST /api/market/listings —— 挂牌（价格校验 4.4.1.1）
app.post('/market/listings', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');

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
    throw new HttpError(400, player.status === 'listed' ? '这名球员已经在挂牌流程里了' : '当前状态不能挂牌（训练营球员走激活/转正路径，暂不开放挂牌）');
  }

  const dup = await c.env.DB.prepare(`SELECT id FROM listings WHERE player_id = ? AND status IN ('listed', 'bidding', 'pending_review') LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (dup) throw new HttpError(400, '这名球员已经有一单在市场里了，等它结束再挂');

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
      after: { playerId, clubId: club.id, askPrice, season: win.season, windowSeq: win.windowSeq },
    }),
  ];
  const results = await c.env.DB.batch(statements);
  const inserted = results[0].meta.changes > 0;
  if (!inserted) throw new HttpError(409, '挂牌没落库，球员状态可能刚被改过，刷新再试');

  return c.json(
    { ok: true, listingId: Number(results[0].meta.last_row_id), min: bounds.min, max: bounds.max },
    201,
  );
});

// GET /api/market/listings/:id —— 详情 + 出价历史
app.get('/market/listings/:id', async (c) => {
  await settleOverdue(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
  const listing = await c.env.DB.prepare(
    `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_at, l.last_bid_at,
            l.listed_day, l.deadline_note, l.season, l.window_seq,
            p.name AS player_name, p.position, p.age, p.ca, p.pa,
            cl.name AS seller_name
     FROM listings l
     JOIN players p ON p.id = l.player_id
     JOIN clubs cl ON cl.id = l.seller_club_id
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
    deadlineAt = bidDeadline({
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
    listing: {
      id: listing.id,
      player: { id: listing.player_id, name: listing.player_name, position: listing.position, age: listing.age, ca: listing.ca, pa: listing.pa },
      sellerClub: { id: listing.seller_club_id, name: listing.seller_name },
      type: listing.type,
      askPrice: listing.ask_price,
      status: listing.status,
      listedAt: listing.listed_at,
      lastBidAt: listing.last_bid_at,
      releaseFee: contract?.release_fee ?? null,
      deadlineAt,
      deadlineNote: listing.deadline_note,
      windowOpen,
      nextMinBid,
      bidStepMin: ctx.bidStepMin,
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
  const user = await requireCoach(c.env, c.req.raw);
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { amount?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, '出价金额须为正数（单位 m）');

  // 惰性结算先跑：可能这单刚好截止，出价要被拒
  await settleOverdue(c.env);

  const listing = await c.env.DB.prepare('SELECT id, seller_club_id, ask_price, status, season, window_seq FROM listings WHERE id = ?')
    .bind(id)
    .first<{ id: number; seller_club_id: number; ask_price: number; status: string; season: number | null; window_seq: number | null }>();
  if (!listing) throw new HttpError(404, '这单挂牌不存在');
  if (listing.seller_club_id === club.id) throw new HttpError(403, '不能对自己俱乐部的挂牌出价');
  if (listing.status !== 'listed' && listing.status !== 'bidding') {
    throw new HttpError(409, listing.status === 'pending_review' ? '这单已经截止，正在等管理组审核' : '这单已经结束，不能再出价');
  }
  if (!(await isWindowOpen(c.env.DB, listing.season, listing.window_seq))) {
    throw new HttpError(409, '这单所属的转会窗口已经关了');
  }

  const highestRow = await c.env.DB.prepare(`SELECT MAX(amount) AS highest FROM bids WHERE listing_id = ? AND status = 'active'`)
    .bind(id)
    .first<{ highest: number | null }>();
  const bidError = validateBidAmount(amount, highestRow?.highest ?? null, listing.ask_price);
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
    // 5) 挂牌进入竞价态，静默计时重置
    c.env.DB.prepare(
      `UPDATE listings SET status = 'bidding', last_bid_at = ${nowSql()} WHERE id = ? AND status IN ('listed', 'bidding')`,
    ).bind(id),
    audit({
      actor: user.id,
      action: 'bid_place',
      targetType: 'listing',
      targetId: id,
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
    if (msg.includes('WHL_BID_REJECT_CLOSED')) throw new HttpError(409, '这单刚好不在竞价状态了，刷新看看');
    throw err;
  }

  const bid = await c.env.DB
    .prepare(`SELECT id, amount, created_at FROM bids WHERE listing_id = ? AND club_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(id, club.id)
    .first<{ id: number; amount: number; created_at: string }>();
  return c.json({ ok: true, bid }, 201);
});

// GET /api/me/bids —— 我的出价（含冻结状态章）
app.get('/me/bids', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, bids: [] });
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.listing_id, b.amount, b.created_at, b.status AS bid_status,
            f.status AS hold_status, l.status AS listing_status, l.ask_price,
            p.id AS player_id, p.name AS player_name, p.position, p.ca, p.pa,
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
      player: { id: r.player_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa },
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
            p.name AS player_name,
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
      from_name: string | null;
      to_name: string | null;
    }>();
  if (!t) throw new HttpError(404, '单据不存在');
  return c.json({
    transfer: {
      id: t.id,
      type: t.type,
      status: t.status,
      player: { id: t.player_id, name: t.player_name },
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
