// 冠名市场（v2.6.0，规则=revenue 插件 README §七 + brand_service.py / window_service.py / formula.py:462）：
// 品牌池 7 家（无排他，多队可签同一品牌）；底价/窗口 = (基准 + 容量系数×容量万 + 死忠系数×死忠万) × 热度，
// 按签约时队况锁定整约；三套餐（稳健/进取/对赌）费用条款快照入合同；
// 提前解约赔剩余窗口费用 30%；窗末收租 + 对赌奖金并入关窗批（windowHomeStatements）。
// v1 不做：品牌主动解约/满意度、续约、品牌自定义套餐、LLM 生成品牌、行业系数（一律 1.0）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { getOpenWindow } from './seasons.ts';
import { createAuditStatement } from '../lib/audit.ts';

export interface BrandDef {
  brand: string;
  heat: number;
  industry: string;
}

export const DEFAULT_BRANDS: BrandDef[] = [
  { brand: '麒麟生物', heat: 1.2, industry: '医疗' },
  { brand: '阿迪达斯', heat: 1.1, industry: '运动' },
  { brand: '亚马逊', heat: 1.3, industry: '科技' },
  { brand: '可口可乐', heat: 1.0, industry: '饮食' },
  { brand: '海底捞', heat: 0.9, industry: '饮食' },
  { brand: '星海通讯', heat: 0.8, industry: '科技' },
  { brand: 'CVS Health', heat: 0.7, industry: '医疗' },
];

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

/** 品牌池报价：按本队队况逐品牌算底价与三套餐。 */
export function quoteBrands(p: NamingParams, capacity: number, fans: number): NamingQuote[] {
  return DEFAULT_BRANDS.map((b) => {
    const baseFee = namingBaseFee(p, capacity, fans, b.heat);
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
  const def = DEFAULT_BRANDS.find((b) => b.brand === brand);
  if (!def) throw new HttpError(400, `品牌「${brand}」不在品牌池`);
  if (await getActiveNaming(env.DB, clubId)) throw new HttpError(409, '已有生效冠名，先退约再签新约');
  const params = await loadNamingParams(env.DB);
  const baseFee = namingBaseFee(params, stadium.capacity, stadium.fans, def.heat);
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
        clubId, def.brand, def.heat, baseFee, pkg.packageNo, pkg.pkgName, pkg.feePerWindow,
        pkg.windows, pkg.windows, pkg.bonusAmount, pkg.betAttend, pkg.betFans, win.season, win.windowSeq, clubId,
      ),
  ]);
  if ((out[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '已有生效冠名，先退约再签新约');
  const row = await getActiveNaming(env.DB, clubId);
  if (!row) throw new HttpError(500, '冠名合同落库后读不回来');
  return row;
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
 *  attendRate/fansGrowth 由调用方传入（windowHomeStatements 循环里现成）。 */
export function windowNamingStatements(
  env: Env,
  row: NamingContractRow,
  season: number,
  windowSeq: number,
  attendRate: number,
  fansGrowth: number,
): ReturnType<Env['DB']['prepare']>[] {
  const refId = season * 100 + windowSeq;
  const statements = [
    ...ledgerMovement(env.DB, {
      clubId: row.club_id,
      delta: row.fee_per_window,
      kind: 'naming_fee',
      refType: 'window',
      refId,
      memo: `${row.brand} 冠名费（${row.pkg_name}套餐，剩 ${row.windows_remaining} 窗）`,
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
