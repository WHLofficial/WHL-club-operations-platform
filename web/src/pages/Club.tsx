// 球队中心雏形（增量 1）：球队头 + 余额大字 + 阵容名单；注册合规随增量 2 进场
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type MyClubOverview, type PlayerListItem } from '../lib/api.ts';
import { AGENT_TIER_LABEL, LEAGUE_TIER_LABEL, STATUS_LABEL } from '../lib/ref.ts';

export default function Club() {
  const [overview, setOverview] = useState<MyClubOverview | null>(null);
  const [roster, setRoster] = useState<PlayerListItem[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<MyClubOverview>('/api/me/club')
      .then(async (data) => {
        setOverview(data);
        if (data.club) {
          const list = await api<{ players: PlayerListItem[] }>(`/api/players?club_id=${data.club.id}&limit=100`);
          setRoster(list.players);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载球队信息失败');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container">
        <h1>球队中心</h1>
        <div className="card empty-state">
          <p className="muted">正在翻档案…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <h1>球队中心</h1>
        <div className="banner warn">{error}</div>
        <div className="card empty-state">
          <p className="muted">观众视角看不到球队内部。转会操作需要教练账号。</p>
        </div>
      </div>
    );
  }

  if (!overview?.club) {
    return (
      <div className="container">
        <h1>球队中心</h1>
        <div className="card empty-state">
          <p className="muted">你的账号还没有绑定俱乐部。拿到管理组发的 8 位认证码，一表定归属。</p>
          <Link className="btn" to="/bind">
            去球队登记
          </Link>
        </div>
      </div>
    );
  }

  const { club, balance, squadCount, window: win } = overview;

  return (
    <div className="container">
      <h1>球队中心</h1>
      <section className="card club-head">
        <div className="club-head-main">
          <h2>{club.name}</h2>
          <div className="club-head-badges">
            <span className={`badge ${club.leagueTier === 'premier' ? 'gold' : 'gray'}`}>
              {LEAGUE_TIER_LABEL[club.leagueTier] ?? club.leagueTier}
            </span>
            {win && (
              <span className="badge sky">
                第 {win.season} 赛季 · 窗口 {win.windowSeq}
              </span>
            )}
          </div>
        </div>
        <div className="club-head-numbers">
          <div className="club-stat">
            <span className="stat-label">资金余额</span>
            <span className="stat-value mono gold-text">{balance === null ? '—' : `${balance.toFixed(2)} m`}</span>
          </div>
          <div className="club-stat">
            <span className="stat-label">一线队名单</span>
            <span className="stat-value mono">{squadCount ?? '—'} 人</span>
          </div>
          <div className="club-stat">
            <span className="stat-label">当前窗口</span>
            <span className="stat-value stat-value-small">{win ? '进行中' : '还没开'}</span>
          </div>
        </div>
        {!win && <p className="hint">转会窗口还没开。窗口开了之后，这里会挂出市场与注册入口。</p>}
      </section>

      <section className="card">
        <h3>阵容名单</h3>
        {roster === null ? null : roster.length === 0 ? (
          <div className="empty-state">
            <p className="muted">名单还是空的。等管理组导入球员、签下合同之后，这里就是你的更衣室。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>位置</th>
                  <th className="num">年龄</th>
                  <th className="num">CA</th>
                  <th className="num">PA</th>
                  <th className="num">身价</th>
                  <th>状态</th>
                  <th className="num">徽章</th>
                  <th>经纪人</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/players/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.position ?? '—'}</td>
                    <td className="num">{p.age ?? '—'}</td>
                    <td className="num mono">{p.ca}</td>
                    <td className="num mono">{p.pa}</td>
                    <td className="num mono">{p.marketValue === null ? '—' : p.marketValue.toFixed(2)}</td>
                    <td>
                      <span className={`badge ${p.status === 'listed' ? 'sky' : p.status === 'trainee' ? 'purple' : 'gray'}`}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="num">
                      {p.badgesGold > 0 && <span title="金徽章">🥇×{p.badgesGold} </span>}
                      {p.badgesSilver > 0 && <span title="银徽章">🥈×{p.badgesSilver}</span>}
                      {p.badgesGold === 0 && p.badgesSilver === 0 && '—'}
                    </td>
                    <td>🕴 {AGENT_TIER_LABEL[p.agentTier] ?? p.agentTier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
