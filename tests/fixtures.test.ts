// v6.15.0 公开赛程面（GET /api/fixtures）与缓存治理（fixtures scope）。
// 用例编号与 docs/test-plans/v6.15.0-weather-forecast.md 一一对应（TC-PUB / TC-CACHE）。
// 夹具默认 PUBLIC_CACHE_TTL_MS='0'（旁路缓存，断言读库真值）；缓存用例逐例改 '60000'。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, authRegisterClubTeam, createAuthDb, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { CACHE_TTL_MS, PUBLIC_SCOPES, scopesForWritePath, ttlForScope } from '../src/lib/cache-policy.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
  kv: Map<string, string>;
}

interface PublicMatch {
  matchId: number;
  tournamentId: number;
  round: number;
  homeClub: { id: number; name: string };
  awayTeamName: string | null;
  stageName: string | null;
  finished: boolean;
  stadium: { name: string | null; capacity: number; tier: number } | null;
  weather: string | null;
  attendance: number | null;
}

interface FixturesBody {
  tournamentId: number;
  round: number;
  matches: PublicMatch[];
}

const MATCH_KEYS = [
  'attendance',
  'awayTeamName',
  'finished',
  'homeClub',
  'matchId',
  'round',
  'stadium',
  'stageName',
  'tournamentId',
  'weather',
].sort();

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
  resetGuards(); // 限流桶 + L1 缓存 + 代际键记忆逐用例清零
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(TOUR_SCHEMA);
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
    PUBLIC_CACHE_TTL_MS: '0',
    rng: () => 0.5,
  } as unknown as Env;
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-admin', JSON.stringify({ userId: 2 }));
  return { env, sqlite, tour, auth: authSqlite, kv };
}

function seedClub(fx: Fixture, clubId: number, tourTeamId: number, opts: { shell?: number; stadium?: boolean } = {}): void {
  fx.sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (?, ?, 'premier', 'active')`).run(clubId, `俱乐部${clubId}`);
  fx.sqlite
    .prepare(`INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, 50, '2026-01-01T00:00:00Z')`)
    .run(clubId);
  if (opts.stadium !== false) {
    fx.sqlite
      .prepare(
        `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit, next_attendance_mod, next_weather, created_at, updated_at)
         VALUES (?, ?, 20000, 0, ?, 0, 1800, 0, 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run(clubId, `球场${clubId}`, opts.shell ?? 0);
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

/** 基线场景：赛事 5 / 轮 0 一场（俱乐部 1 主场 vs 队12），球场与设施齐 */
function seedPublicFixture(): Fixture {
  const fx = freshEnv();
  addTournament(fx, 5, 50);
  addTeam(fx, 11, '队11');
  addTeam(fx, 12, '队12');
  seedClub(fx, 1, 11, { shell: 90 });
  seedClub(fx, 2, 12, { stadium: false });
  fx.sqlite
    .prepare(`INSERT INTO club_facilities (club_id, facility_key, level) VALUES (1, 'commercial', 2), (1, 'broadcast', 3)`)
    .run();
  addMatch(fx, 1, 11, 12, { round: 0 });
  bindSeason(fx, 5);
  return fx;
}

const get = (path: string, fx: Fixture, cookie?: string) =>
  app.request(path, { headers: cookie ? { Cookie: cookie } : {} }, fx.env);

const fixturesUrl = (tournamentId?: unknown, round?: unknown) => {
  const parts: string[] = [];
  if (tournamentId !== undefined) parts.push(`tournament_id=${tournamentId}`);
  if (round !== undefined) parts.push(`round=${round}`);
  return `/api/fixtures${parts.length ? `?${parts.join('&')}` : ''}`;
};

describe('TC-PUB · 公开只读 GET /api/fixtures', () => {
  it('TC-PUB-01 形状：主场比赛列表字段齐全', async () => {
    const fx = seedPublicFixture();
    addForecastRow(fx, '晴', 1.11, { matchId: 1 });
    const res = await get(fixturesUrl(5, 0), fx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FixturesBody;
    expect(body.tournamentId).toBe(5);
    expect(body.round).toBe(0);
    expect(body.matches).toHaveLength(1);
    const m = body.matches[0]!;
    expect(Object.keys(m).sort()).toEqual(MATCH_KEYS); // 白名单：无多余键
    expect(m.matchId).toBe(1);
    expect(m.tournamentId).toBe(5);
    expect(m.round).toBe(0);
    expect(m.homeClub).toEqual({ id: 1, name: '俱乐部1' });
    expect(m.awayTeamName).toBe('队12'); // tour 侧队名，不是俱乐部名/编号
    expect(m.stageName).toBe('常规赛');
    expect(m.finished).toBe(true);
    expect(m.stadium).toEqual({ name: '球场1', capacity: 20000, tier: 0 });
    expect(m.weather).toBe('晴'); // 未确认 → 取预报值
    // 未确认：上座 null；收入三件套已收窄出公开面（评审 #4），白名单由 MATCH_KEYS 锁死
    expect(m.attendance).toBeNull();
  });

  it('TC-PUB-02 匿名 200：与带 token 请求逐字一致', async () => {
    const fx = seedPublicFixture();
    addForecastRow(fx, '雪', 0.77, { matchId: 1 });
    const anon = await get(fixturesUrl(5, 0), fx);
    const withToken = await get(fixturesUrl(5, 0), fx, 'whl_session=tok-admin');
    expect(anon.status).toBe(200);
    expect(withToken.status).toBe(200);
    expect(await anon.text()).toBe(await withToken.text()); // 不因身份增删字段
  });

  it('TC-PUB-03 天气来源优先级：确认 > 预报', async () => {
    const fx = seedPublicFixture();
    addMatch(fx, 2, 11, 12, { round: 0 });
    addForecastRow(fx, '晴', 1.11, { matchId: 1 });
    addForecastRow(fx, '晴', 1.11, { matchId: 2 });
    addAttendanceRow(fx, '雨', { matchId: 2 }); // 已确认且与预报不同
    const body = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    const byId = new Map(body.matches.map((m) => [m.matchId, m]));
    expect(byId.get(1)!.weather).toBe('晴'); // 只预报 → 预报值
    expect(byId.get(2)!.weather).toBe('雨'); // 已确认 → 实际值
  });

  it('TC-PUB-03b 预报行 club_id 与主队错配 → 不展示（与消费端 AND club_id 同口径，评审 #2）', async () => {
    const fx = seedPublicFixture();
    addForecastRow(fx, '晴', 1.11, { matchId: 1, clubId: 2 }); // 主队是俱乐部 1，预报行挂在 2 上（改期/换边形态）
    const body = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(body.matches[0]!.weather).toBeNull();
  });

  it('TC-PUB-04 都无 → weather=null（不现掷兜底）', async () => {
    const fx = seedPublicFixture();
    const body = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    const m = body.matches[0]!;
    expect(m.weather).toBeNull();
    expect(m.attendance).toBeNull();
  });

  it('TC-PUB-05 参数校验 400（含空串落 0 与 round 上界，评审 #1/nit）', async () => {
    const fx = seedPublicFixture();
    for (const url of [fixturesUrl(undefined, 0), fixturesUrl(5, 1.5), fixturesUrl(5, 'x'), fixturesUrl(5, ''), fixturesUrl(5, 201)]) {
      const res = await get(url, fx);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/tournament_id|round/);
    }
  });

  it('TC-PUB-06 该轮无比赛 → 空列表 200 且写进缓存', async () => {
    const fx = seedPublicFixture();
    fx.env.PUBLIC_CACHE_TTL_MS = '60000';
    const first = await get(fixturesUrl(5, 7), fx);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ tournamentId: 5, round: 7, matches: [] });
    // 缓存已写入：之后库里补一场同轮比赛，第二次仍返回空列表（未重读库）
    addMatch(fx, 2, 11, 12, { round: 7 });
    const second = await get(fixturesUrl(5, 7), fx);
    expect(await second.json()).toEqual({ tournamentId: 5, round: 7, matches: [] });
  });

  it('TC-PUB-07 只出主队可解析的比赛（不伪造球场）', async () => {
    const fx = seedPublicFixture();
    addTeam(fx, 99, 'CPU队');
    addMatch(fx, 2, 99, 11, { round: 0 }); // CPU 队主场
    addMatch(fx, 3, 12, 11, { round: 0 }); // 平台俱乐部主场但无球场行
    const body = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(body.matches.map((m) => m.matchId)).toEqual([1]);
    expect(body.matches[0]!.stadium).toEqual({ name: '球场1', capacity: 20000, tier: 0 });
  });

  it('TC-PUB-08 确认后 weather 切到实际值（写路径 purge 生效）', async () => {
    const fx = seedPublicFixture();
    fx.env.PUBLIC_CACHE_TTL_MS = '60000';
    addForecastRow(fx, '晴', 1.11, { matchId: 1 });
    fx.sqlite.prepare(`UPDATE stadiums SET next_weather = '雨' WHERE club_id = 1`).run();
    const before = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(before.matches[0]!.weather).toBe('晴'); // 确认前：预报值
    const confirm = await app.request(
      '/api/admin/results/1/confirm',
      { method: 'POST', headers: { Cookie: 'whl_session=tok-admin' } },
      fx.env,
    );
    expect(confirm.status).toBe(201);
    expect(sqlGet<{ weather: string }>(fx.sqlite, 'SELECT weather FROM match_attendance WHERE match_id = 1')!.weather).toBe('雨');
    const after = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(after.matches[0]!.weather).toBe('雨'); // purge 后立即看到实际值
  });

  it('TC-PUB-09 未预报未确认不泄漏比例/系数', async () => {
    const fx = seedPublicFixture();
    const res = await get(fixturesUrl(5, 0), fx);
    const text = await res.text();
    expect(text).not.toContain('wx_coef');
    expect(text).not.toContain('forecast_by');
    expect(text).not.toContain('weather_probabilities');
    const body = JSON.parse(text) as FixturesBody;
    expect(body.matches).toHaveLength(1);
    expect(Object.keys(body.matches[0]!).sort()).toEqual(MATCH_KEYS); // 字段白名单与 TC-PUB-01 一致
  });

  it('TC-PUB-10 assertPublicRate 生效（第 61 次 429）', async () => {
    const fx = seedPublicFixture();
    for (let i = 1; i <= 60; i += 1) {
      const res = await get(fixturesUrl(5, 0), fx);
      expect(res.status).toBe(200);
    }
    const over = await get(fixturesUrl(5, 0), fx);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: '请求太频繁，请稍后再试' });
    // 限流先于读取：库里补一场后仍 429（429 不落缓存、也不被缓存绕过）
    addMatch(fx, 2, 11, 12, { round: 0 });
    expect((await get(fixturesUrl(5, 0), fx)).status).toBe(429);
  });
});

describe('TC-CACHE · 缓存治理（fixtures scope）', () => {
  it('TC-CACHE-01 fixtures scope TTL = 1h', () => {
    expect(CACHE_TTL_MS.fixtures).toBe(3_600_000);
    expect(CACHE_TTL_MS.fixtures).not.toBe(CACHE_TTL_MS.roster); // 不是 24h 档
  });

  it('TC-CACHE-02 PUBLIC_SCOPES 含 fixtures（3→4），写路径覆盖预报端点', () => {
    expect(PUBLIC_SCOPES).toHaveLength(4);
    expect(PUBLIC_SCOPES).toContain('fixtures');
    expect(scopesForWritePath('/api/admin/weather/forecast')).toEqual(['players', 'roster', 'clubs', 'fixtures']);
  });

  it('TC-CACHE-03 既有 3 元素断言已同步为 4，且边界不误伤', () => {
    // 断言同步的机读锚点（运行期等价性由这两个文件自身跑绿保证）
    const guardSrc = readFileSync(fileURLToPath(new URL('./guard.test.ts', import.meta.url).href), 'utf8');
    const teamSyncSrc = readFileSync(fileURLToPath(new URL('./team-sync.test.ts', import.meta.url).href), 'utf8');
    expect(guardSrc).toContain('expect(PUBLIC_SCOPES.length).toBe(4)');
    expect(guardSrc).toContain(`expect(scopesForWritePath('/api/club')).toEqual([...PUBLIC_SCOPES])`);
    expect(teamSyncSrc).toContain(`expect(scopesForWritePath('/api/internal/team-upsert')).toEqual(['players', 'roster', 'clubs', 'fixtures'])`);
    // 边界：公开只读目录与只写通知的路径不进 scope 列表
    expect(scopesForWritePath('/api/clubs/directory')).toEqual([]);
    expect(scopesForWritePath('/api/notifications/read')).toEqual([]);
  });

  it('TC-CACHE-04 缓存命中与键隔离（tournament_id × round）', async () => {
    const fx = seedPublicFixture();
    addTournament(fx, 6, 60);
    addMatch(fx, 2, 11, 12, { round: 1 });
    addMatch(fx, 3, 11, 12, { tournamentId: 6, stageId: 60, round: 0 });
    bindSeason(fx, 6);
    addForecastRow(fx, '晴', 1.11, { matchId: 1 });
    fx.sqlite
      .prepare(
        `INSERT INTO match_weather (match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at)
         VALUES (2, 1, 1, 5, 1, '雪', 0.77, 2, '2026-09-16T00:00:00Z'),
                (3, 1, 1, 6, 0, '雨', 0.845, 2, '2026-09-16T00:00:00Z')`,
      )
      .run();
    fx.env.PUBLIC_CACHE_TTL_MS = '60000';
    const first = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(first.matches[0]!.weather).toBe('晴');
    // 改库后同参数再取：命中缓存 → 仍返回旧值
    fx.sqlite.prepare(`UPDATE match_weather SET weather = '台风' WHERE match_id = 1`).run();
    const second = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(second.matches[0]!.weather).toBe('晴');
    // 键隔离：(5,1) 与 (6,0) 各自独立（键漏 round 或漏 tournament_id 会在此串数据）
    const r51 = (await (await get(fixturesUrl(5, 1), fx)).json()) as FixturesBody;
    expect(r51.round).toBe(1);
    expect(r51.matches.map((m) => [m.matchId, m.weather])).toEqual([[2, '雪']]);
    const r60 = (await (await get(fixturesUrl(6, 0), fx)).json()) as FixturesBody;
    expect(r60.tournamentId).toBe(6);
    expect(r60.matches.map((m) => [m.matchId, m.weather])).toEqual([[3, '雨']]);
  });

  it('TC-CACHE-05 写路径 purge：预报后立即可见 + KV 代际键 +1', async () => {
    const fx = seedPublicFixture();
    fx.env.PUBLIC_CACHE_TTL_MS = '60000';
    const before = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(before.matches[0]!.weather).toBeNull(); // 预热：未预报的旧缓存
    const post = await app.request(
      '/api/admin/weather/forecast',
      { method: 'POST', headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-admin' }, body: JSON.stringify({ tournamentId: 5, round: 0 }) },
      fx.env,
    );
    expect(post.status).toBe(200);
    const after = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(after.matches[0]!.weather).toBe('多云'); // 不陈旧
    expect(fx.kv.get('cache:epoch:public')).toBe('1'); // purge 写代际键
  });

  it("TC-CACHE-06 ttlForScope 旁路：'0' → 不缓存（两次都打 loader）", async () => {
    expect(ttlForScope('fixtures', '0')).toBe(0);
    const fx = seedPublicFixture(); // 夹具默认 PUBLIC_CACHE_TTL_MS='0'
    const first = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(first.matches[0]!.weather).toBeNull();
    addForecastRow(fx, '雪', 0.77, { matchId: 1 });
    const second = (await (await get(fixturesUrl(5, 0), fx)).json()) as FixturesBody;
    expect(second.matches[0]!.weather).toBe('雪'); // 旁路后读到库里的新值
  });

  it('TC-CACHE-07 环境变量覆盖优先级', () => {
    expect(ttlForScope('fixtures', undefined)).toBe(3_600_000); // 未配 → 默认表值
    expect(ttlForScope('fixtures', '60000')).toBe(60_000);
    expect(ttlForScope('fixtures', '0')).toBe(0);
    expect(ttlForScope('fixtures', 'abc')).toBe(3_600_000); // 非法 → 回落默认
  });
});
