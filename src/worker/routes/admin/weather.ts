// 管理端 · 场次天气预报（v6.15.0，revenue 插件 forecast_round 口径）：
// GET 预览（只读、零 rng 零落库）+ POST 触发（对未预报未确认的可预报场次逐场抽类型+系数落库）。
// 权限键与赛季域一致（club.registrations.manage）——预报的是赛程域的「轮」，挂在赛季管理页。
// 口径：预报只覆盖有轮号（match.round 非空）的联赛式赛程；淘汰赛/无轮号场次不在预报范围，
// 触发时这类场次不进任何返回段（该轮全无轮号则四段全空，与「该轮没排赛」表现一致）。
// 参数校验文案统一用 query 侧的 snake_case（parseRoundParams 两形态共用），与端点字面参数名一致。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { readJson } from './shared.ts';
import { forecastRound, parseRoundParams, previewRound } from '../../weather-ops.ts';

const app = new Hono<{ Bindings: Env }>();

// GET /api/admin/weather/forecast?tournament_id=&round= —— 该轮每场的预报/确认/跳过状态
app.get('/weather/forecast', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const { tournamentId, round } = parseRoundParams(c.req.query('tournament_id'), c.req.query('round'));
  return c.json(await previewRound(c.env, tournamentId, round));
});

// POST /api/admin/weather/forecast body { tournamentId, round } —— 触发预报（已预报保留、已确认跳过）
app.post('/weather/forecast', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { tournamentId?: unknown; round?: unknown } | null;
  const { tournamentId, round } = parseRoundParams(body?.tournamentId, body?.round);
  return c.json(await forecastRound(c.env, user.id, tournamentId, round));
});

export default app;
