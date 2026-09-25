// 管理端 · 总览（v2.1.0）：轻计数卡（待审/赛果队列/活跃挂牌/俱乐部/球员，commit 6 新增）
// + M0 货币监控（原 Admin.tsx M0Section）；数据层 TanStack Query（commit 3）
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, ledgerKindLabel, type AdminOverview, type M0Report } from '../../lib/api.ts';

export default function OverviewPage() {
  return (
    <div className="admin-page">
      <OverviewCountsSection />
      <M0Section />
    </div>
  );
}

const COUNT_CARDS: { key: keyof Omit<AdminOverview, 'at'>; label: string; hint: string; to?: string }[] = [
  { key: 'openReviews', label: '待审核成交', hint: '等管理组盖章的成交单', to: '/admin/market' },
  { key: 'resultQueue', label: '赛果队列', hint: '已结束未确认给 XP 的比赛', to: '/admin/seasons' },
  { key: 'activeListings', label: '活跃挂牌', hint: '在架 / 竞价 / 匹配中的挂牌', to: '/market' },
  { key: 'clubs', label: '俱乐部', hint: '注册俱乐部总数', to: '/admin/clubs' },
  { key: 'players', label: '球员', hint: '球员库总人数', to: '/players' },
];

function OverviewCountsSection() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: overview, error } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api<AdminOverview>('/api/admin/overview'),
  });

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // fetchQuery 用 ?fresh=1 绕过服务端 60s isolate 缓存强拉一次，结果回填缓存
      await queryClient.fetchQuery({
        queryKey: ['admin', 'overview'],
        queryFn: () => api<AdminOverview>('/api/admin/overview?fresh=1'),
      });
    } catch {
      // 强拉失败保留旧缓存；错误展示走 useQuery 的 error 分支
    } finally {
      setRefreshing(false);
    }
  }

  if (error) {
    return (
      <section className="card admin-section">
        <h2>今日概览</h2>
        <div className="banner bad">{error instanceof Error ? error.message : '加载总览失败'}</div>
      </section>
    );
  }

  return (
    <section className="card admin-section">
      <h2>今日概览</h2>
      <p className="hint">
        一眼扫积压：先看待审与赛果队列有没有涨，再决定去哪个子页。数据 {overview ? `截至 ${overview.at.slice(11, 19)}` : '加载中…'}
        （服务端缓存 60 秒）。
      </p>
      {overview === undefined ? (
        <p className="muted">正在点数…</p>
      ) : (
        <div className="inline-form" style={{ alignItems: 'stretch' }}>
          {COUNT_CARDS.map((c) => (
            <div key={c.key} className="field" style={{ minWidth: '9rem' }}>
              <span>{c.label}</span>
              {c.to ? (
                <Link to={c.to} className="ledger-balance-num mono" style={{ fontSize: '1.5rem' }}>
                  {overview[c.key]}
                </Link>
              ) : (
                <span className="ledger-balance-num mono" style={{ fontSize: '1.5rem' }}>
                  {overview[c.key]}
                </span>
              )}
              <span className="muted">{c.hint}</span>
            </div>
          ))}
          <button className="btn btn-sm" type="button" disabled={refreshing} onClick={refresh}>
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      )}
    </section>
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
