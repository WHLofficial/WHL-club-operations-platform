// 流水账（附录 A〔6〕，UI_DESIGN §4.2 .ledger-book）：余额大字置顶 + 收支手账 + 类型筛选 + 翻页
import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  api,
  ledgerKindLabel,
  MANUAL_LEDGER_KINDS,
  type ClubBalance,
  type LedgerPage,
} from '../lib/api.ts';

/** 类型筛选选项：§7.1 枚举 + 奖金模板（prize_*），顺序按常见收支在前 */
const KIND_OPTIONS = [
  'opening_import',
  'manual_adjust',
  'transfer_in',
  'transfer_out',
  'transfer_tax',
  'free_agent_fee',
  'rc_change_fee',
  'rc_change_refund',
  'match_diff_burn',
  'termination_fee',
  'delist_fee',
  ...MANUAL_LEDGER_KINDS.filter((k) => k.value.startsWith('prize_')).map((k) => k.value),
];

function fmtTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

function fmtAmount(n: number): string {
  const abs = Math.abs(n);
  const s = `${abs.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} m`;
  return n >= 0 ? `+${s}` : `−${s}`;
}

export default function Ledger() {
  const [kind, setKind] = useState('');
  // 余额拉失败按「全空」展示（旧行为 .catch 落全 null）
  const balanceQuery = useQuery({
    queryKey: ['club', 'balance'],
    queryFn: () => api<ClubBalance>('/api/club/balance'),
    retry: false,
  });
  const balance = balanceQuery.data ?? { club: null, balance: null, held: null, available: null };
  const ledgerQuery = useInfiniteQuery({
    // 切类型就从头翻：kind 进 key
    queryKey: ['ledger', kind],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (kind) qs.set('kind', kind);
      if (pageParam !== null) qs.set('cursor', String(pageParam));
      return api<LedgerPage>(`/api/club/ledger${qs.size > 0 ? `?${qs}` : ''}`);
    },
    initialPageParam: null as number | null,
    // nextCursor 到底时是 null；v5 里 null 仍是合法游标，必须转 undefined 才算「没有下一页」
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = ledgerQuery.data ? ledgerQuery.data.pages.flatMap((p) => p.entries) : [];
  const lastPage = ledgerQuery.data?.pages[ledgerQuery.data.pages.length - 1] ?? null;
  const nextCursor = ledgerQuery.hasNextPage ? (lastPage?.nextCursor ?? null) : null;
  const loaded = !ledgerQuery.isPending;
  const busy = ledgerQuery.isFetching;
  const error = ledgerQuery.isError ? (ledgerQuery.error instanceof Error ? ledgerQuery.error.message : '流水读不出来，稍后再试') : null;

  const noClub = balance.club === null && !balanceQuery.isPending;

  return (
    <div className="container">
      <h1>财政账本</h1>
      {noClub ? (
        <div className="card empty-state">
          <p className="muted">你的账号还没绑定俱乐部，先到「球队登记」完成归属，这里才会有账。</p>
        </div>
      ) : (
        <div className="ledger-book">
          <div className="card ledger-balance">
            <div className="ledger-balance-main">
              <span className="ledger-balance-label">俱乐部余额</span>
              <strong className="mono ledger-balance-num">
                {balance?.balance === null || balance?.balance === undefined ? '…' : `${balance.balance.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} m`}
              </strong>
            </div>
            <div className="ledger-balance-sub muted">
              可支配 {balance?.available?.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) ?? '…'} m ·
              冻结中 {balance?.held?.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) ?? '…'} m
            </div>
          </div>

          <div className="card">
            <label className="field">
              流水类型
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">全部类型</option>
                <optgroup label="收支">
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {ledgerKindLabel(k)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {error && <p className="error-msg">{error}</p>}
            {loaded && entries.length === 0 && !error ? (
              <p className="muted">这个类型还没有流水。有收支变动之后，这里会一笔笔记下来。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>摘要</th>
                      <th className="num">金额</th>
                      <th className="num">余额</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <span className={`ledger-side ${e.amount >= 0 ? 'in' : 'out'}`}>{e.amount >= 0 ? '收' : '支'}</span>
                        </td>
                        <td>
                          <span className="badge">{ledgerKindLabel(e.kind)}</span>
                          {e.memo && <span className="ledger-memo">{e.memo}</span>}
                        </td>
                        <td className={`num mono ${e.amount >= 0 ? 'ledger-in' : 'ledger-out'}`}>{fmtAmount(e.amount)}</td>
                        <td className="num mono">{e.balanceAfter.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                        <td className="mono ledger-time">{fmtTime(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {nextCursor !== null && (
              <button className="btn" type="button" disabled={busy} onClick={() => void ledgerQuery.fetchNextPage()}>
                {busy ? '读取中…' : '再看 30 笔'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
