// 一线队号码分配浮层（v6.76.0）：
// 左栏未分配名单，右栏 1–99 十列号码格。点击号码即在草稿内落位；
// 点到已占用号码时，与持有者直接对调（原号为空的持有者落回未分配）。
// 保存才提交最终态 assignments；409 冲突保留草稿并标红冲突格，关窗/脏改动关闭都有确认。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  apiPut,
  type NumberConflict,
  type SquadNumbersResponse,
  type SquadOverview,
  type SquadPlayerRow,
} from '../../lib/api.ts';
import { positionGroupKeyOf } from '../../lib/club-cards.ts';
import { qk, useSquadQuery } from '../../lib/queries.ts';
import { useOverlayShell } from '../../lib/use-overlay-shell.ts';

const GROUP_LABEL: Record<string, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋', unknown: '其他' };
const GROUP_ORDER: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3, unknown: 4 };

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? '?' : trimmed[0]!.toUpperCase();
}

/** 号码格只放姓：西文取最后一个词，中文/单段名原样显示（格子单行省略） */
function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : name.trim();
}

function groupOf(player: SquadPlayerRow): string {
  return positionGroupKeyOf(player.position);
}

export function SquadNumbersDialog({
  preselectPlayerId,
  onClose,
}: {
  /** 从球员页进入时预选该球员，并滚到他的号码 */
  preselectPlayerId?: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const squadQuery = useSquadQuery(true);
  const squad = squadQuery.data ?? null;
  const players = useMemo(() => squad?.players ?? [], [squad]);
  const base = useMemo(() => new Map(players.map((p) => [p.id, p.number] as const)), [players]);

  const [draft, setDraft] = useState<Map<number, string | null>>(() => new Map());
  const [history, setHistory] = useState<Map<number, string | null>[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<NumberConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const didInitialSelect = useRef(false);

  // 草稿覆盖在服务端快照上；渲染与保存都以 finalMap 为唯一口径
  const finalMap = useMemo(() => {
    const map = new Map(base);
    for (const [id, number] of draft) map.set(id, number);
    return map;
  }, [base, draft]);
  const holders = useMemo(() => {
    const map = new Map<string, SquadPlayerRow>();
    for (const player of players) {
      const number = finalMap.get(player.id) ?? null;
      if (number !== null) map.set(number, player);
    }
    return map;
  }, [players, finalMap]);
  const draftNumbers = useMemo(
    () => new Set([...draft.values()].filter((n): n is string => n !== null)),
    [draft],
  );
  const unassigned = useMemo(
    () =>
      players
        .filter((p) => (finalMap.get(p.id) ?? null) === null)
        .sort(
          (a, b) =>
            GROUP_ORDER[groupOf(a)]! - GROUP_ORDER[groupOf(b)]! ||
            (b.ca ?? 0) - (a.ca ?? 0) ||
            a.name.localeCompare(b.name, 'zh'),
        ),
    [players, finalMap],
  );
  const selected = selectedId === null ? null : (players.find((p) => p.id === selectedId) ?? null);
  const selectedNumber = selected === null ? null : (finalMap.get(selected.id) ?? null);
  const changed = [...draft.entries()].filter(([id, number]) => (base.get(id) ?? null) !== number);
  const assignedCount = [...finalMap.values()].filter((n) => n !== null).length;

  // 首轮选中：球员页入口预选当前球员并滚到他的号码；阵容页入口选第一名未分配球员。
  useEffect(() => {
    if (squad === null || selectedId !== null || didInitialSelect.current) return;
    didInitialSelect.current = true;
    const preferred =
      preselectPlayerId !== undefined && squad.players.some((p) => p.id === preselectPlayerId)
        ? preselectPlayerId
        : null;
    const firstUnassigned = [...squad.players]
      .filter((p) => (p.number ?? null) === null)
      .sort((a, b) => GROUP_ORDER[positionGroupKeyOf(a.position)]! - GROUP_ORDER[positionGroupKeyOf(b.position)]!)[0];
    setSelectedId(preferred ?? firstUnassigned?.id ?? squad.players[0]?.id ?? null);
    if (preferred !== null) {
      const number = squad.players.find((p) => p.id === preferred)?.number ?? null;
      if (number !== null) {
        requestAnimationFrame(() => {
          gridRef.current?.querySelector<HTMLElement>(`[data-num="${number}"]`)?.scrollIntoView?.({ block: 'center' });
        });
      }
    }
  }, [squad, selectedId, preselectPlayerId]);

  function commit(next: Map<number, string | null>) {
    setHistory((prev) => [...prev, new Map(draft)]);
    setDraft(next);
    setSavedCount(null);
    setConflicts([]);
    setError(null);
  }

  function pickCell(number: string) {
    if (saving) return;
    if (selectedId === null) {
      const holder = holders.get(number);
      if (holder) {
        setSelectedId(holder.id);
        setConflicts([]);
      }
      return;
    }
    const holder = holders.get(number);
    if (holder?.id === selectedId) return;
    const next = new Map(draft);
    const current = finalMap.get(selectedId) ?? null;
    next.set(selectedId, number);
    // 点占用号位 = 草稿内直接对调：持有者拿原号；原号为空则落回未分配
    if (holder) next.set(holder.id, current);
    commit(next);
  }

  function clearSelected() {
    if (saving || selectedId === null) return;
    if ((finalMap.get(selectedId) ?? null) === null) return;
    const next = new Map(draft);
    next.set(selectedId, null);
    commit(next);
  }

  function undo() {
    if (saving || history.length === 0) return;
    const previous = history[history.length - 1]!;
    setDraft(previous);
    setHistory((prev) => prev.slice(0, -1));
    setSavedCount(null);
    setConflicts([]);
    setError(null);
  }

  function requestClose() {
    if (saving) return;
    if (discardOpen) {
      setDiscardOpen(false);
      return;
    }
    if (changed.length > 0) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }

  const { narrow, panelRef, onCloseRef } = useOverlayShell(requestClose);

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (discardOpen || saving) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId === null) return;
      e.preventDefault();
      clearSelected();
    }
  }

  async function save() {
    if (saving || conflicts.length > 0 || changed.length === 0) return;
    setSaving(true);
    setError(null);
    setSavedCount(null);
    try {
      const res = await apiPut<SquadNumbersResponse>('/api/club/squad/numbers', {
        assignments: changed.map(([playerId, number]) => ({ playerId, number })),
      });
      // 乐观回写本队名单，避免保存后草稿清空时旧号码闪一下
      const applied = new Map(res.applied.map((row) => [row.playerId, row.after] as const));
      qc.setQueryData<SquadOverview>(qk.squad, (old) =>
        old === undefined
          ? old
          : { ...old, players: old.players.map((p) => (applied.has(p.id) ? { ...p, number: applied.get(p.id)! } : p)) },
      );
      setDraft(new Map());
      setHistory([]);
      setConflicts([]);
      setSavedCount(res.applied.length);
      const clubId = squad?.club?.id;
      if (clubId !== undefined) void qc.invalidateQueries({ queryKey: qk.clubRoster(clubId) });
      for (const row of res.applied) void qc.invalidateQueries({ queryKey: qk.player(String(row.playerId)) });
      void qc.invalidateQueries({ queryKey: qk.squad });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.conflicts?.length ?? 0) > 0) {
        // 全有或全无：保留草稿，只把服务端指出的冲突号标红；背景数据刷新后再让用户改
        setConflicts(err.conflicts ?? []);
        void qc.invalidateQueries({ queryKey: qk.squad });
      } else if (err instanceof ApiError && err.status === 404) {
        // 浮层打开期间球员被转出/解约：名单刷新后把已不在队里的草稿项摘掉，避免每次保存都整单 404
        setError(err.message);
        await qc.invalidateQueries({ queryKey: qk.squad });
        const fresh = qc.getQueryData<SquadOverview>(qk.squad);
        if (fresh) {
          const ids = new Set(fresh.players.map((p) => p.id));
          const prune = (map: Map<number, string | null>) => new Map([...map].filter(([id]) => ids.has(id)));
          setDraft((prev) => prune(prev));
          setHistory((prev) => prev.map(prune));
          setConflicts([]);
          setSavedCount(null);
          setError('名单已变化，已同步；请确认后重试');
        }
      } else {
        setError(err instanceof Error ? err.message : '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  const draftLabel =
    conflicts.length > 0
      ? `${conflicts.length} 处冲突 · 保存不可用`
      : changed.length > 0
        ? `草稿 ${changed.length} 项`
        : savedCount !== null
          ? `已保存 ${savedCount} 项`
          : '没有改动';

  return createPortal(
    <div className="modal-mask" onClick={() => onCloseRef.current()}>
      <div
        className={`modal-card card sqn-dialog${narrow ? ' is-narrow' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="一线队号码分配"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        <header className="sqn-head">
          <div className="sqn-head-main">
            <div className="sqn-eyebrow">SQUAD NUMBERS</div>
            <h2>号码分配</h2>
            <div className="sqn-sub">
              {squad?.club?.name ?? '本队'} · {players.length} 人在册
            </div>
          </div>
          <div className="sqn-head-right">
            <span className="sqn-count">
              {assignedCount} / {players.length} 已分配
            </span>
            <button type="button" className="sqn-close" aria-label="关闭号码分配" onClick={() => onCloseRef.current()}>
              ×
            </button>
          </div>
        </header>

        {squadQuery.isError ? (
          <div className="sqn-loading">
            <p>名单没取到：{squadQuery.error instanceof Error ? squadQuery.error.message : '请重试'}</p>
            <button type="button" className="btn btn-sm" onClick={() => void squadQuery.refetch()}>
              重试
            </button>
          </div>
        ) : squad === null ? (
          <div className="sqn-loading">正在调阅一线队名单…</div>
        ) : (
          <div className="sqn-body">
            <aside className="sqn-aside">
              <div className="sqn-aside-head">
                <span>未分配</span>
                <span className="sqn-pill">{unassigned.length}</span>
              </div>
              <p className="sqn-hint">点球员，再点右侧号码</p>
              <div className="sqn-list">
                {unassigned.length === 0 ? (
                  <p className="sqn-empty">全员已分配号码。</p>
                ) : (
                  unassigned.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      className={`sqn-row${selectedId === player.id ? ' is-selected' : ''}`}
                      title={player.name}
                      onClick={() => {
                        setSelectedId(player.id);
                        setDiscardOpen(false);
                      }}
                    >
                      <span className="sqn-avatar">{initialOf(player.name)}</span>
                      <span className="sqn-row-main">
                        <span className="sqn-row-name">
                          <span className="sqn-name-full">{player.name}</span>
                          <span className="sqn-name-surname">{surnameOf(player.name)}</span>
                        </span>
                        <span className="sqn-row-meta">
                          {GROUP_LABEL[groupOf(player)] ?? '其他'} · CA {player.ca ?? '—'}
                        </span>
                      </span>
                      <span className="sqn-tag">{groupOf(player) === 'unknown' ? '—' : groupOf(player)}</span>
                    </button>
                  ))
                )}
              </div>
              <p className="sqn-aside-foot">已分配球员可直接点右侧号码选中；点到已占用的号码会与持有者对调。</p>
            </aside>

            <section className="sqn-main">
              <div className={`sqn-selection${selected === null ? ' is-empty' : ''}`}>
                {selected === null ? (
                  <span className="sqn-selected-hint">从左侧选一名未分配球员，或点号码选中持有者</span>
                ) : (
                  <>
                    <span className="sqn-avatar">{initialOf(selected.name)}</span>
                    <span className="sqn-selected-main">
                      <span className="sqn-selected-name">{selected.name}</span>
                      <span className="sqn-selected-meta">
                        {GROUP_LABEL[groupOf(selected)] ?? '其他'} · CA {selected.ca ?? '—'}
                      </span>
                    </span>
                    <span className={`sqn-number-chip${selectedNumber === null ? ' is-empty' : ''}`}>
                      {selectedNumber ?? '未分配'}
                    </span>
                    <span className="sqn-selected-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={saving || selectedNumber === null}
                        onClick={clearSelected}
                      >
                        清除号码
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={saving} onClick={() => setSelectedId(null)}>
                        取消选择
                      </button>
                    </span>
                  </>
                )}
              </div>

              {conflicts.length > 0 && (
                <div className="sqn-banner is-bad" role="alert">
                  <strong>
                    {conflicts[0]!.number} 号已被 {conflicts[0]!.playerName} 占用
                  </strong>
                  <span>
                    {conflicts.length > 1 ? `另有 ${conflicts.length - 1} 个号码冲突。` : ''}
                    他在本次提交之外。先把冲突号让出来，或给 {selected?.name ?? '球员'} 换一个号。
                  </span>
                </div>
              )}
              {error !== null && (
                <div className="sqn-banner is-bad" role="alert">
                  {error}
                </div>
              )}
              {savedCount !== null && (
                <div className="sqn-banner is-ok" role="status">
                  已保存 {savedCount} 项。
                </div>
              )}

              <div className="sqn-grid-head">
                <h3>号码格</h3>
                <span>1–99 · 按十位排列</span>
              </div>
              <div className="sqn-grid" ref={gridRef}>
                {Array.from({ length: 99 }, (_, i) => String(i + 1)).map((number) => {
                  const holder = holders.get(number) ?? null;
                  const isConflict = conflicts.some((c) => c.number === number);
                  const isDraft = draftNumbers.has(number) || (holder !== null && draft.has(holder.id));
                  const isSelected = holder !== null && holder.id === selectedId;
                  return (
                    <button
                      key={number}
                      type="button"
                      data-num={number}
                      className={`sqn-cell${holder === null ? ' is-empty' : ''}${isSelected ? ' is-selected' : ''}${isConflict ? ' is-conflict' : ''}${isDraft ? ' is-draft' : ''}`}
                      title={holder === null ? `${number} 号 · 空` : `${number} 号 · ${holder.name}`}
                      aria-label={holder === null ? `${number} 号，空` : `${number} 号，${holder.name}`}
                      onClick={() => pickCell(number)}
                    >
                      <span className="sqn-cell-num">{number}</span>
                      <span className="sqn-cell-name">{holder === null ? '空' : surnameOf(holder.name)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {discardOpen && (
          <div className="sqn-confirm" role="alertdialog" aria-label="放弃未保存的号码改动">
            <span>有 {changed.length} 项改动还没保存，关闭会丢弃。</span>
            <div className="sqn-confirm-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDiscardOpen(false)}>
                继续编辑
              </button>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                放弃并关闭
              </button>
            </div>
          </div>
        )}

        <footer className="sqn-foot">
          <span className={`sqn-draft${conflicts.length > 0 ? ' is-bad' : ''}`}>{draftLabel}</span>
          <div className="sqn-actions">
            <button type="button" className="btn btn-sm btn-ghost" disabled={saving || history.length === 0} onClick={undo}>
              撤销
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={saving} onClick={requestClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving || changed.length === 0 || conflicts.length > 0}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存号码'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
