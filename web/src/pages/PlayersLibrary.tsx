// 球员库（增量 6.1 d8）：全联盟公开名册。当前视图=现在的归属与能力；初始视图=导入时的底册
// （归属打建档俱乐部、CA 取建档值、PA 取导入上限，TECH_DESIGN §15 假设 24）。
// 筛选 + keyset 游标分页（useInfiniteQuery 双向翻页，增量 16 起）；不显示工资——那是合同卷宗里的事。
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type PlayersLibraryResponse } from '../lib/api.ts';

type View = 'current' | 'initial';
type SortKey = 'id' | 'ca' | 'pa' | 'age' | 'market_value';

const SORT_LABEL: Record<SortKey, string> = {
  id: '注册顺序',
  ca: 'CA',
  pa: 'PA',
  age: '年龄',
  market_value: '身价',
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

// 位置下拉的常用项（细位交集见球员档案页的完整矩阵）
const POSITIONS = ['GK', 'ST', 'CF', 'LW', 'RW', 'CAM', 'LM', 'RM', 'CM', 'CDM', 'CB', 'LB', 'RB'];

function money(x: number | null): string {
  return x === null ? '—' : `${x.toFixed(2)} m`;
}

export default function PlayersLibrary() {
  const [view, setView] = useState<View>('current');
  const [position, setPosition] = useState('');
  const [status, setStatus] = useState('');
  const [growable, setGrowable] = useState<'all' | '1' | '0'>('all');
  const [nameInput, setNameInput] = useState('');
  const [name, setName] = useState('');
  const [sort, setSort] = useState<SortKey>('id');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  // 筛选全部进 queryKey：改筛选 = 换 key = 自动回到第一页（旧游标栈语义）
  const libQuery = useInfiniteQuery({
    queryKey: ['players', view, position, status, growable, name, sort, order],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (view === 'initial') params.set('view', 'initial');
      if (position) params.set('position', position);
      if (status) params.set('status', status);
      if (growable !== 'all') params.set('growable', growable);
      if (name) params.set('name', name);
      if (sort !== 'id') {
        params.set('sort', sort);
        params.set('order', order);
      }
      if (pageParam) params.set('cursor', pageParam);
      return api<PlayersLibraryResponse>(`/api/players?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    // nextCursor 到底时是 null；v5 里 null 仍是合法游标，必须转 undefined 才算「没有下一页」
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // 页码语义照搬旧游标栈：显示第 pageIdx 页 = 已翻到的页，上一页回退、下一页前进（缓存命中不重拉）。
  // v5 的 fetchPreviousPage 是往前补页不是回退，不能直接用。
  const [pageIdx, setPageIdx] = useState(1);
  useEffect(() => {
    setPageIdx(1);
  }, [view, position, status, growable, name, sort, order]);
  const pageCount = libQuery.data?.pages.length ?? 0;
  const rows = libQuery.data ? libQuery.data.pages[Math.min(pageIdx, pageCount) - 1]!.players : null;
  const loadError = libQuery.isError ? (libQuery.error instanceof Error ? libQuery.error.message : '加载失败') : '';
  const busy = libQuery.isFetching;
  const canPrev = pageIdx > 1 && !busy;
  const canNext = pageIdx < pageCount || (libQuery.hasNextPage && !busy);

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

  const changeFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
  };
  return (
    <div className="container">
      <h2>球员库</h2>
      <p className="muted">全联盟的公开名册。点姓名进球员档案。工资和合同细节在各自俱乐部的卷宗里，这里不摆。</p>

      <section className="card">
        <div className="library-controls">
          <div className="seg" role="radiogroup" aria-label="按视图切换">
            <button type="button" className={view === 'current' ? 'on' : ''} onClick={() => changeFilter(setView)('current')}>
              当前
            </button>
            <button type="button" className={view === 'initial' ? 'on' : ''} onClick={() => changeFilter(setView)('initial')}>
              初始
            </button>
          </div>
          <label className="field">
            位置
            <select value={position} onChange={(e) => changeFilter(setPosition)(e.target.value)}>
              <option value="">全部</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            状态
            <select value={status} onChange={(e) => changeFilter(setStatus)(e.target.value)}>
              <option value="">全部</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="seg seg-mini" role="radiogroup" aria-label="按可成长筛选">
            {([['all', '全部'], ['1', '可成长'], ['0', '到顶']] as const).map(([v, label]) => (
              <button key={v} type="button" className={growable === v ? 'on' : ''} onClick={() => changeFilter(setGrowable)(v)}>
                {label}
              </button>
            ))}
          </div>
          <label className="field">
            排序
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey);
              }}
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="seg seg-mini" role="radiogroup" aria-label="排序方向">
            <button
              type="button"
              className={order === 'desc' ? 'on' : ''}
              disabled={sort === 'id'}
              onClick={() => changeFilter(setOrder)('desc')}
            >
              高到低
            </button>
            <button
              type="button"
              className={order === 'asc' ? 'on' : ''}
              disabled={sort === 'id'}
              onClick={() => changeFilter(setOrder)('asc')}
            >
              低到高
            </button>
          </div>
          <form
            className="library-search"
            onSubmit={(e) => {
              e.preventDefault();
              changeFilter(setName)(nameInput.trim());
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

        {view === 'initial' && (
          <p className="hint">初始视图是导入时的底册：CA 取建档值，PA 取导入的上限值。归属列给的是当前归属。</p>
        )}

        {loadError && <div className="banner warn">{loadError}</div>}

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
                  <th>归属</th>
                  <th>位置</th>
                  <th className="num">年龄</th>
                  <th className="num">CA</th>
                  <th className="num">PA</th>
                  <th>成长</th>
                  <th className="num">声望</th>
                  <th className="num">身价</th>
                  <th>状态</th>
                  <th>徽章</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.uid}</td>
                    <td>
                      <Link to={`/players/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.clubName ?? '自由身'}</td>
                    <td>{p.position ?? '—'}</td>
                    <td className="num mono">{p.age ?? '—'}</td>
                    <td className="num mono">{p.ca}</td>
                    <td className="num mono">{p.pa}</td>
                    <td>
                      {p.growable ? <span className="badge sky">可成长</span> : <span className="badge gray">到顶</span>}
                    </td>
                    <td className="num mono">{p.prestige ?? '—'}</td>
                    <td className="num mono">{money(p.marketValue)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[p.status] ?? 'gray'}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                    </td>
                    <td className="mono">
                      {p.badgesSilver === 0 && p.badgesGold === 0
                        ? '—'
                        : [
                            p.badgesGold > 0 ? `${p.badgesGold}金` : '',
                            p.badgesSilver > 0 ? `${p.badgesSilver}银` : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="library-pager">
          <button className="btn btn-sm" type="button" disabled={!canPrev} onClick={() => setPageIdx((p) => p - 1)}>
            上一页
          </button>
          <span className="muted">第 {pageIdx} 页</span>
          <button className="btn btn-sm" type="button" disabled={!canNext} onClick={goNext}>
            下一页
          </button>
        </div>
      </section>
    </div>
  );
}
