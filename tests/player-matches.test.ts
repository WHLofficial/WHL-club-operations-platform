// 球员页「比赛」页签（v6.46.0）：聚合口径（src/core/player-matches.ts 纯函数）+
// 只读端点 GET /api/players/:id/matches（src/worker/player-matches.ts 取数）。
//
// 钉住的口径（改这些行为必须同步改设计文件 memory/design-player-matches-tab.md）：
//   1) 出场 = 四源并集（成长记录 / 赛事事件 / 赛前真实首发 11 人 / 缺阵不计出场）；
//   2) 只统计已确认且非弃权的场次——弃权场与未确认场次整场丢弃（连成长记录也不认）；
//   3) 黄牌排除同场两黄变一红的那张；红牌含 red 与 red_2y；乌龙不计个人进球；伤退按场计 1；
//   4) 均分 = 该赛事已录评分的平均，两位小数；合计行按全部评分场次加权（先累加原始和再除）；
//   5) 门将零封/失球取比分，扑救取成长库 saves（没有记录的场次按 0）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { aggregatePlayerMatches, type PlayerMatchesInput } from '../src/core/player-matches.ts';

/* ---------- 一、纯聚合 ---------- */

type Confirm = PlayerMatchesInput['confirmations'][number];

let seq = 0;
function confirm(over: Partial<Confirm> & { matchId: number }): Confirm {
  seq += 1;
  return {
    season: 9,
    competitionType: 'league_premier',
    tournamentId: 5,
    stageName: '常规赛',
    round: seq,
    homeTeam: '海港联',
    awayTeam: '北岸城',
    scoreHome: 2,
    scoreAway: 1,
    walkoverSide: '',
    finishedAt: `2026-09-${String(10 + (seq % 18)).padStart(2, '0')} 21:00:00`,
    ...over,
  };
}

function input(over: Partial<PlayerMatchesInput> = {}): PlayerMatchesInput {
  return {
    position: 'ST',
    growth: [],
    confirmations: [],
    tourEvents: [],
    lineups: [],
    missed: [],
    teamNameById: new Map([[501, '海港联'], [502, '北岸城']]),
    tournamentNameById: new Map([[5, '第九赛季联赛'], [7, '第九赛季冠军杯']]),
    ...over,
  };
}

describe('TC-PM 比赛页签聚合口径', () => {
  it('TC-PM-01 四源并集算出场；赛事/赛季/合计三级汇总与加权均分', () => {
    const confs = [
      confirm({ matchId: 1001, round: 1, finishedAt: '2026-09-11 21:00:00' }), // 成长源 + 赛事事件
      confirm({ matchId: 1002, round: 2, competitionType: 'champions_cup', tournamentId: 7, finishedAt: '2026-09-12 21:00:00' }), // 首发源
      confirm({ matchId: 1003, round: 3, competitionType: 'champions_cup', tournamentId: 7, finishedAt: '2026-09-20 21:00:00' }), // 助攻源 + 成长评分
      confirm({ matchId: 900, season: 8, competitionType: 'league_second', tournamentId: 6, round: 1, stageName: '常规赛', finishedAt: '2026-08-30 21:00:00' }),
    ];
    const res = aggregatePlayerMatches(
      input({
        growth: [
          { matchRef: '1001', eventType: 'rating', value: 7.5 },
          { matchRef: '1001', eventType: 'appearance', value: 1 },
          { matchRef: '1003', eventType: 'rating', value: 6.8 }, // 另一赛事的评分
          { matchRef: '900', eventType: 'rating', value: 6 }, // v6.46.0：差评照录，均分才真实
        ],
        confirmations: confs,
        tourEvents: [
          { matchId: 1001, type: 'goal', minute: 23, own: true, entryTeamId: 501 },
          { matchId: 1003, type: 'goal', minute: 67, own: false, entryTeamId: 502 }, // 我给别人的助攻
        ],
        lineups: [{ matchId: 1002, teamId: 501 }],
      }),
    );

    // 赛季倒序：S9 在前、S8 在后
    expect(res.seasons.map((s) => s.season)).toEqual([9, 8]);
    const s9 = res.seasons[0];
    // 赛事序固定：顶级联赛 → 冠军杯
    expect(s9.comps.map((c) => c.competitionType)).toEqual(['league_premier', 'champions_cup']);
    expect(s9.comps.map((c) => c.competitionName)).toEqual(['顶级联赛', '冠军杯']);
    expect(s9.comps.map((c) => c.appearances)).toEqual([1, 2]);
    expect(s9.comps[0].goals).toBe(1);
    expect(s9.comps[0].ratingCount).toBe(1);
    expect(s9.comps[0].avgRating).toBe(7.5);
    expect(s9.comps[1].assists).toBe(1);
    expect(s9.comps[1].avgRating).toBe(6.8);
    expect(s9.comps[1].tournamentName).toBe('第九赛季冠军杯');
    // 合计 = 三个赛事的加总；均分按全部评分场次加权（7.5 与 6.8 → 7.15，不是两个均分的平均）
    expect(s9.total.competitionName).toBe('合计');
    expect(s9.total.appearances).toBe(3);
    expect(s9.total.avgRating).toBe(7.15);
    expect(s9.total.ratingCount).toBe(2);
    expect(res.seasons[1].comps[0].competitionName).toBe('次级联赛');
    expect(res.seasons[1].total.avgRating).toBe(6);

    // 逐场流水：日期倒序（1003 的 09-20 最晚），出场来源可查
    expect(res.matches.map((m) => m.matchId)).toEqual([1003, 1002, 1001, 900]);
    expect(res.matches.map((m) => m.appeared)).toEqual([true, true, true, true]);
    expect(res.matches.map((m) => m.sources)).toEqual([['growth', 'event'], ['lineup'], ['growth', 'event'], ['growth']]);
    // 助攻事件串用「助攻」文案（own=false），本人进球用「进球 23′」
    expect(res.matches[0].events).toEqual(['助攻 67′']);
    expect(res.matches[2].events).toEqual(['进球 23′']);
    // 对手与主客（队号 501 = 海港联 = 主队）
    expect(res.matches[2].side).toBe('home');
    expect(res.matches[2].opponent).toBe('北岸城');
    expect(res.matches[0].side).toBe('away'); // entryTeamId 502 → 客队
    expect(res.matches[0].opponent).toBe('海港联');
  });

  it('TC-PM-02 黄牌排除同场两黄变一红的那张；红牌含 red/red_2y；乌龙不计进球；伤退按场计 1', () => {
    const res = aggregatePlayerMatches(
      input({
        confirmations: [confirm({ matchId: 1010, scoreHome: 1, scoreAway: 1 })],
        tourEvents: [
          { matchId: 1010, type: 'yellow', minute: 30, own: true, entryTeamId: 501 },
          { matchId: 1010, type: 'red_2y', minute: 80, own: true, entryTeamId: 501 },
          { matchId: 1010, type: 'injury_minor', minute: 55, own: true, entryTeamId: 501 },
          { matchId: 1010, type: 'injury_major', minute: 88, own: true, entryTeamId: 501 },
          { matchId: 1010, type: 'own_goal', minute: 70, own: true, entryTeamId: 501 },
        ],
      }),
    );
    const c = res.seasons[0].comps[0];
    expect(c.yellow).toBe(0); // 同场有 red_2y → 那张黄牌（30′）不计
    expect(c.red).toBe(1);
    expect(c.injuryOut).toBe(1); // 同一场的两条伤病事件只算 1 次伤退
    expect(c.ownGoal).toBe(1);
    expect(c.goals).toBe(0); // 乌龙不计个人进球
    // 流水仍照实列出场上发生的事（计数口径与事件串是两件事）
    expect(res.matches[0].events).toEqual(['黄牌 30′', '伤退 55′', '乌龙 70′', '红牌（两黄） 80′', '伤退 88′']);
  });

  it('TC-PM-03 自己吃红牌（非两黄）时黄牌照计；只有 red 也算红牌', () => {
    const res = aggregatePlayerMatches(
      input({
        confirmations: [confirm({ matchId: 1011 }), confirm({ matchId: 1012 })],
        tourEvents: [
          { matchId: 1011, type: 'yellow', minute: 20, own: true, entryTeamId: 501 },
          { matchId: 1011, type: 'red', minute: 60, own: true, entryTeamId: 501 },
          { matchId: 1012, type: 'red_2y', minute: 90, own: true, entryTeamId: 501 },
        ],
      }),
    );
    const c = res.seasons[0].comps[0];
    expect(c.yellow).toBe(1);
    expect(c.red).toBe(2);
  });

  it('TC-PM-04 弃权场与未确认场次整场丢弃（成长记录也不认）', () => {
    const res = aggregatePlayerMatches(
      input({
        growth: [
          { matchRef: '1020', eventType: 'appearance', value: 1 },
          { matchRef: '1021', eventType: 'rating', value: 8 },
        ],
        confirmations: [
          confirm({ matchId: 1020, walkoverSide: 'away' }), // 弃权场
          // 1021 没有确认行
          confirm({ matchId: 1022 }),
        ],
        tourEvents: [{ matchId: 1022, type: 'yellow', minute: 12, own: true, entryTeamId: 501 }],
      }),
    );
    expect(res.matches.map((m) => m.matchId)).toEqual([1022]);
    expect(res.seasons[0].total.appearances).toBe(1);
    expect(res.seasons[0].total.ratingCount).toBe(0);
  });

  it('TC-PM-05 缺阵不计出场；同场既有缺阵又有记录时按并集（出场优先）', () => {
    const res = aggregatePlayerMatches(
      input({
        confirmations: [confirm({ matchId: 1030 }), confirm({ matchId: 1031 })],
        missed: [1030, 1031],
        growth: [{ matchRef: '1031', eventType: 'appearance', value: 1 }],
      }),
    );
    const byId = new Map(res.matches.map((m) => [m.matchId, m]));
    expect(byId.get(1030)!.missed).toBe(true);
    expect(byId.get(1030)!.appeared).toBe(false);
    expect(byId.get(1031)!.missed).toBe(true);
    expect(byId.get(1031)!.appeared).toBe(true);
    const c = res.seasons[0].comps[0];
    expect(c.missed).toBe(2);
    expect(c.appearances).toBe(1); // 只有 1031 算出场
  });

  it('TC-PM-06 门将：零封/失球取比分（只算出场场次），扑救取成长库合计', () => {
    const res = aggregatePlayerMatches(
      input({
        position: 'GK',
        // 队名表只装「我的队」（真实取数里 teamNameById 只查 myTeamIds），主客靠队号/队名判
        teamNameById: new Map([[501, '海港联']]),
        confirmations: [
          confirm({ matchId: 1040, homeTeam: '海港联', awayTeam: '北岸城', scoreHome: 2, scoreAway: 0 }),
          confirm({ matchId: 1041, homeTeam: '北岸城', awayTeam: '海港联', scoreHome: 3, scoreAway: 1 }),
        ],
        growth: [
          { matchRef: '1040', eventType: 'appearance', value: 1 },
          { matchRef: '1040', eventType: 'saves', value: 4 },
          { matchRef: '1041', eventType: 'appearance', value: 1 },
          { matchRef: '1041', eventType: 'saves', value: 2 },
        ],
        tourEvents: [{ matchId: 1040, type: 'clean_sheet', minute: null, own: true, entryTeamId: 501 }],
      }),
    );
    const c = res.seasons[0].comps[0];
    expect(c.appearances).toBe(2);
    expect(c.cleanSheets).toBe(1);
    expect(c.conceded).toBe(3); // 1040 失 0 + 1041 失 3
    expect(c.saves).toBe(6);
    const byId = new Map(res.matches.map((m) => [m.matchId, m]));
    expect(byId.get(1040)!.conceded).toBe(0);
    expect(byId.get(1040)!.cleanSheet).toBe(true);
    expect(byId.get(1040)!.events[0]).toBe('零封');
    expect(byId.get(1040)!.events.at(-1)).toBe('扑救 4');
    expect(byId.get(1041)!.conceded).toBe(3);
    expect(byId.get(1041)!.cleanSheet).toBe(false);
    expect(byId.get(1041)!.events[0]).toBe('失球 3');
  });

  it('TC-PM-07 队号判不出主客时先用队名集合兜底；两边都认不出则不记失球', () => {
    const named = aggregatePlayerMatches(
      input({
        position: 'GK',
        teamNameById: new Map([[501, '海港联']]),
        confirmations: [confirm({ matchId: 1050, homeTeam: '海港联', awayTeam: '北岸城', scoreHome: 0, scoreAway: 1 })],
        growth: [{ matchRef: '1050', eventType: 'appearance', value: 1 }],
        // 没有事件与首发 ⇒ teamId 为 null，只能靠队名集合判
      }),
    );
    expect(named.matches[0].side).toBe('home');
    expect(named.matches[0].conceded).toBe(1);
    expect(named.matches[0].events[0]).toBe('失球 1');

    const unknown = aggregatePlayerMatches(
      input({
        teamNameById: new Map(),
        confirmations: [confirm({ matchId: 1051, homeTeam: '甲队', awayTeam: '乙队' })],
        growth: [{ matchRef: '1051', eventType: 'appearance', value: 1 }],
      }),
    );
    expect(unknown.matches[0].side).toBeNull();
    expect(unknown.matches[0].opponent).toBeNull();
    expect(unknown.matches[0].conceded).toBeNull();
    expect(unknown.matches[0].cleanSheet).toBe(false);
    expect(unknown.seasons[0].comps[0].conceded).toBe(0); // 判不出就不累加
  });

  it('TC-PM-08 同赛事不同 tournamentId 分两行；未知赛事类型排最后', () => {
    const res = aggregatePlayerMatches(
      input({
        confirmations: [
          confirm({ matchId: 1060, competitionType: 'qualifying', tournamentId: 9 }),
          confirm({ matchId: 1061, competitionType: 'friendly', tournamentId: 10 }),
          confirm({ matchId: 1062, competitionType: 'league_premier', tournamentId: 5 }),
        ],
        growth: [
          { matchRef: '1060', eventType: 'appearance', value: 1 },
          { matchRef: '1061', eventType: 'appearance', value: 1 },
          { matchRef: '1062', eventType: 'appearance', value: 1 },
        ],
      }),
    );
    expect(res.seasons[0].comps.map((c) => c.competitionType)).toEqual(['league_premier', 'qualifying', 'friendly']);
    expect(res.seasons[0].comps[2].competitionName).toBe('friendly'); // 未收录的类别原样回显
    expect(res.seasons[0].total.appearances).toBe(3);
  });
});

/* ---------- 二、端点取数 ---------- */

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
}

// 赛事库裁剪：比赛事件 / 首发提交 / 伤病停赛 / 队名 / 赛事名
const TOUR_SCHEMA = `
  CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
  CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER, seed INTEGER);
  CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE player (id INTEGER PRIMARY KEY, team_id INTEGER, name TEXT, number INTEGER);
  CREATE TABLE match (
    id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER, slot INTEGER, leg INTEGER DEFAULT 1,
    home_entry_id INTEGER, away_entry_id INTEGER, status TEXT DEFAULT 'finished', walkover_side TEXT DEFAULT ''
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
  tour.exec(TOUR_SCHEMA);
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
  return { env, sqlite, tour, auth };
}

function seedPlatform(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '海港联', 'premier', 'active');
    INSERT INTO players (id, uid, name, display_name, club_id, position, status, growth_xp, ca, fc_id) VALUES
      (10, 'p10', 'K. Lin', '林岸', 1, 'GK', 'normal', 0, 70, 101),
      (11, 'p11', 'L. Li', NULL, 1, 'ST', 'normal', 0, 70, NULL);
  `);
  fx.auth.exec(`INSERT INTO team (id, club_id, tour_team_id) VALUES (1, 1, 501);`);
  fx.tour.exec(`
    INSERT INTO tournament (id, name, status) VALUES (5, '第九赛季联赛', 'running');
    INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (1, 5, 501, 1), (2, 5, 502, 2);
    INSERT INTO team (id, name) VALUES (501, '海港联'), (502, '北岸城');
    INSERT INTO player (id, team_id, name, number) VALUES (101, 501, '林岸', 1);
  `);
}

function seedConfirm(
  fx: Fixture,
  matchId: number,
  over: { competitionType?: string; walkoverSide?: string; season?: number; round?: number; homeTeam?: string; awayTeam?: string; scoreHome?: number; scoreAway?: number; finishedAt?: string; tournamentId?: number } = {},
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO result_confirmations
         (season, window_seq, tournament_id, match_id, competition_type, stage_name, stage_kind, round,
          home_team_id, away_team_id, home_team, away_team, score_home, score_away, walkover_side,
          finished_at, confirmed_by, confirmed_at)
       VALUES (?, 2, ?, ?, ?, '常规赛', 'league', ?, 501, 502, ?, ?, ?, ?, ?, ?, 1, '2026-09-21T10:00:00Z')`,
    )
    .run(
      over.season ?? 9,
      over.tournamentId ?? 5,
      matchId,
      over.competitionType ?? 'league_premier',
      over.round ?? 1,
      over.homeTeam ?? '海港联',
      over.awayTeam ?? '北岸城',
      over.scoreHome ?? 2,
      over.scoreAway ?? 1,
      over.walkoverSide ?? '',
      over.finishedAt ?? '2026-09-20 21:00:00',
    );
}

function seedGrowth(fx: Fixture, playerId: number, matchRef: string, eventType: string, value: number, xp = 0): void {
  fx.sqlite
    .prepare(
      `INSERT INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
       VALUES (?, ?, 9, 2, ?, ?, ?, 'manual', 1, '2026-09-21T10:00:00Z')`,
    )
    .run(playerId, matchRef, eventType, value, xp);
}

function seedTourMatch(fx: Fixture, matchId: number): void {
  fx.tour
    .prepare(
      `INSERT INTO match (id, stage_id, round, slot, leg, home_entry_id, away_entry_id, status, walkover_side)
       VALUES (?, 1, ?, 1, 1, 1, 2, 'finished', '')`,
    )
    .run(matchId, matchId);
}

/** 11 人首发（player_id 101..111 → 本任务只用 101）+ 3 名替补 */
function slotsWithStarter(starterId: number): string {
  const starters = Array.from({ length: 11 }, (_, i) => ({ lid: i + 1, position: 'CM', player_id: 100 + i + 1 }));
  starters[0] = { lid: 1, position: 'GK', player_id: starterId } as never;
  return JSON.stringify([...starters, { kind: 'bench', player_id: 200 }, { kind: 'bench', player_id: 201 }, { kind: 'bench', player_id: 202 }]);
}

function get(path: string, env: Env) {
  return app.request(path, { method: 'GET' }, env);
}

describe('TC-PME GET /api/players/:id/matches', () => {
  it('TC-PME-01 四源并集：成长 / 赛事事件 / 首发 / 缺阵各一场，逐场标记来源', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    // ① 成长源：出场 + 评分
    seedGrowth(fx, 10, '1001', 'appearance', 1);
    seedGrowth(fx, 10, '1001', 'rating', 5.5);
    seedConfirm(fx, 1001);
    // ② 赛事事件源：本人进球
    seedTourMatch(fx, 1002);
    fx.tour.prepare('INSERT INTO match_event (match_id, entry_id, player_id, assist_player_id, type, minute) VALUES (1002, 1, 101, NULL, ?, 30)').run('goal');
    seedConfirm(fx, 1002, { round: 2, scoreHome: 1, scoreAway: 1, finishedAt: '2026-09-22 21:00:00' });
    // ③ 首发源：链式沿用之外的真实提交（含该球员在 11 人里）
    seedTourMatch(fx, 1003);
    fx.tour
      .prepare('INSERT INTO tactic_submission (match_id, team_id, created_by, tactic_id, slots_json, created_at) VALUES (1003, 501, 1, 1, ?, ?)')
      .run(slotsWithStarter(101), '2026-09-23T12:00:00Z');
    seedConfirm(fx, 1003, { round: 3, finishedAt: '2026-09-23 21:00:00' });
    // ④ 缺阵源
    seedTourMatch(fx, 1004);
    fx.tour
      .prepare('INSERT INTO injury (id, team_id, player_id, event_id, injury_name) VALUES (1, 501, 101, 9, ?)')
      .run('拉伤');
    fx.tour.exec('INSERT INTO injury_miss (id, injury_id, match_id) VALUES (1, 1, 1004);');
    seedConfirm(fx, 1004, { round: 4, finishedAt: '2026-09-24 21:00:00' });

    const res = await get('/api/players/101/matches', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      player: { id: number; name: string; position: string | null };
      seasons: { season: number; comps: { appearances: number; ratingCount: number; avgRating: number | null; missed: number }[]; total: { appearances: number; avgRating: number | null } }[];
      matches: { matchId: number; appeared: boolean; missed: boolean; sources: string[]; rating: number | null; events: string[]; cleanSheet: boolean; conceded: number | null }[];
    };
    expect(body.player).toEqual({ id: 10, name: '林岸', position: 'GK' });
    expect(body.matches.map((m) => m.matchId)).toEqual([1004, 1003, 1002, 1001]); // 时间倒序
    const byId = new Map(body.matches.map((m) => [m.matchId, m]));
    expect(byId.get(1001)!.sources).toEqual(['growth']);
    expect(byId.get(1001)!.rating).toBe(5.5); // 差评照录（v6.46.0）
    expect(byId.get(1002)!.sources).toEqual(['event']);
    expect(byId.get(1003)!.sources).toEqual(['lineup']);
    expect(byId.get(1004)!.missed).toBe(true);
    expect(byId.get(1004)!.appeared).toBe(false);
    // 门将：三场出场（1001 成长 / 1002 事件 / 1003 首发）
    const total = body.seasons[0].total;
    expect(total.appearances).toBe(3);
    expect(body.seasons[0].comps[0].missed).toBe(1);
    expect(total.avgRating).toBe(5.5);
    expect(body.seasons[0].comps[0].ratingCount).toBe(1);
  });

  it('TC-PME-02 首发链式沿用不算出场：slots 里没有该球员 / 不是 11 人 / JSON 坏了都不计', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedTourMatch(fx, 1100);
    seedTourMatch(fx, 1101);
    seedTourMatch(fx, 1102);
    // 1100：11 人首发但不含 101（只有 10 人也被判假）+ 1101：只有 10 人 + 1102：JSON 坏了
    fx.tour
      .prepare('INSERT INTO tactic_submission (match_id, team_id, created_by, tactic_id, slots_json, created_at) VALUES (1100, 501, 1, 1, ?, ?)')
      .run(JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ lid: i + 1, position: 'CM', player_id: 300 + i }))), '2026-09-23T12:00:00Z');
    fx.tour
      .prepare('INSERT INTO tactic_submission (match_id, team_id, created_by, tactic_id, slots_json, created_at) VALUES (1101, 501, 1, 1, ?, ?)')
      .run(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ lid: i + 1, position: 'CM', player_id: i === 0 ? 101 : 300 + i }))), '2026-09-23T12:00:00Z');
    fx.tour
      .prepare('INSERT INTO tactic_submission (match_id, team_id, created_by, tactic_id, slots_json, created_at) VALUES (1102, 501, 1, 1, ?, ?)')
      .run('{不是 JSON', '2026-09-23T12:00:00Z');
    for (const id of [1100, 1101, 1102]) seedConfirm(fx, id);

    const res = await get('/api/players/101/matches', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: unknown[] };
    expect(body.matches).toEqual([]); // 三条都不算：没有来源就没有这场
  });

  it('TC-PME-03 弃权场不进汇总（成长记录也一起丢）；未确认场次不进', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedGrowth(fx, 10, '1200', 'appearance', 1);
    seedConfirm(fx, 1200, { walkoverSide: 'away' });
    seedGrowth(fx, 10, '1201', 'appearance', 1); // 没有 result_confirmations 行

    const res = await get('/api/players/101/matches', fx.env);
    const body = (await res.json()) as { matches: unknown[]; seasons: unknown[] };
    expect(body.matches).toEqual([]);
    expect(body.seasons).toEqual([]);
  });

  it('TC-PME-04 :id 收 fc_id 与内部 id 两条路径同结果；未知 id 404；非整数 400', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedGrowth(fx, 10, '1300', 'appearance', 1);
    seedConfirm(fx, 1300, { finishedAt: '2026-09-25 21:00:00' });

    const byFc = await get('/api/players/101/matches', fx.env);
    const byId = await get('/api/players/10/matches', fx.env);
    expect(byFc.status).toBe(200);
    expect(byId.status).toBe(200);
    expect(await byFc.json()).toEqual(await byId.json());

    const missing = await get('/api/players/999999/matches', fx.env);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain('球员不存在');

    const bad = await get('/api/players/abc/matches', fx.env);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('球员 ID 不对');
  });

  it('TC-PME-05 没有 fc_id 时不查赛事库也不炸：只剩成长源，主客靠 club→队号映射的队名兜底', async () => {
    const fx = freshEnv();
    seedPlatform(fx);
    seedGrowth(fx, 11, '1400', 'appearance', 1); // 球员 11 无 fc_id
    seedConfirm(fx, 1400, { finishedAt: '2026-09-26 21:00:00' });

    const res = await get('/api/players/11/matches', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: { side: string | null; opponent: string | null; sources: string[] }[] };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].sources).toEqual(['growth']);
    // 没有 fc_id 拿不到赛事事件/首发，但 club→tour_team_id 映射还在，队名表里有「海港联」就能判主客
    expect(body.matches[0].side).toBe('home');
    expect(body.matches[0].opponent).toBe('北岸城');
  });
});
