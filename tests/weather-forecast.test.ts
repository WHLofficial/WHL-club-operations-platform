// v6.15.0 天气预报表（迁移 0057 · 按轮预报触发/预览 · 上座消费端三档优先级）。
// 用例编号与 docs/test-plans/v6.15.0-weather-forecast.md 一一对应（TC-MIG / TC-FC / TC-PV / TC-PRI），
// 数值基线（rng=0.5）：K = 1800×4.0×1.0×1.0×1.05 = 7560；多云 wx=0.97 → 上座 7333。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import type { ForecastResult, RoundMatchView } from '../src/worker/weather-ops.ts';
import { applyMigrations, authRegisterClubTeam, createAuthDb, createTestD1, runMigration, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { confirmResult } from '../src/worker/results.ts';
import { matchAttendanceStatements, type AttendanceHookInput } from '../src/worker/home.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
  kv: Map<string, string>;
}

const TOUR_SCHEMA = `
  CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
  CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT, config_json TEXT DEFAULT '{}');
  CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER);
  CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE player (id INTEGER PRIMARY KEY, name TEXT, team_id INTEGER);
  CREATE TABLE match_event (id INTEGER PRIMARY KEY, match_id INTEGER, type TEXT, player_id INTEGER, assist_player_id INTEGER);
  CREATE TABLE match (id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER,
    home_entry_id INTEGER, away_entry_id INTEGER, winner_entry_id,
    score_home REAL, score_away REAL, pen_home REAL, pen_away REAL,
    walkover_side TEXT, status TEXT, finished_at TEXT);`;

function freshEnv(): Fixture {
  resetConfigCache();
  resetGuards(); // 公开缓存代际键/限流桶逐用例清零（预报触发走后端路由，不涉缓存，但保持夹具同口径）
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(TOUR_SCHEMA);
  // 管理端 requireAdmin 读 TOUR_DB 的 user 表（与 event-ops.test.ts 同款）
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0), (2, '管理组甲', 'admin', 0, 0);`,
  );
  const { sqlite: authSqlite, d1: authD1 } = createAuthDb();
  const kv = new Map<string, string>();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    AUTH_DB: authD1,
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    rng: () => 0.5,
  } as unknown as Env;
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-admin', JSON.stringify({ userId: 2 }));
  return { env, sqlite, tour, auth: authSqlite, kv };
}

interface ClubOpts {
  capacity?: number;
  tier?: number;
  fans?: number;
  shell?: number;
  nextMod?: number;
  nextWeather?: string;
  stadiumName?: string;
  /** false = 不建球场行（「有映射无球场」跳过分支） */
  stadium?: boolean;
}

function seedClub(fx: Fixture, clubId: number, tourTeamId: number, opts: ClubOpts = {}): void {
  fx.sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (?, ?, 'premier', 'active')`).run(clubId, `俱乐部${clubId}`);
  fx.sqlite
    .prepare(`INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, 50, '2026-01-01T00:00:00Z')`)
    .run(clubId);
  if (opts.stadium !== false) {
    fx.sqlite
      .prepare(
        `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit, next_attendance_mod, next_weather, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run(
        clubId,
        opts.stadiumName ?? `球场${clubId}`,
        opts.capacity ?? 20000,
        opts.tier ?? 0,
        opts.shell ?? 0,
        opts.fans ?? 1800,
        opts.nextMod ?? 1,
        opts.nextWeather ?? '',
      );
  }
  authRegisterClubTeam(fx.auth, tourTeamId, clubId, `队${tourTeamId}`);
}

function addTournament(fx: Fixture, tournamentId: number, stageId: number, stageName = '常规赛'): void {
  fx.tour.prepare('INSERT INTO tournament (id, name, status) VALUES (?, ?, ?)').run(tournamentId, `赛事${tournamentId}`, 'active');
  fx.tour
    .prepare(`INSERT INTO stage (id, tournament_id, kind, sort_order, name, config_json) VALUES (?, ?, 'round_robin', 1, ?, '{}')`)
    .run(stageId, tournamentId, stageName);
}

function addTeam(fx: Fixture, teamId: number, name: string): void {
  fx.tour.prepare('INSERT INTO team (id, name) VALUES (?, ?)').run(teamId, name);
}

function addMatch(
  fx: Fixture,
  matchId: number,
  homeTeamId: number,
  awayTeamId: number,
  opts: { tournamentId?: number; stageId?: number; round?: number } = {},
): void {
  const tournamentId = opts.tournamentId ?? 5;
  const stageId = opts.stageId ?? 50;
  const homeEntry = matchId * 2;
  const awayEntry = matchId * 2 + 1;
  fx.tour
    .prepare('INSERT INTO entry (id, tournament_id, team_id) VALUES (?, ?, ?), (?, ?, ?)')
    .run(homeEntry, tournamentId, homeTeamId, awayEntry, tournamentId, awayTeamId);
  fx.tour
    .prepare(
      `INSERT INTO match (id, stage_id, round, home_entry_id, away_entry_id, winner_entry_id,
         score_home, score_away, pen_home, pen_away, walkover_side, status, finished_at)
       VALUES (?, ?, ?, ?, ?, NULL, 2, 0, NULL, NULL, NULL, 'finished', '2026-09-16T00:00:00Z')`,
    )
    .run(matchId, stageId, opts.round ?? 0, homeEntry, awayEntry);
}

function bindSeason(fx: Fixture, tournamentId: number, season = 1): void {
  fx.sqlite
    .prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, 'league_premier', '2026-09-16T00:00:00Z')`)
    .run(season, tournamentId);
}

function addForecastRow(fx: Fixture, weather: string, wxCoef: number, opts: { matchId?: number; clubId?: number } = {}): void {
  fx.sqlite
    .prepare(
      `INSERT INTO match_weather (match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at)
       VALUES (?, ?, 1, 5, 0, ?, ?, 2, '2026-09-16T00:00:00Z')`,
    )
    .run(opts.matchId ?? 1, opts.clubId ?? 1, weather, wxCoef);
}

function addAttendanceRow(fx: Fixture, weather: string, opts: { matchId?: number; attendance?: number; clubId?: number } = {}): void {
  fx.sqlite
    .prepare(
      `INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
       VALUES (?, ?, 1, 0, ?, ?, 0.96, 0.13, 0.9, '2026-09-16T00:00:00Z')`,
    )
    .run(opts.matchId ?? 1, opts.clubId ?? 1, weather, opts.attendance ?? 6388);
}

/** 基线场景：赛事 5 / 轮 0 两场同主队（俱乐部 1，球场齐）；客队俱乐部 2 无球场行 */
function seedForecastFixture(): Fixture {
  const fx = freshEnv();
  addTournament(fx, 5, 50);
  addTeam(fx, 11, '队11');
  addTeam(fx, 12, '队12');
  seedClub(fx, 1, 11, { shell: 90 });
  seedClub(fx, 2, 12, { stadium: false });
  addMatch(fx, 1, 11, 12, { round: 0 });
  addMatch(fx, 2, 11, 12, { round: 0 });
  bindSeason(fx, 5);
  return fx;
}

/** 上座消费端夹具（对齐 tests/event-ops.test.ts:975-987）：主队影响力 90 → 对手系数 1.05 → K = 7560 */
function seedMatchFixture(opts: { nextMod?: number; nextWeather?: string } = {}): Fixture {
  const fx = freshEnv();
  addTournament(fx, 5, 50);
  addTeam(fx, 11, '队11');
  addTeam(fx, 12, '队12');
  seedClub(fx, 1, 11, { shell: 90, stadiumName: '主场', ...opts });
  seedClub(fx, 2, 12, { stadium: false });
  fx.sqlite
    .prepare(`INSERT INTO club_facilities (club_id, facility_key, level) VALUES (1, 'commercial', 2), (1, 'broadcast', 3)`)
    .run();
  addMatch(fx, 1, 11, 12, { round: 0 });
  bindSeason(fx, 5);
  return fx;
}

const postForecast = (fx: Fixture, body: unknown, cookie = 'whl_session=tok-admin') =>
  app.request(
    '/api/admin/weather/forecast',
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) },
    fx.env,
  );

const getPreview = (path: string, fx: Fixture, cookie = 'whl_session=tok-admin') =>
  app.request(path, { headers: { Cookie: cookie } }, fx.env);

const forecastCount = (fx: Fixture, where = '') => sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM match_weather ${where}`)!.n;
const auditCount = (fx: Fixture) => sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM audit_log')!.n;
const attendanceOf = (fx: Fixture) =>
  sqlGet<{ weather: string; attendance: number; club_id: number }>(fx.sqlite, 'SELECT weather, attendance, club_id FROM match_attendance WHERE match_id = 1');
const revenueMemo = (fx: Fixture) => sqlGet<{ memo: string }>(fx.sqlite, `SELECT memo FROM ledger_entries WHERE kind = 'revenue' ORDER BY id DESC LIMIT 1`)!.memo;

/** 需求公式（与 home.ts 同序相乘；rng=0.5 时 K=7560）——只用于反推期望上座，不替代被测实现 */
function demandOf(wx: number, perturbation: number, nextMod = 1): number {
  return 1800 * 4.0 * 1.0 * 1.0 * wx * 1.05 * nextMod * perturbation;
}

describe('TC-MIG · 迁移与结构', () => {
  it('TC-MIG-01 0057 建出 match_weather 表与按轮索引', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const cols = sqlAll<{ name: string; type: string; notnull: number; pk: number }>(sqlite, 'PRAGMA table_info(match_weather)');
    expect(cols.map((c) => c.name)).toEqual([
      'match_id',
      'club_id',
      'season',
      'tournament_id',
      'round',
      'weather',
      'wx_coef',
      'forecast_by',
      'created_at',
    ]);
    const by = new Map(cols.map((c) => [c.name, c]));
    expect(by.get('match_id')!.pk).toBe(1); // 主键即幂等闸
    expect(by.get('match_id')!.type).toBe('INTEGER');
    expect(by.get('club_id')!.type).toBe('INTEGER');
    expect(by.get('season')!.type).toBe('INTEGER');
    expect(by.get('tournament_id')!.type).toBe('INTEGER');
    // round 可空（比赛系统轮号可空），其余列 NOT NULL
    expect(by.get('round')!.notnull).toBe(0);
    for (const name of ['club_id', 'season', 'tournament_id', 'weather', 'wx_coef', 'created_at']) {
      expect(by.get(name)!.notnull).toBe(1);
    }
    expect(by.get('weather')!.type).toBe('TEXT');
    expect(by.get('wx_coef')!.type).toBe('REAL');
    expect(by.get('forecast_by')!.type).toBe('INTEGER');
    expect(by.get('forecast_by')!.notnull).toBe(0); // 预报人可空（历史/脚本落库）
    const idx = sqlGet<{ sql: string }>(
      sqlite,
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_match_weather_round'`,
    );
    expect(idx?.sql).toContain('(tournament_id, round)');
  });

  it('TC-MIG-02 match_id 主键即幂等闸（重复 INSERT 抛 UNIQUE，原值不变）', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const insert = (weather: string, wxCoef: number) =>
      sqlite
        .prepare(
          `INSERT INTO match_weather (match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at)
           VALUES (1, 1, 1, 5, 0, ?, ?, 2, '2026-09-16T00:00:00Z')`,
        )
        .run(weather, wxCoef);
    insert('雪', 0.77);
    expect(() => insert('晴', 1.15)).toThrow(/UNIQUE/);
    const rows = sqlAll<{ match_id: number; weather: string; wx_coef: number; created_at: string }>(
      sqlite,
      'SELECT match_id, weather, wx_coef, created_at FROM match_weather',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.weather).toBe('雪');
    expect(rows[0]!.wx_coef).toBe(0.77);
    expect(rows[0]!.created_at).toBe('2026-09-16T00:00:00Z');
  });

  it('TC-MIG-03 MIGRATION_FILES 尾部追加 0059 且全量迁移可跑', () => {
    // MIGRATION_FILES 未导出（tests/d1.ts:67 为模块内常量）：读源码文本锁「尾部追加」这一动作
    const src = readFileSync(fileURLToPath(new URL('./d1.ts', import.meta.url).href), 'utf8');
    expect(src).toMatch(/'0059_bid_guard_activation\.sql',?\s*\];/);
    const sqlite = new DatabaseSync(':memory:');
    expect(() => applyMigrations(sqlite)).not.toThrow();
    expect(
      sqlAll(sqlite, `SELECT name FROM sqlite_master WHERE name IN ('match_weather', 'idx_match_weather_round')`),
    ).toHaveLength(2);
  });

  it('TC-MIG-04 迁移向后兼容：存量库升级不丢数据', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite, '0056_event_seed_brand_visit.sql');
    sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '俱乐部1', 'premier', 'active');
      INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit, next_attendance_mod, next_weather, created_at, updated_at)
        VALUES (1, '球场1', 20000, 0, 90, 0, 1800, 0, 1.5, '雨', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
        VALUES (1, 1, 1, 0, '雨', 6388, 0.96, 0.13, 0.9, '2026-01-01T00:00:00Z');
      INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at)
        VALUES (1, 5, 'league_premier', '2026-01-01T00:00:00Z');
    `);
    runMigration(sqlite, '0057_match_weather.sql');
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM match_attendance')!.n).toBe(1);
    expect(sqlGet<{ weather: string; attendance: number }>(sqlite, 'SELECT weather, attendance FROM match_attendance WHERE match_id = 1')).toEqual({
      weather: '雨',
      attendance: 6388,
    });
    expect(sqlGet<{ next_weather: string }>(sqlite, 'SELECT next_weather FROM stadiums WHERE club_id = 1')!.next_weather).toBe('雨');
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM season_tournaments')!.n).toBe(1);
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM match_weather')!.n).toBe(0); // 新表空
  });
});

describe('TC-FC · 预报触发 POST /api/admin/weather/forecast', () => {
  it('TC-FC-01 正常预报：逐场落 weather + wx_coef，值逐字可推算', async () => {
    const fx = seedForecastFixture();
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(body.tournamentId).toBe(5);
    expect(body.round).toBe(0);
    expect(body.forecast.map((f) => f.matchId)).toEqual([1, 2]);
    expect(body.existing).toEqual([]);
    expect(body.confirmed).toEqual([]);
    expect(body.skipped).toEqual([]);

    const rows = sqlAll<{
      match_id: number;
      club_id: number;
      season: number;
      tournament_id: number;
      round: number;
      weather: string;
      wx_coef: number;
      forecast_by: number;
      created_at: string;
    }>(fx.sqlite, 'SELECT * FROM match_weather ORDER BY match_id');
    expect(rows).toHaveLength(2);
    const expectedWx = 0.9 + 0.5 * (1.04 - 0.9); // uniform(rng, 0.9, 1.04)（rng=0.5）——与实现同形
    for (const row of rows) {
      expect(row.weather).toBe('多云'); // rollWeather(rng=0.5)：40/30/20/10 表的第二档
      expect(row.wx_coef).toBeCloseTo(0.97, 10);
      expect(row.wx_coef).toBe(expectedWx);
      expect(row.club_id).toBe(1);
      expect(row.season).toBe(1);
      expect(row.tournament_id).toBe(5);
      expect(row.round).toBe(0);
      expect(row.forecast_by).toBe(2); // 管理组甲
      expect(row.created_at).not.toBe('');
    }
  });

  it('TC-FC-02 返回四段列表的结构与计数', async () => {
    const fx = seedForecastFixture();
    addTeam(fx, 99, 'CPU队');
    addMatch(fx, 3, 12, 11, { round: 0 }); // 主队俱乐部 2：有映射无球场行
    addMatch(fx, 4, 99, 11, { round: 0 }); // 主队无平台映射（CPU）
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(body.forecast.map((f) => f.matchId)).toEqual([1, 2]);
    expect(body.existing).toEqual([]);
    expect(body.confirmed).toEqual([]);
    expect(body.skipped.map((s) => [s.matchId, s.reason])).toEqual([
      [3, '主队没有球场'],
      [4, '主队不是平台俱乐部'],
    ]);
    // 跳过场次不得静默丢弃：四段计数之和 = 该轮主场比赛总数
    const total = body.forecast.length + body.existing.length + body.confirmed.length + body.skipped.length;
    expect(total).toBe(4);
    expect(forecastCount(fx)).toBe(2);
  });

  it('TC-FC-03 幂等：重复触发保留已预报（雪/0.77 不被重滚）', async () => {
    const fx = seedForecastFixture();
    await postForecast(fx, { tournamentId: 5, round: 0 });
    // 模拟既有预报：直改库成另一档值
    fx.sqlite.prepare(`UPDATE match_weather SET weather = '雪', wx_coef = 0.77`).run();
    const before = sqlAll<{ match_id: number; weather: string; wx_coef: number; forecast_by: number; created_at: string }>(
      fx.sqlite,
      'SELECT match_id, weather, wx_coef, forecast_by, created_at FROM match_weather ORDER BY match_id',
    );
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(body.forecast).toEqual([]);
    expect(body.existing.map((e) => [e.matchId, e.weather, e.wxCoef])).toEqual([
      [1, '雪', 0.77],
      [2, '雪', 0.77],
    ]);
    expect(
      sqlAll(fx.sqlite, 'SELECT match_id, weather, wx_coef, forecast_by, created_at FROM match_weather ORDER BY match_id'),
    ).toEqual(before);
  });

  it('TC-FC-04 已确认比赛跳过（有 match_attendance 行）', async () => {
    const fx = seedForecastFixture();
    addAttendanceRow(fx, '雨', { matchId: 1 });
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(body.confirmed.map((c) => [c.matchId, c.weather])).toEqual([[1, '雨']]);
    expect(body.forecast.map((f) => f.matchId)).toEqual([2]);
    expect(forecastCount(fx, 'WHERE match_id = 1')).toBe(0);
    expect(sqlGet<{ weather: string; attendance: number }>(fx.sqlite, 'SELECT weather, attendance FROM match_attendance WHERE match_id = 1')).toEqual({
      weather: '雨',
      attendance: 6388,
    });
  });

  it('TC-FC-05 CPU 队主场跳过（无平台映射）', async () => {
    const fx = seedForecastFixture();
    addTeam(fx, 99, 'CPU队');
    addMatch(fx, 3, 99, 11, { round: 0 });
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(forecastCount(fx, 'WHERE match_id = 3')).toBe(0);
    expect(body.skipped.map((s) => [s.matchId, s.reason])).toEqual([[3, '主队不是平台俱乐部']]);
    expect(forecastCount(fx)).toBe(2); // 正常场次照落
  });

  it('TC-FC-06 有映射但无 stadiums 行 → 跳过', async () => {
    const fx = seedForecastFixture();
    addMatch(fx, 3, 12, 11, { round: 0 }); // 主队 club 2：有映射无球场
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(forecastCount(fx, 'WHERE match_id = 3')).toBe(0);
    expect(body.skipped.map((s) => [s.matchId, s.reason])).toEqual([[3, '主队没有球场']]);
    expect(forecastCount(fx)).toBe(2);
  });

  it('TC-FC-07 赛事无赛季绑定 → 409（消息含「绑定」）', async () => {
    const fx = freshEnv();
    addTournament(fx, 5, 50);
    addTeam(fx, 11, '队11');
    addTeam(fx, 12, '队12');
    seedClub(fx, 1, 11, { shell: 90 });
    seedClub(fx, 2, 12, { stadium: false });
    addMatch(fx, 1, 11, 12, { round: 0 });
    // 故意不建 season_tournaments 行
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('绑定');
    expect(forecastCount(fx)).toBe(0);
    expect(auditCount(fx)).toBe(0);
  });

  it('TC-FC-08 参数校验 400（逐例点名非法字段）', async () => {
    const fx = seedForecastFixture();
    const cases: [unknown, string][] = [
      [{ round: 0 }, 'tournament_id'],
      [{ tournamentId: 'abc', round: 0 }, 'tournament_id'],
      [{ tournamentId: 5 }, 'round'],
      [{ tournamentId: 5, round: 1.5 }, 'round'],
      [{ tournamentId: 5, round: '二' }, 'round'],
      // 严格解析（评审 #1）：Number(null)/Number('') 都是 0，不得落成第 0 轮真的抽定落库
      [{ tournamentId: 5, round: null }, 'round'],
      [{ tournamentId: 5, round: '' }, 'round'],
      [{ tournamentId: 5, round: 201 }, 'round'],
    ];
    for (const [body, field] of cases) {
      const res = await postForecast(fx, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(field);
    }
    expect(forecastCount(fx)).toBe(0);
    expect(auditCount(fx)).toBe(0);
  });

  it('TC-FC-09 该轮无主场比赛 → 200 四段全空（审计仍写 attempted:0）', async () => {
    const fx = seedForecastFixture();
    const res = await postForecast(fx, { tournamentId: 5, round: 7 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(body).toEqual({ tournamentId: 5, round: 7, forecast: [], existing: [], confirmed: [], skipped: [] });
    expect(forecastCount(fx)).toBe(0);
    // 实现口径（首跑实测）：无待预报场次也走审计分支；v6.15.0 评审后 after 记 attempted（尝试数）
    const audit = sqlAll<{ action: string; after: string }>(fx.sqlite, `SELECT action, after FROM audit_log WHERE action = 'weather_forecast'`);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.after)).toEqual({ round: 7, attempted: 0 });
  });

  it('TC-FC-10 审计 weather_forecast（origin=user，after 含轮次与场次数）', async () => {
    const fx = seedForecastFixture();
    await postForecast(fx, { tournamentId: 5, round: 0 });
    const rows = sqlAll<{ actor: number; action: string; target_type: string; target_id: number; origin: string; after: string }>(
      fx.sqlite,
      'SELECT actor, action, target_type, target_id, origin, after FROM audit_log',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: 2,
      action: 'weather_forecast',
      target_type: 'tournament',
      target_id: 5,
      origin: 'user',
    });
    expect(JSON.parse(rows[0]!.after)).toEqual({ round: 0, attempted: 2 });
  });

  it('TC-FC-11 权限：非管理员拒绝（POST 与 GET 一致），零落行', async () => {
    const fx = seedForecastFixture();
    const coachPost = await postForecast(fx, { tournamentId: 5, round: 0 }, 'whl_session=tok-coach');
    expect(coachPost.status).toBe(403);
    expect(((await coachPost.json()) as { error: string }).error).toBe('没有权限进行此操作');
    const anonPost = await app.request(
      '/api/admin/weather/forecast',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tournamentId: 5, round: 0 }) },
      fx.env,
    );
    expect(anonPost.status).toBe(401);
    expect(((await anonPost.json()) as { error: string }).error).toBe('未登录');
    const coachGet = await getPreview('/api/admin/weather/forecast?tournament_id=5&round=0', fx, 'whl_session=tok-coach');
    expect(coachGet.status).toBe(403);
    expect(forecastCount(fx)).toBe(0);
    expect(auditCount(fx)).toBe(0);
  });

  it('TC-FC-12 wx_coef 落在该天气区间内（rng 序列 0.05/0.5/0.8/0.95）', async () => {
    const fx = seedForecastFixture();
    addMatch(fx, 3, 11, 12, { round: 0 });
    addMatch(fx, 4, 11, 12, { round: 0 });
    // 逐场两口：[rollWeather, uniform(wx)]；0.05→晴 / 0.5→多云 / 0.8→雨 / 0.95→雪
    const seq = [0.05, 0.05, 0.5, 0.5, 0.8, 0.8, 0.95, 0.95];
    let i = 0;
    fx.env.rng = () => seq[i++ % seq.length]!;
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const ranges: Record<string, [number, number]> = {
      晴: [1.05, 1.25],
      多云: [0.9, 1.04],
      雨: [0.8, 0.89],
      雪: [0.75, 0.79],
    };
    const rows = sqlAll<{ match_id: number; weather: string; wx_coef: number }>(
      fx.sqlite,
      'SELECT match_id, weather, wx_coef FROM match_weather ORDER BY match_id',
    );
    expect(rows.map((r) => r.weather)).toEqual(['晴', '多云', '雨', '雪']);
    rows.forEach((row, idx) => {
      const range = ranges[row.weather];
      expect(range).toBeDefined(); // 天气必须落在概率表四键里
      expect(row.wx_coef).toBeGreaterThanOrEqual(range![0]);
      expect(row.wx_coef).toBeLessThanOrEqual(range![1]);
      // 与 uniform 同形：区间取错（如晴用多云区间）会在此处红
      expect(row.wx_coef).toBe(range![0] + seq[idx * 2 + 1]! * (range![1] - range![0]));
    });
  });

  it('TC-FC-13 定位键 (tournament_id, round) 隔离', async () => {
    const fx = freshEnv();
    addTournament(fx, 5, 50);
    addTournament(fx, 6, 60);
    addTeam(fx, 11, '队11');
    addTeam(fx, 12, '队12');
    seedClub(fx, 1, 11, { shell: 90 });
    seedClub(fx, 2, 12, { stadium: false });
    addMatch(fx, 1, 11, 12, { round: 0 });
    addMatch(fx, 2, 11, 12, { round: 1 });
    addMatch(fx, 3, 11, 12, { tournamentId: 6, stageId: 60, round: 0 });
    bindSeason(fx, 5);
    bindSeason(fx, 6);
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    expect(sqlAll<{ match_id: number }>(fx.sqlite, 'SELECT match_id FROM match_weather ORDER BY match_id').map((r) => r.match_id)).toEqual([1]);
  });

  it('TC-FC-14 只预报主队场次，客队主场不落行', async () => {
    const fx = seedForecastFixture();
    addTeam(fx, 99, 'CPU队');
    addMatch(fx, 3, 99, 11, { round: 0 }); // 俱乐部 1 客场、CPU 队主场
    const res = await postForecast(fx, { tournamentId: 5, round: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastResult;
    expect(forecastCount(fx, 'WHERE match_id = 3')).toBe(0);
    // 客队无主场收入逻辑；该场按「主队不是平台俱乐部」进 skipped（实现口径）
    expect(body.skipped.find((s) => s.matchId === 3)?.reason).toBe('主队不是平台俱乐部');
    expect(forecastCount(fx)).toBe(2);
  });
});

describe('TC-PV · 预览 GET /api/admin/weather/forecast', () => {
  it('TC-PV-01 形状：该轮主场比赛 + 预报/确认/跳过状态', async () => {
    const fx = seedForecastFixture();
    addForecastRow(fx, '雪', 0.77, { matchId: 1 });
    addAttendanceRow(fx, '雨', { matchId: 2 });
    addMatch(fx, 3, 12, 11, { round: 0 }); // 主队 club 2：有映射无球场 → 跳过
    const res = await getPreview('/api/admin/weather/forecast?tournament_id=5&round=0', fx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tournamentId: number; round: number; matches: RoundMatchView[] };
    expect(body.tournamentId).toBe(5);
    expect(body.round).toBe(0);
    expect(body.matches.map((m) => m.matchId)).toEqual([1, 2, 3]);
    const [mine, confirmed, skipped] = body.matches;
    expect(mine).toMatchObject({
      homeClubId: 1,
      homeClubName: '俱乐部1',
      awayTeamName: '队12',
      stageName: '常规赛',
      finished: true,
      weather: '雪', // 已预报取 match_weather.weather
      wxCoef: 0.77,
      confirmedWeather: null,
      skippedReason: null,
    });
    expect(mine!.stadium).toEqual({ name: '球场1', capacity: 20000, tier: 0 });
    expect(confirmed).toMatchObject({
      weather: null, // 无预报行
      wxCoef: null,
      confirmedWeather: '雨', // 确认态取 match_attendance.weather
      attendance: 6388,
      ticket: 0.96,
      skippedReason: null,
    });
    expect(skipped).toMatchObject({ weather: null, wxCoef: null, confirmedWeather: null, skippedReason: '主队没有球场', stadium: null });
  });

  it('TC-PV-02 预览不掷随机、不落库（GET 两次 rng 计数不增）', async () => {
    const fx = seedForecastFixture();
    let calls = 0;
    fx.env.rng = () => {
      calls += 1;
      return 0.5;
    };
    const url = '/api/admin/weather/forecast?tournament_id=5&round=0';
    const first = await getPreview(url, fx);
    const second = await getPreview(url, fx);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toBe(0);
    expect(forecastCount(fx)).toBe(0);
    expect(await first.json()).toEqual(await second.json());
  });

  it('TC-PV-03 四态判定逐例', async () => {
    const fx = seedForecastFixture();
    addForecastRow(fx, '雪', 0.77, { matchId: 2 });
    addMatch(fx, 3, 11, 12, { round: 0 }); // 未预报未确认
    addAttendanceRow(fx, '雨', { matchId: 3 });
    addMatch(fx, 4, 12, 11, { round: 0 }); // 主队 club 2：有映射无球场 → 跳过
    const res = await getPreview('/api/admin/weather/forecast?tournament_id=5&round=0', fx);
    const body = (await res.json()) as { matches: RoundMatchView[] };
    const byId = new Map(body.matches.map((m) => [m.matchId, m]));
    // 未预报未确认（match 1）
    expect(byId.get(1)).toMatchObject({ weather: null, wxCoef: null, confirmedWeather: null, skippedReason: null });
    // 已预报未确认
    expect(byId.get(2)).toMatchObject({ weather: '雪', wxCoef: 0.77, confirmedWeather: null, skippedReason: null });
    // 已确认（有 match_attendance 行）
    expect(byId.get(3)).toMatchObject({ weather: null, confirmedWeather: '雨', attendance: 6388, skippedReason: null });
    // 跳过（无球场行）
    expect(byId.get(4)).toMatchObject({ weather: null, confirmedWeather: null, skippedReason: '主队没有球场' });
  });

  it('TC-PV-04 参数与绑定校验与触发端点一致', async () => {
    const fx = seedForecastFixture();
    addTournament(fx, 6, 60);
    addMatch(fx, 3, 11, 12, { tournamentId: 6, stageId: 60, round: 0 }); // 赛事 6 不建绑定
    for (const [url, field] of [
      ['/api/admin/weather/forecast?round=0', 'tournament_id'],
      ['/api/admin/weather/forecast?tournament_id=5&round=1.5', 'round'],
    ] as [string, string][]) {
      const res = await getPreview(url, fx);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(field);
    }
    const unbound = await getPreview('/api/admin/weather/forecast?tournament_id=6&round=0', fx);
    expect(unbound.status).toBe(409);
    expect(((await unbound.json()) as { error: string }).error).toContain('绑定');
  });

  it('TC-PV-05 权限与触发端点一致：教练拒绝、匿名 401', async () => {
    const fx = seedForecastFixture();
    addForecastRow(fx, '雪', 0.77, { matchId: 1 });
    const coach = await getPreview('/api/admin/weather/forecast?tournament_id=5&round=0', fx, 'whl_session=tok-coach');
    expect(coach.status).toBe(403);
    expect(((await coach.json()) as { error: string }).error).toBe('没有权限进行此操作');
    const anon = await getPreview('/api/admin/weather/forecast?tournament_id=5&round=0', fx, '');
    expect(anon.status).toBe(401);
    const anonBody = (await anon.json()) as Record<string, unknown>;
    expect(Object.keys(anonBody)).toEqual(['error']); // 不泄露预报数据结构
  });
});

describe('TC-PRI · 消费端三档优先级（home.ts matchAttendanceStatements / confirmResult）', () => {
  it('TC-PRI-01 预报命中：weather 与 wx 都取落库值，rng 零天气消费', async () => {
    const fx = seedMatchFixture();
    addForecastRow(fx, '晴', 1.11); // 故意不等于 rng=0.5 会滚出的 1.15
    let calls = 0;
    fx.env.rng = () => {
      calls += 1;
      return 0.5;
    };
    await confirmResult(fx.env, 1, 1, 'user');
    const row = attendanceOf(fx)!;
    expect(row.weather).toBe('晴');
    expect(row.attendance).toBe(8391); // floor(7560 × 1.11)
    expect(row.attendance).toBe(Math.floor(demandOf(1.11, 1.0)));
    expect(calls).toBe(2); // 预报命中：只抽 perturbation + sell_out_fill
  });

  it('TC-PRI-02 预报命中 memo 文案', async () => {
    const fx = seedMatchFixture();
    addForecastRow(fx, '晴', 1.11);
    await confirmResult(fx.env, 1, 1, 'user');
    const memo = revenueMemo(fx);
    expect(memo).toContain('（赛前预报）');
    expect(memo).not.toContain('（事件预置）');
    expect(memo).toContain('晴');
    expect(memo).toContain('8391');
  });

  it('TC-PRI-03 事件预置优先于预报（雨 6388，预报行保留）', async () => {
    const fx = seedMatchFixture({ nextWeather: '雨' });
    addForecastRow(fx, '晴', 1.11);
    await confirmResult(fx.env, 1, 1, 'user');
    const row = attendanceOf(fx)!;
    expect(row.weather).toBe('雨');
    expect(row.attendance).toBe(6388); // wx=0.845 现抽
    const memo = revenueMemo(fx);
    expect(memo).toContain('（事件预置）');
    expect(memo).not.toContain('（赛前预报）');
    // 预置一次性消费：同批清零
    expect(sqlGet<{ next_attendance_mod: number; next_weather: string }>(fx.sqlite, 'SELECT next_attendance_mod, next_weather FROM stadiums WHERE club_id = 1')).toEqual({
      next_attendance_mod: 1,
      next_weather: '',
    });
    expect(forecastCount(fx)).toBe(1); // 预报行不因预置命中而消失
  });

  it('TC-PRI-04 无预报无预置：与现状逐字一致（回归锁）', async () => {
    const fx = seedMatchFixture();
    await confirmResult(fx.env, 1, 1, 'user');
    const row = attendanceOf(fx)!;
    expect(row.weather).toBe('多云');
    expect(row.attendance).toBe(7333);
    expect(revenueMemo(fx)).not.toContain('（赛前预报）');
    expect(revenueMemo(fx)).not.toContain('（事件预置）');
  });

  it('TC-PRI-05 预报天气为表外值（人工改库）→ 按落库值直用', async () => {
    const fx = seedMatchFixture();
    addForecastRow(fx, '台风', 1.0);
    await confirmResult(fx.env, 1, 1, 'user');
    const row = attendanceOf(fx)!;
    expect(row.weather).toBe('台风'); // 实测口径：消费端不校验天气表，直用
    expect(row.attendance).toBe(7560); // wx_coef=1.0 → K
    expect(sqlGet<{ next_weather: string }>(fx.sqlite, 'SELECT next_weather FROM stadiums WHERE club_id = 1')!.next_weather).toBe('');
  });

  it('TC-PRI-06 预报行消费后保留（可重放对账）', async () => {
    const fx = seedMatchFixture();
    addForecastRow(fx, '晴', 1.11);
    const before = sqlGet<{ weather: string; wx_coef: number; created_at: string }>(
      fx.sqlite,
      'SELECT weather, wx_coef, created_at FROM match_weather WHERE match_id = 1',
    );
    await confirmResult(fx.env, 1, 1, 'user');
    expect(sqlGet(fx.sqlite, 'SELECT weather, wx_coef, created_at FROM match_weather WHERE match_id = 1')).toEqual(before);
  });

  it('TC-PRI-07 wx_coef 被人工改成中性 1.0 → 直用（7560）', async () => {
    const fx = seedMatchFixture();
    addForecastRow(fx, '多云', 1.0);
    await confirmResult(fx.env, 1, 1, 'user');
    const row = attendanceOf(fx)!;
    expect(row.weather).toBe('多云');
    expect(row.attendance).toBe(7560); // 不特判 1.0、不回退区间中点 0.97
  });

  it('TC-PRI-08 随机序列位置不变性（有预报 2 口 vs 无预报 4 口）', async () => {
    // A：预报命中 → perturbation 吃第 1 口、fill 第 2 口，wx 一口不抽
    const fa = seedMatchFixture();
    addForecastRow(fa, '多云', 1.0);
    const seqA = [0.5, 0.0, 0.2, 0.8];
    let callsA = 0;
    fa.env.rng = () => seqA[callsA++ % seqA.length]!;
    await confirmResult(fa.env, 1, 1, 'user');
    expect(attendanceOf(fa)!.attendance).toBe(7560); // 0.97+0.5×0.06 = 1.0（第 1 口）
    expect(callsA).toBe(2);

    // B：无预报 → weather 第 1 口、wx 第 2 口、perturbation 第 3 口、fill 第 4 口
    const fb = seedMatchFixture();
    const seqB = [0.5, 1.0, 0.25, 0.75];
    let callsB = 0;
    fb.env.rng = () => seqB[callsB++ % seqB.length]!;
    await confirmResult(fb.env, 1, 1, 'user');
    const rowB = attendanceOf(fb)!;
    expect(rowB.weather).toBe('多云'); // 第 1 口 0.5
    expect(rowB.attendance).toBe(7744); // wx=1.04（第 2 口）× perturbation 0.985（第 3 口）
    expect(rowB.attendance).toBe(Math.floor(demandOf(1.04, 0.985)));
    expect(callsB).toBe(4);
  });

  it('TC-PRI-09 双闸仍在：已有 match_attendance 时钩子整段跳过（预报未消费、预置不清零）', async () => {
    const fx = seedMatchFixture({ nextWeather: '雨' });
    addForecastRow(fx, '晴', 1.11);
    addAttendanceRow(fx, '雨', { matchId: 1 });
    const input: AttendanceHookInput = { matchId: 1, season: 1, windowSeq: 0, homeTeamId: 11, awayTeamId: 12 };
    const out = await matchAttendanceStatements(fx.env, input);
    expect(out.detail).toBeNull();
    expect(out.statements).toHaveLength(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'revenue'`)).toEqual({ n: 0 });
    expect(forecastCount(fx)).toBe(1); // 预报行未被消费
    expect(sqlGet<{ next_weather: string }>(fx.sqlite, 'SELECT next_weather FROM stadiums WHERE club_id = 1')!.next_weather).toBe('雨'); // 跳过发生在清零之前
    // 重放整条确认路径：仍是 detail=null（幂等）
    await confirmResult(fx.env, 1, 1, 'user');
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'revenue'`)).toEqual({ n: 0 });
  });

  it('TC-PRI-10 预报行 club_id 与解析出的主场不一致（改期/换边）→ 不消费、回落现掷', async () => {
    const fx = seedMatchFixture();
    addForecastRow(fx, '晴', 1.11, { clubId: 2 }); // 预报落在俱乐部 2，主场却是俱乐部 1
    await confirmResult(fx.env, 1, 1, 'user');
    const row = attendanceOf(fx)!;
    // 实现口径（实测）：消费端查询带 AND club_id = ?，错配行不消费 → 回落现掷多云/7333
    expect(row.club_id).toBe(1);
    expect(row.weather).toBe('多云');
    expect(row.attendance).toBe(7333);
    expect(revenueMemo(fx)).not.toContain('（赛前预报）');
  });
});
