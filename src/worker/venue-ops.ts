// 球场档期（v6.9.0 E 块；v6.53.0 P0 改为容量驱动 + 净现金口径）：每窗非比赛日的档位预订与窗末结算。
// 口径唯一真源 memory/plan-v6.53.0-venue-slots-p0.md §3.1 / §4.2：
//   gross      = 基数 × 设施乘数 × (1 + 冠名 attendBuff) × 同类饱和 × (企业日: 0.5 + 声望/100)
//   opsCost    = costBase + costPerSeat × 容量（不乘饱和、不乘加成）
//   damage     = 实际掷点后的草皮损坏；expectedDamage 单列（期望值，不进账本）
//   net        = gross − opsCost − damage
// 账本三条互不冲突的流水（ledger.ts 的幂等闸是 (club_id, kind, ref_type, ref_id)，只能靠 ref_type 区分）：
//   (activity, booking, +gross)、(maintenance, booking, −damage)、(maintenance, booking_ops, −opsCost)。
// 随机数仍是**确定性伪随机**（同 (队, 赛季, 窗, 槽) 逐字恒定）：本仓没有插件那套 window_summaries
// 强制重算，关窗批重跑必须逐字一致；幂等最终仍由账本闸与 venue_window_settlements 兜住。
// 不做（登记）：开放日的 fans_pct 死忠加成（插件本身也未实现）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { seededUnit } from '../core/seeded.ts';
import { isWindowOpen } from './seasons.ts';
import { assertOpOpen } from './ops-schedule.ts';
import {
  ATTENDANCE_K,
  ATTEND_MOD_MAX,
  ATTEND_MOD_MIN,
  REP_MAX,
  REP_MIN,
  SLOT_HARD_MAX,
  activityUnlockReason,
  attendMod as combineAttendMod,
  satMultAt,
  slotsForCapacity,
  venueQuote,
} from '../core/venue.ts';
import type {
  VenueActivityDef,
  VenueContext,
  VenueFacilityKey,
  VenuePricing,
  VenueQuote,
} from '../core/venue.ts';

export const SLOT_MIN = 1;
/** 每窗档位硬上限（与 core 同源，避免两处数字漂移）。 */
export const SLOT_MAX = SLOT_HARD_MAX;
/** config `activity_slots` 缺省值（v6.53.0 起语义是「每窗档位上限」，实际槽数由容量派生后再被它钳制）。 */
const DEFAULT_SLOT_CAP = 4;

/** 兼容旧名：活动定义已是 core 的 VenueActivityDef（本文件曾自定义同名结构）。 */
export type { VenueActivityDef } from '../core/venue.ts';
export type ActivityDef = VenueActivityDef;

export interface ActivityCatalog {
  /** 每窗档位上限（config activity_slots，0 = 关闭档期预订，硬上限 20）。 */
  slotCap: number;
  types: Record<string, VenueActivityDef>;
  /** 仍是旧格式（income_min/income_max 或 youth_level_factor）的活动键 ⇒ 前端 configWarning 非空。 */
  legacyKeys: string[];
}

const FACILITY_KEYS: readonly VenueFacilityKey[] = ['broadcast', 'youth', 'commercial'];

function num(r: Record<string, unknown>, key: string): number | null {
  const v = r[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return typeof v === 'string' ? v : null;
}

function clamp(n: number, low: number, high: number): number {
  if (!Number.isFinite(n)) return low;
  if (n < low) return low;
  if (n > high) return high;
  return n;
}

function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

/** 数字进 memo：最多三位小数、去掉多余的 0（5.25 / 0.975 / 1）。 */
function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * 单个活动定义的解析（白名单 = §3.1 全部键 + 旧键兼容）。
 * 旧键兼容（保留旧经济、不静默改数）：
 *   income_min + income_max 同时存在 → pricing 'legacy_range'，保留区间；income 取中点仅供展示/兜底
 *   youth_level_factor → youthBoostPerLevel；income → flat
 *   旧配置没有运营成本键 ⇒ costBase/costPerSeat = 0（**不要**套新默认的 0.275/0.00002）
 *   旧 activityIncome 只给 concert 乘 (1 + 0.1×草皮级) ⇒ legacy_range 的 concert 缺省 pitchBoostPerLevel = 0.1
 */
function parseDef(raw: unknown, key: string): { def: VenueActivityDef; legacy: boolean } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const incomeMinRaw = num(r, 'income_min');
  const incomeMaxRaw = num(r, 'income_max');
  // 区间型必须成对且上界不小于下界，否则退回固定收入（旧 parseDef 同语义）
  const rangeOK =
    incomeMinRaw !== null && incomeMaxRaw !== null && incomeMaxRaw >= incomeMinRaw;

  const declared = str(r, 'pricing');
  let pricing: VenuePricing;
  if (rangeOK) {
    pricing = 'legacy_range';
  } else if (declared === 'legacy_range') {
    // 显式声明区间型却没给合法上下界 ⇒ 这条活动不合法，剔除（与 validateActivityConfig 同口径）
    return null;
  } else if (declared === 'capacity') {
    pricing = 'capacity';
  } else {
    pricing = 'flat';
  }

  const incomeMin = pricing === 'legacy_range' ? incomeMinRaw! : 0;
  const incomeMax = pricing === 'legacy_range' ? incomeMaxRaw! : 0;
  const income =
    pricing === 'legacy_range'
      ? round3((incomeMin + incomeMax) / 2)
      : Math.max(0, num(r, 'income') ?? 0);

  const youthLevelFactor = num(r, 'youth_level_factor');
  const legacy = pricing === 'legacy_range' || youthLevelFactor !== null;
  // 旧 activityIncome 的演唱会草皮加成 0.1 只活在 legacy 分支；新表在 JSON 里显式给 pitch_boost_per_level
  const pitchDefault = pricing === 'legacy_range' && key === 'concert' ? 0.1 : 0;

  const damageMin = Math.max(0, num(r, 'damage_min') ?? 0);
  const requiresFacilityRaw = str(r, 'requires_facility');
  const requiresReputationRaw = num(r, 'requires_reputation');
  const name = str(r, 'name');

  const def: VenueActivityDef = {
    name: name !== null && name.trim() !== '' ? name.trim() : key,
    blurb: str(r, 'blurb') ?? '',
    pricing,
    pricePerSeat: Math.max(0, num(r, 'price_per_seat') ?? 0),
    fillRate: clamp(num(r, 'fill_rate') ?? 1, 0, 1),
    income,
    incomeMin,
    incomeMax,
    costBase: Math.max(0, num(r, 'cost_base') ?? 0),
    costPerSeat: Math.max(0, num(r, 'cost_per_seat') ?? 0),
    attendMod: clamp(num(r, 'attend_mod') ?? 1, ATTEND_MOD_MIN, ATTEND_MOD_MAX),
    reputationGain: clamp(num(r, 'reputation_gain') ?? 0, 0, 10),
    fansDelta: clamp(num(r, 'fans_delta') ?? 0, 0, 5),
    pitchBoostPerLevel: num(r, 'pitch_boost_per_level') ?? pitchDefault,
    youthBoostPerLevel: num(r, 'youth_boost_per_level') ?? youthLevelFactor ?? 0,
    broadcastBoostPerLevel: num(r, 'broadcast_boost_per_level') ?? 0,
    pitchDamageProb: clamp(num(r, 'pitch_damage_prob') ?? 0, 0, 1),
    damageMin,
    damageMax: Math.max(damageMin, Math.max(0, num(r, 'damage_max') ?? 0)),
    incomeRepBase: Math.max(0, num(r, 'income_rep_base') ?? 0),
    requiresFacility:
      requiresFacilityRaw !== null && FACILITY_KEYS.includes(requiresFacilityRaw as VenueFacilityKey)
        ? (requiresFacilityRaw as VenueFacilityKey)
        : null,
    requiresLevel: clamp(Math.trunc(num(r, 'requires_level') ?? 0), 0, 5),
    requiresReputation:
      requiresReputationRaw === null ? null : clamp(requiresReputationRaw, REP_MIN, REP_MAX),
  };
  return { def, legacy };
}

/** 活动目录（config activity_config JSON + activity_slots）：单个活动非法剔除，整目录为空仍 500。 */
export async function loadActivityCatalog(db: Env['DB']): Promise<ActivityCatalog> {
  const config = createConfigService(db);
  const slotsRaw = await config.getNumber('activity_slots');
  const slotCap = clamp(Math.trunc(slotsRaw ?? DEFAULT_SLOT_CAP), 0, SLOT_HARD_MAX);
  const raw = await config.getJson<Record<string, unknown>>('activity_config');
  const types: Record<string, VenueActivityDef> = {};
  const legacyKeys: string[] = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = parseDef(value, key);
      if (!parsed) continue;
      types[key] = parsed.def;
      if (parsed.legacy) legacyKeys.push(key);
    }
  }
  if (Object.keys(types).length === 0) throw new HttpError(500, '活动目录配置（activity_config）不可用');
  return { slotCap, types, legacyKeys };
}

export interface VenueBookingRow {
  id: number;
  club_id: number;
  season: number;
  window_seq: number;
  slot_no: number;
  activity_type: string;
  booked_by: string;
  created_at: string;
}

export async function listBookings(
  db: Env['DB'],
  clubId: number,
  season: number,
  windowSeq: number,
): Promise<VenueBookingRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, club_id, season, window_seq, slot_no, activity_type, booked_by, created_at
       FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? ORDER BY slot_no`,
    )
    .bind(clubId, season, windowSeq)
    .all<VenueBookingRow>();
  return rows.results;
}

/** 本队场馆现状（容量/声望/待消费乘数/设施等级）。stadiums 无行 ⇒ capacity 0、hasStadium false、
 *  声望 0、乘数 1、K 0、设施空——**不要**回退 20000，缺球场就是 0 座。 */
export interface VenueContextInfo {
  capacity: number;
  hasStadium: boolean;
  venueReputation: number;
  nextAttendanceMod: number;
  attendanceModMatches: number;
  facilities: Map<string, number>;
}

export async function loadVenueContext(db: Env['DB'], clubId: number): Promise<VenueContextInfo> {
  const [stadium, facilityRows] = await Promise.all([
    db
      .prepare(
        `SELECT capacity, venue_reputation, next_attendance_mod, attendance_mod_matches
         FROM stadiums WHERE club_id = ?`,
      )
      .bind(clubId)
      .first<{
        capacity: number;
        venue_reputation: number;
        next_attendance_mod: number;
        attendance_mod_matches: number;
      }>(),
    db
      .prepare(`SELECT facility_key, level FROM club_facilities WHERE club_id = ?`)
      .bind(clubId)
      .all<{ facility_key: string; level: number }>(),
  ]);
  const facilities = new Map<string, number>();
  for (const row of facilityRows.results) facilities.set(row.facility_key, row.level);
  if (!stadium) {
    return {
      capacity: 0,
      hasStadium: false,
      venueReputation: 0,
      nextAttendanceMod: 1,
      attendanceModMatches: 0,
      facilities,
    };
  }
  return {
    capacity: Math.max(0, Math.trunc(stadium.capacity ?? 0)),
    hasStadium: true,
    venueReputation: Number.isFinite(stadium.venue_reputation) ? stadium.venue_reputation : 0,
    nextAttendanceMod: Number.isFinite(stadium.next_attendance_mod) ? stadium.next_attendance_mod : 1,
    attendanceModMatches: Math.max(0, Math.trunc(stadium.attendance_mod_matches ?? 0)),
    facilities,
  };
}

// 确定性伪随机实现已上收 src/core/seeded.ts（v6.54.0，闹涨薪域共用同一随机源）；
// 这里保留再导出，naming-ops / rumors / 既有测试的引用路径不动。
export { seededUnit };

export interface ActivityRolls {
  income: number;
  damage: number;
  damageRoll: number;
}

/** 单档位报价：core 的 venueQuote 加一层名字，Worker 侧统一从这里取（公式仍只有 core 一份）。 */
export function activityQuote(
  def: VenueActivityDef,
  ctx: VenueContext,
  satMult: number,
  rolls: ActivityRolls,
): VenueQuote {
  return venueQuote(def, ctx, satMult, rolls);
}

/** 单档位的结算流水（收入 + 草皮损坏 + 运营成本，三条），未知活动类型返回空。
 *  satMult 由 windowActivityStatements 按「同类活动在本窗的序位」算出后传入（不是 slot_no 序位）。
 *  金额为 0 的流水不落：旧配置缺成本键时 opsCost 恒 0，照落会给没参与经营的队建 0 余额账户，
 *  并让关窗批每档多出两条空语句；对账口径不变（gross − opsCost − damage 仍成立）。 */
export function bookingSettlement(
  env: Env,
  row: VenueBookingRow,
  catalog: ActivityCatalog,
  ctx: VenueContext,
  satMult: number,
): {
  statements: ReturnType<Env['DB']['prepare']>[];
  gross: number;
  opsCost: number;
  damage: number;
  reputationGain: number;
  attendanceMod: number;
} {
  const def = catalog.types[row.activity_type];
  if (!def) {
    return { statements: [], gross: 0, opsCost: 0, damage: 0, reputationGain: 0, attendanceMod: 1 };
  }
  const seed = [row.club_id, row.season, row.window_seq, row.slot_no];
  const quote = activityQuote(def, ctx, satMult, {
    income: seededUnit(seed, 0),
    damage: seededUnit(seed, 1),
    damageRoll: seededUnit(seed, 2),
  });
  const where = `S${row.season} 第 ${row.window_seq} 窗 ${row.slot_no} 号档期`;
  // 品牌档位加成沿用旧文案位置（括号内、紧跟档期描述），后面再接毛收入/饱和（插件口径可回溯）
  const buff = ctx.attendBuff !== 0 ? `，品牌档位加成 ×${(1 + ctx.attendBuff).toFixed(2)}` : '';
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  // 一档固定三条流水（活动收入 / 草皮损坏 / 运营成本），即使金额为 0 也落：
  // 账本行是「这一档结算过」的凭据，缺行会让幂等与审计看不出该档的掷点结果。
  statements.push(
    ...ledgerMovement(env.DB, {
      clubId: row.club_id,
      delta: quote.gross,
      kind: 'activity',
      refType: 'booking',
      refId: row.id,
      memo: `${def.name}（${where}${buff}）（毛 ${fmt(quote.gross)} × 饱和 ${fmt(satMult)}）`,
    }),
  );
  statements.push(
    ...ledgerMovement(env.DB, {
      clubId: row.club_id,
      delta: -quote.damage,
      kind: 'maintenance',
      refType: 'booking',
      refId: row.id,
      memo: `${def.name}草皮损坏（${where}）`,
    }),
  );
  statements.push(
    ...ledgerMovement(env.DB, {
      clubId: row.club_id,
      delta: -quote.opsCost,
      kind: 'maintenance',
      refType: 'booking_ops',
      refId: row.id,
      memo: `${def.name}（${where}）（运营成本 ${fmt(quote.opsCost)}）`,
    }),
  );
  return {
    statements,
    gross: quote.gross,
    opsCost: quote.opsCost,
    damage: quote.damage,
    reputationGain: quote.reputationGain,
    attendanceMod: quote.attendanceMod,
  };
}

/** 窗末副作用（按队一次，不是按槽）：幂等台账 + 声望/上座乘数。
 *  第二条的 `changes() > 0` 读的是**紧邻上一条** INSERT OR IGNORE 是否真的插入了行——重跑关窗批时
 *  INSERT 被忽略 ⇒ 0 ⇒ 声望不二次加、乘数不二次置 5（同 ledger.ts:56-61 的既有写法）。
 *  CASE 里的 attendance_mod_matches / next_attendance_mod 都是本语句执行前的旧值：
 *    K=0 且 mod≠1（随机事件预置）⇒ 只乘 mod、K 仍 0（下一场即清，事件优先）；
 *    K=0 且 mod=1 ⇒ K=5；K>0 ⇒ K 保持。 */
function venueSettlementStatements(
  env: Env,
  clubId: number,
  season: number,
  windowSeq: number,
  reputationGain: number,
  mod: number,
  bookings: number,
): ReturnType<Env['DB']['prepare']>[] {
  return [
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO venue_window_settlements
           (club_id, season, window_seq, reputation_gain, attend_mod, bookings, created_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .bind(clubId, season, windowSeq, reputationGain, mod, bookings),
    env.DB
      .prepare(
        `UPDATE stadiums SET
           venue_reputation = MAX(0, MIN(100, ROUND(venue_reputation + ?, 1))),
           next_attendance_mod = CASE WHEN ? <> 1
             THEN MAX(?, MIN(?, ROUND(next_attendance_mod * ?, 3)))
             ELSE next_attendance_mod END,
           attendance_mod_matches = CASE WHEN ? <> 1
             THEN CASE
               WHEN attendance_mod_matches = 0 AND next_attendance_mod <> 1 THEN 0
               ELSE MAX(attendance_mod_matches, ?)
             END
             ELSE attendance_mod_matches END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE club_id = ? AND changes() > 0`,
      )
      .bind(reputationGain, mod, ATTEND_MOD_MIN, ATTEND_MOD_MAX, mod, mod, ATTENDANCE_K, clubId),
  ];
}

/** 本队本窗全部档位的结算流水（关窗批用）；返回净现金口径合计便于汇总。
 *  无已结算档位（无预订 / 全是空置 / 活动已从目录删掉）⇒ 空语句、全 0，**不写幂等台账**（无副作用）。 */
export async function windowActivityStatements(
  env: Env,
  clubId: number,
  season: number,
  windowSeq: number,
  catalog: ActivityCatalog,
  ctx: VenueContext,
): Promise<{
  statements: ReturnType<Env['DB']['prepare']>[];
  gross: number;
  opsCost: number;
  damage: number;
  net: number;
  reputationGain: number;
  attendMod: number;
  bookings: number;
}> {
  const rows = await listBookings(env.DB, clubId, season, windowSeq);
  // 「已排档位数」= 档期表行数（含历史 idle/已下线活动）：它进幂等台账与页面计数，
  // 与「真正结算了几档」是两回事，别用 settled 冒充。
  const totalBookings = rows.length;
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  // 饱和按「同类活动在本窗的序位」（0-based），不是 slot_no
  const counts = new Map<string, number>();
  let gross = 0;
  let opsCost = 0;
  let damage = 0;
  let mod = 1;
  let reputationGain = 0;
  let settled = 0;

  for (const row of rows) {
    if (row.activity_type === 'idle') continue;
    const def = catalog.types[row.activity_type];
    if (!def) continue; // 配置里删掉某活动后旧订单安静跳过
    const ordinal = counts.get(row.activity_type) ?? 0;
    counts.set(row.activity_type, ordinal + 1);
    const out = bookingSettlement(env, row, catalog, ctx, satMultAt(ordinal));
    if (out.statements.length === 0) continue;
    statements.push(...out.statements);
    settled += 1;
    gross = round3(gross + out.gross);
    opsCost = round3(opsCost + out.opsCost);
    damage = round3(damage + out.damage);
    // 多档上座乘数逐档连乘后夹在 [0.5, 2.0]（与 core quotePlan 同序、同夹法）
    mod = combineAttendMod(mod, out.attendanceMod);
    reputationGain += out.reputationGain;
  }

  if (settled === 0) {
    return {
      statements: [],
      gross: 0,
      opsCost: 0,
      damage: 0,
      net: 0,
      reputationGain: 0,
      attendMod: 1,
      bookings: totalBookings,
    };
  }

  const aggregateMod = round3(mod);
  const totalReputation = round2(reputationGain);
  statements.push(
    ...venueSettlementStatements(env, clubId, season, windowSeq, totalReputation, aggregateMod, totalBookings),
  );
  return {
    statements,
    gross: round3(gross),
    opsCost: round3(opsCost),
    damage: round3(damage),
    net: round3(gross - opsCost - damage),
    reputationGain: totalReputation,
    attendMod: aggregateMod,
    bookings: totalBookings,
  };
}

export interface VenueSlotInput {
  clubId: number;
  season: number;
  windowSeq: number;
  slotNo: number;
  /** null = 清空该槽（PUT 的「暂不排」）；'idle' 不是合法入参（用 null）。 */
  activityType: string | null;
  /** 来源标记：教练操作写 actor 的 id 字符串，事件赠档写 '事件'；覆盖时必须能清回 ''。 */
  bookedBy?: string;
}

/** 单槽写入语句（预订/改订/清空）。校验（槽号范围、设施声望闸、开窗）在 bookSlot 里做，
 *  这里只兜活动存在性——它不改状态、只构造语句，供 PUT 与 bookSlot 共用。
 *  upsert 的冲突目标是 0046 的 UNIQUE (club_id, season, window_seq, slot_no)，
 *  且 booked_by 必须显式 SET：否则覆盖事件赠档的 '事件' 时会残留旧值。 */
export async function venueSlotStatement(
  env: Env,
  input: VenueSlotInput,
  catalog: ActivityCatalog,
): Promise<ReturnType<Env['DB']['prepare']>> {
  if (input.activityType === null) {
    return env.DB
      .prepare(`DELETE FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? AND slot_no = ?`)
      .bind(input.clubId, input.season, input.windowSeq, input.slotNo);
  }
  if (!catalog.types[input.activityType]) {
    throw new HttpError(400, `没有「${input.activityType}」这种活动`);
  }
  const bookedBy = input.bookedBy ?? '';
  return env.DB
    .prepare(
      `INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(club_id, season, window_seq, slot_no) DO UPDATE SET
         activity_type = excluded.activity_type,
         booked_by = excluded.booked_by,
         created_at = excluded.created_at`,
    )
    .bind(input.clubId, input.season, input.windowSeq, input.slotNo, input.activityType, bookedBy);
}

async function loadSlot(
  db: Env['DB'],
  clubId: number,
  season: number,
  windowSeq: number,
  slotNo: number,
): Promise<VenueBookingRow | null> {
  const row = await db
    .prepare(
      `SELECT id, club_id, season, window_seq, slot_no, activity_type, booked_by, created_at
       FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? AND slot_no = ?`,
    )
    .bind(clubId, season, windowSeq, slotNo)
    .first<VenueBookingRow>();
  return row ?? null;
}

/**
 * 预订/改订一个档位（同一槽位覆盖，返回被取代的活动类型供前端提示）。
 * 校验顺序固定（任何一步失败抛 HttpError，message 直接给玩家看）：
 *   槽号范围（容量派生） → 活动存在且不是空置 → 设施/声望门槛 → 开窗 → 消费中心时段闸。
 * 窗口必须正开着且与该 (赛季, 窗) 一致——跨窗改订会落到已关窗上，直接拒。
 */
export async function bookSlot(
  env: Env,
  input: { clubId: number; season: number; windowSeq: number; slotNo: number; activityType: string; actor: number },
  catalog?: ActivityCatalog,
): Promise<{ booking: VenueBookingRow; previous: VenueBookingRow | null }> {
  const acts = catalog ?? (await loadActivityCatalog(env.DB));
  const venue = await loadVenueContext(env.DB, input.clubId);
  const slots = slotsForCapacity(venue.capacity, acts.slotCap);
  if (!Number.isInteger(input.slotNo) || input.slotNo < SLOT_MIN || input.slotNo > slots) {
    throw new HttpError(
      400,
      `档位序号应在 ${SLOT_MIN}-${slots} 之间（本队容量 ${venue.capacity} 座，本窗 ${slots} 个档位）`,
    );
  }
  if (input.activityType === 'idle') throw new HttpError(400, '空置档不用保存，选「暂不排」即可');
  const def = acts.types[input.activityType];
  if (!def) throw new HttpError(400, `没有「${input.activityType}」这种活动`);
  const unlock = activityUnlockReason(def, venue.facilities, venue.venueReputation);
  if (unlock) throw new HttpError(400, unlock);
  if (!(await isWindowOpen(env.DB, input.season, input.windowSeq))) {
    throw new HttpError(409, '档期只能在开着的窗口里订，这一窗已经关了');
  }
  // v6.49.0 运营时刻表：消费中心整体一套时段（0078 把 consumption 锚到 window_open/window_close 后才真正生效）
  await assertOpOpen(env.DB, 'consumption');
  const previous = await loadSlot(env.DB, input.clubId, input.season, input.windowSeq, input.slotNo);
  await venueSlotStatement(
    env,
    { ...input, activityType: input.activityType, bookedBy: String(input.actor) },
    acts,
  ).then((s) => s.run());
  const booking = await loadSlot(env.DB, input.clubId, input.season, input.windowSeq, input.slotNo);
  if (!booking) throw new HttpError(500, '档位预订没能落库');
  return { booking, previous };
}
