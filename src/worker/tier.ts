// 分级派生（增量 9）：当季级别以赛事报名为真源（TECH_DESIGN §3.2 改判）。
// 链路：auth 目录 club_id → tour_team_id → club season_tournaments（只认
// league_premier/league_second 定级赛事，杯赛报名再多也不参与定级）→ TOUR_DB entry 报名行。
// clubs.league_tier 单值列自此休眠；AUTH_DB 未配置时回落休眠列（回滚通道，仿 binding.ts）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';

export type Tier = 'premier' | 'second';

const TIER_BY_TYPE: Record<string, Tier> = { league_premier: 'premier', league_second: 'second' };

// 同一请求内复用派生结果：`t:{season}:{clubId}` 存单队结果，`st:{season}` 存当季定级赛事清单
export type TierCache = Map<string, Promise<unknown>>;

export function tierCache(): TierCache {
  return new Map();
}

// 当季定级赛事清单（只认 league_premier/league_second）：单队派生与批量派生共用一份口径，
// 否则「哪些赛事参与定级」会出现两个来源。
function loadLeagueList(env: Env, season: number): Promise<{ tid: number; tier: Tier }[]> {
  return env.DB.prepare(
    `SELECT tournament_id AS tid, competition_type AS ct FROM season_tournaments
     WHERE season = ? AND competition_type IN ('league_premier', 'league_second')`,
  )
    .bind(season)
    .all<{ tid: number; ct: string }>()
    .then((r) => r.results.map((x) => ({ tid: x.tid, tier: TIER_BY_TYPE[x.ct] })));
}

async function derive(env: Env, season: number, clubId: number, cache?: TierCache): Promise<Tier | null> {
  if (!env.AUTH_DB) {
    // 回滚通道：认证通道未配置时读休眠的单值列（旧行为，建队时的定级仍生效）
    const row = await env.DB.prepare('SELECT league_tier AS t FROM clubs WHERE id = ?').bind(clubId).first<{ t: string | null }>();
    return row?.t === 'premier' || row?.t === 'second' ? row.t : null;
  }
  const team = await env.AUTH_DB.prepare('SELECT tour_team_id AS tid FROM team WHERE club_id = ?')
    .bind(clubId)
    .first<{ tid: number | null }>();
  const tourTeamId = team?.tid ?? null;
  if (tourTeamId === null || env.TOUR_DB === undefined) return null;

  const stKey = `st:${season}`;
  let leagues = cache?.get(stKey) as Promise<{ tid: number; tier: Tier }[]> | undefined;
  if (!leagues) {
    leagues = loadLeagueList(env, season);
    cache?.set(stKey, leagues);
  }
  const list = await leagues;
  if (list.length === 0) return null; // 本赛季还没绑定任何定级赛事

  const ph = list.map(() => '?').join(', ');
  const entries = await env.TOUR_DB.prepare(`SELECT tournament_id AS tid FROM entry WHERE team_id = ? AND tournament_id IN (${ph})`)
    .bind(tourTeamId, ...list.map((l) => l.tid))
    .all<{ tid: number }>();
  const tiers = new Set<Tier>();
  for (const e of entries.results) {
    const t = list.find((l) => l.tid === e.tid)?.tier;
    if (t) tiers.add(t);
  }
  if (tiers.size === 0) return null; // 杯赛报了但定级赛事还没报
  if (tiers.size > 1) {
    throw new HttpError(500, `分级数据冲突：俱乐部 ${clubId} 在本赛季报了多座定级赛事，请管理组核对赛事报名`);
  }
  return [...tiers][0];
}

export async function deriveClubTier(env: Env, season: number | null, clubId: number, cache?: TierCache): Promise<Tier | null> {
  if (season === null) return null;
  const key = `t:${season}:${clubId}`;
  const hit = cache?.get(key) as Promise<Tier | null> | undefined;
  if (hit) return hit;
  const p = derive(env, season, clubId, cache);
  cache?.set(key, p);
  return p;
}

export interface ClubLeague {
  tier: Tier | null;
  /** 该队当季报名的那座定级赛事（球队详情的排名要用它去比赛系统取积分榜）；未定级/多座冲突为 null */
  tournamentId: number | null;
}

// 批量派生（增量 31）：公开球队列表一屏就要算 20 队，逐队调 deriveClubTier 是 20×(1 AUTH_DB + 1 TOUR_DB)，
// 其中 AUTH_DB 那条每队要扫 team 全表 20 行（实测 20 队 400 行），而集合形状只要 20 + 62 行。
//
// 规则与 derive() 同一份（TIER_BY_TYPE / loadLeagueList / 「报名行 → 级别」的映射），差别只有一处：
// 一队同时报了多座定级赛事（derive 抛 HttpError(500)）在批量里**降级为 null** —— 单队数据问题
// 不该打死整张公开列表页，但也不能静默，所以留一条 console.warn 给运维。
//
// 返回级别**与**报名赛事 id：球队详情（增量 31）要拿 tournamentId 去比赛系统取积分榜，而
// 「哪座赛事参与定级」这件事只该有一份口径，所以两处共用这个函数（deriveClubTiers 是它的薄包装）。
export async function deriveClubLeagues(
  env: Env,
  season: number | null,
  clubIds: number[],
  preloadedTourTeamIds?: Map<number, number>,
): Promise<Map<number, ClubLeague>> {
  const out = new Map<number, ClubLeague>(clubIds.map((id) => [id, { tier: null, tournamentId: null }]));
  if (season === null || clubIds.length === 0) return out;

  if (!env.AUTH_DB) {
    // 回滚通道（同 derive）：认证通道未配置时读休眠的单值列
    const ph = clubIds.map(() => '?').join(', ');
    const rows = await env.DB.prepare(`SELECT id, league_tier AS t FROM clubs WHERE id IN (${ph})`)
      .bind(...clubIds)
      .all<{ id: number; t: string | null }>();
    for (const r of rows.results) {
      out.set(r.id, { tier: r.t === 'premier' || r.t === 'second' ? r.t : null, tournamentId: null });
    }
    return out;
  }

  let tourTeamIds = preloadedTourTeamIds;
  if (!tourTeamIds) {
    const rows = await env.AUTH_DB.prepare('SELECT club_id, tour_team_id AS tid FROM team WHERE club_id IS NOT NULL')
      .all<{ club_id: number; tid: number | null }>();
    tourTeamIds = new Map<number, number>();
    for (const r of rows.results) if (typeof r.tid === 'number') tourTeamIds.set(r.club_id, r.tid);
  }
  if (env.TOUR_DB === undefined) return out;

  const pairs: Array<[clubId: number, tourTeamId: number]> = [];
  for (const id of clubIds) {
    const tid = tourTeamIds.get(id);
    if (typeof tid === 'number') pairs.push([id, tid]);
  }
  if (pairs.length === 0) return out;

  const list = await loadLeagueList(env, season);
  if (list.length === 0) return out; // 本赛季还没绑定任何定级赛事

  const teamPh = pairs.map(() => '?').join(', ');
  const tidPh = list.map(() => '?').join(', ');
  const entries = await env.TOUR_DB.prepare(
    `SELECT team_id AS team, tournament_id AS tid FROM entry WHERE team_id IN (${teamPh}) AND tournament_id IN (${tidPh})`,
  )
    .bind(...pairs.map((p) => p[1]), ...list.map((l) => l.tid))
    .all<{ team: number; tid: number }>();

  // tour_team_id → club_id 反查。AUTH_DB.team 的 UNIQUE(club_id)/UNIQUE(tour_team_id) 被破坏时
  // 同一座 tour team 会映射到两家俱乐部：单块 derive 取 .first()（确定性首行），批量不能悄悄 last-wins，
  // 否则同一 clubId 在两处得到不同 tier —— 冲突的两家都按未定级显示并告警。
  const clubByTourTeam = new Map<number, number>();
  const ambiguousTeams = new Set<number>();
  for (const [clubId, tourTeamId] of pairs) {
    const prev = clubByTourTeam.get(tourTeamId);
    if (prev !== undefined && prev !== clubId) {
      ambiguousTeams.add(tourTeamId);
      console.warn(`[tier] AUTH_DB 映射冲突，列表按未定级显示：比赛系统球队 ${tourTeamId} 同时挂在俱乐部 ${prev} 与 ${clubId} 下，请管理组核对绑定`);
      continue;
    }
    clubByTourTeam.set(tourTeamId, clubId);
  }

  const tiersByClub = new Map<number, Set<Tier>>();
  const tourneysByClub = new Map<number, Set<number>>();
  for (const e of entries.results) {
    const tier = list.find((l) => l.tid === e.tid)?.tier;
    const clubId = clubByTourTeam.get(e.team);
    if (!tier || clubId === undefined || ambiguousTeams.has(e.team)) continue;
    const set = tiersByClub.get(clubId) ?? new Set<Tier>();
    set.add(tier);
    tiersByClub.set(clubId, set);
    const tset = tourneysByClub.get(clubId) ?? new Set<number>();
    tset.add(e.tid);
    tourneysByClub.set(clubId, tset);
  }
  for (const [clubId, tiers] of tiersByClub) {
    if (tiers.size !== 1) {
      console.warn(`[tier] 分级数据冲突，列表按未定级显示：俱乐部 ${clubId} 在本赛季报了多座定级赛事，请管理组核对赛事报名`);
      continue;
    }
    // 同一级别报了两座赛事（比如两座 league_premier）时级别仍唯一、但排名该看哪座说不清 ⇒ tournamentId 留 null
    const tourneys = tourneysByClub.get(clubId);
    out.set(clubId, {
      tier: [...tiers][0],
      tournamentId: tourneys && tourneys.size === 1 ? [...tourneys][0] : null,
    });
  }
  return out;
}

export async function deriveClubTiers(
  env: Env,
  season: number | null,
  clubIds: number[],
  preloadedTourTeamIds?: Map<number, number>,
): Promise<Map<number, Tier | null>> {
  const leagues = await deriveClubLeagues(env, season, clubIds, preloadedTourTeamIds);
  return new Map([...leagues].map(([clubId, l]) => [clubId, l.tier]));
}
