// 消费中心教练端（v6.26.0）：目录 / 我的工单 / 提交工单（提交即扣费，审核通过才生效）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach, requireUser } from '../../lib/session.ts';
import { getBoundClub } from '../binding.ts';
import { SHOP_CATEGORIES, type ShopCategory } from '../../core/shop.ts';
import { getOpenWindow } from '../seasons.ts';
import {
  createClubOrder,
  loadShopSettings,
  orderDto,
  squadStateOf,
  type ShopOrderRow,
} from '../shop-ops.ts';

const app = new Hono<{ Bindings: Env }>();

// 商品目录：价目 / PA 上限 / 豪门名单（前端渲染表单与实时总价用）
app.get('/shop/catalog', async (c) => {
  await requireUser(c.env, c.req.raw);
  const settings = await loadShopSettings(c.env.DB);
  return c.json({
    prices: settings.prices,
    paCap: settings.paCap,
    hpremiumClubIds: settings.hpremiumClubIds,
  });
});

// 全队表单状态：热区 / 角色 / 徽章占用按效果引擎同一套规则算好，前端下拉只出合法项
app.get('/shop/squad-state', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再逛消费中心');
  const players = await c.env.DB
    .prepare(
      `SELECT id, display_name, name, number, growable, pa, position, game_attrs FROM players
       WHERE club_id = ? AND status IN ('normal', 'listed') ORDER BY number IS NULL, number, id`,
    )
    .bind(club.id)
    .all<{
      id: number;
      display_name: string | null;
      name: string;
      number: number | null;
      growable: number;
      pa: number | null;
      position: string | null;
      game_attrs: string | null;
    }>();
  const ids = players.results.map((p) => p.id);
  const granted = new Map<number, { slot: number; kind: 'silver' | 'gold'; psid: number }[]>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    if (slice.length === 0) break;
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await c.env.DB
      .prepare(`SELECT player_id, slot, kind, psid FROM player_playstyles WHERE player_id IN (${placeholders})`)
      .bind(...slice)
      .all<{ player_id: number; slot: number; kind: 'silver' | 'gold'; psid: number }>();
    for (const r of rows.results) {
      const list = granted.get(r.player_id) ?? [];
      list.push({ slot: r.slot, kind: r.kind, psid: r.psid });
      granted.set(r.player_id, list);
    }
  }
  return c.json({
    clubId: club.id,
    players: players.results.map((p) => squadStateOf(p, granted.get(p.id) ?? [])),
  });
});

// 本俱乐部的全部工单（含管理组代录的 external 单），带球员名与摘要
app.get('/shop/orders', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再看消费工单');
  const rows = await c.env.DB
    .prepare(
      `SELECT o.*, p.display_name AS player_display_name, p.name AS player_name
       FROM shop_orders o LEFT JOIN players p ON p.id = json_extract(o.payload_json, '$.playerId')
       WHERE o.club_id = ? ORDER BY o.id DESC LIMIT 100`,
    )
    .bind(club.id)
    .all<ShopOrderRow & { player_display_name: string | null; player_name: string | null }>();
  return c.json({
    clubId: club.id,
    orders: rows.results.map((r) => orderDto(r, r.player_display_name ?? r.player_name)),
  });
});

app.post('/shop/orders', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再提交消费工单');
  // v6.29.0 开窗闸：消费提交与转会操作同口径（关窗 409；GET 与管理端代录不受限）
  if (!(await getOpenWindow(c.env.DB))) throw new HttpError(409, '转会窗口没开，现在不能提交消费工单', 'no_window');
  const body = (await c.req.raw.json().catch(() => null)) as { category?: unknown; payload?: unknown; note?: unknown } | null;
  if (!body || typeof body.category !== 'string' || !SHOP_CATEGORIES.includes(body.category as ShopCategory)) {
    throw new HttpError(400, 'category 只能是 pa / badge / badge_upgrade / role / position / club_shell');
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const { order, summary } = await createClubOrder(c.env, {
    userId: user.id,
    clubId: club.id,
    category: body.category as ShopCategory,
    payload: body.payload,
    note,
  });
  return c.json({ order: orderDto(order, null), summary }, 201);
});

export default app;
