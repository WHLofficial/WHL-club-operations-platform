// v6.65.0 转会区读路径提速回归（测试计划 docs/test-plans/v6.65.0-market-hot-refresh.md）：
// 语句数锁（TC-CTX-01 / TC-AGG-02 / TC-NOTE-01/02）+ 聚合折进主查询的逐格口径（TC-AGG-01）
// + ctx 装配值语义（TC-CTX-02）+ 读端点结算挂 waitUntil（TC-WU-02）。
// 语句数锁全部走运行时 prepare/batch 计数代理（不碰源码文本，天然免疫行尾差异）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { loadMarketContext } from '../src/worker/market-context.ts';
import { settleOverdue, resetSettleCoalesce } from '../src/worker/market-settle.ts';
import { createConfigService, resetConfigCache } from '../src/core/config.ts';
import { createTestD1, applyMigrations, sqlGet, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

// prepare/batch 计数代理：被测面（路由 / 结算 / config 装配）只走这两个入口。
// batch 的内容不必拆看——批内语句必先经 prepare，sqls 里的条数 + batchSizes 的批次数即可锁形状。
function countingDb(db: D1Database) {
  const sqls: string[] = [];
  const batchSizes: number[] = [];
  const wrapped = {
    prepare(sql: string) {
      sqls.push(sql);
      return db.prepare(sql);
    },
    batch(stmts: unknown[]) {
      batchSizes.push(stmts.length);
      return (db as unknown as { batch(s: unknown[]): Promise<unknown> }).batch(stmts);
    },
  };
  return { db: wrapped as unknown as D1Database, sqls, batchSizes };
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (3, '教练丙', 'coach', 0, 0),
       (4, '教练丁', 'coach', 0, 0),
       (9, '观众', 'user', 0, 0);`,
  );
  tour.exec(TOUR_TEAM_SEED_SQL);
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
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-coach2'],
    [4, 'tok-coach3'],
    [9, 'tok-viewer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} }, env);
}

function post(path: string, body: unknown, token: string | undefined, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Cookie: `whl_session=${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env,
  );
}

let clubSeq = 9000;
async function createClub(fx: Fixture, name: string): Promise<number> {
  clubSeq += 1;
  const gameTeamId = 9001 + ((clubSeq - 9001) % 100);
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier', gameTeamId, country: 14 }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { club: { id: number } }).club.id;
}

interface MarketFixture extends Fixture {
  sellerClub: number;
  bidderClub: number;
  richClub: number;
}

// 三俱乐部（卖方 100m / 竞标 50m / 豪门 90m）+ 开放窗口 + 球员（RC 20、身价 30 → 挂牌区间 [10, 30]）。
// 与 market-routes.test.ts 的 seedMarket 同构，第三队余额改 90 以便连续两次抬价。
async function seedMarket(fx: Fixture): Promise<MarketFixture> {
  const sellerClub = await createClub(fx, '挂牌联');
  const bidderClub = await createClub(fx, '竞标队');
  const richClub = await createClub(fx, '豪门队');
  const binds: [number, string][] = [
    [sellerClub, 'tok-coach'],
    [bidderClub, 'tok-coach2'],
    [richClub, 'tok-coach3'],
  ];
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of binds) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    const bind = await post('/api/clubs/bind', { code }, token, fx.env);
    expect(bind.status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${sellerClub}, 100, '2026-07-01T00:00:00Z'), (${bidderClub}, 50, '2026-07-01T00:00:00Z'), (${richClub}, 90, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${sellerClub}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${bidderClub}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z'),
       (${richClub}, 'opening_import', 90, 90, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
       (10, 'fc10', '王牌', ${sellerClub}, 'ST', 26, 85, 88, 30, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 10, ${sellerClub}, 20, 2, 'formal', 1, '2026-07-01');`,
  );
  return { ...fx, sellerClub, bidderClub, richClub };
}

async function seedSecondPlayer(fx: Fixture, sellerClub: number, id = 11, uid = 'fc11'): Promise<number> {
  fx.sqlite.exec(
    `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES (${id}, '${uid}', '替补', ${sellerClub}, 'CM', 24, 75, 82, 20, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES (${id}, ${id}, ${sellerClub}, 10, 1, 'formal', 1, '2026-07-01');`,
  );
  return id;
}

async function listPlayer(mf: MarketFixture, playerId: number, askPrice: number, token = 'tok-coach') {
  return post('/api/market/listings', { playerId, askPrice }, token, mf.env);
}

interface ListingDto {
  id: number;
  highestBid: number | null;
  bidCount: number;
  highestBidder: { id: number; name: string } | null;
  firstBidPending: boolean;
}

describe('v6.65.0 转会区读路径提速', () => {
  it('TC-CTX-01 loadMarketContext 冷缓存只发 1 条 config 查询（变异拆回 11 单键必红）', async () => {
    const fx = freshEnv();
    const { db, sqls } = countingDb(fx.env.DB);
    const ctx = await loadMarketContext(db);
    expect(ctx.bidStepMin).toBe(1);
    expect(sqls.filter((s) => s.includes('FROM config')).length).toBe(1);
  });

  it('TC-CTX-02 ctx 值语义逐格：覆盖生效、坏值回落默认、缺行落默认', async () => {
    const fx = freshEnv();
    const config = createConfigService(fx.env.DB);
    await config.set('listing_floor_coefs', '0.7,0.6');
    await config.set('deadline_hours', '20,22');
    await config.set('bid_step_min', 'abc');
    const ctx = await loadMarketContext(fx.env.DB);
    expect(ctx.floorRc).toBe(0.7);
    expect(ctx.floorValue).toBe(0.6);
    expect(ctx.deadlineHours).toEqual([20, 22]);
    expect(ctx.bidStepMin).toBe(1);
    expect(ctx.silenceHours).toBe(3);
  });

  it('TC-AGG-01 聚合折进主查询后口径逐格不变（无出价 / 多次出价 / 旧价被顶掉 / 领先方）', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15); // 挂牌 1
    const p2 = await seedSecondPlayer(fx, mf.sellerClub);
    await listPlayer(mf, p2, 10); // 挂牌 2
    const p3 = await seedSecondPlayer(fx, mf.sellerClub, 12, 'fc12');
    await listPlayer(mf, p3, 8); // 挂牌 3（无人出价）
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    await post('/api/market/listings/2/bids', { amount: 12 }, 'tok-coach2', fx.env);
    // 豪门队抬到 18：旧 active（15）被顶掉，领先方必须是豪门队而不是历史出价方
    await post('/api/market/listings/1/bids', { amount: 18 }, 'tok-coach3', fx.env);
    const res = await get('/api/market/listings?status=all', undefined, fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: ListingDto[] };
    const byId = new Map(body.listings.map((l) => [l.id, l]));
    const l1 = byId.get(1)!;
    const l2 = byId.get(2)!;
    const l3 = byId.get(3)!;
    expect(l1.highestBid).toBe(18);
    expect(l1.bidCount).toBe(2);
    expect(l1.highestBidder).toEqual({ id: mf.richClub, name: '豪门队' });
    expect(l1.firstBidPending).toBe(false);
    expect(l2.highestBid).toBe(12);
    expect(l2.bidCount).toBe(1);
    expect(l2.highestBidder).toEqual({ id: mf.bidderClub, name: '竞标队' });
    expect(l3.highestBid).toBeNull();
    expect(l3.bidCount).toBe(0);
    expect(l3.highestBidder).toBeNull();
    expect(l3.firstBidPending).toBe(false);
  });

  it('TC-AGG-02 listings 路由的出价聚合恰 1 条语句（变异拆回两条分查必红）', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    const { db, sqls } = countingDb(fx.env.DB);
    const res = await get('/api/market/listings?status=active', undefined, { ...fx.env, DB: db });
    expect(res.status).toBe(200);
    expect(sqls.filter((s) => s.includes('FROM bids b GROUP BY b.listing_id')).length).toBe(1);
  });

  it('TC-NOTE-01 首次结算 note 进 1 批（2 条），二次结算 note 零写零批', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    const p2 = await seedSecondPlayer(fx, mf.sellerClub);
    await listPlayer(mf, p2, 10);
    // POST 挂牌端点自身会跑一轮结算（origin user）：第二张单挂牌时第一张的 note 已被写掉。
    // 统一清 NULL 再计时，首跑断言才与「两张都从 NULL 落 note」对齐。
    fx.sqlite.exec('UPDATE listings SET deadline_note = NULL');
    resetSettleCoalesce();
    const first = countingDb(fx.env.DB);
    // settleOverdue 收整个 env（expireStaleOffers 走 env.DB），只把 DB 换成计数包装
    const s1 = await settleOverdue({ ...fx.env, DB: first.db }, { origin: 'user' });
    expect(s1.notesUpdated).toBe(2);
    expect(first.sqls.filter((s) => s.includes('UPDATE listings SET deadline_note')).length).toBe(2);
    // batchSizes：三扫批(3) + note 批(2)。变异拆回逐行 run ⇒ batchSizes 退化成 [3] 且恰红
    expect(first.batchSizes).toEqual([3, 2]);
    const second = countingDb(fx.env.DB);
    const s2 = await settleOverdue({ ...fx.env, DB: second.db }, { origin: 'user' });
    expect(s2.notesUpdated).toBe(0);
    expect(second.sqls.filter((s) => s.includes('UPDATE listings SET deadline_note')).length).toBe(0);
    expect(second.batchSizes).toEqual([3]);
  });

  it('TC-NOTE-02 只有 note 变更的行进批（恰 1 条），其余行原值不动', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    const p2 = await seedSecondPlayer(fx, mf.sellerClub);
    await listPlayer(mf, p2, 10);
    resetSettleCoalesce();
    await settleOverdue(fx.env, { origin: 'user' });
    const baseline = sqlGet<{ deadline_note: string }>(fx.sqlite, 'SELECT deadline_note FROM listings WHERE id = 2')!.deadline_note;
    fx.sqlite.exec(`UPDATE listings SET deadline_note = '旧文案' WHERE id = 1`);
    resetSettleCoalesce();
    const counted = countingDb(fx.env.DB);
    const s = await settleOverdue({ ...fx.env, DB: counted.db }, { origin: 'user' });
    expect(s.notesUpdated).toBe(1);
    expect(counted.sqls.filter((x) => x.includes('UPDATE listings SET deadline_note')).length).toBe(1);
    expect(counted.batchSizes).toEqual([3, 1]);
    const after = sqlGet<{ deadline_note: string }>(fx.sqlite, 'SELECT deadline_note FROM listings WHERE id = 1')!.deadline_note;
    expect(after).toBe(baseline);
  });

  it('TC-WU-02 生产路径（有 executionCtx）：结算挂 waitUntil，卡住的结算不阻塞响应', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    resetSettleCoalesce();
    // gate 卡住 db.batch（只有结算走 batch，路由主查询走 prepare）：结算若在关键路径上，
    // 响应必然被卡到放行之后；挂 waitUntil 则响应先回。竞型确定，无墙钟抖动。
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slowDb = {
      prepare(sql: string) {
        return fx.env.DB.prepare(sql);
      },
      batch(stmts: unknown[]) {
        return gate.then(() => (fx.env.DB as unknown as { batch(s: unknown[]): Promise<unknown> }).batch(stmts));
      },
    };
    const captured: Promise<unknown>[] = [];
    const resP = app.request(
      '/api/market/listings?status=active',
      { method: 'GET' },
      { ...fx.env, DB: slowDb as unknown as D1Database },
      { waitUntil: (p: Promise<unknown>) => void captured.push(p), passThroughOnException: () => {}, props: {} },
    ) as Promise<Response>;
    const winner = await Promise.race([
      resP.then(() => 'response' as const),
      gate.then(() => 'gate' as const),
      new Promise<'timer'>((r) => setTimeout(() => r('timer'), 100)),
    ]);
    expect(winner).toBe('response');
    release();
    const res = await resP;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: unknown[] };
    expect(Array.isArray(body.listings)).toBe(true);
    expect(captured.length).toBeGreaterThanOrEqual(1);
  });
});
