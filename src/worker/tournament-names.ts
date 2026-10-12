// 赛事名（跨库取名，v6.45.0 录入台 → v6.46.0 抽出来共用）
// result_confirmations 在平台库、tournament 在赛事库，跨库不能 JOIN，只对已取到的 id 做一趟 IN 查名；
// 查不到（或 tournament_id 为空）保留 null —— 调用方各自决定把 null 归进哪一组，不影响任何写路径。
import type { Env } from './env.ts';

/** tournament id → name（只查正整数 id；空输入不查库） */
export async function loadTournamentNames(env: Env, ids: (number | null)[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0))];
  if (uniq.length === 0) return new Map();
  const rows = await env.TOUR_DB.prepare(`SELECT id, name FROM tournament WHERE id IN (${uniq.map(() => '?').join(', ')})`)
    .bind(...uniq)
    .all<{ id: number; name: string }>();
  return new Map(rows.results.map((r) => [r.id, r.name] as const));
}

export const tournamentNameOf = (names: Map<number, string>, id: number | null): string | null =>
  id === null ? null : (names.get(id) ?? null);
