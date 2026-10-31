// 消费中心效果引擎（v6.26.0）：六类商品的 payload 校验、效果语句、扣费 / 退款与审批编排。
//
// 并发与原子性口径（对照 v6.11.0 事件的教训）：
// - game_attrs 一律 SQL json_set（字面量整数为服务端校验后的值），禁止 JS 读改写——校验时的读
//   只做判定，写入与审批状态流转同批原子。
// - 审批批 = [效果语句 + 台账 + 审计（全部挂 PENDING_GUARD：`(SELECT status FROM shop_orders
//   WHERE id=?)='pending'`）→ 状态流转放批末（WHERE status='pending'）]。守卫压 'pending' 而非
//   'approved'：并发抢同一单时，后到批的效果守卫读到已提交的终态、整段 no-op，状态 UPDATE
//   changes=0 → 409；若守卫压 'approved'，后到批会重复执行效果。
// - 扣费：先 INSERT 工单拿 id，再批内 ledgerMovement(-amount, guardSql 原子余额守卫)——守卫没过
//   （changes=0）删除工单行并报「余额不足」。金额提交时锁定进单，改价不影响已提交的单。
// - 退款：ledgerMovement(+amount, refType='shop_refund') 吃默认幂等闸 + status='pending' 守卫，
//   防重复退、防「审批/拒绝并发时给已生效的单退款」。
import { HttpError } from '../lib/http.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { getOpenWindow } from './seasons.ts';
import { CONFIG_DEFAULTS, createConfigService } from '../core/config.ts';
import {
  CLUB_SHELL_PENDING_LIMIT,
  SHOP_PA_POINTS_MAX,
  SHOP_PA_POINTS_MIN,
  SHOP_CATEGORY_LABELS,
  type ShopCategory,
  type ShopPayload,
  type ShopPayloadBadge,
  type ShopPayloadBadgeUpgrade,
  type ShopPayloadClubShell,
  type ShopPayloadPa,
  type ShopPayloadPosition,
  type ShopPayloadRole,
  type ShopPrices,
  shopOrderSummary,
  shopPriceOf,
  areAdjacent,
  rolePositionOf,
} from '../core/shop.ts';
import {
  POSITION_BY_ID,
  PS_GRANTABLE_BASE_IDS,
  ROLE_SLOT_KEYS,
  isRoleId,
  nextFreePlaystyleSlot,
  playstyleIdOf,
  playstyleSlotRange,
  playstyleSlotsOf,
  type PlaystyleKind,
} from '../core/fc26.ts';
import { fullCountSql, planPlaystylePicks, type PlaystylePickFailureCode } from '../core/playstyle-rules.ts';
import { ledgerMovement } from './ledger.ts';
import { voucherBalance, voucherMovement } from './voucher.ts';
import { queueClubNotification } from './notify.ts';
import type { Env } from './env.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// 审批效果守卫：只在本批状态流转成功（此前仍 pending）时生效
function pendingGuard(): string {
  return `(SELECT status FROM shop_orders WHERE id = ?) = 'pending'`;
}

type GrantedRowSource = 'growth' | 'china' | 'shop' | 'external' | 'manual';

/** 商店「徽章」文案（Q1：商店保留俗称）：按 core 校验的 code 映射成商店口吻，其余透传 */
function shopBadgeMessage(code: PlaystylePickFailureCode, fallback: string, kind: PlaystyleKind): string {
  const seg = kind === 'silver' ? '银徽章' : '金徽章';
  switch (code) {
    case 'already_owned':
      return `这名球员已经有这个${seg}`;
    case 'silver_blocked_by_gold':
      return `这名球员已经有这个金徽章，不能再买${seg}`;
    case 'gold_blocked_by_silver':
      return `这名球员已经有这个银徽章，${seg}请用「银升金」升级`;
    case 'position_denied':
      return 'GK 专属 PlayStyle 不能发给非门将球员';
    case 'slot_full':
      return `${seg}槽位已满，先腾出${kind === 'silver' ? '银' : '金'}槽再买`;
    default:
      return fallback;
  }
}

export interface ShopSettings {
  prices: ShopPrices;
  paCap: number;
  hpremiumClubIds: number[];
}

const DEFAULT_PRICES = JSON.parse(CONFIG_DEFAULTS.shop_prices ?? '{}') as ShopPrices;

export async function loadShopSettings(db: D1Database): Promise<ShopSettings> {
  const config = createConfigService(db);
  const pricesRaw = await config.getJson<Partial<ShopPrices>>('shop_prices');
  const prices = { ...DEFAULT_PRICES, ...pricesRaw };
  const paCap = (await config.getNumber('fc26_pa_cap')) ?? 95;
  const hpremium = await config.getJson<number[]>('shop_hpremium_clubs');
  return { prices, paCap, hpremiumClubIds: Array.isArray(hpremium) ? hpremium : [] };
}

// ---------------------------------------------------------------------------
// payload 结构校验（提交与管理端代录共用；语义校验在 prepareShopPlan）

function wantInt(v: unknown, name: string, opts: { min?: number; max?: number } = {}): number {
  if (!Number.isInteger(v)) throw new HttpError(400, `${name} 必须是整数`);
  const n = v as number;
  if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `${name} 不能小于 ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new HttpError(400, `${name} 不能大于 ${opts.max}`);
  return n;
}

export function parseShopPayload(category: ShopCategory, raw: unknown): ShopPayload {
  const p = (raw ?? {}) as Record<string, unknown>;
  switch (category) {
    case 'pa':
      return {
        playerId: wantInt(p.playerId, 'playerId', { min: 1 }),
        points: wantInt(p.points, 'points', { min: SHOP_PA_POINTS_MIN, max: SHOP_PA_POINTS_MAX }),
      } satisfies ShopPayloadPa;
    case 'badge': {
      if (p.kind !== 'silver' && p.kind !== 'gold') throw new HttpError(400, "kind 只能是 'silver' 或 'gold'");
      return { playerId: wantInt(p.playerId, 'playerId', { min: 1 }), kind: p.kind, psid: wantInt(p.psid, 'psid', { min: 1, max: 99 }) } satisfies ShopPayloadBadge;
    }
    case 'badge_upgrade':
      return { playerId: wantInt(p.playerId, 'playerId', { min: 1 }), psid: wantInt(p.psid, 'psid', { min: 1, max: 99 }) } satisfies ShopPayloadBadgeUpgrade;
    case 'role': {
      if (p.action !== 'add' && p.action !== 'upgrade' && p.action !== 'remove') throw new HttpError(400, "action 只能是 'add' / 'upgrade' / 'remove'");
      const out: ShopPayloadRole = { playerId: wantInt(p.playerId, 'playerId', { min: 1 }), action: p.action };
      if (p.action === 'add') out.roleId = wantInt(p.roleId, 'roleId', { min: 1, max: 149 });
      if (p.action !== 'add') out.slot = wantInt(p.slot, 'slot', { min: 1, max: 5 });
      return out;
    }    case 'position': {
      if (p.action !== 'add' && p.action !== 'remove' && p.action !== 'replace') throw new HttpError(400, "action 只能是 'add' / 'remove' / 'replace'");
      const out: ShopPayloadPosition = {
        playerId: wantInt(p.playerId, 'playerId', { min: 1 }),
        action: p.action,
        slot: wantInt(p.slot, 'slot', { min: 2, max: 4 }),
      };
      if (p.action !== 'remove') out.posId = wantInt(p.posId, 'posId', { min: 0, max: 27 });
      return out;
    }
    case 'club_shell': {
      const note = typeof p.note === 'string' ? p.note : undefined;
      return { note } satisfies ShopPayloadClubShell;
    }
  }
}

// ---------------------------------------------------------------------------
// 语义校验与效果计划

interface PlayerCoreRow {
  id: number;
  name: string;
  display_name: string | null;
  club_id: number | null;
  growable: number;
  pa: number | null;
  position: string | null;
  game_attrs: string | null;
}

async function loadPlayer(db: D1Database, clubId: number, playerId: number): Promise<PlayerCoreRow> {
  const row = await db
    .prepare('SELECT id, name, display_name, club_id, growable, pa, position, game_attrs FROM players WHERE id = ?')
    .bind(playerId)
    .first<PlayerCoreRow>();
  if (!row) throw new HttpError(404, '找不到这名球员');
  if (row.club_id !== clubId) throw new HttpError(400, '球员不属于你的俱乐部');
  return row;
}

function gameAttrs(row: PlayerCoreRow): Record<string, unknown> {
  if (!row.game_attrs) return {};
  try {
    return JSON.parse(row.game_attrs) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 热区（PosID1-4）：主位在首位；名称口径用 POSITION_BY_ID，取不到时回落 players.position 文本列 */
function hotZonesOf(row: PlayerCoreRow): { main: string; names: string[]; slotIds: (number | null)[] } {
  const attrs = gameAttrs(row);
  const slotIds: (number | null)[] = [1, 2, 3, 4].map((i) => {
    const v = Number(attrs[`PosID${i}`]);
    return Number.isFinite(v) && v >= 0 ? v : null;
  });
  const names = slotIds.map((id) => (id !== null ? POSITION_BY_ID[id] ?? null : null));
  const main = names[0] ?? row.position ?? '';
  // 主位一定在场；其余槽只收可识别名称
  const all = [main, ...names.slice(1).filter((n): n is string => !!n)];
  return { main, names: all, slotIds };
}

function roleSlotsOf(row: PlayerCoreRow): (number | null)[] {
  const attrs = gameAttrs(row);
  return ROLE_SLOT_KEYS.map((key) => {
    const v = Number(attrs[key]);
    return Number.isInteger(v) && v > 0 ? v : null;
  });
}

// ---------------------------------------------------------------------------
// 表单状态下发（GET /api/shop/squad-state）：前端下拉按规则过滤，非法选项根本不下发

export interface SquadStatePlayer {
  id: number;
  name: string;
  number: number | null;
  growable: boolean;
  pa: number | null;
  position: string | null;
  /** 热区，定长 4 位（下标 = 槽号 - 1，主位在前，空槽 null） */
  zones: (string | null)[];
  roles: { slot: number; roleId: number }[];
  /** 已拥有的徽章（基础 ID，FC 源 + 发放明细合并去重） */
  ownedSilver: number[];
  ownedGold: number[];
  /** 各段已占槽位数（决定还能不能买） */
  silverUsed: number;
  goldUsed: number;
}

export function squadStateOf(
  row: { id: number; display_name: string | null; name: string; number: number | null; growable: number; pa: number | null; position: string | null; game_attrs: string | null },
  grantedRows: { slot: number; kind: PlaystyleKind; psid: number }[],
): SquadStatePlayer {
  const core = { ...row, club_id: null } as unknown as PlayerCoreRow;
  const zones = hotZonesOf(core);
  const roles = roleSlotsOf(core);
  const fcSlots = playstyleSlotsOf(gameAttrs(core));
  const ownedSilver = new Set<number>(fcSlots.filter((s) => !s.gold).map((s) => s.psid % 100));
  const ownedGold = new Set<number>(fcSlots.filter((s) => s.gold).map((s) => s.psid % 100));
  const usedSlots = new Set<number>(fcSlots.map((s) => s.slot));
  for (const g of grantedRows) {
    (g.kind === 'silver' ? ownedSilver : ownedGold).add(g.psid);
    usedSlots.add(g.slot);
  }
  const slotCount = (kind: PlaystyleKind) => {
    const { min, max } = playstyleSlotRange(kind);
    let n = 0;
    for (const s of usedSlots) if (s >= min && s <= max) n += 1;
    return n;
  };
  // zones 定长 4 位（下标 = 槽号 - 1，空槽 null）：前端按 zones[n-1] 定位槽位，压缩空槽会打错槽
  const zoneSlots: (string | null)[] = zones.slotIds.map((id) => (id !== null ? POSITION_BY_ID[id] ?? null : null));
  if (zoneSlots[0] === null) zoneSlots[0] = core.position ?? null;
  return {
    id: row.id,
    name: row.display_name ?? row.name,
    number: row.number,
    growable: row.growable === 1,
    pa: row.pa,
    position: row.position,
    zones: zoneSlots,
    roles: roles.flatMap((r, i) => (r !== null ? [{ slot: i + 1, roleId: r }] : [])),
    ownedSilver: [...ownedSilver].sort((a, b) => a - b),
    ownedGold: [...ownedGold].sort((a, b) => a - b),
    silverUsed: slotCount('silver'),
    goldUsed: slotCount('gold'),
  };
}

export interface ShopPlan {
  /** 球员内部 id（队壳单为 null） */
  playerId: number | null;
  playerName: string | null;
  /** 审批通过批要执行的效果语句（含 PENDING_GUARD；不含状态流转与审计） */
  buildEffects: (db: D1Database, orderId: number, source: 'club' | 'external', actor: number | null) => D1PreparedStatement[];
  /** player_purchases 台账行（审批批内与效果同批写入；徽章不记台账） */
  purchase?: { field: 'pa' | 'role' | 'position'; valueJson: string };
}

/**
 * 语义校验 + 效果计划。提交时（POST /orders）与审批时（approve）都走这里：提交失败=400，
 * 审批时失败由调用方包成 409（让管理组明示拒绝，不静默转拒）。
 */
export async function prepareShopPlan(
  db: D1Database,
  clubId: number,
  category: ShopCategory,
  payload: ShopPayload,
  opts: { paCap: number },
): Promise<ShopPlan> {
  switch (category) {
    case 'pa': {
      const p = payload as ShopPayloadPa;
      const player = await loadPlayer(db, clubId, p.playerId);
      if (player.growable !== 1) throw new HttpError(400, '只有可成长球员能买 PA');
      const current = player.pa ?? 0;
      if (current + p.points > opts.paCap) {
        throw new HttpError(400, `PA 超过当前版本上限 ${opts.paCap}（当前 ${current} + ${p.points} 点 > ${opts.paCap}）`);
      }
      return {
        playerId: player.id,
        playerName: player.display_name ?? player.name,
        purchase: { field: 'pa', valueJson: JSON.stringify({ points: p.points }) },
        buildEffects: (db2, orderId) => [
          db2
            .prepare(
              `UPDATE players SET pa = MIN(pa + ${p.points}, ${opts.paCap}), updated_at = ${nowSql()}
               WHERE id = ${player.id} AND ${pendingGuard()}`,
            )
            .bind(orderId),
        ],
      };
    }
    case 'badge': {
      const p = payload as ShopPayloadBadge;
      const player = await loadPlayer(db, clubId, p.playerId);
      if (!PS_GRANTABLE_BASE_IDS.includes(p.psid)) throw new HttpError(400, '这个 PlayStyle 不在可发放清单里');
      const kind: PlaystyleKind = p.kind;
      const granted = await db
        .prepare('SELECT slot, kind, psid, source FROM player_playstyles WHERE player_id = ?')
        .bind(player.id)
        .all<{ slot: number; kind: PlaystyleKind; psid: number; source: GrantedRowSource }>();
      const fcSlots = playstyleSlotsOf(gameAttrs(player));
      // v6.63.0：跨段判重 + 位置资格收敛到 core planPlaystylePicks（context 'shop'：择金遇银挡）；
      // 商店口吻保留「徽章」俗称（Q1），失败按 code 映射文案
      const outcome = planPlaystylePicks([playstyleIdOf(p.psid, kind)], {
        silverCount: kind === 'silver' ? 1 : 0,
        goldCount: kind === 'gold' ? 1 : 0,
        ownedPsids: [
          ...fcSlots.map((s) => s.psid),
          ...granted.results.map((g) => playstyleIdOf(g.psid, g.kind)),
        ],
        usedSlots: [...fcSlots.map((s) => s.slot), ...granted.results.map((g) => g.slot)],
        context: 'shop',
        position: player.position,
        grantedRows: granted.results,
      });
      if (!outcome.ok) throw new HttpError(400, shopBadgeMessage(outcome.code, outcome.message, kind));
      const freeSlot = outcome.slots[0]!.slot;
      return {
        playerId: player.id,
        playerName: player.display_name ?? player.name,
        buildEffects: (db2, orderId, source, actor) => [
          db2
            .prepare(
              `INSERT INTO player_playstyles (player_id, slot, kind, psid, source, granted_by, created_at)
               SELECT ${player.id}, ${freeSlot}, '${kind}', ${p.psid}, '${source === 'external' ? 'external' : 'shop'}', ?, ${nowSql()}
               WHERE ${pendingGuard()}`,
            )
            .bind(actor, orderId),
          // 台账重算用 SQL 公式在执行时实时算（v6.63.0 全量口径），不吃计划-执行窗口的竞态
          db2
            .prepare(
              `UPDATE players SET badges_silver = ${fullCountSql('silver')}, badges_gold = ${fullCountSql('gold')}, updated_at = ${nowSql()}
               WHERE id = ${player.id} AND ${pendingGuard()}`,
            )
            .bind(orderId),
        ],
      };
    }
    case 'badge_upgrade': {
      const p = payload as ShopPayloadBadgeUpgrade;
      const player = await loadPlayer(db, clubId, p.playerId);
      const row = await db
        .prepare("SELECT id, slot FROM player_playstyles WHERE player_id = ? AND psid = ? AND kind = 'silver'")
        .bind(player.id, p.psid)
        .first<{ id: number; slot: number }>();
      if (!row) throw new HttpError(400, '这名球员没有这枚银徽章（发放所得才能升级）');
      const granted = await db
        .prepare('SELECT slot, kind FROM player_playstyles WHERE player_id = ?')
        .bind(player.id)
        .all<{ slot: number; kind: PlaystyleKind }>();
      const fcSlots = playstyleSlotsOf(gameAttrs(player));
      const usedSlots = [...fcSlots.map((s) => s.slot), ...granted.results.map((g) => g.slot)];
      const goldSlot = nextFreePlaystyleSlot('gold', usedSlots);
      if (goldSlot === null) throw new HttpError(400, '金徽章槽已满（3 个），先腾出金槽再升级');
      return {
        playerId: player.id,
        playerName: player.display_name ?? player.name,
        buildEffects: (db2, orderId) => [
          db2
            .prepare(
              `UPDATE player_playstyles SET kind = 'gold', slot = ${goldSlot}, created_at = ${nowSql()}
               WHERE id = ${row.id} AND kind = 'silver' AND ${pendingGuard()}`,
            )
            .bind(orderId),
          // 台账重算（v6.63.0 全量口径）：原银行变形后自动退出银数；若球员有同基础 FC 银，
          // 新金行的派生抑制让它在计数与清单里同时消失 —— 无需额外语句
          db2
            .prepare(
              `UPDATE players SET badges_silver = ${fullCountSql('silver')}, badges_gold = ${fullCountSql('gold')}, updated_at = ${nowSql()}
               WHERE id = ${player.id} AND ${pendingGuard()}`,
            )
            .bind(orderId),
        ],
      };
    }
    case 'role': {
      const p = payload as ShopPayloadRole;
      const player = await loadPlayer(db, clubId, p.playerId);
      const roles = roleSlotsOf(player);
      if (p.action === 'add') {
        const roleId = p.roleId!;
        if (!isRoleId(roleId)) throw new HttpError(400, 'roleId 不在角色表里（1-49 单加号 / 101-149 双加号）');
        const rolePos = rolePositionOf(roleId);
        const zones = hotZonesOf(player);
        if (!rolePos || !zones.names.includes(rolePos)) {
          throw new HttpError(400, `该角色归属位置「${rolePos ?? '未知'}」不在球员热区（${zones.names.join('/')}）内，不可新增`);
        }
        const base = roleId > 100 ? roleId - 100 : roleId;
        if (roles.some((r) => r !== null && (r > 100 ? r - 100 : r) === base)) {
          throw new HttpError(400, '这名球员已有该角色（同角色不可重复；单加号升双加号请用升级）');
        }
        const freeSlot = roles.findIndex((r) => r === null);
        if (freeSlot === -1) throw new HttpError(400, '角色槽已满（5 个）');
        const slot = freeSlot + 1;
        return {
          playerId: player.id,
          playerName: player.display_name ?? player.name,
          purchase: { field: 'role', valueJson: JSON.stringify({ slot, roleId, prevRoleId: null }) },
          buildEffects: (db2, orderId) => [
            db2
              .prepare(
                `UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID${slot}', ${roleId}), updated_at = ${nowSql()}
                 WHERE id = ${player.id} AND ${pendingGuard()}`,
              )
              .bind(orderId),
          ],
        };
      }
      const slotIdx = (p.slot ?? 0) - 1;
      if (slotIdx < 0 || slotIdx >= roles.length) throw new HttpError(400, 'slot 应在 1-5 之间');
      const current = roles[slotIdx];
      if (current === null) throw new HttpError(400, `第 ${slotIdx + 1} 槽没有角色`);
      if (p.action === 'upgrade') {
        if (current > 100) throw new HttpError(400, '该槽已是双加号角色');
        return {
          playerId: player.id,
          playerName: player.display_name ?? player.name,
          purchase: { field: 'role', valueJson: JSON.stringify({ slot: slotIdx + 1, roleId: current + 100, prevRoleId: current }) },
          buildEffects: (db2, orderId) => [
            db2
              .prepare(
                `UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID${slotIdx + 1}', ${current + 100}), updated_at = ${nowSql()}
                 WHERE id = ${player.id} AND ${pendingGuard()}`,
              )
              .bind(orderId),
          ],
        };
      }
      // remove
      return {
        playerId: player.id,
        playerName: player.display_name ?? player.name,
        purchase: { field: 'role', valueJson: JSON.stringify({ slot: slotIdx + 1, roleId: null, prevRoleId: current }) },
        buildEffects: (db2, orderId) => [
          db2
            .prepare(
              `UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID${slotIdx + 1}', json('null')), updated_at = ${nowSql()}
               WHERE id = ${player.id} AND ${pendingGuard()}`,
            )
            .bind(orderId),
        ],
      };
    }
    case 'position': {
      const p = payload as ShopPayloadPosition;
      const player = await loadPlayer(db, clubId, p.playerId);
      const zones = hotZonesOf(player);
      if (p.slot < 2 || p.slot > 4) throw new HttpError(400, '第一位置不可新增、去除或替换（slot 应在 2-4）');
      if (zones.main === 'GK') throw new HttpError(400, '第一位置为门将（GK）的球员不可新增、去除或替换位置');
      const slotIdx = p.slot - 1;
      const clearRolePaths = (posName: string): number[] => {
        // 位置被去除 / 替换 ⇒ 该位置上的所有角色连带去除
        const roles = roleSlotsOf(player);
        return roles
          .map((r, i) => (r !== null && rolePositionOf(r) === posName ? i + 1 : 0))
          .filter((n) => n > 0);
      };
      const jsonSets = (paths: string[], value: string) =>
        `json_set(game_attrs, ${paths.map((path) => `'${path}', ${value}`).join(', ')})`;
      if (p.action === 'add') {
        const posId = p.posId!;
        const posName = POSITION_BY_ID[posId];
        if (!posName || posId === 0) throw new HttpError(400, 'posId 不在位置表里，且门将（GK）不可被新增');
        if (zones.names.includes(posName)) throw new HttpError(400, `球员热区已有「${posName}」，不可重复新增`);
        const occupied = zones.slotIds[slotIdx] !== null;
        if (occupied) throw new HttpError(400, `第 ${p.slot} 槽已有位置，请用替换`);
        const adjacentOk = zones.names.some((n) => n && areAdjacent(n, posName));
        if (!adjacentOk) throw new HttpError(400, `「${posName}」与现有热区（${zones.names.join('/')}）都不相邻`);
        return {
          playerId: player.id,
          playerName: player.display_name ?? player.name,
          purchase: { field: 'position', valueJson: JSON.stringify({ slot: p.slot, posId, prevPosId: null, clearedRoleSlots: [] }) },
          buildEffects: (db2, orderId) => [
            db2
              .prepare(
                `UPDATE players SET game_attrs = ${jsonSets([`$.PosID${p.slot}`], String(posId))}, updated_at = ${nowSql()}
                 WHERE id = ${player.id} AND ${pendingGuard()}`,
              )
              .bind(orderId),
          ],
        };
      }
      const oldId = zones.slotIds[slotIdx];
      const oldName = oldId !== null ? POSITION_BY_ID[oldId] ?? null : null;
      if (oldId === null) throw new HttpError(400, `第 ${p.slot} 槽没有位置可${p.action === 'remove' ? '去除' : '替换'}`);
      const clearedRoleSlots = clearRolePaths(oldName ?? '');
      if (p.action === 'remove') {
        const paths = [`$.PosID${p.slot}`, ...clearedRoleSlots.map((n) => `$.RoleID${n}`)];
        return {
          playerId: player.id,
          playerName: player.display_name ?? player.name,
          purchase: { field: 'position', valueJson: JSON.stringify({ slot: p.slot, posId: null, prevPosId: oldId, clearedRoleSlots }) },
          buildEffects: (db2, orderId) => [
            db2
              .prepare(
                `UPDATE players SET game_attrs = ${jsonSets(paths, "json('null')")}, updated_at = ${nowSql()}
                 WHERE id = ${player.id} AND ${pendingGuard()}`,
              )
              .bind(orderId),
          ],
        };
      }
      // replace
      const posId = p.posId!;
      const posName = POSITION_BY_ID[posId];
      if (!posName || posId === 0) throw new HttpError(400, 'posId 不在位置表里，且门将（GK）不可被替换进来');
      if (posId === oldId) throw new HttpError(400, '替换前后的位置不可相同');
      const remaining = zones.names.filter((_, i) => i !== slotIdx);
      if (remaining.includes(posName)) throw new HttpError(400, `热区已有「${posName}」，替换后不可重复`);
      const adjacentOk = remaining.some((n) => n && areAdjacent(n, posName));
      if (!adjacentOk) throw new HttpError(400, `「${posName}」与替换后剩余热区（${remaining.join('/')}）都不相邻`);
      return {
        playerId: player.id,
        playerName: player.display_name ?? player.name,
        purchase: { field: 'position', valueJson: JSON.stringify({ slot: p.slot, posId, prevPosId: oldId, clearedRoleSlots }) },
        buildEffects: (db2, orderId) => [
          db2
            .prepare(
              `UPDATE players SET game_attrs = json_set(game_attrs, ${[
                `'$.PosID${p.slot}', ${posId}`,
                ...clearedRoleSlots.map((n) => `'$.RoleID${n}', json('null')`),
              ].join(', ')}), updated_at = ${nowSql()}
               WHERE id = ${player.id} AND ${pendingGuard()}`,
            )
            .bind(orderId),
        ],
      };
    }
    case 'club_shell':
      return {
        playerId: null,
        playerName: null,
        buildEffects: () => [],
      };
  }
}

// ---------------------------------------------------------------------------
// 工单编排：建单（教练 / 管理组代录）、审批、拒绝

const ORDER_COLS =
  'id, source, club_id, ordered_by, category, payload_json, amount, voucher_used, status, note, reviewed_by, reviewed_at, reject_reason, created_at';

export interface ShopOrderRow {
  id: number;
  source: 'club' | 'external';
  club_id: number;
  ordered_by: number;
  category: ShopCategory;
  payload_json: string;
  amount: number | null;
  /** 券抵额（v6.58.0）：实付现金 = amount − voucher_used；老单默认 0 */
  voucher_used: number;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export function orderDto(row: ShopOrderRow, playerName?: string | null) {
  let payload: ShopPayload | null = null;
  try {
    payload = JSON.parse(row.payload_json) as ShopPayload;
  } catch {
    payload = null;
  }
  return {
    id: row.id,
    source: row.source,
    clubId: row.club_id,
    orderedBy: row.ordered_by,
    category: row.category,
    categoryLabel: SHOP_CATEGORY_LABELS[row.category] ?? row.category,
    payload,
    summary: payload ? shopOrderSummary(row.category, payload, playerName) : '（参数无法解析）',
    amount: row.amount,
    voucherUsed: row.voucher_used,
    cashPaid: row.amount == null ? null : Math.round((row.amount - row.voucher_used) * 100) / 100,
    status: row.status,
    note: row.note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    rejectReason: row.reject_reason,
    createdAt: row.created_at,
  };
}

export interface CreateOrderResult {
  order: ShopOrderRow;
  summary: string;
}

/** 教练提交工单：校验 → 建单（锁价）→ 批内扣费（守卫没过删单报余额不足） */
export async function createClubOrder(
  env: Env,
  opts: { userId: number; clubId: number; category: ShopCategory; payload: unknown; note?: string | null },
): Promise<CreateOrderResult> {
  const db = env.DB;
  const settings = await loadShopSettings(db);
  const payload = parseShopPayload(opts.category, opts.payload);
  if (opts.category === 'club_shell') {
    if (settings.hpremiumClubIds.includes(opts.clubId)) {
      throw new HttpError(403, '豪门俱乐部队壳事项请在群内咨询管理组，系统不受理申请');
    }
    // 队壳只在赛季第 1 窗（赛季初窗口）开放：窗口序号以 season_windows 当前开放窗为准
    const win = await getOpenWindow(db);
    if (!win || win.windowSeq !== 1) {
      throw new HttpError(409, '队壳申请只在赛季第 1 个窗口（赛季初窗口）开放；现在不是赛季初窗口，等赛季初再来。', 'shell_first_window');
    }
    const pending = await db
      .prepare("SELECT COUNT(*) AS n FROM shop_orders WHERE club_id = ? AND category = 'club_shell' AND status = 'pending'")
      .bind(opts.clubId)
      .first<{ n: number }>();
    if ((pending?.n ?? 0) >= CLUB_SHELL_PENDING_LIMIT) throw new HttpError(409, '已有待审的队壳申请，请等管理组处理后再提交');
  }
  const plan = await prepareShopPlan(db, opts.clubId, opts.category, payload, { paCap: settings.paCap });
  const amount = shopPriceOf(opts.category, payload, settings.prices);
  if (amount === null) throw new HttpError(400, '工单参数不完整，无法计价');
  const summary = shopOrderSummary(opts.category, payload, plan.playerName);

  // 先券后钱强制全额抵（与建设域同口径）：券够多少抵多少，剩余走现金
  const vouchers = await voucherBalance(db, opts.clubId);
  // 券余额理论上不为负；脏数据/历史遗留也要按 0 截断，否则 cash = amount + |vouchers| 会多收钱
  const voucherUsed = round2(Math.min(Math.max(vouchers, 0), amount));
  const cash = round2(amount - voucherUsed);
  const order = await db
    .prepare(
      `INSERT INTO shop_orders (source, club_id, ordered_by, category, payload_json, amount, voucher_used, status, note, created_at)
       VALUES ('club', ?, ?, ?, ?, ?, ?, 'pending', ?, ${nowSql()}) RETURNING ${ORDER_COLS}`,
    )
    .bind(opts.clubId, opts.userId, opts.category, JSON.stringify(payload), amount, voucherUsed, opts.note ?? null)
    .first<ShopOrderRow>();
  if (!order) throw new HttpError(500, '工单创建失败');

  // 扣费与审计同批：券/现金两个守卫任一没过 → 整批空转 + 删单 400。
  // 券语句排批首，且它的守卫同时要求「现金也够」；现金语句用 changes()>0 串在券后面，
  // 这样不存在「券扣了现金不够」或反过来的中间态（测试计划 TC-O-003 的最坏交错）。
  const audit = createAuditStatement(db);
  const parts: D1PreparedStatement[] = [];
  const voucherIndex = voucherUsed > 0 ? parts.push(...voucherMovement(db, {
    clubId: opts.clubId,
    delta: -voucherUsed,
    kind: 'shop_use',
    refType: 'shop_order',
    refId: order.id,
    memo: `消费工单 #${order.id} 消费券抵扣：${summary}`,
    guardSql:
      'COALESCE((SELECT vouchers FROM ledger_accounts WHERE club_id = ?), 0) >= ? AND COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0) >= ?',
    guardParams: [opts.clubId, voucherUsed, opts.clubId, cash],
  })) - 2 : -1;
  const cashIndex = cash > 0 ? parts.push(...ledgerMovement(db, {
    clubId: opts.clubId,
    delta: -cash,
    kind: 'shop_purchase',
    refType: 'shop_order',
    refId: order.id,
    memo: `消费工单 #${order.id}：${summary}`,
    guardSql: `${voucherUsed > 0 ? 'changes() > 0 AND ' : ''}(SELECT COALESCE(balance, 0) FROM ledger_accounts WHERE club_id = ?) >= ?`,
    guardParams: [opts.clubId, cash],
  })) - 2 : -1;
  const results = await db.batch([
    ...parts,
    audit({
      actor: opts.userId,
      action: 'shop_order_create',
      targetType: 'shop_order',
      targetId: order.id,
      origin: 'user',
      after: { category: opts.category, amount, voucherUsed, cash, summary },
      ...(voucherIndex >= 0 ? { guardSql: 'changes() > 0' } : {}),
    }),
  ]);
  const charged = (idx: number) => idx < 0 || (results[idx]?.meta?.changes ?? 0) > 0;
  if (!charged(voucherIndex) || !charged(cashIndex)) {
    await db.prepare('DELETE FROM shop_orders WHERE id = ?').bind(order.id).run();
    throw new HttpError(400, '余额或消费券不足，工单未提交');
  }
  return { order, summary };
}

/** 管理组代录外部增益工单：只校验不生效（amount=NULL 不进账本），创建 → 确认两步 */
export async function createExternalOrder(
  env: Env,
  opts: { actorId: number; clubId: number; category: ShopCategory; payload: unknown; note?: string | null },
): Promise<CreateOrderResult> {
  const db = env.DB;
  const settings = await loadShopSettings(db);
  const payload = parseShopPayload(opts.category, opts.payload);
  const plan = await prepareShopPlan(db, opts.clubId, opts.category, payload, { paCap: settings.paCap });
  const summary = shopOrderSummary(opts.category, payload, plan.playerName);
  const order = await db
    .prepare(
      `INSERT INTO shop_orders (source, club_id, ordered_by, category, payload_json, amount, status, note, created_at)
       VALUES ('external', ?, ?, ?, ?, NULL, 'pending', ?, ${nowSql()}) RETURNING ${ORDER_COLS}`,
    )
    .bind(opts.clubId, opts.actorId, opts.category, JSON.stringify(payload), opts.note ?? null)
    .first<ShopOrderRow>();
  if (!order) throw new HttpError(500, '工单创建失败');
  const audit = createAuditStatement(db);
  await audit({
    actor: opts.actorId,
    action: 'shop_order_external',
    targetType: 'shop_order',
    targetId: order.id,
    origin: 'user',
    after: { category: opts.category, summary, note: opts.note ?? null },
  }).run();
  return { order, summary };
}

/** 审批通过：重校验（失败 409 让管理组明示拒绝）→ 效果 + 台账 + 审计（挂 pending 守卫）→ 状态流转 */
export async function approveShopOrder(
  env: Env,
  opts: { orderId: number; reviewerId: number; note?: string | null },
): Promise<CreateOrderResult> {
  const db = env.DB;
  const order = await db.prepare(`SELECT ${ORDER_COLS} FROM shop_orders WHERE id = ?`).bind(opts.orderId).first<ShopOrderRow>();
  if (!order) throw new HttpError(404, '没有这张工单');
  if (order.status !== 'pending') throw new HttpError(409, '这张工单已经处理过了');
  const settings = await loadShopSettings(db);
  let payload: ShopPayload;
  let plan: ShopPlan;
  try {
    payload = parseShopPayload(order.category, JSON.parse(order.payload_json));
    plan = await prepareShopPlan(db, order.club_id, order.category, payload, { paCap: settings.paCap });
  } catch (err) {
    if (err instanceof HttpError) {
      throw new HttpError(409, `工单当前状态已不满足执行条件：${err.message}`, 'shop_order_stale');
    }
    throw err;
  }
  const summary = shopOrderSummary(order.category, payload, plan.playerName);
  const audit = createAuditStatement(db);
  // granted_by = 审批发放的管理员（明细表口径：发放人，不是买家）
  const statements = [
    ...plan.buildEffects(db, order.id, order.source, opts.reviewerId),
  ];
  if (plan.purchase) {
    statements.push(
      db
        .prepare(
          `INSERT INTO player_purchases (player_id, field, value_json, order_id, created_at)
           SELECT ?, ?, ?, ?, ${nowSql()} WHERE ${pendingGuard()}`,
        )
        .bind(plan.playerId, plan.purchase.field, plan.purchase.valueJson, order.id, order.id),
    );
  }
  statements.push(
    audit({
      actor: opts.reviewerId,
      action: 'shop_order_approve',
      targetType: 'shop_order',
      targetId: order.id,
      origin: 'user',
      before: { status: order.status },
      after: { status: 'approved', summary, note: opts.note ?? order.note ?? null },
      guardSql: pendingGuard(),
      guardParams: [order.id],
    }),
  );
  statements.push(
    db
      .prepare(
        `UPDATE shop_orders SET status = 'approved', reviewed_by = ?, reviewed_at = ${nowSql()}, note = COALESCE(?, note)
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(opts.reviewerId, opts.note ?? null, order.id),
  );
  const results = await db.batch(statements);
  if ((results[results.length - 1]?.meta?.changes ?? 0) === 0) {
    throw new HttpError(409, '这张工单已经处理过了');
  }
  await queueApprovedNotification(env, order, summary, opts.note ?? null);
  return { order: { ...order, status: 'approved', reviewed_by: opts.reviewerId, note: opts.note ?? order.note }, summary };
}

/** 拒绝：club 单自动退款（幂等闸 + pending 守卫），external 单纯作废 */
export async function rejectShopOrder(
  env: Env,
  opts: { orderId: number; reviewerId: number; reason: string },
): Promise<CreateOrderResult> {
  const db = env.DB;
  const reason = opts.reason.trim();
  if (!reason) throw new HttpError(400, '拒绝理由必填');
  const order = await db.prepare(`SELECT ${ORDER_COLS} FROM shop_orders WHERE id = ?`).bind(opts.orderId).first<ShopOrderRow>();
  if (!order) throw new HttpError(404, '没有这张工单');
  if (order.status !== 'pending') throw new HttpError(409, '这张工单已经处理过了');
  let payload: ShopPayload | null = null;
  try {
    payload = JSON.parse(order.payload_json) as ShopPayload;
  } catch {
    payload = null;
  }
  const summary = payload ? shopOrderSummary(order.category, payload) : '（参数无法解析）';
  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];
  const voucherUsed = order.voucher_used ?? 0;
  const cashRefund = round2((order.amount ?? 0) - voucherUsed);
  if (order.source === 'club' && order.amount != null && order.amount > 0) {
    // 双退（v6.58.0）：现金退 amount − voucher_used，券退 voucher_used；两段同挂 pending 守卫，
    // 老单 voucher_used=0 时券段不生成，行为与切换前逐值一致。
    if (voucherUsed > 0) {
      statements.push(
        ...voucherMovement(db, {
          clubId: order.club_id,
          delta: voucherUsed,
          kind: 'shop_refund',
          refType: 'shop_order',
          refId: order.id,
          memo: `消费工单 #${order.id} 拒绝退回消费券：${summary}`,
          guardSql: pendingGuard(),
          guardParams: [order.id],
        }),
      );
    }
    if (cashRefund > 0) {
      statements.push(
        ...ledgerMovement(db, {
          clubId: order.club_id,
          delta: cashRefund,
          kind: 'shop_purchase',
          refType: 'shop_refund',
          refId: order.id,
          memo: `消费工单 #${order.id} 拒绝退款：${summary}`,
          guardSql: pendingGuard(),
          guardParams: [order.id],
        }),
      );
    }
  }
  statements.push(
    audit({
      actor: opts.reviewerId,
      action: 'shop_order_reject',
      targetType: 'shop_order',
      targetId: order.id,
      origin: 'user',
      before: { status: order.status },
      after: { status: 'rejected', reason },
      guardSql: pendingGuard(),
      guardParams: [order.id],
    }),
  );
  statements.push(
    db
      .prepare(
        `UPDATE shop_orders SET status = 'rejected', reviewed_by = ?, reviewed_at = ${nowSql()}, reject_reason = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(opts.reviewerId, reason, order.id),
  );
  const results = await db.batch(statements);
  if ((results[results.length - 1]?.meta?.changes ?? 0) === 0) {
    throw new HttpError(409, '这张工单已经处理过了');
  }
  await queueClubNotification(env, order.club_id, 'shop_order_rejected', {
    summary,
    reason,
    refund: order.source === 'club' && order.amount != null && order.amount > 0,
    cashRefund,
    voucherRefund: voucherUsed,
    orderId: order.id,
  });
  return { order: { ...order, status: 'rejected', reviewed_by: opts.reviewerId, reject_reason: reason }, summary };
}

async function queueApprovedNotification(env: Env, order: ShopOrderRow, summary: string, note: string | null) {
  const data: Record<string, unknown> = { summary, external: order.source === 'external', orderId: order.id };
  if (note) data.note = note;
  await queueClubNotification(env, order.club_id, 'shop_order_approved', data);
}

// ---------------------------------------------------------------------------
// 导入保护重放（players-import.ts confirmImport 每 chunk 批内调用）

export interface PurchaseRow {
  player_id: number;
  field: 'pa' | 'role' | 'position';
  value_json: string;
}

/**
 * 按台账重放：导入整列覆盖 pa / game_attrs 之后，把已购属性加回去。
 * pa = MIN(pa + 台账SUM, cap)；role / position 按槽位 json_set 回写（清除槽写 json('null')）。
 * 语句与 upsert 同批 ⇒ 「导入 + 重放」整体幂等（导入重跑 = 基线重置 + 再重放）。
 */
export function replayStatements(db: D1Database, purchases: PurchaseRow[], paCap: number): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  const paSum = new Map<number, number>();
  for (const row of purchases) {
    if (row.field === 'pa') {
      let points = 0;
      try {
        points = Number((JSON.parse(row.value_json) as { points?: unknown }).points ?? 0);
      } catch {
        points = 0;
      }
      if (Number.isFinite(points) && points > 0) {
        paSum.set(row.player_id, (paSum.get(row.player_id) ?? 0) + points);
      }
    } else if (row.field === 'role') {
      const v = JSON.parse(row.value_json) as { slot?: unknown; roleId?: unknown };
      const slot = Number(v.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 5) continue;
      const roleId = v.roleId == null ? "json('null')" : String(Number(v.roleId));
      out.push(
        db.prepare(
          `UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID${slot}', ${roleId}), updated_at = ${nowSql()} WHERE id = ${row.player_id}`,
        ),
      );
    } else {
      const v = JSON.parse(row.value_json) as { slot?: unknown; posId?: unknown; clearedRoleSlots?: unknown };
      const slot = Number(v.slot);
      if (!Number.isInteger(slot) || slot < 2 || slot > 4) continue;
      const posId = v.posId == null ? "json('null')" : String(Number(v.posId));
      const paths = [`'$.PosID${slot}', ${posId}`];
      if (Array.isArray(v.clearedRoleSlots)) {
        for (const n of v.clearedRoleSlots) {
          const rn = Number(n);
          if (Number.isInteger(rn) && rn >= 1 && rn <= 5) paths.push(`'$.RoleID${rn}', json('null')`);
        }
      }
      out.push(
        db.prepare(
          `UPDATE players SET game_attrs = json_set(game_attrs, ${paths.join(', ')}), updated_at = ${nowSql()} WHERE id = ${row.player_id}`,
        ),
      );
    }
  }
  for (const [playerId, points] of paSum) {
    out.push(
      db.prepare(`UPDATE players SET pa = MIN(pa + ${points}, ${paCap}), updated_at = ${nowSql()} WHERE id = ${playerId}`),
    );
  }
  return out;
}

/** 拉一批球员的已购台账（playerIds 为内部 id；空数组返回空） */
export async function fetchPurchases(db: D1Database, playerIds: number[]): Promise<PurchaseRow[]> {
  if (playerIds.length === 0) return [];
  const out: PurchaseRow[] = [];
  for (let i = 0; i < playerIds.length; i += 90) {
    const slice = playerIds.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await db
      .prepare(`SELECT player_id, field, value_json FROM player_purchases WHERE player_id IN (${placeholders})`)
      .bind(...slice)
      .all<PurchaseRow>();
    out.push(...rows.results);
  }
  return out;
}
