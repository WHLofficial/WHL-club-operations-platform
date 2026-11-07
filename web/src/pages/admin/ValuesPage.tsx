// 管理端 · 身价页（v6.79.0，设计 docs/superpowers/specs/2026-11-07-market-value-admin-design.md §3.3）：
// 阶梯 ±一档 + 手输绝对值进暂存，底部批量提交走 /api/admin/players/batch（≤200/批）。
// 模型参考价与最近成交只读展示（最近成交仅 withLastDeal=1 下发，口径见 api.ts LastDealInfo 注释）。
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  type LastDealInfo,
  type PlayerLibraryRow,
  type PlayersLibraryResponse,
} from '../../lib/api.ts';
import { next, prev, snap } from '../../lib/valueLadder.ts';
import { useToast } from '../../lib/toast.tsx';
import { IdTag } from '../../components/IdTag.tsx';
import EmptyState from '../../components/EmptyState.tsx';

// 状态筛选：默认 normal（grilling 裁决：全量 18k 行不默认拉）；「全部」不带 status 参数（含挂牌/退役）
type StatusFilter = 'normal' | 'all' | 'trainee' | 'free';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'normal', label: '正常' },
  { value: 'all', label: '全部' },
  { value: 'trainee', label: '训练营' },
  { value: 'free', label: '自由身' },
];

const PAGE_SIZE = 100;
const BATCH_MAX = 200; // 与服务端 PLAYER_BATCH_MAX 一致（src/worker/routes/admin/players.ts）

interface ClubOption {
  id: number;
  name: string;
}

// 暂存：球员 id → 手输框原文。数值在提交前现解析，off-ladder 只提示不拦截；非数字/负数不提交。
type PendingEdits = Record<number, string>;

// 单行暂存的派生态：valid = 原文是非空非负有限数（负数服务端必 400，按非法输入拦在前端）；offLadder = 在档表之外
interface RowEdit {
  raw: string;
  num: number;
  offLadder: boolean;
}

function rowEditOf(pending: PendingEdits, id: number): RowEdit | null {
  const raw = pending[id];
  if (raw === undefined) return null;
  const num = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(num) || num < 0) return null;
  return { raw, num, offLadder: snap(num) !== num };
}

function fmtValue(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Number.isInteger(v) ? String(v) : v.toFixed(1)} m`;
}

function fmtLastDeal(d: LastDealInfo | null | undefined): string {
  if (!d || d.fee === null || !Number.isFinite(d.fee)) return '—';
  const season = d.season !== null ? ` · S${d.season}` : '';
  const windowSeq = d.windowSeq !== null ? ` 窗${d.windowSeq}` : '';
  return `${d.fee.toFixed(1)} m${season}${windowSeq}`;
}

export default function ValuesPage() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [clubId, setClubId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('normal');
  const [pending, setPending] = useState<PendingEdits>({});
  const [busy, setBusy] = useState(false);

  // 球队下拉（公开 /api/clubs）
  const { data: clubsData, error: clubsError } = useQuery({
    queryKey: ['admin', 'values', 'clubs'],
    queryFn: () => api<{ clubs: ClubOption[] }>('/api/clubs'),
  });
  useEffect(() => {
    if (clubsError) show(clubsError instanceof Error ? clubsError.message : '球队列表加载失败', true);
  }, [clubsError, show]);

  // 筛选全进 queryKey：改筛选 = 换 key = 自动回第一页；暂存属于当前清单，换筛选即清
  const listQuery = useInfiniteQuery({
    queryKey: ['admin', 'values', 'list', clubId || 'all', status],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ withLastDeal: '1', limit: String(PAGE_SIZE) });
      if (clubId !== '') qs.set('club_id', clubId);
      if (status !== 'all') qs.set('status', status);
      if (pageParam) qs.set('cursor', String(pageParam));
      return api<PlayersLibraryResponse>(`/api/players?${qs.toString()}`);
    },
    initialPageParam: null as string | null,
    // nextCursor 到底是 null；null 仍是合法游标口径时必须转 undefined 才算没有下一页（同 PlayersLibrary）
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  const listError = listQuery.error;
  useEffect(() => {
    if (listError) show(listError instanceof Error ? listError.message : '球员列表加载失败', true);
  }, [listError, show]);

  useEffect(() => {
    setPending({});
  }, [clubId, status]);

  const rows: PlayerLibraryRow[] = listQuery.data?.pages.flatMap((p) => p.players) ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 可提交项：暂存里有有效数值（非负有限数，与 rowEditOf 同判据）、行还在当前清单、且与现值不同（同值重报是噪音，不进 items）
  const items = Object.entries(pending)
    .map(([idStr, raw]) => {
      const id = Number(idStr);
      const row = byId.get(id);
      const num = Number(raw.trim());
      if (row === undefined || raw.trim() === '' || !Number.isFinite(num) || num < 0 || row.marketValue === num) return null;
      return { id, marketValue: num };
    })
    .filter((x): x is { id: number; marketValue: number } => x !== null);
  const offLadderCount = items.filter((it) => snap(it.marketValue) !== it.marketValue).length;
  const stagedCount = Object.keys(pending).length;

  function step(row: PlayerLibraryRow, dir: 1 | -1) {
    const edit = rowEditOf(pending, row.id);
    // 基准：暂存值优先，否则现身价，再否则模型参考价，全空从 0 起步（next(0)=1 即最低档）
    const base = edit !== null ? edit.num : (row.marketValue ?? row.modelValue ?? 0);
    const target = dir === 1 ? next(base) : prev(base);
    if (target === null) return;
    setPending((p) => ({ ...p, [row.id]: String(target) }));
  }

  function setManual(row: PlayerLibraryRow, text: string) {
    setPending((p) => {
      if (text.trim() === '') {
        const { [row.id]: _removed, ...rest } = p;
        return rest;
      }
      return { ...p, [row.id]: text };
    });
  }

  function revert(id: number) {
    setPending((p) => {
      const { [id]: _removed, ...rest } = p;
      return rest;
    });
  }

  async function submitAll() {
    if (busy || items.length === 0) return;
    setBusy(true);
    try {
      for (let i = 0; i < items.length; i += BATCH_MAX) {
        await apiPost<{ ok: boolean; updated: number }>('/api/admin/players/batch', {
          items: items.slice(i, i + BATCH_MAX),
        });
      }
      show(`身价已更新：${items.length} 条变更按 ≤${BATCH_MAX}/批提交完成（审计留痕）。`);
      // 全部成功才失效重拉 + 清暂存；await 到重拉落地再清，行内不闪旧值
      await queryClient.invalidateQueries({ queryKey: ['admin', 'values', 'list'] });
      setPending({});
    } catch (err) {
      show(err instanceof Error ? err.message : '身价批量提交失败', true);
    } finally {
      setBusy(false);
    }
  }

  const clubs = clubsData?.clubs ?? [];
  const loadError = listQuery.isError ? (listQuery.error instanceof Error ? listQuery.error.message : '加载失败') : '';

  return (
    <div className="admin-page">
      <section className="card admin-section">
        <h2>身价</h2>
        {toastNode}
        <p className="hint">
          阶梯：≤10 整数；10–30 固定档（12, 13, 15, 17, 18, 20, 22, 23, 25, 27, 28, 30）；30 以上按 5（35, 40, 45, …）。
          ±一档走严格邻档；手输绝对值不在档上只红字提示、照常提交（服务端不做阶梯校验）。模型参考与最近成交只读。
        </p>
        <div className="inline-form">
          <label className="field">
            球队
            <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
              <option value="">全部球队</option>
              {clubs.map((club) => (
                <option key={club.id} value={String(club.id)}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            状态
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <span className="hint">
            已加载 {rows.length} 名
            {listQuery.isFetching ? '（读取中…）' : ''}
            {loadError !== '' ? ` · ${loadError}` : ''}
          </span>
        </div>

        {listQuery.isLoading ? null : rows.length === 0 ? (
          <EmptyState>没有符合条件的球员。换支球队或状态再试。</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>球员</th>
                    <th>位置 · 年龄 · CA</th>
                    <th className="num">现身价</th>
                    <th className="num">模型参考</th>
                    <th>最近成交</th>
                    <th>调整</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const edit = rowEditOf(pending, row.id);
                    const manualInvalid = pending[row.id] !== undefined && edit === null;
                    const downTarget = (edit !== null ? prev(edit.num) : prev(row.marketValue ?? row.modelValue ?? 0)) ?? null;
                    const upTarget = edit !== null ? next(edit.num) : next(row.marketValue ?? row.modelValue ?? 0);
                    return (
                      <tr key={row.id}>
                        <td>
                          {row.name} <IdTag kind="球员" value={row.id} />
                        </td>
                        <td className="mono">
                          {row.position ?? '—'} · {row.age ?? '—'} · CA {row.ca}
                        </td>
                        <td className="num">
                          <input
                            className="mono"
                            inputMode="decimal"
                            style={{
                              width: '5.5rem',
                              textAlign: 'right',
                              ...(edit !== null ? { background: 'rgba(217, 119, 6, 0.14)' } : {}),
                            }}
                            aria-label={`${row.name} 身价`}
                            // 暂存原文优先（含非法输入——受控框不能回跳，否则用户正在输的内容被吞）
                            value={pending[row.id] !== undefined ? pending[row.id] : (row.marketValue != null ? String(row.marketValue) : '')}
                            placeholder={row.marketValue == null ? '—' : undefined}
                            onChange={(e) => setManual(row, e.target.value)}
                          />
                          {edit !== null && (
                            <div className="muted" style={{ fontSize: '0.78rem' }}>
                              原 {fmtValue(row.marketValue)}
                            </div>
                          )}
                          {edit !== null && edit.offLadder && (
                            <div style={{ color: 'var(--bad)', fontSize: '0.78rem' }}>不在档上（照常提交）</div>
                          )}
                          {manualInvalid && <div style={{ color: 'var(--bad)', fontSize: '0.78rem' }}>不是有效身价（须为非负数），不会提交</div>}
                        </td>
                        <td className="num mono">{fmtValue(row.modelValue)}</td>
                        <td className="mono">{fmtLastDeal(row.lastDeal)}</td>
                        <td className="num">
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={downTarget === null || busy}
                            title={downTarget === null ? '已是最低档' : `→ ${downTarget}`}
                            onClick={() => step(row, -1)}
                          >
                            −一档
                          </button>{' '}
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={busy}
                            title={`→ ${upTarget}`}
                            onClick={() => step(row, 1)}
                          >
                            +一档
                          </button>{' '}
                          <button className="btn btn-sm btn-ghost" type="button" disabled={edit === null || busy} onClick={() => revert(row.id)}>
                            还原
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row-gap" style={{ marginTop: '0.5rem' }}>
              {listQuery.hasNextPage ? (
                <button className="btn" type="button" disabled={listQuery.isFetchingNextPage} onClick={() => void listQuery.fetchNextPage()}>
                  {listQuery.isFetchingNextPage ? '加载中…' : '加载更多'}
                </button>
              ) : (
                <span className="hint">已到末页（共 {rows.length} 名）</span>
              )}
            </div>
          </>
        )}

        <div className="row-gap" style={{ marginTop: '0.5rem' }}>
          <span className="hint">
            暂存 {stagedCount} 条，可提交 {items.length} 条
            {offLadderCount > 0 ? `（其中 ${offLadderCount} 条不在档上，照常提交）` : ''}
            {stagedCount > items.length ? `；${stagedCount - items.length} 条无效或与现值相同，不计入` : ''}。
          </span>
          <button className="primary" type="button" disabled={busy || items.length === 0} onClick={() => void submitAll()}>
            {busy ? '提交中…' : `提交 ${items.length} 条变更`}
          </button>
        </div>
      </section>
    </div>
  );
}
