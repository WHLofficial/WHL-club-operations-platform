// v6.84.0 P0 守卫：玩家队转 CPU 的两个入口先挡住——
//   ① 已绑到 CPU 队的教练会话：requireCoach 统一 403（管理端不受影响）；
//   ② 拿 CPU 队的码新绑定：/clubs/bind 回滚 + 审计 + 409 cpu_club。
// 另含 OIDC 模式绑定后 502 的回归（绑定前 requireCoach 已缓存 bound=false，不能用带 request 的 getBoundClub）。
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, attachAuthChannel, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

const realFetch = globalThis.fetch;
const OIDC_COOKIE = '__Host-club_session';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  // tour 镜像：兼容模式鉴权要 user 表（1 管理组甲 / 2 教练乙）
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0), (2, '教练乙', 'coach', 0, 0);`,
  );
  const kv = new Map<string, string>();
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
  };
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  return { env, sqlite, kv };
}

function seedClub(fx: Fixture, id: number, name: string, isCpu: number): void {
  fx.sqlite
    .prepare('INSERT INTO clubs (id, name, league_tier, status, created_at, is_cpu) VALUES (?, ?, NULL, ?, ?, ?)')
    .run(id, name, 'active', '2026-01-01T00:00:00Z', isCpu);
}

// auth 目录登记一队（team.id 显式给定——team_binding 按它引用）
function registerTeam(auth: DatabaseSync, teamId: number, clubId: number): void {
  auth
    .prepare('INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(teamId, teamId, clubId, `目录队${teamId}`, '2026-01-01T00:00:00Z');
}

// 登记一队并绑给某账号（绑定真源：team_binding → team.club_id）
function bindTeam(auth: DatabaseSync, teamId: number, clubId: number, accountId: number): void {
  registerTeam(auth, teamId, clubId);
  auth
    .prepare("INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (?, ?, 'club', '2026-01-02T00:00:00Z')")
    .run(accountId, teamId);
}

function issueCode(auth: DatabaseSync, teamId: number, code: string): void {
  auth
    .prepare("INSERT INTO team_bind_code (team_id, code_hash, via, expires_at, created_at) VALUES (?, ?, 'club', NULL, ?)")
    .run(teamId, createHash('sha256').update(code).digest('hex'), '2026-01-01T00:00:00Z');
}

// OIDC 会话夹具：与登录回调落库的行同形（claims 是登录时存档的那份）
function seedOidcSession(fx: Fixture, token: string, userId: number, permissions: string[]): void {
  fx.sqlite
    .prepare('INSERT INTO oidc_session (token_hash, sub, auth_sid, claims, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      createHash('sha256').update(token).digest('hex'),
      String(userId),
      `sid-${userId}`,
      JSON.stringify({ name: `账号${userId}`, locked: false, must_change_pw: false, roles: ['club.coach'], permissions }),
      '2026-01-01T00:00:00Z',
      '2099-01-01T00:00:00Z',
    );
}

function get(path: string, env: Env, cookie: string) {
  return app.request(path, { method: 'GET', headers: { Cookie: cookie } }, env);
}

function post(path: string, body: unknown, env: Env, cookie: string) {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) },
    env,
  );
}

function lastAudit(sqlite: DatabaseSync) {
  return sqlGet<{ actor: number | null; action: string; target_type: string; target_id: number; after: string | null }>(
    sqlite,
    'SELECT actor, action, target_type, target_id, after FROM audit_log ORDER BY id DESC LIMIT 1',
  );
}

afterEach(() => {
  // attachAuthChannel 是直接赋值 globalThis.fetch（不是 vi.stubGlobal），这里手工还原
  globalThis.fetch = realFetch;
});

describe('requireCoach 的 CPU 队守卫（兼容模式）', () => {
  it('绑到 CPU 队的教练：教练端点一律 403，消息指路管理组', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    seedClub(fx, 10, '曼城 (CPU)', 1);
    bindTeam(auth, 1, 10, 2);

    for (const path of ['/api/me/club', '/api/club/balance']) {
      const res = await get(path, fx.env, 'whl_session=tok-coach');
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: '该队已转为 CPU 队，请联系管理组' });
    }
  });

  it('同一个人类队不受影响（绑定照旧 200）', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    seedClub(fx, 50, '人类队', 0);
    bindTeam(auth, 2, 50, 2);

    const me = await get('/api/me/club', fx.env, 'whl_session=tok-coach');
    expect(me.status).toBe(200);
    expect(((await me.json()) as { club: { id: number } }).club.id).toBe(50);
    const balance = await get('/api/club/balance', fx.env, 'whl_session=tok-coach');
    expect(balance.status).toBe(200);
    expect(((await balance.json()) as { club: { id: number } }).club.id).toBe(50);
  });

  it('管理组不受影响：解绑 CPU 队的账号照常可用（getBoundClub 不过滤 is_cpu）', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    seedClub(fx, 10, '曼城 (CPU)', 1);
    bindTeam(auth, 1, 10, 2);

    const res = await post('/api/admin/bindings/unbind', { userId: 2 }, fx.env, 'whl_session=tok-admin');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sqlGet(auth, 'SELECT account_id FROM team_binding WHERE account_id = ?', 2)).toBeUndefined();
    expect(lastAudit(fx.sqlite)).toEqual({
      actor: 1,
      action: 'club_unbind',
      target_type: 'club',
      target_id: 10,
      after: null,
    });
  });

  it('管理员兼绑 CPU 队：教练侧入口同样 403（OIDC 分支不再提前放行）', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    fx.env.AUTH_MODE = 'oidc';
    fx.env.OIDC_CLIENT_ID = 'club-web';
    seedClub(fx, 10, '曼城 (CPU)', 1);
    bindTeam(auth, 1, 10, 1);
    seedOidcSession(fx, 'oidc-admin', 1, ['club.clubs.manage', 'club.coach']);

    const res = await get('/api/me/club', fx.env, `${OIDC_COOKIE}=oidc-admin`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '该队已转为 CPU 队，请联系管理组' });
  });
});

describe('POST /api/clubs/bind 的 CPU 队守卫', () => {
  it('OIDC：拿 CPU 队的码 → 回滚绑定 + 审计 + 409 cpu_club', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    fx.env.AUTH_MODE = 'oidc';
    fx.env.OIDC_CLIENT_ID = 'club-web';
    seedClub(fx, 10, '曼城 (CPU)', 1);
    registerTeam(auth, 110, 10);
    issueCode(auth, 110, 'CPUBIND1');
    seedOidcSession(fx, 'oidc-cpu', 2, ['club.coach', 'club.squad.manage']);

    const res = await post('/api/clubs/bind', { code: 'CPUBIND1' }, fx.env, `${OIDC_COOKIE}=oidc-cpu`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '该队已转为 CPU 队，不能绑定', code: 'cpu_club' });
    // 回滚干净：auth 侧没有留下绑定，本地只留一条拒绝审计（没有 club_bind）
    expect(sqlGet(auth, 'SELECT account_id FROM team_binding WHERE account_id = ?', 2)).toBeUndefined();
    expect(lastAudit(fx.sqlite)).toEqual({
      actor: 2,
      action: 'club_bind_rejected_cpu',
      target_type: 'club',
      target_id: 10,
      after: '{"userId":2}',
    });
    expect(sqlGet(fx.sqlite, "SELECT id FROM audit_log WHERE action = 'club_bind'")).toBeUndefined();
  });

  it('OIDC：人类队绑定成功 201（绑定后真查，不吃绑定前缓存的 502 回归）', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    fx.env.AUTH_MODE = 'oidc';
    fx.env.OIDC_CLIENT_ID = 'club-web';
    seedClub(fx, 50, '人类队', 0);
    registerTeam(auth, 150, 50);
    issueCode(auth, 150, 'HUMANBD1');
    seedOidcSession(fx, 'oidc-human', 2, ['club.coach', 'club.squad.manage']);

    const res = await post('/api/clubs/bind', { code: 'HUMANBD1' }, fx.env, `${OIDC_COOKIE}=oidc-human`);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, clubId: 50 });
    expect(lastAudit(fx.sqlite)).toMatchObject({ actor: 2, action: 'club_bind', target_type: 'club', target_id: 50 });
  });

  it('兼容模式：人类队绑定 201（requireCoach 现在会预查绑定，绑定后仍按真查解析）', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    seedClub(fx, 50, '人类队', 0);
    registerTeam(auth, 151, 50);
    issueCode(auth, 151, 'HUMANBD2');

    const res = await post('/api/clubs/bind', { code: 'HUMANBD2' }, fx.env, 'whl_session=tok-coach');
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, clubId: 50 });
    expect(sqlGet(auth, 'SELECT team_id FROM team_binding WHERE account_id = ?', 2)).toBeDefined();
  });

  it('回滚失败 → 502 并说明（auth 侧绑定残留，靠 P0 守卫挡住后续操作）', async () => {
    const fx = freshEnv();
    const auth = attachAuthChannel(fx.env);
    fx.env.AUTH_MODE = 'oidc';
    fx.env.OIDC_CLIENT_ID = 'club-web';
    seedClub(fx, 10, '曼城 (CPU)', 1);
    registerTeam(auth, 110, 10);
    issueCode(auth, 110, 'CPUBIND2');
    seedOidcSession(fx, 'oidc-cpu2', 2, ['club.coach', 'club.squad.manage']);

    const authStub = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/team/unbind')) {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      return authStub(url, init);
    };

    const res = await post('/api/clubs/bind', { code: 'CPUBIND2' }, fx.env, `${OIDC_COOKIE}=oidc-cpu2`);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('解绑失败');
    // 回滚没成功：绑定还在（美其名曰脏状态），但教练侧已被 requireCoach 挡住
    expect(sqlGet(auth, 'SELECT team_id FROM team_binding WHERE account_id = ?', 2)).toBeDefined();
    const me = await get('/api/me/club', fx.env, `${OIDC_COOKIE}=oidc-cpu2`);
    expect(me.status).toBe(403);
  });
});
