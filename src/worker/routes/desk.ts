// 转会台汇总（v6.73.0 期 B，设计 §5.1）：导航角标 / 桌内待办条共用的一份轻量计数。
// 只读、不跑 settleOverdue（owner Q6 A）：角标允许落后一个结算窗；进入转会台时
// me/bids / offers / negotiations 三条读路径的 30s coalesce 结算会把过期状态收口。
// 三条 COUNT 一次 db.batch；未绑队回全 0（200），避免顶栏出现 404 噪音。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { requireCoach } from '../../lib/session.ts';
import { getBoundClub } from '../binding.ts';

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
  if (!club) return c.json(EMPTY);

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
  return c.json({ negotiations, offers, bids, total: negotiations + offers + bids });
});

export default app;
