// 主场页签（v6.30.0 A 段：自 pages/club/CoachPanel.tsx 拆入，自家专属）。
// 只读档案 + 近期主场战报（天气/上座/票务/商业/转播），设施经营/冠名市场/球场档期三卡已在
// v6.26.0 整体迁入消费中心，这里只留一行入口（取代原「消费中心」大卡）。
// 战报查询（useHomeMatches）住在本组件里：只有激活「主场」页签才挂载、才发请求。
import { Link } from 'react-router';
import { useHomeMatches } from '../../lib/queries.ts';
import { influenceCoefText } from '../../lib/influence.ts';
import type { StadiumInfo } from '../../lib/api.ts';

const FACILITY_LABEL: Record<string, string> = {
  commercial: '商业区',
  broadcast: '灯光转播',
  pitch: '草皮',
  youth: '青训中心',
  medical: '医疗中心',
};

function StadiumCard({ home }: { home: StadiumInfo }) {
  return (
    <section className="card">
      <h3>主场档案</h3>
      <p>
        <b>{home.namingBrand ? `${home.namingBrand}·${home.name || '未冠名'}` : home.name || '未冠名'}</b> · {home.tierName ?? `档位 ${home.tier}`}（{home.tier} 级） · 容量{' '}
        <span className="mono">{home.capacity.toLocaleString()}</span> 座 · 死忠球迷{' '}
        <span className="mono">{Math.round(home.fans).toLocaleString()}</span>
      </p>
      <p className="hint">
        球队影响力 <span className="mono">{home.influence.total.toFixed(1)}</span>（（球员{' '}
        <span className="mono">{home.influence.players.toFixed(1)}</span> + 队壳{' '}
        <span className="mono">{home.influence.shell.toFixed(1)}</span>）× 级别系数{' '}
        <span className="mono">{influenceCoefText(home.influence.tierCoef)}</span> + 奖励分{' '}
        <span className="mono">{home.influence.bonus.toFixed(1)}</span>）——影响上座率与比赛日收入
      </p>
      {home.facilities.length > 0 && (
        <p className="hint">
          设施：
          {home.facilities.map((f) => (
            <span key={f.key} className="badge gray" style={{ marginLeft: 6 }}>
              {FACILITY_LABEL[f.key] ?? f.key} {f.level} 级
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

const WEATHER_ICON: Record<string, string> = { 晴: '☀️', 多云: '⛅', 雨: '🌧️', 雪: '❄️' };

const RESULT_BADGE: Record<string, string> = {
  胜: 'green',
  点球胜: 'green',
  弃权胜: 'green',
  平: 'gray',
  负: 'red',
  点球负: 'red',
  弃权负: 'red',
};

function money2(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(2)} m`;
}

function HomeMatchesCard() {
  const { data, isPending, isError } = useHomeMatches(true);
  const matches = data?.matches ?? [];
  return (
    <section className="card">
      <h3>近期主场战报</h3>
      <p className="hint">最近 {matches.length > 0 ? matches.length : 10} 场主场的上座与比赛日收入（票务 + 商业 + 转播），赛果确认后即时入账。</p>
      {isPending && <p className="muted">正在翻战报…</p>}
      {isError && <p className="error-msg">战报读不出来，稍后再试。</p>}
      {!isPending && !isError && matches.length === 0 && <p className="muted">还没有主场收入记录。赛果确认之后，这里会列出每场的天气、上座与收入。</p>}
      {matches.length > 0 && (
        <div className="table-wrap">
          <table className="coach-sticky">
            <thead>
              <tr>
                <th>窗口</th>
                <th>对手</th>
                <th>比分</th>
                <th>赛果</th>
                <th>天气</th>
                <th className="num">上座</th>
                <th className="num">票务</th>
                <th className="num">商业</th>
                <th className="num">转播</th>
                <th className="num">合计</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.matchId}>
                  <td className="mono">
                    S{m.season} · 窗{m.windowSeq}
                  </td>
                  <td>{m.opponentName ?? (m.opponentId !== null ? `对手 #${m.opponentId}` : '—')}</td>
                  <td className="mono">{m.scoreText ?? '—'}</td>
                  <td>{m.result ? <span className={`badge ${RESULT_BADGE[m.result] ?? 'gray'}`}>{m.result}</span> : <span className="badge gray">待定</span>}</td>
                  <td>{m.weather ? `${WEATHER_ICON[m.weather] ?? ''} ${m.weather}` : '—'}</td>
                  <td className="num mono">
                    {m.attendance.toLocaleString()}
                    {m.attendanceRate !== null && <span className="muted">（{Math.round(m.attendanceRate * 100)}%）</span>}
                  </td>
                  <td className="num mono">{money2(m.ticket)}</td>
                  <td className="num mono">{money2(m.commercial)}</td>
                  <td className="num mono">{money2(m.broadcast)}</td>
                  <td className="num mono gold-text">{money2(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function VenueTab({ home }: { home: StadiumInfo | null }) {
  return (
    <div className="club-block">
      {home && <StadiumCard home={home} />}
      {home && <HomeMatchesCard />}
      <p className="hint">
        <Link to="/shop">去消费中心经营设施 →</Link>
      </p>
    </div>
  );
}
