// v3.4.0 步骤 3：GET /api/clubs 球队列表端点。
// 覆盖：四项指标（阵容拆一线队/训练营、平均 CA、总身价、工资总额）聚合口径、分级批量派生、
// 队徽经比赛系统 team.logo_key、CPU 标记、空阵容回落、AUTH_DB 未配的休眠列回落、
// 双定级数据冲突降级为未定级（不打死公开列表页）。
// 另加两条「省 D1 额度」的锁死断言：① 聚合查询必须走 club 前导索引而不是全表扫（线上 18,301 行，
// 全表扫就是 18× 浪费）；② 全平台聚合只跑一条语句，不允许按俱乐部 N+1。
import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { applyMigrations, attachAuthChannel, createTestD1, createTestKV } from './d1.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
}

function freshEnv(): Fixture {
  resetConfigCache();
  resetGuards();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE team (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, logo_key TEXT);
     CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL, team_id INTEGER NOT NULL, UNIQUE(tournament_id, team_id));`,
  );
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: createTestKV() as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    // 显式旁路缓存：同 URL 第二次请求若命中 L1 就抓不到 SQL
    PUBLIC_CACHE_TTL_MS: '0',
  };
  const auth = attachAuthChannel(env);
  return { env, sqlite, tour, auth };
}

// 赛季 + 定级赛事（101=顶级 / 102=次级）
function bindSeason(fx: Fixture): void {
  fx.sqlite.exec("INSERT INTO seasons (season, status) VALUES (1, 'running')");
  fx.sqlite.exec(
    `INSERT INTO season_tournaments (season, tournament_id, competition_type) VALUES
       (1, 101, 'league_premier'), (1, 102, 'league_second')`,
  );
}

function addClub(fx: Fixture, id: number, name: string, opts: { isCpu?: boolean; status?: string } = {}): void {
  fx.sqlite
    .prepare('INSERT INTO clubs (id, name, is_cpu, status) VALUES (?, ?, ?, ?)')
    .run(id, name, opts.isCpu ? 1 : 0, opts.status ?? 'active');
}

// 目录登记（AUTH_DB team：club_id ↔ tour_team_id）+ 比赛系统队行（含队徽）
function linkTeam(fx: Fixture, clubId: number, tourTeamId: number, name: string, logoKey: string | null): void {
  fx.auth
    .prepare('INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(tourTeamId, clubId, name, '2026-01-01T00:00:00Z');
  fx.tour.prepare('INSERT INTO team (id, name, logo_key) VALUES (?, ?, ?)').run(tourTeamId, name, logoKey);
}

function enter(fx: Fixture, tournamentId: number, teamId: number): void {
  fx.tour.prepare('INSERT INTO entry (tournament_id, team_id) VALUES (?, ?)').run(tournamentId, teamId);
}

let nextPlayerId = 1;
function addPlayer(
  fx: Fixture,
  clubId: number | null,
  opts: { ca?: number; status?: string; marketValue?: number | null; wage?: number | null; active?: boolean } = {},
): number {
  const id = nextPlayerId++;
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, club_id, position, ca, pa, growable, status, market_value, fc_id)
       VALUES (?, ?, ?, ?, 'CM', ?, 85, 1, ?, ?, ?)`,
    )
    .run(id, `fc${id}`, `球员${id}`, clubId, opts.ca ?? 80, opts.status ?? 'normal', opts.marketValue ?? null, id);
  if (opts.wage !== undefined && opts.wage !== null && clubId !== null) {
    fx.sqlite
      .prepare(
        `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active)
         VALUES (?, ?, 50, ?, 'formal', 'import', '2026-07-01', ?)`,
      )
      .run(id, clubId, opts.wage, opts.active === false ? 0 : 1);
  }
  return id;
}

interface ClubEntry {
  id: number;
  name: string;
  isCpu: boolean;
  tier: string | null;
  logoKey: string | null;
  squad: { senior: number; trainee: number };
  avgCa: number | null;
  /** 全队都没录身价时为 null（不是 0） */
  totalValue: number | null;
  totalWage: number;
}

async function listClubs(env: Env): Promise<ClubEntry[]> {
  const res = await app.request('http://localhost/api/clubs', {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { clubs: ClubEntry[] };
  return body.clubs;
}

const byId = (clubs: ClubEntry[], id: number): ClubEntry => {
  const found = clubs.find((c) => c.id === id);
  expect(found, `列表里应有俱乐部 ${id}`).toBeDefined();
  return found!;
};

// 记录型 D1 包装：把路由实际执行的 SQL 收下来，再原样交给测试库
function recorder(env: Env): { env: Env; captured: string[] } {
  const inner = env.DB;
  const captured: string[] = [];
  const DB = {
    prepare(sql: string) {
      captured.push(sql);
      return inner.prepare(sql);
    },
    batch: inner.batch,
  } as unknown as D1Database;
  return { env: { ...env, DB } as Env, captured };
}

describe('GET /api/clubs 球队列表（v3.4.0 步骤 3）', () => {
  it('四项指标 + 分级 + 队徽 + CPU 标记；退役俱乐部不入列表', async () => {
    const fx = freshEnv();
    bindSeason(fx);
    addClub(fx, 1, '阿森纳');
    addClub(fx, 2, '甲队 (CPU)', { isCpu: true });
    addClub(fx, 3, '空队');
    addClub(fx, 4, '旧队', { status: 'retired' });
    addClub(fx, 5, '无身价队');
    linkTeam(fx, 1, 90, '阿森纳', 'team/90/1.png');
    linkTeam(fx, 2, 91, '甲队', null);
    enter(fx, 101, 90);

    // 阿森纳：3 名一线（CA 80/82/84）+ 1 名训练营（CA 60）；工资只算生效合同
    addPlayer(fx, 1, { ca: 80, marketValue: 1_000_000, wage: 1.5 });
    addPlayer(fx, 1, { ca: 82, marketValue: 1_000_000, wage: 2 });
    addPlayer(fx, 1, { ca: 84, marketValue: 1_000_000, wage: 0.5 });
    addPlayer(fx, 1, { ca: 60, status: 'trainee', wage: 0.4 });
    // 失效合同不进工资总额
    addPlayer(fx, 1, { ca: 70, marketValue: 500_000, wage: 9, active: false });
    addPlayer(fx, 2, { ca: 70, marketValue: 500_000, wage: 3 });
    // 自由身（club_id NULL）不归任何俱乐部
    addPlayer(fx, null, { ca: 90, status: 'free' });
    // 无身价队：有球员、有合同（工资算得出来），但谁都没录过 market_value —— 这就是生产现状
    // （18,301 行 market_value 全 NULL）。身价合计必须是 null 而不是 0，否则页面会写成
    // 「每支球队身价都是 0.00 m」这种假话。
    addPlayer(fx, 5, { ca: 75, wage: 2 });
    addPlayer(fx, 5, { ca: 78, wage: 3 });

    const clubs = await listClubs(fx.env);

    expect(clubs.map((c) => c.name)).toEqual([...clubs.map((c) => c.name)].sort());

    const ars = byId(clubs, 1);
    expect(ars.isCpu).toBe(false);
    expect(ars.tier).toBe('premier');
    expect(ars.logoKey).toBe('team/90/1.png');
    // 训练营口径 = status='trainee'，且从阵容人数里拆出来
    expect(ars.squad).toEqual({ senior: 4, trainee: 1 });
    expect(ars.avgCa).toBe(75.2); // (80+82+84+60+70)/5
    expect(ars.totalValue).toBe(3_500_000);
    expect(ars.totalWage).toBe(4.4); // 1.5 + 2 + 0.5 + 0.4，失效的 9 不算

    const cpu = byId(clubs, 2);
    expect(cpu.isCpu).toBe(true);
    expect(cpu.tier).toBeNull(); // 没报名定级赛事
    expect(cpu.logoKey).toBeNull();
    expect(cpu.squad).toEqual({ senior: 1, trainee: 0 });
    expect(cpu.avgCa).toBe(70);
    expect(cpu.totalValue).toBe(500_000);
    expect(cpu.totalWage).toBe(3);

    // 没录过身价（生产现状）：身价合计回 null 而不是 0，工资总额照常有值
    const noValue = byId(clubs, 5);
    expect(noValue.squad).toEqual({ senior: 2, trainee: 0 });
    expect(noValue.totalValue).toBeNull();
    expect(noValue.totalWage).toBe(5);

    // 没有任何球员的俱乐部：人数与工资回 0，平均 CA 与身价回 null（不是 0，
    // 避免显示成「平均 CA 0」和「身价 0.00 m」）
    const empty = byId(clubs, 3);
    expect(empty.squad).toEqual({ senior: 0, trainee: 0 });
    expect(empty.avgCa).toBeNull();
    expect(empty.totalValue).toBeNull();
    expect(empty.totalWage).toBe(0);

    expect(clubs.some((c) => c.id === 4)).toBe(false);
  });

  it('AUTH_DB 未配时回落休眠列 clubs.league_tier，队徽为空（没有映射就取不到 tour 队）', async () => {
    const fx = freshEnv();
    fx.env.AUTH_DB = undefined;
    bindSeason(fx);
    addClub(fx, 1, '阿森纳');
    fx.sqlite.exec("UPDATE clubs SET league_tier = 'premier' WHERE id = 1");
    addPlayer(fx, 1, { ca: 80 });

    const ars = byId(await listClubs(fx.env), 1);
    expect(ars.tier).toBe('premier');
    expect(ars.logoKey).toBeNull();
    expect(ars.squad).toEqual({ senior: 1, trainee: 0 });
  });

  it('同一俱乐部同时报名两个定级赛事：该队降级为未定级并告警，其他队照常', async () => {
    const fx = freshEnv();
    bindSeason(fx);
    addClub(fx, 1, '冲突队');
    addClub(fx, 2, '正常队');
    linkTeam(fx, 1, 90, '冲突队', null);
    linkTeam(fx, 2, 91, '正常队', null);
    enter(fx, 101, 90);
    enter(fx, 102, 90); // 双定级 = 数据异常
    enter(fx, 101, 91);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const clubs = await listClubs(fx.env);
      // 单队 deriveClubTier 在同样数据下抛 500——列表页不能因此整体失败
      expect(byId(clubs, 1).tier).toBeNull();
      expect(byId(clubs, 2).tier).toBe('premier');
      expect(warn.mock.calls.some((args) => String(args[0]).includes('分级数据冲突'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('全平台聚合走 club 前导索引（不是全表扫），且只跑一条语句（无 N+1）', async () => {
    const fx = freshEnv();
    bindSeason(fx);
    addClub(fx, 1, '阿森纳');
    addClub(fx, 2, '甲队');
    linkTeam(fx, 1, 90, '阿森纳', null);
    linkTeam(fx, 2, 91, '甲队', null);
    enter(fx, 101, 90);
    enter(fx, 102, 91);
    // 灌足量行：小表上优化器可能不选索引，而线上是 18,301 行（其中 17,731 行 club_id IS NULL）
    const ins = fx.sqlite.prepare(
      `INSERT INTO players (uid, name, club_id, position, ca, pa, growable, status, fc_id)
       VALUES (?, ?, ?, 'CM', 80, 85, 1, 'normal', ?)`,
    );
    fx.sqlite.exec('BEGIN');
    for (let i = 1; i <= 400; i += 1) {
      ins.run(`fc${i}`, `球员${i}`, i % 11 === 0 ? null : (i % 2) + 1, i);
    }
    fx.sqlite.exec('COMMIT');

    const { env, captured } = recorder(fx.env);
    await listClubs(env);

    const agg = captured.filter((sql) => sql.includes('FROM players p LEFT JOIN contracts'));
    expect(agg, '全平台阵容聚合只应有一条语句').toHaveLength(1);
    // 占位符不绑定：SQLite 把未绑定参数当 NULL，执行计划不受值影响
    const plan = (fx.sqlite.prepare(`EXPLAIN QUERY PLAN ${agg[0]}`).all() as { detail: string }[])
      .map((r) => r.detail)
      .join(' | ');
    expect(plan).toContain('SEARCH p USING INDEX idx_players_club');
    expect(plan, '聚合不能退回 players 全表扫').not.toContain('SCAN p');
    expect(plan).not.toContain('TEMP B-TREE');

    // 一条列表请求的 DB 语句总数：clubs + 聚合 + 赛季 + 分级（season_tournaments）+ 休眠列/映射，
    // 上限 10 是为了钉住「不逐队查」——逐队派生会是 20 倍
    expect(captured.length).toBeLessThanOrEqual(10);
  });

  it('没有可见赛季时不报错，分级一律未定级', async () => {
    const fx = freshEnv();
    addClub(fx, 1, '阿森纳');
    linkTeam(fx, 1, 90, '阿森纳', 'team/90/1.png');
    addPlayer(fx, 1, { ca: 80 });

    const ars = byId(await listClubs(fx.env), 1);
    expect(ars.tier).toBeNull();
    expect(ars.logoKey).toBe('team/90/1.png'); // 队徽不依赖赛季
  });

  it('赛季在但本赛季还没绑定定级赛事：分级一律未定级，队徽照出', async () => {
    const fx = freshEnv();
    fx.sqlite.exec("INSERT INTO seasons (season, status) VALUES (1, 'running')"); // 不插 season_tournaments
    addClub(fx, 1, '阿森纳');
    linkTeam(fx, 1, 90, '阿森纳', 'team/90/1.png');
    enter(fx, 101, 90);

    const ars = byId(await listClubs(fx.env), 1);
    expect(ars.tier).toBeNull();
    expect(ars.logoKey).toBe('team/90/1.png');
  });

  it('TOUR_DB 缺失（比赛系统未绑定）：分级与队徽都为空，列表照常返回', async () => {
    const fx = freshEnv();
    bindSeason(fx);
    // Env 上 TOUR_DB 是必填（生产绑定一定有），这里模拟「比赛系统未绑定」要绕过类型
    (fx.env as { TOUR_DB?: unknown }).TOUR_DB = undefined;
    addClub(fx, 1, '阿森纳');
    linkTeam(fx, 1, 90, '阿森纳', 'team/90/1.png');
    enter(fx, 101, 90);
    addPlayer(fx, 1, { ca: 80 });

    const ars = byId(await listClubs(fx.env), 1);
    expect(ars.tier).toBeNull();
    expect(ars.logoKey).toBeNull();
    expect(ars.squad).toEqual({ senior: 1, trainee: 0 });
  });

  it('AUTH_DB 映射冲突（同一比赛系统球队挂在两家俱乐部下）：两家都按未定级并告警', async () => {
    const fx = freshEnv();
    bindSeason(fx);
    // 正常路径下 team.tour_team_id 带 UNIQUE 约束，而 SQLite 不允许 DROP 自动索引 ⇒ 重建表来复现「约束被破坏」
    fx.auth.exec(
      `ALTER TABLE team RENAME TO team_old;
       CREATE TABLE team (id INTEGER PRIMARY KEY, tour_team_id INTEGER, club_id INTEGER UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL);
       DROP TABLE team_old;`,
    );
    addClub(fx, 1, '甲俱乐部');
    addClub(fx, 2, '乙俱乐部');
    linkTeam(fx, 1, 90, '甲队', null);
    fx.auth
      .prepare('INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(90, 2, '乙队', '2026-01-01T00:00:00Z');
    enter(fx, 101, 90);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const clubs = await listClubs(fx.env);
      // 批量派生不能悄悄 last-wins：单队 derive 取首行，两边不一致就会「同一 clubId 两处不同 tier」
      expect(byId(clubs, 1).tier).toBeNull();
      expect(byId(clubs, 2).tier).toBeNull();
      expect(warn.mock.calls.some((args) => String(args[0]).includes('映射冲突'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
