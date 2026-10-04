// 主场收入域（v1.5.0，TECH_DESIGN §8 全按 revenue 插件移植 + 主规则 v5.2 §4.1.2/4.1.3/5.1）。
// 数据流（用户裁决 2026-09-16）：赛果确认时当场掷天气→算上座→三分收入即时入账（钩子④，match_attendance
// 主键+ledger 幂等双闸），v6.28.0 起死忠同批每场演化（上座→收入→死忠原子落账，比赛日体感）；
// 维护费与「本窗无主场场次」的死忠兜底演化在窗末并入关窗批。设施扩建/升级已随v2.5.0 落地
// （见 src/worker/stadium-ops.ts：五类子设施 0-5 级 + 球场扩建/升级）。
// 影响力 =（球员影响力总和（规则 4.1.3：系数×能力等级×国际声望，可成长 0.25/非成长 0.13，即时计算不落库）
//        + 队壳影响力）× 级别系数 + 奖励分（v6.28.0 A 段用户拍板图口径；级别 premier 1.2 / second 1.0、
//        未定级回 1.0，级别真源是 deriveClubTier 的报名派生，管理组维护 stadiums 两列）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { clubIdByTourTeam, tourTeamIdsByClub } from './prizes.ts';
import { deriveClubLeagues, deriveClubTier, tierCache, type Tier } from './tier.ts';
import {
  evolveSatisfactionForClub,
  loadSatisfyConfig,
  loadTierProfiles,
  recalibrateTierStatements,
  windowNamingStatements,
  windowBrandHeatStatement,
  type BrandTier,
  type NamingContractRow,
} from './naming-ops.ts';
import { loadActivityCatalog, windowActivityStatements } from './venue-ops.ts';
import { activateQueuedStatements, buildRoundStatements } from './market-ops.ts';
import {
  collectWindowSignals,
  loadEventSignals,
  queueWindowSignalNotes,
} from './event-ops.ts';

export interface AttendanceModel {
  weather_probabilities: Record<string, number>;
  weather_ranges: Record<string, [number, number]>;
  form_coef_table: Record<string, number>;
  attendance_multiplier_base: number;
  attendance_multiplier_per_tier: number;
  ticket_revenue_per_10k: number;
  commercial_per_10k_per_level: number;
  broadcast_per_match_per_level: number;
  sell_out_fill: [number, number];
  perturbation: [number, number];
  neutral_form_pts: number;
  default_influence: number;
  fans_target_table: { bands: { max_influence: number; slope: number }[] };
  fans_cap: number;
  fans_grow_rate: number;
  fans_grow_heat_base: number;
  fans_grow_heat_span: number;
  fans_drop_rate: number;
  fans_drop_heat_extra: number;
  influence_coef_growable: number;
  influence_coef_static: number;
}

export interface TierEntry {
  name: string;
  min_seats: number;
  max_seats: number;
  base_maintenance: number;
  per_10k_rate: number;
  attend_coef: number;
  upgrade_cost: number;
}

export interface StadiumRow {
  club_id: number;
  name: string | null;
  capacity: number;
  tier: number;
  shell_influence: number;
  bonus_points: number;
  fans: number;
  /** v6.28.0：本窗开始时的 fans 快照（关窗批写为窗末值，供下一窗 fansGrowth 基准）；老数据 0 = 无快照 */
  fans_window_start: number;
}

export async function loadAttendanceModel(db: Env['DB']): Promise<AttendanceModel> {
  const config = createConfigService(db);
  const raw = await config.get('attendance_model');
  if (!raw) throw new HttpError(409, '主场系数表（attendance_model）未配置');
  try {
    return JSON.parse(raw) as AttendanceModel;
  } catch {
    throw new HttpError(409, '主场系数表（attendance_model）不是合法 JSON');
  }
}

export async function loadTierTable(db: Env['DB']): Promise<Record<string, TierEntry>> {
  const config = createConfigService(db);
  const raw = await config.get('tier_table');
  if (!raw) throw new HttpError(409, '球场档位表（tier_table）未配置');
  try {
    return JSON.parse(raw) as Record<string, TierEntry>;
  } catch {
    throw new HttpError(409, '球场档位表（tier_table）不是合法 JSON');
  }
}

/** 能力等级（规则 4.1.2 十档表）：CA/PA 值 → 1-10 */
export function abilityTier(v: number | null): number {
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

/** 能力等级：可成长=(CA档+PA档)/2、非成长=CA档（规则 4.1.2） */
export function playerAbilityLevel(ca: number | null, pa: number | null, growable: number): number {
  if (growable && ca !== null && pa !== null) return (abilityTier(ca) + abilityTier(pa)) / 2;
  return abilityTier(ca);
}

/** 球员影响力总和（规则 4.1.3：系数×能力等级×国际声望；口径=在册现行合同，假设 32） */
export async function playerInfluenceSum(env: Env, clubId: number, model: AttendanceModel): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT p.prestige, p.ca, p.pa, p.growable FROM players p
     JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
     WHERE ct.club_id = ?`,
  )
    .bind(clubId)
    .all<{ prestige: number | null; ca: number | null; pa: number | null; growable: number | null }>();
  let sum = 0;
  for (const p of results) {
    const coef = p.growable ? model.influence_coef_growable : model.influence_coef_static;
    sum += coef * playerAbilityLevel(p.ca, p.pa, p.growable ?? 0) * (p.prestige ?? 0);
  }
  return sum;
}

/** 球队影响力 =（队壳 + Σ球员）× 级别系数 + 奖励分（v6.28.0 A 段用户拍板图口径）。
 *  tierCoef 必填不留默认值：漏传会静默按旧加法口径算，宁可在编译期报错。 */
export function teamInfluence(
  stadium: { shell_influence: number; bonus_points: number },
  playerSum: number,
  tierCoef: number,
): number {
  return (stadium.shell_influence + playerSum) * tierCoef + stadium.bonus_points;
}

/** 级别系数取值：未登记级别（tier=null / 缺键 / 非有限数）一律回 1.0（用户口径）。 */
export function influenceTierCoef(coefs: { premier?: number; second?: number } | null, tier: Tier | null): number {
  const v = tier === null ? undefined : coefs?.[tier];
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

// 与 CONFIG_DEFAULTS.influence_tier_coefs 同值（config 缺键/坏值时兜底，运行期不留第二份口径表）
const INFLUENCE_TIER_COEF_DEFAULTS: Record<Tier, number> = { premier: 1.2, second: 1.0 };

/** 级别系数表（config influence_tier_coefs）：逐档兜底，坏值不炸上座钩子/关窗批。 */
export async function loadInfluenceTierCoefs(db: Env['DB']): Promise<Record<Tier, number>> {
  const raw = await createConfigService(db).getJson<Partial<Record<Tier, number>>>('influence_tier_coefs');
  const pick = (tier: Tier): number => {
    const v = raw?.[tier];
    return typeof v === 'number' && Number.isFinite(v) ? v : INFLUENCE_TIER_COEF_DEFAULTS[tier];
  };
  return { premier: pick('premier'), second: pick('second') };
}

/** 天气掷出（概率表 40/30/20/10 用户裁决） */
export function rollWeather(rng: () => number, probabilities: Record<string, number>): string {
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

/** 区间均匀抽（v6.15.0 导出：预报侧抽天气系数与消费端同源） */
export function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** [lo, hi] 二元数值区间校验（v6.15.0 导出：weather-ops 预报抽系数与消费端共用，防两处漂移） */
export function asRange(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;
}

/** 近 3 场战绩 Pts（胜3平1负0；弃权按 winner 记胜负；**点球决胜按平局计**——用户裁决 2026-09-16；
 * 不足 3 场中性 4 分，假设 31） */
export function formPtsOf(
  rows: {
    home_team_id: number | null;
    away_team_id: number | null;
    score_home: number | null;
    score_away: number | null;
    pen_home: number | null;
    pen_away: number | null;
    walkover_side: string | null;
  }[],
  clubId: number,
): number {
  let pts = 0;
  let seen = 0;
  for (const r of rows) {
    if (seen >= 3) break;
    if (r.home_team_id === null || r.away_team_id === null) continue;
    let won: boolean | null = null;
    let drew = false;
    if (r.walkover_side === 'home') won = r.home_team_id === clubId;
    else if (r.walkover_side === 'away') won = r.away_team_id === clubId;
    else if (r.score_home !== null && r.score_away !== null) {
      // 点球决胜按平局计（战绩口径）：90 分钟平分就是平，点球胜负只影响淘汰赛晋级/奖金
      if (r.score_home === r.score_away) drew = true;
      else won = (r.score_home > r.score_away ? r.home_team_id : r.away_team_id) === clubId;
    }
    if (won === null && !drew) continue; // 无有效结果不计名额
    pts += drew ? 1 : won ? 3 : 0;
    seen++;
  }
  if (seen < 3) return 4; // 中性分（revenue NEUTRAL_FORM_PTS）
  return pts;
}

// 参数是**比赛系统队 id**：result_confirmations.home_team_id / away_team_id 存的就是它（迁移 0017）。
// v6.6.3 订正：原先绑 club id，靠生产 20/20「club_id = tour_team_id」的数值巧合才命中（米兰 legacy 47
// vs 131681 期间恒返中性 4）；现在调用方自行映射，本函数只认 tour 队 id。
export async function clubFormPts(env: Env, tourTeamId: number, excludeMatchId: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side
     FROM result_confirmations WHERE (home_team_id = ? OR away_team_id = ?) AND match_id != ?
     ORDER BY id DESC LIMIT 9`,
  )
    .bind(tourTeamId, tourTeamId, excludeMatchId)
    .all();
  return formPtsOf(results as Parameters<typeof formPtsOf>[0], tourTeamId);
}

/** 死忠目标：影响力-死忠阶梯分段线性逐带累计（斜率递减，max_influence 0 = 开放段恒排末尾） */
export function diehardTarget(model: AttendanceModel, influence: number): number {
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

/** 死忠演化（非对称靠拢；青训每级 +3% 涨粉；战绩 Pts≥7 ×1.05/≤1 ×0.95；钳 [0, 上限]）。
 *  fansBuff = 生效冠名品牌的档位死忠增长加成（v6.13.0 C2，口碑 +0.5%）——只乘涨粉系数、掉粉不受影响。
 *  v6.28.0 B 段：opts.growRate/dropRate 覆盖两侧系数（每场演化传 per-match 键；缺省沿用窗系数，公式内核不变）。 */
export function evolveFans(
  model: AttendanceModel,
  fans: number,
  target: number,
  attendRate: number,
  formPts: number,
  youthLevel = 0,
  fansBuff = 0,
  opts: { growRate?: number; dropRate?: number } = {},
): number {
  const growRate = opts.growRate ?? model.fans_grow_rate;
  const dropRate = opts.dropRate ?? model.fans_drop_rate;
  const diff = target - fans;
  let next: number;
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

export interface AttendanceHookInput {
  matchId: number;
  season: number;
  windowSeq: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
}

export interface AttendanceDetail {
  clubId: number;
  weather: string;
  attendance: number;
  ticket: number;
  commercial: number;
  broadcast: number;
}

/**
 * 赛果确认钩子④（v1.5.0）：主场三分收入即时入账。
 * 跳过条件（detail=null）：AUTH_DB 目录无主场映射 / 无球场行 / 已入过账。
 * 上座快照 INSERT match_attendance（match_id 主键）+ ledgerMovement(kind='revenue', ref='match') 同批双闸。
 * v6.10.0：随机事件的预置上座乘数（next_attendance_mod）与预置天气（next_weather）在这里消费，同批清零。
 */
export async function matchAttendanceStatements(
  env: Env,
  input: AttendanceHookInput,
): Promise<{ statements: ReturnType<Env['DB']['prepare']>[]; detail: AttendanceDetail | null }> {
  if (input.homeTeamId === null || input.awayTeamId === null) return { statements: [], detail: null };
  const model = await loadAttendanceModel(env.DB);
  const rng = env.rng ?? Math.random;
  const clubMap = await clubIdByTourTeam(env, [input.homeTeamId]);
  const clubId = clubMap.get(input.homeTeamId);
  if (clubId === undefined) return { statements: [], detail: null };
  const existing = await env.DB.prepare('SELECT 1 AS x FROM match_attendance WHERE match_id = ?').bind(input.matchId).first();
  if (existing) return { statements: [], detail: null };
  const stadium = await env.DB
    .prepare(
      'SELECT club_id, capacity, tier, shell_influence, bonus_points, fans, fans_window_start, next_attendance_mod, next_weather FROM stadiums WHERE club_id = ?',
    )
    .bind(clubId)
    .first<StadiumRow & { next_attendance_mod: number; next_weather: string }>();
  if (!stadium) return { statements: [], detail: null };

  // v6.10.0 随机事件预置（一次性消费）：weather_set 写了 next_weather 就用预置天气。
  // v6.15.0 场次预报：管理员按轮提前抽定的类型+系数（match_weather），优先级事件 > 预报 > 现掷；
  // 预报命中时天气相关的随机整笔不抽（weather/wx 不再滚，rng 仍剩 perturbation+fill 两口），
  // wx 直用落库值（表外天气也直用，人工改库不防御）。
  // 预报行校验 club_id——改期/换边后别把别队的预报用上；预报行消费后保留（公开面回看用）。
  const presetWeather =
    stadium.next_weather !== '' && model.weather_probabilities[stadium.next_weather] !== undefined ? stadium.next_weather : null;
  // 事件预置命中时预报行完全不被使用（wx 现抽、memo 走「事件预置」），点查直接跳过
  const forecastRow =
    presetWeather !== null
      ? null
      : await env.DB.prepare('SELECT weather, wx_coef FROM match_weather WHERE match_id = ? AND club_id = ?')
          .bind(input.matchId, clubId)
          .first<{ weather: string; wx_coef: number }>();
  const weather = presetWeather ?? forecastRow?.weather ?? rollWeather(rng, model.weather_probabilities);
  const wxRange = asRange(model.weather_ranges[weather]);
  const wx = forecastRow ? forecastRow.wx_coef : wxRange ? uniform(rng, wxRange[0], wxRange[1]) : 1;

  // 近 3 场战绩（平台已确认赛果，不含本场，假设 31）；赛果表存 tour 队 id，直接用主队 tour id 查
  const formPts = await clubFormPts(env, input.homeTeamId, input.matchId);
  const form = model.form_coef_table[String(Math.min(Math.max(formPts, 0), 9))] ?? 1;

  const tierTable = await loadTierTable(env.DB);
  const tierEntry = tierTable[String(stadium.tier)];
  const tierCoef = tierEntry?.attend_coef ?? 1;
  const multiplier = model.attendance_multiplier_base * (1 + model.attendance_multiplier_per_tier * stadium.tier);

  // v6.28.0 A 段：级别系数一次取；级别按 deriveClubTier 报名派生（tierCache 同请求内复用，主客队各一次）
  const influenceCoefs = await loadInfluenceTierCoefs(env.DB);
  const tierMem = tierCache();

  // 客队影响力：目录映射到俱乐部→其球队影响力；缺球场行→默认值（revenue default_influence）
  let awayInfluence = model.default_influence;
  const awayClubId = (await clubIdByTourTeam(env, [input.awayTeamId])).get(input.awayTeamId);
  if (awayClubId !== undefined) {
    const awayStadium = await env.DB.prepare('SELECT shell_influence, bonus_points FROM stadiums WHERE club_id = ?').bind(awayClubId).first<{ shell_influence: number; bonus_points: number }>();
    if (awayStadium) {
      const awayTier = await deriveClubTier(env, input.season, awayClubId, tierMem);
      awayInfluence = teamInfluence(awayStadium, await playerInfluenceSum(env, awayClubId, model), influenceTierCoef(influenceCoefs, awayTier));
    }
  }
  // 对手系数（revenue 口径）：主队影响力 ≤0 时取 1.0（不放大需求）
  const homeTier = await deriveClubTier(env, input.season, clubId, tierMem);
  const homeInfluence = teamInfluence(stadium, await playerInfluenceSum(env, clubId, model), influenceTierCoef(influenceCoefs, homeTier));
  const opp = homeInfluence <= 0 ? 1 : 1 + 0.05 * (awayInfluence / homeInfluence);

  const demand =
    stadium.fans *
    multiplier *
    tierCoef *
    form *
    wx *
    opp *
    stadium.next_attendance_mod * // v6.10.0 随机事件：下一场上座乘数（默认 1，用完即清）
    uniform(rng, model.perturbation[0], model.perturbation[1]);
  const fill = uniform(rng, model.sell_out_fill[0], model.sell_out_fill[1]);
  const attendance = demand >= stadium.capacity ? Math.floor(stadium.capacity * fill) : Math.floor(Math.max(0, demand));

  const facilities = await env.DB.prepare('SELECT facility_key, level FROM club_facilities WHERE club_id = ?').bind(clubId).all<{ facility_key: string; level: number }>();
  const levelOf = (key: string) => facilities.results.find((f) => f.facility_key === key)?.level ?? 0;
  const wan = attendance / 10000;
  const ticket = Math.round(wan * model.ticket_revenue_per_10k * 100) / 100;
  const commercial = Math.round(wan * model.commercial_per_10k_per_level * levelOf('commercial') * 100) / 100;
  const broadcast = Math.round(model.broadcast_per_match_per_level * levelOf('broadcast') * 100) / 100;
  const total = Math.round((ticket + commercial + broadcast) * 100) / 100;

  // v6.28.0 B 段：每场死忠演化（比赛日体感）——与上座/收入同批原子落账；幂等闸是 match_attendance 主键（上面已查过）。
  // 系数走 per-match 键（初值 0.2 = 窗系数 0.5 × 0.4）；fan_mood 是窗级事件信号，这里不消费（关窗批按窗生效一次）。
  const cfg = createConfigService(env.DB);
  const perMatchGrow = (await cfg.getNumber('fans_grow_rate_per_match')) ?? model.fans_grow_rate * 0.4;
  const perMatchDrop = (await cfg.getNumber('fans_drop_rate_per_match')) ?? model.fans_drop_rate * 0.4;
  // fansBuff = 生效冠名品牌档位性格（与关窗批同口径）：active 合同 → brand_pool.tier → config 三档参数；无合同 0
  const activeNaming = await env.DB
    .prepare(`SELECT brand FROM naming_contracts WHERE club_id = ? AND status = 'active' LIMIT 1`)
    .bind(clubId)
    .first<{ brand: string }>();
  let fansBuff = 0;
  if (activeNaming) {
    const brandRow = await env.DB.prepare('SELECT tier FROM brand_pool WHERE brand = ?').bind(activeNaming.brand).first<{ tier: string }>();
    fansBuff = (await loadTierProfiles(env.DB))[(brandRow?.tier ?? '口碑') as BrandTier].fansBuff;
  }
  const perMatchAttendRate = stadium.capacity > 0 ? attendance / stadium.capacity : 1;
  const nextFans = evolveFans(
    model,
    stadium.fans,
    // 死忠目标与上座 demand 的影响力同源：都用本钩子算出的 homeInfluence（含级别系数）
    diehardTarget(model, homeInfluence),
    perMatchAttendRate,
    formPts,
    levelOf('youth'),
    fansBuff,
    { growRate: perMatchGrow, dropRate: perMatchDrop },
  );

  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  statements.push(
    ...ledgerMovement(env.DB, {
      clubId,
      delta: total,
      kind: 'revenue',
      refType: 'match',
      refId: input.matchId,
      memo: `比赛日收入（比赛 #${input.matchId}，上座 ${attendance}/${stadium.capacity}，${weather}${presetWeather ? '（事件预置）' : forecastRow ? '（赛前预报）' : ''}；票 ${ticket}/商 ${commercial}/播 ${broadcast}）`,
    }),
  );
  statements.push(
    env.DB
      .prepare(
        `INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .bind(input.matchId, clubId, input.season, input.windowSeq, weather, attendance, ticket, commercial, broadcast),
  );
  // 事件预置是一次性的：本场消费掉即清零（同批原子；没预置时这两条也是写回默认值）
  statements.push(
    env.DB
      .prepare(
        `UPDATE stadiums SET next_attendance_mod = 1, next_weather = '', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE club_id = ?`,
      )
      .bind(clubId),
  );
  // 死忠每场演化落账（v6.28.0 B 段，与上座/收入同批；跳过条件同函数既有口径）
  statements.push(
    env.DB
      .prepare(`UPDATE stadiums SET fans = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE club_id = ?`)
      .bind(nextFans, clubId),
  );
  return { statements, detail: { clubId, weather, attendance, ticket, commercial, broadcast } };
}

export interface HomeWindowSummary {
  maintenanceClubs: number;
  maintenanceTotal: number;
  fansClubs: number;
  namingClubs: number;
  namingTotal: number;
  activityClubs: number;
  activityTotal: number;
  moodClubs: number;
  terminatedClubs: number;
  /** v6.14.0 C3 招商轮：本轮定向递出的报价数 / 接班转正的队数（临时窗恒 0） */
  marketOffers: number;
  activatedClubs: number;
}

/** 批后补排的俱乐部通知（关窗批提交成功后由调用方逐条 queueClubNotification）。 */
export interface PendingClubNotification {
  clubId: number;
  template: string;
  data: Record<string, unknown>;
}

/**
 * 窗末主场结算（v1.5.0，并入关窗批）：维护费 + 死忠兜底演化 + 冠名收租 + 档期活动。
 * 维护费 = 档位基础 + 每万座费率 × 容量万 × 本窗主场场次（已确认口径，假设 33）；临时窗照收。
 * 死忠（v6.28.0 B 段）：本窗有主场场次的队已在钩子④按 per-match 系数演化过，这里**不再演化**（防双记账，
 * 只推进 fans_window_start 快照）；无主场场次的队按窗系数兜底一次（上座率中性 1.0；青训等级涨粉系数
 * ×(1+0.03n)，v6.6.3 接入；品牌档位 fansBuff 只乘涨粉侧，v6.13.0 C2）；fan_mood 事件信号对所有队
 * 按窗生效一次（演化之后，v6.12.0 D3）——每种窗都跑。
 * 影响力走 v6.28.0 A 段口径（队壳+球员）× 级别系数 + 奖励分，级别由 deriveClubLeagues 批量派生。
 * 冠名收租仅常规窗（临时窗 chargeNaming=false：不收租、不减剩余窗数，v3.0.0 裁决）；
 * 品牌热度动态随收租批走（近 3 场全胜/全败调 brand_pool.heat，v6.8.0）；
 * 档位自动校准批首跑一次（v6.13.0 C2，热度降序 + 头部准入下限，锁档跳过）；
 * 品牌方情绪两信号演化 + 跌破地板主动解约随收租批走（v6.13.0 C2，剩 1 窗的合同本窗到期不再演化）。
 * 档期活动（v6.9.0）：本窗已订档位按确定性伪随机结算收入与草皮损坏；临时窗**照算**（预订时窗是开的，
 * 活动本身与转会议题无关），但只算当窗已订的槽位。
 * 幂等：ledger 走 'maintenance'/'naming_fee'/'activity'/'booking' 闸；fans UPDATE 幂等由关窗状态原子闸保证（整批回滚）。
 * notifications 返回批后通知（情绪变化 / 品牌解约），调用方在批提交成功后排队——批回滚不发假通知。
 */
export async function windowHomeStatements(
  env: Env,
  season: number,
  windowSeq: number,
  opts: { chargeNaming: boolean; actor?: number | null },
): Promise<{ statements: ReturnType<Env['DB']['prepare']>[]; summary: HomeWindowSummary; notifications: PendingClubNotification[] }> {
  const model = await loadAttendanceModel(env.DB);
  const tierTable = await loadTierTable(env.DB);
  const activityCatalog = await loadActivityCatalog(env.DB);
  // v6.28.0 A 段：级别系数一次取（批次内共用，别进循环）
  const influenceCoefs = await loadInfluenceTierCoefs(env.DB);
  // v6.12.0 D3 经营信号：本窗触发事件沉淀的 fan_mood / upkeep / fee_mod，按队消费
  const signalDefs = await loadEventSignals(env.DB);
  const signalsByClub = await collectWindowSignals(env.DB, season, windowSeq, signalDefs);

  // v6.13.0 C2：生效冠名一次批量取（含 satisfaction）+ 品牌实时档位映射——省逐队点查，也给 buff/演化供料
  const namingRows = opts.chargeNaming
    ? (await env.DB.prepare(`SELECT * FROM naming_contracts WHERE status = 'active'`).all<NamingContractRow>()).results
    : [];
  const namingByClub = new Map(namingRows.map((r) => [r.club_id, r]));
  const brandTier = new Map(
    opts.chargeNaming
      ? (
          await env.DB.prepare(`SELECT brand, tier FROM brand_pool WHERE status = 'adopted'`).all<{ brand: string; tier: string }>()
        ).results.map((r) => [r.brand, r.tier as BrandTier])
      : [],
  );
  const profiles = opts.chargeNaming ? await loadTierProfiles(env.DB) : null;
  const satisfyCfg = opts.chargeNaming ? await loadSatisfyConfig(env.DB) : null;

  const stadiums = await env.DB.prepare('SELECT club_id, capacity, tier, shell_influence, bonus_points, fans, fans_window_start FROM stadiums').all<StadiumRow>();
  // 设施等级一次批量查（青训级 → evolveFans 涨粉系数 ×(1+0.03n)，v6.6.3；草皮级 → 档期活动的收入加成与损坏减免，v6.9.0）
  const facilityRows = await env.DB
    .prepare(`SELECT club_id, facility_key, level FROM club_facilities WHERE facility_key IN ('youth', 'pitch')`)
    .all<{ club_id: number; facility_key: string; level: number }>();
  const youthLevels = new Map(facilityRows.results.filter((r) => r.facility_key === 'youth').map((r) => [r.club_id, r.level]));
  const pitchLevels = new Map(facilityRows.results.filter((r) => r.facility_key === 'pitch').map((r) => [r.club_id, r.level]));
  const tourMap = await tourTeamIdsByClub(env, stadiums.results.map((s) => s.club_id));
  // v6.28.0 A 段：级别批量派生（预载 tour 映射 → 一次 AUTH_DB + 一次 TOUR_DB，别逐队派生 20 次）
  const leagues = await deriveClubLeagues(env, season, stadiums.results.map((s) => s.club_id), tourMap);
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  const notifications: PendingClubNotification[] = [];
  const moodReports: import('./naming-ops.ts').SatisfactionReport[] = [];
  const terminatedReports: import('./naming-ops.ts').SatisfactionReport[] = [];
  const summary: HomeWindowSummary = {
    maintenanceClubs: 0,
    maintenanceTotal: 0,
    fansClubs: 0,
    namingClubs: 0,
    namingTotal: 0,
    activityClubs: 0,
    activityTotal: 0,
    moodClubs: 0,
    terminatedClubs: 0,
    marketOffers: 0,
    activatedClubs: 0,
  };

  // v6.14.0 C3 招商轮·清盘段（常规窗）：未签 pending 作废 + 整轮无人签品牌热度 −ignored +
  // 旧轮置 settled——在档位校准之前（插件 run_window 的 close → recalibrate → open 同序）
  const round = opts.chargeNaming ? await buildRoundStatements(env, season, windowSeq) : null;
  if (round) statements.push(...round.settleStatements);

  // 档位自动校准（v6.13.0 C2）：常规窗批首跑一次（按校准时刻的热度排名；本批热度演化结果下窗生效）
  if (opts.chargeNaming) {
    const recal = await recalibrateTierStatements(env.DB);
    statements.push(...recal.statements);
  }

  for (const s of stadiums.results) {
    const tierEntry = tierTable[String(s.tier)];
    if (!tierEntry) {
      // 档位表缺该档位（配置异常）：本批照旧不演化/不收租，但窗初快照要推进到窗末现值，
      // 否则下一窗 fansGrowth 会从更早的窗初起算（现值已含每场演化）
      statements.push(
        env.DB
          .prepare(`UPDATE stadiums SET fans_window_start = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE club_id = ?`)
          .bind(s.fans, s.club_id),
      );
      continue;
    }
    const homeMatches = await env.DB.prepare(
      `SELECT COALESCE(SUM(attendance), 0) AS total, COUNT(*) AS n FROM match_attendance WHERE club_id = ? AND season = ? AND window_seq = ?`,
    )
      .bind(s.club_id, season, windowSeq)
      .first<{ total: number; n: number }>();
    const played = homeMatches?.n ?? 0;
    const attendTotal = homeMatches?.total ?? 0;
    const attendRate = played > 0 && s.capacity > 0 ? attendTotal / (s.capacity * played) : 1;

    // upkeep 信号乘数（v6.12.0 D3，插件 window_service 同序：先算基础维护费再乘、积已终钳）
    const sig = signalsByClub.get(s.club_id);
    const upkeepF = sig?.mults.upkeep ?? 1;
    const maintenanceBase = Math.round((tierEntry.base_maintenance + tierEntry.per_10k_rate * (s.capacity / 10000) * played) * 100) / 100;
    const maintenance = upkeepF !== 1 ? Math.round(maintenanceBase * upkeepF * 1000) / 1000 : maintenanceBase;
    if (maintenance > 0) {
      summary.maintenanceClubs++;
      summary.maintenanceTotal = Math.round((summary.maintenanceTotal + maintenance) * 100) / 100;
      statements.push(
        ...ledgerMovement(env.DB, {
          clubId: s.club_id,
          delta: -maintenance,
          kind: 'maintenance',
          refType: 'window',
          refId: season * 100 + windowSeq,
          memo: `球场维护（S${season} 第 ${windowSeq} 窗，${played} 场主场${upkeepF !== 1 ? `，经营信号：维护负担 ×${upkeepF}` : ''}）`,
        }),
      );
    }

    const naming = namingByClub.get(s.club_id) ?? null;
    const profile = naming && profiles ? profiles[(brandTier.get(naming.brand) ?? '口碑') as BrandTier] : null;

    const influence = teamInfluence(s, await playerInfluenceSum(env, s.club_id, model), influenceTierCoef(influenceCoefs, leagues.get(s.club_id)?.tier ?? null));
    const target = diehardTarget(model, influence);
    // 战绩按 tour 队 id 查赛果表；目录无映射 → 中性 4（与「赛果不足 3 场」同口径）
    const tourTeamId = tourMap.get(s.club_id);
    const formPts = tourTeamId === undefined ? 4 : await clubFormPts(env, tourTeamId, 0);
    // v6.28.0 B 段：本窗有主场场次的队已在钩子④按 per-match 系数演化过 → 关窗不再演化（防双记账），
    // 现值 s.fans 即窗末值；无主场场次的队按窗系数（evolveFans 缺省）兜底演化一次。
    const evolved = played > 0 ? s.fans : evolveFans(model, s.fans, target, attendRate, formPts, youthLevels.get(s.club_id) ?? 0, profile?.fansBuff ?? 0);
    // fan_mood 信号（v6.12.0 D3，插件 fans_service.evolve 同口径）：演化结果 ×(1+Σ/100) 后钳 [0, 上限]。
    // 窗级事件信号对所有队按窗生效一次——放在演化之后，不随每场演化重复。
    const mood = sig?.steps.fan_mood ?? 0;
    const nextFansWithMood = mood !== 0 ? Math.min(Math.max(evolved * (1 + mood / 100), 0), model.fans_cap) : evolved;
    // 差值闸只管计数（既有口径：fansClubs = 本批真改动的队数）；UPDATE 每队都发——
    // fans_window_start 快照要跟着窗末推进，否则下一窗的 fansGrowth 基准会越算越偏。
    if (Math.abs(nextFansWithMood - s.fans) >= 0.5) summary.fansClubs++;
    statements.push(
      env.DB
        .prepare(`UPDATE stadiums SET fans = ?, fans_window_start = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE club_id = ?`)
        .bind(nextFansWithMood, nextFansWithMood, s.club_id),
    );

    // 窗末冠名收租（v2.6.0）：费用 + 剩余窗口递减/到期 + 对赌奖金，幂等靠账本闸（club 维度）；
    // 临时窗不收租也不递减（v3.0.0 裁决）
    if (opts.chargeNaming && naming) {
      // 对赌奖金增长率按「窗初快照 → 窗末」算（v6.28.0）：每场演化已即时改 fans，拿现值当基准会把增长率算成 0
      const fansStart = s.fans_window_start > 0 ? s.fans_window_start : s.fans;
      const fansGrowth = fansStart > 0 ? (nextFansWithMood - fansStart) / fansStart : 0;
      statements.push(
        ...windowNamingStatements(env, naming, season, windowSeq, attendRate, fansGrowth, { feeFactor: sig?.mults.fee_mod ?? 1 }),
      );
      summary.namingClubs++;
      summary.namingTotal = Math.round((summary.namingTotal + naming.fee_per_window) * 100) / 100;
      // 品牌热度动态（v6.8.0）：本队近 3 场全胜/全败调 brand_pool.heat（目录无映射的队跳过）
      if (tourTeamId !== undefined) {
        const heatStmt = await windowBrandHeatStatement(env, naming, tourTeamId);
        if (heatStmt) statements.push(heatStmt);
      }
      // 品牌方情绪两信号演化（v6.13.0 C2）：收租语句在前（本窗到期的合同先 expire，演化按 status='active'
      // 守卫自然跳过）；本窗之后仍存活的合同才演化（剩 1 窗本窗到期，情绪步进无意义）。
      if (profile && satisfyCfg && naming.windows_remaining > 1) {
        // 上座信号按「有无主场场次」定（无场次中性 0，不借中性上座率 1.0 白拿达标）
        const sAttend = played > 0 ? (attendRate >= profile.goodAttend ? 1 : attendRate <= profile.badAttend ? -1 : 0) : 0;
        const evolution = await evolveSatisfactionForClub(env, naming, tourTeamId, season, windowSeq, sAttend, profile, satisfyCfg);
        statements.push(...evolution.statements);
        const rep = evolution.report;
        if (rep.to !== rep.from) {
          summary.moodClubs++;
          moodReports.push(rep);
        }
        if (rep.terminated) {
          summary.terminatedClubs++;
          terminatedReports.push(rep);
        }
      }
    }

    // 档期活动结算（v6.9.0）：本窗已订档位的收入与草皮损坏（确定性伪随机；无订单则零开销）；
    // attendBuff = 生效冠名品牌档位的活动收入加成（v6.13.0 C2，头部 +2%）
    const activity = await windowActivityStatements(env, s.club_id, season, windowSeq, activityCatalog, {
      pitch: pitchLevels.get(s.club_id) ?? 0,
      youth: youthLevels.get(s.club_id) ?? 0,
      attendBuff: profile?.attendBuff ?? 0,
    });
    if (activity.statements.length > 0) {
      statements.push(...activity.statements);
      summary.activityClubs++;
      summary.activityTotal = Math.round((summary.activityTotal + activity.income - activity.extraMaintenance) * 100) / 100;
    }
  }
  // 经营信号注记（v6.12.0 D3）：给本窗有非中性信号的队各排一条通知（本仓没有关窗汇总通知，
  // 教练感知面 = 这条通知 + 维护费/冠名费流水 memo 里的信号说明）
  await queueWindowSignalNotes(env, season, windowSeq, signalDefs);
  // v6.14.0 C3 招商轮·批尾：接班转正（收租/演化/解约语句之后）——转正语句一律生成，
  // 落不落由执行期守卫（无生效约）决定：本批刚腾出/刚到期的位当批即转正；只有通知列表按构建期状态过滤
  // → 开新轮定向递价（round_id 标量子查询取本批刚开的轮）
  const offerNotified: { clubId: number; brands: string[] }[] = [];
  const activated: import('./market-ops.ts').QueuedActivation[] = [];
  if (round) {
    // 评审 P2-1：actor 透传（origin 'user' 配 actor 记真操作人；缺省 null = 系统口径）
    const activation = await activateQueuedStatements(env, season, windowSeq, 'user', opts.actor ?? null);
    statements.push(...round.openStatements, ...activation.statements);
    summary.marketOffers = round.offerCount;
    summary.activatedClubs = activation.activated.length;
    offerNotified.push(...round.offersPerClub);
    activated.push(...activation.activated);
  }
  // 情绪变化 / 品牌解约通知（v6.13.0 C2）：批后由调用方排队（批回滚则不发）
  const affected = [...new Set([...moodReports, ...terminatedReports].map((r) => r.clubId))];
  if (affected.length > 0) {
    const clubRows = (
      await env.DB
        .prepare(`SELECT id, name FROM clubs WHERE id IN (${affected.map(() => '?').join(',')})`)
        .bind(...affected)
        .all<{ id: number; name: string }>()
    ).results;
    const nameOf = (id: number) => clubRows.find((c) => c.id === id)?.name ?? `俱乐部${id}`;
    const sigText = (v: number, pos: string, neg: string) => (v > 0 ? pos : v < 0 ? neg : '持平');
    for (const rep of moodReports) {
      notifications.push({
        clubId: rep.clubId,
        template: 'naming_mood',
        data: {
          club: nameOf(rep.clubId),
          brand: rep.brand,
          from: rep.from.toFixed(2),
          to: rep.to.toFixed(2),
          reason: `上座${sigText(rep.attendSignal, '达标', '低迷')}，战绩${sigText(rep.resultSignal, '走高', '走低')}，${rep.delta >= 0 ? '+' : ''}${rep.delta.toFixed(3)}`,
        },
      });
    }
    for (const rep of terminatedReports) {
      const profile = profiles?.[(brandTier.get(rep.brand) ?? '口碑') as BrandTier];
      notifications.push({
        clubId: rep.clubId,
        template: 'naming_terminated',
        data: {
          club: nameOf(rep.clubId),
          brand: rep.brand,
          satisfaction: rep.to.toFixed(2),
          tier: brandTier.get(rep.brand) ?? '口碑',
          floor: (profile?.satisfyFloor ?? 0.5).toFixed(2),
        },
      });
    }
  }
  // 招商轮通知（v6.14.0 C3）：逐队收价汇总 + 接班转正回执，批后排队（批回滚不发假通知）
  const marketIds = [...new Set([...offerNotified.map((p) => p.clubId), ...activated.map((a) => a.clubId)])];
  if (marketIds.length > 0) {
    const marketClubs = (
      await env.DB
        .prepare(`SELECT id, name FROM clubs WHERE id IN (${marketIds.map(() => '?').join(',')})`)
        .bind(...marketIds)
        .all<{ id: number; name: string }>()
    ).results;
    const marketName = (id: number) => marketClubs.find((cl) => cl.id === id)?.name ?? `俱乐部${id}`;
    for (const p of offerNotified) {
      notifications.push({
        clubId: p.clubId,
        template: 'naming_offer',
        data: { club: marketName(p.clubId), count: p.brands.length, brands: p.brands.join('、') },
      });
    }
    for (const a of activated) {
      notifications.push({
        clubId: a.clubId,
        template: 'naming_offer_activated',
        data: { club: marketName(a.clubId), brand: a.brand, feePerWindow: a.feePerWindow, windows: a.windows, pkgName: a.pkgName },
      });
    }
  }
  return { statements, summary, notifications };
}
