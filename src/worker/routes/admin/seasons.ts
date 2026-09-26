// 管理端 · 赛季管理与赛果确认（附录 A〔6〕，§11；原 admin.ts 赛季域，v2.1.0 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement } from '../../../lib/audit.ts';
import { settleTournamentStage, settleSeason, checkSeasonSettle, rejudgeGrowable } from '../../season-settle.ts';
import { queueResults, confirmResult, replayHooksForMatch } from '../../results.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

const COMPETITION_TYPES = ['league_premier', 'league_second', 'champions_cup', 'super_cup', 'qualifying'] as const;

app.post('/seasons', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { season?: unknown; ageCap?: unknown } | null;
  const season = Number(body?.season);
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  // 可成长年龄上限（规则 4.1.1：大版本第 1/2/3+ 季 25/24/23 递减；建季时管理组直接填本季上限）
  const ageCap = body?.ageCap === undefined || body?.ageCap === null ? null : Number(body?.ageCap);
  if (ageCap !== null && (!Number.isInteger(ageCap) || ageCap < 15 || ageCap > 40)) throw new HttpError(400, '可成长年龄上限应为 15-40 的整数（规则参考 25/24/23）');
  const audit = createAuditStatement(c.env.DB);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO seasons (season, status, age_cap, created_at) VALUES (?, 'preparing', ?, ${nowSql()})`).bind(season, ageCap),
      audit({ actor: user.id, action: 'season_create', targetType: 'season', targetId: season, origin: 'user', after: ageCap !== null ? { ageCap } : undefined }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '这个赛季已经存在');
    throw err;
  }
  // 建档即按新上限重判全球员 growable（规则 4.1.1 季切口径）
  const growable = ageCap !== null ? await rejudgeGrowable(c.env, ageCap) : 0;
  return c.json({ ok: true, season, growable }, 201);
});

// 赛季结算前置检查（v1.4.0）：硬阻断清单 + 软警示清单
app.get('/seasons/:id/settle-check', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const season = Number(c.req.param('id'));
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  if (!(await c.env.DB.prepare('SELECT season FROM seasons WHERE season = ?').bind(season).first())) throw new HttpError(404, '赛季不存在');
  const check = await checkSeasonSettle(c.env, season);
  return c.json({ ok: true, season, ...check });
});

// 赛季结算（v1.4.0）：手动按钮——忠诚奖金 → growable 重判 → seasons.status='settled'。
// 硬阻断 409；软警示需 acknowledged=true 确认后继续（返回体带提示清单）
app.post('/seasons/:id/settle-season', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { acknowledged?: unknown } | null;
  return c.json(await settleSeason(c.env, user.id, c.req.param('id'), body?.acknowledged === true));
});

// 赛事完结结算（v1.4.0）：入场奖金/资格赛保底/小组赛剩余池一次性发放，stage_settled_at 幂等
app.post('/season-bindings/:id/stage-settle', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  return c.json(await settleTournamentStage(c.env, user.id, c.req.param('id')));
});

app.get('/seasons', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const rows = await c.env.DB.prepare('SELECT season, status FROM seasons ORDER BY season DESC').all<{
    season: number;
    status: string;
  }>();
  return c.json({ seasons: rows.results });
});

// 绑定赛事到赛季（v0.7.1 层级修订：赛季是上级，赛事与窗口并列——赛事绑赛季、窗口只管转会准入）。
// 一座赛事只进一个赛季（库上唯一约束，防同一场比赛双份进赛果队列）；赛季已结算后不得再绑
app.post('/seasons/:id/bind-tournament', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const season = Number(c.req.param('id'));
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const body = (await readJson(c)) as { tournamentId?: unknown; competitionType?: unknown } | null;
  const tournamentId = Number(body?.tournamentId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournamentId 应为正整数');
  const competitionType = body?.competitionType;
  if (typeof competitionType !== 'string' || !(COMPETITION_TYPES as readonly string[]).includes(competitionType)) {
    throw new HttpError(400, '竞赛类型只能是 league_premier / league_second / champions_cup / super_cup / qualifying');
  }

  const tournament = await c.env.TOUR_DB.prepare('SELECT id, name FROM tournament WHERE id = ?')
    .bind(tournamentId)
    .first<{ id: number; name: string }>();
  if (!tournament) throw new HttpError(404, '比赛系统里找不到这座赛事');

  const seasonRow = await c.env.DB.prepare('SELECT status FROM seasons WHERE season = ?').bind(season).first<{ status: string }>();
  if (!seasonRow) throw new HttpError(404, '赛季不存在，先建档再绑赛事');
  if (seasonRow.status === 'settled') throw new HttpError(409, '这个赛季已经结算，不能再绑赛事');

  const audit = createAuditStatement(c.env.DB);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, ?, ${nowSql()})`,
      ).bind(season, tournamentId, competitionType),
      audit({
        actor: user.id,
        action: 'season_bind_tournament',
        targetType: 'season',
        targetId: season,
        origin: 'user',
        after: { season, tournamentId, competitionType },
      }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '这座赛事已经绑过赛季了（一座赛事只进一个赛季）');
    throw err;
  }
  return c.json({ ok: true, tournament: { id: tournament.id, name: tournament.name } });
});

// 某赛季的赛事绑定列表（管理端「赛季与赛事绑定」用；赛事名前端经 /tournaments 下拉映射）
app.get('/seasons/:id/tournaments', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const season = Number(c.req.param('id'));
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const rows = await c.env.DB.prepare(
    'SELECT id, tournament_id, competition_type, stage_settled_at FROM season_tournaments WHERE season = ? ORDER BY id',
  )
    .bind(season)
    .all<{ id: number; tournament_id: number; competition_type: string | null; stage_settled_at: string | null }>();
  return c.json({
    bindings: rows.results.map((r) => ({ id: r.id, tournamentId: r.tournament_id, competitionType: r.competition_type, stageSettledAt: r.stage_settled_at })),
  });
});

// 解绑：该赛事还没有任何确认入档赛果时才允许（防结算后改账）
app.post('/seasons/:id/unbind-tournament', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const season = Number(c.req.param('id'));
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const body = (await readJson(c)) as { tournamentId?: unknown } | null;
  const tournamentId = Number(body?.tournamentId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournamentId 应为正整数');

  const binding = await c.env.DB.prepare('SELECT id FROM season_tournaments WHERE season = ? AND tournament_id = ?')
    .bind(season, tournamentId)
    .first<{ id: number }>();
  if (!binding) throw new HttpError(404, '这座赛事没有绑在这个赛季上');
  const confirmed = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM result_confirmations WHERE tournament_id = ?')
    .bind(tournamentId)
    .first<{ n: number }>();
  if ((confirmed?.n ?? 0) > 0) throw new HttpError(409, '这座赛事已经有确认入档的赛果，不能解绑');

  const audit = createAuditStatement(c.env.DB);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM season_tournaments WHERE id = ?').bind(binding.id),
    audit({
      actor: user.id,
      action: 'season_unbind_tournament',
      targetType: 'season',
      targetId: season,
      origin: 'user',
      after: { season, tournamentId },
    }),
  ]);
  return c.json({ ok: true });
});

// 赛事下拉：比赛系统赛事列表（只读跨库）
app.get('/tournaments', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const rows = await c.env.TOUR_DB.prepare('SELECT id, name, status FROM tournament ORDER BY id DESC LIMIT 100').all<{
    id: number;
    name: string;
    status: string;
  }>();
  return c.json({ tournaments: rows.results });
});

app.get('/results/queue', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  return c.json(await queueResults(c.env));
});

app.post('/results/:id/confirm', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const { result, xp } = await confirmResult(c.env, user.id, c.req.param('id'), 'user');
  return c.json({ ok: true, result, xp }, 201);
});

// 重放已确认场次的三钩子（v2.7.0，幂等）：钩子失败/标了人工复核的场，修完数据后从这里补账
app.post('/results/:id/replay-hooks', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const result = await replayHooksForMatch(c.env, c.req.param('id'));
  return c.json({ ok: true, result }, 201);
});

export default app;
