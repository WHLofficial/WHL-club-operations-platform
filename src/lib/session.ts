// 共享登录透传（TECH_DESIGN §3.1，照抄竞猜系统范式）：
// 会话真源在比赛系统 —— cookie whl_session → 共享 KV sess:{token} → TOUR_DB user 表。
// 平台不种 cookie、不设注册/登录页、不建本地 users 表（§4 数据边界：平台不写 user 表）。
import type { Env } from '../worker/env.ts';
import { HttpError } from './http.ts';

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

async function resolveAuthUser(env: Env, request: Request): Promise<SessionUser | null> {
  if (!env.SESSION_KV || !env.TOUR_DB) return null;
  const token = getCookie(request, TOUR_COOKIE);
  if (!token) return null;
  const raw = await env.SESSION_KV.get(`sess:${token}`);
  if (!raw) return null;
  let userId: number;
  try {
    userId = JSON.parse(raw).userId;
  } catch {
    return null;
  }
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
// 业务接口一律 403 引导回赛事系统改密——平台自身没有改密页（§3.1-3）。
export async function requireUser(env: Env, request: Request): Promise<SessionUser> {
  const user = await getAuthUser(env, request);
  if (!user) throw new HttpError(401, '未登录');
  if (user.mustChangePw) {
    throw new HttpError(403, '密码刚被重置，请先到赛事系统设置新密码', 'password_change_required');
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
