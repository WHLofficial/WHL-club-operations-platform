// 管理端 · 成长引擎管理端（附录 A〔6〕，§10；公开端点在 routes/growth.ts；
// 原 admin.ts 成长域，增量 15 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement, writeAudit } from '../../../lib/audit.ts';
import { getVisibleSeason } from '../../seasons.ts';
import { xpForEvent, recordGrowthEvent, runGrowthSettlement, listGrowthPeriods, loadGrowthPeriod, growthPeriodStatements, type GrowthEventType } from '../../growth.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// 补录：评分/扑救/夺回球权等比赛系统没有的数据；XP 由服务端按 §10.1 计算
app.post('/growth/events', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { playerId?: unknown; matchRef?: unknown; eventType?: unknown; value?: unknown } | null;
  const playerId = Number(body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first<{ id: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');

  const eventType = body?.eventType;
  const MANUAL_TYPES = ['appearance', 'rating', 'clean_sheet', 'duels_won', 'saves'] as const;
  if (typeof eventType !== 'string' || !(MANUAL_TYPES as readonly string[]).includes(eventType)) {
    throw new HttpError(400, 'event_type 只能是 appearance / rating / clean_sheet / duels_won / saves');
  }
  let value = body?.value === undefined || body?.value === null ? 1 : Number(body?.value);
  if (eventType === 'rating') {
    if (!Number.isFinite(value) || value < 7 || value > 10) throw new HttpError(400, '评分要在 7.0-10.0 之间，7.0 以下不给 XP');
    value = Math.round(value * 10) / 10;
  } else if (eventType === 'duels_won' || eventType === 'saves') {
    if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, '次数要是正整数');
  }
  const xp = xpForEvent(eventType as GrowthEventType, value);
  if (xp <= 0) throw new HttpError(400, '这个数值达不到记 XP 的标准');

  const matchRef = typeof body?.matchRef === 'string' && body.matchRef.trim() !== '' ? body.matchRef.trim().slice(0, 40) : `manual:${Date.now()}`;
  const recorded = await recordGrowthEvent(c.env.DB, {
    playerId,
    matchRef,
    season: await getVisibleSeason(c.env.DB),
    windowSeq: null,
    eventType: eventType as GrowthEventType,
    value,
    xp,
    source: 'manual',
    recordedBy: user.id,
  });
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'growth_manual_event',
    targetType: 'player',
    targetId: playerId,
    after: { eventType, value, xp, matchRef, duplicate: !recorded },
  });
  return c.json({ ok: true, xp, duplicate: !recorded }, recorded ? 201 : 200);
});

app.post('/growth/settlement/run', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { season?: unknown; half?: unknown } | null;
  const summary = await runGrowthSettlement(c.env, user.id, body?.season, body?.half);
  return c.json({ ok: true, ...summary });
});

// 成长期宣告（用户规则 2026-09-18）：里程碑只累计当前成长期内的进+攻。
// 与窗口解耦：管理端随时可以宣告新一期；开窗时也能勾选自动宣告（window-machine.ts 的 declareGrowthPeriod）。
// 宣告只是画一条线（界 = 当前事件序号），不改任何球员数据，因此可反复宣告、可连续宣告。
app.get('/growth/periods', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  return c.json(await listGrowthPeriods(c.env.DB));
});

app.post('/growth/periods', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { season?: unknown; note?: unknown } | null;
  let season: number | null;
  if (body?.season === undefined || body?.season === null || body?.season === '') {
    season = await getVisibleSeason(c.env.DB);
  } else {
    season = Number(body.season);
    if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  }
  const note = typeof body?.note === 'string' && body.note.trim() !== '' ? body.note.trim().slice(0, 60) : null;
  await c.env.DB.batch([
    ...growthPeriodStatements(c.env.DB, { season, source: 'manual', note, declaredBy: user.id }),
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_period_declared',
      targetType: 'growth_period',
      targetId: null,
      after: { season, note, source: 'manual' },
    }),
  ]);
  return c.json({ ok: true, ...(await loadGrowthPeriod(c.env.DB)) }, 201);
});

// 档位核定（§10.3）：条件叠加由管理组按现实资料判断，平台只落核定结果与审计
app.post('/growth/:playerId/tier', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await readJson(c)) as { tier?: unknown } | null;
  const tier = Number(body?.tier);
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) throw new HttpError(400, '档位只能是 1-5');
  const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first<{ id: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE players SET growth_tier = ?, updated_at = ${nowSql()} WHERE id = ?`).bind(tier, playerId),
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_tier_set',
      targetType: 'player',
      targetId: playerId,
      after: { tier },
    }),
  ]);
  return c.json({ ok: true, tier });
});

export default app;
