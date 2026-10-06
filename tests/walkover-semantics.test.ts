// 弃权语义（2026-10-06 订正）：walkover_side 记的是**弃权方（判负方）**，不是取胜方。
// 权威口径 = 比赛系统 tour 仓 migrations/0013_walkover.sql 列注释 + 生产 note 文案双向核对：
//   '' = 普通场；'home' = 主队弃权（客队胜）；'away' = 客队弃权（主队胜）；'both' = 双弃权（双方各记一负）。
// 本文件钉住订正后的四类行为：
//   ① 钱：弃权场只发胜方（弃权方一分不发，连败方出场补贴也没有）；双弃权双方都不发；
//   ② 比赛日收入：弃权场不落（上座/三分收入/死忠演化整块早退）；
//   ③ 战绩：近 3 场 Pts / 最近一场记号 / 品牌热度 / 窗内胜率 全部按弃权方判负；
//   ④ 积分表：弃权按 3:0 判负给对侧；双弃权不计。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { isWalkover, walkoverLoser, walkoverWinnerSide } from '../src/core/walkover.ts';
import { matchPrizeStatements, type MatchPrizeInput } from '../src/worker/prizes.ts';
import { formPtsOf, matchAttendanceStatements } from '../src/worker/home.ts';
import { lastResultOf } from '../src/worker/event-ops.ts';
import { brandHeatDelta, windowWinRate, type HeatRules } from '../src/worker/naming-ops.ts';
import { leagueStandings } from '../src/worker/season-settle.ts';

const RULES: HeatRules = { winStreak: 0.03, slump: 0.02, clampLow: 0.5, clampHigh: 1.5, champion: 0.1, deal: 0.02, ignored: -0.03 };

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

/** 两支俱乐部 + AUTH_DB 目录映射（tour 11 → club 1 主队、tour 12 → club 2 客队），余额各 10。 */
function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const { sqlite: auth, d1: authD1 } = createAuthDb();
  auth.exec(
    `INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES
       (1, 11, 1, '队11', '2026-01-01T00:00:00Z'),
       (2, 12, 2, '队12', '2026-01-01T00:00:00Z');`,
  );
  sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES
       (1, '主队俱乐部', 'premier', 'active', 0),
       (2, '客队俱乐部', 'premier', 'active', 0);
     INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (1, 10, '2026-01-01T00:00:00Z'),
       (2, 10, '2026-01-01T00:00:00Z');
     INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit,
                           next_attendance_mod, next_weather, created_at, updated_at)
       VALUES (1, '主队球场', 20000, 0, 0, 0, 1800, 0, 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');`,
  );
  const env = {
    DB: createTestD1(sqlite),
    AUTH_DB: authD1,
    rng: () => 0.5,
    PUBLIC_CACHE_TTL_MS: '0',
  } as unknown as Env;
  return { env, sqlite };
}

/** 单场奖金输入（默认联赛主队 3:0 胜；弃权场把比分置 null、walkoverSide 设成弃权方） */
function prizeInput(over: Partial<MatchPrizeInput> = {}): MatchPrizeInput {
  return {
    matchId: 101,
    season: 9,
    competitionType: 'league_premier',
    stageKind: 'league',
    round: 1,
    homeTeamId: 11,
    awayTeamId: 12,
    scoreHome: 3,
    scoreAway: 0,
    penHome: null,
    penAway: null,
    walkoverSide: '',
    winnerTeamId: null,
    stageEntryCount: null,
    ...over,
  };
}

/** 跑奖金语句并回读落库流水（club_id + 金额 + 侧别），按 id 升序 */
async function runPrizes(fx: Fixture, m: MatchPrizeInput): Promise<{ clubId: number; amount: number; refType: string }[]> {
  const statements = await matchPrizeStatements(fx.env, m);
  if (statements.length > 0) await fx.env.DB.batch(statements);
  return fx.sqlite
    .prepare('SELECT club_id AS clubId, amount, ref_type AS refType FROM ledger_entries ORDER BY id')
    .all() as { clubId: number; amount: number; refType: string }[];
}

describe('弃权语义纯函数（core/walkover.ts）', () => {
  it('isWalkover：空串 / null / 脏值都不算弃权场，home/away/both 算', () => {
    expect([isWalkover('home'), isWalkover('away'), isWalkover('both')]).toEqual([true, true, true]);
    expect([isWalkover(''), isWalkover(null), isWalkover(undefined), isWalkover('draw')]).toEqual([false, false, false, false]);
  });

  it('walkoverWinnerSide：胜者是弃权方的对面；双弃权/非弃权 → null', () => {
    expect(walkoverWinnerSide('home')).toBe('away'); // 主队弃权 ⇒ 客队胜
    expect(walkoverWinnerSide('away')).toBe('home');
    expect(walkoverWinnerSide('both')).toBeNull();
    expect(walkoverWinnerSide('')).toBeNull();
    expect(walkoverWinnerSide(null)).toBeNull();
  });

  it('walkoverLoser：单方弃权只有弃权方判负；双弃权双方都判负；普通场恒 false', () => {
    expect(walkoverLoser('home', 'home')).toBe(true);
    expect(walkoverLoser('home', 'away')).toBe(false);
    expect(walkoverLoser('away', 'away')).toBe(true);
    expect(walkoverLoser('away', 'home')).toBe(false);
    expect([walkoverLoser('both', 'home'), walkoverLoser('both', 'away')]).toEqual([true, true]);
    expect([walkoverLoser('', 'home'), walkoverLoser(null, 'away')]).toEqual([false, false]);
  });
});

describe('弃权场奖金：胜方照发，弃权方一分不发（用户裁决 2026-10-06）', () => {
  it('普通联赛场回归：胜方 8.5 + 败方出场补贴 4.7', async () => {
    const fx = freshEnv();
    expect(await runPrizes(fx, prizeInput())).toEqual([
      { clubId: 1, amount: 8.5, refType: 'match_home' },
      { clubId: 2, amount: 4.7, refType: 'match_away' },
    ]);
  });

  it('主队弃权（walkover_side=home）⇒ 客队拿胜场奖金，主队零流水', async () => {
    const fx = freshEnv();
    const rows = await runPrizes(fx, prizeInput({ walkoverSide: 'home', scoreHome: null, scoreAway: null, winnerTeamId: 12 }));
    expect(rows).toEqual([{ clubId: 2, amount: 8.5, refType: 'match_away' }]);
  });

  it('客队弃权（walkover_side=away）⇒ 主队拿胜场奖金，客队零流水', async () => {
    const fx = freshEnv();
    const rows = await runPrizes(fx, prizeInput({ walkoverSide: 'away', scoreHome: null, scoreAway: null, winnerTeamId: 11 }));
    expect(rows).toEqual([{ clubId: 1, amount: 8.5, refType: 'match_home' }]);
  });

  it('双弃权（both）⇒ 双方都不发（连出场补贴也没有）', async () => {
    const fx = freshEnv();
    expect(await runPrizes(fx, prizeInput({ walkoverSide: 'both', scoreHome: null, scoreAway: null }))).toEqual([]);
  });

  it('超级杯弃权：胜方 4.0，弃权方 0（原实现给弃权方发 2.0 出场补贴）', async () => {
    const fx = freshEnv();
    const rows = await runPrizes(fx, prizeInput({ competitionType: 'super_cup', walkoverSide: 'away', scoreHome: null, scoreAway: null }));
    expect(rows).toEqual([{ clubId: 1, amount: 4.0, refType: 'match_home' }]);
  });

  it('冠军杯小组弃权：胜方 7.0（该档本无败方项，弃权方同样零流水）', async () => {
    const fx = freshEnv();
    const rows = await runPrizes(
      fx,
      prizeInput({ competitionType: 'champions_cup', stageKind: 'group', walkoverSide: 'home', scoreHome: null, scoreAway: null }),
    );
    expect(rows).toEqual([{ clubId: 2, amount: 7.0, refType: 'match_away' }]);
  });

  it('幂等：同一场同侧重放不双发（弃权场也只发一次）', async () => {
    const fx = freshEnv();
    await runPrizes(fx, prizeInput({ walkoverSide: 'away', scoreHome: null, scoreAway: null }));
    const again = await runPrizes(fx, prizeInput({ walkoverSide: 'away', scoreHome: null, scoreAway: null }));
    expect(again).toEqual([{ clubId: 1, amount: 8.5, refType: 'match_home' }]);
  });
});

describe('弃权场不发比赛日收入（home.ts matchAttendanceStatements 早退）', () => {
  it('普通场照发：detail 有值 + 落 match_attendance 与 revenue 流水', async () => {
    const fx = freshEnv();
    const { statements, detail } = await matchAttendanceStatements(fx.env, {
      matchId: 101,
      season: 9,
      windowSeq: 1,
      homeTeamId: 11,
      awayTeamId: 12,
      walkoverSide: '',
    });
    expect(detail).not.toBeNull();
    await fx.env.DB.batch(statements);
    const att = fx.sqlite.prepare('SELECT COUNT(*) AS n FROM match_attendance WHERE match_id = 101').get() as { n: number };
    const rev = fx.sqlite.prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'revenue' AND ref_type = 'match'`).get() as { n: number };
    expect(att.n).toBe(1);
    expect(rev.n).toBe(1);
  });

  it('弃权场（home/away/both）全部早退：detail=null、零语句、不落上座与收入', async () => {
    const fx = freshEnv();
    for (const side of ['home', 'away', 'both']) {
      const { statements, detail } = await matchAttendanceStatements(fx.env, {
        matchId: 101,
        season: 9,
        windowSeq: 1,
        homeTeamId: 11,
        awayTeamId: 12,
        walkoverSide: side,
      });
      expect(detail, `walkoverSide=${side}`).toBeNull();
      expect(statements, `walkoverSide=${side}`).toHaveLength(0);
    }
    const att = fx.sqlite.prepare('SELECT COUNT(*) AS n FROM match_attendance').get() as { n: number };
    const rev = fx.sqlite.prepare(`SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'revenue'`).get() as { n: number };
    expect([att.n, rev.n]).toEqual([0, 0]);
  });
});

describe('弃权判负的战绩口径（近 3 场 Pts / 最近一场 / 品牌热度 / 窗内胜率）', () => {
  const formRow = (over: Record<string, unknown>) => ({
    home_team_id: 11,
    away_team_id: 12,
    score_home: null,
    score_away: null,
    pen_home: null,
    pen_away: null,
    walkover_side: null,
    ...over,
  });

  it('formPtsOf：主队弃权记 0 分、客队记 3 分（三场名额内）', () => {
    // 主队视角：弃权负 0 + 胜 3 + 平 1 = 4
    expect(
      formPtsOf([formRow({ walkover_side: 'home' }), formRow({ score_home: 2, score_away: 1 }), formRow({ score_home: 1, score_away: 1 })], 11),
    ).toBe(4);
    // 客队视角：弃权胜 3 + 负 0 + 平 1 = 4
    expect(
      formPtsOf([formRow({ walkover_side: 'home' }), formRow({ score_home: 2, score_away: 1 }), formRow({ score_home: 1, score_away: 1 })], 12),
    ).toBe(4);
    // 客队弃权 ⇒ 主队三战全胜 = 9
    expect(formPtsOf([formRow({ walkover_side: 'away' }), formRow({ score_home: 2, score_away: 1 }), formRow({ score_home: 3, score_away: 0 })], 11)).toBe(9);
    // 双弃权双方各记一负
    expect(formPtsOf([formRow({ walkover_side: 'both' }), formRow({ score_home: 2, score_away: 1 }), formRow({ score_home: 1, score_away: 1 })], 11)).toBe(4);
  });

  it('lastResultOf：walkover_side=home ⇒ 主队 L、客队 W；双弃权双方 L', () => {
    const wo = (side: string) => [{ home_team_id: 11, away_team_id: 12, score_home: null, score_away: null, pen_home: null, pen_away: null, walkover_side: side }];
    expect(lastResultOf(wo('home'), 11)).toBe('L');
    expect(lastResultOf(wo('home'), 12)).toBe('W');
    expect(lastResultOf(wo('away'), 11)).toBe('W');
    expect(lastResultOf(wo('away'), 12)).toBe('L');
    expect(lastResultOf(wo('both'), 11)).toBe('L');
    expect(lastResultOf(wo('both'), 12)).toBe('L');
  });

  it('brandHeatDelta / windowWinRate：弃权方判负（原实现当取胜方读）', () => {
    const r = (side: string) => ({ home_team_id: 11, away_team_id: 12, score_home: null, score_away: null, walkover_side: side });
    // 主队（11）三场弃权 ⇒ 三连败 −slump
    expect(brandHeatDelta([r('home'), r('home'), r('home')], 11, RULES)).toBe(-0.02);
    // 客队弃权 ⇒ 11 三连胜 +winStreak
    expect(brandHeatDelta([r('away'), r('away'), r('away')], 11, RULES)).toBe(0.03);
    // 一弃权负 + 两胜 ⇒ 非全胜非全败，不动
    expect(brandHeatDelta([r('home'), r('away'), r('away')], 11, RULES)).toBeNull();
    // 双弃权 ⇒ 11 判负
    expect(brandHeatDelta([r('both'), r('both'), r('both')], 11, RULES)).toBe(-0.02);
    // 窗内胜率：一弃权负 + 一胜 = 0.5；两胜 = 1；双弃权负 + 一胜 = 0.5
    expect(windowWinRate([r('home'), r('away')], 11)).toBe(0.5);
    expect(windowWinRate([r('away'), r('away')], 11)).toBe(1);
    expect(windowWinRate([r('both'), r('away')], 11)).toBe(0.5);
  });

  it('leagueStandings：弃权按 3:0 判负给对侧；双弃权不计', () => {
    const row = (over: Record<string, unknown>) => ({
      stage_kind: 'league',
      home_team_id: 11,
      away_team_id: 12,
      score_home: null,
      score_away: null,
      pen_home: null,
      pen_away: null,
      walkover_side: null,
      winner_team: null,
      ...over,
    });
    const table = new Map(leagueStandings([row({ walkover_side: 'home' })]).map((r) => [r.teamId, r]));
    expect(table.get(12)).toMatchObject({ pts: 3, gd: 3 }); // 客队胜
    expect(table.get(11)).toMatchObject({ pts: 0, gd: -3 }); // 主队弃权负
    const table2 = new Map(leagueStandings([row({ walkover_side: 'away' })]).map((r) => [r.teamId, r]));
    expect(table2.get(11)).toMatchObject({ pts: 3, gd: 3 });
    expect(table2.get(12)).toMatchObject({ pts: 0, gd: -3 });
    const table3 = new Map(leagueStandings([row({ walkover_side: 'both' })]).map((r) => [r.teamId, r]));
    expect(table3.get(11)).toMatchObject({ pts: 0, gd: 0 });
    expect(table3.get(12)).toMatchObject({ pts: 0, gd: 0 });
  });
});
