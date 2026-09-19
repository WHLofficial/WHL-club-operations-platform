// 管理端 · 总览（原 Admin.tsx M0 货币监控；增量 15 拆分，commit 3 数据层转 TanStack Query）
import { useQuery } from '@tanstack/react-query';
import { api, ledgerKindLabel, type M0Report } from '../../lib/api.ts';

export default function OverviewPage() {
  return (
    <div className="admin-page">
      <M0Section />
    </div>
  );
}

function M0Section() {
  const { data: report, error } = useQuery({
    queryKey: ['admin', 'm0'],
    queryFn: () => api<M0Report>('/api/admin/m0'),
  });

  if (error) {
    return (
      <section className="card admin-section">
        <h2>M0 货币监控</h2>
        <div className="banner bad">{error instanceof Error ? error.message : '加载 M0 报表失败'}</div>
      </section>
    );
  }
  if (!report) {
    return (
      <section className="card admin-section">
        <h2>M0 货币监控</h2>
        <p className="muted">正在算总账…</p>
      </section>
    );
  }
  const fmt = (v: number) =>
    `${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
  return (
    <section className="card admin-section">
      <h2>M0 货币监控</h2>
      <p className="hint">M0 = Σ俱乐部余额（含冻结）。观察通胀：总量的增长应主要来自期初导入与奖金发放，回收项（税/费）会把钱抽走。</p>
      <div className="ledger-balance">
        <span className="ledger-balance-num mono">{fmt(report.m0)}</span>
        <span className="ledger-balance-sub">
          冻结中 {fmt(report.held)} · 可流动 {fmt(report.available)}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>记账类型</th>
              <th>笔数</th>
              <th>净额（收+ / 支−）</th>
            </tr>
          </thead>
          <tbody>
            {report.byKind.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  还没有流水。
                </td>
              </tr>
            ) : (
              report.byKind.map((k) => (
                <tr key={k.kind}>
                  <td>
                    {ledgerKindLabel(k.kind)} <span className="muted mono">{k.kind}</span>
                  </td>
                  <td className="mono">{k.n}</td>
                  <td className={`num mono ${k.total >= 0 ? 'ledger-in' : 'ledger-out'}`}>{fmt(k.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <details>
        <summary>按俱乐部明细（{report.byClub.length} 家）</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>俱乐部</th>
                <th>余额</th>
              </tr>
            </thead>
            <tbody>
              {report.byClub.map((club) => (
                <tr key={club.id}>
                  <td>
                    {club.name} <span className="muted">#{club.id}</span>
                  </td>
                  <td className="num mono">{fmt(club.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
