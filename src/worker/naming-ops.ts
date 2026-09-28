// 冠名市场（v2.6.0，规则=revenue 插件 README §七 + brand_service.py / window_service.py / formula.py:462）：
// 品牌池落库（v6.8.0 迁移 0045，管理端可调，无排他，多队可签同一品牌）；
// 底价/窗口 = (基准 + 容量系数×容量万 + 死忠系数×死忠万) × 热度 × 行业系数，按签约时队况锁定整约；
// 三套餐（稳健/进取/对赌）费用条款快照入合同；提前解约赔剩余窗口费用 30%；
// 窗末收租 + 对赌奖金 + 品牌热度动态（近 3 场全胜/全败）并入关窗批。
// 续约（v6.8.0）：只剩最后 1 窗可续，按当期队况与品牌现热度重算（插件 renew 口径，无涨跌系数）。
// 不做（缓议）：品牌主动解约/满意度/档位性格（C2）、招商轮（C3）、夺冠/成交/被冷落热度触发、事件 brand_heat（D 块）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { getOpenWindow } from './seasons.ts';
import { createAuditStatement, writeAudit } from '../lib/audit.ts';

export interface BrandPoolRow {
  id: number;
  brand: string;
  heat: number;
  source: string;
  status: string;
  industry: string;
  created_at: string;
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
  baseFee: number;
  packages: NamingPackage[];
}

/** 品牌池在池品牌（adopted），按 id 稳定序。 */
export async function loadAdoptedBrands(db: Env['DB']): Promise<BrandPoolRow[]> {
  return (
    await db
      .prepare(`SELECT id, brand, heat, source, status, industry, created_at FROM brand_pool WHERE status = 'adopted' ORDER BY id`)
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

/** 品牌池报价：按本队队况逐品牌算底价（×行业系数）与三套餐。 */
export function quoteBrands(
  p: NamingParams,
  brands: BrandPoolRow[],
  capacity: number,
  fans: number,
  factors: Record<string, number>,
): NamingQuote[] {
  return brands.map((b) => {
    const baseFee = round3(namingBaseFee(p, capacity, fans, b.heat) * industryFactor(factors, b.industry));
    return { brand: b.brand, heat: b.heat, industry: b.industry, baseFee, packages: buildPackages(p, baseFee) };
  });
}

/** 签约：费用条款按当期队况快照入合同（需开放窗口；无排他，多队可签同一品牌）。 */
export async function signNaming(
  env: Env,
  clubId: number,
  brand: string,
  packageNo: number,
): Promise<NamingContractRow> {
  if (!Number.isInteger(packageNo) || packageNo < 1 || packageNo > 3) {
    throw new HttpError(400, '套餐号需为 1-3（1=稳健 2=进取 3=对赌）');
  }
  const win = await getOpenWindow(env.DB);
  if (!win) throw new HttpError(409, '转会窗口没开，签不了冠名合同');
  const stadium = await env.DB
    .prepare('SELECT capacity, fans FROM stadiums WHERE club_id = ?')
    .bind(clubId)
    .first<{ capacity: number; fans: number }>();
  if (!stadium) throw new HttpError(404, '俱乐部还没有球场档案');
  const def = await env.DB
    .prepare(`SELECT heat, industry FROM brand_pool WHERE brand = ? AND status = 'adopted'`)
    .bind(brand)
    .first<{ heat: number; industry: string }>();
  if (!def) throw new HttpError(400, `品牌「${brand}」不在品牌池`);
  if (await getActiveNaming(env.DB, clubId)) throw new HttpError(409, '已有生效冠名，先退约再签新约');
  const params = await loadNamingParams(env.DB);
  const factors = await loadIndustryFactors(env.DB);
  const baseFee = round3(namingBaseFee(params, stadium.capacity, stadium.fans, def.heat) * industryFactor(factors, def.industry));
  const pkg = buildPackages(params, baseFee)[packageNo - 1]!;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const out = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO naming_contracts
         (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
          windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status,
          started_season, started_window, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ${now}, ${now}
         WHERE NOT EXISTS (SELECT 1 FROM naming_contracts WHERE club_id = ? AND status = 'active')`,
      )
      .bind(
        clubId, brand, def.heat, baseFee, pkg.packageNo, pkg.pkgName, pkg.feePerWindow,
        pkg.windows, pkg.windows, pkg.bonusAmount, pkg.betAttend, pkg.betFans, win.season, win.windowSeq, clubId,
      ),
  ]);
  if ((out[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '已有生效冠名，先退约再签新约');
  const row = await getActiveNaming(env.DB, clubId);
  if (!row) throw new HttpError(500, '冠名合同落库后读不回来');
  return row;
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
    .prepare('SELECT capacity, fans FROM stadiums WHERE club_id = ?')
    .bind(clubId)
    .first<{ capacity: number; fans: number }>();
  if (!stadium) throw new HttpError(404, '俱乐部还没有球场档案');
  const params = await loadNamingParams(env.DB);
  const factors = await loadIndustryFactors(env.DB);
  const baseFee = round3(namingBaseFee(params, stadium.capacity, stadium.fans, brand.heat) * industryFactor(factors, brand.industry));
  const pkg = buildPackages(params, baseFee)[packageNo - 1]!;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const out = await env.DB
    .prepare(
      `UPDATE naming_contracts
       SET brand_heat = ?, base_fee = ?, package_no = ?, pkg_name = ?, fee_per_window = ?,
           windows_total = ?, windows_remaining = ?, bonus_amount = ?, bet_attend = ?, bet_fans = ?,
           started_season = ?, started_window = ?, updated_at = ${now}
       WHERE id = ? AND status = 'active' AND windows_remaining = 1`,
    )
    .bind(
      brand.heat, baseFee, pkg.packageNo, pkg.pkgName, pkg.feePerWindow,
      pkg.windows, pkg.windows, pkg.bonusAmount, pkg.betAttend, pkg.betFans,
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
  const row = await getActiveNaming(env.DB, clubId);
  if (!row) throw new HttpError(404, '该队没有生效冠名');
  const params = await loadNamingParams(env.DB);
  const remaining = Math.max(0, row.windows_remaining - 1);
  const penalty = round3(remaining * row.fee_per_window * params.terminatePenalty);
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
 *  opts.feeFactor = fee_mod 经营信号乘数（v6.12.0 D3，连乘积已终钳；缺省 1 与原行为逐字一致）。 */
export function windowNamingStatements(
  env: Env,
  row: NamingContractRow,
  season: number,
  windowSeq: number,
  attendRate: number,
  fansGrowth: number,
  opts: { feeFactor?: number } = {},
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
  // 对赌奖金：上座率或死忠增长率任一达线发全额（formula.py bet_bonus_due：纯流水，随账本闸幂等）
  if (
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
}

/** 热度规则（config market_heat_rules，JSON）：缺行或缺字段回默认（插件 market_heat_config 出厂值）。 */
export async function loadHeatRules(db: Env['DB']): Promise<HeatRules> {
  const defaults: HeatRules = { winStreak: 0.03, slump: 0.02, clampLow: 0.5, clampHigh: 1.5 };
  const config = createConfigService(db);
  const r = await config.getJson<Partial<HeatRules>>('market_heat_rules');
  if (r && [r.winStreak, r.slump, r.clampLow, r.clampHigh].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return r as HeatRules;
  }
  return defaults;
}

/** 近 3 场有效结果的胜负记号（弃权按 winner 记；点球决胜按平计——与 formPtsOf 战绩口径一致；
 *  无效行不计名额）。全胜 +winStreak / 全败 −slump / 其余（含不足 3 场）不动。 */
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
    if (r.walkover_side === 'home' || r.walkover_side === 'away') {
      const winnerId = r.walkover_side === 'home' ? r.home_team_id : r.away_team_id;
      marks.push(winnerId === tourTeamId ? 'W' : 'L');
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
