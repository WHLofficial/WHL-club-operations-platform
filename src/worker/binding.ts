// 绑定查询共用件：绑定真源在 auth 库（v1.0.0 上收，TECH_DESIGN §3.2），这里两跳派生——
// AUTH_DB team_binding → team.club_id → 本地 clubs 补名字与组别。
// AUTH_DB 未配置时回落本地休眠表 club_bindings（回滚通道：旧表保留不写，撤新代码即恢复旧读写）。
//
// v6.40.2：一次请求里「教练判定」（hasTeamBinding）与「取绑定俱乐部」（getBoundClub）查的是同一份
// 跨库真源，过去各查一次 = 两趟 AUTH_DB 往返（生产实测约 220ms/条）。这里合并成一次查询（LEFT JOIN
// team 保住「绑了但 team 行缺失」语义：bound=true / clubId=null），并按 Request 记忆化
// （照 lib/session.ts 的 authMemo 手法：WeakMap 挂 Request，随请求回收）。
// 调用方手上没有 Request 时照旧真查（行为与拆分前逐字一致）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';

export interface BoundClub {
  id: number;
  name: string;
  transfer_banned: number;
  /** 1 = CPU 托管队（v6.84.0）：教练侧一律拒绝，管理端解绑/接管照常可用 → 这里不过滤 */
  is_cpu: number;
}

export interface TeamBinding {
  /** 账号在认证中心绑定过球队（不看 club_id 是否已关联目录） */
  bound: boolean;
  /** 绑定球队对应的目录俱乐部 id；绑了但 team 行缺失时为 null */
  clubId: number | null;
}

async function loadTeamBinding(env: Env, userId: number): Promise<TeamBinding> {
  if (!env.AUTH_DB) {
    const row = await env.DB.prepare('SELECT club_id FROM club_bindings WHERE user_id = ?')
      .bind(userId)
      .first<{ club_id: number | null }>();
    return { bound: row !== null, clubId: row?.club_id ?? null };
  }
  const row = await env.AUTH_DB.prepare(
    `SELECT t.club_id AS club_id FROM team_binding b LEFT JOIN team t ON t.id = b.team_id WHERE b.account_id = ?`,
  )
    .bind(userId)
    .first<{ club_id: number | null }>();
  return { bound: row !== null, clubId: row?.club_id ?? null };
}

const bindingMemo = new WeakMap<Request, Map<number, Promise<TeamBinding>>>();

// 按请求记忆化的绑定查询：同一请求内多处调用只付一趟跨库往返。失败不落记忆（下次照旧真查）。
export function getTeamBinding(env: Env, request: Request, userId: number): Promise<TeamBinding> {
  let perUser = bindingMemo.get(request);
  if (!perUser) {
    perUser = new Map();
    bindingMemo.set(request, perUser);
  }
  const hit = perUser.get(userId);
  if (hit) return hit;
  const pending = loadTeamBinding(env, userId).catch((err: unknown) => {
    perUser.delete(userId);
    throw err;
  });
  perUser.set(userId, pending);
  return pending;
}

async function boundClubId(env: Env, userId: number): Promise<number | null> {
  return (await loadTeamBinding(env, userId)).clubId;
}

export async function loadClubById(env: Env, clubId: number): Promise<BoundClub | null> {
  // v1.2.0：league_tier 由报名派生（tier.ts），不再随绑定查询返回
  // v6.84.0：补 is_cpu——requireCoach 的 CPU 守卫要判它
  return env.DB.prepare('SELECT id, name, transfer_banned, is_cpu FROM clubs WHERE id = ?').bind(clubId).first<BoundClub>();
}

// v6.84.0：俱乐部行也按请求记忆化（同族手法，键是 clubId——行内容与账号无关）。
// 同一请求里 requireCoach 的 CPU 守卫与随后的 getBoundClub 查的是同一行，只付一次本库点查。
const clubMemo = new WeakMap<Request, Map<number, Promise<BoundClub | null>>>();

// request 可选：给了就吃按请求记忆化（同请求里 requireCoach 刚查过的那份），不给照旧真查。
export async function getBoundClub(env: Env, userId: number, request?: Request): Promise<BoundClub | null> {
  if (!request) {
    const clubId = await boundClubId(env, userId);
    return clubId === null ? null : loadClubById(env, clubId);
  }
  const clubId = (await getTeamBinding(env, request, userId)).clubId;
  if (clubId === null) return null;
  let perClub = clubMemo.get(request);
  if (!perClub) {
    perClub = new Map();
    clubMemo.set(request, perClub);
  }
  const hit = perClub.get(clubId);
  if (hit) return hit;
  const pending = loadClubById(env, clubId).catch((err: unknown) => {
    perClub.delete(clubId);
    throw err;
  });
  perClub.set(clubId, pending);
  return pending;
}

// v1.3.0：转会禁令守卫——挂单/出价/激活/海捞/续约/解约/匹配/议价报价等新转会动作统一拦在入口
export function assertTradable(club: BoundClub): void {
  if (club.transfer_banned) throw new HttpError(403, '你所在俱乐部的转会权限已被管理组冻结，请联系管理组处理既有事项后再试');
}
