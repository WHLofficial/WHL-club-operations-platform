// v6.30.0 C 段：球队详情页两张球员表（阵容名单 / 注册名单）共享的列系统。
// 与球员库同源：可选列池直接由 lib/players-library.ts 的 COL_DEFS 派生，单元格渲染（renderClubCol）
// 与球员库共用同一份实现 —— 球员库（pages/PlayersLibrary.tsx）改成引用本模块后，它自己的列集与行为不变。
// 与球员库的差别只有两处：
//   ① 球队页两张表各有自己的一套固定列（球员库里可选的 违约金/工资 在球队页是固定列，所以池子要减掉这两项）；
//   ② URL 键分成 cols（阵容名单）与 regcols（注册名单）—— 两张表在不同页签，用不同键防串味。
import type { ReactElement, ReactNode } from 'react';
import { COL_DEFS, attrClass, money, parseColsParam, type SortKey } from './players-library.ts';
import { AGENT_TIER_LABEL, CONTRACT_TYPE_LABEL, SOURCE_LABEL, playstyleIsGold } from './ref.ts';
import { basePlaystyleId } from '../../../src/core/fc26.ts';
import { CARD_BUILTIN_COL_KEYS } from './club-cards.ts';
import { BadgeCounts, badgeCountItems } from '../components/BadgeCounts.tsx';
import { PlaystyleBadge } from '../components/PlaystyleBadge.tsx';

/* ---------- 固定列 ---------- */

export interface ClubFixedCol {
  key: string;
  label: string;
  num?: boolean;
}

// 阵容名单固定 11 列（顺序不可改：标记在最左，转会状态收尾）
export const SQUAD_FIXED_COLS: ClubFixedCol[] = [
  { key: 'marker', label: '标记' },
  { key: 'no', label: '号码', num: true },
  { key: 'uid', label: 'UID' },
  { key: 'name', label: '姓名' },
  { key: 'age', label: '年龄', num: true },
  { key: 'positions', label: '位置' },
  { key: 'ca', label: 'CA', num: true },
  { key: 'pa', label: 'PA', num: true },
  { key: 'releaseFee', label: '违约金', num: true },
  { key: 'wage', label: '工资', num: true },
  { key: 'transferStatus', label: '转会状态' },
];

// 注册名单固定 11 列（顺序不可改：分配必须最左 —— 分配开关要贴着球员名一起看）
export const REG_FIXED_COLS: ClubFixedCol[] = [
  { key: 'assignment', label: '分配' },
  ...SQUAD_FIXED_COLS.filter((c) => c.key !== 'transferStatus'),
];

/* ---------- 可选列池 ---------- */

// 升为球队页固定列的两项（球员库里它们还是可选列）
const CLUB_FIXED_COL_KEYS: ReadonlySet<string> = new Set(['wage', 'releaseFee']);

// 可选列池（16）：球员库 COL_DEFS 去掉 工资/解约金。派生而非手抄 ——
// 球员库加列时这里自动跟上，club-columns.test.ts 的 16 项断言会在池子变形时报警
export const CLUB_OPTIONAL_COLS = COL_DEFS.filter((d) => !CLUB_FIXED_COL_KEYS.has(d.key));

const CLUB_OPT_COL_KEYS: ReadonlySet<string> = new Set(CLUB_OPTIONAL_COLS.map((d) => d.key));

/** 「列」开关（MultiSelect）的条目：池子顺序即面板顺序 */
export const CLUB_COL_ITEMS: { value: string; label: string }[] = CLUB_OPTIONAL_COLS.map((d) => ({
  value: d.key,
  label: d.label,
}));

/**
 * v6.37.0 卡片化「列…」自选池：可选列池剔除卡片已内置的 8 键（CARD_BUILTIN_COL_KEYS），
 * 勾出来的都是长尾（徽章/脚/未来之星/中国计划/经纪人等 10 项），追加在卡片指标后面。
 */
export const CARD_EXTRA_ITEMS: { value: string; label: string }[] = CLUB_OPTIONAL_COLS.filter(
  (d) => !CARD_BUILTIN_COL_KEYS.has(d.key),
).map((d) => ({ value: d.key, label: d.label }));

/**
 * 卡片化的 ?cols=/?regcols= 解析：普通解析后再收敛到长尾池。
 * 旧 URL 里可能存着表格时代的内置键（如 ?cols=wage）——不滤就会在卡上重复出一列。
 */
export function parseCardExtras(raw: string | null): string[] {
  const parsed = parseClubColsParam(raw);
  if (!parsed) return [];
  const pool = new Set(CARD_EXTRA_ITEMS.map((i) => i.value));
  return parsed.filter((k) => pool.has(k));
}

/** 可选列表头/文案的唯一来源（认不出的键回落原键：宁可见到怪名，也不静默少一列） */
export function clubColDef(key: string): { label: string; num?: boolean } {
  return CLUB_OPTIONAL_COLS.find((d) => d.key === key) ?? { label: key };
}

// URL 键：阵容名单用 cols、注册名单用 regcols
export const SQUAD_COLS_KEY = 'cols';
export const REG_COLS_KEY = 'regcols';

// 固定列承载的排序键（球队页 × 球员库两套固定列的并集口径见 clubVisibleCols 注释）
const CLUB_FIXED_SORT_KEYS: ReadonlySet<string> = new Set([
  'uid',
  'marker',
  'name',
  'position',
  'age',
  'ca',
  'pa',
  'release_fee',
  'wage',
]);

/**
 * `?cols=` / `?regcols=` 的解析：先过球员库 parseColsParam（含 attr:<属性白名单>），
 * 再按球队页的可选列池过滤 —— 池子外的键（球员库的 工资/解约金、attr: 列）一律当坏值忽略。
 * 键全被滤掉时回落 null（= 可选列全不显示）。
 */
export function parseClubColsParam(raw: string | null): string[] | null {
  const parsed = parseColsParam(raw);
  if (parsed === null) return null;
  const cols = parsed.filter((c) => CLUB_OPT_COL_KEYS.has(c));
  return cols.length > 0 ? cols : null;
}

/**
 * 当前该显示哪些可选列。语义照球员库 players-library.ts 的 sortColumnVisible：
 * 排序键落在固定列上 → 固定列恒在，不用补；落在可选列上 → 没选也自动显列（否则用户会看到
 * 「按看不见的列排了序」）。差别只在「固定列」换成球队页自己的两套 ——
 * 球员库里可选的 违约金/工资 在球队页是固定列，直接照抄球员库的集合会把这两列加两遍。
 */
export function clubVisibleCols(raw: string | null, sortKey: SortKey | null = null): string[] {
  const cols = parseClubColsParam(raw) ?? [];
  if (sortKey === null || CLUB_FIXED_SORT_KEYS.has(sortKey)) return cols;
  const def = CLUB_OPTIONAL_COLS.find((d) => d.sort === sortKey);
  return def === undefined || cols.includes(def.key) ? cols : [...cols, def.key];
}

/** 勾选/取消一列（「列」开关的写入口；写 URL 由调用方按自己的键做） */
export function toggleClubCol(cols: readonly string[], key: string): string[] {
  return cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
}

/* ---------- 转会状态 ---------- */

export type TransferStatusKey = 'listed' | 'transferListed' | 'transferPriced' | 'notForSale';

export interface TransferStatusRow {
  notForSale: boolean;
  status: string;
  transferListed: boolean;
  /** 列表端点只给布尔（min_offer_price 数值不下发）；老夹具可能没有这个键 */
  transferPriced?: boolean;
}

/**
 * 阵容名单第 11 列的四态判定，优先级（用户口径，不可改）：
 * 非卖品 > 挂牌中 > 转会名单 > 已标价 > 无。
 * 「挂牌中」只看 status==='listed' —— 四种挂牌入口（手动/自动等）统一落这一个状态，不分类型与阶段。
 */
export function transferStatusOf(row: TransferStatusRow): TransferStatusKey | null {
  if (row.notForSale) return 'notForSale';
  if (row.status === 'listed') return 'listed';
  if (row.transferListed) return 'transferListed';
  if (row.transferPriced === true) return 'transferPriced';
  return null;
}

/* ---------- 单元格渲染（与球员库共用） ---------- */

/**
 * 单元格渲染要用到的字段（结构化类型，不要求完整行）：
 * 球员库行（PlayerLibraryRow）与球队页两张表的行都满足它。ca/pa 可空 —— 注册名单的行来自
 * /api/club/squad，原始列可能为 NULL（球员库那边 ca/pa 恒有值，行为不变）。
 */
export interface ClubColRow {
  attrValue?: number | null;
  marketValue: number | null;
  badgesSilver: number;
  badgesGold: number;
  prestige: number | null;
  baseCa: number | null;
  ca: number | null;
  pa: number | null;
  foot: number | null;
  growthTier: number | null;
  isFutureStar: boolean;
  chinaPlan: boolean;
  agentTier: number;
  psIds?: (number | null)[] | null;
  fcId: number | null;
  // 违约金/工资在球队页是固定列（不由本函数渲染），但球员库的可选列池里有这两键 —— 一并收着
  releaseFee: number | null;
  wage: number | null;
  contractType: string | null;
  source: string | null;
  protected: boolean;
  serviceSeasons: number | null;
}

export interface PsBadgeRef {
  psid: number;
  gold: boolean;
}

// PlayStyle 槽位原值 → 徽章清单（psIds 与槽位对齐、缺槽 null）
// 空槽不产出条目：null / 0 / 非整数都跳过 —— 与 core/fc26.ts 的 playstyleSlotsOf 同口径
// （后端 psIds 只把 null/非有限数归一，空槽的 0 会透出来，直接渲染就成了「0」）
// 金徽判定与基础 ID 剥离都走 core/ref 的口径，别在这里再写一遍 >=100 / -100
// slot 是数组下标（0 起），playstyleIsGold 收的是槽号（1 起）⇒ 这里 +1，否则下标 12 的 PSID13
// 走不到「金槽」分支（v3.2.1：银段 ID 落在金槽时会显示成银，与属性页的 🥇 不一致）
// v6.30.0：自 pages/PlayersLibrary.tsx 移入本模块（球员库照旧从这里 re-export）
// v6.35.0：由拼字符串（psNames）改成给渲染用的清单，ps 列改用 PlaystyleBadge compact
export function psBadgesOf(row: { psIds?: (number | null)[] | null }): PsBadgeRef[] {
  if (!row.psIds || row.psIds.length === 0) return [];
  const out: PsBadgeRef[] = [];
  row.psIds.forEach((v, slot) => {
    if (v === null || !Number.isInteger(v) || v <= 0) return;
    const gold = playstyleIsGold(v, slot + 1);
    out.push({ psid: basePlaystyleId(v), gold });
  });
  return out;
}

/**
 * 可选列单元格内容（v6.37.0 从 renderClubCol 提出，外壳与内容分离）：
 * 卡片化布局（阵容/注册名单）渲染同一份内容时不再包 td；球员库与表格形态照旧走 renderClubCol。
 * key 是 COL_DEFS 的键或 `attr:<属性键>`；内容里的列表项由调用方自行带 key。
 */
export function clubCellContent(key: string, p: ClubColRow): ReactNode {
  if (key.startsWith('attr:')) return p.attrValue ?? '—';
  switch (key) {
    case 'marketValue':
      return money(p.marketValue);
    case 'badges':
      return badgeCountItems(p.badgesSilver, p.badgesGold).length === 0 ? (
        '—'
      ) : (
        <BadgeCounts silver={p.badgesSilver} gold={p.badgesGold} density="text" />
      );
    case 'prestige':
      return p.prestige ?? '—';
    case 'baseCa':
      return p.baseCa ?? '—';
    case 'growthGap':
      return p.pa === null || p.ca === null ? '—' : p.pa - p.ca;
    case 'foot':
      return p.foot === null ? '—' : p.foot === 0 ? '左脚' : '右脚';
    case 'growthTier':
      return p.growthTier === null ? '—' : `${p.growthTier} 档`;
    case 'futureStar':
      return p.isFutureStar ? '★' : '—';
    case 'chinaPlan':
      return p.chinaPlan ? '✓' : '—';
    case 'agentTier':
      return AGENT_TIER_LABEL[p.agentTier] ?? '—';
    case 'ps': {
      const badges = psBadgesOf(p);
      return badges.length === 0
        ? '—'
        : badges.map((b, i) => <PlaystyleBadge key={`${b.psid}-${i}`} psid={b.psid} gold={b.gold} compact />);
    }
    case 'fcId':
      return p.fcId ?? '—';
    case 'wage':
      return money(p.wage);
    case 'releaseFee':
      return p.releaseFee === null ? '—' : money(p.releaseFee);
    case 'contractType':
      return p.contractType ? (CONTRACT_TYPE_LABEL[p.contractType] ?? p.contractType) : '—';
    case 'source':
      return p.source ? (SOURCE_LABEL[p.source] ?? p.source) : '—';
    case 'protected':
      return p.contractType ? (p.protected ? '保护中' : '非保护') : '—';
    case 'years':
      // == null 而非 === null：API 漂移缺字段（undefined）时降级 '—' 而不是崩（同 club-cards 口径）
      return p.serviceSeasons == null ? '—' : `${p.serviceSeasons.toFixed(1)} 年`;
    default:
      return '—';
  }
}

/** 可选列单元格的 td 类名（与内容分离后由 renderClubCol 统一挂） */
export function clubCellClass(key: string, p: ClubColRow): string {
  if (key.startsWith('attr:')) return 'num mono';
  switch (key) {
    case 'badges':
    case 'fcId':
      return 'mono';
    case 'ps':
      return 'mono ps-cell';
    case 'baseCa':
      return `num mono${p.baseCa === null ? '' : ` ${attrClass(p.baseCa)}`}`;
    case 'foot':
    case 'futureStar':
    case 'chinaPlan':
    case 'agentTier':
    case 'contractType':
    case 'source':
    case 'protected':
      return '';
    default:
      return 'num mono';
  }
}

/**
 * 可选列单元格（v6.30.0：自 pages/PlayersLibrary.tsx 的 renderCol 提出，球员库与本模块共用一份）。
 * key 是 COL_DEFS 的键或 `attr:<属性键>`；每个分支都带 key={key}。
 */
export function renderClubCol(key: string, p: ClubColRow): ReactElement {
  return <td key={key} className={clubCellClass(key, p)}>{clubCellContent(key, p)}</td>;
}
