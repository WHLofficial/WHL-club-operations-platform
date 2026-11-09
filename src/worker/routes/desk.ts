// 转会台 / 球员转会浮层的数据端点（期 B 建 summary，期 C 加 transfer-panel）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { getBoundClub } from '../binding.ts';
import { createConfigService } from '../../core/config.ts';
import { sqlDisplayName } from '../../core/player-name.ts';
import { waitUntilOf } from '../../lib/guard.ts';
import { settleOverdue } from '../market-settle.ts';
import { loadMarketContext } from '../market-context.ts';
import { isWindowOpen } from '../seasons.ts';
import { loadNegotiationContext } from '../negotiation-context.ts';
import { SILENT_ANCHOR_SQL, silenceHours, settleMessage } from '../negotiations.ts';
import { listingDetailOf, type ListingBidRow, type ListingRow } from './market.ts';
// 契约类型锚点（v6.82.0 第 1 批）：两个端点的响应以 src/contract/batch1.ts 为真源锁装配
// （c.json 泛型 = 写侧编译期锁；甄别 FieldDiff #1/#2 的处置见契约型注）。
import type {
  DeskSummary as DeskSummaryDto,
  TransferPanelResponse as TransferPanelResponseDto,
} from '../../contract/batch1.ts';
// status 六值具名单源（v6.82.0 评审修）：行类型不再复制字面联合，改引用契约 OfferStatus
// （契约内 OfferListItem.status 同名同源）；turn 二值取 core/offer-rules.ts 的 OfferTurn
// （契约 batch5.ts:335 注释点名的同值单源）。
import type { OfferStatus } from '../../contract/batch5.ts';
import type { OfferTurn } from '../../core/offer-rules.ts';

const app = new Hono<{ Bindings: Env }>();

const EMPTY = { negotiations: 0, offers: 0, bids: 0, total: 0 } as const;

function countOf(result: unknown): number {
  const rows = (result as { results?: { n: number }[] }).results ?? [];
  return rows[0]?.n ?? 0;
}

app.get('/market/desk/summary', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  // 用户级计数不能进共享缓存
  c.header('Cache-Control', 'private, no-store');
  if (!club) return c.json<DeskSummaryDto>(EMPTY);

  const [negoScan, offerScan, bidScan] = await c.env.DB.batch([
    // 谈判：active 即待办（表无 turn 列）
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM negotiation_sessions WHERE club_id = ? AND status = 'active'`,
    ).bind(club.id),
    // 报价：轮到我表态（in 看 seller、out 看 buyer）；intent 是卖方待确认，不计入
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM offers
       WHERE status = 'pending'
         AND ((seller_club_id = ? AND turn = 'seller') OR (buyer_club_id = ? AND turn = 'buyer'))`,
    ).bind(club.id, club.id),
    // 出价：我在该挂牌上的最新一笔已被超出，且挂牌仍在竞价
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM bids b
       JOIN listings l ON l.id = b.listing_id
       WHERE b.club_id = ?
         AND b.status = 'superseded'
         AND l.status = 'bidding'
         AND b.id = (SELECT MAX(b2.id) FROM bids b2 WHERE b2.listing_id = b.listing_id AND b2.club_id = b.club_id)`,
    ).bind(club.id),
  ]);

  const negotiations = countOf(negoScan);
  const offers = countOf(offerScan);
  const bids = countOf(bidScan);
  return c.json<DeskSummaryDto>({ negotiations, offers, bids, total: negotiations + offers + bids });
});

// —— 期 C：球员转会浮层（设计 §6.1）——
// 球员页状态条/浮层与转会台行展开共用一份响应：挂牌字段与 GET /market/listings/:id 完全同口径，
// 个人数组（我的出价/报价/谈判）未绑队时为空。读路径结算与详情端点同款：有 waitUntil 就后台跑，
// 不承诺本次响应已结算完（前端 staleTime 30s + 写后失效补齐）。

interface PlayerPanelRow {
  id: number;
  fc_id: number | null;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  status: string;
  club_id: number | null;
  club_name: string | null;
}

interface OfferPanelRow {
  id: number;
  player_id: number;
  buyer_club_id: number;
  seller_club_id: number;
  amount: number;
  init_amount: number;
  round: number;
  note: string | null;
  /** offers.status 六值（甄别核实与契约联合无失配）；v6.82.0 评审修改引用契约具名 OfferStatus
   *  ——将来新增 status 值只改 batch5 一处，这里 typecheck 即红。contract-demands 侧同理 */
  status: OfferStatus;
  /** 0037_offers.sql 列注释：buyer/seller 二值——core OfferTurn 同名单源 */
  turn: OfferTurn;
  listing_id: number | null;
  created_at: string;
  updated_at: string;
  counterpart_name: string;
  player_fc_id: number | null;
  player_name: string;
  position: string | null;
  ca: number | null;
  pa: number | null;
  list_price: number | null;
}

interface TransferPanelRow {
  id: number;
  type: string;
  fee: number | null;
  from_club_id: number | null;
  from_club_name: string | null;
  to_club_id: number | null;
  to_club_name: string | null;
  completed_at: string | null;
}

interface NegoPanelRow {
  id: number;
  /** negotiation_sessions.status 三值（甄别核实与 api 手抄联合无失配） */
  status: 'active' | 'settled' | 'cancelled';
  release_fee: number | null;
  expected_wage: number | null;
  attempt_count: number | null;
  settled_wage: number | null;
  settle_source: string | null;
  silent_anchor: string | null;
}

interface MyBidPanelRow {
  id: number;
  listing_id: number;
  amount: number;
  created_at: string;
  status: string;
  /** fund_holds.status 三值（0001_init.sql 注释）；LEFT JOIN 无冻结行时 null */
  hold_status: 'held' | 'released' | 'settled' | null;
}

const OFFER_COLS = `o.id, o.player_id, o.amount, o.init_amount, o.round, o.note, o.status, o.turn, o.listing_id, o.created_at, o.updated_at,
            o.buyer_club_id, o.seller_club_id, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name,
            p.position, p.ca, p.pa, p.list_price`;

function offerOf(box: 'in' | 'out', r: OfferPanelRow) {
  return {
    id: r.id,
    player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa, listPrice: r.list_price },
    counterpart: { id: box === 'in' ? r.buyer_club_id : r.seller_club_id, name: r.counterpart_name },
    role: box === 'in' ? ('seller' as const) : ('buyer' as const),
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
  };
}

app.get('/players/:id/transfer-panel', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  // 用户级响应（含我的出价/报价/谈判），不能进共享缓存
  c.header('Cache-Control', 'private, no-store');
  const playerId = Number(c.req.param('id'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');

  // 与 GET /market/listings/:id 同款：读路径结算不挡响应（测试无 executionCtx 时就地 await）
  const settleRun = settleOverdue(c.env, { origin: 'lazy_settle', coalesceMs: 30_000 }).catch((e) => {
    console.error('[desk] 转会浮层读路径后台结算失败:', e);
  });
  const wu = waitUntilOf(c);
  if (wu) wu.waitUntil(settleRun);
  else await settleRun;

  // 未绑队也回公开部分（球员/挂牌/成交单），个人数组用恒定空集
  const clubId = club?.id ?? -1;

  // 第一批：互不依赖 ⇒ 一趟往返。挂牌取「在流程内最新一单，否则最新已结束」。
  const [player, listing, contract, ctx, bidPausedRaw, transfer, offersIn, offersOut, nego, myBids, maxAttempts, silenceH] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT p.id, p.fc_id, ${sqlDisplayName('p')} AS name, p.position, p.age, p.ca, p.pa, p.status, p.club_id, cl.name AS club_name
         FROM players p LEFT JOIN clubs cl ON cl.id = p.club_id
         WHERE p.id = ?`,
      )
        .bind(playerId)
        .first<PlayerPanelRow>(),
      c.env.DB.prepare(
        `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_at, l.last_bid_at,
              l.listed_day, l.deadline_at, l.deadline_note, l.season, l.window_seq, l.activated_by, l.activation_deadline, l.match_deadline, l.bid_paused,
              ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id, p.position, p.age, p.ca, p.pa,
              cl.name AS seller_name, ca2.name AS activator_name
         FROM listings l
         JOIN players p ON p.id = l.player_id
         LEFT JOIN clubs cl ON cl.id = l.seller_club_id
         LEFT JOIN clubs ca2 ON ca2.id = l.activated_by
         WHERE l.player_id = ?
         ORDER BY CASE WHEN l.status IN ('listed', 'bidding', 'matched_pending', 'pending_review') THEN 0 ELSE 1 END, l.id DESC
         LIMIT 1`,
      )
        .bind(playerId)
        .first<ListingRow>(),
      c.env.DB.prepare('SELECT release_fee, wage, contract_type FROM contracts WHERE player_id = ? AND is_active = 1')
        .bind(playerId)
        .first<{ release_fee: number | null; wage: number | null; contract_type: string }>(),
      loadMarketContext(c.env.DB),
      createConfigService(c.env.DB).get('market_bid_paused'),
      c.env.DB.prepare(
        `SELECT t.id, t.type, t.fee, t.from_club_id, t.to_club_id, t.completed_at,
              cf.name AS from_club_name, ct.name AS to_club_name
         FROM transfers t
         LEFT JOIN clubs cf ON cf.id = t.from_club_id
         LEFT JOIN clubs ct ON ct.id = t.to_club_id
         WHERE t.player_id = ? AND t.status = 'completed' AND t.to_club_id IS NOT NULL
           AND t.type IN ('transfer', 'activation', 'match', 'free_agent', 'forced_auction')
         ORDER BY (t.completed_at IS NULL), t.completed_at DESC, t.id DESC
         LIMIT 1`,
      )
        .bind(playerId)
        .first<TransferPanelRow>(),
      // 报价 in（我是卖方，对方是买方）/ out（我是买方，对方是卖方）各一条：合成一条会让一侧饿死
      c.env.DB.prepare(
        `SELECT ${OFFER_COLS}, cb.name AS counterpart_name
         FROM offers o
         JOIN players p ON p.id = o.player_id
         JOIN clubs cb ON cb.id = o.buyer_club_id
         WHERE o.seller_club_id = ? AND o.player_id = ?
         ORDER BY o.updated_at DESC, o.id DESC
         LIMIT 20`,
      )
        .bind(clubId, playerId)
        .all<OfferPanelRow>(),
      c.env.DB.prepare(
        `SELECT ${OFFER_COLS}, cb.name AS counterpart_name
         FROM offers o
         JOIN players p ON p.id = o.player_id
         JOIN clubs cb ON cb.id = o.seller_club_id
         WHERE o.buyer_club_id = ? AND o.player_id = ?
         ORDER BY o.updated_at DESC, o.id DESC
         LIMIT 20`,
      )
        .bind(clubId, playerId)
        .all<OfferPanelRow>(),
      // 只回我作为买方的会话摘要（attempts 全文留在谈判页签）
      c.env.DB.prepare(
        `SELECT s.id, s.status, s.release_fee, s.expected_wage, s.attempt_count, s.settled_wage, s.settle_source,
              ${SILENT_ANCHOR_SQL} AS silent_anchor
         FROM negotiation_sessions s
         WHERE s.player_id = ? AND s.club_id = ?
         ORDER BY (s.status = 'active') DESC, s.id DESC
         LIMIT 1`,
      )
        .bind(playerId, clubId)
        .first<NegoPanelRow>(),
      // 我的出价：独立查询，不能从挂牌详情那份最近 50 笔里筛（别家更早的价会把我的挤出窗口）
      c.env.DB.prepare(
        `SELECT b.id, b.listing_id, b.amount, b.created_at, b.status, f.status AS hold_status
         FROM bids b
         JOIN listings l ON l.id = b.listing_id
         LEFT JOIN fund_holds f ON f.id = b.hold_id
         WHERE b.club_id = ? AND l.player_id = ?
         ORDER BY b.id DESC
         LIMIT 20`,
      )
        .bind(clubId, playerId)
        .all<MyBidPanelRow>(),
      loadNegotiationContext(c.env.DB).then((n) => n.maxAttempts),
      silenceHours(c.env.DB),
    ]);

  if (!player) throw new HttpError(404, '这名球员不存在');

  // 第二批：依赖挂牌 id（最高价/出价历史/开窗判定）
  const [highest, bidScan, windowOpen] =
    listing === null
      ? ([null, { results: [] as ListingBidRow[] }, false] as const)
      : await Promise.all([
          c.env.DB.prepare(`SELECT MAX(amount) AS highest FROM bids WHERE listing_id = ? AND status = 'active'`)
            .bind(listing.id)
            .first<{ highest: number | null }>(),
          c.env.DB.prepare(
            `SELECT b.id, b.club_id, b.amount, b.created_at, b.status, cl.name AS club_name
             FROM bids b JOIN clubs cl ON cl.id = b.club_id
             WHERE b.listing_id = ? ORDER BY b.id DESC LIMIT 50`,
          )
            .bind(listing.id)
            .all<ListingBidRow>(),
          isWindowOpen(c.env.DB, listing.season, listing.window_seq),
        ]);

  // 挂牌字段走详情端点的同一装配函数（含 deadlineAt/nextMinBid/highestBidder/matchPhase…）
  const detail =
    listing === null
      ? null
      : listingDetailOf(listing, {
          highest: highest?.highest ?? null,
          marketBidPaused: bidPausedRaw === 'true',
          contract,
          ctx,
          windowOpen,
          bids: bidScan.results,
        });

  const anchor = nego?.silent_anchor ?? '';
  const expiresAt = anchor ? new Date(Date.parse(anchor) + silenceH * 3600_000).toISOString() : null;
  const attemptsUsed = nego?.attempt_count ?? 0;

  return c.json<TransferPanelResponseDto>({
    club: club === null ? null : { id: club.id, name: club.name },
    player: {
      id: player.id,
      fcId: player.fc_id,
      name: player.name,
      position: player.position,
      age: player.age,
      ca: player.ca,
      pa: player.pa,
      clubId: player.club_id,
      clubName: player.club_name,
      isMine: club !== null && player.club_id === club.id,
      status: player.status,
    },
    // ListingRow.status 的行类型是 string（market.ts 内部声明，不在本批文件范围），运行时值域
    // = ListingStatus 五值（甄别核实无失配）⇒ 此处断言仅编译期收窄，不改载荷字节。
    listing:
      detail === null
        ? null
        : ({ ...detail.listing, marketBidPaused: detail.marketBidPaused } as NonNullable<TransferPanelResponseDto['listing']>),
    bids: detail?.bids ?? [],
    myBids: myBids.results.map((b) => ({
      id: b.id,
      listingId: b.listing_id,
      amount: b.amount,
      createdAt: b.created_at,
      status: b.status,
      holdStatus: b.hold_status,
    })),
    offers: { in: offersIn.results.map((r) => offerOf('in', r)), out: offersOut.results.map((r) => offerOf('out', r)) },
    negotiation:
      nego === null
        ? null
        : {
            id: nego.id,
            status: nego.status,
            releaseFee: nego.release_fee,
            expectedWage: nego.expected_wage,
            attemptsUsed,
            remaining: Math.max(0, maxAttempts - attemptsUsed),
            expiresAt,
            settled:
              nego.status === 'settled' && nego.settle_source
                ? { wage: nego.settled_wage, source: nego.settle_source, message: settleMessage(nego.settle_source) }
                : null,
          },
    transfer:
      transfer === null
        ? null
        : {
            id: transfer.id,
            type: transfer.type,
            fee: transfer.fee,
            fromClubId: transfer.from_club_id,
            fromClubName: transfer.from_club_name,
            toClubId: transfer.to_club_id,
            toClubName: transfer.to_club_name,
            completedAt: transfer.completed_at,
          },
    asOf: new Date().toISOString(),
  });
});

export default app;
