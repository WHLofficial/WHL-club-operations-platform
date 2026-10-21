// 球场档期（v6.9.0 E 块；v6.53.0 P0 重写为容量驱动档位 + 净现金口径）：
//   档位派生与饱和（slotsForCapacity/satMultAt）、活动目录与旧格式兼容（loadActivityCatalog）、
//   单档报价与整窗预览（activityQuote/quotePlan 的 Worker 侧接线）、预订（bookSlot/venueSlotStatement）、
//   窗末结算三条流水（bookingSettlement/windowActivityStatements）与 /club/venue-plan 三端点。
// 口径唯一真源 memory/plan-v6.53.0-venue-slots-p0.md §3.1-§3.3（公式）/§4.2（签名）/§4.5（端点）/§7.2（用例）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetOpsScheduleCache } from '../src/worker/ops-schedule.ts';
import {
  bookSlot,
  bookingSettlement,
  listBookings,
  loadActivityCatalog,
  loadVenueContext,
  seededUnit,
  venueSlotStatement,
  windowActivityStatements,
} from '../src/worker/venue-ops.ts';
import { quotePlan, slotsForCapacity, venueQuote } from '../src/core/venue.ts';
import type { VenueContext } from '../src/core/venue.ts';
import { windowHomeStatements } from '../src/worker/home.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0);`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    SYNC_BASE_URL: undefined,
    SYNC_SECRET: undefined,
  };
  return { env, sqlite, tour, kv };
}

/** 默认球场：容量 20000（⇒ 3 槽）、档位 0（维护费基础 2.0）、声望 0、余额 50；默认同时开 S1W1 */
function seedClub(
  sqlite: DatabaseSync,
  opts: {
    clubId?: number;
    balance?: number;
    openWindow?: boolean;
    capacity?: number;
    reputation?: number;
    facilities?: Record<string, number>;
  } = {},
) {
  const id = opts.clubId ?? 1;
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (${id}, '俱乐部${id}', 'premier', 'active');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (${id}, 1, '2026-01-01T00:00:00Z');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans, venue_reputation)
      VALUES (${id}, '主场${id}', ${opts.capacity ?? 20000}, 0, 1800, ${opts.reputation ?? 0});
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (${id}, ${opts.balance ?? 50}, '2026-01-01T00:00:00Z');
  `);
  for (const [key, level] of Object.entries(opts.facilities ?? {})) {
    sqlite
      .prepare(`INSERT INTO club_facilities (club_id, facility_key, level, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')`)
      .run(id, key, level);
  }
  if (opts.openWindow !== false) {
    if (id === 1) {
      sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z')`);
    } else {
      sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (${id}, 1, 'open', '2026-07-01T00:00:00Z')`);
    }
  }
}

function seedBooking(
  sqlite: DatabaseSync,
  slotNo: number,
  activityType: string,
  opts: { clubId?: number; season?: number; windowSeq?: number; bookedBy?: string } = {},
): number {
  sqlite
    .prepare(
      `INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-07-01T00:00:00Z')`,
    )
    .run(opts.clubId ?? 1, opts.season ?? 1, opts.windowSeq ?? 1, slotNo, activityType, opts.bookedBy ?? '1');
  return sqlGet<{ id: number }>(sqlite, 'SELECT MAX(id) AS id FROM venue_bookings')!.id;
}

/** 写 activity_config（先 resetConfigCache，否则 config 服务的 60s 缓存会拿到旧值） */
function seedActivityConfig(sqlite: DatabaseSync, cfg: Record<string, unknown>) {
  sqlite
    .prepare(`INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('activity_config', ?, '2026-07-01T00:00:00Z')`)
    .run(JSON.stringify(cfg));
  resetConfigCache();
}

function seedSetting(sqlite: DatabaseSync, key: string, value: string) {
  sqlite
    .prepare(`INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, '2026-07-01T00:00:00Z')`)
    .run(key, value);
  resetConfigCache();
}

/** 新格式目录：容量定价；pitch_damage_prob 由用例指定（1 = 必损坏，不靠种子运气；0 = 无损坏，金额可手算） */
function capacityCatalogConfig(pitchDamageProb: number): Record<string, unknown> {
  return {
    concert: {
      name: '演唱会',
      blurb: '单场现金最高',
      pricing: 'capacity',
      price_per_seat: 0.00015,
      fill_rate: 1.0,
      cost_base: 0.275,
      cost_per_seat: 0.00002,
      attend_mod: 0.95,
      reputation_gain: 2,
      pitch_damage_prob: pitchDamageProb,
      damage_min: 2,
      damage_max: 5,
    },
    esports: {
      name: '电竞赛事',
      pricing: 'capacity',
      price_per_seat: 0.00008,
      fill_rate: 1.0,
      cost_base: 0.3,
      cost_per_seat: 0.00001,
      attend_mod: 1.0,
      reputation_gain: 2,
    },
    idle: { name: '空置', pricing: 'flat', income: 0, attend_mod: 1, reputation_gain: 0 },
  };
}

/** 旧格式目录（legacy_range）：income_min/income_max + youth_level_factor，用于验证逐字复刻旧乘序 */
function legacyCatalogConfig(): Record<string, unknown> {
  return {
    concert: { name: '演唱会', income_min: 3, income_max: 8, pitch_damage_prob: 1, damage_min: 2, damage_max: 5 },
    youth_camp: { name: '青训夏令营', income: 0.7, youth_level_factor: 0.1, attend_mod: 1.007 },
    idle: { name: '空置', income: 0 },
  };
}

/** 结算用 ctx：直接按 core 的 VenueContext 字面量拼（不经过 stadiums 也可以单测报价） */
function ctxOf(over: Partial<VenueContext> = {}): VenueContext {
  return {
    capacity: 20000,
    reputation: 0,
    pitchLevel: 0,
    youthLevel: 0,
    broadcastLevel: 0,
    attendanceRate: 1,
    attendBuff: 0,
    ...over,
  };
}

/** 与 /club/venue-plan 同一接线：目录 + 场馆现状 ⇒ quotePlan */
async function planOf(env: Env, clubId: number, picks: { slotNo: number; activity: string }[]) {
  const catalog = await loadActivityCatalog(env.DB);
  const info = await loadVenueContext(env.DB, clubId);
  const plan = quotePlan({
    capacity: info.capacity,
    slots: slotsForCapacity(info.capacity, catalog.slotCap),
    defs: catalog.types,
    facilities: info.facilities,
    reputation: info.venueReputation,
    attendanceRate: 1,
    attendBuff: 0,
    picks,
  });
  return { catalog, info, plan };
}

const ROLLS_MID = { income: 0.5, damage: 0.5, damageRoll: 0.5 };

describe('确定性伪随机（seededUnit）：同种子逐字一致、不同档位/抽取互不相同', () => {
  it('同 seed + draw 恒定、落在 [0,1)、档位与抽取维度都参与', () => {
    expect(seededUnit([1, 1, 1, 1], 0)).toBe(seededUnit([1, 1, 1, 1], 0));
    expect(seededUnit([1, 1, 1, 1], 0)).not.toBe(seededUnit([1, 1, 1, 2], 0)); // 换档位
    expect(seededUnit([1, 1, 1, 1], 0)).not.toBe(seededUnit([1, 1, 2, 1], 0)); // 换窗口
    expect(seededUnit([1, 1, 1, 1], 0)).not.toBe(seededUnit([1, 1, 1, 1], 2)); // 换抽取
    for (const slot of [1, 2, 3, 7]) {
      for (const draw of [0, 1, 2]) {
        const v = seededUnit([1, 1, 1, slot], draw);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe('活动目录（loadActivityCatalog）：新格式解析、旧格式兼容、非法项剔除', () => {
  it('默认目录六类、slotCap=4、无旧格式键；容量定价字段按 config 默认值解析', async () => {
    const fx = freshEnv();
    const cat = await loadActivityCatalog(fx.env.DB);
    expect(Object.keys(cat.types)).toEqual(['concert', 'esports', 'youth_camp', 'open_day', 'corporate', 'idle']);
    expect(cat.slotCap).toBe(4);
    expect(cat.legacyKeys).toEqual([]);
    expect(cat.types.concert).toMatchObject({
      name: '演唱会',
      pricing: 'capacity',
      pricePerSeat: 0.00015,
      fillRate: 1,
      costBase: 0.275,
      costPerSeat: 0.00002,
      attendMod: 0.95,
      pitchDamageProb: 0.15,
      damageMin: 2,
      damageMax: 5,
    });
    // 设施/声望门槛解析（电竞要转播 L2、企业日要商业 L1 + 声望 20）
    expect(cat.types.esports).toMatchObject({ requiresFacility: 'broadcast', requiresLevel: 2 });
    expect(cat.types.corporate).toMatchObject({ requiresFacility: 'commercial', requiresLevel: 1, requiresReputation: 20 });
  });

  it('activity_slots 是「每窗上限」：改成 1 后 slotCap=1，实际槽数再由容量派生钳制', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedSetting(fx.sqlite, 'activity_slots', '1');
    const cat = await loadActivityCatalog(fx.env.DB);
    expect(cat.slotCap).toBe(1);
    // 容量 20000 派生 3，上限 1 压过派生
    expect(slotsForCapacity(20000, cat.slotCap)).toBe(1);
    await expect(
      bookSlot(fx.env, { clubId: 1, season: 1, windowSeq: 1, slotNo: 2, activityType: 'concert', actor: 1 }),
    ).rejects.toThrow(/档位序号应在 1-1 之间/);
  });

  it('旧格式 income_min/income_max ⇒ pricing=legacy_range、legacyKeys 非空，报价逐字复刻旧乘序', async () => {
    const fx = freshEnv();
    seedActivityConfig(fx.sqlite, legacyCatalogConfig());
    const cat = await loadActivityCatalog(fx.env.DB);
    expect(cat.legacyKeys.sort()).toEqual(['concert', 'youth_camp']);
    const concert = cat.types.concert!;
    expect(concert.pricing).toBe('legacy_range');
    expect(concert.incomeMin).toBe(3);
    expect(concert.incomeMax).toBe(8);
    // 旧配置不套新默认（cost_base/cost_per_seat 缺省 0），否则旧账会突然多扣运营成本
    expect(concert.costBase).toBe(0);
    expect(concert.costPerSeat).toBe(0);
    expect(concert.pitchBoostPerLevel).toBe(0.1); // 旧 activityIncome 只给 concert 乘 (1 + 0.1×草皮级)

    const low = venueQuote(concert, ctxOf({ capacity: 10000 }), 1, { income: 0, damage: 0, damageRoll: 0 });
    const mid = venueQuote(concert, ctxOf({ capacity: 10000 }), 1, { income: 0.5, damage: 0, damageRoll: 0 });
    const high = venueQuote(concert, ctxOf({ capacity: 10000 }), 1, { income: 1, damage: 0, damageRoll: 0 });
    expect([low.gross, mid.gross, high.gross]).toEqual([3, 5.5, 8]);
    expect(mid.opsCost).toBe(0);
    // 草皮 3 级 ⇒ ×(1 + 0.1×3) = 1.3（旧口径：设施乘数是乘出来的，不是加出来的）
    expect(venueQuote(concert, ctxOf({ capacity: 10000, pitchLevel: 3 }), 1, { income: 0, damage: 0, damageRoll: 0 }).gross).toBeCloseTo(3.9, 3);
    // 概率 1 且 roll 0 ⇒ 损坏取下界 2，且不随设施乘数放大
    expect(low.damage).toBe(2);
    // youth_level_factor 迁到 youthBoostPerLevel
    expect(cat.types.youth_camp!.youthBoostPerLevel).toBe(0.1);
    expect(cat.types.youth_camp!.pricing).toBe('flat');
  });

  it('整目录不可用 ⇒ 500；单个非法项（显式区间型却没给合法上下界）被剔除而不是整体崩', async () => {
    const fx = freshEnv();
    seedActivityConfig(fx.sqlite, {});
    await expect(loadActivityCatalog(fx.env.DB)).rejects.toMatchObject({ status: 500 });
    seedActivityConfig(fx.sqlite, {
      concert: { name: '演唱会', pricing: 'legacy_range', income_min: 8 },
      open_day: { name: '球迷开放日', income: 0.2 },
    });
    const cat = await loadActivityCatalog(fx.env.DB);
    expect(cat.types.concert).toBeUndefined();
    expect(cat.types.open_day).toBeDefined();
  });
});

describe('单档报价（activityQuote）：容量定价、运营成本不乘饱和/加成、损坏与期望损坏分离', () => {
  it('容量定价 gross=容量×票价×上座率，opsCost=costBase+costPerSeat×容量', () => {
    const def = {
      name: '演唱会',
      blurb: '',
      pricing: 'capacity' as const,
      pricePerSeat: 0.00015,
      fillRate: 1,
      income: 0,
      incomeMin: 0,
      incomeMax: 0,
      costBase: 0.275,
      costPerSeat: 0.00002,
      attendMod: 0.95,
      reputationGain: 2,
      fansDelta: 0,
      pitchBoostPerLevel: 0,
      youthBoostPerLevel: 0,
      broadcastBoostPerLevel: 0,
      pitchDamageProb: 0.15,
      damageMin: 2,
      damageMax: 5,
      incomeRepBase: 0,
      requiresFacility: null,
      requiresLevel: 0,
      requiresReputation: null,
    };
    const first = venueQuote(def, ctxOf({ capacity: 35000 }), 1, { income: 0.5, damage: 1, damageRoll: 0.99 });
    expect(first.gross).toBeCloseTo(5.25, 3);
    expect(first.opsCost).toBeCloseTo(0.975, 3);
    expect(first.damage).toBe(0); // roll 0.99 > 概率 0.15 ⇒ 本场没坏
    expect(first.expectedDamage).toBeCloseTo(0.525, 3);
    expect(first.expectedNet).toBeCloseTo(3.75, 4);
    // 饱和只压收入，不动运营成本与期望损坏（否则第二档会被罚两次）
    const second = venueQuote(def, ctxOf({ capacity: 35000 }), 0.7, { income: 0.5, damage: 1, damageRoll: 0.99 });
    expect(second.gross).toBeCloseTo(3.675, 3);
    expect(second.opsCost).toBeCloseTo(0.975, 3);
    expect(second.expectedDamage).toBeCloseTo(0.525, 3);
    expect(second.expectedNet).toBeCloseTo(2.175, 4);
  });

  it('企业日按声望加成、青训按青训等级放大、冠名 attendBuff 只乘收入', () => {
    const corporate = {
      name: '企业日',
      blurb: '',
      pricing: 'flat' as const,
      pricePerSeat: 0,
      fillRate: 0,
      income: 0.9,
      incomeMin: 0,
      incomeMax: 0,
      costBase: 0,
      costPerSeat: 0,
      attendMod: 1,
      reputationGain: 3,
      fansDelta: 0,
      pitchBoostPerLevel: 0,
      youthBoostPerLevel: 0,
      broadcastBoostPerLevel: 0,
      pitchDamageProb: 0,
      damageMin: 0,
      damageMax: 0,
      incomeRepBase: 0.5,
      requiresFacility: 'commercial' as const,
      requiresLevel: 1,
      requiresReputation: 20,
    };
    expect(venueQuote(corporate, ctxOf({ reputation: 0 }), 1, ROLLS_MID).gross).toBeCloseTo(0.45, 3);
    expect(venueQuote(corporate, ctxOf({ reputation: 20 }), 1, ROLLS_MID).gross).toBeCloseTo(0.63, 3);
    expect(venueQuote(corporate, ctxOf({ reputation: 100 }), 1, ROLLS_MID).gross).toBeCloseTo(1.35, 3);

    const youth = { ...corporate, name: '青训夏令营', income: 0.7, incomeRepBase: 0, requiresFacility: 'youth' as const, requiresLevel: 1, requiresReputation: null, youthBoostPerLevel: 0.1 };
    expect(venueQuote(youth, ctxOf({ youthLevel: 0 }), 1, ROLLS_MID).gross).toBeCloseTo(0.7, 3);
    expect(venueQuote(youth, ctxOf({ youthLevel: 5 }), 1, ROLLS_MID).gross).toBeCloseTo(1.05, 3);

    const base = venueQuote(youth, ctxOf(), 1, ROLLS_MID);
    const buffed = venueQuote(youth, ctxOf({ attendBuff: 0.02 }), 1, ROLLS_MID);
    expect(buffed.gross).toBeCloseTo(base.gross * 1.02, 3);
    expect(buffed.opsCost).toBe(base.opsCost);
    expect(buffed.expectedDamage).toBe(base.expectedDamage);
  });
});

describe('整窗预览（quotePlan）：饱和按同类序位、不是「每槽都按首档」', () => {
  it('35000 排 4 场演唱会：逐槽 3.75/2.175/0.8625/0.8625，合计 7.65 而非 15.00', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 35000 });
    const picks = [1, 2, 3, 4].map((slotNo) => ({ slotNo, activity: 'concert' }));
    const { plan } = await planOf(fx.env, 1, picks);
    expect(plan.quotes.map((q) => q.expectedNet)).toEqual([3.75, 2.175, 0.8625, 0.8625]);
    expect(plan.quotes.map((q) => q.saturation)).toEqual([1, 0.7, 0.45, 0.45]);
    // 展示用 gross 逐槽 round3（2.3625 → 2.363），合计 13.651；expectedNet 用未取整的毛额，
    // 所以合计仍是 13.65 − 3.9 − 2.1 = 7.65（这条差异正是 §3.3 口径的来源）
    expect(plan.totals).toMatchObject({ gross: 13.651, opsCost: 3.9, expectedDamage: 2.1 });
    expect(plan.totals.expectedNet).toBe(7.65);
    expect(plan.totals.attendanceMod).toBeCloseTo(0.815, 3);
    expect(plan.totals.reputationGain).toBe(8);
    // 「15.00」是逐槽孤立口径（每槽都当自己遇到的首场）：本用例存在的意义就是防回退
    const ifEverySlotWasFirst = plan.quotes.length * 3.75;
    expect(ifEverySlotWasFirst).toBeCloseTo(15, 6);
  });

  it('2 场演唱 + 2 场电竞：两类各自从首档起算，合计 9.385', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 35000 });
    const { plan } = await planOf(fx.env, 1, [
      { slotNo: 1, activity: 'concert' },
      { slotNo: 2, activity: 'esports' },
      { slotNo: 3, activity: 'concert' },
      { slotNo: 4, activity: 'esports' },
    ]);
    // 两类各自从首档起算：5.25 + 3.675 + 2.8 + 1.96 = 13.685（若按 slot_no 一刀切会得 5.25 + 3.675 + 1.96 + 1.31 = 12.195）
    expect(plan.totals.gross).toBeCloseTo(13.685, 3);
    expect(plan.totals.opsCost).toBeCloseTo(3.25, 3); // 0.975×2 + 0.65×2
    expect(plan.totals.expectedNet).toBeCloseTo(9.385, 4);
  });
});

describe('档位预订（bookSlot / venueSlotStatement）', () => {
  it('槽号按容量派生：20000 ⇒ 3 槽，4 号越界；非整数也拒', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const input = { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, activityType: 'concert', actor: 1 };
    await expect(bookSlot(fx.env, { ...input, slotNo: 0 })).rejects.toThrow(/档位序号应在 1-3 之间/);
    await expect(bookSlot(fx.env, { ...input, slotNo: 4 })).rejects.toThrow(/档位序号应在 1-3 之间/);
    await expect(bookSlot(fx.env, { ...input, slotNo: 1.5 })).rejects.toMatchObject({ status: 400 });
    expect((await bookSlot(fx.env, { ...input, slotNo: 3 })).booking.slot_no).toBe(3);
  });

  it('容量 12000 ⇒ 2 槽；没有 stadiums 行 ⇒ 0 座 2 槽（不回退 20000）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 12000 });
    await expect(
      bookSlot(fx.env, { clubId: 1, season: 1, windowSeq: 1, slotNo: 3, activityType: 'concert', actor: 1 }),
    ).rejects.toThrow(/档位序号应在 1-2 之间/);

    const fx2 = freshEnv();
    fx2.sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '无球场', 'premier', 'active');
      INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 1, '2026-01-01T00:00:00Z');
      INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 50, '2026-01-01T00:00:00Z');
      INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
    `);
    const info = await loadVenueContext(fx2.env.DB, 1);
    expect(info).toMatchObject({ capacity: 0, hasStadium: false });
    await expect(
      bookSlot(fx2.env, { clubId: 1, season: 1, windowSeq: 1, slotNo: 3, activityType: 'concert', actor: 1 }),
    ).rejects.toThrow(/档位序号应在 1-2 之间（本队容量 0 座/);
  });

  it('设施/声望闸：电竞要转播 L2、企业日要声望 ≥20；空置档与未知活动各自 400', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 12000 });
    const base = { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, actor: 1 };
    await expect(bookSlot(fx.env, { ...base, activityType: 'esports' })).rejects.toThrow(/需要转播设施 L2（当前 L0）/);
    await expect(bookSlot(fx.env, { ...base, activityType: 'youth_camp' })).rejects.toThrow(/需要青训设施 L1（当前 L0）/);
    await expect(bookSlot(fx.env, { ...base, activityType: 'idle' })).rejects.toThrow(/空置档不用保存/);
    await expect(bookSlot(fx.env, { ...base, activityType: 'opera' })).rejects.toThrow(/没有「opera」这种活动/);

    const fx2 = freshEnv();
    seedClub(fx2.sqlite, { capacity: 12000, reputation: 12, facilities: { commercial: 1 } });
    await expect(bookSlot(fx2.env, { ...base, activityType: 'corporate' })).rejects.toThrow(/需要场馆声望 ≥20（当前 12）/);
    // 声望够 + 商业设施 L1 ⇒ 放行
    fx2.sqlite.exec(`UPDATE stadiums SET venue_reputation = 20 WHERE club_id = 1`);
    expect((await bookSlot(fx2.env, { ...base, activityType: 'corporate' })).booking.activity_type).toBe('corporate');
  });

  it('窗口没开 409（先于活动校验之后的任何状态变化）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { openWindow: false });
    const input = { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, activityType: 'concert', actor: 1 };
    await expect(bookSlot(fx.env, input)).rejects.toThrow(/这一窗已经关了/);
    await expect(bookSlot(fx.env, input)).rejects.toMatchObject({ status: 409 });
  });

  it('同槽位改订覆盖：返回被取代的活动、库里只剩一条；覆盖事件赠档时 booked_by 被改回操作人', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedActivityConfig(fx.sqlite, capacityCatalogConfig(0));
    const input = { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, activityType: 'concert', actor: 1 };
    const first = await bookSlot(fx.env, input);
    expect(first.previous).toBeNull();
    expect(first.booking.booked_by).toBe('1');

    const second = await bookSlot(fx.env, { ...input, activityType: 'esports' });
    expect(second.previous?.activity_type).toBe('concert');
    expect(second.booking.activity_type).toBe('esports');
    const rows = await listBookings(fx.env.DB, 1, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slot_no).toBe(1);

    seedBooking(fx.sqlite, 2, 'open_day', { bookedBy: '事件' });
    const third = await bookSlot(fx.env, { ...input, slotNo: 2, activityType: 'concert' });
    expect(third.previous?.booked_by).toBe('事件');
    expect(third.booking.booked_by).toBe('1');
  });

  it('venueSlotStatement(activityType:null) 是清空（DELETE），不是写 idle 行', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedActivityConfig(fx.sqlite, capacityCatalogConfig(0));
    seedBooking(fx.sqlite, 1, 'concert');
    const cat = await loadActivityCatalog(fx.env.DB);
    const stmt = await venueSlotStatement(fx.env, { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, activityType: null }, cat);
    await stmt.run();
    expect(await listBookings(fx.env.DB, 1, 1, 1)).toHaveLength(0);
    // 语句层兜活动存在性（PUT 直接用它，不能写进未知键）
    await expect(
      venueSlotStatement(fx.env, { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, activityType: 'opera' }, cat),
    ).rejects.toThrow(/没有「opera」这种活动/);
  });
});

describe('窗末结算（bookingSettlement / windowActivityStatements）：三条流水、净现金、幂等', () => {
  it('一档结算后账本恰好三行：activity/booking +gross、maintenance/booking −damage、maintenance/booking_ops −opsCost', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedActivityConfig(fx.sqlite, capacityCatalogConfig(1)); // 概率 1：损坏必然发生，不靠种子运气
    const bookingId = seedBooking(fx.sqlite, 1, 'concert');
    const cat = await loadActivityCatalog(fx.env.DB);
    const info = await loadVenueContext(fx.env.DB, 1);
    const out = await windowActivityStatements(fx.env, 1, 1, 1, cat, {
      capacity: info.capacity,
      reputation: info.venueReputation,
      pitchLevel: 0,
      youthLevel: 0,
      broadcastLevel: 0,
      attendanceRate: 1,
      attendBuff: 0,
    });
    await fx.env.DB.batch(out.statements);

    // 容量 20000：gross = 20000×0.00015 = 3、opsCost = 0.275 + 0.4 = 0.675
    expect(out.gross).toBeCloseTo(3, 3);
    expect(out.opsCost).toBeCloseTo(0.675, 3);
    expect(out.damage).toBeGreaterThan(0);
    expect(out.net).toBeCloseTo(3 - 0.675 - out.damage, 3);

    const rows = sqlAll<{ kind: string; ref_type: string; amount: number; memo: string }>(
      fx.sqlite,
      `SELECT kind, ref_type, amount, memo FROM ledger_entries WHERE ref_id = ?`,
      bookingId,
    );
    expect(rows).toHaveLength(3);
    const byKey = new Map(rows.map((r) => [`${r.kind}/${r.ref_type}`, r] as const));
    expect(byKey.get('activity/booking')!.amount).toBeCloseTo(3, 3);
    expect(byKey.get('maintenance/booking')!.amount).toBeCloseTo(-out.damage, 3);
    expect(byKey.get('maintenance/booking_ops')!.amount).toBeCloseTo(-0.675, 3);
    expect(byKey.get('activity/booking')!.memo).toContain('演唱会（S1 第 1 窗 1 号档期）');
    expect(byKey.get('maintenance/booking')!.memo).toContain('草皮损坏');
    expect(byKey.get('maintenance/booking_ops')!.memo).toContain('运营成本');
    // 账本口径自洽：毛 − 成本 − 损坏 = 净
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBeCloseTo(out.net, 3);
  });

  it('饱和按「同类活动在本窗的序位」：concert/esports/concert ⇒ 第三槽重回 0.45 档而不是继续沿用', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 35000 });
    seedActivityConfig(fx.sqlite, capacityCatalogConfig(0)); // 无损坏，金额可手算
    seedBooking(fx.sqlite, 1, 'concert');
    seedBooking(fx.sqlite, 2, 'esports');
    seedBooking(fx.sqlite, 3, 'concert');
    const cat = await loadActivityCatalog(fx.env.DB);
    const out = await windowActivityStatements(fx.env, 1, 1, 1, cat, ctxOf({ capacity: 35000 }));
    await fx.env.DB.batch(out.statements);

    // 5.25 + 2.8 + 3.675 = 11.725（按 slot_no 一刀切会得 5.25 + 1.96 + 2.3625 = 9.5725）
    expect(out.gross).toBeCloseTo(11.725, 3);
    expect(out.opsCost).toBeCloseTo(2.6, 3); // 0.975 + 0.65 + 0.975
    expect(out.damage).toBe(0);
    expect(out.net).toBeCloseTo(9.125, 3);
    expect(out.attendMod).toBeCloseTo(0.903, 3); // 0.95 × 1.0 × 0.95
    expect(out.reputationGain).toBe(6);
    expect(out.bookings).toBe(3);

    // 每档三条 ⇒ booking/booking_ops 共 9 行；窗末副作用一行（ref_type='window' 属别的批次，这里没有）
    const rows = sqlAll<{ kind: string; ref_type: string; amount: number }>(
      fx.sqlite,
      `SELECT kind, ref_type, amount FROM ledger_entries`,
    );
    expect(rows).toHaveLength(9);
    expect(rows.filter((r) => r.ref_type === 'booking' && r.kind === 'activity')).toHaveLength(3);
    expect(rows.filter((r) => r.ref_type === 'booking_ops')).toHaveLength(3);
    expect(rows.filter((r) => r.ref_type === 'booking' && r.kind === 'maintenance')).toHaveLength(3);
  });

  it('同窗重跑幂等：同种子同额、账本与声望/上座乘数都不二次生效', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedActivityConfig(fx.sqlite, capacityCatalogConfig(1));
    seedBooking(fx.sqlite, 1, 'concert');
    const idleId = seedBooking(fx.sqlite, 2, 'idle');
    const cat = await loadActivityCatalog(fx.env.DB);
    const ctx = ctxOf();

    const first = await windowActivityStatements(fx.env, 1, 1, 1, cat, ctx);
    await fx.env.DB.batch(first.statements);
    const again = await windowActivityStatements(fx.env, 1, 1, 1, cat, ctx);
    await fx.env.DB.batch(again.statements);

    expect(again.gross).toBe(first.gross);
    expect(again.opsCost).toBe(first.opsCost);
    expect(again.damage).toBe(first.damage);
    expect(again.net).toBe(first.net);
    expect(again.bookings).toBe(2); // 含空置档，它不结算

    const counts = sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!;
    expect(counts.n).toBe(3);
    const settlements = sqlGet<{ n: number; rep: number; mod: number; bookings: number }>(
      fx.sqlite,
      `SELECT COUNT(*) AS n, SUM(reputation_gain) AS rep, SUM(attend_mod) AS mod, SUM(bookings) AS bookings
       FROM venue_window_settlements WHERE club_id = 1 AND season = 1 AND window_seq = 1`,
    )!;
    expect(settlements).toMatchObject({ n: 1, rep: 2, mod: 0.95, bookings: 2 });
    // 声望只加一次（不是 4）、上座乘数只乘一次、K 置 5
    const stadium = sqlGet<{ venue_reputation: number; next_attendance_mod: number; attendance_mod_matches: number }>(
      fx.sqlite,
      `SELECT venue_reputation, next_attendance_mod, attendance_mod_matches FROM stadiums WHERE club_id = 1`,
    )!;
    expect(stadium.venue_reputation).toBeCloseTo(2, 3);
    expect(stadium.next_attendance_mod).toBeCloseTo(0.95, 3);
    expect(stadium.attendance_mod_matches).toBe(5);
    expect(await listBookings(fx.env.DB, 1, 1, 1)).toHaveLength(2);
    expect(idleId).toBeGreaterThan(0);
  });

  it('事件预置上座乘数（K=0 但 mod≠1）⇒ 只乘 mod、K 仍 0（事件优先，下一场即清）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedActivityConfig(fx.sqlite, capacityCatalogConfig(0));
    fx.sqlite.exec(`UPDATE stadiums SET next_attendance_mod = 1.2, attendance_mod_matches = 0 WHERE club_id = 1`);
    seedBooking(fx.sqlite, 1, 'concert');
    const cat = await loadActivityCatalog(fx.env.DB);
    const out = await windowActivityStatements(fx.env, 1, 1, 1, cat, ctxOf());
    await fx.env.DB.batch(out.statements);
    const stadium = sqlGet<{ next_attendance_mod: number; attendance_mod_matches: number }>(
      fx.sqlite,
      `SELECT next_attendance_mod, attendance_mod_matches FROM stadiums WHERE club_id = 1`,
    )!;
    expect(stadium.next_attendance_mod).toBeCloseTo(1.14, 3); // 1.2 × 0.95
    expect(stadium.attendance_mod_matches).toBe(0);
  });

  it('没有可结算档位（空置 / 未知活动 / 全空）⇒ 空语句、全 0、不写幂等台账', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const cat = await loadActivityCatalog(fx.env.DB);
    const empty = await windowActivityStatements(fx.env, 1, 1, 1, cat, ctxOf());
    expect(empty.statements).toEqual([]);
    expect(empty).toMatchObject({ gross: 0, opsCost: 0, damage: 0, net: 0, attendMod: 1, bookings: 0 });

    seedBooking(fx.sqlite, 1, 'idle');
    seedBooking(fx.sqlite, 2, 'opera'); // 配置里删掉某活动后旧订单安静跳过
    const [row] = await listBookings(fx.env.DB, 1, 1, 1);
    const one = await bookingSettlement(fx.env, row!, cat, ctxOf(), 1);
    expect(one).toMatchObject({ gross: 0, opsCost: 0, damage: 0 });
    expect(row!.activity_type).toBe('idle');
    const out = await windowActivityStatements(fx.env, 1, 1, 1, cat, ctxOf());
    expect(out.statements).toEqual([]);
    expect(out.bookings).toBe(2);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM venue_window_settlements`)!.n).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n).toBe(0);
  });

  it('关窗批把档期结算并进汇总：activityTotal 是净额、activityOpsCost 单列，且不与 (maintenance, window) 闸相撞', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedActivityConfig(fx.sqlite, capacityCatalogConfig(1));
    seedBooking(fx.sqlite, 1, 'concert');
    const { statements, summary } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: false });
    await fx.env.DB.batch(statements);
    expect(summary.activityClubs).toBe(1);
    expect(summary.maintenanceClubs).toBe(1);
    expect(summary.maintenanceTotal).toBe(2); // 基础维护费（档位 0、本窗 0 场主场）仍独立入账

    const rows = sqlAll<{ kind: string; ref_type: string }>(fx.sqlite, `SELECT kind, ref_type FROM ledger_entries ORDER BY id`);
    expect(rows.filter((r) => r.ref_type === 'window')).toHaveLength(1);
    expect(rows.filter((r) => r.ref_type === 'booking')).toHaveLength(2); // 收入 + 草皮损坏
    expect(rows.filter((r) => r.ref_type === 'booking_ops')).toHaveLength(1);

    // 汇总口径 = 毛收入 − 草皮损坏 − 运营成本（账本三行相加）
    const gross = sqlGet<{ s: number }>(fx.sqlite, `SELECT COALESCE(SUM(amount), 0) AS s FROM ledger_entries WHERE kind = 'activity'`)!.s;
    const damage = sqlGet<{ s: number }>(fx.sqlite, `SELECT COALESCE(SUM(amount), 0) AS s FROM ledger_entries WHERE kind = 'maintenance' AND ref_type = 'booking'`)!.s;
    const opsCost = sqlGet<{ s: number }>(fx.sqlite, `SELECT COALESCE(SUM(amount), 0) AS s FROM ledger_entries WHERE kind = 'maintenance' AND ref_type = 'booking_ops'`)!.s;
    expect(summary.activityOpsCost).toBeCloseTo(Math.round(-opsCost * 100) / 100, 2);
    expect(summary.activityTotal).toBeCloseTo(Math.round((gross + damage + opsCost) * 100) / 100, 2);
  });
});

describe('教练端场馆档期端点（/api/club/venue-plan）', () => {
  const send = (method: string, path: string, env: Env, body?: unknown, cookie = 'whl_session=tok-coach') =>
    app.request(
      path,
      { method, headers: { 'content-type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );

  interface PlanBody {
    capacity: number;
    hasStadium: boolean;
    slotCount: number;
    slotCap: number;
    window: { season: number; windowSeq: number; status: string } | null;
    activities: { key: string; name: string; unlocked: boolean; requirements: { need: number; current: number }[] }[];
    slots: {
      slotNo: number;
      saturation: number;
      booked: string | null;
      quote: { expectedNet: number } | null;
      options: { activity: string; expectedNet: number; unlockReason: string | null }[];
    }[];
    policy: string | null;
    recommendations: Record<string, unknown>;
    bookings: { slotNo: number; activityType: string }[];
    configWarning: string | null;
  }

  it('GET：容量 20000 ⇒ 3 槽 / 上限 4 / 六类活动 / 三条槽；活动带解锁原因', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const res = await send('GET', '/api/club/venue-plan', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanBody;
    expect(body).toMatchObject({ capacity: 20000, hasStadium: true, slotCount: 3, slotCap: 4, policy: null, bookings: [] });
    expect(body.window).toMatchObject({ season: 1, windowSeq: 1, status: 'open' });
    expect(body.activities.map((a) => a.key)).toEqual(['concert', 'esports', 'youth_camp', 'open_day', 'corporate', 'idle']);
    expect(body.activities).toHaveLength(6);
    expect(body.slots.map((s) => s.slotNo)).toEqual([1, 2, 3]);
    expect(body.slots[0]!.options).toHaveLength(6);
    const esports = body.activities.find((a) => a.key === 'esports')!;
    expect(esports.unlocked).toBe(false);
    expect(esports.requirements).toMatchObject([{ need: 2, current: 0 }]);
    // 未排时每槽都按「自己遇到的首档」报价 ⇒ 3 × 3.75 这种孤立口径不能当整窗合计
    expect(body.slots[0]!.options.find((o) => o.activity === 'concert')!.expectedNet).toBeCloseTo(1.8, 3);
    expect(body.slots[0]!.quote).toBeNull();
    expect(Object.keys(body.recommendations).sort()).toEqual(['fans', 'money', 'reputation']);
    expect(body.configWarning).toBeNull();
  });

  it('GET：35000 ⇒ 4 槽；无球场 ⇒ 0 座 2 槽 hasStadium=false', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 35000 });
    const big = (await (await send('GET', '/api/club/venue-plan', fx.env)).json()) as PlanBody;
    expect(big).toMatchObject({ capacity: 35000, slotCount: 4, hasStadium: true });

    const fx2 = freshEnv();
    fx2.sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '无球场', 'premier', 'active');
      INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 1, '2026-01-01T00:00:00Z');
      INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
    `);
    const none = (await (await send('GET', '/api/club/venue-plan', fx2.env)).json()) as PlanBody;
    expect(none).toMatchObject({ capacity: 0, hasStadium: false, slotCount: 2 });
  });

  it('GET：旧格式目录 ⇒ configWarning 点名旧键', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedActivityConfig(fx.sqlite, legacyCatalogConfig());
    const body = (await (await send('GET', '/api/club/venue-plan', fx.env)).json()) as PlanBody;
    expect(body.configWarning).toContain('concert');
  });

  it('GET：响应字段契约锁死（改名/漏字段会让前端静默空）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const body = (await (await send('GET', '/api/club/venue-plan', fx.env)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'activities',
      'attendance',
      'bookings',
      'capacity',
      'clubId',
      'configWarning',
      'facilities',
      'hasStadium',
      'policy',
      'recommendations',
      'reputation',
      'slotCap',
      'slotCount',
      'slots',
      'window',
    ]);
    expect(Object.keys(body.attendance as Record<string, unknown>).sort()).toEqual(['clamp', 'matchesLeft', 'mod']);
    expect((body.facilities as { key: string }[]).map((f) => f.key)).toEqual([
      'commercial',
      'broadcast',
      'pitch',
      'youth',
      'medical',
    ]);
    const win = body.window as Record<string, unknown>;
    expect(Object.keys(win).sort()).toEqual(['closesAt', 'openedAt', 'reminderSent', 'season', 'status', 'windowSeq']);
    expect(Object.keys((body.slots as Record<string, unknown>[])[0]!).sort()).toEqual([
      'booked',
      'options',
      'quote',
      'saturation',
      'slotNo',
    ]);
  });

  it('POST /preview：35000 排 4 场演唱合计 7.65；设施/声望不够只报原因不拒', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 35000 });
    const picks = [1, 2, 3, 4].map((slotNo) => ({ slotNo, activity: 'concert' }));
    const res = await send('POST', '/api/club/venue-plan/preview', fx.env, { slots: picks });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slots: { expectedNet: number }[]; totals: { expectedNet: number; gross: number; opsCost: number }; unlockReasons: Record<string, string> };
    expect(body.slots.map((s) => s.expectedNet)).toEqual([3.75, 2.175, 0.8625, 0.8625]);
    expect(body.totals.expectedNet).toBe(7.65);
    expect(body.totals.gross).toBeCloseTo(13.651, 3);
    expect(body.totals.opsCost).toBeCloseTo(3.9, 3);
    expect(body.unlockReasons).toEqual({});

    // 12000 排电竞 / 声望 12 排企业日：预览照算，只把门槛写进 unlockReasons
    const fx2 = freshEnv();
    seedClub(fx2.sqlite, { capacity: 12000, reputation: 12, facilities: { commercial: 1 } });
    const blocked = (await (await send('POST', '/api/club/venue-plan/preview', fx2.env, {
      slots: [
        { slotNo: 1, activity: 'esports' },
        { slotNo: 2, activity: 'corporate' },
      ],
    })).json()) as { unlockReasons: Record<string, string> };
    expect(blocked.unlockReasons['1']).toContain('需要转播设施 L2');
    expect(blocked.unlockReasons['2']).toContain('需要场馆声望 ≥20');

    // 越界 / 重复 / 未知活动 / 非数组都给 400
    expect((await send('POST', '/api/club/venue-plan/preview', fx.env, { slots: [{ slotNo: 5, activity: 'concert' }] })).status).toBe(400);
    expect(
      (await send('POST', '/api/club/venue-plan/preview', fx.env, { slots: [{ slotNo: 1, activity: 'concert' }, { slotNo: 1, activity: 'open_day' }] })).status,
    ).toBe(400);
    expect((await send('POST', '/api/club/venue-plan/preview', fx.env, { slots: [{ slotNo: 1, activity: 'opera' }] })).status).toBe(400);
    expect((await send('POST', '/api/club/venue-plan/preview', fx.env, {})).status).toBe(400);
  });

  it('POST /preview 不写库：档期行、账本、上座乘数都不动', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 35000 });
    const count = (table: string) => sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ${table}`)!.n;
    const before = { bookings: count('venue_bookings'), ledger: count('ledger_entries') };
    const res = await send('POST', '/api/club/venue-plan/preview', fx.env, {
      slots: [1, 2, 3, 4].map((slotNo) => ({ slotNo, activity: 'concert' })),
    });
    expect(res.status).toBe(200);
    expect(count('venue_bookings')).toBe(before.bookings);
    expect(count('ledger_entries')).toBe(before.ledger);
    expect(
      sqlGet<{ next_attendance_mod: number; attendance_mod_matches: number }>(
        fx.sqlite,
        'SELECT next_attendance_mod, attendance_mod_matches FROM stadiums WHERE club_id = 1',
      ),
    ).toEqual({ next_attendance_mod: 1, attendance_mod_matches: 0 });
  });

  it('PUT：保存后 GET 的合计与预览一致；activity:null 清空该槽；policy 可存可清', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 35000 });
    const picks = [
      { slotNo: 1, activity: 'concert' },
      { slotNo: 2, activity: 'concert' },
      { slotNo: 3, activity: 'open_day' },
    ];
    const preview = (await (await send('POST', '/api/club/venue-plan/preview', fx.env, { slots: picks })).json()) as {
      totals: { expectedNet: number };
    };
    const put = await send('PUT', '/api/club/venue-plan', fx.env, { slots: picks, policy: 'money' });
    expect(put.status).toBe(200);
    const saved = (await put.json()) as { policy: string | null; totals: { expectedNet: number } };
    expect(saved.policy).toBe('money');
    expect(saved.totals.expectedNet).toBeCloseTo(preview.totals.expectedNet, 6);

    const after = (await (await send('GET', '/api/club/venue-plan', fx.env)).json()) as PlanBody;
    expect(after.bookings.map((b) => [b.slotNo, b.activityType])).toEqual([
      [1, 'concert'],
      [2, 'concert'],
      [3, 'open_day'],
    ]);
    expect(after.slots[1]!.saturation).toBe(0.7); // 同类第二档
    expect(after.policy).toBe('money');

    // 清空 2 号槽（activity:null），policy:null 清方针
    const clear = await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 2, activity: null }], policy: null });
    expect(clear.status).toBe(200);
    const cleared = (await (await send('GET', '/api/club/venue-plan', fx.env)).json()) as PlanBody;
    expect(cleared.bookings.map((b) => b.slotNo)).toEqual([1, 3]);
    expect(cleared.policy).toBeNull();
  });

  it('PUT：越界/空置/未知活动 400，没开窗 409（先命中窗口），非法方针 400', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    expect((await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 4, activity: 'concert' }] })).status).toBe(400);
    expect((await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 1, activity: 'idle' }] })).status).toBe(400);
    expect((await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 1, activity: 'opera' }] })).status).toBe(400);
    expect((await send('PUT', '/api/club/venue-plan', fx.env, { policy: 'champion' })).status).toBe(400);
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    const closed = await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 1, activity: 'concert' }] });
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as { error: string }).error).toContain('现在没有开着的窗');
  });

  it('PUT：设施/声望/运营闸都在保存路径上（不是只靠已下线的 bookSlot）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 12000, reputation: 12, facilities: { commercial: 1 } });

    const esports = await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 1, activity: 'esports' }] });
    expect(esports.status).toBe(400);
    expect(((await esports.json()) as { error: string }).error).toContain('需要转播设施 L2');

    const corporate = await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 2, activity: 'corporate' }] });
    expect(corporate.status).toBe(400);
    expect(((await corporate.json()) as { error: string }).error).toContain('需要场馆声望 ≥20');

    // 运营把 consumption 设成「已结束」：前端 useOpsGate 只是提示，服务端必须自己 409
    fx.sqlite.exec(`
      UPDATE ops_schedule
         SET start_anchor = 'absolute', start_at = '2020-01-01T00:00:00.000Z',
             end_anchor = 'absolute', end_at = '2020-01-02T00:00:00.000Z'
       WHERE op_key = 'consumption'
    `);
    resetOpsScheduleCache();
    const gated = await send('PUT', '/api/club/venue-plan', fx.env, { slots: [{ slotNo: 1, activity: 'concert' }] });
    expect(gated.status).toBe(409);
    resetOpsScheduleCache();
  });

  it('没有开窗：GET 的 window 为 null；没绑俱乐部 403；匿名 401', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { openWindow: false });
    const body = (await (await send('GET', '/api/club/venue-plan', fx.env)).json()) as PlanBody;
    expect(body.window).toBeNull();
    expect(body.bookings).toEqual([]);

    const fx2 = freshEnv();
    fx2.sqlite.exec(`
      INSERT INTO clubs (id, name, status) VALUES (1, '没绑定', 'active');
      INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
    `);
    expect((await send('GET', '/api/club/venue-plan', fx2.env)).status).toBe(403);
    expect((await send('PUT', '/api/club/venue-plan', fx2.env, { slots: [] })).status).toBe(403);

    expect((await app.request('/api/club/venue-plan', {}, fx.env)).status).toBe(401);
    expect(
      (
        await app.request(
          '/api/club/venue-plan/preview',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slots: [] }) },
          fx.env,
        )
      ).status,
    ).toBe(401);
  });
});
