// 球员库（增量 6.1 d8 建，增量 17 改版）：全联盟公开名册 + SoFIFA 式可变列。
// 列与筛选双向联动：筛了什么就自动加什么列（手动调过列选择器后以手动为准，取消筛选也不再自动撤）；
// 筛选条件全部进 URL query，刷新不丢、链接可分享。当前视图=现在的归属与能力；初始视图=导入时的底册。
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type ClubDirectoryRow, type PlayerLibraryRow, type PlayersLibraryResponse } from '../lib/api.ts';
import { AGENT_TIER_LABEL, CONTRACT_TYPE_LABEL, SOURCE_LABEL, playstyleById } from '../lib/ref.ts';

type View = 'current' | 'initial';
type SortKey = 'id' | 'ca' | 'pa' | 'age' | 'market_value' | 'influence';

const SORT_LABEL: Record<SortKey, string> = {
  id: '注册顺序',
  ca: 'CA',
  pa: 'PA',
  age: '年龄',
  market_value: '身价',
  influence: '影响力',
};

const STATUS_LABEL: Record<string, string> = {
  normal: '在队',
  listed: '挂牌中',
  trainee: '训练营',
  free: '自由身',
  retired: '退役',
};

const STATUS_BADGE: Record<string, string> = {
  normal: 'sky',
  listed: 'gold',
  trainee: 'purple',
  free: 'gray',
  retired: 'gray',
};

// 位置全集按 PositionID 升序（同 src/core/fc26.ts POSITION_BY_ID）；组快捷只做整组选中
const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'CDM', 'RM', 'CM', 'LM', 'CAM', 'RW', 'ST', 'LW'];
const POSITION_GROUPS: [string, string[]][] = [
  ['门将', ['GK']],
  ['后卫', ['RB', 'CB', 'LB']],
  ['中场', ['CDM', 'RM', 'CM', 'LM', 'CAM']],
  ['前锋', ['RW', 'ST', 'LW']],
];

const PAGE_SIZE = 20;

interface Filters {
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

const EMPTY_FILTERS: Filters = {
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
function filtersFromUrl(): Filters {
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

function filtersToQuery(f: Filters): string {
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

const DEFAULT_COLS = ['marketValue', 'badges'];

const COL_DEFS: { key: string; label: string }[] = [
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
  { key: 'wage', label: '周薪' },
  { key: 'releaseFee', label: '解约金' },
  { key: 'contractType', label: '合同类型' },
  { key: 'source', label: '成约方式' },
  { key: 'protected', label: '保护期至' },
  { key: 'years', label: '效力年限' },
];

// 筛选 → 自动加列（双向联动的「筛了就显示」半边；取消筛选自动撤由派生实现）
function autoColsFor(f: Filters): string[] {
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

function money(x: number | null): string {
  return x === null ? '—' : `${x.toFixed(2)} m`;
}

function yearsBetween(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return `${((Date.now() - t) / 86400000 / 365.25).toFixed(1)} 年`;
}

// PlayStyle 槽位原值 → 显示名（psIds 与槽位对齐、缺槽 null；金徽=基础 ID+100，或金槽 13+）
function psNames(row: PlayerLibraryRow): string {
  if (!row.psIds || row.psIds.length === 0) return '—';
  const names = row.psIds
    .map((v, slot) => {
      if (v === null) return null;
      const gold = v >= 100 || slot >= 13;
      const base = v >= 100 ? v - 100 : v;
      const ref = playstyleById.get(base);
      const name = ref?.chs ?? ref?.en ?? String(v);
      return gold ? `金·${name}` : name;
    })
    .filter((n): n is string => n !== null);
  return names.length > 0 ? names.join('、') : '—';
}

function renderCol(key: string, p: PlayerLibraryRow) {
  if (key.startsWith('attr:')) return <td key={key} className="num mono">{p.attrValue ?? '—'}</td>;
  switch (key) {
    case 'marketValue':
      return <td key={key} className="num mono">{money(p.marketValue)}</td>;
    case 'badges':
      return (
        <td key={key} className="mono">
          {p.badgesSilver === 0 && p.badgesGold === 0
            ? '—'
            : [p.badgesGold > 0 ? `${p.badgesGold}金` : '', p.badgesSilver > 0 ? `${p.badgesSilver}银` : '']
                .filter(Boolean)
                .join(' ')}
        </td>
      );
    case 'prestige':
      return <td key={key} className="num mono">{p.prestige ?? '—'}</td>;
    case 'baseCa':
      return <td key={key} className="num mono">{p.baseCa ?? '—'}</td>;
    case 'growthGap':
      return <td key={key} className="num mono">{p.pa - p.ca}</td>;
    case 'foot':
      return <td key={key}>{p.foot === 0 ? '左脚' : '右脚'}</td>;
    case 'growthTier':
      return <td key={key} className="num mono">{p.growthTier} 档</td>;
    case 'futureStar':
      return <td key={key}>{p.isFutureStar ? '★' : '—'}</td>;
    case 'chinaPlan':
      return <td key={key}>{p.chinaPlan ? '✓' : '—'}</td>;
    case 'agentTier':
      return <td key={key}>{AGENT_TIER_LABEL[p.agentTier] ?? '—'}</td>;
    case 'ps':
      return <td key={key} className="mono ps-cell">{psNames(p)}</td>;
    case 'fcId':
      return <td key={key} className="mono">{p.fcId ?? '—'}</td>;
    case 'wage':
      return <td key={key} className="num mono">{money(p.wage)}</td>;
    case 'releaseFee':
      return <td key={key} className="num mono">{p.releaseFee === null ? '—' : money(p.releaseFee)}</td>;
    case 'contractType':
      return <td key={key}>{p.contractType ? (CONTRACT_TYPE_LABEL[p.contractType] ?? p.contractType) : '—'}</td>;
    case 'source':
      return <td key={key}>{p.source ? (SOURCE_LABEL[p.source] ?? p.source) : '—'}</td>;
    case 'protected':
      return <td key={key} className="mono">{p.protectedUntil ? p.protectedUntil.slice(0, 10) : '—'}</td>;
    case 'years':
      return <td key={key} className="num mono">{p.effectiveFrom ? yearsBetween(p.effectiveFrom) : '—'}</td>;
    default:
      return <td key={key}>—</td>;
  }
}

// PlayStyle 下拉数据：ref 表按类型分组（id 0 是占位）
const PLAYSTYLES = [...playstyleById.values()].filter((r) => r.id > 0);
const PS_TYPES = [...new Set(PLAYSTYLES.map((r) => r.type ?? '其他'))];

export default function PlayersLibrary() {
  const [filters, setFilters] = useState<Filters>(filtersFromUrl);
  // null=未手动干预（列跟随筛选联动）；一旦手动勾选，改为以手动清单为准
  const [manualCols, setManualCols] = useState<string[] | null>(() => {
    const raw = new URLSearchParams(window.location.search).get('cols');
    return raw ? raw.split(',').filter(Boolean) : null;
  });
  const [nameInput, setNameInput] = useState(filters.name);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
  };

  // 筛选进 URL（replaceState 不产生历史记录）
  const query = useMemo(() => filtersToQuery(filters), [filters]);
  useEffect(() => {
    const cols = manualCols ? `&cols=${manualCols.join(',')}` : '';
    window.history.replaceState(null, '', `${window.location.pathname}?${query}${cols}`);
  }, [query, manualCols]);

  // 俱乐部目录（公开端点）：「俱乐部」下拉
  const clubsQuery = useQuery({
    queryKey: ['clubs-directory'],
    queryFn: () => api<{ clubs: ClubDirectoryRow[] }>('/api/clubs/directory'),
  });

  // 筛选全进 queryKey：改筛选 = 换 key = 自动回第一页（旧游标栈语义）
  const libQuery = useInfiniteQuery({
    queryKey: ['players', query],
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
      return api<PlayersLibraryResponse>(`/api/players?${query}${cursor}`);
    },
    initialPageParam: null as string | null,
    // nextCursor 到底时是 null；v5 里 null 仍是合法游标，必须转 undefined 才算「没有下一页」
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const [pageIdx, setPageIdx] = useState(1);
  useEffect(() => {
    setPageIdx(1);
  }, [query]);

  const pageCount = libQuery.data?.pages.length ?? 0;
  const currentPage = libQuery.data ? libQuery.data.pages[Math.min(pageIdx, pageCount) - 1] : undefined;
  const rows = currentPage?.players ?? null;
  const total = currentPage?.total ?? null;
  const totalPages = total !== null ? Math.max(Math.ceil(total / PAGE_SIZE), 1) : null;
  const loadError = libQuery.isError ? (libQuery.error instanceof Error ? libQuery.error.message : '加载失败') : '';
  const busy = libQuery.isFetching;
  const canPrev = pageIdx > 1 && !busy;
  const canNext = (pageIdx < pageCount || (libQuery.hasNextPage && !busy)) && !busy;

  function goNext() {
    if (pageIdx < pageCount) {
      setPageIdx(pageIdx + 1);
      return;
    }
    if (libQuery.hasNextPage && !busy) {
      setPageIdx(pageIdx + 1);
      void libQuery.fetchNextPage();
    }
  }

  const togglePosition = (pos: string) => {
    setFilters((f) => ({
      ...f,
      positions: f.positions.includes(pos) ? f.positions.filter((p) => p !== pos) : [...f.positions, pos],
    }));
  };

  const togglePs = (id: number) => {
    setFilters((f) => ({ ...f, ps: f.ps.includes(id) ? f.ps.filter((n) => n !== id) : [...f.ps, id] }));
  };

  const autoCols = useMemo(() => autoColsFor(filters), [filters]);
  const activeCols: string[] = useMemo(() => {
    const cols = manualCols ?? [...DEFAULT_COLS, ...autoCols];
    // 按 COL_DEFS 顺序展示，attr 列缀尾
    const rank = new Map(COL_DEFS.map((d, i) => [d.key, i]));
    return [...new Set(cols)].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
  }, [manualCols, autoCols]);

  const toggleCol = (key: string) => {
    setManualCols((prev) => {
      const base = prev ?? [...DEFAULT_COLS, ...autoCols];
      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    });
  };

  const resetAll = () => {
    setFilters(EMPTY_FILTERS);
    setManualCols(null);
    setNameInput('');
  };

  // 「更多筛选」启用计数：autoCols 与高级面板参数一一对应（含 fcId、rcNone 等无列项经由列映射）
  const activeAdvCount = autoCols.length;

  const num = (key: keyof Filters, label: string, placeholder?: string) => (
    <label className="field">
      {label}
      <input
        type="number"
        value={filters[key] as string}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as Filters[typeof key])}
      />
    </label>
  );

  return (
    <div className="container">
      <h2>球员库</h2>
      <p className="muted">全联盟的公开名册。点姓名进球员档案；筛了哪一项，表里就自动多哪一列（列选择器里手动调过则以手动为准）。</p>

      <section className="card">
        <div className="library-controls">
          <div className="seg" role="radiogroup" aria-label="按视图切换">
            <button type="button" className={filters.view === 'current' ? 'on' : ''} onClick={() => set('view', 'current')}>
              当前
            </button>
            <button type="button" className={filters.view === 'initial' ? 'on' : ''} onClick={() => set('view', 'initial')}>
              初始
            </button>
          </div>
          <label className="field">
            俱乐部
            <select value={filters.club} onChange={(e) => set('club', e.target.value)}>
              <option value="">全部</option>
              <option value="free">自由身</option>
              {(clubsQuery.data?.clubs ?? []).map((club) => (
                <option key={club.id} value={String(club.id)}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            状态
            <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">全部</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="seg seg-mini" role="radiogroup" aria-label="按可成长筛选">
            {([['all', '全部'], ['1', '可成长'], ['0', '非成长']] as const).map(([v, label]) => (
              <button key={v} type="button" className={filters.growable === v ? 'on' : ''} onClick={() => set('growable', v)}>
                {label}
              </button>
            ))}
          </div>
          <label className="field">
            排序
            <select value={filters.sort} onChange={(e) => set('sort', e.target.value as SortKey)}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="seg seg-mini" role="radiogroup" aria-label="排序方向">
            <button type="button" className={filters.order === 'desc' ? 'on' : ''} disabled={filters.sort === 'id'} onClick={() => set('order', 'desc')}>
              高到低
            </button>
            <button type="button" className={filters.order === 'asc' ? 'on' : ''} disabled={filters.sort === 'id'} onClick={() => set('order', 'asc')}>
              低到高
            </button>
          </div>
          <form
            className="library-search"
            onSubmit={(e) => {
              e.preventDefault();
              set('name', nameInput.trim());
            }}
          >
            <input
              type="search"
              placeholder="按姓名找"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              aria-label="按姓名找"
            />
            <button className="btn btn-sm" type="submit" disabled={busy}>
              找
            </button>
          </form>
          <button className="btn btn-sm btn-ghost" type="button" onClick={resetAll}>
            清空筛选
          </button>
        </div>

        <div className="lib-chip-row" aria-label="位置多选">
          <span className="muted lib-chip-label">位置</span>
          {POSITION_GROUPS.map(([label, group]) => (
            <button
              key={label}
              type="button"
              className={`lib-chip${group.every((p) => filters.positions.includes(p)) ? ' on' : ''}`}
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  positions: group.every((p) => f.positions.includes(p))
                    ? f.positions.filter((p) => !group.includes(p))
                    : [...new Set([...f.positions, ...group])],
                }))
              }
            >
              {label}
            </button>
          ))}
          {POSITIONS.map((p) => (
            <button key={p} type="button" className={`lib-chip${filters.positions.includes(p) ? ' on' : ''}`} onClick={() => togglePosition(p)}>
              {p}
            </button>
          ))}
        </div>

        <details className="lib-adv" open={false}>
          <summary>更多筛选{activeAdvCount > 0 ? `（已启用 ${activeAdvCount} 项）` : ''}</summary>
          <div className="lib-adv-body">
            <div className="lib-adv-group">
              <h4>区间</h4>
              <div className="lib-adv-grid">
                {num('caMin', 'CA ≥')}
                {num('caMax', 'CA ≤')}
                {num('paMin', 'PA ≥')}
                {num('paMax', 'PA ≤')}
                {num('gapMin', '成长空间 ≥', 'PA−CA')}
                {num('gapMax', '成长空间 ≤')}
                {num('baseCaMin', '初始 CA ≥')}
                {num('baseCaMax', '初始 CA ≤')}
                {num('ageMin', '年龄 ≥')}
                {num('ageMax', '年龄 ≤')}
                {num('mvMin', '身价 ≥', 'm')}
                {num('mvMax', '身价 ≤', 'm')}
                {num('inflMin', '影响力 ≥')}
                {num('inflMax', '影响力 ≤')}
              </div>
            </div>
            <div className="lib-adv-group">
              <h4>细分属性</h4>
              <div className="lib-adv-grid">
                <label className="field">
                  属性键
                  <select value={filters.attr} onChange={(e) => set('attr', e.target.value)}>
                    <option value="">不筛</option>
                    {ATTR_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                {filters.attr && num('attrMin', '≥')}
                {filters.attr && num('attrMax', '≤')}
              </div>
            </div>
            <div className="lib-adv-group">
              <h4>条件</h4>
              <div className="lib-adv-grid">
                <label className="field">
                  惯用脚
                  <select value={filters.foot} onChange={(e) => set('foot', e.target.value as Filters['foot'])}>
                    <option value="">全部</option>
                    <option value="1">右脚</option>
                    <option value="0">左脚</option>
                  </select>
                </label>
                <label className="field">
                  成长档位
                  <select value={filters.growthTier} onChange={(e) => set('growthTier', e.target.value)}>
                    <option value="">全部</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        {n} 档
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  经纪人
                  <select value={filters.agentTier} onChange={(e) => set('agentTier', e.target.value)}>
                    <option value="">全部</option>
                    <option value="1">温和</option>
                    <option value="2">普通</option>
                    <option value="3">苛刻</option>
                  </select>
                </label>
                <label className="field check">
                  <input type="checkbox" checked={filters.futureStar} onChange={(e) => set('futureStar', e.target.checked)} />
                  仅未来之星
                </label>
                <label className="field check">
                  <input type="checkbox" checked={filters.chinaPlan} onChange={(e) => set('chinaPlan', e.target.checked)} />
                  仅中国计划
                </label>
                <label className="field">
                  FC ID
                  <input type="number" value={filters.fcId} onChange={(e) => set('fcId', e.target.value)} placeholder="精确查号" />
                </label>
              </div>
              <div className="lib-adv-ps">
                <span className="muted">PlayStyle（多选，金徽也算）</span>
                {PS_TYPES.map((type) => (
                  <div key={type} className="lib-chip-row">
                    <span className="muted lib-chip-label">{type}</span>
                    {PLAYSTYLES.filter((r) => (r.type ?? '其他') === type).map((r) => (
                      <button key={r.id} type="button" className={`lib-chip${filters.ps.includes(r.id) ? ' on' : ''}`} onClick={() => togglePs(r.id)}>
                        {r.chs ?? r.en ?? r.id}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="lib-adv-group">
              <h4>合同</h4>
              <div className="lib-adv-grid">
                <label className="field">
                  现行合同
                  <select value={filters.hasContract} onChange={(e) => set('hasContract', e.target.value as Filters['hasContract'])}>
                    <option value="">不限</option>
                    <option value="1">有</option>
                    <option value="0">无</option>
                  </select>
                </label>
                {num('wageMin', '周薪 ≥', 'm')}
                {num('wageMax', '周薪 ≤', 'm')}
                {num('rcMin', '解约金 ≥', 'm')}
                {num('rcMax', '解约金 ≤', 'm')}
                <label className="field check">
                  <input type="checkbox" checked={filters.rcNone} onChange={(e) => set('rcNone', e.target.checked)} />
                  无解约金条款
                </label>
                <label className="field">
                  合同类型
                  <select value={filters.contractType} onChange={(e) => set('contractType', e.target.value)}>
                    <option value="">全部</option>
                    <option value="formal">正式合同</option>
                    <option value="trainee">训练营合同</option>
                  </select>
                </label>
                <label className="field">
                  成约方式
                  <select value={filters.source} onChange={(e) => set('source', e.target.value)}>
                    <option value="">全部</option>
                    {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  保护期
                  <select value={filters.protectedSel} onChange={(e) => set('protectedSel', e.target.value as Filters['protectedSel'])}>
                    <option value="">不限</option>
                    <option value="in">保护期内</option>
                    <option value="out">保护期外</option>
                  </select>
                </label>
                {num('yearsMin', '效力年限 ≥', '年')}
                {num('yearsMax', '效力年限 ≤', '年')}
              </div>
            </div>
          </div>
        </details>

        {filters.view === 'initial' && (
          <p className="hint">初始视图是导入时的底册：CA 取建档值，PA 取导入的上限值。所属球队列给的是当前归属。</p>
        )}

        {loadError && <div className="banner warn">{loadError}</div>}

        {/* 翻页信息与翻页条在表格上方：不用再沉底找 */}
        <div className="library-pager">
          <button className="btn btn-sm" type="button" disabled={!canPrev} onClick={() => setPageIdx((p) => p - 1)}>
            上一页
          </button>
          <span className="muted">
            {total !== null ? `共 ${total} 名球员 · 共 ${totalPages} 页 · 第 ${pageIdx} 页` : `第 ${pageIdx} 页`}
          </span>
          <button className="btn btn-sm" type="button" disabled={!canNext} onClick={goNext}>
            下一页
          </button>
        </div>

        <details className="lib-cols">
          <summary>显示列（{activeCols.length} 列可变）</summary>
          <div className="lib-chip-row">
            {COL_DEFS.map((d) => (
              <button key={d.key} type="button" className={`lib-chip${activeCols.includes(d.key) ? ' on' : ''}`} onClick={() => toggleCol(d.key)}>
                {d.label}
              </button>
            ))}
            {manualCols !== null && (
              <button type="button" className="lib-chip" onClick={() => setManualCols(null)}>
                恢复自动
              </button>
            )}
          </div>
        </details>

        {rows === null ? (
          <p className="muted">{busy ? '正在翻名册…' : ''}</p>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <p className="muted">这个筛法下没有球员。放宽条件，或者换个词再找。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>姓名</th>
                  <th>所属球队</th>
                  <th>位置</th>
                  <th className="num">年龄</th>
                  <th className="num">CA</th>
                  <th className="num">PA</th>
                  <th>成长</th>
                  <th className="num">影响力</th>
                  <th>状态</th>
                  {activeCols.map((key) => (
                    <th key={key} className={key.startsWith('attr:') || ['marketValue', 'baseCa', 'growthGap', 'wage', 'releaseFee', 'years', 'prestige', 'fcId'].includes(key) ? 'num' : ''}>
                      {key.startsWith('attr:') ? key.slice(5) : COL_DEFS.find((d) => d.key === key)?.label ?? key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.uid.replace(/^fc/, '')}</td>
                    <td>
                      <Link to={`/players/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.clubName ?? '自由身'}</td>
                    <td className="mono">{p.positions.length > 0 ? p.positions.join(' ') : '—'}</td>
                    <td className="num mono">{p.age ?? '—'}</td>
                    <td className="num mono">{p.ca}</td>
                    <td className="num mono">{p.pa}</td>
                    <td>{p.growable ? <span className="badge sky">可成长</span> : <span className="badge gray">非成长</span>}</td>
                    <td className="num mono">{p.influence.toFixed(2)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[p.status] ?? 'gray'}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                    </td>
                    {activeCols.map((key) => renderCol(key, p))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// 细分属性键与后端白名单同源（FC26_GAME_ATTR_COLUMNS 尾段 34 项，照搬 src/core/fc26.ts）；
// 前端只做展示，硬校验在后端
const ATTR_KEYS = [
  'sprintspeed', 'acceleration', 'finishing', 'positioning', 'shotpower', 'longshots', 'penalties', 'volleys',
  'vision', 'crossing', 'freekickaccuracy', 'longpassing', 'shortpassing', 'curve', 'agility', 'balance',
  'reactions', 'composure', 'ballcontrol', 'dribbling', 'interceptions', 'headingaccuracy', 'defensiveawareness',
  'standingtackle', 'slidingtackle', 'jumping', 'stamina', 'strength', 'aggression',
  'gkdiving', 'gkhandling', 'gkkicking', 'gkpositioning', 'gkreflexes',
] as const;
