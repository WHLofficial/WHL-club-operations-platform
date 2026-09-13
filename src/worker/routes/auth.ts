// 统一认证接入（迁移步骤②③收口，auth 项目 PRD P0-5 / TECH_DESIGN §6.3）：OIDC RP 四端点。
// 配置 OIDC_ISSUER + OIDC_CLIENT_ID 即切换 OIDC 模式；未配置 = 兼容模式，
// /auth/login 退化为跳赛事系统（旧入口不变），回调/登出通知端点一律 404。
// 流程：authorize（PKCE S256，scope openid profile）→ 回调验签 + 拉 userinfo 验形，
// claims（姓名/锁定/待改密/角色/权限）存进本地会话行 → 登出先吊销本地行再跳认证中心
// end_session → back-channel 按 sid 吊销。会话解析只读 claims（lib/session.ts），
// 不查 TOUR_DB user 表——账号真源在 auth 库，收口后新账号在赛事库无行。
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { sha256Hex } from '../../lib/crypto.ts';
import { parseOidcClaims } from '../../lib/session.ts';
import {
  BACKCHANNEL_LOGOUT_EVENT,
  OIDC_SESSION_COOKIE,
  OIDC_TEMP_COOKIE,
  SESSION_TTL_SECONDS,
  b64urlDecode,
  b64urlEncode,
  jwksFor,
  pkceChallenge,
  randomB64url,
  timingSafeEq,
} from '../../lib/oidc.ts';

const authRoutes = new Hono<{ Bindings: Env }>();

// 兼容模式下的旧入口：与 TopBar 的「去赛事系统登录」同一去处
const TOUR_HOME = 'https://whleague.win/';

type OidcEnv = Env & { OIDC_ISSUER: string; OIDC_CLIENT_ID: string };

function isOidcMode(env: Env): env is OidcEnv {
  return Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID);
}

// 回跳地址跟随当前请求源（本地 8795 / 线上 club.whleague.win 皆成立），
// 必须与 auth 侧 app 表 redirect_uris 白名单逐字一致
function callbackUri(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin + '/api/auth/callback';
}

// ---------- 发起登录 ----------

authRoutes.get('/auth/login', async (c) => {
  if (!isOidcMode(c.env)) return c.redirect(TOUR_HOME, 302);
  const state = randomB64url(16);
  const nonce = randomB64url(16);
  const verifier = randomB64url(32);
  // state/nonce/verifier 中转 10 分钟（防 CSRF 用 state，防重放用 nonce，防截码用 PKCE）
  setCookie(c, OIDC_TEMP_COOKIE, b64urlEncode(JSON.stringify({ state, nonce, verifier })), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
    secure: true, // __Host- 前缀强制；本地 127.0.0.1 属可信源
  });
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.env.OIDC_CLIENT_ID,
    redirect_uri: callbackUri(c),
    scope: 'openid profile', // profile 换姓名——claims 存档后本地不再有任何用户表现查
    state,
    nonce,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return c.redirect(`${c.env.OIDC_ISSUER}/authorize?${q}`, 302);
});

// ---------- 回调建会话 ----------

type TempState = { state: string; nonce: string; verifier: string };

function parseTemp(raw: string): TempState | null {
  try {
    const t: unknown = JSON.parse(b64urlDecode(raw));
    if (
      typeof t !== 'object' ||
      t === null ||
      typeof (t as TempState).state !== 'string' ||
      typeof (t as TempState).nonce !== 'string' ||
      typeof (t as TempState).verifier !== 'string'
    ) {
      return null;
    }
    return t as TempState;
  } catch {
    return null;
  }
}

authRoutes.get('/auth/callback', async (c) => {
  if (!isOidcMode(c.env)) throw new HttpError(404, '接口不存在');
  const { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId } = c.env;

  // RFC 9207：auth 回跳带 iss，先核对响应来自配的这个认证中心
  const iss = c.req.query('iss');
  if (iss !== undefined && iss !== issuer) {
    throw new HttpError(400, '登录响应来源不对，请重新登录', 'oidc_iss_mismatch');
  }

  const tempRaw = getCookie(c, OIDC_TEMP_COOKIE);
  const temp = tempRaw ? parseTemp(tempRaw) : null;
  if (!temp || !timingSafeEq(c.req.query('state') ?? '', temp.state)) {
    throw new HttpError(400, '登录状态已失效，请重新登录', 'oidc_state_invalid');
  }

  const code = c.req.query('code');
  if (!code) throw new HttpError(400, '登录被取消或未完成，请重试', 'oidc_no_code');

  // code 换票（公开 client，无 secret，凭 PKCE 自证）；非 200 一律 502，不向用户区分细节。
  // access_token 与 id_token 同为必需——前者供 userinfo 拉取
  const tokenRes = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUri(c),
      client_id: clientId,
      code_verifier: temp.verifier,
    }),
  });
  const tokens = tokenRes.ok
    ? ((await tokenRes.json().catch(() => null)) as { id_token?: unknown; access_token?: unknown } | null)
    : null;
  if (!tokens || typeof tokens.id_token !== 'string' || typeof tokens.access_token !== 'string') {
    throw new HttpError(502, '认证中心换票失败，请稍后重试', 'oidc_token_error');
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(tokens.id_token, jwksFor(issuer), {
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
    }));
  } catch {
    throw new HttpError(502, '登录凭证校验失败，请重新登录', 'oidc_verify_error');
  }
  if (!timingSafeEq(typeof payload.nonce === 'string' ? payload.nonce : '', temp.nonce)) {
    throw new HttpError(502, '登录凭证校验失败，请重新登录', 'oidc_verify_error');
  }
  // sub 必须是数字串（步骤③收口后即 auth 账号 id）；sid 供登出联动
  if (
    typeof payload.sub !== 'string' ||
    !/^\d+$/.test(payload.sub) ||
    typeof payload.sid !== 'string' ||
    !payload.sid
  ) {
    throw new HttpError(502, '登录凭证不完整，请重新登录', 'oidc_claim_error');
  }

  // 拉 userinfo 存 claims（收口 §6.3）：会话解析只信这份存档，本地不再查 TOUR_DB user 表。
  // 失败/缺字段一律 502 不建会话——宁可暂时登不上，也不能认错人
  const uiRes = await fetch(`${issuer}/userinfo`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const info = uiRes.ok ? ((await uiRes.json().catch(() => null)) as unknown) : null;
  const claims = parseOidcClaims(info);
  if (!claims) {
    throw new HttpError(502, '认证中心用户信息拉取失败，请重新登录', 'oidc_userinfo_error');
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare('DELETE FROM oidc_session WHERE expires_at < ?').bind(now).run();
  const token = randomB64url(32);
  await c.env.DB.prepare(
    'INSERT INTO oidc_session (token_hash, sub, auth_sid, claims, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      await sha256Hex(token),
      payload.sub,
      payload.sid,
      JSON.stringify(claims),
      now,
      new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    )
    .run();

  setCookie(c, OIDC_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure: true, // __Host- 前缀强制；本地 127.0.0.1 属可信源
  });
  deleteCookie(c, OIDC_TEMP_COOKIE, { path: '/', secure: true });
  return c.redirect('/', 302);
});

// ---------- 登出：先吊销本地行，浏览器再跳认证中心 end_session ----------

authRoutes.post('/auth/logout', async (c) => {
  const token = getCookie(c, OIDC_SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('UPDATE oidc_session SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), await sha256Hex(token))
      .run();
  }
  deleteCookie(c, OIDC_SESSION_COOKIE, { path: '/', secure: true });
  deleteCookie(c, OIDC_TEMP_COOKIE, { path: '/', secure: true });
  if (!isOidcMode(c.env)) return c.redirect(TOUR_HOME, 302);
  // 认证中心吊销自身会话后向各接入方推 back-channel（club 本地行已先吊销，幂等）
  const target = `${c.env.OIDC_ISSUER}/logout?post_logout_redirect_uri=${encodeURIComponent(new URL(c.req.url).origin + '/')}`;
  return c.redirect(target, 302);
});

// ---------- back-channel 登出通知（认证中心服务器间直呼，无 cookie） ----------

authRoutes.post('/auth/backchannel-logout', async (c) => {
  if (!isOidcMode(c.env)) throw new HttpError(404, '接口不存在');
  const form = await c.req.formData().catch(() => null);
  const token = form?.get('logout_token');
  if (typeof token !== 'string' || !token) throw new HttpError(400, '需要 logout_token');

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwksFor(c.env.OIDC_ISSUER), {
      issuer: c.env.OIDC_ISSUER,
      audience: c.env.OIDC_CLIENT_ID,
      algorithms: ['RS256'],
    }));
  } catch {
    throw new HttpError(400, 'logout_token 校验失败');
  }
  const events = payload.events;
  if (typeof events !== 'object' || events === null || !(BACKCHANNEL_LOGOUT_EVENT in events)) {
    throw new HttpError(400, 'logout_token 缺少登出事件');
  }
  if (payload.nonce !== undefined) throw new HttpError(400, 'logout_token 不应携带 nonce');
  if (typeof payload.sid !== 'string' || !payload.sid) throw new HttpError(400, 'logout_token 缺少 sid');

  await c.env.DB.prepare('UPDATE oidc_session SET revoked_at = ? WHERE auth_sid = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), payload.sid)
    .run();
  // 规范要求：成功回 200 空体（未知 sid 也算成功），失败回 400
  return c.body(null, 200);
});

export default authRoutes;
