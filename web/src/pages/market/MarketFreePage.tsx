// 海捞 /market/free（v6.18.0 改版；v6.24.0 批次 C 拆页）：只剩海捞资格查询（信息条）。
// 激活别队球员搬到 /market/activation（激活挂牌 + 5 分钟首价窗内落首价，见 MarketActivationPage.tsx）。
// v6.17.0 的成交动态（sea-signs）与 CPU 捞人榜（cpu-board）端点已退役：成交情报迁到 /market/intel，
// 可激活名单换成 /api/market/activatable。需登录（路由守卫），查询端点是教练端点（club.squad.manage）。
import { useState } from 'react';
import { Link } from 'react-router';
import { useMyClub, useSeaLookup } from '../../lib/queries.ts';
import { playerPath } from '../../lib/player-link.ts';
import { MarketNav } from './shared.tsx';

export default function MarketFreePage() {
  const { loading, isCoach, club } = useMyClub();
  return (
    <div className="container">
      <h1>转会市场 · 海捞</h1>
      <MarketNav />
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : !isCoach ? (
        <div className="card empty-state">
          <p className="muted">海捞资格查询只对教练开放，观众视角看看就好。</p>
        </div>
      ) : club === null ? (
        <div className="card empty-state">
          <p className="muted">还没有绑定俱乐部。先到球队中心完成绑定，再来海捞。</p>
        </div>
      ) : (
        <SeaLookupSection />
      )}
    </div>
  );
}

/* ---------- 海捞资格查询（v6.18.0，GET /api/market/sea-lookup） ---------- */

function SeaLookupSection() {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, isFetching, isError, error } = useSeaLookup(submitted);

  const search = () => setSubmitted(input.trim());

  return (
    <section className="card admin-section">
      <h3>海捞资格查询</h3>
      <p className="hint">
        输入球员 ID 或名字，查他能不能被海捞。海捞签入费 = 新违约金 × 30%，签入入口在球员档案左栏（E 态）。激活别队球员在「激活」页。
      </p>
      <div className="inline-form">
        <div className="field grow">
          <label htmlFor="sea-lookup-q">球员 ID 或名字</label>
          <input
            id="sea-lookup-q"
            value={input}
            placeholder="输入球员 ID 或名字"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
        </div>
        <button className="btn" type="button" disabled={input.trim() === '' || isFetching} onClick={search}>
          {isFetching ? '查询中…' : '查询'}
        </button>
      </div>
      {isError ? (
        <div className="banner warn">{error instanceof Error ? error.message : '查询打不开了，稍后再试'}</div>
      ) : submitted === '' ? (
        <p className="muted">输入球员 ID 或名字，查他能不能被海捞。</p>
      ) : data === undefined ? (
        <p className="muted">正在查…</p>
      ) : data.length === 0 ? (
        <p className="hint">没有找到这名球员。</p>
      ) : (
        <ul className="form-list">
          {data.map((r) => (
            <li key={r.id}>
              <div className="form-row">
                <span className="form-teams">
                  <Link to={playerPath(r)}>{r.name}</Link>
                  <span className="muted">
                    {' '}
                    {r.position ?? '—'} · {r.age ?? '—'} 岁 · CA <span className="mono">{r.ca ?? '—'}</span> · PA{' '}
                    <span className="mono">{r.pa ?? '—'}</span> · {r.clubName ?? '自由身'}
                  </span>
                </span>
                <span className="form-tail">
                  <span className={`badge ${r.seaSign.eligible ? 'green' : 'gray'}`}>
                    {r.seaSign.eligible ? '可捞' : '不可捞'}
                  </span>
                </span>
              </div>
              {r.seaSign.reason && <p className="hint">{r.seaSign.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
