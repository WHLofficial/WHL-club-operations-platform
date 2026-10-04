// v6.13.0 C2 冠名深度：档位校准（头部准入下限/锁档/topK）、两信号情绪演化与品牌主动解约、
// 签约档位名额守卫、联赛冠军加成（自算积分表/tiebreak/跳过路径/幂等）、buff 生效点。
// 测试计划：docs/test-plans/v6.13.0-c2.md（TC-TIER / TC-EVO / TC-QUOTA / TC-CHAMP / TC-BUFF / TC-CFG）
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam, sqlGet } from './d1.ts';
import { resetConfigCache, CONFIG_KEYS } from '../src/core/config.ts';
import {
  recalibrateTierStatements, tierQuotaOf, satisfactionDelta, clampSatisfaction, windowWinRate,
  evolveSatisfactionForClub, getActiveNaming, loadTierProfiles, loadSatisfyConfig, loadHeatRules,
} from '../src/worker/naming-ops.ts';
import { signViaOffer } from './market-helpers.ts';
import type { TierProfile, SatisfyConfig } from '../src/worker/naming-ops.ts';
import { championBonusStatements, leagueStandings, settleSeason } from '../src/worker/season-settle.ts';
import { activityIncome } from '../src/worker/venue-ops.ts';
import { evolveFans, loadAttendanceModel } from '../src/worker/home.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  auth: DatabaseSync;
  tour: DatabaseSync;
}

function freshEnv(opts: { auth?: boolean } = {}): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  // checkSeasonSettle 的软警示会查 tour 库的 match/stage（最小两表防 no such table）
  tour.exec(`CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER); CREATE TABLE match (id INTEGER PRIMARY KEY, stage_id INTEGER, status TEXT);`);
  let auth = new DatabaseSync(':memory:');
  const env: Env = { DB: createTestD1(sqlite), TOUR_DB: createTestD1(tour) } as unknown as Env;
  if (opts.auth) {
    const { sqlite: authSqlite, d1 } = createAuthDb();
    auth = authSqlite;
    env.AUTH_DB = d1;
  }
  return { env, sqlite, auth, tour };
}

function seedClub(sqlite: DatabaseSync, clubId = 1) {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (${clubId}, '俱乐部${clubId}', 'premier', 'active');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans) VALUES (${clubId}, '球场${clubId}', 20000, 0, 18000);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (${clubId}, 50, '2026-01-01T00:00:00Z');
  `);
  if (clubId === 1) {
    sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');`);
  }
}

/** 播一条已确认赛果（walkover 传 '' 表普通场，与迁移注释口径一致） */
function seedResult(
  sqlite: DatabaseSync,
  opts: { matchId: number; season?: number; windowSeq?: number; tournamentId?: number; home: number; away: number;
    scoreHome?: number | null; scoreAway?: number | null; penHome?: number | null; penAway?: number | null; walkover?: string },
) {
  sqlite
    .prepare(
      `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team, away_team,
         home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side, winner_team, finished_at)
       VALUES (?, ?, ?, ?, '主', '客', ?, ?, ?, ?, ?, ?, ?, NULL, '2026-01-01T00:00:00Z')`,
    )
    .run(
      opts.season ?? 1,
      opts.windowSeq ?? 1,
      opts.tournamentId ?? 5,
      opts.matchId,
      opts.home,
      opts.away,
      opts.scoreHome ?? null,
      opts.scoreAway ?? null,
      opts.penHome ?? null,
      opts.penAway ?? null,
      opts.walkover ?? '',
    );
}

function seedBinding(sqlite: DatabaseSync, season: number, tournamentId: number, type: string) {
  sqlite.prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')`).run(season, tournamentId, type);
}

/** 纯函数行构造（ConfirmedRow 形状） */
const row = (o: {
  home: number | null; away: number | null; scoreHome?: number | null; scoreAway?: number | null;
  penHome?: number | null; penAway?: number | null; walkover?: string | null;
}) => ({
  stage_kind: null,
  winner_team: null,
  home_team_id: o.home,
  away_team_id: o.away,
  score_home: o.scoreHome ?? null,
  score_away: o.scoreAway ?? null,
  pen_home: o.penHome ?? null,
  pen_away: o.penAway ?? null,
  walkover_side: o.walkover ?? null,
});

const HEAD_PROFILE: TierProfile = { satisfyFloor: 0.7, goodAttend: 0.95, badAttend: 0.6, penaltyMult: 1.5, attendBuff: 0.02, fansBuff: 0 };
const SAT: SatisfyConfig = { attendWeight: 0.5, resultWeight: 0.3, lineBuffer: 0.05, championSatisfaction: 0.1 };
const RULES = { topSeatRatio: 8, emergingSlots: 2, topHeatFloor: 1.0, emergingHeatFloor: 0.9 };

// ─── TC-CFG ──────────────────────────────────────────────────────────────────

describe('config 三新键与 champion 键（TC-CFG）', () => {
  it('注册表 68→78，market_heat_rules 默认带 champion/deal/ignored，三档 profile 出厂值', async () => {
    expect(CONFIG_KEYS).toHaveLength(78);
    const fx = freshEnv();
    expect(await loadHeatRules(fx.env.DB)).toEqual({ winStreak: 0.03, slump: 0.02, clampLow: 0.5, clampHigh: 1.5, champion: 0.1, deal: 0.02, ignored: -0.03 });
    expect(await loadSatisfyConfig(fx.env.DB)).toEqual({ attendWeight: 0.5, resultWeight: 0.3, lineBuffer: 0.05, championSatisfaction: 0.1 });
    const profiles = await loadTierProfiles(fx.env.DB);
    expect(profiles['头部']!.satisfyFloor).toBe(0.7);
    expect(profiles['头部']!.penaltyMult).toBe(1.5);
    expect(profiles['口碑']!.fansBuff).toBe(0.005);
  });
});

// ─── TC-TIER ─────────────────────────────────────────────────────────────────

describe('档位自动校准（recalibrateTierStatements，TC-TIER）', () => {
  it('TC-TIER-01 0054 种子预设档位；出厂状态零变档；降热品牌落到口碑档', async () => {
    const fx = freshEnv();
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM brand_pool WHERE tier = '头部' AND brand IN ('亚马逊','麒麟生物','阿迪达斯')`)?.n).toBe(3);
    // 17 俱乐部 → topK=3：热度前三（亚马逊 1.3 / 麒麟生物 1.2 / 阿迪达斯 1.1）都 ≥1.0，稳居头部
    for (let i = 1; i <= 17; i++) fx.sqlite.exec(`INSERT INTO clubs (id, name, league_tier, status) VALUES (${i}, '队${i}', 'premier', 'active')`);
    expect((await recalibrateTierStatements(fx.env.DB)).changed).toBe(0);
    fx.sqlite.exec(`UPDATE brand_pool SET heat = 0.85 WHERE brand = '海底捞'`); // 新兴 0.9 → 低于新兴地板
    const cal = await recalibrateTierStatements(fx.env.DB);
    expect(cal.changed).toBe(1);
    for (const s of cal.statements) await s.run();
    expect(sqlGet<{ tier: string }>(fx.sqlite, `SELECT tier FROM brand_pool WHERE brand = '海底捞'`)?.tier).toBe('口碑');
  });

  it('TC-TIER-02 头部准入下限：全池 heat<1.0 头部空缺，不注水', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE brand_pool SET heat = heat - 0.5`); // 全池最高 0.8
    const cal = await recalibrateTierStatements(fx.env.DB);
    for (const s of cal.statements) await s.run();
    expect(cal.top).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM brand_pool WHERE tier = '头部'`)?.n).toBe(0);
  });

  it('TC-TIER-03 锁档：tier_locked=1 不参与排名也不变档', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE brand_pool SET tier = '口碑', tier_locked = 1 WHERE brand = '阿迪达斯'`); // 热度 1.3 全池第一
    const cal = await recalibrateTierStatements(fx.env.DB);
    for (const s of cal.statements) await s.run();
    expect(sqlGet<{ tier: string; tier_locked: number }>(fx.sqlite, `SELECT tier, tier_locked FROM brand_pool WHERE brand = '阿迪达斯'`)).toEqual({ tier: '口碑', tier_locked: 1 });
  });

  it('TC-TIER-04 topK = ceil(俱乐部数/8)：8 家时第二名不够格，9 家时够格', async () => {
    // 热度序：亚马逊 1.3 / 麒麟生物 1.2 / 阿迪达斯 1.1。8 俱乐部 → topK=1：麒麟生物（第二名）降为新兴
    const fx8 = freshEnv();
    for (let i = 1; i <= 8; i++) fx8.sqlite.exec(`INSERT INTO clubs (id, name, league_tier, status) VALUES (${i}, '队${i}', 'premier', 'active')`);
    const cal8 = await recalibrateTierStatements(fx8.env.DB);
    for (const s of cal8.statements) await s.run();
    expect(sqlGet<{ tier: string }>(fx8.sqlite, `SELECT tier FROM brand_pool WHERE brand = '麒麟生物'`)?.tier).toBe('新兴');
    // 9 俱乐部 → topK=2：麒麟生物保持头部
    const fx9 = freshEnv();
    for (let i = 1; i <= 9; i++) fx9.sqlite.exec(`INSERT INTO clubs (id, name, league_tier, status) VALUES (${i}, '队${i}', 'premier', 'active')`);
    const cal9 = await recalibrateTierStatements(fx9.env.DB);
    for (const s of cal9.statements) await s.run();
    expect(sqlGet<{ tier: string }>(fx9.sqlite, `SELECT tier FROM brand_pool WHERE brand = '麒麟生物'`)?.tier).toBe('头部');
  });
});

// ─── TC-EVO ──────────────────────────────────────────────────────────────────

describe('两信号情绪演化（TC-EVO）', () => {
  it('TC-EVO-01 satisfactionDelta 七态：正向线性、负向按档位 penaltyMult 放大', () => {
    expect(satisfactionDelta(SAT, 1, 1, 1.5)).toBeCloseTo(0.04); // 0.5×0.05 + 0.3×0.05
    expect(satisfactionDelta(SAT, 1, 0, 1.5)).toBeCloseTo(0.025);
    expect(satisfactionDelta(SAT, 0, 1, 1.5)).toBeCloseTo(0.015);
    expect(satisfactionDelta(SAT, 0, 0, 1.5)).toBe(0);
    expect(satisfactionDelta(SAT, -1, 0, 1.5)).toBeCloseTo(-0.0375); // ×1.5 头部敏感
    expect(satisfactionDelta(SAT, -1, 0, 0.75)).toBeCloseTo(-0.01875); // ×0.75 口碑宽容
    expect(satisfactionDelta(SAT, 0, -1, 0.75)).toBeCloseTo(-0.01125);
  });

  it('TC-EVO-02 windowWinRate 口径：点球按平、弃权按取胜方、双方弃权不计、无场次 null', () => {
    // 1 胜（弃权）1 平（点球决胜按平）1 负 → 1/3
    const rows = [
      row({ home: 101, away: 102, walkover: 'home' }),
      row({ home: 101, away: 103, scoreHome: 1, scoreAway: 1, penHome: 5, penAway: 3 }),
      row({ home: 104, away: 101, scoreHome: 2, scoreAway: 0 }),
    ];
    expect(windowWinRate(rows, 101)).toBeCloseTo(1 / 3);
    expect(windowWinRate(rows, 103)).toBe(0); // 点球战胜方按平计：103 不拿胜场（变异防线：只看 101 抓不到）
    // 双方弃权（无弃权侧无比分）与队 id 缺失的脏行不计名额
    const rows2 = [
      row({ home: 101, away: 102 }),
      row({ home: null, away: 101, scoreHome: 3, scoreAway: 0 }),
      row({ home: 101, away: 103, scoreHome: 2, scoreAway: 1 }),
    ];
    expect(windowWinRate(rows2, 101)).toBe(1);
    expect(windowWinRate([], 101)).toBeNull();
  });

  it('TC-EVO-03 落库：战绩信号按窗内赛果现算（season+window_seq 过滤），satisfaction 更新', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    await signViaOffer(fx.env, 1, '阿迪达斯', 1);
    const naming = (await getActiveNaming(fx.env.DB, 1))!;
    seedResult(fx.sqlite, { matchId: 1, home: 101, away: 102, scoreHome: 2, scoreAway: 0 });
    seedResult(fx.sqlite, { matchId: 2, home: 103, away: 101, scoreHome: 1, scoreAway: 0 });
    seedResult(fx.sqlite, { matchId: 3, windowSeq: 2, home: 101, away: 104, scoreHome: 9, scoreAway: 0 }); // 别的窗不计
    const { statements, report } = await evolveSatisfactionForClub(fx.env, naming, 101, 1, 1, 1, HEAD_PROFILE, SAT);
    expect(report.resultSignal).toBe(0); // 1 胜 1 负 → 0.5，中性带内
    for (const s of statements) await s.run();
    const after = (await getActiveNaming(fx.env.DB, 1))!;
    expect(after.satisfaction).toBeCloseTo(naming.satisfaction + 0.025); // 只吃上座 +1
    expect(after.status).toBe('active');
  });

  it('TC-EVO-04 跌破地板 → 品牌主动解约语句（terminated + windows_remaining=0 + ended 刻）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    await signViaOffer(fx.env, 1, '阿迪达斯', 1);
    const naming = (await getActiveNaming(fx.env.DB, 1))!;
    fx.sqlite.exec(`UPDATE naming_contracts SET satisfaction = 0.72 WHERE id = ${naming.id}`);
    const { statements, report } = await evolveSatisfactionForClub(fx.env, { ...naming, satisfaction: 0.72 }, undefined, 1, 1, -1, HEAD_PROFILE, SAT);
    expect(statements).toHaveLength(2);
    expect(report.terminated).toBe(true);
    for (const s of statements) await s.run();
    expect(
      sqlGet<{ status: string; windows_remaining: number; ended_season: number; ended_window: number }>(
        fx.sqlite,
        `SELECT status, windows_remaining, ended_season, ended_window FROM naming_contracts WHERE id = ${naming.id}`,
      ),
    ).toMatchObject({ status: 'terminated', windows_remaining: 0, ended_season: 1, ended_window: 1 });
  });

  it('TC-EVO-05 恰在地板不解约（严格小于）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    await signViaOffer(fx.env, 1, '阿迪达斯', 1);
    const naming = (await getActiveNaming(fx.env.DB, 1))!;
    // 0.7375 − 0.0375（sAttend=−1 头部 ×1.5）= 0.700 精确落地板
    const { statements, report } = await evolveSatisfactionForClub(fx.env, { ...naming, satisfaction: 0.7375 }, undefined, 1, 1, -1, HEAD_PROFILE, SAT);
    expect(report.to).toBeCloseTo(0.7);
    expect(report.terminated).toBe(false);
    expect(statements).toHaveLength(1);
  });

  it('TC-EVO-06 钳口 [0,2] round3', () => {
    expect(clampSatisfaction(2.5)).toBe(2);
    expect(clampSatisfaction(-1)).toBe(0);
    expect(clampSatisfaction(0.123456)).toBe(0.123);
  });

  it('TC-EVO-07 无主场比赛（sAttend=0）不借中性上座率拿正向信号', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    await signViaOffer(fx.env, 1, '阿迪达斯', 1);
    const naming = (await getActiveNaming(fx.env.DB, 1))!;
    const { report } = await evolveSatisfactionForClub(fx.env, naming, undefined, 1, 1, 0, HEAD_PROFILE, SAT);
    expect(report.attendSignal).toBe(0);
    expect(report.delta).toBe(0);
  });
});

// ─── TC-QUOTA ────────────────────────────────────────────────────────────────

describe('签约档位名额守卫（TC-QUOTA）', () => {
  it('TC-QUOTA-01 tierQuotaOf：头部 1 / 新兴 2 / 口碑不限', () => {
    expect(tierQuotaOf('头部', RULES)).toBe(1);
    expect(tierQuotaOf('新兴', RULES)).toBe(2);
    expect(tierQuotaOf('口碑', RULES)).toBeNull();
  });

  it('TC-QUOTA-02 头部第 2 队 409、新兴第 3 队 409，文案点名档位限数', async () => {
    const fx = freshEnv();
    for (const id of [1, 2, 3, 4]) seedClub(fx.sqlite, id);
    await signViaOffer(fx.env, 1, '阿迪达斯', 1); // 头部
    await expect(signViaOffer(fx.env, 2, '阿迪达斯', 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('头部档限 1 队') });
    await signViaOffer(fx.env, 2, '可口可乐', 1); // 新兴
    await signViaOffer(fx.env, 3, '可口可乐', 1);
    await expect(signViaOffer(fx.env, 4, '可口可乐', 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('新兴档限 2 队') });
  });

  it('TC-QUOTA-03 名额原子守卫：accept 语句带 active+queued 合并 COUNT 子查询防线（并发超卖不进库，源码文本锁）', () => {
    const src = readFileSync('src/worker/market-ops.ts', 'utf8');
    expect(src).toContain(
      `AND (SELECT COUNT(*) FROM naming_contracts WHERE brand = (SELECT brand FROM brand_pool WHERE id = ?) AND status = 'active')
            + (SELECT COUNT(*) FROM market_offers WHERE brand_id = ? AND status = 'queued') < ?`,
    );
  });

  it('TC-QUOTA-04 口碑档不限额可多签；解约释放名额后头部可再签（守卫按 active+queued 合并计，terminated 不占）', async () => {
    const fx = freshEnv();
    for (const id of [1, 2, 3]) seedClub(fx.sqlite, id);
    const woman = sqlGet<{ brand: string }>(fx.sqlite, `SELECT brand FROM brand_pool WHERE tier = '口碑' ORDER BY id LIMIT 1`)!.brand;
    for (const id of [1, 2, 3]) await signViaOffer(fx.env, id, woman, 1);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM naming_contracts WHERE brand = '${woman}' AND status = 'active'`)?.n).toBe(3);
    fx.sqlite.exec(`UPDATE naming_contracts SET status = 'terminated', windows_remaining = 0 WHERE club_id = 1`);
    await signViaOffer(fx.env, 1, '阿迪达斯', 1); // terminated 不占名额，释放后可签头部
  });
});

// ─── TC-CHAMP ────────────────────────────────────────────────────────────────

describe('联赛冠军加成（TC-CHAMP）', () => {
  it('TC-CHAMP-01 积分表：胜3平1负0、点球按平、弃权判负 3:0、双方弃权不计', () => {
    const rows = [
      row({ home: 101, away: 102, scoreHome: 2, scoreAway: 1 }), // 101 胜 +3 分 +2 球
      row({ home: 101, away: 103, scoreHome: 1, scoreAway: 1, penHome: 5, penAway: 3 }), // 点球按平
      row({ home: 104, away: 101, walkover: 'home' }), // 101 判负 −3 净胜球
      row({ home: 102, away: 103 }), // 双方弃权不计
    ];
    const table = new Map(leagueStandings(rows).map((r) => [r.teamId, r]));
    expect(table.get(101)).toMatchObject({ pts: 4, gd: -2 }); // 3+1 分；净胜 (2−1) + 0 − 3
    expect(table.get(102)).toMatchObject({ pts: 0, gd: -1 });
    expect(table.get(103)).toMatchObject({ pts: 1, gd: 0 });
    expect(table.get(104)).toMatchObject({ pts: 3, gd: 3 });
  });

  it('TC-CHAMP-03 跳过：0 条或 >1 条 league_premier 绑定 → note 零语句', async () => {
    const fx = freshEnv();
    const none = await championBonusStatements(fx.env, 1, 1);
    expect(none.statements).toHaveLength(0);
    expect(none.detail.note).toContain('没有联赛');
    seedBinding(fx.sqlite, 1, 5, 'league_premier');
    seedBinding(fx.sqlite, 1, 6, 'league_premier');
    const dup = await championBonusStatements(fx.env, 1, 1);
    expect(dup.statements).toHaveLength(0);
    expect(dup.detail.note).toContain('无法唯一判定');
  });

  it('TC-CHAMP-04 绑定无确认赛果 → note', async () => {
    const fx = freshEnv();
    seedBinding(fx.sqlite, 1, 5, 'league_premier');
    expect((await championBonusStatements(fx.env, 1, 1)).detail.note).toContain('没有已确认赛果');
  });

  it('TC-CHAMP-05 冠军无 AUTH 映射（CPU 队同路）→ note、clubId null', async () => {
    const fx = freshEnv(); // 无 AUTH_DB
    seedBinding(fx.sqlite, 1, 5, 'league_premier');
    seedResult(fx.sqlite, { matchId: 1, tournamentId: 5, home: 11, away: 12, scoreHome: 1, scoreAway: 0 });
    const out = await championBonusStatements(fx.env, 1, 1);
    expect(out.detail.note).toContain('CPU 队或无俱乐部映射');
    expect(out.detail.clubId).toBeNull();
  });

  it('TC-CHAMP-02 tiebreak：净胜球反超积分同分队；再同则队名小者先（AUTH 目录名）', async () => {
    // 净胜球路径：同 3 分，11 净胜 +1（1:0）、12 净胜 +2（2:0）→ 12 冠。
    // 名字序（阿森纳 < 切尔西）与净胜球序刻意相反，去掉 gd 的变异会被名字序掩盖而漏抓
    const fx = freshEnv({ auth: true });
    authRegisterClubTeam(fx.auth, 11, 1, '阿森纳');
    authRegisterClubTeam(fx.auth, 12, 2, '切尔西');
    seedBinding(fx.sqlite, 1, 5, 'league_premier');
    seedResult(fx.sqlite, { matchId: 1, tournamentId: 5, home: 11, away: 13, scoreHome: 1, scoreAway: 0 });
    seedResult(fx.sqlite, { matchId: 2, tournamentId: 5, home: 12, away: 14, scoreHome: 2, scoreAway: 0 });
    expect((await championBonusStatements(fx.env, 1, 1)).detail.clubId).toBe(2);
    // 队名路径：同 3 分同净胜，localeCompare 拼音序「阿森纳」(a) < 「拜仁」(bai) → 阿森纳（club 4）冠
    const fx2 = freshEnv({ auth: true });
    authRegisterClubTeam(fx2.auth, 21, 3, '拜仁');
    authRegisterClubTeam(fx2.auth, 22, 4, '阿森纳');
    seedBinding(fx2.sqlite, 1, 5, 'league_premier');
    seedResult(fx2.sqlite, { matchId: 1, tournamentId: 5, home: 21, away: 23, scoreHome: 1, scoreAway: 0 });
    seedResult(fx2.sqlite, { matchId: 2, tournamentId: 5, home: 22, away: 24, scoreHome: 1, scoreAway: 0 });
    expect((await championBonusStatements(fx2.env, 1, 1)).detail.clubId).toBe(4);
  });

  it('TC-CHAMP-06 冠军无生效冠名 → note「无落点」零语句，clubId 照回', async () => {
    const fx = freshEnv({ auth: true });
    seedClub(fx.sqlite, 1);
    authRegisterClubTeam(fx.auth, 11, 1, '阿森纳');
    seedBinding(fx.sqlite, 1, 5, 'league_premier');
    seedResult(fx.sqlite, { matchId: 1, tournamentId: 5, home: 11, away: 12, scoreHome: 3, scoreAway: 0 });
    const out = await championBonusStatements(fx.env, 1, 1);
    expect(out.detail.applied).toBe(false);
    expect(out.detail.note).toContain('无生效冠名');
    expect(out.detail.clubId).toBe(1);
    expect(out.statements).toHaveLength(0);
  });

  it('TC-CHAMP-07 applied：热度 +0.1 钳内、满意度 +0.1、审计 champion_bonus 带守卫', async () => {
    const fx = freshEnv({ auth: true });
    seedClub(fx.sqlite, 1);
    authRegisterClubTeam(fx.auth, 11, 1, '阿森纳');
    seedBinding(fx.sqlite, 1, 5, 'league_premier');
    seedResult(fx.sqlite, { matchId: 1, tournamentId: 5, home: 11, away: 12, scoreHome: 2, scoreAway: 0 });
    await signViaOffer(fx.env, 1, '阿迪达斯', 1);
    fx.sqlite.exec(`INSERT INTO seasons (season, status, created_at) VALUES (1, 'running', '2026-01-01T00:00:00Z')`);
    const heatBefore = sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '阿迪达斯'`)!.heat;
    const out = await championBonusStatements(fx.env, 1, 1);
    expect(out.detail).toMatchObject({ applied: true, clubId: 1, brand: '阿迪达斯', heatDelta: 0.1, satDelta: 0.1 });
    for (const s of out.statements) await s.run();
    expect(sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '阿迪达斯'`)!.heat).toBeCloseTo(heatBefore + 0.1);
    expect(sqlGet<{ satisfaction: number }>(fx.sqlite, `SELECT satisfaction FROM naming_contracts WHERE club_id = 1`)!.satisfaction).toBeCloseTo(1.1);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'champion_bonus'`)?.n).toBe(1);
  });

  it('TC-CHAMP-08 settleSeason 集成：冠军明细进返回体 + 重放 409 不重复加成', async () => {
    const fx = freshEnv({ auth: true });
    seedClub(fx.sqlite, 1);
    authRegisterClubTeam(fx.auth, 11, 1, '阿森纳');
    seedBinding(fx.sqlite, 1, 5, 'league_premier');
    seedResult(fx.sqlite, { matchId: 1, tournamentId: 5, home: 11, away: 12, scoreHome: 1, scoreAway: 0 });
    await signViaOffer(fx.env, 1, '阿迪达斯', 1); // 要开窗，先签后关
    fx.sqlite.exec(`INSERT INTO seasons (season, status, age_cap, created_at) VALUES (1, 'running', 24, '2026-01-01T00:00:00Z')`);
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1`);
    const heatBefore = sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '阿迪达斯'`)!.heat;
    const res = await settleSeason(fx.env, 1, 1, true);
    expect(res.champion.applied).toBe(true);
    expect(res.champion.clubId).toBe(1);
    expect(res.champion.brand).toBe('阿迪达斯');
    expect(sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '阿迪达斯'`)!.heat).toBeCloseTo(heatBefore + 0.1);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'champion_bonus'`)?.n).toBe(1);
    await expect(settleSeason(fx.env, 1, 1, true)).rejects.toThrow('已经结算过');
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'champion_bonus'`)?.n).toBe(1);
    // 守卫重放：已 settled 的赛季再跑加成语句必须是零改行（热度不再 +0.1、审计不再 +1）
    const replay = await championBonusStatements(fx.env, 1, 1);
    for (const s of replay.statements) await s.run();
    expect(sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '阿迪达斯'`)!.heat).toBeCloseTo(heatBefore + 0.1);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'champion_bonus'`)?.n).toBe(1);
  });
});

// ─── TC-BUFF ─────────────────────────────────────────────────────────────────

describe('buff 生效点（TC-BUFF）', () => {
  it('TC-BUFF-01 activityIncome attendBuff 只乘活动收入、不动损坏', () => {
    const def = { key: 'concert', name: '演唱会', incomeMin: 3, incomeMax: 8, pitchDamageProb: 0, income: null };
    const rolls = { income: 0.5, damage: 0 };
    const base = activityIncome(def as never, 'concert', 0, 0, rolls as never, 0);
    const buffed = activityIncome(def as never, 'concert', 0, 0, rolls as never, 0.02);
    expect(buffed.income).toBeCloseTo(base.income * 1.02);
    expect(buffed.extraMaintenance).toBeCloseTo(base.extraMaintenance);
  });

  it('TC-BUFF-02 evolveFans fansBuff 只乘涨粉分支，掉粉不动', async () => {
    const fx = freshEnv();
    const model = await loadAttendanceModel(fx.env.DB);
    // 涨粉：fansBuff=0.005（口碑）放大涨粉系数
    const up0 = evolveFans(model, 1800, 3560, 1, 4, 0, 0);
    expect(evolveFans(model, 1800, 3560, 1, 4, 0, 0.005)).toBeGreaterThan(up0);
    // 掉粉不吃 buff（与青训同机制）
    const down0 = evolveFans(model, 3000, 2680, 1, 4, 0, 0);
    expect(evolveFans(model, 3000, 2680, 1, 4, 0, 0.005)).toBe(down0);
  });
});
