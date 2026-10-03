// 消费中心管理端（v6.26.0）：待审工单 / 外部增益代录 / 通过（重校验后自动生效）/ 拒绝（必填理由，club 单自动退款）。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { SHOP_CATEGORIES, type ShopCategory } from '../../../core/shop.ts';
import {
  approveShopOrder,
  createExternalOrder,
  orderDto,
  rejectShopOrder,
  type ShopOrderRow,
} from '../../shop-ops.ts';

const app = new Hono<{ Bindings: Env }>();

function parseCategory(raw: unknown): ShopCategory {
  if (typeof raw !== 'string' || !SHOP_CATEGORIES.includes(raw as ShopCategory)) {
    throw new HttpError(400, 'category 只能是 pa / badge / badge_upgrade / role / position / club_shell');
  }
  return raw as ShopCategory;
}

// 全量工单（?status=&source= 筛选；external 单带俱乐部名）
app.get('/shop/orders', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const status = c.req.query('status');
  const source = c.req.query('source');
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (status) {
    if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'status 只能是 pending / approved / rejected');
    clauses.push('o.status = ?');
    params.push(status);
  }
  if (source) {
    if (!['club', 'external'].includes(source)) throw new HttpError(400, "source 只能是 'club' / 'external'");
    clauses.push('o.source = ?');
    params.push(source);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await c.env.DB
    .prepare(
      `SELECT o.*, p.display_name AS player_display_name, p.name AS player_name, cl.name AS club_name
       FROM shop_orders o
       LEFT JOIN players p ON p.id = json_extract(o.payload_json, '$.playerId')
       LEFT JOIN clubs cl ON cl.id = o.club_id
       ${where} ORDER BY o.id DESC LIMIT 200`,
    )
    .bind(...params)
    .all<ShopOrderRow & { player_display_name: string | null; player_name: string | null; club_name: string | null }>();
  return c.json({
    orders: rows.results.map((r) => {
      const dto = orderDto(r, r.player_display_name ?? r.player_name);
      return { ...dto, clubName: r.club_name ?? null };
    }),
  });
});

// 外部增益代录（积分兑换 / 奖励等）：只校验不生效，确认执行走 approve
app.post('/shop/orders', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const body = (await c.req.raw.json().catch(() => null)) as { clubId?: unknown; category?: unknown; payload?: unknown; note?: unknown } | null;
  if (!body || !Number.isInteger(body.clubId) || (body.clubId as number) <= 0) {
    throw new HttpError(400, 'clubId 必须是正整数（目标俱乐部）');
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const { order, summary } = await createExternalOrder(c.env, {
    actorId: user.id,
    clubId: body.clubId as number,
    category: parseCategory(body.category),
    payload: body.payload,
    note,
  });
  return c.json({ order: orderDto(order, null), summary }, 201);
});

app.post('/shop/orders/:id/approve', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '工单 id 必须是正整数');
  const body = (await c.req.raw.json().catch(() => ({}))) as { note?: unknown } | null;
  const note = body && typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const { order, summary } = await approveShopOrder(c.env, { orderId: id, reviewerId: user.id, note });
  return c.json({ order: orderDto(order, null), summary });
});

app.post('/shop/orders/:id/reject', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '工单 id 必须是正整数');
  const body = (await c.req.raw.json().catch(() => null)) as { reason?: unknown } | null;
  if (!body || typeof body.reason !== 'string' || !body.reason.trim()) {
    throw new HttpError(400, '拒绝理由必填（会连同退款一起通知教练）');
  }
  const { order, summary } = await rejectShopOrder(c.env, { orderId: id, reviewerId: user.id, reason: body.reason });
  return c.json({ order: orderDto(order, null), summary });
});

export default app;
