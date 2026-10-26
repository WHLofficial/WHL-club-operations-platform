// 闹涨薪纯函数层单测（v6.54.0 步骤 2）：设计文档
// docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md rev20 的公式逐条锁——
// §5.1.1 凸曲线概率表、§5.1 生成闸与 PPS 加权抽样（不是 top-6 硬切）、§5.2 普通涨幅、
// §5.4.3 通胀公式五档（TC-RD-34）、§5.5 rc_floor 取整链（设计「取整示例」17 例 + 回补 3 例 +
// 全公式 3 例 + 归档边界，合计 24+ 例）、§5.3/§6 expires_at、还价即时判定（与现有谈判平价）、
// §5.4.4-5 段计数四反例（expired 计入 / 挂牌驱赶不计 / 同队续约不清 / 换队与回原队清零）。
// 所有期望值均为按设计公式独立算出的死值（node 逐值验证），不是用被测代码反推。
import { describe, expect, it } from 'vitest';
import {
  DEMAND_GAP_MIN,
  DEMAND_TTL_MS,
  computeDemandAmounts,
  computeRcFloor,
  counterRoll,
  countsTowardEscalation,
  demandFires,
  demandGateRoll,
  demandExpiresAt,
  demandGap,
  demandProbability,
  demandScore,
  escalatesToDirect,
  judgeCounter,
  meetsDemandGate,
  ppsPickDemands,
  roundRcFloor,
  segmentFinals,
  type DemandFinalRecord,
} from '../src/core/demand-rules.ts';
// 平价锚（§5.3「与现有谈判完全相同」）：还价判定的 eff 衰减与成功率必须与现有引擎逐字同值
import { attemptExpected, successRate } from '../src/worker/negotiation-secret.ts';

describe('§5.1.1 凸曲线概率 p = clamp(0.04 + 0.84·score^1.3, 0.04, 0.60)', () => {
  it('设计校准表逐档命中（14.4%–56.8%）', () => {
    expect(demandProbability(0.2)).toBeCloseTo(0.1436616889369616, 12);
    expect(demandProbability(0.3)).toBeCloseTo(0.21560501608785912, 12);
    expect(demandProbability(0.4)).toBeCloseTo(0.2952450184252776, 12);
    expect(demandProbability(0.5)).toBeCloseTo(0.3811460064696189, 12);
    expect(demandProbability(0.6)).toBeCloseTo(0.4723902690238238, 12);
    expect(demandProbability(0.7)).toBeCloseTo(0.5683317837728962, 12);
  });

  it('双端钳制：下限 0.04（score 0 与负值防 NaN）、上限 0.60（score ≥ 0.80 起）', () => {
    expect(demandProbability(0)).toBe(0.04);
    expect(demandProbability(-0.5)).toBe(0.04);
    expect(demandProbability(0.8)).toBe(0.6); // 裸值 0.6685 被压回
    expect(demandProbability(1)).toBe(0.6); // 裸值 0.88 被压回
  });
});

describe('§5.1 要求倾向分 score（权重 0.30/0.25/0.20/0.15/0.10）', () => {
  const base = {
    wage: 2.5,
    expected: 4.0,
    ca: 85,
    pa: 90,
    age: 24,
    isFutureStar: false,
    agentTier: 2 as const,
    firstTeam: true,
    recent: { avgRating10: 7.5, apps10: 5 },
    caRankInClub: 1,
    nFirstTeam: 12,
    caRankInPosition: 1,
    nPosition: 4,
    clubWageMedian: 5,
  };

  it('综合案例逐分量与总分对表（手算死值）', () => {
    const b = demandScore(base);
    expect(b.gap).toBeCloseTo(0.6, 12);
    expect(b.gapScore).toBeCloseTo(0.6, 12);
    // 表现 = clamp((7.5−6)/3)×0.7 + clamp(5/10)×0.3 = 0.35+0.15 = 0.5
    expect(b.performanceScore).toBeCloseTo(0.5, 12);
    expect(b.appsScore).toBeCloseTo(0.5, 12);
    expect(b.rankScore).toBe(1); // 队内第 1
    expect(b.posRankScore).toBe(1); // 位置组第 1
    expect(b.valueScore).toBeCloseTo(0.5, 12); // 2.5 / 5
    expect(b.coreScore).toBeCloseTo(0.4*0.5 + 0.25*1 + 0.2*1 + 0.15*0.5, 12); // 0.725
    // 潜力 = (90−85)/90×0.6 + (24 岁 → 0.15) = 0.0333… + 0.15
    expect(b.potentialScore).toBeCloseTo(0.18333333333333332, 12);
    expect(b.agentScore).toBe(0.5);
    expect(b.score).toBeCloseTo(0.5275, 12);
    expect(b.p).toBeCloseTo(0.4057366555678111, 12);
  });

  it('中性兜底：无近 10 场 → 表现 0.4 / 出场 0.3；无工资中位数 → valueScore 0.5', () => {
    const b = demandScore({ ...base, recent: null, clubWageMedian: null });
    expect(b.performanceScore).toBe(0.4);
    expect(b.appsScore).toBe(0.3);
    expect(b.valueScore).toBe(0.5);
  });

  it('替补（非 first_team）：appsScore 0、两个排名分落 0.15 底', () => {
    const b = demandScore({ ...base, firstTeam: false });
    expect(b.appsScore).toBe(0);
    expect(b.rankScore).toBe(0.15);
    expect(b.posRankScore).toBe(0.15);
  });

  it('排名分 0.15 底与除零守卫：垫底压 0.15；1 人队除数取 1', () => {
    expect(demandScore({ ...base, caRankInClub: 12, nFirstTeam: 12 }).rankScore).toBe(0.15);
    expect(demandScore({ ...base, caRankInPosition: 4, nPosition: 4 }).posRankScore).toBe(0.15);
    expect(demandScore({ ...base, caRankInClub: 1, nFirstTeam: 1 }).rankScore).toBe(1);
  });

  it('gapScore 钳 [0,1]；valueScore 上限钳 1；潜力按年龄 23/25 两档与未来星', () => {
    expect(demandScore({ ...base, expected: 10 }).gapScore).toBe(1); // gap 3.0 → 钳 1
    expect(demandScore({ ...base, wage: 10, clubWageMedian: 2 }).valueScore).toBe(1); // 5.0 → 钳 1
    expect(demandScore({ ...base, age: 23 }).potentialScore).toBeCloseTo((5/90)*0.6 + 0.25, 12);
    expect(demandScore({ ...base, age: 30 }).potentialScore).toBeCloseTo((5/90)*0.6, 12);
    expect(demandScore({ ...base, isFutureStar: true }).potentialScore).toBeCloseTo((5/90)*0.6 + 0.15 + 0.15, 12); // 未来星 0.15 + 24 岁档 0.15
    expect(demandScore({ ...base, agentTier: 1 }).agentScore).toBe(0);
    expect(demandScore({ ...base, agentTier: 3 }).agentScore).toBe(1);
  });

  it('下界案例（替补 + 无数据 + agentTier 1 + gap 恰 8%）：score 0.1525、p 0.1129', () => {
    const b = demandScore({
      wage: 2.5,
      expected: 2.5 * (1 + DEMAND_GAP_MIN),
      ca: 70,
      pa: 70,
      age: 30,
      isFutureStar: false,
      agentTier: 1,
      firstTeam: false,
      recent: null,
      caRankInClub: 5,
      nFirstTeam: 5,
      caRankInPosition: 2,
      nPosition: 2,
      clubWageMedian: null,
    });
    expect(b.score).toBeCloseTo(0.1525, 12);
    expect(b.p).toBeCloseTo(0.11286686464187687, 12);
  });
});

describe('§5.1 生成闸与本地门槛', () => {
  it('demandGap 与 8% 门槛', () => {
    expect(DEMAND_GAP_MIN).toBe(0.08);
    expect(demandGap(2.5, 4.0)).toBeCloseTo(0.6, 12);
    expect(meetsDemandGate(2.5, 4.0)).toBe(true);
    expect(meetsDemandGate(3, 3.2)).toBe(false); // §9.3 第三行：gap 6.7% 不触发
    expect(meetsDemandGate(0, 5)).toBe(false); // wage>0
    expect(meetsDemandGate(2.5, 2.0)).toBe(false); // expected ≥ wage
  });

  it('边界哨兵：gap 恰 8% 必须生成（锁 >=，不是 >）', () => {
    // 只有 gap 在 double 下严格等于 DEMAND_GAP_MIN 的输入才能区分 >= 与 >。
    // 反例：2.5 * (1 + DEMAND_GAP_MIN) = 2.7000000000000002、gap = 0.08000000000000007 > 0.08，
    // 拿它当「恰 8%」例会把「>= 改 >」的 off-by-one 静默放过去（2026-10-26 变异验证实证）。
    // 12.5→13.5 与 25→27 两档尺度都严格落在 0.08 上；先锁死这一点——gap 公式若改成
    // expected/wage−1 之类会挪出 1 ulp，本断言先红，提醒重挑哨兵，别让边界例悄悄失效。
    expect(demandGap(12.5, 13.5)).toBe(DEMAND_GAP_MIN);
    expect(demandGap(25, 27)).toBe(DEMAND_GAP_MIN);
    expect(meetsDemandGate(12.5, 13.5)).toBe(true);
    expect(meetsDemandGate(25, 27)).toBe(true);
    // 紧邻边界之下（差 7.97e-15）也必须拒：门槛不能被悄悄放宽
    expect(demandGap(12.5, 13.4999999999999)).toBeLessThan(DEMAND_GAP_MIN);
    expect(meetsDemandGate(12.5, 13.4999999999999)).toBe(false);
  });

  it('生成闸确定性：同 (赛季, 窗, 球员) 恒定、roll = seededUnit(..., 20)、不同窗互异', () => {
    expect(demandGateRoll(9, 1, 1)).toBeCloseTo(0.5551041725557297, 12);
    expect(demandFires(9, 2, 1, 0.2)).toBe(true); // roll 0.1534 < 0.2
    expect(demandFires(9, 2, 1, 0.1)).toBe(false);
    expect(demandFires(9, 1, 1, 0.2)).toBe(false); // 换窗 roll 0.5551 ≥ 0.2
    expect(demandFires(9, 1, 1, 0.6)).toBe(demandGateRoll(9, 1, 1) < 0.6);
  });
});

describe('§5.1 PPS 加权无放回抽样（key = −ln(u)/p，u = 1 − seededUnit([season,window,player], 21)）', () => {
  // season 9 / window 1，8 名候选 p 从 0.04 到 0.32：按设计公式独立算出的 key 序
  // = [1, 8, 4, 5, 6, 3, 2, 7]；top-6 = [1,8,4,5,6,3]，而按 p 硬切 top-6 = [8,7,6,5,4,3]。
  const candidates = Array.from({ length: 8 }, (_, i) => ({ playerId: i + 1, p: 0.04 + 0.04 * i }));

  it('取 key 最小的 6 条：低 p 球员可入选、次高 p 球员可落选（不是 top-6 硬切）', () => {
    const picks = ppsPickDemands(candidates, 9, 1);
    expect(picks.map((c) => c.playerId)).toEqual([1, 8, 4, 5, 6, 3]);
    const byP = [...candidates].sort((a, b) => b.p - a.p).slice(0, 6).map((c) => c.playerId);
    expect(byP).toEqual([8, 7, 6, 5, 4, 3]);
    expect(picks.map((c) => c.playerId)).not.toEqual(byP); // p=0.04 的 1 号在、p=0.28 的 7 号不在
  });

  it('确定性：同种子同结果', () => {
    const a = ppsPickDemands(candidates, 9, 1);
    const b = ppsPickDemands(candidates, 9, 1);
    expect(a.map((c) => c.playerId)).toEqual(b.map((c) => c.playerId));
  });

  it('候选 ≤ cap 全取；cap 可收窄；p ≤ 0 永不中', () => {
    const three = [{ playerId: 11, p: 0.1 }, { playerId: 12, p: 0.5 }, { playerId: 13, p: 0.3 }];
    expect([...ppsPickDemands(three, 9, 2)].sort((a, b) => a.playerId - b.playerId).map((c) => c.playerId)).toEqual([11, 12, 13]);
    expect(ppsPickDemands(candidates, 9, 1, 2).map((c) => c.playerId)).toEqual([1, 8]); // key 序前两条
    const withZero = [...candidates, { playerId: 99, p: 0 }];
    expect(ppsPickDemands(withZero, 9, 1, 8).map((c) => c.playerId)).not.toContain(99);
  });
});

describe('§5.2 普通涨幅 r = clamp(0.80×gap, 0.15, 0.50)', () => {
  it('设计示例：wage 2.5 / expected 4.0 → target 3.70、底线 3.33（§10.1「低于 3.33」）', () => {
    expect(computeDemandAmounts({ wage: 2.5, expected: 4.0, mode: 'normal' })).toEqual({
      target: 3.7,
      raisePct: 0.48,
      floorWage: 3.33,
    });
  });

  it('§9.3 示例：wage 8 / expected 9 → 涨幅压到下限 15%、target 9.00', () => {
    expect(computeDemandAmounts({ wage: 8, expected: 9, mode: 'normal' })).toEqual({
      target: 9,
      raisePct: 0.125,
      floorWage: 8.4,
    });
  });

  it('封顶链 target = min(round2(wage×(1+r)), expected, wageMax=20)；target ≤ wage 不生成', () => {
    // wageMax 兜底：22.5 → 20
    expect(computeDemandAmounts({ wage: 15, expected: 30, mode: 'normal' })).toEqual({
      target: 20,
      raisePct: 0.3333,
      floorWage: 18,
    });
    // expected 封顶：round2(2.5×1.15)=2.88 > expected 2.8 → 压回 2.8（gap 0.12 仍过门槛）
    expect(computeDemandAmounts({ wage: 2.5, expected: 2.8, mode: 'normal' })?.target).toBe(2.8);
    // 显式 wageMax 覆盖
    expect(computeDemandAmounts({ wage: 2.5, expected: 4.0, mode: 'normal', wageMax: 3.5 })?.target).toBe(3.5);
    // wage 21 > wageMax 20 → target 20 ≤ wage → null
    expect(computeDemandAmounts({ wage: 21, expected: 22, mode: 'normal' })).toBeNull();
  });
});

describe('§5.4.3 通胀公式 r = clamp(gap, 0.30, 0.60)——TC-RD-34 五档逐值（wage 2.5）', () => {
  // expected 按 expectedWage 两位小数口径取 round2(2.5×(1+gap))
  const cases: Array<[number, number, number, number]> = [
    // [gap, expected, 通胀 target, 普通 target]
    [0.1, 2.75, 2.75, 2.75], // gap ≤ 30%：两种公式都到顶（压在 expected 上）
    [0.25, 3.13, 3.13, 3.0], // 通胀到顶、普通 20% 留尾巴
    [0.48, 3.7, 3.7, 3.46], // 通胀一次开到市场价
    [0.6, 4.0, 4.0, 3.7], // §5.2 设计示例（普通 48% → 3.70）
    [0.9, 4.75, 4.0, 3.75], // 通胀 60% 上限压着（4.00 < expected 4.75）；普通压 50%
  ];
  it.each(cases)('gap $0%：通胀 target $2、普通 target $3', (_gap, expected, inflationTarget, normalTarget) => {
    expect(computeDemandAmounts({ wage: 2.5, expected, mode: 'inflation' })?.target).toBe(inflationTarget);
    expect(computeDemandAmounts({ wage: 2.5, expected, mode: 'normal' })?.target).toBe(normalTarget);
  });

  it('通胀 raisePct 恰为 clamp 后的实际涨幅（gap 90% 时 0.6）', () => {
    expect(computeDemandAmounts({ wage: 2.5, expected: 4.75, mode: 'inflation' })?.raisePct).toBe(0.6);
  });
});

describe('§5.5 rc_floor：取整链与 24+ 个边界例', () => {
  // 设计「取整示例」17 例（§5.5）+ 全公式例 13.56→15；currentRc 传 0 隔离纯取整链
  it.each([
    [2.4, 2],
    [2.5, 2],
    [2.6, 3],
    [2.93, 3],
    [4.2, 4],
    [4.5, 4],
    [4.51, 5],
    [5.2, 5],
    [7.4, 5],
    [7.5, 5],
    [7.51, 10],
    [12.4, 10],
    [12.5, 10],
    [12.6, 15],
    [13.56, 15],
    [17.5, 15],
    [17.6, 20],
    [23.8, 25],
  ])('取整链 raw %d → %d', (raw, expected) => {
    expect(roundRcFloor(raw, 0)).toBe(expected);
  });

  it('取整低于 current_rc 时按 raw 档位回补（设计三例：2.5→3、4.2→5、7.5→10）', () => {
    expect(roundRcFloor(2.5, 2.5)).toBe(3);
    expect(roundRcFloor(4.2, 4.2)).toBe(5);
    expect(roundRcFloor(7.5, 7.5)).toBe(10);
    expect(roundRcFloor(12.4, 12)).toBe(15); // 链 10 < 12 → +5
  });

  it('归档副作用边界：current_rc=5 且 raw ≤ 7.5 回到 5；raw=5 原地不动', () => {
    expect(roundRcFloor(7.5, 5)).toBe(5);
    expect(roundRcFloor(5, 5)).toBe(5);
  });

  it('全公式（§5.5 示例）：RC 20/score 0.7 → 25；RC 2.5/score 0.6 → 3；RC 12/score 0.4 → 15', () => {
    expect(computeRcFloor({ currentRc: 20, score: 0.7, mode: 'normal' })).toBe(25);
    expect(computeRcFloor({ currentRc: 2.5, score: 0.6, mode: 'normal' })).toBe(3);
    expect(computeRcFloor({ currentRc: 12, score: 0.4, mode: 'normal' })).toBe(15);
  });

  it('rc_raise 边界：score 0 → 5%（raw 21 归档回 20）；score 1 → 25%；通胀恒顶格不看 score', () => {
    expect(computeRcFloor({ currentRc: 20, score: 0, mode: 'normal' })).toBe(20);
    expect(computeRcFloor({ currentRc: 20, score: 1, mode: 'normal' })).toBe(25);
    expect(computeRcFloor({ currentRc: 20, score: 0, mode: 'inflation' })).toBe(25); // §10.1 违约金 20→25
    expect(computeRcFloor({ currentRc: 8, score: 1, mode: 'inflation' })).toBe(10);
    expect(computeRcFloor({ currentRc: 0, score: 0.9, mode: 'normal' })).toBe(0); // 无 RC 退化 wage-only
  });
});

describe('§5.3/§6 expires_at = min(生成 + 3 日, 关窗)', () => {
  it('3 天早于关窗 → 3 天；关窗更早 → 关窗；恰好相等取同值', () => {
    expect(DEMAND_TTL_MS).toBe(3 * 24 * 3600_000);
    expect(demandExpiresAt(0, DEMAND_TTL_MS)).toBe(DEMAND_TTL_MS);
    expect(demandExpiresAt(0, 86_400_000)).toBe(86_400_000);
    expect(demandExpiresAt(1000, 10 ** 12)).toBe(1000 + DEMAND_TTL_MS);
  });
});

describe('§5.3 还价即时判定（roll 钉 seededUnit([demand_id, round], 21)）', () => {
  // target 3.70 / floor 3.33（§5.2 示例值）；demand 1 各轮掷点：
  // r1 0.532381、r2 0.945757、r3 0.482847（node 按 seededUnit 死值算出）
  it('c ≥ target 直接成交（不看 roll）；c < floor → lowball 终局', () => {
    expect(judgeCounter({ demandId: 1, round: 1, counter: 3.7, targetWage: 3.7, floorWage: 3.33 })).toMatchObject({
      verdict: 'accepted',
      acceptedWage: 3.7,
      p: 1,
    });
    expect(judgeCounter({ demandId: 1, round: 3, counter: 4.0, targetWage: 3.7, floorWage: 3.33 }).verdict).toBe('accepted');
    const low = judgeCounter({ demandId: 1, round: 3, counter: 3.0, targetWage: 3.7, floorWage: 3.33 });
    expect(low.verdict).toBe('lowball');
    expect(low.acceptedWage).toBeNull();
    expect(low.p).toBe(0);
  });

  it('floor 本身不是 lowball（c = floor 走成功率判定）', () => {
    // p(3.33 vs 3.70) = 0.9047 > roll 0.5324 → accepted
    expect(judgeCounter({ demandId: 1, round: 1, counter: 3.33, targetWage: 3.7, floorWage: 3.33 }).verdict).toBe('accepted');
  });

  it('区间内按 roll < p 判定（注入掷点覆盖分支；区间 c ∈ [floor, target)）', () => {
    // r1：eff=3.70，p(3.40 vs 3.70)=0.9356 → roll 0.5 接受（按 3.40）、roll 0.95 判拒进谈判
    expect(judgeCounter({ demandId: 1, round: 1, counter: 3.4, targetWage: 3.7, floorWage: 3.33, roll: 0.5 })).toMatchObject({
      verdict: 'accepted',
      acceptedWage: 3.4,
      eff: 3.7,
    });
    expect(judgeCounter({ demandId: 1, round: 1, counter: 3.4, targetWage: 3.7, floorWage: 3.33, roll: 0.95 }).verdict).toBe('negotiating');
    // r2：eff 衰减 3.52，p(3.40 vs 3.52)=0.9766 → roll 0.9 接受、roll 0.99 谈判中
    expect(judgeCounter({ demandId: 1, round: 2, counter: 3.4, targetWage: 3.7, floorWage: 3.33, roll: 0.9 })).toMatchObject({
      verdict: 'accepted',
      eff: 3.52,
    });
    expect(judgeCounter({ demandId: 1, round: 2, counter: 3.4, targetWage: 3.7, floorWage: 3.33, roll: 0.99 }).verdict).toBe('negotiating');
    // r3：判拒即谈崩终局（没有下一轮）
    expect(judgeCounter({ demandId: 1, round: 3, counter: 3.4, targetWage: 3.7, floorWage: 3.33, roll: 0.99 }).verdict).toBe('collapse');
  });

  it('轮次溢出防御：round > 3 时判拒不再返回 negotiating', () => {
    expect(
      judgeCounter({ demandId: 1, round: 4, counter: 3.4, targetWage: 3.7, floorWage: 3.33, roll: 0.99 }).verdict,
    ).toBe('collapse');
  });

  it('不注入 roll 时用确定性种子：counterRoll 死值 + demand 7 真实判定', () => {
    expect(counterRoll(7, 3)).toBeCloseTo(0.30992611800320446, 12);
    expect(counterRoll(7, 1)).toBeCloseTo(0.9156219121068716, 12);
    // r1 c=3.33（恰在底线上）：p=0.9047 < roll 0.9156 → 谈判中
    expect(judgeCounter({ demandId: 7, round: 1, counter: 3.33, targetWage: 3.7, floorWage: 3.33 }).verdict).toBe('negotiating');
    // r1 c=3.40：p=0.9356 > 0.9156 → 接受
    expect(judgeCounter({ demandId: 7, round: 1, counter: 3.4, targetWage: 3.7, floorWage: 3.33 }).verdict).toBe('accepted');
    // r3 c=3.40：p=0.9766 > roll 0.3099 → 接受
    expect(judgeCounter({ demandId: 7, round: 3, counter: 3.4, targetWage: 3.7, floorWage: 3.33 }).verdict).toBe('accepted');
    expect(counterRoll(7, 3)).toBe(counterRoll(7, 3)); // 同 (demand, round) 恒定
    expect(counterRoll(7, 3)).not.toBe(counterRoll(7, 2));
  });

  it('与现有谈判引擎平价（§5.3「与现有谈判完全相同」）：eff 衰减与成功率逐字同值', () => {
    expect(attemptExpected(3.7, 1, 0.95)).toBe(3.7);
    expect(attemptExpected(3.7, 2, 0.95)).toBe(3.52);
    expect(attemptExpected(3.7, 3, 0.95)).toBe(3.52); // 与现有引擎同：>1 轮统一乘一次，不叠加
    for (const round of [1, 2, 3]) {
      const r = judgeCounter({ demandId: 1, round, counter: 3.4, targetWage: 3.7, floorWage: 3.33 });
      expect(r.eff).toBe(attemptExpected(3.7, round, 0.95));
      expect(r.p).toBe(successRate(3.4, r.eff, -9, 0.8));
    }
  });
});

describe('§5.4.4-5 段计数与升档判定', () => {
  const H = 3600_000;
  const D = 24 * H;
  // 时间轴：t1 首签 → t2 终局 → t3 同队续约 / 换队 / 回原队 → t4、t5 …
  it('单条终局计入口径：rejected 三档与 expired 恒计；挂牌驱赶的过期不计（§5.4.5）', () => {
    expect(countsTowardEscalation('direct')).toBe(true);
    expect(countsTowardEscalation('collapse')).toBe(true);
    expect(countsTowardEscalation('lowball')).toBe(true);
    expect(countsTowardEscalation('expired')).toBe(true); // rev20：放任过期也算一次
    expect(countsTowardEscalation('expired', true)).toBe(false); // 挂牌驱赶 = 给出路
  });

  it('同队续约不清零（堵洗计数）：amendment 不改 club_id，历史延续', () => {
    const rows: DemandFinalRecord[] = [
      { kind: 'expired', clubId: 1, at: 2 * D },
      { kind: 'direct', clubId: 1, at: 4 * D }, // t3 的同队续约夹在中间，不产生新段
    ];
    expect(segmentFinals(rows, 1, 1 * D)).toHaveLength(2);
  });

  it('换队清零：新东家段内历史为空', () => {
    const rows: DemandFinalRecord[] = [
      { kind: 'expired', clubId: 1, at: 2 * D },
      { kind: 'collapse', clubId: 1, at: 3 * D },
    ];
    expect(segmentFinals(rows, 2, 4 * D)).toHaveLength(0); // t4 转会到 2 队
    expect(escalatesToDirect(segmentFinals(rows, 2, 4 * D).length)).toBe(false); // 新段从零
  });

  it('回原队 = 新段从零（owner 裁决）：旧段行被段锚排除，买回补记的过期计入新段', () => {
    const rows: DemandFinalRecord[] = [
      { kind: 'expired', clubId: 1, at: 2 * D }, // 旧段终局（首段效力期）
      { kind: 'expired', clubId: 1, at: 5 * D, byListing: false }, // 买回（A 分支）补记的一次 expired
    ];
    // 段锚 = 最近一次入队时刻 = 买回完成时刻 5*D → 旧段行（at=2D）不算
    expect(segmentFinals(rows, 1, 5 * D).map((r) => r.at)).toEqual([5 * D]);
    // 对照：若无锚（null 退化口径）会误数旧账 —— 锁定锚参数的必要性
    expect(segmentFinals(rows, 1, null)).toHaveLength(2);
  });

  it('反例锁：锚喂成买回恢复的 signed_at（旧段起点 1*D）→ 旧段行全量混入', () => {
    // 设计 rev20：买回 A 分支恢复的快照 signed_at 是离开前旧值（= 旧段起点 1*D，不是买回时刻）。
    // 若 worker 拿现行合同 signed_at 当锚，旧段终局行 at(2D) ≥ 1D 过滤不掉，「新段从零」被静默破坏：
    // escalatesToDirect 提前一窗触发直拒三件套（全联盟通告 + 保护期失效，不可逆广播动作）。
    // 本例钉死这个混入形状 —— 将来有人把锚改回 signed_at，看到 2 行就该知道口径错了。
    const rows: DemandFinalRecord[] = [
      { kind: 'expired', clubId: 1, at: 2 * D }, // 旧段终局
      { kind: 'expired', clubId: 1, at: 5 * D }, // A2 买回补记的 expired（at = 买回时刻）
    ];
    expect(segmentFinals(rows, 1, 1 * D)).toHaveLength(2); // 旧段行混入 = 错误口径的特征形状
    // 同锚下 direct 买回（不补记终局）后的首次新终局也会被旧账顶成升档：
    expect(escalatesToDirect(segmentFinals([{ kind: 'expired', clubId: 1, at: 2 * D }], 1, 1 * D).length)).toBe(true);
  });

  it('挂牌驱赶不计入累计：混在历史里被过滤', () => {
    const rows: DemandFinalRecord[] = [
      { kind: 'expired', clubId: 1, at: 2 * D, byListing: true }, // §11.2 挂牌自动过期
      { kind: 'expired', clubId: 1, at: 4 * D },
    ];
    expect(segmentFinals(rows, 1, 1 * D).map((r) => r.at)).toEqual([4 * D]);
  });

  it('expired + 谈崩混计到第 2 次即升档：先过期一次，再谈崩 → 走直拒三件套', () => {
    const history: DemandFinalRecord[] = [{ kind: 'expired', clubId: 1, at: 2 * D }];
    const soFar = segmentFinals(history, 1, 1 * D).length;
    expect(soFar).toBe(1);
    expect(escalatesToDirect(soFar)).toBe(true); // 本次 collapse 升档
  });

  it('升档判定：首次终局不升档，第 2 次及以后升档', () => {
    expect(escalatesToDirect(0)).toBe(false);
    expect(escalatesToDirect(1)).toBe(true);
    expect(escalatesToDirect(2)).toBe(true);
  });
});
