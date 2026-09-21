// 球员库（增量 6.1 d8 建，增量 17 改版，增量 26 拆出 FilterPanel）：全联盟公开名册 + SoFIFA 式可变列。
// 列与筛选双向联动：筛了什么就自动加什么列（手动调过列选择器后以手动为准，取消筛选也不再自动撤）；
// 筛选条件全部进 URL query，刷新不丢、链接可分享。当前视图=现在的归属与能力；初始视图=导入时的底册。
// 筛选模型（Filters / URL 互转 / 列系统）在 ../lib/players-library.ts，筛选控件在 ../components/FilterPanel.tsx。
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type ClubDirectoryRow, type PlayerLibraryRow, type PlayersLibraryResponse } from '../lib/api.ts';
import { AGENT_TIER_LABEL, CONTRACT_TYPE_LABEL, SOURCE_LABEL, playstyleById } from '../lib/ref.ts';
import FilterPanel from '../components/FilterPanel.tsx';
import {
  COL_DEFS,
  DEFAULT_COLS,
  EMPTY_FILTERS,
  FIXED_COLUMNS,
  PAGE_SIZE,
  STATUS_BADGE,
  STATUS_LABEL,
  autoColsFor,
  filterChips,
  filtersFromUrl,
  filtersToQuery,
  firstOrderFor,
  type FilterChip,
  type Filters,
  type SortKey,
} from '../lib/players-library.ts';

// 左栏开合记在本地：桌面用户收起一次就一直收起（移动端抽屉另有开关，见步骤 8）。
// localStorage 在隐私模式/被禁用时会抛，读写成败都不影响页面。
const SIDE_STORAGE_KEY = 'players-library:side';
function readSideOpen(): boolean {
  try {
    return localStorage.getItem(SIDE_STORAGE_KEY) !== 'closed';
  } catch {
    return true;
  }
}
function writeSideOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDE_STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    /* 存不了就只是不记住，不打扰用户 */
  }
}
function money(x: number | null): string {
  return x === null ? '—' : `${x.toFixed(2)} m`;
}

// 增量 25：效力时长按窗刻度存储（赛季数），不再由日期折算

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
      return <td key={key} className="mono">{p.contractType ? (p.protected ? '保护中' : '非保护') : '—'}</td>;
    case 'years':
      return <td key={key} className="num mono">{p.serviceSeasons === null ? '—' : `${p.serviceSeasons.toFixed(1)} 赛季`}</td>;
    default:
      return <td key={key}>—</td>;
  }
}

// 表头排序（增量 26 步骤 6）：整个表头是可点按钮，点一下按该列排，再点翻向；箭头只在当前排序列点亮。
// aria-sort 给读屏（它就挂 th），箭头本身是装饰
function SortHeader({
  label,
  sortKey,
  num,
  activeKey,
  order,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  num?: boolean;
  activeKey: string;
  order: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th className={num ? 'num' : ''} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={active ? 'th-sort on' : 'th-sort'} onClick={() => onSort(sortKey)} title={`按${label}排序`}>
        {label}
        <span className="th-arrow" aria-hidden="true">
          {active ? (order === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

export default function PlayersLibrary() {
  const [filters, setFilters] = useState<Filters>(filtersFromUrl);
  // null=未手动干预（列跟随筛选联动）；一旦手动勾选，改为以手动清单为准
  const [manualCols, setManualCols] = useState<string[] | null>(() => {
    const raw = new URLSearchParams(window.location.search).get('cols');
    return raw ? raw.split(',').filter(Boolean) : null;
  });
  const [nameInput, setNameInput] = useState(filters.name);
  // 左栏开合：初值读本地记忆（默认展开），移动端另有抽屉开关
  const [sideOpen, setSideOpen] = useState(readSideOpen);

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

  // 生效条件摘要条：每个 chip 自带「只清自己」的补丁，合并回筛选即可（纯函数在 lib 里）
  const chips = useMemo(() => filterChips(filters, clubsQuery.data?.clubs ?? []), [filters, clubsQuery.data]);
  const removeChip = (chip: FilterChip) => {
    setFilters((f) => ({ ...f, ...chip.clear }));
    // 搜索框有自己的缓冲 state：撤掉「姓名」chip 时得把缓冲一起清掉，否则再点「找」条件就复活了
    if (chip.clear.name !== undefined) setNameInput(chip.clear.name);
  };

  // 表头排序：同一列再点翻向，换列用该列的自然首向（firstOrderFor）。
  // 默认态 sort='id'（URL 里没有排序参数）挂在 UID 列上显示——它是最初始的顺序，也是身份轴；
  // 但 id 分支后端固定升序（players.ts 里 sort==='id' 时 order 恒 asc），箭头与翻向基准都得按 asc 来，否则
  // 默认就显示「↓」而表格其实是升序，第一次点这一列还会因为基准取反而不动。
  const activeSortKey = filters.sort === 'id' ? 'uid' : filters.sort;
  const activeOrder: 'asc' | 'desc' = filters.sort === 'id' ? 'asc' : filters.order;
  const sortBy = (key: SortKey) => {
    setFilters((f) => {
      const current = f.sort === 'id' ? 'uid' : f.sort;
      const order = f.sort === 'id' ? 'asc' : f.order;
      // 同列翻向时顺手把 sort 落成真实键（'uid'），默认态才能离开 id 分支
      if (current === key) return { ...f, sort: key, order: order === 'asc' ? 'desc' : 'asc' };
      return { ...f, sort: key, order: firstOrderFor(key) };
    });
  };

  const toggleSide = () => {
    const next = !sideOpen;
    writeSideOpen(next);
    setSideOpen(next);
  };

  return (
    <div className="container">
      <h2>球员库</h2>
      <p className="muted">全联盟的公开名册。点姓名进球员档案；筛了哪一项，表里就自动多哪一列（列选择器里手动调过则以手动为准）。</p>

      <section className="card">
        <div className="library-controls">
          <button
            type="button"
            className="btn btn-sm lib-side-toggle"
            aria-expanded={sideOpen}
            aria-controls="library-side"
            onClick={toggleSide}
            title={sideOpen ? '收起筛选栏' : '展开筛选栏'}
          >
            筛选{chips.length > 0 ? `（${chips.length}）` : ''}
          </button>
          <div className="seg" role="radiogroup" aria-label="按视图切换">
            <button type="button" className={filters.view === 'current' ? 'on' : ''} onClick={() => set('view', 'current')}>
              当前
            </button>
            <button type="button" className={filters.view === 'initial' ? 'on' : ''} onClick={() => set('view', 'initial')}>
              初始
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
        </div>

        {/* 生效条件摘要条（增量 26 决策 18）：常驻一行，每条可单独撤掉；没有条件时留一行提示 */}
        <div className="lib-summary" role="group" aria-label="已生效的筛选条件">
          {chips.length === 0 ? (
            <span className="muted">未设筛选条件</span>
          ) : (
            <>
              <span className="lib-summary-label">已筛</span>
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className="lib-chip on"
                  aria-label={`移除筛选：${chip.label}`}
                  onClick={() => removeChip(chip)}
                >
                  {chip.label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className={sideOpen ? 'library-shell' : 'library-shell collapsed'}>
          <aside className="library-side" id="library-side" aria-label="筛选与显示列">
            <FilterPanel
              filters={filters}
              set={set}
              setFilters={setFilters}
              clubs={clubsQuery.data?.clubs ?? []}
              togglePosition={togglePosition}
              togglePs={togglePs}
              resetAll={resetAll}
              activeCount={chips.length}
              activeCols={activeCols}
              manualCols={manualCols}
              toggleCol={toggleCol}
              resetCols={() => setManualCols(null)}
            />
          </aside>

          <div className="library-main">
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
                      {FIXED_COLUMNS.map((col) => (
                        <SortHeader
                          key={col.label}
                          label={col.label}
                          sortKey={col.sort}
                          num={col.num}
                          activeKey={activeSortKey}
                          order={activeOrder}
                          onSort={sortBy}
                        />
                      ))}
                      {activeCols.map((key) => {
                        const def = COL_DEFS.find((d) => d.key === key);
                        const label = key.startsWith('attr:') ? key.slice(5) : def?.label ?? key;
                        // 认不出的列（手改 ?cols= 塞进来的）不装作能排：照常出表头，只是不可点
                        const dynSort: SortKey | null = key.startsWith('attr:') ? (key as SortKey) : def?.sort ?? null;
                        if (dynSort === null) return <th key={key}>{label}</th>;
                        return (
                          <SortHeader
                            key={key}
                            label={label}
                            sortKey={dynSort}
                            num={key.startsWith('attr:') || def?.num === true}
                            activeKey={activeSortKey}
                            order={activeOrder}
                            onSort={sortBy}
                          />
                        );
                      })}
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
          </div>
        </div>
      </section>
    </div>
  );
}
