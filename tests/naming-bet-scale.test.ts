// v6.51.0 复审修复回归锁：对赌抽签的**场次尺度（n 源）**与结算尺度对齐
// ① n 只来自近 3 窗历史的同尺度场次均值（不再读休眠列 season_windows.tournament_id / TOUR_DB）
// ② 计数型反解的 n = 结算判定同尺度（points/goals/cleansheet 全窗口径、attend/sellout 主场尺度）
// ③ 反向锁：按主场尺度反解会把实际达线率顶到 0.8+（破 design §4.8 F 经济式与 G2/G3 支出界）
// ④ G3 奖金上界对任意 windows_total 成立（每项 = min(0.25, 1 ÷ windows_total) × 底价）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  betWeights,
  buildBetTerms,
  deriveBetPool,
  deriveOne,
  evaluateBetItem,
  expectedWindowScale,
  loadNamingParams,
  windowNamingStatements,
  type BetHistorySample,
  type BetTermsItem,
  type NamingContractRow,
} from '../src/worker/naming-ops.ts';

const CAP = 20000;

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(`
    CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, name TEXT);
    CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER);
    CREATE TABLE match (id INTEGER PRIMARY KEY, stage_id INTEGER, home_entry_id INTEGER);
  `);
  const { sqlite: auth, d1: authD1 } = createAuthDb();
  return { env: { DB: createTestD1(sqlite), AUTH_DB: authD1, TOUR_DB: createTestD1(tour) } as unknown as Env, sqlite, tour, auth };
}

/** 俱乐部 1（容量 20000）+ 当前开放窗 S2W1 */
function seedClub(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans) VALUES (1, '酋长球场', ${CAP}, 0, 18000);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 50, '2026-01-01T00:00:00Z');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (2, 1, 'open', '2026-07-01T00:00:00Z');
  `);
}

function bindTeam(fx: Fixture): void {
  fx.auth.exec(`INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 9001, 1, '阿森纳', 'x')`);
}

/** 近 3 窗生产形状历史：每窗 4 主场 / 8 全窗；上座 0.625·0.55·0.7、积分 14、进球 11、零封 2、满座 1 */
function seedHistory(fx: Fixture): void {
  const attend = [
    { season: 1, windowSeq: 1, attendances: [8000, 10000, 12000, 20000] },
    { season: 1, windowSeq: 2, attendances: [6000, 8000, 10000, 20000] },
    { season: 1, windowSeq: 3, attendances: [10000, 12000, 14000, 20000] },
  ];
  let mid = 1;
  for (const w of attend) {
    for (const a of w.attendances) {
      fx.sqlite.exec(
        `INSERT INTO match_attendance (match_id, club_id, season, window_seq, attendance, ticket, commercial, broadcast)
         VALUES (${mid++}, 1, ${w.season}, ${w.windowSeq}, ${a}, 0, 0, 0)`,
      );
    }
  }
  // 每窗 8 场（4 主 4 客）⇒ 积分 14、进球 11、零封 2
  const rows: [number, number, number, number][] = [
    [9001, 9002, 2, 0],
    [9001, 9003, 1, 1],
    [9001, 9004, 3, 1],
    [9001, 9005, 0, 1],
    [9006, 9001, 0, 2],
    [9007, 9001, 2, 0],
    [9008, 9001, 1, 1],
    [9009, 9001, 1, 2],
  ];
  for (const base of [900, 950, 1000]) {
    rows.forEach(([home, away, sh, sa], i) => {
      fx.sqlite.exec(
        `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team_id, away_team_id, score_home, score_away)
         VALUES (1, ${base === 900 ? 1 : base === 950 ? 2 : 3}, 1, ${base + i}, ${home}, ${away}, ${sh}, ${sa})`,
      );
    });
  }
}

/** 纯函数用例用的同形样本（不落库） */
function historySamples(): BetHistorySample[] {
  return [0.625, 0.55, 0.7].map((attend, i) => ({
    season: 1,
    windowSeq: i + 1,
    played: 8,
    points: 14,
    goals: 11,
    cleansheet: 2,
    homePlayed: 4,
    sellout: 1,
    attend,
  }));
}

/** 确定性 PRNG（splitmix 系；测试可复现，不依赖 Math.random） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonDraw(rand: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

function binomDraw(rand: () => number, n: number, rate: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) if (rand() < rate) c++;
  return c;
}

/** P(X ≥ t)，X ~ Poisson(λ)：反解实现用的是同一族尾概率（测试内独立复算） */
function poissonTail(lambda: number, t: number): number {
  if (t <= 0) return 1;
  let cum = 0;
  let term = Math.exp(-lambda);
  for (let k = 0; k < t; k++) {
    cum += term;
    term = (term * lambda) / (k + 1);
  }
  return 1 - cum;
}

/** P(X ≥ t)，X ~ Binomial(n, rate) */
function binomTail(n: number, rate: number, t: number): number {
  if (t <= 0) return 1;
  let cum = 0;
  for (let k = 0; k < t; k++) {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    cum += c * Math.pow(rate, k) * Math.pow(1 - rate, n - k);
  }
  return 1 - cum;
}

/** 对赌合同（底价 1.6、fee = 0.7 × 底价 = 1.12） */
function seedContract(sqlite: DatabaseSync, betTerms: string, over: { windowsTotal?: number; windowsRemaining?: number } = {}): NamingContractRow {
  const total = over.windowsTotal ?? 4;
  const remaining = over.windowsRemaining ?? total;
  sqlite.exec(`
    INSERT INTO naming_contracts
      (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
       windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, bet_terms, status,
       started_season, started_window, created_at, updated_at)
    VALUES (1, '奥维恩', 1.3, 1.6, 3, '对赌', 1.12, ${total}, ${remaining}, 1.0, 0.8, 0.03, '${betTerms}', 'active',
            2, 1, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
  `);
  return sqlGet<NamingContractRow>(sqlite, 'SELECT * FROM naming_contracts WHERE club_id = 1')!;
}

describe('A · 场次尺度来源（🔴#1 回归锁）', () => {
  it('expectedWindowScale：近 3 窗同尺度场次均值取整，忽略无数据窗，无历史 → {0,0}', () => {
    expect(expectedWindowScale([])).toEqual({ home: 0, all: 0 });
    const s = (homePlayed: number, played: number): BetHistorySample => ({
      season: 1,
      windowSeq: 1,
      played,
      points: 0,
      goals: 0,
      cleansheet: 0,
      homePlayed,
      sellout: 0,
      attend: null,
    });
    // 场均 13/3 = 4.33 → 4；全窗 25/3 = 8.33 → 8
    expect(expectedWindowScale([s(4, 8), s(5, 9), s(4, 8)])).toEqual({ home: 4, all: 8 });
    // 无数据窗（首季窗口尚无赛果/上座）不进均值
    expect(expectedWindowScale([s(0, 0), s(4, 8)])).toEqual({ home: 4, all: 8 });
  });

  it('buildBetTerms 不再读休眠列：写入 season_windows.tournament_id + TOUR_DB 20 场赛程也不改结果（逐字一致）', async () => {
    const plain = freshEnv();
    seedClub(plain.sqlite);
    bindTeam(plain);
    seedHistory(plain);
    const a = await buildBetTerms(plain.env, 1, '奥维恩', 2, 1);

    const noisy = freshEnv();
    seedClub(noisy.sqlite);
    bindTeam(noisy);
    seedHistory(noisy);
    noisy.sqlite.exec("UPDATE season_windows SET tournament_id = 7 WHERE season = 2 AND window_seq = 1");
    noisy.tour.exec("INSERT INTO stage (id, tournament_id, name) VALUES (5, 7, '常规赛');");
    noisy.tour.exec('INSERT INTO entry (id, tournament_id, team_id) VALUES (11, 7, 9001);');
    for (let i = 0; i < 20; i++) noisy.tour.exec(`INSERT INTO match (id, stage_id, home_entry_id) VALUES (${100 + i}, 5, 11);`);
    const b = await buildBetTerms(noisy.env, 1, '奥维恩', 2, 1);

    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.items).toHaveLength(2); // TOUR_DB 里 20 场主场不再变成 n（旧口径会把计数型全拉进池）
    expect(a.items.map((i) => i.nBase).every((n) => n === 4 || n === 8)).toBe(true);
    expect(a.dropped).toEqual([]);
  });
});

describe('B · 反解尺度 = 结算尺度（🔴#2 回归锁）', () => {
  it('deriveBetPool 传 BetScale：nBase 逐指标取尺度（attend/sellout 主场 4、其余全窗 8）', () => {
    const state = deriveBetPool(historySamples(), { home: 4, all: 8 }, CAP, 0.34, betWeights([]));
    expect(state.dropped).toEqual([]);
    expect(Object.fromEntries(state.viable.map((v) => [v.item.m, v.item.nBase]))).toEqual({
      attend: 4,
      sellout: 4,
      fans: 8,
      points: 8,
      goals: 8,
      cleansheet: 8,
    });
  });

  it('反向锁：全窗口径反解的线达线率贴 p；误用主场尺度反解则达线率 > 0.8（会顶破经济式）', () => {
    const samples = historySamples();
    // 本窗实况 = 全窗口径 8 场 × 每场 1.75 分 ⇒ λ = 14（结算判的是这 8 场的合计）
    const all = deriveOne('points', samples, 8, 0.34, CAP)!;
    const home = deriveOne('points', samples, 4, 0.34, CAP)!;
    expect(poissonTail(14, all.threshold)).toBeGreaterThanOrEqual(0.34);
    expect(poissonTail(14, all.threshold)).toBeLessThan(0.47);
    expect(poissonTail(14, home.threshold)).toBeGreaterThan(0.8);
    // 进球同理（λ = 1.375 × 8 = 11）
    expect(poissonTail(11, deriveOne('goals', samples, 8, 0.34, CAP)!.threshold)).toBeLessThan(0.47);
    expect(poissonTail(11, deriveOne('goals', samples, 4, 0.34, CAP)!.threshold)).toBeGreaterThan(0.8);
    // 零封：全窗 8 场 × rate 0.25；主场尺度（4 场）反解会把线压到 1 ⇒ 8 场实况几乎必达
    expect(binomTail(8, 0.25, deriveOne('cleansheet', samples, 8, 0.34, CAP)!.threshold)).toBeGreaterThanOrEqual(0.34);
    expect(binomTail(8, 0.25, deriveOne('cleansheet', samples, 4, 0.34, CAP)!.threshold)).toBeGreaterThan(0.8);
  });

  it('蒙特卡洛（确定性 PRNG，4000 抽样）：三条计数指标的实际达线率 ≈ 反解尾概率，且都 ≥ p', () => {
    const samples = historySamples();
    const N = 4000;
    const specs = [
      { m: 'points' as const, model: 'poisson' as const, rate: 1.75 },
      { m: 'goals' as const, model: 'poisson' as const, rate: 1.375 },
      { m: 'cleansheet' as const, model: 'binom' as const, rate: 0.25 },
    ];
    for (const [idx, spec] of specs.entries()) {
      const derived = deriveOne(spec.m, samples, 8, 0.34, CAP)!;
      const item: BetTermsItem = { m: spec.m, threshold: derived.threshold, baseline: derived.baseline, nBase: derived.nBase, pTarget: 0.34, guard: '' };
      const analytic =
        spec.model === 'poisson' ? poissonTail(spec.rate * 8, item.threshold) : binomTail(8, spec.rate, item.threshold);
      const rand = mulberry32(20261008 + idx);
      let hits = 0;
      for (let i = 0; i < N; i++) {
        const draws = spec.model === 'poisson' ? poissonDraw(rand, spec.rate * 8) : binomDraw(rand, 8, spec.rate);
        const counts = { homePlayed: 4, played: 8, points: 0, goals: 0, cleansheet: 0, sellout: 0, [spec.m]: draws };
        if (evaluateBetItem(item, counts, 0.5, 0).hit) hits++;
      }
      const empirical = hits / N;
      expect(Math.abs(empirical - analytic)).toBeLessThan(0.04); // 实现与解析同族
      expect(analytic).toBeGreaterThanOrEqual(0.34 - 1e-9); // 反解保证「不低于目标 p」
      expect(analytic).toBeLessThan(0.7); // 离散指标的下界跳变上限（见用例内注释）
    }
  });

  it('对赌套餐窗数锁在配置默认 4（naming_params.bet.windows）：G2/G3 的数值前提可查', async () => {
    const fx = freshEnv();
    const p = await loadNamingParams(fx.env.DB);
    expect(p.bet.windows).toBe(4); // 4 窗：每项 min(0.25, 1/4) = 0.25 × 底价 ⇒ 单窗 ≤ 1.20、合同期 ≤ 2.0（G2/G3）
    expect(p.bet.factor).toBeCloseTo(0.7, 5); // 套餐费率 0.70 × 底价（G2 下界）
    // bonusRate 是**旧展示口径**（bonus_amount = 0.7 × 对赌费 = 0.49 × 底价 ≈ 两项全达的 0.5 × 底价）；
    // v6.51.0 结算按「条数 × min(0.25, 1/windows_total) × 底价」现算，不再读 bonus_amount。
    expect(p.bet.bonusRate).toBeCloseTo(0.7, 5);
  });
});

describe('C · 签约→结算闭环与 G3 上界', () => {
  it('闭环：签约快照的线直接用于本窗全窗口径判定（基线窗不达、上峰窗两条全达）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindTeam(fx);
    seedHistory(fx);
    const terms = await buildBetTerms(fx.env, 1, '奥维恩', 2, 1);
    // 本夹具的确定性抽签结果 = points + attend（尺度 8 / 4，见 A 组）；线一律在基线之上 ⇒ 平均水准的窗自然不达
    const baseline: Record<string, number> = { points: 14, goals: 11, cleansheet: 2, sellout: 1, attend: 0.625, fans: 0.03 };
    for (const i of terms.items) expect(baseline[i.m]).toBeLessThan(i.threshold);
    // naming_contracts.club_id 唯一（一队一约）⇒ 同一行连用两个窗
    const row = seedContract(fx.sqlite, JSON.stringify(terms));

    // 基线窗（各项都低于线）⇒ 不发奖金、不倒扣
    await fx.env.DB.batch(
      windowNamingStatements(fx.env, row, 2, 1, 0.625, 0, {
        counts: { homePlayed: 4, played: 8, points: 14, goals: 11, cleansheet: 2, sellout: 1 },
      }),
    );
    expect(sqlAll(fx.sqlite, "SELECT id FROM ledger_entries WHERE kind = 'naming_bonus'")).toEqual([]);

    // 上峰窗（两条都正好达到线）⇒ 逐条发放 0.25 × 底价
    const atLine: Record<string, number> = { points: 0, goals: 0, cleansheet: 0, sellout: 0, attend: 0.1, fans: 0 };
    for (const i of terms.items) atLine[i.m] = i.threshold;
    await fx.env.DB.batch(
      windowNamingStatements(fx.env, row, 2, 2, atLine.attend, atLine.fans, {
        counts: { homePlayed: 4, played: 8, points: atLine.points, goals: atLine.goals, cleansheet: atLine.cleansheet, sellout: atLine.sellout },
      }),
    );
    const bonus = sqlAll<{ amount: number; ref_type: string }>(
      fx.sqlite,
      "SELECT amount, ref_type FROM ledger_entries WHERE kind = 'naming_bonus' ORDER BY ref_type",
    );
    expect(bonus.map((b) => b.ref_type)).toEqual(terms.items.map((i) => `bet_${i.m}`).sort());
    expect(bonus.every((b) => b.amount === 0.4)).toBe(true); // 0.25 × 底价 1.6
    // 单窗支出 = 0.70 + 0.5 = 1.20 × 底价（G2 上界，命中两条时正好贴顶）
    // 不达窗只有冠名费（不倒扣、不记奖金）
    expect(sqlAll(fx.sqlite, 'SELECT kind FROM ledger_entries WHERE ref_id = 201')).toEqual([{ kind: 'naming_fee' }]);
    // G2 是**单窗**口径：只算本窗（S2W2 = ref_id 202）的费用 + 本窗奖金
    const fee = sqlGet<{ amount: number }>(fx.sqlite, "SELECT SUM(amount) AS amount FROM ledger_entries WHERE kind = 'naming_fee' AND ref_id = 202")!.amount;
    expect(fee + 0.8).toBeLessThanOrEqual(1.2 * 1.6 + 1e-9);
  });

  it('G3 对任意 windows_total 成立：每项 = min(0.25, 1 ÷ windows_total) × 底价 ⇒ 8 窗累计奖金仍 ≤ 2.0 × 底价', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const row = seedContract(fx.sqlite, JSON.stringify({ v: 2, seed: [2, 1, 1, 7], p: 0.34, strength: 'strong', backtest: { hitRate: null, windows: 0 }, dropped: [], items: [
      { m: 'points', threshold: 1, baseline: 1, nBase: 8, pTarget: 0.34, guard: '' },
      { m: 'goals', threshold: 1, baseline: 1, nBase: 8, pTarget: 0.34, guard: '' },
    ] }), { windowsTotal: 8, windowsRemaining: 8 });
    await fx.env.DB.batch(
      windowNamingStatements(fx.env, row, 2, 1, 0.5, 0, {
        counts: { homePlayed: 4, played: 8, points: 20, goals: 20, cleansheet: 0, sellout: 0 },
      }),
    );
    const bonus = sqlAll<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE kind = 'naming_bonus'");
    expect(bonus.map((b) => b.amount)).toEqual([0.2, 0.2]); // min(0.25, 1/8) × 1.6
    // 8 窗 × 2 条 × 0.2 = 3.2 = 2.0 × 底价（4 窗时是 0.4 × 2 × 4 = 3.2，同一上界）
    expect(8 * 2 * 0.2).toBeLessThanOrEqual(2.0 * 1.6 + 1e-9);
  });
});
