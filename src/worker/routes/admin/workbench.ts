// 管理端 · 审核工作台的在途数据（v6.68.2 期 C，设计文档 §6.3）
//
// 只读三端点：在途五表、搜索兜底、凭证地址。读操作不写审计（与 /reviews 一致）。
// 写动作不在这里——工作台行内的处置按钮直接调现有的 admin 端点（暂停出价 / 强制结算 /
// 强制作废 / 作废谈判 / 强制成交 / 取消强拍），复用同一套原因框与审计，不另开一套。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { loadInFlight, searchWorkbench } from '../../workbench.ts';

const app = new Hono<{ Bindings: Env }>();

// GET /api/admin/workbench/in-flight?cpu=0|1 —— 五张在途表一次取全（cpu=0 隐藏 CPU 参与方，默认）
app.get('/workbench/in-flight', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const raw = c.req.query('cpu');
  if (raw !== undefined && raw !== '0' && raw !== '1') throw new HttpError(400, 'cpu 只能是 0 或 1');
  const data = await loadInFlight(c.env, { includeCpu: raw === '1' });
  return c.json(data);
});

// GET /api/admin/workbench/search?q= —— 数字按七种 id 并行探，文字查球员/俱乐部名
app.get('/workbench/search', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const q = c.req.query('q') ?? '';
  if (q.trim() === '') return c.json({ results: [] });
  if (q.trim().length > 64) throw new HttpError(400, '搜索词太长');
  const results = await searchWorkbench(c.env, q);
  return c.json({ results });
});

// GET /api/admin/workbench/proof/:listingId —— 凭证地址（列表只回 hasProof 布尔，key 不随列表下发）
app.get('/workbench/proof/:listingId', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const id = Number(c.req.param('listingId'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '挂牌 ID 不对');
  const row = await c.env.DB.prepare('SELECT activation_proof FROM listings WHERE id = ?')
    .bind(id)
    .first<{ activation_proof: string | null }>();
  if (!row) throw new HttpError(404, '这单挂牌不存在');
  if (!row.activation_proof) throw new HttpError(404, '这单激活没有上传凭证');
  return c.json({ url: `/api/media/${row.activation_proof}` });
});

export default app;
