// 管理端建队（增量 17 commit 4）：游戏球队 ID 必填 + tour 校验/队名预填 + auth 目录自动建档（可重试）
// 增量 37 追加：tour 里没有这支队时不再 404 挡下，改为**先在赛事系统建队**（同一号）再本地建档；
// 推送失败则 502 且不建档（两侧 id 空间一致，单边建档会留下错位）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(withAuth = false): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0);
     CREATE TABLE team (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');
     INSERT INTO team (id, org_id, name) VALUES (500, 1, '游戏里的队'), (600, 1, '新号队');`,
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
  if (withAuth) {
    const authSqlite = new DatabaseSync(':memory:');
    authSqlite.exec(
      `CREATE TABLE team (id INTEGER PRIMARY KEY AUTOINCREMENT, tour_team_id INTEGER UNIQUE NOT NULL, club_id INTEGER, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');`,
    );
    env.AUTH_DB = createTestD1(authSqlite);
    env.OIDC_ISSUER = 'http://auth.local';
    env.AUTH_BIND_SECRET = 'test-secret';
  }
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  return { env, sqlite, tour, kv };
}

function post(path: string, body: unknown, env: Env) {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-admin' }, body: JSON.stringify(body) },
    env,
  );
}

function get(path: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: 'whl_session=tok-admin' } }, env);
}

// 拦 machineCall 的 fetch：记录 body、按脚本回 JSON
let machineRequests: { path: string; body: Record<string, unknown> }[] = [];
const defaultReply = () => ({ status: 200, json: { ok: true, teamId: 500 } });
let machineReply: (path: string) => { status: number; json: Record<string, unknown> } = defaultReply;

function stubMachineFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(url).pathname;
      machineRequests.push({ path, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      const reply = machineReply(path);
      return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  machineRequests = [];
  // machineReply 是模块级脚本变量，不重置会串到下一条用例（增量 37 新用例里改过它）
  machineReply = defaultReply;
});

describe('管理端建队：游戏球队 ID 必填（增量 17）', () => {
  it('缺 gameTeamId / 非正整数 → 400；tour 无队且没填名字 → 400（填了名字会自动去建队）', async () => {
    const fx = freshEnv();
    expect((await post('/api/admin/clubs', { name: '某队' }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/clubs', { name: '某队', gameTeamId: 0 }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/clubs', { name: '某队', gameTeamId: 12.5 }, fx.env)).status).toBe(400);
    const missing = await post('/api/admin/clubs', { gameTeamId: 999 }, fx.env);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toContain('请填俱乐部名字');
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 999')).toBeUndefined();
  });

  it('tour 无队 + 填了名字 + 配了密钥 → 先在赛事系统建队，再本地建档（pushedToTour=true）', async () => {
    const fx = freshEnv();
    fx.env.TOUR_API_BASE = 'http://tour.test';
    fx.env.TEAM_SYNC_SECRET = 'sync-secret';
    stubMachineFetch();
    const res = await post('/api/admin/clubs', { gameTeamId: 999, name: '新队' }, fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      club: { id: number; name: string };
      authLinked: boolean | null;
      pushedToTour: boolean;
    };
    expect(body.club).toMatchObject({ id: 999, name: '新队' });
    expect(body.pushedToTour).toBe(true);
    expect(machineRequests).toEqual([{ path: '/api/internal/team-upsert', body: { id: 999, name: '新队' } }]);
    expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 999')).toEqual({ name: '新队' });
  });

  it('tour 无队 + 推送失败 → 502 且不建档（不留「有俱乐部没球队」的错位）', async () => {
    const fx = freshEnv();
    fx.env.TOUR_API_BASE = 'http://tour.test';
    fx.env.TEAM_SYNC_SECRET = 'sync-secret';
    stubMachineFetch();
    machineReply = () => ({ status: 409, json: { error: 'conflict', message: '球队 ID #999 已被占用' } });
    const res = await post('/api/admin/clubs', { gameTeamId: 999, name: '新队' }, fx.env);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('赛事系统建队失败：球队 ID #999 已被占用');
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 999')).toBeUndefined();
  });

  it('tour 无队 + 未配 TEAM_SYNC_SECRET → 502，文案指路；本地不建档', async () => {
    const fx = freshEnv();
    fx.env.TOUR_API_BASE = 'http://tour.test';
    stubMachineFetch();
    const res = await post('/api/admin/clubs', { gameTeamId: 999, name: '新队' }, fx.env);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('未配置 TEAM_SYNC_SECRET');
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 999')).toBeUndefined();
  });

  it('成功（回滚通道无 AUTH_DB）：指定 id 建队、名字取 tour 预填、authLinked=null', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/clubs', { gameTeamId: 500 }, fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { club: { id: number; name: string }; authLinked: boolean | null };
    expect(body.club).toMatchObject({ id: 500, name: '游戏里的队' });
    expect(body.authLinked).toBeNull();
  });

  it('成功（auth 接入）：register 带 tour_team_id/club_id 落 auth 目录，authLinked=true', async () => {
    const fx = freshEnv(true);
    stubMachineFetch();
    const res = await post('/api/admin/clubs', { gameTeamId: 500, name: '自定义名' }, fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { club: { id: number; name: string }; authLinked: boolean | null };
    expect(body.club).toMatchObject({ id: 500, name: '自定义名' });
    expect(body.authLinked).toBe(true);
    expect(machineRequests).toEqual([
      { path: '/api/team/register', body: { tour_team_id: 500, name: '自定义名', club_id: 500 } },
    ]);
  });

  it('id 撞号 → 409；auth register 失败不回滚 clubs 行（201 authLinked=false），重试端点可修复', async () => {
    const fx = freshEnv(true);
    fx.sqlite.exec(`INSERT INTO clubs (id, name, status, created_at) VALUES (500, '占号队', 'active', '2026-01-01T00:00:00Z')`);
    expect((await post('/api/admin/clubs', { gameTeamId: 500 }, fx.env)).status).toBe(409);

    stubMachineFetch();
    machineReply = () => ({ status: 400, json: { error: 'club_taken', message: '该俱乐部已关联其他球队' } });
    const res = await post('/api/admin/clubs', { gameTeamId: 600, name: '新队' }, fx.env);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { authLinked: boolean }).authLinked).toBe(false);

    machineReply = () => ({ status: 400, json: { error: 'club_taken', message: '拒绝' } });
    expect((await post('/api/admin/clubs/600/register-auth', {}, fx.env)).status).toBe(502);
    machineReply = () => ({ status: 200, json: { ok: true, teamId: 1 } });
    expect((await post('/api/admin/clubs/600/register-auth', {}, fx.env)).status).toBe(200);
  });

  it('tour 已有这支队 → 不推送（不白打扰赛事系统）', async () => {
    const fx = freshEnv();
    fx.env.TOUR_API_BASE = 'http://tour.test';
    fx.env.TEAM_SYNC_SECRET = 'sync-secret';
    stubMachineFetch();
    const res = await post('/api/admin/clubs', { gameTeamId: 500 }, fx.env);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { pushedToTour: boolean }).pushedToTour).toBe(false);
    expect(machineRequests).toEqual([]);
  });

  it('tour 无队 + 推送成功但本地名字撞车 → 409；赛事系统那边已建队（对账页会显示只有球队没俱乐部）', async () => {
    const fx = freshEnv();
    fx.env.TOUR_API_BASE = 'http://tour.test';
    fx.env.TEAM_SYNC_SECRET = 'sync-secret';
    fx.sqlite.exec(`INSERT INTO clubs (id, name, status, created_at) VALUES (700, '新队', 'active', '2026-01-01T00:00:00Z')`);
    stubMachineFetch();
    const res = await post('/api/admin/clubs', { gameTeamId: 999, name: '新队' }, fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('俱乐部名字已存在');
    // 推送不可撤销，这是有意接受的代价：错位由对账页的 onlyTour 一类显形并可一键补建
    expect(machineRequests).toEqual([{ path: '/api/internal/team-upsert', body: { id: 999, name: '新队' } }]);
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 999')).toBeUndefined();
  });

  it('队名预填查询：tour-team 按队号回队名；无队 404', async () => {
    const fx = freshEnv();
    const res = await get('/api/admin/clubs/tour-team?teamId=500', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { team: { id: number; name: string } }).toMatchObject({ team: { id: 500, name: '游戏里的队' } });
    expect((await get('/api/admin/clubs/tour-team?teamId=999', fx.env)).status).toBe(404);
    expect((await get('/api/admin/clubs/tour-team?teamId=abc', fx.env)).status).toBe(400);
  });
});
