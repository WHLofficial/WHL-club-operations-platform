// 冠名市场（v2.6.0，规则=revenue 插件 README §七 + brand_service.py / window_service.py / formula.py:462）：
// 品牌池落库（v6.8.0 迁移 0045，管理端可调，无排他，多队可签同一品牌）；
// 底价/窗口 = (基准 + 容量系数×容量万 + 死忠系数×死忠万) × 热度 × 行业系数，按签约时队况锁定整约；
// 三套餐（稳健/进取/对赌）费用条款快照入合同；提前解约赔剩余窗口费用 30%；
// 窗末收租 + 对赌奖金 + 品牌热度动态（近 3 场全胜/全败）并入关窗批。
// 续约（v6.8.0）：只剩最后 1 窗可续，按当期队况与品牌现热度重算（插件 renew 口径，无涨跌系数）。
// 档位性格与情绪演化（v6.13.0 C2）：brand_pool 三档（头部/新兴/口碑），关窗批自动校准（热度降序 +
// 头部准入下限，可空缺）+ 管理端锁档；满意度按上座/战绩两信号每窗演化（事件效果 v6.12.0 起即时落库，
// 不进演化，避免同一笔事件记两次账）；跌破档位地板品牌主动解约（无赔偿）；签约按品牌档位名额原子守卫。
// 招商轮（v6.14.0 C3）：主动签约（signNaming）退役，冠名获取只走 market-ops.ts 的招商轮报价
// ——本文件保留合同域（续约/退约/收租/演化/名额口径），签约入口在 market-ops.acceptOffer（快照供料）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { walkoverLoser } from '../core/walkover.ts';
import { getOpenWindow } from './seasons.ts';
import { assertOpOpen } from './ops-schedule.ts';
import { createAuditStatement, writeAudit } from '../lib/audit.ts';
// 对赌抽签（v6.51.0 批 3）：随机源与队映射都是既有实现——seededUnit 只复用不改（确定性契约），
// tourTeamIdsByClub 用于把 club_id 映射到赛事队 id（本窗已排主场场次/强度分位的取数入口）。
import { seededUnit } from './venue-ops.ts';
import { tourTeamIdsByClub } from './prizes.ts';

export interface BrandPoolRow {
  id: number;
  brand: string;
  heat: number;
  source: string;
  status: string;
  industry: string;
  tier: string;
  tier_locked: number;
  created_at: string;
  /** 企业档案（v6.51.0 批 2，0074）：空串 = 无档案（展示层不渲染） */
  name_en: string;
  full_name: string;
  color: string;
  slogan: string;
  hq: string;
  intro: string;
  /** '中资' = 展示「中资」小标签；空串 = 不渲染 */
  origin: string;
  /** 招商性格（v6.51.0 批 3，0075）：'' | '稳健' | '进取' | '对赌' */
  style: string;
  /** 偏好标签，逗号分隔（冠军相/高上座/死忠规模/大场馆），空串 = 不偏 */
  prefer: string;
}

/** 冠名上球场（v6.51.0 批 1）：品牌·球场原名 的中点命名；球场名缺失回空串（展示层回落原名）。 */
export function composeVenueName(brand: string, stadiumName: string | null | undefined): string {
  return stadiumName ? `${brand}·${stadiumName}` : '';
}

/** 球场命名读侧统一口径：快照（签约时点）优先，为空（老合同/未签约）现场 compose，无冠名回 null。 */
export function venueNameOf(
  snapshot: string | null | undefined,
  brand: string | null | undefined,
  stadiumName: string | null | undefined,
): string | null {
  if (snapshot) return snapshot;
  if (!brand) return null;
  return composeVenueName(brand, stadiumName) || null;
}

export interface NamingParams {
  base: number;
  perCapacityWan: number;
  perFansWan: number;
  terminatePenalty: number;
  stable: { windows: number; factor: number };
  short: { windows: number; factor: number };
  bet: { windows: number; factor: number; bonusRate: number; attend: number; fans: number };
}

export async function loadNamingParams(db: Env['DB']): Promise<NamingParams> {
  const config = createConfigService(db);
  const p = await config.getJson<NamingParams>('naming_params');
  if (
    !p ||
    ![p.base, p.perCapacityWan, p.perFansWan, p.terminatePenalty].every(Number.isFinite) ||
    !p.stable || !p.short || !p.bet
  ) {
    throw new HttpError(409, '冠名参数（naming_params）未配置或不完整');
  }
  return p;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 底价/窗口 = (基准 + 容量系数×容量万 + 死忠系数×死忠万) × 热度（formula.py naming_fee:462） */
export function namingBaseFee(p: NamingParams, capacity: number, fans: number, heat: number): number {
  return round3((p.base + p.perCapacityWan * (capacity / 10000) + p.perFansWan * (fans / 10000)) * heat);
}

export interface NamingPackage {
  packageNo: number;
  pkgName: string;
  windows: number;
  feePerWindow: number;
  bonusAmount: number;
  betAttend: number | null;
  betFans: number | null;
}

/** 三套餐费用条款（brand_service.py build_packages 口径）：金额=底价×factor，对赌奖金=保底×bonusRate。 */
export function buildPackages(p: NamingParams, baseFee: number): NamingPackage[] {
  const betFee = round3(baseFee * p.bet.factor);
  return [
    { packageNo: 1, pkgName: '稳健', windows: p.stable.windows, feePerWindow: round3(baseFee * p.stable.factor), bonusAmount: 0, betAttend: null, betFans: null },
    { packageNo: 2, pkgName: '进取', windows: p.short.windows, feePerWindow: round3(baseFee * p.short.factor), bonusAmount: 0, betAttend: null, betFans: null },
    {
      packageNo: 3,
      pkgName: '对赌',
      windows: p.bet.windows,
      feePerWindow: betFee,
      bonusAmount: round3(betFee * p.bet.bonusRate),
      betAttend: p.bet.attend,
      betFans: p.bet.fans,
    },
  ];
}

// ─── v6.51.0 批 3：对赌抽签引擎（design-brand-pool-structure §4.8 A–G）─────────
// 指标库 6 条（全窗级口径）→ 品牌 prefer 加权轮盘抽 2 条（第二条排除同相关族）→ 队伍强度定 p
// → 近 3 窗回测纠偏 → 四层硬护栏（G1 上下限 / G1b 触界剔除重抽 / G1c 少池兜底 / G4 无主场判不达）。
// 随机源 = venue-ops.seededUnit（确定性：同 seed+draw 恒定 ⇒ 关窗批重跑逐字一致、测试可复现）；
// seed = (season, windowSeq, clubId, hash(brand)) ⇒ 同签名恒同结果、换季换窗重抽。
// 单份合同不重抽：抽签结果进 naming_contracts.bet_terms 快照，结算按快照逐条评估。

export const BET_METRICS = ['attend', 'sellout', 'fans', 'points', 'goals', 'cleansheet'] as const;
export type BetMetric = (typeof BET_METRICS)[number];

/** 展示名（审计行/结算 memo/前端共用） */
export const BET_LABELS: Record<BetMetric, string> = {
  attend: '上座率',
  sellout: '满座场次',
  fans: '死忠增长',
  points: '窗内积分',
  goals: '窗内进球',
  cleansheet: '零封场次',
};

/** 相关族（design §4.8 B）：第二条不得与第一条同族 ⇒ 两条近似独立、双达概率 ≈ p² */
const BET_FAMILY: Record<BetMetric, 'A' | 'B' | 'C' | 'D'> = {
  attend: 'A',
  sellout: 'A',
  points: 'B',
  goals: 'B',
  fans: 'C',
  cleansheet: 'D',
};

/** prefer 标签 → 指标权重（design §4.8 B 表，未列出 = 1.0；多标签乘性叠加，如 冠军相+大场馆 ⇒ points 2.16） */
const PREFER_WEIGHTS: Record<string, Partial<Record<BetMetric, number>>> = {
  冠军相: { points: 2.4, goals: 1.9, cleansheet: 0.7 },
  高上座: { attend: 2.4, sellout: 1.7, fans: 1.1 },
  死忠规模: { fans: 2.6, attend: 1.1 },
  大场馆: { sellout: 2.3, attend: 1.6, points: 0.9 },
};

/** 四个合法 prefer 标签（管理端校验用） */
export const PREFER_TAGS = ['冠军相', '高上座', '死忠规模', '大场馆'] as const;

/** 招商性格三枚举（'' = 未登记，回档位映射） */
export const BRAND_STYLES = ['稳健', '进取', '对赌'] as const;

/** 池默认基线（design §4.8 A 末行）：无任何历史（首赛季首窗/新队/无赛果）时的 B 与每场均值 */
const POOL_DEFAULT = {
  attend: 0.6,
  fans: 0.03,
  pointsPerMatch: 1.3,
  goalsPerMatch: 1.2,
  cleansheetRate: 1 / 3,
  selloutRate: 0.25,
};

/** 比率型 σ 兜底（design §4.8 C：样本 < 2 窗） */
const DEFAULT_SIGMA = { attend: 0.06, fans: 0.02 };

/** 强度三分位 → 目标单条达线概率 p（design §4.8 C）；回测纠偏后钳 [0.28, 0.58] */
export const BET_P_BY_STRENGTH = { strong: 0.34, mid: 0.42, weak: 0.5 } as const;
export type BetStrength = keyof typeof BET_P_BY_STRENGTH;

/** 护栏标记（G5）：'' = 反解值直接可用；floor/ceil = 精确落界；pool_default = 无历史走池默认基线 */
export type BetGuard = '' | 'floor' | 'ceil' | 'pool_default';

export interface BetTermsItem {
  m: BetMetric;
  /** 达线阈值：比率型为比率（0.612），计数型为整数场次/次数（7） */
  threshold: number;
  /** 阈值反解所用基线（比率型 = 窗均值；计数型 = 每场均值） */
  baseline: number;
  /** 阈值反解所用样本口径的场次数（计数型 = 本窗同尺度场次期望：sellout 取主场尺度、points/goals/cleansheet 取全窗口径） */
  nBase: number;
  /** 反解时的目标达线概率（回测纠偏后的 p） */
  pTarget: number;
  guard: BetGuard;
}

/** 条款快照（naming_contracts.bet_terms，JSON v2；空串/旧格式 ⇒ 结算回落旧绝对线） */
export interface BetTerms {
  v: 2;
  seed: number[];
  p: number;
  strength: BetStrength;
  backtest: { hitRate: number | null; windows: number };
  /** G1b 被剔除的指标（含不适用与触界），按指标库固定序 */
  dropped: BetMetric[];
  items: BetTermsItem[];
}

/** 窗级历史样本（基线/回测用）：近 3 窗按 (season, window_seq) 降序 */
export interface BetHistorySample {
  season: number;
  windowSeq: number;
  /** 已确认场次（主客合计；弃权/缺比分的脏行不计） */
  played: number;
  points: number;
  goals: number;
  cleansheet: number;
  /** 主场场次与满座场次（match_attendance） */
  homePlayed: number;
  sellout: number;
  /** 窗上座率（无主场 → null） */
  attend: number | null;
}

/** 本窗结算样本（关窗批传给 windowNamingStatements；缺省 ⇒ 计数型条款判不达 + 审计 no_data） */
export interface NamingWindowCounts {
  /** 本窗主场场次（G4：= 0 时上座指标判不达——不借无主场的中性上座率 1.0） */
  homePlayed: number;
  played: number;
  points: number;
  goals: number;
  cleansheet: number;
  sellout: number;
}

/** 单窗口径的积分/进球/零封聚合片段（弃权按 3:0、点球按平；与 season-settle.leagueStandings 同口径）。
 *  绑定顺序固定：points 4 个 ? → goals 3 个 ? → cleansheet 3 个 ?，全部传 teamId。 */
function betCountSql(): string {
  return `COUNT(*) AS played,
    SUM(CASE
      WHEN walkover_side = 'away' THEN (CASE WHEN home_team_id = ? THEN 3 ELSE 0 END)
      WHEN walkover_side = 'home' THEN (CASE WHEN away_team_id = ? THEN 3 ELSE 0 END)
      WHEN score_home = score_away THEN 1
      WHEN home_team_id = ? AND score_home > score_away THEN 3
      WHEN away_team_id = ? AND score_away > score_home THEN 3
      ELSE 0 END) AS points,
    SUM(CASE
      WHEN walkover_side = 'away' THEN (CASE WHEN home_team_id = ? THEN 3 ELSE 0 END)
      WHEN walkover_side = 'home' THEN (CASE WHEN away_team_id = ? THEN 3 ELSE 0 END)
      WHEN home_team_id = ? THEN COALESCE(score_home, 0) ELSE COALESCE(score_away, 0) END) AS goals,
    SUM(CASE
      WHEN walkover_side = 'away' THEN (CASE WHEN home_team_id = ? THEN 1 ELSE 0 END)
      WHEN walkover_side = 'home' THEN (CASE WHEN away_team_id = ? THEN 1 ELSE 0 END)
      WHEN home_team_id = ? THEN (CASE WHEN score_away = 0 THEN 1 ELSE 0 END)
      ELSE (CASE WHEN score_home = 0 THEN 1 ELSE 0 END) END) AS cleansheet`;
}

/** betCountSql 的绑定参数（10 个占位符全是 teamId——缺位绑定在 D1 会静默落 NULL） */
function betCountParams(teamId: number): number[] {
  return [teamId, teamId, teamId, teamId, teamId, teamId, teamId, teamId, teamId, teamId];
}

/** 有效赛果行（双弃权与缺比分行不计，与 leagueStandings 一致） */
const BET_VALID_ROW = `(walkover_side IN ('home','away') OR (walkover_side IS NULL AND score_home IS NOT NULL AND score_away IS NOT NULL))`;

/** 标准正态分位（Acklam 有理逼近，|误差| < 1.15e-9）：design §4.8 C 三档 z_p 的连续化。
 *  p=0.34 → 0.4125、p=0.42 → 0.2019、p=0.50 → 0.0000 与表值（0.41/0.20/0.00）一致，
 *  回测纠偏把 p 调成 0.28/0.36/0.48… 后同一公式照样给 z。 */
export function normalQuantile(q: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (q <= 0) return -Infinity;
  if (q >= 1) return Infinity;
  if (q < pLow) {
    const u = Math.sqrt(-2 * Math.log(q));
    return (((((c[0]! * u + c[1]!) * u + c[2]!) * u + c[3]!) * u + c[4]!) * u + c[5]!) / ((((d[0]! * u + d[1]!) * u + d[2]!) * u + d[3]!) * u + 1);
  }
  if (q > 1 - pLow) {
    const u = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0]! * u + c[1]!) * u + c[2]!) * u + c[3]!) * u + c[4]!) * u + c[5]!) / ((((d[0]! * u + d[1]!) * u + d[2]!) * u + d[3]!) * u + 1);
  }
  const u = q - 0.5;
  const v = u * u;
  return (((((a[0]! * v + a[1]!) * v + a[2]!) * v + a[3]!) * v + a[4]!) * v + a[5]!) * u / (((((b[0]! * v + b[1]!) * v + b[2]!) * v + b[3]!) * v + b[4]!) * v + 1);
}

/** P(X ≥ t)，X ~ Poisson(λ)：从 t 起的 pmf 递推求和（λ/n 都小，直接求和足够稳） */
function poissonTail(lambda: number, t: number): number {
  if (t <= 0) return 1;
  if (lambda <= 0) return 0;
  let pmf = Math.exp(-lambda);
  let sum = 0;
  for (let k = 0; k <= 400; k++) {
    if (k >= t) sum += pmf;
    pmf = (pmf * lambda) / (k + 1);
    if (k > lambda && pmf < 1e-14) break;
  }
  return Math.min(1, sum);
}

/** P(X ≥ t)，X ~ Binomial(n, rate)：n 小（≤ 一窗场次），直接递推 */
function binomialTail(n: number, rate: number, t: number): number {
  if (t <= 0) return 1;
  if (n <= 0 || rate <= 0) return 0;
  if (rate >= 1) return t <= n ? 1 : 0;
  let pmf = Math.pow(1 - rate, n);
  let sum = 0;
  for (let k = 0; k <= n; k++) {
    if (k >= t) sum += pmf;
    pmf = (pmf * (n - k) * rate) / ((k + 1) * (1 - rate));
  }
  return Math.min(1, sum);
}

/** 计数型反解：取**最大**整数 T 使 P(X ≥ T) ≥ p（= 分布的 (1−p) 分位）。
 *  与比率型 T = B + z_p·σ 同解：p 就是单条达线概率，两条独立 ⇒ 双达 ≈ p²（design §4.8 F 的经济式）。 */
function poissonLineT(lambda: number, p: number): number {
  let last = 0;
  for (let t = 1; t <= 400; t++) {
    if (poissonTail(lambda, t) < p) break;
    last = t;
  }
  return last;
}

function binomialLineT(n: number, rate: number, p: number): number {
  let last = 0;
  for (let t = 1; t <= n; t++) {
    if (binomialTail(n, rate, t) < p) break;
    last = t;
  }
  return last;
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 样本标准差（样本 < 2 → null，调用方回落到 DEFAULT_SIGMA） */
function stdevOf(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const varr = values.reduce((s, v) => s + (v - m) * (v - m), 0) / (values.length - 1);
  return Math.sqrt(varr);
}

/** 品牌名字符串哈希（FNV-1a，喂给 seededUnit 的 seed 四元组第 4 位） */
export function brandHash(brand: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < brand.length; i++) {
    h = Math.imul(h ^ brand.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** prefer 逗号标签（去空、去重、只留四个合法标签） */
export function parsePreferTags(prefer: string): string[] {
  return [...new Set(prefer.split(',').map((s) => s.trim()).filter((s) => (PREFER_TAGS as readonly string[]).includes(s)))];
}

/** 指标抽签权重：基础 1.0 × prefer 命中倍率（乘性叠加） */
export function betWeights(preferTags: string[]): Record<BetMetric, number> {
  const out = {} as Record<BetMetric, number>;
  for (const m of BET_METRICS) {
    let w = 1;
    for (const tag of preferTags) {
      const mult = PREFER_WEIGHTS[tag]?.[m];
      if (typeof mult === 'number') w *= mult;
    }
    out[m] = w;
  }
  return out;
}

/** G1 阈值上下限（**唯一实现点**）：返回 null = 该指标不进池（design §4.8 G1「不进池」列）。 */
export function betGuardBounds(m: BetMetric, n: number, baseline: number): { floor: number; ceil: number } | null {
  switch (m) {
    case 'attend':
      if (baseline >= 0.85) return null;
      return { floor: Math.max(baseline + 0.01, 0.3), ceil: Math.min(0.9, baseline + 0.05, baseline * 1.15) };
    case 'fans':
      if (baseline < 0.005 || baseline > 0.05) return null;
      return { floor: 0.01, ceil: Math.min(0.06, baseline + 0.02) };
    case 'points':
      if (n < 3) return null;
      return { floor: Math.max(1, Math.round(n * 0.4)), ceil: Math.floor(n * 2.2) };
    case 'goals':
      if (n < 3) return null;
      return { floor: Math.max(1, Math.round(n * 0.3)), ceil: Math.floor(n * 2.4) };
    case 'cleansheet':
      if (n < 3) return null;
      return { floor: 1, ceil: Math.ceil(n / 3) };
    case 'sellout':
      if (n < 3 || baseline > 0.5) return null;
      return { floor: 1, ceil: Math.max(1, Math.ceil(n * 0.7)) };
  }
}

/** 单指标反解（返回 null = 指标库层面不适用；阈值是否在 G1 内由调用方判） */
export function deriveOne(
  m: BetMetric,
  samples: BetHistorySample[],
  n: number,
  p: number,
  capacity: number,
): { threshold: number; baseline: number; nBase: number; pooled: boolean } | null {
  const z = normalQuantile(1 - p);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  if (m === 'attend') {
    if (capacity <= 0) return null;
    const vals = samples.map((s) => s.attend).filter((v): v is number => v !== null);
    const pooled = vals.length === 0;
    const baseline = meanOf(vals) ?? POOL_DEFAULT.attend;
    const sigma = stdevOf(vals) ?? DEFAULT_SIGMA.attend;
    return { threshold: r3(baseline + z * sigma), baseline: r3(baseline), nBase: n, pooled };
  }
  if (m === 'fans') {
    // 库内无死忠历史表（stadiums 只存现值 + 本窗起点，stadiums.fans_window_start）⇒ 恒走池默认基线。
    // 这是数据可得性的硬限制（design §4.8 A「无历史走池默认」），不是取舍。
    const baseline = POOL_DEFAULT.fans;
    const sigma = Math.min(DEFAULT_SIGMA.fans, 0.02);
    return { threshold: r3(baseline + z * sigma), baseline, nBase: n, pooled: true };
  }
  if (m === 'sellout') {
    const rates = samples.filter((s) => s.homePlayed > 0).map((s) => s.sellout / s.homePlayed);
    const pooled = rates.length === 0;
    const rate = meanOf(rates) ?? POOL_DEFAULT.selloutRate;
    return { threshold: binomialLineT(n, rate, p), baseline: r3(rate), nBase: n, pooled };
  }
  if (m === 'points') {
    const perMatch = samples.filter((s) => s.played > 0).map((s) => s.points / s.played);
    const pooled = perMatch.length === 0;
    const rate = meanOf(perMatch) ?? POOL_DEFAULT.pointsPerMatch;
    return { threshold: poissonLineT(rate * n, p), baseline: r3(rate), nBase: n, pooled };
  }
  if (m === 'goals') {
    const perMatch = samples.filter((s) => s.played > 0).map((s) => s.goals / s.played);
    const pooled = perMatch.length === 0;
    const rate = meanOf(perMatch) ?? POOL_DEFAULT.goalsPerMatch;
    return { threshold: poissonLineT(rate * n, p), baseline: r3(rate), nBase: n, pooled };
  }
  const rates = samples.filter((s) => s.played > 0).map((s) => s.cleansheet / s.played);
  const pooled = rates.length === 0;
  const rate = meanOf(rates) ?? POOL_DEFAULT.cleansheetRate;
  return { threshold: binomialLineT(n, rate, p), baseline: r3(rate), nBase: n, pooled };
}

/** 结算尺度（design §4.8 A）：阈值反解必须与**结算判定变量**同尺度 ——
 *  `sellout` 比的是「本窗主场场次」的合计、`attend` 按主场算率，
 *  `points/goals/cleansheet` 比的是「本窗全部已确认场次」的合计。 */
export interface BetScale {
  /** 本窗主场场次期望（attend / sellout 尺度） */
  home: number;
  /** 本窗全部已确认场次期望（points / goals / cleansheet 尺度） */
  all: number;
}

/** 本窗场次期望（签约当刻口径）。窗口与赛程是**解耦**的 —— 迁移 0014 起 season_windows.tournament_id 休眠
 *  （绑定平移到 season_tournaments，且「赛果归属赛季不归属窗口」假设 25）⇒ 签约当刻取不到「本窗已排定赛程」，
 *  故用该队近 3 窗同尺度场次的均值（取整）作本窗期望。无历史（首季 / 新队）→ 0 ⇒ 计数型出池（G1c）、
 *  比率型 attend / fans 照用池默认线；这样反解尺度 = 结算尺度，回测纠偏也按同一 nBase 归一。 */
export function expectedWindowScale(samples: BetHistorySample[]): BetScale {
  const homeMean = meanOf(samples.filter((s) => s.homePlayed > 0).map((s) => s.homePlayed));
  const allMean = meanOf(samples.filter((s) => s.played > 0).map((s) => s.played));
  return { home: homeMean === null ? 0 : Math.round(homeMean), all: allMean === null ? 0 : Math.round(allMean) };
}

/** 单指标取尺度：传数字 = 两尺度相同（单口径调用与既有用例），传 BetScale = 生产口径 */
function scaleN(m: BetMetric, scale: number | BetScale): number {
  if (typeof scale === 'number') return scale;
  return m === 'attend' || m === 'sellout' ? scale.home : scale.all;
}

/** 近 3 窗（严格早于当前窗）的窗级样本：赛果聚合 + 主场上座/满座 */
async function loadBetHistory(
  env: Env,
  clubId: number,
  tourTeamId: number,
  capacity: number,
  season: number,
  windowSeq: number,
): Promise<BetHistorySample[]> {
  const before = `(season < ? OR (season = ? AND window_seq < ?))`;
  const { results: resRows } = await env.DB
    .prepare(
      `SELECT season, window_seq, ${betCountSql()}
       FROM result_confirmations
       WHERE (home_team_id = ? OR away_team_id = ?) AND ${before} AND ${BET_VALID_ROW}
       GROUP BY season, window_seq ORDER BY season DESC, window_seq DESC LIMIT 3`,
    )
    .bind(...betCountParams(tourTeamId), tourTeamId, tourTeamId, season, season, windowSeq)
    .all<{ season: number; window_seq: number; played: number; points: number; goals: number; cleansheet: number }>();
  const { results: attRows } = await env.DB
    .prepare(
      `SELECT season, window_seq, COUNT(*) AS home_played, COALESCE(SUM(attendance), 0) AS total,
              COALESCE(SUM(CASE WHEN attendance >= ? * 0.98 THEN 1 ELSE 0 END), 0) AS sellout
       FROM match_attendance WHERE club_id = ? AND ${before}
       GROUP BY season, window_seq ORDER BY season DESC, window_seq DESC LIMIT 3`,
    )
    .bind(capacity, clubId, season, season, windowSeq)
    .all<{ season: number; window_seq: number; home_played: number; total: number; sellout: number }>();
  const keys = new Map<string, BetHistorySample>();
  const keyOf = (s: number, w: number) => `${s}:${w}`;
  for (const r of attRows) {
    keys.set(keyOf(r.season, r.window_seq), {
      season: r.season,
      windowSeq: r.window_seq,
      played: 0,
      points: 0,
      goals: 0,
      cleansheet: 0,
      homePlayed: r.home_played,
      sellout: r.sellout,
      attend: r.home_played > 0 && capacity > 0 ? r.total / (capacity * r.home_played) : null,
    });
  }
  for (const r of resRows) {
    const k = keyOf(r.season, r.window_seq);
    const cur = keys.get(k) ?? {
      season: r.season,
      windowSeq: r.window_seq,
      played: 0,
      points: 0,
      goals: 0,
      cleansheet: 0,
      homePlayed: 0,
      sellout: 0,
      attend: null,
    };
    cur.played = r.played;
    cur.points = r.points ?? 0;
    cur.goals = r.goals ?? 0;
    cur.cleansheet = r.cleansheet ?? 0;
    keys.set(k, cur);
  }
  return [...keys.values()].sort((a, b) => b.season - a.season || b.windowSeq - a.windowSeq).slice(0, 3);
}

/** 三分位归位（同分按 id 升序已由调用方排定，这里只看位次） */
function tertileOf(pos: number, total: number): BetStrength {
  if (total <= 0) return 'mid';
  if (pos * 3 < total) return 'strong';
  if (pos * 3 >= total * 2) return 'weak';
  return 'mid';
}

/** 队伍强度三分位（design §4.8 C）：近 3 个已关窗的全联盟场均积分（PPM）名次分位 →
 *  无赛果退化到死忠规模（stadiums.fans）分位 → 再退化中位。 */
async function clubStrength(env: Env, tourTeamId: number | null, clubId: number): Promise<BetStrength> {
  if (tourTeamId !== null) {
    const closed = (
      await env.DB
        .prepare(`SELECT season, window_seq FROM season_windows WHERE status = 'closed' ORDER BY season DESC, window_seq DESC LIMIT 3`)
        .all<{ season: number; window_seq: number }>()
    ).results;
    if (closed.length > 0) {
      const cond = closed.map(() => '(season = ? AND window_seq = ?)').join(' OR ');
      const params = closed.flatMap((w) => [w.season, w.window_seq]);
      const ptsHome = `CASE WHEN walkover_side = 'away' THEN 3 WHEN walkover_side = 'home' THEN 0 WHEN score_home = score_away THEN 1 WHEN score_home > score_away THEN 3 ELSE 0 END`;
      const ptsAway = `CASE WHEN walkover_side = 'home' THEN 3 WHEN walkover_side = 'away' THEN 0 WHEN score_home = score_away THEN 1 WHEN score_away > score_home THEN 3 ELSE 0 END`;
      const { results } = await env.DB
        .prepare(
          `SELECT team_id, SUM(pts) AS pts, COUNT(*) AS played FROM (
             SELECT home_team_id AS team_id, ${ptsHome} AS pts FROM result_confirmations
              WHERE (${cond}) AND home_team_id IS NOT NULL AND ${BET_VALID_ROW}
             UNION ALL
             SELECT away_team_id AS team_id, ${ptsAway} AS pts FROM result_confirmations
              WHERE (${cond}) AND away_team_id IS NOT NULL AND ${BET_VALID_ROW}
           ) GROUP BY team_id`,
        )
        .bind(...params, ...params)
        .all<{ team_id: number; pts: number; played: number }>();
      const ranked = results
        .filter((r) => r.played > 0)
        .map((r) => ({ id: r.team_id, ppm: r.pts / r.played }))
        .sort((a, b) => b.ppm - a.ppm || a.id - b.id);
      const pos = ranked.findIndex((r) => r.id === tourTeamId);
      if (pos >= 0) return tertileOf(pos, ranked.length);
    }
  }
  const fans = (
    await env.DB.prepare(`SELECT club_id, fans FROM stadiums ORDER BY fans DESC, club_id ASC`).all<{
      club_id: number;
      fans: number;
    }>()
  ).results;
  const fpos = fans.findIndex((r) => r.club_id === clubId);
  if (fpos >= 0) return tertileOf(fpos, fans.length);
  return 'mid';
}

/** 权重轮盘（seed+draw 恒定 ⇒ 同签名同结果） */
function roulette<T extends { weight: number }>(pool: T[], seed: number[], draw: number): T {
  const total = pool.reduce((s, v) => s + v.weight, 0);
  const r = seededUnit(seed, draw) * total;
  let acc = 0;
  for (const v of pool) {
    acc += v.weight;
    if (r < acc) return v;
  }
  return pool[pool.length - 1]!;
}

/** 抽签：第一条按权重轮盘；第二条重新归一化后抽、排除与第一条同相关族（G1c 池=1 只抽 1 条） */
function drawBetItems(viable: { item: BetTermsItem; weight: number }[], seed: number[]): BetTermsItem[] {
  if (viable.length === 0) return [];
  const first = roulette(viable, seed, 0);
  if (viable.length === 1) return [first.item];
  const rest = viable.filter((v) => v.item.m !== first.item.m && BET_FAMILY[v.item.m] !== BET_FAMILY[first.item.m]);
  if (rest.length === 0) return [first.item];
  return [first.item, roulette(rest, seed, 1).item];
}

/** 回测达线率（design §4.8 D）：把当前阈值回放到历史各窗。
 *  计数型按**每场速率**比较（历史窗场次数与本窗 n 不同，直接比整数会把差异算成难度差）：
 *  历史窗的每场值 ≥ T ÷ n 即算达线。无可回放样本 → null（数据 < 2 窗直接跳过纠偏）。 */
function betHitRate(items: BetTermsItem[], samples: BetHistorySample[]): number | null {
  const rates: number[] = [];
  for (const item of items) {
    let hits = 0;
    let total = 0;
    for (const s of samples) {
      let histPerMatch: number | null = null;
      switch (item.m) {
        case 'attend':
          histPerMatch = s.attend;
          break;
        case 'fans':
          histPerMatch = null; // 无历史
          break;
        case 'sellout':
          histPerMatch = s.homePlayed > 0 ? s.sellout / s.homePlayed : null;
          break;
        case 'points':
          histPerMatch = s.played > 0 ? s.points / s.played : null;
          break;
        case 'goals':
          histPerMatch = s.played > 0 ? s.goals / s.played : null;
          break;
        case 'cleansheet':
          histPerMatch = s.played > 0 ? s.cleansheet / s.played : null;
          break;
      }
      if (histPerMatch === null) continue;
      total += 1;
      // 比率型阈值本身就是比率；计数型换算成每场阈值（T ÷ nBase）
      const line = item.m === 'attend' ? item.threshold : item.nBase > 0 ? item.threshold / item.nBase : Infinity;
      if (histPerMatch >= line) hits += 1;
    }
    if (total > 0) rates.push(hits / total);
  }
  return rates.length > 0 ? rates.reduce((s, v) => s + v, 0) / rates.length : null;
}

/** 给定 p 的可行池 / 触界集合 / 被剔指标（G1 + G1b）——纯函数，护栏行为逐条可锁。
 *  可行池 = 适用性通过 **且** 反解阈值落在 G1 [下限,上限] 内；触界 = 剔除重抽（绝不钳低）。
 *  scale 按指标各自的结算尺度取 n（见 BetScale / expectedWindowScale）。 */
export function deriveBetPool(
  samples: BetHistorySample[],
  scale: number | BetScale,
  capacity: number,
  p: number,
  weights: Record<BetMetric, number>,
): { dropped: BetMetric[]; viable: { item: BetTermsItem; weight: number }[]; breaches: { item: BetTermsItem; distance: number }[] } {
  const dropped: BetMetric[] = [];
  const viable: { item: BetTermsItem; weight: number }[] = [];
  const breaches: { item: BetTermsItem; distance: number }[] = [];
  for (const m of BET_METRICS) {
    const n = scaleN(m, scale);
    const d = deriveOne(m, samples, n, p, capacity);
    if (d === null) {
      dropped.push(m);
      continue;
    }
    const bounds = betGuardBounds(m, n, d.baseline);
    if (bounds === null) {
      dropped.push(m);
      continue;
    }
    const guard: BetGuard = d.pooled ? 'pool_default' : '';
    // G1c：无历史走池默认基线时，线高于上限就地取上限（唯一被允许的「向下钳」）
    const threshold = guard === 'pool_default' ? Math.min(d.threshold, bounds.ceil) : d.threshold;
    const item: BetTermsItem = { m, threshold, baseline: d.baseline, nBase: d.nBase, pTarget: p, guard };
    if (threshold < bounds.floor || threshold > bounds.ceil) {
      // G1b：触界 = 剔除重抽，绝不把线钳低（钳低 = 一条人人都能过的要求 = 白送）
      const distance =
        threshold > bounds.ceil
          ? (threshold - bounds.ceil) / Math.max(bounds.ceil, 1e-6)
          : (bounds.floor - threshold) / Math.max(bounds.floor, 1e-6);
      breaches.push({ item, distance });
      dropped.push(m);
      continue;
    }
    viable.push({ item, weight: weights[m] });
  }
  return { dropped, viable, breaches };
}

/** G1c 兜底链：可行池 ≥2 抽 2 条（异族）/ =1 只抽 1 条（drawBetItems 内）/ =0 取触界最轻一条
 *  钳到上限记 guard='ceil'（唯一允许的向下钳，且只发生在全池触界时）。 */
export function chooseBetItems(
  state: ReturnType<typeof deriveBetPool>,
  scale: number | BetScale,
  seed: number[],
): { items: BetTermsItem[]; dropped: BetMetric[] } {
  const items = drawBetItems(state.viable, seed);
  const dropped = [...state.dropped];
  if (items.length === 0 && state.breaches.length > 0) {
    const lightest = [...state.breaches].sort((a, b) => a.distance - b.distance)[0]!;
    const bounds = betGuardBounds(lightest.item.m, scaleN(lightest.item.m, scale), lightest.item.baseline)!;
    return { items: [{ ...lightest.item, threshold: bounds.ceil, guard: 'ceil' }], dropped: dropped.filter((m) => m !== lightest.item.m) };
  }
  return { items, dropped };
}

/**
 * 对赌条款抽签（签约/接班转正/续约三处调用，与 pkgJson 同点）：
 * 适用性过滤 → prefer 加权抽 2 条（异族）→ 强度定 p 反解 → 近 3 窗回测纠偏 → 四层护栏定稿。
 * 纯计算 + 只读查库，不写库；结果由调用方写进 naming_contracts.bet_terms 快照。
 */
export async function buildBetTerms(
  env: Env,
  clubId: number,
  brand: string,
  season: number,
  windowSeq: number,
): Promise<BetTerms> {
  const capacity =
    (await env.DB.prepare('SELECT capacity FROM stadiums WHERE club_id = ?').bind(clubId).first<{ capacity: number }>())
      ?.capacity ?? 0;
  const tourTeamId = (await tourTeamIdsByClub(env, [clubId])).get(clubId) ?? null;
  const samples = tourTeamId === null ? [] : await loadBetHistory(env, clubId, tourTeamId, capacity, season, windowSeq);
  // 本窗场次期望（逐指标尺度在 deriveBetPool 内取）：无历史 → {0,0} ⇒ 计数型出池、比率型走池默认线
  const scale = expectedWindowScale(samples);
  const strength = await clubStrength(env, tourTeamId, clubId);
  const brandRow = await env.DB
    .prepare(`SELECT prefer FROM brand_pool WHERE brand = ?`)
    .bind(brand)
    .first<{ prefer: string }>();
  const weights = betWeights(parsePreferTags(brandRow?.prefer ?? ''));
  const seed = [season, windowSeq, clubId, brandHash(brand)];

  let p: number = BET_P_BY_STRENGTH[strength];
  let state = deriveBetPool(samples, scale, capacity, p, weights);
  let { items, dropped } = chooseBetItems(state, scale, seed);
  let hitRate: number | null = null;
  // 回测纠偏（design §4.8 D）：数据 < 2 窗跳过；不在 [0.30, 0.55] 反向调 ±0.06，最多两档、钳 [0.28, 0.58]
  if (samples.length >= 2 && items.length > 0) {
    for (let step = 0; step < 2; step++) {
      hitRate = betHitRate(items, samples);
      if (hitRate === null || (hitRate >= 0.3 && hitRate <= 0.55)) break;
      p = Math.max(0.28, Math.min(0.58, Math.round((p + (hitRate > 0.55 ? 0.06 : -0.06)) * 100) / 100));
      state = deriveBetPool(samples, scale, capacity, p, weights);
      ({ items, dropped } = chooseBetItems(state, scale, seed)); // 新 p ⇒ 阈值/可行池变，同 seed 重抽
    }
  }
  return {
    v: 2,
    seed,
    p,
    strength,
    backtest: { hitRate, windows: samples.length },
    dropped,
    items,
  };
}

/** 条款快照解析：'' / 非 v2（旧格式）⇒ null（结算回落旧 bet_attend/bet_fans 绝对线）。
 *  v2 快照即使 items 为空也**不回退旧线**（新合同空条款 = 零奖金 + 审计 no_data，不得借旧绝对线白送）。 */
export function parseBetTerms(raw: string | null | undefined): BetTerms | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Partial<BetTerms>;
  if (o.v !== 2 || !Array.isArray(o.items)) return null;
  const items = o.items.filter(
    (it): it is BetTermsItem =>
      !!it && typeof it === 'object' && (BET_METRICS as readonly string[]).includes(String(it.m)) && Number.isFinite(it.threshold),
  );
  return {
    v: 2,
    seed: Array.isArray(o.seed) ? o.seed : [],
    p: typeof o.p === 'number' && Number.isFinite(o.p) ? o.p : 0,
    strength: o.strength === 'strong' || o.strength === 'weak' ? o.strength : 'mid',
    backtest: o.backtest && typeof o.backtest === 'object' ? o.backtest : { hitRate: null, windows: 0 },
    dropped: Array.isArray(o.dropped) ? o.dropped : [],
    items,
  };
}

/** 本窗结算样本（关窗批，与指标库同口径）：赛果聚合 + 主场场次/满座场次 */
export async function loadNamingWindowCounts(
  env: Env,
  clubId: number,
  tourTeamId: number | null,
  season: number,
  windowSeq: number,
): Promise<NamingWindowCounts> {
  const capacity =
    (await env.DB.prepare('SELECT capacity FROM stadiums WHERE club_id = ?').bind(clubId).first<{ capacity: number }>())
      ?.capacity ?? 0;
  const att = await env.DB
    .prepare(
      `SELECT COUNT(*) AS home_played,
              COALESCE(SUM(CASE WHEN attendance >= ? * 0.98 THEN 1 ELSE 0 END), 0) AS sellout
       FROM match_attendance WHERE club_id = ? AND season = ? AND window_seq = ?`,
    )
    .bind(capacity, clubId, season, windowSeq)
    .first<{ home_played: number; sellout: number }>();
  let played = 0;
  let points = 0;
  let goals = 0;
  let cleansheet = 0;
  if (tourTeamId !== null) {
    const row = await env.DB
      .prepare(
        `SELECT ${betCountSql()} FROM result_confirmations
         WHERE (home_team_id = ? OR away_team_id = ?) AND season = ? AND window_seq = ? AND ${BET_VALID_ROW}`,
      )
      .bind(...betCountParams(tourTeamId), tourTeamId, tourTeamId, season, windowSeq)
      .first<{ played: number; points: number; goals: number; cleansheet: number }>();
    played = row?.played ?? 0;
    points = row?.points ?? 0;
    goals = row?.goals ?? 0;
    cleansheet = row?.cleansheet ?? 0;
  }
  return { homePlayed: att?.home_played ?? 0, played, points, goals, cleansheet, sellout: att?.sellout ?? 0 };
}

/** 单条条款的本窗实况判定（G4：上座指标在本窗无主场时判不达，不借「缺省上座率 1.0」）。
 *  actual=null 表示样本缺失（计数型拿不到 counts / 无从取数）⇒ 判不达并记 no_data。 */
export function evaluateBetItem(
  item: BetTermsItem,
  counts: NamingWindowCounts | null,
  attendRate: number,
  fansGrowth: number,
): { actual: number | null; hit: boolean } {
  switch (item.m) {
    case 'attend': {
      if (!counts || counts.homePlayed <= 0) return { actual: null, hit: false };
      return { actual: attendRate, hit: attendRate >= item.threshold };
    }
    case 'fans':
      return { actual: fansGrowth, hit: fansGrowth >= item.threshold };
    case 'sellout':
      if (!counts) return { actual: null, hit: false };
      return { actual: counts.sellout, hit: counts.sellout >= item.threshold };
    case 'points':
      if (!counts) return { actual: null, hit: false };
      return { actual: counts.points, hit: counts.points >= item.threshold };
    case 'goals':
      if (!counts) return { actual: null, hit: false };
      return { actual: counts.goals, hit: counts.goals >= item.threshold };
    case 'cleansheet':
      if (!counts) return { actual: null, hit: false };
      return { actual: counts.cleansheet, hit: counts.cleansheet >= item.threshold };
  }
}

export interface NamingContractRow {
  id: number;
  club_id: number;
  brand: string;
  brand_heat: number;
  base_fee: number;
  package_no: number;
  pkg_name: string;
  fee_per_window: number;
  windows_total: number;
  windows_remaining: number;
  bonus_amount: number;
  bet_attend: number | null;
  bet_fans: number | null;
  status: string;
  started_season: number;
  started_window: number;
  satisfaction: number;
  /** 冠名球场名快照（v6.51.0 批 1，0072）：'' = 老合同/未写（读侧现场 compose） */
  venue_name: string;
  /** 对赌条款抽签快照 JSON v2（v6.51.0 批 3，0075）：'' / 旧格式 ⇒ 结算回落旧绝对线 */
  bet_terms: string;
}

export async function getActiveNaming(db: Env['DB'], clubId: number): Promise<NamingContractRow | null> {
  return db
    .prepare(`SELECT * FROM naming_contracts WHERE club_id = ? AND status = 'active'`)
    .bind(clubId)
    .first<NamingContractRow>();
}

export interface NamingQuote {
  brand: string;
  heat: number;
  industry: string;
  tier: string;
  baseFee: number;
  packages: NamingPackage[];
  /** 签下将命名的球场名（v6.51.0 批 1）：无球场名回 null */
  venueName: string | null;
}

/** 品牌池在池品牌（adopted），按 id 稳定序。 */
export async function loadAdoptedBrands(db: Env['DB']): Promise<BrandPoolRow[]> {
  return (
    await db
      .prepare(
        `SELECT id, brand, heat, source, status, industry, tier, tier_locked, created_at,
                name_en, full_name, color, slogan, hq, intro, origin, style, prefer
         FROM brand_pool WHERE status = 'adopted' ORDER BY id`,
      )
      .all<BrandPoolRow>()
  ).results;
}

/** 行业系数表（config naming_industry_factors，JSON）：非法值剔除，未登记行业回 1.0（插件 formula.py:470 口径）。 */
export async function loadIndustryFactors(db: Env['DB']): Promise<Record<string, number>> {
  const config = createConfigService(db);
  const raw = await config.getJson<Record<string, unknown>>('naming_industry_factors');
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
  }
  return out;
}

export function industryFactor(factors: Record<string, number>, industry: string): number {
  const v = factors[industry];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1.0;
}

/** 品牌池报价：按本队队况逐品牌算底价（×行业系数）与三套餐；stadiumName 供「签下将命名为 …」展示（v6.51.0 批 1）。 */
export function quoteBrands(
  p: NamingParams,
  brands: BrandPoolRow[],
  capacity: number,
  fans: number,
  factors: Record<string, number>,
  stadiumName?: string | null,
): NamingQuote[] {
  return brands.map((b) => {
    const baseFee = round3(namingBaseFee(p, capacity, fans, b.heat) * industryFactor(factors, b.industry));
    return {
      brand: b.brand,
      heat: b.heat,
      industry: b.industry,
      tier: b.tier,
      baseFee,
      packages: buildPackages(p, baseFee),
      venueName: venueNameOf('', b.brand, stadiumName),
    };
  });
}

/** 提前解约赔款口径（terminateNaming 与 C3 换签 acceptOffer 共用）：剩余窗口(减 1) × 每窗费 × terminatePenalty。 */
export function terminatePenaltyOf(params: NamingParams, windowsRemaining: number, feePerWindow: number): number {
  const remaining = Math.max(0, windowsRemaining - 1);
  return round3(remaining * feePerWindow * params.terminatePenalty);
}

/** 续约（v6.8.0，插件 brand_service.py renew 口径）：只剩最后 1 窗可续；按当前队况与品牌现热度
 *  重算三套餐，原地换约（费用条款/剩余窗数/签约窗一次更新），无独立涨跌系数——价格漂移全由
 *  容量/死忠/热度/行业系数的变化承载。 */
export async function renewNaming(
  env: Env,
  clubId: number,
  packageNo: number,
  actor: number | null,
): Promise<NamingContractRow> {
  if (!Number.isInteger(packageNo) || packageNo < 1 || packageNo > 3) {
    throw new HttpError(400, '套餐号需为 1-3（1=稳健 2=进取 3=对赌）');
  }
  const win = await getOpenWindow(env.DB);
  if (!win) throw new HttpError(409, '转会窗口没开，续约办不了');
  // v6.49.0 运营时刻表：冠名续约属消费中心（默认「不限制」= 只剩上面那道窗口闸）
  await assertOpOpen(env.DB, 'consumption');
  const row = await getActiveNaming(env.DB, clubId);
  if (!row) throw new HttpError(404, '该队没有生效冠名');
  if (row.windows_remaining !== 1) {
    throw new HttpError(400, `只剩最后 1 窗才能续约（当前剩 ${row.windows_remaining} 窗）`);
  }
  const brand = await env.DB
    .prepare(`SELECT heat, industry, status FROM brand_pool WHERE brand = ?`)
    .bind(row.brand)
    .first<{ heat: number; industry: string; status: string }>();
  if (!brand || brand.status !== 'adopted') throw new HttpError(409, `品牌「${row.brand}」已不在池中，无法续约`);
  const stadium = await env.DB
    .prepare('SELECT name, capacity, fans FROM stadiums WHERE club_id = ?')
    .bind(clubId)
    .first<{ name: string | null; capacity: number; fans: number }>();
  if (!stadium) throw new HttpError(404, '俱乐部还没有球场档案');
  const params = await loadNamingParams(env.DB);
  const factors = await loadIndustryFactors(env.DB);
  const baseFee = round3(namingBaseFee(params, stadium.capacity, stadium.fans, brand.heat) * industryFactor(factors, brand.industry));
  const pkg = buildPackages(params, baseFee)[packageNo - 1]!;
  // 对赌条款重抽（v6.51.0 批 3）：续约换约等于新一份合同，条款按新 seed（同季同窗，品牌/队未变 ⇒ 与当窗首次签约同结果）
  const betTerms = packageNo === 3 ? JSON.stringify(await buildBetTerms(env, clubId, row.brand, win.season, win.windowSeq)) : '';
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const out = await env.DB
    .prepare(
      `UPDATE naming_contracts
       SET brand_heat = ?, base_fee = ?, package_no = ?, pkg_name = ?, fee_per_window = ?,
           windows_total = ?, windows_remaining = ?, bonus_amount = ?, bet_attend = ?, bet_fans = ?,
           venue_name = ?, bet_terms = ?, started_season = ?, started_window = ?, updated_at = ${now}
       WHERE id = ? AND status = 'active' AND windows_remaining = 1`,
    )
    .bind(
      brand.heat, baseFee, pkg.packageNo, pkg.pkgName, pkg.feePerWindow,
      pkg.windows, pkg.windows, pkg.bonusAmount, pkg.betAttend, pkg.betFans,
      composeVenueName(row.brand, stadium.name), betTerms,
      win.season, win.windowSeq, row.id,
    )
    .run();
  // 并发守卫：0 行即状态在读到写之间被改过（解约 / 另一窗已续），此时不写审计——审计只记真发生的事
  if ((out.meta.changes ?? 0) === 0) throw new HttpError(409, '冠名状态刚被并发改动，请重试');
  await writeAudit(env.DB, {
    actor,
    action: 'naming_renew',
    targetType: 'naming_contract',
    targetId: row.id,
    origin: 'user',
    before: { brand: row.brand, feePerWindow: row.fee_per_window, windowsTotal: row.windows_total, packageNo: row.package_no },
    after: { brand: row.brand, feePerWindow: pkg.feePerWindow, windowsTotal: pkg.windows, packageNo: pkg.packageNo, baseFee },
  });
  const updated = await getActiveNaming(env.DB, clubId);
  if (!updated) throw new HttpError(500, '续约落库后读不回来');
  return updated;
}

/** 提前解约：赔剩余窗口费用 30%（当窗费用照收，插件口径 remaining−1）；无赔金时纯状态变更。 */
export async function terminateNaming(
  env: Env,
  clubId: number,
  actor: number | null,
): Promise<{ brand: string; penalty: number; windowsRemaining: number }> {
  const win = await getOpenWindow(env.DB);
  if (!win) throw new HttpError(409, '转会窗口没开，退约也办不了');
  // v6.49.0 运营时刻表：冠名退约属消费中心（退约是收口动作，但仍在消费中心的口径里）
  await assertOpOpen(env.DB, 'consumption');
  const row = await getActiveNaming(env.DB, clubId);
  if (!row) throw new HttpError(404, '该队没有生效冠名');
  const params = await loadNamingParams(env.DB);
  const remaining = Math.max(0, row.windows_remaining - 1);
  const penalty = terminatePenaltyOf(params, row.windows_remaining, row.fee_per_window);
  const statements = [
    env.DB
      .prepare(
        `UPDATE naming_contracts SET status = 'terminated', ended_season = ?, ended_window = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'active'`,
      )
      .bind(win.season, win.windowSeq, row.id),
  ];
  if (penalty > 0) {
    statements.push(
      ...ledgerMovement(env.DB, {
        clubId,
        delta: -penalty,
        kind: 'naming_penalty',
        refType: 'naming',
        refId: row.id,
        memo: `提前解约赔款（${row.brand}，剩 ${remaining} 窗 × ${row.fee_per_window}M × ${params.terminatePenalty}）`,
        idempotent: false, // 玩家主动操作可重复发生，不开查重闸
      }),
    );
  }
  // 解约留痕：状态变更 + 赔款金额同批入审计（赔款为 0 时也留，状态变更本身要可追溯）
  statements.push(
    createAuditStatement(env.DB)({
      actor,
      action: 'naming_terminate',
      targetType: 'naming_contract',
      targetId: row.id,
      origin: 'user',
      before: { status: 'active', windowsRemaining: row.windows_remaining },
      after: { status: 'terminated', windowsRemaining: row.windows_remaining, penalty, remainingWindowsCharged: remaining },
    }),
  );
  const outs = await env.DB.batch(statements);
  if ((outs[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '冠名状态刚被并发改动，请重试');
  return { brand: row.brand, penalty, windowsRemaining: row.windows_remaining };
}

/** 窗末冠名结算语句（并入关窗批）：收租 + 剩余窗口递减 + 到期 + 对赌奖金，幂等靠账本闸。
 *  attendRate/fansGrowth 由调用方传入（windowHomeStatements 循环里现成）。
 *  opts.feeFactor = fee_mod 经营信号乘数（v6.12.0 D3，连乘积已终钳；缺省 1 与原行为逐字一致）。
 *  opts.counts = 本窗结算样本（v6.51.0 批 3，loadNamingWindowCounts 的产出）：对赌 v2 条款评估用；
 *  缺省 ⇒ 依赖样本的条款判不达并记 no_data（不阻塞、不倒扣）。
 *  对赌双路（v6.51.0）：bet_terms 非空且可解析（v2）→ 逐条评估，每项命中各发一笔 naming_bonus
 *  （每项 = 0.25 × 底价，两项全达 0.5 × 底价 ⇒ 单窗支出 ∈ [0.70, 1.20] × 底价、合同期 ≤ 4.80 × 底价，
 *  G2/G3 由构造保证）；bet_terms 为空串/旧格式 → 旧绝对线（bet_attend 0.8 / bet_fans 3%）一次付全额。 */
export function windowNamingStatements(
  env: Env,
  row: NamingContractRow,
  season: number,
  windowSeq: number,
  attendRate: number,
  fansGrowth: number,
  opts: { feeFactor?: number; counts?: NamingWindowCounts } = {},
): ReturnType<Env['DB']['prepare']>[] {
  const refId = season * 100 + windowSeq;
  const feeFactor = opts.feeFactor ?? 1;
  const fee = Math.round(row.fee_per_window * feeFactor * 1000) / 1000;
  const feeNote = feeFactor !== 1 ? `，经营信号：冠名费 ×${feeFactor}` : '';
  const statements = [
    ...ledgerMovement(env.DB, {
      clubId: row.club_id,
      delta: fee,
      kind: 'naming_fee',
      refType: 'window',
      refId,
      memo: `${row.brand} 冠名费（${row.pkg_name}套餐，剩 ${row.windows_remaining} 窗${feeNote}）`,
    }),
    env.DB
      .prepare(
        `UPDATE naming_contracts
         SET windows_remaining = windows_remaining - 1,
             status = CASE WHEN windows_remaining - 1 <= 0 THEN 'expired' ELSE status END,
             ended_season = CASE WHEN windows_remaining - 1 <= 0 THEN ? ELSE ended_season END,
             ended_window = CASE WHEN windows_remaining - 1 <= 0 THEN ? ELSE ended_window END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'active'`,
      )
      .bind(season, windowSeq, row.id),
  ];
  // 对赌奖金双路（v6.51.0 批 3）
  const terms = row.package_no === 3 ? parseBetTerms(row.bet_terms) : null;
  if (terms) {
    // 新路：抽签条款逐条评估。每项 = min(0.25, 1 ÷ windows_total) × 底价（对赌套餐 4 窗 ⇒ 仍是 0.25，两项全达 0.5）——
    // 单窗支出 = 0.70 + 命中数 × 每项 ≤ 1.20 × 底价（G2）；合同期奖金 ≤ 2 × 每项 × windows_total ≤ 2.0 × 底价（G3）。
    // 每项比率的 1 ÷ windows_total 上界让 G2/G3 成为硬钳：管理员改 naming_params.bet.windows 也不会破界。
    const perItemRate = Math.min(0.25, 1 / Math.max(1, row.windows_total));
    const perItem = Math.round(row.base_fee * perItemRate * 1000) / 1000;
    if (terms.items.length === 0) {
      // G1c 结算侧：v2 快照无条款 ⇒ 零奖金不倒扣，留一行 no_data（绝不回退旧绝对线）
      statements.push(
        createAuditStatement(env.DB)({
          actor: null,
          action: 'naming_bet_check',
          targetType: 'naming_contract',
          targetId: row.id,
          origin: 'cron_tick',
          after: { brand: row.brand, reason: 'no_data', items: 0, note: `${row.brand} 对赌：快照无条款（no_data），本窗不发奖金` },
        }),
      );
    }
    for (const item of terms.items) {
      const { actual, hit } = evaluateBetItem(item, opts.counts ?? null, attendRate, fansGrowth);
      const label = BET_LABELS[item.m];
      const actualNote = actual === null ? '无数据' : String(Math.round(actual * 1000) / 1000);
      // G5 审计行：每条条款一条（含 guard 标记与实况/线），钱与留痕同批；
      // 样本缺失（无主场 / 拿不到 counts）记 reason='no_data'，与「够数但不达线」区分开
      statements.push(
        createAuditStatement(env.DB)({
          actor: null,
          action: 'naming_bet_check',
          targetType: 'naming_contract',
          targetId: row.id,
          origin: 'cron_tick',
          after: {
            brand: row.brand,
            metric: item.m,
            label,
            actual: actual === null ? null : Math.round(actual * 1000) / 1000,
            threshold: item.threshold,
            baseline: item.baseline,
            nBase: item.nBase,
            guard: item.guard,
            reason: actual === null ? 'no_data' : '',
            hit,
            note: `${row.brand} 对赌 ${label}：实 ${actualNote} / 线 ${item.threshold}（guard: ${item.guard || 'none'}）`,
          },
        }),
      );
      if (hit && perItem > 0) {
        statements.push(
          ...ledgerMovement(env.DB, {
            clubId: row.club_id,
            delta: perItem,
            kind: 'naming_bonus',
            // ref_type 带指标名：账本幂等闸按 (club, kind, ref_type, ref_id) 查重，
            // 两条款同窗各发一笔不能共用 ref_type='window'（会互相闸掉第二笔）
            refType: `bet_${item.m}`,
            refId,
            memo: `${row.brand} 对赌奖金（${label} 达线：实 ${actualNote} / 线 ${item.threshold}）`,
          }),
        );
      }
    }
  } else if (
    // 旧路（bet_terms 空串 / 旧格式）：上座率或死忠增长率任一达线发全额
    // （formula.py bet_bonus_due：纯流水，随账本闸幂等）——老合同不得抛错，行为逐字不变
    row.package_no === 3 &&
    row.bonus_amount > 0 &&
    (attendRate >= (row.bet_attend ?? Infinity) || fansGrowth >= (row.bet_fans ?? Infinity))
  ) {
    statements.push(
      ...ledgerMovement(env.DB, {
        clubId: row.club_id,
        delta: row.bonus_amount,
        kind: 'naming_bonus',
        refType: 'window',
        refId,
        memo: `${row.brand} 对赌奖金（上座/死忠达线）`,
      }),
    );
  }
  return statements;
}

export interface HeatRules {
  winStreak: number;
  slump: number;
  clampLow: number;
  clampHigh: number;
  champion: number;
  /** v6.14.0 C3：招商轮签约成交 +deal / 整轮无人递价被冷落 −ignored（插件 market_heat_config deal/ignored 同值） */
  deal: number;
  ignored: number;
}

/** 热度规则（config market_heat_rules，JSON）：缺行或缺字段回默认（插件 market_heat_config 出厂值）。
 *  champion = 赛季冠军品牌热度加成（v6.13.0 C2，插件 champion_bonuses 口径 0.10）。 */
export async function loadHeatRules(db: Env['DB']): Promise<HeatRules> {
  const defaults: HeatRules = { winStreak: 0.03, slump: 0.02, clampLow: 0.5, clampHigh: 1.5, champion: 0.1, deal: 0.02, ignored: -0.03 };
  const config = createConfigService(db);
  const r = await config.getJson<Partial<HeatRules>>('market_heat_rules');
  if (!r || typeof r !== 'object') return defaults;
  return {
    winStreak: finiteOr(r.winStreak, defaults.winStreak),
    slump: finiteOr(r.slump, defaults.slump),
    clampLow: finiteOr(r.clampLow, defaults.clampLow),
    clampHigh: finiteOr(r.clampHigh, defaults.clampHigh),
    champion: finiteOr(r.champion, defaults.champion),
    deal: finiteOr(r.deal, defaults.deal),
    ignored: finiteOr(r.ignored, defaults.ignored),
  };
}

/** 近 3 场有效结果的胜负记号（**弃权按弃权方判负**——walkover_side 记的是弃权方，见 core/walkover.ts；
 *  点球决胜按平计——与 formPtsOf 战绩口径一致；无效行不计名额）。全胜 +winStreak / 全败 −slump / 其余（含不足 3 场）不动。 */
export function brandHeatDelta(
  rows: {
    home_team_id: number | null;
    away_team_id: number | null;
    score_home: number | null;
    score_away: number | null;
    walkover_side: string | null;
  }[],
  tourTeamId: number,
  rules: HeatRules,
): number | null {
  const marks: ('W' | 'D' | 'L')[] = [];
  for (const r of rows) {
    if (marks.length >= 3) break;
    if (r.home_team_id === null || r.away_team_id === null) continue;
    if (r.walkover_side === 'home' || r.walkover_side === 'away' || r.walkover_side === 'both') {
      const ours = r.home_team_id === tourTeamId ? 'home' : 'away';
      marks.push(walkoverLoser(r.walkover_side, ours) ? 'L' : 'W');
      continue;
    }
    if (r.score_home === null || r.score_away === null) continue;
    if (r.score_home === r.score_away) {
      marks.push('D');
      continue;
    }
    const winnerId = r.score_home > r.score_away ? r.home_team_id : r.away_team_id;
    marks.push(winnerId === tourTeamId ? 'W' : 'L');
  }
  if (marks.length < 3) return null;
  if (marks.every((m) => m === 'W')) return rules.winStreak;
  if (marks.every((m) => m === 'L')) return -rules.slump;
  return null;
}

/** 窗末品牌热度调整语句（并入关窗批，插件 evolve_sentiment 口径）：按本队近 3 场赛果调 brand_pool.heat。
 *  热度变化在 SQL 侧钳制累加（MAX/MIN 两参形式），同品牌多队同窗调整互不覆盖；
 *  品牌被弃用后不再调整（status 守卫）。合同费用是签约快照，热度只影响后续报价/续约。
 *  幂等：无独立闸，靠关窗批第一句窗口状态原子闸（失败整批回滚）——与 fans UPDATE 同机制。 */
export async function windowBrandHeatStatement(
  env: Env,
  row: NamingContractRow,
  tourTeamId: number,
): Promise<ReturnType<Env['DB']['prepare']> | null> {
  const rules = await loadHeatRules(env.DB);
  // 取近 9 行而非 3 行：弃权/点球以外的脏行（队 id 缺失、比分为空）不计名额，要留缓冲才凑得出近 3 场
  const { results } = await env.DB.prepare(
    `SELECT home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side
     FROM result_confirmations WHERE (home_team_id = ? OR away_team_id = ?)
     ORDER BY id DESC LIMIT 9`,
  )
    .bind(tourTeamId, tourTeamId)
    .all();
  const delta = brandHeatDelta(results as Parameters<typeof brandHeatDelta>[0], tourTeamId, rules);
  if (delta === null) return null;
  return env.DB
    .prepare(`UPDATE brand_pool SET heat = MAX(?, MIN(?, ROUND(heat + ?, 3))) WHERE brand = ? AND status = 'adopted'`)
    .bind(rules.clampLow, rules.clampHigh, delta, row.brand);
}

// ─── v6.13.0 C2 档位性格与情绪演化 ───────────────────────────────────────────

export type BrandTier = '头部' | '新兴' | '口碑';
export const BRAND_TIERS: BrandTier[] = ['头部', '新兴', '口碑'];

export interface TierProfile {
  satisfyFloor: number;
  goodAttend: number;
  badAttend: number;
  penaltyMult: number;
  attendBuff: number;
  fansBuff: number;
}

export interface TierRules {
  topSeatRatio: number;
  emergingSlots: number;
  topHeatFloor: number;
  emergingHeatFloor: number;
}

export interface SatisfyConfig {
  attendWeight: number;
  resultWeight: number;
  lineBuffer: number;
  championSatisfaction: number;
  /** 招商性格偏好加成（v6.51.0 批 3）：每命中 1 个 prefer 标签 +preferBonus 满意度，整档封顶 preferBonusCap */
  preferBonus: number;
  preferBonusCap: number;
}

// 出厂值 = 插件 _conf_schema market_tier_profiles / market_satisfy_config 同值
const DEFAULT_TIER_PROFILES: Record<BrandTier, TierProfile> = {
  头部: { satisfyFloor: 0.7, goodAttend: 0.95, badAttend: 0.6, penaltyMult: 1.5, attendBuff: 0.02, fansBuff: 0 },
  新兴: { satisfyFloor: 0.6, goodAttend: 0.9, badAttend: 0.6, penaltyMult: 1.0, attendBuff: 0, fansBuff: 0 },
  口碑: { satisfyFloor: 0.5, goodAttend: 0.85, badAttend: 0.5, penaltyMult: 0.75, attendBuff: 0, fansBuff: 0.005 },
};
const DEFAULT_TIER_RULES: TierRules = { topSeatRatio: 8, emergingSlots: 2, topHeatFloor: 1.0, emergingHeatFloor: 0.9 };
const DEFAULT_SATISFY: SatisfyConfig = {
  attendWeight: 0.5,
  resultWeight: 0.3,
  lineBuffer: 0.05,
  championSatisfaction: 0.1,
  preferBonus: 0.02,
  preferBonusCap: 0.04,
};

const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function parseProfile(raw: unknown, fallback: TierProfile): TierProfile {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  return {
    satisfyFloor: finiteOr(r.satisfyFloor, fallback.satisfyFloor),
    goodAttend: finiteOr(r.goodAttend, fallback.goodAttend),
    badAttend: finiteOr(r.badAttend, fallback.badAttend),
    penaltyMult: finiteOr(r.penaltyMult, fallback.penaltyMult),
    attendBuff: finiteOr(r.attendBuff, fallback.attendBuff),
    fansBuff: finiteOr(r.fansBuff, fallback.fansBuff),
  };
}

/** 三档性格参数（config market_tier_profiles，JSON）：逐档逐字段兜底，坏值不炸关窗批。 */
export async function loadTierProfiles(db: Env['DB']): Promise<Record<BrandTier, TierProfile>> {
  const config = createConfigService(db);
  const raw = await config.getJson<Record<string, unknown>>('market_tier_profiles');
  return {
    头部: parseProfile(raw?.['头部'], DEFAULT_TIER_PROFILES.头部),
    新兴: parseProfile(raw?.['新兴'], DEFAULT_TIER_PROFILES.新兴),
    口碑: parseProfile(raw?.['口碑'], DEFAULT_TIER_PROFILES.口碑),
  };
}

/** 校准与名额规则（config market_tier_rules，JSON）：整段非法回默认。 */
export async function loadTierRules(db: Env['DB']): Promise<TierRules> {
  const config = createConfigService(db);
  const r = await config.getJson<Partial<TierRules>>('market_tier_rules');
  if (!r || typeof r !== 'object') return DEFAULT_TIER_RULES;
  return {
    topSeatRatio: finiteOr(r.topSeatRatio, DEFAULT_TIER_RULES.topSeatRatio),
    emergingSlots: finiteOr(r.emergingSlots, DEFAULT_TIER_RULES.emergingSlots),
    topHeatFloor: finiteOr(r.topHeatFloor, DEFAULT_TIER_RULES.topHeatFloor),
    emergingHeatFloor: finiteOr(r.emergingHeatFloor, DEFAULT_TIER_RULES.emergingHeatFloor),
  };
}

/** 情绪演化两信号权重（config market_satisfy_config，JSON）：整段非法回默认。
 *  无 eventWeight——事件情绪效果 v6.12.0 起即时落库，不进演化（避免同一笔事件记两次账，Q2 裁决）。 */
export async function loadSatisfyConfig(db: Env['DB']): Promise<SatisfyConfig> {
  const config = createConfigService(db);
  const r = await config.getJson<Partial<SatisfyConfig>>('market_satisfy_config');
  if (!r || typeof r !== 'object') return DEFAULT_SATISFY;
  return {
    attendWeight: finiteOr(r.attendWeight, DEFAULT_SATISFY.attendWeight),
    resultWeight: finiteOr(r.resultWeight, DEFAULT_SATISFY.resultWeight),
    lineBuffer: finiteOr(r.lineBuffer, DEFAULT_SATISFY.lineBuffer),
    championSatisfaction: finiteOr(r.championSatisfaction, DEFAULT_SATISFY.championSatisfaction),
    preferBonus: finiteOr(r.preferBonus, DEFAULT_SATISFY.preferBonus),
    preferBonusCap: finiteOr(r.preferBonusCap, DEFAULT_SATISFY.preferBonusCap),
  };
}

/** 档位签约名额（按品牌实时档位计）：头部 1 队、新兴 emergingSlots 队、口碑不限（null）。 */
export function tierQuotaOf(tier: string, rules: TierRules): number | null {
  if (tier === '头部') return 1;
  if (tier === '新兴') return Math.max(1, Math.trunc(rules.emergingSlots));
  return null;
}

export interface TierRecalibration {
  statements: ReturnType<Env['DB']['prepare']>[];
  changed: number;
  top: number;
  emerging: number;
  wordOfMouth: number;
}

/**
 * 档位自动校准语句（关窗批用，插件 recalibrate_tiers 口径 + 头部准入下限裁决）：
 * 热度降序前 ceil(俱乐部数/topSeatRatio) 家且 heat ≥ topHeatFloor → 头部；heat ≥ emergingHeatFloor → 新兴；其余口碑。
 * 够格几家算几家——头部可空缺（准入下限挡住弱品牌，全池低迷时不注水凑数）。
 * tier_locked=1 的品牌跳过（管理端锁档）；已处在目标档位的品牌不写行（省写配额）。
 */
export async function recalibrateTierStatements(db: Env['DB']): Promise<TierRecalibration> {
  const rules = await loadTierRules(db);
  const clubs = await db.prepare('SELECT COUNT(*) AS n FROM clubs').first<{ n: number }>();
  const topK = Math.max(1, Math.ceil((clubs?.n ?? 0) / Math.max(1, rules.topSeatRatio)));
  const brands = (
    await db
      .prepare(`SELECT id, heat, tier FROM brand_pool WHERE status = 'adopted' AND tier_locked = 0 ORDER BY heat DESC, id`)
      .all<{ id: number; heat: number; tier: string }>()
  ).results;
  const topIds: number[] = [];
  const emergingIds: number[] = [];
  const wordIds: number[] = [];
  let top = 0;
  let emerging = 0;
  let wordOfMouth = 0;
  brands.forEach((b, i) => {
    const target =
      i < topK && b.heat >= rules.topHeatFloor ? '头部' : b.heat >= rules.emergingHeatFloor ? '新兴' : '口碑';
    if (target === '头部') top++;
    else if (target === '新兴') emerging++;
    else wordOfMouth++;
    if (target === b.tier) return;
    (target === '头部' ? topIds : target === '新兴' ? emergingIds : wordIds).push(b.id);
  });
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  const push = (tier: BrandTier, ids: number[]) => {
    if (ids.length === 0) return;
    statements.push(
      db.prepare(`UPDATE brand_pool SET tier = ? WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(tier, ...ids),
    );
  };
  push('头部', topIds);
  push('新兴', emergingIds);
  push('口碑', wordIds);
  return {
    statements,
    changed: topIds.length + emergingIds.length + wordIds.length,
    top,
    emerging,
    wordOfMouth,
  };
}

/** 窗内胜率（战绩信号输入，formPtsOf 同口径：点球按平、**弃权按弃权方判负**、双弃权双方各记一负）；无有效场次回 null。 */
export function windowWinRate(
  rows: {
    home_team_id: number | null;
    away_team_id: number | null;
    score_home: number | null;
    score_away: number | null;
    walkover_side: string | null;
  }[],
  tourTeamId: number,
): number | null {
  let wins = 0;
  let played = 0;
  for (const r of rows) {
    if (r.home_team_id === null || r.away_team_id === null) continue;
    let won: boolean | null = null;
    let drew = false;
    if (r.walkover_side === 'home' || r.walkover_side === 'away' || r.walkover_side === 'both') {
      won = !walkoverLoser(r.walkover_side, r.home_team_id === tourTeamId ? 'home' : 'away');
    } else if (r.score_home !== null && r.score_away !== null) {
      if (r.score_home === r.score_away) drew = true;
      else won = (r.score_home > r.score_away ? r.home_team_id : r.away_team_id) === tourTeamId;
    }
    if (won === null && !drew) continue;
    played++;
    if (won) wins++;
  }
  return played > 0 ? wins / played : null;
}

/** 两信号步进（纯函数，插件 evolve_sentiment 的 delta 公式、事件项缺省）：负向按档位 penaltyMult 放大。 */
export function satisfactionDelta(cfg: SatisfyConfig, sAttend: number, sResult: number, penaltyMult: number): number {
  let delta = cfg.attendWeight * cfg.lineBuffer * sAttend + cfg.resultWeight * cfg.lineBuffer * sResult;
  if (delta < 0) delta *= penaltyMult;
  return delta;
}

/** 满意度落库值：钳 [0,2] round3（事件效果与演化共用同一钳口）。 */
export function clampSatisfaction(v: number): number {
  return Math.round(Math.max(0, Math.min(2, v)) * 1000) / 1000;
}

export interface SatisfactionReport {
  clubId: number;
  contractId: number;
  brand: string;
  from: number;
  to: number;
  delta: number;
  attendSignal: number;
  resultSignal: number;
  terminated: boolean;
}

/**
 * 单队情绪演化语句（关窗批用，插件 evolve_sentiment 两信号口径）：
 * 上座信号由调用方传入（该队本窗有无主场比赛只有它知道——无场次中性 0，不借中性上座率 1.0 白拿 +1）；
 * 战绩信号按窗内全部场次胜率现算（点球按平、弃权按弃权方判负，与 formPtsOf/brandHeatDelta 同口径）。
 * 演化后跌破品牌当前档位地板 → 品牌主动解约（terminated + windows_remaining=0，无赔偿），解约语句同批。
 * preferHits（v6.51.0 批 3）= 品牌 prefer 标签与该队现状信号的命中数，加成 min(hits × preferBonus, cap)
 * 并入 delta（在 penaltyMult 放大之前并入——是正向项，不受负向放大影响）；0 = 现状逐字不变。
 * 幂等：无独立闸，靠关窗批第一句窗口状态原子闸（失败整批回滚）——与 fans UPDATE 同机制。
 */
export async function evolveSatisfactionForClub(
  env: Env,
  naming: NamingContractRow,
  tourTeamId: number | undefined,
  season: number,
  windowSeq: number,
  sAttend: number,
  profile: TierProfile,
  cfg: SatisfyConfig,
  preferHits = 0,
): Promise<{ statements: ReturnType<Env['DB']['prepare']>[]; report: SatisfactionReport }> {
  let sResult = 0;
  if (tourTeamId !== undefined) {
    const { results } = await env.DB
      .prepare(
        `SELECT home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side
         FROM result_confirmations WHERE (home_team_id = ? OR away_team_id = ?) AND season = ? AND window_seq = ?`,
      )
      .bind(tourTeamId, tourTeamId, season, windowSeq)
      .all();
    const rate = windowWinRate(
      results as Parameters<typeof windowWinRate>[0],
      tourTeamId,
    );
    if (rate !== null) {
      sResult = rate >= 0.5 + cfg.lineBuffer ? 1 : rate <= 0.5 - cfg.lineBuffer ? -1 : 0;
    }
  }
  // 招商性格偏好加成（v6.51.0 批 3）：正向并入，再与两信号项一起过负向放大闸
  const preferAdd = preferHits > 0 ? Math.min(preferHits * cfg.preferBonus, cfg.preferBonusCap) : 0;
  const delta = satisfactionDelta(cfg, sAttend, sResult, profile.penaltyMult) + preferAdd;
  const to = clampSatisfaction(naming.satisfaction + delta);
  const nowSqlStr = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const statements: ReturnType<Env['DB']['prepare']>[] = [
    env.DB
      .prepare(`UPDATE naming_contracts SET satisfaction = ?, updated_at = ${nowSqlStr} WHERE id = ? AND status = 'active'`)
      .bind(to, naming.id),
  ];
  const report: SatisfactionReport = {
    clubId: naming.club_id,
    contractId: naming.id,
    brand: naming.brand,
    from: naming.satisfaction,
    to,
    delta,
    attendSignal: sAttend,
    resultSignal: sResult,
    terminated: false,
  };
  if (to < profile.satisfyFloor) {
    statements.push(
      env.DB
        .prepare(
          `UPDATE naming_contracts SET status = 'terminated', windows_remaining = 0, ended_season = ?, ended_window = ?,
           updated_at = ${nowSqlStr} WHERE id = ? AND status = 'active'`,
        )
        .bind(season, windowSeq, naming.id),
    );
    report.terminated = true;
  }
  return { statements, report };
}
