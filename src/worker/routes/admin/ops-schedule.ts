// 运营时刻表管理端（v6.49.0）：读全表 + 逐项设时段（锚 = 随窗 / 具体时间 / 不限制）。
// 与窗口开关同级（requireAdmin 不带 perm）——它决定所有转会操作与消费中心的可用性。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { OPS_KEYS } from '../../../core/ops-schedule.ts';
import { opsScheduleView, saveOpsRow, type OpsSaveInput } from '../../ops-schedule.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/ops-schedule', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const view = await opsScheduleView(c.env.DB);
  return c.json(view);
});

// PUT /api/admin/ops-schedule：body { key, startAnchor, startAt?, endAnchor, endAt?, requiresWindow, closeInflight?, note? }
// 具体时间一律规范成 ISO（前端把「北京时间」墙钟换算好再传，服务端只认 ISO）。
app.put('/ops-schedule', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求体不是 JSON');
  const key = typeof body.key === 'string' ? body.key : '';
  if (!OPS_KEYS.some((meta) => meta.key === key)) throw new HttpError(404, 'unknown_op_key', 'unknown_op_key');

  const input: OpsSaveInput = {
    startAnchor: body.startAnchor as OpsSaveInput['startAnchor'],
    startAt: isoOf(body.startAt, '起点'),
    endAnchor: body.endAnchor as OpsSaveInput['endAnchor'],
    endAt: isoOf(body.endAt, '终点'),
    requiresWindow: body.requiresWindow !== false,
    closeInflight: body.closeInflight !== false,
    note: typeof body.note === 'string' ? body.note : '',
  };
  const row = await saveOpsRow(c.env, key, input, user.id ?? null);
  return c.json({ ok: true, row });
});

// 具体时间只在这一处解析：ISO 字符串（带时区）→ 规范化 ISO；空值/非绝对锚一律 null。
function isoOf(raw: unknown, label: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new HttpError(400, `${label}要填具体时间（ISO 字符串）`);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new HttpError(400, `${label}时间格式不对（要 ISO 字符串）`);
  return new Date(ms).toISOString();
}

export default app;
