// 球员库的筛选模型与列模型（v3.1.0 从 pages/PlayersLibrary.tsx 拆出，供页面与 FilterPanel 共用）。
// 四件事都在这里：Filters 类型与默认值、URL query ↔ 筛选状态的互转、筛选 → 自动列的联动规则、
// 生效条件摘要条（filterChips）。拆出来的原因：控件搬进左栏后页面与面板都要用这套模型，
// 留在页面里会形成页面 ↔ 组件的循环导入。
import { AGENT_TIER_LABEL, CONTRACT_TYPE_LABEL, SOURCE_LABEL, playstyleById } from './ref.ts';
import { FC26_GAME_ATTR_COLUMNS, isGoldPlaystyleId, isPlaystyleId } from '../../../src/core/fc26.ts';
import { SORT_KEY_NAMES } from '../../../src/core/players-sort.ts';
import { MARKER_VALUES, type PlayerMarker } from '../../../src/core/squad-rules.ts';

// 标记（v6.5.0）的展示文案：emoji 是标记本体，title/hover 出全称
export const MARKER_EMOJI: Record<PlayerMarker, string> = { ge90: '🔴', ge87: '🟡', growth: '🟢' };
export const MARKER_LABEL: Record<PlayerMarker, string> = {
  ge90: '初始CA ≥ 90',
  ge87: '初始CA 87-89',
  growth: '初始CA < 87 且 PA ≥ 87 可成长',
};

// 细分属性白名单：与后端同一份来源（core/fc26 的 sprintspeed 起 34 项，players.ts 也这么切）。
// 前端只用它做校验与下拉展示 —— 硬校验仍在后端；但校验口径必须一致，否则一个手改的
// `?sort=attr:foo` 会通过前端、再让整个列表请求 400（整页变成错误态）。
export const ATTR_KEYS: readonly string[] = FC26_GAME_ATTR_COLUMNS.slice(FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed'));

export type View = 'current' | 'initial';

// 排序键：与后端共用同一份表（core/players-sort.ts，players.ts 也 import 它），外加
// `attr:<属性键>`（后端同样支持按细分属性排序）。表头每一列都可点，映射见 FIXED_COLUMNS 与 COL_DEFS。
// 从 core 引入而不是本地写一份：原先两边各一份字面量，测试比对的是硬编码副本，
// 后端加键、前端漏加不会有任何断言报错
export const SORT_KEYS = SORT_KEY_NAMES;

export type SortKey = (typeof SORT_KEYS)[number] | `attr:${string}`;

// 首次点某列表头的方向：身份、文本与业务序（在队→退役）从小到大，其余数值与标记类从大到小
// —— 点 CA / 身价 / 徽章的人想看的是「最好的在前」，点姓名的人想看字母序
const ASC_FIRST: ReadonlySet<string> = new Set(['id', 'uid', 'name', 'club', 'position', 'status', 'contract_type', 'source']);

export function firstOrderFor(key: SortKey): 'asc' | 'desc' {
  return ASC_FIRST.has(key) ? 'asc' : 'desc';
}

// URL 里的 sort：接受 29 个固定键或 attr:<白名单属性键>。真正的白名单在后端（非法值会 400），
// 这里按同一份 ATTR_KEYS 校验，免得手改的 URL 先被当真、再让整页请求 400
export function isSortKey(v: string): v is SortKey {
  if ((SORT_KEYS as readonly string[]).includes(v)) return true;
  return v.startsWith('attr:') && ATTR_KEYS.includes(v.slice(5));
}

export const STATUS_LABEL: Record<string, string> = {
  normal: '在队',
  listed: '挂牌中',
  trainee: '训练营',
  free: '自由身',
  retired: '退役',
};

export const STATUS_BADGE: Record<string, string> = {
  normal: 'sky',
  listed: 'gold',
  trainee: 'purple',
  free: 'gray',
  retired: 'gray',
};

// 位置全集按 PositionID 升序（同 src/core/fc26.ts POSITION_BY_ID）。
// v3.1.1 前这里还有一份 POSITION_GROUPS（门将/后卫/中场/前锋整组选中的快捷 chip），
// 位置改多选下拉后只剩 12 个码位，那份分组没有引用者了。
export const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'CDM', 'RM', 'CM', 'LM', 'CAM', 'RW', 'ST', 'LW'];

export const PAGE_SIZE = 20;

export interface Filters {
  view: View;
  name: string;
  positions: string[];
  status: string;
  growable: 'all' | '1' | '0';
  sort: SortKey;
  order: 'asc' | 'desc';
  club: string; // ''=全部 | 'free'=自由身 | 俱乐部 id
  caMin: string;
  caMax: string;
  paMin: string;
  paMax: string;
  ageMin: string;
  ageMax: string;
  baseCaMin: string;
  baseCaMax: string;
  gapMin: string;
  gapMax: string;
  mvMin: string;
  mvMax: string;
  inflMin: string;
  inflMax: string;
  attr: string;
  attrMin: string;
  attrMax: string;
  foot: '' | '0' | '1';
  growthTier: string;
  futureStar: boolean;
  chinaPlan: boolean;
  agentTier: string;
  marker: '' | PlayerMarker;
  ps: number[];
  hasContract: '' | '1' | '0';
  wageMin: string;
  wageMax: string;
  rcMin: string;
  rcMax: string;
  rcNone: boolean;
  contractType: string;
  source: string;
  protectedSel: '' | 'in' | 'out';
  yearsMin: string;
  yearsMax: string;
  fcId: string;
}

export const EMPTY_FILTERS: Filters = {
  view: 'current',
  name: '',
  positions: [],
  status: '',
  growable: 'all',
  sort: 'id',
  order: 'desc',
  club: '',
  caMin: '',
  caMax: '',
  paMin: '',
  paMax: '',
  ageMin: '',
  ageMax: '',
  baseCaMin: '',
  baseCaMax: '',
  gapMin: '',
  gapMax: '',
  mvMin: '',
  mvMax: '',
  inflMin: '',
  inflMax: '',
  attr: '',
  attrMin: '',
  attrMax: '',
  foot: '',
  growthTier: '',
  futureStar: false,
  chinaPlan: false,
  agentTier: '',
  marker: '',
  ps: [],
  hasContract: '',
  wageMin: '',
  wageMax: '',
  rcMin: '',
  rcMax: '',
  rcNone: false,
  contractType: '',
  source: '',
  protectedSel: '',
  yearsMin: '',
  yearsMax: '',
  fcId: '',
};

// 区间类筛选 → URL 键的显式映射（键名与后端参数对齐；camelCase 推导会得到 gap_min 这类错键）
type StringFilterKey = { [K in keyof Filters]: Filters[K] extends string ? K : never }[keyof Filters];
const RANGE_URL_KEYS: [StringFilterKey, string][] = [
  ['caMin', 'ca_min'],
  ['caMax', 'ca_max'],
  ['paMin', 'pa_min'],
  ['paMax', 'pa_max'],
  ['ageMin', 'age_min'],
  ['ageMax', 'age_max'],
  ['baseCaMin', 'base_ca_min'],
  ['baseCaMax', 'base_ca_max'],
  ['gapMin', 'growth_gap_min'],
  ['gapMax', 'growth_gap_max'],
  ['mvMin', 'market_value_min'],
  ['mvMax', 'market_value_max'],
  ['inflMin', 'influence_min'],
  ['inflMax', 'influence_max'],
  ['attrMin', 'attr_min'],
  ['attrMax', 'attr_max'],
  ['wageMin', 'wage_min'],
  ['wageMax', 'wage_max'],
  ['rcMin', 'release_fee_min'],
  ['rcMax', 'release_fee_max'],
  ['yearsMin', 'effective_years_min'],
  ['yearsMax', 'effective_years_max'],
];

// URL query ↔ 筛选状态：键名与后端参数对齐，方便直接拼接口径
export function filtersFromUrl(): Filters {
  const q = new URLSearchParams(window.location.search);
  const str = (k: string) => q.get(k) ?? '';
  const f: Filters = { ...EMPTY_FILTERS };
  if (str('view') === 'initial') f.view = 'initial';
  f.name = str('name');
  // 去重：URL 里手写 ?position=GK,GK 会出重复项（摘要条上就是两个一样的 chip、React key 也重复）
  f.positions = str('position') ? [...new Set(str('position').split(',').filter((p) => POSITIONS.includes(p)))] : [];
  f.status = str('status');
  if (str('growable') === '1' || str('growable') === '0') f.growable = str('growable') as '1' | '0';
  const sortParam = str('sort');
  if (isSortKey(sortParam)) f.sort = sortParam;
  if (str('order') === 'asc') f.order = 'asc';
  f.club = str('club_id') === 'free' ? 'free' : str('club_id').replace(/\D/g, '');
  for (const [key, urlKey] of RANGE_URL_KEYS) {
    (f as unknown as Record<string, string>)[key] = str(urlKey).replace(/[^\d.-]/g, '');
  }
  f.attr = str('attr');
  if (str('foot') === '0' || str('foot') === '1') f.foot = str('foot') as '0' | '1';
  f.growthTier = str('growth_tier').replace(/\D/g, '');
  f.futureStar = str('is_future_star') === '1';
  f.chinaPlan = str('china_plan') === '1';
  f.agentTier = str('agent_tier').replace(/\D/g, '');
  f.marker = (MARKER_VALUES as readonly string[]).includes(str('marker')) ? (str('marker') as PlayerMarker) : '';
  f.ps = str('ps') ? [...new Set(str('ps').split(',').map(Number).filter((n) => isPlaystyleId(n)))] : [];
  if (str('has_contract') === '1' || str('has_contract') === '0') f.hasContract = str('has_contract') as '1' | '0';
  f.rcNone = str('release_fee_none') === '1';
  f.contractType = str('contract_type');
  f.source = str('source');
  if (str('protected') === 'in' || str('protected') === 'out') f.protectedSel = str('protected') as 'in' | 'out';
  f.fcId = str('fc_id').replace(/\D/g, '');
  return f;
}

export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string) => {
    if (v !== '') p.set(k, v);
  };
  if (f.view === 'initial') p.set('view', 'initial');
  put('name', f.name);
  put('position', f.positions.join(','));
  put('status', f.status);
  put('growable', f.growable === 'all' ? '' : f.growable);
  put('sort', f.sort === 'id' ? '' : f.sort);
  put('order', f.sort === 'id' ? '' : f.order);
  put('club_id', f.club);
  put('ca_min', f.caMin);
  put('ca_max', f.caMax);
  put('pa_min', f.paMin);
  put('pa_max', f.paMax);
  put('age_min', f.ageMin);
  put('age_max', f.ageMax);
  put('base_ca_min', f.baseCaMin);
  put('base_ca_max', f.baseCaMax);
  put('growth_gap_min', f.gapMin);
  put('growth_gap_max', f.gapMax);
  put('market_value_min', f.mvMin);
  put('market_value_max', f.mvMax);
  put('influence_min', f.inflMin);
  put('influence_max', f.inflMax);
  put('attr', f.attr);
  if (f.attr) {
    put('attr_min', f.attrMin);
    put('attr_max', f.attrMax);
  }
  put('foot', f.foot);
  put('growth_tier', f.growthTier);
  put('is_future_star', f.futureStar ? '1' : '');
  put('china_plan', f.chinaPlan ? '1' : '');
  put('agent_tier', f.agentTier);
  put('marker', f.marker);
  // 金段 ID（101-199）也要发出去：银徽与金徽各查各的槽（v3.1.1 步骤 4）。
  // 这里的过滤是防手改地址栏塞脏值 —— 后端会 400，整个列表变成错误态。
  put('ps', f.ps.filter((n) => isPlaystyleId(n)).join(','));
  put('has_contract', f.hasContract);
  put('wage_min', f.wageMin);
  put('wage_max', f.wageMax);
  put('release_fee_min', f.rcMin);
  put('release_fee_max', f.rcMax);
  put('release_fee_none', f.rcNone ? '1' : '');
  put('contract_type', f.contractType);
  put('source', f.source);
  put('protected', f.protectedSel);
  put('effective_years_min', f.yearsMin);
  put('effective_years_max', f.yearsMax);
  put('fc_id', f.fcId);
  p.set('limit', String(PAGE_SIZE));
  return p.toString();
}

// ---- 列系统：基础列恒在；可变列默认两列，其余由筛选联动自动加（手动调过则以手动为准） ----

export const DEFAULT_COLS = ['marketValue', 'badges'];

// 固定 10 列（标签 / 排序键 / 是否数值列）。数组顺序就是表头与单元格的渲染顺序，改动前先看页面行渲染同序
export const FIXED_COLUMNS: { label: string; sort: SortKey; num?: boolean }[] = [
  { label: 'UID', sort: 'uid' },
  { label: '姓名', sort: 'name' },
  { label: '所属球队', sort: 'club' },
  { label: '位置', sort: 'position' },
  { label: '年龄', sort: 'age', num: true },
  { label: 'CA', sort: 'ca', num: true },
  { label: 'PA', sort: 'pa', num: true },
  { label: '成长', sort: 'growable' },
  { label: '影响力', sort: 'influence', num: true },
  { label: '状态', sort: 'status' },
];

export const COL_DEFS: { key: string; label: string; sort: SortKey; num?: boolean }[] = [
  { key: 'marketValue', label: '身价', sort: 'market_value', num: true },
  { key: 'badges', label: '徽章', sort: 'badges' },
  { key: 'prestige', label: '声望', sort: 'prestige', num: true },
  { key: 'baseCa', label: '初始 CA', sort: 'base_ca', num: true },
  { key: 'growthGap', label: '成长空间', sort: 'growth_gap', num: true },
  { key: 'foot', label: '惯用脚', sort: 'foot' },
  { key: 'growthTier', label: '成长档位', sort: 'growth_tier' },
  { key: 'futureStar', label: '未来之星', sort: 'future_star' },
  { key: 'chinaPlan', label: '中国计划', sort: 'china_plan' },
  { key: 'agentTier', label: '经纪人', sort: 'agent_tier' },
  { key: 'marker', label: '标记', sort: 'marker' },
  { key: 'ps', label: 'PlayStyle', sort: 'ps' },
  { key: 'fcId', label: 'FC ID', sort: 'fc_id', num: true },
  { key: 'wage', label: '工资（半赛季）', sort: 'wage', num: true },
  { key: 'releaseFee', label: '解约金', sort: 'release_fee', num: true },
  { key: 'contractType', label: '合同类型', sort: 'contract_type' },
  { key: 'source', label: '成约方式', sort: 'source' },
  { key: 'protected', label: '保护期', sort: 'protected' },
  { key: 'years', label: '效力时长', sort: 'years', num: true },
];

const COL_KEYS: ReadonlySet<string> = new Set(COL_DEFS.map((d) => d.key));

// 某个排序键此刻是否有可见的列承载它。两边命名不同名（列键是驼峰 marketValue，排序键是后端的
// market_value；attr 列则与排序键同名 attr:sprintspeed），所以不能拿 filters.sort 直接去 activeCols 里找
export function sortColumnVisible(key: SortKey, activeCols: readonly string[]): boolean {
  if (FIXED_COLUMNS.some((c) => c.sort === key)) return true;
  if (activeCols.includes(key)) return true;
  return COL_DEFS.some((d) => d.sort === key && activeCols.includes(d.key));
}

// `?cols=` 的解析：只认 COL_DEFS 里的键与 attr:<白名单属性键>。
// 手改 URL 塞进来的别的键照旧会渲染成表头（表头列不是硬校验点），但 `attr:` 前缀必须过白名单，
// 否则它既能骗过排序校验、又会在点表头时把列表请求打成 400
export function parseColsParam(raw: string | null): string[] | null {
  const cols = (raw ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => (c.startsWith('attr:') ? ATTR_KEYS.includes(c.slice(5)) : COL_KEYS.has(c)));
  return cols.length > 0 ? cols : null;
}

// 筛选 → 自动加列（双向联动的「筛了就显示」半边；取消筛选自动撤由派生实现）
export function autoColsFor(f: Filters): string[] {
  const cols: string[] = [];
  if (f.baseCaMin || f.baseCaMax) cols.push('baseCa');
  if (f.gapMin || f.gapMax) cols.push('growthGap');
  if (f.mvMin || f.mvMax) cols.push('marketValue');
  if (f.attr) cols.push(`attr:${f.attr}`);
  if (f.foot) cols.push('foot');
  if (f.growthTier) cols.push('growthTier');
  if (f.futureStar) cols.push('futureStar');
  if (f.chinaPlan) cols.push('chinaPlan');
  if (f.agentTier) cols.push('agentTier');
  if (f.marker) cols.push('marker');
  if (f.ps.length > 0) cols.push('ps');
  if (f.fcId) cols.push('fcId');
  if (f.hasContract || f.wageMin || f.wageMax || f.contractType) cols.push('wage', 'contractType');
  if (f.rcMin || f.rcMax || f.rcNone) cols.push('releaseFee');
  if (f.source) cols.push('source');
  if (f.protectedSel) cols.push('protected');
  if (f.yearsMin || f.yearsMax) cols.push('years');
  return cols;
}

// ---- 生效条件摘要条（v3.1.0 步骤 5）：当前筛选翻成一行可删 chips ----
// 每个 chip 只带「把自己清掉」的补丁，页面合并回 Filters —— 这里保持纯函数，不碰状态也不碰 DOM。
export interface FilterChip {
  id: string;
  label: string;
  clear: Partial<Filters>;
}

// 区间项：两边各自成一条 chips（与输入框一一对应，删掉「CA ≥ 70」不会连「CA ≤ 90」一起丢）
const RANGE_CHIP_GROUPS: [keyof Filters, keyof Filters, string, string][] = [
  ['caMin', 'caMax', 'CA', ''],
  ['paMin', 'paMax', 'PA', ''],
  ['ageMin', 'ageMax', '年龄', ' 岁'],
  ['baseCaMin', 'baseCaMax', '初始 CA', ''],
  ['gapMin', 'gapMax', '成长空间', ''],
  ['mvMin', 'mvMax', '身价', ' m'],
  ['inflMin', 'inflMax', '影响力', ''],
  ['wageMin', 'wageMax', '工资', ' m'],
  ['rcMin', 'rcMax', '解约金', ' m'],
  ['yearsMin', 'yearsMax', '效力时长', ' 赛季'],
];

// 摘要条里的徽章名：金段的 chs/en 都带 " +" 后缀（参考表如此），金徽章那一类已经写在
// chip 前缀里了，名字再拖一个加号是噪音。
function psChipName(id: number, gold: boolean): string {
  const ref = playstyleById.get(id);
  const name = ref?.chs ?? ref?.en ?? String(id);
  return gold ? name.replace(/\s*\+\s*$/, '') : name;
}

export function filterChips(f: Filters, clubs: readonly { id: number; name: string }[]): FilterChip[] {
  const chips: FilterChip[] = [];
  const push = (id: string, label: string, clear: Partial<Filters>) => chips.push({ id, label, clear });

  if (f.name) push('name', `姓名含「${f.name}」`, { name: '' });
  // 位置与 PlayStyle 是「一类一条」：多选很容易选出一串，逐个成 chip 会把摘要条铺满；
  // 点 × 清掉整类。位置只此一条，PlayStyle 按银/金两段各一条（徽章名去掉金段的 " +" 后缀）。
  if (f.positions.length > 0) push('positions', `位置：${f.positions.join('、')}`, { positions: [] });
  if (f.status) push('status', `状态：${STATUS_LABEL[f.status] ?? f.status}`, { status: '' });
  if (f.club) {
    const name = f.club === 'free' ? '自由身' : (clubs.find((c) => String(c.id) === f.club)?.name ?? f.club);
    push('club', `俱乐部：${name}`, { club: '' });
  }
  if (f.growable !== 'all') push('growable', f.growable === '1' ? '仅可成长' : '仅非成长', { growable: 'all' });

  for (const [minKey, maxKey, label, unit] of RANGE_CHIP_GROUPS) {
    const min = f[minKey] as string;
    const max = f[maxKey] as string;
    if (min) push(String(minKey), `${label} ≥ ${min}${unit}`, { [minKey]: '' } as Partial<Filters>);
    if (max) push(String(maxKey), `${label} ≤ ${max}${unit}`, { [maxKey]: '' } as Partial<Filters>);
  }

  if (f.attr) {
    push('attr', `属性：${f.attr}`, { attr: '', attrMin: '', attrMax: '' });
    if (f.attrMin) push('attrMin', `${f.attr} ≥ ${f.attrMin}`, { attrMin: '' });
    if (f.attrMax) push('attrMax', `${f.attr} ≤ ${f.attrMax}`, { attrMax: '' });
  }
  if (f.foot) push('foot', f.foot === '0' ? '左脚' : '右脚', { foot: '' });
  if (f.growthTier) push('growthTier', `成长档位：${f.growthTier} 档`, { growthTier: '' });
  if (f.agentTier) push('agentTier', `经纪人：${AGENT_TIER_LABEL[Number(f.agentTier)] ?? f.agentTier}`, { agentTier: '' });
  if (f.marker) push('marker', `标记：${MARKER_EMOJI[f.marker]} ${MARKER_LABEL[f.marker]}`, { marker: '' });
  if (f.futureStar) push('futureStar', '仅未来之星', { futureStar: false });
  if (f.chinaPlan) push('chinaPlan', '仅中国计划', { chinaPlan: false });
  const silverPs = f.ps.filter((n) => !isGoldPlaystyleId(n));
  const goldPs = f.ps.filter((n) => isGoldPlaystyleId(n));
  if (silverPs.length > 0) {
    push('ps:silver', `银徽章：${silverPs.map((n) => psChipName(n, false)).join('、')}`, { ps: goldPs });
  }
  if (goldPs.length > 0) {
    push('ps:gold', `金徽章：${goldPs.map((n) => psChipName(n, true)).join('、')}`, { ps: silverPs });
  }
  if (f.hasContract) push('hasContract', f.hasContract === '1' ? '仅有合同' : '仅无合同', { hasContract: '' });
  if (f.rcNone) push('rcNone', '无解约金条款', { rcNone: false });
  if (f.contractType) push('contractType', `合同类型：${CONTRACT_TYPE_LABEL[f.contractType] ?? f.contractType}`, { contractType: '' });
  if (f.source) push('source', `成约方式：${SOURCE_LABEL[f.source] ?? f.source}`, { source: '' });
  if (f.protectedSel) push('protected', f.protectedSel === 'in' ? '保护中' : '非保护', { protectedSel: '' });
  if (f.fcId) push('fcId', `FC ID：${f.fcId}`, { fcId: '' });

  return chips;
}
