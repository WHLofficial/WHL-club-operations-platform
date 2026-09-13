// 赛果只读同步与确认（TECH_DESIGN §11）：平台跨库（TOUR_DB）读比赛系统完赛场次 →
// 管理组确认 → 比分快照落 result_confirmations（此后比赛系统改判不影响已确认记录）。
// 奖金 P0 手动记账；确认钩子（XP 事件/通知）在 confirmResult 尾部按增量接入。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement } from '../lib/audit.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface TourMatchRow {
  id: number;
  status: string;
  tournament_id: number;
  round: number | null;
  stage_name: string | null;
  home_team: string | null;
  away_team: string | null;
  score_home: number | null;
  score_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  walkover_side: string | null;
  winner_team: string | null;
  finished_at: string | null;
}

// match→stage 两跳到 tournament；队名/胜者经 entry→team 解析（比赛系统只存 ID）
const MATCH_SELECT = `
  SELECT m.id, m.status, s.tournament_id, m.round, s.name AS stage_name,
         th.name AS home_team, ta.name AS away_team,
         m.score_home, m.score_away, m.pen_home, m.pen_away,
         m.walkover_side, tw.name AS winner_team, m.finished_at
  FROM match m
  JOIN stage s ON s.id = m.stage_id
  LEFT JOIN entry eh ON eh.id = m.home_entry_id
  LEFT JOIN entry ea ON ea.id = m.away_entry_id
  LEFT JOIN team th ON th.id = eh.team_id
  LEFT JOIN team ta ON ta.id = ea.team_id
  LEFT JOIN entry ew ON ew.id = m.winner_entry_id
  LEFT JOIN team tw ON tw.id = ew.team_id`;

export interface ResultQueueItem {
  matchId: number;
  season: number;
  windowSeq: number;
  competitionType: string | null;
  stageName: string | null;
  round: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  penHome: number | null;
  penAway: number | null;
  walkoverSide: string | null;
  winnerTeam: string | null;
  finishedAt: string | null;
}

export interface ConfirmedResultItem {
  id: number;
  matchId: number;
  season: number;
  windowSeq: number;
  competitionType: string | null;
  stageName: string | null;
  round: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  winnerTeam: string | null;
  confirmedAt: string;
}

function toConfirmedItem(r: {
  id: number;
  match_id: number;
  season: number;
  window_seq: number;
  competition_type: string | null;
  stage_name: string | null;
  round: number | null;
  home_team: string | null;
  away_team: string | null;
  score_home: number | null;
  score_away: number | null;
  winner_team: string | null;
  confirmed_at: string;
}): ConfirmedResultItem {
  return {
    id: r.id,
    matchId: r.match_id,
    season: r.season,
    windowSeq: r.window_seq,
    competitionType: r.competition_type,
    stageName: r.stage_name,
    round: r.round,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    scoreHome: r.score_home,
    scoreAway: r.score_away,
    winnerTeam: r.winner_team,
    confirmedAt: r.confirmed_at,
  };
}

// 待确认队列：所有绑了赛事的窗口 → 该赛事 finished 场次，剔除已确认；每窗硬 LIMIT（§17）
export async function queueResults(env: Env): Promise<{ queue: ResultQueueItem[]; confirmed: ConfirmedResultItem[] }> {
  const bound = await env.DB.prepare(
    `SELECT season, window_seq, tournament_id, competition_type FROM season_windows
     WHERE tournament_id IS NOT NULL ORDER BY season DESC, window_seq DESC LIMIT 20`,
  ).all<{ season: number; window_seq: number; tournament_id: number; competition_type: string | null }>();

  const confirmedRows = await env.DB.prepare(
    'SELECT match_id FROM result_confirmations ORDER BY id DESC LIMIT 500',
  ).all<{ match_id: number }>();
  const confirmedSet = new Set(confirmedRows.results.map((r) => r.match_id));

  const queue: (ResultQueueItem & { _sortKey: string })[] = [];
  for (const w of bound.results) {
    const rows = await env.TOUR_DB.prepare(
      `${MATCH_SELECT} WHERE s.tournament_id = ? AND m.status = 'finished'
       ORDER BY m.finished_at DESC, m.id DESC LIMIT 50`,
    )
      .bind(w.tournament_id)
      .all<TourMatchRow>();
    for (const r of rows.results) {
      if (confirmedSet.has(r.id)) continue;
      queue.push({
        matchId: r.id,
        season: w.season,
        windowSeq: w.window_seq,
        competitionType: w.competition_type,
        stageName: r.stage_name,
        round: r.round,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        scoreHome: r.score_home,
        scoreAway: r.score_away,
        penHome: r.pen_home,
        penAway: r.pen_away,
        walkoverSide: r.walkover_side,
        winnerTeam: r.winner_team,
        finishedAt: r.finished_at,
        _sortKey: r.finished_at ?? '',
      });
    }
  }
  queue.sort((a, b) => (a._sortKey < b._sortKey ? 1 : a._sortKey > b._sortKey ? -1 : b.matchId - a.matchId));

  const confirmed = await env.DB.prepare(
    `SELECT id, match_id, season, window_seq, competition_type, stage_name, round,
            home_team, away_team, score_home, score_away, winner_team, confirmed_at
     FROM result_confirmations ORDER BY id DESC LIMIT 50`,
  ).all();
  return {
    queue: queue.map(({ _sortKey: _ignored, ...item }) => item),
    confirmed: (confirmed.results as Parameters<typeof toConfirmedItem>[0][]).map(toConfirmedItem),
  };
}

// 确认一场比赛：完赛校验 → 窗口绑定解析 → 快照落库 + 审计（幂等：match_id 唯一，重复确认 409）
export async function confirmResult(
  env: Env,
  actor: number,
  matchIdInput: unknown,
): Promise<ConfirmedResultItem> {
  const matchId = Number(matchIdInput);
  if (!Number.isInteger(matchId) || matchId <= 0) throw new HttpError(400, '比赛 ID 不对');

  const m = await env.TOUR_DB.prepare(`${MATCH_SELECT} WHERE m.id = ?`).bind(matchId).first<TourMatchRow>();
  if (!m) throw new HttpError(404, '比赛系统里找不到这场比赛');
  if (m.status !== 'finished') throw new HttpError(409, '这场比赛还没完赛，只有完赛的场次能确认');

  const binding = await env.DB.prepare(
    'SELECT season, window_seq, competition_type FROM season_windows WHERE tournament_id = ?',
  )
    .bind(m.tournament_id)
    .first<{ season: number; window_seq: number; competition_type: string | null }>();
  if (!binding) throw new HttpError(409, '这场比赛所属赛事还没绑定到任何窗口，先到「赛季与赛事绑定」里绑');

  const audit = createAuditStatement(env.DB);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO result_confirmations
           (season, window_seq, tournament_id, match_id, competition_type, stage_name, round,
            home_team, away_team, score_home, score_away, pen_home, pen_away, walkover_side,
            winner_team, finished_at, confirmed_by, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql()})`,
      ).bind(
        binding.season,
        binding.window_seq,
        m.tournament_id,
        matchId,
        binding.competition_type,
        m.stage_name,
        m.round,
        m.home_team,
        m.away_team,
        m.score_home,
        m.score_away,
        m.pen_home,
        m.pen_away,
        m.walkover_side,
        m.winner_team,
        m.finished_at,
        actor,
      ),
      audit({
        actor,
        action: 'result_confirm',
        targetType: 'match',
        targetId: matchId,
        after: {
          season: binding.season,
          windowSeq: binding.window_seq,
          homeTeam: m.home_team,
          awayTeam: m.away_team,
          scoreHome: m.score_home,
          scoreAway: m.score_away,
        },
      }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '这场比赛已经确认过了');
    throw err;
  }

  const row = await env.DB.prepare('SELECT * FROM result_confirmations WHERE match_id = ?').bind(matchId).first();
  // 确认钩子接入点：XP 事件（增量 6-d3）→ bot 通知（增量 6-d4）
  return toConfirmedItem(row as Parameters<typeof toConfirmedItem>[0]);
}
