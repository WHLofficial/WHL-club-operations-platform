// 管理端 · 市场干预（增量 10 扩权工具）/ 窗口状态机（§11/§6.4-6，增量 5）/ 强制拍卖（规则 4.4.5）
// （原 admin.ts 市场域，增量 15 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { adminVoidBid, adminForceSettle, adminForceVoid, adminForceSign, adminCancelSigning, requireReason } from '../../market-intervene.ts';
import { listWindows, openWindow, closeWindow } from '../../window-machine.ts';
import { createForcedAuction, cancelForcedAuction } from '../../bypass.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// ---- 市场干预（增量 10：管理介入扩权，撤/关/裁定工具） ----

app.post('/market/bids/:id/void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminVoidBid(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/market/listings/:id/force-settle', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceSettle(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/market/listings/:id/force-void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceVoid(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/negotiations/:id/force-sign', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceSign(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/negotiations/:id/void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminCancelSigning(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

// ---- 窗口状态机（§11/§6.4-6，增量 5） ----

// GET /api/admin/windows —— 赛季与窗口列表
app.get('/windows', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  return c.json(await listWindows(c.env.DB));
});

// POST /api/admin/windows/open —— 开新窗（前置：无在开窗口；全球员经纪人档位重掷）
// declareGrowthPeriod=true 时同批宣告新成长期（勾选框；成长期本身不与窗口绑定）
app.post('/windows/open', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { season?: unknown; windowSeq?: unknown; declareGrowthPeriod?: unknown } | null;
  return c.json(await openWindow(c.env, user.id, body?.season, body?.windowSeq, body?.declareGrowthPeriod), 201);
});

// POST /api/admin/windows/close —— 关窗（前置校验；force 需 window_force_settle=true）
app.post('/windows/close', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { force?: unknown } | null;
  return c.json(await closeWindow(c.env, user.id, body?.force));
});

// ---- 强制拍卖（规则 4.4.5，附录 A〔5〕） ----

// POST /api/admin/forced-auctions —— 建强制拍卖（1m 挂牌，CA 前六不含门将，整单税 50%）
app.post('/forced-auctions', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { playerId?: unknown } | null;
  const result = await createForcedAuction(c.env, user.id, body?.playerId);
  return c.json(result, 201);
});

// POST /api/admin/forced-auctions/:id/cancel —— 取消（未成交前）
app.post('/forced-auctions/:id/cancel', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const result = await cancelForcedAuction(c.env, user.id, c.req.param('id'));
  return c.json(result);
});

export default app;
