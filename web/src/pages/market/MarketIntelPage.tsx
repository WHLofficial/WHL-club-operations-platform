// 市场情报 /market/intel（v6.18.0 新增）：传闻卡 + 已达成交易卡。
// 两个端点都公开（匿名可读），不走 RequireUser；数据层 hooks 在 lib/queries.ts。
import { Link } from 'react-router';
import type { MarketDealsRow, RumorItem } from '../../lib/api.ts';
import { useMarketDeals, useRumors } from '../../lib/queries.ts';
import { TRANSFER_TYPE_LABEL } from '../../lib/ref.ts';
import { playerPath } from '../../lib/player-link.ts';
import { MarketNav, money } from './shared.tsx';

// 交易类型徽标配色（复用全局 .badge 色板；未知类型走灰）
const DEAL_TYPE_BADGE: Record<string, string> = {
  transfer: 'sky',
  activation: 'purple',
  forced_auction: 'orange',
  free_agent: 'green',
  rc_change: 'blue',
  termination: 'red',
  match: 'gold',
};

export default function MarketIntelPage() {
  return (
    <div className="container">
      <h1>转会市场 · 市场情报</h1>
      <MarketNav />
      <RumorsSection />
      <DealsSection />
    </div>
  );
}

/* ---------- 传闻（v6.18.0，GET /api/market/rumors） ---------- */

function RumorsSection() {
  const { data, isError, error } = useRumors();
  return (
    <section className="card">
      <h3>传闻</h3>
      <p className="hint">传闻由系统按窗口自动生成，真真假假，请自行查证 · 下窗换血。</p>
      {isError ? (
        <div className="banner warn">{error instanceof Error ? error.message : '传闻打不开了，稍后再试'}</div>
      ) : data === undefined ? (
        <p className="muted">正在打听消息…</p>
      ) : data.length === 0 ? (
        <p className="hint">这个窗口暂时没有传闻。</p>
      ) : (
        <ul className="form-list">
          {data.map((r) => (
            <li key={r.id} className="form-row">
              <span className="form-teams">
                <RumorText rumor={r} />
              </span>
              <span className="form-tail muted">{r.clubName}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// 传闻正文里的球员名渲染成档案链接：只替换第一处，没命中就原文照出
function RumorText({ rumor }: { rumor: RumorItem }) {
  const idx = rumor.playerName === '' ? -1 : rumor.text.indexOf(rumor.playerName);
  if (idx < 0) return <>{rumor.text}</>;
  return (
    <>
      {rumor.text.slice(0, idx)}
      <Link to={playerPath({ id: rumor.playerId })}>{rumor.playerName}</Link>
      {rumor.text.slice(idx + rumor.playerName.length)}
    </>
  );
}

/* ---------- 已达成交易（v6.18.0，GET /api/market/deals） ---------- */

function DealsSection() {
  const { data, isError, error } = useMarketDeals();
  return (
    <section className="card">
      <h3>已达成交易</h3>
      {isError ? (
        <div className="banner warn">{error instanceof Error ? error.message : '成交记录打不开了，稍后再试'}</div>
      ) : data === undefined ? (
        <p className="muted">成交记录还没加载出来…</p>
      ) : data.length === 0 ? (
        <p className="hint">还没有已达成交易。成交、续约、解约、海捞签入都会记在这里。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>完成时间</th>
                <th>类型</th>
                <th>球员</th>
                <th>从 → 到</th>
                <th className="num">金额（m）</th>
                <th className="num">附加费（m）</th>
                <th>赛季 · 窗</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.completedAt ? d.completedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td>
                    <span className={`badge ${DEAL_TYPE_BADGE[d.type] ?? 'gray'}`}>{TRANSFER_TYPE_LABEL[d.type] ?? d.type}</span>
                  </td>
                  <td>
                    <Link to={playerPath({ id: d.playerId })}>{d.playerName}</Link>
                  </td>
                  <td>
                    <span className="muted">{d.fromClubName ?? '—'}</span> → {d.toClubName ?? '自由身'}
                  </td>
                  <td className="num mono">{money(feeOf(d))}</td>
                  <td className="num mono">{money(d.extraFee)}</td>
                  <td className="mono">{d.season == null || d.windowSeq == null ? '—' : `S${d.season} 第 ${d.windowSeq} 窗`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// 解约没有成交金额（fee=0）→ 显示 —；其余 null 由 money() 兜底
function feeOf(d: MarketDealsRow): number | null {
  return d.type === 'termination' ? null : d.fee;
}
