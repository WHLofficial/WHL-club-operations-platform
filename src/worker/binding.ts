// 绑定查询共用件：一账号一队（§3.2），注册、市场、财政都要用
export interface BoundClub {
  id: number;
  name: string;
  league_tier: string | null;
}

export async function getBoundClub(env: import('./env.ts').Env, userId: number): Promise<BoundClub | null> {
  return env.DB.prepare(
    `SELECT c.id, c.name, c.league_tier FROM club_bindings b JOIN clubs c ON c.id = b.club_id WHERE b.user_id = ?`,
  )
    .bind(userId)
    .first<BoundClub>();
}
