// 比赛日上座与三分收入（纯算式，v6.44.0 从 worker/home.ts 抽出）。
//
// 为什么抽出来：这条算式现在有三个消费方——赛果确认钩子④（worker/home.ts）、
// 天气同步端点的历史账订正批（scripts/prod-*/gen-recalc-sql）、以及插件侧 Python 的同一套公式。
// 算式留在 worker 里，订正脚本就只能抄一份，抄错一个系数是**静默**的（数字仍然"看着对"），
// 所以这里做唯一真源：worker 与脚本都调这一个函数，插件侧靠跨仓金标准向量对齐。
//
// 纯函数：零 IO、零 DB、零 env；随机只经 rng 参数进来（默认 Math.random），
// 于是测试可以钉死序列、订正脚本可以塞固定种子重放。
//
// 消费端顺序（改这里等于改 rng 的消费序列，home.ts 的既有数值基线会立刻红）：
// 天气掷出 → 天气系数 → 需求（perturbation）→ 满座余量（fill）。本文件只管后两口。
/** 算式参数（worker/home.ts 的 AttendanceModel 结构性满足它——那边直接传 model 即可；
 *  本文件不 import worker 侧类型，core → worker 的反向依赖只留注释不留代码） */
export interface AttendanceFormula {
  perturbation: [number, number];
  sell_out_fill: [number, number];
  ticket_revenue_per_10k: number;
  commercial_per_10k_per_level: number;
  broadcast_per_match_per_level: number;
}

/** 单场因子（全部由调用方解析好：球场、级别、战绩、天气、对手、设施） */
export interface AttendanceFactors {
  /** 球场死忠基数（stadiums.fans） */
  fans: number;
  /** 球场容量 */
  capacity: number;
  /** 容量倍数：attendance_multiplier_base × (1 + per_tier × tier) */
  multiplier: number;
  /** 球场档次系数（tier_table.attend_coef） */
  tierCoef: number;
  /** 近 3 场战绩系数（form_coef_table[pts]） */
  form: number;
  /** 天气系数（预报值 / 事件预置 / 现抽） */
  wx: number;
  /** 对手系数：主队影响力 ≤0 时 1，否则 1 + 0.05 × 客队影响力/主队影响力 */
  opp: number;
  /** 下一场上座乘数（随机事件一次性预置，默认 1） */
  nextAttendanceMod: number;
  commercialLevel: number;
  broadcastLevel: number;
}

export interface AttendanceBreakdown {
  /** 未取整需求（含扰动与满座前的一切因子） */
  demand: number;
  /** 满座余量抽值（仅在满座时参与取整） */
  fill: number;
  soldOut: boolean;
  attendance: number;
  ticket: number;
  commercial: number;
  broadcast: number;
  total: number;
}

/** 区间均匀抽（v6.15.0 起导出：预报侧抽天气系数与消费端同源）。 */
export function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** 分转元：收入一律两位小数四舍五入（与插件 formula 口径同）。订正批（scripts 下 prod 批的 gen-recalc-sql.ts）
 *  也 import 这一个，避免脚本抄一份取整口径——抄错是静默的（数字仍然"看着对"）。 */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 算一场比赛日的上座与三分收入（票/商/播）。
 * 满座（demand ≥ capacity）时上座 = floor(capacity × fill)，否则 = floor(max(0, demand))。
 * 广播收入与上座无关（按转播设施等级逐场固定），票/商按「万人次 × 单位收入 × 等级」。
 */
export function computeMatchAttendance(
  formula: AttendanceFormula,
  factors: AttendanceFactors,
  rng: () => number = Math.random,
): AttendanceBreakdown {
  const demand =
    factors.fans *
    factors.multiplier *
    factors.tierCoef *
    factors.form *
    factors.wx *
    factors.opp *
    factors.nextAttendanceMod *
    uniform(rng, formula.perturbation[0], formula.perturbation[1]);
  const fill = uniform(rng, formula.sell_out_fill[0], formula.sell_out_fill[1]);
  const soldOut = demand >= factors.capacity;
  const attendance = soldOut ? Math.floor(factors.capacity * fill) : Math.floor(Math.max(0, demand));

  const wan = attendance / 10000;
  const ticket = round2(wan * formula.ticket_revenue_per_10k);
  const commercial = round2(wan * formula.commercial_per_10k_per_level * factors.commercialLevel);
  const broadcast = round2(formula.broadcast_per_match_per_level * factors.broadcastLevel);
  return {
    demand,
    fill,
    soldOut,
    attendance,
    ticket,
    commercial,
    broadcast,
    total: round2(ticket + commercial + broadcast),
  };
}
