// v6.44.0 天气同步入站（POST /api/internal/weather-sync）：插件侧天气真源 → 平台 match_weather。
//
// 契约的另一半在插件仓 tests/s18_club_sync.py——两边的金标准向量逐字同值（同样的 secret/ts/raw/hex），
// 任一侧偷改规范串、路径或 body 形状都会红。用例编号对应 docs/test-plans/v6.44.0-weather-sync.md。
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, authRegisterClubTeam, createAuthDb, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { hmacHex } from '../src/lib/hmac.ts';
import { WEATHER_SYNC_PATH, WEATHER_SYNC_FORECAST_BY } from '../src/worker/weather-ops.ts';
import { matchAttendanceStatements, type AttendanceHookInput } from '../src/worker/home.ts';
import { normTeamName } from '../src/core/name-fold.ts';

const SECRET = 'test-weather-sync-secret';
const SEASON = 9;

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
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

function freshEnv(opts: { secret?: boolean } = {}): Fixture {
  resetConfigCache();
  resetGuards();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(TOUR_SCHEMA);
  const { sqlite: authSqlite, d1: authD1 } = createAuthDb();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    AUTH_DB: authD1,
    MEDIA: {} as never,
    ASSETS: {} as never,
    rng: () => 0.5,
    ...(opts.secret === false ? {} : { WEATHER_SYNC_SECRET: SECRET }),
  } as unknown as Env;
  return { env, sqlite, tour, auth: authSqlite };
}

function seedClub(fx: Fixture, clubId: number, tourTeamId: number, opts: { shell?: number; stadium?: boolean; capacity?: number; fans?: number } = {}): void {
  fx.sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (?, ?, 'premier', 'active')`).run(clubId, `俱乐部${clubId}`);
  fx.sqlite.prepare(`INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, 0, '2026-01-01T00:00:00Z')`).run(clubId);
  if (opts.stadium !== false) {
    fx.sqlite
      .prepare(
        `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit, next_attendance_mod, next_weather, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 0, ?, 0, 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run(clubId, `球场${clubId}`, opts.capacity ?? 20000, opts.shell ?? 90, opts.fans ?? 1800);
  }
  authRegisterClubTeam(fx.auth, tourTeamId, clubId, `队${tourTeamId}`);
}

function addMatch(fx: Fixture, matchId: number, homeTeamId: number, awayTeamId: number, round = 1): void {
  const tournamentId = 5;
  const stageId = 50;
  const homeEntry = matchId * 2;
  const awayEntry = matchId * 2 + 1;
  fx.tour.prepare('INSERT INTO entry (id, tournament_id, team_id) VALUES (?, ?, ?), (?, ?, ?)').run(homeEntry, tournamentId, homeTeamId, awayEntry, tournamentId, awayTeamId);
  fx.tour
    .prepare(
      `INSERT INTO match (id, stage_id, round, home_entry_id, away_entry_id, winner_entry_id,
         score_home, score_away, pen_home, pen_away, walkover_side, status, finished_at)
       VALUES (?, ?, ?, ?, ?, NULL, 2, 0, NULL, NULL, NULL, 'finished', '2026-10-11T00:00:00Z')`,
    )
    .run(matchId, stageId, round, homeEntry, awayEntry);
}

function bindSeason(fx: Fixture, tournamentId = 5, competitionType = 'league_premier', season = SEASON): void {
  fx.sqlite
    .prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, ?, '2026-10-01T00:00:00Z')`)
    .run(season, tournamentId, competitionType);
}

/** 基线场景：顶级联赛（赛事 5）第 1 轮 利物浦(11) vs 曼城(12)；主队有球场，客队无 */
function seedBase(opts: { awayName?: string; stadium?: boolean; bind?: boolean; secret?: boolean } = {}): Fixture {
  const fx = freshEnv({ secret: opts.secret });
  fx.tour.prepare('INSERT INTO tournament (id, name, status) VALUES (5, ?, ?)').run('顶级联赛S9', 'active');
  fx.tour.prepare(`INSERT INTO stage (id, tournament_id, kind, sort_order, name, config_json) VALUES (50, 5, 'round_robin', 1, '常规赛', '{}')`).run();
  fx.tour.prepare('INSERT INTO team (id, name) VALUES (11, ?), (12, ?)').run('利物浦', opts.awayName ?? '曼城');
  seedClub(fx, 1, 11, { stadium: opts.stadium });
  seedClub(fx, 2, 12, { stadium: false });
  addMatch(fx, 1, 11, 12, 1);
  if (opts.bind !== false) bindSeason(fx);
  return fx;
}

/** 按插件侧同款规范串签一次入站调用（o.secret=null 表示「没配密钥」的调用方视角） */
function inbound(fx: Fixture, body: unknown, o: { secret?: string | null; ts?: string; sign?: string; omitSign?: boolean; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify(body);
  const ts = o.ts ?? String(Math.floor(Date.now() / 1000));
  const secret = o.secret === undefined ? SECRET : o.secret;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-timestamp': ts };
  if (!o.omitSign) {
    headers['x-sign'] = o.sign ?? createHmac('sha256', secret ?? '').update(`POST|${WEATHER_SYNC_PATH}|${ts}|${raw}`).digest('hex');
  }
  return app.request(WEATHER_SYNC_PATH, { method: 'POST', headers, body: raw }, fx.env);
}

function pushBody(items: { home: string; away: string; weather: string; coef: number }[], over: Record<string, unknown> = {}) {
  return { season: SEASON, competition: '顶级联赛', roundNo: 1, items, ...over };
}

const weatherRow = (fx: Fixture, matchId = 1) =>
  sqlGet<{ match_id: number; club_id: number; season: number; tournament_id: number; round: number; weather: string; wx_coef: number; forecast_by: unknown }>(
    fx.sqlite,
    'SELECT * FROM match_weather WHERE match_id = ?',
    matchId,
  );

describe('天气同步入站：验签与形状（v6.44.0）', () => {
  it('TC-WS-01 未配 WEATHER_SYNC_SECRET → 503 fail-closed（与 team-upsert 同口径）', async () => {
    const fx = seedBase({ secret: false });
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]), { secret: null });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unconfigured', message: '本仓未配置 WEATHER_SYNC_SECRET，拒绝机器写入' });
    expect(weatherRow(fx)).toBeUndefined();
  });

  it('TC-WS-02 缺签名/坏签名 → 403，且不落库', async () => {
    const fx = seedBase();
    const body = pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]);
    const noSign = await inbound(fx, body, { omitSign: true });
    expect(noSign.status).toBe(403);
    const badSign = await inbound(fx, body, { sign: 'deadbeef' });
    expect(badSign.status).toBe(403);
    const wrongSecret = await inbound(fx, body, { secret: '别的密钥' });
    expect(wrongSecret.status).toBe(403);
    expect(weatherRow(fx)).toBeUndefined();
  });

  it('TC-WS-03 时间戳超窗（±300s 外）→ 403', async () => {
    const fx = seedBase();
    const body = pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]);
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    expect((await inbound(fx, body, { ts: stale })).status).toBe(403);
    const inWindow = String(Math.floor(Date.now() / 1000) - 300);
    expect((await inbound(fx, body, { ts: inWindow })).status).toBe(200);
  });

  it('TC-WS-04 跨仓金标准：签名串与 hex 逐字（与插件 tests/s18_club_sync.py 同值）', async () => {
    const GOLDEN_SECRET = 'whl-golden-secret';
    const GOLDEN_TS = '1700000000';
    const GOLDEN_BODY =
      '{"season":9,"competition":"顶级联赛","roundNo":1,"items":[{"home":"利物浦","away":"曼城(CPU)","weather":"雨","coef":0.8342}]}';
    const GOLDEN_SIGN = '8ecf0abca9d0244d2e8e9a3902a25dcd8fbb2aea34b4655ea152c81d1469e633';
    expect(WEATHER_SYNC_PATH).toBe('/api/internal/weather-sync');
    expect(await hmacHex(GOLDEN_SECRET, `POST|${WEATHER_SYNC_PATH}|${GOLDEN_TS}|${GOLDEN_BODY}`)).toBe(GOLDEN_SIGN);
    // 同一份输入的另一种实现必须同值（crypto.subtle vs node:crypto）
    expect(createHmac('sha256', GOLDEN_SECRET).update(`POST|${WEATHER_SYNC_PATH}|${GOLDEN_TS}|${GOLDEN_BODY}`).digest('hex')).toBe(GOLDEN_SIGN);
  });

  it('TC-WS-05 形状校验矩阵：非对象/赛季/赛事名/轮次/items/单场字段', async () => {
    const fx = seedBase();
    const cases: [unknown, string][] = [
      [[1, 2], 'bad_body'],
      [{ ...pushBody([]), season: 0 }, 'bad_season'],
      [{ ...pushBody([]), season: 'x' }, 'bad_season'],
      [{ ...pushBody([]), competition: '联盟杯' }, 'unknown_competition'],
      [{ ...pushBody([]), roundNo: -1 }, 'bad_round'],
      [{ ...pushBody([]), roundNo: 201 }, 'bad_round'],
      [{ ...pushBody([]), items: [] }, 'bad_items'],
      [{ ...pushBody([]), items: 'x' }, 'bad_items'],
      [pushBody([{ home: '', away: '曼城', weather: '雨', coef: 1 }]), 'bad_item'],
      [pushBody([{ home: '利物浦', away: '曼城', weather: '', coef: 1 }]), 'bad_item'],
      [pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 'x' as unknown as number }]), 'bad_item'],
      [pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0 }]), 'bad_item'],
    ];
    for (const [body, code] of cases) {
      const res = await inbound(fx, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: string }).error, JSON.stringify(body)).toBe(code);
    }
    expect(weatherRow(fx)).toBeUndefined();
  });

  it('TC-WS-06 赛季没绑定该赛事 → 409 not_bound（整轮级错误，逐场 verdict 救不了）', async () => {
    const fx = seedBase({ bind: false });
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('not_bound');
    expect(body.message).toContain('第 9 赛季');
  });

  it('TC-WS-06b 绑定的是别的 competition_type 也算没绑（顶级联赛 vs 次级联赛）', async () => {
    const fx = seedBase();
    fx.sqlite.prepare(`UPDATE season_tournaments SET competition_type = 'league_second' WHERE tournament_id = 5`).run();
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('not_bound');
  });
});

describe('天气同步入站：落库与幂等（v6.44.0）', () => {
  it('TC-WS-07 首推 → created，逐列落库（含 club_id 解析与推送方落款）', async () => {
    const fx = seedBase();
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.8342 }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; summary: Record<string, number>; verdicts: { status: string; matchId?: number }[] };
    expect(body.ok).toBe(true);
    expect(body.summary).toMatchObject({ created: 1, replaced: 0, unchanged: 0, unmatched: 0, pushed: 1 });
    expect(body.verdicts[0]).toMatchObject({ status: 'created', matchId: 1 });
    expect(weatherRow(fx)).toMatchObject({
      match_id: 1,
      club_id: 1, // 主队 tour 队 11 → 平台俱乐部 1（消费端按 club_id 过滤，必须一致）
      season: SEASON,
      tournament_id: 5,
      round: 1,
      weather: '雨',
      wx_coef: 0.8342,
      forecast_by: WEATHER_SYNC_FORECAST_BY,
    });
  });

  it('TC-WS-08 重复推同值 → unchanged，行不新增、值不变（一条命令推全季的幂等）', async () => {
    const fx = seedBase();
    const item = { home: '利物浦', away: '曼城', weather: '雨', coef: 0.8342 };
    await inbound(fx, pushBody([item]));
    const second = (await (await inbound(fx, pushBody([item]))).json()) as { summary: Record<string, number> };
    expect(second.summary).toMatchObject({ created: 0, unchanged: 1, replaced: 0 });
    expect(sqlAll(fx.sqlite, 'SELECT match_id FROM match_weather')).toHaveLength(1);
    expect(weatherRow(fx)?.wx_coef).toBe(0.8342);
  });

  it('TC-WS-09 改值 → replaced（天气与系数一起覆盖）', async () => {
    const fx = seedBase();
    await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.8342 }]));
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '晴', coef: 1.02 }]));
    expect(((await res.json()) as { summary: Record<string, number> }).summary).toMatchObject({ replaced: 1, created: 0 });
    expect(weatherRow(fx)).toMatchObject({ weather: '晴', wx_coef: 1.02 });
  });

  it('TC-WS-10 推者赢：平台自己抽的预报被推送覆盖', async () => {
    const fx = seedBase();
    fx.sqlite
      .prepare(
        `INSERT INTO match_weather (match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at)
         VALUES (1, 1, 9, 5, 1, '雪', 1.05, 2, '2026-10-01T00:00:00Z')`,
      )
      .run();
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '多云', coef: 0.97 }]));
    expect(((await res.json()) as { summary: Record<string, number> }).summary).toMatchObject({ replaced: 1 });
    expect(weatherRow(fx)).toMatchObject({ weather: '多云', wx_coef: 0.97, forecast_by: WEATHER_SYNC_FORECAST_BY });
  });

  it('TC-WS-11 队名归一：tour 侧带 (CPU)/（CPU）后缀、大小写差异都能匹对', async () => {
    const fx = seedBase({ awayName: '曼城(CPU)' });
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]));
    const body = (await res.json()) as { verdicts: { status: string; matchId?: number }[] };
    // 队名匹对上了（CPU 后缀被剥），但客队不影响落库——主队有球场即落
    expect(body.verdicts[0]).toMatchObject({ status: 'created', matchId: 1 });

    const fx2 = seedBase({ awayName: '曼城（CPU）' });
    const res2 = await inbound(fx2, pushBody([{ home: ' 利物浦 ', away: '曼城', weather: '雨', coef: 0.9 }]));
    expect(((await res2.json()) as { verdicts: { status: string }[] }).verdicts[0].status).toBe('created');
  });

  it('TC-WS-11b normTeamName 的归一矩阵（剥 CPU 后缀 + 折名）', () => {
    expect(normTeamName('曼城(CPU)')).toBe(normTeamName('曼城'));
    expect(normTeamName('曼城（CPU）')).toBe(normTeamName('曼城'));
    expect(normTeamName('曼城 (CPU) ')).toBe(normTeamName('曼城'));
    expect(normTeamName(' 利物浦 ')).toBe(normTeamName('利物浦'));
    expect(normTeamName('Šeško FC')).toBe(normTeamName('sesko fc'));
    expect(normTeamName('曼城')).not.toBe(normTeamName('曼联'));
  });

  it('TC-WS-12 队名对不上 → unmatched（整轮不失败，零写入）', async () => {
    const fx = seedBase();
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼联', weather: '雨', coef: 0.9 }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: Record<string, number>; verdicts: { status: string; detail?: string }[] };
    expect(body.summary).toMatchObject({ unmatched: 1, created: 0 });
    expect(body.verdicts[0].detail).toContain('没有这对主客队');
    expect(weatherRow(fx)).toBeUndefined();
  });

  it('TC-WS-12b 轮次对不上 → unmatched（同队不同轮不误落）', async () => {
    const fx = seedBase();
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }], { roundNo: 2 }));
    expect(((await res.json()) as { summary: Record<string, number> }).summary).toMatchObject({ unmatched: 1 });
    expect(weatherRow(fx)).toBeUndefined();
  });

  it('TC-WS-13 表外天气 → bad_weather（其余场次照常落库）', async () => {
    const fx = seedBase();
    fx.tour.prepare('INSERT INTO team (id, name) VALUES (13, ?)').run('阿森纳');
    seedClub(fx, 3, 13);
    addMatch(fx, 2, 13, 12, 1);
    const res = await inbound(
      fx,
      pushBody([
        { home: '利物浦', away: '曼城', weather: '冰雹', coef: 0.9 },
        { home: '阿森纳', away: '曼城', weather: '雨', coef: 0.9 },
      ]),
    );
    const body = (await res.json()) as { summary: Record<string, number>; verdicts: { status: string; detail?: string }[] };
    expect(body.summary).toMatchObject({ bad_weather: 1, created: 1 });
    expect(body.verdicts[0].detail).toContain('不认识的天气类型');
    expect(weatherRow(fx, 1)).toBeUndefined();
    expect(weatherRow(fx, 2)).toMatchObject({ weather: '雨' });
  });

  it('TC-WS-14 主队无球场行 / 主队不是平台俱乐部 → skipped_no_stadium', async () => {
    const fx = seedBase({ stadium: false });
    const noStadium = (await (await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]))).json()) as {
      summary: Record<string, number>;
      verdicts: { detail?: string }[];
    };
    expect(noStadium.summary).toMatchObject({ skipped_no_stadium: 1 });
    expect(noStadium.verdicts[0].detail).toContain('没有球场行');

    // 主队是 CPU 队（tour 队 12 有 clubs 行但 is_cpu）——clubIdByTourTeam 自带 CPU 过滤
    const fx2 = seedBase();
    fx2.sqlite.prepare(`UPDATE clubs SET is_cpu = 1 WHERE id = 1`).run();
    const cpu = (await (await inbound(fx2, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.9 }]))).json()) as {
      summary: Record<string, number>;
      verdicts: { detail?: string }[];
    };
    expect(cpu.summary).toMatchObject({ skipped_no_stadium: 1 });
    expect(cpu.verdicts[0].detail).toContain('不是平台俱乐部');
    expect(weatherRow(fx2)).toBeUndefined();
  });

  it('TC-WS-15 已确认赛果的场次照推（settled=true 点名），行仍被覆盖', async () => {
    const fx = seedBase();
    fx.sqlite
      .prepare(
        `INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
         VALUES (1, 1, 9, 0, '雪', 6388, 0.96, 0.13, 0.9, '2026-10-05T00:00:00Z')`,
      )
      .run();
    const res = await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.8342 }]));
    const body = (await res.json()) as { summary: Record<string, number>; verdicts: { settled?: boolean; detail?: string }[] };
    expect(body.summary.settled).toBe(1);
    expect(body.verdicts[0].settled).toBe(true);
    expect(body.verdicts[0].detail).toContain('订正批');
    expect(weatherRow(fx)).toMatchObject({ weather: '雨', wx_coef: 0.8342 });
    // 已确认行本身不动（历史账由订正批收敛，不在入站路径上改账）
    expect(sqlGet<{ weather: string }>(fx.sqlite, 'SELECT weather FROM match_attendance WHERE match_id = 1')).toEqual({ weather: '雪' });
  });

  it('TC-WS-16 审计行：actor=null / origin=machine / action=weather_sync / after 带逐场结果', async () => {
    const fx = seedBase();
    await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 0.8342 }]));
    const audit = sqlGet<{ actor: number | null; action: string; origin: string; target_type: string; target_id: number; after: string }>(
      fx.sqlite,
      `SELECT actor, action, origin, target_type, target_id, after FROM audit_log WHERE action = 'weather_sync'`,
    );
    expect(audit).toMatchObject({ actor: null, action: 'weather_sync', origin: 'machine', target_type: 'tournament', target_id: 5 });
    const after = JSON.parse(audit!.after) as { roundNo: number; summary: Record<string, number>; applied: { matchId: number; weather: string; coef: number }[] };
    expect(after.roundNo).toBe(1);
    expect(after.summary).toMatchObject({ created: 1 });
    expect(after.applied).toEqual([{ matchId: 1, home: '利物浦', away: '曼城', weather: '雨', coef: 0.8342, status: 'created' }]);
  });

  it('TC-WS-16b 全跳过（零写入）时不写审计行（没有落库就没有"同步了什么"可留痕）', async () => {
    const fx = seedBase();
    await inbound(fx, pushBody([{ home: '利物浦', away: '曼联', weather: '雨', coef: 0.9 }]));
    expect(sqlAll(fx.sqlite, `SELECT id FROM audit_log WHERE action = 'weather_sync'`)).toHaveLength(0);
  });
});

describe('天气同步入站：与结算端贯通（v6.44.0）', () => {
  it('TC-WS-17 推送的系数被赛果确认采用（上座按推送系数算，不再现抽）', async () => {
    const fx = seedBase();
    // 基线（tests/weather-forecast.test.ts 同款夹具）：K = 1800×4.0×1.0×1.0×1.0417 = 7500，rng=0.5 → 扰动 1.0
    await inbound(fx, pushBody([{ home: '利物浦', away: '曼城', weather: '雨', coef: 1.5 }]));
    fx.sqlite.prepare(`INSERT INTO club_facilities (club_id, facility_key, level) VALUES (1, 'commercial', 2), (1, 'broadcast', 3)`).run();
    const input: AttendanceHookInput = { matchId: 1, season: SEASON, windowSeq: 0, homeTeamId: 11, awayTeamId: 12, walkoverSide: null };
    const { detail } = await matchAttendanceStatements(fx.env, input);
    expect(detail).toMatchObject({ clubId: 1, weather: '雨', attendance: 11250 }); // 7500 × 1.5
    expect(detail!.ticket).toBeCloseTo(1.69, 2); // 1.125 万人次 × 1.5
    expect(detail!.commercial).toBeCloseTo(0.23, 2); // 1.125 × 0.1 × 商业等级 2
    expect(detail!.broadcast).toBeCloseTo(0.9, 2);
  });

  it('TC-WS-18 未推送的场次照旧现抽（旁路不变：插件没上线也不影响既有结算）', async () => {
    const fx = seedBase();
    const input: AttendanceHookInput = { matchId: 1, season: SEASON, windowSeq: 0, homeTeamId: 11, awayTeamId: 12, walkoverSide: null };
    const { detail } = await matchAttendanceStatements(fx.env, input);
    // rng=0.5：天气多云、wx=0.97 → 7500 × 0.97 = 7275（v6.15.0 起的既有基线）
    expect(detail).toMatchObject({ weather: '多云', attendance: 7275 });
  });
});
