// 统一认证接入测试（迁移步骤②，auth 项目 PRD P0-5）：
// in-process 伪认证服务器——stub 全局 fetch 提供 jwks/token 两端点，用 jose 现签
// id_token / logout_token（独立密钥对，challenge/verifier 哈希用 node:crypto 独立实现），
// 驱动 RP 全流程：发起登录 → 回调建会话 → 登出吊销 → back-channel 通知；
// 兼容模式（未配 OIDC_*）回归旧行为。
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { BACKCHANNEL_LOGOUT_EVENT } from '../src/lib/oidc.ts';

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
}

let stub: StubState;

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof URL ? input : new URL(String(input));
  if (url.pathname.endsWith('/jwks.json')) {
    return new Response(JSON.stringify({ keys: [signing.jwk] }), {
      headers: { 'content-type': 'application/json' },
    });
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
        scope: 'openid',
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
    ...(oidc ? { OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT_ID } : {}),
  };
  return { env, sqlite };
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
    expect(u.searchParams.get('scope')).toBe('openid');
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

    // 会话行：token_hash 是会话 cookie 的 sha256（独立实现核对），sub/sid 来自 id_token
    const row = sqlGet<{ token_hash: string; sub: string; auth_sid: string; revoked_at: null }>(
      sqlite,
      'SELECT token_hash, sub, auth_sid, revoked_at FROM oidc_session',
    );
    expect(row).toEqual({
      token_hash: createHash('sha256').update(session!).digest('hex'),
      sub: '2',
      auth_sid: 'sid-1',
      revoked_at: null,
    });

    // /api/me 用会话 cookie 认人（姓名/角色现查 tour 库，不信任令牌声明）
    const me = await app.request('/api/me', { method: 'GET', headers: { Cookie: `__Host-club_session=${session}` } }, env);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: { id: 2, name: '教练乙', role: 'coach', locked: false, mustChangePw: false },
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

    // sub 不是数字串（过渡期必须是 tour user id）→ 502
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
});
