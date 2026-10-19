// v6.52.0 非成长球员不计成长 XP（数据照收）—— 计划 §5 的 NG-01..NG-11。
//
// 口径（用户 m06019 + m06100 拍板）：
//   判定 = COALESCE(players.growable, 0) = 1 才算可成长；NULL 落非成长侧。
//   ①②③⑦（录入台批量 / 单人补录 / 自动钩子 / 改值重放）= 主闸归零：事件行与 value 照写、
//     growth_events.xp 存 0、players.growth_xp 不累加（消费方还要读这些数据）。
//   ④⑤⑥（训练营 / 中国计划 / 里程碑）= 查询层过滤：非成长球员连事件行都不产生（历史行不删）。
//
// 夹具注意：裸 INSERT 的 growable 走 0001 的 DEFAULT 1；这里三类结算与主闸都显式写 growable。
// 不能用 `POST /api/admin/seasons` 造赛季（带 ageCap 会触发 rejudgeGrowable，把 ca<pa 且
// age<=cap 的球员重判成 growable=1），赛季/绑定/窗口一律直接 INSERT。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, runMigration, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { recordGrowthEventStatements } from '../src/worker/growth.ts';
import { retryUnresolvedResults } from '../src/worker/results.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
  kv: Map<string, string>;
}

// 赛事库裁剪：赛果确认钩子（MATCH_SELECT / match_event）与球员比赛 tab（player-matches）
// 两边用到的表都摆齐；schema 与 tests/player-matches.test.ts 同源。
const TOUR_SCHEMA = `
  CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT, config_json TEXT DEFAULT '{}');
  CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT, config_json TEXT DEFAULT '{}');
  CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER, seed INTEGER);
  CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE player (id INTEGER PRIMARY KEY, team_id INTEGER, name TEXT, number INTEGER);
  CREATE TABLE match (
    id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER, slot INTEGER, leg INTEGER DEFAULT 1,
    home_entry_id INTEGER, away_entry_id INTEGER, status TEXT, note TEXT,
    score_home INTEGER, score_away INTEGER, pen_home INTEGER, pen_away INTEGER,
    winner_entry_id INTEGER, finished_at TEXT, walkover_side TEXT DEFAULT ''
  );
  CREATE TABLE match_event (
    id INTEGER PRIMARY KEY, match_id INTEGER, entry_id INTEGER, player_id INTEGER,
    assist_player_id INTEGER, type TEXT, minute INTEGER, created_at TEXT
  );
  CREATE TABLE tactic_submission (
    id INTEGER PRIMARY KEY, match_id INTEGER, team_id INTEGER, created_by INTEGER,
    tactic_id INTEGER, slots_json TEXT NOT NULL, created_at TEXT, UNIQUE (match_id, team_id)
  );
  CREATE TABLE injury (id INTEGER PRIMARY KEY, team_id INTEGER, player_id INTEGER, event_id INTEGER, injury_name TEXT);
  CREATE TABLE injury_miss (id INTEGER PRIMARY KEY, injury_id INTEGER, match_id INTEGER, UNIQUE (injury_id, match_id));`;

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `${TOUR_SCHEMA}
     CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0);`,
  );
  const auth = new DatabaseSync(':memory:');
  auth.exec('CREATE TABLE team (id INTEGER PRIMARY KEY, club_id INTEGER, tour_team_id INTEGER);');
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    AUTH_DB: createTestD1(auth),
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
  // 可见赛季（批量补录的事件都盖这个赛季；赛季行直接 INSERT，绕开 rejudgeGrowable）
  sqlite.exec(
    `INSERT INTO seasons (season, status, created_at) VALUES
       (3, 'running', '2026-01-01T00:00:00Z'),
       (2, 'settled', '2025-01-01T00:00:00Z');`,
  );
  return { env, sqlite, tour, auth, kv };
}

/**
 * 平台侧种子（显式 growable）：
 *   10 可成长 / 11 非成长 —— 主闸与自动钩子对照组
 *   12 训练营可成长 / 13 训练营非成长
 *   20 中国计划可成长 / 21 中国计划非成长
 *   30 里程碑可成长 / 31 里程碑非成长
 *   40 growable IS NULL —— NULL 落非成长侧
 * 全部 ca/pa 写死且 age > 25（即使将来有人误触 rejudge 也不会把非成长翻回可成长）。
 */
function seedPlatform(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '海港联', 'premier', 'active'), (2, '北岸城', 'premier', 'active');
    INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, china_plan, ca, pa, age, growable, fc_id) VALUES
      (10, 'p10', 'K. Grow', 1, 'ST', 'normal', 2, 0, 0, 80, 90, 20, 1, 101),
      (11, 'p11', 'N. Stay', 1, 'ST', 'normal', 2, 0, 0, 88, 88, 30, 0, 102),
      (12, 'p12', 'T. Trainee', 1, 'CM', 'trainee', 1, 0, 0, 60, 75, 18, 1, 103),
      (13, 'p13', 'S. Trainee', 1, 'CM', 'trainee', 1, 0, 0, 70, 70, 30, 0, 104),
      (20, 'p20', 'C. China', 2, 'CM', 'normal', 1, 0, 1, 70, 80, 21, 1, 201),
      (21, 'p21', 'C. China Old', 2, 'CM', 'normal', 1, 0, 1, 80, 80, 30, 0, 202),
      (30, 'p30', 'M. Miles', 1, 'ST', 'normal', 2, 0, 0, 80, 90, 21, 1, 301),
      (31, 'p31', 'M. Miles Old', 1, 'ST', 'normal', 2, 0, 0, 90, 90, 30, 0, 302),
      (40, 'p40', 'G. Null', 1, 'ST', 'normal', 1, 0, 0, 70, 80, 20, NULL, 401);
    INSERT INTO contracts (player_id, club_id, contract_type, is_active) VALUES
      (12, 1, 'trainee', 1), (13, 1, 'trainee', 1), (20, 2, 'formal', 1), (21, 2, 'formal', 1);
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (2, 2, '2026-01-01T00:00:00Z');
  `);
}

/** 一条已确认、非弃权、计 XP 的联赛场次（批量补录 / 改值 / 球员比赛 tab 共用） */
function seedMatch(fx: Fixture, matchId: number, over: { homeTeam?: string; awayTeam?: string; finishedAt?: string } = {}): void {
  fx.sqlite
    .prepare(
      `INSERT INTO result_confirmations
         (season, window_seq, tournament_id, match_id, competition_type, stage_name, stage_kind, round,
          home_team_id, away_team_id, home_team, away_team, score_home, score_away, walkover_side,
          finished_at, confirmed_by, confirmed_at)
       VALUES (3, 2, 5, ?, 'league_premier', '常规赛', 'league', 1, 501, 502, ?, ?, 2, 1, '', ?, 1, '2026-07-02T10:00:00Z')`,
    )
    .run(matchId, over.homeTeam ?? '海港联', over.awayTeam ?? '北岸城', over.finishedAt ?? '2026-07-01T21:00:00Z');
}

/** 直接落一条已录事件（历史/自动通道），参数顺序与表列一致 */
function seedEvent(
  fx: Fixture,
  playerId: number,
  matchRef: string,
  eventType: string,
  value: number,
  xp: number,
  source = 'manual',
  createdAt = '2026-07-02T10:00:00Z',
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
       VALUES (?, ?, 3, 2, ?, ?, ?, ?, 1, ?)`,
    )
    .run(playerId, matchRef, eventType, value, xp, source, createdAt);
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

function xpOf(fx: Fixture, playerId: number): number {
  return sqlGet<{ growth_xp: number }>(fx.sqlite, 'SELECT growth_xp FROM players WHERE id = ?', playerId)?.growth_xp ?? 0;
}

interface EventRow {
  id: number;
  player_id: number;
  match_ref: string | null;
  event_type: string;
  value: number;
  xp: number;
  source: string;
}

function eventsOf(fx: Fixture, playerId?: number): EventRow[] {
  const sql = 'SELECT id, player_id, match_ref, event_type, value, xp, source FROM growth_events';
  return playerId === undefined
    ? sqlAll<EventRow>(fx.sqlite, `${sql} ORDER BY id`)
    : sqlAll<EventRow>(fx.sqlite, `${sql} WHERE player_id = ? ORDER BY id`, playerId);
}

/** 按场次锚取事件（match_ref 是比赛 id 的字符串形式） */
function eventsOfMatch(fx: Fixture, matchRef: string): EventRow[] {
  return sqlAll<EventRow>(
    fx.sqlite,
    'SELECT id, player_id, match_ref, event_type, value, xp, source FROM growth_events WHERE match_ref = ? ORDER BY id',
    matchRef,
  );
}

async function errorText(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

const WEB_SRC = fileURLToPath(new URL('../web/src/', import.meta.url).href);
const MIGRATIONS = fileURLToPath(new URL('../src/db/migrations/', import.meta.url).href);

/* ========================================================================== */
/* NG-01 / NG-11 · 迁移 0077                                                  */
/* ========================================================================== */

describe('NG-01 迁移 0077：非成长球员存量 XP 清零（growable=1 与事件行不动）', () => {
  /** 先跑到 0076 再摆存量，最后跑 0077（照 tests/d1.ts runMigration 的「回填迁移」用法） */
  function legacyDb(): DatabaseSync {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite, '0076_growth_events_match_ref_index.sql');
    sqlite.exec(`
      INSERT INTO players (id, uid, name, growable, growth_xp, levels_applied, updated_at) VALUES
        (1, 'a', '非成长有 XP', 0, 5, 0, 'keep-1'),
        (2, 'b', '非成长零 XP', 0, 0, 0, 'keep-2'),
        (3, 'c', '可成长有 XP', 1, 5, 1, 'keep-3'),
        (4, 'd', 'NULL 归非成长', NULL, 7, 0, 'keep-4');
      INSERT INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, created_at) VALUES
        (1, 'm1', 3, 1, 'goal', 2, 1, 'auto', '2026-07-01T00:00:00Z'),
        (1, 'm2', 3, 1, 'rating', 8, 2, 'manual', '2026-07-02T00:00:00Z'),
        (3, 'm3', 3, 1, 'goal', 1, 0.5, 'auto', '2026-07-03T00:00:00Z');
    `);
    return sqlite;
  }

  it('TC-NG-01a 只清 growable=0/NULL 的 growth_xp；可成长球员与事件行原样保留', () => {
    const sqlite = legacyDb();
    runMigration(sqlite, '0077_growth_nongrowable_reset.sql');

    const players = sqlAll<{ id: number; growth_xp: number; levels_applied: number; updated_at: string }>(
      sqlite,
      'SELECT id, growth_xp, levels_applied, updated_at FROM players ORDER BY id',
    );
    expect(players.map((p) => p.growth_xp)).toEqual([0, 0, 5, 0]);
    expect(players.map((p) => p.levels_applied)).toEqual([0, 0, 1, 0]); // levels_applied 不动
    expect(players[1].updated_at).toBe('keep-2'); // 无 XP 的行连 updated_at 都不刷新（守卫命中）
    expect(players[2].updated_at).toBe('keep-3');
    expect(players[0].updated_at).not.toBe('keep-1');
    expect(players[3].updated_at).not.toBe('keep-4');

    // 事件行一条不删、value/xp 原样（成长史 / 球员比赛 tab 还要读）
    const events = sqlAll<{ player_id: number; match_ref: string; value: number; xp: number }>(
      sqlite,
      'SELECT player_id, match_ref, value, xp FROM growth_events ORDER BY id',
    );
    expect(events).toEqual([
      { player_id: 1, match_ref: 'm1', value: 2, xp: 1 },
      { player_id: 1, match_ref: 'm2', value: 8, xp: 2 },
      { player_id: 3, match_ref: 'm3', value: 1, xp: 0.5 },
    ]);
  });

  it('TC-NG-01b 迁移 SQL 自带 growth_xp <> 0 守卫：重放 0 行、二次跑数据不变', () => {
    const sqlite = legacyDb();
    const sql = readFileSync(`${MIGRATIONS}0077_growth_nongrowable_reset.sql`, 'utf8');
    const first = sqlite.prepare(sql).run();
    expect(first.changes).toBe(2); // 只有 id 1 与 4 真写了（id 2 已是 0，id 3 可成长）
    const afterFirst = sqlAll<Record<string, unknown>>(sqlite, 'SELECT * FROM players ORDER BY id');

    const second = sqlite.prepare(sql).run();
    expect(second.changes).toBe(0); // 守卫不可省：去掉它就是 3 行（0/NULL 全量匹配）
    expect(sqlAll<Record<string, unknown>>(sqlite, 'SELECT * FROM players ORDER BY id')).toEqual(afterFirst);
  });
});

describe('NG-11 迁移注册与隔离', () => {
  it('TC-NG-11a MIGRATION_FILES 已注册 0077 且排在 0076 之后', () => {
    const source = readFileSync(fileURLToPath(new URL('./d1.ts', import.meta.url).href), 'utf8');
    const at77 = source.indexOf("'0077_growth_nongrowable_reset.sql'");
    const at76 = source.indexOf("'0076_growth_events_match_ref_index.sql'");
    expect(at76).toBeGreaterThan(-1);
    expect(at77).toBeGreaterThan(-1);
    expect(at77).toBeGreaterThan(at76); // 应用顺序必须晚于 0076
  });

  it('TC-NG-11b 迁移带幂等守卫、0076 的索引在册、全量迁移后数据仍成立', () => {
    const migration = readFileSync(`${MIGRATIONS}0077_growth_nongrowable_reset.sql`, 'utf8');
    expect(migration).toContain('AND COALESCE(growth_xp, 0) <> 0');
    expect(migration).toContain('WHERE COALESCE(growable, 0) = 0');
    // 注释里逐字写了「文件内不写 BEGIN/COMMIT」，所以只扫 SQL 行（迁移执行器自行包事务，仓规）
    const sqlOnly = migration
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sqlOnly).not.toMatch(/\b(BEGIN|COMMIT)\b/i);

    // 全量迁移跑完后 0076 的索引仍在册（0077 是纯数据订正，不该动结构）
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    expect(
      sqlGet<{ name: string }>(sqlite, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_growth_events_match_ref'")?.name,
    ).toBe('idx_growth_events_match_ref');
  });
});

/* ========================================================================== */
/* NG-02 · 主闸                                                               */
/* ========================================================================== */

describe('NG-02 主闸 recordGrowthEventStatements：事件照写、XP 归零', () => {
  it('TC-NG-02a 可成长 1/1 且 xp 照存；非成长与 NULL 都是 0/1、事件 xp=0、value 照存', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    const db = fx.env.DB;

    const grow = await db.batch(
      recordGrowthEventStatements(db, { playerId: 10, matchRef: 'm-grow', season: 3, windowSeq: 2, eventType: 'goal', value: 2, xp: 1, source: 'auto' }),
    );
    expect(grow[0].meta.changes).toBe(1); // XP 语句入账
    expect(grow[1].meta.changes).toBe(1); // 事件语句入账
    expect(eventsOf(fx, 10)[0]).toMatchObject({ value: 2, xp: 1 });
    expect(xpOf(fx, 10)).toBe(1);

    const stay = await db.batch(
      recordGrowthEventStatements(db, { playerId: 11, matchRef: 'm-stay', season: 3, windowSeq: 2, eventType: 'goal', value: 2, xp: 1, source: 'auto' }),
    );
    expect(stay[0].meta.changes).toBe(0); // 非成长：XP 语句不入账
    expect(stay[1].meta.changes).toBe(1); // 事件照写
    expect(eventsOf(fx, 11)[0]).toMatchObject({ value: 2, xp: 0, event_type: 'goal' });
    expect(xpOf(fx, 11)).toBe(0);

    const nul = await db.batch(
      recordGrowthEventStatements(db, { playerId: 40, matchRef: 'm-null', season: 3, windowSeq: 2, eventType: 'assist', value: 1, xp: 0.5, source: 'auto' }),
    );
    expect(nul[0].meta.changes).toBe(0); // NULL 归非成长侧
    expect(nul[1].meta.changes).toBe(1);
    expect(eventsOf(fx, 40)[0]).toMatchObject({ value: 1, xp: 0 });

    // 事件行 data 其余字段（match_ref / season / source）照旧
    expect(eventsOf(fx, 11)[0]).toMatchObject({ match_ref: 'm-stay', source: 'auto' });
  });

  it('TC-NG-02b 同锚重放仍幂等：可成长与非成长都是 0/0，growth_xp 不重复加', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    const db = fx.env.DB;
    const input = { matchRef: 'm-replay', season: 3, windowSeq: 2, eventType: 'goal' as const, value: 1, xp: 0.5, source: 'auto' as const };

    await db.batch(recordGrowthEventStatements(db, { ...input, playerId: 10 }));
    const againGrow = await db.batch(recordGrowthEventStatements(db, { ...input, playerId: 10 }));
    expect(againGrow.map((r) => r.meta.changes)).toEqual([0, 0]);
    expect(xpOf(fx, 10)).toBe(0.5);

    await db.batch(recordGrowthEventStatements(db, { ...input, playerId: 11 }));
    const againStay = await db.batch(recordGrowthEventStatements(db, { ...input, playerId: 11 }));
    expect(againStay.map((r) => r.meta.changes)).toEqual([0, 0]);
    expect(xpOf(fx, 11)).toBe(0);
    expect(eventsOf(fx, 11)).toHaveLength(1); // 幂等锚仍然只一行
  });
});

/* ========================================================================== */
/* NG-03 · 三类结算查询层过滤                                                  */
/* ========================================================================== */

describe('NG-03 赛季结算：训练营 / 中国计划 / 里程碑不给非成长球员产事件', () => {
  /** 30 号可成长、31 号非成长，各 6 条进球（只进+攻达到里程碑档 5） */
  function seedMilestones(fx: Fixture): void {
    for (let i = 1; i <= 6; i += 1) {
      seedEvent(fx, 30, `g${i}`, 'goal', 1, 0, 'auto');
      seedEvent(fx, 31, `h${i}`, 'goal', 1, 0, 'auto');
    }
  }

  it('TC-NG-03a 非成长球员一条新事件都不产生；summary 只计可成长球员', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedMilestones(fx);
    // 历史行保留：13 号（训练营非成长）过去产生的 trainee_season 与已入账 XP 都不清
    seedEvent(fx, 13, 'trainee:2', 'trainee_season', 1, 40, 'auto', '2026-01-01T00:00:00Z');
    fx.sqlite.exec('UPDATE players SET growth_xp = 40 WHERE id = 13');

    const res = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { traineeCount: number; traineeXp: number; chinaCount: number; milestonesGranted: number };
    expect(summary).toMatchObject({ traineeCount: 1, traineeXp: 40, chinaCount: 1, milestonesGranted: 1 });

    // 可成长：各自照常产生事件并联入账
    expect(eventsOf(fx, 12).filter((e) => e.event_type === 'trainee_season')).toMatchObject([{ value: 1, xp: 40 }]);
    expect(eventsOf(fx, 20).filter((e) => e.event_type === 'china_plan')).toMatchObject([{ value: 1, xp: 20 }]);
    expect(eventsOf(fx, 30).filter((e) => e.event_type === 'milestone')).toMatchObject([{ value: 5, xp: 1 }]);
    expect(xpOf(fx, 12)).toBe(40);
    expect(xpOf(fx, 20)).toBe(20);
    expect(xpOf(fx, 30)).toBe(1);

    // 非成长：训练营 / 中国计划 / 里程碑都没有新行（13 只剩那条历史行）
    expect(eventsOf(fx, 13).filter((e) => e.event_type === 'trainee_season')).toHaveLength(1);
    expect(eventsOf(fx, 13)[0].match_ref).toBe('trainee:2');
    expect(eventsOf(fx, 21).filter((e) => e.event_type === 'china_plan')).toHaveLength(0);
    expect(eventsOf(fx, 31).filter((e) => e.event_type === 'milestone')).toHaveLength(0);
    expect(eventsOf(fx, 31)).toHaveLength(6); // 只有历史进球行，value 都在
    expect(xpOf(fx, 13)).toBe(40); // 历史 XP 不清（迁移只清存量，不追溯减法）
    expect(xpOf(fx, 21)).toBe(0);
    expect(xpOf(fx, 31)).toBe(0);

    // 审计 after 的计数同样只含可成长球员
    const audit = sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'growth_settlement' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(audit?.after ?? '{}')).toMatchObject({ traineeCount: 1, chinaCount: 1, milestonesGranted: 1 });
  });

  it('TC-NG-03b 重放不产生新行、历史行不删；非成长球员的进球不参与里程碑汇总', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedMilestones(fx);

    await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    const before = eventsOf(fx).length;
    const replay = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(replay.status).toBe(200);
    expect((await replay.json()) as Record<string, number>).toMatchObject({ traineeCount: 1, chinaCount: 1, milestonesGranted: 0 });
    expect(eventsOf(fx)).toHaveLength(before); // 一条新行都没加（非成长重放也是 0）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM growth_events WHERE player_id = 31 AND event_type = 'milestone'")?.n).toBe(0);
  });
});

/* ========================================================================== */
/* NG-04 · 自动钩子                                                           */
/* ========================================================================== */

describe('NG-04 赛果确认钩子：非成长球员事件照记、granted 按事件条数', () => {
  function seedConfirmMatch(fx: Fixture): void {
    fx.tour.exec(`
      INSERT INTO tournament (id, name, status, config_json) VALUES (5, '第七赛季联赛', 'running', '{}');
      INSERT INTO stage (id, tournament_id, kind, sort_order, name, config_json) VALUES (1, 5, 'league', 1, '常规赛', '{}');
      INSERT INTO team (id, name) VALUES (501, '海港联'), (502, '北岸城');
      INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (1, 5, 501, 1), (2, 5, 502, 2);
      INSERT INTO player (id, team_id, name, number) VALUES (101, 501, 'K. Grow', 9), (102, 501, 'N. Stay', 10);
      INSERT INTO match (id, stage_id, round, slot, leg, home_entry_id, away_entry_id, status, note, score_home, score_away, winner_entry_id, finished_at, walkover_side)
        VALUES (900, 1, 1, 1, 1, 1, 2, 'finished', NULL, 2, 1, 1, '2026-07-01T21:00:00Z', '');
      INSERT INTO match_event (match_id, entry_id, player_id, assist_player_id, type, minute, created_at) VALUES
        (900, 1, 101, NULL, 'goal', 10, '2026-07-01T21:00:00Z'),
        (900, 1, 101, NULL, 'goal', 30, '2026-07-01T21:00:00Z'),
        (900, 1, 102, NULL, 'goal', 50, '2026-07-01T21:00:00Z'),
        (900, 1, 101, 102, 'goal', 70, '2026-07-01T21:00:00Z');
    `);
    fx.sqlite.exec(`
      INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (3, 5, 'league_premier', '2026-01-01T00:00:00Z');
      INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (3, 2, 'open', '2026-07-01T00:00:00Z');
    `);
  }

  it('TC-NG-04a 非成长球员有进球/助攻事件（数据在）、growth_xp 不变；granted=3 条事件', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedConfirmMatch(fx);

    const res = await post('/api/admin/results/900/confirm', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { xp: { granted: number; unresolved: string[] } };
    // 事件条数：101 两球合一条 + 102 一球 + 102 一助攻 = 3（非成长的 2 条也计数）
    expect(body.xp.granted).toBe(3);
    expect(body.xp.unresolved).toEqual([]);

    // 可成长：一球 0.5 × 3 球（合成一条 value=3）
    expect(eventsOf(fx, 10)).toMatchObject([{ event_type: 'goal', value: 3, xp: 1.5, source: 'auto' }]);
    expect(xpOf(fx, 10)).toBe(1.5);
    // 非成长：事件与 value 照写、xp=0、growth_xp 不动
    expect(eventsOf(fx, 11)).toMatchObject([
      { event_type: 'goal', value: 1, xp: 0, match_ref: '900' },
      { event_type: 'assist', value: 1, xp: 0, match_ref: '900' },
    ]);
    expect(xpOf(fx, 11)).toBe(0);
  });

  it('TC-NG-04b 重放钩子（retry/replay 同一入口）：不重复加事件、不补发 XP', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedConfirmMatch(fx);
    await post('/api/admin/results/900/confirm', {}, 'tok-admin', fx.env);
    const before = eventsOf(fx).length;

    const replay = await post('/api/admin/results/900/replay-hooks', {}, 'tok-admin', fx.env);
    expect(replay.status).toBe(201);
    expect(eventsOf(fx)).toHaveLength(before); // 幂等锚挡住重放
    expect(xpOf(fx, 10)).toBe(1.5);
    expect(xpOf(fx, 11)).toBe(0);
    expect(eventsOf(fx, 11).map((e) => e.xp)).toEqual([0, 0]);
  });

  it('TC-NG-04c retryUnresolvedResults：补齐球员后自动补账，非成长球员事件照记、XP=0', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedConfirmMatch(fx);
    // 赛事库有位还没在平台建档的球员（999，避开既有 fc_id）进球 → 确认那一刻认不到，进 unresolved 标人工复核
    fx.tour.exec(`
      INSERT INTO player (id, team_id, name, number) VALUES (999, 501, 'X. Late', 11);
      INSERT INTO match_event (match_id, entry_id, player_id, assist_player_id, type, minute, created_at)
        VALUES (900, 1, 999, NULL, 'goal', 80, '2026-07-01T21:00:00Z');
    `);
    const confirmed = await post('/api/admin/results/900/confirm', {}, 'tok-admin', fx.env);
    const xp = ((await confirmed.json()) as { xp: { unresolved: string[] } }).xp;
    expect(xp.unresolved).toContain('海港联·X. Late');
    expect(sqlGet<{ needs_review: number }>(fx.sqlite, 'SELECT needs_review FROM result_confirmations WHERE match_id = 900')?.needs_review).toBe(1);

    // 补建非成长球员（fc_id 对上），自动重试应当把事件补齐 —— 数据照收、XP 归零
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, ca, pa, age, growable, fc_id)
        VALUES (14, 'p14', 'X. Late', 1, 'ST', 'normal', 1, 0, 70, 70, 30, 0, 999);
    `);
    const retry = await retryUnresolvedResults(fx.env);
    expect(retry).toMatchObject({ scanned: 1, healed: 1, failed: 0 });
    expect(eventsOf(fx, 14)).toMatchObject([{ event_type: 'goal', value: 1, xp: 0, match_ref: '900' }]);
    expect(xpOf(fx, 14)).toBe(0);
    expect(sqlGet<{ needs_review: number }>(fx.sqlite, 'SELECT needs_review FROM result_confirmations WHERE match_id = 900')?.needs_review).toBe(0);

    // 再跑：没有待复核场次，事件不重复
    expect(await retryUnresolvedResults(fx.env)).toMatchObject({ scanned: 0 });
    expect(eventsOf(fx, 14)).toHaveLength(1);
  });
});

/* ========================================================================== */
/* NG-05 · 录入台批量                                                          */
/* ========================================================================== */

describe('NG-05 录入台批量：非成长行 201、事件入账、响应 XP 归零', () => {
  it('TC-NG-05a 非成长行事件照写（value 照存 / xp=0）、totalXp 与逐行 xp 不虚报；面板带 growable', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedMatch(fx, 1500);

    const panelRes = await get('/api/admin/growth/match-entry/1500', 'tok-admin', fx.env);
    expect(panelRes.status).toBe(200);
    const panel = (await panelRes.json()) as { sides: { home: { players: { id: number; growable: boolean }[] } } };
    const byId = new Map(panel.sides.home.players.map((p) => [p.id, p]));
    expect(byId.get(10)?.growable).toBe(true);
    expect(byId.get(11)?.growable).toBe(false); // 漏字段会让整队被当非成长，这里钉住 DTO

    const res = await post(
      '/api/admin/growth/match-entry/1500',
      {
        entries: [
          { playerId: 10, appearance: true, rating: 8 }, // 可成长：1 + 2 = 3
          { playerId: 11, appearance: true, rating: 8, cleanSheet: true, duelsWon: 12, saves: 8 }, // 非成长：全部 0
        ],
      },
      'tok-admin',
      fx.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      written: number;
      duplicates: number;
      totalXp: number;
      perPlayer: { playerId: number; xp: number; written: number }[];
    };
    expect(body).toMatchObject({ written: 7, duplicates: 0, totalXp: 3 });
    expect(body.perPlayer).toEqual([
      { playerId: 10, name: 'K. Grow', xp: 3, written: 2, updated: 0, duplicates: 0 },
      { playerId: 11, name: 'N. Stay', xp: 0, written: 5, updated: 0, duplicates: 0 },
    ]);

    expect(eventsOf(fx, 11)).toMatchObject([
      { event_type: 'appearance', value: 1, xp: 0, source: 'manual' },
      { event_type: 'clean_sheet', value: 1, xp: 0 },
      { event_type: 'rating', value: 8, xp: 0 },
      { event_type: 'duels_won', value: 12, xp: 0 },
      { event_type: 'saves', value: 8, xp: 0 },
    ]);
    expect(xpOf(fx, 11)).toBe(0);
    expect(xpOf(fx, 10)).toBe(3);

    // 审计 detail 与响应同口径（非成长行 xp=0）
    const audit = sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'growth_manual_event_batch'");
    const after = JSON.parse(audit?.after ?? '{}') as { entries: { playerId: number; xp: number }[] };
    expect(after.entries.filter((e) => e.playerId === 11).every((e) => e.xp === 0)).toBe(true);
  });

  it('TC-NG-05b 同批全部重复 → 200、duplicates 计数正确、XP 不再变', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedMatch(fx, 1501);
    const payload = { entries: [{ playerId: 10, appearance: true }, { playerId: 11, appearance: true }] };

    const first = await post('/api/admin/growth/match-entry/1501', payload, 'tok-admin', fx.env);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ written: 2, totalXp: 1 });

    const again = await post('/api/admin/growth/match-entry/1501', payload, 'tok-admin', fx.env);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      written: 0,
      updated: 0,
      duplicates: 2,
      totalXp: 0,
      perPlayer: [
        { playerId: 10, xp: 0, duplicates: 1 },
        { playerId: 11, xp: 0, duplicates: 1 },
      ],
    });
    expect(eventsOfMatch(fx, '1501')).toHaveLength(2);
    expect(xpOf(fx, 10)).toBe(1);
    expect(xpOf(fx, 11)).toBe(0);
  });
});

/* ========================================================================== */
/* NG-06 · 单人补录                                                           */
/* ========================================================================== */

describe('NG-06 单人补录：201 / xp=0 / 审计 after.xp=0 / 重放 200 duplicate', () => {
  it('TC-NG-06a 非成长球员新事件 201（不是 duplicate）、响应与审计同为 0、growth_xp 不变', async () => {
    const fx = freshEnv();
    seedPlatform(fx);

    const res = await post('/api/admin/growth/events', { playerId: 11, eventType: 'rating', value: 9, matchRef: 'manual:ng6' }, 'tok-admin', fx.env);
    expect(res.status).toBe(201); // 关键：主闸改了判定口径后仍按事件 INSERT 判新入账
    expect(await res.json()).toMatchObject({ ok: true, xp: 0, duplicate: false });

    expect(eventsOf(fx, 11)).toMatchObject([{ event_type: 'rating', value: 9, xp: 0, source: 'manual' }]);
    expect(xpOf(fx, 11)).toBe(0);

    const audit = sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'growth_manual_event' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(audit?.after ?? '{}')).toMatchObject({ eventType: 'rating', value: 9, xp: 0, duplicate: false });
  });

  it('TC-NG-06b 同锚重放 200 + duplicate；可成长球员照常计 XP', async () => {
    const fx = freshEnv();
    seedPlatform(fx);

    await post('/api/admin/growth/events', { playerId: 40, eventType: 'rating', value: 9, matchRef: 'manual:null6' }, 'tok-admin', fx.env); // NULL 也按非成长
    expect(eventsOf(fx, 40)).toMatchObject([{ value: 9, xp: 0 }]);

    const first = await post('/api/admin/growth/events', { playerId: 11, eventType: 'rating', value: 9, matchRef: 'manual:dup6' }, 'tok-admin', fx.env);
    expect(first.status).toBe(201);
    const again = await post('/api/admin/growth/events', { playerId: 11, eventType: 'rating', value: 9, matchRef: 'manual:dup6' }, 'tok-admin', fx.env);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ xp: 0, duplicate: true });
    expect(eventsOf(fx, 11)).toHaveLength(1);
    expect(xpOf(fx, 11)).toBe(0);

    // 可成长对照组：评分 9 → 3 XP
    const grow = await post('/api/admin/growth/events', { playerId: 10, eventType: 'rating', value: 9, matchRef: 'manual:dup6' }, 'tok-admin', fx.env);
    expect(grow.status).toBe(201);
    expect(await grow.json()).toMatchObject({ xp: 3, duplicate: false });
    expect(xpOf(fx, 10)).toBe(3);
    expect(eventsOf(fx, 10)).toMatchObject([{ value: 9, xp: 3 }]);
  });
});

/* ========================================================================== */
/* NG-07 · 改值重放                                                           */
/* ========================================================================== */

describe('NG-07 改值重放：非成长保持现有 xp、链上不动；可成长照常重放', () => {
  /** 三场累计链：11 / 1 / 12，XP 0 / 1 / 1（录入顺序 = id 序） */
  function seedChain(fx: Fixture, playerId: number): void {
    seedEvent(fx, playerId, '910', 'duels_won', 11, 0);
    seedEvent(fx, playerId, '911', 'duels_won', 1, 1);
    seedEvent(fx, playerId, '912', 'duels_won', 12, 1);
    fx.sqlite.exec(`UPDATE players SET growth_xp = 2 WHERE id = ${playerId}`);
    for (const id of [910, 911, 912]) seedMatch(fx, id);
  }

  it('TC-NG-07a 非成长：改值只换 value/recorded_by，xp=0 的行维持 0、链上其他行与 growth_xp 不动', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedChain(fx, 11);

    const res = await post('/api/admin/growth/match-entry/910', { entries: [{ playerId: 11, duelsWon: 6 }] }, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ written: 0, updated: 1, duplicates: 0, totalXp: 0 });
    expect(eventsOf(fx, 11)).toMatchObject([
      { match_ref: '910', value: 6, xp: 0 },
      { match_ref: '911', value: 1, xp: 1 }, // 链上不动（正常重放会把它改成 0）
      { match_ref: '912', value: 12, xp: 1 },
    ]);
    expect(xpOf(fx, 11)).toBe(2);

    // 被改行原本 xp>0（成长期录下的历史行）：只改 value，不抹掉历史 XP
    const up = await post('/api/admin/growth/match-entry/912', { entries: [{ playerId: 11, duelsWon: 6 }] }, 'tok-admin', fx.env);
    expect(up.status).toBe(201);
    expect(await up.json()).toMatchObject({ written: 0, updated: 1, totalXp: 0 });
    expect(eventsOf(fx, 11)[2]).toMatchObject({ match_ref: '912', value: 6, xp: 1 });
    expect(xpOf(fx, 11)).toBe(2);

    // 审计 detail 的 xp 是行现值、kind=update
    const audit = sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'growth_manual_event_batch' ORDER BY id DESC LIMIT 1");
    expect((JSON.parse(audit?.after ?? '{}') as { entries: { xp: number; kind: string }[] }).entries[0]).toMatchObject({ xp: 1, kind: 'update' });
  });

  it('TC-NG-07b 可成长对照：差额照常重放（链上连带校正、growth_xp 跟着变）', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedChain(fx, 10);

    const res = await post('/api/admin/growth/match-entry/910', { entries: [{ playerId: 10, duelsWon: 6 }] }, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ written: 0, updated: 1, duplicates: 0, totalXp: -1 });
    expect(eventsOf(fx, 10)).toMatchObject([
      { match_ref: '910', value: 6, xp: 0 },
      { match_ref: '911', value: 1, xp: 0 }, // 链上被连带校正 1 → 0
      { match_ref: '912', value: 12, xp: 1 },
    ]);
    expect(xpOf(fx, 10)).toBe(1);
  });
});

/* ========================================================================== */
/* NG-08 · 升级闸门                                                           */
/* ========================================================================== */

describe('NG-08 升级闸门：非成长球员 409（排在 pending 判定之前）', () => {
  it('TC-NG-08a 非成长 + 有 XP ⇒ 409 且不改任何字段；清零后仍给同一文案', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec('UPDATE players SET growth_xp = 25 WHERE id = 11'); // 待办 2
    // 成长页也必须按 growable 归零：存量 25 XP 仍在，但非成长球员不应显示「2 次待升级」
    const before = (await (await get('/api/players/102/growth', 'tok-admin', fx.env)).json()) as { player: { pendingLevelUps: number; growthXp: number } };
    expect(before.player).toMatchObject({ pendingLevelUps: 0, growthXp: 25 });

    const res = await post('/api/growth/levelup/11', { planIndex: 0 }, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    expect(await errorText(res)).toContain('非成长球员不能消费升级');
    expect(sqlGet<{ ca: number; levels_applied: number }>(fx.sqlite, 'SELECT ca, levels_applied FROM players WHERE id = 11')).toMatchObject({ ca: 88, levels_applied: 0 });
    expect(eventsOf(fx, 11).filter((e) => e.event_type === 'levelup')).toHaveLength(0);

    // 迁移清零后 pending=0：仍要先报「非成长」而不是「没有待处理的升级」（顺序不可反）
    runMigration(fx.sqlite, '0077_growth_nongrowable_reset.sql');
    expect(xpOf(fx, 11)).toBe(0);
    const afterMigration = await post('/api/growth/levelup/11', { planIndex: 0 }, 'tok-admin', fx.env);
    expect(afterMigration.status).toBe(409);
    expect(await errorText(afterMigration)).toContain('非成长球员不能消费升级');

    const growth = (await (await get('/api/players/102/growth', 'tok-admin', fx.env)).json()) as { player: { pendingLevelUps: number; growthXp: number } };
    expect(growth.player).toMatchObject({ pendingLevelUps: 0, growthXp: 0 });
  });

  it('TC-NG-08b 可成长球员照常升级（对照）', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec('UPDATE players SET growth_xp = 25 WHERE id = 10');
    const before = (await (await get('/api/players/101/growth', 'tok-admin', fx.env)).json()) as { player: { pendingLevelUps: number; growthXp: number } };
    expect(before.player).toMatchObject({ pendingLevelUps: 2, growthXp: 25 });

    const res = await post('/api/growth/levelup/10', { planIndex: 0 }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    // 档 2 方案 0 = +2 CA（DEFAULT_UPGRADE_PLANS[2]）
    expect(await res.json()).toMatchObject({ plan: { ca: 2, silver: 0, gold: 0 }, levelsApplied: 1, pendingLeft: 1 });
    expect(sqlGet<{ ca: number }>(fx.sqlite, 'SELECT ca FROM players WHERE id = 10')?.ca).toBe(82);
  });
});

/* ========================================================================== */
/* NG-09 · 消费方不回归                                                       */
/* ========================================================================== */

describe('NG-09 消费方：球员比赛 tab 与成长史仍读得到非成长球员的数据', () => {
  it('TC-NG-09 事件行与 value 对非成长球员照常可见（match_ref 口径 + 成长史）', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedMatch(fx, 900, { finishedAt: '2026-07-01 21:00:00' });
    // 非成长球员的两条事件（主闸写出来的形态：value 在、xp=0）
    seedEvent(fx, 11, '900', 'appearance', 1, 0, 'manual');
    seedEvent(fx, 11, '900', 'goal', 2, 0, 'auto');
    // 赛事库认得这个人（fc_id 102 → 队号 501），比赛 tab 的「哪支队」靠它
    fx.tour.exec(`
      INSERT INTO tournament (id, name, status) VALUES (5, '第七赛季联赛', 'running');
      INSERT INTO team (id, name) VALUES (501, '海港联'), (502, '北岸城');
      INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (1, 5, 501, 1), (2, 5, 502, 2);
      INSERT INTO player (id, team_id, name, number) VALUES (102, 501, 'N. Stay', 10);
    `);
    fx.auth.exec('INSERT INTO team (id, club_id, tour_team_id) VALUES (1, 1, 501);');

    const matches = await get('/api/players/102/matches', 'tok-admin', fx.env);
    expect(matches.status).toBe(200);
    const matchBody = (await matches.json()) as {
      matches: { matchId: number; appeared: boolean; sources: string[] }[];
      seasons: { total: { appearances: number } }[];
    };
    expect(matchBody.matches).toHaveLength(1);
    expect(matchBody.matches[0]).toMatchObject({ matchId: 900, appeared: true });
    expect(matchBody.matches[0].sources).toContain('growth');
    expect(matchBody.seasons[0].total.appearances).toBe(1);

    const growth = await get('/api/players/102/growth', 'tok-admin', fx.env);
    expect(growth.status).toBe(200);
    const growthBody = (await growth.json()) as { player: { growthXp: number }; events: { eventType: string; value: number; xp: number }[] };
    expect(growthBody.player.growthXp).toBe(0);
    expect(growthBody.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'appearance', value: 1 }),
        expect.objectContaining({ eventType: 'goal', value: 2, xp: 0 }),
      ]),
    );
  });
});

/* ========================================================================== */
/* NG-10 · 前端静态锁                                                          */
/* ========================================================================== */

describe('NG-10 前端：非成长行徽标 / 行 XP 归零 / 输入可用', () => {
  const page = readFileSync(`${WEB_SRC}pages/admin/GrowthEntryPage.tsx`, 'utf8');
  const seasons = readFileSync(`${WEB_SRC}pages/admin/SeasonsPage.tsx`, 'utf8');
  const api = readFileSync(`${WEB_SRC}lib/api.ts`, 'utf8');

  it('TC-NG-10a 面板 DTO 映射、rowXp 先归零再算 extraXp、合计走 rowXp', () => {
    // 漏字段/老后端按非成长处理（与 SQL 侧 COALESCE 同向，只会少报不会虚报）
    expect(page).toContain('growable: p.growable === true');

    // rowXp 必须在累加 extraXp（已录进球/助攻的 XP）之前返回 0
    const rowXpBody = /const rowXp = \(r: RowDraft\): number => \{([\s\S]*?)\n\};/.exec(page)?.[1] ?? '';
    expect(rowXpBody).toContain('if (!r.growable) return 0;');
    const guardAt = rowXpBody.indexOf('if (!r.growable) return 0;');
    const extraAt = rowXpBody.indexOf('r.extraXp');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(extraAt);

    // 本场合计与四处展示都经 rowXp（不需要各改一遍）
    expect(page).toContain('const totalXp = activeRows.reduce((sum, r) => sum + rowXp(r), 0);');
  });

  it('TC-NG-10b 卡片与表格都出「非成长 · 不计 XP」徽标、输入不因 growable 被禁；文案改为「成长事件」', () => {
    const badges = page.match(/非成长 · 不计 XP/g) ?? [];
    expect(badges.length).toBeGreaterThanOrEqual(2); // 卡片头 + 桌面表格（窄屏卡片流共用卡片头）
    expect(page).toContain('非成长球员的录入照收（比赛数据要用），只是不计成长 XP');

    // 输入可用：growable 不得出现在任何 disabled / readOnly 表达式里
    expect(page).not.toMatch(/disabled[^\n]*growable/);
    expect(page).not.toMatch(/growable[^\n]*disabled/);
    expect(page).not.toMatch(/readOnly[^\n]*growable/);

    // 服务端 DTO 类型带 growable（前端据此标灰）
    expect(api).toMatch(/interface MatchEntryPlayer \{[\s\S]*?growable: boolean;/);

    // 确认赛果 toast 不再宣称「XP 事件」
    expect(seasons).toContain('条成长事件');
    expect(seasons).not.toContain('条 XP 事件');
  });
});
