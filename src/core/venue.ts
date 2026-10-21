// v6.53.0 场馆档期 P0：纯逻辑与数值口径。
// 口径唯一真源 memory/plan-v6.53.0-venue-slots-p0.md §3.1 / §4.1：
//   收入 = 基数 × 设施乘数 × (1 + 冠名 attendBuff) × 饱和度 × 声望倍率
//   成本 = costBase + costPerSeat × 容量（不乘饱和、不乘加成）
//   草皮损坏 = pitchDamageProb × (1 − 0.15 × 草皮等级) 的概率掷点，期望值单列
// 本文件零 import：只做算术与校验，Worker 与前端都能引用（不进前端 bundle，故不必登记
// tests/core-zero-import.test.ts 的 PURE_DATA_MODULES）。

export const SLOT_HARD_MAX = 20;
/** 同类活动同一窗内的饱和系数，下标 = 该窗内同类序位（0-based），序号 ≥3 都取 0.45。 */
export const SATURATION_MULTS = [1, 0.7, 0.45, 0.45] as const;
/** 每窗档位数按容量分档时的分界（人）。 */
export const ATTENDANCE_K = 5;
export const ATTEND_MOD_MIN = 0.5;
export const ATTEND_MOD_MAX = 2.0;
export const REP_MIN = 0;
export const REP_MAX = 100;
export const REP_SEASON_DECAY = 0.9;
/** 旧配置（income_min + income_max 区间型）的定价档标记。 */
export const legacy_range: VenuePricing = 'legacy_range';

export type VenuePricing = 'capacity' | 'flat' | 'legacy_range';
export type VenueFacilityKey = 'broadcast' | 'youth' | 'commercial';
export type VenueFacilities = Map<string, number> | Record<string, number>;

export interface VenueActivityDef {
  name: string;
  blurb: string;
  pricing: VenuePricing;
  /** capacity 型：每座单价。 */
  pricePerSeat: number;
  /** capacity 型：上座填充率。 */
  fillRate: number;
  /** flat 型：固定收入。 */
  income: number;
  /** legacy_range 型：区间下限/上限（缺省 0）。 */
  incomeMin: number;
  incomeMax: number;
  costBase: number;
  costPerSeat: number;
  attendMod: number;
  reputationGain: number;
  fansDelta: number;
  pitchBoostPerLevel: number;
  youthBoostPerLevel: number;
  broadcastBoostPerLevel: number;
  pitchDamageProb: number;
  damageMin: number;
  damageMax: number;
  /** > 0 时收入再乘 (incomeRepBase + 声望/100)，企业日专用。 */
  incomeRepBase: number;
  requiresFacility: VenueFacilityKey | null;
  requiresLevel: number;
  requiresReputation: number | null;
}

export interface VenueContext {
  capacity: number;
  reputation: number;
  pitchLevel: number;
  youthLevel: number;
  broadcastLevel: number;
  attendanceRate: number;
  attendBuff: number;
}

export interface VenueQuote {
  gross: number;
  opsCost: number;
  damage: number;
  expectedDamage: number;
  net: number;
  expectedNet: number;
  attendanceMod: number;
  reputationGain: number;
}

export interface VenueSlotQuote {
  slotNo: number;
  activity: string;
  saturation: number;
  gross: number;
  opsCost: number;
  expectedDamage: number;
  expectedNet: number;
  attendanceMod: number;
  reputationGain: number;
}

export interface VenueTotals {
  gross: number;
  opsCost: number;
  expectedDamage: number;
  expectedNet: number;
  attendanceMod: number;
  reputationGain: number;
}

export interface VenuePlanPick {
  slotNo: number;
  activity: string | null;
}

export interface QuotePlanInput {
  capacity: number;
  slots: number;
  defs: Record<string, VenueActivityDef>;
  facilities: VenueFacilities;
  reputation: number;
  attendanceRate: number;
  attendBuff: number;
  picks: VenuePlanPick[];
}

export type VenuePolicy = 'money' | 'fans' | 'reputation';

export interface RecommendPlanInput {
  capacity: number;
  slots: number;
  policy: VenuePolicy;
  defs: Record<string, VenueActivityDef>;
  facilities: VenueFacilities;
  reputation: number;
  attendanceRate: number;
  attendBuff: number;
  existing: { slotNo: number; activity: string }[];
}

export interface RecommendPlanResult {
  policy: VenuePolicy;
  picks: { slotNo: number; activity: string }[];
  totals: VenueTotals;
}

function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

function round4(n: number): number {
  const r = Math.round(n * 10000) / 10000;
  return r === 0 ? 0 : r;
}

function clamp(n: number, low: number, high: number): number {
  if (!Number.isFinite(n)) return low;
  if (n < low) return low;
  if (n > high) return high;
  return n;
}

/** 每窗档位数：容量 0/缺省或 <15000 → 2，<30000 → 3，否则 4；再夹到配置上限与硬上限。 */
export function slotsForCapacity(capacity: number | null | undefined, slotCap: number): number {
  if (!(slotCap > 0)) return 0;
  const cap = capacity ?? 0;
  const base = !cap || cap <= 0 ? 2 : cap < 15000 ? 2 : cap < 30000 ? 3 : 4;
  return Math.min(base, Math.trunc(slotCap), SLOT_HARD_MAX);
}

/** 同类活动的饱和系数：0-based 序位，序号 ≥3 一律 0.45。 */
export function satMultAt(ordinal: number): number {
  const value = Number.isFinite(ordinal) ? Math.trunc(ordinal) : 0;
  const idx = Math.min(Math.max(0, value), SATURATION_MULTS.length - 1);
  return SATURATION_MULTS[idx];
}

/** 期望净额 = 收入 − 运营成本 − 期望草皮损坏。
 *  入参应是**未取整的 gross 中间值**、保留 4 位小数：计划 §7.2 的逐槽表里 35000 排 4 演唱
 *  第 3/4 槽是 0.8625（= 5.25 × 0.45 − 0.975 − 0.525），先 round3 成 2.363 再减会变 0.863；
 *  合计仍 round3（4 演唱 = 7.65），两种断言才同时成立。 */
export function expectedNet(gross: number, opsCost: number, expectedDamage: number): number {
  return round4(gross - opsCost - expectedDamage);
}

/** 档期累计人气系数：逐项相乘后夹在 [0.5, 2.0]。 */
export function attendMod(prev: number, next: number): number {
  return clamp(prev * next, ATTEND_MOD_MIN, ATTEND_MOD_MAX);
}

/** 草皮每级把损坏概率压低 0.15（旧 activityIncome 同口径）。 */
const PITCH_DAMAGE_REDUCTION_PER_LEVEL = 0.15;

/** 设施等级取数：Map 或普通对象都吃，缺省 / 非数字一律 0。 */
function facilityLevel(facilities: VenueFacilities, key: string): number {
  const raw = facilities instanceof Map ? facilities.get(key) : facilities[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function baseIncome(def: VenueActivityDef, capacity: number, incomeRoll: number): number {
  if (def.pricing === 'capacity') return capacity * def.pricePerSeat * def.fillRate;
  if (def.pricing === 'legacy_range') return def.incomeMin + incomeRoll * (def.incomeMax - def.incomeMin);
  return def.income;
}

/** 设施乘数：capacity/flat 三项线性相加；legacy_range 复刻旧序（草皮、青训各一次乘法，不含转播）。 */
function facilityMult(def: VenueActivityDef, ctx: VenueContext): number {
  if (def.pricing === 'legacy_range') {
    return (1 + def.pitchBoostPerLevel * ctx.pitchLevel) * (1 + def.youthBoostPerLevel * ctx.youthLevel);
  }
  return (
    1 +
    def.pitchBoostPerLevel * ctx.pitchLevel +
    def.youthBoostPerLevel * ctx.youthLevel +
    def.broadcastBoostPerLevel * ctx.broadcastLevel
  );
}

/** 草皮损坏概率：草皮每级把概率压低 0.15，最低 0。 */
function damageProb(def: VenueActivityDef, pitchLevel: number): number {
  return Math.max(0, def.pitchDamageProb * (1 - PITCH_DAMAGE_REDUCTION_PER_LEVEL * pitchLevel));
}

export function venueQuote(
  def: VenueActivityDef,
  ctx: VenueContext,
  satMult: number,
  rolls: { income: number; damage: number; damageRoll: number },
): VenueQuote {
  const base = baseIncome(def, ctx.capacity, rolls.income);
  const rawGross =
    base *
    facilityMult(def, ctx) *
    (1 + ctx.attendBuff) *
    satMult *
    (def.incomeRepBase > 0 ? def.incomeRepBase + ctx.reputation / 100 : 1);
  const gross = round3(rawGross);
  const opsCost = round3(def.costBase + def.costPerSeat * ctx.capacity);
  const prob = damageProb(def, ctx.pitchLevel);
  const damaged = prob > 0 && rolls.damageRoll < prob;
  const damage = damaged ? round3(def.damageMin + (def.damageMax - def.damageMin) * rolls.damage) : 0;
  const expectedDamage = round3((prob * (def.damageMin + def.damageMax)) / 2);
  return {
    gross,
    opsCost,
    damage,
    expectedDamage,
    net: round3(gross - opsCost - damage),
    expectedNet: expectedNet(rawGross, opsCost, expectedDamage),
    attendanceMod: def.attendMod,
    reputationGain: round2(def.reputationGain * clamp(ctx.attendanceRate, 0, 1)),
  };
}

function contextOf(input: {
  capacity: number;
  facilities: VenueFacilities;
  reputation: number;
  attendanceRate: number;
  attendBuff: number;
}): VenueContext {
  return {
    capacity: input.capacity,
    reputation: input.reputation,
    pitchLevel: facilityLevel(input.facilities, 'pitch'),
    youthLevel: facilityLevel(input.facilities, 'youth'),
    broadcastLevel: facilityLevel(input.facilities, 'broadcast'),
    attendanceRate: input.attendanceRate,
    attendBuff: input.attendBuff,
  };
}

function toPicks(picks: Map<number, string>): { slotNo: number; activity: string }[] {
  return [...picks.entries()]
    .map(([slotNo, activity]) => ({ slotNo, activity }))
    .sort((a, b) => a.slotNo - b.slotNo);
}

export function quotePlan(input: QuotePlanInput): { quotes: VenueSlotQuote[]; totals: VenueTotals } {
  const ctx = contextOf(input);
  const slots = Math.max(0, Math.trunc(input.slots));
  const picked = new Map<number, string>();
  for (const item of input.picks) {
    if (!Number.isInteger(item.slotNo) || item.slotNo < 1 || item.slotNo > slots) continue;
    // 同 slotNo 后者覆盖前者
    if (!item.activity) {
      picked.delete(item.slotNo);
      continue;
    }
    picked.set(item.slotNo, item.activity);
  }

  const counts = new Map<string, number>();
  const quotes: VenueSlotQuote[] = [];
  for (const [slotNo, activity] of [...picked.entries()].sort((a, b) => a[0] - b[0])) {
    if (activity === 'idle') continue;
    const def = input.defs[activity];
    if (!def) continue;
    const ordinal = counts.get(activity) ?? 0;
    counts.set(activity, ordinal + 1);
    const saturation = satMultAt(ordinal);
    const q = venueQuote(def, ctx, saturation, { income: 0.5, damage: 0.5, damageRoll: 0.5 });
    quotes.push({
      slotNo,
      activity,
      saturation,
      gross: q.gross,
      opsCost: q.opsCost,
      expectedDamage: q.expectedDamage,
      expectedNet: q.expectedNet,
      attendanceMod: q.attendanceMod,
      reputationGain: q.reputationGain,
    });
  }

  let gross = 0;
  let opsCost = 0;
  let expectedDamage = 0;
  let expectedNetSum = 0;
  let mods = 1;
  let reputationGain = 0;
  for (const q of quotes) {
    gross += q.gross;
    opsCost += q.opsCost;
    expectedDamage += q.expectedDamage;
    expectedNetSum += q.expectedNet;
    mods = attendMod(mods, q.attendanceMod);
    reputationGain += q.reputationGain;
  }

  return {
    quotes,
    totals: {
      gross: round3(gross),
      opsCost: round3(opsCost),
      expectedDamage: round3(expectedDamage),
      expectedNet: round3(expectedNetSum),
      attendanceMod: quotes.length === 0 ? 1 : round3(mods),
      reputationGain: round2(reputationGain),
    },
  };
}

const FACILITY_LABELS: Record<VenueFacilityKey, string> = {
  broadcast: '转播设施',
  youth: '青训设施',
  commercial: '商业设施',
};

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}

/** 解锁缺口人话：null = 已解锁；多个条件用「；」连接。 */
export function activityUnlockReason(
  def: VenueActivityDef,
  facilities: VenueFacilities,
  reputation: number,
): string | null {
  const reasons: string[] = [];
  if (def.requiresFacility) {
    const have = facilityLevel(facilities, def.requiresFacility);
    if (have < def.requiresLevel) {
      reasons.push(`需要${FACILITY_LABELS[def.requiresFacility]} L${trimNum(def.requiresLevel)}（当前 L${trimNum(have)}）`);
    }
  }
  if (def.requiresReputation !== null && reputation < def.requiresReputation) {
    reasons.push(`需要场馆声望 ≥${trimNum(def.requiresReputation)}（当前 ${trimNum(reputation)}）`);
  }
  return reasons.length === 0 ? null : reasons.join('；');
}

/** 配置里允许出现的活动键（含旧键 income_min/income_max/youth_level_factor）。 */
const ACTIVITY_CONFIG_KEYS = new Set([
  'name',
  'blurb',
  'pricing',
  'price_per_seat',
  'fill_rate',
  'income',
  'income_min',
  'income_max',
  'cost_base',
  'cost_per_seat',
  'attend_mod',
  'reputation_gain',
  'fans_delta',
  'pitch_boost_per_level',
  'youth_boost_per_level',
  'youth_level_factor',
  'broadcast_boost_per_level',
  'pitch_damage_prob',
  'damage_min',
  'damage_max',
  'income_rep_base',
  'requires_facility',
  'requires_level',
  'requires_reputation',
]);

const PRICING_VALUES: readonly VenuePricing[] = ['capacity', 'flat', 'legacy_range'];
const FACILITY_KEYS: readonly VenueFacilityKey[] = ['broadcast', 'youth', 'commercial'];

function readNum(def: Record<string, unknown>, field: string): number | null | 'bad' {
  const v = def[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'bad';
  return v;
}

function validateOneActivity(key: string, value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return `活动 ${key}：必须是对象`;
  const def = value as Record<string, unknown>;

  for (const field of Object.keys(def)) {
    if (!ACTIVITY_CONFIG_KEYS.has(field)) return `活动 ${key}：未知键 ${field}`;
  }

  const numFields = [
    'price_per_seat',
    'fill_rate',
    'income',
    'income_min',
    'income_max',
    'cost_base',
    'cost_per_seat',
    'attend_mod',
    'reputation_gain',
    'fans_delta',
    'pitch_boost_per_level',
    'youth_boost_per_level',
    'youth_level_factor',
    'broadcast_boost_per_level',
    'pitch_damage_prob',
    'damage_min',
    'damage_max',
    'income_rep_base',
    'requires_level',
    'requires_reputation',
  ];
  const num: Record<string, number | null> = {};
  for (const field of numFields) {
    const v = readNum(def, field);
    if (v === 'bad') return `活动 ${key}：${field} 必须是数字`;
    num[field] = v;
  }

  if (num.income !== null && num.income < 0) return `活动 ${key}：income 不能小于 0`;
  if (num.cost_base !== null && num.cost_base < 0) return `活动 ${key}：cost_base 不能小于 0`;
  if (num.cost_per_seat !== null && num.cost_per_seat < 0) return `活动 ${key}：cost_per_seat 不能小于 0`;
  if (num.price_per_seat !== null && num.price_per_seat < 0) return `活动 ${key}：price_per_seat 不能小于 0`;
  if (num.fill_rate !== null && (num.fill_rate < 0 || num.fill_rate > 1)) {
    return `活动 ${key}：fill_rate 必须在 0-1 之间`;
  }
  if (num.attend_mod !== null && (num.attend_mod < ATTEND_MOD_MIN || num.attend_mod > ATTEND_MOD_MAX)) {
    return `活动 ${key}：attend_mod 必须在 ${ATTEND_MOD_MIN}-${ATTEND_MOD_MAX} 之间`;
  }
  if (num.reputation_gain !== null && (num.reputation_gain < 0 || num.reputation_gain > 10)) {
    return `活动 ${key}：reputation_gain 必须在 0-10 之间`;
  }
  if (num.fans_delta !== null && (num.fans_delta < 0 || num.fans_delta > 5)) {
    return `活动 ${key}：fans_delta 必须在 0-5 之间`;
  }
  if (
    num.requires_level !== null &&
    (!Number.isInteger(num.requires_level) || num.requires_level < 0 || num.requires_level > 5)
  ) {
    return `活动 ${key}：requires_level 必须是 0-5 的整数`;
  }
  if (num.pitch_damage_prob !== null && (num.pitch_damage_prob < 0 || num.pitch_damage_prob > 1)) {
    return `活动 ${key}：pitch_damage_prob 必须在 0-1 之间`;
  }
  if (num.damage_min !== null && num.damage_min < 0) return `活动 ${key}：damage_min 不能小于 0`;
  if (num.damage_max !== null && num.damage_max < 0) return `活动 ${key}：damage_max 不能小于 0`;
  if (num.damage_min !== null && num.damage_max !== null && num.damage_max < num.damage_min) {
    return `活动 ${key}：damage_max 不能小于 damage_min`;
  }
  if (
    num.requires_reputation !== null &&
    (num.requires_reputation < REP_MIN || num.requires_reputation > REP_MAX)
  ) {
    return `活动 ${key}：requires_reputation 必须在 ${REP_MIN}-${REP_MAX} 之间`;
  }

  if (def.pricing !== undefined && def.pricing !== null) {
    if (typeof def.pricing !== 'string' || !PRICING_VALUES.includes(def.pricing as VenuePricing)) {
      return `活动 ${key}：pricing 只能是 ${PRICING_VALUES.join(' / ')}`;
    }
  }
  const min = num.income_min;
  const max = num.income_max;
  if ((min === null) !== (max === null)) return `活动 ${key}：income_min 与 income_max 必须成对出现`;
  if (min !== null && max !== null && max < min) return `活动 ${key}：income_max 不能小于 income_min`;
  if (def.pricing === 'legacy_range' && (min === null || max === null)) {
    return `活动 ${key}：legacy_range 必须同时给 income_min 与 income_max`;
  }

  if (def.requires_facility !== undefined && def.requires_facility !== null) {
    if (
      typeof def.requires_facility !== 'string' ||
      !FACILITY_KEYS.includes(def.requires_facility as VenueFacilityKey)
    ) {
      return `活动 ${key}：requires_facility 只能是 ${FACILITY_KEYS.join(' / ')}`;
    }
  }
  if (def.name !== undefined && def.name !== null) {
    if (typeof def.name !== 'string' || def.name.trim() === '') return `活动 ${key}：name 必须是非空字符串`;
  }
  if (def.blurb !== undefined && def.blurb !== null) {
    if (typeof def.blurb !== 'string') return `活动 ${key}：blurb 必须是字符串`;
    if (def.blurb.length > 40) return `活动 ${key}：blurb 不能超过 40 字`;
  }
  return null;
}

/** 活动目录校验：返回 null = 合法；否则返回人话报错。 */
export function validateActivityConfig(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return '活动目录（activity_config）必须是对象';
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return '活动目录（activity_config）不能为空';
  for (const [key, value] of entries) {
    const reason = validateOneActivity(key, value);
    if (reason) return reason;
  }
  return null;
}

/** 每窗档位数校验：0-20 的整数（字符串或数字）。返回 null = 合法。 */
export function validateActivitySlots(raw: unknown): string | null {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0 || raw > SLOT_HARD_MAX) {
      return `activity_slots 必须是 0-${SLOT_HARD_MAX} 的整数`;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!/^\d+$/.test(text)) return `activity_slots 必须是 0-${SLOT_HARD_MAX} 的整数`;
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value > SLOT_HARD_MAX) {
      return `activity_slots 必须是 0-${SLOT_HARD_MAX} 的整数`;
    }
    return null;
  }
  return `activity_slots 必须是 0-${SLOT_HARD_MAX} 的整数`;
}

function policyScore(policy: VenuePolicy, totals: VenueTotals, fansDelta: number): number[] {
  if (policy === 'money') return [totals.expectedNet];
  if (policy === 'reputation') return [totals.reputationGain];
  return [fansDelta, totals.attendanceMod];
}

function compareScore(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function fansOfPlan(picks: Map<number, string>, defs: Record<string, VenueActivityDef>): number {
  let sum = 0;
  for (const activity of picks.values()) {
    const def = defs[activity];
    if (def) sum += def.fansDelta;
  }
  return sum;
}

/**
 * 推荐排档（贪心）：保留 existing 已排项，只填空槽，按 slotNo 升序逐档挑当前口径最优的活动。
 * 比较用整盘 totals：money 看 expectedNet，reputation 看 reputationGain，
 * fans 看 (ΣfansDelta, totals.attendanceMod)；同分按 defs 的键序取先出现的。
 */
export function recommendPlan(input: RecommendPlanInput): RecommendPlanResult {
  const slots = Math.max(0, Math.trunc(input.slots));
  const base = {
    capacity: input.capacity,
    slots,
    defs: input.defs,
    facilities: input.facilities,
    reputation: input.reputation,
    attendanceRate: input.attendanceRate,
    attendBuff: input.attendBuff,
  };

  const picks = new Map<number, string>();
  for (const item of input.existing) {
    if (!Number.isInteger(item.slotNo) || item.slotNo < 1 || item.slotNo > slots) continue;
    if (!item.activity || item.activity === 'idle') continue;
    if (!input.defs[item.activity]) continue;
    picks.set(item.slotNo, item.activity);
  }

  const candidates = Object.keys(input.defs).filter(
    (key) =>
      key !== 'idle' &&
      Boolean(input.defs[key]) &&
      activityUnlockReason(input.defs[key], input.facilities, input.reputation) === null,
  );

  let totals = quotePlan({ ...base, picks: toPicks(picks) }).totals;
  for (let slotNo = 1; slotNo <= slots; slotNo += 1) {
    if (picks.has(slotNo)) continue;
    let bestKey: string | null = null;
    let bestScore: number[] = [];
    let bestTotals = totals;
    for (const key of candidates) {
      const trial = new Map(picks);
      trial.set(slotNo, key);
      const trialTotals = quotePlan({ ...base, picks: toPicks(trial) }).totals;
      const score = policyScore(input.policy, trialTotals, fansOfPlan(trial, input.defs));
      if (bestKey === null || compareScore(score, bestScore) > 0) {
        bestKey = key;
        bestScore = score;
        bestTotals = trialTotals;
      }
    }
    if (bestKey !== null) {
      picks.set(slotNo, bestKey);
      totals = bestTotals;
    }
  }

  // totals 始终是「当前 picks 最后一次 quotePlan」的结果（每接受一个候选即更新），不再复算一遍
  return { policy: input.policy, picks: toPicks(picks), totals };
}
