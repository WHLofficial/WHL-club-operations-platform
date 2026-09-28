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
// 未接入（D 块计划留给 v6.12.0）：satisfaction（落 naming_contracts）、signals（落 club_signals）、
// offer_spawn（生成限时折扣冠名报价）——三条都在 notes 里留痕播报，不静默吞掉。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createConfigService } from '../core/config.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { ledgerMovement } from './ledger.ts';
import { getOpenWindow, type OpenWindow } from './seasons.ts';
import { SLOT_MIN, listBookings, loadActivityCatalog, type ActivityCatalog } from './venue-ops.ts';
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
}

export const EVENT_RULES_DEFAULT: EventRules = {
  hitProbability: 0.4,
  maxPerClub: 1,
  maxOccurrences: 2,
  softConditionFactor: 0.25,
  choiceDeadlineHours: 72,
};

export interface EventClamps {
  money: number;
  fansPct: number;
  maintenance: number;
  brandHeat: number;
  buildCredit: number;
  influence: number;
  bookingCancel: number;
}

export const EVENT_CLAMPS_DEFAULT: EventClamps = {
  money: 8,
  fansPct: 0.05,
  maintenance: 5,
  brandHeat: 0.3,
  buildCredit: 5,
  influence: 10,
  bookingCancel: 2,
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
  };
}

/** 天气键集合（config attendance_model.weather_probabilities）：weather_set 只认表里有的天气。 */
async function loadWeatherKeys(db: Env['DB']): Promise<Set<string>> {
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
      .prepare(`SELECT club_id, brand FROM naming_contracts WHERE status = 'active' AND club_id IN (${inList})`)
      .bind(...ids)
      .all<{ club_id: number; brand: string }>(),
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
 *  权重×softConditionFactor 衰减参与；已达 maxOccurrences 的事件剔除。无候选返 null。 */
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

// ---- 效果落账（11 键） ----

export interface EffectRunContext {
  clamps: EventClamps;
  heatRules: HeatRules;
  weatherKeys: Set<string>;
  /** 活动目录（config 不可用时为 null ⇒ 档期类效果落空而不是整批失败） */
  catalog: ActivityCatalog | null;
  openWindow: OpenWindow | null;
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
      // 品牌满意度：v6.12.0 落 naming_contracts（本批只播报）
      case 'satisfaction': {
        const v = numOf(value) ?? 0;
        applied.satisfaction = v;
        notes.push(`品牌满意度 ${signedNum(v)}（v6.12.0 落库，本次只播报）`);
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
      // 经营信号：v6.12.0 落 club_signals（本批只播报）
      case 'signals': {
        applied.signals = value;
        notes.push(`经营信号 ${JSON.stringify(value)}（v6.12.0 接入消费点，本次只播报）`);
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
      // 上门报价：v6.12.0 生成限时折扣冠名报价（本批只播报）
      case 'offer_spawn': {
        applied.offer_spawn = value;
        notes.push(`上门报价 ${JSON.stringify(value)}（v6.12.0 生成限时冠名报价，本次只播报）`);
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
  const [rules, clamps, pool, heatRules, catalog, openWindow, weatherKeys] = await Promise.all([
    loadEventRules(env.DB),
    loadEventClamps(env.DB),
    loadEventPool(env.DB),
    loadHeatRules(env.DB),
    // 目录配置坏了不该让整批触发失败：档期类效果落空即可
    loadActivityCatalog(env.DB).catch(() => null),
    getOpenWindow(env.DB),
    loadWeatherKeys(env.DB),
  ]);

  let named: EventRow | null = null;
  if (input.eventId !== undefined) {
    named = pool.find((r) => r.event_id === input.eventId) ?? null;
    if (named === null) throw new HttpError(404, `没有「${input.eventId}」这个事件`);
    if (named.status !== 'adopted') throw new HttpError(400, `事件「${named.name}」已停用，先启用再触发`);
    if (named.event_type !== 'instant') throw new HttpError(400, `「${named.name}」是选择型事件，要等 v6.11.0（D2）开放`);
  }

  const clubIds =
    input.clubIds ??
    (await env.DB.prepare('SELECT id FROM clubs ORDER BY id').all<{ id: number }>()).results.map((r) => r.id);
  if (clubIds.length === 0) return { clubs: 0, triggered: 0, capped: 0, events: [] };

  const contexts = await loadEventContexts(env, clubIds, input.season, input.windowSeq);
  // v6.11.0 放开选择型：现在只从即发型里抽
  const instantPool = pool.filter((r) => r.event_type === 'instant');
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
        event = named;
      } else {
        if (rng() >= rules.hitProbability) break;
        event = pickEvent(instantPool, ctx, rules, rng, used);
        if (event === null) {
          capped++;
          break;
        }
      }
      const text = renderEventText(event, ctx);
      const effects = parseJson<Record<string, unknown>>(event.effects_json, {});
      // 先落 occurrence 拿 id（效果语句的幂等闸挂在它身上），再同一批落效果 + 置 resolved + 审计
      const inserted = await env.DB
        .prepare(
          `INSERT INTO event_occurrences
             (club_id, season, window_seq, event_id, event_name, event_type, status, effects_json, notes_json,
              choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
           VALUES (?, ?, ?, ?, ?, 'instant', 'pending', '{}', '[]', NULL, '{}', NULL, '', NULL, ?, ${nowSql()})`,
        )
        .bind(clubId, input.season, input.windowSeq, event.event_id, event.name, text)
        .run();
      const occurrenceId = Number(inserted.meta.last_row_id ?? 0);
      const run = await applyEventEffects(
        env,
        ctx,
        { id: occurrenceId, season: input.season, windowSeq: input.windowSeq, name: event.name },
        effects,
        { clamps, heatRules, weatherKeys, catalog, openWindow },
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
