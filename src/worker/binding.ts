// 绑定查询共用件：绑定真源在 auth 库（v1.0.0 上收，TECH_DESIGN §3.2），这里两跳派生——
// AUTH_DB team_binding → team.club_id → 本地 clubs 补名字与组别。
// AUTH_DB 未配置时回落本地休眠表 club_bindings（回滚通道：旧表保留不写，撤新代码即恢复旧读写）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';

export interface BoundClub {
  id: number;
  name: string;
  transfer_banned: number;
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
  // v1.2.0：league_tier 由报名派生（tier.ts），不再随绑定查询返回
  return env.DB.prepare('SELECT id, name, transfer_banned FROM clubs WHERE id = ?').bind(clubId).first<BoundClub>();
}

// v1.3.0：转会禁令守卫——挂单/出价/激活/海捞/续约/解约/匹配/议价报价等新转会动作统一拦在入口
export function assertTradable(club: BoundClub): void {
  if (club.transfer_banned) throw new HttpError(403, '你所在俱乐部的转会权限已被管理组冻结，请联系管理组处理既有事项后再试');
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
