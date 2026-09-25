// 主场收入域（v1.5.0，TECH_DESIGN §8 全按 revenue 插件移植 + 主规则 v5.2 §4.1.2/4.1.3/5.1）。
// 数据流（用户裁决 2026-09-16）：赛果确认时当场掷天气→算上座→三分收入即时入账（钩子④，match_attendance
// 主键+ledger 幂等双闸）；维护费与死忠演化在窗末并入关窗批。设施扩建/升级已随v2.5.0 落地
// （见 src/worker/stadium-ops.ts：五类子设施 0-5 级 + 球场扩建/升级）。
// 影响力 = 球员影响力总和（规则 4.1.3：系数×能力等级×国际声望，可成长 0.25/非成长 0.13，即时计算不落库）
//        + 队壳影响力 + 奖励分（主规则 §5.1，管理组维护 stadiums 两列）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { clubIdByTourTeam } from './prizes.ts';
import { getActiveNaming, windowNamingStatements } from './naming-ops.ts';

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

/** 球队影响力 = Σ球员 + 队壳 + 奖励分（主规则 §5.1） */
export function teamInfluence(stadium: { shell_influence: number; bonus_points: number }, playerSum: number): number {
  return playerSum + stadium.shell_influence + stadium.bonus_points;
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

function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
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

// ⚠️ 这里绑的是 club id，而 result_confirmations.home_team_id / away_team_id 存的是**比赛系统队 id**
// （迁移 0017）。生产实测（2026-09-22）两套 id 逐队相等（20/20，AUTH_DB team 的 club_id = tour_team_id），
// 且 20 队各有 6-7 条已确认赛果，所以现在算得出真值、不是恒中性。但这是数值巧合：米兰的 tour_team_id
// 曾长期是 legacy 47 而 club_id 是 131681，那段时间本函数恒返中性 4。将来若有 club 的 id 不等于其
// tour 队 id，本函数会静默退化成「永远中性」，届时按 prizes.ts 的 clubIdByTourTeam 先做映射再查。
export async function clubFormPts(env: Env, clubId: number, excludeMatchId: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side
     FROM result_confirmations WHERE (home_team_id = ? OR away_team_id = ?) AND match_id != ?
     ORDER BY id DESC LIMIT 9`,
  )
    .bind(clubId, clubId, excludeMatchId)
    .all();
  return formPtsOf(results as Parameters<typeof formPtsOf>[0], clubId);
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

/** 死忠演化（非对称靠拢；青训每级 +3% 涨粉；战绩 Pts≥7 ×1.05/≤1 ×0.95；钳 [0, 上限]） */
export function evolveFans(model: AttendanceModel, fans: number, target: number, attendRate: number, formPts: number, youthLevel = 0): number {
  const diff = target - fans;
  let next: number;
  if (diff > 0) {
    let coef = model.fans_grow_rate * (model.fans_grow_heat_base + model.fans_grow_heat_span * attendRate);
    coef *= 1 + 0.03 * youthLevel;
    next = fans + diff * coef;
  } else {
    const coef = model.fans_drop_rate * (1 + model.fans_drop_heat_extra * (1 - attendRate));
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

function asRange(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;
}

/**
 * 赛果确认钩子④（v1.5.0）：主场三分收入即时入账。
 * 跳过条件（detail=null）：AUTH_DB 目录无主场映射 / 无球场行 / 已入过账。
 * 上座快照 INSERT match_attendance（match_id 主键）+ ledgerMovement(kind='revenue', ref='match') 同批双闸。
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
  const stadium = await env.DB.prepare('SELECT club_id, capacity, tier, shell_influence, bonus_points, fans FROM stadiums WHERE club_id = ?').bind(clubId).first<StadiumRow>();
  if (!stadium) return { statements: [], detail: null };

  const weather = rollWeather(rng, model.weather_probabilities);
  const wxRange = asRange(model.weather_ranges[weather]);
  const wx = wxRange ? uniform(rng, wxRange[0], wxRange[1]) : 1;

  // 近 3 场战绩（平台已确认赛果，不含本场，假设 31）
  const formPts = await clubFormPts(env, clubId, input.matchId);
  const form = model.form_coef_table[String(Math.min(Math.max(formPts, 0), 9))] ?? 1;

  const tierTable = await loadTierTable(env.DB);
  const tierEntry = tierTable[String(stadium.tier)];
  const tierCoef = tierEntry?.attend_coef ?? 1;
  const multiplier = model.attendance_multiplier_base * (1 + model.attendance_multiplier_per_tier * stadium.tier);

  // 客队影响力：目录映射到俱乐部→其球队影响力；缺球场行→默认值（revenue default_influence）
  let awayInfluence = model.default_influence;
  const awayClubId = (await clubIdByTourTeam(env, [input.awayTeamId])).get(input.awayTeamId);
  if (awayClubId !== undefined) {
    const awayStadium = await env.DB.prepare('SELECT shell_influence, bonus_points FROM stadiums WHERE club_id = ?').bind(awayClubId).first<{ shell_influence: number; bonus_points: number }>();
    if (awayStadium) awayInfluence = teamInfluence(awayStadium, await playerInfluenceSum(env, awayClubId, model));
  }
  // 对手系数（revenue 口径）：主队影响力 ≤0 时取 1.0（不放大需求）
  const homeInfluence = teamInfluence(stadium, await playerInfluenceSum(env, clubId, model));
  const opp = homeInfluence <= 0 ? 1 : 1 + 0.05 * (awayInfluence / homeInfluence);

  const demand =
    stadium.fans *
    multiplier *
    tierCoef *
    form *
    wx *
    opp *
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

  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  statements.push(
    ...ledgerMovement(env.DB, {
      clubId,
      delta: total,
      kind: 'revenue',
      refType: 'match',
      refId: input.matchId,
      memo: `比赛日收入（比赛 #${input.matchId}，上座 ${attendance}/${stadium.capacity}，${weather}；票 ${ticket}/商 ${commercial}/播 ${broadcast}）`,
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
  return { statements, detail: { clubId, weather, attendance, ticket, commercial, broadcast } };
}

export interface HomeWindowSummary {
  maintenanceClubs: number;
  maintenanceTotal: number;
  fansClubs: number;
  namingClubs: number;
  namingTotal: number;
}

/**
 * 窗末主场结算（v1.5.0，并入关窗批）：维护费 + 死忠演化 + 冠名收租。
 * 维护费 = 档位基础 + 每万座费率 × 容量万 × 本窗主场场次（已确认口径，假设 33）；临时窗照收。
 * 死忠演化每队一轮（上座率=本窗平均，无场次中性 1.0；青训本期 0 级）——每种窗都演化。
 * 冠名收租仅常规窗（临时窗 chargeNaming=false：不收租、不减剩余窗数，v3.0.0 裁决）。
 * 幂等：ledger 走 'maintenance'/'naming_fee'/'window' 闸；fans UPDATE 幂等由关窗状态原子闸保证（整批回滚）。
 */
export async function windowHomeStatements(
  env: Env,
  season: number,
  windowSeq: number,
  opts: { chargeNaming: boolean },
): Promise<{ statements: ReturnType<Env['DB']['prepare']>[]; summary: HomeWindowSummary }> {
  const model = await loadAttendanceModel(env.DB);
  const tierTable = await loadTierTable(env.DB);

  const stadiums = await env.DB.prepare('SELECT club_id, capacity, tier, shell_influence, bonus_points, fans FROM stadiums').all<StadiumRow>();
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  const summary: HomeWindowSummary = { maintenanceClubs: 0, maintenanceTotal: 0, fansClubs: 0, namingClubs: 0, namingTotal: 0 };

  for (const s of stadiums.results) {
    const tierEntry = tierTable[String(s.tier)];
    if (!tierEntry) continue;
    const homeMatches = await env.DB.prepare(
      `SELECT COALESCE(SUM(attendance), 0) AS total, COUNT(*) AS n FROM match_attendance WHERE club_id = ? AND season = ? AND window_seq = ?`,
    )
      .bind(s.club_id, season, windowSeq)
      .first<{ total: number; n: number }>();
    const played = homeMatches?.n ?? 0;
    const attendTotal = homeMatches?.total ?? 0;
    const attendRate = played > 0 && s.capacity > 0 ? attendTotal / (s.capacity * played) : 1;

    const maintenance = Math.round((tierEntry.base_maintenance + tierEntry.per_10k_rate * (s.capacity / 10000) * played) * 100) / 100;
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
          memo: `球场维护（S${season} 第 ${windowSeq} 窗，${played} 场主场）`,
        }),
      );
    }

    const influence = teamInfluence(s, await playerInfluenceSum(env, s.club_id, model));
    const target = diehardTarget(model, influence);
    const formPts = await clubFormPts(env, s.club_id, 0);
    const nextFans = evolveFans(model, s.fans, target, attendRate, formPts);
    if (Math.abs(nextFans - s.fans) >= 0.5) {
      summary.fansClubs++;
      statements.push(
        env.DB
          .prepare(`UPDATE stadiums SET fans = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE club_id = ?`)
          .bind(nextFans, s.club_id),
      );
    }

    // 窗末冠名收租（v2.6.0）：费用 + 剩余窗口递减/到期 + 对赌奖金，幂等靠账本闸（club 维度）；
    // 临时窗不收租也不递减（v3.0.0 裁决）
    if (opts.chargeNaming) {
      const naming = await getActiveNaming(env.DB, s.club_id);
      if (naming) {
        const fansGrowth = s.fans > 0 ? (nextFans - s.fans) / s.fans : 0;
        statements.push(...windowNamingStatements(env, naming, season, windowSeq, attendRate, fansGrowth));
        summary.namingClubs++;
        summary.namingTotal = Math.round((summary.namingTotal + naming.fee_per_window) * 100) / 100;
      }
    }
  }
  return { statements, summary };
}
