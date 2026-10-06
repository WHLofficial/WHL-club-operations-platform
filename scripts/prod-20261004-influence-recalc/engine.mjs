// v6.28.0 C 段「影响力图值导入 + 死忠重算 + 历史链式重演」的**纯函数**重演引擎。
// 为什么单独抽一个不含任何 I/O 的引擎：本批要对生产历史做一次全量重记，出数的可信度必须能被
// 单元测试逐字交叉验证（tests/influence-recalc-engine.test.ts 用同一夹具同时喂本引擎与
// src/worker/home.ts 的真实函数，断言两者字面相等）。因此这里的每个公式都是 home.ts 的逐行镜像，
// **任何一处改动都必须同步改 home.ts**——两处口径漂移会让重演数据与线上运行期不一致。
//
// 镜像源（home.ts 行号以 v6.28.0 落地时为准）：
//   abilityTier/playerAbilityLevel/playerInfluenceSum  = home.ts:102-137
//   teamInfluence/influenceTierCoef                    = home.ts:141-166
//   uniform/rollWeather/asRange                        = home.ts:169-189
//   formPtsOf                                          = home.ts:193-225
//   diehardTarget/evolveFans                           = home.ts:242-286
//   matchAttendanceStatements（上座 demand/收入/每场演化）= home.ts:311-459
//
// 与运行期的**唯一**差别（重演口径，见 README）：
//   1) 随机项（perturbation / weather_ranges 的 wx / sell_out_fill）一律取 rng=0.5 的取值，
//      即区间表达式 lo + 0.5*(hi-lo) 的"期望中点"，而不是历史那次抽样的复现；
//   2) 天气不重掷，直接用 match_attendance 里已记录的 weather（wx 仍按 (1) 取中点）；
//   3) form 取自"本场确认那一刻"的 result_confirmations（replay 靠 RC id 切时间点，见 formPtsBefore）。
// 因为 uniform(rng=0.5) 与"区间中点"在浮点上可能差最后一位，本引擎统一实现 uniformAt(0.5,...)，
// 保证与运行期（测试里 rng=()=>0.5）**逐位**相等。

/** 出厂默认（镜像 src/core/config.ts:132-162 的 CONFIG_DEFAULTS；生产 config 表只有 3 个无关键）。 */
export const MODEL_DEFAULTS = Object.freeze({
  weather_probabilities: { 晴: 0.4, 多云: 0.3, 雨: 0.2, 雪: 0.1 },
  weather_ranges: { 晴: [1.05, 1.25], 多云: [0.9, 1.04], 雨: [0.8, 0.89], 雪: [0.75, 0.79] },
  form_coef_table: { 0: 0.7, 1: 0.74, 2: 0.85, 3: 0.94, 4: 1.0, 5: 1.04, 6: 1.1, 7: 1.19, 8: 1.22, 9: 1.25 },
  attendance_multiplier_base: 4.0,
  attendance_multiplier_per_tier: 0.35,
  ticket_revenue_per_10k: 1.5,
  commercial_per_10k_per_level: 0.1,
  broadcast_per_match_per_level: 0.3,
  sell_out_fill: [0.985, 0.999],
  perturbation: [0.97, 1.03],
  neutral_form_pts: 4,
  default_influence: 90,
  fans_target_table: {
    bands: [
      { max_influence: 120, slope: 26 },
      { max_influence: 160, slope: 22 },
      { max_influence: 200, slope: 15 },
      { max_influence: 0, slope: 12 },
    ],
  },
  fans_cap: 10000,
  fans_grow_rate: 0.5,
  fans_grow_heat_base: 0.6,
  fans_grow_heat_span: 0.4,
  fans_drop_rate: 0.5,
  fans_drop_heat_extra: 0.8,
  influence_coef_growable: 0.25,
  influence_coef_static: 0.13,
});

export const TIER_TABLE_DEFAULTS = Object.freeze({
  0: { name: '社区级', min_seats: 12000, max_seats: 25000, base_maintenance: 2.0, per_10k_rate: 0.8, attend_coef: 1.0, upgrade_cost: 3.0 },
  1: { name: '地区级', min_seats: 20000, max_seats: 35000, base_maintenance: 5.0, per_10k_rate: 0.55, attend_coef: 1.1, upgrade_cost: 4.5 },
  2: { name: '大区级', min_seats: 25000, max_seats: 45000, base_maintenance: 8.0, per_10k_rate: 0.35, attend_coef: 1.2, upgrade_cost: 6.0 },
  3: { name: '国家级', min_seats: 35000, max_seats: 60000, base_maintenance: 11.0, per_10k_rate: 0.28, attend_coef: 1.3, upgrade_cost: 10.0 },
  4: { name: '国际级', min_seats: 50000, max_seats: 100000, base_maintenance: 14.0, per_10k_rate: 0.2, attend_coef: 1.4, upgrade_cost: 0.0 },
});

export const INFLUENCE_TIER_COEF_DEFAULTS = Object.freeze({ premier: 1.2, second: 1.0 });

/** B 段 per-match 涨/掉系数出厂默认（config.ts:265-266；关窗兜底仍走 attendance_model 窗系数）。 */
export const PER_MATCH_DEFAULTS = Object.freeze({ fans_grow_rate_per_match: 0.2, fans_drop_rate_per_match: 0.2 });

/** 深拷贝（调用方可能改模型对象，出厂默认表是冻结的只读真源）。 */
export function cloneModel(model = MODEL_DEFAULTS) {
  return JSON.parse(JSON.stringify(model));
}

// ─────────────────────────── 影响力（A 段） ───────────────────────────

/** 能力等级十档表（镜像 home.ts:102）。 */
export function abilityTier(v) {
  if (v === null) return 1;
  if (v >= 93) return 10;
  if (v >= 90) return 9;
  if (v >= 87) return 8;
  if (v >= 84) return 7;
  if (v >= 80) return 6;
  if (v >= 75) return 5;
  if (v >= 70) return 4;
  if (v >= 65) return 3;
  if (v >= 60) return 2;
  return 1;
}

/** 可成长=(CA档+PA档)/2、非成长=CA档（镜像 home.ts:117）。 */
export function playerAbilityLevel(ca, pa, growable) {
  if (growable && ca !== null && pa !== null) return (abilityTier(ca) + abilityTier(pa)) / 2;
  return abilityTier(ca);
}

/** Σ(系数×能力等级×国际声望)（镜像 home.ts:123；rows 为在册现行合同关联的球员行）。 */
export function playerInfluenceSum(rows, model) {
  let sum = 0;
  for (const p of rows) {
    const coef = p.growable ? model.influence_coef_growable : model.influence_coef_static;
    sum += coef * playerAbilityLevel(p.ca, p.pa, p.growable ?? 0) * (p.prestige ?? 0);
  }
  return sum;
}

/** （队壳+Σ球员）×级别系数+奖励分（镜像 home.ts:141）。 */
export function teamInfluence(stadium, playerSum, tierCoef) {
  return (stadium.shell_influence + playerSum) * tierCoef + stadium.bonus_points;
}

/** 级别系数：null/缺键/非有限数一律 1.0（镜像 home.ts:150）。 */
export function influenceTierCoef(coefs, tier) {
  const v = tier === null ? undefined : coefs?.[tier];
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

// ─────────────────────────── 上座与收入 ───────────────────────────

/** 区间均匀抽（镜像 home.ts:182：lo + rng*(hi-lo)，顺序不可换，否则浮点尾位会漂）。 */
export function uniform(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

/** 重演口径：随机项取 rng=0.5 的取值（= 区间中点，见文件头注释）。 */
export function midpoint(lo, hi) {
  return uniform(() => 0.5, lo, hi);
}

/** 天气概率表掷出（镜像 home.ts:169；重演不用，保留供测试对拍）。 */
export function rollWeather(rng, probabilities) {
  const items = Object.entries(probabilities);
  if (items.length === 0) return '多云';
  const total = items.reduce((s, [, p]) => s + p, 0);
  let r = rng() * total;
  for (const [name, p] of items) {
    r -= p;
    if (r <= 0) return name;
  }
  return items[items.length - 1][0];
}

/** [lo,hi] 二元区间校验（镜像 home.ts:187）。 */
export function asRange(v) {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;
}

/** 近 3 场战绩 Pts（胜3平1负0、点球按平、**弃权按弃权方判负**、不足 3 场中性 4；镜像 home.ts formPtsOf）。
 *  弃权口径 2026-10-06 订正：walkover_side 记的是弃权方（判负方）——'home' = 主队弃权、'away' = 客队弃权、
 *  'both' = 双弃权双方各记一负（见 src/core/walkover.ts 与生产批 scripts/prod-20261006-s9-walkover-fix）。 */
export function formPtsOf(rows, clubId) {
  let pts = 0;
  let seen = 0;
  for (const r of rows) {
    if (seen >= 3) break;
    if (r.home_team_id === null || r.away_team_id === null) continue;
    let won = null;
    let drew = false;
    if (r.walkover_side === 'home' || r.walkover_side === 'away' || r.walkover_side === 'both') {
      const ours = r.home_team_id === clubId ? 'home' : 'away';
      won = r.walkover_side === 'both' ? false : r.walkover_side !== ours;
    } else if (r.score_home !== null && r.score_away !== null) {
      if (r.score_home === r.score_away) drew = true;
      else won = (r.score_home > r.score_away ? r.home_team_id : r.away_team_id) === clubId;
    }
    if (won === null && !drew) continue;
    pts += drew ? 1 : won ? 3 : 0;
    seen++;
  }
  if (seen < 3) return 4;
  return pts;
}

/**
 * 重演版战绩：取"本场确认那一刻"能看到的历史 RC 行。
 * 运行期 clubFormPts 的视图 = `WHERE (home=? OR away=?) AND match_id != 本场 ORDER BY id DESC LIMIT 9`；
 * 确认批是"先插 RC、后跑钩子"（results.ts confirmResult），所以那一刻可见的历史恰好是
 * 「同一 tour 队、RC.id 小于本场 RC.id」的行——本函数按 id 切时间点，再套 formPtsOf。
 */
export function formPtsBefore(rcRows, rcId, tourTeamId) {
  const rows = rcRows
    .filter((r) => r.id < rcId && (r.home_team_id === tourTeamId || r.away_team_id === tourTeamId))
    .sort((a, b) => b.id - a.id)
    .slice(0, 9);
  return formPtsOf(rows, tourTeamId);
}

/** 档位系数（tier_table[tier].attend_coef ?? 1；镜像 home.ts:355）。 */
export function attendTierCoef(tierTable, tier) {
  return tierTable?.[String(tier)]?.attend_coef ?? 1;
}

/** 上座乘数 = base × (1 + per_tier × tier)（镜像 home.ts:356）。 */
export function attendanceMultiplier(model, tier) {
  return model.attendance_multiplier_base * (1 + model.attendance_multiplier_per_tier * tier);
}

/** 对手系数（镜像 home.ts:375；主队影响力 ≤0 取 1，不放大需求）。 */
export function opponentCoef(homeInfluence, awayInfluence) {
  return homeInfluence <= 0 ? 1 : 1 + 0.05 * (awayInfluence / homeInfluence);
}

/**
 * 一场上座（镜像 home.ts:345-387 的非随机部分）。
 * ctx：{model, tierTable, fans, capacity, tier, nextAttendanceMod, weather, wxOverride, formPts,
 *       homeInfluence, awayInfluence}
 * weather 必须由调用方给出（重演用已落库天气；运行期由 预置>预报>现掷 三级决定）。
 */
export function computeAttendance(ctx) {
  const { model, tierTable } = ctx;
  const wxRange = asRange(model.weather_ranges[ctx.weather]);
  // 有赛前预报时 wx 直用落库系数（运行期同口径）；否则取区间中点
  const wx = ctx.wxOverride ?? (wxRange ? midpoint(wxRange[0], wxRange[1]) : 1);
  const form = model.form_coef_table[String(Math.min(Math.max(ctx.formPts, 0), 9))] ?? 1;
  const tierCoef = attendTierCoef(tierTable, ctx.tier);
  const multiplier = attendanceMultiplier(model, ctx.tier);
  const opp = opponentCoef(ctx.homeInfluence, ctx.awayInfluence);
  const demand =
    ctx.fans * multiplier * tierCoef * form * wx * opp * ctx.nextAttendanceMod * midpoint(model.perturbation[0], model.perturbation[1]);
  const fill = midpoint(model.sell_out_fill[0], model.sell_out_fill[1]);
  const attendance = demand >= ctx.capacity ? Math.floor(ctx.capacity * fill) : Math.floor(Math.max(0, demand));
  return { wx, form, formCoef: form, tierCoef, multiplier, opp, demand, fill, attendance, soldOut: demand >= ctx.capacity };
}

/** 三分收入（镜像 home.ts:391-395；levels = {commercial, broadcast} 设施等级）。 */
export function computeRevenue(model, attendance, levels = {}) {
  const wan = attendance / 10000;
  const ticket = Math.round(wan * model.ticket_revenue_per_10k * 100) / 100;
  const commercial = Math.round(wan * model.commercial_per_10k_per_level * (levels.commercial ?? 0) * 100) / 100;
  const broadcast = Math.round(model.broadcast_per_match_per_level * (levels.broadcast ?? 0) * 100) / 100;
  const total = Math.round((ticket + commercial + broadcast) * 100) / 100;
  return { ticket, commercial, broadcast, total };
}

// ─────────────────────────── 死忠（B 段） ───────────────────────────

/** 死忠目标：影响力-死忠阶梯逐带累计（镜像 home.ts:242）。 */
export function diehardTarget(model, influence) {
  const bands = [...(model.fans_target_table.bands ?? [])].sort(
    (a, b) => (a.max_influence <= 0 ? 1 : 0) - (b.max_influence <= 0 ? 1 : 0) || a.max_influence - b.max_influence,
  );
  let target = 0;
  let lower = 0;
  for (const band of bands) {
    const upper = band.max_influence <= 0 ? influence : Math.min(influence, band.max_influence);
    if (upper > lower) target += (upper - lower) * band.slope;
    if (band.max_influence <= 0 || influence <= band.max_influence) break;
    lower = band.max_influence;
  }
  return target;
}

/** 死忠演化（镜像 home.ts:260；opts.growRate/dropRate 覆盖两侧系数）。 */
export function evolveFans(model, fans, target, attendRate, formPts, youthLevel = 0, fansBuff = 0, opts = {}) {
  const growRate = opts.growRate ?? model.fans_grow_rate;
  const dropRate = opts.dropRate ?? model.fans_drop_rate;
  const diff = target - fans;
  let next;
  if (diff > 0) {
    let coef = growRate * (model.fans_grow_heat_base + model.fans_grow_heat_span * attendRate);
    coef *= 1 + 0.03 * youthLevel;
    coef *= 1 + fansBuff;
    next = fans + diff * coef;
  } else {
    const coef = dropRate * (1 + model.fans_drop_heat_extra * (1 - attendRate));
    next = fans + diff * coef;
  }
  if (formPts >= 7) next *= 1.05;
  else if (formPts <= 1) next *= 0.95;
  return Math.min(Math.max(next, 0), model.fans_cap);
}

/** 每场演化的推进（镜像 home.ts:412-423）：上座率=上座/容量，目标=diehardTarget(主队影响力)。 */
export function advanceFans(ctx) {
  const { model } = ctx;
  const target = diehardTarget(model, ctx.homeInfluence);
  const attendRate = ctx.capacity > 0 ? ctx.attendance / ctx.capacity : 1;
  const nextFans = evolveFans(model, ctx.fans, target, attendRate, ctx.formPts, ctx.youthLevel ?? 0, ctx.fansBuff ?? 0, {
    growRate: ctx.growRate,
    dropRate: ctx.dropRate,
  });
  return { target, attendRate, nextFans };
}

/**
 * 关窗收尾的 fans 推进（镜像 home.ts:619-632）。
 * 关键口径（B 段防双记账）：**本窗有主场场次的队已在钩子④按 per-match 系数演化过 ⇒ 关窗不再演化**
 * （played>0 时 evolved = 现值）；无主场场次的队才按窗系数（evolveFans 缺省 0.5）兜底演化一次，
 * attendRate 由调用方给（无场次时运行期取 1）。mood 是窗级经营信号（v6.12.0 D3），演化之后按 % 修正再钳。
 * 生产 16 队全部有主场 ⇒ 本批只走 played>0 分支（差异在 README 标注）。
 */
export function windowCloseFans(model, ctx) {
  const target = diehardTarget(model, ctx.influence);
  const evolved =
    ctx.played > 0
      ? ctx.fans
      : evolveFans(model, ctx.fans, target, ctx.attendRate, ctx.formPts, ctx.youthLevel ?? 0, ctx.fansBuff ?? 0);
  const mood = ctx.mood ?? 0;
  const nextFans = mood !== 0 ? Math.min(Math.max(evolved * (1 + mood / 100), 0), model.fans_cap) : evolved;
  return { target, evolved, nextFans };
}

// ─────────────────────────── 单场 / 全量推进 ───────────────────────────


/**
 * 单场推进（上座 → 收入 → 死忠），与运行期钩子④同序同口径。
 * ctx 额外字段：{matchId, clubId, fans, capacity, tier, facilityLevels, youthLevel, fansBuff,
 *                growRate, dropRate, awayInfluence, homeInfluence}
 */
export function replayMatch(ctx) {
  const att = computeAttendance(ctx);
  const revenue = computeRevenue(ctx.model, att.attendance, ctx.facilityLevels);
  const fans = advanceFans({ ...ctx, attendance: att.attendance });
  return { ...att, revenue, ...fans, total: revenue.total };
}

/**
 * 账本链重放（纯函数）：按应用顺序（ledger_entries.id 升序 = 真实入账顺序）重算 balance_after。
 * **不做 2 位四舍五入**：运行期 ledgerMovement 的余额是 SQLite 的 `balance + excluded.balance`
 * （binary64 直接相加，不取整），生产现存链上就有 31.759999999999998 这类浮点尾（已只读核实）。
 * 重演必须与运行期同口径，否则新链会与线上"同一公式、不同尾数"，verify 的逐行断言会失败。
 */
export function replayBalanceChain(entries) {
  let balance = 0;
  return entries.map((e) => {
    balance = balance + e.amount;
    return { ...e, balance_after: balance };
  });
}
