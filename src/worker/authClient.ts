// 认证中心机器通道（v1.0.0 球队绑定上收）：绑定真源在 auth 库（team/team_bind_code/team_binding），
// 平台经只读 AUTH_DB 派生读（binding.ts），经这里写（发码/烧码/解绑）。
// HMAC 契约与 auth machine.ts / tour 仓 authClient.ts 逐字一致：X-Sign = hex(HMAC-SHA256(secret, "POST|path|ts|raw"))，
// X-Timestamp 秒级 ±300s。基地址复用 OIDC_ISSUER（同一台认证中心）；密钥 AUTH_BIND_SECRET 与 auth BIND_SECRET 同值。
import type { Env } from './env.ts';

export class AuthApiError extends Error {
  /** auth 端业务错误码：invalid_code / already_bound / not_bound / team_not_found / … */
  code: string;
  // 写成显式字段赋值而不是 TS 参数属性：参数属性是唯一一种「需要代码生成」的 TS 语法，
  // Node 的类型剥离不支持它（ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX）⇒ 凡 import 本文件的路由模块
  // 都无法在 Node 里加载，读量普查脚本（scripts/measure-surface-reads.mjs）就抓不到它们的 SQL。
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type MachineBody = Record<string, unknown>;

async function machineCall(env: Env, path: string, body: MachineBody): Promise<Record<string, unknown>> {
  const secret = env.AUTH_BIND_SECRET ?? '';
  const base = env.OIDC_ISSUER ?? '';
  if (!secret || !base) throw new AuthApiError('unconfigured', '认证中心通道未配置（OIDC_ISSUER / AUTH_BIND_SECRET）');
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`POST|${path}|${ts}|${raw}`));
  const sign = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': String(ts), 'x-sign': sign },
      body: raw,
    });
  } catch {
    throw new AuthApiError('auth_unreachable', '认证中心不可达');
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new AuthApiError('auth_bad_response', '认证中心响应不是 JSON');
  }
  if (!res.ok) {
    throw new AuthApiError(
      typeof parsed.error === 'string' ? parsed.error : `http_${res.status}`,
      typeof parsed.message === 'string' ? parsed.message : '认证中心拒绝请求',
    );
  }
  return parsed;
}

// 管理端发码（routes/admin/clubs.ts /clubs/:id/bindcode）：按 club_id 解析目录行；明码只在本次响应出现
export async function authIssueTeamCode(
  env: Env,
  { clubId, hours }: { clubId: number; hours: number },
): Promise<{ code: string; expiresAt: string }> {
  const out = await machineCall(env, '/api/team/bindcode', { club_id: clubId, via: 'club', ttl_hours: hours });
  if (typeof out.code !== 'string' || typeof out.expires_at !== 'string') {
    throw new AuthApiError('auth_bad_response', '发码响应缺少 code/expires_at');
  }
  return { code: out.code, expiresAt: out.expires_at };
}

// 教练烧码（clubs.ts /clubs/bind）：写 auth team_binding（一账号一队由 auth 挡并发）
export async function authBindTeam(env: Env, { code, accountId }: { code: string; accountId: number }): Promise<{ teamId: number }> {
  const out = await machineCall(env, '/api/team/bind', { code, account_id: accountId, via: 'club' });
  const teamId = Number(out.teamId);
  if (!Number.isInteger(teamId)) throw new AuthApiError('auth_bad_response', '烧码响应缺少 teamId');
  return { teamId };
}

// 管理端解绑（routes/admin/clubs.ts /bindings/unbind）
export async function authUnbindTeam(env: Env, accountId: number): Promise<void> {
  await machineCall(env, '/api/team/unbind', { account_id: accountId });
}

// 管理端建队自动建档（v2.3.0）：auth team 目录 upsert（ON CONFLICT(tour_team_id) 幂等），
// 同步带上 club_id 关联；失败可重试（目录行已建时重复调用只更新 name/club_id）
export async function authRegisterTeam(
  env: Env,
  { tourTeamId, name, clubId }: { tourTeamId: number; name: string; clubId: number },
): Promise<number> {
  const out = await machineCall(env, '/api/team/register', { tour_team_id: tourTeamId, name, club_id: clubId });
  const teamId = Number(out.teamId);
  if (!Number.isInteger(teamId)) throw new AuthApiError('auth_bad_response', '登记响应缺少 teamId');
  return teamId;
}
