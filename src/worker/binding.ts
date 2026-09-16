// 绑定查询共用件：绑定真源在 auth 库（增量 7 上收，TECH_DESIGN §3.2），这里两跳派生——
// AUTH_DB team_binding → team.club_id → 本地 clubs 补名字与组别。
// AUTH_DB 未配置时回落本地休眠表 club_bindings（回滚通道：旧表保留不写，撤新代码即恢复旧读写）。
import type { Env } from './env.ts';

export interface BoundClub {
  id: number;
  name: string;
}

async function boundClubId(env: Env, userId: number): Promise<number | null> {
  if (!env.AUTH_DB) {
    const row = await env.DB.prepare('SELECT club_id FROM club_bindings WHERE user_id = ?')
      .bind(userId)
      .first<{ club_id: number }>();
    return row?.club_id ?? null;
  }
  const row = await env.AUTH_DB.prepare(
    `SELECT t.club_id AS club_id FROM team_binding b JOIN team t ON t.id = b.team_id WHERE b.account_id = ?`,
  )
    .bind(userId)
    .first<{ club_id: number | null }>();
  return row?.club_id ?? null;
}

export async function getBoundClub(env: Env, userId: number): Promise<BoundClub | null> {
  const clubId = await boundClubId(env, userId);
  if (clubId === null) return null;
  // 增量 9：league_tier 由报名派生（tier.ts），不再随绑定查询返回
  return env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(clubId).first<BoundClub>();
}

// OIDC 教练判定用：账号在认证中心是否绑定过球队（不看 club_id 是否已关联目录）
export async function hasTeamBinding(env: Env, userId: number): Promise<boolean> {
  if (!env.AUTH_DB) {
    const row = await env.DB.prepare('SELECT 1 AS x FROM club_bindings WHERE user_id = ?').bind(userId).first<{ x: number }>();
    return row !== null;
  }
  const row = await env.AUTH_DB.prepare('SELECT 1 AS x FROM team_binding WHERE account_id = ?').bind(userId).first<{ x: number }>();
  return row !== null;
}
