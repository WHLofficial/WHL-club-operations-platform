// 球员对比选人浮层（v6.37.0，入口 B 交互形态从「跳球员库勾选」改为页内浮层）：
// 桌面 = 居中弹层，≤760px = 底部抽屉，壳照 MarketListingOverlay（createPortal + 遮罩关 + 面板拦冒泡）；
// 焦点陷阱 / 锁滚 / Esc defaultPrevented 守卫照 PlayersLibrary 抽屉（仓库第三份副本，暂不抽公共件）。
// 数据不走搜索接口：与球员库搜索框共用 ['players-roster'] 缓存键，打开拉一次名册 blob 后全在本地过滤
// （打字即请求会撞公开 GET 限流并击占进程内缓存，见 PlayerSearchBox.tsx 顶部说明）。
// 槽位固定 3 格：自己恒占 A 色（slot 0），picked 按 1/2 顺延 —— 与对比页 colorFor 色随人走同一口径。
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import { colorFor } from '../../lib/compare.ts';
import { useClubsList } from '../../lib/queries.ts';
import { parseRoster, suggestPlayers, ROSTER_SUGGEST_LIMIT, type RosterBody } from '../../lib/roster.ts';
import { useMediaQuery } from '../../lib/use-media.ts';

// 与 PlayersLibrary.tsx / AdminLayout.tsx 的抽屉同款：只看浏览器默认能 Tab 到的元素
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface ComparePickerOverlayProps {
  /** 当前球员（槽 A，恒在）：fc_id 缺失时入口整块不渲染，这里不再校验 */
  own: { fcId: number; name: string };
  /** 确认回调：ids[0] 恒为 own.fcId，其余按入选顺序 */
  onConfirm: (ids: number[]) => void;
  onClose: () => void;
}

export default function ComparePickerOverlay({ own, onConfirm, onClose }: ComparePickerOverlayProps) {
  const narrow = useMediaQuery('(max-width: 760px)');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ fcId: number; name: string }[]>([]);

  const rosterQuery = useQuery({
    queryKey: ['players-roster'],
    queryFn: () => api<RosterBody>('/api/players/roster'),
    // 挂载即拉 = 打开浮层才拉；球员库搜索框拉过就是同一份缓存
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const clubsQuery = useClubsList();

  const entries = useMemo(() => (rosterQuery.data ? parseRoster(rosterQuery.data.roster) : []), [rosterQuery.data]);
  const clubName = useMemo(
    () => new Map((clubsQuery.data?.clubs ?? []).map((c) => [c.id, c.name])),
    [clubsQuery.data],
  );
  // 候选只排除自己；已选的人保留在列表里（行内 ✓，再点一次移除）——照定稿视觉稿
  const candidates = useMemo(
    () => suggestPlayers(entries, q).filter((c) => c.fcId !== own.fcId).slice(0, ROSTER_SUGGEST_LIMIT),
    [entries, q, own.fcId],
  );

  const full = picked.length >= 2;
  const toggle = (c: { fcId: number; name: string }) => {
    setPicked((prev) => {
      const at = prev.findIndex((p) => p.fcId === c.fcId);
      if (at >= 0) return prev.filter((p) => p.fcId !== c.fcId);
      if (prev.length >= 2) return prev;
      return [...prev, c];
    });
  };

  const slots: ({ fcId: number; name: string; slot: number } | null)[] = [
    { fcId: own.fcId, name: own.name, slot: 0 },
    ...picked.map((p, i) => ({ fcId: p.fcId, name: p.name, slot: i + 1 })),
  ];
  while (slots.length < 3) slots.push(null);

  // 壳的副作用只在挂载时布一次：父组件传的 onClose 是内联箭头（每次渲染新引用），
  // 收进 ref，避免锁滚 / 聚焦 / 监听器跟着重跑
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // 焦点归位：关闭（含确认导航）后交还给入口按钮
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => restoreRef.current?.focus();
  }, []);

  // 锁背景滚动 + Esc 关闭 + Tab 循环留在面板内 + 焦点移进面板（照 PlayersLibrary 抽屉）
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 内层组件已经消化过的 Esc 不再二次响应
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
        if (el.offsetParent === null) return false;
        const closed = el.closest('details:not([open])');
        return !closed || closed.querySelector(':scope > summary') === el;
      });
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = !!active && panel.contains(active);
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
  }, []);

  const confirm = () => {
    if (picked.length === 0) return;
    onConfirm([own.fcId, ...picked.map((p) => p.fcId)]);
  };

  return createPortal(
    <div
      className={narrow ? 'cmp-picker-ov cmp-picker-drawer' : 'cmp-picker-ov'}
      onClick={() => onCloseRef.current()}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="cmp-picker-panel"
        role="dialog"
        aria-modal="true"
        aria-label="加入对比"
        onClick={(e) => e.stopPropagation()}
      >
        {narrow && <div className="cmp-picker-grab" aria-hidden="true" />}
        <div className="cmp-picker-head">
          <h2 className="cmp-picker-title">加入对比</h2>
          <button
            ref={closeBtnRef}
            className="cmp-picker-x"
            type="button"
            aria-label="关闭"
            onClick={() => onCloseRef.current()}
          >
            ✕
          </button>
        </div>
        <div className="cmp-picker-slots">
          {slots.map((s, i) =>
            s === null ? (
              <div key={`empty-${i}`} className="cmp-picker-slot cmp-picker-slot-empty">
                空位
              </div>
            ) : (
              <div
                key={s.fcId}
                className="cmp-picker-slot"
                style={{ borderColor: colorFor(s.slot), backgroundColor: `${colorFor(s.slot)}14` }}
              >
                <span className="cmp-picker-dot" style={{ backgroundColor: colorFor(s.slot) }} aria-hidden="true" />
                <span className="cmp-picker-slot-name">{s.name}</span>
                {s.slot > 0 && (
                  <button
                    type="button"
                    className="cmp-picker-slot-x"
                    aria-label={`移除 ${s.name}`}
                    onClick={() => setPicked((prev) => prev.filter((p) => p.fcId !== s.fcId))}
                  >
                    ✕
                  </button>
                )}
              </div>
            ),
          )}
        </div>
        <input
          className="cmp-picker-search"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索球员姓名…"
          aria-label="搜索球员姓名"
          autoComplete="off"
        />
        <p className="cmp-picker-hint">
          {full ? '名额已满（含自己共 3 人）' : `再选 ${2 - picked.length} 人即可开始对比`}
        </p>
        <ul className="cmp-picker-list">
          {rosterQuery.isPending && <li className="cmp-picker-note">名册加载中…</li>}
          {rosterQuery.isError && <li className="cmp-picker-note">名册暂时拉不到，稍后再试</li>}
          {!rosterQuery.isPending && !rosterQuery.isError && q.trim() === '' && (
            <li className="cmp-picker-note">输入姓名搜索球员</li>
          )}
          {q.trim() !== '' && !rosterQuery.isPending && !rosterQuery.isError && candidates.length === 0 && (
            <li className="cmp-picker-note">没有匹配「{q.trim()}」的球员</li>
          )}
          {candidates.map((c) => {
            const at = picked.findIndex((p) => p.fcId === c.fcId);
            const on = at >= 0;
            const slotColor = on ? colorFor(at + 1) : null;
            return (
              <li key={c.fcId}>
                <button
                  type="button"
                  className={`cmp-picker-item${on ? ' on' : ''}`}
                  // 选中行底色 = 槽位色低透明（6 位 hex 直接追加两位 alpha）
                  style={slotColor ? { color: slotColor, backgroundColor: `${slotColor}1a` } : undefined}
                  disabled={!on && full}
                  aria-pressed={on}
                  onClick={() => toggle(c)}
                >
                  <span className="cmp-picker-item-name">{c.name}</span>
                  <span className="cmp-picker-item-club">
                    {c.clubId === null ? '自由身' : (clubName.get(c.clubId) ?? `俱乐部 ${c.clubId}`)}
                  </span>
                  <span className="cmp-picker-item-mark" aria-hidden="true">
                    {on ? '✓' : '＋'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="cmp-picker-foot">
          <span className="cmp-picker-count">已选 {1 + picked.length}/3</span>
          <button className="btn" type="button" disabled={picked.length === 0} onClick={confirm}>
            开始对比
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
