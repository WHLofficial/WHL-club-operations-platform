// 赛果只读同步与确认（TECH_DESIGN §11）：平台跨库（TOUR_DB）读比赛系统完赛场次 →
// 管理组确认 → 比分快照落 result_confirmations（此后比赛系统改判不影响已确认记录）。
// 确认钩子：自动 XP 事件（§10.1，growth.ts）+ 后续 bot 通知（d4）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { recordGrowthEventStatements, defensivePositionsForClub, type GrowthEventInput } from './growth.ts';
import { queueClubNotification } from './notify.ts';
import { matchPrizeStatements } from './prizes.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface TourMatchRow {
  id: number;
  status: string;
  tournament_id: number;
  stage_kind: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  round: number | null;
  stage_name: string | null;
  stage_config: string | null;
  home_team: string | null;
  away_team: string | null;
  score_home: number | null;
  score_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  walkover_side: string | null;
  winner_team: string | null;
  winner_team_id: number | null;
  finished_at: string | null;
}

// match→stage 两跳到 tournament；队名/胜者经 entry→team 解析（比赛系统只存 ID）
const MATCH_SELECT = `
  SELECT m.id, m.status, s.tournament_id, s.kind AS stage_kind,
         eh.team_id AS home_team_id, ea.team_id AS away_team_id,
         m.round, s.name AS stage_name, s.config_json AS stage_config,
         th.name AS home_team, ta.name AS away_team,
         m.score_home, m.score_away, m.pen_home, m.pen_away,
         m.walkover_side, tw.name AS winner_team, tw.id AS winner_team_id, m.finished_at
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

// 待确认队列：绑定的全部赛事（赛季级绑定，增量 6.1 修订）→ 该赛事 finished 场次，剔除已确认；每赛事硬 LIMIT（§17）
export async function queueResults(env: Env): Promise<{ queue: ResultQueueItem[]; confirmed: ConfirmedResultItem[] }> {
  const bound = await env.DB.prepare(
    `SELECT season, tournament_id, competition_type FROM season_tournaments
     ORDER BY season DESC, tournament_id DESC LIMIT 20`,
  ).all<{ season: number; tournament_id: number; competition_type: string | null }>();

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

// 确认一场比赛：完赛校验 → 赛季绑定解析 → 快照落库 + 审计（幂等：match_id 唯一，重复确认 409）。
// 窗口号盖确认时刻的全局开放窗口（§15 假设 25：窗口只管转会准入，赛果归属赛季不归属窗口）；
// 没有开放窗口（关窗后补确认）取最近一窗，一次窗口都没开过则记 0。
export async function confirmResult(
  env: Env,
  actor: number,
  matchIdInput: unknown,
): Promise<{ result: ConfirmedResultItem; xp: XpHookSummary; prizeError: string | null }> {
  const matchId = Number(matchIdInput);
  if (!Number.isInteger(matchId) || matchId <= 0) throw new HttpError(400, '比赛 ID 不对');

  const m = await env.TOUR_DB.prepare(`${MATCH_SELECT} WHERE m.id = ?`).bind(matchId).first<TourMatchRow>();
  if (!m) throw new HttpError(404, '比赛系统里找不到这场比赛');
  if (m.status !== 'finished') throw new HttpError(409, '这场比赛还没完赛，只有完赛的场次能确认');

  const binding = await env.DB.prepare(
    'SELECT season, competition_type FROM season_tournaments WHERE tournament_id = ?',
  )
    .bind(m.tournament_id)
    .first<{ season: number; competition_type: string | null }>();
  if (!binding) throw new HttpError(409, '这场比赛所属赛事还没绑定到任何赛季，先到「赛季与赛事绑定」里绑');

  const win =
    (await env.DB.prepare(
      "SELECT window_seq FROM season_windows WHERE status = 'open' ORDER BY season DESC, window_seq DESC LIMIT 1",
    ).first<{ window_seq: number }>()) ??
    (await env.DB.prepare('SELECT window_seq FROM season_windows ORDER BY season DESC, window_seq DESC LIMIT 1').first<{
      window_seq: number;
    }>());
  const ctx = { season: binding.season, window_seq: win?.window_seq ?? 0, competition_type: binding.competition_type };

  const audit = createAuditStatement(env.DB);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO result_confirmations
           (season, window_seq, tournament_id, match_id, competition_type, stage_name, stage_kind, round,
            home_team_id, away_team_id, home_team, away_team, score_home, score_away, pen_home, pen_away,
            walkover_side, winner_team, finished_at, confirmed_by, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql()})`,
      ).bind(
        ctx.season,
        ctx.window_seq,
        m.tournament_id,
        matchId,
        binding.competition_type,
        m.stage_name,
        m.stage_kind,
        m.round,
        m.home_team_id,
        m.away_team_id,
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
          season: ctx.season,
          windowSeq: ctx.window_seq,
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

  const row = await env.DB.prepare(
    `SELECT id, match_id, season, window_seq, competition_type, stage_name, round,
            home_team, away_team, score_home, score_away, winner_team, confirmed_at
     FROM result_confirmations WHERE match_id = ?`,
  )
    .bind(matchId)
    .first();
  // 确认钩子①：自动 XP 事件（§10.1）；钩子②bot 通知（§12，尽力而为不阻塞确认）；
  // 钩子③赛事奖金即时入账（增量 11，吞错不阻塞确认——奖金失败可重确认同 match 幂等重放）
  const xp = await recordAutoXpForMatch(env, matchId, m, ctx);
  await queueResultNotifications(env, ctx, m);
  let prizeError: string | null = null;
  try {
    const prizeStatements = await matchPrizeStatements(env, {
      matchId,
      season: ctx.season,
      competitionType: binding.competition_type,
      stageKind: m.stage_kind,
      round: m.round,
      homeTeamId: m.home_team_id,
      awayTeamId: m.away_team_id,
      scoreHome: m.score_home,
      scoreAway: m.score_away,
      penHome: m.pen_home,
      penAway: m.pen_away,
      walkoverSide: m.walkover_side,
      winnerTeamId: m.winner_team_id,
      stageEntryCount: stageEntryCount(m.stage_config),
    });
    if (prizeStatements.length > 0) await env.DB.batch(prizeStatements);
  } catch (err) {
    prizeError = String(err);
  }
  return { result: toConfirmedItem(row as Parameters<typeof toConfirmedItem>[0]), xp, prizeError };
}

/** elim 阶段 config_json 里的入场队数（晋级轮次推算用；解析失败按未知处理=不发晋级奖金） */
function stageEntryCount(configJson: string | null): number | null {
  if (!configJson) return null;
  try {
    const cfg = JSON.parse(configJson) as Record<string, unknown>;
    for (const key of ['entry_count', 'entryCount', 'bracket_size', 'bracketSize', 'size']) {
      const v = cfg[key];
      if (typeof v === 'number' && v > 1) return v;
    }
    return null;
  } catch {
    return null;
  }
}

// 确认通知：给主客两队绑了 QQ 的教练各排一条（队名 → 平台俱乐部按名匹配，同 XP 匹配口径）
async function queueResultNotifications(
  env: Env,
  binding: { season: number; window_seq: number; competition_type: string | null },
  m: TourMatchRow,
): Promise<void> {
  const score = `${m.score_home ?? '?'}:${m.score_away ?? '?'}`;
  const data = {
    season: binding.season,
    windowSeq: binding.window_seq,
    competition: binding.competition_type,
    score,
  };
  for (const teamName of new Set([m.home_team, m.away_team])) {
    if (!teamName) continue;
    const club = await env.DB.prepare('SELECT id FROM clubs WHERE name = ?').bind(teamName).first<{ id: number }>();
    if (!club) continue;
    await queueClubNotification(env, club.id, 'result_confirmed', {
      ...data,
      home: m.home_team,
      away: m.away_team,
    });
  }
}

// ---- 确认钩子：自动 XP 事件（§10.1）----

interface XpHookSummary {
  granted: number;
  unresolved: string[];
}

/**
 * 从比赛系统 match_event 生成出场/进球/助攻/零封事件（growth_events 去重锚防重复）。
 * 限制口径（§15 假设 20-22）：仅联赛与冠军杯小组赛计 XP；弃权场不计；训练营球员不按场次
 * （走结算固定 XP）。球员匹配按「队名=俱乐部名 → 球员名=名单名」，解不开的进 unresolved 由管理组补录。
 */
async function recordAutoXpForMatch(
  env: Env,
  matchId: number,
  m: TourMatchRow,
  binding: { season: number; window_seq: number; competition_type: string | null },
): Promise<XpHookSummary> {
  const comp = binding.competition_type;
  const xpEligible = comp === 'league_premier' || comp === 'league_second' || (comp === 'champions_cup' && m.stage_kind === 'group');
  const walkover = !!m.walkover_side && m.walkover_side !== '';
  const unresolved: string[] = [];
  if (!xpEligible || walkover) return { granted: 0, unresolved };

  const events = await env.TOUR_DB.prepare(
    `SELECT me.type, me.player_id, me.assist_player_id,
            p.name AS player_name, p.team_id AS player_team_id, pt.name AS player_team_name,
            ap.name AS assist_name, ap.team_id AS assist_team_id, apt.name AS assist_team_name
     FROM match_event me
     LEFT JOIN player p ON p.id = me.player_id
     LEFT JOIN team pt ON pt.id = p.team_id
     LEFT JOIN player ap ON ap.id = me.assist_player_id
     LEFT JOIN team apt ON apt.id = ap.team_id
     WHERE me.match_id = ?`,
  )
    .bind(matchId)
    .all<{
      type: string;
      player_id: number | null;
      assist_player_id: number | null;
      player_name: string | null;
      player_team_id: number | null;
      player_team_name: string | null;
      assist_name: string | null;
      assist_team_id: number | null;
      assist_team_name: string | null;
    }>();

  // 出场名单 = 有事件记录的球员 + 助攻者（都必然登过场）
  const seen = new Map<number, { name: string | null; teamId: number | null; teamName: string | null }>();
  for (const ev of events.results) {
    if (ev.player_id !== null) seen.set(ev.player_id, { name: ev.player_name, teamId: ev.player_team_id, teamName: ev.player_team_name });
    if (ev.assist_player_id !== null) seen.set(ev.assist_player_id, { name: ev.assist_name, teamId: ev.assist_team_id, teamName: ev.assist_team_name });
  }

  // 队名 → 平台俱乐部 → 名单内同名球员（带 position/status 供零封判定与训练营排除）
  const clubCache = new Map<string, { clubId: number; defensive: Set<string> } | null>();
  const rosterCache = new Map<string, { id: number; position: string | null; status: string } | null>();
  async function resolve(teamName: string | null, playerName: string | null) {
    if (!teamName || !playerName) return null;
    let club = clubCache.get(teamName);
    if (club === undefined) {
      const row = await env.DB.prepare('SELECT id FROM clubs WHERE name = ?').bind(teamName).first<{ id: number }>();
      club = row ? { clubId: row.id, defensive: await defensivePositionsForClub(env.DB, row.id) } : null;
      clubCache.set(teamName, club);
    }
    if (!club) {
      if (!unresolved.includes(`俱乐部「${teamName}」`)) unresolved.push(`俱乐部「${teamName}」`);
      return null;
    }
    const key = `${club.clubId}:${playerName}`;
    let player = rosterCache.get(key);
    if (player === undefined) {
      player =
        (await env.DB.prepare('SELECT id, position, status FROM players WHERE club_id = ? AND name = ? ORDER BY id LIMIT 1')
          .bind(club.clubId, playerName)
          .first<{ id: number; position: string | null; status: string }>()) ?? null;
      rosterCache.set(key, player);
    }
    if (!player) {
      const label = `${teamName}·${playerName}`;
      if (!unresolved.includes(label)) unresolved.push(label);
      return null;
    }
    return { club, player };
  }

  const statements: D1PreparedStatement[] = [];
  function push(e: Omit<GrowthEventInput, 'source' | 'season' | 'windowSeq'>) {
    statements.push(
      ...recordGrowthEventStatements(env.DB, {
        ...e,
        season: binding.season,
        windowSeq: binding.window_seq,
        source: 'auto',
      }),
    );
  }

  const resolved = new Map<number, Awaited<ReturnType<typeof resolve>>>();
  for (const [tourPlayerId, info] of seen) {
    const r = await resolve(info.teamName, info.name);
    resolved.set(tourPlayerId, r);
    if (!r || r.player.status === 'trainee') continue; // 训练营不按场次（§10.1）
    push({ playerId: r.player.id, matchRef: String(matchId), eventType: 'appearance', value: 1, xp: 1, recordedBy: null });
  }
  // 进球/助攻按「球员×类型」聚合成一条事件：growth_events 去重锚是
  // UNIQUE(player_id, match_ref, event_type)，一场一类型只容一行，value 记球/助攻数
  const goalCount = new Map<number, number>();
  const assistCount = new Map<number, number>();
  for (const ev of events.results) {
    if (ev.type !== 'goal' && ev.type !== 'pen_goal') continue; // own_goal/牌/伤停不记 XP（§15 假设）
    if (ev.player_id !== null) goalCount.set(ev.player_id, (goalCount.get(ev.player_id) ?? 0) + 1);
    if (ev.assist_player_id !== null) assistCount.set(ev.assist_player_id, (assistCount.get(ev.assist_player_id) ?? 0) + 1);
  }
  for (const [tourPlayerId, count] of goalCount) {
    const r = resolved.get(tourPlayerId);
    if (!r || r.player.status === 'trainee') continue;
    push({ playerId: r.player.id, matchRef: String(matchId), eventType: 'goal', value: count, xp: 0.5 * count, recordedBy: null });
  }
  for (const [tourPlayerId, count] of assistCount) {
    const r = resolved.get(tourPlayerId);
    if (!r || r.player.status === 'trainee') continue;
    push({ playerId: r.player.id, matchRef: String(matchId), eventType: 'assist', value: count, xp: 0.5 * count, recordedBy: null });
  }
  // 零封：一侧净吞 0 蛋 → 该侧登场的防守位置球员各 0.5（位置宽松链见 defensivePositionsForClub）
  if (m.score_away === 0 && m.home_team_id !== null) {
    await pushCleanSheets(m.home_team_id);
  }
  if (m.score_home === 0 && m.away_team_id !== null) {
    await pushCleanSheets(m.away_team_id);
  }

  async function pushCleanSheets(sideTeamId: number) {
    for (const [tourPlayerId, info] of seen) {
      if (info.teamId !== sideTeamId) continue;
      const r = resolved.get(tourPlayerId);
      if (!r || r.player.status === 'trainee') continue;
      if (!r.club.defensive.has(r.player.position ?? '')) continue;
      push({ playerId: r.player.id, matchRef: String(matchId), eventType: 'clean_sheet', value: 1, xp: 0.5, recordedBy: null });
    }
  }

  let granted = 0;
  if (statements.length > 0) {
    const results = await env.DB.batch(statements);
    // 每条事件两条语句（先 UPDATE 后 INSERT），奇数位 changes=1 表示新入账
    for (let i = 0; i < statements.length; i += 2) {
      if ((results[i + 1]?.meta.changes ?? 0) === 1) granted++;
    }
  }
  return { granted, unresolved };
}

