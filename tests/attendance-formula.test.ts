// v6.44.0 上座与三分收入纯算式（src/core/attendance.ts）：金样数值 + rng 消费顺序 + 唯一真源。
//
// 期望值是**死值常量**（不是用被测代码算出来的）：与 tests/home.test.ts 的既有基线（上座 7275 /
// 票 1.09 / 商 0.15 / 播 0.9 / 合计 2.14）逐字同源。算式从 home.ts 抽到 core 时若掉一个因子、
// 换一次取整或调换 rng 两口顺序，这里立刻红——这正是抽取重构要钉住的东西。
import { describe, expect, it } from 'vitest';
import { computeMatchAttendance, uniform as coreUniform, type AttendanceFactors, type AttendanceFormula } from '../src/core/attendance.ts';
import { uniform as homeUniform } from '../src/worker/home.ts';

/** 夹具基线（= tests/weather-forecast.test.ts 的场景）：premier 主队影响力 108 / 客队 90 → opp = 1+0.05×(90/108) */
const FORMULA: AttendanceFormula = {
  perturbation: [0.97, 1.03],
  sell_out_fill: [0.985, 0.999],
  ticket_revenue_per_10k: 1.5,
  commercial_per_10k_per_level: 0.1,
  broadcast_per_match_per_level: 0.3,
};

function factors(over: Partial<AttendanceFactors> = {}): AttendanceFactors {
  return {
    fans: 1800,
    capacity: 20000,
    multiplier: 4.0,
    tierCoef: 1.0,
    form: 1.0,
    wx: 0.97,
    opp: 1 + 0.05 * (90 / 108),
    nextAttendanceMod: 1,
    commercialLevel: 2,
    broadcastLevel: 3,
    ...over,
  };
}

/** 固定序列 rng（逐次吐出给定值；用尽后停在最后一个，便于断言"到底抽了几口"） */
function seq(values: number[]): { rng: () => number; calls: number } {
  const box = { calls: 0, rng: () => values[Math.min(box.calls++, values.length - 1)] };
  return box;
}

describe('上座与三分收入纯算式（v6.44.0）', () => {
  it('TC-AF-01 金样：与 home.test.ts 基线逐字同值（rng=0.5 中点）', () => {
    const r = computeMatchAttendance(FORMULA, factors(), () => 0.5);
    expect(r.demand).toBeCloseTo(7275, 6); // 1800×4.0×1.0×1.0×0.97×1.0417×1×1.0
    expect(r.fill).toBeCloseTo(0.992, 6); // 0.985+0.5×(0.999-0.985)
    expect(r.soldOut).toBe(false);
    expect(r.attendance).toBe(7275);
    expect(r.ticket).toBeCloseTo(1.09, 6); // 0.7275 万人次 × 1.5
    expect(r.commercial).toBeCloseTo(0.15, 6); // × 0.1 × 等级 2
    expect(r.broadcast).toBeCloseTo(0.9, 6); // × 0.3 × 等级 3（与上座无关）
    expect(r.total).toBeCloseTo(2.14, 6);
  });

  it('TC-AF-02 rng 消费顺序：先扰动、后满座余量（顺序反了金样就变）', () => {
    const box = seq([0, 0]);
    const r = computeMatchAttendance(FORMULA, factors({ capacity: 5000 }), box.rng);
    expect(box.calls).toBe(2);
    expect(r.demand).toBeCloseTo(7056.75, 6); // 7500 × 0.97(天气) × 0.97(扰动下沿)
    expect(r.soldOut).toBe(true); // 需求 7056.75 > 容量 5000
    expect(r.fill).toBeCloseTo(0.985, 6); // 第二口取到 0.985
    expect(r.attendance).toBe(4925); // floor(5000 × 0.985)
  });

  it('TC-AF-03 满座分支：demand ≥ capacity 走上座×余量，收入按满座上座算', () => {
    const r = computeMatchAttendance(FORMULA, factors({ fans: 10000 }), () => 0.5);
    expect(r.soldOut).toBe(true);
    expect(r.attendance).toBe(19840); // floor(20000 × 0.992)
    expect(r.ticket).toBeCloseTo(2.98, 6); // 1.984 万 × 1.5
  });

  it('TC-AF-04 需求非正 → 上座 0、票/商 0、播照发（转播收入与上座无关）', () => {
    const r = computeMatchAttendance(FORMULA, factors({ fans: 0 }), () => 0.5);
    expect(r.demand).toBe(0);
    expect(r.attendance).toBe(0);
    expect(r.ticket).toBe(0);
    expect(r.commercial).toBe(0);
    expect(r.broadcast).toBeCloseTo(0.9, 6);
    expect(r.total).toBeCloseTo(0.9, 6);
  });

  it('TC-AF-05 因子逐项生效（下一场乘数 / 天气系数 / 对手系数 / 档次 / 战绩）', () => {
    const base = computeMatchAttendance(FORMULA, factors(), () => 0.5).demand;
    const withMod = computeMatchAttendance(FORMULA, factors({ nextAttendanceMod: 1.5 }), () => 0.5).demand;
    expect(withMod).toBeCloseTo(base * 1.5, 6);
    const withWx = computeMatchAttendance(FORMULA, factors({ wx: 1.5 }), () => 0.5).demand;
    expect(withWx).toBeCloseTo(base * (1.5 / 0.97), 6);
    const withTier = computeMatchAttendance(FORMULA, factors({ tierCoef: 0.8 }), () => 0.5).demand;
    expect(withTier).toBeCloseTo(base * 0.8, 6);
    const withForm = computeMatchAttendance(FORMULA, factors({ form: 1.05 }), () => 0.5).demand;
    expect(withForm).toBeCloseTo(base * 1.05, 6);
    const withOpp = computeMatchAttendance(FORMULA, factors({ opp: 1 }), () => 0.5).demand;
    expect(withOpp).toBeCloseTo(base / (1 + 0.05 * (90 / 108)), 6);
    const withMult = computeMatchAttendance(FORMULA, factors({ multiplier: 6.0 }), () => 0.5).demand;
    expect(withMult).toBeCloseTo(base * 1.5, 6);
  });

  it('TC-AF-06 取整口径：上座向下取整、收入两位小数四舍五入', () => {
    // 需求 7275.49… → 上座 7275（不是 7276）
    const r = computeMatchAttendance(FORMULA, factors({ wx: 0.970065333 }), () => 0.5);
    expect(r.attendance).toBe(7275);
    // 票收 = round2(1.005 万 × 1.5) = round2(1.5075) = 1.51（半进位）
    const half = computeMatchAttendance(FORMULA, factors({ fans: 1800 * (10050 / 7275), wx: 0.97 }), () => 0.5);
    expect(half.attendance).toBe(10050);
    expect(half.ticket).toBeCloseTo(1.51, 6);
  });

  it('TC-AF-07 唯一真源：home.ts 再导出的 uniform 就是 core 的那一个（不许在两处各写一份）', () => {
    expect(homeUniform).toBe(coreUniform);
    expect(coreUniform(() => 0.25, 0.97, 1.03)).toBeCloseTo(0.985, 12);
  });
});
