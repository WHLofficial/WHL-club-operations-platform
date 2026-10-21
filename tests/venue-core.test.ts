// v6.53.0 场馆档期 P0 纯逻辑口径（计划 memory/plan-v6.53.0-venue-slots-p0.md §7.2）。
// 断言里的数字全部照抄计划 §3.3 的手算表，不允许按实现结果反推。
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, CONFIG_KEYS } from '../src/core/config.ts';
import {
  ATTEND_MOD_MAX,
  ATTEND_MOD_MIN,
  SLOT_HARD_MAX,
  activityUnlockReason,
  attendMod,
  expectedNet,
  legacy_range,
  quotePlan,
  recommendPlan,
  satMultAt,
  slotsForCapacity,
  validateActivityConfig,
  validateActivitySlots,
  venueQuote,
  type VenueActivityDef,
  type VenueContext,
} from '../src/core/venue.ts';

function mkDef(partial: Partial<VenueActivityDef>): VenueActivityDef {
  return {
    name: '活动',
    blurb: '',
    pricing: 'flat',
    pricePerSeat: 0,
    fillRate: 1,
    income: 0,
    incomeMin: 0,
    incomeMax: 0,
    costBase: 0,
    costPerSeat: 0,
    attendMod: 1,
    reputationGain: 0,
    fansDelta: 0,
    pitchBoostPerLevel: 0,
    youthBoostPerLevel: 0,
    broadcastBoostPerLevel: 0,
    pitchDamageProb: 0,
    damageMin: 0,
    damageMax: 0,
    incomeRepBase: 0,
    requiresFacility: null,
    requiresLevel: 0,
    requiresReputation: null,
    ...partial,
  };
}

// §3.1 的五个活动（键序 = 默认 JSON 键序，推荐同分时按它稳定取胜）
const CONCERT = mkDef({
  name: '演唱会',
  pricing: 'capacity',
  pricePerSeat: 0.00015,
  fillRate: 1.0,
  costBase: 0.275,
  costPerSeat: 0.00002,
  attendMod: 0.95,
  reputationGain: 2,
  pitchBoostPerLevel: 0.1,
  pitchDamageProb: 0.15,
  damageMin: 2.0,
  damageMax: 5.0,
});
const ESPORTS = mkDef({
  name: '电竞赛事',
  pricing: 'capacity',
  pricePerSeat: 0.00008,
  fillRate: 1.0,
  costBase: 0.3,
  costPerSeat: 0.00001,
  broadcastBoostPerLevel: 0,
  attendMod: 1.0,
  reputationGain: 2,
  requiresFacility: 'broadcast',
  requiresLevel: 2,
});
const YOUTH = mkDef({
  name: '青训夏令营',
  pricing: 'flat',
  income: 0.7,
  attendMod: 1.007,
  reputationGain: 1,
  youthBoostPerLevel: 0.1,
  requiresFacility: 'youth',
  requiresLevel: 1,
});
const OPEN_DAY = mkDef({ name: '球迷开放日', pricing: 'flat', income: 0.2, attendMod: 1.005, reputationGain: 1 });
const CORPORATE = mkDef({
  name: '企业日',
  pricing: 'flat',
  income: 0.9,
  attendMod: 1.0,
  reputationGain: 3,
  incomeRepBase: 0.5,
  requiresFacility: 'commercial',
  requiresLevel: 1,
  requiresReputation: 20,
});
const DEFS: Record<string, VenueActivityDef> = {
  concert: CONCERT,
  esports: ESPORTS,
  youth_camp: YOUTH,
  open_day: OPEN_DAY,
  corporate: CORPORATE,
  idle: mkDef({ name: '空置', pricing: 'flat', income: 0, attendMod: 1, reputationGain: 0 }),
};

const FACILITIES = { broadcast: 2, youth: 1, commercial: 1 };

function ctx(capacity: number, overrides: Partial<VenueContext> = {}): VenueContext {
  return {
    capacity,
    reputation: 0,
    pitchLevel: 0,
    youthLevel: 0,
    broadcastLevel: 0,
    attendanceRate: 1,
    attendBuff: 0,
    ...overrides,
  };
}

const MID_ROLLS = { income: 0.5, damage: 0.5, damageRoll: 0.5 };

describe('slotsForCapacity / satMultAt', () => {
  it('档位数按容量分档并夹到配置上限', () => {
    expect(slotsForCapacity(14999, 4)).toBe(2);
    expect(slotsForCapacity(15000, 4)).toBe(3);
    expect(slotsForCapacity(29999, 4)).toBe(3);
    expect(slotsForCapacity(30000, 4)).toBe(4);
    expect(slotsForCapacity(35000, 2)).toBe(2);
    expect(slotsForCapacity(12000, 0)).toBe(0);
    expect(slotsForCapacity(0, 4)).toBe(2);
    expect(slotsForCapacity(null, 4)).toBe(2);
    expect(SLOT_HARD_MAX).toBe(20);
  });

  it('同类饱和系数 0-based，序号 ≥3 都是 0.45', () => {
    expect([0, 1, 2, 3, 4].map((n) => satMultAt(n))).toEqual([1, 0.7, 0.45, 0.45, 0.45]);
  });
});

describe('venueQuote：单槽期望值与掷点', () => {
  it('演唱会四档容量（expectedDamage 0.525）', () => {
    const q35 = venueQuote(CONCERT, ctx(35000), 1, MID_ROLLS);
    expect(q35.gross).toBe(5.25);
    expect(q35.opsCost).toBe(0.975);
    expect(q35.expectedDamage).toBe(0.525);
    expect(q35.expectedNet).toBe(3.75);
    expect(q35.attendanceMod).toBe(0.95);
    expect(q35.reputationGain).toBe(2);

    const q22 = venueQuote(CONCERT, ctx(22000), 1, MID_ROLLS);
    expect(q22.gross).toBe(3.3);
    expect(q22.opsCost).toBe(0.715);
    expect(q22.expectedNet).toBe(2.06);

    const q17 = venueQuote(CONCERT, ctx(17000), 1, MID_ROLLS);
    expect(q17.gross).toBe(2.55);
    expect(q17.opsCost).toBe(0.615);
    expect(q17.expectedNet).toBe(1.41);

    const q12 = venueQuote(CONCERT, ctx(12000), 1, MID_ROLLS);
    expect(q12.gross).toBe(1.8);
    expect(q12.opsCost).toBe(0.515);
    expect(q12.expectedNet).toBe(0.76);
  });

  it('电竞两档容量（无草皮损坏）', () => {
    const q35 = venueQuote(ESPORTS, ctx(35000), 1, MID_ROLLS);
    expect(q35.gross).toBe(2.8);
    expect(q35.opsCost).toBe(0.65);
    expect(q35.expectedDamage).toBe(0);
    expect(q35.expectedNet).toBe(2.15);

    const q12 = venueQuote(ESPORTS, ctx(12000), 1, MID_ROLLS);
    expect(q12.gross).toBe(0.96);
    expect(q12.opsCost).toBe(0.42);
    expect(q12.expectedNet).toBe(0.54);
  });

  it('固定收入活动与声望倍率', () => {
    expect(venueQuote(YOUTH, ctx(35000), 1, MID_ROLLS).expectedNet).toBe(0.7);
    expect(venueQuote(OPEN_DAY, ctx(35000), 1, MID_ROLLS).expectedNet).toBe(0.2);
    expect(venueQuote(CORPORATE, ctx(35000, { reputation: 20 }), 1, MID_ROLLS).gross).toBe(0.63);
    expect(venueQuote(CORPORATE, ctx(35000, { reputation: 20 }), 1, MID_ROLLS).expectedNet).toBe(0.63);
    expect(venueQuote(CORPORATE, ctx(35000, { reputation: 100 }), 1, MID_ROLLS).gross).toBe(1.35);
  });

  it('实际掷点与期望值分开：damageRoll 0 命中 3.5，0.99 不命中', () => {
    const hit = venueQuote(CONCERT, ctx(35000), 1, { income: 0.5, damage: 0.5, damageRoll: 0 });
    expect(hit.damage).toBe(3.5);
    expect(hit.net).toBe(0.775);
    expect(hit.expectedDamage).toBe(0.525);
    expect(hit.expectedNet).toBe(3.75);

    const miss = venueQuote(CONCERT, ctx(35000), 1, { income: 0.5, damage: 0.5, damageRoll: 0.99 });
    expect(miss.damage).toBe(0);
    expect(miss.net).toBe(4.275);
    expect(miss.expectedNet).toBe(3.75);
  });

  it('expectedNet 助手 = gross − opsCost − expectedDamage', () => {
    expect(expectedNet(5.25, 0.975, 0.525)).toBe(3.75);
  });

  it('草皮等级按 0.15/级 降损：L2 后概率 0.105、毛收入 ×1.2、期望损坏 0.368、净 4.957', () => {
    const q = venueQuote(CONCERT, ctx(35000, { pitchLevel: 2 }), 1, MID_ROLLS);
    expect(q.gross).toBe(6.3); // 5.25 × (1 + 0.1 × 2)
    expect(q.expectedDamage).toBe(0.368);
    expect(q.expectedNet).toBe(4.957);
    // 掷中的实际损坏也同步降：0.105 > 0.05 ⇒ 命中，金额仍按 3.5 计
    expect(venueQuote(CONCERT, ctx(35000, { pitchLevel: 2 }), 1, { income: 0.5, damage: 0.5, damageRoll: 0.05 }).damage).toBe(3.5);
    expect(venueQuote(CONCERT, ctx(35000, { pitchLevel: 2 }), 1, { income: 0.5, damage: 0.5, damageRoll: 0.11 }).damage).toBe(0);
  });

  it('声望增益按上座率缩放并夹在 [0,1]：0.5 ⇒ 1 点，1.5 ⇒ 仍 2 点', () => {
    expect(venueQuote(CONCERT, ctx(35000, { attendanceRate: 0.5 }), 1, MID_ROLLS).reputationGain).toBe(1);
    expect(venueQuote(CONCERT, ctx(35000, { attendanceRate: 1.5 }), 1, MID_ROLLS).reputationGain).toBe(2);
    expect(venueQuote(CONCERT, ctx(35000, { attendanceRate: 0 }), 1, MID_ROLLS).reputationGain).toBe(0);
  });

  it('legacy_range：区间中点 5.5，两端 3 / 8（设施乘数 1）', () => {
    const legacy = mkDef({ pricing: legacy_range, incomeMin: 3, incomeMax: 8 });
    expect(venueQuote(legacy, ctx(35000), 1, { income: 0.5, damage: 0.5, damageRoll: 0.5 }).gross).toBe(5.5);
    expect(venueQuote(legacy, ctx(35000), 1, { income: 0, damage: 0.5, damageRoll: 0.5 }).gross).toBe(3);
    expect(venueQuote(legacy, ctx(35000), 1, { income: 1, damage: 0.5, damageRoll: 0.5 }).gross).toBe(8);
    // 旧序：草皮加成是独立乘法（1 + 0.1 × 草皮）
    const legacyPitch = mkDef({ pricing: legacy_range, incomeMin: 3, incomeMax: 8, pitchBoostPerLevel: 0.1 });
    expect(venueQuote(legacyPitch, ctx(35000, { pitchLevel: 1 }), 1, MID_ROLLS).gross).toBe(6.05);
  });
});

describe('quotePlan：饱和、合计与累计人气', () => {
  const base = {
    capacity: 35000,
    defs: DEFS,
    facilities: FACILITIES,
    reputation: 20,
    attendanceRate: 1,
    attendBuff: 0,
  };

  it('4 场演唱会逐槽 3.75 / 2.175 / 0.8625 / 0.8625，合计 7.65', () => {
    const plan = quotePlan({
      ...base,
      slots: 4,
      picks: [1, 2, 3, 4].map((slotNo) => ({ slotNo, activity: 'concert' })),
    });
    expect(plan.quotes.map((q) => q.slotNo)).toEqual([1, 2, 3, 4]);
    expect(plan.quotes.map((q) => q.saturation)).toEqual([1, 0.7, 0.45, 0.45]);
    expect(plan.quotes.map((q) => q.expectedNet)).toEqual([3.75, 2.175, 0.8625, 0.8625]);
    expect(plan.totals.expectedNet).toBe(7.65);
  });

  it('2 演唱会 + 2 电竞 合计 ≈ 9.385', () => {
    const plan = quotePlan({
      ...base,
      slots: 4,
      picks: [
        { slotNo: 1, activity: 'concert' },
        { slotNo: 2, activity: 'concert' },
        { slotNo: 3, activity: 'esports' },
        { slotNo: 4, activity: 'esports' },
      ],
    });
    expect(plan.quotes.map((q) => q.expectedNet)).toEqual([3.75, 2.175, 2.15, 1.31]);
    expect(plan.totals.expectedNet).toBeCloseTo(9.385, 6);
  });

  it('锁定活动照样进合计（预览只报原因不拒；能不能排由 PUT 再拦）', () => {
    const plan = quotePlan({
      ...base,
      facilities: { broadcast: 0, youth: 0, commercial: 0 },
      slots: 2,
      picks: [{ slotNo: 1, activity: 'esports' }],
    });
    expect(plan.quotes).toHaveLength(1);
    expect(plan.totals.expectedNet).toBe(2.15);
    expect(plan.totals.gross).toBe(2.8);
  });

  it('累计人气 1.005 × 1.007 = 1.012035 → 1.012；无档位时 1', () => {    const plan = quotePlan({
      ...base,
      slots: 4,
      picks: [
        { slotNo: 1, activity: 'open_day' },
        { slotNo: 2, activity: 'youth_camp' },
      ],
    });
    expect(plan.totals.attendanceMod).toBe(1.012);
    expect(plan.totals.reputationGain).toBe(2);

    const empty = quotePlan({ ...base, slots: 4, picks: [] });
    expect(empty.quotes).toEqual([]);
    expect(empty.totals.attendanceMod).toBe(1);
    expect(empty.totals.expectedNet).toBe(0);
  });

  it('同 slotNo 后者覆盖、越界与 idle 不计入', () => {
    const plan = quotePlan({
      ...base,
      slots: 2,
      picks: [
        { slotNo: 1, activity: 'concert' },
        { slotNo: 1, activity: 'esports' },
        { slotNo: 2, activity: 'idle' },
        { slotNo: 3, activity: 'concert' },
      ],
    });
    expect(plan.quotes).toHaveLength(1);
    expect(plan.quotes[0]?.slotNo).toBe(1);
    expect(plan.quotes[0]?.activity).toBe('esports');
  });
});

describe('activityUnlockReason', () => {
  it('转播设施与声望两处文案', () => {
    expect(activityUnlockReason(ESPORTS, {}, 0)).toContain('转播设施 L2（当前 L0）');
    expect(activityUnlockReason(CORPORATE, FACILITIES, 12)).toContain('声望 ≥20（当前 12）');
  });

  it('已解锁返回 null', () => {
    expect(activityUnlockReason(CONCERT, {}, 0)).toBeNull();
    expect(activityUnlockReason(YOUTH, { youth: 1 }, 0)).toBeNull();
    expect(activityUnlockReason(CORPORATE, FACILITIES, 20)).toBeNull();
  });

  it('多条件用「；」连接并全列出', () => {
    const both = mkDef({ requiresFacility: 'broadcast', requiresLevel: 2, requiresReputation: 50 });
    const reason = activityUnlockReason(both, {}, 0);
    expect(reason).toContain('；');
    expect(reason).toContain('转播设施 L2（当前 L0）');
    expect(reason).toContain('声望 ≥50（当前 0）');
  });
});

describe('validateActivityConfig / validateActivitySlots', () => {
  const rawConfig = CONFIG_DEFAULTS.activity_config;
  const defaults = JSON.parse(rawConfig ?? '{}') as Record<string, Record<string, unknown>>;

  it('默认配置合法且键序 = concert / esports / youth_camp / open_day / corporate / idle', () => {
    expect(typeof rawConfig).toBe('string');
    expect(validateActivityConfig(defaults)).toBeNull();
    expect(Object.keys(defaults)).toEqual(['concert', 'esports', 'youth_camp', 'open_day', 'corporate', 'idle']);
    expect(defaults.concert?.price_per_seat).toBe(0.00015);
    expect(defaults.concert?.cost_base).toBe(0.275);
    expect(defaults.concert?.cost_per_seat).toBe(0.00002);
    expect(defaults.esports?.requires_facility).toBe('broadcast');
    expect(defaults.esports?.requires_level).toBe(2);
    expect(defaults.youth_camp?.income).toBe(0.7);
    expect(defaults.open_day?.income).toBe(0.2);
    expect(defaults.corporate?.income_rep_base).toBe(0.5);
    expect(defaults.corporate?.requires_reputation).toBe(20);
  });

  it('未知键 / 负值 / 越界 / 区间反序都要报错', () => {
    expect(validateActivityConfig({ concert: { foo: 1 } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { income: -1 } })).not.toBeNull();
    expect(validateActivityConfig({ esports: { requires_level: 9 } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { income_min: 5, income_max: 3 } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { fill_rate: 1.5 } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { fill_rate: -0.1 } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { attend_mod: 3 } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { requires_facility: 'parking' } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { pricing: 'legacy_range' } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { pricing: 'wat' } })).not.toBeNull();
    expect(validateActivityConfig({ concert: { blurb: 'x'.repeat(41) } })).not.toBeNull();
    expect(validateActivityConfig('nope')).not.toBeNull();
  });

  it('旧键 income_min / income_max 仍合法（不把 legacy 配置判死）', () => {
    expect(validateActivityConfig({ concert: { income_min: 3, income_max: 8 } })).toBeNull();
    expect(validateActivityConfig({ concert: { income_min: 3, income_max: 8, pricing: 'legacy_range' } })).toBeNull();
    expect(validateActivityConfig({ youth_camp: { income: 1.0, youth_level_factor: 0.1 } })).toBeNull();
  });

  it('activity_slots 只收 0-20 的整数', () => {
    expect(validateActivitySlots('4')).toBeNull();
    expect(validateActivitySlots(0)).toBeNull();
    expect(validateActivitySlots(SLOT_HARD_MAX)).toBeNull();
    expect(validateActivitySlots(String(SLOT_HARD_MAX + 1))).not.toBeNull();
    expect(validateActivitySlots('4.5')).not.toBeNull();
    expect(validateActivitySlots(-1)).not.toBeNull();
    expect(validateActivitySlots('abc')).not.toBeNull();
    expect(validateActivitySlots(null)).not.toBeNull();
    expect(validateActivitySlots(undefined)).not.toBeNull();
  });

  it('配置默认值：activity_slots = 4、window_length_hours = 168 且在注册表内', () => {
    expect(CONFIG_DEFAULTS.activity_slots).toBe('4');
    expect(CONFIG_DEFAULTS.window_length_hours).toBe('168');
    const keys: readonly string[] = CONFIG_KEYS;
    expect(keys).toContain('activity_slots');
    expect(keys).toContain('window_length_hours');
  });
});

describe('attendMod：逐项相乘后夹在 [0.5, 2.0]', () => {
  it('正常相乘与上下钳制', () => {
    expect(attendMod(1, 1.007)).toBe(1.007);
    expect(attendMod(1.9, 1.5)).toBe(ATTEND_MOD_MAX);
    expect(attendMod(0.6, 0.5)).toBe(ATTEND_MOD_MIN);
  });
});

describe('recommendPlan：贪心三口径', () => {
  const base = {
    capacity: 35000,
    slots: 4,
    defs: DEFS,
    facilities: FACILITIES,
    reputation: 20,
    attendanceRate: 1,
    attendBuff: 0,
    existing: [],
  };

  it('money：2 演唱会 + 2 电竞 合计 ≈ 9.385（4 演唱只有 7.65）', () => {
    const plan = recommendPlan({ ...base, policy: 'money' });
    expect(plan.policy).toBe('money');
    expect(plan.picks.map((p) => p.activity)).toEqual(['concert', 'concert', 'esports', 'esports']);
    expect(plan.totals.expectedNet).toBeCloseTo(9.385, 6);
  });

  it('fans：先挑青训夏令营（1.007 > 1.005）', () => {
    const plan = recommendPlan({ ...base, policy: 'fans' });
    expect(plan.picks[0]?.activity).toBe('youth_camp');
  });

  it('fans：fansDelta > 0 的活动优先于纯人气', () => {
    const withFans = { ...DEFS, corporate: mkDef({ ...CORPORATE, fansDelta: 1 }) };
    const plan = recommendPlan({ ...base, policy: 'fans', defs: withFans });
    expect(plan.picks[0]?.activity).toBe('corporate');
  });

  it('reputation：先挑企业日（声望 +3）', () => {
    const plan = recommendPlan({ ...base, policy: 'reputation' });
    expect(plan.picks[0]?.activity).toBe('corporate');
    expect(plan.totals.reputationGain).toBe(12);
  });

  it('锁定活动不进推荐，但 existing 已排项原样保留', () => {
    const locked = recommendPlan({ ...base, policy: 'reputation', reputation: 0 });
    expect(locked.picks.some((p) => p.activity === 'corporate')).toBe(false);

    const kept = recommendPlan({ ...base, policy: 'money', existing: [{ slotNo: 1, activity: 'open_day' }] });
    expect(kept.picks.find((p) => p.slotNo === 1)?.activity).toBe('open_day');
    expect(kept.picks).toHaveLength(4);

    const keepLocked = recommendPlan({
      ...base,
      policy: 'money',
      reputation: 0,
      existing: [{ slotNo: 1, activity: 'corporate' }],
    });
    expect(keepLocked.picks.find((p) => p.slotNo === 1)?.activity).toBe('corporate');
  });

  it('slots = 0 时不排档', () => {
    const plan = recommendPlan({ ...base, slots: 0, policy: 'money' });
    expect(plan.picks).toEqual([]);
    expect(plan.totals.expectedNet).toBe(0);
  });
});
