// 队徽（v6.39.3 抽自 routes/clubs.ts 共用）：club_id → tour_team_id → 比赛系统 team.logo_key。
// 本平台 `clubs.logo_key` 全仓无人**写**（写侧在比赛系统），虽然 `GET /me/club` 会读出来渲染，
// 但没有任何入口能给它赋值 ⇒ 一律取比赛系统 `team.logo_key`（生产 20/20 覆盖）。
// 需要下发队徽的公开端点都走这两步：routes/clubs.ts（列表/详情）与 routes/players.ts（球员库）。
import type { Env } from './env.ts';

// club_id → tour_team_id（AUTH_DB 批量，实测 20 行）。队徽与分级派生共用这一份映射：
// 逐队查的话每队都要扫 team 全表 20 行，20 队就是 400 行。
export async function loadClubTourTeams(env: Env): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!env.AUTH_DB) return out;
  const rows = await env.AUTH_DB.prepare('SELECT club_id, tour_team_id AS tid FROM team WHERE club_id IS NOT NULL')
    .all<{ club_id: number; tid: number | null }>();
  for (const r of rows.results) if (typeof r.tid === 'number') out.set(r.club_id, r.tid);
  return out;
}

// 返回 tour_team_id → key（R2 键，前端经 /api/media 镜像读）。调用方用上面的映射折回 club_id。
export async function loadTeamLogos(env: Env, tourTeamIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (env.TOUR_DB === undefined || tourTeamIds.length === 0) return out;
  const ph = tourTeamIds.map(() => '?').join(', ');
  const rows = await env.TOUR_DB.prepare(`SELECT id, logo_key FROM team WHERE id IN (${ph})`)
    .bind(...tourTeamIds)
    .all<{ id: number; logo_key: string | null }>();
  for (const r of rows.results) if (r.logo_key) out.set(r.id, r.logo_key);
  return out;
}
