// 赛季公开端点（附录 A〔6〕，🌐 无需登录）：当前赛季 + 最新窗口 + 本赛季绑定赛事（增量 6.1：赛事绑赛季）
import { Hono } from 'hono';
import type { Env } from '../env.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/seasons/current', async (c) => {
  const db = c.env.DB;
  const season = await db
    .prepare(
      `SELECT season, status FROM seasons
       WHERE status IN ('preparing', 'running')
       ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, season DESC LIMIT 1`,
    )
    .first<{ season: number; status: string }>();
  const win = await db
    .prepare(
      `SELECT season, window_seq, status, opened_at, closed_at
       FROM season_windows ORDER BY season DESC, window_seq DESC LIMIT 1`,
    )
    .first<{
      season: number;
      window_seq: number;
      status: string;
      opened_at: string | null;
      closed_at: string | null;
    }>();
  const bindings = season
    ? await db
        .prepare('SELECT id, tournament_id, competition_type FROM season_tournaments WHERE season = ? ORDER BY id')
        .bind(season.season)
        .all<{ id: number; tournament_id: number; competition_type: string | null }>()
    : { results: [] as { id: number; tournament_id: number; competition_type: string | null }[] };
  return c.json({
    season: season ? { season: season.season, status: season.status } : null,
    window: win
      ? {
          season: win.season,
          windowSeq: win.window_seq,
          status: win.status,
          openedAt: win.opened_at,
          closedAt: win.closed_at,
        }
      : null,
    tournaments: bindings.results.map((t) => ({ id: t.id, tournamentId: t.tournament_id, competitionType: t.competition_type })),
  });
});

export default app;
