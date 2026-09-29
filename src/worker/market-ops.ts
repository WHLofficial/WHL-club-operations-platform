// 招商轮（v6.14.0 C3）：品牌获取冠名的唯一通道（主动签约 signNaming 已退役）。
// 非临时窗的关窗批内：清盘旧轮（未签 pending → expired、整轮无人签的品牌热度 −0.03）→ 档位校准（home.ts 批首）
// → 批尾开新轮：名额未满（active 合同 + queued 接班合并计）的 adopted 品牌按档位策略定向递价
//   （头部盯估值最高 min(2,N) 队、新兴盯估值中游、口碑广撒优先零报价队——market_service._targeted_offers 口径；
//   偏离留痕：插件估值列表排除已有冠名队，本仓按用户裁决全员可收价，签时走换约二选一）。
//   套餐按档位：头部递进取（pkg 2）、其余稳健（pkg 1，插件 _brand_package 口径）。
// 报价金额 = 发放时的队况估值快照；签约 / 接班转正按快照入合同（费用条款整约锁定语义同 0024，不按签时队况重算）。
// 接班（queued）：有生效冠名的队签报价 → 现合同到期后自动接替（转正点：关窗批到期 / 球队退约 / 品牌侧解约）；
//   queued 与 active 合并计档位名额 ⇒ 转正只是 queued→active 迁移、合计不变，天然不超卖。
// 幂等口径：清盘 / 开轮 / 转正无独立闸，靠关窗批窗口状态原子闸（整批回滚）；accept 是即时批，
//   以 offer 行 `status='pending'` 当抢锁闸——批内后续语句全部以「offer 已 accepted / 旧约已 terminated」
//   为守卫，并发同刻只有一方能让第一句改行成功，其余整批零改行一致失败后抛 409。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createConfigService } from '../core/config.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { ledgerMovement } from './ledger.ts';
import { getOpenWindow } from './seasons.ts';
import {
  buildPackages,
  getActiveNaming,
  industryFactor,
  loadAdoptedBrands,
  loadHeatRules,
  loadIndustryFactors,
  loadNamingParams,
  loadTierRules,
  namingBaseFee,
  tierQuotaOf,
  type NamingContractRow,
} from './naming-ops.ts';

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---- 配置 ----

export interface RoundRules {
  offersPerBrand: number;
  offerTtlHours: number;
}

/** 招商轮规则（config market_round_rules，JSON）：逐字段兜底；ttl<=0 = 不设时限（关窗批清盘兜底）。 */
export async function loadRoundRules(db: Env['DB']): Promise<RoundRules> {
  const config = createConfigService(db);
  const r = await config.getJson<Partial<RoundRules>>('market_round_rules');
  const per = Number(r?.offersPerBrand);
  const ttl = Number(r?.offerTtlHours);
  return {
    offersPerBrand: Number.isFinite(per) && per >= 1 ? Math.trunc(per) : 3,
    offerTtlHours: Number.isFinite(ttl) && ttl >= 0 ? ttl : 72,
  };
}

// ---- 读取 ----

export interface MarketRoundRow {
  id: number;
  opened_season: number;
  opened_window: number;
  status: string;
  opened_at: string;
  settled_at: string | null;
}

export async function getOpenRound(db: Env['DB']): Promise<MarketRoundRow | null> {
  return db.prepare(`SELECT * FROM market_rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1`).first<MarketRoundRow>();
}

export interface ClubOfferRow {
  id: number;
  brand_id: number;
  club_id: number;
  package_no: number;
  amount: number;
  windows: number;
  package_json: string;
  status: string;
  created_at: string;
  expire_at: string;
  brand: string;
  tier: string;
  round_status: string;
}

/** 教练端收件箱：本队待签（pending 且所在轮 open）+ 排队接班（queued）的报价。 */
export async function listClubOffers(db: Env['DB'], clubId: number): Promise<ClubOfferRow[]> {
  return (
    await db
      .prepare(
        `SELECT o.id, o.brand_id, o.club_id, o.package_no, o.amount, o.windows, o.package_json,
                o.status, o.created_at, o.expire_at, b.brand, b.tier, r.status AS round_status
         FROM market_offers o
         JOIN brand_pool b ON b.id = o.brand_id
         JOIN market_rounds r ON r.id = o.round_id
         WHERE o.club_id = ? AND ((o.status = 'pending' AND r.status = 'open') OR o.status = 'queued')
         ORDER BY o.id DESC`,
      )
      .bind(clubId)
      .all<ClubOfferRow>()
  ).results;
}

// ---- 定向递价（纯函数，插件 _targeted_offers / _brand_package 口径） ----

/** 套餐按档位：头部大牌只做短约（进取），新兴 / 口碑走稳健。 */
export function packageNoForTier(tier: string): 1 | 2 {
  return tier === '头部' ? 2 : 1;
}

/** 品牌挑队策略（valuations 已按估值降序；offeredTeams 是本轮已被其它品牌递过价的队）：
 *  头部盯估值最高 min(2, N) 队；新兴盯中游 N 队；口碑广撒——优先零报价队兜底再按估值补位。 */
export function pickTargetsForBrand(
  tier: string,
  valuations: { clubId: number }[],
  perBrand: number,
  offeredTeams: Set<number>,
): number[] {
  if (valuations.length === 0) return [];
  if (tier === '头部') return valuations.slice(0, Math.min(2, perBrand)).map((v) => v.clubId);
  if (tier === '新兴') {
    const mid = Math.floor(valuations.length / 2);
    const start = Math.max(0, mid - 1);
    return valuations.slice(start, start + perBrand).map((v) => v.clubId);
  }
  const zero = valuations.filter((v) => !offeredTeams.has(v.clubId));
  const rest = valuations.filter((v) => offeredTeams.has(v.clubId));
  return [...zero, ...rest].slice(0, perBrand).map((v) => v.clubId);
}

// ---- 轮生命周期（关窗批语句段） ----

export interface RoundBuild {
  /** 清盘段：未签 pending 作废 + 整轮无人签品牌热度 −ignored + 轮置 settled。批首（档位校准之前）执行。 */
  settleStatements: ReturnType<Env['DB']['prepare']>[];
  /** 开轮段：新轮 INSERT + 定向报价 INSERT（round_id 用批内标量子查询取刚开的轮）。批尾执行。 */
  openStatements: ReturnType<Env['DB']['prepare']>[];
  hadOpenRound: boolean;
  offerCount: number;
  /** 逐队收价汇总（批后 naming_offer 通知供料）。 */
  offersPerClub: { clubId: number; brands: string[] }[];
}

/**
 * 招商轮一次开清（关窗批用）：清盘旧轮 → （调用方在同批中间跑档位校准）→ 开新轮定向递价。
 * 报价金额按当刻队况估值快照（本批 fans 演化尚未提交，差异为窗内死忠增量、可忽略——整批原子）。
 * 开轮语句里 round_id 走 `(SELECT id FROM market_rounds WHERE status='open')`：批内逐句执行，
 * 新轮 INSERT 在前、报价 INSERT 在后；并发下窗口状态原子闸保证只有一个批能提交。
 */
export async function buildRoundStatements(env: Env, season: number, windowSeq: number): Promise<RoundBuild> {
  const db = env.DB;
  const [rules, params, factors] = await Promise.all([loadRoundRules(db), loadNamingParams(db), loadIndustryFactors(db)]);
  const open = await getOpenRound(db);
  const settleStatements: ReturnType<Env['DB']['prepare']>[] = [];
  if (open) {
    // 未签 pending 一律作废（静默不发通知——插件清盘同口径；已 accepted/queued 的合同不受影响）
    settleStatements.push(
      db.prepare(`UPDATE market_offers SET status = 'expired' WHERE round_id = ? AND status = 'pending'`).bind(open.id),
    );
    // 整轮无人签约的品牌被冷落：热度 −ignored（SQL 侧钳制累加，与 windowBrandHeatStatement 同形）
    const heatRules = await loadHeatRules(db);
    settleStatements.push(
      db
        .prepare(
          `UPDATE brand_pool SET heat = MAX(?, MIN(?, ROUND(heat + ?, 3)))
           WHERE status = 'adopted'
             AND id IN (SELECT brand_id FROM market_offers WHERE round_id = ?)
             AND id NOT IN (SELECT brand_id FROM market_offers WHERE round_id = ? AND status IN ('accepted', 'queued'))`,
        )
        .bind(heatRules.clampLow, heatRules.clampHigh, heatRules.ignored, open.id, open.id),
    );
    settleStatements.push(
      db.prepare(`UPDATE market_rounds SET status = 'settled', settled_at = ${nowSql} WHERE id = ? AND status = 'open'`).bind(open.id),
    );
  }

  // 开新轮：名额未满（active 合同 + queued 接班合并计）的 adopted 品牌才出手
  const [brands, stadiums, activeRows, queuedRows, tierRules] = await Promise.all([
    loadAdoptedBrands(db),
    db.prepare('SELECT club_id, capacity, fans FROM stadiums').all<{ club_id: number; capacity: number; fans: number }>(),
    db.prepare(`SELECT brand, COUNT(*) AS n FROM naming_contracts WHERE status = 'active' GROUP BY brand`).all<{ brand: string; n: number }>(),
    db.prepare(`SELECT brand_id, COUNT(*) AS n FROM market_offers WHERE status = 'queued' GROUP BY brand_id`).all<{ brand_id: number; n: number }>(),
    loadTierRules(db),
  ]);
  const activeCount = new Map(activeRows.results.map((r) => [r.brand, r.n]));
  const queuedCount = new Map(queuedRows.results.map((r) => [r.brand_id, r.n]));
  const sellers = brands.filter((b) => {
    const quota = tierQuotaOf(b.tier, tierRules);
    if (quota === null) return true;
    return (activeCount.get(b.brand) ?? 0) + (queuedCount.get(b.id) ?? 0) < quota;
  });

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expireAt = rules.offerTtlHours > 0 ? new Date(now + rules.offerTtlHours * 3_600_000).toISOString() : '9999-12-31T00:00:00.000Z';
  const offeredTeams = new Set<number>();
  interface OfferRow {
    brandId: number;
    clubId: number;
    pkgNo: number;
    amount: number;
    windows: number;
    pkgJson: string;
  }
  const rows: OfferRow[] = [];
  for (const b of sellers) {
    const valuations = stadiums.results
      .map((s) => ({
        clubId: s.club_id,
        // 估值 = 冠名底价公式（×热度已在 namingBaseFee 内）× 行业系数，降序（插件 _valuations 同口径）
        fee: round3(namingBaseFee(params, s.capacity, s.fans, b.heat) * industryFactor(factors, b.industry)),
      }))
      .sort((x, y) => y.fee - x.fee);
    const targets = pickTargetsForBrand(b.tier, valuations, rules.offersPerBrand, offeredTeams);
    const pkgNo = packageNoForTier(b.tier);
    for (const clubId of targets) {
      offeredTeams.add(clubId);
      const fee = valuations.find((v) => v.clubId === clubId)!.fee;
      const pkg = buildPackages(params, fee)[pkgNo - 1]!;
      rows.push({
        brandId: b.id,
        clubId,
        pkgNo,
        amount: pkg.feePerWindow,
        windows: pkg.windows,
        pkgJson: JSON.stringify({
          slot: 'naming',
          pkgName: pkg.pkgName,
          baseFee: fee, // 底价快照（估值 = 底价公式 × 行业系数），入合同 base_fee 列（口径同 signNaming 时代）
          bonusAmount: pkg.bonusAmount,
          betAttend: pkg.betAttend,
          betFans: pkg.betFans,
          brandHeat: b.heat,
        }),
      });
    }
  }
  const openStatements: ReturnType<Env['DB']['prepare']>[] = [
    db
      .prepare(`INSERT INTO market_rounds (opened_season, opened_window, status, opened_at) VALUES (?, ?, 'open', ${nowSql})`)
      .bind(season, windowSeq),
  ];
  // 报价 INSERT 分块多 VALUES（D1 绑定参数上限 100：每块 10 行 × 8 参数留余量）；
  // round_id 用标量子查询取本批刚开的轮（此时旧轮已 settled，open 的只有新轮）
  for (let i = 0; i < rows.length; i += 10) {
    const slice = rows.slice(i, i + 10);
    openStatements.push(
      db
        .prepare(
          `INSERT INTO market_offers (round_id, brand_id, club_id, package_no, amount, windows, package_json, status, created_at, expire_at)
           VALUES ${slice.map(() => `((SELECT id FROM market_rounds WHERE status = 'open'), ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).join(', ')}`,
        )
        .bind(...slice.flatMap((r) => [r.brandId, r.clubId, r.pkgNo, r.amount, r.windows, r.pkgJson, createdAt, expireAt])),
    );
  }
  const perClub = new Map<number, string[]>();
  for (const r of rows) {
    const name = brands.find((b) => b.id === r.brandId)?.brand ?? `品牌#${r.brandId}`;
    const list = perClub.get(r.clubId) ?? [];
    list.push(name);
    perClub.set(r.clubId, list);
  }
  return {
    settleStatements,
    openStatements,
    hadOpenRound: open !== null,
    offerCount: rows.length,
    offersPerClub: [...perClub].map(([clubId, brandList]) => ({ clubId, brands: brandList })),
  };
}

// ---- 接班转正（queued → active） ----

export interface QueuedActivation {
  clubId: number;
  offerId: number;
  brand: string;
  feePerWindow: number;
  windows: number;
  pkgName: string;
}

/**
 * 全部队的接班转正语句（关窗批收租/演化之后调用——本窗到期的合同已 expired、守卫自然放行；
 * 球队退约 / 品牌侧解约后也可单队调用）。转正前提：该队 queued 报价 + 无 active 冠名；
 * 合同按报价快照入账（金额/窗数/套餐条款都是发放时锁定），INSERT 与 offer 状态 UPDATE 互为守卫。
 * 名额不复查：queued 与 active 合并计名额，转正只是迁移、合计不变。
 */
export async function activateQueuedStatements(
  env: Env,
  season: number,
  windowSeq: number,
  origin: AuditOrigin,
  actor: number | null,
  clubIds?: number[],
): Promise<{ statements: ReturnType<Env['DB']['prepare']>[]; activated: QueuedActivation[] }> {
  const db = env.DB;
  const scope = clubIds && clubIds.length > 0 ? ` AND o.club_id IN (${clubIds.map(() => '?').join(',')})` : '';
  const queued = (
    await db
      .prepare(
        `SELECT o.id, o.club_id, o.package_no, o.amount, o.windows, o.package_json, b.brand
         FROM market_offers o JOIN brand_pool b ON b.id = o.brand_id
         WHERE o.status = 'queued'${scope} ORDER BY o.id`,
      )
      .bind(...(clubIds ?? []))
      .all<{ id: number; club_id: number; package_no: number; amount: number; windows: number; package_json: string; brand: string }>()
  ).results;
  if (queued.length === 0) return { statements: [], activated: [] };
  const actives = new Set(
    (await db.prepare(`SELECT DISTINCT club_id FROM naming_contracts WHERE status = 'active'`).all<{ club_id: number }>()).results.map(
      (r) => r.club_id,
    ),
  );
  const audit = createAuditStatement(db);
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  const activated: QueuedActivation[] = [];
  for (const q of queued) {
    if (actives.has(q.club_id)) continue; // 仍有生效冠名（演化解约被并发抢先等），留在 queued 等下一次
    const snap = parsePkgJson(q.package_json, q.package_no, q.amount);
    activated.push({ clubId: q.club_id, offerId: q.id, brand: q.brand, feePerWindow: q.amount, windows: q.windows, pkgName: snap.pkgName });
    statements.push(
      // 先占坑：offer queued→accepted（NOT EXISTS active 挡跨批竞态——别批刚插了 active 合同则本队不再转正）
      db
        .prepare(
          `UPDATE market_offers SET status = 'accepted'
           WHERE id = ? AND status = 'queued'
             AND NOT EXISTS (SELECT 1 FROM naming_contracts WHERE club_id = ? AND status = 'active')`,
        )
        .bind(q.id, q.club_id),
      db
        .prepare(
          `INSERT INTO naming_contracts
           (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
            windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status,
            started_season, started_window, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ${nowSql}, ${nowSql}
           WHERE NOT EXISTS (SELECT 1 FROM naming_contracts WHERE club_id = ? AND status = 'active')
             AND (SELECT status FROM market_offers WHERE id = ?) = 'accepted'`,
        )
        .bind(
          q.club_id, q.brand, snap.brandHeat, snap.baseFee, q.package_no, snap.pkgName, q.amount,
          q.windows, q.windows, snap.bonusAmount, snap.betAttend, snap.betFans,
          season, windowSeq, q.club_id, q.id,
        ),
      audit({
        actor,
        action: 'naming_activated',
        targetType: 'market_offer',
        targetId: q.id,
        origin,
        after: { clubId: q.club_id, brand: q.brand, feePerWindow: q.amount, windows: q.windows, pkgName: snap.pkgName },
        guardSql: `(SELECT status FROM market_offers WHERE id = ?) = 'accepted'`,
        guardParams: [q.id],
      }),
    );
  }
  return { statements, activated };
}

interface OfferSnapshot {
  pkgName: string;
  baseFee: number;
  bonusAmount: number;
  betAttend: number | null;
  betFans: number | null;
  brandHeat: number;
}

function parsePkgJson(raw: string, packageNo: number, amountFallback: number): OfferSnapshot {
  const fallback: OfferSnapshot = {
    pkgName: packageNo === 2 ? '进取' : packageNo === 3 ? '对赌' : '稳健',
    baseFee: amountFallback,
    bonusAmount: 0,
    betAttend: null,
    betFans: null,
    brandHeat: 1,
  };
  try {
    const p = JSON.parse(raw) as Partial<OfferSnapshot> | null;
    if (!p || typeof p !== 'object') return fallback;
    return {
      pkgName: typeof p.pkgName === 'string' ? p.pkgName : fallback.pkgName,
      baseFee: typeof p.baseFee === 'number' && Number.isFinite(p.baseFee) ? p.baseFee : fallback.baseFee,
      bonusAmount: typeof p.bonusAmount === 'number' && Number.isFinite(p.bonusAmount) ? p.bonusAmount : 0,
      betAttend: typeof p.betAttend === 'number' && Number.isFinite(p.betAttend) ? p.betAttend : null,
      betFans: typeof p.betFans === 'number' && Number.isFinite(p.betFans) ? p.betFans : null,
      brandHeat: typeof p.brandHeat === 'number' && Number.isFinite(p.brandHeat) ? p.brandHeat : fallback.brandHeat,
    };
  } catch {
    return fallback;
  }
}

// ---- 签报价（教练端，即时批） ----

export type AcceptMode = 'queued' | 'terminate';

export interface AcceptOfferResult {
  result: 'signed' | 'queued' | 'terminated';
  contract: NamingContractRow | null;
  penalty: number;
}

interface OfferDetail {
  id: number;
  brand_id: number;
  club_id: number;
  package_no: number;
  amount: number;
  windows: number;
  package_json: string;
  status: string;
  expire_at: string;
  round_status: string;
  brand: string;
  tier: string;
}

/**
 * 签一份招商报价：无生效冠名 → 立即成约（signed）；有生效冠名 → 必须二选一：
 * `queued` = 现合同到期后自动接替（同队 queued 唯一索引拦重复接班）；
 * `terminate` = 先按既有口径退约（赔剩余窗口费用，立即批同批原子）再签新约。
 * 批内抢锁顺序：offer pending→accepted（queued 分支 pending→queued）→ 其余语句全部以
 * 「offer 已被本批改写 + （terminate）旧约已被本批终止」为守卫 ⇒ 并发同刻只有一方整批生效。
 */
export async function acceptOffer(
  env: Env,
  offerId: number,
  clubId: number,
  modeInput: unknown,
  actor: number | null,
): Promise<AcceptOfferResult> {
  const db = env.DB;
  const offer = await db
    .prepare(
      `SELECT o.id, o.brand_id, o.club_id, o.package_no, o.amount, o.windows, o.package_json,
              o.status, o.expire_at, r.status AS round_status, b.brand, b.tier
       FROM market_offers o
       JOIN market_rounds r ON r.id = o.round_id
       JOIN brand_pool b ON b.id = o.brand_id
       WHERE o.id = ?`,
    )
    .bind(offerId)
    .first<OfferDetail>();
  if (!offer) throw new HttpError(404, '报价不存在');
  if (offer.club_id !== clubId) throw new HttpError(403, '这份报价不是递给你们队的');
  if (offer.status === 'expired') throw new HttpError(409, '报价已过期');
  if (offer.status !== 'pending') throw new HttpError(409, '这份报价已处理过');
  if (offer.expire_at < new Date().toISOString()) {
    // 惰性落态（尽力而为）：过期报价读得到就标记掉，别让下一位再撞上
    await db.prepare(`UPDATE market_offers SET status = 'expired' WHERE id = ? AND status = 'pending'`).bind(offerId).run();
    throw new HttpError(409, '报价已过有效期');
  }
  if (offer.round_status !== 'open') throw new HttpError(409, '招商轮已关闭，签不了这份报价');

  const active = await getActiveNaming(db, clubId);
  const win = await getOpenWindow(db);
  const mode: AcceptMode | null = active ? (modeInput === 'queued' || modeInput === 'terminate' ? modeInput : null) : null;
  if (active && mode === null) {
    throw new HttpError(400, '已有生效冠名：签新报价请选择「到期后自动接替」或「解约当前并签新」');
  }
  if (!active && !win) throw new HttpError(409, '转会窗口没开，签不了冠名合同');

  const [tierRules, heatRules] = await Promise.all([loadTierRules(db), loadHeatRules(db)]);
  const quota = tierQuotaOf(offer.tier, tierRules);
  // 名额预检 409（明确文案，C2 TC-QUOTA-02 口径）：active 合同（按品牌名）+ queued 接班（按品牌 id）
  // 合并计数——本报价此刻仍是 pending、不进计数；真正防线是下方各语句里的原子守卫
  if (quota !== null) {
    const used = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM naming_contracts WHERE brand = ? AND status = 'active')
              + (SELECT COUNT(*) FROM market_offers WHERE brand_id = ? AND status = 'queued') AS n`,
      )
      .bind(offer.brand, offer.brand_id)
      .first<{ n: number }>();
    if ((used?.n ?? 0) >= quota) throw new HttpError(409, `品牌「${offer.brand}」档位名额已满（${offer.tier}档限 ${quota} 队）`);
  }
  const snap = parsePkgJson(offer.package_json, offer.package_no, offer.amount);
  const audit = createAuditStatement(db);
  // 名额原子守卫：active 合同（按品牌名）+ queued 接班（按品牌 id）合并计数，口碑档不限额时不加——
  // bind 0 会让 COUNT < 0 恒假（tests/naming-tiers TC-QUOTA-04 同一坑）
  const quotaGuard =
    quota === null
      ? ''
      : ` AND (SELECT COUNT(*) FROM naming_contracts WHERE brand = (SELECT brand FROM brand_pool WHERE id = ?) AND status = 'active')
            + (SELECT COUNT(*) FROM market_offers WHERE brand_id = ? AND status = 'queued') < ?`;
  const quotaParams = quota === null ? [] : [offer.brand_id, offer.brand_id, quota];

  if (active && mode === 'queued') {
    const statements = [
      db
        .prepare(
          `UPDATE market_offers SET status = 'queued'
           WHERE id = ? AND status = 'pending'${quotaGuard}`,
        )
        .bind(offerId, ...quotaParams),
      audit({
        actor,
        action: 'naming_offer_accept',
        targetType: 'market_offer',
        targetId: offerId,
        origin: 'user',
        before: { mode: 'queued', oldContractId: active.id, oldBrand: active.brand },
        after: { brand: offer.brand, feePerWindow: offer.amount, windows: offer.windows, packageNo: offer.package_no, queued: true },
        guardSql: `(SELECT status FROM market_offers WHERE id = ?) = 'queued'`,
        guardParams: [offerId],
      }),
    ];
    const outs = await db.batch(statements);
    if ((outs[0]?.meta.changes ?? 0) === 0) {
      throw new HttpError(409, '接班位刚被占用或名额已满，请刷新后重试');
    }
    return { result: 'queued', contract: null, penalty: 0 };
  }

  // signed / terminate：立即成约（terminate 先在同批退掉现约并收赔偿）
  if (!win) throw new HttpError(409, '转会窗口没开，签不了冠名合同');
  const params = await loadNamingParams(db);
  let penalty = 0;
  const terminateStatements: ReturnType<Env['DB']['prepare']>[] = [];
  if (active && mode === 'terminate') {
    const remaining = Math.max(0, active.windows_remaining - 1);
    penalty = round3(remaining * active.fee_per_window * params.terminatePenalty);
    terminateStatements.push(
      db
        .prepare(
          `UPDATE naming_contracts SET status = 'terminated', ended_season = ?, ended_window = ?, updated_at = ${nowSql}
           WHERE id = ? AND status = 'active'`,
        )
        .bind(win.season, win.windowSeq, active.id),
    );
    if (penalty > 0) {
      terminateStatements.push(
        ...ledgerMovement(db, {
          clubId,
          delta: -penalty,
          kind: 'naming_penalty',
          refType: 'naming',
          refId: active.id,
          memo: `换签解约赔款（${active.brand}，剩 ${remaining} 窗 × ${active.fee_per_window}M × ${params.terminatePenalty}）`,
          idempotent: false,
          // 只在上一句真把旧约改成 terminated 时入账（并发下不收冤枉钱）
          guardSql: `(SELECT status FROM naming_contracts WHERE id = ?) = 'terminated'`,
          guardParams: [active.id],
        }),
      );
    }
  }
  const statements = [
    // 抢锁：并发同刻只一方能把 pending 改掉，后续语句全部守卫假
    db.prepare(`UPDATE market_offers SET status = 'accepted' WHERE id = ? AND status = 'pending'`).bind(offerId),
    ...terminateStatements,
    db
      .prepare(
        `INSERT INTO naming_contracts
         (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
          windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status,
          started_season, started_window, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ${nowSql}, ${nowSql}
         WHERE (SELECT status FROM market_offers WHERE id = ?) = 'accepted'
           AND NOT EXISTS (SELECT 1 FROM naming_contracts WHERE club_id = ? AND status = 'active')${quotaGuard}${
          active ? ` AND (SELECT status FROM naming_contracts WHERE id = ?) = 'terminated'` : ''
        }`,
      )
      .bind(
        clubId, offer.brand, snap.brandHeat, snap.baseFee, offer.package_no, snap.pkgName, offer.amount,
        offer.windows, offer.windows, snap.bonusAmount, snap.betAttend, snap.betFans,
        win.season, win.windowSeq,
        offerId, clubId, ...quotaParams, ...(active ? [active.id] : []),
      ),
    // 签约成交：品牌热度 +deal（SQL 侧钳制累加；守卫钉在 offer 状态上，抢输方不动热度）
    db
      .prepare(
        `UPDATE brand_pool SET heat = MAX(?, MIN(?, ROUND(heat + ?, 3)))
         WHERE id = ? AND status = 'adopted' AND (SELECT status FROM market_offers WHERE id = ?) = 'accepted'`,
      )
      .bind(heatRules.clampLow, heatRules.clampHigh, heatRules.deal, offer.brand_id, offerId),
    audit({
      actor,
      action: 'naming_offer_accept',
      targetType: 'market_offer',
      targetId: offerId,
      origin: 'user',
      before: active ? { mode, oldContractId: active.id, oldBrand: active.brand } : { mode: 'signed' },
      after: {
        brand: offer.brand,
        feePerWindow: offer.amount,
        windows: offer.windows,
        packageNo: offer.package_no,
        ...(penalty > 0 ? { penalty } : {}),
      },
      guardSql: `(SELECT status FROM market_offers WHERE id = ?) = 'accepted'`,
      guardParams: [offerId],
    }),
  ];
  const outs = await db.batch(statements);
  if ((outs[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '报价刚被处理过，请刷新');
  const contractIdx = terminateStatements.length + 1;
  if ((outs[contractIdx]?.meta.changes ?? 0) === 0) {
    throw new HttpError(409, active ? '换签刚被并发改动，请重试' : '已有生效冠名或名额已满，请刷新后重试');
  }
  const contract = await getActiveNaming(db, clubId);
  if (!contract) throw new HttpError(500, '冠名合同落库后读不回来');
  return { result: active ? 'terminated' : 'signed', contract, penalty };
}

// ---- 事件上门（offer_spawn 效果落库，event-ops 调用） ----

export interface VisitSpawn {
  statements: ReturnType<Env['DB']['prepare']>[];
  notes: string[];
  applied: { brand: string; amount: number; windows: number } | null;
}

/**
 * offer_spawn：从 adopted 且无生效冠名的品牌按热度加权挑一家，向触发球队递稳健套餐报价挂当前开放轮。
 * 候选空 / 无开放轮 / 撞 (round, brand, club) 待处理唯一键 → 落空播报（插件同文案，不谎报递价成功）。
 * `guardSql` 由调用方传（事件效果的 occurrence pending 守卫，单一真源在 event-ops）。
 * INSERT 在本函数内独立执行（效果批组装期就要定 notes 文案；occ 此刻仍 pending、守卫有效；
 * 效果批若整体失败重放，NOT EXISTS 守卫挡住重复递价，只会再播一次落空）。
 */
export async function spawnVisitOffer(
  env: Env,
  club: { clubId: number; capacity: number; fans: number },
  occurrenceId: number,
  guardSql: string,
): Promise<VisitSpawn> {
  const db = env.DB;
  const open = await getOpenRound(db);
  if (!open) return { statements: [], notes: ['当前无开放招商轮次，品牌上门落空'], applied: null };
  const candidates = (
    await db
      .prepare(
        `SELECT b.id, b.brand, b.heat, b.industry FROM brand_pool b
         WHERE b.status = 'adopted'
           AND NOT EXISTS (SELECT 1 FROM naming_contracts nc WHERE nc.brand = b.brand AND nc.status = 'active')
         ORDER BY b.id`,
      )
      .all<{ id: number; brand: string; heat: number; industry: string }>()
  ).results;
  if (candidates.length === 0) return { statements: [], notes: ['品牌池里没有可上门的品牌，本次落空'], applied: null };
  const rng = env.rng ?? Math.random;
  const total = candidates.reduce((s, b) => s + Math.max(b.heat, 0), 0);
  let x = rng() * total;
  let picked = candidates[candidates.length - 1]!;
  for (const b of candidates) {
    x -= Math.max(b.heat, 0);
    if (x < 0) {
      picked = b;
      break;
    }
  }
  const [params, factors, rules] = await Promise.all([loadNamingParams(db), loadIndustryFactors(db), loadRoundRules(db)]);
  const fee = round3(namingBaseFee(params, club.capacity, club.fans, picked.heat) * industryFactor(factors, picked.industry));
  const pkg = buildPackages(params, fee)[0]!; // 稳健套餐（插件 offer_spawn 取 packages[0] 同口径）
  const expireAt = rules.offerTtlHours > 0 ? new Date(Date.now() + rules.offerTtlHours * 3_600_000).toISOString() : '9999-12-31T00:00:00.000Z';
  const out = await db
    .prepare(
      `INSERT INTO market_offers (round_id, brand_id, club_id, package_no, amount, windows, package_json, status, created_at, expire_at)
       SELECT ?, ?, ?, 1, ?, ?, ?, 'pending', ${nowSql}, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM market_offers WHERE round_id = ? AND brand_id = ? AND club_id = ? AND status = 'pending'
       ) AND ${guardSql}`,
    )
    .bind(
      open.id, picked.id, club.clubId, pkg.feePerWindow, pkg.windows,
      JSON.stringify({ slot: 'naming', pkgName: pkg.pkgName, baseFee: fee, bonusAmount: pkg.bonusAmount, betAttend: pkg.betAttend, betFans: pkg.betFans, brandHeat: picked.heat }),
      expireAt, open.id, picked.id, club.clubId, occurrenceId,
    )
    .run();
  if ((out.meta.changes ?? 0) === 0) {
    return {
      statements: [],
      notes: [`品牌「${picked.brand}」已有待处理的上门报价，本次落空`],
      applied: null,
    };
  }
  return {
    statements: [],
    notes: [`品牌「${picked.brand}」上门递价：${pkg.feePerWindow}M/窗 × ${pkg.windows} 窗（${pkg.pkgName}），冠名市场可签`],
    applied: { brand: picked.brand, amount: pkg.feePerWindow, windows: pkg.windows },
  };
}
