// 海捞 /market/free（v6.18.0 改版；v6.24.0 批次 C 拆页；v6.50.0 加暗标段横幅）：资格查询（信息条）+ 暗标段阶段。
// 暗标段（v6.50.0 海捞两阶段）：收标期内自由身池走统一截止的密封标，这里显示倒计时、我的标与开标公示；
// 出标入口在球员档案左栏（E 态），不在本页。金额与出标方保密——教练侧只看得到自己那份。
// 激活别队球员搬到 /market/activation（激活挂牌 + 5 分钟首价窗内落首价，见 MarketActivationPage.tsx）。
// v6.17.0 的成交动态（sea-signs）与 CPU 捞人榜（cpu-board）端点已退役：成交情报迁到 /market/intel，
// 可激活名单换成 /api/market/activatable。需登录（路由守卫），查询端点是教练端点（club.squad.manage）。
import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, type SeaBidStatus } from '../../lib/api.ts';
import { qk, useMyClub, useSeaLookup, useSeaPhase } from '../../lib/queries.ts';
import { useTimeFmt } from '../../lib/datetime.ts';
import { fmtClock, useCountdown } from '../../lib/use-countdown.ts';
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
          <p className="muted">还没有绑定俱乐部。先到我的球队完成绑定，再来海捞。</p>
        </div>
      ) : (
        <>
          <SeaPhaseSection />
          <SeaLookupSection />
        </>
      )}
    </div>
  );
}

/* ---------- 暗标段阶段横幅（v6.50.0，GET /api/transfers/sea-sealed） ---------- */

const SEA_BID_BADGE: Record<SeaBidStatus, { label: string; badge: string }> = {
  sealed: { label: '收标中', badge: 'sky' },
  won: { label: '胜出 · 等审核', badge: 'green' },
  lost: { label: '未胜出', badge: 'gray' },
  void: { label: '已作废', badge: 'gray' },
  withdrawn: { label: '已撤回', badge: 'gray' },
};

function SeaPhaseSection() {
  const qc = useQueryClient();
  const { data } = useSeaPhase();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const left = useCountdown(data?.state === 'sealed' ? (data.batch?.deadlineAt ?? null) : null);
  const fmt = useTimeFmt();

  if (data === undefined || data.state === 'off' || data.state === 'none') return null;

  const withdraw = (playerId: number) => {
    setBusyId(playerId);
    setErr('');
    void apiPost('/api/transfers/sea-sealed/withdraw', { playerId })
      .then(() => qc.invalidateQueries({ queryKey: qk.seaPhase }))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : '撤回没成功，稍后再试'))
      .finally(() => setBusyId(null));
  };

  const banner =
    data.state === 'sealed'
      ? left === null
        ? '暗标段收标中'
        : `暗标段收标中 · 还剩 ${fmtClock(left)}`
      : data.state === 'closing'
        ? '暗标段已截止，正在开标'
        : '暗标段已开标';

  return (
    <section className="card admin-section">
      <h3>海捞暗标段</h3>
      <div className={`banner ${data.state === 'open' ? 'ok' : 'info'}`}>
        <strong>{banner}</strong>
        {data.batch !== null && data.state !== 'open' && (
          <>
            {' '}
            <span className="muted">
              （S{data.batch.season} 第 {data.batch.windowSeq} 窗 · 截止 {fmt.time(data.batch.deadlineAt)}）
            </span>
          </>
        )}
      </div>
      {data.state === 'sealed' || data.state === 'closing' ? (
        <p className="hint">
          本窗自由身池走密封标：金额与出标方保密，统一截止后价高者得（同额先出的胜出）。出标即冻结新违约金的 30%
          （= 签入费），截止前可改可撤；入口在球员档案左栏（E 态）。
        </p>
      ) : (
        <p className="hint">
          开标结果见下。胜出者会进管理组审核 → 工资谈判；没胜出的球队，冻结已解冻。之后本窗自由身池回到常规海捞。
        </p>
      )}
      {err !== '' && <div className="banner warn">{err}</div>}

      {data.myBids.length > 0 && (
        <>
          <h4 className="hint">我的出标（只有自己看得见）</h4>
          <ul className="form-list">
            {data.myBids.map((b) => (
              <li key={b.playerId}>
                <div className="form-row">
                  <span className="form-teams">
                    <Link to={playerPath({ id: b.playerId })}>{b.playerName}</Link>
                    <span className="muted">
                      {' '}
                      新违约金 <span className="mono">{b.newReleaseFee.toFixed(2)}</span>m · 签入费{' '}
                      <span className="mono">{(b.newReleaseFee * 0.3).toFixed(2)}</span>m
                    </span>
                  </span>
                  <span className="form-tail">
                    <span className={`badge ${SEA_BID_BADGE[b.status].badge}`}>{SEA_BID_BADGE[b.status].label}</span>{' '}
                    {b.status === 'sealed' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={busyId === b.playerId}
                        onClick={() => withdraw(b.playerId)}
                      >
                        {busyId === b.playerId ? '撤回中…' : '撤回'}
                      </button>
                    )}
                  </span>
                </div>
                {b.voidReason !== '' && <p className="hint">{b.voidReason}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.state === 'open' && (
        <>
          <h4 className="hint">开标公示</h4>
          {data.results.length === 0 ? (
            <p className="muted">本批没有标生效。</p>
          ) : (
            <ul className="form-list">
              {data.results.map((r) => (
                <li key={r.playerId}>
                  <div className="form-row">
                    <span className="form-teams">
                      <Link to={playerPath({ id: r.playerId })}>{r.playerName}</Link>
                      <span className="muted"> → {r.clubName}</span>
                    </span>
                    <span className="form-tail mono">{r.amount.toFixed(2)}m</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
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
