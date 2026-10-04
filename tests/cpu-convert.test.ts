// v6.27.0 CPU 接管向导（管理端四步：读现状 → 改 tour 侧队名 → 改本仓队名 → 铺主场基建）。
// 覆盖：只读聚合 / 改名双向 / 幂等铺基建（重放零写入）/ 权限 / 校验 / 跨仓改名契约金标准。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, attachAuthChannel, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { hmacHex } from '../src/lib/hmac.ts';
import { TEAM_RENAME_PATH, pushTeamRename } from '../src/worker/tourClient.ts';
import { diehardTarget, loadAttendanceModel, playerInfluenceSum, teamInfluence } from '../src/worker/home.ts';
import { FACILITY_KEYS } from '../src/worker/stadium-ops.ts';
import { resetOverviewCache } from '../src/worker/routes/admin/overview.ts';

const SYNC_SECRET = 'test-team-sync-secret';
const TOUR_BASE = 'http://tour.test';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  // tour 镜像：user 表供兼容模式鉴权（admin / coach 两个角色），team 表供队名预填与 tour 侧改名
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0), (2, '教练乙', 'coach', 0, 0);
     CREATE TABLE team (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');
     INSERT INTO team (id, org_id, name) VALUES (10, 1, '曼城 (CPU)'), (241, 1, 'RB莱比锡 (CPU)'), (112172, 1, '桑德兰 (CPU)'), (131681, 1, '朴茨茅斯 (CPU)'), (999, 1, '丙级非预设队 (CPU)');`,
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
    TOUR_API_BASE: TOUR_BASE,
    TEAM_SYNC_SECRET: SYNC_SECRET,
  };
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  return { env, sqlite, tour, kv };
}

function get(path: string, env: Env, cookie = 'tok-admin') {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${cookie}` } }, env);
}

function post(path: string, body: unknown, env: Env, cookie = 'tok-admin') {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `whl_session=${cookie}` }, body: JSON.stringify(body) },
    env,
  );
}

// CPU 队建档：is_cpu=1；league_tier 留空（休眠列，级别真源在报名/预设表）
function seedCpuClub(fx: Fixture, id: number, name: string, leagueTier: string | null = null): void {
  fx.sqlite
    .prepare('INSERT INTO clubs (id, name, league_tier, status, created_at, is_cpu) VALUES (?, ?, ?, ?, ?, 1)')
    .run(id, name, leagueTier, 'active', '2026-01-01T00:00:00Z');
}

function auditCount(sqlite: DatabaseSync): number {
  return sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM audit_log')?.n ?? -1;
}

function lastAudit(sqlite: DatabaseSync) {
  return sqlGet<{
    actor: number | null;
    action: string;
    target_type: string;
    target_id: number;
    origin: string;
    before: string | null;
    after: string | null;
  }>(sqlite, 'SELECT actor, action, target_type, target_id, origin, before, after FROM audit_log ORDER BY id DESC LIMIT 1');
}

// 拦出站 fetch：记录 url/路径/头/体，按脚本回 JSON（与 admin-clubs-create 的机器通道桩同形）
let machineRequests: { url: string; path: string; headers: Record<string, string>; body: string }[] = [];
const defaultReply = () => ({ status: 200, json: { ok: true, renamed: true, name: '曼城' } as Record<string, unknown> });
let machineReply: (path: string) => { status: number; json: Record<string, unknown> } = defaultReply;

function stubMachineFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(url);
      machineRequests.push({
        url: String(url),
        path: parsed.pathname,
        headers: { ...((init?.headers ?? {}) as Record<string, string>) },
        body: String(init?.body ?? ''),
      });
      const reply = machineReply(parsed.pathname);
      return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  machineRequests = [];
  // machineReply 是模块级脚本变量，不重置会串到下一条用例
  machineReply = defaultReply;
});

describe('GET /api/admin/clubs/:id/cpu-convert（只读聚合）', () => {
  it('预设 CPU 队：基建全空、建议按预设表预填、死忠目标与公式现算一致', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    const res = await get('/api/admin/clubs/10/cpu-convert', fx.env);
    expect(res.status).toBe(200);
    // 死忠目标不是抄来的常量：用同一套公式现算一遍（shell 65.75 + bonus 15，无球员影响力）
    // 夹具无 AUTH_DB → deriveClubTier 回落休眠列 clubs.league_tier（未设 = NULL）→ 级别系数 1.0
    const model = await loadAttendanceModel(fx.env.DB);
    const playerSum = await playerInfluenceSum(fx.env, 10, model);
    const expectedFans = diehardTarget(model, teamInfluence({ shell_influence: 65.75, bonus_points: 15 }, playerSum, 1));
    expect(await res.json()).toEqual({
      // 队名与 tour 侧队名逐字回显；leagueTier 是休眠列原始值（此处空），不等于建议级别
      club: { id: 10, name: '曼城 (CPU)', isCpu: true, leagueTier: null, status: 'active' },
      tour: { id: 10, name: '曼城 (CPU)' },
      infra: { stadium: false, ledger: false, facilities: 0 },
      binding: { bound: false, userId: null, userName: null, boundAt: null },
      suggest: { newName: '曼城', shellInfluence: 65.75, bonusPoints: 15, leagueTier: 'second', diehardTarget: expectedFans },
    });
    expect(expectedFans).toBeGreaterThan(0);
  });

  it('预设表四条逐字（级别 1→premier、2→second；RB莱比锡奖励空按 0）', async () => {
    const fx = freshEnv();
    const presets = [
      { id: 241, name: 'RB莱比锡 (CPU)', tier: 'premier', shell: 38.65, bonus: 30 },
      { id: 112172, name: '桑德兰 (CPU)', tier: 'second', shell: 25.57, bonus: 0 },
      { id: 131681, name: '朴茨茅斯 (CPU)', tier: 'premier', shell: 52.95, bonus: 10 },
    ];
    for (const p of presets) {
      seedCpuClub(fx, p.id, p.name);
      const body = (await (await get(`/api/admin/clubs/${p.id}/cpu-convert`, fx.env)).json()) as {
        suggest: Record<string, unknown>;
      };
      expect(body.suggest).toMatchObject({ shellInfluence: p.shell, bonusPoints: p.bonus, leagueTier: p.tier });
    }
  });

  it('基建与绑定如实回显（本仓休眠表）；表外队给 null/0；tour 侧查无此队 → tour:null', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 999, '丙级非预设队 (CPU)');
    fx.sqlite.exec(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, created_at, updated_at)
         VALUES (999, '老球场', 20000, 0, 3, 4, 1234, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
       INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (999, 500, '2026-01-01T00:00:00Z');
       INSERT INTO club_facilities (club_id, facility_key, level, updated_at) VALUES (999, 'pitch', 3, '2026-01-01T00:00:00Z');
       INSERT INTO club_bindings (club_id, user_id, user_name, bound_at) VALUES (999, 7, '张三', '2026-01-02T00:00:00Z');`,
    );
    const body = (await (await get('/api/admin/clubs/999/cpu-convert', fx.env)).json()) as Record<string, unknown>;
    expect(body.infra).toEqual({ stadium: true, ledger: true, facilities: 1 });
    expect(body.binding).toEqual({ bound: true, userId: 7, userName: '张三', boundAt: '2026-01-02T00:00:00Z' });
    expect(body.tour).toEqual({ id: 999, name: '丙级非预设队 (CPU)' });
    expect(body.suggest).toMatchObject({ newName: '丙级非预设队', shellInfluence: 0, bonusPoints: 0, leagueTier: null });

    seedCpuClub(fx, 888, 'tour 里没有的队 (CPU)');
    const missing = (await (await get('/api/admin/clubs/888/cpu-convert', fx.env)).json()) as Record<string, unknown>;
    expect(missing.tour).toBeNull();
  });

  it('AUTH_DB 在位时绑定取 auth 聚合（与 GET /clubs 同口径）；整名只有 (CPU) 时退回原名', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    const auth = attachAuthChannel(fx.env);
    auth.exec(
      `INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '曼城 (CPU)', '2026-01-01T00:00:00Z');
       INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (2, 1, 'code', '2026-01-03T00:00:00Z');`,
    );
    const body = (await (await get('/api/admin/clubs/10/cpu-convert', fx.env)).json()) as Record<string, unknown>;
    expect(body.binding).toEqual({ bound: true, userId: 2, userName: '教练乙', boundAt: '2026-01-03T00:00:00Z' });

    fx.sqlite.prepare('INSERT INTO clubs (id, name, status, created_at) VALUES (?, ?, ?, ?)').run(60, '(CPU)', 'active', '2026-01-01T00:00:00Z');
    const edge = (await (await get('/api/admin/clubs/60/cpu-convert', fx.env)).json()) as { suggest: { newName: string } };
    expect(edge.suggest.newName).toBe('(CPU)');
  });

  it('非 CPU 队也能读（isCpu:false）；club 不存在 → 404', async () => {
    const fx = freshEnv();
    fx.sqlite
      .prepare('INSERT INTO clubs (id, name, status, created_at) VALUES (?, ?, ?, ?)')
      .run(50, '人类队', 'active', '2026-01-01T00:00:00Z');
    const body = (await (await get('/api/admin/clubs/50/cpu-convert', fx.env)).json()) as Record<string, unknown>;
    expect(body.club).toMatchObject({ id: 50, name: '人类队', isCpu: false });
    expect(body.suggest).toMatchObject({ newName: '人类队' });
    expect((await get('/api/admin/clubs/4040/cpu-convert', fx.env)).status).toBe(404);
  });
});

describe('POST /api/admin/clubs/:id/rename-tour（改 tour 侧队名）', () => {
  it('is_cpu=1 + 对手方 200 → renamed:true、审计写、本仓队名不动', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    stubMachineFetch();
    machineReply = () => ({ status: 200, json: { ok: true, renamed: true, name: '曼城' } });
    const res = await post('/api/admin/clubs/10/rename-tour', { name: '曼城' }, fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, renamed: true, name: '曼城' });
    expect(machineRequests).toHaveLength(1);
    expect(machineRequests[0].path).toBe(TEAM_RENAME_PATH);
    expect(machineRequests[0].body).toBe('{"id":10,"name":"曼城"}'); // 字段顺序固定 id 在前
    // tour 侧改名是单边动作：本仓那一行不动（本仓改名是 rename-local 的事）
    expect(sqlGet(fx.sqlite, 'SELECT name FROM clubs WHERE id = 10')).toEqual({ name: '曼城 (CPU)' });
    expect(lastAudit(fx.sqlite)).toEqual({
      actor: 1,
      action: 'club_cpu_rename_tour',
      target_type: 'club',
      target_id: 10,
      origin: 'user',
      before: null,
      after: '{"name":"曼城"}',
    });
  });

  it('对手方 409 → 502 tour_sync_failed；本仓零改动、无审计，随后可重试成功', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    stubMachineFetch();
    machineReply = () => ({ status: 409, json: { error: 'name_taken', message: '名字重复' } });
    const failed = await post('/api/admin/clubs/10/rename-tour', { name: '曼城' }, fx.env);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'tour_sync_failed', message: '名字重复' });
    expect(sqlGet(fx.sqlite, 'SELECT name FROM clubs WHERE id = 10')).toEqual({ name: '曼城 (CPU)' });
    expect(auditCount(fx.sqlite)).toBe(0); // 没改成就没有留痕可写
    // 对手方恢复后同一个请求直接过（重试不需要先清什么状态）
    machineReply = () => ({ status: 200, json: { ok: true, renamed: true, name: '曼城' } });
    expect((await post('/api/admin/clubs/10/rename-tour', { name: '曼城' }, fx.env)).status).toBe(200);
    expect(auditCount(fx.sqlite)).toBe(1);
  });

  it('对手方回 renamed:false 也照实回显（对端查无此队/本就同名）', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    stubMachineFetch();
    machineReply = () => ({ status: 200, json: { ok: true, renamed: false } });
    const res = await post('/api/admin/clubs/10/rename-tour', { name: '曼城' }, fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, renamed: false, name: '曼城' });
  });

  it('非 CPU 队 → 409 not_cpu，且不发出站请求、不写审计', async () => {
    const fx = freshEnv();
    fx.sqlite
      .prepare('INSERT INTO clubs (id, name, status, created_at) VALUES (?, ?, ?, ?)')
      .run(50, '人类队', 'active', '2026-01-01T00:00:00Z');
    stubMachineFetch();
    const res = await post('/api/admin/clubs/50/rename-tour', { name: '新名' }, fx.env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_cpu', message: '该俱乐部不是 CPU 队，无需接管' });
    expect(machineRequests).toEqual([]);
    expect(auditCount(fx.sqlite)).toBe(0);
  });

  it('404 / 空名 400 / 41 字 400 / 未配 TOUR_API_BASE → 502 未配置文案', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    stubMachineFetch();
    expect((await post('/api/admin/clubs/4040/rename-tour', { name: 'A' }, fx.env)).status).toBe(404);
    const empty = await post('/api/admin/clubs/10/rename-tour', { name: '   ' }, fx.env);
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe('队名不能为空');
    const tooLong = await post('/api/admin/clubs/10/rename-tour', { name: 'x'.repeat(41) }, fx.env);
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { error: string }).error).toBe('队名最多 40 个字');
    expect(machineRequests).toEqual([]); // 校验没过就不该出站
    fx.env.TOUR_API_BASE = undefined;
    const noBase = await post('/api/admin/clubs/10/rename-tour', { name: '曼城' }, fx.env);
    expect(noBase.status).toBe(502);
    expect(await noBase.json()).toEqual({ error: 'tour_sync_failed', message: '未配置 TOUR_API_BASE，无法同步到赛事系统' });
  });
});

describe('POST /api/admin/clubs/:id/rename-local（改本仓队名并摘 CPU 标记）', () => {
  it('成功：changed:true、DB 改名且 is_cpu=0、审计写', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    const res = await post('/api/admin/clubs/10/rename-local', { name: '曼城' }, fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true, name: '曼城' });
    expect(sqlGet(fx.sqlite, 'SELECT name, is_cpu FROM clubs WHERE id = 10')).toEqual({ name: '曼城', is_cpu: 0 });
    expect(lastAudit(fx.sqlite)).toEqual({
      actor: 1,
      action: 'club_cpu_rename_local',
      target_type: 'club',
      target_id: 10,
      origin: 'user',
      before: null,
      after: '{"name":"曼城"}',
    });
  });

  it('重放 → changed:false（is_cpu 已摘），DB 与审计都不再变', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    await post('/api/admin/clubs/10/rename-local', { name: '曼城' }, fx.env);
    const replay = await post('/api/admin/clubs/10/rename-local', { name: '曼城' }, fx.env);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, changed: false });
    expect(sqlGet(fx.sqlite, 'SELECT name, is_cpu FROM clubs WHERE id = 10')).toEqual({ name: '曼城', is_cpu: 0 });
    expect(auditCount(fx.sqlite)).toBe(1);
  });

  it('撞 clubs.name UNIQUE → 409 name_taken，DB 不变、无审计', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    fx.sqlite
      .prepare('INSERT INTO clubs (id, name, status, created_at) VALUES (?, ?, ?, ?)')
      .run(11, '别人队', 'active', '2026-01-01T00:00:00Z');
    const res = await post('/api/admin/clubs/10/rename-local', { name: '别人队' }, fx.env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_taken', message: '已有俱乐部使用该名字' });
    expect(sqlGet(fx.sqlite, 'SELECT name, is_cpu FROM clubs WHERE id = 10')).toEqual({ name: '曼城 (CPU)', is_cpu: 1 });
    expect(auditCount(fx.sqlite)).toBe(0);
  });

  it('404 / 空名 400 / 41 字 400', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    expect((await post('/api/admin/clubs/4040/rename-local', { name: 'A' }, fx.env)).status).toBe(404);
    expect((await post('/api/admin/clubs/10/rename-local', { name: '' }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/clubs/10/rename-local', { name: 'x'.repeat(41) }, fx.env)).status).toBe(400);
    expect(sqlGet(fx.sqlite, 'SELECT name, is_cpu FROM clubs WHERE id = 10')).toEqual({ name: '曼城 (CPU)', is_cpu: 1 });
  });
});

describe('POST /api/admin/clubs/:id/seed-ops（铺主场基建，一次 batch 全幂等）', () => {
  const SEED_BODY = { stadiumName: '伊蒂哈德球场', shellInfluence: 65.75, bonusPoints: 15, leagueTier: 'second' };

  it('一次调用铺齐：球场（12000/0 级/壳奖励按入参/fans 公式现算）+ 账本 0 + 五设施 0 级 + 联赛级别 + 审计', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    const model = await loadAttendanceModel(fx.env.DB);
    const playerSum = await playerInfluenceSum(fx.env, 10, model);
    // 路由侧同源：无 AUTH_DB → 派生级别回落休眠列 NULL → 系数 1.0（与 cpu-convert 预览同一套）
    const expectedFans = diehardTarget(model, teamInfluence({ shell_influence: 65.75, bonus_points: 15 }, playerSum, 1));
    const res = await post('/api/admin/clubs/10/seed-ops', SEED_BODY, fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      created: { stadium: true, ledger: true, facilities: FACILITY_KEYS.length },
      leagueTier: 'second',
    });
    expect(
      sqlGet(fx.sqlite, 'SELECT name, capacity, tier, shell_influence, bonus_points, fans FROM stadiums WHERE club_id = 10'),
    ).toEqual({ name: '伊蒂哈德球场', capacity: 12000, tier: 0, shell_influence: 65.75, bonus_points: 15, fans: expectedFans });
    expect(sqlGet(fx.sqlite, 'SELECT created_at IS NOT NULL AS c, updated_at IS NOT NULL AS u FROM stadiums WHERE club_id = 10')).toEqual({
      c: 1,
      u: 1,
    });
    expect(sqlGet(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 10')).toEqual({ balance: 0 });
    expect(sqlAll(fx.sqlite, 'SELECT facility_key, level FROM club_facilities WHERE club_id = 10 ORDER BY facility_key')).toEqual(
      [...FACILITY_KEYS].sort().map((k) => ({ facility_key: k, level: 0 })),
    );
    expect(sqlGet(fx.sqlite, 'SELECT league_tier FROM clubs WHERE id = 10')).toEqual({ league_tier: 'second' });
    const audit = lastAudit(fx.sqlite);
    expect(audit).toMatchObject({ actor: 1, action: 'club_cpu_seed_ops', target_type: 'club', target_id: 10, origin: 'user' });
    expect(JSON.parse(String(audit?.after))).toEqual({
      shellInfluence: 65.75,
      bonusPoints: 15,
      leagueTier: 'second',
      fans: expectedFans,
      stadiumCreated: true,
    });
  });

  it('重放同一请求：相关行逐字段（含 updated_at）快照完全一致，created 全 false', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    await post('/api/admin/clubs/10/seed-ops', SEED_BODY, fx.env);
    const snapshot = () => ({
      stadium: sqlAll(fx.sqlite, 'SELECT * FROM stadiums WHERE club_id = 10'),
      ledger: sqlAll(fx.sqlite, 'SELECT * FROM ledger_accounts WHERE club_id = 10'),
      facilities: sqlAll(fx.sqlite, 'SELECT * FROM club_facilities WHERE club_id = 10 ORDER BY facility_key'),
      club: sqlAll(fx.sqlite, 'SELECT * FROM clubs WHERE id = 10'),
    });
    const before = snapshot();
    // 真时钟往前走一点：updated_at 若被重写（ON CONFLICT DO UPDATE 之类）就会露馅
    await new Promise((r) => setTimeout(r, 30));
    const replay = await post('/api/admin/clubs/10/seed-ops', { ...SEED_BODY, stadiumName: '换个名字也不改' }, fx.env);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true,
      created: { stadium: false, ledger: false, facilities: 0 },
      leagueTier: 'second',
    });
    expect(snapshot()).toEqual(before); // 只建不改：重放零写入
    // 审计自证：这一趟没落库（stadiumCreated:false），读审计的人不会误以为壳/奖励被改过
    expect(JSON.parse(String(lastAudit(fx.sqlite)?.after))).toMatchObject({ stadiumCreated: false });
  });

  it('leagueTier 两个合法值都收（premier 顶级队）', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 241, 'RB莱比锡 (CPU)');
    const res = await post(
      '/api/admin/clubs/241/seed-ops',
      { stadiumName: '红牛球场', shellInfluence: 38.65, bonusPoints: 30, leagueTier: 'premier' },
      fx.env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      created: { stadium: true, ledger: true, facilities: FACILITY_KEYS.length },
      leagueTier: 'premier',
    });
    expect(sqlGet(fx.sqlite, 'SELECT league_tier FROM clubs WHERE id = 241')).toEqual({ league_tier: 'premier' });
    // 级别系数真源是派生级别（无 AUTH_DB → 回落休眠列 NULL → 1.0），表单里的 premier 只写休眠列：
    // 若 seed-ops 拿表单级别当系数（1.2），写入的 fans 就会与 cpu-convert 预览的 diehardTarget 分叉——
    // 这两条断言（本仓写入 vs 纯函数、本仓写入 vs 预览）就是 TC-IN-08 的闸
    const model = await loadAttendanceModel(fx.env.DB);
    const playerSum = await playerInfluenceSum(fx.env, 241, model);
    const expectedFans = diehardTarget(model, teamInfluence({ shell_influence: 38.65, bonus_points: 30 }, playerSum, 1));
    expect(sqlGet(fx.sqlite, 'SELECT fans FROM stadiums WHERE club_id = 241')).toEqual({ fans: expectedFans });
    const preview = (await (await get('/api/admin/clubs/241/cpu-convert', fx.env)).json()) as { suggest: { diehardTarget: number } };
    expect(preview.suggest.diehardTarget).toBe(expectedFans);
  });

  it('入参校验全挡（球场名 0/61 字、壳 -1/10001、奖励 -1/10001、级别 third/缺省）→ 400 且库内零写入', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    const bad = [
      { ...SEED_BODY, stadiumName: '' },
      { ...SEED_BODY, stadiumName: 'x'.repeat(61) },
      { ...SEED_BODY, shellInfluence: -1 },
      { ...SEED_BODY, shellInfluence: 10001 },
      { ...SEED_BODY, bonusPoints: -1 },
      { ...SEED_BODY, bonusPoints: 10001 },
      { ...SEED_BODY, leagueTier: 'third' },
      { stadiumName: '球场', shellInfluence: 0, bonusPoints: 0 },
    ];
    for (const body of bad) {
      expect((await post('/api/admin/clubs/10/seed-ops', body, fx.env)).status).toBe(400);
    }
    const messages = await Promise.all(
      [
        { ...SEED_BODY, shellInfluence: -1 },
        { ...SEED_BODY, leagueTier: 'third' },
      ].map(async (body) => ((await (await post('/api/admin/clubs/10/seed-ops', body, fx.env)).json()) as { error: string }).error),
    );
    expect(messages).toEqual(['队壳影响力应为 0-10000 的数值', '联赛级别只能是 premier（顶级）或 second（次级）']);
    expect(sqlGet(fx.sqlite, 'SELECT COUNT(*) AS n FROM stadiums')).toEqual({ n: 0 });
    expect(sqlGet(fx.sqlite, 'SELECT COUNT(*) AS n FROM club_facilities')).toEqual({ n: 0 });
    expect(auditCount(fx.sqlite)).toBe(0);
    expect((await post('/api/admin/clubs/4040/seed-ops', SEED_BODY, fx.env)).status).toBe(404);
  });
});

describe('权限：四个端点都要 club.clubs.manage', () => {
  it('无权限的会话一律 403，未登录 401，且一个字节都不落库', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    stubMachineFetch();
    expect((await get('/api/admin/clubs/10/cpu-convert', fx.env, 'tok-coach')).status).toBe(403);
    const calls: [string, unknown][] = [
      ['/api/admin/clubs/10/rename-tour', { name: '曼城' }],
      ['/api/admin/clubs/10/rename-local', { name: '曼城' }],
      ['/api/admin/clubs/10/seed-ops', { stadiumName: '球场', shellInfluence: 0, bonusPoints: 0, leagueTier: 'second' }],
    ];
    for (const [path, body] of calls) {
      expect((await post(path, body, fx.env, 'tok-coach')).status).toBe(403);
    }
    // 未登录：GET/POST 都先撞 401（鉴权在鉴权层挡下，不进业务）
    expect((await app.request('/api/admin/clubs/10/cpu-convert', { method: 'GET' }, fx.env)).status).toBe(401);
    expect(
      (
        await app.request(
          '/api/admin/clubs/10/rename-tour',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"曼城"}' },
          fx.env,
        )
      ).status,
    ).toBe(401);
    expect(sqlGet(fx.sqlite, 'SELECT name, is_cpu FROM clubs WHERE id = 10')).toEqual({ name: '曼城 (CPU)', is_cpu: 1 });
    expect(sqlGet(fx.sqlite, 'SELECT COUNT(*) AS n FROM stadiums')).toEqual({ n: 0 });
    expect(machineRequests).toEqual([]);
    expect(auditCount(fx.sqlite)).toBe(0);
  });
});

describe('交付 3：GET /clubs 的 isCpu 与 overview 的 cpuClubs', () => {
  it('列表逐队带 isCpu；overview 数出 CPU 队数', async () => {
    const fx = freshEnv();
    seedCpuClub(fx, 10, '曼城 (CPU)');
    fx.sqlite
      .prepare('INSERT INTO clubs (id, name, status, created_at) VALUES (?, ?, ?, ?)')
      .run(50, '人类队', 'active', '2026-01-01T00:00:00Z');
    const list = (await (await get('/api/admin/clubs', fx.env)).json()) as { clubs: { id: number; isCpu: boolean }[] };
    expect(list.clubs.map((c) => ({ id: c.id, isCpu: c.isCpu }))).toEqual([
      { id: 10, isCpu: true },
      { id: 50, isCpu: false },
    ]);
    // overview 是 isolate 级 60s 缓存，用例间必须清，否则读到别的用例留下的计数
    resetOverviewCache();
    const overview = (await (await get('/api/admin/overview', fx.env)).json()) as { clubs: number; cpuClubs: number };
    expect(overview).toMatchObject({ clubs: 2, cpuClubs: 1 });
  });
});

// 跨仓契约金标准（v6.27.0）：改名是 team-upsert 之后同一条签名通道的第二个写动作。
// 期望 hex 是用 node:crypto 独立算出来写死的**死值**——两侧任一方偷改算法、路径或签名串都会红。
describe('跨仓契约金标准：team-rename（v6.27.0）', () => {
  const SECRET = 'increment-37-golden-secret';
  const GOLDEN_TS = '1767225600'; // 2026-01-01T00:00:00Z
  const GOLDEN_RAW = '{"id":700,"name":"Arsenal"}';
  const GOLDEN_HEX = 'd6dadafa1c903870a8b19747c094e6ace3a52beb402e7ded8530e10458305cba';

  it('路径常量逐字', () => {
    expect(TEAM_RENAME_PATH).toBe('/api/internal/team-rename');
  });

  it('签名串逐字 POST|path|ts|raw，HMAC-SHA256 小写 hex（与 team-upsert 同一口径）', async () => {
    expect(await hmacHex(SECRET, `POST|${TEAM_RENAME_PATH}|${GOLDEN_TS}|${GOLDEN_RAW}`)).toBe(GOLDEN_HEX);
    // 同一份输入的另一种实现必须同值（crypto.subtle vs node:crypto）
    expect(createHmac('sha256', SECRET).update(`POST|${TEAM_RENAME_PATH}|${GOLDEN_TS}|${GOLDEN_RAW}`).digest('hex')).toBe(GOLDEN_HEX);
  });

  it('出站请求：冻结时钟后 URL / 头名 / raw body / 签名逐字（字段顺序 id 在前）', async () => {
    const fx = freshEnv();
    fx.env.TEAM_SYNC_SECRET = SECRET;
    stubMachineFetch();
    machineReply = () => ({ status: 200, json: { ok: true, renamed: true, name: 'Arsenal' } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Number(GOLDEN_TS) * 1000));
    try {
      expect(await pushTeamRename(fx.env, { id: 700, name: 'Arsenal' })).toEqual({ ok: true, renamed: true, name: 'Arsenal' });
    } finally {
      vi.useRealTimers();
    }
    expect(machineRequests).toHaveLength(1);
    expect(machineRequests[0].url).toBe(`${TOUR_BASE}${TEAM_RENAME_PATH}`);
    expect(machineRequests[0].path).toBe('/api/internal/team-rename');
    expect(machineRequests[0].body).toBe(GOLDEN_RAW);
    expect(Object.keys(machineRequests[0].headers).map((k) => k.toLowerCase()).sort()).toEqual([
      'content-type',
      'x-sign',
      'x-timestamp',
    ]);
    expect(machineRequests[0].headers['x-timestamp']).toBe(GOLDEN_TS);
    expect(machineRequests[0].headers['x-sign']).toBe(GOLDEN_HEX);
    // 独立复算（不依赖时钟冻结是否生效）：签的就是发出去的那一份 raw
    expect(machineRequests[0].headers['x-sign']).toBe(
      createHmac('sha256', SECRET)
        .update(`POST|${TEAM_RENAME_PATH}|${machineRequests[0].headers['x-timestamp']}|${machineRequests[0].body}`)
        .digest('hex'),
    );
  });

  it('未配 TOUR_API_BASE / TEAM_SYNC_SECRET → ok:false 文案（与 team-upsert 同款），不出站', async () => {
    const fx = freshEnv();
    stubMachineFetch();
    fx.env.TOUR_API_BASE = undefined;
    expect(await pushTeamRename(fx.env, { id: 700, name: 'Arsenal' })).toEqual({
      ok: false,
      message: '未配置 TOUR_API_BASE，无法同步到赛事系统',
    });
    const fx2 = freshEnv();
    fx2.env.TEAM_SYNC_SECRET = undefined;
    expect(await pushTeamRename(fx2.env, { id: 700, name: 'Arsenal' })).toEqual({
      ok: false,
      message: '未配置 TEAM_SYNC_SECRET，无法同步到赛事系统',
    });
    expect(machineRequests).toEqual([]);
  });

  it('对手方非 200 → ok:false 透出 status/error/message；非 JSON 用兜底文案；fetch 抛错不冒泡', async () => {
    const fx = freshEnv();
    stubMachineFetch();
    machineReply = () => ({ status: 409, json: { error: 'name_taken', message: '名字重复' } });
    expect(await pushTeamRename(fx.env, { id: 700, name: 'Arsenal' })).toEqual({
      ok: false,
      status: 409,
      error: 'name_taken',
      message: '名字重复',
    });
    machineReply = () => ({ status: 500, json: {} });
    expect(await pushTeamRename(fx.env, { id: 700, name: 'Arsenal' })).toEqual({
      ok: false,
      status: 500,
      error: undefined,
      message: '赛事系统拒绝同步（HTTP 500）',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    expect(await pushTeamRename(fx.env, { id: 700, name: 'Arsenal' })).toEqual({ ok: false, message: '赛事系统不可达' });
  });

  it('尾斜杠的基址不会拼出双斜杠（与 pushTeamToTour 同款 replace(/\\/+$/,"")）', async () => {
    const fx = freshEnv();
    fx.env.TOUR_API_BASE = `${TOUR_BASE}/`;
    stubMachineFetch();
    await pushTeamRename(fx.env, { id: 700, name: 'Arsenal' });
    expect(machineRequests[0].url).toBe(`${TOUR_BASE}${TEAM_RENAME_PATH}`);
  });
});
