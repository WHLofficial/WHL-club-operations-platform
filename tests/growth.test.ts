// 成长引擎（§10）：XP 补录、赛果确认钩子自动事件、赛季结算（训练营/中国计划/里程碑）、
// 升级方案二选一、档位核定。幂等锚 = UNIQUE(player_id, match_ref, event_type)。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { xpForEvent, milestoneThresholds, milestoneXp, isCpuTeam } from '../src/worker/growth.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

// 比赛系统库表（照 WHL-tournament-management-system 迁移裁剪）：比赛事件含球员/助工者
const TOUR_SCHEMA = `
  CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
  CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT, config_json TEXT DEFAULT '{}');
  CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER, seed INTEGER);
  CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE player (id INTEGER PRIMARY KEY, team_id INTEGER, name TEXT, number INTEGER);
  CREATE TABLE match_event (id INTEGER PRIMARY KEY, match_id INTEGER, player_id INTEGER, assist_player_id INTEGER, type TEXT, minute INTEGER);
  CREATE TABLE match (
    id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER, slot INTEGER,
    home_entry_id INTEGER, away_entry_id INTEGER,
    score_home INTEGER, score_away INTEGER, pen_home INTEGER, pen_away INTEGER,
    status TEXT, winner_entry_id INTEGER, finished_at TEXT, walkover_side TEXT DEFAULT ''
  );`;

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
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${token}` } }, env);
}

function post(path: string, body: unknown, token: string, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` },
      body: JSON.stringify(body),
    },
    env,
  );
}

// 平台侧种子：两家俱乐部六名球员；王五=训练营（不按场次），孙八=中国计划
function seedPlatform(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '曼城', 'premier', 'active');
    INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, china_plan, ca) VALUES
      (10, 'p10', '张三', 1, 'ST', 'normal', 3, 0, 0, 80),
      (11, 'p11', '李四', 1, 'GK', 'normal', 1, 0, 0, 75),
      (12, 'p12', '王五', 1, 'CM', 'trainee', 1, 0, 0, 60),
      (20, 'p20', '赵六', 2, 'ST', 'normal', 1, 0, 0, 78),
      (21, 'p21', '钱七', 2, 'GK', 'normal', 1, 0, 0, 74),
      (22, 'p22', '孙八', 2, 'CM', 'normal', 2, 0, 1, 70);
    INSERT INTO contracts (player_id, club_id, contract_type, is_active) VALUES (12, 1, 'trainee', 1);
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (2, 2, '2026-01-01T00:00:00Z');
  `);
}

// 比赛系统种子：联赛 900/901 完赛、冠军杯淘汰赛 905 完赛、弃权 903、未完赛 902
function seedTour(fx: Fixture): void {
  fx.tour.exec(`
    INSERT INTO tournament (id, name, status) VALUES (5, 'S3 顶级联赛', 'running'), (6, 'S3 冠军杯', 'running');
    INSERT INTO stage (id, tournament_id, kind, sort_order, name) VALUES (50, 5, 'round_robin', 1, '常规赛'), (60, 6, 'elim', 1, NULL);
    INSERT INTO team (id, name) VALUES (1, '阿森纳'), (2, '曼城'), (3, '切尔西');
    INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (11, 5, 1, 1), (12, 5, 2, 2), (13, 6, 3, 1);
    INSERT INTO player (id, team_id, name, number) VALUES
      (101, 1, '张三', 9), (102, 1, '李四', 1), (103, 1, '王五', 8),
      (201, 2, '赵六', 9), (202, 2, '钱七', 1), (203, 2, '孙九', 7), (301, 3, '孙九', 7);
    INSERT INTO match (id, stage_id, round, slot, home_entry_id, away_entry_id, score_home, score_away, status, winner_entry_id, finished_at)
      VALUES (900, 50, 1, 1, 11, 12, 2, 1, 'finished', 11, '2026-07-03T21:00:00Z'),
             (901, 50, 1, 2, 12, 11, 0, 3, 'finished', 11, '2026-07-04T21:00:00Z'),
             (902, 50, 2, 1, 11, 12, NULL, NULL, 'pending', NULL, NULL);
    INSERT INTO match (id, stage_id, round, slot, home_entry_id, away_entry_id, score_home, score_away, status, walkover_side, finished_at)
      VALUES (903, 60, 1, 1, 13, NULL, 0, 3, 'finished', 'home', '2026-07-05T21:00:00Z');
    INSERT INTO match (id, stage_id, round, slot, home_entry_id, away_entry_id, score_home, score_away, status, winner_entry_id, finished_at)
      VALUES (905, 60, 1, 2, 11, 12, 1, 0, 'finished', 11, '2026-07-06T21:00:00Z');
    INSERT INTO match_event (match_id, player_id, assist_player_id, type, minute) VALUES
      (900, 101, NULL, 'goal', 10), (900, 101, 103, 'goal', 30), (900, 201, NULL, 'goal', 40),
      (900, 203, NULL, 'goal', 50), (900, 301, NULL, 'goal', 60),
      (901, 101, NULL, 'goal', 15), (901, 102, NULL, 'yellow', 70),
      (905, 201, NULL, 'goal', 25);
  `);
}

async function bindSeason(fx: Fixture): Promise<void> {
  await post('/api/admin/seasons', { season: 3 }, 'tok-admin', fx.env);
  await post('/api/admin/windows/open', { season: 3, windowSeq: 1 }, 'tok-admin', fx.env);
  await post(
    '/api/admin/seasons/3/bind-tournament',
    { tournamentId: 5, competitionType: 'league_premier' },
    'tok-admin',
    fx.env,
  );
  // 绑定已不依赖窗口（增量 6.1：赛事绑赛季）；仍开出窗口 2，让冠军杯场次的确认时点落在窗 2
  await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
  await post('/api/admin/windows/open', { season: 3, windowSeq: 2 }, 'tok-admin', fx.env);
  await post(
    '/api/admin/seasons/3/bind-tournament',
    { tournamentId: 6, competitionType: 'champions_cup' },
    'tok-admin',
    fx.env,
  );
}

function xpOf(fx: Fixture, playerId: number): number {
  return sqlGet<{ growth_xp: number }>(fx.sqlite, 'SELECT growth_xp FROM players WHERE id = ?', playerId)?.growth_xp ?? 0;
}

describe('XP 计算函数（§10.1 表）', () => {
  it('评分 7-10 分档；进球/助攻/零封 0.5；夺权每 12 次；扑救每 8 次 + 单场超 8 额外 1', () => {
    expect(xpForEvent('appearance', 1)).toBe(1);
    expect(xpForEvent('rating', 6.9)).toBe(0);
    expect(xpForEvent('rating', 7)).toBe(1);
    expect(xpForEvent('rating', 7.9)).toBe(1);
    expect(xpForEvent('rating', 8)).toBe(2);
    expect(xpForEvent('rating', 9.5)).toBe(3);
    expect(xpForEvent('rating', 10)).toBe(4);
    expect(xpForEvent('goal', 1)).toBe(0.5);
    expect(xpForEvent('clean_sheet', 1)).toBe(0.5);
    expect(xpForEvent('duels_won', 24)).toBe(2);
    expect(xpForEvent('saves', 8)).toBe(1);
    expect(xpForEvent('saves', 9)).toBe(2);
  });

  it('里程碑阈值 5/10/15/20 之后每 +5（无上限，去重锚保证每档只发一次）', () => {
    expect(milestoneThresholds(4)).toEqual([]);
    expect(milestoneThresholds(17)).toEqual([5, 10, 15]);
    expect(milestoneThresholds(26)).toEqual([5, 10, 15, 20, 25]);
    const far = milestoneThresholds(999);
    expect(far).toHaveLength(199); // 5, 10, …, 995
    expect(far.at(-1)).toBe(995);
    expect(milestoneXp(5)).toBe(1);
    expect(milestoneXp(10)).toBe(2);
    expect(milestoneXp(15)).toBe(3);
    expect(milestoneXp(25)).toBe(4);
  });
});

describe('XP 补录（附录 A〔6〕）', () => {
  it('评分/夺权/扑救/出场按表入账；XP 服务端算；审计留痕', async () => {
    const fx = freshEnv();
    seedPlatform(fx);

    const rating = await post('/api/admin/growth/events', { playerId: 10, eventType: 'rating', value: 8.5, matchRef: 'manual:r1' }, 'tok-admin', fx.env);
    expect(rating.status).toBe(201);
    expect(((await rating.json()) as { xp: number }).xp).toBe(2);
    expect(xpOf(fx, 10)).toBe(2);

    const duels = await post('/api/admin/growth/events', { playerId: 10, eventType: 'duels_won', value: 25, matchRef: 'manual:d1' }, 'tok-admin', fx.env);
    expect(((await duels.json()) as { xp: number }).xp).toBe(2);
    const saves = await post('/api/admin/growth/events', { playerId: 21, eventType: 'saves', value: 9, matchRef: 'manual:s1' }, 'tok-admin', fx.env);
    expect(((await saves.json()) as { xp: number }).xp).toBe(2);
    const appearance = await post('/api/admin/growth/events', { playerId: 20, eventType: 'appearance' }, 'tok-admin', fx.env);
    expect(((await appearance.json()) as { xp: number }).xp).toBe(1);
    expect(xpOf(fx, 20)).toBe(1);

    expect(sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'growth_manual_event'")?.action).toBe('growth_manual_event');
  });

  it('重复补录（同 matchRef+事件）标记 duplicate 且 XP 不重复加；越界/非法/教练全拒', async () => {
    const fx = freshEnv();
    seedPlatform(fx);

    const first = await post('/api/admin/growth/events', { playerId: 10, eventType: 'rating', value: 9, matchRef: 'manual:x' }, 'tok-admin', fx.env);
    expect(first.status).toBe(201);
    const again = await post('/api/admin/growth/events', { playerId: 10, eventType: 'rating', value: 9, matchRef: 'manual:x' }, 'tok-admin', fx.env);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(xpOf(fx, 10)).toBe(3);

    const lowRating = await post('/api/admin/growth/events', { playerId: 10, eventType: 'rating', value: 6.5 }, 'tok-admin', fx.env);
    expect(lowRating.status).toBe(400);
    const badType = await post('/api/admin/growth/events', { playerId: 10, eventType: 'goal' }, 'tok-admin', fx.env);
    expect(badType.status).toBe(400);
    const badCount = await post('/api/admin/growth/events', { playerId: 10, eventType: 'saves', value: -3 }, 'tok-admin', fx.env);
    expect(badCount.status).toBe(400);
    const noPlayer = await post('/api/admin/growth/events', { playerId: 999, eventType: 'appearance' }, 'tok-admin', fx.env);
    expect(noPlayer.status).toBe(404);
    const coach = await post('/api/admin/growth/events', { playerId: 10, eventType: 'appearance' }, 'tok-coach', fx.env);
    expect(coach.status).toBe(403);
  });
});

describe('赛果确认钩子：自动 XP（§15 假设 20-22）', () => {
  it('按队名+球员名匹配入出场/进球/助攻/零封；训练营不记；解不开进 unresolved', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedTour(fx);
    await bindSeason(fx);

    // 900 阿森纳 2:1 曼城：张三 2 球、王五(训练营)助攻、赵六 1 球；孙九(曼城)/孙九(切尔西)解不开
    const c900 = await post('/api/admin/results/900/confirm', {}, 'tok-admin', fx.env);
    expect(c900.status).toBe(201);
    const xp900 = ((await c900.json()) as { xp: { granted: number; unresolved: string[] } }).xp;
    expect(xp900.granted).toBe(4); // 出场 2 + 张三两球合成一条(value2) + 赵六一球
    expect(xp900.unresolved).toEqual(expect.arrayContaining(['曼城·孙九', '俱乐部「切尔西」']));
    expect(xpOf(fx, 10)).toBe(2); // 出场 1 + 两球 1（0.5×2）
    expect(sqlGet<{ value: number; xp: number }>(fx.sqlite, "SELECT value, xp FROM growth_events WHERE player_id = 10 AND event_type = 'goal'")).toMatchObject({
      value: 2,
      xp: 1,
    });
    expect(xpOf(fx, 20)).toBe(1.5); // 出场 1 + 一球 0.5
    expect(xpOf(fx, 12)).toBe(0); // 训练营不按场次

    // 901 曼城 0:3 阿森纳：张三 1 球 + 李四(GK，黄牌在场)；阿森纳零封 → 李四 出场+零封
    const c901 = await post('/api/admin/results/901/confirm', {}, 'tok-admin', fx.env);
    expect(c901.status).toBe(201);
    expect((((await c901.json()) as { xp: { granted: number } }).xp).granted).toBe(4); // 出场 2 + 张三进球 1 + 零封 1
    expect(xpOf(fx, 10)).toBe(3.5); // 再 + 出场 1 + 一球 0.5
    expect(xpOf(fx, 11)).toBe(1.5); // 出场 1 + 零封 0.5

    const events = sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM growth_events WHERE event_type = 'clean_sheet'")?.n;
    expect(events).toBe(1);
  });

  it('冠军杯淘汰赛与弃权场不计 XP（限联赛与冠军杯小组赛）', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedTour(fx);
    await bindSeason(fx);

    const knockout = await post('/api/admin/results/905/confirm', {}, 'tok-admin', fx.env);
    expect(knockout.status).toBe(201);
    expect((((await knockout.json()) as { xp: { granted: number } }).xp).granted).toBe(0);

    const walkover = await post('/api/admin/results/903/confirm', {}, 'tok-admin', fx.env);
    expect(walkover.status).toBe(201);
    expect((((await walkover.json()) as { xp: { granted: number } }).xp).granted).toBe(0);

    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM growth_events')?.n).toBe(0);
    expect(xpOf(fx, 20)).toBe(0);
  });

  it('CPU 队（队名带 (CPU)）整队静默跳过：不计 XP，也不进「没匹配上」提示', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedTour(fx);
    await bindSeason(fx);
    // 906 阿森纳 1:2 巴塞罗那(CPU)：CPU 队球员视同海里球员（平台无俱乐部行、无合同）
    fx.tour.exec(`
      INSERT INTO team (id, name) VALUES (4, '巴塞罗那(CPU)');
      INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (14, 5, 4, 3);
      INSERT INTO player (id, team_id, name, number) VALUES (401, 4, 'CPU前锋', 9);
      INSERT INTO match (id, stage_id, round, slot, home_entry_id, away_entry_id, score_home, score_away, status, winner_entry_id, finished_at)
        VALUES (906, 50, 3, 1, 11, 14, 1, 2, 'finished', 14, '2026-07-10T21:00:00Z');
      INSERT INTO match_event (match_id, player_id, assist_player_id, type, minute) VALUES
        (906, 101, NULL, 'goal', 20), (906, 401, NULL, 'goal', 30), (906, 401, NULL, 'goal', 35);
    `);

    const res = await post('/api/admin/results/906/confirm', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const xp = ((await res.json()) as { xp: { granted: number; unresolved: string[] } }).xp;
    expect(xp.granted).toBe(2); // 只有阿森纳张三：出场 1 + 进球 1
    expect(xp.unresolved).toEqual([]); // CPU 队不再提示补录，也不牵扯它的球员名
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM growth_events WHERE match_ref = '906'")?.n).toBe(2);
    expect(xpOf(fx, 10)).toBe(1.5); // 张三：出场 1 + 一球 0.5（CPU 队两名 CPU 球员的进球一分不记）

    // 严格匹配：只有半角「(CPU)」后缀算 CPU 队，全角/大小写/中间位置都不算
    expect(isCpuTeam('巴塞罗那(CPU)')).toBe(true);
    expect(isCpuTeam('（CPU）巴塞罗那')).toBe(false);
    expect(isCpuTeam('巴塞罗那（CPU）')).toBe(false);
    expect(isCpuTeam('巴塞罗那(cpu)')).toBe(false);
    expect(isCpuTeam('CPU')).toBe(false);
    expect(isCpuTeam(null)).toBe(false);
  });
});

describe('赛季结算（§10.1）：训练营/中国计划/里程碑', () => {
  it('训练营 40、中国计划 +20、进+攻 5 球补发里程碑；重放幂等不重复加', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    // 哈兰德已入 6 球事件（xp 3）→ 结算补发 milestone:5（+1）
    // 中国计划 XP 只认在玩家队的球员（用户规则 2026-09-18）：孙八补一份现行合同才吃得到；
    // 周九同样 china_plan=1 但没有合同（CPU 队/自由身口径）→ 一分不加。
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, china_plan, ca) VALUES
        (30, 'p30', '哈兰德', 1, 'ST', 'normal', 2, 3, 0, 85),
        (23, 'p23', '周九', 2, 'CM', 'normal', 1, 0, 1, 70);
      INSERT INTO contracts (player_id, club_id, contract_type, is_active) VALUES (22, 2, 'standard', 1);
      INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES
        (30, 'ms1', 'goal', 1, 0.5, 'auto', '2026-07-01T00:00:00Z'), (30, 'ms2', 'goal', 1, 0.5, 'auto', '2026-07-01T00:00:00Z'),
        (30, 'ms3', 'goal', 1, 0.5, 'auto', '2026-07-01T00:00:00Z'), (30, 'ms4', 'goal', 1, 0.5, 'auto', '2026-07-01T00:00:00Z'),
        (30, 'ms5', 'goal', 1, 0.5, 'auto', '2026-07-01T00:00:00Z'), (30, 'ms6', 'goal', 1, 0.5, 'auto', '2026-07-01T00:00:00Z');
    `);

    const run1 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(run1.status).toBe(200);
    const s1 = (await run1.json()) as {
      traineeCount: number;
      traineeXp: number;
      chinaCount: number;
      milestonesGranted: number;
      pendingLevelUps: { playerId: number; pending: number }[];
    };
    expect(s1.traineeCount).toBe(1);
    expect(s1.traineeXp).toBe(40);
    expect(s1.chinaCount).toBe(1); // 只有有合同的孙八；无合同的周九不算
    expect(s1.milestonesGranted).toBe(1);
    expect(s1.pendingLevelUps).toEqual(expect.arrayContaining([{ playerId: 12, name: '王五', growthTier: 1, pending: 4 }]));
    expect(s1.pendingLevelUps.find((p) => p.playerId === 30)).toBeUndefined(); // 4 XP 不到一级

    expect(xpOf(fx, 12)).toBe(40);
    expect(xpOf(fx, 22)).toBe(20);
    expect(xpOf(fx, 23)).toBe(0); // 中国计划但无现行合同：不入账
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM growth_events WHERE player_id = 23')?.n).toBe(0);
    expect(xpOf(fx, 30)).toBe(4);
    expect(sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'growth_settlement'")?.action).toBe('growth_settlement');

    // 重放：全部命中去重锚，XP 与计数不再变
    const run2 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    const s2 = (await run2.json()) as typeof s1;
    expect(s2.traineeCount).toBe(1);
    expect(s2.chinaCount).toBe(1);
    expect(s2.milestonesGranted).toBe(0);
    expect(xpOf(fx, 12)).toBe(40);
    expect(xpOf(fx, 22)).toBe(20);
    expect(xpOf(fx, 30)).toBe(4);
  });

  it('里程碑只算成长期内的进+攻：解约划断后重新累计、可再次补发', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    // 姆巴佩：6 球后遭解约（reset 划断）——按「解约即回初始」，划断前那 6 球不再算
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, ca) VALUES (31, 'p31', '姆巴佩', 1, 'ST', 'normal', 2, 0, 85);
      INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES
        (31, 'm1', 'goal', 1, 0, 'auto', '2026-05-01T00:00:00Z'), (31, 'm2', 'goal', 1, 0, 'auto', '2026-05-01T00:00:00Z'),
        (31, 'm3', 'goal', 1, 0, 'auto', '2026-05-01T00:00:00Z'), (31, 'm4', 'goal', 1, 0, 'auto', '2026-05-01T00:00:00Z'),
        (31, 'm5', 'goal', 1, 0, 'auto', '2026-05-01T00:00:00Z'), (31, 'm6', 'goal', 1, 0, 'auto', '2026-05-01T00:00:00Z'),
        (31, 'term1', 'reset', 0, 0, 'auto', '2026-06-01T00:00:00Z');
    `);
    const run1 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(run1.status).toBe(200);
    expect(((await run1.json()) as { milestonesGranted: number }).milestonesGranted).toBe(0); // 划断前 6 球不算

    // 新成长期（解约后）再攒 5 球 → 补发 milestone:5，去重锚带上划断序号
    fx.sqlite.exec(`
      INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES
        (31, 'n1', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z'), (31, 'n2', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z'),
        (31, 'n3', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z'), (31, 'n4', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z'),
        (31, 'n5', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z');
    `);
    const run2 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(((await run2.json()) as { milestonesGranted: number }).milestonesGranted).toBe(1);
    expect(
      sqlGet<{ match_ref: string }>(fx.sqlite, "SELECT match_ref FROM growth_events WHERE player_id = 31 AND event_type = 'milestone'")?.match_ref,
    ).toMatch(/^milestone:\d+:\d+:5$/); // 锚带期号+划断序号

    // 重放：同一成长期内不再重复补发
    const run3 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(((await run3.json()) as { milestonesGranted: number }).milestonesGranted).toBe(0);
  });

  it('season 非法 400', async () => {
    const fx = freshEnv();
    const bad = await post('/api/admin/growth/settlement/run', { season: 0 }, 'tok-admin', fx.env);
    expect(bad.status).toBe(400);
  });
});

describe('升级方案二选一与档位核定（§10.2/§10.3）', () => {
  it('档 3 两方案逐次消费；CA/银徽章按方案落账；待办清零后 409；越界 400', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec("UPDATE players SET growth_xp = 25 WHERE id = 10"); // 待办 2

    const lv1 = await post('/api/growth/levelup/10', { planIndex: 0 }, 'tok-admin', fx.env);
    expect(lv1.status).toBe(200);
    const r1 = (await lv1.json()) as { plan: { ca: number }; levelsApplied: number; pendingLeft: number };
    expect(r1.plan).toEqual({ ca: 3, silver: 0, gold: 0 });
    expect(r1.levelsApplied).toBe(1);
    expect(r1.pendingLeft).toBe(1);
    expect(sqlGet<{ ca: number }>(fx.sqlite, 'SELECT ca FROM players WHERE id = 10')?.ca).toBe(83);

    const outOfRange = await post('/api/growth/levelup/10', { planIndex: 5 }, 'tok-admin', fx.env); // 有待办但方案号越界
    expect(outOfRange.status).toBe(400);

    const lv2 = await post('/api/growth/levelup/10', { planIndex: 1, picks: [1] }, 'tok-admin', fx.env);
    const r2 = (await lv2.json()) as {
      plan: { ca: number; silver: number };
      levelsApplied: number;
      playstyles: { slot: number; psid: number; gold: boolean }[];
    };
    expect(r2.plan).toEqual({ ca: 2, silver: 1, gold: 0 });
    expect(r2.levelsApplied).toBe(2);
    // 方案带 1 个银徽章 → 落槽 1、发的是选中的银 PlayStyle（psid 用存库形式：银 1-99 / 金 101-199）
    expect(r2.playstyles).toEqual([{ slot: 1, psid: 1, gold: false }]);
    expect(sqlGet<{ ca: number; badges_silver: number }>(fx.sqlite, 'SELECT ca, badges_silver FROM players WHERE id = 10')).toMatchObject({ ca: 85, badges_silver: 1 });
    expect(sqlAll<{ slot: number; kind: string; psid: number; source: string }>(fx.sqlite, 'SELECT slot, kind, psid, source FROM player_playstyles WHERE player_id = 10')).toEqual([
      { slot: 1, kind: 'silver', psid: 1, source: 'growth' }, // 明细存基础 ID
    ]);

    const drained = await post('/api/growth/levelup/10', { planIndex: 0 }, 'tok-admin', fx.env);
    expect(drained.status).toBe(409);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM growth_events WHERE event_type = 'levelup'")?.n).toBe(2);

    const growth = (await (await get('/api/players/10/growth', 'tok-admin', fx.env)).json()) as {
      player: { pendingLevelUps: number; growthXp: number; upgradePlans: unknown[]; chinaPlaystyles: { quota: number; granted: number; left: number } };
      events: { eventType: string; matchRef: string | null }[];
      playstyleDetails: { slot: number; kind: string; psid: number; source: string; createdAt: string | null }[];
    };
    expect(growth.player.pendingLevelUps).toBe(0);
    expect(growth.player.growthXp).toBe(25);
    expect(growth.player.upgradePlans).toHaveLength(2);
    expect(growth.events.map((e) => e.matchRef)).toEqual(expect.arrayContaining(['levelup:1', 'levelup:2']));
    expect(growth.playstyleDetails).toMatchObject([{ slot: 1, kind: 'silver', psid: 1, source: 'growth' }]);
    expect(growth.player.chinaPlaystyles).toEqual({ quota: 3, granted: 0, left: 3 });
  });

  it('带徽章的方案必须交 picks：缺数量 / 不在清单 / 重复 / 已拥有各自 400，且一个字段都没写', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec("UPDATE players SET growth_xp = 25 WHERE id = 10"); // 待办 2；档 3 方案 1 = 2CA + 1 银

    const none = await post('/api/growth/levelup/10', { planIndex: 1 }, 'tok-admin', fx.env);
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toContain('要发 1 个银 PlayStyle');

    const bogus = await post('/api/growth/levelup/10', { planIndex: 1, picks: [9] }, 'tok-admin', fx.env); // 9 不在白名单
    expect(bogus.status).toBe(400);
    expect(((await bogus.json()) as { error: string }).error).toContain('不在可发放清单里');

    const gold = await post('/api/growth/levelup/10', { planIndex: 1, picks: [101] }, 'tok-admin', fx.env); // 该方案不发金徽
    expect(gold.status).toBe(400);

    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM player_playstyles')?.n).toBe(0);
    expect(sqlGet<{ ca: number; levels_applied: number }>(fx.sqlite, 'SELECT ca, levels_applied FROM players WHERE id = 10')).toMatchObject({ ca: 80, levels_applied: 0 });

    // 先发一次，再用同一个 PlayStyle 升级 → 已拥有
    const first = await post('/api/growth/levelup/10', { planIndex: 1, picks: [1] }, 'tok-admin', fx.env);
    expect(first.status).toBe(200);
    const again = await post('/api/growth/levelup/10', { planIndex: 1, picks: [1] }, 'tok-admin', fx.env);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toContain('已经在这名球员身上');
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM player_playstyles')?.n).toBe(1);
  });

  it('FC 源槽也算占用：game_attrs 里已有的 PlayStyle 不能重发，槽位从下一个空槽起', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec(
      `UPDATE players SET growth_xp = 10, game_attrs = '{"PSID1": 3}' WHERE id = 10`, // 槽 1 被 FC 源占（银 3）
    );

    const dup = await post('/api/growth/levelup/10', { planIndex: 1, picks: [3] }, 'tok-admin', fx.env);
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toContain('已经在这名球员身上');

    const ok = await post('/api/growth/levelup/10', { planIndex: 1, picks: [5] }, 'tok-admin', fx.env);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { playstyles: unknown }).playstyles).toEqual([{ slot: 2, psid: 5, gold: false }]); // 跳过槽 1
  });

  it('金徽落金槽（13 起）且存库 ID 是基础 ID + 100', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec("UPDATE players SET growth_xp = 10 WHERE id = 10");

    const lv = await post('/api/growth/levelup/10', { planIndex: 2, picks: [101, 102] }, 'tok-admin', fx.env); // 档 3 方案 2 = 3CA + 2 银
    expect(lv.status).toBe(400); // 方案 2 是 2 银，给金徽数量对不上

    fx.sqlite.exec("UPDATE players SET growth_tier = 5 WHERE id = 10"); // 档 5 方案 1 = 3CA + 1 金
    const goldLv = await post('/api/growth/levelup/10', { planIndex: 1, picks: [101] }, 'tok-admin', fx.env);
    expect(goldLv.status).toBe(200);
    expect(((await goldLv.json()) as { playstyles: unknown }).playstyles).toEqual([{ slot: 13, psid: 101, gold: true }]);
    expect(sqlGet<{ slot: number; kind: string; psid: number }>(fx.sqlite, 'SELECT slot, kind, psid FROM player_playstyles WHERE player_id = 10')).toMatchObject({
      slot: 13,
      kind: 'gold',
      psid: 1, // 明细存基础 ID，金徽的 +100 由 kind 表示
    });
  });

  it('银槽满 12 后不再发（400），CA 与台账一个都不动', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec(`
      UPDATE players SET growth_xp = 10 WHERE id = 10;
      INSERT INTO player_playstyles (player_id, slot, kind, psid, source, created_at)
        WITH RECURSIVE s(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM s WHERE v < 12)
        SELECT 10, v, 'silver', v, 'growth', '2026-01-01T00:00:00.000Z' FROM s;
    `);

    const lv = await post('/api/growth/levelup/10', { planIndex: 1, picks: [55] }, 'tok-admin', fx.env);
    expect(lv.status).toBe(400);
    expect(((await lv.json()) as { error: string }).error).toContain('银槽已满（12 个）');
    expect(sqlGet<{ ca: number; badges_silver: number; levels_applied: number }>(fx.sqlite, 'SELECT ca, badges_silver, levels_applied FROM players WHERE id = 10')).toMatchObject({
      ca: 80,
      badges_silver: 0,
      levels_applied: 0,
    });
  });

  it('徽章封顶：台账到帽后不再加，CA 照加', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    // 台账被管理端手工顶到帽（12），槽位其实还空着 —— 计数封顶只挡台账，不挡 CA
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, ca, badges_silver, badges_gold) VALUES
        (40, 'p40', '老将', 1, 'ST', 'normal', 5, 10, 90, 12, 3);
    `);

    const lv = await post('/api/growth/levelup/40', { planIndex: 2, picks: [1, 2] }, 'tok-admin', fx.env); // [3CA+2银]
    expect(lv.status).toBe(200);
    expect(sqlGet<{ ca: number; badges_silver: number; badges_gold: number }>(fx.sqlite, 'SELECT ca, badges_silver, badges_gold FROM players WHERE id = 40')).toMatchObject({
      ca: 93,
      badges_silver: 12,
      badges_gold: 3,
    });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM player_playstyles WHERE player_id = 40')?.n).toBe(2);
  });

  it('非管理组只能给自己俱乐部球员升级；未登录 401', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec("UPDATE players SET growth_xp = 12 WHERE id = 20");

    const other = await post('/api/growth/levelup/10', { planIndex: 0 }, 'tok-coach', fx.env); // 张三属阿森纳
    expect(other.status).toBe(403);
    const mine = await post('/api/growth/levelup/20', { planIndex: 0 }, 'tok-coach', fx.env); // 赵六属曼城
    expect(mine.status).toBe(200);
    expect(sqlGet<{ ca: number }>(fx.sqlite, 'SELECT ca FROM players WHERE id = 20')?.ca).toBe(79); // 档1 方案 +1CA

    const anon = await app.request('/api/growth/levelup/20', { method: 'POST', body: JSON.stringify({ planIndex: 0 }) }, fx.env);
    expect(anon.status).toBe(401);
  });

  it('档位核定 1-5 落库+审计；越界 400', async () => {
    const fx = freshEnv();
    seedPlatform(fx);

    const ok = await post('/api/admin/growth/10/tier', { tier: 5 }, 'tok-admin', fx.env);
    expect(ok.status).toBe(200);
    expect(sqlGet<{ growth_tier: number }>(fx.sqlite, 'SELECT growth_tier FROM players WHERE id = 10')?.growth_tier).toBe(5);
    expect(sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'growth_tier_set'")?.action).toBe('growth_tier_set');

    const bad = await post('/api/admin/growth/10/tier', { tier: 6 }, 'tok-admin', fx.env);
    expect(bad.status).toBe(400);
    const coach = await post('/api/admin/growth/10/tier', { tier: 3 }, 'tok-coach', fx.env);
    expect(coach.status).toBe(403);
  });
});

describe('中国计划徽章发放（增量 30：中国计划自选 3 个银 PlayStyle）', () => {
  it('本队教练一次发满 3 个：台账 +3、明细落槽 1-3、再发 409；鉴权与计划门槛各就各位', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    // 周九：club 1 的中国计划球员（tok-coach 绑定的是 club 2，用来验 403）
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, status, china_plan, ca) VALUES (30, 'p30', '周九', 1, 'ST', 'normal', 1, 70);`,
    );

    const res = await post('/api/growth/china-playstyles/22', { picks: [1, 2, 3] }, 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { granted: number; left: number; playstyles: unknown };
    expect(body.granted).toBe(3);
    expect(body.left).toBe(0);
    expect(body.playstyles).toEqual([
      { slot: 1, psid: 1, gold: false },
      { slot: 2, psid: 2, gold: false },
      { slot: 3, psid: 3, gold: false },
    ]);
    // 台账同步加（离队时按 source='china' 行数回收）
    expect(sqlGet<{ badges_silver: number }>(fx.sqlite, 'SELECT badges_silver FROM players WHERE id = 22')?.badges_silver).toBe(3);
    expect(
      sqlAll<{ slot: number; kind: string; psid: number; source: string; granted_by: number }>(
        fx.sqlite,
        'SELECT slot, kind, psid, source, granted_by FROM player_playstyles WHERE player_id = 22 ORDER BY slot',
      ),
    ).toEqual([
      { slot: 1, kind: 'silver', psid: 1, source: 'china', granted_by: 2 },
      { slot: 2, kind: 'silver', psid: 2, source: 'china', granted_by: 2 },
      { slot: 3, kind: 'silver', psid: 3, source: 'china', granted_by: 2 },
    ]);

    const again = await post('/api/growth/china-playstyles/22', { picks: [4] }, 'tok-coach', fx.env);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain('已经发完（3 个）');

    const notInPlan = await post('/api/growth/china-playstyles/20', { picks: [4] }, 'tok-coach', fx.env);
    expect(notInPlan.status).toBe(409);
    expect(((await notInPlan.json()) as { error: string }).error).toContain('不在中国球员计划里');

    const otherClub = await post('/api/growth/china-playstyles/30', { picks: [4, 5, 6] }, 'tok-coach', fx.env);
    expect(otherClub.status).toBe(403);
    expect((await post('/api/growth/china-playstyles/30', { picks: [4, 5, 6] }, 'tok-admin', fx.env)).status).toBe(200); // 管理组通吃

    const anon = await app.request('/api/growth/china-playstyles/30', { method: 'POST', body: JSON.stringify({ picks: [] }) }, fx.env);
    expect(anon.status).toBe(401);
    expect((await post('/api/growth/china-playstyles/abc', { picks: [] }, 'tok-admin', fx.env)).status).toBe(400);
    expect((await post('/api/growth/china-playstyles/999', { picks: [] }, 'tok-admin', fx.env)).status).toBe(404);
  });

  it('数量必须对得上名额：少给 / 多给 / 重复 / 不在清单都 400，一个字段都不写', async () => {
    const fx = freshEnv();
    seedPlatform(fx);

    const few = await post('/api/growth/china-playstyles/22', { picks: [1] }, 'tok-coach', fx.env);
    expect(few.status).toBe(400);
    expect(((await few.json()) as { error: string }).error).toContain('要发 3 个银 PlayStyle');

    const many = await post('/api/growth/china-playstyles/22', { picks: [1, 2, 3, 4] }, 'tok-coach', fx.env);
    expect(many.status).toBe(400);

    const dup = await post('/api/growth/china-playstyles/22', { picks: [1, 1, 2] }, 'tok-coach', fx.env);
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toContain('不能在同一段里选两次');

    const bogus = await post('/api/growth/china-playstyles/22', { picks: [1, 2, 9] }, 'tok-coach', fx.env);
    expect(bogus.status).toBe(400);
    expect(((await bogus.json()) as { error: string }).error).toContain('不在可发放清单里');

    const goldInChina = await post('/api/growth/china-playstyles/22', { picks: [101, 102, 103] }, 'tok-coach', fx.env);
    expect(goldInChina.status).toBe(400); // 中国计划只发银徽章

    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM player_playstyles')?.n).toBe(0);
    expect(sqlGet<{ badges_silver: number }>(fx.sqlite, 'SELECT badges_silver FROM players WHERE id = 22')?.badges_silver).toBe(0);
  });

  it('名额按已发行数递减：库里已有 1 行 china 明细时，本次只收 2 个', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec(`
      UPDATE players SET badges_silver = 1 WHERE id = 22;
      INSERT INTO player_playstyles (player_id, slot, kind, psid, source, created_at)
        VALUES (22, 1, 'silver', 5, 'china', '2026-01-01T00:00:00Z');
    `);

    const growth = (await (await get('/api/players/22/growth', 'tok-coach', fx.env)).json()) as {
      player: { chinaPlaystyles: { quota: number; granted: number; left: number } };
      playstyleDetails: { slot: number; psid: number; source: string }[];
    };
    expect(growth.player.chinaPlaystyles).toEqual({ quota: 3, granted: 1, left: 2 });
    expect(growth.playstyleDetails).toMatchObject([{ slot: 1, psid: 5, source: 'china' }]);

    const one = await post('/api/growth/china-playstyles/22', { picks: [2] }, 'tok-coach', fx.env);
    expect(one.status).toBe(400); // 名额剩 2，只给 1 个不行
    expect(((await one.json()) as { error: string }).error).toContain('要发 2 个银 PlayStyle');

    const two = await post('/api/growth/china-playstyles/22', { picks: [2, 3] }, 'tok-coach', fx.env);
    expect(two.status).toBe(200);
    expect(((await two.json()) as { left: number }).left).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM player_playstyles WHERE player_id = 22 AND source = 'china'")?.n).toBe(3);
    expect(sqlGet<{ badges_silver: number }>(fx.sqlite, 'SELECT badges_silver FROM players WHERE id = 22')?.badges_silver).toBe(3);
  });
});

describe('成长期（用户规则 2026-09-18）：里程碑只算当期，宣告与窗口解耦', () => {
  it('多名球员各自累计补发（回归：分组游标曾把全表折成一组并来回跳）', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    // 甲 5 球 → 只到档 5；乙 10 球 → 到档 5、10。两人都要各自补发，且统计不能卡住。
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, ca) VALUES
        (31, 'p31', '甲', 1, 'ST', 'normal', 2, 0, 85),
        (32, 'p32', '乙', 2, 'ST', 'normal', 2, 0, 85);
    `);
    for (let i = 1; i <= 6; i++) {
      fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (31, 'a${i}', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z')`);
    }
    for (let i = 1; i <= 11; i++) {
      fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (32, 'b${i}', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z')`);
    }

    const run = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(run.status).toBe(200);
    expect(((await run.json()) as { milestonesGranted: number }).milestonesGranted).toBe(3); // 甲 5；乙 5、10

    const granted = sqlAll<{ player_id: number; match_ref: string; xp: number }>(
      fx.sqlite,
      "SELECT player_id, match_ref, xp FROM growth_events WHERE event_type = 'milestone' ORDER BY player_id, id",
    );
    expect(granted.map((g) => `${g.player_id}:${g.match_ref}`)).toEqual([
      '31:milestone:0:0:5',
      '32:milestone:0:0:5',
      '32:milestone:0:0:10',
    ]);
    expect(granted.map((g) => g.xp)).toEqual([1, 1, 2]); // 档 5→1 XP；档 10→2 XP
  });

  it('多名球员各自有解约划断时，里程碑锚各按各的划断序号（回归：reset 查询漏 GROUP BY 只剩一行）', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, ca) VALUES
        (34, 'p34', '丁', 1, 'ST', 'normal', 2, 0, 85),
        (35, 'p35', '戊', 2, 'ST', 'normal', 2, 0, 85);
    `);
    // 各自先被解约划断，再在解约之后攒进+攻：丁 6 球、戊 11 球
    fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (34, 'r34', 'reset', 0, 0, 'auto', '2026-07-01T00:00:00Z')`);
    for (let i = 1; i <= 6; i++) {
      fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (34, 'a${i}', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z')`);
    }
    fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (35, 'r35', 'reset', 0, 0, 'auto', '2026-07-01T00:00:00Z')`);
    for (let i = 1; i <= 11; i++) {
      fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (35, 'b${i}', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z')`);
    }
    const resetOf = (playerId: number) =>
      sqlGet<{ id: number }>(fx.sqlite, `SELECT id FROM growth_events WHERE player_id = ${playerId} AND event_type = 'reset'`)?.id ?? 0;

    const run = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(run.status).toBe(200);
    expect(((await run.json()) as { milestonesGranted: number }).milestonesGranted).toBe(3);

    const granted = sqlAll<{ player_id: number; match_ref: string }>(
      fx.sqlite,
      "SELECT player_id, match_ref FROM growth_events WHERE event_type = 'milestone' ORDER BY player_id, id",
    );
    expect(granted.map((g) => `${g.player_id}:${g.match_ref}`)).toEqual([
      `34:milestone:0:${resetOf(34)}:5`,
      `35:milestone:0:${resetOf(35)}:5`,
      `35:milestone:0:${resetOf(35)}:10`,
    ]);

    // 重放：同一划断世代内不再补发
    const again = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(((await again.json()) as { milestonesGranted: number }).milestonesGranted).toBe(0);
  });

  it('管理端手动宣告新成长期：宣告前的事件不再计入，宣告后可再次补发', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, ca) VALUES (33, 'p33', '丙', 1, 'ST', 'normal', 2, 0, 85);
    `);
    for (let i = 1; i <= 6; i++) {
      fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (33, 'c${i}', 'goal', 1, 0, 'auto', '2026-07-01T00:00:00Z')`);
    }

    const run1 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(((await run1.json()) as { growthPeriodId: number; milestonesGranted: number })).toMatchObject({
      growthPeriodId: 0, // 还没宣告过：全生涯口径
      milestonesGranted: 1,
    });

    // 宣告：界取宣告时点的事件序号（此时 growth_events 有 6 条 goal）
    const maxEventId = sqlGet<{ max_id: number }>(fx.sqlite, 'SELECT COALESCE(MAX(id), 0) AS max_id FROM growth_events')?.max_id ?? 0;
    const declared = await post('/api/admin/growth/periods', { note: '半赛季换血期' }, 'tok-admin', fx.env);
    expect(declared.status).toBe(201);
    const d = (await declared.json()) as { id: number; startEventId: number };
    expect(d.id).toBe(1);
    expect(d.startEventId).toBe(maxEventId);
    expect(sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'growth_period_declared'")?.action).toBe('growth_period_declared');

    // 宣告之后没有新事件 → 不再补发；老的那条 milestone 行留着（历史不删）
    const run2 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(((await run2.json()) as { growthPeriodId: number; milestonesGranted: number })).toMatchObject({
      growthPeriodId: 1,
      milestonesGranted: 0,
    });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM growth_events WHERE event_type = 'milestone'")?.n).toBe(1);

    // 新成长期内再攒 10 球 → 档 5、10 重新补发（去重锚带期号，不被老行挡住）
    for (let i = 1; i <= 10; i++) {
      fx.sqlite.exec(`INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source, created_at) VALUES (33, 'd${i}', 'goal', 1, 0, 'auto', '2026-08-01T00:00:00Z')`);
    }
    const run3 = await post('/api/admin/growth/settlement/run', { season: 3 }, 'tok-admin', fx.env);
    expect(((await run3.json()) as { milestonesGranted: number }).milestonesGranted).toBe(2);
    expect(
      sqlAll<{ match_ref: string }>(fx.sqlite, "SELECT match_ref FROM growth_events WHERE event_type = 'milestone' AND player_id = 33 ORDER BY id").map(
        (r) => r.match_ref,
      ),
    ).toEqual(['milestone:0:0:5', 'milestone:1:0:5', 'milestone:1:0:10']);
  });

  it('开窗勾选「同时宣告新成长期」：同批宣告；不勾选不宣告', async () => {
    const fx = freshEnv();
    seedPlatform(fx);

    const noFlag = await post('/api/admin/windows/open', { season: 3, windowSeq: 1 }, 'tok-admin', fx.env);
    expect(((await noFlag.json()) as { growthPeriodDeclared: boolean }).growthPeriodDeclared).toBe(false);

    await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    const flagged = await post('/api/admin/windows/open', { season: 3, windowSeq: 2, declareGrowthPeriod: true }, 'tok-admin', fx.env);
    expect(flagged.status).toBe(201);
    expect(((await flagged.json()) as { growthPeriodDeclared: boolean }).growthPeriodDeclared).toBe(true);

    const list = await get('/api/admin/growth/periods', 'tok-admin', fx.env);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      current: { id: number; season: number | null; source: string; note: string | null; declaredAt: string | null } | null;
      periods: { id: number }[];
    };
    expect(body.periods.length).toBe(1);
    expect(body.current).toMatchObject({ id: 1, season: 3, source: 'window_open' });
    expect(body.current?.note).toContain('第 2 窗');
    expect(body.current?.declaredAt).toBeTruthy();

    // 开窗审计里带上是否宣告（成长期本身不改窗口状态）
    const audit = sqlGet<{ after: string }>(
      fx.sqlite,
      "SELECT after FROM audit_log WHERE action = 'window_open' ORDER BY id DESC LIMIT 1",
    );
    expect(audit?.after).toContain('"growthPeriodDeclared":true');

    const coach = await post('/api/admin/growth/periods', {}, 'tok-coach', fx.env);
    expect(coach.status).toBe(403);
  });
});
