// 随机事件域（v6.10.0，D 块）：事件池 → 条件判定 → 加权单抽 → 效果落账（11 键）。
// 口径来源 = 参考插件 services/event_engine.py + services/event_effects.py：
// 每队独立掷 event_hit_probability(0.4) → 候选按条件过滤 → 按 weight 加权单抽 → 效果表逐键落库；
// 同一事件一次分配最多被 event_max_occurrences(2) 队抽中，达上限从后续候选剔除。
//
// 本仓差异（两仓语义不同导致的必然改写，不是简化）：
//  · 事件**不绑窗口**：发生在赛季进行中、可多次触发；occurrence 行只把触发时所处的 (赛季, 窗) 归档。
//  · 没有 window_summaries 强制重算，也没有「下一场未赛主场」行可以改天气 ⇒ 预置类效果
//    （attendance_mod / weather_set）写到 stadiums.next_attendance_mod / next_weather，
//    下一场主场结算时消费并清零（home.ts matchAttendanceStatements）。
//  · 幂等以 occurrence 行自己当闸（本仓事件没有关窗批可依附）：非账本效果语句一律追加
//    `AND (SELECT status FROM event_occurrences WHERE id = ?) = 'pending'`，同批末句置 resolved；
//    账本效果另有 (club, kind, ref_type, ref_id) 查重闸 ⇒ 整批重放安全。
//  · last_result 比的是「最近一场任意场地的已确认赛果」（本仓没有主场索引），插件比的是最近一场主场。
// v6.10.0 只开放即发型（event_type='instant'）；选择型 v6.11.0 开放（表结构已建全，届时零迁移）。
// v6.12.0（D3）起 14 键里 13 键真落库：satisfaction → naming_contracts.satisfaction（0051，钳 [0,2]）；
// signals → 效果值按 event_signals 清洗后入 effects_json，关窗批三消费点（home.ts：fan_mood 死忠、
// upkeep 维护费、fee_mod 冠名费）；offer_spawn 挪 C3（招商轮），触发到该键播报落空。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createConfigService } from '../core/config.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { ledgerMovement } from './ledger.ts';
import { getOpenWindow, type OpenWindow } from './seasons.ts';
import { SLOT_MIN, listBookings, loadActivityCatalog, seededUnit, type ActivityCatalog } from './venue-ops.ts';
import { tourTeamIdsByClub } from './prizes.ts';
import { loadHeatRules, type HeatRules } from './naming-ops.ts';
import { FACILITY_KEYS } from './stadium-ops.ts';
import { queueClubNotification } from './notify.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/** 幂等闸：非账本效果语句一律追加这段（occurrence 行自己当闸，重放时整条不落）。 */
const PENDING_GUARD = `(SELECT status FROM event_occurrences WHERE id = ?) = 'pending'`;

/** 下一场上座乘数钳制区间（插件 next_attendance_mod 的钳幅，两仓同值） */
export const ATTENDANCE_MOD_MIN = 0.5;
export const ATTENDANCE_MOD_MAX = 2.0;
/** 设施等级界（club_facilities.level CHECK 0-5） */
export const FACILITY_MAX_LEVEL = 5;

// ---- 小工具 ----

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function numOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 带符号数字（+3.0 / -0.02）——播报备注用 */
function signedNum(v: number, digits = 2): string {
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}`;
}

function signedMoney(v: number): string {
  return `${signedNum(v, 1)} m`;
}

function signedPct(v: number): string {
  return `${signedNum(v * 100, 1)}%`;
}

function activityName(catalog: ActivityCatalog | null, key: string): string {
  return catalog?.types[key]?.name ?? key;
}

// ---- 规则 / 钳幅（config） ----

export interface EventRules {
  /** 每队每批独立掷中的概率 */
  hitProbability: number;
  /** 每队每批最多触发几条 */
  maxPerClub: number;
  /** 同一事件一批最多被几队抽中 */
  maxOccurrences: number;
  /** soft_conditions=1 的事件条件不满足时的权重衰减系数 */
  softConditionFactor: number;
  /** 选择型事件的选项时限（小时；v6.11.0 用） */
  choiceDeadlineHours: number;
  /** 同队同时最多几条待选事件（0 = 不限；随机抽取达上限跳过、点名触发 409） */
  maxPending: number;
}

export const EVENT_RULES_DEFAULT: EventRules = {
  hitProbability: 0.4,
  maxPerClub: 1,
  maxOccurrences: 2,
  softConditionFactor: 0.25,
  choiceDeadlineHours: 72,
  maxPending: 3,
};

export interface EventClamps {
  money: number;
  fansPct: number;
  maintenance: number;
  brandHeat: number;
  buildCredit: number;
  influence: number;
  bookingCancel: number;
  /** 品牌方情绪单次变化上界（±，插件 _clamp_satisfaction 默认 0.5） */
  satisfaction: number;
}

export const EVENT_CLAMPS_DEFAULT: EventClamps = {
  money: 8,
  fansPct: 0.05,
  maintenance: 5,
  brandHeat: 0.3,
  buildCredit: 5,
  influence: 10,
  bookingCancel: 2,
  satisfaction: 0.5,
};

/** 事件规则（config event_rules，JSON）：缺行或单字段非法按默认逐字段回落。 */
export async function loadEventRules(db: Env['DB']): Promise<EventRules> {
  const raw = await createConfigService(db).getJson<Partial<EventRules>>('event_rules');
  const d = EVENT_RULES_DEFAULT;
  const pick = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = numOf(v);
    return n === null ? fallback : clampNum(n, lo, hi);
  };
  return {
    hitProbability: pick(raw?.hitProbability, 0, 1, d.hitProbability),
    maxPerClub: Math.trunc(pick(raw?.maxPerClub, 1, 20, d.maxPerClub)),
    maxOccurrences: Math.trunc(pick(raw?.maxOccurrences, 1, 20, d.maxOccurrences)),
    softConditionFactor: pick(raw?.softConditionFactor, 0, 1, d.softConditionFactor),
    choiceDeadlineHours: pick(raw?.choiceDeadlineHours, 0, 720, d.choiceDeadlineHours),
    maxPending: Math.trunc(pick(raw?.maxPending, 0, 50, d.maxPending)),
  };
}

/** 效果钳幅（config event_clamps，JSON）：一律取绝对值上界，负值抬 0。 */
export async function loadEventClamps(db: Env['DB']): Promise<EventClamps> {
  const raw = await createConfigService(db).getJson<Partial<EventClamps>>('event_clamps');
  const d = EVENT_CLAMPS_DEFAULT;
  const pick = (v: unknown, fallback: number) => {
    const n = numOf(v);
    return n === null ? fallback : clampNum(Math.abs(n), 0, 1000);
  };
  return {
    money: pick(raw?.money, d.money),
    fansPct: pick(raw?.fansPct, d.fansPct),
    maintenance: pick(raw?.maintenance, d.maintenance),
    brandHeat: pick(raw?.brandHeat, d.brandHeat),
    buildCredit: pick(raw?.buildCredit, d.buildCredit),
    influence: pick(raw?.influence, d.influence),
    bookingCancel: pick(raw?.bookingCancel, d.bookingCancel),
    satisfaction: pick(raw?.satisfaction, d.satisfaction),
  };
}

/** 经营信号定义（config event_signals，JSON）：type=step 步进求和（单值对称钳 clamp）、
 *  type=mult 乘数连乘（积钳 [low, high]）。label 供注记与流水展示。 */
export interface EventSignalDef {
  label: string;
  type: 'step' | 'mult';
  /** step 型：单值对称钳上界 */
  clamp?: number;
  /** mult 型：积钳区间 */
  low?: number;
  high?: number;
}

export type EventSignalDefs = Record<string, EventSignalDef>;

export const EVENT_SIGNALS_DEFAULT: EventSignalDefs = {
  fan_mood: { label: '粉丝情绪', type: 'step', clamp: 2.0 },
  upkeep: { label: '维护负担', type: 'mult', low: 0.5, high: 2.0 },
  fee_mod: { label: '冠名费', type: 'mult', low: 0.5, high: 2.0 },
};

/** 经营信号定义（config event_signals）：缺行或单键非法按默认逐键回落，未登记键忽略。 */
export async function loadEventSignals(db: Env['DB']): Promise<EventSignalDefs> {
  const raw = await createConfigService(db).getJson<Record<string, unknown>>('event_signals');
  const out: EventSignalDefs = {};
  for (const [key, def] of Object.entries(EVENT_SIGNALS_DEFAULT)) {
    const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : null;
    const rec = r !== null && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
    const label = typeof rec.label === 'string' && rec.label !== '' ? rec.label : def.label;
    const type = rec.type === 'step' || rec.type === 'mult' ? rec.type : def.type;
    const clamp = numOf(rec.clamp) ?? def.clamp;
    const low = numOf(rec.low) ?? def.low;
    const high = numOf(rec.high) ?? def.high;
    out[key] =
      type === 'step'
        ? { label, type, clamp: clamp !== undefined && clamp > 0 ? clamp : 2.0 }
        : { label, type, low: low ?? 0.5, high: high ?? 2.0 };
  }
  return out;
}

/**
 * 效果里的 signals 值清洗（插件 `_clamp_signals` 同口径）：未登记的信号名丢弃、非数值丢弃、
 * step 型对称钳 ±clamp、mult 型钳 [low, high]、清完为 0 的键丢弃。全空返回 null（调用方按落空播报）。
 */
export function cleanSignals(value: unknown, defs: EventSignalDefs): Record<string, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const def = defs[key];
    if (def === undefined) continue;
    const n = numOf(raw);
    if (n === null || n === 0) continue;
    out[key] = def.type === 'step' ? clampNum(n, -(def.clamp ?? 2.0), def.clamp ?? 2.0) : clampNum(n, def.low ?? 0.5, def.high ?? 2.0);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 信号的人类可读描述（结算备注 / 选项概率表同口径）：step 印带符号值、mult 印乘数。 */
export function describeSignals(signals: Record<string, number> | null, defs: EventSignalDefs = EVENT_SIGNALS_DEFAULT): string {
  if (signals === null) return '';
  return Object.entries(signals)
    .map(([key, v]) => `${defs[key]?.label ?? key} ${defs[key]?.type === 'mult' ? `×${v}` : signedNum(v)}`)
    .join('、');
}

/** 天气键集合（config attendance_model.weather_probabilities）：weather_set 只认表里有的天气。 */
export async function loadWeatherKeys(db: Env['DB']): Promise<Set<string>> {
  const model = await createConfigService(db).getJson<{ weather_probabilities?: Record<string, number> }>('attendance_model');
  return new Set(Object.keys(model?.weather_probabilities ?? {}));
}

// ---- 事件池 ----

export interface EventRow {
  id: number;
  event_id: string;
  name: string;
  category: string;
  weight: number;
  event_type: string;
  conditions_json: string;
  effects_json: string;
  options_json: string;
  soft_conditions: number;
  template: string;
  source: string;
  status: string;
  created_at: string;
}

export async function loadEventPool(db: Env['DB']): Promise<EventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
              soft_conditions, template, source, status, created_at
       FROM event_pool ORDER BY id`,
    )
    .all<EventRow>();
  return results;
}

/** 单条事件（结算路径只关心一条，不必整池读） */
export async function loadEventById(db: Env['DB'], eventId: string): Promise<EventRow | null> {
  return db
    .prepare(
      `SELECT id, event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
              soft_conditions, template, source, status, created_at
       FROM event_pool WHERE event_id = ?`,
    )
    .bind(eventId)
    .first<EventRow>();
}

// ---- 队况上下文（条件判定与效果的输入） ----

export interface EventStadium {
  club_id: number;
  name: string;
  capacity: number;
  tier: number;
  shell_influence: number;
  bonus_points: number;
  fans: number;
  build_credit: number;
  next_attendance_mod: number;
  next_weather: string;
}

export interface EventClubContext {
  clubId: number;
  name: string;
  stadium: EventStadium;
  balance: number;
  facilities: Map<string, number>;
  /** 生效冠名品牌（无冠名 = null） */
  brand: string | null;
  /** 生效冠名合同行 id（无冠名 = null；satisfaction 效果的落库锚点） */
  namingId: number | null;
  /** 生效冠名的品牌方情绪现值（无冠名 = null） */
  satisfaction: number | null;
  /** 触发窗已排的档期活动类型 */
  activities: string[];
  lastResult: 'W' | 'D' | 'L' | null;
  tourTeamId: number | null;
}

export interface EventResultRow {
  home_team_id: number | null;
  away_team_id: number | null;
  score_home: number | null;
  score_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  walkover_side: string | null;
}

/** 该队最近一场已确认赛果的胜负记号（弃权按取胜方；点球决胜按平——与 home.ts formPtsOf 战绩口径一致）。
 *  行按 id DESC 传入，取第一条涉及该队的。 */
export function lastResultOf(rows: EventResultRow[], tourTeamId: number): 'W' | 'D' | 'L' | null {
  for (const r of rows) {
    if (r.home_team_id === null || r.away_team_id === null) continue;
    if (r.home_team_id !== tourTeamId && r.away_team_id !== tourTeamId) continue;
    if (r.walkover_side === 'home') return r.home_team_id === tourTeamId ? 'W' : 'L';
    if (r.walkover_side === 'away') return r.away_team_id === tourTeamId ? 'W' : 'L';
    if (r.score_home === null || r.score_away === null) continue;
    if (r.score_home === r.score_away) return 'D';
    const winnerIsHome = r.score_home > r.score_away;
    return (winnerIsHome ? r.home_team_id : r.away_team_id) === tourTeamId ? 'W' : 'L';
  }
  return null;
}

/** 批量装队况上下文（一次几条查询，不是每队 N 条）。没有 stadiums 行的队按全零兜底
 *  （条件按 0 判，写 stadiums 的效果自然落空），不整队跳过；clubs 表里没有的 id 直接跳过。 */
export async function loadEventContexts(
  env: Env,
  clubIds: number[],
  season: number,
  windowSeq: number,
): Promise<Map<number, EventClubContext>> {
  const ids = [...new Set(clubIds.filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map<number, EventClubContext>();
  if (ids.length === 0) return out;
  const inList = ids.map(() => '?').join(',');
  const [stadiums, clubs, accounts, facilities, naming, bookings, tourTeams] = await Promise.all([
    env.DB
      .prepare(
        `SELECT club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit,
                next_attendance_mod, next_weather
         FROM stadiums WHERE club_id IN (${inList})`,
      )
      .bind(...ids)
      .all<EventStadium>(),
    env.DB.prepare(`SELECT id, name FROM clubs WHERE id IN (${inList})`).bind(...ids).all<{ id: number; name: string }>(),
    env.DB
      .prepare(`SELECT club_id, balance FROM ledger_accounts WHERE club_id IN (${inList})`)
      .bind(...ids)
      .all<{ club_id: number; balance: number }>(),
    env.DB
      .prepare(`SELECT club_id, facility_key, level FROM club_facilities WHERE club_id IN (${inList})`)
      .bind(...ids)
      .all<{ club_id: number; facility_key: string; level: number }>(),
    env.DB
      .prepare(`SELECT club_id, id, brand, satisfaction FROM naming_contracts WHERE status = 'active' AND club_id IN (${inList})`)
      .bind(...ids)
      .all<{ club_id: number; id: number; brand: string; satisfaction: number }>(),
    env.DB
      .prepare(`SELECT club_id, activity_type FROM venue_bookings WHERE season = ? AND window_seq = ? AND club_id IN (${inList})`)
      .bind(season, windowSeq, ...ids)
      .all<{ club_id: number; activity_type: string }>(),
    tourTeamIdsByClub(env, ids),
  ]);

  const tourIds = [...new Set([...tourTeams.values()])];
  let resultRows: EventResultRow[] = [];
  if (tourIds.length > 0) {
    const marks = tourIds.map(() => '?').join(',');
    resultRows = (
      await env.DB
        .prepare(
          `SELECT home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side
           FROM result_confirmations WHERE home_team_id IN (${marks}) OR away_team_id IN (${marks})
           ORDER BY id DESC`,
        )
        .bind(...tourIds, ...tourIds)
        .all<EventResultRow>()
    ).results;
  }

  // 只给库里真实存在的俱乐部装上下文：写错的 id 直接跳过，免得留下幽灵 occurrence 与流水
  const existing = new Set(clubs.results.map((c) => c.id));
  for (const clubId of ids) {
    if (!existing.has(clubId)) continue;
    const row = stadiums.results.find((s) => s.club_id === clubId);
    const stadium: EventStadium = row ?? {
      club_id: clubId,
      name: '',
      capacity: 0,
      tier: 0,
      shell_influence: 0,
      bonus_points: 0,
      fans: 0,
      build_credit: 0,
      next_attendance_mod: 1,
      next_weather: '',
    };
    const facilityMap = new Map<string, number>();
    for (const f of facilities.results) if (f.club_id === clubId) facilityMap.set(f.facility_key, f.level);
    const tourTeamId = tourTeams.get(clubId) ?? null;
    out.set(clubId, {
      clubId,
      name: clubs.results.find((c) => c.id === clubId)?.name ?? `俱乐部${clubId}`,
      stadium,
      balance: accounts.results.find((a) => a.club_id === clubId)?.balance ?? 0,
      facilities: facilityMap,
      brand: naming.results.find((n) => n.club_id === clubId)?.brand ?? null,
      namingId: naming.results.find((n) => n.club_id === clubId)?.id ?? null,
      satisfaction: naming.results.find((n) => n.club_id === clubId)?.satisfaction ?? null,
      activities: bookings.results.filter((b) => b.club_id === clubId).map((b) => b.activity_type),
      lastResult: tourTeamId === null ? null : lastResultOf(resultRows, tourTeamId),
      tourTeamId,
    });
  }
  return out;
}

// ---- 条件判定与抽取 ----

const LAST_RESULT_ALIAS: Record<string, 'W' | 'D' | 'L'> = {
  win: 'W',
  w: 'W',
  draw: 'D',
  d: 'D',
  loss: 'L',
  l: 'L',
};

/** 硬条件（AND）：min/max_tier、min_capacity、min/max_fans、min/max_balance、facility_min、
 *  weather_is（读预置的下一场天气）、last_result、requires_naming、requires_activity。 */
export function conditionOk(ctx: EventClubContext, cond: Record<string, unknown>): boolean {
  const minTier = numOf(cond.min_tier);
  if (minTier !== null && ctx.stadium.tier < minTier) return false;
  const maxTier = numOf(cond.max_tier);
  if (maxTier !== null && ctx.stadium.tier > maxTier) return false;
  const minCapacity = numOf(cond.min_capacity);
  if (minCapacity !== null && ctx.stadium.capacity < minCapacity) return false;
  // max_capacity 是本仓补的（插件只有 min_capacity）：容量上限条件（如「小场子才出的意外」）
  const maxCapacity = numOf(cond.max_capacity);
  if (maxCapacity !== null && ctx.stadium.capacity > maxCapacity) return false;
  const minFans = numOf(cond.min_fans);
  if (minFans !== null && ctx.stadium.fans < minFans) return false;
  const maxFans = numOf(cond.max_fans);
  if (maxFans !== null && ctx.stadium.fans > maxFans) return false;
  const minBalance = numOf(cond.min_balance);
  if (minBalance !== null && ctx.balance < minBalance) return false;
  const maxBalance = numOf(cond.max_balance);
  if (maxBalance !== null && ctx.balance > maxBalance) return false;
  const facMin = cond.facility_min;
  if (facMin !== null && typeof facMin === 'object') {
    for (const [key, value] of Object.entries(facMin as Record<string, unknown>)) {
      const need = numOf(value);
      if (need === null) continue;
      if (!(FACILITY_KEYS as readonly string[]).includes(key)) continue; // 未知设施键忽略（插件同样不校验）
      if ((ctx.facilities.get(key) ?? 0) < need) return false;
    }
  }
  // 本仓没有提前掷好的比赛行：天气条件读 stadiums.next_weather 预置（没预置 = 不满足）
  if (typeof cond.weather_is === 'string' && ctx.stadium.next_weather !== cond.weather_is) return false;
  if (typeof cond.last_result === 'string') {
    const want = LAST_RESULT_ALIAS[cond.last_result.toLowerCase()];
    if (want === undefined || ctx.lastResult !== want) return false;
  }
  if (cond.requires_naming === true && ctx.brand === null) return false;
  if (typeof cond.requires_activity === 'string' && !ctx.activities.includes(cond.requires_activity)) return false;
  return true;
}

/** 加权单抽（插件 random.choices 同语义）：硬条件不满足剔除；soft_conditions=1 的按
 *  权重×softConditionFactor 衰减参与；已达 maxOccurrences 的事件剔除；选择型没有选项且
 *  不设时限的剔除（触发后永远无法结算的永久 pending 窄口）。无候选返 null。 */
export function pickEvent(
  pool: EventRow[],
  ctx: EventClubContext,
  rules: EventRules,
  rng: () => number,
  used: Record<string, number>,
): EventRow | null {
  const cands: { row: EventRow; weight: number }[] = [];
  for (const row of pool) {
    if (row.status !== 'adopted') continue;
    if ((used[row.event_id] ?? 0) >= rules.maxOccurrences) continue;
    if (row.event_type === 'choice' && rules.choiceDeadlineHours <= 0 && parseEventOptions(row.options_json).length === 0) continue;
    const cond = parseJson<Record<string, unknown>>(row.conditions_json, {});
    const ok = conditionOk(ctx, cond);
    if (!ok && row.soft_conditions !== 1) continue;
    cands.push({ row, weight: ok ? row.weight : row.weight * rules.softConditionFactor });
  }
  const total = cands.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return null;
  let x = rng() * total;
  for (const c of cands) {
    x -= c.weight;
    if (x < 0) return c.row;
  }
  return cands[cands.length - 1]!.row;
}

export function renderEventText(event: EventRow, ctx: EventClubContext): string {
  const stadium = ctx.stadium.name !== '' ? ctx.stadium.name : `${ctx.name}主场`;
  const body = event.template.trim() !== '' ? event.template : `${ctx.name} 触发了事件「${event.name}」。`;
  return body.replace(/\{team\}/g, ctx.name).replace(/\{stadium\}/g, stadium);
}

// ---- 选择型（v6.11.0，D2）：选项 / 结果 / 广播文案 ----

/** 选项里的一条结果分支：权重 w + 效果表（插件 options_json 同形） */
export interface EventOutcome {
  w: number;
  effects: Record<string, unknown>;
}

/** 选择型事件的一个选项 */
export interface EventOption {
  no: number;
  name: string;
  desc: string;
  outcomes: EventOutcome[];
}

/**
 * 解析 options_json（宽容：坏条目整条剔除，缺失权重按 1——插件 `max(1, int(o.get('w', 1)))` 同口径）。
 * 缺 no 的条目无法被玩家选中，直接丢；**重复 no 也丢后者**：路由结算按 `find` 取第一个同号选项，
 * 留着会让玩家点到的按钮与实际结算的选项对不上（前端 `key={o.no}` 也会撞）。
 */
export function parseEventOptions(raw: string | null | undefined): EventOption[] {
  const arr = parseJson<unknown[]>(raw, []);
  if (!Array.isArray(arr)) return [];
  const options: EventOption[] = [];
  const seen = new Set<number>();
  for (const item of arr) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const no = numOf(o.no);
    if (no === null || seen.has(no)) continue;
    seen.add(no);
    const outcomes: EventOutcome[] = [];
    for (const rawOutcome of Array.isArray(o.outcomes) ? o.outcomes : []) {
      if (rawOutcome === null || typeof rawOutcome !== 'object' || Array.isArray(rawOutcome)) continue;
      const r = rawOutcome as Record<string, unknown>;
      const w = numOf(r.w);
      const effects =
        r.effects !== null && typeof r.effects === 'object' && !Array.isArray(r.effects)
          ? (r.effects as Record<string, unknown>)
          : {};
      outcomes.push({ w: w === null || w <= 0 ? 1 : w, effects });
    }
    options.push({
      no,
      name: typeof o.name === 'string' && o.name !== '' ? o.name : `选项${no}`,
      desc: typeof o.desc === 'string' ? o.desc : '',
      outcomes,
    });
  }
  return options;
}

/**
 * 选项概率表里要打「尚未生效」标记的键：offer_spawn（上门报价）依赖招商轮（C3），
 * D3 触发到它一律按「无开放招商轮次」落空。satisfaction / signals 自 v6.12.0 起真落库，不再标注。
 */
const PENDING_EFFECT_KEYS = new Set(['offer_spawn']);
const PENDING_LABEL = '（C3 生效）';

/**
 * 选项概率表用的人类可读效果描述（与结算备注同口径；只读效果表，不依赖队况与配置）。
 * `markPending` 只在**展示**侧打开：给依赖 C3 的 offer_spawn 补一句「（C3 生效）」。
 */
export function describeEffect(key: string, value: unknown, markPending = false, signalDefs?: EventSignalDefs): string {
  const desc = describeEffectPlain(key, value, signalDefs);
  if (desc === '') return '';
  return markPending && PENDING_EFFECT_KEYS.has(key) ? `${desc}${PENDING_LABEL}` : desc;
}

function describeEffectPlain(key: string, value: unknown, signalDefs?: EventSignalDefs): string {
  switch (key) {
    case 'money':
      return `资金 ${signedMoney(numOf(value) ?? 0)}`;
    case 'maintenance':
      return `草皮维护 ${signedMoney(-(numOf(value) ?? 0))}`;
    case 'fans_pct':
      return `死忠 ${signedPct(numOf(value) ?? 0)}`;
    case 'attendance_mod':
      return `下一场上座 ×${(numOf(value) ?? 1).toFixed(2)}`;
    case 'satisfaction':
      return `品牌方情绪 ${signedNum(numOf(value) ?? 0)}`;
    case 'brand_heat':
      return `品牌热度 ${signedNum(numOf(value) ?? 0)}`;
    case 'build_credit':
      return `建设券 ${signedNum(numOf(value) ?? 0)}`;
    case 'influence':
      return `队壳影响力 ${signedNum(numOf(value) ?? 0)}`;
    case 'signals': {
      const cleaned = value !== null && typeof value === 'object' && !Array.isArray(value) ? cleanSignals(value, signalDefs ?? EVENT_SIGNALS_DEFAULT) : null;
      return cleaned !== null ? `经营信号 ${describeSignals(cleaned, signalDefs)}` : '';
    }
    case 'offer_spawn':
      return `上门报价 ${JSON.stringify(value)}`;
    case 'weather_set': {
      const w = (value as { weather?: unknown } | null)?.weather;
      return `下一场天气 → ${typeof w === 'string' ? w : ''}`;
    }
    case 'facility': {
      const f = value as { key?: unknown; delta?: unknown } | null;
      return `设施 ${typeof f?.key === 'string' ? f.key : ''} ${signedNum(numOf(f?.delta) ?? 0, 0)} 级`;
    }
    case 'booking_cancel': {
      const c = value as { count?: unknown } | null;
      return `撤档 ${numOf(c?.count) ?? 0} 个`;
    }
    case 'booking_gift': {
      const g = value as { type?: unknown } | null;
      return `赠档 ${typeof g?.type === 'string' ? g.type : ''}`;
    }
    default:
      return '';
  }
}

export function describeEffects(effects: Record<string, unknown>, markPending = false, signalDefs?: EventSignalDefs): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(effects)) {
    const desc = describeEffect(key, value, markPending, signalDefs);
    if (desc !== '') parts.push(desc);
  }
  return parts.length > 0 ? parts.join('、') : '无变化';
}

export interface WorstPick {
  option: EventOption;
  outcome: EventOutcome;
}

/**
 * 全部选项所有结果里净额最小（money − maintenance）的一条，平局取低选项号再取低结果序号。
 * 无结果的选项不参与；全部选项均无结果 → null（插件 `_worst_option` 同口径，超时兜底用）。
 */
export function worstOption(options: EventOption[]): WorstPick | null {
  let best: WorstPick | null = null;
  let bestKey: [number, number, number] | null = null;
  for (const option of options) {
    for (let j = 0; j < option.outcomes.length; j++) {
      const outcome = option.outcomes[j]!;
      const net = (numOf(outcome.effects.money) ?? 0) - (numOf(outcome.effects.maintenance) ?? 0);
      const key: [number, number, number] = [net, option.no, j];
      const better =
        bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])));
      if (better) {
        bestKey = key;
        best = { option, outcome };
      }
    }
  }
  return best;
}

/**
 * 按选项结果的权重掷骰选一条 outcome（权重 `max(1, trunc(w))`，插件 `_roll_option` 同口径）。
 * 抽取钉在 `[occurrenceId, choiceNo]` 上 ⇒ 同一条事件同一个选项永远得到同一结果（可重放）。
 */
export function rollOptionOutcome(
  option: EventOption,
  occurrenceId: number,
  choiceNo: number,
): EventOutcome | null {
  const outcomes = option.outcomes;
  if (outcomes.length === 0) return null;
  const weights = outcomes.map((o) => Math.max(1, Math.trunc(o.w)));
  const total = weights.reduce((s, w) => s + w, 0);
  let x = seededUnit([occurrenceId, choiceNo], 0) * total;
  for (let i = 0; i < outcomes.length; i++) {
    x -= weights[i]!;
    if (x < 0) return outcomes[i]!;
  }
  return outcomes[outcomes.length - 1]!;
}

const OPTION_GLYPH: Record<number, string> = { 1: '①', 2: '②', 3: '③', 4: '④' };

/** ISO 时刻 → 广播/提醒用的短格式（UTC，`09-29 01:00`） */
export function shortDeadline(iso: string): string {
  return iso.slice(5, 16).replace('T', ' ');
}

/** 选择型触发时的广播文案：叙述段 + 确定性选项概率表（玩家按选项号回复；依赖 C3 的键带「（C3 生效）」标注） */
export function renderChoiceText(
  event: EventRow,
  ctx: EventClubContext,
  options: EventOption[],
  deadlineHours: number,
  signalDefs?: EventSignalDefs,
): string {
  const stadium = ctx.stadium.name !== '' ? ctx.stadium.name : `${ctx.name}主场`;
  const lines = [
    `🎲 事件「${event.name}」（${event.category}）@ ${ctx.name}·${stadium}`,
    renderEventText(event, ctx),
    deadlineHours > 0 ? `请在 ${deadlineHours} 小时内任选一项操作：` : '请任选一项操作：',
  ];
  for (const opt of options) {
    // 概率按权重归一后再印：抽签（rollOptionOutcome）比的是归一权重，把原始 w 直接当百分数只在
    // 「同一选项内权重合计 100」时才等价（内置 18 条恰好合计 100，手写种子不保证）
    const weights = opt.outcomes.map((o) => Math.max(1, Math.trunc(o.w)));
    const total = weights.reduce((s, w) => s + w, 0);
    const odds = opt.outcomes
      .map((o, i) => `${total > 0 ? Math.round((weights[i]! / total) * 100) : 0}% ${describeEffects(o.effects, true, signalDefs)}`)
      .join(' / ');
    lines.push(
      `${OPTION_GLYPH[opt.no] ?? `${opt.no}.`} ${opt.name}` +
        (opt.desc !== '' ? `（${opt.desc}）` : '') +
        (odds !== '' ? `：${odds}` : ''),
    );
  }
  return lines.join('\n');
}

// ---- 效果落账（11 键） ----

export interface EffectRunContext {
  clamps: EventClamps;
  heatRules: HeatRules;
  weatherKeys: Set<string>;
  /** 活动目录（config 不可用时为 null ⇒ 档期类效果落空而不是整批失败） */
  catalog: ActivityCatalog | null;
  openWindow: OpenWindow | null;
  /** 经营信号定义（清洗与播报用） */
  signalDefs: EventSignalDefs;
}

export interface EffectRun {
  statements: D1PreparedStatement[];
  notes: string[];
  applied: Record<string, unknown>;
}

export interface EventOccurrenceRef {
  id: number;
  season: number;
  windowSeq: number;
  name: string;
}

/**
 * 事件效果 → 语句（插件 event_effects.EFFECT_SPECS 同序同钳幅）。
 * 全部语句都带 occurrence 的 pending 守卫；调用方负责在同一批末尾置 resolved。
 */
export async function applyEventEffects(
  env: Env,
  ctx: EventClubContext,
  occ: EventOccurrenceRef,
  effects: Record<string, unknown>,
  ec: EffectRunContext,
): Promise<EffectRun> {
  const db = env.DB;
  const statements: D1PreparedStatement[] = [];
  const notes: string[] = [];
  const applied: Record<string, unknown> = {};
  /** 带 pending 守卫的语句（守卫参数追加在末尾） */
  const guarded = (sql: string, params: unknown[]): D1PreparedStatement =>
    db.prepare(`${sql} AND ${PENDING_GUARD}`).bind(...params, occ.id);

  for (const [key, value] of Object.entries(effects)) {
    switch (key) {
      // 资金：入账/出账都走 kind='event'（TECH_DESIGN §7 早登记该 kind）
      case 'money': {
        const v = clampNum(numOf(value) ?? 0, -ec.clamps.money, ec.clamps.money);
        if (v === 0) break;
        statements.push(
          ...ledgerMovement(db, {
            clubId: ctx.clubId,
            delta: v,
            kind: 'event',
            refType: 'event',
            refId: occ.id,
            memo: `${occ.name}：资金 ${signedMoney(v)}`,
            guardSql: PENDING_GUARD,
            guardParams: [occ.id],
          }),
        );
        applied.money = v;
        notes.push(`资金 ${signedMoney(v)}`);
        break;
      }
      // 维护费：插件也记 kind='event'，本仓改记 kind='maintenance'（草皮损坏同列，且拿到独立闸）。
      // 只钳正向——维护费是出账，事件不返钱（负值抬 0）。
      case 'maintenance': {
        const v = clampNum(numOf(value) ?? 0, 0, ec.clamps.maintenance);
        if (v === 0) break;
        statements.push(
          ...ledgerMovement(db, {
            clubId: ctx.clubId,
            delta: -v,
            kind: 'maintenance',
            refType: 'event',
            refId: occ.id,
            memo: `${occ.name}：草皮维护 -${v.toFixed(1)} m`,
            guardSql: PENDING_GUARD,
            guardParams: [occ.id],
          }),
        );
        applied.maintenance = v;
        notes.push(`草皮维护 -${v.toFixed(1)} m`);
        break;
      }
      // 死忠：fans×(1+v)，钳 [0, capacity]
      case 'fans_pct': {
        const v = clampNum(numOf(value) ?? 0, -ec.clamps.fansPct, ec.clamps.fansPct);
        if (v === 0) break;
        statements.push(
          guarded(`UPDATE stadiums SET fans = MAX(0, MIN(?, ROUND(fans * (1 + ?), 1))), updated_at = ${nowSql()} WHERE club_id = ?`, [
            ctx.stadium.capacity,
            v,
            ctx.clubId,
          ]),
        );
        applied.fans_pct = v;
        notes.push(`死忠 ${signedPct(v)}`);
        break;
      }
      // 下一场上座乘数：与现值**相乘**叠加（插件同），钳 [0.5, 2.0]
      case 'attendance_mod': {
        const v = numOf(value);
        if (v === null || v <= 0) break;
        statements.push(
          guarded(
            `UPDATE stadiums SET next_attendance_mod = MAX(?, MIN(?, ROUND(next_attendance_mod * ?, 3))), updated_at = ${nowSql()} WHERE club_id = ?`,
            [ATTENDANCE_MOD_MIN, ATTENDANCE_MOD_MAX, v, ctx.clubId],
          ),
        );
        applied.attendance_mod = v;
        notes.push(`下一场上座 ×${v}`);
        break;
      }
      // 品牌方情绪：累加进生效冠名的 satisfaction（钳 [0,2]，插件 evolve 侧同钳）；无冠名落空
      case 'satisfaction': {
        const v = clampNum(numOf(value) ?? 0, -ec.clamps.satisfaction, ec.clamps.satisfaction);
        if (v === 0) break;
        if (ctx.namingId === null) {
          notes.push(`品牌方情绪 ${signedNum(v)}（本队没有生效冠名，落空）`);
          break;
        }
        statements.push(
          guarded(`UPDATE naming_contracts SET satisfaction = MAX(0, MIN(2, ROUND(satisfaction + ?, 3))), updated_at = ${nowSql()} WHERE id = ?`, [
            v,
            ctx.namingId,
          ]),
        );
        applied.satisfaction = v;
        notes.push(`品牌方情绪 ${signedNum(v)}`);
        break;
      }
      // 品牌热度：取该队生效冠名品牌，钳 [clampLow, clampHigh]；无冠名落空
      case 'brand_heat': {
        const v = clampNum(numOf(value) ?? 0, -ec.clamps.brandHeat, ec.clamps.brandHeat);
        if (ctx.brand === null) {
          notes.push(`品牌热度 ${signedNum(v)}（本队没有生效冠名，落空）`);
          break;
        }
        if (v === 0) break;
        statements.push(
          guarded(`UPDATE brand_pool SET heat = MAX(?, MIN(?, ROUND(heat + ?, 3))) WHERE brand = ? AND status = 'adopted'`, [
            ec.heatRules.clampLow,
            ec.heatRules.clampHigh,
            v,
            ctx.brand,
          ]),
        );
        applied.brand_heat = v;
        notes.push(`品牌热度 ${signedNum(v)}（${ctx.brand}）`);
        break;
      }
      // 建设券：直改余额，无流水（插件同）
      case 'build_credit': {
        const v = clampNum(numOf(value) ?? 0, -ec.clamps.buildCredit, ec.clamps.buildCredit);
        if (v === 0) break;
        statements.push(
          guarded(`UPDATE stadiums SET build_credit = MAX(0, ROUND(build_credit + ?, 3)), updated_at = ${nowSql()} WHERE club_id = ?`, [
            v,
            ctx.clubId,
          ]),
        );
        applied.build_credit = v;
        notes.push(`建设券 ${signedNum(v)}`);
        break;
      }
      // 队壳影响力：≥0（钳 ±clamps.influence）
      case 'influence': {
        const v = clampNum(numOf(value) ?? 0, -ec.clamps.influence, ec.clamps.influence);
        if (v === 0) break;
        statements.push(
          guarded(
            `UPDATE stadiums SET shell_influence = MAX(0, ROUND(shell_influence + ?, 3)), updated_at = ${nowSql()} WHERE club_id = ?`,
            [v, ctx.clubId],
          ),
        );
        applied.influence = v;
        notes.push(`队壳影响力 ${signedNum(v)}`);
        break;
      }
      // 经营信号：按 event_signals 定义清洗后记进 applied（effects_json），关窗批消费三键
      case 'signals': {
        const cleaned = cleanSignals(value, ec.signalDefs);
        if (cleaned === null) {
          notes.push('经营信号（没有可识别的信号键，落空）');
          break;
        }
        applied.signals = cleaned;
        notes.push(`经营信号 ${describeSignals(cleaned, ec.signalDefs)}`);
        break;
      }
      // 设施升降级：{key, delta}，delta 收敛 ±1，钳 [0, 5]，行缺失同批补 0 级行
      case 'facility': {
        const spec = value !== null && typeof value === 'object' ? (value as { key?: unknown; delta?: unknown }) : null;
        const fkey = typeof spec?.key === 'string' ? spec.key : '';
        if (!(FACILITY_KEYS as readonly string[]).includes(fkey)) {
          notes.push(`设施「${fkey !== '' ? fkey : '?'}」不在设施表里，落空`);
          break;
        }
        const rawDelta = numOf(spec?.delta) ?? 0;
        const delta = rawDelta > 0 ? 1 : rawDelta < 0 ? -1 : 0;
        const cur = ctx.facilities.get(fkey) ?? 0;
        const next = clampNum(cur + delta, 0, FACILITY_MAX_LEVEL);
        if (delta === 0 || next === cur) {
          notes.push(`设施 ${fkey} 已在 ${cur} 级，落空`);
          break;
        }
        statements.push(
          guarded(
            `INSERT OR IGNORE INTO club_facilities (club_id, facility_key, level, updated_at) SELECT ?, ?, 0, ${nowSql()} WHERE 1 = 1`,
            [ctx.clubId, fkey],
          ),
        );
        statements.push(
          guarded(`UPDATE club_facilities SET level = ?, updated_at = ${nowSql()} WHERE club_id = ? AND facility_key = ?`, [
            next,
            ctx.clubId,
            fkey,
          ]),
        );
        applied.facility = { key: fkey, delta: next - cur };
        notes.push(`设施 ${fkey} ${cur}→${next} 级`);
        break;
      }
      // 撤档：按 slot_no 降序撤 n 个（插件同）；没有开窗落空
      case 'booking_cancel': {
        const spec = value !== null && typeof value === 'object' ? (value as { count?: unknown }) : null;
        const want = Math.trunc(clampNum(numOf(spec?.count) ?? 0, 0, ec.clamps.bookingCancel));
        if (want === 0) break;
        if (ec.openWindow === null) {
          notes.push(`撤档 ${want} 个（现在没有开着的窗口，落空）`);
          break;
        }
        const rows = await listBookings(db, ctx.clubId, ec.openWindow.season, ec.openWindow.windowSeq);
        // listBookings 按 slot_no 升序，取尾部 n 个（=最大的 n 个档位）后反转成降序（插件同序）
        const victims = rows.slice(-want).reverse();
        if (victims.length === 0) {
          notes.push(`撤档 ${want} 个（本窗没有已排档期，落空）`);
          break;
        }
        for (const b of victims) {
          statements.push(
            guarded(`DELETE FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? AND slot_no = ?`, [
              ctx.clubId,
              b.season,
              b.window_seq,
              b.slot_no,
            ]),
          );
        }
        applied.booking_cancel = victims.map((b) => b.slot_no);
        notes.push(`撤档 ${victims.map((b) => `档${b.slot_no} ${activityName(ec.catalog, b.activity_type)}`).join('、')}`);
        break;
      }
      // 赠档：找首个空槽插入（booked_by='事件'）；没有开窗落空
      case 'booking_gift': {
        const spec = value !== null && typeof value === 'object' ? (value as { type?: unknown }) : null;
        const atype = typeof spec?.type === 'string' ? spec.type : '';
        if (ec.catalog === null) {
          notes.push('赠档（活动目录不可用，落空）');
          break;
        }
        if (ec.catalog.types[atype] === undefined) {
          notes.push(`赠档（没有「${atype !== '' ? atype : '?'}」这种活动，落空）`);
          break;
        }
        if (ec.openWindow === null) {
          notes.push(`赠档 ${activityName(ec.catalog, atype)}（现在没有开着的窗口，落空）`);
          break;
        }
        const rows = await listBookings(db, ctx.clubId, ec.openWindow.season, ec.openWindow.windowSeq);
        const usedSlots = new Set(rows.map((r) => r.slot_no));
        let slot = 0;
        for (let i = SLOT_MIN; i <= ec.catalog.slots; i++) {
          if (!usedSlots.has(i)) {
            slot = i;
            break;
          }
        }
        if (slot === 0) {
          notes.push(`赠档 ${activityName(ec.catalog, atype)}（档位已满，落空）`);
          break;
        }
        statements.push(
          guarded(
            `INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)
             SELECT ?, ?, ?, ?, ?, '事件', ${nowSql()}
             WHERE NOT EXISTS (SELECT 1 FROM venue_bookings WHERE club_id = ? AND season = ? AND window_seq = ? AND slot_no = ?)`,
            [ctx.clubId, ec.openWindow.season, ec.openWindow.windowSeq, slot, atype, ctx.clubId, ec.openWindow.season, ec.openWindow.windowSeq, slot],
          ),
        );
        applied.booking_gift = { slot, type: atype };
        notes.push(`赠档 档${slot} ${activityName(ec.catalog, atype)}`);
        break;
      }
      // 天气：写预置的下一场天气；不在天气表里的键落空（不抛）
      case 'weather_set': {
        const spec = value !== null && typeof value === 'object' ? (value as { weather?: unknown }) : null;
        const w = typeof spec?.weather === 'string' ? spec.weather : '';
        if (!ec.weatherKeys.has(w)) {
          notes.push(`天气「${w !== '' ? w : '?'}」不在天气表里，落空`);
          break;
        }
        statements.push(guarded(`UPDATE stadiums SET next_weather = ?, updated_at = ${nowSql()} WHERE club_id = ?`, [w, ctx.clubId]));
        applied.weather_set = w;
        notes.push(`下一场天气 → ${w}`);
        break;
      }
      // 上门报价：依赖招商轮（C3 才建），本版恒按「无开放轮次」落空（插件无轮次时同文案）
      case 'offer_spawn': {
        notes.push('当前无开放招商轮次，品牌上门落空');
        break;
      }
      default:
        notes.push(`未知效果键「${key}」，跳过`);
    }
  }
  return { statements, notes, applied };
}

// ---- 触发（管理端驱动） ----

export interface TriggerInput {
  /** 触发时所处的赛季/窗口（只归档，不参与幂等） */
  season: number;
  windowSeq: number;
  actor: number | null;
  origin: AuditOrigin;
  /** 不传 = 全部俱乐部 */
  clubIds?: number[];
  /** 点名触发：绕过命中概率与条件（管理端强制上演） */
  eventId?: string;
  rng?: () => number;
}

export interface TriggeredEvent {
  occurrenceId: number;
  clubId: number;
  clubName: string;
  eventId: string;
  eventName: string;
  /** instant=当刻结算 / choice=进待定等玩家选（v6.11.0 开放） */
  eventType: string;
  /** 选择型的截止时刻（instant 与「不设时限」都是 null） */
  deadlineAt: string | null;
  text: string;
  notes: string[];
  effects: Record<string, unknown>;
}

export interface TriggerResult {
  clubs: number;
  triggered: number;
  /** 掷中但没有可用候选（都被条件挡了或已达 maxOccurrences）的队数 */
  capped: number;
  events: TriggeredEvent[];
}

/**
 * 触发一批随机事件：每队独立掷 hitProbability，命中后加权单抽一条即发型事件并当刻结算。
 * 点名触发（eventId）绕过命中概率、条件与 maxOccurrences——管理端要「这几队就演这个」。
 */
export async function triggerEventBatch(env: Env, input: TriggerInput): Promise<TriggerResult> {
  const rng = input.rng ?? env.rng ?? Math.random;
  const [rules, clamps, pool, heatRules, catalog, openWindow, weatherKeys, signalDefs] = await Promise.all([
    loadEventRules(env.DB),
    loadEventClamps(env.DB),
    loadEventPool(env.DB),
    loadHeatRules(env.DB),
    // 目录配置坏了不该让整批触发失败：档期类效果落空即可
    loadActivityCatalog(env.DB).catch(() => null),
    getOpenWindow(env.DB),
    loadWeatherKeys(env.DB),
    loadEventSignals(env.DB),
  ]);

  let named: EventRow | null = null;
  if (input.eventId !== undefined) {
    named = pool.find((r) => r.event_id === input.eventId) ?? null;
    if (named === null) throw new HttpError(404, `没有「${input.eventId}」这个事件`);
    if (named.status !== 'adopted') throw new HttpError(400, `事件「${named.name}」已停用，先启用再触发`);
    // 选择型没有选项且不设时限 = 结算不出任何结果，触发只会留一条永久 pending（窄口封死）
    if (named.event_type === 'choice' && rules.choiceDeadlineHours <= 0 && parseEventOptions(named.options_json).length === 0) {
      throw new HttpError(400, `事件「${named.name}」没有选项且未设时限，触发后无法结算；先配置选项或时限`);
    }
  }

  const clubIds =
    input.clubIds ??
    (await env.DB.prepare('SELECT id FROM clubs ORDER BY id').all<{ id: number }>()).results.map((r) => r.id);
  if (clubIds.length === 0) return { clubs: 0, triggered: 0, capped: 0, events: [] };

  const contexts = await loadEventContexts(env, clubIds, input.season, input.windowSeq);
  // 同队待选上限：随机抽取达上限跳过本轮（事件流向没满的队），点名触发 409（管理员要明确感知）
  const pendingCounts = new Map<number, number>();
  if (rules.maxPending > 0) {
    const inList = clubIds.map(() => '?').join(',');
    const rows = await env.DB
      .prepare(
        `SELECT club_id, COUNT(*) AS n FROM event_occurrences
         WHERE status = 'pending' AND event_type = 'choice' AND club_id IN (${inList}) GROUP BY club_id`,
      )
      .bind(...clubIds)
      .all<{ club_id: number; n: number }>();
    for (const r of rows.results) pendingCounts.set(r.club_id, r.n);
  }
  // v6.11.0（D2）起两类都参与抽取：即发型当刻结算，选择型进待定等玩家选
  const used: Record<string, number> = {};
  const events: TriggeredEvent[] = [];
  const actorLabel = input.actor === null ? 'system' : String(input.actor);
  let capped = 0;

  for (const clubId of clubIds) {
    const ctx = contexts.get(clubId);
    if (ctx === undefined) continue;
    const attempts = named !== null ? 1 : rules.maxPerClub;
    for (let i = 0; i < attempts; i++) {
      let event: EventRow | null;
      if (named !== null) {
        if (named.event_type === 'choice' && rules.maxPending > 0 && (pendingCounts.get(clubId) ?? 0) >= rules.maxPending) {
          throw new HttpError(409, `「${ctx.name}」的待选事件已达上限（${rules.maxPending} 条），先处理再点名`);
        }
        event = named;
      } else {
        if (rng() >= rules.hitProbability) break;
        event = pickEvent(pool, ctx, rules, rng, used);
        if (event === null) {
          capped++;
          break;
        }
        if (event.event_type === 'choice' && rules.maxPending > 0 && (pendingCounts.get(clubId) ?? 0) >= rules.maxPending) {
          capped++;
          break;
        }
      }
      // 选择型给时限（config choiceDeadlineHours，≤0 = 不设时限、永不自动兜底）
      const isChoice = event.event_type === 'choice';
      const deadlineAt =
        isChoice && rules.choiceDeadlineHours > 0
          ? new Date(Date.now() + rules.choiceDeadlineHours * 3600_000).toISOString()
          : null;
      const options = parseEventOptions(event.options_json);
      const text = isChoice
        ? renderChoiceText(event, ctx, options, rules.choiceDeadlineHours, signalDefs)
        : renderEventText(event, ctx);
      // 先落 occurrence 拿 id（效果语句的幂等闸挂在它身上），再同一批落效果 + 置 resolved + 审计
      const inserted = await env.DB
        .prepare(
          `INSERT INTO event_occurrences
             (club_id, season, window_seq, event_id, event_name, event_type, status, effects_json, notes_json,
              choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', '{}', '[]', NULL, '{}', ?, '', NULL, ?, ${nowSql()})`,
        )
        .bind(clubId, input.season, input.windowSeq, event.event_id, event.name, event.event_type, deadlineAt, text)
        .run();
      const occurrenceId = Number(inserted.meta.last_row_id ?? 0);
      if (isChoice) {
        // 选择型只进待定，不落任何效果——玩家选定或超时兜底时才兑现（插件 _trigger_choice 同）
        pendingCounts.set(clubId, (pendingCounts.get(clubId) ?? 0) + 1);
        await env.DB.batch([
          createAuditStatement(env.DB)({
            actor: input.actor,
            action: 'event_trigger',
            targetType: 'event_occurrence',
            targetId: occurrenceId,
            origin: input.origin,
            after: {
              clubId,
              eventId: event.event_id,
              eventName: event.name,
              eventType: 'choice',
              deadlineAt,
              options,
              text,
            },
          }),
        ]);
        used[event.event_id] = (used[event.event_id] ?? 0) + 1;
        events.push({
          occurrenceId,
          clubId,
          clubName: ctx.name,
          eventId: event.event_id,
          eventName: event.name,
          eventType: 'choice',
          deadlineAt,
          text,
          notes: [],
          effects: {},
        });
        await queueClubNotification(env, clubId, 'event_triggered', {
          club: ctx.name,
          name: event.name,
          text,
          notes:
            deadlineAt !== null
              ? `待你选择，截止 ${shortDeadline(deadlineAt)}，超时按资金最差结果自动结算`
              : '待你选择',
        });
        continue;
      }
      const effects = parseJson<Record<string, unknown>>(event.effects_json, {});
      const run = await applyEventEffects(
        env,
        ctx,
        { id: occurrenceId, season: input.season, windowSeq: input.windowSeq, name: event.name },
        effects,
        { clamps, heatRules, weatherKeys, catalog, openWindow, signalDefs },
      );
      await env.DB.batch([
        ...run.statements,
        env.DB
          .prepare(
            `UPDATE event_occurrences SET status = 'resolved', effects_json = ?, notes_json = ?, resolved_by = ?,
                    resolved_at = ${nowSql()}, text = ? WHERE id = ? AND status = 'pending'`,
          )
          .bind(JSON.stringify(run.applied), JSON.stringify(run.notes), actorLabel, text, occurrenceId),
        createAuditStatement(env.DB)({
          actor: input.actor,
          action: 'event_trigger',
          targetType: 'event_occurrence',
          targetId: occurrenceId,
          origin: input.origin,
          after: {
            clubId,
            eventId: event.event_id,
            eventName: event.name,
            effects: run.applied,
            notes: run.notes,
            text,
          },
        }),
      ]);
      used[event.event_id] = (used[event.event_id] ?? 0) + 1;
      events.push({
        occurrenceId,
        clubId,
        clubName: ctx.name,
        eventId: event.event_id,
        eventName: event.name,
        eventType: 'instant',
        deadlineAt: null,
        text,
        notes: run.notes,
        effects: run.applied,
      });
      // 即时型也广播（站内信 + QQ），尽力而为，失败不阻断
      await queueClubNotification(env, clubId, 'event_triggered', {
        club: ctx.name,
        name: event.name,
        text,
        notes: run.notes.join('；'),
      });
    }
  }

  return { clubs: contexts.size, triggered: events.length, capped, events };
}

// ---- 选择型结算（v6.11.0，D2）：玩家选定 / 超时兜底 / 教练端视图 ----

interface OccurrenceRow {
  id: number;
  club_id: number;
  season: number;
  window_seq: number;
  event_id: string;
  event_name: string;
  event_type: string;
  status: string;
  deadline_at: string | null;
  club_name: string | null;
}

export interface ResolveInput {
  occurrenceId: number;
  /** 玩家选项号；不传/null = 按净额最差兜底（超时未选，或选项号无效） */
  choiceNo?: number | null;
  actor: number | null;
  origin: AuditOrigin;
  /** 超时兜底：resolved_by 记 'auto'（玩家自选与管理员代选都记 actor id） */
  auto?: boolean;
}

export interface ResolvedEvent {
  occurrenceId: number;
  clubId: number;
  clubName: string;
  eventId: string;
  eventName: string;
  optionNo: number | null;
  optionName: string;
  auto: boolean;
  skipped: boolean;
  /** 结算口径（`选2 局部修补省钱` / `自动最差（未收到选择）` / `无选项信息，跳过`） */
  how: string;
  effects: Record<string, unknown>;
  notes: string[];
  text: string;
}

/**
 * 结算一条选择型事件：玩家选定（choiceNo）或按净额最差兜底（choiceNo 缺省 / 选项号无效）。
 * 幂等以 occurrence 行的 pending 状态为闸（效果语句与 UPDATE 都带 `status = 'pending'`），
 * 整批原子 ⇒ 重放安全；并发抢同一行时 UPDATE 改 0 行 ⇒ 409（效果语句被守卫挡下，不会双记）。
 */
export async function resolveEvent(env: Env, input: ResolveInput): Promise<ResolvedEvent> {
  const row = await env.DB.prepare(
    `SELECT o.id, o.club_id, o.season, o.window_seq, o.event_id, o.event_name, o.event_type, o.status,
            o.deadline_at, c.name AS club_name
     FROM event_occurrences o LEFT JOIN clubs c ON c.id = o.club_id
     WHERE o.id = ?`,
  )
    .bind(input.occurrenceId)
    .first<OccurrenceRow>();
  if (row === null) throw new HttpError(404, '没有这条事件记录');
  if (row.status !== 'pending') throw new HttpError(409, '这条事件已经结算过了');
  if (row.event_type !== 'choice') throw new HttpError(409, '即发型事件没有可选项');

  const event = await loadEventById(env.DB, row.event_id);
  const eventName = event !== null ? event.name : row.event_name;
  const options = parseEventOptions(event?.options_json);
  const asked = input.choiceNo === null || input.choiceNo === undefined ? null : input.choiceNo;
  let option: EventOption | null = null;
  let outcome: EventOutcome | null = null;
  let auto = input.auto === true || asked === null;
  let skipped = false;
  let how = '';

  if (options.length === 0) {
    skipped = true;
    how = '无选项信息，跳过';
  } else {
    if (!auto) {
      option = options.find((o) => o.no === asked) ?? null;
      // 选项号无效同样按最差兜底（插件 `_resolve_choice` 同口径）；路由层已先拦 400
      if (option === null) auto = true;
    }
    if (auto) {
      const worst = worstOption(options);
      if (worst === null) {
        skipped = true;
        how = '选项均无结果，跳过';
      } else {
        option = worst.option;
        outcome = worst.outcome;
        how = asked === null ? '自动最差（未收到选择）' : '自动最差（选项号无效）';
      }
    } else if (option !== null) {
      outcome = rollOptionOutcome(option, row.id, option.no);
      how = `选${option.no} ${option.name}`;
    }
  }

  // 队况与效果依赖（6 次读）只在真要落效果时装：无选项 / 选项均无结果的跳过路径不白读
  let ctx: EventClubContext | undefined;
  let ec: EffectRunContext | null = null;
  if (!skipped) {
    ctx = (await loadEventContexts(env, [row.club_id], row.season, row.window_seq)).get(row.club_id);
    if (ctx === undefined) throw new HttpError(409, '这个俱乐部已经不在册，事件无法结算');
    const [clamps, heatRules, catalog, openWindow, weatherKeys, signalDefs] = await Promise.all([
      loadEventClamps(env.DB),
      loadHeatRules(env.DB),
      loadActivityCatalog(env.DB).catch(() => null),
      getOpenWindow(env.DB),
      loadWeatherKeys(env.DB),
      loadEventSignals(env.DB),
    ]);
    ec = { clamps, heatRules, weatherKeys, catalog, openWindow, signalDefs };
  }

  const run: EffectRun = skipped
    ? { statements: [], notes: [], applied: {} }
    : await applyEventEffects(
        env,
        ctx!,
        { id: row.id, season: row.season, windowSeq: row.window_seq, name: option === null ? eventName : `${eventName}·${option.name}` },
        outcome !== null ? outcome.effects : {},
        ec!,
      );
  const notes = [...run.notes];
  if (!skipped && outcome === null) notes.push('选项无结果配置，按无效果结算');
  const optionNo = skipped ? null : (option?.no ?? null);
  const optionName = option?.name ?? '';
  const outcomeJson = skipped ? { skipped: true } : { option: optionNo, option_name: optionName, auto, effects: outcome !== null ? outcome.effects : {} };
  const text = skipped
    ? `「${eventName}」${how}`
    : `${option === null ? eventName : `${eventName}·${option.name}`}：${how}${notes.length > 0 ? `（${notes.join('；')}）` : ''}`;
  const resolvedBy = input.auto === true ? 'auto' : input.actor === null ? 'system' : String(input.actor);
  // 超时兜底记 expired（0048 的状态注释原义「expired=超时兜底」），玩家/管理员结算记 resolved
  const finalStatus = input.auto === true ? 'expired' : 'resolved';

  // 审计排在批次首位、挂 PENDING_GUARD：它与状态 UPDATE 在同一批里求值，守卫没过就一行不留
  // （并发抢同一条时，抢输的一方账本被挡下，审计也必须一起挡下，否则留下失实的 after 快照）。
  // 顺序不可反：同批内逐条执行，排在 UPDATE 之后的守卫读到的已是 resolved，恒为假、赢家也丢审计。
  const results = await env.DB.batch([
    createAuditStatement(env.DB)({
      actor: input.actor,
      action: 'event_resolve',
      targetType: 'event_occurrence',
      targetId: row.id,
      origin: input.origin,
      before: { status: 'pending' },
      after: { optionNo, optionName, auto, skipped, effects: run.applied, notes, text },
      guardSql: PENDING_GUARD,
      guardParams: [row.id],
    }),
    ...run.statements,
    env.DB
      .prepare(
        `UPDATE event_occurrences SET status = ?, choice_no = ?, outcome_json = ?, effects_json = ?,
                notes_json = ?, resolved_by = ?, resolved_at = ${nowSql()}, text = ? WHERE id = ? AND status = 'pending'`,
      )
      .bind(
        finalStatus,
        optionNo,
        JSON.stringify(outcomeJson),
        JSON.stringify(run.applied),
        JSON.stringify(notes),
        resolvedBy,
        text,
        row.id,
      ),
  ]);
  const claimed = Number(results[results.length - 1]?.meta?.changes ?? 0);
  if (claimed === 0) throw new HttpError(409, '这条事件刚被并发结算，请刷新');

  await queueClubNotification(env, row.club_id, 'event_resolved', {
    club: ctx !== undefined ? ctx.name : row.club_name !== null && row.club_name !== '' ? row.club_name : `俱乐部${row.club_id}`,
    name: eventName,
    how: finalStatus === 'expired' ? `${how}（超时自动结算）` : how,
    notes: notes.join('；'),
  });

  return {
    occurrenceId: row.id,
    clubId: row.club_id,
    clubName: ctx !== undefined ? ctx.name : row.club_name !== null && row.club_name !== '' ? row.club_name : `俱乐部${row.club_id}`,
    eventId: row.event_id,
    eventName,
    optionNo,
    optionName,
    auto,
    skipped,
    how,
    effects: run.applied,
    notes,
    text,
  };
}

export interface EventTickResult {
  /** 超时兜底结算的条数 */
  expired: number;
  /** 首次发出「距时限 24h」提醒的条数 */
  reminded: number;
  /** 扫到但结算不掉的条数（并发已结 / 俱乐部已不在册） */
  skipped: number;
}

const EVENT_TICK_LIMIT = 50;

/**
 * cron 兜底（5 分钟一跳，与惰性结算同批）：超时未选的选择型按净额最差自动结算 + 距时限 24h 提醒。
 * **只挑 `deadline_at IS NOT NULL`**：即发型是「先 INSERT 再同批落效果」的，进程中途挂掉会留下
 * status='pending' 的即发型残留行，无差别兜底会把这些残行当「超时未选」误结算。
 */
export async function expirePendingEvents(env: Env, nowIso?: string): Promise<EventTickResult> {
  const now = nowIso ?? new Date().toISOString();
  // 下界 7 天：结算不掉的残行（唯一可达来源是「俱乐部已不在册」）会一直留在 pending、deadline 已过期，
  // 而本查询是 `ORDER BY id LIMIT`，积够 50 条就把整个超时兜底挤停摆。超时兜底自 D3 起记 `expired`
  // 终态（resolveEvent auto 路径），但这类结算必然失败的残行仍到不了终态，7 天下界继续限伤。
  const floor = new Date(Date.parse(now) - 7 * 24 * 3600_000).toISOString();
  const due = await env.DB.prepare(
    `SELECT id FROM event_occurrences
     WHERE status = 'pending' AND deadline_at IS NOT NULL AND deadline_at <= ? AND deadline_at >= ?
     ORDER BY id LIMIT ?`,
  )
    .bind(now, floor, EVENT_TICK_LIMIT)
    .all<{ id: number }>();

  let expired = 0;
  let skipped = 0;
  for (const r of due.results) {
    try {
      await resolveEvent(env, {
        occurrenceId: r.id,
        choiceNo: null,
        actor: null,
        origin: 'cron_tick',
        auto: true,
      });
      expired++;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      skipped++;
    }
  }

  // 距时限 24h 提醒：reminded_at 自己当闸（同一条只提醒一次，并发/重放安全）。
  // 上界 `<= soon` 之外还要 `> now`：少了它会给已经过期的行推「还有不到 24 小时可选」。
  const soon = new Date(Date.parse(now) + 24 * 3600_000).toISOString();
  const pending = await env.DB.prepare(
    `SELECT o.id, o.club_id, o.event_name, o.deadline_at, c.name AS club_name
     FROM event_occurrences o LEFT JOIN clubs c ON c.id = o.club_id
     WHERE o.status = 'pending' AND o.deadline_at IS NOT NULL AND o.reminded_at = ''
       AND o.deadline_at <= ? AND o.deadline_at > ?
     ORDER BY o.id LIMIT ?`,
  )
    .bind(soon, now, EVENT_TICK_LIMIT)
    .all<{ id: number; club_id: number; event_name: string; deadline_at: string; club_name: string | null }>();

  let reminded = 0;
  for (const r of pending.results) {
    const claim = await env.DB.prepare(
      `UPDATE event_occurrences SET reminded_at = ?
       WHERE id = ? AND status = 'pending' AND reminded_at = ''`,
    )
      .bind(now, r.id)
      .run();
    if (Number(claim.meta.changes ?? 0) === 0) continue;
    reminded++;
    await queueClubNotification(env, r.club_id, 'event_deadline', {
      club: r.club_name !== null && r.club_name !== '' ? r.club_name : `俱乐部${r.club_id}`,
      name: r.event_name,
      deadline: shortDeadline(r.deadline_at),
    })
  }

  return { expired, reminded, skipped };
}

export interface ClubEventPending {
  id: number;
  eventId: string;
  eventName: string;
  deadlineAt: string | null;
  text: string;
  options: EventOption[];
}

export interface ClubEventRecent {
  id: number;
  eventId: string;
  eventName: string;
  eventType: string;
  choiceNo: number | null;
  optionName: string;
  auto: boolean;
  skipped: boolean;
  effects: Record<string, unknown>;
  notes: string[];
  text: string;
  resolvedBy: string;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ClubEventsView {
  pending: ClubEventPending[];
  recent: ClubEventRecent[];
}
/** 教练端事件视图：待选（选择型未结）+ 最近已结（含即发型，按 id 倒序）；两个列表同走 limit 钳 1..50 */
export async function listClubEvents(env: Env, clubId: number, recentLimit = 10): Promise<ClubEventsView> {
  const limit = Math.max(1, Math.min(50, Math.trunc(recentLimit)));
  const [pendRows, recentRows, pool] = await Promise.all([
    env.DB.prepare(
      `SELECT id, event_id, event_name, deadline_at, text FROM event_occurrences
       WHERE club_id = ? AND status = 'pending' AND event_type = 'choice'
       ORDER BY id DESC LIMIT ?`,
    )
      .bind(clubId, limit)
      .all<{ id: number; event_id: string; event_name: string; deadline_at: string | null; text: string }>(),
    env.DB.prepare(
      `SELECT id, event_id, event_name, event_type, choice_no, outcome_json, notes_json, text,
              resolved_by, resolved_at, created_at
       FROM event_occurrences WHERE club_id = ? AND status <> 'pending'
       ORDER BY id DESC LIMIT ?`,
    )
      .bind(clubId, limit)
      .all<{
        id: number;
        event_id: string;
        event_name: string;
        event_type: string;
        choice_no: number | null;
        outcome_json: string;
        notes_json: string;
        text: string;
        resolved_by: string;
        resolved_at: string | null;
        created_at: string;
      }>(),
    loadEventPool(env.DB),
  ]);

  const optionsByEvent = new Map<string, EventOption[]>();
  for (const r of pool) optionsByEvent.set(r.event_id, parseEventOptions(r.options_json));

  return {
    pending: pendRows.results.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      eventName: r.event_name,
      deadlineAt: r.deadline_at,
      text: r.text,
      options: optionsByEvent.get(r.event_id) ?? [],
    })),
    recent: recentRows.results.map((r) => {
      const outcome = parseJson<{ option_name?: unknown; auto?: unknown; skipped?: unknown; effects?: unknown }>(
        r.outcome_json,
        {},
      );
      const effects =
        outcome.effects !== null && typeof outcome.effects === 'object' && !Array.isArray(outcome.effects)
          ? (outcome.effects as Record<string, unknown>)
          : {};
      return {
        id: r.id,
        eventId: r.event_id,
        eventName: r.event_name,
        eventType: r.event_type,
        choiceNo: r.choice_no,
        optionName: typeof outcome.option_name === 'string' ? outcome.option_name : '',
        auto: outcome.auto === true,
        skipped: outcome.skipped === true,
        effects,
        notes: parseJson<string[]>(r.notes_json, []),
        text: r.text,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at,
        createdAt: r.created_at,
      };
    }),
  };
}

// ---- 关窗批消费经营信号（v6.12.0，D3）----

export interface WindowSignalFactors {
  /** step 型信号求和（fan_mood） */
  steps: Record<string, number>;
  /** mult 型信号连乘积（已按 [low, high] 终钳；upkeep / fee_mod） */
  mults: Record<string, number>;
}

/**
 * 收集某窗触发的事件里沉淀的经营信号（插件 `collect_window_signals` 同思路：只读事件日志不落状态，
 * 首结与重算同源）。信号值在效果落账时已按 event_signals 清洗过（单值钳幅），这里做聚合：
 * step 求和、mult 连乘后再终钳 [low, high]。没有信号记录的队不在返回 Map 里。
 *
 * 已知边界：信号按 occurrence 归档的 (season, window_seq) 归窗——选择型若拖到归档窗关闭之后才结算，
 * 其信号会落在已关的窗里、不再被消费（幅度小：fan_mood ±2 / 乘数 ≤2，登记接受）。
 */
export async function collectWindowSignals(
  db: Env['DB'],
  season: number,
  windowSeq: number,
  defs: EventSignalDefs = EVENT_SIGNALS_DEFAULT,
): Promise<Map<number, WindowSignalFactors>> {
  const { results } = await db
    .prepare(
      `SELECT club_id, effects_json FROM event_occurrences
       WHERE season = ? AND window_seq = ? AND status IN ('resolved', 'expired') ORDER BY id`,
    )
    .bind(season, windowSeq)
    .all<{ club_id: number; effects_json: string }>();
  const out = new Map<number, WindowSignalFactors>();
  for (const r of results) {
    const effects = parseJson<Record<string, unknown>>(r.effects_json, {});
    const signals = effects.signals;
    if (signals === null || typeof signals !== 'object' || Array.isArray(signals)) continue;
    const acc = out.get(r.club_id) ?? { steps: {}, mults: {} };
    for (const [key, raw] of Object.entries(signals as Record<string, unknown>)) {
      const def = defs[key];
      const n = numOf(raw);
      if (def === undefined || n === null) continue;
      if (def.type === 'step') acc.steps[key] = (acc.steps[key] ?? 0) + n;
      else acc.mults[key] = (acc.mults[key] ?? 1) * n;
    }
    out.set(r.club_id, acc);
  }
  // mult 终钳（插件 mult_factor 同口径）：逐队逐键钳 [low, high]
  for (const acc of out.values()) {
    for (const [key, v] of Object.entries(acc.mults)) {
      const def = defs[key];
      acc.mults[key] = clampNum(v, def?.low ?? 0.5, def?.high ?? 2.0);
    }
  }
  return out;
}

/** 结算通知 / 账本注记用的人类可读信号行（只列非中性项）。 */
export function windowSignalNoteLines(sig: WindowSignalFactors, defs: EventSignalDefs): string[] {
  const lines: string[] = [];
  for (const [key, v] of Object.entries(sig.steps)) {
    if (v === 0) continue;
    const label = defs[key]?.label ?? key;
    lines.push(`${label} ${signedNum(v)}（死忠演化 ×${(1 + v / 100).toFixed(2)}）`);
  }
  for (const [key, v] of Object.entries(sig.mults)) {
    if (v === 1) continue;
    const label = defs[key]?.label ?? key;
    const surface = key === 'upkeep' ? '维护费' : key === 'fee_mod' ? '冠名收入' : '相关费用';
    lines.push(`${label} ×${v}（本窗${surface}${v > 1 ? '上浮' : '下浮'}）`);
  }
  return lines;
}

/** 关窗批尾部调用：给本窗有非中性经营信号的队各排一条「经营信号」通知（尽力而为，失败不阻断）。 */
export async function queueWindowSignalNotes(
  env: Env,
  season: number,
  windowSeq: number,
  defs: EventSignalDefs,
): Promise<void> {
  const signals = await collectWindowSignals(env.DB, season, windowSeq, defs);
  if (signals.size === 0) return;
  const ids = [...signals.keys()];
  const clubs = await env.DB
    .prepare(`SELECT id, name FROM clubs WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: number; name: string }>();
  for (const [clubId, sig] of signals) {
    const lines = windowSignalNoteLines(sig, defs);
    if (lines.length === 0) continue;
    const name = clubs.results.find((c) => c.id === clubId)?.name ?? `俱乐部${clubId}`;
    await queueClubNotification(env, clubId, 'window_signals', {
      club: name,
      window: `S${season} 第 ${windowSeq} 窗`,
      lines: lines.join('；'),
    });
  }
}

// ---- LLM 结构草稿钳制（v6.12.0，D3；管理端 only）----

/** LLM 草稿允许出现的条件键（conditionOk 认得的全部） */
const DRAFT_CONDITION_KEYS = new Set([
  'min_tier', 'max_tier', 'min_capacity', 'max_capacity', 'min_fans', 'max_fans', 'min_balance', 'max_balance',
  'facility_min', 'weather_is', 'last_result', 'requires_naming', 'requires_activity',
]);

const DRAFT_CONDITION_NUM_RANGE: Record<string, [number, number]> = {
  min_tier: [0, 4],
  max_tier: [0, 4],
  min_capacity: [0, 200_000],
  max_capacity: [0, 200_000],
  min_fans: [0, 100_000],
  max_fans: [0, 100_000],
  min_balance: [0, 10_000],
  max_balance: [0, 10_000],
};

export interface EventDraftStruct {
  event_id: string;
  name: string;
  category: string;
  weight: number;
  event_type: 'instant' | 'choice';
  conditions: Record<string, unknown>;
  effects: Record<string, unknown>;
  options: { no: number; name: string; desc: string; outcomes: { w: number; effects: Record<string, unknown> }[] }[];
  template: string;
}

/**
 * LLM 生成的事件结构草稿过钳制闸（插件 design_events 的 `_clamp_event` 同思路）：
 * 未登记键丢弃、数值全部钳进 event_clamps / 信号定义区间、结构不合最低要求直接报错。
 * 返回钳后的结构 + 调整清单（管理端展示「哪些被改了」）；抛 HttpError(400) = 草稿不可救。
 */
export function clampEventDraft(
  raw: unknown,
  ec: { clamps: EventClamps; signalDefs: EventSignalDefs; weatherKeys: Set<string> },
): { event: EventDraftStruct; adjustments: string[] } {
  const adjustments: string[] = [];
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const drop = (what: string) => adjustments.push(`丢弃 ${what}`);

  const eventId = typeof src.event_id === 'string' && /^[a-z][a-z0-9_]{2,31}$/.test(src.event_id) ? src.event_id : '';
  if (eventId === '') throw new HttpError(400, 'event_id 缺失或不合规范（小写字母开头，3-32 位小写字母/数字/下划线）');
  const name = typeof src.name === 'string' ? src.name.trim().slice(0, 20) : '';
  if (name === '') throw new HttpError(400, 'name 缺失');
  const category = typeof src.category === 'string' && src.category.trim() !== '' ? src.category.trim().slice(0, 12) : '通用';
  const weightRaw = numOf(src.weight) ?? 10;
  const weight = Math.trunc(clampNum(weightRaw, 1, 10));
  if (weight !== weightRaw) adjustments.push(`weight 钳到 ${weight}`);
  const eventType = src.event_type === 'choice' ? 'choice' : src.event_type === 'instant' ? 'instant' : '';
  if (eventType === '') throw new HttpError(400, 'event_type 只能是 instant 或 choice');

  // 条件：白名单 + 数值区间；未知键丢弃
  const conditions: Record<string, unknown> = {};
  const rawCond = src.conditions !== null && typeof src.conditions === 'object' && !Array.isArray(src.conditions) ? (src.conditions as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawCond)) {
    if (!DRAFT_CONDITION_KEYS.has(key)) {
      drop(`条件「${key}」`);
      continue;
    }
    if (key === 'requires_naming') {
      if (value === true) conditions[key] = true;
      continue;
    }
    if (key === 'facility_min') {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const fac: Record<string, number> = {};
        for (const [fk, fv] of Object.entries(value as Record<string, unknown>)) {
          if ((FACILITY_KEYS as readonly string[]).includes(fk) && numOf(fv) !== null) fac[fk] = clampNum(Math.trunc(numOf(fv)!), 0, FACILITY_MAX_LEVEL);
        }
        if (Object.keys(fac).length > 0) conditions[key] = fac;
      }
      continue;
    }
    const range = DRAFT_CONDITION_NUM_RANGE[key];
    if (range !== undefined) {
      const n = numOf(value);
      if (n !== null) conditions[key] = clampNum(n, range[0], range[1]);
      continue;
    }
    if (key === 'weather_is' && typeof value === 'string') {
      if (ec.weatherKeys.has(value)) conditions[key] = value;
      else drop(`条件 weather_is「${value}」（不在天气表）`);
      continue;
    }
    if (key === 'last_result' && typeof value === 'string') {
      if (LAST_RESULT_ALIAS[value.toLowerCase()] !== undefined) conditions[key] = value;
      else drop(`条件 last_result「${value}」`);
      continue;
    }
    if (key === 'requires_activity' && typeof value === 'string' && value !== '') conditions[key] = value.slice(0, 20);
  }

  /** 效果表钳制：即时效果与选项分支共用 */
  const clampEffects = (rawEffects: unknown, where: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (rawEffects === null || typeof rawEffects !== 'object' || Array.isArray(rawEffects)) return out;
    for (const [key, value] of Object.entries(rawEffects as Record<string, unknown>)) {
      switch (key) {
        case 'money': {
          const n = clampNum(numOf(value) ?? 0, -ec.clamps.money, ec.clamps.money);
          if (n !== 0) out[key] = Math.round(n * 10) / 10;
          break;
        }
        case 'maintenance': {
          const n = clampNum(numOf(value) ?? 0, 0, ec.clamps.maintenance);
          if (n !== 0) out[key] = Math.round(n * 10) / 10;
          break;
        }
        case 'fans_pct': {
          const n = clampNum(numOf(value) ?? 0, -ec.clamps.fansPct, ec.clamps.fansPct);
          if (n !== 0) out[key] = Math.round(n * 1000) / 1000;
          break;
        }
        case 'attendance_mod': {
          const n = clampNum(numOf(value) ?? 1, ATTENDANCE_MOD_MIN, ATTENDANCE_MOD_MAX);
          if (n !== 1) out[key] = Math.round(n * 1000) / 1000;
          break;
        }
        case 'satisfaction': {
          const n = clampNum(numOf(value) ?? 0, -ec.clamps.satisfaction, ec.clamps.satisfaction);
          if (n !== 0) out[key] = Math.round(n * 1000) / 1000;
          break;
        }
        case 'brand_heat': {
          const n = clampNum(numOf(value) ?? 0, -ec.clamps.brandHeat, ec.clamps.brandHeat);
          if (n !== 0) out[key] = Math.round(n * 1000) / 1000;
          break;
        }
        case 'build_credit': {
          const n = clampNum(numOf(value) ?? 0, -ec.clamps.buildCredit, ec.clamps.buildCredit);
          if (n !== 0) out[key] = Math.round(n * 10) / 10;
          break;
        }
        case 'influence': {
          const n = clampNum(numOf(value) ?? 0, -ec.clamps.influence, ec.clamps.influence);
          if (n !== 0) out[key] = Math.round(n * 10) / 10;
          break;
        }
        case 'weather_set': {
          const w = (value as { weather?: unknown } | null)?.weather;
          if (typeof w === 'string' && ec.weatherKeys.has(w)) out[key] = { weather: w };
          else drop(`${where} 的 weather_set（不在天气表）`);
          break;
        }
        case 'facility': {
          const f = value as { key?: unknown; delta?: unknown } | null;
          const fkey = typeof f?.key === 'string' ? f.key : '';
          const delta = Math.sign(numOf(f?.delta) ?? 0);
          if ((FACILITY_KEYS as readonly string[]).includes(fkey) && delta !== 0) out[key] = { key: fkey, delta };
          else drop(`${where} 的 facility`);
          break;
        }
        case 'booking_cancel': {
          const c = Math.trunc(clampNum(numOf((value as { count?: unknown } | null)?.count) ?? 0, 0, ec.clamps.bookingCancel));
          if (c !== 0) out[key] = { count: c };
          break;
        }
        case 'booking_gift': {
          const t = (value as { type?: unknown } | null)?.type;
          if (typeof t === 'string' && t !== '') out[key] = { type: t.slice(0, 20) };
          break;
        }
        case 'signals': {
          const cleaned = cleanSignals(value, ec.signalDefs);
          if (cleaned !== null) out[key] = cleaned;
          break;
        }
        default:
          drop(`${where} 的效果键「${key}」`);
      }
    }
    return out;
  };

  let effects: Record<string, unknown> = {};
  let options: EventDraftStruct['options'] = [];
  if (eventType === 'instant') {
    effects = clampEffects(src.effects, '即时效果');
    if (Object.keys(effects).length === 0) throw new HttpError(400, '即时型草稿没有任何合法效果键');
  } else {
    const rawOptions = Array.isArray(src.options) ? src.options : [];
    const seenNo = new Set<number>();
    for (const rawOpt of rawOptions.slice(0, 4)) {
      if (rawOpt === null || typeof rawOpt !== 'object' || Array.isArray(rawOpt)) continue;
      const o = rawOpt as Record<string, unknown>;
      const no = numOf(o.no);
      if (no === null || !Number.isInteger(no) || no < 1 || no > 9 || seenNo.has(no)) {
        drop('一个选项（no 越界或重复）');
        continue;
      }
      seenNo.add(no);
      const outcomes: { w: number; effects: Record<string, unknown> }[] = [];
      for (const rawOutcome of (Array.isArray(o.outcomes) ? o.outcomes : []).slice(0, 4)) {
        if (rawOutcome === null || typeof rawOutcome !== 'object' || Array.isArray(rawOutcome)) continue;
        const r = rawOutcome as Record<string, unknown>;
        const w = Math.trunc(clampNum(numOf(r.w) ?? 1, 1, 100));
        outcomes.push({ w, effects: clampEffects(r.effects, `选项${no}分支`) });
      }
      if (outcomes.length === 0) {
        drop(`选项${no}（没有任何合法结果分支）`);
        continue;
      }
      options.push({
        no,
        name: typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim().slice(0, 30) : `选项${no}`,
        desc: typeof o.desc === 'string' ? o.desc.slice(0, 60) : '',
        outcomes,
      });
    }
    if (options.length < 2) throw new HttpError(400, '选择型草稿至少要 2 个合法选项');
  }

  const template = typeof src.template === 'string' ? src.template.slice(0, 120) : '';
  return {
    event: { event_id: eventId, name, category, weight, event_type: eventType, conditions, effects, options, template },
    adjustments,
  };
}
