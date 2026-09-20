// 进程内守护（增量 23）：固定窗口限流 + TTL SWR 缓存；公开 GET 挂点行为
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { assertPublicRate, cachedJson, canonicalQuery, memoryRateLimit, resetGuards } from '../src/lib/guard.ts';

function freshEnv(): Env {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  sqlite.exec(`INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '测试队', 'premier', 'active');
    INSERT INTO players (uid, name, club_id, position, ca, pa, status) VALUES ('fc1', '甲', 1, 'ST', 70, 80, 'normal');`);
  const tour = new DatabaseSync(':memory:');
  tour.exec(`CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);`);
  return {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {} as never,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
}

function get(path: string, env: Env, headers?: Record<string, string>) {
  return app.request(`http://localhost${path}`, { headers }, env);
}

describe('memoryRateLimit 固定窗口', () => {
  it('窗口内计数，超限拒绝，新窗口放行', () => {
    resetGuards();
    const base = 1_700_000_000_000;
    const realNow = Date.now;
    Date.now = () => base;
    try {
      for (let i = 0; i < 3; i++) expect(memoryRateLimit('k', 3, 1_000)).toBe(true);
      expect(memoryRateLimit('k', 3, 1_000)).toBe(false);
      Date.now = () => base + 1_001;
      expect(memoryRateLimit('k', 3, 1_000)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('不同 key 互不影响', () => {
    resetGuards();
    expect(memoryRateLimit('a', 1, 60_000)).toBe(true);
    expect(memoryRateLimit('a', 1, 60_000)).toBe(false);
    expect(memoryRateLimit('b', 1, 60_000)).toBe(true);
  });
});

describe('cachedJson TTL + SWR', () => {
  it('TTL 内复用缓存（loader 只跑一次）', async () => {
    resetGuards();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { n: calls };
    };
    expect(await cachedJson('x', 60_000, loader)).toEqual({ n: 1 });
    expect(await cachedJson('x', 60_000, loader)).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it('过期回旧值并后台刷新（SWR），刷新完成后取新值', async () => {
    resetGuards();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { n: calls };
    };
    const base = 1_700_000_000_000;
    const realNow = Date.now;
    let nowMs = base;
    Date.now = () => nowMs;
    try {
      expect(await cachedJson('y', 1_000, loader)).toEqual({ n: 1 }); // 首次装载
      // 越过 TTL：SWR 先回旧值，刷新在后台进行
      nowMs = base + 2_000;
      expect(await cachedJson('y', 1_000, loader)).toEqual({ n: 1 });
      await new Promise((r) => setTimeout(r, 0)); // 让后台刷新落地
      expect(await cachedJson('y', 1_000, loader)).toEqual({ n: 2 });
    } finally {
      Date.now = realNow;
    }
    expect(calls).toBe(2);
  });

  it('ttl<=0 旁路：每次都执行 loader', async () => {
    resetGuards();
    let calls = 0;
    const loader = async () => ({ n: ++calls });
    expect(await cachedJson('z', 0, loader)).toEqual({ n: 1 });
    expect(await cachedJson('z', 0, loader)).toEqual({ n: 2 });
    expect(await cachedJson('z', -1, loader)).toEqual({ n: 3 });
  });

  it('条数上限：键外部可控，超限淘汰最旧，不无限长住内存', async () => {
    resetGuards();
    let calls = 0;
    const loader = async () => ({ n: ++calls });
    // 灌 70 个不同键（上限 64）：最旧的 7 条应被淘汰
    for (let i = 0; i < 70; i++) await cachedJson(`k${i}`, 60_000, loader);
    const afterFill = calls;
    // 最新键仍命中缓存（loader 不再跑）
    await cachedJson('k69', 60_000, loader);
    expect(calls).toBe(afterFill);
    // 最旧键已被淘汰，需重新装载
    await cachedJson('k0', 60_000, loader);
    expect(calls).toBe(afterFill + 1);
  });

  it('canonicalQuery：参数顺序不同归一到同一键', () => {
    expect(canonicalQuery('http://x/api/players?b=2&a=1')).toBe('a=1&b=2');
    expect(canonicalQuery('http://x/api/players?a=1&b=2')).toBe(canonicalQuery('http://x/api/players?b=2&a=1'));
    expect(canonicalQuery('http://x/api/players')).toBe('');
  });
});

describe('公开 GET 挂点（限流 + 缓存）', () => {
  it('限流：同一 IP 第 61 次请求 429', async () => {
    resetGuards();
    const env = freshEnv();
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await get('/api/clubs/directory', env, { 'CF-Connecting-IP': '1.2.3.4' })).status;
    }
    expect(last).toBe(429);
    // 其他 IP 不受影响
    expect((await get('/api/clubs/directory', env, { 'CF-Connecting-IP': '5.6.7.8' })).status).toBe(200);
  });

  it('缓存：PUBLIC_CACHE_TTL_MS 配了以后，同 query 第二次命中缓存', async () => {
    resetGuards();
    const env = freshEnv();
    env.PUBLIC_CACHE_TTL_MS = '60000';
    const first = await (await get('/api/players?limit=1', env)).json();
    const second = await (await get('/api/players?limit=1', env)).json();
    expect(second).toEqual(first);
    // 不同 query 各自缓存（筛掉 normal 后 total=0，与上面不同）
    const other = await (await get('/api/players?limit=1&status=listed', env)).json<{ total: number }>();
    expect(other.total).not.toBe((second as { total: number }).total);
    // 参数顺序不同 → 归一后同一键：改库后换序请求仍回缓存旧值（键没归一就会读到新值）
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc9', '丙', 'ST', 55, 65, 'normal')`,
    ).run();
    const reordered = await (await get('/api/players?status=listed&limit=1', env)).json();
    expect(reordered).toEqual(other);
  });

  it('未配 PUBLIC_CACHE_TTL_MS：旁路，数据变更立即可见', async () => {
    resetGuards();
    const env = freshEnv();
    const before = await (await get('/api/players?limit=5', env)).json<{ total: number }>();
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc2', '乙', 'ST', 60, 70, 'normal')`,
    ).run();
    const after = await (await get('/api/players?limit=5', env)).json<{ total: number }>();
    expect(after.total).toBe(before.total + 1);
  });

  it('assertPublicRate 用 CF-Connecting-IP 分桶', () => {
    resetGuards();
    const mk = (ip: string) => ({ req: { header: () => ip } });
    expect(() => assertPublicRate(mk('9.9.9.9'), 's')).not.toThrow();
    expect(() => assertPublicRate(mk('8.8.8.8'), 's')).not.toThrow();
  });
});
