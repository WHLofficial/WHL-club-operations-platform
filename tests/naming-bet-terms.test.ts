// v6.51.0 批 3：对赌抽签引擎与四层护栏（design-brand-pool-structure §4.8 A–G）
// 覆盖：指标库反解（比率/计数）· G1 阈值上下限表 · G1b 触界剔除重抽 · G1c 少池/空池兜底链
// · prefer 权重偏向 · 强度三分位 · 回测纠偏 · 快照确定性 · 结算双路（含 G2/G3 支出上界与 no_data）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  BET_P_BY_STRENGTH,
  betGuardBounds,
  betWeights,
  brandHash,
  buildBetTerms,
  chooseBetItems,
  deriveBetPool,
  deriveOne,
  evaluateBetItem,
  normalQuantile,
  parseBetTerms,
  windowNamingStatements,
  type BetHistorySample,
  type BetTerms,
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
  const env = {
    DB: createTestD1(sqlite),
    AUTH_DB: authD1,
    TOUR_DB: createTestD1(tour),
    rng: () => 0.5,
  } as unknown as Env;
  return { env, sqlite, tour, auth };
}

/** 俱乐部 1（容量 20000、死忠 18000）+ 当前开放窗（默认 S2W1；历史窗由用例自铺） */
function seedClub(sqlite: DatabaseSync, window: [number, number] = [2, 1]): void {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans) VALUES (1, '酋长球场', ${CAP}, 0, 18000);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 50, '2026-01-01T00:00:00Z');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (${window[0]}, ${window[1]}, 'open', '2026-07-01T00:00:00Z');
  `);
}

/** club 1 → tour 队 9001（AUTH_DB team 目录；无映射 ⇒ 历史与赛程都取不到） */
function bindTeam(fx: Fixture): void {
  fx.auth.exec(`INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 9001, 1, '阿森纳', 'x')`);
}

/**
 * 生产形状的历史（近 3 窗）：每窗 4 场主场上座 + 8 场赛果 ⇒ 尺度 {home: 4, all: 8}。
 * v6.51.0 复审修复后 n 只来自历史（旧夹具写 season_windows.tournament_id 属休眠列，已废弃）。
 * 每窗：上座率 0.625 / 0.55 / 0.7（B 0.625、σ 0.075）、满座 1 场、积分 14、进球 11、零封 2。
 */
function seedHistory(fx: Fixture): void {
  seedAttendHistory(fx, [
    { season: 1, windowSeq: 1, attendances: [8000, 10000, 12000, 20000] },
    { season: 1, windowSeq: 2, attendances: [6000, 8000, 10000, 20000] },
    { season: 1, windowSeq: 3, attendances: [10000, 12000, 14000, 20000] },
  ]);
  const rows: [number, number, number, number][] = [
    [9001, 9002, 2, 0], // 主 胜（3 分、2 球、零封）
    [9001, 9003, 1, 1], // 主 平（1 分、1 球）
    [9001, 9004, 3, 1], // 主 胜（3 分、3 球）
    [9001, 9005, 0, 1], // 主 负
    [9006, 9001, 0, 2], // 客 胜（3 分、2 球、零封）
    [9007, 9001, 2, 0], // 客 负
    [9008, 9001, 1, 1], // 客 平（1 分、1 球）
    [9009, 9001, 1, 2], // 客 胜（3 分、2 球）
  ];
  seedResults(fx, 1, 1, rows, 900);
  seedResults(fx, 1, 2, rows, 950);
  seedResults(fx, 1, 3, rows, 1000);
}

/** 历史主场场次（上座率 = attendance ÷ 容量） */
function seedAttendHistory(fx: Fixture, rows: { season: number; windowSeq: number; attendances: number[] }[]): void {
  let id = 1;
  for (const r of rows) {
    for (const a of r.attendances) {
      fx.sqlite.exec(
        `INSERT INTO match_attendance (match_id, club_id, season, window_seq, attendance, ticket, commercial, broadcast)
         VALUES (${id++}, 1, ${r.season}, ${r.windowSeq}, ${a}, 0, 0, 0)`,
      );
    }
  }
}

/** 历史赛果（本队 tour 队 9001；scores[0] = 主队进球）；match_id 全局唯一（表上 UNIQUE） */
function seedResults(fx: Fixture, season: number, windowSeq: number, rows: [number, number, number, number][], idBase = 900): void {
  rows.forEach(([home, away, sh, sa], i) => {
    fx.sqlite.exec(
      `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team_id, away_team_id, score_home, score_away)
       VALUES (${season}, ${windowSeq}, 1, ${idBase + i}, ${home}, ${away}, ${sh}, ${sa})`,
    );
  });
}

/** 历史样本（反解/池装配的纯函数入参） */
function sample(over: Partial<BetHistorySample> = {}): BetHistorySample {
  return { season: 1, windowSeq: 1, played: 0, points: 0, goals: 0, cleansheet: 0, homePlayed: 0, sellout: 0, attend: null, ...over };
}

const WEIGHTS_ALL_ONE = betWeights([]);

describe('A · 指标库反解（design §4.8 A/C）', () => {
  it('z_p 三档与 design 表值同解（0.34→0.41 / 0.42→0.20 / 0.50→0.00）', () => {
    expect(normalQuantile(1 - 0.34)).toBeCloseTo(0.41, 2);
    expect(normalQuantile(1 - 0.42)).toBeCloseTo(0.2, 2);
    expect(normalQuantile(1 - 0.5)).toBeCloseTo(0, 3);
    // 回测纠偏后的 p 也走同一公式（0.58 → 负 z，线降到基线以下）
    expect(normalQuantile(1 - 0.58)).toBeLessThan(0);
  });

  it('比率型：T = B + z_p × σ，σ 用历史样本标准差（< 2 窗回落 0.06 / 0.02）', () => {
    const hist = [sample({ season: 1, windowSeq: 1, attend: 0.4 }), sample({ season: 1, windowSeq: 2, attend: 0.6 }), sample({ season: 1, windowSeq: 3, attend: 0.55 })];
    // B = 0.5166667 → 0.517；σ（样本）= 0.104076 → 0.517 + 0.4125×0.104076 = 0.5596 → 0.560
    expect(deriveOne('attend', hist, 4, 0.34, CAP)).toEqual({ threshold: 0.56, baseline: 0.517, nBase: 4, pooled: false });
    // 无历史 → 池默认基线 0.60 + 0.4125×0.06 = 0.6247 → 0.625
    expect(deriveOne('attend', [], 4, 0.34, CAP)).toEqual({ threshold: 0.625, baseline: 0.6, nBase: 4, pooled: true });
    // 死忠增长库内无历史表（stadiums 只存现值 + 本窗起点）⇒ 恒走池默认
    expect(deriveOne('fans', [], 4, 0.34, CAP)).toEqual({ threshold: 0.038, baseline: 0.03, nBase: 4, pooled: true });
    expect(deriveOne('fans', hist, 4, 0.5, CAP)).toEqual({ threshold: 0.03, baseline: 0.03, nBase: 4, pooled: true });
    // 无容量 ⇒ 上座率分母缺失，指标库层面不适用
    expect(deriveOne('attend', hist, 4, 0.34, 0)).toBeNull();
  });

  it('计数型：取「反解线 T 使 P(X ≥ T) ≥ p」；无赛果走池默认每场均值', () => {
    // 每场 1.5 分 → λ = 1.5×4 = 6：P(X≥7)=0.393 ≥ 0.34、P(X≥8)=0.256 < 0.34 ⇒ T = 7
    expect(deriveOne('points', [sample({ played: 4, points: 6 })], 4, 0.34, CAP)?.threshold).toBe(7);
    // 无历史：池默认 1.3/场 → λ = 5.2；P(X≥5)=0.594 ≥ 0.5、P(X≥6)=0.419 < 0.5 ⇒ T = 5
    expect(deriveOne('points', [], 4, 0.5, CAP)?.threshold).toBe(5);
    // 无历史：池默认 1.2/场 → λ = 4.8；P(X≥6)=0.349 ≥ 0.34、P(X≥7)=0.209 < 0.34 ⇒ T = 6
    expect(deriveOne('goals', [], 4, 0.34, CAP)?.threshold).toBe(6);
    // 零封：池默认 1/3 → Binomial(4, 1/3)；P(X≥2)=0.407 ≥ 0.34、P(X≥3)=0.111 < 0.34 ⇒ T = 2
    expect(deriveOne('cleansheet', [], 4, 0.34, CAP)?.threshold).toBe(2);
    // 满座：池默认 1/4 → Binomial(4, 0.25)；P(X≥1)=0.684 ≥ 0.34、P(X≥2)=0.262 < 0.34 ⇒ T = 1
    expect(deriveOne('sellout', [], 4, 0.34, CAP)?.threshold).toBe(1);
    // 样本口径：计数型用「本窗已排主场场次 n」反解，历史只贡献每场速率
    expect(deriveOne('goals', [sample({ played: 2, goals: 4 })], 4, 0.34, CAP)).toMatchObject({ baseline: 2, nBase: 4 });
  });
});

describe('B · G1 阈值上下限表（唯一实现点，逐条锁）', () => {
  it('attend / fans / 计数型 / sellout 的上下限与「不进池」分支全部与表同值', () => {
    // attend：floor max(B+0.01, 0.30)、ceil min(0.90, B+0.05, 1.15B)；B ≥ 0.85 不进池
    expect(betGuardBounds('attend', 4, 0.85)).toBeNull();
    expect(betGuardBounds('attend', 4, 0.6)).toEqual({ floor: 0.61, ceil: 0.65 });
    expect(betGuardBounds('attend', 0, 0.6)).toEqual({ floor: 0.61, ceil: 0.65 }); // attend 不看 n（无主场也定线，G4 在结算判）
    // 低上座队：floor(0.30) > ceil(0.23) ⇒ 必触界剔除（见 C 组「同族池只抽 1 条」旁的说明）
    const lowAttend = betGuardBounds('attend', 4, 0.2)!;
    expect(lowAttend.floor).toBe(0.3);
    expect(lowAttend.ceil).toBeCloseTo(0.23, 10); // 0.2 × 1.15 浮点尾差
    // fans：floor 0.01、ceil min(0.06, B+0.02)；B < 0.005 或 B > 0.05 不进池
    expect(betGuardBounds('fans', 4, 0.03)).toEqual({ floor: 0.01, ceil: 0.05 });
    expect(betGuardBounds('fans', 4, 0.05)).toEqual({ floor: 0.01, ceil: 0.06 });
    expect(betGuardBounds('fans', 4, 0.06)).toBeNull();
    expect(betGuardBounds('fans', 4, 0.004)).toBeNull();
    // 计数型：n < 3 一律不进池
    expect(betGuardBounds('points', 2, 1.3)).toBeNull();
    expect(betGuardBounds('points', 4, 1.3)).toEqual({ floor: 2, ceil: 8 });
    expect(betGuardBounds('points', 10, 1.3)).toEqual({ floor: 4, ceil: 22 });
    expect(betGuardBounds('goals', 2, 1.2)).toBeNull();
    expect(betGuardBounds('goals', 4, 1.2)).toEqual({ floor: 1, ceil: 9 });
    expect(betGuardBounds('cleansheet', 2, 0.33)).toBeNull();
    expect(betGuardBounds('cleansheet', 4, 0.33)).toEqual({ floor: 1, ceil: 2 });
    expect(betGuardBounds('cleansheet', 3, 0.33)).toEqual({ floor: 1, ceil: 1 });
    expect(betGuardBounds('sellout', 2, 0.25)).toBeNull();
    expect(betGuardBounds('sellout', 4, 0.25)).toEqual({ floor: 1, ceil: 3 });
    expect(betGuardBounds('sellout', 4, 0.6)).toBeNull(); // 池内满座率 > 0.5 不进池
  });

  it('prefer 权重表（design §4.8 B）：基础 1.0 × 命中倍率乘性叠加', () => {
    // 权重是浮点乘出来的（2.4×1.1 = 2.6400000000000006…），逐字段用 closeTo 比
    const expectWeights = (tags: string[], expected: Record<string, number>) => {
      const got = betWeights(tags);
      for (const [m, w] of Object.entries(expected)) expect(got[m as keyof typeof got]).toBeCloseTo(w, 10);
      expect(Object.keys(got).sort()).toEqual(['attend', 'cleansheet', 'fans', 'goals', 'points', 'sellout']);
    };
    expectWeights([], { attend: 1, sellout: 1, fans: 1, points: 1, goals: 1, cleansheet: 1 });
    expectWeights(['冠军相'], { attend: 1, sellout: 1, fans: 1, points: 2.4, goals: 1.9, cleansheet: 0.7 });
    expectWeights(['高上座'], { attend: 2.4, sellout: 1.7, fans: 1.1, points: 1, goals: 1, cleansheet: 1 });
    expectWeights(['死忠规模'], { attend: 1.1, sellout: 1, fans: 2.6, points: 1, goals: 1, cleansheet: 1 });
    expectWeights(['大场馆'], { attend: 1.6, sellout: 2.3, fans: 1, points: 0.9, goals: 1, cleansheet: 1 });
    // 冠军相 + 大场馆 ⇒ points 2.4 × 0.9 = 2.16、sellout 2.3、goals 1.9（表内示例）
    expectWeights(['冠军相', '大场馆'], { attend: 1.6, sellout: 2.3, fans: 1, points: 2.16, goals: 1.9, cleansheet: 0.7 });
    expectWeights(['高上座', '死忠规模'], { attend: 2.64, sellout: 1.7, fans: 2.86, points: 1, goals: 1, cleansheet: 1 });
  });
});

describe('C · 池装配与 G1c 兜底链（纯函数）', () => {
  it('G1b 触界剔除重抽：σ 过大把线顶出上限 ⇒ 该指标进 dropped，绝不钳低', () => {
    // 历史 [0.30, 0.80, 0.50]：B = 0.533、σ = 0.252 ⇒ 线 0.637 > ceil 0.583 ⇒ 剔除（不是钳到 0.583）
    const hist = [sample({ season: 1, windowSeq: 1, attend: 0.3 }), sample({ season: 1, windowSeq: 2, attend: 0.8 }), sample({ season: 1, windowSeq: 3, attend: 0.5 })];
    const state = deriveBetPool(hist, 0, CAP, 0.34, WEIGHTS_ALL_ONE);
    expect(state.dropped).toEqual(['attend', 'sellout', 'points', 'goals', 'cleansheet']); // attend 触界 + 四个计数型 n=0
    expect(state.breaches.map((b) => b.item.m)).toEqual(['attend']);
    expect(state.viable.map((v) => v.item.m)).toEqual(['fans']);
    // 池 = 1 ⇒ 只抽 1 条（不硬凑第二条），奖金随条数走
    const { items } = chooseBetItems(state, 0, [2, 1, 1, 12345]);
    expect(items.map((i) => i.m)).toEqual(['fans']);
    expect(items[0]!.guard).toBe('pool_default');
  });

  it('B ≥ 0.85 的 attend 不进池（基线过高，线无处可放）', () => {
    const hist = [sample({ season: 1, windowSeq: 1, attend: 0.9 }), sample({ season: 1, windowSeq: 2, attend: 0.88 })];
    const state = deriveBetPool(hist, 4, CAP, 0.34, WEIGHTS_ALL_ONE);
    expect(state.dropped).toContain('attend');
    expect(state.viable.some((v) => v.item.m === 'attend')).toBe(false);
  });

  it('兜底链 = 0：全池触界 ⇒ 取触界最轻一条钳到上限记 guard=ceil（唯一被允许的向下钳）', () => {
    // 该分支为防御性路径：fans 恒可入池（池默认基线 0.03 的线必落在 [0.01, 0.05]），
    // 生产不可达 ⇒ 用合成 state 直接锁行为（触界排序取最轻、钳到 ceil、dropped 里销账）
    const goalsItem: BetTermsItem = { m: 'goals', threshold: 20, baseline: 1.2, nBase: 4, pTarget: 0.34, guard: '' };
    const pointsItem: BetTermsItem = { m: 'points', threshold: 30, baseline: 1.3, nBase: 4, pTarget: 0.34, guard: '' };
    const state = {
      dropped: ['goals', 'points'] as const,
      viable: [],
      // goals 触界距离 (20−9)÷9 = 1.222 < points (30−8)÷8 = 2.75 ⇒ 取 goals
      breaches: [
        { item: goalsItem, distance: Math.abs((20 - 9) / 9) },
        { item: pointsItem, distance: Math.abs((30 - 8) / 8) },
      ],
    };
    const { items, dropped } = chooseBetItems({ ...state, dropped: [...state.dropped] }, 4, [1, 1, 1, 7]);
    expect(items).toEqual([{ ...goalsItem, threshold: 9, guard: 'ceil' }]); // 钳到 G1 上限 floor(4×2.4)=9
    expect(dropped).toEqual(['points']); // goals 销账（已入条款池），points 仍记 dropped
  });

  it('同族池只抽 1 条（第二条排除相关族）；异族池抽满 2 条', () => {
    const mk = (m: BetTermsItem['m']): BetTermsItem => ({ m, threshold: 1, baseline: 1, nBase: 4, pTarget: 0.34, guard: '' });
    const sameFamily = [
      { item: mk('attend'), weight: 1 },
      { item: mk('sellout'), weight: 1 },
    ];
    expect(chooseBetItems({ dropped: [], viable: sameFamily, breaches: [] }, 4, [1, 1, 1, 5]).items).toHaveLength(1);
    const twoFamilies = [
      { item: mk('attend'), weight: 1 },
      { item: mk('fans'), weight: 1 },
      { item: mk('points'), weight: 1 },
    ];
    const drawn = chooseBetItems({ dropped: [], viable: twoFamilies, breaches: [] }, 4, [1, 1, 1, 5]).items;
    expect(drawn).toHaveLength(2);
    expect(new Set(drawn.map((d) => d.m)).size).toBe(2);
    const familyOf: Record<string, string> = { attend: 'A', sellout: 'A', points: 'B', goals: 'B', fans: 'C', cleansheet: 'D' };
    expect(familyOf[drawn[0]!.m]).not.toBe(familyOf[drawn[1]!.m]);
  });

  it('无任何基线（首季新队）⇒ 比率型也走池默认基线并记 guard=pool_default', () => {
    const state = deriveBetPool([], 0, CAP, 0.34, WEIGHTS_ALL_ONE);
    expect(state.dropped).toEqual(['sellout', 'points', 'goals', 'cleansheet']); // 计数型 n=0 出池
    expect(state.viable.map((v) => [v.item.m, v.item.guard, v.item.threshold])).toEqual([
      ['attend', 'pool_default', 0.625],
      ['fans', 'pool_default', 0.038],
    ]);
  });
});

describe('D · buildBetTerms 端到端（确定性 / 基线 / 强度 / 回测）', () => {
  it('确定性：同签名恒同结果（关窗批重跑逐字一致），换窗换队换品牌则换 seed', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindTeam(fx);
    seedHistory(fx);
    const a = await buildBetTerms(fx.env, 1, '奥维恩', 2, 1);
    const b = await buildBetTerms(fx.env, 1, '奥维恩', 2, 1);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.seed).toEqual([2, 1, 1, brandHash('奥维恩')]);
    expect(a.v).toBe(2);
    expect(a.items).toHaveLength(2);
    // 单球场 ⇒ 死忠分位退化取最高 1 队 ⇒ strong（p 基值 0.34）；近 3 窗回测 hitRate 0.167 < 0.30
    // ⇒ 线太难达 ⇒ 下调一档到 0.28（钳下界 0.28），阈值随之变松（R2 回测纠偏）
    expect(a.p).toBe(0.28);
    expect(a.backtest).toEqual({ hitRate: 0.16666666666666666, windows: 3 });
    // 尺度锁（v6.51.0 复审 🔴#2）：n 取历史同尺度场次期望 —— 上座用主场尺度 4、计数型用全窗口径 8
    expect(a.items.map((i) => [i.m, i.nBase]).sort()).toEqual([['attend', 4], ['points', 8]]);
    expect(a.dropped).toEqual([]);
    // 换窗：seed 变、条款重抽（单份合同内不重抽靠快照，见 F 组）
    const c = await buildBetTerms(fx.env, 1, '奥维恩', 2, 2);
    expect(c.seed).toEqual([2, 2, 1, brandHash('奥维恩')]);
    expect(c.seed).not.toEqual(a.seed);
  });

  it('无历史（首季新队，场次期望 = 0）：计数型出池、比率型走池默认，条款照样成对落地', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindTeam(fx); // 有队映射但无历史（尺度 {0,0}）
    const t = await buildBetTerms(fx.env, 1, '奥维恩', 2, 1);
    expect(t.items.map((i) => i.m).sort()).toEqual(['attend', 'fans']);
    expect(t.items.every((i) => i.guard === 'pool_default')).toBe(true);
    expect(t.items.find((i) => i.m === 'attend')!.threshold).toBe(0.625);
    expect(t.items.find((i) => i.m === 'fans')!.threshold).toBe(0.038);
    expect(t.dropped).toEqual(['sellout', 'points', 'goals', 'cleansheet']);
  });

  it('历史 σ 过大：attend 触界剔除记 dropped，池退化成 1 条（不硬凑、不钳低）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindTeam(fx);
    seedAttendHistory(fx, [
      { season: 1, windowSeq: 1, attendances: [6000] }, // 0.30
      { season: 1, windowSeq: 2, attendances: [16000] }, // 0.80
      { season: 1, windowSeq: 3, attendances: [10000] }, // 0.50
    ]);
    const t = await buildBetTerms(fx.env, 1, '奥维恩', 2, 1);
    expect(t.dropped).toContain('attend');
    expect(t.items.map((i) => i.m)).toEqual(['fans']);
    expect(t.backtest.windows).toBe(3);
    expect(t.backtest.hitRate).toBeNull(); // fans 无历史可回放 ⇒ 纠偏跳过
  });

  it('强度三分位：近 3 窗场均积分中位 = mid（p=0.42），末位 = weak（p=0.50）', async () => {
    const mid = freshEnv();
    seedClub(mid.sqlite);
    bindTeam(mid);
    mid.sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'closed', '2026-01-01T00:00:00Z')`);
    seedResults(mid, 1, 1, [
      [9003, 9002, 2, 0], // 9003 两胜 ⇒ PPM 3.0
      [9003, 9001, 1, 0],
      [9001, 9002, 1, 0], // 9001 一胜一负 ⇒ PPM 1.5（中位）
      [9002, 9001, 2, 0],
    ]);
    expect((await buildBetTerms(mid.env, 1, '奥维恩', 2, 1)).p).toBe(BET_P_BY_STRENGTH.mid);

    const weak = freshEnv();
    seedClub(weak.sqlite);
    bindTeam(weak);
    weak.sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'closed', '2026-01-01T00:00:00Z')`);
    seedResults(weak, 1, 1, [
      [9003, 9002, 2, 0], // 9003 两胜 ⇒ 3.0
      [9003, 9001, 1, 0],
      [9002, 9001, 1, 0], // 9001 两负 ⇒ 0.0（末位）
    ]);
    const t = await buildBetTerms(weak.env, 1, '奥维恩', 2, 1);
    expect(t.strength).toBe('weak');
    expect(t.p).toBe(BET_P_BY_STRENGTH.weak);
    // p = 0.50 ⇒ z = 0 ⇒ 无历史时 attend 线 = 池默认基线 0.60，低于 G1 下限 B+0.01 ⇒ 触界剔除（design G1b）
    expect(t.dropped).toContain('attend');
  });

  it('回测纠偏：历史达线率 > 0.55 ⇒ 反向调 p（±0.06、最多两档、钳 [0.28,0.58]）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindTeam(fx);
    // 三窗上座 [0.40, 0.50, 0.50]：强队线落在 0.49 附近 ⇒ 两窗达线 ⇒ hitRate 0.667 > 0.55
    seedAttendHistory(fx, [
      { season: 1, windowSeq: 1, attendances: [8000] },
      { season: 1, windowSeq: 2, attendances: [10000] },
      { season: 1, windowSeq: 3, attendances: [10000] },
    ]);
    const t = await buildBetTerms(fx.env, 1, '奥维恩', 2, 1);
    expect(t.strength).toBe('strong');
    expect(t.p).toBeGreaterThan(BET_P_BY_STRENGTH.strong); // 线太好达 ⇒ 目标概率上调（难度上修）
    expect(t.p).toBeLessThanOrEqual(0.58);
    expect(t.p).toBeCloseTo(0.46, 5); // 0.34 + 0.06 × 2（两档封顶）
    expect(t.backtest).toEqual({ hitRate: 0.6666666666666666, windows: 3 });
    expect(t.items.length).toBeGreaterThanOrEqual(1);
  });

  it('prefer 权重偏向：冠军相让 points/goals 更常入池、cleansheet 更少（120 品牌固定样本）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindTeam(fx);
    seedHistory(fx); // 3 窗历史 ⇒ 尺度 {home:4, all:8}、六条指标全可入池
    const names: string[] = [];
    for (let i = 0; i < 60; i++) {
      names.push(`冠牌${i}`);
      names.push(`平牌${i}`);
      fx.sqlite.exec(
        `INSERT INTO brand_pool (brand, heat, source, status, industry, tier, prefer, created_at)
         VALUES ('冠牌${i}', 1.0, 'custom', 'adopted', '科技', '口碑', '冠军相', 'x')`,
      );
      fx.sqlite.exec(
        `INSERT INTO brand_pool (brand, heat, source, status, industry, tier, prefer, created_at)
         VALUES ('平牌${i}', 1.0, 'custom', 'adopted', '科技', '口碑', '', 'x')`,
      );
    }
    const firstCount: Record<string, Record<string, number>> = { 冠军相: {}, 空: {} };
    for (const name of names) {
      const pref = name.startsWith('冠牌') ? '冠军相' : '空';
      const t = await buildBetTerms(fx.env, 1, name, 2, 1);
      const first = t.items[0]!.m;
      firstCount[pref]![first] = (firstCount[pref]![first] ?? 0) + 1;
    }
    const count = (pref: string, m: string) => firstCount[pref]![m] ?? 0;
    // 第一条是纯权重轮盘：points 权重 2.4、goals 1.9、cleansheet 0.7（其余 1.0）。
    // 固定 60+60 样本下的确定性结果：冠军相 {points 22, goals 14, fans 12, attend 6, sellout 3, cleansheet 3}
    // vs 平牌（全 1.0）{fans 14, points 14, cleansheet 11, sellout 8, attend 7, goals 6}。
    expect(count('冠军相', 'points')).toBeGreaterThan(count('空', 'points') * 1.4);
    expect(count('冠军相', 'goals')).toBeGreaterThan(count('空', 'goals') * 1.5);
    expect(count('冠军相', 'cleansheet')).toBeLessThan(count('空', 'cleansheet') * 0.6);
    expect(count('冠军相', 'points')).toBeGreaterThan(count('冠军相', 'cleansheet'));
    // 量级核对（固定样本、确定性）：命中倍率 2.4 对 1.0 ⇒ 约 3 成对 1 成半
    expect(count('冠军相', 'points')).toBeGreaterThanOrEqual(12);
    expect(count('空', 'points')).toBeLessThanOrEqual(16);
  });
});

describe('E · 结算双路（windowNamingStatements）', () => {
  /** 对赌合同（base_fee 1.6、fee = 0.7 × 底价 = 1.12、4 窗） */
  function seedBetContract(sqlite: DatabaseSync, betTerms: string, over: { betAttend?: number | null; betFans?: number | null; bonus?: number } = {}): NamingContractRow {
    const betAttend = over.betAttend === undefined ? 0.8 : over.betAttend;
    const betFans = over.betFans === undefined ? 0.03 : over.betFans;
    sqlite.exec(`
      INSERT INTO naming_contracts
        (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
         windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, bet_terms, status,
         started_season, started_window, created_at, updated_at)
      VALUES (1, '奥维恩', 1.3, 1.6, 3, '对赌', 1.12,
              4, 4, ${over.bonus ?? 1.0}, ${betAttend ?? 'NULL'}, ${betFans ?? 'NULL'}, '${betTerms}', 'active',
              2, 1, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
    `);
    return sqlGet<NamingContractRow>(sqlite, 'SELECT * FROM naming_contracts WHERE club_id = 1')!;
  }

  const item = (m: BetTermsItem['m'], threshold: number): BetTermsItem => ({ m, threshold, baseline: 1, nBase: 4, pTarget: 0.34, guard: '' });
  const termsJson = (items: BetTermsItem[]): string =>
    JSON.stringify({ v: 2, seed: [2, 1, 1, 7], p: 0.34, strength: 'strong', backtest: { hitRate: null, windows: 0 }, dropped: [], items } satisfies BetTerms);

  it('两条命中各发一笔 naming_bonus（ref_type 带指标名，互不闸掉）；单窗支出 ≤ 1.20 × 底价', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const row = seedBetContract(fx.sqlite, termsJson([item('points', 3), item('goals', 4)]));
    const counts = { homePlayed: 2, played: 2, points: 6, goals: 5, cleansheet: 1, sellout: 1 };
    await fx.env.DB.batch(windowNamingStatements(fx.env, row, 2, 1, 0.5, 0.0, { counts }));
    const bonus = sqlAll<{ amount: number; ref_type: string }>(
      fx.sqlite,
      "SELECT amount, ref_type FROM ledger_entries WHERE kind = 'naming_bonus' ORDER BY ref_type",
    );
    // 每项 = 0.25 × 底价 1.6 = 0.4；两项 0.8 = 0.5 × 底价
    expect(bonus).toEqual([
      { amount: 0.4, ref_type: 'bet_goals' },
      { amount: 0.4, ref_type: 'bet_points' },
    ]);
    const fee = sqlGet<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE kind = 'naming_fee'")!.amount;
    expect(fee + bonus.reduce((s, b) => s + b.amount, 0)).toBeLessThanOrEqual(1.2 * 1.6 + 1e-9); // G2 上界
    expect(fee).toBeGreaterThanOrEqual(0.7 * 1.6 - 1e-9); // G2 下界（不达线不倒扣）
    // G5：每条条款一行审计，带 guard 与实况/线
    const audits = sqlAll<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'naming_bet_check' ORDER BY id");
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => JSON.parse(a.after))).toMatchObject([
      { metric: 'points', actual: 6, threshold: 3, hit: true, guard: '', reason: '' },
      { metric: 'goals', actual: 5, threshold: 4, hit: true, guard: '', reason: '' },
    ]);
  });

  it('合同期上限（G3）：4 窗全达 ⇒ 累计奖金 ≤ 2.0 × 底价、累计支出 ≤ 4.80 × 底价', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    let row = seedBetContract(fx.sqlite, termsJson([item('points', 3), item('goals', 4)]));
    const counts = { homePlayed: 2, played: 2, points: 6, goals: 5, cleansheet: 1, sellout: 1 };
    for (let w = 1; w <= 4; w++) {
      await fx.env.DB.batch(windowNamingStatements(fx.env, row, 2, w, 0.5, 0.0, { counts }));
      row = sqlGet<NamingContractRow>(fx.sqlite, 'SELECT * FROM naming_contracts WHERE club_id = 1')!;
    }
    const total = sqlGet<{ fee: number; bonus: number }>(
      fx.sqlite,
      `SELECT COALESCE(SUM(CASE WHEN kind = 'naming_fee' THEN amount ELSE 0 END), 0) AS fee,
              COALESCE(SUM(CASE WHEN kind = 'naming_bonus' THEN amount ELSE 0 END), 0) AS bonus
       FROM ledger_entries`,
    )!;
    expect(total.bonus).toBeLessThanOrEqual(2.0 * 1.6 + 1e-9);
    expect(total.fee + total.bonus).toBeLessThanOrEqual(4.8 * 1.6 + 1e-9);
    expect(row.status).toBe('expired'); // 4 窗走完
  });

  it('G4 无主场判不达：本窗 0 主场时上座线命中也不发钱，审计记 no_data 不倒扣', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const row = seedBetContract(fx.sqlite, termsJson([item('attend', 0.5)]));
    // 上座率 0.95 看着达标，但本窗没有主场场次 ⇒ 不得借「缺省上座率 1.0」的口径发钱
    await fx.env.DB.batch(
      windowNamingStatements(fx.env, row, 2, 1, 0.95, 0.0, { counts: { homePlayed: 0, played: 0, points: 0, goals: 0, cleansheet: 0, sellout: 0 } }),
    );
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_bonus'")?.n).toBe(0);
    const after = JSON.parse(sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'naming_bet_check'")!.after);
    expect(after).toMatchObject({ metric: 'attend', actual: null, hit: false, reason: 'no_data' });
    expect(after.note).toContain('实 无数据');
    // 样本缺失（counts 完全不传）：计数型同样判不达
    expect(evaluateBetItem(item('points', 3), null, 0.95, 0.5)).toEqual({ actual: null, hit: false });
    expect(evaluateBetItem(item('fans', 0.03), null, 0.95, 0.05)).toEqual({ actual: 0.05, hit: true }); // 死忠增长不依赖主场样本
  });

  it('v2 空条款（items 空）⇒ 零奖金不倒扣且不回退旧绝对线，审计记 no_data', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const row = seedBetContract(fx.sqlite, termsJson([]), { betAttend: 0.8, betFans: 0.03, bonus: 1.0 });
    expect(parseBetTerms(row.bet_terms)).toMatchObject({ v: 2, items: [] });
    await fx.env.DB.batch(windowNamingStatements(fx.env, row, 2, 1, 0.95, 0.9)); // 不传 counts = 样本缺失
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_bonus'")?.n).toBe(0);
    const after = JSON.parse(sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'naming_bet_check'")!.after);
    expect(after).toMatchObject({ brand: '奥维恩', reason: 'no_data', items: 0 });
  });

  it('旧格式/空串仍走旧绝对线（老合同不得抛错、行为逐字不变）', async () => {
    // 空串（v6.51.0 之前签的对赌合同）
    const legacy = freshEnv();
    seedClub(legacy.sqlite);
    const row = seedBetContract(legacy.sqlite, '', { betAttend: 0.8, betFans: 0.03, bonus: 1.0 });
    expect(parseBetTerms(row.bet_terms)).toBeNull();
    await legacy.env.DB.batch(windowNamingStatements(legacy.env, row, 2, 1, 0.85, 0.0));
    const entries = sqlAll<{ amount: number; ref_type: string; memo: string }>(
      legacy.sqlite,
      "SELECT amount, ref_type, memo FROM ledger_entries WHERE kind = 'naming_bonus'",
    );
    expect(entries).toEqual([{ amount: 1.0, ref_type: 'window', memo: '奥维恩 对赌奖金（上座/死忠达线）' }]);

    // 旧格式快照（v1 / 坏 JSON）：同样回落旧路，不抛错
    for (const raw of ['{"v":1,"attend":0.8}', 'not-json']) {
      const fx = freshEnv();
      seedClub(fx.sqlite);
      const r = seedBetContract(fx.sqlite, raw, { betAttend: 0.9, betFans: null, bonus: 1.0 });
      expect(parseBetTerms(raw)).toBeNull();
      await fx.env.DB.batch(windowNamingStatements(fx.env, r, 2, 1, 0.5, 0.01)); // 两条都不达线
      expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_bonus'")?.n).toBe(0);
      expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM naming_contracts WHERE club_id = 1')).toMatchObject({ status: 'active' });
    }
  });

  it('非对赌套餐永不发奖金（即便快照带条款）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const row = seedBetContract(fx.sqlite, termsJson([item('points', 1)]), { bonus: 1.0 });
    fx.sqlite.exec(`UPDATE naming_contracts SET package_no = 2, pkg_name = '进取' WHERE club_id = 1`);
    const again = sqlGet<NamingContractRow>(fx.sqlite, 'SELECT * FROM naming_contracts WHERE club_id = 1')!;
    await fx.env.DB.batch(
      windowNamingStatements(fx.env, again, 2, 1, 0.9, 0.9, { counts: { homePlayed: 2, played: 2, points: 9, goals: 9, cleansheet: 2, sellout: 2 } }),
    );
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_bonus'")?.n).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_fee'")?.n).toBe(1);
    expect(row.package_no).toBe(3); // 夹具确实先按对赌铺过
  });
});
