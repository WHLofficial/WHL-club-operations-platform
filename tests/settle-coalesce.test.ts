// v6.40.2 惰性结算合并与读路径往返预算（TC-SETTLE-01..03 / TC-BUDGET-01）。
//
// 背景（性能审计）：生产实测每次 D1 往返约 220ms，而「摊开谈判桌」要 13 条往返（详情）+
// 14 条（列表）——整跑一次惰性结算就是其中 11 条。三条改动落在这里：
//   ① 读路径传 coalesceMs=30_000：窗口内直接回上一次 summary、并发共享同一次在飞结算；
//   ② 写路径动作前先真结算（不传 coalesceMs）⇒ 语义不变，只是把「刚过期」的单先收口；
//   ③ 结算里的三段扫描合一次 batch、路由自身读合一次 batch。
// 本文件用「往返计数器」钉住这三条：计数口径 = D1 语句终止操作（first/all/run）与 batch 各算一次往返
// （与真实 D1 一致：prepare 本身不出网）。
//
// 变异验证对应关系（开发期手动三改三红，测试常驻断言）：
//   ① 去掉只读入口的 coalesceMs → TC-SETTLE-01/02 变红
//   ② 去掉 settleOverdue 的在飞共享 → TC-SETTLE-02 变红
//   ③ 去掉写端点的 settleOverdue 调用 → TC-SETTLE-03 变红（报错文案会退回「球员已不在卖家阵容里」）
//   ④ 拆掉路由层的 db.batch → TC-BUDGET-01 变红
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetSettleCoalesce } from '../src/worker/market-settle.ts';

/** 往返计数：trips = 语句终止操作数 + batch 数；sqls 留原文供「哪条扫描跑了几次」判定 */
interface Counter {
  trips: number;
  sqls: string[];
}

interface RawStmt {
  bind(...args: unknown[]): RawStmt;
  first<T = Record<string, unknown>>(...args: unknown[]): Promise<T | null>;
  all<T = Record<string, unknown>>(...args: unknown[]): Promise<{ results: T[] }>;
  run(...args: unknown[]): Promise<unknown>;
  exec(): unknown;
}

/** 把测试 D1 包一层计数器（batch 内的语句不重复计——真实 D1 里 batch 只出一次网） */
function countingD1(sqlite: DatabaseSync, counter: Counter): D1Database {
  const base = createTestD1(sqlite) as unknown as { prepare(sql: string): RawStmt; batch(stmts: RawStmt[]): Promise<unknown> };
  const raw = new WeakMap<object, RawStmt>();
  const wrap = (stmt: RawStmt): RawStmt => {
    const w: RawStmt = {
      bind: (...args: unknown[]) => wrap(stmt.bind(...args)),
      first: (...a: unknown[]) => {
        counter.trips += 1;
        return stmt.first(...a);
      },
      all: (...a: unknown[]) => {
        counter.trips += 1;
        return stmt.all(...a);
      },
      run: (...a: unknown[]) => {
        counter.trips += 1;
        return stmt.run(...a);
      },
      exec: () => {
        counter.trips += 1;
        return stmt.exec();
      },
    };
    raw.set(w, stmt);
    return w;
  };
  return {
    prepare: (sql: string) => {
      counter.sqls.push(sql);
      return wrap(base.prepare(sql));
    },
    batch: (stmts: RawStmt[]) => {
      counter.trips += 1;
      return base.batch(stmts.map((s) => raw.get(s) ?? s));
    },
  } as unknown as D1Database;
}

/** 惰性结算里的「孤儿单自愈扫」——每真跑一次结算恰好出现一次 */
const ORPHAN_SCAN = "FROM offers WHERE status = 'accepted' AND listing_id IS NULL";

/** 取「从此刻起」的语句游标：counter 是累计的，造数据的写路径自己也会跑一次结算 */
function cursor(counter: Counter): number {
  return counter.sqls.length;
}
function settleRunsSince(counter: Counter, from: number): number {
  return counter.sqls.slice(from).filter((sql) => sql.includes(ORPHAN_SCAN)).length;
}

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
  counter: Counter;
}

// 两支真人队（1 阿森纳 / 2 拜仁）；uid 2 绑 club1（卖方）、uid 5 绑 club2（买方）
function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const kv = new Map<string, string>();
  const counter: Counter = { trips: 0, sqls: [] };
  const env: Env = {
    DB: countingD1(sqlite, counter),
    TOUR_DB: createTestD1(tourDb()),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
  for (const [uid, token] of [
    [2, 'tok-coach'],
    [5, 'tok-coach2'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, kv, counter };
}

function tourDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (2, '教练乙', 'coach', 0, 0), (5, '教练戊', 'coach', 0, 0);`,
  );
  return sqlite;
}

function seedWorld(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '拜仁', 'premier', 'active');
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z'), (2, 5, '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status, fc_id) VALUES
      (1, 'uid1', '球员甲', 1, 'ST', 80, 85, 'normal', 11),
      (2, 'uid2', '球员乙', 2, 'CM', 75, 82, 'normal', 12);
    INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES
      (1, 1, 50, 2, 'formal', 'import', '2026-07-01', 1),
      (2, 2, 50, 2, 'formal', 'import', '2026-07-01', 1);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 100, '2026-07-01T00:00:00Z'), (2, 100, '2026-07-01T00:00:00Z');
  `);
}

function get(path: string, token: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${token}` } }, env);
}

function post(path: string, body: unknown, token: string, env: Env) {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` }, body: JSON.stringify(body) },
    env,
  );
}

/** 买方（club2）给 club1 的球员甲送报价，落一单 pending（返回单号） */
async function placeOffer(fx: Fixture): Promise<number> {
  const res = await post('/api/offers', { playerId: 1, amount: 30 }, 'tok-coach2', fx.env);
  expect(res.status).toBe(201);
  const out = (await res.json()) as { offerId: number };
  return out.offerId;
}

describe('v6.40.2 惰性结算合并（TC-SETTLE-01..03）', () => {
  it('TC-SETTLE-01 读路径 30s 合并命中：第二次访问不再真结算，载荷照旧', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    await placeOffer(fx);
    const from = cursor(fx.counter); // 送报价走的是写路径（不合并），从这里开始数读路径的结算

    const first = await get('/api/offers?box=out', 'tok-coach2', fx.env);
    expect(first.status).toBe(200);
    expect(settleRunsSince(fx.counter, from), '第一次访问要真跑一次结算').toBe(1);

    const second = await get('/api/offers?box=out', 'tok-coach2', fx.env);
    expect(second.status).toBe(200);
    expect(settleRunsSince(fx.counter, from), '30s 窗口内第二次访问直接回上次 summary，不再跑结算').toBe(1);
    expect(await second.json()).toEqual(await first.json());

    // 窗口清掉（等价于生产里 30 秒后的下一次访问）⇒ 又真跑
    resetSettleCoalesce();
    const third = await get('/api/offers?box=out', 'tok-coach2', fx.env);
    expect(third.status).toBe(200);
    expect(settleRunsSince(fx.counter, from)).toBe(2);
  });

  it('TC-SETTLE-02 并发读共享同一次在飞结算（单飞），两边的数据都对', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    await placeOffer(fx);
    resetSettleCoalesce(); // 上面那次送报价走的是写路径（不合并），这里显式清一次，确保从零开始
    const from = cursor(fx.counter);

    const [a, b] = await Promise.all([
      get('/api/offers?box=out', 'tok-coach2', fx.env),
      get('/api/offers?box=out', 'tok-coach2', fx.env),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(settleRunsSince(fx.counter, from), '两个并发读只该有一次结算在飞').toBe(1);
    expect(await a.json()).toEqual(await b.json());
  });

  it('TC-SETTLE-03 写路径动作前先真结算：球员刚离开卖家 ⇒ 同意被拒成「已经了结」', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const offerId = await placeOffer(fx);
    // 球员离队（模拟「这单此刻已经该过期」），但不走任何读路径
    fx.sqlite.exec(`UPDATE players SET club_id = NULL, status = 'free' WHERE id = 1`);

    const res = await post(`/api/offers/${offerId}/accept`, {}, 'tok-coach', fx.env);
    expect(res.status).toBe(409);
    // 文案是 settle 先收口后的那条：若没先结算，acceptOffer 会先撞「球员已不在卖家阵容里」
    expect(((await res.json()) as { error: string }).error).toContain('已经了结');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', offerId)?.status).toBe('expired');
    // 冻结退回买方（过期收口的副作用，与惰性结算同源）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM fund_holds WHERE status = 'held'")?.n).toBe(0);
  });
});

describe('v6.40.2 读路径往返预算（TC-BUDGET-01）', () => {
  it('TC-BUDGET-01 详情冷读 ≤8 条往返（实测 8）、合并命中 ≤4 条（实测 3）（改前 13 条）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const offerId = await placeOffer(fx);
    resetSettleCoalesce();

    const cold = fx.counter.trips;
    const first = await get(`/api/offers/${offerId}`, 'tok-coach', fx.env);
    expect(first.status).toBe(200);
    const coldTrips = fx.counter.trips - cold;
    expect(coldTrips, `详情冷读往返 ${coldTrips} 条（改前 13 条：两次认证探针 + 11 条结算 + 详情 + 事件）`).toBeLessThanOrEqual(8);

    const warm = fx.counter.trips;
    const second = await get(`/api/offers/${offerId}`, 'tok-coach', fx.env);
    expect(second.status).toBe(200);
    const warmTrips = fx.counter.trips - warm;
    expect(warmTrips, `合并命中往返 ${warmTrips} 条（认证探针 1 + 详情 batch 1）`).toBeLessThanOrEqual(4);
    expect(warmTrips).toBeLessThan(coldTrips);
  });

  it('TC-BUDGET-01 列表冷读 ≤8 条往返（实测 8）、合并命中 ≤4 条（实测 3）（改前 14 条）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    await placeOffer(fx);
    resetSettleCoalesce();

    const cold = fx.counter.trips;
    const first = await get('/api/offers?box=out', 'tok-coach2', fx.env);
    expect(first.status).toBe(200);
    const coldTrips = fx.counter.trips - cold;
    expect(coldTrips, `列表冷读往返 ${coldTrips} 条（改前 14 条：两次认证探针 + 11 条结算 + 列表 + 2 计数）`).toBeLessThanOrEqual(8);

    const warm = fx.counter.trips;
    const second = await get('/api/offers?box=out', 'tok-coach2', fx.env);
    expect(second.status).toBe(200);
    const warmTrips = fx.counter.trips - warm;
    expect(warmTrips, `合并命中往返 ${warmTrips} 条（认证探针 1 + 列表 batch 1）`).toBeLessThanOrEqual(4);
  });
});
