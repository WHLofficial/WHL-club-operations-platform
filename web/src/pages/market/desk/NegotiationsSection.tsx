// 转会台 · 谈判区（v6.23.0）：原 pages/Negotiations.tsx 主体搬入，逻辑行为不变。
// 家族口径：mono 数字、口语化文案、操作 toast 反馈、两段式 busy 态。
// v6.23.0 新增：会话卡头部阶段徽标（第一步 · 定违约金 / 工资谈判 · 剩 N 轮），只用现有字段推导。
// v6.32.0：删历史台账表——工作台只放进行中，落定记录归球队详情页转会页签的队史（工资随球员合同页签可查）；
// useMyNegotiations 挪 lib/queries.ts；money 收口到 ../shared.tsx；谈判规则展示常量具名。
// v6.40.0 对话式：报价记录表折进卡内对话流（我方报价在右 / 经纪人反馈在左 / 结果用系统行），动作区挪到流底部；
// 工资类金额两位小数（money + m），违约金与成交价走整数口径（moneyIntText）；气泡与系统行时间到秒；
// 工资输入下加实时成功率档位（useWagePreview，350ms 防抖，失败静默）。
// 这个页签不加拒绝 / 终止谈判（设计不做清单）：谈判只有「谈成」或签训练营两条出口。
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, type NegotiationSession, type OfferResult, type ReleaseFeeResult, type TraineeSignResult } from '../../../lib/api.ts';
import { useToast } from '../../../lib/toast.tsx';
import { useMyClub, useMyNegotiations, useWagePreview, qk } from '../../../lib/queries.ts';
import { playerPath } from '../../../lib/player-link.ts';
import { moneyIntText } from '../../../lib/club-cards.ts';
import { useTimeFmt } from '../../../lib/datetime.ts';
import { money } from '../shared.tsx';

const TIER_BADGE: Record<number, string> = { 1: 'green', 2: 'gray', 3: 'red' };

const ATTEMPT_LABEL: Record<string, { text: string; badge: string }> = {
  success: { text: '成', badge: 'green' },
  fail: { text: '未成', badge: 'gray' },
  direct_fail: { text: '直败', badge: 'red' },
};

// 谈判规则展示常量（与后端谈判引擎口径同源的显示值；后端改规则需同步这里）
const MAX_NEGO_ROUNDS = 3;
const TRAINEE_WAGE = 0.75;
const TRAINEE_RELEASE_FEE = 5;

// 服务端只吐档位文案（阈值 0.2/0.5/0.8 留在 Worker 侧），前端只负责上色。
const FORECAST_CLASS: Record<string, string> = {
  成功率很高: 'is-hi',
  成功率过半: 'is-mid',
  成功率偏低: 'is-low',
  成功率很低: 'is-vlow',
};

// 一轮的结果只有落到系统行才看得见：'fail' 不用写——左气泡的经纪人反馈就是那一轮的回应。
// 三种 result 的措辞与后端 settleMessage 同源（成约那是会话级结算句，由 settled.message 承担）。
function attemptSysText(a: NegotiationSession['attempts'][number]): string | null {
  const label = ATTEMPT_LABEL[a.result];
  if (!label || a.result === 'fail') return null;
  const tail =
    a.result === 'success'
      ? '报价被经纪人接受，按你的报价签约'
      : '报价过低，谈判直接失败，已按该次预期工资结算';
  return `${label.text} · ${tail}`;
}

// 我的谈判会话在 lib/queries.ts（页签计数与谈判区共用一个 query 键）

export default function NegotiationsSection() {
  const { show, toastNode } = useToast();
  const { isCoach } = useMyClub();
  const qc = useQueryClient();
  const sessionsQuery = useMyNegotiations(isCoach);
  const sessions = sessionsQuery.data ?? null;
  const loadError = sessionsQuery.isError
    ? sessionsQuery.error instanceof Error
      ? sessionsQuery.error.message
      : '谈判名单打不开了，稍后再试'
    : '';
  const refresh = () => qc.invalidateQueries({ queryKey: qk.myNegotiations });

  const [justSigned, setJustSigned] = useState<{ id: number; name: string } | null>(null);
  const active = useMemo(() => (sessions ?? []).filter((s) => s.status === 'active'), [sessions]);

  // 成约即过户 ⇒ 顺手把新援的球衣号定了（v4.0.0）。号码不是必填，所以留「先跳过」。
  async function afterSettled(msg: string, player: { id: number; name: string }) {
    show(msg);
    setJustSigned(player);
    await refresh();
  }

  return (
    <section id="desk-nego" aria-label="签约谈判">
      <h3>签约谈判</h3>
      <p className="hint">
        成交单获管理组批准后，谈判会话自动开在这里：先定新违约金（幅度受限），再按经纪人预期工资谈工资，最多{' '}
        <span className="mono">{MAX_NEGO_ROUNDS}</span> 轮；任何时候都可以直接签训练营合同（固定{' '}
        <span className="mono">{money(TRAINEE_WAGE)}</span>m / 违约金{' '}
        <span className="mono">{moneyIntText(TRAINEE_RELEASE_FEE) ?? '—'}</span>，不占本窗下放名额）。成约那一刻球员过户、钱款到账。
      </p>
      {loadError && <div className="banner warn">{loadError}</div>}
      {toastNode}

      {justSigned !== null && <NumberPrompt player={justSigned} onDone={() => setJustSigned(null)} show={show} />}

      {sessions === null && !loadError && <p className="muted">正在翻谈判夹…</p>}

      {/* v6.32.0：判空按 active 走——只剩已落定会话（历史已归队史）的教练也该看到引导，而不是空区块 */}
      {sessions !== null && active.length === 0 && (
        <div className="card empty-state">
          <p className="muted">现在没有进行中的谈判。你们买下的球员过了审核之后，会话就会出现在这里。</p>
        </div>
      )}

      {active.map((s) => (
        <SessionCard
          key={s.id}
          session={s}
          onChanged={refresh}
          onSettled={afterSettled}
          onError={(m) => show(m, true)}
          show={show}
        />
      ))}
    </section>
  );
}

/* ---------- 成约后的球衣号（v4.0.0） ---------- */

// 成约那一刻球员就过户了，号码是俱乐部的 ⇒ 就地让教练定号，省得回头翻球员卡。
// 可以跳过：合同页签随时能补，所以这里不拦路，也不校验同队重复之外的东西（后端把关）。
// v6.23.0：toast 由区块级 useToast 渲染，show 从这里传下去（原先子组件各自 useToast 却不渲染 node，消息看不见）。
function NumberPrompt({
  player,
  onDone,
  show,
}: {
  player: { id: number; name: string };
  onDone: () => void;
  show: (text: string, err?: boolean) => void;
}) {
  const qc = useQueryClient();
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || number === '') return;
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; number: number }>(`/api/club/players/${player.id}/number`, {
        number: Number(number),
      });
      show(`${player.name} 定为 ${res.number} 号。`);
      qc.invalidateQueries({ queryKey: qk.squad });
      onDone();
    } catch (err) {
      show(err instanceof Error ? err.message : '定号失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>
        给 {player.name} 定球衣号
        <span className="badge green">新援</span>
      </h3>
      <p className="hint">球员已经过户到你的队里。定个 1–99 的号；不着急也可以先跳过，之后在球员卡的合同页签补。</p>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="new-player-number">球衣号</label>
          <input
            id="new-player-number"
            className="mono"
            type="number"
            min="1"
            max="99"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
        <button className="btn" type="button" disabled={busy || number === ''} onClick={submit}>
          {busy ? '定号中…' : '定号'}
        </button>
        <button className="btn btn-sm" type="button" disabled={busy} onClick={onDone}>
          先跳过
        </button>
      </div>
    </section>
  );
}

/* ---------- 单个进行中的会话 ---------- */

function SessionCard({
  session,
  onChanged,
  onSettled,
  onError,
  show,
}: {
  session: NegotiationSession;
  onChanged: () => Promise<void>;
  onSettled: (msg: string, player: { id: number; name: string }) => Promise<void>;
  onError: (msg: string) => void;
  show: (text: string, err?: boolean) => void;
}) {
  const s = session;
  const { dateTimeSec } = useTimeFmt();
  const lastOffer = s.attempts.length > 0 ? s.attempts[s.attempts.length - 1].offeredWage : null;
  const agentName = `经纪人${s.agentTierLabel}`;

  return (
    <section className="card">
      <h3>
        <Link to={playerPath(s.player)}>{s.player.name}</Link> · 签约谈判
        <span className="badge purple">谈判中</span>
        {/* v6.23.0 阶段徽标：违约金未定 = 第一步，定了才进工资谈判 */}
        {s.releaseFee === null ? (
          <span className="badge sky">第一步 · 定违约金</span>
        ) : (
          <span className="badge gold">工资谈判 · 剩 {s.remaining} 轮</span>
        )}
        <span className={`badge ${TIER_BADGE[s.agentTier] ?? 'gray'}`}>经纪人{s.agentTierLabel}</span>
      </h3>
      <p className="hint">
        {s.fromClubName ?? '—'} → <b>{s.toClubName ?? '—'}</b> · 成交价{' '}
        <span className="mono">{moneyIntText(s.transfer.fee) ?? '—'}</span> · {s.player.position ?? '—'} ·{' '}
        {s.player.age ?? '—'} 岁 · <span className="mono">{s.player.ca ?? '—'}</span> ·{' '}
        <span className="mono">{s.player.pa ?? '—'}</span>
      </p>

      {/* 对话流：会话开场 →（逐轮）我方报价 / 经纪人反馈 / 结果 → 结算。动作区在流底部，跟对话读下来就是一条线 */}
      <div className="nego-thread">
        {s.releaseFee === null ? (
          <p className="nego-sys">谈判会话开启：先定新违约金（整数，幅度受限），定完给出经纪人预期工资。</p>
        ) : (
          <p className="nego-sys">
            违约金定为 <span className="mono">{moneyIntText(s.releaseFee) ?? '—'}</span> · 预期工资{' '}
            <span className="mono">{money(s.expectedWage)}m/半赛季</span>
          </p>
        )}
        {s.attempts.map((a) => {
          const sys = attemptSysText(a);
          return (
            <Fragment key={a.attemptNo}>
              <div className="nego-b me">
                <div className="nego-b-who">我方</div>
                <div className="nego-b-main">
                  第 {a.attemptNo} 轮工资报价 · <span className="mono">{money(a.offeredWage)}m/半赛季</span>
                </div>
                {a.at && <div className="nego-b-at mono">{dateTimeSec(a.at)}</div>}
              </div>
              {/* 逐轮反馈（0066 起落库；老行没有 feedback 就只留我方那条） */}
              {a.feedback && (
                <div className="nego-b them">
                  <div className="nego-b-who">{agentName}</div>
                  <div className="nego-b-main">{a.feedback}</div>
                  {a.at && <div className="nego-b-at mono">{dateTimeSec(a.at)}</div>}
                </div>
              )}
              {sys && <p className="nego-sys">{sys}</p>}
            </Fragment>
          );
        })}
        {s.settled && <p className="nego-sys">{s.settled.message}</p>}
      </div>

      {s.releaseFee === null ? (
        <ReleaseFeeStep session={s} onChanged={onChanged} onError={onError} show={show} />
      ) : (
        <OfferStep session={s} lastOffer={lastOffer} onChanged={onChanged} onSettled={onSettled} onError={onError} show={show} />
      )}
    </section>
  );
}

/* ---------- 第一步：定新违约金 ---------- */

function ReleaseFeeStep({
  session,
  onChanged,
  onError,
  show,
}: {
  session: NegotiationSession;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
  show: (text: string, err?: boolean) => void;
}) {
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
      show(`违约金定为 ${res.releaseFee}m。经纪人预期工资 ${res.expectedWage.toFixed(2)}m/半赛季，开谈吧。`);
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
          ? `幅度受限：只能在 ${session.rcBounds[0]}~${session.rcBounds[1]}m 之间（整数）。`
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
  show,
}: {
  session: NegotiationSession;
  lastOffer: number | null;
  onChanged: () => Promise<void>;
  onSettled: (msg: string, player: { id: number; name: string }) => Promise<void>;
  onError: (msg: string) => void;
  show: (text: string, err?: boolean) => void;
}) {
  const [wage, setWage] = useState('');
  const [debounced, setDebounced] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTrainee, setConfirmTrainee] = useState(false);

  // 输入停下 350ms 再问档位：边敲边打请求既费流量又让胶囊乱跳。
  useEffect(() => {
    const t = setTimeout(() => setDebounced(wage), 350);
    return () => clearTimeout(t);
  }, [wage]);

  // 本地先过一遍规则（金额范围、必须抬高），不合规就只显示提示句——不发请求，也就不会出现
  // 「本地一看就不行、服务端却回了档位」的自相矛盾。
  const wageNum = wage === '' ? Number.NaN : Number(wage);
  const localHint =
    wage === ''
      ? ''
      : !Number.isFinite(wageNum)
        ? '报价要是数字。'
        : wageNum < 0.01
          ? '报价至少 0.01m/半赛季。'
          : wageNum > 20
            ? '报价最多 20m/半赛季。'
            : lastOffer !== null && wageNum <= lastOffer
              ? `必须高于上一次报价 ${money(lastOffer)}m。`
              : '';
  const forecastOn = localHint === '' && wage !== '' && debounced === wage;
  const preview = useWagePreview(session.id, debounced, forecastOn);

  function outcomeMessage(res: OfferResult): string {
    switch (res.result) {
      case 'success':
        return `第 ${res.attemptNo} 轮报价 ${money(res.wage)}m 被接受，合同落定，球员过户完成。`;
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
        await onSettled(outcomeMessage(res), { id: session.player.id, name: session.player.name });
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
      await onSettled(res.message, { id: session.player.id, name: session.player.name });
    } catch (err) {
      onError(err instanceof Error ? err.message : '签约失败');
    } finally {
      setBusy(false);
      setConfirmTrainee(false);
    }
  }

  // 四态：空输入什么都不显示 / 不合规只给本地提示 / 等回话「正在掂量…」/ 到手就上档位胶囊。
  // 请求失败整行不显示（静默）——预览是锦上添花，不能变成拦住出价的错误提示。
  const forecastNode =
    wage === '' ? null : localHint !== '' ? (
      <>
        <span className="live-label">报价提示</span>
        <span className="live-hint">{localHint}</span>
      </>
    ) : preview.isError ? null : (
      <>
        <span className="live-label">预计</span>
        {preview.data ? (
          <span className={`live-pill ${FORECAST_CLASS[preview.data.forecast] ?? 'is-mid'}`}>
            {preview.data.forecast}
            {preview.data.risk ? '（有谈崩风险）' : ''}
          </span>
        ) : (
          <span className="live-pill is-wait">正在掂量…</span>
        )}
      </>
    );

  return (
    <>
      <div className="stat-pair">
        <div className="market-card-price">
          <span className="stat-label">新违约金</span>
          <span className="mono">{moneyIntText(session.releaseFee) ?? '—'}</span>
        </div>
        <div className="market-card-price">
          <span className="stat-label">经纪人预期工资</span>
          <span className="mono gold-text">{money(session.expectedWage)}m/半赛季</span>
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
          {lastOffer !== null ? <>上一次报价 {money(lastOffer)}m，必须一次比一次高。</> : <>第一口价随你开，但别把经纪人惹毛。</>}
          报价不耗轮次，只有经纪人回应了才算一轮。
        </span>
      </div>
      {forecastNode && (
        <div className="live-row" role="status" aria-live="polite">
          {forecastNode}
        </div>
      )}
      <div className="inline-form">
        {confirmTrainee ? (
          <>
            <button className="btn btn-danger" type="button" disabled={busy} onClick={signTrainee}>
              {busy ? '签约中…' : `确认：按 ${money(TRAINEE_WAGE)}m / ${moneyIntText(TRAINEE_RELEASE_FEE) ?? '—'} 签进训练营`}
            </button>
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => setConfirmTrainee(false)}>
              再想想
            </button>
          </>
        ) : (
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => setConfirmTrainee(true)}>
            直接签训练营（{money(TRAINEE_WAGE)}m / 违约金 {moneyIntText(TRAINEE_RELEASE_FEE) ?? '—'}）
          </button>
        )}
        <span className="hint">训练营条款固定，不占本窗 2 个下放名额；点了就成约过户，不能反悔。</span>
      </div>
    </>
  );
}
