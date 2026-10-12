// 球员页「比赛」页签的取数（v6.46.0，只读）：四个来源各查一趟，合并交给 src/core/player-matches.ts 纯计算。
//   ① 成长记录     平台库 growth_events（match_ref = 比赛系统 match id 的文本）
//   ② 赛事事件     赛事库 match_event（player_id = 本库 players.fc_id；两库同一次 rekey）
//   ③ 赛前首发     赛事库 tactic_submission.slots_json（11 人首发且含该球员才算；链式沿用不算）
//   ④ 缺阵         赛事库 injury_miss JOIN injury
// 平台库只用来查确认过的比分快照（result_confirmations）与历史 club_id；赛事库一律只读。
import type { Env } from './env.ts';
import { firstPlayerByRef } from './player-ref.ts';
import { tourTeamIdsByClub } from './prizes.ts';
import { rowDisplayName } from '../core/player-name.ts';
import { loadTournamentNames } from './tournament-names.ts';
import {
  aggregatePlayerMatches,
  type PlayerMatchesInput,
  type PlayerMatchesResult,
} from '../core/player-matches.ts';

/** D1 的绑定参数有上限（100），IN 列表统一按 50 切片 */
const ID_CHUNK = 50;
/** 首发名单扫描上限：一支队一季约 40-50 场，按 20 季留足余量（命中不了就是历史赛季太久远） */
const LINEUP_SCAN_LIMIT = 2000;

export interface PlayerMatchesPayload {
  player: { id: number; name: string; position: string | null };
  result: PlayerMatchesResult;
}

function slices(ids: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** slots_json 里首发 11 人是否含该球员（`kind` 字段的是替补；解析失败按「不算」处理） */
function isStarterWithin(sub: { matchId: number; teamId: number; slotsJson: string }, fcId: number): boolean {
  let slots: unknown;
  try {
    slots = JSON.parse(sub.slotsJson);
  } catch {
    return false;
  }
  if (!Array.isArray(slots)) return false;
  const starters = slots.filter((s) => !!s && typeof s === 'object' && !('kind' in (s as Record<string, unknown>)));
  if (starters.length !== 11) return false;
  return starters.some((s) => (s as { player_id?: unknown }).player_id === fcId);
}

/** 球员页「比赛」页签载荷；ref 是 fc_id（兼容内部 id），找不到球员返回 null */
export async function loadPlayerMatches(env: Env, ref: number): Promise<PlayerMatchesPayload | null> {
  const player = await firstPlayerByRef<{
    id: number;
    name: string;
    display_name: string | null;
    position: string | null;
    club_id: number | null;
    fc_id: number | null;
  }>(env.DB, 'id, name, display_name, position, club_id, fc_id', ref);
  if (!player) return null;

  // ① 成长记录：match_ref 非空才有「哪一场」的语义；里程碑/重置这类无场次的类型不参与
  const growthRows = await env.DB.prepare(
    `SELECT match_ref, event_type, value FROM growth_events
     WHERE player_id = ? AND match_ref IS NOT NULL
       AND event_type IN ('appearance', 'rating', 'goal', 'assist', 'clean_sheet', 'saves')`,
  )
    .bind(player.id)
    .all<{ match_ref: string; event_type: string; value: number }>();

  // 该球员效力过的 club（现属 + 已完成转会两端）→ 赛事队号。用真映射，不靠 id 数值巧合。
  const clubIds = new Set<number>();
  if (player.club_id !== null) clubIds.add(player.club_id);
  const transferRows = await env.DB.prepare(
    `SELECT from_club_id, to_club_id FROM transfers WHERE player_id = ? AND status = 'completed'`,
  )
    .bind(player.id)
    .all<{ from_club_id: number | null; to_club_id: number | null }>();
  for (const r of transferRows.results) {
    if (r.from_club_id !== null) clubIds.add(r.from_club_id);
    if (r.to_club_id !== null) clubIds.add(r.to_club_id);
  }
  const clubToTourTeam = await tourTeamIdsByClub(env, [...clubIds]);
  const myTeamIds = new Set<number>(clubToTourTeam.values());

  const tourEvents: PlayerMatchesInput['tourEvents'] = [];
  const lineups: PlayerMatchesInput['lineups'] = [];
  const missed: number[] = [];

  const fcId = player.fc_id;
  if (fcId !== null) {
    // 该球员在赛事系统的注册队：club 映射可能缺行（未建档/CPU 队），这一条保证「他在哪支队」总能问到
    const tourPlayer = await env.TOUR_DB.prepare('SELECT team_id FROM player WHERE id = ?')
      .bind(fcId)
      .first<{ team_id: number | null }>();
    if (tourPlayer?.team_id) myTeamIds.add(tourPlayer.team_id);

    // ② 赛事事件：本人事件与助攻（assist_player_id）各算命中；用 entry 落队号判主客
    const eventRows = await env.TOUR_DB.prepare(
      `SELECT me.match_id, me.type, me.minute, me.player_id, e.team_id AS entry_team_id
       FROM match_event me JOIN entry e ON e.id = me.entry_id
       WHERE me.player_id = ? OR me.assist_player_id = ?`,
    )
      .bind(fcId, fcId)
      .all<{ match_id: number; type: string; minute: number | null; player_id: number | null; entry_team_id: number | null }>();
    for (const r of eventRows.results) {
      tourEvents.push({
        matchId: r.match_id,
        type: r.type,
        minute: r.minute,
        own: r.player_id === fcId,
        entryTeamId: r.entry_team_id,
      });
    }

    // ③ 赛前真实提交的首发（只看已开打的场次；一赛一队一份，重复提交覆盖）
    for (const teamSlice of slices([...myTeamIds], ID_CHUNK)) {
      if (teamSlice.length === 0) continue;
      const subRows = await env.TOUR_DB.prepare(
        `SELECT ts.match_id, ts.team_id, ts.slots_json
         FROM tactic_submission ts JOIN match m ON m.id = ts.match_id
         WHERE ts.team_id IN (${teamSlice.map(() => '?').join(', ')})
           AND m.status IN ('live', 'finished')
         ORDER BY ts.match_id DESC LIMIT ?`,
      )
        .bind(...teamSlice, LINEUP_SCAN_LIMIT)
        .all<{ match_id: number; team_id: number; slots_json: string }>();
      for (const r of subRows.results) {
        const sub = { matchId: r.match_id, teamId: r.team_id, slotsJson: r.slots_json };
        if (isStarterWithin(sub, fcId)) lineups.push({ matchId: sub.matchId, teamId: sub.teamId });
      }
    }

    // ④ 伤病停赛名单（injury 一事一登记，injury_miss 一伤一场）
    const missRows = await env.TOUR_DB.prepare(
      `SELECT im.match_id FROM injury_miss im JOIN injury i ON i.id = im.injury_id WHERE i.player_id = ?`,
    )
      .bind(fcId)
      .all<{ match_id: number }>();
    for (const r of missRows.results) missed.push(r.match_id);
  }

  // 候选场次 = 四来源并集；只有确认过（且非弃权）的场次才可能进汇总
  const candidateIds = new Set<number>();
  for (const r of growthRows.results) {
    const matchId = Number(r.match_ref);
    if (Number.isInteger(matchId) && matchId > 0) candidateIds.add(matchId);
  }
  for (const e of tourEvents) candidateIds.add(e.matchId);
  for (const l of lineups) candidateIds.add(l.matchId);
  for (const m of missed) candidateIds.add(m);

  const confirmations: PlayerMatchesInput['confirmations'] = [];
  for (const idSlice of slices([...candidateIds], ID_CHUNK)) {
    const rows = await env.DB.prepare(
      `SELECT match_id, season, competition_type, tournament_id, stage_name, round,
              home_team, away_team, score_home, score_away, walkover_side, finished_at
       FROM result_confirmations WHERE match_id IN (${idSlice.map(() => '?').join(', ')})`,
    )
      .bind(...idSlice)
      .all<{
        match_id: number;
        season: number;
        competition_type: string | null;
        tournament_id: number | null;
        stage_name: string | null;
        round: number | null;
        home_team: string | null;
        away_team: string | null;
        score_home: number | null;
        score_away: number | null;
        walkover_side: string | null;
        finished_at: string | null;
      }>();
    for (const r of rows.results) {
      confirmations.push({
        matchId: r.match_id,
        season: r.season,
        competitionType: r.competition_type,
        tournamentId: r.tournament_id,
        stageName: r.stage_name,
        round: r.round,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        scoreHome: r.score_home,
        scoreAway: r.score_away,
        walkoverSide: r.walkover_side,
        finishedAt: r.finished_at,
      });
    }
  }

  // 队名（判主客与对手）与赛事名
  const teamIdList = [...myTeamIds];
  const teamNameById = new Map<number, string>();
  for (const idSlice of slices(teamIdList, ID_CHUNK)) {
    if (idSlice.length === 0) continue;
    const rows = await env.TOUR_DB.prepare(`SELECT id, name FROM team WHERE id IN (${idSlice.map(() => '?').join(', ')})`)
      .bind(...idSlice)
      .all<{ id: number; name: string }>();
    for (const r of rows.results) teamNameById.set(r.id, r.name);
  }
  const tournamentNameById = await loadTournamentNames(
    env,
    confirmations.map((c) => c.tournamentId),
  );

  const result = aggregatePlayerMatches({
    position: player.position,
    growth: growthRows.results.map((r) => ({ matchRef: r.match_ref, eventType: r.event_type, value: r.value })),
    confirmations,
    tourEvents,
    lineups,
    missed,
    teamNameById,
    tournamentNameById,
  });

  return {
    player: { id: player.id, name: rowDisplayName(player), position: player.position },
    result,
  };
}
