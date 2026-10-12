#!/usr/bin/env node
// 生成 S9 天气订正批 SQL 工件（系数比 · 期望中性归一）。
//
// 缘起：平台与插件各有一套主场收入引擎，天气真源定为插件（用户裁决 2026-10-12）。
//   插件 v2.12.0 起「一次抽定天气 + 系数」并落库（matches.wx_coef），`/主场天气推送`
//   把权威 (weather, coef) 推到平台 match_weather（forecast_by='revenue-plugin'）。
//   但 S9 的 90 场平台侧**早已结算**：预检 B 段 match_weather 全库 0 行 ⇒ 平台从未有过
//   预报行，S9 全部是结算当时内联现掷（rollWeather + uniform(range)），
//   当时那一掷的类型落在 match_attendance.weather、系数则**无处可查**。本批就是把
//   这些历史账按插件权威输入收敛。
//
// 口径（为什么是「系数比 + 期望中性归一」而不是重算）：
//   平台结算值 A = floor(K × wx × ε)，K = 容量/球迷/战绩/影响力/设施… 的乘积，
//   ε = 扰动 uniform(0.97,1.03)（E[ε] = 1）。K 与 ε 都不可复现：K 依赖结算时点的
//   球场状态与近 3 场战绩，ε 是当时那一掷。但**期望**可复现：
//       E[A] = K × E[wx] = K × mid(range[type])
//   ⇒ K_隐 = A_old / mid(range[w_p])，把权威系数代回：
//       A_new = A_old × coef_a / mid(range[w_p])
//   即把平台那一掷的 (wx_p × ε_p) 归一到它的期望 mid(range[w_p])，再乘权威系数。
//   **不重放 K、不动球迷、不动球场**——K 不可复现时这是唯一自洽的做法
//   （重算 = 重新模拟，不是还原）。残余不确定度：|wx_p×ε_p − mid| ≤ 区间半宽 + 3%
//   ⇒ 单场相对偏差上界 ≈ 8%（晴 [1.05,1.25] 最宽）。两侧对账口径 = 输入一致 + 量级一致。
//
//   两侧 weather_ranges 逐字相同（平台 src/core/config.ts CONFIG_DEFAULTS.attendance_model
//   与插件 _conf_schema.json 默认值），且生产 config 表无 attendance_model 覆盖
//   （预检 I 段 0 行 ⇒ createConfigService 兜底默认，src/core/config.ts:335）⇒ 中点两边同源。
//
// 精确 / 估计两档（2026-10-12 取证发现，依据 ../prod-20261004-influence-recalc/plan.json）：
//   2026-10-04 的「影响力重算批」用**期望口径**（perturbation=1.0、sell_out_fill=0.992、
//   wx=区间中点、天气不重掷）逐场 UPDATE 了 S9 窗 1 的 78 行 match_attendance；它只 UPDATE
//   不 INSERT ⇒ created_at 保留结算当时的值（库里那批行的时间戳散在 09-20…10-03，看着像
//   多次实时结算，实为同一批重算）。该批 plan.json 逐场留了 factors.demand（= K0 × mid(w_p)，
//   未截断的原始需求）与 capacity ⇒ 对这 78 行可以**精确重算**（K0 不再需要猜）：
//       demand_new = factors.demand × coef_a / mid(w_p)
//       A_new = demand_new ≥ capacity ? floor(capacity × 0.992) : floor(demand_new)
//   残余只剩「新一掷的扰动与满座填充」——与 10-04 批同取期望（1.0 / 0.992）⇒ 同约定下可复算，
//   逐场偏差 ≤1 席（两次 floor 的取整差）。这一档在报告里记 tier=exact。
//   其余行（2026-10-07…10-11 实时结算的 12 行，不在 plan 里；弃权清零行另走只改天气）走下面的
//   系数比估计口径，残余上界 ≈ 8%（wx 未知）+ 3%（扰动未知）⇒ 记 tier=estimate。
//   两档的**收入都按平台算式重算**（票 = round2(上座/万 × 1.5)、商/播按设施等级），并先做
//   「用旧上座复算旧收入是否逐分相符」的守卫：不符（等级/配置漂移）即交人工，不进 SQL。
//
// 收入重算：按平台算式由新上座直接算（不再按比例缩放）——ticket = round2(A_new/万 × 1.5)、
//   commercial = round2(A_new/万 × 0.1 × 商设等级)、broadcast = round2(0.3 × 播设等级)，
//   合计 = round2(票+商+播)（src/core/attendance.ts computeMatchAttendance 同形）。
//   生产设施全 0 级（预检 E 段 36 行 level 全 0）⇒ 商/播恒为 0，合计 = 票。
//   delta = round2(新合计 − 旧合计) 走 manual_adjust 分录（ref_type='wx_fix'，锚在 memo 里）。
//
// 跳过口径（每条都进报告，不进 SQL）：
//   ① 无权威记录（插件未预报该场）——没有可收敛的输入，只报不动；
//   ② 上座 0 或收入合计 0（弃权场已被 2026-10-06 批清零）——只改 weather（类型不一致时），不动钱；
//   ③ 收入流水与上座行对不上（金额 ≠ round2(票+商+播)）——账实不符，交人工，不动；
//   ④ delta 绝对值 < 0.005——无实质变化。
//
// CLI：node gen-recalc-sql.ts [--authoritative=<file>] [--ts=<ISO>] [--out=<dir>]
//   默认读 authoritative.json（capture-authoritative.mjs 在插件推送后抓的 match_weather）。
//   没有它 → 只打印「推送前盘点 + 敏感度区间」并退出 0，不产出订正 SQL（工件保持只备不跑）。
//   --ts 固定工件时间戳：补生成后续分片时要传回已执行批的时间戳，否则 created_at 会变、
//   与已执行的 SQL 不再逐字一致（沿用 prod-20261006 批的纪律）。

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DEFAULTS } from '../../src/core/config.ts';
import { round2 } from '../../src/core/attendance.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = 'whl-club';
const KIND = 'manual_adjust';
const REF_TYPE = 'wx_fix';
const REF_TYPE_UNDO = 'wx_fix_undo';
/** 满座判定带：上座/容量 ≥ 该值即认为被容量截断（fill ∈ [0.985,0.999] 的下沿） */
const SOLD_OUT_BAND = 0.985;
/** 单条语句字节上限（exec-shards.mjs 单批 4000B，单条超过就永远切不出去） */
const MAX_STMT_BYTES = 3900;
/** exec-shards.mjs 拒绝含这些字符的语句（shell 元字符）；`|` 尤甚——故 memo 用 `·` 不用 `|` */
const FORBIDDEN = /["%&|<>]/;

const arg = (name: string, dflt: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const BATCH_TS = arg('ts', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
const OUT_DIR = arg('out', HERE);
const AUTH_FILE = arg('authoritative', join(HERE, 'authoritative.json'));
/** 2026-10-04 影响力重算批的计划：逐场留着 factors.demand（= K0 × mid(w_p)）与 capacity，
 *  是 tier=exact 精确重算的唯一真源（那批用期望口径重写过 S9 窗 1 的 78 行）。 */
const PLAN_FILE = arg('plan', join(HERE, '..', 'prod-20261004-influence-recalc', 'plan.json'));

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => (v == null ? '' : String(v));
const fmt2 = (v: number): string => v.toFixed(2);

interface Snapshot {
  capturedAt: string;
  scope: string;
  byLabel: Record<string, Row[]>;
}

function loadSnapshot(): Snapshot {
  const raw = JSON.parse(readFileSync(join(HERE, 'snapshot.json'), 'utf8')) as {
    capturedAt: string;
    scope: string;
    statements: { label: string; results: Row[] }[];
  };
  const byLabel: Record<string, Row[]> = {};
  for (const s of raw.statements) byLabel[s.label] = s.results;
  return { capturedAt: raw.capturedAt, scope: raw.scope, byLabel };
}

interface Authoritative {
  capturedAt: string;
  rows: Row[];
}

function loadAuthoritative(): Authoritative | null {
  let raw: string;
  try {
    raw = readFileSync(AUTH_FILE, 'utf8');
  } catch {
    return null;
  }
  const parsed = JSON.parse(raw) as { capturedAt?: string; rows?: Row[]; statements?: { results: Row[] }[] };
  const rows = parsed.rows ?? parsed.statements?.[0]?.results ?? [];
  return { capturedAt: parsed.capturedAt ?? '（未知）', rows };
}

// ---------------------------------------------------------------- 生效主场模型
interface Model {
  ranges: Record<string, [number, number]>;
  /** sell_out_fill 中点（生产 = 0.992）：tier=exact 重算的容量截断值 */
  fillMid: number;
  ticketPer10k: number;
  commPer10kLevel: number;
  bcastPerLevel: number;
  source: string;
}

function effectiveModel(snap: Snapshot): Model {
  const live = (snap.byLabel.I ?? [])[0];
  const raw = live && str(live.value) ? str(live.value) : (CONFIG_DEFAULTS.attendance_model as string);
  const model = JSON.parse(raw) as {
    weather_ranges: Record<string, [number, number]>;
    sell_out_fill: [number, number];
    ticket_revenue_per_10k: number;
    commercial_per_10k_per_level: number;
    broadcast_per_match_per_level: number;
  };
  return {
    ranges: model.weather_ranges,
    fillMid: (model.sell_out_fill[0] + model.sell_out_fill[1]) / 2,
    ticketPer10k: model.ticket_revenue_per_10k,
    commPer10kLevel: model.commercial_per_10k_per_level,
    bcastPerLevel: model.broadcast_per_match_per_level,
    source:
      live && str(live.value)
        ? `config 表（updated_at=${str(live.updated_at)}）`
        : '代码默认 CONFIG_DEFAULTS.attendance_model（config 表无覆盖）',
  };
}

/** 平台收入算式（src/core/attendance.ts computeMatchAttendance 同形） */
function revenueOf(
  m: Model,
  attendance: number,
  commercialLevel: number,
  broadcastLevel: number,
): { ticket: number; commercial: number; broadcast: number; total: number } {
  const wan = attendance / 10000;
  const ticket = round2(wan * m.ticketPer10k);
  const commercial = round2(wan * m.commPer10kLevel * commercialLevel);
  const broadcast = round2(m.bcastPerLevel * broadcastLevel);
  return { ticket, commercial, broadcast, total: round2(ticket + commercial + broadcast) };
}

// ---------------------------------------------------------------- 影响力重算批计划
interface RefMatch {
  matchId: number;
  /** = K0 × mid(w_p)：未截断的原始需求（该批 perturbation 取 1.0、wx 取区间中点） */
  demand: number;
  capacity: number;
  weather: string;
  afterAttendance: number;
  /** 该批自己用的 wx（正常应等于 mid(range[weather])；不等说明这一行不是中点口径，不能按 K0×mid 反推） */
  wx: number;
}

/** plan 行能不能当 K0 真源：天气对得上、上座对得上、且该行确实用区间中点算的（wx == mid） */
function planIsExactSource(ref: RefMatch, range: [number, number]): boolean {
  return Math.abs(ref.wx - mid(range)) <= 0.005;
}

function loadInfluencePlan(): Map<number, RefMatch> {
  const map = new Map<number, RefMatch>();
  let raw: string;
  try {
    raw = readFileSync(PLAN_FILE, 'utf8');
  } catch {
    return map;
  }
  const parsed = JSON.parse(raw) as {
    matchPlans?: {
      matchId: number;
      weather?: string;
      capacity?: number;
      factors?: { demand?: number; wx?: number };
      after?: { attendance?: number };
    }[];
  };
  for (const m of parsed.matchPlans ?? []) {
    const demand = num(m.factors?.demand);
    const capacity = num(m.capacity);
    if (!m.matchId || !(demand > 0) || !(capacity > 0)) continue;
    map.set(num(m.matchId), {
      matchId: num(m.matchId),
      demand,
      capacity,
      weather: str(m.weather),
      afterAttendance: num(m.after?.attendance),
      wx: num(m.factors?.wx),
    });
  }
  return map;
}

const mid = (r: [number, number]): number => (r[0] + r[1]) / 2;

// ---------------------------------------------------------------- 订正条目
interface Correction {
  matchId: number;
  clubId: number;
  home: string;
  away: string;
  walkover: string;
  wOld: string;
  wNew: string;
  coefNew: number;
  midOld: number;
  ratio: number;
  aOld: number;
  aNew: number;
  tOld: number;
  cOld: number;
  bOld: number;
  tNew: number;
  cNew: number;
  totalOld: number;
  totalNew: number;
  delta: number;
  soldOut: boolean;
  cappedByCapacity: boolean;
  typeChanged: boolean;
  ledgerAmount: number | null;
  /** exact = 影响力重算批覆盖过（K0 已知，可精确重算）；estimate = 系数比期望归一 */
  tier: 'exact' | 'estimate';
  /** exact 档的未截断新需求（= factors.demand × coef_a/mid）；estimate 档为 null */
  demandNew: number | null;
  capacity: number | null;
}

interface Skip {
  matchId: number;
  clubId: number;
  home: string;
  away: string;
  reason: string;
  wOld: string;
  aOld: number;
  wNew?: string;
  coefNew?: number;
}

interface WeatherOnly {
  matchId: number;
  clubId: number;
  home: string;
  away: string;
  wOld: string;
  wNew: string;
  coefNew: number;
  aOld: number;
  reason: string;
}

interface PreClassification {
  typeDist: Record<string, number>;
  zeroRows: { matchId: number; clubId: number; home: string; away: string; wOld: string; walkover: string }[];
  soldOutRows: { matchId: number; clubId: number; aOld: number; capacity: number }[];
  revenueMismatch: { matchId: number; clubId: number; totalOld: number; ledgerAmount: number | null; ledgerId: number | null }[];
  noConfirmation: number[];
  noStadium: number[];
  revenueTotal: number;
}

interface Plan {
  corrections: Correction[];
  weatherOnly: WeatherOnly[];
  skips: Skip[];
  anomalies: string[];
  uncovered: { matchId: number; clubId: number; home: string; away: string; wOld: string; aOld: number }[];
  model: Model;
  rowsSeen: number;
  pre: PreClassification;
  sensitivity: { matchId: number; totalOld: number; rLo: number; rHi: number; dLo: number; dHi: number }[];
  /** 口径分档计数（推送前后都算，进 inventory/report） */
  tiers: { exact: number; estimate: number; exactEligible: number; refPlanRows: number; refPlanFile: string };
  /** 计划行对得上但不能按 K0 精确重算的场次（降档为 estimate），逐条留痕 */
  exactDemoted: { matchId: number; planWx: number; rangeMid: number; planWeather: string; reason: string }[];
  /** 影响力重算批计划里有行、但这一行不能当 K0 真源的全部场次（含弃权清零、计划文件损坏） */
  planRowNotes: { matchId: number; reason: string }[];
}

function buildPlan(snap: Snapshot, auth: Authoritative | null, model: Model, refPlan: Map<number, RefMatch>): Plan {
  const C = snap.byLabel.C ?? [];
  const D = snap.byLabel.D ?? [];
  const E = snap.byLabel.E ?? [];
  const G = snap.byLabel.G ?? [];
  const H = snap.byLabel.H ?? [];

  const confById = new Map<number, Row>();
  for (const r of H) confById.set(num(r.match_id), r);
  const capById = new Map<number, number>();
  for (const r of D) capById.set(num(r.club_id), num(r.capacity));
  const levelByClub = new Map<number, { commercial: number; broadcast: number }>();
  for (const r of E) {
    const entry = levelByClub.get(num(r.club_id)) ?? { commercial: 0, broadcast: 0 };
    if (str(r.facility_key) === 'commercial') entry.commercial = num(r.level);
    if (str(r.facility_key) === 'broadcast') entry.broadcast = num(r.level);
    levelByClub.set(num(r.club_id), entry);
  }
  const revenueByMatch = new Map<number, Row>();
  for (const r of G) {
    if (str(r.kind) === 'revenue' && str(r.ref_type) === 'match') revenueByMatch.set(num(r.ref_id), r);
  }
  const authById = new Map<number, Row>();
  for (const r of auth?.rows ?? []) {
    if (str(r.forecast_by) === 'revenue-plugin') authById.set(num(r.match_id), r);
  }

  const plan: Plan = {
    corrections: [],
    weatherOnly: [],
    skips: [],
    anomalies: [],
    uncovered: [],
    model,
    rowsSeen: C.length,
    pre: {
      typeDist: {},
      zeroRows: [],
      soldOutRows: [],
      revenueMismatch: [],
      noConfirmation: [],
      noStadium: [],
      revenueTotal: 0,
    },
    sensitivity: [],
    tiers: { exact: 0, estimate: 0, exactEligible: 0, refPlanRows: refPlan.size, refPlanFile: PLAN_FILE },
    exactDemoted: [],
    planRowNotes: [],
  };

  const allCoefLo = Math.min(...Object.values(model.ranges).map((r) => r[0]));
  const allCoefHi = Math.max(...Object.values(model.ranges).map((r) => r[1]));

  for (const row of C) {
    const matchId = num(row.match_id);
    const clubId = num(row.club_id);
    const wOld = str(row.weather);
    const aOld = num(row.attendance);
    const tOld = num(row.ticket);
    const cOld = num(row.commercial);
    const bOld = num(row.broadcast);
    const totalOld = round2(tOld + cOld + bOld);
    const conf = confById.get(matchId);
    const home = str(conf?.home_team);
    const away = str(conf?.away_team);
    const walkover = str(conf?.walkover_side);
    const rangeOld = model.ranges[wOld];

    // 推送前盘点（与权威输入无关的那部分：类型分布 / 清零行 / 满座行 / 账实一致性）
    plan.pre.typeDist[wOld] = (plan.pre.typeDist[wOld] ?? 0) + 1;
    plan.pre.revenueTotal = round2(plan.pre.revenueTotal + totalOld);
    if (!conf) plan.pre.noConfirmation.push(matchId);
    const preCap = capById.get(clubId);
    if (preCap === undefined) plan.pre.noStadium.push(clubId);
    if (aOld === 0 || totalOld === 0) {
      plan.pre.zeroRows.push({ matchId, clubId, home, away, wOld, walkover });
    } else if (preCap !== undefined && preCap > 0 && aOld / preCap >= SOLD_OUT_BAND) {
      plan.pre.soldOutRows.push({ matchId, clubId, aOld, capacity: preCap });
    }
    const preLedger = revenueByMatch.get(matchId);
    const preLedgerAmount = preLedger ? round2(num(preLedger.amount)) : null;
    if (aOld > 0 && totalOld > 0 && (preLedgerAmount === null || Math.abs(preLedgerAmount - totalOld) >= 0.005)) {
      plan.pre.revenueMismatch.push({
        matchId,
        clubId,
        totalOld,
        ledgerAmount: preLedgerAmount,
        ledgerId: preLedger ? num(preLedger.id) : null,
      });
    }

    if (!rangeOld) {
      plan.anomalies.push(`match ${matchId}：平台结算天气 '${wOld}' 不在生效区间表里，无法归一`);
      continue;
    }

    // 口径分档（与权威输入无关，推送前就能数出来）：这一行是不是影响力重算批写下的
    const refPre = refPlan.get(matchId);
    if (refPre !== undefined) {
      const attOk = Math.abs(refPre.afterAttendance - aOld) < 0.5;
      const wxOk = planIsExactSource(refPre, rangeOld);
      if (refPre.weather === wOld && attOk && wxOk) {
        plan.tiers.exactEligible++;
      } else {
        const why = !attOk
          ? `计划上座 ${refPre.afterAttendance} ≠ 库中 ${aOld}（弃权批清零后计划未回写）`
          : refPre.weather !== wOld
            ? `计划天气字段与库中不一致（计划 '${refPre.weather.replace(/\uFFFD/g, '�')}' vs 库 '${wOld}'${/\uFFFD/.test(refPre.weather) ? '，计划文件该字段已损坏' : ''}）`
            : `计划行 wx=${refPre.wx} ≠ mid(${wOld})=${round2(mid(rangeOld) * 10000) / 10000}，非中点口径`;
        plan.planRowNotes.push({ matchId, reason: why });
      }
    }

    // 敏感度（推送前盘点用）：把权威系数取遍全类型上下沿
    plan.sensitivity.push({
      matchId,
      totalOld,
      rLo: allCoefLo / mid(rangeOld),
      rHi: allCoefHi / mid(rangeOld),
      dLo: round2(totalOld * (allCoefLo / mid(rangeOld)) - totalOld),
      dHi: round2(totalOld * (allCoefHi / mid(rangeOld)) - totalOld),
    });

    const authRow = authById.get(matchId);
    if (!authRow) {
      plan.uncovered.push({ matchId, clubId, home, away, wOld, aOld });
      continue;
    }

    const wNew = str(authRow.weather);
    const coefNew = num(authRow.wx_coef);
    const rangeNew = model.ranges[wNew];
    if (!rangeNew) {
      plan.anomalies.push(`match ${matchId}：插件权威天气 '${wNew}' 不在生效区间表里`);
      continue;
    }
    if (!(coefNew >= rangeNew[0] - 1e-9 && coefNew <= rangeNew[1] + 1e-9)) {
      // 权威系数落在本仓区间外 = 两侧区间配置已漂移（区间真源在插件 `_conf_schema.json`），
      // 拿它做系数比会把量级放大/缩小任意倍数 ⇒ 本场不订正，交人工核配置
      plan.anomalies.push(
        `match ${matchId}：权威系数 ${coefNew} 落在区间 [${rangeNew[0]},${rangeNew[1]}] 之外（${wNew}）` +
          `——两侧 weather_ranges 可能已漂移，本场不订正，交人工`,
      );
      continue;
    }

    const mOld = mid(rangeOld);
    const ratio = coefNew / mOld;
    const typeChanged = wNew !== wOld;

    // ② 上座 0 / 收入合计 0：弃权场已被清零，钱没有可缩放的分母 ⇒ 只改天气
    if (aOld === 0 || totalOld === 0) {
      if (typeChanged) {
        plan.weatherOnly.push({
          matchId,
          clubId,
          home,
          away,
          wOld,
          wNew,
          coefNew,
          aOld,
          reason: walkover ? `弃权场（${walkover} 方弃权）上座与收入已清零` : '上座 0 或收入合计 0，无可缩放基数',
        });
      } else {
        plan.skips.push({ matchId, clubId, home, away, reason: '上座 0 或收入合计 0，且天气类型一致——无变化', wOld, aOld });
      }
      continue;
    }

    // ③ 账实不符：上座行合计 ≠ 该场 revenue 流水金额 ⇒ 交人工
    const ledger = revenueByMatch.get(matchId);
    const ledgerAmount = ledger ? round2(num(ledger.amount)) : null;
    if (ledgerAmount === null) {
      plan.anomalies.push(`match ${matchId}：找不到 kind=revenue/ref_type=match 的流水（上座行合计 ${fmt2(totalOld)}），交人工`);
      continue;
    }
    if (Math.abs(ledgerAmount - totalOld) >= 0.005) {
      plan.anomalies.push(
        `match ${matchId}：上座行合计 ${fmt2(totalOld)} 与流水金额 ${fmt2(ledgerAmount)}（流水 id=${num(ledger?.id)}）不符，交人工`,
      );
      continue;
    }

    // ③b 收入算式守卫：用旧上座 + 现行设施等级复算旧收入，逐分相符才敢重算
    const levels = levelByClub.get(clubId) ?? { commercial: 0, broadcast: 0 };
    const oldCheck = revenueOf(model, aOld, levels.commercial, levels.broadcast);
    if (
      Math.abs(oldCheck.ticket - tOld) >= 0.005 ||
      Math.abs(oldCheck.commercial - cOld) >= 0.005 ||
      Math.abs(oldCheck.broadcast - bOld) >= 0.005
    ) {
      plan.anomalies.push(
        `match ${matchId}：旧收入复算不符（库中 票${fmt2(tOld)}/商${fmt2(cOld)}/播${fmt2(bOld)}；` +
          `按现行算式与设施等级复算 票${fmt2(oldCheck.ticket)}/商${fmt2(oldCheck.commercial)}/播${fmt2(oldCheck.broadcast)}）` +
          `——等级或配置在结算后漂移过，交人工`,
      );
      continue;
    }

    // ① 主算式（两档口径：exact = 影响力重算批覆盖过 ⇒ K0 已知可精确重算；estimate = 系数比期望归一）
    const ref = refPlan.get(matchId);
    const refRowMatches = ref !== undefined && ref.weather === wOld && Math.abs(ref.afterAttendance - aOld) < 0.5;
    const exact = refRowMatches && planIsExactSource(ref, rangeOld);
    if (refRowMatches && !exact) {
      // 计划行对得上，但该行不是「wx 取区间中点」口径 ⇒ K0 反推不成立，降档并留痕
      const mangled = /[\uFFFD]/.test(ref.weather);
      plan.exactDemoted.push({
        matchId,
        planWx: ref.wx,
        rangeMid: round2(mid(rangeOld) * 10000) / 10000,
        planWeather: mangled ? `'${wOld}'（计划文件里这一行的天气字段已损坏，含替换字符）` : ref.weather,
        reason: `影响力重算批这一行用的是 wx=${ref.wx}（≠ mid(${wOld})=${round2(mid(rangeOld) * 10000) / 10000}），K0 无法按 K0×mid 反推`,
      });
    }
    let aNew: number;
    let demandNew: number | null = null;
    let soldOut: boolean;
    let cappedByCapacity = false;
    if (exact) {
      // 该批用期望口径重写过（perturbation=1.0、wx=区间中点）⇒ factors.demand = K0 × mid(w_p)，
      // 换权威系数后 demand_new = factors.demand × coef_a/mid(w_p)；容量截断按 fill 中点 0.992。
      demandNew = ref.demand * ratio;
      soldOut = demandNew >= ref.capacity;
      aNew = soldOut ? Math.floor(ref.capacity * model.fillMid) : Math.floor(Math.max(0, demandNew));
      cappedByCapacity = soldOut;
    } else {
      const capacity = capById.get(clubId);
      soldOut = capacity !== undefined && capacity > 0 && aOld / capacity >= SOLD_OUT_BAND;
      let aNewRaw = Math.round(aOld * ratio);
      if (soldOut) {
        // 容量截断场：上座 = floor(容量 × fill)，fill 与天气无关 ⇒ 系数上调不加人（仍满座），
        // 系数下调才可能掉出满座。K 不可知，取 min 即「只向下订正」的期望口径。
        aNewRaw = Math.min(aNewRaw, aOld);
      }
      if (capacity !== undefined && capacity > 0) {
        const capCeil = Math.floor(capacity * 0.999);
        if (aNewRaw > capCeil) {
          aNewRaw = capCeil;
          cappedByCapacity = true;
        }
      }
      aNew = Math.max(0, aNewRaw);
    }
    const revNew = revenueOf(model, aNew, levels.commercial, levels.broadcast);
    const tNew = revNew.ticket;
    const cNew = revNew.commercial;
    const bNew = revNew.broadcast;
    const totalNew = revNew.total;
    const delta = round2(totalNew - totalOld);
    plan.tiers[exact ? 'exact' : 'estimate']++;

    if (aNew === aOld && Math.abs(delta) < 0.005 && !typeChanged) {
      plan.skips.push({ matchId, clubId, home, away, reason: '系数归一后无变化', wOld, aOld, wNew, coefNew });
      continue;
    }

    plan.corrections.push({
      matchId,
      clubId,
      home,
      away,
      walkover,
      wOld,
      wNew,
      coefNew,
      midOld: mOld,
      ratio,
      aOld,
      aNew,
      tOld,
      cOld,
      bOld,
      tNew,
      cNew,
      totalOld,
      totalNew,
      delta,
      soldOut,
      cappedByCapacity,
      typeChanged,
      ledgerAmount,
      tier: exact ? 'exact' : 'estimate',
      demandNew,
      capacity: exact ? ref.capacity : (capById.get(clubId) ?? null),
    });
  }

  return plan;
}

// ---------------------------------------------------------------- SQL 生成
function memoText(c: Correction): string {
  const tail = c.delta === 0 ? '无差额' : `差额 ${c.delta > 0 ? '+' : ''}${fmt2(c.delta)}`;
  const tierTag = c.tier === 'exact' ? '精确重算' : '期望归一';
  return (
    `天气订正·match:${c.matchId}（${c.home} vs ${c.away}；天气 ${c.wOld}→${c.wNew}，系数 ${c.coefNew}；` +
    `上座 ${c.aOld}→${c.aNew}；票 ${fmt2(c.tOld)}→${fmt2(c.tNew)} 商 ${fmt2(c.cOld)}→${fmt2(c.cNew)} 播 ${fmt2(c.bOld)}；` +
    `${tail}；${tierTag}）`
  );
}

function updateSql(c: Correction): string {
  return (
    `UPDATE match_attendance SET weather = '${c.wNew}', attendance = ${c.aNew}, ticket = ${fmt2(c.tNew)}, ` +
    `commercial = ${fmt2(c.cNew)}, broadcast = ${fmt2(c.bOld)}\n` +
    ` WHERE match_id = ${c.matchId} AND attendance = ${c.aOld} AND weather = '${c.wOld}';`
  );
}

function weatherOnlySql(w: WeatherOnly): string {
  return `UPDATE match_attendance SET weather = '${w.wNew}'\n WHERE match_id = ${w.matchId} AND weather = '${w.wOld}';`;
}

/** 账本两笔（账户差额 + 流水），与 src/worker/ledger.ts:29-63 的 ledgerMovement 同形。
 *  离线批可能被通道拆批，故不用 changes()>0 闸，改用同键 NOT EXISTS（prod-20261006 批同款）。 */
function ledgerPair(c: Correction, ts: string, dir: 1 | -1): string[] {
  const amount = round2(c.delta * dir);
  const club = c.clubId;
  const refType = dir === 1 ? REF_TYPE : REF_TYPE_UNDO;
  const memo =
    dir === 1
      ? memoText(c)
      : `天气订正回滚·match:${c.matchId}（撤销 wx_fix 分录；上座 ${c.aNew}→${c.aOld}；天气 ${c.wNew}→${c.wOld}；` +
        `差额 ${amount > 0 ? '+' : ''}${fmt2(amount)}）`;
  const guard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = ${club} AND kind = '${KIND}' AND ref_type = '${refType}' AND ref_id = ${c.matchId})`;
  return [
    `INSERT INTO ledger_accounts (club_id, balance, updated_at)\n` +
      `SELECT ${club}, ${fmt2(amount)}, '${ts}'\n WHERE ${guard}\n` +
      ` ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at\n WHERE ${guard};`,
    `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)\n` +
      `SELECT ${club}, '${KIND}', ${fmt2(amount)}, (SELECT balance FROM ledger_accounts WHERE club_id = ${club}), '${refType}', ${c.matchId}, '${memo}', '${ts}'\n WHERE ${guard};`,
  ];
}

function restoreSql(c: Correction): string {
  return (
    `UPDATE match_attendance SET weather = '${c.wOld}', attendance = ${c.aOld}, ticket = ${fmt2(c.tOld)}, ` +
    `commercial = ${fmt2(c.cOld)}, broadcast = ${fmt2(c.bOld)}\n` +
    ` WHERE match_id = ${c.matchId} AND attendance = ${c.aNew} AND weather = '${c.wNew}';`
  );
}

function header(title: string, extra: string[] = []): string {
  return (
    `-- ${title}\n` +
    `--\n` +
    `-- 生成时间：${BATCH_TS}\n` +
    `-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20 --retry=2\n` +
    extra.map((l) => `-- ${l}\n`).join('') +
    `\n`
  );
}

function writeShard(rel: string, body: string): { bytes: number; stmts: number; sha256: string } {
  const path = join(OUT_DIR, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  const stmts = body
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '').length;
  return {
    bytes: Buffer.byteLength(body, 'utf8'),
    stmts,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

// ---------------------------------------------------------------- 主流程
function main(): void {
  const snap = loadSnapshot();
  const model = effectiveModel(snap);
  const auth = loadAuthoritative();
  const refPlan = loadInfluencePlan();
  const plan = buildPlan(snap, auth, model, refPlan);

  console.log(`快照：${snap.scope} @ ${snap.capturedAt}（C 段 ${plan.rowsSeen} 行已结算上座）`);
  console.log(`主场模型来源：${model.source}（fill 中点 ${model.fillMid}）`);
  console.log(
    `口径分档：可精确重算 ${plan.tiers.exactEligible} 行（影响力重算批覆盖，K0 已知）· 其余走期望归一；` +
      `本批实际入账 精确 ${plan.tiers.exact} / 估计 ${plan.tiers.estimate} 场（计划 ${plan.tiers.refPlanRows} 行，读自 ${PLAN_FILE}）`,
  );
  console.log(`权威输入：${auth ? `${AUTH_FILE} @ ${auth.capturedAt}（${auth.rows.length} 行 match_weather）` : '（无 —— 只做推送前盘点，不产出订正 SQL）'}`);
  const bRows = (snap.byLabel.B ?? []).length;
  console.log(`平台预报行（B 段，推送前）：${bRows} 行${bRows === 0 ? ' ⇒ 平台从未有预报行，S9 全部内联现掷' : ''}`);

  const sensD = plan.sensitivity.reduce((a, s) => a + s.dLo, 0);
  const sensH = plan.sensitivity.reduce((a, s) => a + s.dHi, 0);
  const sensBase = plan.sensitivity.reduce((a, s) => a + s.totalOld, 0);
  const coefLo = Math.min(...Object.values(model.ranges).map((r) => r[0]));
  const coefHi = Math.max(...Object.values(model.ranges).map((r) => r[1]));
  console.log(
    `敏感度（权威系数取遍全类型上下沿 ${coefLo}–${coefHi}）：比赛日收入合计 ${fmt2(sensBase)} → 变化区间 ${fmt2(sensD)} … +${fmt2(sensH)}`,
  );
  console.log(
    `分类：可订正 ${plan.corrections.length} · 只改天气 ${plan.weatherOnly.length} · 跳过 ${plan.skips.length} · 无权威记录 ${plan.uncovered.length} · 异常 ${plan.anomalies.length}`,
  );
  console.log(
    `盘点：天气分布 ${Object.entries(plan.pre.typeDist).map(([k, v]) => `${k}${v}`).join('/')}` +
      `｜已清零行 ${plan.pre.zeroRows.length}（弃权 ${plan.pre.zeroRows.filter((z) => z.walkover).length}）` +
      `｜满座行 ${plan.pre.soldOutRows.length}` +
      `｜账实不符 ${plan.pre.revenueMismatch.length}` +
      `｜缺赛果确认 ${plan.pre.noConfirmation.length}｜缺球场 ${plan.pre.noStadium.length}`,
  );

  if (!auth) {
    const inv = {
      mode: 'pre-push-inventory',
      snapshotCapturedAt: snap.capturedAt,
      modelSource: model.source,
      ranges: model.ranges,
      fillMid: model.fillMid,
      tiers: plan.tiers,
      exactDemoted: plan.exactDemoted,
      planRowNotes: plan.planRowNotes,
      platformForecastRows: bRows,
      rows: plan.rowsSeen,
      revenueTotal: plan.pre.revenueTotal,
      sensitivityTotal: { lo: round2(sensD), hi: round2(sensH) },
      pre: plan.pre,
      uncovered: plan.uncovered,
      anomalies: plan.anomalies,
      skips: plan.skips,
      perRowSensitivity: plan.sensitivity,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'inventory.json'), `${JSON.stringify(inv, null, 2)}\n`);
    console.log(`已写出 inventory.json（推送前盘点；推送后重跑本脚本才会产出订正 SQL）`);
    return;
  }

  // ---- 自检（硬断言，任一不过即拒绝产出）
  const errs: string[] = [];
  const mids = new Set<number>();
  const anchors = new Set<string>();
  for (const c of plan.corrections) {
    if (mids.has(c.matchId)) errs.push(`match ${c.matchId} 重复`);
    mids.add(c.matchId);
    const key = `${c.clubId}/${c.matchId}`;
    if (anchors.has(key)) errs.push(`账本锚重复 ${key}`);
    anchors.add(key);
    if (Math.abs(round2(c.tNew + c.cNew + c.bOld) - c.totalNew) >= 0.005) errs.push(`match ${c.matchId} 合计不自洽`);
    if (Math.abs(round2(c.totalNew - c.totalOld) - c.delta) >= 0.005) errs.push(`match ${c.matchId} 差额不自洽`);
    if (c.delta === 0 && c.aNew === c.aOld && !c.typeChanged) errs.push(`match ${c.matchId} 无变化却入批`);
    if (c.tier === 'exact') {
      // 精确档：上座必须逐位等于「未截断需求按容量截断规则」的结果
      if (c.demandNew === null || c.capacity === null) {
        errs.push(`match ${c.matchId}：精确档缺 demandNew/capacity`);
      } else {
        const expect = c.demandNew >= c.capacity ? Math.floor(c.capacity * plan.model.fillMid) : Math.floor(Math.max(0, c.demandNew));
        if (c.aNew !== expect) errs.push(`match ${c.matchId}：精确档上座 ${c.aNew} ≠ 复算 ${expect}`);
      }
    } else if (c.aOld > 0 && Math.abs(c.aNew / c.aOld - c.ratio) > 0.02) {
      errs.push(`match ${c.matchId} 缩放比偏离系数比过大`);
    }
  }
  for (const w of plan.weatherOnly) {
    if (mids.has(w.matchId)) errs.push(`match ${w.matchId} 同时出现在两条路径`);
  }
  for (const s of plan.anomalies) console.log(`  ⚠ ${s}`);
  if (errs.length) {
    console.error('自检失败：');
    for (const e of errs) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  // ---- 分片
  const full = [...plan.corrections].sort((a, b) => a.matchId - b.matchId);
  const typeOnly = full.filter((c) => c.typeChanged);

  const sum = (list: Correction[], f: (c: Correction) => number) => round2(list.reduce((a, c) => a + f(c), 0));

  const bodyFull = [
    header(`S9 天气订正批 · 全量收敛（精确重算 + 系数比期望归一）`, [
      `范围：${full.length} 场（含天气类型不一致 ${typeOnly.length} 场 + 类型一致但系数为平台自掷 ${full.length - typeOnly.length} 场）`,
      `口径：精确重算 ${full.filter((c) => c.tier === 'exact').length} 场（影响力重算批覆盖，K0 已知）· 期望归一 ${full.filter((c) => c.tier === 'estimate').length} 场`,
      `账本：ref_type='${REF_TYPE}' kind='${KIND}'，净变化 ${fmt2(sum(full, (c) => c.delta))}`,
      `每场两句账本（账户差额 + 流水）+ 一句上座行 UPDATE；重放全为 no-op（守卫看旧值，账本看锚）`,
      `与 02a 重叠安全：02a 订过的场次这里守卫不通过 ⇒ 自动 no-op`,
    ]),
    ...full.map((c) => `-- match ${c.matchId}｜${c.home} vs ${c.away}｜${c.wOld}→${c.wNew}｜上座 ${c.aOld}→${c.aNew}｜差额 ${fmt2(c.delta)}｜${c.tier === 'exact' ? '精确' : '估计'}\n${updateSql(c)}\n${ledgerPair(c, BATCH_TS, 1).join('\n')}\n`),
    ...plan.weatherOnly.map((w) => `-- match ${w.matchId}｜只改天气（${w.reason}）\n${weatherOnlySql(w)}\n`),
  ].join('\n');

  const bodyTypeOnly = [
    header(`S9 天气订正批 · 保守子集（只订天气类型不一致）`, [
      `范围：${typeOnly.length} 场（平台结算天气 ≠ 插件权威天气，输入差异可证）`,
      `账本净变化 ${fmt2(sum(typeOnly, (c) => c.delta))}`,
      `类型一致、仅系数不同的场次（${full.length - typeOnly.length} 场）不在本分片——那部分靠期望中性归一，属"口径收敛"而非"输入订正"`,
    ]),
    ...typeOnly.map((c) => `-- match ${c.matchId}｜${c.home} vs ${c.away}｜${c.wOld}→${c.wNew}｜上座 ${c.aOld}→${c.aNew}｜差额 ${fmt2(c.delta)}｜${c.tier === 'exact' ? '精确' : '估计'}\n${updateSql(c)}\n${ledgerPair(c, BATCH_TS, 1).join('\n')}\n`),
  ].join('\n');

  const bodyRollback = [
    header(`S9 天气订正批 · 回滚（还原上座行 + 反向分录）`, [
      `对应 sql/02-recalc.sql 的 ${full.length} 场；上座行守卫看新值、账本锚 ref_type='${REF_TYPE_UNDO}'`,
      `只跑了 02a 的情况下，未跑场次这里守卫不通过 ⇒ 自动 no-op`,
    ]),
    ...full.map((c) => `-- match ${c.matchId}｜还原 ${c.aNew}→${c.aOld}｜差额 ${fmt2(-c.delta)}｜${c.tier === 'exact' ? '精确' : '估计'}\n${restoreSql(c)}\n${ledgerPair(c, BATCH_TS, -1).join('\n')}\n`),
  ].join('\n');

  // 逐队期望余额：基线（F 段）+ Σ delta
  const balBase = new Map<number, number>();
  for (const r of snap.byLabel.F ?? []) balBase.set(num(r.club_id), num(r.balance));
  const perClub = new Map<number, number>();
  for (const c of full) perClub.set(c.clubId, round2((perClub.get(c.clubId) ?? 0) + c.delta));
  const clubIds = [...perClub.keys()].sort((a, b) => a - b);

  const wxCode: Record<string, number> = { 晴: 1, 多云: 2, 雨: 3, 雪: 4 };
  const changed = full.filter((c) => c.typeChanged);

  const verify1 = [
    header(`S9 天气订正批 · 执行后复查（一）：余额与分录`, [
      `逐队余额应等于基线 + 净变化（下表）；wx_fix 计数应为 ${full.filter((c) => c.delta !== 0).length}、合计应为 ${fmt2(sum(full, (c) => c.delta))}；守恒位应恒为 0。`,
      ...clubIds.map((id) => `club ${id}：基线 ${fmt2(balBase.get(id) ?? 0)} + ${fmt2(perClub.get(id) ?? 0)} = ${fmt2(round2((balBase.get(id) ?? 0) + (perClub.get(id) ?? 0)))}`),
    ]),
    `SELECT\n` +
      clubIds.map((id) => `  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = ${id}) AS bal_${id},`).join('\n') +
      `\n` +
      `  (SELECT COUNT(*) FROM ledger_entries WHERE kind = '${KIND}' AND ref_type = '${REF_TYPE}') AS wx_fix_n,\n` +
      `  (SELECT ROUND(COALESCE(SUM(amount), 0), 2) FROM ledger_entries WHERE kind = '${KIND}' AND ref_type = '${REF_TYPE}') AS wx_fix_sum,\n` +
      `  (SELECT COUNT(*) FROM ledger_entries WHERE kind = '${KIND}' AND ref_type = '${REF_TYPE_UNDO}') AS wx_undo_n,\n` +
      `  (SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve;`,
  ].join('\n');

  const verify2 = [
    header(`S9 天气订正批 · 执行后复查（二）：逐场旧值是否已消失`, [
      `att_old_n / wx_old_n 应为 0（旧值与旧天气类型都已不在）；att_new_n / wx_new_n 应分别等于订正场数 ${full.length} 与天气有变化的场数 ${changed.length}。`,
      `编码：match_id*1000000+attendance 与 match_id*10+天气码（晴1/多云2/雨3/雪4），避开 exec-shards 对 | 的禁用。`,
    ]),
    `SELECT\n` +
      `  (SELECT SUM(CASE WHEN match_id * 1000000 + attendance IN (${full.map((c) => `${c.matchId * 1000000 + c.aOld}`).join(', ')}) THEN 1 ELSE 0 END) FROM match_attendance) AS att_old_n,\n` +
      `  (SELECT SUM(CASE WHEN match_id * 1000000 + attendance IN (${full.map((c) => `${c.matchId * 1000000 + c.aNew}`).join(', ')}) THEN 1 ELSE 0 END) FROM match_attendance) AS att_new_n,\n` +
      `  (SELECT SUM(CASE WHEN match_id * 10 + CASE weather WHEN '晴' THEN 1 WHEN '多云' THEN 2 WHEN '雨' THEN 3 WHEN '雪' THEN 4 ELSE 0 END IN (${changed.map((c) => `${c.matchId * 10 + wxCode[c.wOld]}`).join(', ')}) THEN 1 ELSE 0 END) FROM match_attendance) AS wx_old_n,\n` +
      `  (SELECT SUM(CASE WHEN match_id * 10 + CASE weather WHEN '晴' THEN 1 WHEN '多云' THEN 2 WHEN '雨' THEN 3 WHEN '雪' THEN 4 ELSE 0 END IN (${changed.map((c) => `${c.matchId * 10 + wxCode[c.wNew]}`).join(', ')}) THEN 1 ELSE 0 END) FROM match_attendance) AS wx_new_n;`,
  ].join('\n');

  const shards: Record<string, { body: string; note: string; expectChanges: string }> = {
    'sql/02-recalc.sql': { body: bodyFull, note: '全量收敛（推荐）', expectChanges: `${full.length * (1 + 2)} 句` },
    'sql/02a-type-only.sql': { body: bodyTypeOnly, note: '保守子集（只订类型不一致）', expectChanges: `${typeOnly.length * 3} 句` },
    'sql/03-verify-balance.sql': { body: verify1, note: '执行后复查（只读）', expectChanges: '只读' },
    'sql/03a-verify-rows.sql': { body: verify2, note: '执行后复查（只读）', expectChanges: '只读' },
    'rollback/01-undo.sql': { body: bodyRollback, note: '回滚', expectChanges: `${full.length * 3} 句` },
  };

  // 单条语句字节数守卫 + 禁用字符守卫
  for (const [rel, sh] of Object.entries(shards)) {
    for (const stmt of sh.body.split(';')) {
      const s = stmt.trim();
      if (s === '' || s.startsWith('--')) continue;
      if (FORBIDDEN.test(s)) {
        console.error(`${rel}：语句含 exec-shards 禁用字符：${s.slice(0, 160)}`);
        process.exit(1);
      }
      if (Buffer.byteLength(s, 'utf8') > MAX_STMT_BYTES) {
        console.error(`${rel}：单条语句 ${Buffer.byteLength(s, 'utf8')}B 超过 ${MAX_STMT_BYTES}B：${s.slice(0, 120)}…`);
        process.exit(1);
      }
    }
  }

  const manifest: Record<string, unknown> = {};
  for (const [rel, sh] of Object.entries(shards)) {
    const info = writeShard(rel, sh.body);
    manifest[rel] = { ...info, note: sh.note, expectChanges: sh.expectChanges };
    console.log(`已写出 ${rel}：${info.bytes}B / ${info.stmts} 语句 / sha256 ${info.sha256.slice(0, 12)}`);
  }

  const detail = {
    generatedAt: BATCH_TS,
    snapshotCapturedAt: snap.capturedAt,
    authoritativeCapturedAt: auth.capturedAt,
    modelSource: model.source,
    ranges: model.ranges,
    fillMid: model.fillMid,
    tiers: plan.tiers,
    exactDemoted: plan.exactDemoted,
    planRowNotes: plan.planRowNotes,
    totals: {
      rowsSeen: plan.rowsSeen,
      corrections: full.length,
      typeChanged: typeOnly.length,
      coefOnly: full.length - typeOnly.length,
      tierExact: full.filter((c) => c.tier === 'exact').length,
      tierEstimate: full.filter((c) => c.tier === 'estimate').length,
      weatherOnly: plan.weatherOnly.length,
      skipped: plan.skips.length,
      uncovered: plan.uncovered.length,
      anomalies: plan.anomalies.length,
      ledgerEntries: full.filter((c) => c.delta !== 0).length,
      deltaSum: sum(full, (c) => c.delta),
      deltaSumTypeOnly: sum(typeOnly, (c) => c.delta),
      attendanceUp: full.filter((c) => c.aNew > c.aOld).length,
      attendanceDown: full.filter((c) => c.aNew < c.aOld).length,
      soldOut: full.filter((c) => c.soldOut).length,
      cappedByCapacity: full.filter((c) => c.cappedByCapacity).length,
    },
    perClub: clubIds.map((id) => ({ clubId: id, base: balBase.get(id) ?? 0, delta: perClub.get(id) ?? 0, expect: round2((balBase.get(id) ?? 0) + (perClub.get(id) ?? 0)) })),
    pre: plan.pre,
    corrections: full.map((c) => ({
      matchId: c.matchId,
      clubId: c.clubId,
      home: c.home,
      away: c.away,
      walkover: c.walkover,
      wOld: c.wOld,
      wNew: c.wNew,
      coefNew: c.coefNew,
      midOld: round2(c.midOld * 10000) / 10000,
      ratio: Math.round(c.ratio * 10000) / 10000,
      aOld: c.aOld,
      aNew: c.aNew,
      tOld: c.tOld,
      tNew: c.tNew,
      cOld: c.cOld,
      cNew: c.cNew,
      bOld: c.bOld,
      totalOld: c.totalOld,
      totalNew: c.totalNew,
      delta: c.delta,
      soldOut: c.soldOut,
      cappedByCapacity: c.cappedByCapacity,
      typeChanged: c.typeChanged,
      tier: c.tier,
      demandNew: c.demandNew === null ? null : Math.round(c.demandNew * 100) / 100,
      capacity: c.capacity,
    })),
    weatherOnly: plan.weatherOnly,
    skips: plan.skips,
    uncovered: plan.uncovered,
    anomalies: plan.anomalies,
  };
  writeFileSync(join(OUT_DIR, 'report-data.json'), `${JSON.stringify(detail, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'sql', 'manifest.json'), `${JSON.stringify({ batchTs: BATCH_TS, shards: manifest, totals: detail.totals }, null, 2)}\n`);
  console.log(`已写出 report-data.json 与 sql/manifest.json`);

  const totalDelta = detail.totals.deltaSum as number;
  console.log(
    `\n合计：订正 ${full.length} 场（类型 ${typeOnly.length} / 仅系数 ${full.length - typeOnly.length}；` +
      `精确 ${detail.totals.tierExact} / 估计 ${detail.totals.tierEstimate}）` +
      `｜上座上调 ${detail.totals.attendanceUp} 下调 ${detail.totals.attendanceDown}` +
      `｜账本 ${detail.totals.ledgerEntries} 笔 / 净 ${fmt2(totalDelta)}` +
      `｜满座场 ${detail.totals.soldOut}`,
  );
  for (const s of plan.skips.slice(0, 12)) console.log(`  · 跳过 match ${s.matchId}：${s.reason}`);
  if (plan.skips.length > 12) console.log(`  · …另有 ${plan.skips.length - 12} 场跳过（见 report-data.json）`);
  console.log(`\n下一步（需用户明确下令）：node exec-shards.mjs sql/02-recalc.sql --remote --chunk=20 --retry=2`);
}

main();
