// 进程内守护（增量 23）：固定窗口限流 + TTL SWR 缓存；公开 GET 挂点行为
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createTestKV } from './d1.ts';
import {
  assertPublicRate,
  cachedJson,
  canonicalQuery,
  getCacheEpoch,
  memoryRateLimit,
  purgePublicCaches,
  resetGuards,
} from '../src/lib/guard.ts';
import {
  CACHE_TTL_MS,
  EPOCH_FAIL_SHORT_MS,
  PUBLIC_SCOPES,
  scopesForWritePath,
  ttlForScope,
} from '../src/lib/cache-policy.ts';

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
    // 真实可用的 KV 桩（代际版本号要读写它）；不配 PUBLIC_CACHE_TTL_MS ⇒ 走分级表
    SESSION_KV: createTestKV() as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
}

function get(path: string, env: Env, headers?: Record<string, string>) {
  return app.request(`http://localhost${path}`, { headers }, env);
}

function post(path: string, env: Env, headers?: Record<string, string>) {
  return app.request(`http://localhost${path}`, { method: 'POST', headers }, env);
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

  it('后台刷新失败：保留旧值但复位 refreshing，下个请求会再试（不会永久停在刷新中）', async () => {
    resetGuards();
    let calls = 0;
    let fail = false;
    const loader = async () => {
      calls += 1;
      if (fail) throw new Error('loader 挂了');
      return { n: calls };
    };
    const base = 1_700_000_000_000;
    const realNow = Date.now;
    let nowMs = base;
    Date.now = () => nowMs;
    try {
      expect(await cachedJson('r', 1_000, loader)).toEqual({ n: 1 }); // 首次装载
      fail = true;
      nowMs = base + 2_000; // 越过 TTL：回旧值 + 后台刷新（这次失败）
      expect(await cachedJson('r', 1_000, loader)).toEqual({ n: 1 });
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toBe(2);
      // 失败若没复位 refreshing，下面这次过期就不会再触发刷新、永远回旧值
      fail = false;
      nowMs = base + 4_000;
      expect(await cachedJson('r', 1_000, loader)).toEqual({ n: 1 }); // 仍回旧值
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toBe(3); // 关键：又试了一次
      expect(await cachedJson('r', 1_000, loader)).toEqual({ n: 3 });
    } finally {
      Date.now = realNow;
    }
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
    const first = await (await get('/api/players?limit=1', env)).json<{ players: unknown[] }>();
    const second = await (await get('/api/players?limit=1', env)).json<{ players: unknown[] }>();
    expect(second).toEqual(first);
    expect(first.players.length).toBe(1);
    // 不同 query 各自缓存（status=listed 一条都不匹配）
    const listed = await (await get('/api/players?status=listed&limit=1', env)).json<{ players: unknown[] }>();
    expect(listed.players.length).toBe(0);
    // 参数顺序不同 → 归一后同一键：改库后换序请求仍回缓存旧值（键没归一就会读到新值）
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc9', '丙', 'ST', 55, 65, 'listed')`,
    ).run();
    const reordered = await (await get('/api/players?limit=1&status=listed', env)).json<{ players: unknown[] }>();
    expect(reordered).toEqual(listed);
  });

  it('显式配 0：旁路，数据变更立即可见', async () => {
    resetGuards();
    const env = freshEnv();
    // 增量 28：未配 = 走分级 TTL（生产口径），旁路必须显式声明
    env.PUBLIC_CACHE_TTL_MS = '0';
    const before = await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>();
    expect(before.players.length).toBe(0);
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc2', '乙', 'ST', 60, 70, 'listed')`,
    ).run();
    const after = await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>();
    expect(after.players.length).toBe(1);
  });

  it('assertPublicRate 用 CF-Connecting-IP 分桶', () => {
    resetGuards();
    const mk = (ip: string) => ({ req: { header: () => ip } });
    expect(() => assertPublicRate(mk('9.9.9.9'), 's')).not.toThrow();
    expect(() => assertPublicRate(mk('8.8.8.8'), 's')).not.toThrow();
  });
});

describe('分级缓存口径（增量 28）', () => {
  it('ttlForScope：未配走分级表，显式给数（含 0）就照它，非法值回落', () => {
    expect(ttlForScope('players')).toBe(3_600_000);
    expect(ttlForScope('roster')).toBe(86_400_000);
    expect(ttlForScope('clubs')).toBe(86_400_000);
    expect(CACHE_TTL_MS.players).toBe(3_600_000);
    expect(ttlForScope('players', '60000')).toBe(60_000);
    expect(ttlForScope('roster', '0')).toBe(0);
    expect(ttlForScope('players', 'abc')).toBe(3_600_000);
    expect(ttlForScope('players', undefined)).toBe(3_600_000);
  });

  it('scopesForWritePath：按路径段边界匹配，公开只读目录不算写路径', () => {
    expect(scopesForWritePath('/api/club')).toEqual([...PUBLIC_SCOPES]);
    expect(scopesForWritePath('/api/club/squad')).toEqual([...PUBLIC_SCOPES]);
    expect(scopesForWritePath('/api/admin/players/1')).toEqual([...PUBLIC_SCOPES]);
    // 球员成长会 UPDATE players 的 ca/badges_*，列表的档位与影响力吃这几个字段 ⇒ 必须算写路径
    expect(scopesForWritePath('/api/growth/levelup/7')).toEqual([...PUBLIC_SCOPES]);
    expect(scopesForWritePath('/api/cron/tick')).toEqual([...PUBLIC_SCOPES]);
    // `/api/clubs/directory` 是公开只读目录，不能被 `/api/club` 前缀捞进去
    expect(scopesForWritePath('/api/clubs/directory')).toEqual([]);
    // 只写通知 / 只写会话的路径不在公开 scope 里
    expect(scopesForWritePath('/api/notifications/read')).toEqual([]);
    expect(scopesForWritePath('/api/health')).toEqual([]);
    expect(scopesForWritePath('/api/players')).toEqual([]);
  });

  it('默认分级 TTL（不配变量）：players 1h 生效，同 query 第二次命中缓存', async () => {
    resetGuards();
    const env = freshEnv();
    expect(env.PUBLIC_CACHE_TTL_MS).toBeUndefined();
    const first = await (await get('/api/players?limit=1', env)).json<{ players: unknown[] }>();
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc7', '庚', 'ST', 60, 70, 'normal')`,
    ).run();
    const second = await (await get('/api/players?limit=1', env)).json<{ players: unknown[] }>();
    expect(second).toEqual(first);
  });
});

describe('代际键 purge（增量 28）', () => {
  it('purgePublicCaches 直接调用：版本号 +1 后列表立刻看到新数据', async () => {
    resetGuards();
    const env = freshEnv();
    const before = await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>();
    expect(before.players.length).toBe(0);
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc3', '丙', 'ST', 60, 70, 'listed')`,
    ).run();
    // 缓存还在：看不到新数据
    expect((await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>()).players.length).toBe(0);
    await purgePublicCaches(env);
    expect((await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>()).players.length).toBe(1);
  });

  it('一次 purge 只花一次 KV 写：三个 scope 共用同一个版本号', async () => {
    resetGuards();
    const env = freshEnv();
    expect(PUBLIC_SCOPES.length).toBe(3);
    let puts = 0;
    env.SESSION_KV = {
      get: async () => null,
      put: async () => {
        puts += 1;
      },
    } as unknown as KVNamespace;
    await purgePublicCaches(env);
    // SESSION_KV 与登录会话共用，免费档 1000 写/天：按 scope 各写一份就是 3 倍成本、零收益
    expect(puts).toBe(1);
  });

  it('写路径 middleware 挂钩：2xx 写请求后自动 purge（POST /api/cron/tick）', async () => {
    resetGuards();
    const env = freshEnv();
    const cached = await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>();
    expect(cached.players.length).toBe(0);
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc4', '丁', 'ST', 60, 70, 'listed')`,
    ).run();
    // CRON_KEY 未配 ⇒ tick 放行（既有语义），走 2xx ⇒ 中间件 purge
    expect((await post('/api/cron/tick', env)).status).toBe(200);
    expect((await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>()).players.length).toBe(1);
  });

  it('写路径 middleware 挂钩：非 2xx 不 purge（缓存原样保留）', async () => {
    resetGuards();
    const env = freshEnv();
    const cached = await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>();
    expect(cached.players.length).toBe(0);
    await env.DB.prepare(
      `INSERT INTO players (uid, name, position, ca, pa, status) VALUES ('fc5', '戊', 'ST', 60, 70, 'listed')`,
    ).run();
    expect((await post('/api/club/不存在的路径', env)).status).toBe(404);
    expect((await (await get('/api/players?status=listed&limit=5', env)).json<{ players: unknown[] }>()).players.length).toBe(0);
  });

  it('GET 不触发 purge（读请求不改版本号）', async () => {
    resetGuards();
    const env = freshEnv();
    const before = await getCacheEpoch(env);
    await get('/api/clubs/directory', env);
    await get('/api/players?limit=1', env);
    expect(await getCacheEpoch(env)).toEqual(before);
  });

  it('版本号读失败（fail-short）：按 60s 短 TTL，不拿长 TTL 当兜底', async () => {
    resetGuards();
    const env = freshEnv();
    env.SESSION_KV = {
      get: async () => {
        throw new Error('KV 抖动');
      },
      put: async () => undefined,
    } as unknown as KVNamespace;
    expect(await getCacheEpoch(env)).toEqual({ epoch: 0, degraded: true });
    expect(EPOCH_FAIL_SHORT_MS).toBe(60_000);

    let calls = 0;
    const loader = async () => ({ n: ++calls });
    const base = 1_700_000_000_000;
    const realNow = Date.now;
    let nowMs = base;
    Date.now = () => nowMs;
    try {
      expect(await cachedJson('k', 3_600_000, loader, { scope: 'players', env })).toEqual({ n: 1 });
      // 61s：长 TTL（1h）内，但降级后按 60s 算 ⇒ 该刷新了
      nowMs = base + 61_000;
      expect(await cachedJson('k', 3_600_000, loader, { scope: 'players', env })).toEqual({ n: 1 });
      await new Promise((r) => setTimeout(r, 0));
      expect(await cachedJson('k', 3_600_000, loader, { scope: 'players', env })).toEqual({ n: 2 });
    } finally {
      Date.now = realNow;
    }
  });
});

describe('L2 边缘 Cache API（增量 28）', () => {
  // Node 里没有 caches 全局（实测 typeof caches === 'undefined'）⇒ 打桩验证跨 isolate 复用
  function stubCaches(): { store: Map<string, Response>; restore(): void } {
    const store = new Map<string, Response>();
    const real = (globalThis as unknown as { caches?: unknown }).caches;
    (globalThis as unknown as { caches?: unknown }).caches = {
      default: {
        async match(req: Request) {
          const hit = store.get(req.url);
          return hit ? hit.clone() : undefined;
        },
        async put(req: Request, res: Response) {
          store.set(req.url, res);
        },
        async delete(req: Request) {
          return store.delete(req.url);
        },
      },
    };
    return {
      store,
      restore() {
        (globalThis as unknown as { caches?: unknown }).caches = real;
      },
    };
  }

  it('清 L1（模拟换 isolate）后仍从 L2 命中；purge 后旧代际键不可达', async () => {
    resetGuards();
    const env = freshEnv();
    const stub = stubCaches();
    try {
      let calls = 0;
      const loader = async () => ({ n: ++calls });
      expect(await cachedJson('k', 60_000, loader, { scope: 'players', env })).toEqual({ n: 1 });
      expect(stub.store.size).toBe(1);
      // 换 isolate：L1 与版本号记忆全清，但 L2 还在
      resetGuards();
      expect(await cachedJson('k', 60_000, loader, { scope: 'players', env })).toEqual({ n: 1 });
      expect(calls).toBe(1);
      // purge：版本号 +1 ⇒ 键变成 players:v1:k，旧条目不可达 ⇒ 必须重新装载
      await purgePublicCaches(env);
      expect(await cachedJson('k', 60_000, loader, { scope: 'players', env })).toEqual({ n: 2 });
      expect(calls).toBe(2);
      expect(stub.store.size).toBe(2);
    } finally {
      stub.restore();
    }
  });

  it('caches 缺失（Node/vitest）时 L2 静默旁路，不影响正确性', async () => {
    resetGuards();
    const env = freshEnv();
    let calls = 0;
    const loader = async () => ({ n: ++calls });
    expect(await cachedJson('k', 60_000, loader, { scope: 'players', env })).toEqual({ n: 1 });
    resetGuards();
    expect(await cachedJson('k', 60_000, loader, { scope: 'players', env })).toEqual({ n: 2 });
  });
});
