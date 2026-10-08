// v6.37.0 两表卡片化的纯函数层：位置四组容器、行内徽章（优先级折叠）、四视图/桌面全列的
// 指标定义、激活价前端镜像、金额整数显示。渲染组件在 pages/club/card-parts.tsx，两张表
// （阵容名单 / 注册名单）共用。定稿依据：视觉定稿画板 v1–v5 + 屏 14/15（2026-10-05/06），
// 见 memory/plan-v6.37.0-squad-cards.md。
import { POSITION_GROUPS, POSITION_GROUP_BY_POSITION } from '../../../src/core/fc26.ts';
import { TRAINEE_ACTIVATION_FEE } from '../../../src/core/market-rules.ts';
import { AGENT_TIER_LABEL } from './ref.ts';
import { money } from './players-library.ts';

/* ---------- 位置四组容器 ---------- */

export type PositionGroupKey = 'GK' | 'DF' | 'MF' | 'FW';

export interface CardPositionGroup<T> {
  key: PositionGroupKey | 'unknown';
  label: string;
  rows: T[];
}

/** 主位置 → 四档；未知（null / 映射外）落 unknown，展示时殿后 */
export function positionGroupKeyOf(position: string | null): PositionGroupKey | 'unknown' {
  if (position === null) return 'unknown';
  return (POSITION_GROUP_BY_POSITION[position] as PositionGroupKey | undefined) ?? 'unknown';
}

/**
 * 四组容器（档序后场→前场；用户裁决：分组纯布局，不影响任何列集）。
 * 空组丢弃——「0 门将」的信号由阵容组顶部的位置分布行承担，卡片区不再重复；unknown 殿后。
 */
export function groupRowsByPosition<T extends { position: string | null }>(rows: readonly T[]): CardPositionGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = positionGroupKeyOf(row.position);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }
  const out: CardPositionGroup<T>[] = [];
  for (const g of POSITION_GROUPS) {
    const list = buckets.get(g.key);
    // POSITION_GROUPS 的档序即 GK/DF/MF/FW（src/core/fc26.ts 定死），收窄回本模块的四档键
    if (list && list.length > 0) out.push({ key: g.key as PositionGroupKey, label: g.label, rows: list });
  }
  const unknown = buckets.get('unknown');
  if (unknown && unknown.length > 0) out.push({ key: 'unknown', label: '其他', rows: unknown });
  return out;
}

/* ---------- 行内徽章（定稿：只显 1 个 + N） ---------- */

export type InlineBadgeKind = 'status' | 'protect' | 'star' | 'china';

export interface InlineBadge {
  kind: InlineBadgeKind;
  text: string;
}

export interface InlineBadgeRow {
  status: string;
  // 阵容名单行才有（/api/players 的转会设置）；注册名单行没有这些键 → undefined 走不到对应分支
  notForSale?: boolean;
  transferListed?: boolean;
  transferPriced?: boolean;
  // 注册名单行才有（/api/club/squad）
  hasContract?: boolean;
  contractType: string | null;
  protected: boolean;
  isFutureStar: boolean;
  chinaPlan: boolean;
}

/**
 * 行内徽章，数组顺序即优先级（用户定稿：状态 > 保护期 > 未来之星 > 中国计划），
 * 展示侧只取第 1 个、其余折进 +N。状态类的四态优先级照抄 club-columns transferStatusOf
 * 的注释口径：非卖品 > 挂牌中 > 转会名单 > 已标价；无合同只属于注册名单行。
 * 本模块不 import club-columns（它拉着一串 React 组件），这里按同一口径重写四态判定。
 */
export function inlineBadgesOf(row: InlineBadgeRow): InlineBadge[] {
  const out: InlineBadge[] = [];
  if (row.status === 'retired') out.push({ kind: 'status', text: '退役' });
  else if (row.notForSale) out.push({ kind: 'status', text: '非卖品' });
  else if (row.status === 'listed') out.push({ kind: 'status', text: '挂牌中' });
  else if (row.transferListed) out.push({ kind: 'status', text: '转会名单' });
  else if (row.transferPriced === true) out.push({ kind: 'status', text: '已标价' });
  else if (row.hasContract === false) out.push({ kind: 'status', text: '无合同' });
  // 保护期只在有合同时有意义（无合同时服务端的 protected 恒 false，这里再兜一层）
  if (row.protected && row.contractType !== null) out.push({ kind: 'protect', text: '保护期' });
  if (row.isFutureStar) out.push({ kind: 'star', text: '未来之星' });
  if (row.chinaPlan) out.push({ kind: 'china', text: '中国计划' });
  return out;
}

/* ---------- 激活价（前端镜像） ---------- */

/**
 * 激活价（口径同 core activationFee + activations.ts 的训练营分支）：
 * 训练营固定 5m；保护期 ×2（违约金 ≤20）/ ×1.5（>20）；无保护 ×1；定不了价（无合同/无违约金）null。
 * v6.37.0 起激活价为整数（m），1.5 倍的 .5 四舍五入 —— 与 core 同一口径。
 * 保护期判定用服务端算好的 protected（ticks 比较在服务端），前端不再复制一份 ticks 口径。
 */
export function activationFeeOf(row: {
  hasContract?: boolean;
  contractType: string | null;
  protected: boolean;
  releaseFee: number | null;
}): number | null {
  if (row.hasContract === false) return null;
  if (row.contractType === 'trainee') return TRAINEE_ACTIVATION_FEE;
  if (row.releaseFee == null || row.releaseFee <= 0) return null;
  const mult = row.protected ? (row.releaseFee <= 20 ? 2 : 1.5) : 1;
  return Math.round(row.releaseFee * mult);
}

/* ---------- 金额整数显示 ---------- */

/**
 * 违约金/激活价的整数显示（v6.37.0；v6.37.2 起带单位）：37 → '37m'、12.5 → '12.5m'，null → null。
 * 只减尾零、不做进位取舍；存量小数照实显示。工资不走这里（保持 money() 两位小数）。
 */
export function moneyIntText(x: number | null): string | null {
  if (x == null) return null;
  return `${Math.round(x * 100) / 100}m`;
}

/* ---------- 位置副行文案 ---------- */

/** 副行位置（定稿）：默认「主位置 +N」，点开全量逗号分隔；无位置 null */
export function positionSummary(positions: readonly string[], expanded: boolean): string | null {
  if (positions.length === 0) return null;
  if (expanded || positions.length === 1) return positions.join(', ');
  return `${positions[0]} +${positions.length - 1}`;
}

/* ---------- 指标视图（窄屏四视图 chips / 桌面全列合并） ---------- */

export type CardViewKey = 'basic' | 'growth' | 'contract' | 'market';

export interface CardView {
  key: CardViewKey;
  label: string;
}

/** 窄屏四视图（定稿 G 方案）：chips 快切；桌面 = 四视图全列合并、无 chips */
export const CARD_VIEWS: readonly CardView[] = [
  { key: 'basic', label: '基本' },
  { key: 'growth', label: '成长' },
  { key: 'contract', label: '合同' },
  { key: 'market', label: '市场' },
];

/** 指标格要读的字段（结构化类型：PlayerLibraryRow 与 SquadPlayerRow 都满足） */
export interface CardMetricRow {
  age: number | null;
  ca: number | null;
  pa: number | null;
  baseCa: number | null;
  growthTier: number | null;
  wage: number | null;
  releaseFee: number | null;
  serviceSeasons: number | null;
  contractType: string | null;
  protected: boolean;
  hasContract?: boolean;
  marketValue: number | null;
  influence: number;
  agentTier: number;
}

export interface CardCell {
  key: string;
  label: string;
  num?: boolean;
  get: (row: CardMetricRow) => string | null;
  /** v6.38.1：0-99 能力值刻度列返回该值 ⇒ 值格由 metricValues 套 attrClass 五档分段色
     （CA / PA / 初始 CA；与 players-library lensChipFor 的 colored 先例同一适用域边界——
     年龄/差值/金额/效力时长/文本不设，套了会被误读）。 */
  shade?: (row: CardMetricRow) => number | null;
}

/**
 * 四视图的列（定稿画板 v5 + 屏 13）：
 * 基本 = 年龄/CA/PA；成长 = 初始CA/成长空间/成长档位；
 * 合同 = 工资/违约金/激活价/效力；市场 = 身价/影响力/经纪人。
 * 工资与身价保持 money() 两位小数；违约金/激活价走整数显示（v6.37.0 整数化）。
 */
export const CARD_VIEW_CELLS: Record<CardViewKey, readonly CardCell[]> = {
  basic: [
    { key: 'age', label: '年龄', num: true, get: (r) => (r.age == null ? null : String(r.age)) },
    {
      key: 'ca',
      label: 'CA',
      num: true,
      get: (r) => (r.ca == null ? null : String(r.ca)),
      // 0-99 能力值刻度 ⇒ v6.38.1 套 attrClass 五档色（年龄不在能力刻度内，不上色）
      shade: (r) => r.ca ?? null,
    },
    {
      key: 'pa',
      label: 'PA',
      num: true,
      get: (r) => (r.pa == null ? null : String(r.pa)),
      shade: (r) => r.pa ?? null,
    },
  ],
  growth: [
    {
      key: 'baseCa',
      label: '初始CA',
      num: true,
      get: (r) => (r.baseCa == null ? null : String(r.baseCa)),
      shade: (r) => r.baseCa ?? null,
    },
    {
      key: 'growthGap',
      label: '成长空间',
      num: true,
      // PA−CA 差值不属于能力值刻度（90−60=30 套「弱」色是误读，lensChipFor 同口径），不上色
      get: (r) => (r.ca == null || r.pa == null ? null : String(r.pa - r.ca)),
    },
    {
      key: 'growthTier',
      label: '成长档位',
      num: true,
      // 0 = 不可成长（可成长才有 1–3 档），显 —
      get: (r) => (r.growthTier == null || r.growthTier <= 0 ? null : `T${r.growthTier}`),
    },
  ],
  contract: [
    { key: 'wage', label: '工资', num: true, get: (r) => (r.wage == null ? null : money(r.wage)) },
    { key: 'releaseFee', label: '违约金', num: true, get: (r) => moneyIntText(r.releaseFee) },
    { key: 'activation', label: '激活价', num: true, get: (r) => moneyIntText(activationFeeOf(r)) },
    // 效力值不带空格（「0.5年」）：卡片值格窄屏 nowrap 钉宽，60px 兜住最长「10.5年」。
    // v6.38.1：单位 赛季→年（用户裁决「效力时间的年语义同赛季」，1 年 = 1 赛季，数值口径不变）
    { key: 'years', label: '效力', num: true, get: (r) => (r.serviceSeasons == null ? null : `${r.serviceSeasons}年`) },
  ],
  market: [
    { key: 'marketValue', label: '身价', num: true, get: (r) => (r.marketValue == null ? null : money(r.marketValue)) },
    // e2e ⑨ 教训：字段缺失（undefined）不该崩整页——渲染层一律降级 '—'，nullish 守卫覆盖 API 漂移
    { key: 'influence', label: '影响力', num: true, get: (r) => (r.influence == null ? null : r.influence.toFixed(2)) },
    { key: 'agent', label: '经纪人', get: (r) => AGENT_TIER_LABEL[r.agentTier] ?? null },
  ],
};

/** 桌面全列 = 四视图依序合并（13 指标，定稿 B 形态：两行高行解剖 + 指标平铺） */
export const DESKTOP_CELLS: readonly CardCell[] = [
  ...CARD_VIEW_CELLS.basic,
  ...CARD_VIEW_CELLS.growth,
  ...CARD_VIEW_CELLS.contract,
  ...CARD_VIEW_CELLS.market,
];

/**
 * 注册工作台桌面列 = 全列去掉「初始CA」「成长空间」（11 指标）。
 * 用户裁决（v6.39.2）：「注册工作台舍弃初始CA和成长空间，以放下所有列在一行」——注册台行尾恒有
 * 「分配 ▾」列（--sqc-assignw），13 列在 1280 视口放不下会折成两行；砍掉这两列后 11 列单行放下。
 * 阵容页签（SquadTab）仍用 DESKTOP_CELLS 全 13 列（那一屏没有分配列）。
 */
export const DESKTOP_CELLS_DESK: readonly CardCell[] = DESKTOP_CELLS.filter(
  (c) => c.key !== 'baseCa' && c.key !== 'growthGap',
);

/** 卡片已内置的列键（COL_DEFS 键名）：「列…」自选池要剔除它们，勾出来的都是长尾 */
export const CARD_BUILTIN_COL_KEYS: ReadonlySet<string> = new Set([
  'baseCa',
  'growthGap',
  'growthTier',
  'wage',
  'releaseFee',
  'years',
  'marketValue',
  'agentTier',
]);
