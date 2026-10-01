// 管理端按场次批量补录台（v6.16.0）：可补录比赛列表 / 单场花名册面板 / 批量补录三个端点。
//
// 口径（与自动通道同源，见 src/worker/results.ts 的 confirm 钩子）：
//   联赛顶级/次级全阶段、冠军杯小组赛计 XP；弃权场与未确认场次不列；
//   同锚去重 = growth_events 的 UNIQUE(player_id, match_ref, event_type)，match_ref 固定用
//   比赛系统 match id 的字符串形式（补录端点不接受调用方自造锚，否则自动通道写过的场能补第二份 XP）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

// 比赛系统库只摆「已完赛但平台未确认」的场次，证明列表不拿它当数据源
function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0);
     CREATE TABLE match (id INTEGER PRIMARY KEY, status TEXT);`,
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
  };
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  // 可见赛季：running 优先（批量补录的事件都盖这个赛季）
  sqlite.exec(
    `INSERT INTO seasons (season, status, created_at) VALUES
       (7, 'running', '2026-01-01T00:00:00Z'),
       (6, 'settled', '2025-01-01T00:00:00Z');`,
  );
  return { env, sqlite, tour, kv };
}

// 平台种子：1 海港联（premier）、2 北岸城（premier）、3 秋叶原（second，与任何场次无关）
// 球员：10 正常(带显示名/门将)、11 正常(无显示名/前锋)、12 挂牌(中场)、13 训练营(带显示名)、
//       14 自由身(前锋，已离队)、20 北岸城门将、30 秋叶原前锋
function seedBase(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES
      (1, '海港联', 'premier', 'active'), (2, '北岸城', 'premier', 'active'), (3, '秋叶原', 'second', 'active');
    INSERT INTO players (id, uid, name, display_name, club_id, position, status, growth_xp, ca) VALUES
      (10, 'p10', 'K. Zhang', '张三', 1, 'GK', 'normal', 0, 70),
      (11, 'p11', 'L. Li', NULL, 1, 'ST', 'normal', 0, 70),
      (12, 'p12', 'M. Wang', NULL, 1, 'CM', 'listed', 0, 70),
      (13, 'p13', 'N. Zhao', '赵十三', 1, 'CM', 'trainee', 0, 60),
      (14, 'p14', 'O. Sun', NULL, 1, 'ST', 'free', 0, 60),
      (20, 'p20', 'Q. Qian', NULL, 2, 'GK', 'normal', 0, 70),
      (30, 'p30', 'R. Zhou', NULL, 3, 'ST', 'normal', 0, 70);
  `);
}

interface MatchSeed {
  matchId: number;
  competitionType: string | null;
  stageKind?: string | null;
  stageName?: string | null;
  round?: number | null;
  homeTeam: string;
  awayTeam: string;
  scoreHome?: number | null;
  scoreAway?: number | null;
  walkoverSide?: string | null;
  confirmedAt?: string;
  season?: number;
  windowSeq?: number;
}

let confirmSeq = 0;

// 赛果确认快照（只填本任务关心的列，其余走默认/null）
function seedMatch(fx: Fixture, m: MatchSeed): void {
  const confirmedAt = m.confirmedAt ?? `2026-07-${String(10 + (confirmSeq % 18)).padStart(2, '0')}T21:00:00Z`;
  confirmSeq += 1;
  fx.sqlite
    .prepare(
      `INSERT INTO result_confirmations
         (season, window_seq, tournament_id, match_id, competition_type, stage_name, stage_kind, round,
          home_team_id, away_team_id, home_team, away_team, score_home, score_away, walkover_side,
          finished_at, confirmed_by, confirmed_at)
       VALUES (?, ?, 5, ?, ?, ?, ?, ?, 501, 502, ?, ?, ?, ?, ?, '2026-07-01T21:00:00Z', 1, ?)`,
    )
    .run(
      m.season ?? 7,
      m.windowSeq ?? 2,
      m.matchId,
      m.competitionType,
      m.stageName ?? null,
      m.stageKind ?? null,
      m.round ?? null,
      m.homeTeam,
      m.awayTeam,
      m.scoreHome ?? 2,
      m.scoreAway ?? 1,
      m.walkoverSide ?? '',
      confirmedAt,
    );
}

// 直接落一条已录事件（自动通道或历史补录）
function seedEvent(fx: Fixture, playerId: number, matchRef: string, eventType: string, value: number, xp: number, source = 'auto'): void {
  fx.sqlite
    .prepare(
      `INSERT INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
       VALUES (?, ?, 7, 2, ?, ?, ?, ?, 1, '2026-07-02T10:00:00Z')`,
    )
    .run(playerId, matchRef, eventType, value, xp, source);
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

function anon(path: string, env: Env, method = 'POST') {
  return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }, env);
}

interface ListMatch {
  matchId: number;
  season: number;
  windowSeq: number;
  competitionType: string | null;
  stageName: string | null;
  stageKind: string | null;
  round: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  finishedAt: string | null;
  confirmedAt: string | null;
  homeClubId: number | null;
  awayClubId: number | null;
  homeIsCpu: boolean;
  awayIsCpu: boolean;
  recorded: number;
}

interface PanelPlayer {
  id: number;
  name: string;
  officialName: string;
  position: string | null;
  status: string;
}

interface Panel {
  match: ListMatch;
  sides: { home: { clubId: number | null; isCpu: boolean; players: PanelPlayer[] }; away: { clubId: number | null; isCpu: boolean; players: PanelPlayer[] } };
  recorded: { playerId: number; eventType: string; value: number; xp: number; source: string }[];
}

interface BatchResult {
  ok: boolean;
  written: number;
  duplicates: number;
  totalXp: number;
  perPlayer: { playerId: number; name: string; xp: number; written: number; duplicates: number }[];
}

const LIST = '/api/admin/growth/match-entry';
const panelPath = (matchId: number | string) => `/api/admin/growth/match-entry/${matchId}`;
const batchPath = panelPath;

async function listMatches(fx: Fixture): Promise<ListMatch[]> {
  const res = await get(LIST, 'tok-admin', fx.env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { matches: ListMatch[] }).matches;
}

async function errorText(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

function xpOf(fx: Fixture, playerId: number): number {
  return sqlGet<{ growth_xp: number }>(fx.sqlite, 'SELECT growth_xp FROM players WHERE id = ?', playerId)?.growth_xp ?? 0;
}

interface EventRow {
  player_id: number;
  event_type: string;
  value: number;
  xp: number;
  source: string;
  season: number | null;
  window_seq: number | null;
  recorded_by: number | null;
}

function eventsOf(fx: Fixture, matchRef?: number | string): EventRow[] {
  const sql = `SELECT player_id, event_type, value, xp, source, season, window_seq, recorded_by FROM growth_events`;
  return matchRef === undefined
    ? sqlAll<EventRow>(fx.sqlite, `${sql} ORDER BY player_id, id`)
    : sqlAll<EventRow>(fx.sqlite, `${sql} WHERE match_ref = ? ORDER BY player_id, id`, String(matchRef));
}

interface AuditRow {
  actor: number | null;
  action: string;
  target_type: string;
  target_id: number;
  origin: string | null;
  before: string | null;
  after: string | null;
  at: string;
}

function auditsOf(fx: Fixture, action = 'growth_manual_event_batch'): AuditRow[] {
  return sqlAll<AuditRow>(
    fx.sqlite,
    'SELECT actor, action, target_type, target_id, origin, before, after, at FROM audit_log WHERE action = ? ORDER BY id',
    action,
  );
}

describe('TC-LIST 可补录比赛列表', () => {
  it('TC-LIST-01 只列可计 XP 的比赛：联赛两级全阶段 + 冠军杯小组赛，冠军杯淘汰轮不出现', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1001, competitionType: 'league_premier', stageName: '常规赛', stageKind: 'league', round: 1, homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });
    seedMatch(fx, { matchId: 1002, competitionType: 'league_second', stageName: '常规赛', stageKind: 'league', round: 2, homeTeam: '北岸城', awayTeam: '海港联', confirmedAt: '2026-07-02T10:00:00Z' });
    seedMatch(fx, { matchId: 1003, competitionType: 'champions_cup', stageName: 'A 组', stageKind: 'group', round: 3, homeTeam: '海港联', awayTeam: '秋叶原', confirmedAt: '2026-07-03T10:00:00Z' });
    seedMatch(fx, { matchId: 1004, competitionType: 'champions_cup', stageName: '半决赛', stageKind: 'knockout', round: 1, homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-04T10:00:00Z' });

    const matches = await listMatches(fx);
    expect(matches.map((m) => m.matchId)).toEqual([1003, 1002, 1001]);

    // 列表行 DTO：前端直接渲染，字段口径与面板 match 块一致
    expect(matches[0]).toMatchObject({
      matchId: 1003,
      season: 7,
      windowSeq: 2,
      competitionType: 'champions_cup',
      stageName: 'A 组',
      stageKind: 'group',
      round: 3,
      homeTeam: '海港联',
      awayTeam: '秋叶原',
      scoreHome: 2,
      scoreAway: 1,
      homeClubId: 1,
      awayClubId: 3,
      recorded: 0,
    });
    expect(matches[0].confirmedAt).toBe('2026-07-03T10:00:00Z');
    expect(matches[0].finishedAt).toBe('2026-07-01T21:00:00Z');
  });

  it('TC-LIST-02 弃权场与未确认场次不出现（walkover_side 空串的普通场照常出现）', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1005, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', walkoverSide: 'home', confirmedAt: '2026-07-01T10:00:00Z' });
    seedMatch(fx, { matchId: 1006, competitionType: 'league_premier', stageKind: 'league', homeTeam: '北岸城', awayTeam: '海港联', walkoverSide: '', confirmedAt: '2026-07-02T10:00:00Z' });
    // 1007 比赛系统已完赛但平台还没确认 → 只认 result_confirmations
    fx.tour.exec("INSERT INTO match (id, status) VALUES (1007, 'finished')");

    const matches = await listMatches(fx);
    expect(matches.map((m) => m.matchId)).toEqual([1006]);
  });

  it('TC-LIST-03 recorded = 该场已录事件数；确认时间倒序、同刻按 matchId 倒序；只回最近 50 场', async () => {
    const fx = freshEnv();
    seedBase(fx);
    const base = { competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城' };
    seedMatch(fx, { ...base, matchId: 1100, confirmedAt: '2026-07-10T10:00:00Z' });
    seedMatch(fx, { ...base, matchId: 1101, confirmedAt: '2026-07-10T10:00:00Z' }); // 同刻，matchId 大的在前
    seedMatch(fx, { ...base, matchId: 1102, confirmedAt: '2026-07-11T10:00:00Z' });
    seedEvent(fx, 10, '1101', 'appearance', 1, 1);
    seedEvent(fx, 11, '1101', 'goal', 2, 1);
    seedEvent(fx, 12, '1102', 'rating', 8.5, 2);
    // 另插一批更早的可录比赛，压出 LIMIT 50
    for (let i = 0; i < 52; i += 1) {
      seedMatch(fx, { ...base, matchId: 1200 + i, confirmedAt: `2026-06-01T00:00:${String(i % 60).padStart(2, '0')}Z` });
    }

    const matches = await listMatches(fx);
    expect(matches.length).toBe(50);
    expect(matches.slice(0, 3).map((m) => m.matchId)).toEqual([1102, 1101, 1100]);
    const byId = new Map(matches.map((m) => [m.matchId, m]));
    expect(byId.get(1101)?.recorded).toBe(2);
    expect(byId.get(1102)?.recorded).toBe(1);
    expect(byId.get(1100)?.recorded).toBe(0);
    const ids = matches.map((m) => m.matchId);
    expect(ids).not.toContain(1200); // 被 LIMIT 切掉的最早几场
    expect(ids).toContain(1251);
  });

  it('TC-LIST-04 两队归属解析：本库队名解出 clubId，CPU 队无归属且打标；两队都解不开的场照样列出', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1300, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '机器甲 (CPU)', confirmedAt: '2026-07-01T10:00:00Z' });
    seedMatch(fx, { matchId: 1301, competitionType: 'league_premier', stageKind: 'league', homeTeam: '幻影队', awayTeam: '空影队 (CPU)', confirmedAt: '2026-07-02T10:00:00Z' });

    const matches = await listMatches(fx);
    expect(matches.find((m) => m.matchId === 1300)).toMatchObject({ homeClubId: 1, homeIsCpu: false, awayClubId: null, awayIsCpu: true });
    expect(matches.find((m) => m.matchId === 1301)).toMatchObject({ homeClubId: null, homeIsCpu: false, awayClubId: null, awayIsCpu: true });
  });
});

describe('TC-PANEL 单场面板', () => {
  it('TC-PANEL-01 花名册口径：normal/listed/trainee 出（门将→前锋稳定序），free 不出；显示名优先、官方名保留', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1400, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '机器甲 (CPU)', confirmedAt: '2026-07-01T10:00:00Z' });

    const res = await get(panelPath(1400), 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Panel;
    expect(body.match).toMatchObject({ matchId: 1400, homeClubId: 1, awayClubId: null, awayIsCpu: true, recorded: 0 });
    // 位置权重(门将→中场→前锋) + id：14 是 free，已离队不出
    expect(body.sides.home.players.map((p) => p.id)).toEqual([10, 12, 13, 11]);
    const zhang = body.sides.home.players[0];
    expect(zhang).toMatchObject({ name: '张三', officialName: 'K. Zhang', position: 'GK', status: 'normal' });
    const trainee = body.sides.home.players[2];
    expect(trainee).toMatchObject({ id: 13, name: '赵十三', officialName: 'N. Zhao', status: 'trainee' });
    expect(body.sides.home.players[3]).toMatchObject({ id: 11, name: 'L. Li', officialName: 'L. Li' }); // 无显示名回落官方名
    // CPU 侧解不出俱乐部，花名册为空（前端展示「客队无花名册」）
    expect(body.sides.away).toEqual({ clubId: null, isCpu: true, players: [] });
  });

  it('TC-PANEL-02 已录事件预填：带值、XP 与来源（自动/手动都回）', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1400, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });
    seedEvent(fx, 10, '1400', 'appearance', 1, 1);
    seedEvent(fx, 10, '1400', 'goal', 1, 0.5);
    seedEvent(fx, 11, '1400', 'rating', 8.5, 2, 'manual');
    seedEvent(fx, 20, '1401', 'appearance', 1, 1); // 别的场次的事件不许串进来

    const body = (await (await get(panelPath(1400), 'tok-admin', fx.env)).json()) as Panel;
    expect(body.recorded).toEqual([
      { playerId: 10, eventType: 'appearance', value: 1, xp: 1, source: 'auto' },
      { playerId: 10, eventType: 'goal', value: 1, xp: 0.5, source: 'auto' },
      { playerId: 11, eventType: 'rating', value: 8.5, xp: 2, source: 'manual' },
    ]);
    expect(body.match.recorded).toBe(3);
  });

  it('TC-PANEL-03 不可录的场次一律 404：不存在 / 冠军杯淘汰轮 / 弃权场 / 非数字 id；匿名 401', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1400, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });
    seedMatch(fx, { matchId: 1401, competitionType: 'champions_cup', stageKind: 'knockout', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-02T10:00:00Z' });
    seedMatch(fx, { matchId: 1402, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', walkoverSide: 'both', confirmedAt: '2026-07-03T10:00:00Z' });

    for (const id of [9999, 1401, 1402, 'abc']) {
      const res = await get(panelPath(id), 'tok-admin', fx.env);
      expect(res.status, `matchId=${id}`).toBe(404);
    }
    expect((await anon(panelPath(1400), fx.env, 'GET')).status).toBe(401);
    expect((await anon(LIST, fx.env, 'GET')).status).toBe(401);
  });
});

describe('TC-BATCH 批量补录', () => {
  it('TC-BATCH-01 多人多项一次入账：XP 服务端算、事件同批落库、审计一条', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1500, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });

    const res = await post(
      batchPath(1500),
      {
        entries: [
          { playerId: 10, appearance: true, rating: 8.5 }, // 1 + 2
          { playerId: 11, cleanSheet: true }, // 0.5
          { playerId: 12, duelsWon: 24 }, // floor(24/12) = 2
          { playerId: 20, saves: 9 }, // floor(9/8) + 1 = 2
        ],
      },
      'tok-admin',
      fx.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as BatchResult;
    expect(body).toMatchObject({ ok: true, written: 5, duplicates: 0, totalXp: 7.5 });
    expect(body.perPlayer).toEqual([
      { playerId: 10, name: '张三', xp: 3, written: 2, duplicates: 0 },
      { playerId: 11, name: 'L. Li', xp: 0.5, written: 1, duplicates: 0 },
      { playerId: 12, name: 'M. Wang', xp: 2, written: 1, duplicates: 0 },
      { playerId: 20, name: 'Q. Qian', xp: 2, written: 1, duplicates: 0 },
    ]);

    // 事件表：锚是比赛 id 的字符串形式，赛季取可见赛季、窗口为空、来源 manual、操作者记账
    const rows = eventsOf(fx, 1500);
    expect(rows.length).toBe(5);
    expect(rows.every((r) => r.source === 'manual' && r.season === 7 && r.window_seq === null && r.recorded_by === 1)).toBe(true);
    expect(rows.filter((r) => r.event_type === 'appearance').length).toBe(1);
    expect(xpOf(fx, 10)).toBe(3);
    expect(xpOf(fx, 11)).toBe(0.5);
    expect(xpOf(fx, 12)).toBe(2);
    expect(xpOf(fx, 20)).toBe(2);

    const audits = auditsOf(fx);
    expect(audits.length).toBe(1);
    expect(audits[0]).toMatchObject({ actor: 1, target_type: 'match', target_id: 1500, origin: 'user', before: null });
    const after = JSON.parse(audits[0].after ?? '{}') as { matchId: number; written: number; duplicates: number; entries: { playerId: number; eventType: string }[] };
    expect(after).toMatchObject({ matchId: 1500, written: 5, duplicates: 0 });
    expect(after.entries.length).toBe(5);
  });

  it('TC-BATCH-02 球员不属于该场两队 → 400「不属于该场两队」，零写入零审计', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1600, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '机器甲 (CPU)', confirmedAt: '2026-07-01T10:00:00Z' });
    seedMatch(fx, { matchId: 1601, competitionType: 'league_premier', stageKind: 'league', homeTeam: '幻影队', awayTeam: '空影队', confirmedAt: '2026-07-02T10:00:00Z' });

    // 20 属于北岸城，本场客队是 CPU 队（无归属）→ 越权
    const away = await post(batchPath(1600), { entries: [{ playerId: 20, appearance: true }] }, 'tok-admin', fx.env);
    expect(away.status).toBe(400);
    expect(await errorText(away)).toContain('不属于该场两队');
    // 混在一批里也不放行：好行不许先落库
    const mixed = await post(batchPath(1600), { entries: [{ playerId: 10, appearance: true }, { playerId: 30, saves: 8 }] }, 'tok-admin', fx.env);
    expect(mixed.status).toBe(400);
    expect(eventsOf(fx).length).toBe(0);
    expect(xpOf(fx, 20)).toBe(0);
    expect(xpOf(fx, 30)).toBe(0);
    expect(auditsOf(fx).length).toBe(0);

    // 两队都解不出俱乐部的场根本不可写
    const both = await post(batchPath(1601), { entries: [{ playerId: 10, appearance: true }] }, 'tok-admin', fx.env);
    expect(both.status).toBe(400);
    expect(await errorText(both)).toContain('建档');
    expect(eventsOf(fx).length).toBe(0);
  });

  it('TC-BATCH-03 训练营球员 → 400 点名该球员，整批不落库', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1700, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });

    const res = await post(batchPath(1700), { entries: [{ playerId: 10, appearance: true }, { playerId: 13, appearance: true }] }, 'tok-admin', fx.env);
    expect(res.status).toBe(400);
    const text = await errorText(res);
    expect(text).toContain('赵十三'); // 点名用显示名口径
    expect(text).toContain('训练营');
    expect(eventsOf(fx, 1700).length).toBe(0);
    expect(xpOf(fx, 10)).toBe(0);
    expect(auditsOf(fx).length).toBe(0);
  });

  it('TC-BATCH-04 口径复用单人补录规则：评分区间/正整数/entries 形态都前置拒', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1800, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });

    const cases: [Record<string, unknown>, string][] = [
      [{ playerId: 10, rating: 6.9 }, '评分要在 7.0-10.0'],
      [{ playerId: 10, rating: 10.5 }, '评分要在 7.0-10.0'],
      [{ playerId: 10, duelsWon: 0 }, '次数要是正整数'],
      [{ playerId: 10, saves: -1 }, '次数要是正整数'],
      [{ playerId: 10, appearance: false }, '都没有勾上'], // 一格没勾
    ];
    for (const [entry, msg] of cases) {
      const res = await post(batchPath(1800), { entries: [entry] }, 'tok-admin', fx.env);
      expect(res.status, msg).toBe(400);
      expect(await errorText(res)).toContain(msg);
    }
    // entries 本身：空数组 / 缺字段 / 缺 playerId
    for (const body of [{ entries: [] }, {}, { entries: [{ playerId: 10 }] }, { entries: [{ appearance: true }] }]) {
      const res = await post(batchPath(1800), body, 'tok-admin', fx.env);
      expect(res.status).toBe(400);
    }
    expect(eventsOf(fx).length).toBe(0);
    expect(auditsOf(fx).length).toBe(0);
  });

  it('TC-BATCH-05 同锚重复提交：第二次全进 duplicates、XP 不重复、事件各 1 行', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1900, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });
    const body = { entries: [{ playerId: 10, appearance: true }, { playerId: 11, rating: 9 }] };

    const first = await post(batchPath(1900), body, 'tok-admin', fx.env);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ written: 2, duplicates: 0, totalXp: 4 });

    const again = await post(batchPath(1900), body, 'tok-admin', fx.env);
    expect(again.status).toBe(200); // 一条没写进去 → 200 而不是 201
    expect(await again.json()).toMatchObject({
      written: 0,
      duplicates: 2,
      totalXp: 0,
      perPlayer: [
        { playerId: 10, xp: 0, written: 0, duplicates: 1 },
        { playerId: 11, xp: 0, written: 0, duplicates: 1 },
      ],
    });
    expect(xpOf(fx, 10)).toBe(1);
    expect(xpOf(fx, 11)).toBe(3);
    expect(eventsOf(fx, 1900).length).toBe(2);
    expect(auditsOf(fx).length).toBe(2); // 每次提交各留一条（第二次是 no-op 也留痕）
  });

  it('TC-BATCH-06 与自动通道同锚去重：自动写过的出场不重复加 XP，手动项照常入账', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 1900, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });
    seedEvent(fx, 10, '1900', 'appearance', 1, 1); // 自动通道已入账
    fx.sqlite.exec('UPDATE players SET growth_xp = 1 WHERE id = 10');

    const res = await post(batchPath(1900), { entries: [{ playerId: 10, appearance: true, rating: 9 }] }, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ written: 1, duplicates: 1, totalXp: 3 });
    expect(xpOf(fx, 10)).toBe(4); // 1（自动）+ 3（手动评分），出场没再加一次

    const rows = eventsOf(fx, 1900);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.event_type === 'appearance')?.source).toBe('auto'); // 旧锚不动
    expect(rows.find((r) => r.event_type === 'rating')).toMatchObject({ source: 'manual', value: 9, xp: 3, recorded_by: 1 });
  });

  it('TC-BATCH-07 校验前置的原子性：一批里有一条不合法则整批零落库零审计', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 2000, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });

    const res = await post(
      batchPath(2000),
      {
        entries: [
          { playerId: 10, appearance: true },
          { playerId: 11, rating: 6.0 }, // 第 2 条非法
          { playerId: 12, saves: 8 },
        ],
      },
      'tok-admin',
      fx.env,
    );
    expect(res.status).toBe(400);
    expect(await errorText(res)).toContain('评分要在 7.0-10.0');
    expect(eventsOf(fx, 2000).length).toBe(0);
    expect(xpOf(fx, 10)).toBe(0);
    expect(xpOf(fx, 12)).toBe(0);
    expect(auditsOf(fx).length).toBe(0);
  });

  it('TC-BATCH-08 边界值：评分上下界与四舍五入、夺权 12/扑救 8 起算，0 XP 的数值整批拒', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 2100, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });

    const res = await post(
      batchPath(2100),
      {
        entries: [
          { playerId: 10, rating: 7.0 }, // 1
          { playerId: 11, rating: 10.0 }, // 4
          { playerId: 12, duelsWon: 12 }, // floor(12/12) = 1
          { playerId: 20, saves: 8 }, // floor(8/8) = 1
        ],
      },
      'tok-admin',
      fx.env,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ written: 4, duplicates: 0, totalXp: 7 });
    expect(eventsOf(fx, 2100).find((r) => r.player_id === 10)).toMatchObject({ value: 7, xp: 1 });
    expect(eventsOf(fx, 2100).find((r) => r.player_id === 11)).toMatchObject({ value: 10, xp: 4 });

    // 评分四舍五入到 0.1 后再算 XP：7.05 → 7.1 → 1 XP
    const rounded = await post(batchPath(2100), { entries: [{ playerId: 20, rating: 7.05 }] }, 'tok-admin', fx.env);
    expect(rounded.status).toBe(201);
    expect(eventsOf(fx, 2100).find((r) => r.player_id === 20 && r.event_type === 'rating')).toMatchObject({ value: 7.1, xp: 1 });

    // 达不到记 XP 的标准：夺权 11、扑救 7 都是 0 XP 项，直接拒（不是静默丢）
    for (const entry of [{ playerId: 10, duelsWon: 11 }, { playerId: 11, saves: 7 }]) {
      const bad = await post(batchPath(2100), { entries: [entry] }, 'tok-admin', fx.env);
      expect(bad.status).toBe(400);
      expect(await errorText(bad)).toContain('这个数值达不到记 XP 的标准');
    }
    expect(xpOf(fx, 10)).toBe(1); // 那两次被拒的提交没改动 XP
    expect(xpOf(fx, 11)).toBe(4);
  });

  it('TC-BATCH-09 最大组：25 人 × 5 项 = 125 条事件一次入账，审计仍只有一条', async () => {
    const fx = freshEnv();
    seedBase(fx);
    let playersSql = "INSERT INTO clubs (id, name, league_tier, status) VALUES (4, '新军', 'premier', 'active');\n";
    playersSql += 'INSERT INTO players (id, uid, name, club_id, position, status, growth_xp, ca) VALUES ';
    playersSql += Array.from({ length: 25 }, (_, i) => `(${100 + i}, 'n${100 + i}', 'N${100 + i}', 4, 'CM', 'normal', 0, 65)`).join(', ');
    playersSql += ';';
    fx.sqlite.exec(playersSql);
    seedMatch(fx, { matchId: 2200, competitionType: 'league_premier', stageKind: 'league', homeTeam: '新军', awayTeam: '机器甲 (CPU)', confirmedAt: '2026-07-01T10:00:00Z' });

    const entries = Array.from({ length: 25 }, (_, i) => ({ playerId: 100 + i, appearance: true, rating: 8, cleanSheet: true, duelsWon: 12, saves: 8 }));
    const res = await post(batchPath(2200), { entries }, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ written: 125, duplicates: 0, totalXp: 137.5 }); // 每人 1+2+0.5+1+1
    expect(eventsOf(fx, 2200).length).toBe(125);
    expect(auditsOf(fx).length).toBe(1);
  });

  it('TC-BATCH-10 权限与审计：匿名 401、教练 403、不可录场 POST 404；成功提交审计一条含明细', async () => {
    const fx = freshEnv();
    seedBase(fx);
    seedMatch(fx, { matchId: 2300, competitionType: 'league_premier', stageKind: 'league', homeTeam: '海港联', awayTeam: '北岸城', confirmedAt: '2026-07-01T10:00:00Z' });

    const payload = { entries: [{ playerId: 10, appearance: true, rating: 8 }] };
    expect((await anon(batchPath(2300), fx.env)).status).toBe(401);
    expect((await post(batchPath(2300), payload, 'tok-coach', fx.env)).status).toBe(403);
    expect((await get(panelPath(2300), 'tok-coach', fx.env)).status).toBe(403);
    expect((await get(LIST, 'tok-coach', fx.env)).status).toBe(403);
    expect((await post(batchPath(9999), payload, 'tok-admin', fx.env)).status).toBe(404);

    const res = await post(batchPath(2300), payload, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const audits = auditsOf(fx);
    expect(audits.length).toBe(1);
    expect(audits[0]).toMatchObject({ actor: 1, action: 'growth_manual_event_batch', target_type: 'match', target_id: 2300, origin: 'user', before: null });
    const after = JSON.parse(audits[0].after ?? '{}') as {
      matchId: number;
      written: number;
      duplicates: number;
      entries: { playerId: number; name: string; eventType: string; value: number; xp: number; duplicate: boolean }[];
    };
    expect(after).toMatchObject({ matchId: 2300, written: 2, duplicates: 0 });
    expect(after.entries).toEqual([
      { playerId: 10, name: '张三', eventType: 'appearance', value: 1, xp: 1, duplicate: false },
      { playerId: 10, name: '张三', eventType: 'rating', value: 8, xp: 2, duplicate: false },
    ]);
  });
});
