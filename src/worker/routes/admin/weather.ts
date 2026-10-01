// 管理端 · 场次天气预报（v6.15.0，revenue 插件 forecast_round 口径）：
// GET 预览（只读、零 rng 零落库）+ POST 触发（对未预报未确认的可预报场次逐场抽类型+系数落库）。
// 权限键与赛季域一致（club.registrations.manage）——预报的是赛程域的「轮」，挂在赛季管理页。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { readJson } from './shared.ts';
import { forecastRound, previewRound } from '../../weather-ops.ts';

const app = new Hono<{ Bindings: Env }>();

// GET /api/admin/weather/forecast?tournament_id=&round= —— 该轮每场的预报/确认/跳过状态
app.get('/weather/forecast', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const tournamentId = Number(c.req.query('tournament_id'));
  const round = Number(c.req.query('round'));
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournament_id 应为正整数');
  if (!Number.isInteger(round) || round < 0) throw new HttpError(400, 'round 应为非负整数');
  return c.json(await previewRound(c.env, tournamentId, round));
});

// POST /api/admin/weather/forecast body { tournamentId, round } —— 触发预报（已预报保留、已确认跳过）
app.post('/weather/forecast', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { tournamentId?: unknown; round?: unknown } | null;
  const tournamentId = Number(body?.tournamentId);
  const round = Number(body?.round);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournamentId 应为正整数');
  if (!Number.isInteger(round) || round < 0) throw new HttpError(400, 'round 应为非负整数');
  return c.json(await forecastRound(c.env, user.id, tournamentId, round));
});

export default app;
