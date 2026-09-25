// 登录透传与本地会话：
// 兼容模式（TECH_DESIGN §3.1，照抄竞猜系统范式）：会话真源在比赛系统——
// cookie whl_session → 共享 KV sess:{token} → TOUR_DB user 表；平台不种 cookie。
// OIDC 模式 + 步骤③收口（auth 项目 P0-10，TECH_DESIGN §6.3）：认证中心会话 + claims 存档——
// cookie club_session → oidc_session 表（token 哈希 + claims）→ 姓名/状态/角色/权限全部
// 来自登录回调存档的 claims，不再查 TOUR_DB user 表（账号真源在 auth 库，收口后新账号在
// 赛事库无行）。claims 缺失/损坏的旧会话视为未登录，重新走一次 OIDC 登录即恢复。
import type { Env } from '../worker/env.ts';
import { hasTeamBinding } from '../worker/binding.ts';
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
  /** 步骤③：OIDC 模式 = userinfo 下发的权限点（§6.3 按 aud 过滤）；兼容模式 = []（判定回落角色） */
  permissions: string[];
}

// ---- 权限点目录（auth migrations/0002 播种，TECH_DESIGN §6.1） ----
// 管理组六点与旧 admin 角色持有人完全重合；教练两点与旧 coach 角色重合。
const ADMIN_PERMS = [
  'club.clubs.manage',
  'club.bindings.unbind',
  'club.players.import',
  'club.ledger.manage',
  'club.registrations.manage',
  'club.compliance.view',
] as const;
const COACH_PERMS = ['club.squad.manage', 'club.registrations.submit'] as const;
// 超管独立权限点（v2.1.0）：不进 ADMIN_PERMS any 判定集——普通管理组六点不附带，
// 只有认证中心 superadmin 角色（OIDC）或赛事库 superadmin 角色（兼容）才持有。
export const SUPER_ADMIN_PERM = 'club.config.manage.super';

// OIDC 模式 = AUTH_MODE 显式配 "oidc"（v1.2.0 显式化）+ 两项连接变量齐备；未配 AUTH_MODE =
// 兼容模式。不再靠 OIDC_ISSUER 的有无隐式判定——vars 随 wrangler.jsonc 一起部署，
// 杜绝「忘配/半配悄悄改行为」。
export function isOidc(env: Env): env is Env & { AUTH_MODE: string; OIDC_ISSUER: string; OIDC_CLIENT_ID: string } {
  return Boolean(env.AUTH_MODE === 'oidc' && env.OIDC_ISSUER && env.OIDC_CLIENT_ID);
}

// 角色沿用比赛系统：admin/superadmin→管理组（不受 locked 影响，防管理端被锁），
// coach→教练；locked=1 是「未解锁绑队」的观众号（不是封禁），放行只读（§3.1-4）。
// 仅兼容模式使用（KV 会话 + TOUR_DB 现查）；OIDC 会话的 role 走 roleFromClaims 投影。
export function mapRole(tour: { role: string; locked: number }): Role {
  if (tour.role === 'admin' || tour.role === 'superadmin') return 'admin';
  if (tour.locked === 1) return 'viewer';
  if (tour.role === 'coach') return 'coach';
  return 'viewer';
}

// ---- 步骤③收口：userinfo / 会话内 claims 的统一校验 ----
// accept 对象（回调刚拉到的 userinfo）或 JSON 串（oidc_session.claims 列）。
export type OidcClaims = {
  name: string;
  locked: boolean;
  must_change_pw: boolean;
  roles: string[];
  permissions: string[];
};

export function parseOidcClaims(raw: unknown): OidcClaims | null {
  let t = raw;
  if (typeof t === 'string') {
    try {
      t = JSON.parse(t);
    } catch {
      return null;
    }
  }
  if (typeof t !== 'object' || t === null) return null;
  const c = t as Partial<OidcClaims>;
  if (
    typeof c.name !== 'string' ||
    !c.name ||
    typeof c.locked !== 'boolean' ||
    typeof c.must_change_pw !== 'boolean' ||
    !Array.isArray(c.roles) ||
    !c.roles.every((r) => typeof r === 'string') ||
    !Array.isArray(c.permissions) ||
    !c.permissions.every((p) => typeof p === 'string')
  ) {
    return null;
  }
  return { name: c.name, locked: c.locked, must_change_pw: c.must_change_pw, roles: c.roles, permissions: c.permissions };
}

// claims → role 投影（与 mapRole 行为等价，仅供页面展示；接口判定一律走 permissions）：
// 管理权限点/全局超管 → admin；locked 观众号 → viewer；教练权限点 → coach。
function roleFromClaims(claims: OidcClaims): Role {
  if (claims.roles.includes('superadmin') || claims.roles.includes('club.admin')) return 'admin';
  if (claims.locked) return 'viewer';
  if (claims.roles.includes('club.coach')) return 'coach';
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

/** stale 会话判定（OIDC 模式）：会话 cookie 在、oidc_session 行已不在
 *  （back-channel 登出撤行 / 过期）——cookie 该清了，别让浏览器再白带 7 天 */
export async function isStaleOidcSession(env: Env, request: Request): Promise<boolean> {
  if (!isOidc(env)) return false;
  const token = getCookie(request, OIDC_SESSION_COOKIE);
  if (!token) return false;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM oidc_session WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first();
  return !row;
}

async function resolveOidcUser(env: Env, request: Request): Promise<SessionUser | null> {
  const token = getCookie(request, OIDC_SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT sub, claims FROM oidc_session WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<{ sub: string; claims: string | null }>();
  if (!row) return null;
  const claims = parseOidcClaims(row.claims);
  if (!claims) return null;
  const userId = Number(row.sub);
  if (!Number.isInteger(userId)) return null;
  return {
    id: userId,
    name: claims.name,
    role: roleFromClaims(claims),
    locked: claims.locked,
    mustChangePw: claims.must_change_pw,
    permissions: claims.roles.includes('superadmin') ? [...claims.permissions, SUPER_ADMIN_PERM] : claims.permissions,
  };
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
    permissions: tour.role === 'superadmin' ? [SUPER_ADMIN_PERM] : [], // 兼容模式无权限点声明，判定回落角色；超管按角色附点
  };
}

async function resolveAuthUser(env: Env, request: Request): Promise<SessionUser | null> {
  // 双模式互斥（统一认证迁移步骤②③）：OIDC 模式只认认证中心会话（claims 存档，
  // 不查 TOUR_DB）；兼容模式走共享 KV + TOUR_DB 现查——两种登录态并存会让「登出」语义说不清
  if (isOidc(env)) return resolveOidcUser(env, request);
  if (!env.TOUR_DB) return null;
  const userId = await resolveKvUserId(env, request);
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
    const where = isOidc(env) ? '认证中心' : '赛事系统';
    throw new HttpError(403, `密码刚被重置，请先到${where}设置新密码`, 'password_change_required');
  }
  return user;
}

// 步骤③判定口径：OIDC 模式按权限点（§6.3），兼容模式回落旧角色判定——行为逐点等价。
// locked 观众号旧模式投影为 viewer 被角色挡住；收口后权限点注册即发（club.coach），
// 判定前必须显式清空才等价（管理组不受 locked 影响，与 mapRole 口径一致）。
// 教练侧端点（perm 给定时）：持有该权限点或任一管理权限点（旧 requireCoach = admin OR coach，
// 管理组不受限的行为保留）；不给定时任一管理/教练权限点。
export async function requireCoach(env: Env, request: Request, perm?: (typeof COACH_PERMS)[number]): Promise<SessionUser> {
  const user = await requireUser(env, request);
  if (isOidc(env)) {
    // 教练判定（v1.0.0）：auth 对所有新账号自动发 club.coach，权限点无区分度，
    // 改以认证中心绑定为准——绑定了球队即教练；权限点保留为旁路，让未绑定的
    // 准教练也能进 /clubs/bind 这类绑前端点。管理点照旧先行。
    const perms = user.locked ? [] : user.permissions;
    if (ADMIN_PERMS.some((p) => perms.includes(p))) return user;
    const bound = !user.locked && (await hasTeamBinding(env, user.id));
    const ok = perm
      ? perms.includes(perm) || bound
      : COACH_PERMS.some((p) => perms.includes(p)) || bound;
    if (!ok) throw new HttpError(403, '没有权限进行此操作');
    return user;
  }
  if (user.role !== 'admin' && user.role !== 'coach') {
    throw new HttpError(403, '没有权限进行此操作');
  }
  return user;
}

// 管理端点（perm 给定时按语义权限点，不给定时任一管理权限点——六点持有人与旧 admin 重合）
export async function requireAdmin(env: Env, request: Request, perm?: (typeof ADMIN_PERMS)[number]): Promise<SessionUser> {
  const user = await requireUser(env, request);
  if (isOidc(env)) {
    const ok = perm ? user.permissions.includes(perm) : ADMIN_PERMS.some((p) => user.permissions.includes(p));
    if (!ok) throw new HttpError(403, '没有权限进行此操作');
    return user;
  }
  if (user.role !== 'admin') throw new HttpError(403, '没有权限进行此操作');
  return user;
}

// 超管端点（平台参数全开，v2.1.0）：两模式统一按 permissions 判定——
// 两种登录路径各自在会话解析时把 superadmin 角色投影成 SUPER_ADMIN_PERM
export async function requireSuperAdmin(env: Env, request: Request): Promise<SessionUser> {
  const user = await requireUser(env, request);
  if (!user.permissions.includes(SUPER_ADMIN_PERM)) throw new HttpError(403, '没有权限进行此操作');
  return user;
}
