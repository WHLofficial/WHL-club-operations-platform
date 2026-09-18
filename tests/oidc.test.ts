// 统一认证接入测试（迁移步骤②③收口，auth 项目 PRD P0-5 / TECH_DESIGN §6.3）：
// in-process 伪认证服务器——stub 全局 fetch 提供 jwks/token/userinfo 三端点，用 jose 现签
// id_token / logout_token（独立密钥对，challenge/verifier 哈希用 node:crypto 独立实现），
// 驱动 RP 全流程：发起登录 → 回调验签拉 userinfo 存 claims → 判定点按权限点正反例
// → 登出吊销 → back-channel 通知 → 收口探针（tour user 表删光端点照常）；
// 兼容模式（未配 OIDC_*）回归旧行为。
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { BACKCHANNEL_LOGOUT_EVENT, b64urlDecode } from '../src/lib/oidc.ts';

const ISSUER = 'https://auth.example';
const CLIENT_ID = 'club';
const nowSec = () => Math.floor(Date.now() / 1000);

// ---- 密钥与令牌（独立于 club 代码的验签材料） ----

interface KeyMaterial {
  privateKey: CryptoKey;
  jwk: { kid: string; kty: string; n: string; e: string };
}

let signing: KeyMaterial;
let rogue: KeyMaterial;

beforeAll(async () => {
  const make = async (kid: string): Promise<KeyMaterial> => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = (await exportJWK(publicKey)) as { kty: string; n: string; e: string };
    return { privateKey, jwk: { ...jwk, kid } };
  };
  signing = await make('test-key-1');
  rogue = await make('rogue-key');
});

function mint(key: KeyMaterial, claims: JWTPayload): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: key.jwk.kid }).sign(key.privateKey);
}

// ---- 伪认证服务器：stub 全局 fetch，只服务 /jwks.json 与 /token ----

interface StubState {
  code: string;
  challenge: string;
  nonce: string;
  sub: string;
  sid: string;
  idToken?: string; // 覆盖默认现签（伪造签名 / nonce 不符用）
  tokenStatus?: number; // 强制换票失败
  tokenCalls: URLSearchParams[];
  userinfoStatus?: number; // 强制 userinfo 拉取失败
  userinfo?: unknown; // 覆盖默认 userinfo 载荷（缺字段负例用）
}

// 收口后的 userinfo 形状（auth 侧按 aud 下发，TECH_DESIGN §6.3）：
// sub 1=管理组甲（club.admin 六管理点）、2=教练乙（club.coach 两教练点）、
// 3=丙丙 locked 观众号（注册即发教练点，靠 locked 在判定前清空——与旧 viewer 行为等价）
const USERINFO_BY_SUB: Record<string, Record<string, unknown>> = {
  '1': {
    sub: '1',
    name: '管理组甲',
    locked: false,
    must_change_pw: false,
    roles: ['club.admin'],
    permissions: [
      'club.clubs.manage',
      'club.bindings.unbind',
      'club.players.import',
      'club.ledger.manage',
      'club.registrations.manage',
      'club.compliance.view',
    ],
  },
  '2': {
    sub: '2',
    name: '教练乙',
    locked: false,
    must_change_pw: false,
    roles: ['club.coach'],
    permissions: ['club.squad.manage', 'club.registrations.submit'],
  },
  '3': {
    sub: '3',
    name: '丙丙',
    locked: true,
    must_change_pw: false,
    roles: ['club.coach'],
    permissions: ['club.squad.manage', 'club.registrations.submit'],
  },
};

let stub: StubState;

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof URL ? input : new URL(String(input));
  if (url.pathname.endsWith('/jwks.json')) {
    return new Response(JSON.stringify({ keys: [signing.jwk] }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.pathname.endsWith('/userinfo')) {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (!/^Bearer\s+fake-at$/i.test(headers.authorization ?? '')) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
    }
    if (stub.userinfoStatus) {
      return new Response(JSON.stringify({ error: 'server_error' }), { status: stub.userinfoStatus });
    }
    const payload = stub.userinfo ?? USERINFO_BY_SUB[stub.sub];
    if (!payload) return new Response(JSON.stringify({ error: 'no user' }), { status: 401 });
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname.endsWith('/token')) {
    const form = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ''));
    stub.tokenCalls.push(form);
    if (stub.tokenStatus) {
      return new Response(JSON.stringify({ error: 'server_error' }), { status: stub.tokenStatus });
    }
    const ok =
      form.get('grant_type') === 'authorization_code' &&
      form.get('code') === stub.code &&
      form.get('client_id') === CLIENT_ID &&
      form.get('redirect_uri') === 'http://localhost/api/auth/callback' &&
      createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === stub.challenge;
    if (!ok) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    const idToken =
      stub.idToken ??
      (await mint(signing, {
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: stub.sub,
        sid: stub.sid,
        nonce: stub.nonce,
        iat: nowSec(),
        exp: nowSec() + 600,
      }));
    return new Response(
      JSON.stringify({
        access_token: 'fake-at',
        token_type: 'Bearer',
        expires_in: 1800,
        refresh_token: 'fake-rt',
        scope: 'openid profile',
        id_token: idToken,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response('not found', { status: 404 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- 测试环境（tour 用户夹具照抄 routes.test.ts；kv 只种一条旧共享会话验证模式互斥） ----

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
}

function freshEnv(oidc: boolean): Fixture {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (3, '丙丙', 'user', 1, 0);`,
  );
  const kv = new Map<string, string>([['sess:tok-legacy', JSON.stringify({ userId: 2 })]]);
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    ...(oidc ? { AUTH_MODE: 'oidc', OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT_ID } : {}),
  };
  return { env, sqlite, tour };
}

function cookieOf(res: Response, name: string): string | undefined {
  for (const line of res.headers.getSetCookie()) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

/** 完整登录：发起 → 伪 auth 发码 → 回调。返回回调响应与会话 cookie。 */
async function oidcLogin(env: Env, opts?: { sub?: string; sid?: string }) {
  const login = await app.request('/api/auth/login', { method: 'GET' }, env);
  expect(login.status).toBe(302);
  const authUrl = new URL(login.headers.get('Location')!);
  const temp = cookieOf(login, '__Host-club_oidc');
  expect(temp).toBeTruthy();
  stub = {
    code: 'CODE-1',
    challenge: authUrl.searchParams.get('code_challenge')!,
    nonce: authUrl.searchParams.get('nonce')!,
    sub: opts?.sub ?? '2',
    sid: opts?.sid ?? 'sid-1',
    tokenCalls: [],
  };
  const cb = await app.request(
    `/api/auth/callback?code=${stub.code}&state=${authUrl.searchParams.get('state')}&iss=${encodeURIComponent(ISSUER)}`,
    { method: 'GET', headers: { Cookie: `__Host-club_oidc=${temp}` } },
    env,
  );
  return { login, authUrl, cb, session: cookieOf(cb, '__Host-club_session') };
}

describe('统一认证接入（步骤② OIDC RP）', () => {
  it('兼容模式：login/logout 跳赛事系统，回调与通知端点 404，/api/me authMode=shared', async () => {
    const { env } = freshEnv(false);
    const login = await app.request('/api/auth/login', { method: 'GET' }, env);
    expect(login.status).toBe(302);
    expect(login.headers.get('Location')).toBe('https://whleague.win/');

    const cb = await app.request('/api/auth/callback?code=x&state=y', { method: 'GET' }, env);
    expect(cb.status).toBe(404);
    const bcl = await app.request('/api/auth/backchannel-logout', { method: 'POST' }, env);
    expect(bcl.status).toBe(404);

    const logout = await app.request('/api/auth/logout', { method: 'POST' }, env);
    expect(logout.status).toBe(302);
    expect(logout.headers.get('Location')).toBe('https://whleague.win/');

    const me = await app.request('/api/me', { method: 'GET' }, env);
    expect(await me.json()).toEqual({ user: null, authMode: 'shared', authHome: null });
  });

  it('发起登录：302 到 authorize，scope=openid + PKCE S256 + 临时 cookie', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env } = freshEnv(true);
    const login = await app.request('/api/auth/login', { method: 'GET' }, env);
    expect(login.status).toBe(302);
    const u = new URL(login.headers.get('Location')!);
    expect(`${u.protocol}//${u.host}${u.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/callback');
    expect(u.searchParams.get('scope')).toBe('openid profile');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    // S256 challenge 恒 43 位 base64url（auth 侧逐字校验这个形态）
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.has('nonce')).toBe(true);
    expect(u.searchParams.has('state')).toBe(true);
    const sc = login.headers.getSetCookie().find((l) => l.startsWith('__Host-club_oidc='));
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(sc).toContain('Max-Age=600');
    expect(sc).toContain('Path=/');
    expect(sc).toContain('Secure'); // __Host- 前缀强制
  });

  it('回调建会话：换票验签入库，/api/me 认出人（authMode=oidc），旧 whl_session 被无视', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env, sqlite } = freshEnv(true);
    const { cb, session } = await oidcLogin(env);

    expect(cb.status).toBe(302);
    expect(new URL(cb.headers.get('Location')!, 'http://localhost').pathname).toBe('/');
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // 临时 cookie 已删（空值过期），会话 cookie 属性齐全
    const deleted = cb.headers.getSetCookie().find((l) => l.startsWith('__Host-club_oidc='));
    expect(deleted).toMatch(/^__Host-club_oidc=;/);
    const sc = cb.headers.getSetCookie().find((l) => l.startsWith('__Host-club_session='));
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(sc).toContain('Max-Age=604800');
    expect(sc).toContain('Secure');

    // 会话行：token_hash 是会话 cookie 的 sha256（独立实现核对），sub/sid 来自 id_token，
    // claims 为回调拉取并规整存档的 userinfo（parseOidcClaims 只留五个字段，sub 落在行上）
    const { sub: _sub, ...coachClaims } = USERINFO_BY_SUB['2'];
    const row = sqlGet<{ token_hash: string; sub: string; auth_sid: string; claims: string; revoked_at: null }>(
      sqlite,
      'SELECT token_hash, sub, auth_sid, claims, revoked_at FROM oidc_session',
    );
    expect(row).toEqual({
      token_hash: createHash('sha256').update(session!).digest('hex'),
      sub: '2',
      auth_sid: 'sid-1',
      claims: JSON.stringify(coachClaims),
      revoked_at: null,
    });

    // /api/me 用会话 cookie 认人（只读 claims 存档，不再查 tour 库）
    const me = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: {
        id: 2,
        name: '教练乙',
        role: 'coach',
        locked: false,
        mustChangePw: false,
        permissions: ['club.squad.manage', 'club.registrations.submit'],
      },
      authMode: 'oidc',
      authHome: ISSUER,
    });

    // 模式互斥：OIDC 模式下旧的共享会话 cookie 不再生效
    const legacy = await app.request('/api/me', { method: 'GET', headers: { Cookie: 'whl_session=tok-legacy' } }, env);
    expect(((await legacy.json()) as { user: unknown }).user).toBeNull();
  });

  it('回调异常路径：state/临时 cookie/iss → 400；换票/验签/nonce/PKCE → 502', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env } = freshEnv(true);
    const login = await app.request('/api/auth/login', { method: 'GET' }, env);
    const authUrl = new URL(login.headers.get('Location')!);
    const temp = cookieOf(login, '__Host-club_oidc')!;
    const state = authUrl.searchParams.get('state')!;

    const bad = (query: string, cookie?: string) =>
      app.request(
        `/api/auth/callback?${query}`,
        { method: 'GET', headers: cookie ? { Cookie: `__Host-club_oidc=${cookie}` } : {} },
        env,
      );

    // state 不符（CSRF 防线）、临时 cookie 丢失、iss 与配置的认证中心不一致（RFC 9207 自查）
    expect((await bad(`code=C&state=other&iss=${encodeURIComponent(ISSUER)}`, temp)).status).toBe(400);
    expect((await bad(`code=C&state=${state}&iss=${encodeURIComponent(ISSUER)}`)).status).toBe(400);
    expect((await bad(`code=C&state=${state}&iss=https://evil.example`, temp)).status).toBe(400);

    // 换票失败（伪 auth 500）→ 502
    stub = {
      code: 'CODE-2',
      challenge: authUrl.searchParams.get('code_challenge')!,
      nonce: authUrl.searchParams.get('nonce')!,
      sub: '2',
      sid: 'sid-1',
      tokenStatus: 500,
      tokenCalls: [],
    };
    expect((await bad(`code=CODE-2&state=${state}&iss=${encodeURIComponent(ISSUER)}`, temp)).status).toBe(502);

    // 签名不对（rogue 密钥、kid 冒用）→ 502
    stub = {
      ...stub,
      tokenStatus: undefined,
      idToken: await mint(rogue, { iss: ISSUER, aud: CLIENT_ID, sub: '2', sid: 'sid-1', nonce: stub.nonce, iat: nowSec(), exp: nowSec() + 600 }),
    };
    expect((await bad(`code=CODE-2&state=${state}&iss=${encodeURIComponent(ISSUER)}`, temp)).status).toBe(502);

    // nonce 不符（防重放）→ 502
    stub = {
      ...stub,
      idToken: await mint(signing, { iss: ISSUER, aud: CLIENT_ID, sub: '2', sid: 'sid-1', nonce: 'other-nonce', iat: nowSec(), exp: nowSec() + 600 }),
    };
    expect((await bad(`code=CODE-2&state=${state}&iss=${encodeURIComponent(ISSUER)}`, temp)).status).toBe(502);

    // sub 不是数字串（必须是 auth 账号 id）→ 502
    stub = {
      ...stub,
      idToken: await mint(signing, { iss: ISSUER, aud: CLIENT_ID, sub: 'not-a-number', sid: 'sid-1', nonce: stub.nonce, iat: nowSec(), exp: nowSec() + 600 }),
    };
    expect((await bad(`code=CODE-2&state=${state}&iss=${encodeURIComponent(ISSUER)}`, temp)).status).toBe(502);

    // PKCE verifier 与 authorize 的 challenge 不符：伪 auth 拒绝换票（400）→ club 502
    stub = { ...stub, idToken: undefined, challenge: 'A'.repeat(43) };
    expect((await bad(`code=CODE-2&state=${state}&iss=${encodeURIComponent(ISSUER)}`, temp)).status).toBe(502);
    expect(stub.tokenCalls.at(-1)!.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('登出：吊销本地会话行，302 跳认证中心 end_session 带白名单回跳', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env, sqlite } = freshEnv(true);
    const { session } = await oidcLogin(env);

    const logout = await app.request(
      '/api/auth/logout',
      { method: 'POST', headers: { Cookie: `__Host-club_session=${session}` } },
      env,
    );
    expect(logout.status).toBe(302);
    const target = new URL(logout.headers.get('Location')!);
    expect(`${target.protocol}//${target.host}${target.pathname}`).toBe(`${ISSUER}/logout`);
    expect(target.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost/');

    const row = sqlGet<{ revoked_at: string | null }>(sqlite, 'SELECT revoked_at FROM oidc_session');
    expect(row?.revoked_at).not.toBeNull();

    const me = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    expect(((await me.json()) as { user: unknown }).user).toBeNull();
  });

  it('back-channel：按 sid 吊销会话并回 200 空体；坏 token 400；未知 sid 不动既有会话', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env, sqlite } = freshEnv(true);
    const { session } = await oidcLogin(env, { sid: 'sid-bc-1' });

    const post = async (token: string) =>
      app.request(
        '/api/auth/backchannel-logout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ logout_token: token }),
        },
        env,
      );
    const logoutClaims = (sid: string, extra: JWTPayload = {}): JWTPayload => ({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: '2',
      sid,
      jti: 'jti-1',
      iat: nowSec(),
      events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
      ...extra,
    });

    // 签名不对 → 400；带 nonce → 400（规范禁止 logout_token 携带 nonce）
    expect((await post(await mint(rogue, logoutClaims('sid-bc-1')))).status).toBe(400);
    expect((await post(await mint(signing, logoutClaims('sid-bc-1', { nonce: 'x' })))).status).toBe(400);

    // 缺登出事件 → 400
    const { events: _drop, ...noEvent } = logoutClaims('sid-bc-1');
    expect((await post(await mint(signing, noEvent))).status).toBe(400);

    // 正常通知 → 200 空体，会话行被吊销，/api/me 立刻认不出人
    const ok = await post(await mint(signing, logoutClaims('sid-bc-1')));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('');
    const row = sqlGet<{ revoked_at: string | null }>(sqlite, 'SELECT revoked_at FROM oidc_session');
    expect(row?.revoked_at).not.toBeNull();
    const me = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    expect(((await me.json()) as { user: unknown }).user).toBeNull();

    // 未知 sid 也回 200（规范），且不影响其他存活会话
    const other = await oidcLogin(env, { sid: 'sid-bc-2' });
    expect(other.cb.status).toBe(302);
    expect((await post(await mint(signing, logoutClaims('sid-unknown')))).status).toBe(200);
    const alive = sqlGet<{ revoked_at: string | null }>(
      sqlite,
      "SELECT revoked_at FROM oidc_session WHERE auth_sid = 'sid-bc-2'",
    );
    expect(alive?.revoked_at).toBeNull();
  });

  it('判定点（OIDC 模式按权限点）：教练过教练端点/挡管理端点，管理组两头都过，locked 观众号两头被挡', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env } = freshEnv(true);
    const loginAs = async (sub: string) => {
      const { session } = await oidcLogin(env, { sub });
      return `__Host-club_session=${session}`;
    };
    const admin = await loginAs('1');
    const coach = await loginAs('2');
    const viewer = await loginAs('3');

    // 教练端点（requireCoach('club.squad.manage')）：教练与管理组都过——管理组凭
    // 「任一管理权限点」放行（旧 requireCoach = admin OR coach 的行为保留）；
    // locked 观众号旧模式投影 viewer 被挡，收口后 perms 含教练点，locked 闸必须显式生效
    expect((await app.request('/api/club/balance', { method: 'GET', headers: { Cookie: coach } }, env)).status).toBe(200);
    expect((await app.request('/api/club/balance', { method: 'GET', headers: { Cookie: admin } }, env)).status).toBe(200);
    expect((await app.request('/api/club/balance', { method: 'GET', headers: { Cookie: viewer } }, env)).status).toBe(403);

    // 管理端点按语义权限点：club.clubs.manage 持有人过；教练无任一管理点 → 403
    expect((await app.request('/api/admin/clubs', { method: 'GET', headers: { Cookie: admin } }, env)).status).toBe(200);
    expect((await app.request('/api/admin/clubs', { method: 'GET', headers: { Cookie: coach } }, env)).status).toBe(403);
    expect((await app.request('/api/admin/m0', { method: 'GET', headers: { Cookie: coach } }, env)).status).toBe(403);
  });

  it('收口：会话解析只读 claims——tour user 表删光后 /api/me 与判定点照常；旧行 claims NULL 视为未登录', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env, sqlite, tour } = freshEnv(true);
    const { session } = await oidcLogin(env, { sub: '1' });

    // 本地夹具造一条带 user_name 的新式绑定行，然后删光赛事库 user 表 = 收口后新账号无行
    sqlite.exec(
      "INSERT INTO clubs (id, name, league_tier, status, created_at) VALUES (1, '测试俱乐部', 'premier', 'active', '2026-01-01T00:00:00Z');" +
        "INSERT INTO club_bindings (club_id, user_id, user_name, bound_at) VALUES (1, 1, '管理组甲', '2026-01-01T00:00:00Z');",
    );
    tour.exec('DELETE FROM user');

    const me = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    expect(((await me.json()) as { user: { name: string } }).user.name).toBe('管理组甲');

    // 管理列表：绑定人名字本地 user_name 命中，全程不碰 tour user 表（已空）
    const admin = await app.request('/api/admin/clubs', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    expect(admin.status).toBe(200);
    const list = (await admin.json()) as { clubs: { binding: { userName: string | null } | null }[] };
    expect(list.clubs[0].binding?.userName).toBe('管理组甲');

    // 旧格式会话行（claims NULL）视为未登录——重走一次 OIDC 登录即恢复
    sqlite.exec(
      `INSERT INTO oidc_session (token_hash, sub, auth_sid, created_at, expires_at)
       VALUES ('${createHash('sha256').update('legacy').digest('hex')}', '2', 'sid-old', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
    );
    const stale = await app.request('/api/me', { method: 'GET', headers: { Cookie: '__Host-club_session=legacy' } }, env);
    expect(((await stale.json()) as { user: unknown }).user).toBeNull();
  });

  it('userinfo 拉取失败/缺字段 → 502 不建会话；恢复后重登即用上新 claims', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env, sqlite } = freshEnv(true);
    const login = await app.request('/api/auth/login', { method: 'GET' }, env);
    const authUrl = new URL(login.headers.get('Location')!);
    const temp = cookieOf(login, '__Host-club_oidc')!;
    const state = authUrl.searchParams.get('state')!;
    const cb = () =>
      app.request(
        `/api/auth/callback?code=CODE-1&state=${state}&iss=${encodeURIComponent(ISSUER)}`,
        { method: 'GET', headers: { Cookie: `__Host-club_oidc=${temp}` } },
        env,
      );
    stub = {
      code: 'CODE-1',
      challenge: authUrl.searchParams.get('code_challenge')!,
      nonce: authUrl.searchParams.get('nonce')!,
      sub: '2',
      sid: 'sid-1',
      tokenCalls: [],
      userinfoStatus: 500,
    };

    // userinfo 500 → 502；缺 name 字段（shape 不完整）同样 502；两条路都不落会话行
    expect((await cb()).status).toBe(502);
    stub.userinfoStatus = undefined;
    stub.userinfo = { sub: '2', locked: false, must_change_pw: false, roles: ['club.coach'], permissions: ['club.squad.manage'] };
    expect((await cb()).status).toBe(502);
    expect(sqlGet(sqlite, 'SELECT token_hash FROM oidc_session')).toBeUndefined();

    // userinfo 恢复后重新登录即恢复（重登刷新 claims 与 guess/tour 同款语义）
    stub.userinfo = undefined;
    const retried = await oidcLogin(env);
    expect(retried.cb.status).toBe(302);
    const me = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${retried.session}` } }, env);
    expect(((await me.json()) as { user: { name: string } }).user.name).toBe('教练乙');
  });

  it('静默同步探测：me 下发 syncProbe，sync 带 prompt=none，error 回来源页，冷却生效', async () => {
    const { env } = freshEnv(true);
    // 匿名 + oidc + 无冷却 → syncProbe=true
    const me = await app.request('/api/me', { method: 'GET' }, env);
    expect(((await me.json()) as { syncProbe?: boolean }).syncProbe).toBe(true);

    // sync：prompt=none + returnTo 存 temp + 冷却标记
    const sync = await app.request('/api/auth/sync?back=%2Fledger', { method: 'GET' }, env);
    expect(sync.status).toBe(302);
    const authUrl = new URL(sync.headers.get('Location')!);
    expect(authUrl.origin).toBe(ISSUER);
    expect(authUrl.searchParams.get('prompt')).toBe('none');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/callback');
    const temp = cookieOf(sync, '__Host-club_oidc');
    expect(JSON.parse(b64urlDecode(temp!)).returnTo).toBe('/ledger');
    expect(cookieOf(sync, '__Host-club_probe')).toBe('1');
    // 冷却中的 me：syncProbe 不再下发
    const meCooling = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_probe=${cookieOf(sync, '__Host-club_probe')}` } }, env);
    expect(((await meCooling.json()) as { syncProbe?: boolean }).syncProbe).toBeUndefined();

    // auth 无会话回 error=login_required → 原路回 /ledger，不出错页不建会话
    const cbErr = await app.request(
      `/api/auth/callback?error=login_required&state=${authUrl.searchParams.get('state')}&iss=${encodeURIComponent(ISSUER)}`,
      { method: 'GET', headers: { Cookie: `__Host-club_oidc=${temp}` } },
      env,
    );
    expect(cbErr.status).toBe(302);
    expect(cbErr.headers.get('Location')).toBe('/ledger');
    expect(cookieOf(cbErr, '__Host-club_session')).toBeUndefined();
  });

  it('stale 会话：me 认不出人（行已撤销）→ 下发 syncProbe + 清掉无效会话 cookie', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env, sqlite } = freshEnv(true);
    const { session } = await oidcLogin(env);
    // 正常会话：me 认人，无 syncProbe，不清 cookie
    const meLive = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    const liveJson = (await meLive.json()) as { user: unknown; syncProbe?: boolean };
    expect(liveJson.user).toBeTruthy();
    expect(liveJson.syncProbe).toBeUndefined();
    expect(meLive.headers.getSetCookie().find((l) => l.startsWith('__Host-club_session='))).toBeUndefined();
    // 撤销后（back-channel 登出撤行的浏览器侧后果）：cookie 还在但行没了 → 清 cookie + 照常探测
    sqlite.prepare("UPDATE oidc_session SET revoked_at = '2020-01-01T00:00:00.000Z'").run();
    const meStale = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    const staleJson = (await meStale.json()) as { user: unknown; syncProbe?: boolean };
    expect(staleJson.user).toBeNull();
    expect(staleJson.syncProbe).toBe(true);
    const sc = meStale.headers.getSetCookie().find((l) => l.startsWith('__Host-club_session='));
    expect(sc).toMatch(/^__Host-club_session=;/);
    expect(sc).toContain('Max-Age=0');
  });

  it('静默同步探测：auth 有会话则静默登录且回跳来源页；back 非法归一化为 /', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const { env } = freshEnv(true);
    const sync = await app.request('/api/auth/sync?back=https://evil.example/x', { method: 'GET' }, env);
    const authUrl = new URL(sync.headers.get('Location')!);
    const temp = cookieOf(sync, '__Host-club_oidc');
    expect(JSON.parse(b64urlDecode(temp!)).returnTo).toBe('/');
    stub = { code: 'CODE-1', challenge: authUrl.searchParams.get('code_challenge')!, nonce: authUrl.searchParams.get('nonce')!, sub: '2', sid: 'sid-1', tokenCalls: [] };
    const cb = await app.request(
      `/api/auth/callback?code=${stub.code}&state=${authUrl.searchParams.get('state')}&iss=${encodeURIComponent(ISSUER)}`,
      { method: 'GET', headers: { Cookie: `__Host-club_oidc=${temp}` } },
      env,
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get('Location')).toBe('/');
    expect(cookieOf(cb, '__Host-club_session')).toBeTruthy();
  });
});

