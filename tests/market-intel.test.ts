// 市场情报台测试（v6.18.0）：传闻流（GET /api/market/rumors）/ 最近成交（GET /api/market/deals）/
// 海捞速查（GET /api/market/sea-lookup）/ 退役端点回归（TC-REG-01）。
// 用例名与 docs/test-plans/v6.18.0-market-ia.md 的 TC 编号一一对应（TC-RUMOR 10 / TC-DEAL 8 /
// TC-LOOKUP 7 / TC-REG 1；TC-ACT 10 在 tests/market-activatable.test.ts）。
//
// fixture 自建：甲队 101（教练 tok-coach 绑定）/ 乙队 102（tok-coach2 未绑定）+ 赛季 4 running +
// S4W1 open。传闻用例额外按 rumors.ts 的同源种子（seededUnit([season, windowSeq, round, j], 9)）
// 灌入假料球员池、全部挂甲队 normal —— 假料池因此可复现，「真料可对账 / 假料不撞真实关系」两类
// 断言都从确定的池子出发，而不是靠碰运气。
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { seededUnit } from '../src/worker/venue-ops.ts';

const CLUB_A = 101; // 甲队
const CLUB_B = 102; // 乙队
const CPU_CLUB = 131681; // AC米兰(CPU)：CPU 队判定只看 clubs.is_cpu，不看队名

// 限流桶 / L1 缓存 / 代际键记忆逐用例清零（同一个 test 文件共享模块状态）
beforeEach(() => {
  resetGuards();
});

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

/** ttl 默认 '0'（PUBLIC_CACHE_TTL_MS 旁路缓存，读库即真相）；缓存用例显式传 '60000' */
function freshEnv(ttl = '0'): Fixture {
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
       (9, '观众', 'user', 0, 0);`,
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
    PUBLIC_CACHE_TTL_MS: ttl,
  };
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-coach2'],
    [9, 'tok-viewer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} }, env);
}

function seedClubs(fx: Fixture, opts: { cpu?: boolean } = {}): void {
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES
       (${CLUB_A}, '甲队', 'premier', 'active', 0),
       (${CLUB_B}, '乙队', 'premier', 'active', 0)${
         opts.cpu ? `,\n       (${CPU_CLUB}, 'AC米兰(CPU)', 'premier', 'active', 1)` : ''
       };`,
  );
}

function addCpuClub(fx: Fixture): number {
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (${CPU_CLUB}, 'AC米兰(CPU)', 'premier', 'active', 1)`,
  );
  return CPU_CLUB;
}

/** 赛季 4 running + S4W1 开窗（本轮增量所有端点都以「有开窗」为默认态） */
function seedSeason(fx: Fixture): void {
  fx.sqlite.exec(
    `INSERT INTO seasons (season, status) VALUES (4, 'running');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at)
       VALUES (4, 1, 'open', 0, '2026-07-01T00:00:00Z');`,
  );
}

/** 关当前窗 + 开下一窗（season_windows 有 UNIQUE(season, window_seq)，只能新增行，不能改窗号） */
function advanceWindow(fx: Fixture, season: number, fromSeq: number, toSeq: number): void {
  fx.sqlite.exec(
    `UPDATE season_windows SET status = 'closed', closed_at = '2026-07-08T00:00:00Z'
       WHERE season = ${season} AND window_seq = ${fromSeq};
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at)
       VALUES (${season}, ${toSeq}, 'open', 0, '2026-07-09T00:00:00Z');`,
  );
}

function closeWindow(fx: Fixture): void {
  fx.sqlite.exec(
    `UPDATE season_windows SET status = 'closed', closed_at = '2026-07-08T00:00:00Z' WHERE season = 4 AND window_seq = 1`,
  );
}

interface PlayerSeed {
  id: number;
  name: string;
  clubId?: number | null;
  status?: string;
  ca?: number | null;
  pa?: number | null;
  position?: string;
  age?: number;
  displayName?: string;
  fcId?: number | null;
}

function addPlayer(fx: Fixture, p: PlayerSeed): number {
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, display_name, fc_id, club_id, position, age, ca, pa, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.id,
      `fc${p.id}`,
      p.name,
      p.displayName ?? null,
      p.fcId ?? null,
      p.clubId ?? null,
      p.position ?? 'ST',
      p.age ?? 26,
      p.ca ?? 70,
      p.pa ?? p.ca ?? 70,
      p.status ?? 'normal',
    );
  return p.id;
}

interface ListingSeed {
  playerId: number;
  sellerClubId?: number;
  type?: string;
  askPrice?: number;
  status?: string;
  season?: number;
  windowSeq?: number;
}

function addListing(fx: Fixture, l: ListingSeed): number {
  const info = fx.sqlite
    .prepare(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, season, window_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      l.playerId,
      l.sellerClubId ?? CLUB_A,
      l.type ?? 'normal',
      l.askPrice ?? 10,
      l.status ?? 'listed',
      l.season ?? 4,
      l.windowSeq ?? 1,
    );
  return Number(info.lastInsertRowid);
}

interface TransferSeed {
  playerId: number;
  type?: string;
  fromClubId?: number | null;
  toClubId?: number | null;
  fee?: number | null;
  extraFee?: number | null;
  status?: string;
  season?: number | null;
  windowSeq?: number | null;
  completedAt?: string | null;
}

function addTransfer(fx: Fixture, t: TransferSeed): number {
  const at = t.completedAt === undefined ? '2026-07-02T00:00:00Z' : t.completedAt;
  const info = fx.sqlite
    .prepare(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, extra_fee, status, season, window_seq, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.type ?? 'transfer',
      t.playerId,
      t.fromClubId ?? null,
      t.toClubId ?? null,
      t.fee ?? null,
      t.extraFee ?? null,
      t.status ?? 'completed',
      t.season ?? 4,
      t.windowSeq ?? 1,
      at,
      at,
    );
  return Number(info.lastInsertRowid);
}

// 捕获 env.DB.prepare 的 SQL 文本（沿用 market-routes 计划护栏的包装写法）
function captureSql(fx: Fixture): string[] {
  const captured: string[] = [];
  const real = fx.env.DB;
  fx.env.DB = {
    prepare(sql: string) {
      captured.push(sql);
      return real.prepare(sql);
    },
    batch: real.batch.bind(real),
  } as unknown as D1Database;
  return captured;
}

function explain(fx: Fixture, sql: string): string {
  return sqlAll<{ detail: string }>(fx.sqlite, `EXPLAIN QUERY PLAN ${sql}`)
    .map((r) => r.detail)
    .join(' | ');
}

// ---------------------------------------------------------------- 传闻（TC-RUMOR）

const RUMOR_SEASON = 4;
const RUMOR_WINDOW = 1;
const STAR_A = 500; // 王牌甲：甲队在售（S1）
const STAR_B = 501; // 王牌乙：乙队在售（S2）
const FAKE_POOL_SIZE = 16;
const FAKE_ID_RANGE = 20_000;

/** 假料 id 池：与 rumors.ts 同源推导（种子 [season, windowSeq]，draw 9，每轮 16 个、最多 3 轮） */
function fakeIdPool(season: number, windowSeq: number, rounds: number): number[] {
  const ids: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let j = 0; j < FAKE_POOL_SIZE; j += 1) {
      ids.push(1 + Math.floor(seededUnit([season, windowSeq, round, j], 9) * FAKE_ID_RANGE));
    }
  }
  return ids;
}

interface RumorSeedOpts {
  /** 在售池：S1@甲 listed / S2@乙 bidding（默认 true） */
  listings?: boolean;
  /** 成交池：一笔 to_club=甲队 的 transfer（默认 false） */
  dealFallback?: boolean;
  /** 假料球员池（默认 true；灌 (4,1) 三轮 + (4,0) 一轮的并集） */
  fakePool?: boolean;
  ttl?: string;
}

function seedRumors(opts: RumorSeedOpts = {}): Fixture {
  const fx = freshEnv(opts.ttl);
  // clubs 池必须是三支（含 CPU 队）：假料槽的队名按 seededUnit 抽 clubs 下标，
  // 池子大小直接决定抽到哪一队、以及是否撞上「球员现效力队」守卫而被丢槽。
  seedClubs(fx, { cpu: true });
  fx.sqlite.exec(
    `INSERT INTO seasons (season, status) VALUES (${RUMOR_SEASON}, 'running');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at)
       VALUES (${RUMOR_SEASON}, ${RUMOR_WINDOW}, 'open', 0, '2026-07-01T00:00:00Z');`,
  );
  addPlayer(fx, { id: STAR_A, name: '王牌甲', clubId: CLUB_A });
  addPlayer(fx, { id: STAR_B, name: '王牌乙', clubId: CLUB_B });
  if (opts.fakePool !== false) {
    const ids = new Set([...fakeIdPool(RUMOR_SEASON, RUMOR_WINDOW, 3), ...fakeIdPool(RUMOR_SEASON, 0, 1)]);
    for (const id of ids) {
      if (id === STAR_A || id === STAR_B) continue;
      addPlayer(fx, { id, name: `假料${id}`, clubId: CLUB_A });
    }
  }
  if (opts.listings !== false) {
    addListing(fx, { playerId: STAR_A, sellerClubId: CLUB_A, status: 'listed' });
    addListing(fx, { playerId: STAR_B, sellerClubId: CLUB_B, status: 'bidding' });
  }
  if (opts.dealFallback) {
    addTransfer(fx, {
      playerId: STAR_A,
      type: 'transfer',
      toClubId: CLUB_A,
      fee: 12,
      completedAt: '2026-07-02T00:00:00Z',
    });
  }
  return fx;
}

interface RumorRow {
  id: string;
  text: string;
  playerId: number;
  playerName: string;
  clubName: string;
}

async function rumors(fx: Fixture, token?: string): Promise<RumorRow[]> {
  const res = await get('/api/market/rumors', token, fx.env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { rumors: RumorRow[] }).rumors;
}

/** 真关系集（`球员id:球队名`）：只收 loadFactPool 会读到的两个池子（在售三态 + 市场类成交） */
function realRelations(fx: Fixture): Set<string> {
  const rel = new Set<string>();
  for (const r of sqlAll<{ playerId: number; clubName: string }>(
    fx.sqlite,
    `SELECT l.player_id AS playerId, cl.name AS clubName
       FROM listings l JOIN clubs cl ON cl.id = l.seller_club_id
      WHERE l.status IN ('listed', 'bidding', 'matched_pending')`,
  )) {
    rel.add(`${r.playerId}:${r.clubName}`);
  }
  for (const r of sqlAll<{ playerId: number; clubName: string }>(
    fx.sqlite,
    `SELECT t.player_id AS playerId, cl.name AS clubName
       FROM transfers t JOIN clubs cl ON cl.id = t.to_club_id
      WHERE t.status = 'completed' AND t.type IN ('transfer', 'activation', 'forced_auction', 'free_agent')
     UNION
     SELECT t.player_id AS playerId, cl.name AS clubName
       FROM transfers t JOIN clubs cl ON cl.id = t.from_club_id
      WHERE t.status = 'completed' AND t.type IN ('transfer', 'activation', 'forced_auction', 'free_agent')`,
  )) {
    rel.add(`${r.playerId}:${r.clubName}`);
  }
  return rel;
}

function currentClubName(fx: Fixture, playerId: number): string | null {
  const row = sqlAll<{ name: string | null }>(
    fx.sqlite,
    `SELECT cl.name FROM players p LEFT JOIN clubs cl ON cl.id = p.club_id WHERE p.id = ?`,
    playerId,
  )[0];
  return row?.name ?? null;
}

/** 传闻不与现实矛盾：要么能在真实关系里对账（真料），要么既非真实关系、也不指向球员现效力队（假料） */
function expectNoContradiction(fx: Fixture, rows: RumorRow[]): void {
  const rel = realRelations(fx);
  for (const r of rows) {
    if (rel.has(`${r.playerId}:${r.clubName}`)) continue;
    expect(currentClubName(fx, r.playerId), `${r.id} 假料指向了现效力队`).not.toBe(r.clubName);
  }
}

function idsOf(rows: RumorRow[]): string[] {
  return rows.map((r) => r.id);
}

function slots(season: number, windowSeq: number): string[] {
  return Array.from({ length: 8 }, (_, i) => `r${season}-${windowSeq}-${i}`);
}

describe('TC-RUMOR 传闻（GET /api/market/rumors）', () => {
  it('TC-RUMOR-01 载荷结构与 id 序列', async () => {
    const fx = seedRumors();
    const rows = await rumors(fx);
    expect(rows).toHaveLength(8);
    expect(idsOf(rows)).toEqual(slots(RUMOR_SEASON, RUMOR_WINDOW));
    for (const r of rows) {
      // 键序即接口契约：id / text / playerId / playerName / clubName，没有真/假标记、没有池内字段
      expect(Object.keys(r)).toEqual(['id', 'text', 'playerId', 'playerName', 'clubName']);
      expect(typeof r.playerId).toBe('number');
      expect(typeof r.playerName).toBe('string');
      expect(r.playerName.length).toBeGreaterThan(0);
      expect(typeof r.clubName).toBe('string');
      expect(r.clubName.length).toBeGreaterThan(0);
      expect(typeof r.text).toBe('string');
      expect(r.text.length).toBeGreaterThan(0);
    }
  });

  it('TC-RUMOR-02 同窗两次请求逐字相等', async () => {
    const fx = seedRumors();
    const first = await rumors(fx);
    const second = await rumors(fx);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(idsOf(second)).toEqual(slots(RUMOR_SEASON, RUMOR_WINDOW));
  });

  it('TC-RUMOR-03 换窗换血（种子含 season + windowSeq）', async () => {
    const fx = seedRumors();
    const before = await rumors(fx);
    expect(idsOf(before)).toEqual(slots(RUMOR_SEASON, RUMOR_WINDOW));

    advanceWindow(fx, RUMOR_SEASON, RUMOR_WINDOW, 2);
    const after = await rumors(fx);
    // (4,2) 抽出的假料 id 不在库里 ⇒ 假料槽全丢，只剩三个真料槽
    expect(idsOf(after)).toEqual(['r4-2-5', 'r4-2-6', 'r4-2-7']);
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
    // 换窗后留下的都是能对账的真料（种子换了，模板洗牌与事实抽取都换了）
    const rel = realRelations(fx);
    for (const r of after) expect(rel.has(`${r.playerId}:${r.clubName}`)).toBe(true);
    expect(after.map((r) => r.text)).not.toEqual(before.slice(5, 8).map((r) => r.text));
  });

  it('TC-RUMOR-04 真假混排与模板不重复', async () => {
    const fx = seedRumors();
    const rows = await rumors(fx);
    const pool = new Set([...fakeIdPool(RUMOR_SEASON, RUMOR_WINDOW, 3), ...fakeIdPool(RUMOR_SEASON, 0, 1)]);

    // 真料槽 0/2/3/4/6：S1↔甲队、S2↔乙队（事实池只有这两笔在售）
    const truthSlots = ['r4-1-0', 'r4-1-2', 'r4-1-3', 'r4-1-4', 'r4-1-6'];
    for (const id of truthSlots) {
      const row = rows.find((r) => r.id === id);
      expect(row, id).toBeDefined();
      expect([STAR_A, STAR_B]).toContain(row?.playerId);
      expect(row?.clubName).toBe(row?.playerId === STAR_A ? '甲队' : '乙队');
      expect(row?.playerName).toBe(row?.playerId === STAR_A ? '王牌甲' : '王牌乙');
    }

    // 假料槽 1/5/7：球员来自假料池（不是两名真球星），且三条 text 互不相同
    const fakeRows = rows.filter((r) => !truthSlots.includes(r.id));
    expect(fakeRows.map((r) => r.id)).toEqual(['r4-1-1', 'r4-1-5', 'r4-1-7']);
    for (const r of fakeRows) {
      expect(pool.has(r.playerId)).toBe(true);
      expect([STAR_A, STAR_B]).not.toContain(r.playerId);
      expect(r.playerName).toBe(`假料${r.playerId}`);
    }

    // 模板洗牌不重复：8 条 text 互不相同，且占位符全部被填、没有 undefined 漏出
    const texts = rows.map((r) => r.text);
    expect(new Set(texts).size).toBe(8);
    for (const t of texts) {
      expect(t).not.toContain('{player}');
      expect(t).not.toContain('{club}');
      expect(t).not.toContain('undefined');
    }
  });

  it('TC-RUMOR-05 假料守卫（两段：现效力队 + 真实关系撞车）', async () => {
    // 段一：假料不得指向球员现效力队（假料全挂甲队 ⇒ 三条假料一律不是甲队）
    const fx = seedRumors();
    const before = await rumors(fx);
    const pool = new Set([...fakeIdPool(RUMOR_SEASON, RUMOR_WINDOW, 3), ...fakeIdPool(RUMOR_SEASON, 0, 1)]);
    const fakeRows = before.filter((r) => pool.has(r.playerId) && r.playerId !== STAR_A && r.playerId !== STAR_B);
    expect(fakeRows).toHaveLength(3);
    const rel = realRelations(fx);
    for (const r of fakeRows) {
      expect(r.clubName, r.id).not.toBe('甲队');
      expect(rel.has(`${r.playerId}:${r.clubName}`), `${r.id} 假料撞了真实关系`).toBe(false);
    }
    expectNoContradiction(fx, before);

    // 段二：把槽 1 的假料球员挂成乙队在售 ⇒ 该组合变成真实关系，槽 1 必须整体消失（不是改口风）
    const clash = before.find((r) => r.id === 'r4-1-1');
    expect(clash).toBeDefined();
    addListing(fx, { playerId: clash!.playerId, sellerClubId: CLUB_B, status: 'listed' });
    const after = await rumors(fx);
    expect(after).toHaveLength(7);
    expect(idsOf(after)).toEqual(['r4-1-0', 'r4-1-2', 'r4-1-3', 'r4-1-4', 'r4-1-5', 'r4-1-6', 'r4-1-7']);
    expect(idsOf(after)).not.toContain('r4-1-1');
    expectNoContradiction(fx, after);
  });

  it('TC-RUMOR-06 事实池空/半空时的分支落点', async () => {
    // 段一：在售池与成交池都空 ⇒ 真料槽落进假料分支，槽 0 三轮都撞现效力队被丢 ⇒ 7 条全假
    const empty = seedRumors({ listings: false });
    const allFake = await rumors(empty);
    expect(idsOf(allFake)).toEqual(['r4-1-1', 'r4-1-2', 'r4-1-3', 'r4-1-4', 'r4-1-5', 'r4-1-6', 'r4-1-7']);
    const pool = new Set([...fakeIdPool(RUMOR_SEASON, RUMOR_WINDOW, 3), ...fakeIdPool(RUMOR_SEASON, 0, 1)]);
    for (const r of allFake) {
      expect(pool.has(r.playerId), r.id).toBe(true);
      expect(r.clubName).not.toBe('甲队');
    }
    expectNoContradiction(empty, allFake);

    // 段二：补一笔 to_club=甲队的成交 ⇒ 成交池兜底，5 个真料槽全部指向甲队，假料槽不变
    const fallback = seedRumors({ listings: false, dealFallback: true });
    const rows = await rumors(fallback);
    expect(idsOf(rows)).toEqual(slots(RUMOR_SEASON, RUMOR_WINDOW));
    for (const id of ['r4-1-0', 'r4-1-2', 'r4-1-3', 'r4-1-4', 'r4-1-6']) {
      const row = rows.find((r) => r.id === id);
      expect(row?.playerId, id).toBe(STAR_A);
      expect(row?.clubName, id).toBe('甲队');
    }
    for (const id of ['r4-1-1', 'r4-1-5', 'r4-1-7']) {
      const row = rows.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row?.clubName).not.toBe('甲队');
    }
  });

  it('TC-RUMOR-07 不泄漏内部标记与池字段', async () => {
    const fx = seedRumors();
    const res = await get('/api/market/rumors', undefined, fx.env);
    expect(res.status).toBe(200);
    const raw = await res.text();
    for (const leak of ['isTruth', 'truth', 'fake', 'template', 'slot', 'seed']) {
      expect(raw, `载荷泄漏了 ${leak}`).not.toContain(leak);
    }
    const rows = (JSON.parse(raw) as { rumors: RumorRow[] }).rumors;
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['clubName', 'id', 'playerId', 'playerName', 'text']);
    }
  });

  it('TC-RUMOR-08 缓存命中与缓存键含窗口', async () => {
    const fx = seedRumors({ ttl: '60000' });
    const first = await rumors(fx);
    expect(idsOf(first)).toEqual(slots(RUMOR_SEASON, RUMOR_WINDOW));

    // 补库（新增一名在售球员）不穿透缓存：L1 命中直接回旧载荷
    addPlayer(fx, { id: 502, name: '王牌丙', clubId: CLUB_B });
    addListing(fx, { playerId: 502, sellerClubId: CLUB_B, status: 'listed' });
    const cached = await rumors(fx);
    expect(JSON.stringify(cached)).toBe(JSON.stringify(first));

    // 缓存键含 [season, windowSeq]：换窗必须出新载荷，而不是继续回 (4,1) 的 8 条
    advanceWindow(fx, RUMOR_SEASON, RUMOR_WINDOW, 2);
    const after = await rumors(fx);
    expect(idsOf(after)).toEqual(['r4-2-5', 'r4-2-6', 'r4-2-7']);
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(first));
  });

  it('TC-RUMOR-09 匿名可读 + 限流先于读库', async () => {
    const fx = seedRumors();
    const captured = captureSql(fx);
    for (let i = 0; i < 60; i += 1) {
      const res = await get('/api/market/rumors', undefined, fx.env);
      expect(res.status, `第 ${i + 1} 次`).toBe(200);
    }
    const beforeBlock = captured.length;
    const blocked = await get('/api/market/rumors', undefined, fx.env);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: '请求太频繁，请稍后再试' });
    // 限流先于读库：被拦下的那次一次库都没碰
    expect(captured.length).toBe(beforeBlock);
  });

  it('TC-RUMOR-10 无开窗时用可见赛季兜底（windowSeq 0）', async () => {
    const fx = seedRumors();
    closeWindow(fx);
    // 加一个更高的 preparing 赛季：可见赛季仍取 running 的 4（不是 5）
    fx.sqlite.exec(`INSERT INTO seasons (season, status) VALUES (5, 'preparing')`);
    const rows = await rumors(fx);
    expect(idsOf(rows)).toEqual(slots(RUMOR_SEASON, 0));
    expect(rows).toHaveLength(8);
    expectNoContradiction(fx, rows);
  });
});

// ---------------------------------------------------------------- 成交公示（TC-DEAL）

function seedDeals(ttl = '0'): Fixture {
  const fx = freshEnv(ttl);
  seedClubs(fx);
  addPlayer(fx, { id: 700, name: '成交甲', clubId: CLUB_A });
  addPlayer(fx, { id: 701, name: '成交乙', clubId: CLUB_B });
  return fx;
}

const DEAL_KEYS = [
  'id',
  'type',
  'playerId',
  'playerName',
  'fromClubName',
  'toClubName',
  'fee',
  'extraFee',
  'season',
  'windowSeq',
  'completedAt',
];

interface DealRow {
  id: number;
  type: string;
  playerId: number;
  playerName: string;
  fromClubName: string | null;
  toClubName: string | null;
  fee: number | null;
  extraFee: number | null;
  season: number | null;
  windowSeq: number | null;
  completedAt: string | null;
}

async function deals(fx: Fixture, token?: string): Promise<DealRow[]> {
  const res = await get('/api/market/deals', token, fx.env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { deals: DealRow[] }).deals;
}

describe('TC-DEAL 成交公示（GET /api/market/deals）', () => {
  it('TC-DEAL-01 7 种 type 全出且金额语义原样', async () => {
    const fx = seedDeals();
    const at = (n: number) => `2026-07-0${n}T00:00:00Z`;
    addTransfer(fx, { playerId: 700, type: 'transfer', fromClubId: CLUB_A, toClubId: CLUB_B, fee: 30, extraFee: 3, completedAt: at(1) });
    addTransfer(fx, { playerId: 701, type: 'activation', fromClubId: CLUB_B, toClubId: CLUB_A, fee: 5, extraFee: 0, completedAt: at(2) });
    addTransfer(fx, { playerId: 700, type: 'match', fromClubId: CLUB_A, toClubId: CLUB_B, fee: 8.5, extraFee: 2, completedAt: at(3) });
    addTransfer(fx, { playerId: 701, type: 'free_agent', fromClubId: null, toClubId: CLUB_A, fee: 14, extraFee: null, completedAt: at(4) });
    addTransfer(fx, { playerId: 700, type: 'termination', fromClubId: CLUB_B, toClubId: null, fee: 0, extraFee: 12, completedAt: at(5) });
    addTransfer(fx, { playerId: 701, type: 'forced_auction', fromClubId: CLUB_A, toClubId: CLUB_B, fee: 42, extraFee: 6, completedAt: at(6) });
    // 第 7 种 type + 一笔金额全 NULL：JSON 里必须仍是 null（不是键被丢掉）
    addTransfer(fx, { playerId: 700, type: 'rc_change', fromClubId: CLUB_A, toClubId: CLUB_A, fee: null, extraFee: null, completedAt: at(7) });
    addTransfer(fx, { playerId: 701, type: 'rc_change', fromClubId: CLUB_B, toClubId: CLUB_B, fee: 20, extraFee: null, completedAt: at(8) });

    const rows = await deals(fx);
    expect(rows).toHaveLength(8);
    expect([...new Set(rows.map((r) => r.type))].sort()).toEqual(
      ['activation', 'forced_auction', 'free_agent', 'match', 'rc_change', 'termination', 'transfer'].sort(),
    );
    for (const r of rows) expect(Object.keys(r)).toEqual(DEAL_KEYS);
    const nullFee = rows.find((r) => r.completedAt === at(7));
    expect(nullFee?.fee).toBeNull();
    expect(nullFee?.extraFee).toBeNull();
    // 金额原样：不换算、不四舍五入、不把 0 当空
    expect(rows.find((r) => r.completedAt === at(1))?.fee).toBe(30);
    expect(rows.find((r) => r.completedAt === at(3))?.fee).toBe(8.5);
    expect(rows.find((r) => r.completedAt === at(5))?.fee).toBe(0);
    expect(rows.find((r) => r.completedAt === at(5))?.extraFee).toBe(12);
    expect(rows.find((r) => r.completedAt === at(8))?.extraFee).toBeNull();
  });

  it('TC-DEAL-02 排序 completed_at DESC, id DESC', async () => {
    const fx = seedDeals();
    const old = addTransfer(fx, { playerId: 700, toClubId: CLUB_B, completedAt: '2026-07-03T00:00:00Z' });
    const sameLow = addTransfer(fx, { playerId: 700, toClubId: CLUB_A, completedAt: '2026-07-04T00:00:00Z' });
    const sameHigh = addTransfer(fx, { playerId: 701, toClubId: CLUB_B, completedAt: '2026-07-04T00:00:00Z' });
    const newest = addTransfer(fx, { playerId: 701, toClubId: CLUB_A, completedAt: '2026-07-05T00:00:00Z' });

    const rows = await deals(fx);
    expect(rows.map((r) => r.id)).toEqual([newest, sameHigh, sameLow, old]);
  });

  it('TC-DEAL-03 LIMIT 50', async () => {
    const fx = seedDeals();
    const ins = fx.sqlite.prepare(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, completed_at, created_at)
       VALUES ('transfer', 700, ${CLUB_A}, ${CLUB_B}, 10, ?, 4, 1, ?, ?)`,
    );
    const completedIds: number[] = [];
    for (let i = 0; i < 55; i += 1) {
      const at = `2026-05-01T00:00:${String(i).padStart(2, '0')}Z`;
      completedIds.push(Number(ins.run('completed', at, at).lastInsertRowid));
    }
    const otherIds: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const at = `2026-05-02T00:00:0${i}Z`;
      otherIds.push(Number(ins.run('pending_review', at, at).lastInsertRowid));
    }

    const rows = await deals(fx);
    expect(rows).toHaveLength(50);
    // completed_at 秒数递增 ⇒ DESC 取 i=54…5，最老的 5 笔（i=4…0）被截掉
    expect(rows.map((r) => r.id)).toEqual(completedIds.slice().reverse().slice(0, 50));
    for (const id of completedIds.slice(0, 5)) expect(rows.map((r) => r.id)).not.toContain(id);
    for (const id of otherIds) expect(rows.map((r) => r.id)).not.toContain(id);
  });

  it('TC-DEAL-04 LEFT JOIN 两侧（termination 行不得丢）', async () => {
    const fx = seedDeals();
    const termination = addTransfer(fx, {
      playerId: 700,
      type: 'termination',
      fromClubId: CLUB_B,
      toClubId: null,
      fee: 0,
      extraFee: 8,
      completedAt: '2026-07-04T00:00:00Z',
    });
    const orphan = addTransfer(fx, {
      playerId: 701,
      type: 'transfer',
      fromClubId: null,
      toClubId: CLUB_A,
      fee: 20,
      completedAt: '2026-07-03T00:00:00Z',
    });

    const rows = await deals(fx);
    expect(rows.map((r) => r.id)).toEqual([termination, orphan]);
    const term = rows.find((r) => r.id === termination);
    expect(term?.type).toBe('termination');
    expect(term?.fromClubName).toBe('乙队');
    expect(term?.toClubName).toBeNull(); // 不是 undefined / 空串 / 「未知」
    const orph = rows.find((r) => r.id === orphan);
    expect(orph?.fromClubName).toBeNull();
    expect(orph?.toClubName).toBe('甲队');
  });

  it('TC-DEAL-05 只出 completed', async () => {
    const fx = seedDeals();
    const done = addTransfer(fx, { playerId: 700, toClubId: CLUB_B, completedAt: '2026-07-01T00:00:00Z' });
    addTransfer(fx, { playerId: 701, toClubId: CLUB_A, status: 'pending_review', completedAt: null });
    addTransfer(fx, { playerId: 700, toClubId: CLUB_A, status: 'rejected', completedAt: '2026-07-03T00:00:00Z' });
    addTransfer(fx, { playerId: 701, toClubId: CLUB_B, status: 'cancelled', completedAt: '2026-07-04T00:00:00Z' });

    const rows = await deals(fx);
    expect(rows.map((r) => r.id)).toEqual([done]);
  });

  it('TC-DEAL-06 查询计划与 SQL 文本锁', async () => {
    const fx = seedDeals();
    const ins = fx.sqlite.prepare(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, completed_at, created_at)
       VALUES ('transfer', 700, ${CLUB_A}, ${CLUB_B}, 10, ?, 4, 1, ?, ?)`,
    );
    // 灌足量：completed 120 笔 + 其他状态 4000 笔（生产是 17,731 名球员的量级，
    // 小表上优化器会挑别的计划，「只走索引早停 50 行」必须在大表上才看得出来）
    for (let i = 0; i < 120; i += 1) {
      const at = `2026-06-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`;
      ins.run('completed', at, at);
    }
    for (let i = 0; i < 4000; i += 1) {
      const at = `2026-04-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`;
      ins.run(i % 3 === 0 ? 'pending_review' : i % 3 === 1 ? 'rejected' : 'cancelled', at, at);
    }

    const captured = captureSql(fx);
    const rows = await deals(fx);
    expect(rows).toHaveLength(50);

    const sql = captured.find((s) => s.includes('FROM transfers'));
    expect(sql).toBeDefined();
    expect(sql ?? '').toContain(`t.status = 'completed'`);
    expect(sql ?? '').toContain('ORDER BY t.completed_at DESC, t.id DESC');
    expect(sql ?? '').toContain('LIMIT 50');

    const plan = explain(fx, sql ?? '');
    expect(plan).toContain('idx_transfers_status_time'); // 0058 的 (status, completed_at DESC, id DESC)
    expect(plan).not.toContain('SCAN t'); // 退化的签名：扫 transfers 全表
    expect(plan).not.toContain('SCAN transfers');
    expect(plan).not.toContain('TEMP B-TREE'); // 退化的签名：排序落到临时表
  });

  it('TC-DEAL-07 匿名 200 与缓存命中', async () => {
    const fx = seedDeals('60000');
    const first = addTransfer(fx, { playerId: 700, toClubId: CLUB_B, completedAt: '2026-07-01T00:00:00Z' });
    const before = await deals(fx); // 匿名可读
    expect(before.map((r) => r.id)).toEqual([first]);

    // 新成交不穿透 1h 缓存：L1 命中回旧载荷
    addTransfer(fx, { playerId: 701, toClubId: CLUB_A, completedAt: '2026-07-06T00:00:00Z' });
    const cached = await deals(fx);
    expect(JSON.stringify(cached)).toBe(JSON.stringify(before));

    // 清 L1 后才看得见新值（缓存失效由写路径 purge 挂钩负责，测试里手动清）
    resetGuards();
    const fresh = await deals(fx);
    expect(fresh).toHaveLength(2);
  });

  it('TC-DEAL-08 playerName 取 display_name 优先', async () => {
    const fx = seedDeals();
    addPlayer(fx, { id: 702, name: '原甲', displayName: '新甲', clubId: CLUB_A });
    addTransfer(fx, { playerId: 702, type: 'transfer', fromClubId: CLUB_A, toClubId: CLUB_B, completedAt: '2026-07-01T00:00:00Z' });

    const rows = await deals(fx);
    expect(rows).toHaveLength(1);
    expect(rows[0].playerName).toBe('新甲');
  });
});

// ---------------------------------------------------------------- 海捞速查（TC-LOOKUP）

interface LookupRow {
  id: number;
  fcId: number | null;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  clubName: string | null;
  seaSign: { eligible: boolean; reason: string | null };
}

async function lookup(fx: Fixture, q: string, token: string | undefined = 'tok-coach'): Promise<LookupRow[]> {
  const res = await get(`/api/market/sea-lookup?q=${encodeURIComponent(q)}`, token, fx.env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: LookupRow[] }).results;
}

function lookupRaw(fx: Fixture, query: string, token?: string) {
  return get(`/api/market/sea-lookup${query}`, token, fx.env);
}

async function playerSeaSign(
  fx: Fixture,
  playerId: number,
  token: string | undefined = 'tok-coach',
): Promise<{ eligible: boolean; reason: string | null }> {
  const res = await get(`/api/players/${playerId}`, token, fx.env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { seaSign: { eligible: boolean; reason: string | null } }).seaSign;
}

const NO_WINDOW = '转会窗口没开，现在不能海捞';
const HAS_OWNER = '海捞只能签无归属的球员（这名球员有东家）';
const BAD_STATUS = '当前状态不能海捞';
const BANNED = '这名球员本窗口被解约过，本窗口所有球队都不能签他';
const IN_FLIGHT = '这名球员已经有一单在市场流程里了，等它结束再操作';
const PENDING = '这名球员有一张单据正在等管理组审核，先等审核结果';

interface LookupCase {
  id: number;
  label: string;
  eligible: boolean;
  reason: string | null;
}

/** 九类球员：覆盖 checkSeaSignEligible 守卫链的每一关（单条真源与批量快照必须逐球员一致） */
function seedLookupMatrix(fx: Fixture): LookupCase[] {
  seedClubs(fx);
  addCpuClub(fx);
  seedSeason(fx);
  const at = '2026-07-02T00:00:00Z';
  // ① 无归属可签
  addPlayer(fx, { id: 601, name: '自由身', fcId: 900601 });
  // ② CPU 队球员：可海捞
  addPlayer(fx, { id: 602, name: '米兰小将', clubId: CPU_CLUB, fcId: 900602 });
  // ③ 他队（非 CPU）有东家
  addPlayer(fx, { id: 603, name: '乙队主力', clubId: CLUB_B, fcId: 900603 });
  // ④ 退役 / ⑤ 挂牌态
  addPlayer(fx, { id: 604, name: '退役老将', status: 'retired', fcId: 900604 });
  addPlayer(fx, { id: 605, name: '挂牌中', status: 'listed', fcId: 900605 });
  // ⑥ 本窗被解约（S4W1）/ ⑦ 上窗被解约（S4W2）
  addPlayer(fx, { id: 606, name: '本窗解约', fcId: 900606 });
  addTransfer(fx, { playerId: 606, type: 'termination', fromClubId: CLUB_B, toClubId: null, fee: 0, season: 4, windowSeq: 1, completedAt: at });
  addPlayer(fx, { id: 607, name: '上窗解约', fcId: 900607 });
  addTransfer(fx, { playerId: 607, type: 'termination', fromClubId: CLUB_B, toClubId: null, fee: 0, season: 4, windowSeq: 2, completedAt: at });
  // ⑧ 在途挂牌（listings 活跃态）/ ⑨ 审核在途（transfers pending_review）
  addPlayer(fx, { id: 608, name: '在途挂牌', fcId: 900608 });
  addListing(fx, { playerId: 608, sellerClubId: CLUB_B, status: 'listed' });
  addPlayer(fx, { id: 609, name: '审核在途', fcId: 900609 });
  addTransfer(fx, { playerId: 609, type: 'transfer', fromClubId: null, toClubId: CLUB_A, status: 'pending_review', completedAt: null });

  return [
    { id: 601, label: '无归属可签', eligible: true, reason: null },
    { id: 602, label: 'CPU 队', eligible: true, reason: null },
    { id: 603, label: '他队有东家', eligible: false, reason: HAS_OWNER },
    { id: 604, label: '退役', eligible: false, reason: BAD_STATUS },
    { id: 605, label: '挂牌态', eligible: false, reason: BAD_STATUS },
    { id: 606, label: '本窗解约', eligible: false, reason: BANNED },
    { id: 607, label: '上窗解约', eligible: true, reason: null },
    { id: 608, label: '在途挂牌', eligible: false, reason: IN_FLIGHT },
    { id: 609, label: '审核在途', eligible: false, reason: PENDING },
  ];
}

describe('TC-LOOKUP 海捞点查（GET /api/market/sea-lookup）', () => {
  it('TC-LOOKUP-01 数字点查 fc_id 优先、内部 id 兜底', async () => {
    const fx = freshEnv();
    seedClubs(fx);
    // A 的内部 id 777 / fc_id 8888；B 的内部 id 9999 / fc_id 777（fc_id 与 A 的内部 id 撞号）
    addPlayer(fx, { id: 777, name: 'A 队球员', clubId: CLUB_A, fcId: 8888 });
    addPlayer(fx, { id: 9999, name: 'B 队球员', clubId: CLUB_B, fcId: 777 });

    // q=777 先按 fc_id 命中 B，不是内部 id 的 A
    const byFcId = await lookup(fx, '777');
    expect(byFcId).toHaveLength(1);
    expect(byFcId[0].id).toBe(9999);
    expect(byFcId[0].fcId).toBe(777);
    expect(byFcId[0].name).toBe('B 队球员');
    expect(byFcId[0].clubName).toBe('乙队');

    const byFcIdA = await lookup(fx, '8888');
    expect(byFcIdA.map((r) => r.id)).toEqual([777]);
    expect(byFcIdA[0].name).toBe('A 队球员');

    // fc_id 无命中时内部 id 兜底
    const byId = await lookup(fx, '9999');
    expect(byId.map((r) => r.id)).toEqual([9999]);

    // 都没有 ⇒ 空结果不是 404
    const miss = await lookup(fx, '12345678');
    expect(miss).toEqual([]);
  });

  it('TC-LOOKUP-02 名字 LIKE：折叠 / 两列 / LIMIT 8 / CA 降序', async () => {
    const fx = freshEnv();
    seedClubs(fx);
    // 9 名命中「cn」（大小写混合、2 名只靠 display_name 命中）+ 1 名不命中（CA 最高，过滤失效会排第一）
    addPlayer(fx, { id: 801, name: 'Cn甲', ca: 90 });
    addPlayer(fx, { id: 802, name: 'cN乙', ca: 88 });
    addPlayer(fx, { id: 803, name: 'CN丙', ca: 88 });
    addPlayer(fx, { id: 804, name: '张cn丁', ca: 85 });
    addPlayer(fx, { id: 805, name: '李cN戊', ca: 80 });
    addPlayer(fx, { id: 806, name: '王Cn己', ca: 75 });
    addPlayer(fx, { id: 807, name: '赵六', displayName: 'cn赵六', ca: 70 });
    addPlayer(fx, { id: 808, name: '钱七', displayName: 'CN钱七', ca: 65 });
    addPlayer(fx, { id: 810, name: '孙八', ca: 60 });
    addPlayer(fx, { id: 809, name: '周九', ca: 99 });

    const rows = await lookup(fx, 'CN');
    // LIMIT 8：第 9 名命中者（810）被截掉；不命中的 809 无论如何都不出现
    expect(rows.map((r) => r.id)).toEqual([801, 802, 803, 804, 805, 806, 807, 808]);
    // 同 CA（802/803）按 id 升序
    expect(rows[1].ca).toBe(88);
    expect(rows[2].ca).toBe(88);
    // display_name 命中的两行也在（两列都查），行内 name 取 display_name
    expect(rows[6].name).toBe('cn赵六');
    expect(rows[7].name).toBe('CN钱七');
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ['age', 'ca', 'clubName', 'fcId', 'id', 'name', 'pa', 'position', 'seaSign'].sort(),
      );
    }
  });

  it('TC-LOOKUP-03 空 q 400 与文案', async () => {
    const fx = freshEnv();
    seedClubs(fx);
    addPlayer(fx, { id: 601, name: '自由身' });

    const missing = await lookupRaw(fx, '', 'tok-coach');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: '请输入球员 ID 或名字' });

    const blank = await lookupRaw(fx, '?q=%20%20', 'tok-coach');
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: '请输入球员 ID 或名字' });
  });

  it('TC-LOOKUP-04 权限：匿名 401 / 观众 403 / 教练与管理员 200', async () => {
    const fx = freshEnv();
    seedClubs(fx);
    addPlayer(fx, { id: 601, name: '自由身' });

    const anon = await lookupRaw(fx, '?q=601', undefined);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: '未登录' });

    const viewer = await lookupRaw(fx, '?q=601', 'tok-viewer');
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toEqual({ error: '没有权限进行此操作' });

    // 绑定教练（甲队）与未绑定教练都能用（这是「查人」不是「本队操作」）
    expect((await lookupRaw(fx, '?q=601', 'tok-coach')).status).toBe(200);
    expect((await lookupRaw(fx, '?q=601', 'tok-coach2')).status).toBe(200);
    expect((await lookupRaw(fx, '?q=601', 'tok-admin')).status).toBe(200);
  });

  it('TC-LOOKUP-05 批量判定与详情 seaSign 逐球员一致（跨实现强锁）', async () => {
    const fx = freshEnv();
    const cases = seedLookupMatrix(fx);

    for (const c of cases) {
      const rows = await lookup(fx, String(c.id));
      expect(rows, c.label).toHaveLength(1);
      expect(rows[0].id, c.label).toBe(c.id);
      expect(rows[0].seaSign, `${c.label} 批量判定`).toEqual({ eligible: c.eligible, reason: c.reason });
      // 与单条真源（球员详情 seaSign）逐字一致：守卫顺序或文案任一漂移都会红
      expect(await playerSeaSign(fx, c.id), `${c.label} 详情判定`).toEqual(rows[0].seaSign);
    }
  });

  it('TC-LOOKUP-06 未开窗时全员拦在窗口关', async () => {
    const fx = freshEnv();
    const cases = seedLookupMatrix(fx);
    closeWindow(fx);

    for (const c of cases) {
      const rows = await lookup(fx, String(c.id));
      expect(rows[0].seaSign, c.label).toEqual({ eligible: false, reason: NO_WINDOW });
      expect(await playerSeaSign(fx, c.id), c.label).toEqual({ eligible: false, reason: NO_WINDOW });
    }
  });

  it('TC-LOOKUP-07 LIKE 通配符转义', async () => {
    const fx = freshEnv();
    seedClubs(fx);
    addPlayer(fx, { id: 831, name: 'A%B' });
    addPlayer(fx, { id: 832, name: 'A_B' });
    addPlayer(fx, { id: 833, name: 'AXB' });

    // % 与 _ 都是字面量：只回本体，不把另两人当通配命中
    expect((await lookup(fx, 'A%B')).map((r) => r.id)).toEqual([831]);
    expect((await lookup(fx, 'A_B')).map((r) => r.id)).toEqual([832]);
    expect((await lookup(fx, 'AXB')).map((r) => r.id)).toEqual([833]);
  });
});

// ---------------------------------------------------------------- 退役端点回归（TC-REG）

describe('TC-REG 回归与退役', () => {
  it('TC-REG-01 退役三端点一律 404', async () => {
    const fx = seedRumors();
    for (const path of ['/api/market/sea-signs', '/api/market/cpu-board', '/api/market/trainees']) {
      for (const token of [undefined, 'tok-coach']) {
        const res = await get(path, token, fx.env);
        expect(res.status, `${path} (${token ?? '匿名'})`).toBe(404);
        expect(await res.json()).toEqual({ error: '接口不存在' });
      }
    }

    // 接替它们的四个新端点仍在（同夹具里逐个探活）
    expect((await get('/api/market/rumors', undefined, fx.env)).status).toBe(200);
    expect((await get('/api/market/deals', undefined, fx.env)).status).toBe(200);
    expect((await get(`/api/market/sea-lookup?q=${STAR_A}`, 'tok-coach', fx.env)).status).toBe(200);
    expect((await get('/api/market/activatable', 'tok-coach', fx.env)).status).toBe(200);
  });
});
