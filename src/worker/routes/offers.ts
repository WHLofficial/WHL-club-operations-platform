// 报价 / 议价路由（v6.3.0，设计 §4）：全部私有（登录 + 俱乐部身份），不走公开缓存。
// 读路径先跑一遍全量惰性结算（含 offers 过期与自愈），与市场路由同口径。
// offer-settings 挂在 /players/:id/offer-settings（PUT，三段路径，与 playersRoutes 的两段 GET 不冲突）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { getBoundClub, assertTradable } from '../binding.ts';
import { settleOverdue } from '../market-settle.ts';
import {
  acceptOffer,
  counterOffer,
  placeOffer,
  rejectOffer,
  withdrawOffer,
  setOfferSettings,
} from '../offers.ts';
import { sqlDisplayName } from '../../core/player-name.ts';

const app = new Hono<{ Bindings: Env }>();

const OFFER_STATUS_FILTERS = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'all'] as const;

interface OfferListRow {
  id: number;
  player_id: number;
  player_fc_id: number | null;
  player_name: string;
  position: string | null;
  ca: number | null;
  pa: number | null;
  buyer_club_id: number;
  seller_club_id: number;
  counterpart_name: string;
  amount: number;
  init_amount: number;
  round: number;
  note: string | null;
  status: string;
  turn: string;
  listing_id: number | null;
  created_at: string;
  updated_at: string;
}

// GET /api/offers?box=in|out&status=&cursor= —— 我收到的 / 我送出的（游标分页，设计 §4）
app.get('/offers', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');

  const box = c.req.query('box');
  if (box !== 'in' && box !== 'out') throw new HttpError(400, 'box 只能是 in（我收到的）或 out（我送出的）');
  const statusRaw = c.req.query('status') || 'pending';
  if (!(OFFER_STATUS_FILTERS as readonly string[]).includes(statusRaw)) {
    throw new HttpError(400, 'status 只能是 pending / accepted / rejected / withdrawn / expired / all');
  }
  await settleOverdue(c.env, { origin: 'lazy_settle' });

  const cursorRaw = c.req.query('cursor');
  let cursor: { at: string; id: number } | null = null;
  if (cursorRaw) {
    const [at, idRaw] = cursorRaw.split('~');
    const id = Number(idRaw);
    if (!at || !Number.isInteger(id) || id < 0) throw new HttpError(400, 'cursor 不对');
    cursor = { at, id };
  }

  const roleCol = box === 'in' ? 'o.seller_club_id' : 'o.buyer_club_id';
  const counterpartJoin = box === 'in' ? 'JOIN clubs cb ON cb.id = o.buyer_club_id' : 'JOIN clubs cb ON cb.id = o.seller_club_id';
  const statusClause = statusRaw === 'all' ? '' : 'AND o.status = ?';
  const binds: unknown[] = [club.id];
  if (statusRaw !== 'all') binds.push(statusRaw);
  if (cursor) binds.push(cursor.at, cursor.at, cursor.id);

  const rows = await c.env.DB.prepare(
    `SELECT o.id, o.player_id, o.amount, o.init_amount, o.round, o.note, o.status, o.turn, o.listing_id, o.created_at, o.updated_at,
            o.buyer_club_id, o.seller_club_id, cb.name AS counterpart_name,
            p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name, p.position, p.ca, p.pa
     FROM offers o
     JOIN players p ON p.id = o.player_id
     ${counterpartJoin}
     WHERE ${roleCol} = ? ${statusClause}
       ${cursor ? 'AND (o.updated_at < ? OR (o.updated_at = ? AND o.id < ?))' : ''}
     ORDER BY o.updated_at DESC, o.id DESC
     LIMIT 50`,
  )
    .bind(...binds)
    .all<OfferListRow>();

  const pendingMineRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM offers o WHERE ${roleCol} = ? AND status = 'pending' AND turn = ?`,
  )
    .bind(club.id, box === 'in' ? 'seller' : 'buyer')
    .first<{ n: number }>();

  const last = rows.results[rows.results.length - 1];
  return c.json({
    club: { id: club.id, name: club.name },
    box,
    items: rows.results.map((r) => ({
      id: r.id,
      player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa },
      counterpart: { id: box === 'in' ? r.buyer_club_id : r.seller_club_id, name: r.counterpart_name },
      role: box === 'in' ? 'seller' : 'buyer',
      amount: r.amount,
      initAmount: r.init_amount,
      round: r.round,
      note: r.note,
      status: r.status,
      turn: r.turn,
      myTurn: r.status === 'pending' && r.turn === (box === 'in' ? 'seller' : 'buyer'),
      listingId: r.listing_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    nextCursor: rows.results.length === 50 && last ? `${last.updated_at}~${last.id}` : null,
    pendingMine: pendingMineRow?.n ?? 0,
  });
});

// GET /api/offers/:id —— 单条 + 谈判桌 events（时间正序）；买卖双方可见
app.get('/offers/:id', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '报价 ID 不对');
  await settleOverdue(c.env, { origin: 'lazy_settle' });

  const r = await c.env.DB.prepare(
    `SELECT o.*, ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id, p.position, p.ca, p.pa,
            cb.name AS buyer_name, cs.name AS seller_name
     FROM offers o
     JOIN players p ON p.id = o.player_id
     JOIN clubs cb ON cb.id = o.buyer_club_id
     JOIN clubs cs ON cs.id = o.seller_club_id
     WHERE o.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      player_id: number;
      buyer_club_id: number;
      seller_club_id: number;
      amount: number;
      init_amount: number;
      round: number;
      note: string | null;
      status: string;
      turn: string;
      hold_id: number | null;
      listing_id: number | null;
      season: number;
      window_seq: number;
      created_at: string;
      updated_at: string;
      resolved_at: string | null;
      player_name: string;
      player_fc_id: number | null;
      position: string | null;
      ca: number | null;
      pa: number | null;
      buyer_name: string;
      seller_name: string;
    }>();
  if (!r) throw new HttpError(404, '这条报价不存在');
  const myRole = club.id === r.seller_club_id ? 'seller' : club.id === r.buyer_club_id ? 'buyer' : null;
  if (!myRole) throw new HttpError(403, '这不是你的报价单');

  const events = await c.env.DB.prepare(
    `SELECT e.kind, e.amount, e.note, e.at, e.actor_club_id, cb.name AS actor_name
     FROM offer_events e
     LEFT JOIN clubs cb ON cb.id = e.actor_club_id
     WHERE e.offer_id = ? ORDER BY e.id ASC LIMIT 100`,
  )
    .bind(id)
    .all<{ kind: string; amount: number | null; note: string | null; at: string; actor_club_id: number | null; actor_name: string | null }>();

  return c.json({
    offer: {
      id: r.id,
      player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa },
      buyerClub: { id: r.buyer_club_id, name: r.buyer_name },
      sellerClub: { id: r.seller_club_id, name: r.seller_name },
      amount: r.amount,
      initAmount: r.init_amount,
      round: r.round,
      note: r.note,
      status: r.status,
      turn: r.turn,
      myRole,
      myTurn: r.status === 'pending' && r.turn === myRole,
      listingId: r.listing_id,
      season: r.season,
      windowSeq: r.window_seq,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    },
    events: events.results.map((e) => ({
      kind: e.kind,
      amount: e.amount,
      note: e.note,
      at: e.at,
      actor: e.actor_club_id === null ? null : { id: e.actor_club_id, name: e.actor_name },
    })),
  });
});

// POST /api/offers —— 送报价 {playerId, amount, note}
app.post('/offers', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);
  const body = (await c.req.raw.json().catch(() => null)) as { playerId?: unknown; amount?: unknown; note?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const playerId = Number(body.playerId);
  const amount = Number(body.amount);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  if (!Number.isFinite(amount)) throw new HttpError(400, '报价金额不对（单位 m）');
  const out = await placeOffer(c.env, {
    clubId: club.id,
    actor: user.id,
    playerId,
    amount,
    note: typeof body.note === 'string' ? body.note : null,
  });
  return c.json({ ok: true, offerId: out.offerId, status: out.status, auto: out.auto }, 201);
});

// POST /api/offers/:id/counter —— 还价 {amount, note}
app.post('/offers/:id/counter', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);
  const offerId = Number(c.req.param('id'));
  if (!Number.isInteger(offerId) || offerId <= 0) throw new HttpError(400, '报价 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { amount?: unknown; note?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount)) throw new HttpError(400, '还价金额不对（单位 m）');
  return c.json(
    await counterOffer(c.env, {
      offerId,
      clubId: club.id,
      actor: user.id,
      amount,
      note: typeof body.note === 'string' ? body.note : null,
    }),
  );
});

// POST /api/offers/:id/accept —— 同意（轮到谁谁同意；含挂牌事务）
app.post('/offers/:id/accept', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);
  const offerId = Number(c.req.param('id'));
  if (!Number.isInteger(offerId) || offerId <= 0) throw new HttpError(400, '报价 ID 不对');
  return c.json(await acceptOffer(c.env, { offerId, clubId: club.id, actor: user.id }));
});

// POST /api/offers/:id/reject —— 拒绝（卖方）
app.post('/offers/:id/reject', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  const offerId = Number(c.req.param('id'));
  if (!Number.isInteger(offerId) || offerId <= 0) throw new HttpError(400, '报价 ID 不对');
  return c.json(await rejectOffer(c.env, { offerId, clubId: club.id, actor: user.id }));
});

// POST /api/offers/:id/withdraw —— 撤回（买方）
app.post('/offers/:id/withdraw', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  const offerId = Number(c.req.param('id'));
  if (!Number.isInteger(offerId) || offerId <= 0) throw new HttpError(400, '报价 ID 不对');
  return c.json(await withdrawOffer(c.env, { offerId, clubId: club.id, actor: user.id }));
});

// PUT /api/players/:id/offer-settings —— 报价设置（设计 §2.1，仅本队教练）
app.put('/players/:id/offer-settings', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);
  const playerId = Number(c.req.param('id'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as
    | { transferListed?: unknown; minOfferPrice?: unknown; notForSale?: unknown }
    | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  if (typeof body.transferListed !== 'boolean' || typeof body.notForSale !== 'boolean') {
    throw new HttpError(400, 'transferListed 与 notForSale 都是布尔值，二选一');
  }
  const minOfferPrice =
    body.minOfferPrice === null || body.minOfferPrice === undefined || body.minOfferPrice === ''
      ? null
      : Number(body.minOfferPrice);
  if (minOfferPrice !== null && !Number.isFinite(minOfferPrice)) throw new HttpError(400, '最低报价金额不对（单位 m）');
  const out = await setOfferSettings(c.env, {
    clubId: club.id,
    actor: user.id,
    playerId,
    transferListed: body.transferListed,
    minOfferPrice,
    notForSale: body.notForSale,
  });
  return c.json(out);
});

export default app;
