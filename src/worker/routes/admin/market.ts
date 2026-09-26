// 管理端 · 市场干预（v1.3.0 扩权工具）/ 窗口状态机（§11/§6.4-6，v0.6.0）/ 强制拍卖（规则 4.4.5）
// （原 admin.ts 市场域，v2.1.0 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { HttpError } from '../../../lib/http.ts';
import { createConfigService } from '../../../core/config.ts';
import { adminVoidBid, adminForceSettle, adminForceVoid, adminForceSign, adminCancelSigning, requireReason } from '../../market-intervene.ts';
import { listWindows, openWindow, closeWindow } from '../../window-machine.ts';
import { createForcedAuction, cancelForcedAuction } from '../../bypass.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// ---- 市场干预（v1.3.0：管理介入扩权，撤/关/裁定工具） ----

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

// ---- 暂停出价（v2.1.0：全局开关 + 单挂牌冻结；只挡新出价，不改变结算时刻） ----

// GET /api/admin/market/pause-bids —— 全局暂停状态
app.get('/market/pause-bids', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const service = createConfigService(c.env.DB);
  return c.json({ paused: (await service.get('market_bid_paused')) === 'true' });
});

// POST /api/admin/market/pause-bids —— 全局开关（body {paused}；普通 admin 可操作，审计 market_bid_pause）
app.post('/market/pause-bids', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { paused?: unknown } | null;
  if (typeof body?.paused !== 'boolean') throw new HttpError(400, 'paused 须为布尔值');
  const service = createConfigService(c.env.DB);
  const before = (await service.get('market_bid_paused')) === 'true';
  if (before !== body.paused) {
    await service.set('market_bid_paused', body.paused ? 'true' : 'false');
    await writeAudit(c.env.DB, {
      actor: user.id,
      action: 'market_bid_pause',
      targetType: 'market',
      origin: 'user',
      before: { paused: before },
      after: { paused: body.paused },
    });
  }
  return c.json({ ok: true, paused: body.paused });
});

// POST /api/admin/market/listings/:id/pause-bid | resume-bid —— 单挂牌冻结（只挡新出价）
for (const [suffix, paused] of [
  ['/pause-bid', true],
  ['/resume-bid', false],
] as const) {
  app.post(`/market/listings/:id${suffix}`, async (c) => {
    const user = await requireAdmin(c.env, c.req.raw);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
    const res = await c.env.DB.prepare(`UPDATE listings SET bid_paused = ? WHERE id = ? AND status IN ('listed', 'bidding')`)
      .bind(paused ? 1 : 0, id)
      .run();
    if (res.meta.changes === 0) {
      const exists = await c.env.DB.prepare('SELECT status FROM listings WHERE id = ?').bind(id).first<{ status: string }>();
      if (!exists) throw new HttpError(404, '这单挂牌不存在');
      throw new HttpError(409, `这单状态是 ${exists.status}，不在竞价期，无需${paused ? '暂停' : '恢复'}出价`);
    }
    await writeAudit(c.env.DB, {
      actor: user.id,
      action: 'market_listing_bid_pause',
      targetType: 'listing',
      targetId: id,
      origin: 'user',
      after: { bidPaused: paused },
    });
    return c.json({ ok: true, bidPaused: paused });
  });
}

// ---- 窗口状态机（§11/§6.4-6，v0.6.0） ----

// GET /api/admin/windows —— 赛季与窗口列表
app.get('/windows', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  return c.json(await listWindows(c.env.DB));
});

// POST /api/admin/windows/open —— 开新窗（前置：无在开窗口；全球员经纪人性格重掷）
// declareGrowthPeriod=true 时同批宣告新成长期（勾选框；成长期本身不与窗口绑定）
// temporary=true 开临时窗（不推进效力/不计忠诚奖金/不扣工资与冠名租金）；同赛季常规窗最多 2 个
app.post('/windows/open', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as
    | { season?: unknown; windowSeq?: unknown; declareGrowthPeriod?: unknown; temporary?: unknown }
    | null;
  return c.json(await openWindow(c.env, user.id, body?.season, body?.windowSeq, body?.declareGrowthPeriod, body?.temporary), 201);
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
