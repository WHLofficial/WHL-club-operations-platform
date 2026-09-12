// 签约谈判（增量 4，§6.7）：我的谈判会话——定新违约金、工资报价（≤3 轮）、直签训练营。
// 满意度文案与结局由服务端给出（§6.10：前端不含任何判定参数，E 数值仅展示）。
// 家族口径：mono 数字、口语化文案、操作 toast 反馈、两段式 busy 态。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  api,
  apiPost,
  type NegotiationSession,
  type OfferResult,
  type ReleaseFeeResult,
  type TraineeSignResult,
} from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';

const SOURCE_LABEL: Record<string, string> = {
  negotiation: '报价成约',
  forced: '强制成约',
  direct: '直败结算',
  trainee: '训练营直签',
};

const SOURCE_BADGE: Record<string, string> = {
  negotiation: 'green',
  forced: 'orange',
  direct: 'red',
  trainee: 'purple',
};

const TIER_BADGE: Record<number, string> = { 1: 'green', 2: 'gray', 3: 'red' };

const ATTEMPT_LABEL: Record<string, { text: string; badge: string }> = {
  success: { text: '成', badge: 'green' },
  fail: { text: '未成', badge: 'gray' },
  direct_fail: { text: '直败', badge: 'red' },
};

function money(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : x.toFixed(2);
}

export default function Negotiations() {
  const { show, toastNode } = useToast();
  const [sessions, setSessions] = useState<NegotiationSession[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ sessions: NegotiationSession[] }>('/api/negotiations?mine=1');
      setSessions(data.sessions);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '谈判名单打不开了，稍后再试');
      setSessions(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const active = useMemo(() => (sessions ?? []).filter((s) => s.status === 'active'), [sessions]);
  const done = useMemo(() => (sessions ?? []).filter((s) => s.status !== 'active'), [sessions]);

  async function afterSettled(msg: string) {
    show(msg);
    await refresh();
  }

  return (
    <div className="container">
      <h1>签约谈判</h1>
      <p className="hint">
        成交单获管理组批准后，谈判会话自动开在这里：先定新违约金（幅度受限），再按经纪人预期工资谈工资，最多{' '}
        <span className="mono">3</span> 轮；任何时候都可以直接签训练营合同（固定 <span className="mono">0.75</span> m /
        违约金 <span className="mono">5</span> m，不占本窗下放名额）。成约那一刻球员过户、钱款到账。
      </p>
      {loadError && <div className="banner warn">{loadError}</div>}
      {toastNode}

      {sessions === null && !loadError && <p className="muted">正在翻谈判夹…</p>}

      {sessions !== null && sessions.length === 0 && (
        <div className="card empty-state">
          <p className="muted">现在没有谈判。你们买下的球员过了审核之后，会话就会出现在这里。</p>
        </div>
      )}

      {active.map((s) => (
        <SessionCard key={s.id} session={s} onChanged={refresh} onSettled={afterSettled} onError={(m) => show(m, true)} />
      ))}

      {done.length > 0 && (
        <section className="card admin-section">
          <h3>已落定的谈判</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>流向</th>
                  <th className="num">成交价（m）</th>
                  <th className="num">签约工资（m）</th>
                  <th>成约方式</th>
                </tr>
              </thead>
              <tbody>
                {done.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/players/${s.player.id}`}>{s.player.name}</Link>
                    </td>
                    <td>
                      {s.fromClubName ?? '—'} → <b>{s.toClubName ?? '—'}</b>
                    </td>
                    <td className="num mono">{money(s.transfer.fee)}</td>
                    <td className="num mono">{money(s.settled?.wage ?? null)}</td>
                    <td>
                      <span className={`badge ${SOURCE_BADGE[s.settled?.source ?? ''] ?? 'gray'}`}>
                        {SOURCE_LABEL[s.settled?.source ?? ''] ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- 单个进行中的会话 ---------- */

function SessionCard({
  session,
  onChanged,
  onSettled,
  onError,
}: {
  session: NegotiationSession;
  onChanged: () => Promise<void>;
  onSettled: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const s = session;
  const lastOffer = s.attempts.length > 0 ? s.attempts[s.attempts.length - 1].offeredWage : null;

  return (
    <section className="card">
      <h3>
        <Link to={`/players/${s.player.id}`}>{s.player.name}</Link> · 签约谈判
        <span className="badge purple">谈判中</span>
        <span className={`badge ${TIER_BADGE[s.agentTier] ?? 'gray'}`}>经纪人{s.agentTierLabel}</span>
      </h3>
      <p className="hint">
        {s.fromClubName ?? '—'} → <b>{s.toClubName ?? '—'}</b> · 成交价 <span className="mono">{money(s.transfer.fee)}</span> m ·
        {s.player.position ?? '—'} · CA <span className="mono">{s.player.ca ?? '—'}</span> · PA{' '}
        <span className="mono">{s.player.pa ?? '—'}</span>
      </p>

      {s.releaseFee === null ? (
        <ReleaseFeeStep session={s} onChanged={onChanged} onError={onError} />
      ) : (
        <OfferStep session={s} lastOffer={lastOffer} onChanged={onChanged} onSettled={onSettled} onError={onError} />
      )}

      {s.attempts.length > 0 && (
        <>
          <h4>报价记录</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">轮次</th>
                  <th className="num">报价（m）</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {s.attempts.map((a) => (
                  <tr key={a.attemptNo}>
                    <td className="num mono">{a.attemptNo}</td>
                    <td className="num mono">{money(a.offeredWage)}</td>
                    <td>
                      <span className={`badge ${ATTEMPT_LABEL[a.result]?.badge ?? 'gray'}`}>
                        {ATTEMPT_LABEL[a.result]?.text ?? a.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.lastSatisfaction && (
            <p className="hint">
              上一轮反馈：{s.lastSatisfaction}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- 第一步：定新违约金 ---------- */

function ReleaseFeeStep({
  session,
  onChanged,
  onError,
}: {
  session: NegotiationSession;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const { show } = useToast();
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<ReleaseFeeResult>(`/api/negotiations/${session.transferId}/release-fee`, {
        fee: Number(fee),
      });
      onChanged();
      show(`违约金定为 ${res.releaseFee} m。经纪人预期工资 ${res.expectedWage.toFixed(2)} m/半赛季，开谈吧。`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor={`rc-${session.id}`}>新违约金（m）</label>
        <input
          id={`rc-${session.id}`}
          className="mono"
          type="number"
          min="1"
          step="1"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder={session.rcBounds ? `${session.rcBounds[0]}~${session.rcBounds[1]}` : ''}
        />
      </div>
      <button className="btn" type="button" disabled={busy || fee === ''} onClick={submit}>
        {busy ? '提交中…' : '定违约金，出预期工资'}
      </button>
      <span className="hint">
        {session.rcBounds
          ? `幅度受限：只能在 ${session.rcBounds[0]}~${session.rcBounds[1]} m 之间（整数）。`
          : '幅度受限（整数 m）。'}
        定完会给出经纪人预期工资。
      </span>
    </div>
  );
}

/* ---------- 第二步：工资报价 / 直签训练营 ---------- */

function OfferStep({
  session,
  lastOffer,
  onChanged,
  onSettled,
  onError,
}: {
  session: NegotiationSession;
  lastOffer: number | null;
  onChanged: () => Promise<void>;
  onSettled: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const { show } = useToast();
  const [wage, setWage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTrainee, setConfirmTrainee] = useState(false);

  function outcomeMessage(res: OfferResult): string {
    switch (res.result) {
      case 'success':
        return `第 ${res.attemptNo} 轮报价 ${money(res.wage)} m 被接受，合同落定，球员过户完成。`;
      case 'direct':
        return res.message ?? '报价过低，谈判直接失败，已按预期工资结算。';
      case 'forced':
        return res.message ?? '三轮未谈拢，已按预期工资强制成约。';
      default:
        return `${res.satisfaction ?? ''} 第 ${res.attemptNo} 轮没谈拢，还剩 ${res.remaining} 轮。`;
    }
  }

  async function submitOffer() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<OfferResult>(`/api/negotiations/${session.id}/offer`, { wage: Number(wage) });
      if (res.result === 'fail') {
        await onChanged();
        show(outcomeMessage(res), res.risk === true);
      } else {
        await onSettled(outcomeMessage(res));
      }
      setWage('');
    } catch (err) {
      onError(err instanceof Error ? err.message : '报价失败');
    } finally {
      setBusy(false);
    }
  }

  async function signTrainee() {
    if (busy || !confirmTrainee) return;
    setBusy(true);
    try {
      const res = await apiPost<TraineeSignResult>(`/api/negotiations/${session.id}/trainee`, {});
      await onSettled(res.message);
    } catch (err) {
      onError(err instanceof Error ? err.message : '签约失败');
    } finally {
      setBusy(false);
      setConfirmTrainee(false);
    }
  }

  return (
    <>
      <div className="stat-pair">
        <div className="market-card-price">
          <span className="stat-label">新违约金</span>
          <span className="mono">{money(session.releaseFee)} m</span>
        </div>
        <div className="market-card-price">
          <span className="stat-label">经纪人预期工资</span>
          <span className="mono gold-text">{money(session.expectedWage)} m/半赛季</span>
        </div>
      </div>
      <div className="inline-form">
        <div className="field">
          <label htmlFor={`wage-${session.id}`}>工资报价（m/半赛季）</label>
          <input
            id={`wage-${session.id}`}
            className="mono"
            type="number"
            min="0.01"
            max="20"
            step="0.01"
            value={wage}
            onChange={(e) => setWage(e.target.value)}
          />
        </div>
        <button className="btn" type="button" disabled={busy || wage === ''} onClick={submitOffer}>
          {busy ? '谈判中…' : `报价（剩 ${session.remaining} 轮）`}
        </button>
        <span className="hint">
          {lastOffer !== null ? <>上一次报价 {money(lastOffer)} m，必须一次比一次高。</> : <>第一口价随你开，但别把经纪人惹毛。</>}
          报价不耗轮次，只有经纪人回应了才算一轮。
        </span>
      </div>
      <div className="inline-form">
        {confirmTrainee ? (
          <>
            <button className="btn btn-danger" type="button" disabled={busy} onClick={signTrainee}>
              {busy ? '签约中…' : '确认：按 0.75m / 5m 签进训练营'}
            </button>
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => setConfirmTrainee(false)}>
              再想想
            </button>
          </>
        ) : (
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => setConfirmTrainee(true)}>
            直接签训练营（0.75m / 违约金 5m）
          </button>
        )}
        <span className="hint">训练营条款固定，不占本窗 2 个下放名额；点了就成约过户，不能反悔。</span>
      </div>
    </>
  );
}
