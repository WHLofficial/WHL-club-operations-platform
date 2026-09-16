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
    leagues = env.DB
      .prepare(
        `SELECT tournament_id AS tid, competition_type AS ct FROM season_tournaments
         WHERE season = ? AND competition_type IN ('league_premier', 'league_second')`,
      )
      .bind(season)
      .all<{ tid: number; ct: string }>()
      .then((r) => r.results.map((x) => ({ tid: x.tid, tier: TIER_BY_TYPE[x.ct] })));
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
