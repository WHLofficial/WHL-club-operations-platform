// 球场档期（v6.9.0，E 块）：每窗非比赛日档位的活动预订 + 窗末结算。
// 规则 = revenue 插件 activity_config / formula.activity_income:497（区间型收入 + 演唱会草皮损坏概率 + 设施加成）；
// 收入 kind='activity'、草皮损坏 kind='maintenance'，两者都挂 ref_type='booking' / ref_id=booking.id 的账本闸
// —— 草皮损坏**刻意不共用**基础维护费的 ('maintenance','window',season*100+windowSeq) 闸，防两条流水互吞。
// 本仓无插件那套 window_summaries 强制重算（redo），所以随机数改成**确定性伪随机**：
// 同 (队, 赛季, 窗, 槽, 用途) 逐字恒定，关窗批重跑不漂移（幂等最终仍由账本闸兜住）。
// 不做（登记）：开放日的 fans_pct 死忠加成（插件本身也未实现）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { isWindowOpen } from './seasons.ts';

export const SLOT_MIN = 1;
export const SLOT_MAX = 20;
const DEFAULT_SLOTS = 2;
const PITCH_DAMAGE_REDUCTION_PER_LEVEL = 0.15;
const PITCH_CONCERT_BOOST_PER_LEVEL = 0.1;

export interface ActivityDef {
  name: string;
  /** 固定收入（与 incomeMin/incomeMax 二选一） */
  income: number | null;
  incomeMin: number | null;
  incomeMax: number | null;
  pitchDamageProb: number;
  damageMin: number;
  damageMax: number;
  youthLevelFactor: number;
}

export interface ActivityCatalog {
  slots: number;
  types: Record<string, ActivityDef>;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseDef(raw: unknown, key: string): ActivityDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const def: ActivityDef = {
    name: typeof r.name === 'string' && r.name.trim() !== '' ? r.name.trim() : key,
    income: finite(r.income),
    incomeMin: finite(r.income_min),
    incomeMax: finite(r.income_max),
    pitchDamageProb: finite(r.pitch_damage_prob) ?? 0,
    damageMin: finite(r.damage_min) ?? 0,
    damageMax: finite(r.damage_max) ?? 0,
    youthLevelFactor: finite(r.youth_level_factor) ?? 0,
  };
  // 区间型必须有上下界且上界不小于下界，否则退回固定收入（0）
  if (def.incomeMin !== null && def.incomeMax !== null) {
    if (def.incomeMax < def.incomeMin) return null;
  } else {
    def.incomeMin = null;
    def.incomeMax = null;
  }
  if (def.pitchDamageProb < 0) def.pitchDamageProb = 0;
  if (def.damageMax < def.damageMin) def.damageMax = def.damageMin;
  return def;
}

/** 活动目录（config activity_config JSON + activity_slots）：整段非法回内置默认，单个活动非法剔除。 */
export async function loadActivityCatalog(db: Env['DB']): Promise<ActivityCatalog> {
  const config = createConfigService(db);
  const slotsRaw = await config.getNumber('activity_slots');
  const slots = Math.min(SLOT_MAX, Math.max(0, Math.trunc(slotsRaw ?? DEFAULT_SLOTS)));
  const raw = await config.getJson<Record<string, unknown>>('activity_config');
  const types: Record<string, ActivityDef> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      const def = parseDef(value, key);
      if (def) types[key] = def;
    }
  }
  if (Object.keys(types).length === 0) throw new HttpError(500, '活动目录配置（activity_config）不可用');
  return { slots, types };
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

export async function listBookings(db: Env['DB'], clubId: number, season: number, windowSeq: number): Promise<VenueBookingRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, club_id, season, window_seq, slot_no, activity_type, booked_by, created_at
       FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? ORDER BY slot_no`,
    )
    .bind(clubId, season, windowSeq)
    .all<VenueBookingRow>();
  return rows.results;
}

/** 确定性伪随机 [0,1)：同 seed+draw 恒定（关窗批重跑必须逐字一致）。FNV-1a 喂入 + splitmix32 收尾。 */
export function seededUnit(seed: number[], draw: number): number {
  let h = 0x811c9dc5;
  for (const value of [...seed, draw]) {
    let x = value | 0;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (x & 0xff), 0x01000193) >>> 0;
      x >>>= 8;
    }
  }
  let z = (h + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z / 4294967296;
}

export interface ActivityRolls {
  income: number;
  damage: number;
  damageRoll: number;
}

/**
 * 档期结算（纯函数，插件 activity_income 口径）：
 * 区间型收入 uniform(min,max)；草皮损坏概率 ×(1 − 0.15×草皮级) 后判定，损坏额 uniform(damage_min,damage_max)；
 * 演唱会收入 ×(1 + 0.1×草皮级)（**在损坏判定之后**，与插件同序）；青训夏令营 ×(1 + 系数×青训级)；
 * 品牌档位 attend_buff 最后乘（v6.13.0 C2，插件 window_service income×(1+attend_buff) 同口径；默认 0 与原行为一致）。
 */
export function activityIncome(
  def: ActivityDef,
  activityType: string,
  pitchLevel: number,
  youthLevel: number,
  rolls: ActivityRolls,
  attendBuff = 0,
): { income: number; extraMaintenance: number } {
  let income = def.incomeMin !== null && def.incomeMax !== null ? def.incomeMin + rolls.income * (def.incomeMax - def.incomeMin) : (def.income ?? 0);
  let extra = 0;
  if (def.pitchDamageProb > 0) {
    const prob = Math.max(0, def.pitchDamageProb * (1 - PITCH_DAMAGE_REDUCTION_PER_LEVEL * pitchLevel));
    if (rolls.damageRoll < prob) extra = def.damageMin + rolls.damage * (def.damageMax - def.damageMin);
  }
  if (activityType === 'concert') income *= 1 + PITCH_CONCERT_BOOST_PER_LEVEL * pitchLevel;
  if (activityType === 'youth_camp') income *= 1 + def.youthLevelFactor * youthLevel;
  if (attendBuff !== 0) income *= 1 + attendBuff;
  return { income: Math.round(income * 1000) / 1000, extraMaintenance: Math.round(extra * 1000) / 1000 };
}

/** 单档位的结算流水（收入 + 草皮损坏），纯函数便于测试；未知活动类型返回空。 */
export function bookingSettlement(
  env: Env,
  row: VenueBookingRow,
  catalog: ActivityCatalog,
  pitchLevel: number,
  youthLevel: number,
  attendBuff = 0,
): { statements: ReturnType<Env['DB']['prepare']>[]; income: number; extraMaintenance: number } {
  const def = catalog.types[row.activity_type];
  if (!def) return { statements: [], income: 0, extraMaintenance: 0 };
  const seed = [row.club_id, row.season, row.window_seq, row.slot_no];
  const rolls: ActivityRolls = {
    income: seededUnit(seed, 0),
    damage: seededUnit(seed, 1),
    damageRoll: seededUnit(seed, 2),
  };
  const { income, extraMaintenance } = activityIncome(def, row.activity_type, pitchLevel, youthLevel, rolls, attendBuff);
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  if (income !== 0) {
    statements.push(
      ...ledgerMovement(env.DB, {
        clubId: row.club_id,
        delta: income,
        kind: 'activity',
        refType: 'booking',
        refId: row.id,
        memo: `${def.name}（S${row.season} 第 ${row.window_seq} 窗 ${row.slot_no} 号档期${attendBuff !== 0 ? `，品牌档位加成 ×${(1 + attendBuff).toFixed(2)}` : ''}）`,
      }),
    );
  }
  if (extraMaintenance !== 0) {
    statements.push(
      ...ledgerMovement(env.DB, {
        clubId: row.club_id,
        delta: -extraMaintenance,
        kind: 'maintenance',
        refType: 'booking',
        refId: row.id,
        memo: `${def.name}草皮损坏（S${row.season} 第 ${row.window_seq} 窗 ${row.slot_no} 号档期）`,
      }),
    );
  }
  return { statements, income, extraMaintenance };
}

/** 本队本窗全部档位的结算流水（关窗批用）；返回合计便于汇总。
 *  levels.attendBuff = 生效冠名品牌的档位活动收入加成（v6.13.0 C2，头部 +2%；缺省 0 与原行为一致）。 */
export async function windowActivityStatements(
  env: Env,
  clubId: number,
  season: number,
  windowSeq: number,
  catalog: ActivityCatalog,
  levels: { pitch: number; youth: number; attendBuff?: number },
): Promise<{ statements: ReturnType<Env['DB']['prepare']>[]; income: number; extraMaintenance: number; slots: number }> {
  const rows = await listBookings(env.DB, clubId, season, windowSeq);
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  let income = 0;
  let extraMaintenance = 0;
  for (const row of rows) {
    const out = bookingSettlement(env, row, catalog, levels.pitch, levels.youth, levels.attendBuff ?? 0);
    statements.push(...out.statements);
    income = Math.round((income + out.income) * 1000) / 1000;
    extraMaintenance = Math.round((extraMaintenance + out.extraMaintenance) * 1000) / 1000;
  }
  return { statements, income, extraMaintenance, slots: rows.length };
}

/**
 * 预订/改订一个档位（同一槽位覆盖，返回被取代的活动类型供前端提示）。
 * 窗口必须正开着且与该 (赛季, 窗) 一致——跨窗改订会落到已关窗上，直接拒。
 */
export async function bookSlot(
  env: Env,
  input: { clubId: number; season: number; windowSeq: number; slotNo: number; activityType: string; actor: number },
  catalog?: ActivityCatalog,
): Promise<{ booking: VenueBookingRow; previous: VenueBookingRow | null }> {
  const acts = catalog ?? (await loadActivityCatalog(env.DB));
  if (!Number.isInteger(input.slotNo) || input.slotNo < SLOT_MIN || input.slotNo > acts.slots) {
    throw new HttpError(400, `档位序号应在 ${SLOT_MIN}-${acts.slots} 之间（本季每窗 ${acts.slots} 个档位）`);
  }
  const def = acts.types[input.activityType];
  if (!def) throw new HttpError(400, `没有「${input.activityType}」这种活动`);
  if (!(await isWindowOpen(env.DB, input.season, input.windowSeq))) {
    throw new HttpError(409, '档期只能在开着的窗口里订，这一窗已经关了');
  }
  const previous = await env.DB
    .prepare(
      `SELECT id, club_id, season, window_seq, slot_no, activity_type, booked_by, created_at
       FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? AND slot_no = ?`,
    )
    .bind(input.clubId, input.season, input.windowSeq, input.slotNo)
    .first<VenueBookingRow>();
  await env.DB
    .prepare(
      `INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(club_id, season, window_seq, slot_no) DO UPDATE SET
         activity_type = excluded.activity_type,
         booked_by = excluded.booked_by,
         created_at = excluded.created_at`,
    )
    .bind(input.clubId, input.season, input.windowSeq, input.slotNo, input.activityType, String(input.actor))
    .run();
  const booking = await env.DB
    .prepare(
      `SELECT id, club_id, season, window_seq, slot_no, activity_type, booked_by, created_at
       FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? AND slot_no = ?`,
    )
    .bind(input.clubId, input.season, input.windowSeq, input.slotNo)
    .first<VenueBookingRow>();
  if (!booking) throw new HttpError(500, '档位预订没能落库');
  return { booking, previous: previous ?? null };
}
