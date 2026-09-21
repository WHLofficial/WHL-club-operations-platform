// 按姓名找（球员库工具条，增量 26 步骤 7）。
//
// 需求来自用户：搜索要「更兼容」（打 sesko 能搜到 Šeško）+「打字时实时显示若干项推荐」。
// 兼容性在后端做（core/name-fold 折叠，见 /api/players?name=）；推荐这里做，且刻意**不走搜索接口**：
// 聚焦一次就把轻量名册（姓名 + 归属，约 300KB）拉下来放本地，之后每个键都在内存里过滤 ——
// 打字即请求会撞公开 GET 的 60 请求/60 秒限流（src/lib/guard.ts），还会把进程内缓存
// （MAX_CACHE_ENTRIES = 64）逐键击占满。名册无参数，服务端另有 5 分钟缓存。
//
// 本地过滤用同一个 foldName（src/core/name-fold.ts），所以：「这里能推荐出来」与「提交后能搜到」
// 是同一套规则，不会出现推荐里有、搜下去却空的错位。
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type ClubDirectoryRow } from '../lib/api.ts';
import { parseRoster, suggestPlayers, type RosterBody } from '../lib/roster.ts';

export interface PlayerSearchBoxProps {
  /** 已提交的搜索词（来自 URL），也是输入框的初始值 */
  value: string;
  onChange: (next: string) => void;
  /** 回车提交（或点「找」）：把词写进筛选条件，走服务端折叠搜索 */
  onSubmit: () => void;
  clubs: ClubDirectoryRow[];
  busy: boolean;
}

export default function PlayerSearchBox({ value, onChange, onSubmit, clubs, busy }: PlayerSearchBoxProps) {
  const navigate = useNavigate();
  // 聚焦过一次才去拉名册：从不点搜索框的人不为这 300KB 付费
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const rosterQuery = useQuery({
    queryKey: ['players-roster'],
    queryFn: () => api<RosterBody>('/api/players/roster'),
    enabled: touched,
    // 名册是慢变量（一次导入才变），本页会话内不再重取
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const entries = useMemo(() => (rosterQuery.data ? parseRoster(rosterQuery.data.roster) : []), [rosterQuery.data]);
  const suggestions = useMemo(() => (open ? suggestPlayers(entries, value) : []), [open, entries, value]);
  const clubName = useMemo(() => new Map(clubs.map((c) => [c.id, c.name])), [clubs]);
  const loading = touched && rosterQuery.isPending;
  const query = value.trim();
  // 名册没回来之前不显示「无匹配」——那会是在说「查无此人」，而其实还没数据
  const empty = open && !loading && query !== '' && entries.length > 0 && suggestions.length === 0;
  const listId = 'player-search-suggest';
  const showList = open && query !== '' && (suggestions.length > 0 || empty || loading);

  const go = (id: number) => {
    setOpen(false);
    setActive(-1);
    navigate(`/players/${id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((prev) => {
        const next = prev + dir;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter' && active >= 0 && active < suggestions.length) {
      // 高亮着某条推荐时，回车是「去这名球员」，不再当作提交搜索
      e.preventDefault();
      go(suggestions[active].id);
    }
  };

  return (
    <form
      className="library-search"
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
        onSubmit();
      }}
    >
      <div className="search-box">
        <input
          ref={inputRef}
          type="search"
          placeholder="按姓名找（支持去变音：sesko → Šeško）"
          value={value}
          role="combobox"
          aria-label="按姓名找"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            setTouched(true);
            setOpen(true);
          }}
          // 失焦即收：推荐是「顺手看一眼」，不占住页面；点条目走 onMouseDown 兜住（见下）
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {showList && (
          <ul className="search-suggest" id={listId} role="listbox" aria-label="球员推荐">
            {loading && <li className="search-suggest-hint">正在载入名册…</li>}
            {empty && <li className="search-suggest-hint">没有匹配的球员</li>}
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'search-suggest-item on' : 'search-suggest-item'}
                // 用 mousedown 而不是 click：blur 会先把列表收掉，click 永远等不到
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(s.id);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="search-suggest-name">{s.name}</span>
                <span className="search-suggest-club muted">{s.clubId === null ? '自由身' : (clubName.get(s.clubId) ?? `俱乐部 ${s.clubId}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="btn btn-sm" type="submit" disabled={busy}>
        找
      </button>
    </form>
  );
}
