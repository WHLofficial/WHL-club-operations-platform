// 海捞暗标段管理端（v6.50.0）：逐标明账 + 立即开标 / 延长暗标段 / 取消本窗批次。
// 与窗口开关同级（requireAdmin 不带 perm）——它决定本窗自由身池的走法。
// 不传 batchId 时默认作用于「当前开放窗口的批次」。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { cancelCurrentBatch, extendSeaBatch, loadSeaAdminView, openNow } from '../../sea-sealed.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/sea-sealed', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  return c.json(await loadSeaAdminView(c.env));
});

// 立即开标：不等 deadline（force=true 顺带收掉崩在半路的 settling 批次）
app.post('/sea-sealed/open', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const batchId = typeof body?.batchId === 'number' ? body.batchId : undefined;
  return c.json(await openNow(c.env, user.id ?? null, batchId));
});

// 延长暗标段（body { deadlineAt: ISO, batchId? }）：批次与时刻表那一行同改，两把尺子不打架
app.post('/sea-sealed/extend', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const batchId = typeof body?.batchId === 'number' ? body.batchId : undefined;
  const batch = await extendSeaBatch(c.env, user.id ?? null, body?.deadlineAt, batchId);
  return c.json({
    ok: true,
    batch: {
      id: batch.id,
      season: batch.season,
      windowSeq: batch.window_seq,
      status: batch.status,
      deadlineAt: batch.deadline_at,
      note: batch.note,
    },
  });
});

// 取消本窗批次：全部标作废 + 解冻，本窗回到常规流程
app.post('/sea-sealed/cancel', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const batchId = typeof body?.batchId === 'number' ? body.batchId : undefined;
  const note = typeof body?.note === 'string' ? body.note : undefined;
  return c.json(await cancelCurrentBatch(c.env, user.id ?? null, batchId, note));
});

export default app;
