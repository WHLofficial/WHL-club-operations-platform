// 赛季公开端点（附录 A〔6〕，🌐 无需登录）：当前赛季与最新窗口，MVP 闭环走查用
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
      `SELECT season, window_seq, status, tournament_id, competition_type, opened_at, closed_at
       FROM season_windows ORDER BY season DESC, window_seq DESC LIMIT 1`,
    )
    .first<{
      season: number;
      window_seq: number;
      status: string;
      tournament_id: number | null;
      competition_type: string | null;
      opened_at: string | null;
      closed_at: string | null;
    }>();
  return c.json({
    season: season ? { season: season.season, status: season.status } : null,
    window: win
      ? {
          season: win.season,
          windowSeq: win.window_seq,
          status: win.status,
          tournamentId: win.tournament_id,
          competitionType: win.competition_type,
          openedAt: win.opened_at,
          closedAt: win.closed_at,
        }
      : null,
  });
});

export default app;
