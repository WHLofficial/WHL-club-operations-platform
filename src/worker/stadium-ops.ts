// 设施经营（增量 19，规则=revenue 插件 README §三/§四 + TECH_DESIGN §8/§13）：
// 球场扩建（100 座步进、限当前档位座位区间）/ 球场升级（容量≥新档下限 + 开放进度闸）/
// 子设施升级（五类 0-5 级）。建设支出全额 ×voucher_refund 返建设券，券仅可抵扣后续建设
// 支出（先券后钱）；混合支付时账本只记现金部分，memo 注明券抵。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { ledgerMovement } from './ledger.ts';
import { loadTierTable, type TierEntry } from './home.ts';
import { createConfigService } from '../core/config.ts';

export const FACILITY_KEYS = ['commercial', 'broadcast', 'pitch', 'youth', 'medical'] as const;
export type FacilityKey = (typeof FACILITY_KEYS)[number];

export const EXPANSION_STEP = 100;

interface StadiumBuildRow {
  club_id: number;
  capacity: number;
  tier: number;
  build_credit: number;
}

async function loadStadium(db: Env['DB'], clubId: number): Promise<StadiumBuildRow> {
  const row = await db
    .prepare('SELECT club_id, capacity, tier, build_credit FROM stadiums WHERE club_id = ?')
    .bind(clubId)
    .first<StadiumBuildRow>();
  if (!row) throw new HttpError(404, '俱乐部还没有球场档案');
  return row;
}

export async function loadBalance(db: Env['DB'], clubId: number): Promise<number> {
  const row = await db.prepare('SELECT balance FROM ledger_accounts WHERE club_id = ?').bind(clubId).first<{ balance: number }>();
  return row?.balance ?? 0;
}

// facility_prices："0.1,3,5,8,12,16" —— 首位=扩建单价（M/100 座），后五位=子设施升到 1-5 级费用
export interface FacilityPrices {
  expansionPer100: number;
  upgradeCosts: number[]; // index = 当前级（升到 level+1 的费用）
}

export async function loadFacilityPrices(db: Env['DB']): Promise<FacilityPrices> {
  const config = createConfigService(db);
  const list = await config.getNumberList('facility_prices');
  if (!list || list.length < 6 || list.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new HttpError(409, '设施价格表（facility_prices）未配置或不完整');
  }
  return { expansionPer100: list[0]!, upgradeCosts: list.slice(1, 6) };
}

async function loadMaxOpenTier(db: Env['DB']): Promise<number> {
  const config = createConfigService(db);
  const n = await config.getNumber('stadium_max_open_tier');
  return n === null ? 1 : Math.floor(n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 建设支付拆分：先券后钱。返回实付现金与券消耗（券最多抵到费用额）。 */
export function splitPayment(cost: number, credit: number): { creditUsed: number; cash: number } {
  const creditUsed = round2(Math.min(Math.max(credit, 0), cost));
  return { creditUsed, cash: round2(cost - creditUsed) };
}

/** 建设券返还：建设支出全额 × 返还比例（voucher_refund，默认 0.25）。 */
export function creditRefund(cost: number, ratio: number): number {
  return round2(cost * ratio);
}

function tierEntryOf(tierTable: Record<string, TierEntry>, tier: number): TierEntry {
  const entry = tierTable[String(tier)];
  if (!entry) throw new HttpError(409, `球场档位表（tier_table）缺第 ${tier} 档配置`);
  return entry;
}

/** 资金检查 + 券拆分 + 返券计算（读侧；写侧语句由调用方组 batch）。 */
async function payAndRefund(
  env: Env,
  clubId: number,
  cost: number,
  credit: number,
  refundRatio: number,
): Promise<{ creditUsed: number; cash: number; refund: number }> {
  const { creditUsed, cash } = splitPayment(cost, credit);
  const balance = await loadBalance(env.DB, clubId);
  if (balance < cash) {
    throw new HttpError(400, `资金不够：还需现金 ${cash.toFixed(2)}M（建设券已抵 ${creditUsed.toFixed(2)}M），当前余额 ${balance.toFixed(2)}M`);
  }
  const refund = creditRefund(cost, refundRatio);
  return { creditUsed, cash, refund };
}

/** 球场扩建：seats 必须是 100 的正整数倍，扩建后不超当前档位座位上限。 */
export async function expandStadium(
  env: Env,
  clubId: number,
  seats: number,
): Promise<{ cost: number; creditUsed: number; cash: number; refund: number; capacity: number }> {
  if (!Number.isInteger(seats) || seats <= 0 || seats % EXPANSION_STEP !== 0) {
    throw new HttpError(400, `扩建量必须是 ${EXPANSION_STEP} 座的整数倍`);
  }
  const [stadium, prices] = await Promise.all([loadStadium(env.DB, clubId), loadFacilityPrices(env.DB)]);
  const tierTable = await loadTierTable(env.DB);
  const tierEntry = tierEntryOf(tierTable, stadium.tier);
  const nextCapacity = stadium.capacity + seats;
  if (nextCapacity > tierEntry.max_seats) {
    throw new HttpError(400, `超出当前档位（${tierEntry.name}）座位上限 ${tierEntry.max_seats} 座，先升级球场档位`);
  }
  const config = createConfigService(env.DB);
  const cost = round2((seats / EXPANSION_STEP) * prices.expansionPer100);
  const ratio = (await config.getNumber('voucher_refund')) ?? 0.25;
  const { creditUsed, cash, refund } = await payAndRefund(env, clubId, cost, stadium.build_credit, ratio);

  const statements = [
    ...ledgerMovement(env.DB, {
      clubId,
      delta: -cash,
      kind: 'stadium_expand',
      refType: 'stadium',
      refId: clubId,
      memo: `球场扩建 +${seats} 座（费用 ${cost.toFixed(2)}M${creditUsed > 0 ? `，建设券抵 ${creditUsed.toFixed(2)}M` : ''}）`,
      idempotent: false, // 玩家主动操作可重复发生，不开 kind+ref 查重闸
    }),
    env.DB
      .prepare(
        `UPDATE stadiums SET capacity = capacity + ?, build_credit = build_credit - ? + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE club_id = ? AND capacity + ? <= ?`,
      )
      .bind(seats, creditUsed, refund, clubId, seats, tierEntry.max_seats),
  ];
  const outs = await env.DB.batch(statements);
  if ((outs[outs.length - 1]?.meta.changes ?? 0) === 0) throw new HttpError(409, '扩建落库被拦（座位区间校验未过或并发改动），请重试');
  return { cost, creditUsed, cash, refund, capacity: nextCapacity };
}

/** 球场升级：容量 ≥ 新档下限；新档不得超过开放进度（stadium_max_open_tier）。 */
export async function upgradeStadiumTier(
  env: Env,
  clubId: number,
): Promise<{ cost: number; creditUsed: number; cash: number; refund: number; tier: number }> {
  const stadium = await loadStadium(env.DB, clubId);
  const tierTable = await loadTierTable(env.DB);
  const tierEntry = tierEntryOf(tierTable, stadium.tier);
  const nextEntry = tierTable[String(stadium.tier + 1)];
  if (!nextEntry) throw new HttpError(400, `已是最高档位（${tierEntry.name}），无法再升级`);
  const maxOpenTier = await loadMaxOpenTier(env.DB);
  if (stadium.tier + 1 > maxOpenTier) {
    throw new HttpError(400, `第 ${stadium.tier + 1} 档暂未开放（当前开放到第 ${maxOpenTier} 档）`);
  }
  if (stadium.capacity < nextEntry.min_seats) {
    throw new HttpError(400, `容量不足：升入${nextEntry.name}至少要 ${nextEntry.min_seats} 座，先扩建`);
  }
  const config = createConfigService(env.DB);
  const cost = round2(tierEntry.upgrade_cost);
  const ratio = (await config.getNumber('voucher_refund')) ?? 0.25;
  const { creditUsed, cash, refund } = await payAndRefund(env, clubId, cost, stadium.build_credit, ratio);

  const statements = [
    ...ledgerMovement(env.DB, {
      clubId,
      delta: -cash,
      kind: 'stadium_upgrade',
      refType: 'stadium',
      refId: clubId,
      memo: `球场升级 → ${nextEntry.name}（费用 ${cost.toFixed(2)}M${creditUsed > 0 ? `，建设券抵 ${creditUsed.toFixed(2)}M` : ''}）`,
      idempotent: false, // 玩家主动操作可重复发生，不开 kind+ref 查重闸
    }),
    env.DB
      .prepare(
        `UPDATE stadiums SET tier = tier + 1, build_credit = build_credit - ? + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE club_id = ? AND tier = ?`,
      )
      .bind(creditUsed, refund, clubId, stadium.tier),
  ];
  const outs = await env.DB.batch(statements);
  if ((outs[outs.length - 1]?.meta.changes ?? 0) === 0) throw new HttpError(409, '升级落库被拦（档位已被并发改动），请重试');
  return { cost, creditUsed, cash, refund, tier: stadium.tier + 1 };
}

/** 子设施升级：五类白名单，0-5 级，升到下一级费用按 facility_prices[当前级]。 */
export async function upgradeFacilityLevel(
  env: Env,
  clubId: number,
  key: string,
): Promise<{ cost: number; creditUsed: number; cash: number; refund: number; level: number }> {
  if (!(FACILITY_KEYS as readonly string[]).includes(key)) throw new HttpError(400, '设施类型不对');
  const prices = await loadFacilityPrices(env.DB);
  const row = await env.DB
    .prepare('SELECT level FROM club_facilities WHERE club_id = ? AND facility_key = ?')
    .bind(clubId, key)
    .first<{ level: number }>();
  const level = row?.level ?? 0;
  if (level >= 5) throw new HttpError(400, '该设施已满级（5 级）');
  const config = createConfigService(env.DB);
  const cost = round2(prices.upgradeCosts[level]!);
  const ratio = (await config.getNumber('voucher_refund')) ?? 0.25;
  const stadium = await loadStadium(env.DB, clubId);
  const { creditUsed, cash, refund } = await payAndRefund(env, clubId, cost, stadium.build_credit, ratio);

  const statements = [
    ...ledgerMovement(env.DB, {
      clubId,
      delta: -cash,
      kind: 'facility_upgrade',
      refType: 'facility',
      refId: clubId,
      memo: `${key} 设施升到 ${level + 1} 级（费用 ${cost.toFixed(2)}M${creditUsed > 0 ? `，建设券抵 ${creditUsed.toFixed(2)}M` : ''}）`,
      idempotent: false, // 玩家主动操作可重复发生，不开 kind+ref 查重闸
    }),
    env.DB
      .prepare(
        `UPDATE stadiums SET build_credit = build_credit - ? + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE club_id = ?`,
      )
      .bind(creditUsed, refund, clubId),
    env.DB
      .prepare(
        `INSERT INTO club_facilities (club_id, facility_key, level, updated_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(club_id, facility_key) DO UPDATE SET
           level = club_facilities.level + 1, updated_at = excluded.updated_at
         WHERE club_facilities.level = ?`,
      )
      .bind(clubId, key, level + 1, level),
  ];
  const outs = await env.DB.batch(statements);
  if ((outs[outs.length - 1]?.meta.changes ?? 0) === 0) throw new HttpError(409, '设施升级落库被拦（等级已被并发改动），请重试');
  return { cost, creditUsed, cash, refund, level: level + 1 };
}
