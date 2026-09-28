// 流水账（附录 A〔6〕，UI_DESIGN §4.2 .ledger-book）：余额大字置顶 + 窗口财务汇总 + 收支手账 + 类型筛选 + 翻页
import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  api,
  ledgerKindLabel,
  MANUAL_LEDGER_KINDS,
  type ClubBalance,
  type LedgerPage,
} from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useFinanceSummary } from '../lib/queries.ts';
import type { FinanceWindow } from '../lib/api.ts';

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

function money2(n: number): string {
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} m`;
}

// 窗口财务汇总（v6.7.0，B2）：比赛日收入按上座记录精确归窗，其余流水按时间落进各窗。
// 固定列只放结算大头（工资/维护/冠名/活动/富人税），其余 kind 并进「其他」；季前与窗外流水不进表。
// v6.9.0 加「活动」列：球场档期活动的收入（草皮损坏仍归维护费列，kind 同为 maintenance）。
const FINANCE_NAMED_KINDS = ['wage', 'maintenance', 'naming_fee', 'naming_bonus', 'naming_penalty', 'activity', 'luxury_tax'] as const;

function otherKindsSum(byKind: Record<string, number>): number {
  return Object.entries(byKind).reduce((s, [k, v]) => (FINANCE_NAMED_KINDS.includes(k as never) ? s : s + v), 0);
}

/** 冠名列净额 = 租金 + 对赌奖金 − 违约罚金 */
function namingNet(byKind: Record<string, number>): number {
  return (byKind['naming_fee'] ?? 0) + (byKind['naming_bonus'] ?? 0) + (byKind['naming_penalty'] ?? 0);
}

function FinanceSummaryCard() {
  const { data, isPending, isError } = useFinanceSummary(true);
  if (isPending) {
    return (
      <div className="card">
        <h3>窗口财务汇总</h3>
        <p className="muted">正在算账…</p>
      </div>
    );
  }
  if (isError || !data || data.season === null) {
    return (
      <div className="card">
        <h3>窗口财务汇总</h3>
        <p className="muted">{isError ? '汇总读不出来，稍后再试。' : '还没有可展示的赛季。'}</p>
      </div>
    );
  }
  const windows = data.windows;
  const totals = data.totals;
  return (
    <div className="card">
      <h3>窗口财务汇总</h3>
      <p className="hint">
        第 {data.season} 赛季各窗口的收支一览：比赛日 = 上座记录的票务 + 商业 + 转播；其余流水按发生时间归窗。净额 = 收入 − 支出。
      </p>
      {windows.length === 0 ? (
        <p className="muted">这个赛季还没开过窗口。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>窗口</th>
                <th className="num">比赛日</th>
                <th className="num">工资</th>
                <th className="num">维护费</th>
                <th className="num">冠名</th>
                <th className="num">活动</th>
                <th className="num">富人税</th>
                <th className="num">其他</th>
                <th className="num">净额</th>
                <th className="num">期末余额</th>
              </tr>
            </thead>
            <tbody>
              {windows.map((w: FinanceWindow) => (
                <tr key={w.windowSeq}>
                  <td>
                    窗口 {w.windowSeq} {w.isTemporary && <span className="badge sky">临时</span>}
                    {w.status === 'open' && <span className="badge green">进行中</span>}
                  </td>
                  <td className="num mono">{money2(w.matchday.total)}</td>
                  <td className="num mono">{money2(-(w.byKind['wage'] ?? 0))}</td>
                  <td className="num mono">{money2(-(w.byKind['maintenance'] ?? 0))}</td>
                  <td className="num mono">{money2(namingNet(w.byKind))}</td>
                  <td className="num mono">{money2(w.byKind['activity'] ?? 0)}</td>
                  <td className="num mono">{money2(-(w.byKind['luxury_tax'] ?? 0))}</td>
                  <td className="num mono">{money2(otherKindsSum(w.byKind))}</td>
                  <td className={`num mono ${w.net >= 0 ? 'ledger-in' : 'ledger-out'}`}>{fmtAmount(w.net)}</td>
                  <td className="num mono">{w.closingBalance === null ? '—' : w.closingBalance.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {totals && (
                <tr>
                  <td>
                    <b>赛季合计</b>
                  </td>
                  <td className="num mono">{money2(totals.matchday.total)}</td>
                  <td className="num mono">{money2(-windows.reduce((s, w) => s + (w.byKind['wage'] ?? 0), 0))}</td>
                  <td className="num mono">{money2(-windows.reduce((s, w) => s + (w.byKind['maintenance'] ?? 0), 0))}</td>
                  <td className="num mono">{money2(windows.reduce((s, w) => s + namingNet(w.byKind), 0))}</td>
                  <td className="num mono">{money2(windows.reduce((s, w) => s + (w.byKind['activity'] ?? 0), 0))}</td>
                  <td className="num mono">{money2(-windows.reduce((s, w) => s + (w.byKind['luxury_tax'] ?? 0), 0))}</td>
                  <td className="num mono">{money2(windows.reduce((s, w) => s + otherKindsSum(w.byKind), 0))}</td>
                  <td className={`num mono ${totals.net >= 0 ? 'ledger-in' : 'ledger-out'}`}>{fmtAmount(totals.net)}</td>
                  <td className="num mono">{totals.closingBalance === null ? '—' : totals.closingBalance.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data.outside && (
        <p className="hint">窗口外流水（季前开档等）共 {money2(data.outside.total)}，不计入上面的合计。</p>
      )}
    </div>
  );
}

export default function Ledger() {
  const [kind, setKind] = useState('');
  const { user } = useAuth();
  const isCoach = user?.role === 'coach' || user?.role === 'admin';
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

          {isCoach && <FinanceSummaryCard />}

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
