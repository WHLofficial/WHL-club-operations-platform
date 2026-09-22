// 球员库（增量 6.1 d8 建，增量 17 改版，增量 26 拆出 FilterPanel）：全联盟公开名册 + SoFIFA 式可变列。
// 列与筛选双向联动：筛了什么就自动加什么列（手动调过列选择器后以手动为准，取消筛选也不再自动撤）；
// 筛选条件全部进 URL query，刷新不丢、链接可分享。当前视图=现在的归属与能力；初始视图=导入时的底册。
// 筛选模型（Filters / URL 互转 / 列系统）在 ../lib/players-library.ts，筛选控件在 ../components/FilterPanel.tsx。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type ClubDirectoryRow, type PlayerLibraryRow, type PlayersLibraryResponse } from '../lib/api.ts';
import { AGENT_TIER_LABEL, CONTRACT_TYPE_LABEL, SOURCE_LABEL, playstyleById, playstyleIsGold } from '../lib/ref.ts';
import { PS_GOLD_BASE, isGoldPlaystyleId } from '../../../src/core/fc26.ts';
import { useMediaQuery } from '../lib/use-media.ts';
import FilterPanel from '../components/FilterPanel.tsx';
import PlayerSearchBox from '../components/PlayerSearchBox.tsx';
import {
  COL_DEFS,
  DEFAULT_COLS,
  EMPTY_FILTERS,
  FIXED_COLUMNS,
  STATUS_BADGE,
  STATUS_LABEL,
  autoColsFor,
  filterChips,
  filtersFromUrl,
  filtersToQuery,
  firstOrderFor,
  parseColsParam,
  sortColumnVisible,
  type FilterChip,
  type Filters,
  type SortKey,
} from '../lib/players-library.ts';

// 左栏开合记在本地：桌面用户收起一次就一直收起（移动端抽屉不记 —— 每次进来默认关，
// 与 .admin-shell 的窄屏行为一致）。
// localStorage 在隐私模式/被禁用时会抛，读写成败都不影响页面。
const SIDE_STORAGE_KEY = 'players-library:side';
const DRAWER_QUERY = '(max-width: 900px)';
// 抽屉的焦点循环用：只看浏览器默认能 Tab 到的那些（不含 tabindex="-1"）。
// summary 必须算进来 —— <summary> 是可聚焦的（「显示列」那个 <details> 的开关就是它），
// 而它不匹配任何常规选择器；漏掉它时抽屉里真正的最后一个可聚焦元素不在 items 里，
// 从它往后 Tab 就没被拦住，焦点落到 body（实测 375 下第 25 次 Tab 逃出）
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
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
// 金徽判定与基础 ID 剥离都走 core/ref 的口径，别在这里再写一遍 >=100 / -100
// slot 是数组下标（0 起），playstyleIsGold 收的是槽号（1 起）⇒ 这里 +1，否则下标 12 的 PSID13
// 走不到「金槽」分支（增量 29：银段 ID 落在金槽时会显示成银，与档案页的 🥇 不一致）
export function psNames(row: PlayerLibraryRow): string {
  if (!row.psIds || row.psIds.length === 0) return '—';
  const names = row.psIds
    .map((v, slot) => {
      if (v === null) return null;
      const gold = playstyleIsGold(v, slot + 1);
      const base = isGoldPlaystyleId(v) ? v - PS_GOLD_BASE : v;
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
  activeKey: string | null;
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
  const [manualCols, setManualCols] = useState<string[] | null>(() =>
    parseColsParam(new URLSearchParams(window.location.search).get('cols')),
  );
  const [nameInput, setNameInput] = useState(filters.name);
  // 左栏开合：初值读本地记忆（默认展开）；窄屏下同一份 DOM 变成滑出抽屉，另有 drawerOpen
  const [sideOpen, setSideOpen] = useState(readSideOpen);
  const narrow = useMediaQuery(DRAWER_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  // 关抽屉时是否要把焦点交还入口按钮（见下面 closeDrawer 的注释）
  const restoreFocus = useRef(false);
  // 上一次焦点是否落在左栏/抽屉里。宽度变化时用它决定要不要把焦点接回来——
  // 不能在 effect 里嗅探 activeElement：那时 display:none / inert 已生效、焦点已被踢走
  const focusInSide = useRef(false);

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
    // 增量 28：列表每页都是 D1 实读（默认浏览 56 行/页，贵形状数千行），60s 内复用已加载的页；
    // 写路径由服务端代际键 purge，前端改数据的地方仍用 invalidateQueries 强制重取
    staleTime: 60_000,
  });

  const [pageIdx, setPageIdx] = useState(1);
  useEffect(() => {
    setPageIdx(1);
  }, [query]);

  const pageCount = libQuery.data?.pages.length ?? 0;
  const currentPage = libQuery.data ? libQuery.data.pages[Math.min(pageIdx, pageCount) - 1] : undefined;
  const rows = currentPage?.players ?? null;
  // 增量 28：服务端不再回 total（那条整表 COUNT 占单页读量的 99.7%），分页条改游标式：
  // 「已加载 N 名」= 本地已取回的所有页之和，「还有更多 / 已到末页」看 nextCursor 是否还有。
  const loadedCount = libQuery.data?.pages.reduce((n, p) => n + p.players.length, 0) ?? 0;
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
  // 默认态（URL 里没有排序参数、sort='id'）不给任何列打 active：那走的是 players.id，即源表的注册顺序，
  // 与 uid（fc_id）无关（生产实测各分片首行 fc_id 并非递增），标成「UID ↑」是在说假话。
  // 默认态全列显示 ↕，点哪列就从那列的自然首向开始——顺带避掉「第一次点 UID 其实是换键」的错位。
  const activeSortKey: SortKey | null = filters.sort === 'id' ? null : filters.sort;
  const activeOrder: 'asc' | 'desc' = filters.sort === 'id' ? 'asc' : filters.order;
  const sortBy = (key: SortKey) => {
    setFilters((f) => {
      // 默认态视作「还没有当前键」：f.sort='id' 时若拿 'uid' 当基准，第一次点 UID 会被当成同列翻向
      const current = f.sort === 'id' ? null : f.sort;
      const order = f.sort === 'id' ? 'asc' : f.order;
      if (current === key) return { ...f, sort: key, order: order === 'asc' ? 'desc' : 'asc' };
      return { ...f, sort: key, order: firstOrderFor(key) };
    });
  };

  // 排序列随筛选消失时把排序撤回默认（例如按「身价」排完再删掉身价 chip：列没了、指示也没了，
  // 否则表格按一个看不见也取消不掉的键排）。固定列永远在，不受影响。
  useEffect(() => {
    const key = filters.sort;
    if (key === 'id') return;
    if (sortColumnVisible(key, activeCols)) return;
    setFilters((f) => (f.sort === key ? { ...f, sort: EMPTY_FILTERS.sort, order: EMPTY_FILTERS.order } : f));
  }, [filters.sort, activeCols, setFilters]);

  const toggleSide = () => {
    const next = !sideOpen;
    writeSideOpen(next);
    setSideOpen(next);
  };

  // 记录焦点是否在左栏里（一个委托监听，别在每个控件上挂 onFocus）
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      focusInSide.current = !!asideRef.current?.contains(e.target as Node);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // 抽屉关闭：× / 遮罩 / Esc 三条路都走这里，焦点交还给入口按钮（键盘用户不至于掉到文档开头）
  const closeDrawer = () => {
    restoreFocus.current = true;
    setDrawerOpen(false);
  };

  // 焦点归位必须等这次提交落地再 focus：入口按钮在工具条里，而工具条开着时是 inert 的，
  // 关闭当帧 focus() 会被浏览器静默忽略（实测 activeElement 掉到 body）。jsdom 不实现 inert
  // 的焦点拦截，所以这条只有真浏览器能抓到。
  useEffect(() => {
    if (drawerOpen) return;
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    toggleRef.current?.focus();
  }, [drawerOpen]);

  // 抽屉开着时：锁背景滚动（不然滑抽屉会带着表格一起滚）、Esc 关闭、Tab 循环留在抽屉内、焦点移进抽屉
  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 内层组件已经消化过的 Esc 不再二次响应（PlayerSearchBox 收下拉时会 preventDefault）
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        closeDrawer();
        return;
      }
      if (e.key !== 'Tab') return;
      // 顶栏在 <Routes> 之外，不属于任何一个 inert 区，所以光靠 inert 挡不住 Tab 走到抽屉外。
      // 这里补最小焦点循环，让 role=dialog + aria-modal 名副其实。
      const side = asideRef.current;
      if (!side) return;
      // 只看真正能 Tab 到的：offsetParent 为 null（display:none 之类）的不算，
      // 收起的 <details> 里的控件也不算 —— 注意 Chrome 对收起 details 的内容**不返回 null**
      // （实测「更多筛选」收起时里面的输入框仍有 offsetParent），所以必须显式排除。
      // 但 details 自己的 <summary> 要留下：收起时它照样能 Tab 到，正是它决定了「最后一个」。
      // 漏掉这一步时清单里「最后一个」是收起面板里的 chip，从真正的最后一个往后 Tab 没人拦，
      // 焦点落到 body（375 实测第 25 次 Tab 逃出）
      const items = [...side.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
        if (el.offsetParent === null) return false;
        const closed = el.closest('details:not([open])');
        return !closed || closed.querySelector(':scope > summary') === el;
      });
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = !!active && side.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  // 回到宽屏就把抽屉状态放掉：抽屉是窄屏专属形态，留着会让宽屏下一开窗就带遮罩。
  // 焦点归位不靠「此刻 activeElement 是否在 aside 里」嗅探：这个 effect 在 paint 之后才跑，
  // 那时 display:none / inert 已经生效、焦点元素已被浏览器踢出，嗅探必然判否（收起过左栏的用户
  // 每次都踩）。改成记录「上一次焦点落在哪里」，两个方向共用一个判据。
  useEffect(() => {
    if (narrow) {
      // 变窄：左栏从常驻变成 inert 子树，浏览器会把焦点踢到 body；抽屉没开时交给入口按钮
      if (!drawerOpen && focusInSide.current) toggleRef.current?.focus();
      return;
    }
    setDrawerOpen(false);
    if (focusInSide.current) toggleRef.current?.focus();
  }, [narrow]);

  return (
    <div className="container">
      <h2>球员库</h2>
      <p className="muted">全联盟的公开名册。点姓名进球员档案；筛了哪一项，表里就自动多哪一列（列选择器里手动调过则以手动为准）。</p>

      <section className="card">
        <div className="library-controls lib-toolbar control-row" inert={narrow && drawerOpen}>
          {/* 宽屏开合左栏、窄屏开抽屉：同一个按钮、两种语义，计数徽标两边共用 */}
          <button
            ref={toggleRef}
            type="button"
            className="btn btn-sm lib-side-toggle"
            aria-expanded={narrow ? drawerOpen : sideOpen}
            aria-controls="library-side"
            onClick={() => (narrow ? setDrawerOpen(true) : toggleSide())}
            title={
              narrow
                ? '打开筛选抽屉'
                : sideOpen
                  ? '收起筛选栏'
                  : '展开筛选栏'
            }
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
          <PlayerSearchBox
            value={nameInput}
            onChange={setNameInput}
            onSubmit={() => set('name', nameInput.trim())}
            clubs={clubsQuery.data?.clubs ?? []}
            busy={busy}
          />
        </div>

        {drawerOpen && narrow ? <div className="lib-drawer-mask" aria-hidden="true" onClick={closeDrawer} /> : null}

        <div className={`${sideOpen ? 'library-shell' : 'library-shell collapsed'}${drawerOpen ? ' drawer-open' : ''}`}>
          {/* 窄屏关着时 inert：抽屉虽在屏幕外仍占 DOM，不加这个 Tab 能一路走进那几十个输入框。
              宽屏不用（左栏是常驻的，inert 会把正常使用的侧栏一起锁掉）。
              开着时反过来：抽屉是模态形态（遮罩 + 锁滚），背景也要 inert，否则 Shift+Tab 能逃到遮罩后面 */}
          <aside
            ref={asideRef}
            className="library-side"
            id="library-side"
            aria-label="筛选与显示列"
            role={narrow && drawerOpen ? 'dialog' : undefined}
            aria-modal={narrow && drawerOpen ? true : undefined}
            inert={narrow && !drawerOpen}
          >
            {/* 抽屉抬头只在窄屏出现（宽屏 display:none）：标题 + 关闭按钮，与遮罩、Esc 同一出口 */}
            <div className="lib-drawer-head">
              <span>筛选与显示列</span>
              <button
                ref={closeRef}
                type="button"
                className="lib-drawer-close"
                aria-label="关闭筛选抽屉"
                onClick={closeDrawer}
              >
                ×
              </button>
            </div>
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

          <div className="library-main" inert={narrow && drawerOpen}>
            {filters.view === 'initial' && (
              <p className="hint">初始视图是导入时的底册：CA 取建档值，PA 取导入的上限值。所属球队列给的是当前归属。</p>
            )}

            {loadError && <div className="banner warn">{loadError}</div>}

            {/* 摘要条与翻页条合成一行（增量 27 步骤 5）：摘要在左、翻页贴右，表格上方不再
                多占两行。摘要条在搬进这里的同时去掉了自己的 inert —— 整块 .library-main
                在抽屉开着时已经 inert，夹在工具条与表格之间的那块背景区不再单独存在。
                没有筛选条件时摘要整块不渲染：原先那句「未设筛选条件」占位只是把空白写得更显眼 */}
            <div className="lib-bar">
              {chips.length > 0 && (
                <div className="lib-summary" role="group" aria-label="已生效的筛选条件">
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
                </div>
              )}
              <div className="library-pager">
                <button className="btn btn-sm" type="button" disabled={!canPrev} onClick={() => setPageIdx((p) => p - 1)}>
                  上一页
                </button>
                <span className="muted">
                  {`第 ${pageIdx} 页 · 已加载 ${loadedCount} 名 · ${libQuery.hasNextPage ? '还有更多' : '已到末页'}`}
                </span>
                <button className="btn btn-sm" type="button" disabled={!canNext} onClick={goNext}>
                  下一页
                </button>
              </div>
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
