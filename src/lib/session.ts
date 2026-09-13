// 登录透传与本地会话：
// 兼容模式（TECH_DESIGN §3.1，照抄竞猜系统范式）：会话真源在比赛系统——
// cookie whl_session → 共享 KV sess:{token} → TOUR_DB user 表；平台不种 cookie。
// OIDC 模式（统一认证迁移步骤②，auth 项目 PRD P0-5）：配置 OIDC_ISSUER 后改走
// 认证中心签发的本地会话——cookie club_session → oidc_session 表 → 同一张 TOUR_DB user
// 表现查（不存姓名/角色快照，两模式行为完全等价）。回滚开关 = 撤掉 OIDC_* 变量重新部署。
import type { Env } from '../worker/env.ts';
import { HttpError } from './http.ts';
import { sha256Hex } from './crypto.ts';
import { OIDC_SESSION_COOKIE } from './oidc.ts';

const TOUR_COOKIE = 'whl_session';

export type Role = 'admin' | 'coach' | 'viewer';

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
  locked: boolean;
  mustChangePw: boolean;
}

// 角色沿用比赛系统：admin/superadmin→管理组（不受 locked 影响，防管理端被锁），
// coach→教练；locked=1 是「未解锁绑队」的观众号（不是封禁），放行只读（§3.1-4）。
export function mapRole(tour: { role: string; locked: number }): Role {
  if (tour.role === 'admin' || tour.role === 'superadmin') return 'admin';
  if (tour.locked === 1) return 'viewer';
  if (tour.role === 'coach') return 'coach';
  return 'viewer';
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

async function resolveKvUserId(env: Env, request: Request): Promise<number | null> {
  if (!env.SESSION_KV) return null;
  const token = getCookie(request, TOUR_COOKIE);
  if (!token) return null;
  const raw = await env.SESSION_KV.get(`sess:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw).userId;
  } catch {
    return null;
  }
}

async function resolveOidcUserId(env: Env, request: Request): Promise<number | null> {
  const token = getCookie(request, OIDC_SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT sub FROM oidc_session WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<{ sub: string }>();
  if (!row) return null;
  // 过渡期 auth 账号即 tour user 行（真源还在 tour 库）；步骤③收口后这里改信任 claims
  const userId = Number(row.sub);
  return Number.isInteger(userId) ? userId : null;
}

async function loadTourUser(env: Env, userId: number): Promise<SessionUser | null> {
  const tour = (await env.TOUR_DB.prepare(
    'SELECT id, name, role, locked, must_change_pw FROM user WHERE id = ?',
  ).bind(userId).first()) as { id: number; name: string; role: string; locked: number; must_change_pw: number } | null;
  if (!tour) return null;
  return {
    id: tour.id,
    name: tour.name,
    role: mapRole(tour),
    locked: tour.locked === 1,
    mustChangePw: tour.must_change_pw === 1,
  };
}

async function resolveAuthUser(env: Env, request: Request): Promise<SessionUser | null> {
  if (!env.TOUR_DB) return null;
  // 双模式互斥（统一认证迁移步骤②）：配了 OIDC_ISSUER 就只认认证中心会话，
  // 不再回落共享 KV——两种登录态并存会让「登出」语义说不清
  const userId = env.OIDC_ISSUER
    ? await resolveOidcUserId(env, request)
    : await resolveKvUserId(env, request);
  if (userId === null) return null;
  return loadTourUser(env, userId);
}

// 鉴权按请求记忆化（WeakMap 挂 Request，随请求回收）：同一请求里多次鉴权
// 不重复付出 KV get + D1 user 点查（§17.3-5 公开路径省往返的同族手法）。
const authMemo = new WeakMap<Request, Promise<SessionUser | null>>();

export function getAuthUser(env: Env, request: Request): Promise<SessionUser | null> {
  const memo = authMemo.get(request);
  if (memo) return memo;
  const resolved = resolveAuthUser(env, request).catch(() => null);
  authMemo.set(request, resolved);
  return resolved;
}

// must_change_pw=1（被管理员重置过密码）：/api/me 照常返回此人便于前端提示，
// 业务接口一律 403 引导改密——平台自身没有改密页（§3.1-3）；改密地点随模式指路。
export async function requireUser(env: Env, request: Request): Promise<SessionUser> {
  const user = await getAuthUser(env, request);
  if (!user) throw new HttpError(401, '未登录');
  if (user.mustChangePw) {
    const where = env.OIDC_ISSUER ? '认证中心' : '赛事系统';
    throw new HttpError(403, `密码刚被重置，请先到${where}设置新密码`, 'password_change_required');
  }
  return user;
}

export async function requireCoach(env: Env, request: Request): Promise<SessionUser> {
  const user = await requireUser(env, request);
  if (user.role !== 'admin' && user.role !== 'coach') {
    throw new HttpError(403, '没有权限进行此操作');
  }
  return user;
}

export async function requireAdmin(env: Env, request: Request): Promise<SessionUser> {
  const user = await requireUser(env, request);
  if (user.role !== 'admin') throw new HttpError(403, '没有权限进行此操作');
  return user;
}
