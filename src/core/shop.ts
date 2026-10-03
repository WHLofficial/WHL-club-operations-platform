// 消费中心纯逻辑层（v6.26.0，无 IO）：位置相邻表、角色归属位置、价目与摘要文本。
// 校验与落库在 src/worker/shop-ops.ts —— 那边需要球员行 / 徽章槽 / 台账等库内状态。
import { POSITION_BY_ID } from './fc26.ts';

// ---------------------------------------------------------------------------
// 位置相邻表（v6.26.0 定稿，固定常量）
//
// 「新增 / 替换位置热区」的相邻判定只按这张表，不采用 FC 官方转换表（用户裁决：不用官方，
// 只按照图）。定稿依据是位置相邻关系图 313×211 像素实测：块间一律 2px 虚线带、无大空白，
// 左右列与中列错位重叠区均相接，共 22 条边。GK 不参与（不可被新增 / 替换 / 相邻判定）。
// 表本身自反对称：a 的邻表里有 b ⇔ b 的邻表里有 a，tests/shop-orders.test.ts 有逐项对称锁。
export const POSITION_ADJACENCY: Readonly<Record<string, readonly string[]>> = {
  LW: ['ST', 'CAM', 'LM'],
  ST: ['LW', 'RW', 'CAM'],
  RW: ['ST', 'CAM', 'RM'],
  CAM: ['ST', 'LW', 'RW', 'LM', 'RM', 'CM'],
  CM: ['CAM', 'LM', 'RM', 'CDM'],
  CDM: ['CM', 'LM', 'RM', 'LB', 'RB', 'CB'],
  LM: ['LW', 'CAM', 'CM', 'CDM', 'LB'],
  RM: ['RW', 'CAM', 'CM', 'CDM', 'RB'],
  LB: ['LM', 'CDM', 'CB'],
  CB: ['CDM', 'LB', 'RB'],
  RB: ['RM', 'CDM', 'CB'],
};

export function areAdjacent(a: string, b: string): boolean {
  return POSITION_ADJACENCY[a]?.includes(b) ?? false;
}

// 名称 → 位置 ID（查 position.json 的反表；未知名称返回 null）
const POSITION_ID_BY_NAME: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(POSITION_BY_ID).map(([id, name]) => [name, Number(id)]),
);

export function positionIdOf(name: string): number | null {
  return POSITION_ID_BY_NAME[name] ?? null;
}

// ---------------------------------------------------------------------------
// 角色归属位置与名称
//
// 源 = web/assets/ref/role.json：id 1-49 是单加号（+）、101-149 是双加号（++，= 基础 +100），
// chs 字段首词即归属位置（如「ST 突前前锋 +」）。这里落成常量表（worker 侧不引 web/assets 的
// JSON），tests/shop-orders.test.ts 用 role.json 全量逐条锁死，漂移即红。
export const ROLE_POSITION_BY_ID: Readonly<Record<number, string>> = {
  1: 'GK', 2: 'GK', 3: 'RB', 4: 'RB', 5: 'RB', 6: 'RB', 7: 'LB', 8: 'LB', 9: 'LB', 10: 'LB',
  11: 'CB', 12: 'CB', 13: 'CB', 14: 'CDM', 15: 'CDM', 16: 'CDM', 17: 'CDM', 18: 'CM', 19: 'CM',
  20: 'CM', 21: 'CM', 22: 'CM', 23: 'RM', 24: 'RM', 25: 'RM', 26: 'RM', 27: 'LM', 28: 'LM',
  29: 'LM', 30: 'LM', 31: 'CAM', 32: 'CAM', 33: 'CAM', 34: 'CAM', 35: 'RW', 36: 'RW', 37: 'RW',
  38: 'LW', 39: 'LW', 40: 'LW', 41: 'ST', 42: 'ST', 43: 'ST', 44: 'ST', 45: 'GK', 46: 'RB',
  47: 'LB', 48: 'CB', 49: 'CDM',
};

// 角色中文名（基础段，不含档位后缀）；双加号由调用方拼「++」。
export const ROLE_BASE_NAMES: Readonly<Record<number, string>> = {
  1: 'GK 门将', 2: 'GK 清道夫门将', 3: 'RB 边后卫', 4: 'RB 伪后卫', 5: 'RB 边翼卫', 6: 'RB 进攻型边翼卫',
  7: 'LB 边后卫', 8: 'LB 伪后卫', 9: 'LB 边翼卫', 10: 'LB 进攻型边翼卫', 11: 'CB 后卫', 12: 'CB 施压',
  13: 'CB 控球后卫', 14: 'CDM 镇守', 15: 'CDM 中前卫', 16: 'CDM 拖后组织核心', 17: 'CDM 半边卫',
  18: 'CM 全能中场', 19: 'CM 镇守', 20: 'CM 拖后组织核心', 21: 'CM 组织核心', 22: 'CM 半边锋',
  23: 'RM 边锋', 24: 'RM 边中场', 25: 'RM 边路组织核心', 26: 'RM 内锋', 27: 'LM 边锋', 28: 'LM 边中场',
  29: 'LM 边路组织核心', 30: 'LM 内锋', 31: 'CAM 组织核心', 32: 'CAM 影子前锋', 33: 'CAM 半边锋',
  34: 'CAM 传统十号位', 35: 'RW 边锋', 36: 'RW 内锋', 37: 'RW 边路组织核心', 38: 'LW 边锋',
  39: 'LW 内锋', 40: 'LW 边路组织核心', 41: 'ST 突前前锋', 42: 'ST 禁区之王', 43: 'ST 伪九号',
  44: 'ST 站桩中锋', 45: 'GK 出球型门将', 46: 'RB 内切型边后卫', 47: 'LB 内切型边后卫', 48: 'CB 边中卫',
  49: 'CDM 禁区冲击者',
};

/** 角色 ID → 归属位置（双加号段先折回基础段；未知 ID 返回 null） */
export function rolePositionOf(roleId: number): string | null {
  const base = roleId > 100 ? roleId - 100 : roleId;
  return ROLE_POSITION_BY_ID[base] ?? null;
}

/** 角色 ID → 展示名（带档位后缀；未知 ID 返回 null） */
export function roleLabelOf(roleId: number): string | null {
  const base = roleId > 100 ? roleId - 100 : roleId;
  const name = ROLE_BASE_NAMES[base];
  return name ? `${name}${roleId > 100 ? ' ++' : ' +'}` : null;
}

// ---------------------------------------------------------------------------
// 徽章（PlayStyle）可购清单与名称
//
// 可购 = 既有发放白名单 PS_GRANTABLE_BASE_IDS（升级方案 / 中国计划同一份，36 项）；
// 名称来自 web/assets/ref/playstyle.json 的 chs 字段，同样落常量表（tests 逐条锁）。
export const SHOP_PS_NAMES: Readonly<Record<number, string>> = {
  1: '精准搓射', 2: '吊射', 3: '大力射门', 4: '死球', 5: '精准头球', 6: '杂耍', 7: '低射', 8: '破局者',
  11: '精准直塞', 12: '大力短传', 13: '长传', 14: 'Tiki Taka', 15: '快速传中', 16: '别出心裁',
  21: '跟防', 22: '封堵', 23: '拦截', 24: '预判', 25: '铲球', 26: '空中堡垒',
  31: '技术', 32: '灵动迅捷', 33: '第一脚触球', 34: '诡术师', 35: '紧逼好手',
  41: '健步如飞', 42: '坚持不懈', 43: '远距离界外球', 44: '斗士', 45: '执行者',
  51: '远距离抛球(GK)', 52: '步法(GK)', 53: '传中没收者(GK)', 54: '一对一紧逼(GK)', 55: '远距离出击(GK)', 56: '快速反应(GK)',
};

// ---------------------------------------------------------------------------
// payload 契约与价目

export type ShopCategory = 'pa' | 'badge' | 'badge_upgrade' | 'role' | 'position' | 'club_shell';

export const SHOP_CATEGORIES: readonly ShopCategory[] = ['pa', 'badge', 'badge_upgrade', 'role', 'position', 'club_shell'];

export const SHOP_CATEGORY_LABELS: Readonly<Record<ShopCategory, string>> = {
  pa: '买 PA',
  badge: '购徽章',
  badge_upgrade: '银徽升金',
  role: '角色（职责）',
  position: '位置热区',
  club_shell: '队壳申请',
};

export interface ShopPayloadPa {
  playerId: number;
  points: number;
}

export interface ShopPayloadBadge {
  playerId: number;
  kind: 'silver' | 'gold';
  psid: number;
}

export interface ShopPayloadBadgeUpgrade {
  playerId: number;
  psid: number;
}

export interface ShopPayloadRole {
  playerId: number;
  action: 'add' | 'upgrade' | 'remove';
  roleId?: number;
  slot?: number;
}

export interface ShopPayloadPosition {
  playerId: number;
  action: 'add' | 'remove' | 'replace';
  slot: number;
  posId?: number;
}

export interface ShopPayloadClubShell {
  note?: string;
}

export type ShopPayload = ShopPayloadPa | ShopPayloadBadge | ShopPayloadBadgeUpgrade | ShopPayloadRole | ShopPayloadPosition | ShopPayloadClubShell;

// 队壳：同俱乐部同时刻只允许一张待审申请（提交时拦截，避免重复扣费）
export const CLUB_SHELL_PENDING_LIMIT = 1;

// 买 PA 单次点数上下限
export const SHOP_PA_POINTS_MIN = 1;
export const SHOP_PA_POINTS_MAX = 10;

export interface ShopPrices {
  paPerPoint: number;
  clubShell: number;
  badgeSilver: number;
  badgeGold: number;
  badgeSilverToGold: number;
  roleAddPlus: number;
  roleAddPlusPlus: number;
  roleUpgrade: number;
  roleRemove: number;
  positionAdd: number;
  positionRemove: number;
  positionReplace: number;
}

/** 工单金额（M，正数）；payload 结构不合法返回 null（校验层另行报错） */
export function shopPriceOf(category: ShopCategory, payload: ShopPayload, prices: ShopPrices): number | null {
  switch (category) {
    case 'pa': {
      const p = payload as ShopPayloadPa;
      if (!Number.isInteger(p.points) || p.points < SHOP_PA_POINTS_MIN || p.points > SHOP_PA_POINTS_MAX) return null;
      return round2(prices.paPerPoint * p.points);
    }
    case 'badge': {
      const p = payload as ShopPayloadBadge;
      if (p.kind !== 'silver' && p.kind !== 'gold') return null;
      return round2(p.kind === 'silver' ? prices.badgeSilver : prices.badgeGold);
    }
    case 'badge_upgrade':
      return round2(prices.badgeSilverToGold);
    case 'role': {
      const p = payload as ShopPayloadRole;
      if (p.action === 'add') return Number.isInteger(p.roleId) && p.roleId! > 100 ? round2(prices.roleAddPlusPlus) : round2(prices.roleAddPlus);
      if (p.action === 'upgrade') return round2(prices.roleUpgrade);
      if (p.action === 'remove') return round2(prices.roleRemove);
      return null;
    }
    case 'position': {
      const p = payload as ShopPayloadPosition;
      if (p.action === 'add') return round2(prices.positionAdd);
      if (p.action === 'remove') return round2(prices.positionRemove);
      if (p.action === 'replace') return round2(prices.positionReplace);
      return null;
    }
    case 'club_shell':
      return round2(prices.clubShell);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 工单摘要（列表直接展示，前端零翻译）；playerName 缺省时用「球员 #id」 */
export function shopOrderSummary(category: ShopCategory, payload: ShopPayload, playerName?: string | null): string {
  const who = (id: number) => playerName?.trim() || `球员 #${id}`;
  switch (category) {
    case 'pa': {
      const p = payload as ShopPayloadPa;
      return `买 PA：${who(p.playerId)} +${p.points} 点`;
    }
    case 'badge': {
      const p = payload as ShopPayloadBadge;
      const name = SHOP_PS_NAMES[p.psid] ?? `PlayStyle #${p.psid}`;
      return `购徽章：${who(p.playerId)} · ${p.kind === 'silver' ? '银' : '金'}徽「${name}」`;
    }
    case 'badge_upgrade': {
      const p = payload as ShopPayloadBadgeUpgrade;
      const name = SHOP_PS_NAMES[p.psid] ?? `PlayStyle #${p.psid}`;
      return `银徽升金：${who(p.playerId)} ·「${name}」`;
    }
    case 'role': {
      const p = payload as ShopPayloadRole;
      const label = p.roleId != null ? roleLabelOf(p.roleId) : null;
      if (p.action === 'add') return `新增角色：${who(p.playerId)} ·「${label ?? `角色 #${p.roleId}`}」`;
      if (p.action === 'upgrade') return `升级角色：${who(p.playerId)} · 第 ${p.slot ?? '?'} 槽「${label ?? `角色 #${p.roleId}`}」单加号 → 双加号`;
      return `去除角色：${who(p.playerId)} · 第 ${p.slot ?? '?'} 槽`;
    }
    case 'position': {
      const p = payload as ShopPayloadPosition;
      const pos = p.posId != null ? POSITION_BY_ID[p.posId] : null;
      if (p.action === 'add') return `新增位置：${who(p.playerId)} · 热区加「${pos ?? `#${p.posId}`}」`;
      if (p.action === 'remove') return `去除位置：${who(p.playerId)} · 第 ${p.slot} 槽`;
      return `替换位置：${who(p.playerId)} · 第 ${p.slot} 槽 →「${pos ?? `#${p.posId}`}」`;
    }
    case 'club_shell':
      return '队壳申请（管理组线下建壳后交付绑定码）';
  }
}
