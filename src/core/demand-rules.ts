// 闹涨薪（球员主动要求续约/涨薪）纯函数层（v6.54.0，设计文档
// docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md rev20）：
//   §5.1  要求倾向分 score → 单窗概率 p = clamp(0.04 + 0.84*score^1.3, 0.04, 0.60)；
//         生成闸 = seededUnit([season, window, player], 20) < p；超 6 条/队时 PPS 加权无放回抽样收口。
//   §5.2  普通涨幅 r = clamp(0.80×gap, 0.15, 0.50)；§5.4.3 通胀涨幅 r = clamp(gap, 0.30, 0.60)、rc_raise 顶格 0.25。
//   §5.3  还价判定与现有谈判同式（successRate + 每轮期望衰减 0.95），roll 钉 seededUnit([demand_id, round], 21)。
//   §5.4  拒绝后果的累计终局计数：段 = 球员 × 俱乐部 × 当前段（signed_at 即段起点，amendment 不动它、
//         换队重锚、买回恢复快照 ⇒ 同队续约不清零、换队/回原队都算新段）；expired 计入、挂牌驱赶不计；
//         段内第 2 次（含）终局升档走直拒三件套。
//   §5.5  rc_floor 取整链；§5.3/§6 expires_at = min(生成 + 3 日, 关窗)。
// 本模块无 IO；随机源统一走 core/seeded.ts 的 seededUnit（确定性契约）。时间一律 epoch 毫秒，
// 由调用方与 DB 的 ISO 文本互转。金额单位 m，两位小数走 market-rules.round2。
import { round2 } from './market-rules.ts';
import { seededUnit } from './seeded.ts';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// 常量（口径钉死处全部具名，测试与 worker 共用）
// ---------------------------------------------------------------------------

/** 生成硬门槛：落差 ≥ 8%（§5.1），低于它球员不开口 */
export const DEMAND_GAP_MIN = 0.08;
/** 3 日截止（§5.3/§14.1 #8），且不晚于窗口关闭 */
export const DEMAND_TTL_MS = 3 * 24 * 3600_000;
/** 还价最多 3 轮（与 maxAttempts=3 一致，§5.3） */
export const DEMAND_MAX_ROUNDS = 3;
/** 每俱乐部每窗硬上限 6 条（§5.1） */
export const DEMANDS_PER_CLUB = 6;
/** wageMax（谈判上下文默认值，§5.2 target 封顶之一；可被参数覆盖） */
export const DEMAND_WAGE_MAX = 20;
/** 生成闸的 draw 位（§5.1：seededUnit([season, windowSeq, player_id], 20) < p） */
export const DEMAND_GATE_DRAW = 20;
/** PPS 抽样与还价判定共用的 draw 位（§5.1 PPS key / §6 还价判定） */
export const DEMAND_PPS_DRAW = 21;
export const DEMAND_COUNTER_DRAW = 21;
/** 通胀公式 rc_raise 顶格（§5.4.3） */
export const DEMAND_INFLATION_RC_RAISE = 0.25;

export type DemandRaiseMode = 'normal' | 'inflation';

// ---------------------------------------------------------------------------
// §5.1 要求倾向分与概率
// ---------------------------------------------------------------------------

/** 近 10 场表现观测；null = 无 growth_events 数据（新援/替补），按中性值处理 */
export interface DemandRecentForm {
  /** 近 10 场场均评分 */
  avgRating10: number;
  /** 近 10 场出场次数（performanceScore 与 appsScore 共用同一口径） */
  apps10: number;
}

export interface DemandScoreInput {
  wage: number;
  /** 市场预期（expectedWage 按 RC 派生，worker 侧算好传入） */
  expected: number;
  ca: number;
  pa: number;
  age: number;
  isFutureStar: boolean;
  agentTier: 1 | 2 | 3;
  /** 是否注册 first_team（registrations.squad='first_team'） */
  firstTeam: boolean;
  recent: DemandRecentForm | null;
  /** 队内 CA 升序排名（1 起，只数 first_team） */
  caRankInClub: number;
  nFirstTeam: number;
  /** 位置组（GK/DEF/MID/FWD）内 CA 排名与组内 first_team 人数 */
  caRankInPosition: number;
  nPosition: number;
  /** 本队 active 合同工资中位数；null = 无数据 → valueScore 中性 0.5 */
  clubWageMedian: number | null;
}

export interface DemandScoreBreakdown {
  /** 原始落差（expected−wage)/max(wage,0.01)，未钳——通胀公式与 8% 门槛都用它 */
  gap: number;
  gapScore: number;
  performanceScore: number;
  appsScore: number;
  rankScore: number;
  posRankScore: number;
  valueScore: number;
  coreScore: number;
  potentialScore: number;
  agentScore: number;
  score: number;
  p: number;
}

/** 凸曲线概率（§5.1.1 生产校准）：p = clamp(0.04 + 0.84*score^1.3, 0.04, 0.60)；score 负值按 0 防 NaN */
export function demandProbability(score: number): number {
  return clamp(0.04 + 0.84 * Math.pow(Math.max(score, 0), 1.3), 0.04, 0.6);
}

/** 原始落差：gap = (expected − wage) / max(wage, 0.01)（§5.1） */
export function demandGap(wage: number, expected: number): number {
  return (expected - wage) / Math.max(wage, 0.01);
}

/** 生成资格的本地部分（§5.1 硬门槛）：wage>0、expected≥wage、gap≥8%；
 * 挂牌/在途谈判/pending 等涉及 DB 的门槛由 worker 侧补齐。 */
export function meetsDemandGate(wage: number, expected: number): boolean {
  return wage > 0 && expected >= wage && demandGap(wage, expected) >= DEMAND_GAP_MIN;
}

/** 要求倾向分（§5.1 公式逐条落地，权重 0.30/0.25/0.20/0.15/0.10 合计 1） */
export function demandScore(input: DemandScoreInput): DemandScoreBreakdown {
  const gap = demandGap(input.wage, input.expected);
  const gapScore = clamp(gap, 0, 1);

  // 近 10 场缺失 → performanceScore 中性 0.4、appsScore 中性 0.3（first_team 才有；不把新援永久排除）
  let performanceScore: number;
  let appsScore: number;
  if (input.recent === null) {
    performanceScore = 0.4;
    appsScore = input.firstTeam ? 0.3 : 0;
  } else {
    performanceScore =
      clamp((input.recent.avgRating10 - 6.0) / 3.0, 0, 1) * 0.7 + clamp(input.recent.apps10 / 10, 0, 1) * 0.3;
    appsScore = input.firstTeam ? clamp(input.recent.apps10 / 10, 0, 1) : 0;
  }

  // 排名分：0.15 底（排名 >12 仍非零）；除数 max(n−1, 1) 防 1 人队除零
  const rankScore = input.firstTeam
    ? clamp(1 - (input.caRankInClub - 1) / Math.max(input.nFirstTeam - 1, 1), 0.15, 1)
    : 0.15;
  const posRankScore = input.firstTeam
    ? clamp(1 - (input.caRankInPosition - 1) / Math.max(input.nPosition - 1, 1), 0.15, 1)
    : 0.15;

  const valueScore =
    input.clubWageMedian === null ? 0.5 : clamp(input.wage / Math.max(input.clubWageMedian, 0.01), 0, 1);

  const coreScore = 0.4 * appsScore + 0.25 * rankScore + 0.2 * posRankScore + 0.15 * valueScore;

  const potentialScore =
    clamp((input.pa - input.ca) / Math.max(input.pa, 1), 0, 1) * 0.6 +
    (input.age <= 23 ? 0.25 : input.age <= 25 ? 0.15 : 0) +
    (input.isFutureStar ? 0.15 : 0);

  const agentScore = (input.agentTier - 1) / 2; // 1/2/3 → 0/0.5/1

  const score =
    0.3 * gapScore + 0.25 * performanceScore + 0.2 * coreScore + 0.15 * potentialScore + 0.1 * agentScore;

  return {
    gap,
    gapScore,
    performanceScore,
    appsScore,
    rankScore,
    posRankScore,
    valueScore,
    coreScore,
    potentialScore,
    agentScore,
    score,
    p: demandProbability(score),
  };
}

// ---------------------------------------------------------------------------
// §5.1 生成闸与 PPS 加权抽样
// ---------------------------------------------------------------------------

/** 生成闸的确定性掷点（同 (赛季, 窗, 球员) 恒定，不随请求变化） */
export function demandGateRoll(season: number, windowSeq: number, playerId: number): number {
  return seededUnit([season, windowSeq, playerId], DEMAND_GATE_DRAW);
}

/** 本窗该球员是否开口：确定性闸 roll < p（§5.1「确定性」行） */
export function demandFires(season: number, windowSeq: number, playerId: number, p: number): boolean {
  return demandGateRoll(season, windowSeq, playerId) < p;
}

/**
 * PPS 加权无放回抽样（Efraimidis-Spirakis，§5.1）：key = −ln(u)/p，u = 1 − seededUnit([season, window, player], 21)，
 * 取 key 最小的 cap 条；候选 ≤ cap 全取。**不是按 p 排序硬取 top-6**——高 p 入选率更高，低 p 有非零机会。
 * p ≤ 0 的候选 key = +∞（永不中）。返回按 key 升序的原候选对象。
 */
export function ppsPickDemands<T extends { playerId: number; p: number }>(
  candidates: T[],
  season: number,
  windowSeq: number,
  cap: number = DEMANDS_PER_CLUB,
): T[] {
  const keyed = candidates.map((candidate) => {
    const u = 1 - seededUnit([season, windowSeq, candidate.playerId], DEMAND_PPS_DRAW);
    const key = candidate.p > 0 ? -Math.log(u) / candidate.p : Number.POSITIVE_INFINITY;
    return { candidate, key };
  });
  keyed.sort((a, b) => a.key - b.key);
  return keyed.slice(0, Math.max(0, cap)).map((entry) => entry.candidate);
}

// ---------------------------------------------------------------------------
// §5.2 / §5.4.3 要求金额：普通与通胀两种涨幅形态
// ---------------------------------------------------------------------------

export interface DemandAmounts {
  /** 要求工资（接受即按成交值写 pending，target 是开场价） */
  target: number;
  /** raise_pct = round((target−wage)/wage, 4) */
  raisePct: number;
  /** 他的底线：还价低于它直接谈崩（§5.2） */
  floorWage: number;
}

/**
 * 要求金额（§5.2 普通 / §5.4.3 通胀）：
 *   普通   r = clamp(0.80×gap, 0.15, 0.50)——一次跨到落差的 80%，留尾巴下窗再提；
 *   通胀   r = clamp(gap, 0.30, 0.60)——被拒/谈崩过的一次开到市场预期（≤30% 两者同到顶）。
 * target = min(round2(wage×(1+r)), expected, wageMax=20)；target ≤ wage 不生成（返回 null）。
 * floor = max(round2(target×0.90), round2(wage×1.05))。
 */
export function computeDemandAmounts(args: {
  wage: number;
  expected: number;
  mode: DemandRaiseMode;
  wageMax?: number;
}): DemandAmounts | null {
  const wageMax = args.wageMax ?? DEMAND_WAGE_MAX;
  const gap = demandGap(args.wage, args.expected);
  const r =
    args.mode === 'normal' ? clamp(0.8 * gap, 0.15, 0.5) : clamp(gap, 0.3, 0.6);
  const target = Math.min(round2(args.wage * (1 + r)), args.expected, wageMax);
  if (!(target > args.wage)) return null; // target ≤ wage 不生成（§5.2）
  const raisePct = round4((target - args.wage) / args.wage);
  const floorWage = Math.max(round2(target * 0.9), round2(args.wage * 1.05));
  return { target, raisePct, floorWage };
}

// ---------------------------------------------------------------------------
// §5.5 最低违约金 floor（rc_floor）
// ---------------------------------------------------------------------------

/**
 * rc_floor 取整链（§5.5）：raw ≥ 5 按 2.5 为中点归低一档（5 档步进）、< 5 按 0.5 为中点归到整数；
 * 取整只向下偏，若结果低于 current_rc 则按 raw 所在档 +5 / +1，直到不低于当前 RC（「直到」= 循环兜底）。
 * 所有 rc_floor 都是整数。
 */
export function roundRcFloor(rawFloor: number, currentRc: number): number {
  const big = rawFloor >= 5;
  let result = big ? Math.ceil((rawFloor - 2.5) / 5) * 5 : Math.ceil(rawFloor - 0.5);
  const step = big ? 5 : 1;
  while (result < currentRc) result += step;
  return result;
}

/**
 * rc_floor 全公式（§5.5/§5.4.3/§8）：无 RC（≤0）退化 wage-only 返回 0；
 * 普通 rc_raise = clamp(0.05 + 0.20×score, 0.05, 0.25)，通胀顶格 0.25；
 * raw = max(current_rc, round2(current_rc×(1+rc_raise)))，再过取整链。
 */
export function computeRcFloor(args: { currentRc: number; score: number; mode: DemandRaiseMode }): number {
  if (!(args.currentRc > 0)) return 0;
  const raise =
    args.mode === 'inflation' ? DEMAND_INFLATION_RC_RAISE : clamp(0.05 + 0.2 * args.score, 0.05, 0.25);
  const raw = Math.max(args.currentRc, round2(args.currentRc * (1 + raise)));
  return roundRcFloor(raw, args.currentRc);
}

// ---------------------------------------------------------------------------
// §5.3 / §6 expires_at = min(生成 + 3 日, 关窗)
// ---------------------------------------------------------------------------

/** 生成即算死线：两者取早（epoch 毫秒；worker 落库转 ISO 文本，与 deadline_at 同格式） */
export function demandExpiresAt(createdAtMs: number, windowCloseMs: number): number {
  return Math.min(createdAtMs + DEMAND_TTL_MS, windowCloseMs);
}

// ---------------------------------------------------------------------------
// §5.3 多轮还价判定（与现有谈判同式，roll 钉 seededUnit([demand_id, round], 21)）
// ---------------------------------------------------------------------------

export type CounterVerdict =
  | 'accepted' // 成交（按 c 写 pending）
  | 'negotiating' // 未成、轮次未满 → 等经理下一轮
  | 'collapse' // 轮次内判定拒绝且已到第 3 轮 → 谈崩终局
  | 'lowball'; // 还价低于底线 → 视为拒绝整条要求（归 collapse 档）

export interface CounterJudgeInput {
  demandId: number;
  /** 本轮轮次（1 起） */
  round: number;
  /** 经理本轮还价 c */
  counter: number;
  targetWage: number;
  floorWage: number;
  /** 每轮期望衰减（与现有谈判 attemptDecay 同源，默认 0.95） */
  attemptDecay?: number;
  sigmoidSlope?: number;
  sigmoidMid?: number;
  /** 注入掷点（测试用）；缺省 seededUnit([demandId, round], 21) */
  roll?: number;
}

export interface CounterJudgeResult {
  verdict: CounterVerdict;
  /** accepted 时成交工资 = c；其余 null */
  acceptedWage: number | null;
  /** 本轮衰减后的球员期望（eff） */
  eff: number;
  /** 本轮判定所用成功率（accepted-direct/lowball 无意义，分别置 1/0） */
  p: number;
  roll: number;
}

/** 还价判定的确定性掷点（§6：seededUnit([demand_id, round], 21)） */
export function counterRoll(demandId: number, round: number): number {
  return seededUnit([demandId, round], DEMAND_COUNTER_DRAW);
}

// 与 src/worker/negotiation-secret.ts 同式（依赖方向 worker→core，不能反引）；
// tests/demand-rules.test.ts 对两份实现做逐值平价锁，漂移即红。
function successRateOf(offered: number, expected: number, slope: number, mid: number): number {
  if (offered <= 0 || expected <= 0) return 0;
  const ratio = offered / expected;
  if (ratio >= 1) return 1;
  return 1 / (1 + Math.exp((slope * (ratio - mid)) / 0.4));
}

/**
 * 一轮还价的即时判定（§5.3 状态机，POST /counter 同请求返回）：
 *   c ≥ target → accepted（按 c，不看 roll）；
 *   c < floor → lowball 终局（低于他的底线视为拒绝整条要求）；
 *   floor ≤ c < target → p = successRate(c, eff, −9, 0.8)，roll < p 接受；
 *     判拒且 round < 3 → negotiating；round ≥ 3 → collapse。
 * 期望衰减与现有谈判同式：round > 1 时 eff = round2(target×0.95)（attemptExpected 平移）。
 */
export function judgeCounter(input: CounterJudgeInput): CounterJudgeResult {
  const decay = input.attemptDecay ?? 0.95;
  const slope = input.sigmoidSlope ?? -9;
  const mid = input.sigmoidMid ?? 0.8;
  const roll = input.roll ?? counterRoll(input.demandId, input.round);
  // 期望衰减与现有谈判同式：round > 1 时 eff = round(base×decay, 2)——
  // 必须用 attemptExpected 的裸 Math.round（不带 market-rules.round2 的 EPSILON 兜底），
  // 否则 3.70×0.95=3.515 这类半分位会落到 3.52 而现有引擎是 3.51；tests 有平价锁。
  const eff = input.round > 1 ? Math.round(input.targetWage * decay * 100) / 100 : input.targetWage;
  const settle = (verdict: CounterVerdict, acceptedWage: number | null, p: number): CounterJudgeResult => ({
    verdict,
    acceptedWage,
    eff,
    p,
    roll,
  });
  if (input.counter >= input.targetWage) return settle('accepted', input.counter, 1);
  if (input.counter < input.floorWage) return settle('lowball', null, 0);
  const p = successRateOf(input.counter, eff, slope, mid);
  if (roll < p) return settle('accepted', input.counter, p);
  return input.round < DEMAND_MAX_ROUNDS ? settle('negotiating', null, p) : settle('collapse', null, p);
}

// ---------------------------------------------------------------------------
// §5.4.4-5 累计终局：段计数与升档判定
// ---------------------------------------------------------------------------

/** 终局种类：direct=经理明确放人；collapse=3 轮谈崩；lowball=还价低于底线；expired=放任过期 */
export type DemandFinalKind = 'direct' | 'collapse' | 'lowball' | 'expired';

/** 一条可计数的历史终局（worker 从 contract_demands 已终局行整理喂入） */
export interface DemandFinalRecord {
  kind: DemandFinalKind;
  /** 发生终局时球员效力的俱乐部（= contract_demands.club_id） */
  clubId: number;
  /** 终局时刻（epoch ms）：resolved_at；回原队补记的过期 = 买回时刻 */
  at: number;
  /** 挂牌驱动的自动过期（§11.2）= true：给出路的终局，不计入累计（§5.4.5） */
  byListing?: boolean;
}

/** 单条终局是否计入累计（rev20：rejected 任意档与 expired 恒计；挂牌驱赶的过期不计） */
export function countsTowardEscalation(kind: DemandFinalKind, byListing = false): boolean {
  if (kind === 'expired') return !byListing;
  return true;
}

/**
 * 段内可计数终局（§5.4.4 计数口径）：段 = 球员 × 俱乐部 × 当前段。
 *  - 只数 clubId 匹配的行：换队 → 新东家历史为空（清零），同队续约（amendment 不改俱乐部）→ 历史延续
 *    （堵「过期 → 便宜续约洗计数」循环）；
 *  - stintSinceMs = 当前段起点（= 合同 signed_at：换队分支重锚、amendment 不动、买回恢复快照；
 *    从未换队 = 首签时刻）。回原队时同一 club_id 的旧段行因 at < 段起点被排除 ⇒ 回原队 = 新段从零；
 *    买回补记的过期带 at = 买回时刻（≥ 段起点）⇒ 计入新段。
 *  - byListing 的过期不计。
 * 传入 null 表示无段起点可用（退化为只按 clubId 圈定）。
 */
export function segmentFinals<T extends DemandFinalRecord>(
  rows: readonly T[],
  clubId: number,
  stintSinceMs: number | null,
): T[] {
  return rows.filter(
    (row) =>
      row.clubId === clubId &&
      (stintSinceMs === null || row.at >= stintSinceMs) &&
      countsTowardEscalation(row.kind, row.byListing === true),
  );
}

/** 本次终局是否升档走直拒三件套：countedSoFar = 不含本次的段内累计；第 2 次（含）起升档（§5.4.4） */
export function escalatesToDirect(countedSoFar: number): boolean {
  return countedSoFar >= 1;
}
