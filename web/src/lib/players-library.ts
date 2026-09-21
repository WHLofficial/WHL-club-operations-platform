// 球员库的筛选模型与列模型（增量 26 从 pages/PlayersLibrary.tsx 拆出，供页面与 FilterPanel 共用）。
// 三件事都在这里：Filters 类型与默认值、URL query ↔ 筛选状态的互转、筛选 → 自动列的联动规则。
// 拆出来的原因：控件搬进左栏后页面与面板都要用这套模型，留在页面里会形成页面 ↔ 组件的循环导入。

export type View = 'current' | 'initial';

// 排序键与中文名。值必须与 src/worker/routes/players.ts 的 SORT_KEY_NAMES 逐字一致，对不上后端直接 400。
// 后端在增量 26 已把可排序列扩到表头每一列（29 个键），这张表按步骤补齐。
export const SORT_LABEL: Record<string, string> = {
  id: '注册顺序',
  ca: 'CA',
  pa: 'PA',
  age: '年龄',
  market_value: '身价',
  influence: '影响力',
};

export type SortKey = keyof typeof SORT_LABEL;

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

// 位置全集按 PositionID 升序（同 src/core/fc26.ts POSITION_BY_ID）；组快捷只做整组选中
export const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'CDM', 'RM', 'CM', 'LM', 'CAM', 'RW', 'ST', 'LW'];
export const POSITION_GROUPS: [string, string[]][] = [
  ['门将', ['GK']],
  ['后卫', ['RB', 'CB', 'LB']],
  ['中场', ['CDM', 'RM', 'CM', 'LM', 'CAM']],
  ['前锋', ['RW', 'ST', 'LW']],
];

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
  f.positions = str('position') ? str('position').split(',').filter((p) => POSITIONS.includes(p)) : [];
  f.status = str('status');
  if (str('growable') === '1' || str('growable') === '0') f.growable = str('growable') as '1' | '0';
  if (str('sort') in SORT_LABEL) f.sort = str('sort') as SortKey;
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
  f.ps = str('ps') ? str('ps').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 99) : [];
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
  put('ps', f.ps.join(','));
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

export const COL_DEFS: { key: string; label: string }[] = [
  { key: 'marketValue', label: '身价' },
  { key: 'badges', label: '徽章' },
  { key: 'prestige', label: '声望' },
  { key: 'baseCa', label: '初始 CA' },
  { key: 'growthGap', label: '成长空间' },
  { key: 'foot', label: '惯用脚' },
  { key: 'growthTier', label: '成长档位' },
  { key: 'futureStar', label: '未来之星' },
  { key: 'chinaPlan', label: '中国计划' },
  { key: 'agentTier', label: '经纪人' },
  { key: 'ps', label: 'PlayStyle' },
  { key: 'fcId', label: 'FC ID' },
  { key: 'wage', label: '工资（半赛季）' },
  { key: 'releaseFee', label: '解约金' },
  { key: 'contractType', label: '合同类型' },
  { key: 'source', label: '成约方式' },
  { key: 'protected', label: '保护期' },
  { key: 'years', label: '效力时长' },
];

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
  if (f.ps.length > 0) cols.push('ps');
  if (f.fcId) cols.push('fcId');
  if (f.hasContract || f.wageMin || f.wageMax || f.contractType) cols.push('wage', 'contractType');
  if (f.rcMin || f.rcMax || f.rcNone) cols.push('releaseFee');
  if (f.source) cols.push('source');
  if (f.protectedSel) cols.push('protected');
  if (f.yearsMin || f.yearsMax) cols.push('years');
  return cols;
}
