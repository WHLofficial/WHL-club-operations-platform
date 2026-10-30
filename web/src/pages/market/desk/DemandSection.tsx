// 转会台 · 球员要求（v6.54.0 步骤 6，设计 §10.1）：签约谈判页签顶部的「球员要求」分组。
// 形态 = v6.40.0 对话流卡（他提要求 → 你还价 → 他当场表态），无弹窗；五态全部留在页面上：
// 新要求 / 谈判中 / 已接受待生效 / 已拒绝（三种终局）/ 已过期（尾部弱化 + 折叠）。
// 还价只改工资：违约金是固定条款（还价不改变它，不接受只能明确放人），所以输入区只收一个工资。
// 低还价防呆：低于「他的底线」送出置灰并给红字——服务端仍保留「<floor = 拒绝整条要求」的语义（API 兼容），
// 但界面把这种终局收敛到显式「明确放人」入口，避免手滑把一条要求谈死。
// 深链：?tab=negotiations&demand=<id>（站内信 / 球员页只读块的入口）——落在本页签、目标卡高亮
// （.is-target，v6.40.0 报价台 ?offer= 同款）、滚到可视区；目标卡若落在过期折叠里，自动展开。
// 文案纪律（GLOSSARY「球员要求」节）：界面不出现收件箱 / 闹涨薪 / 谈崩 / 底价 / pending 这些机制词；
// 拒绝按钮叫「明确放人」，没谈成叫「没谈成」。
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  apiPost,
  type ContractDemandCard,
  type DemandAcceptResult,
  type DemandCounterResult,
  type DemandWageContext,
  type TransferRequestCard,
} from '../../../lib/api.ts';
import { useContractDemands, useDemandInvalidation, useDemandPreview, useTransferRequests } from '../../../lib/queries.ts';
import { useToast } from '../../../lib/toast.tsx';
import { useTimeFmt } from '../../../lib/datetime.ts';
import { playerPath } from '../../../lib/player-link.ts';
import { moneyIntText } from '../../../lib/club-cards.ts';
import { money } from '../shared.tsx';

// 与 NegotiationsSection 同一套档位词（服务端按 0.2/0.5/0.8 量化，前端只上色）
const FORECAST_CLASS: Record<string, string> = {
  成功率很高: 'is-hi',
  成功率过半: 'is-mid',
  成功率偏低: 'is-low',
  成功率很低: 'is-vlow',
};

// 工资上限的显示口径：与服务端 negotiation-context 的 wageMax 默认值同数（签约谈判 OfferStep 同样硬编码）。
// 超了服务端会回 400，本地先拦是为了不把一句 400 当成交互反馈。
const WAGE_MAX = 20;

// 过期卡最多直接展示几条，其余折叠成计数行（§10.1「>2 条过期折叠计数行」）
const EXPIRED_VISIBLE = 2;

// 每赛季按 2 个常规窗估（§9.1 同口径）
const SEASON_WINDOWS = 2;

function parseId(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 违约金一律整数口径（§5.5 取整链；与签约谈判的 releaseFee / 成交价同写法） */
function rcText(x: number): string {
  return moneyIntText(x) ?? '—';
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * 时间容错：`contract_demands.created_at` / `contract_demand_attempts.created_at` 的 DDL 默认值是
 * SQLite 的 `datetime('now')`——"YYYY-MM-DD HH:MM:SS"，UTC 但没有时区标记，`Date.parse` 会按本机
 * 时区读，直接显示会差一个时区。展示前补成 UTC ISO（带 Z）；已经是 ISO 的（expires_at / resolved_at）
 * 原样返回。口径不一致的根在迁移 0079（其余表一律写 ISO），后端后续统一后这里自然退化为恒等函数。
 */
function utcIso(raw: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
}

export default function DemandSection({ isCoach }: { isCoach: boolean }) {
  const { show, toastNode } = useToast();
  const invalidate = useDemandInvalidation();
  const inboxQuery = useContractDemands(isCoach);
  const requestsQuery = useTransferRequests(isCoach);
  const [params] = useSearchParams();
  const targetId = parseId(params.get('demand'));
  const [showAllExpired, setShowAllExpired] = useState(false);
  const refs = useRef(new Map<number, HTMLElement>());

  const inbox = inboxQuery.data ?? null;
  const requests = requestsQuery.data?.requests ?? [];

  const requestOf = (card: ContractDemandCard): TransferRequestCard | null =>
    requests.find((r) => r.demandId === card.id) ?? null;

  const active = inbox?.active ?? [];
  const accepted = inbox?.accepted ?? [];
  const recent = inbox?.recent ?? [];
  const rejected = recent.filter((c) => c.status === 'rejected');
  const expired = recent.filter((c) => c.status === 'expired');
  const total = active.length + accepted.length + recent.length;
  // 分组头的赛季/窗号：三组里最先出现的那张卡（空态时整组不渲染）
  const anchorCard = active[0] ?? accepted[0] ?? recent[0] ?? null;
  // 目标卡若排在折叠里，强制展开（深链不能落在「还有 N 条」后面）
  const targetInHiddenExpired = targetId !== null && expired.findIndex((c) => c.id === targetId) >= EXPIRED_VISIBLE;
  const expiredShown = showAllExpired || targetInHiddenExpired ? expired : expired.slice(0, EXPIRED_VISIBLE);
  const expiredHidden = expired.length - expiredShown.length;
  const allIds = new Set([...active, ...accepted, ...recent].map((c) => c.id));

  // 目标卡滚到可视区（jsdom 没有 scrollIntoView，守卫写法照 OffersSection 的先例）
  useEffect(() => {
    if (targetId === null) return;
    const el = refs.current.get(targetId);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [targetId, inbox, expiredShown.length]);

  // 非教练不渲染（父容器本来只在教练视角挂本页签，这里是防御）
  if (!isCoach) return null;

  function registerRef(id: number) {
    return (el: HTMLElement | null) => {
      if (el) refs.current.set(id, el);
      else refs.current.delete(id);
    };
  }

  const targetClass = (id: number) => (targetId === id ? ' is-target' : '');

  if (inboxQuery.isPending) return <p className="muted">正在翻球员要求…</p>;

  if (inboxQuery.isError) {
    return (
      <div className="banner bad">
        球员要求打不开：{inboxQuery.error instanceof Error ? inboxQuery.error.message : '稍后再试'}
      </div>
    );
  }

  // 空态：分组头也不渲染（§10.1），只留一句话。toastNode 仍要挂——最后一个动作做完、
  // 列表转空时，操作回执不能跟着一起消失。
  if (inbox !== null && total === 0) {
    return (
      <>
        {toastNode}
        <p className="muted">这个窗口没有球员提出要求。</p>
      </>
    );
  }

  // isPending / isError 都已返回；enabled=false 时 isPending 恒真，所以走到这里 inbox 必有值
  if (inbox === null) return null;
  const wageContext = inbox.wageContext;

  return (
    <section id="desk-demands" aria-label="球员要求">
      {toastNode}
      <div className="demand-group-head">
        <h3>球员要求</h3>
        {active.length > 0 && <span className="badge orange">{active.length}</span>}
        {anchorCard && (
          <span className="muted demand-meta">
            第 {anchorCard.season} 赛季 · 第 {anchorCard.windowSeq} 窗
          </span>
        )}
        {wageContext.currentTotal !== null && (
          <span className="demand-pill">
            当前 <b className="mono">{money(wageContext.currentTotal)}</b> · 待生效{' '}
            <b className="mono">+{money(wageContext.pendingDelta ?? 0)}</b>
          </span>
        )}
      </div>

      {targetId !== null && !allIds.has(targetId) && (
        <p className="banner warn" role="status">
          目标要求 <span className="mono">#{targetId}</span> 不在当前窗口的清单里（可能已作废或已翻页），
          下面仍是现在能处理的要求。
        </p>
      )}

      {active.map((card) => (
        <DemandCard
          key={card.id}
          card={card}
          request={requestOf(card)}
          wageContext={wageContext}
          isTarget={targetId === card.id}
          show={show}
          onChanged={invalidate}
          setRef={registerRef(card.id)}
        />
      ))}

      {accepted.map((card) => (
        <DemandCard
          key={card.id}
          card={card}
          request={requestOf(card)}
          wageContext={wageContext}
          isTarget={targetId === card.id}
          show={show}
          onChanged={invalidate}
          setRef={registerRef(card.id)}
        />
      ))}

      {rejected.map((card) => (
        <DemandCard
          key={card.id}
          card={card}
          request={requestOf(card)}
          wageContext={wageContext}
          isTarget={targetId === card.id}
          show={show}
          onChanged={invalidate}
          setRef={registerRef(card.id)}
        />
      ))}

      {expiredShown.map((card) => (
        <div
          key={card.id}
          className={`demand-expired-row${targetClass(card.id)}`}
          data-demand-id={card.id}
          ref={registerRef(card.id)}
        >
          <b>
            {card.playerName ?? `球员${card.playerId}`}
            {card.position ? ` · ${card.position}` : ''}
          </b>
          <span className="muted">这个窗口没有谈成。放任不理也算一次——再有下次，他就当被放人了。</span>
        </div>
      ))}

      {expiredHidden > 0 && (
        <button type="button" className="demand-fold" aria-expanded={false} onClick={() => setShowAllExpired(true)}>
          还有 {expiredHidden} 条没谈成（过期）· 展开
        </button>
      )}
    </section>
  );
}

/* ---------- 单张要求卡（五态共用外壳） ---------- */

function DemandCard({
  card,
  request,
  wageContext,
  isTarget,
  show,
  onChanged,
  setRef,
}: {
  card: ContractDemandCard;
  request: TransferRequestCard | null;
  wageContext: DemandWageContext;
  isTarget: boolean;
  show: (text: string, err?: boolean) => void;
  onChanged: () => void;
  setRef: (el: HTMLElement | null) => void;
}) {
  const { time, dateTimeSec } = useTimeFmt();
  const [panel, setPanel] = useState<'counter' | 'accept' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);

  const active = card.status === 'pending' || card.status === 'countered';
  const remaining = Math.max(0, card.maxRounds - card.round);
  const who = card.playerName ?? `球员${card.playerId}`;
  const badge = demandBadge(card);

  async function submitAccept() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost<DemandAcceptResult>(`/api/club/contract-demands/${card.id}/accept`, {});
      setPanel(null);
      onChanged();
      show('已接受；新合同在窗口关闭后生效。');
    } catch (err) {
      show(err instanceof Error ? err.message : '接受失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function submitCounter(wage: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<DemandCounterResult>(`/api/club/contract-demands/${card.id}/counter`, { wage });
      setPanel(null);
      onChanged();
      show(counterToast(card, res));
    } catch (err) {
      show(err instanceof Error ? err.message : '还价失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/club/contract-demands/${card.id}/reject`, {});
      setPanel(null);
      onChanged();
      show('已明确放人。他的保护期立即结束，全联盟会收到通告。');
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`card demand-card${active ? '' : ' is-closed'}${isTarget ? ' is-target' : ''}`}
      data-demand-id={card.id}
      ref={setRef}
    >
      <div className="demand-head">
        <h3>
          <Link to={playerPath({ id: card.playerId })}>{who}</Link> · 涨薪要求
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
          {active && (
            <span className="badge sky">
              第 {Math.min(card.round + 1, card.maxRounds)}/{card.maxRounds} 轮 · 剩 {remaining} 轮
            </span>
          )}
        </h3>
        <span className="demand-due mono">{deadlineText(card, time)}</span>
      </div>
      <p className="hint">
        {card.position ?? '—'} · {card.age ?? '—'} 岁 · CA <span className="mono">{card.ca ?? '—'}</span>
        {/* 设计 §10.1 的副行还要求「效力 N 赛季」：收件箱 DTO 目前不下发 service_ticks 换算值
            （DEMAND_LIST_SELECT 只带 players 的 name/position/age/ca），本步不编数；
            后端补字段后在这里追加「· 效力 X 赛季」（也是 TC-RD-35 #3 的缺口）。 */}
      </p>

      {/* 对话流：他开场提要求 → 你还价 / 他当场表态。球员不还价（§10.1 订正屏 40 的方向错误） */}
      <div className="nego-thread">
        <p className="nego-sys">{dateTimeSec(utcIso(card.createdAt))} · 他提出了涨薪要求</p>
        <div className="nego-b them">
          <div className="nego-b-who">{who}</div>
          <p className="nego-b-note">
            教练，我想要 <b className="mono">{money(card.targetWage)}m</b>/窗——现在 {money(card.currentWage)} 太低了。
            {card.rcFloor > 0 && (
              <>
                {' '}另外违约金 <b className="mono">{rcText(card.rcCurrent)} → {rcText(card.rcFloor)}</b>（固定条款，这条不谈）。
              </>
            )}
          </p>
        </div>
        {card.attempts.map((a) => (
          <Fragment key={a.round}>
            <div className="nego-b me">
              <div className="nego-b-who">我方</div>
              <div className="nego-b-main">
                第 {a.round} 次还价 · <span className="mono">{money(a.wage)}m/窗</span>
              </div>
              <div className="nego-b-at mono">{dateTimeSec(utcIso(a.at))}</div>
            </div>
            <div className="nego-b them">
              <div className="nego-b-who">{who}</div>
              <p className="nego-b-note">{playerReply(card, a.wage, a.accepted, a.round)}</p>
            </div>
          </Fragment>
        ))}
      </div>

      {active ? (
        <>
          <div className="inline-form">
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => setPanel(panel === 'accept' ? null : 'accept')}
            >
              按 {money(card.targetWage)} 接受
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy || remaining === 0}
              title={remaining === 0 ? '还价轮次已经用完' : undefined}
              onClick={() => setPanel(panel === 'counter' ? null : 'counter')}
            >
              还价
            </button>
            <button
              className="btn btn-danger"
              type="button"
              disabled={busy}
              onClick={() => setPanel(panel === 'reject' ? null : 'reject')}
            >
              拒绝
            </button>
          </div>

          {panel === 'counter' && (
            <CounterPanel card={card} busy={busy} onSubmit={submitCounter} onClose={() => setPanel(null)} />
          )}
          {panel === 'accept' && (
            <AcceptPanel
              card={card}
              wageContext={wageContext}
              busy={busy}
              onSubmit={submitAccept}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'reject' && (
            <RejectPanel card={card} busy={busy} onSubmit={submitReject} onClose={() => setPanel(null)} />
          )}
        </>
      ) : (
        <ClosedState card={card} request={request} />
      )}
    </section>
  );
}

function demandBadge(card: ContractDemandCard): { label: string; cls: string } {
  if (card.status === 'accepted') return { label: '已接受 · 待生效', cls: 'green' };
  if (card.status === 'rejected') {
    // 界面不写「直接拒绝」（机制词），直拒档叫「明确放人」；其余统称「没谈成」（§10.3）
    return card.resolution === 'direct'
      ? { label: '已拒绝 · 你明确放人', cls: 'red' }
      : { label: '已拒绝 · 没谈成', cls: 'gray' };
  }
  return { label: '涨薪要求', cls: 'gold' };
}

function deadlineText(card: ContractDemandCard, time: (iso: string | null | undefined) => string): string {
  if (card.status === 'accepted') return card.resolvedAt ? `${time(card.resolvedAt)} 成交` : '待生效';
  if (card.status === 'rejected') return card.resolvedAt ? time(card.resolvedAt) : '';
  return `${time(card.expiresAt)} 到期`;
}

/** 他的当场回应。只有「接受 / 没谈拢 / 低于底线 / 轮次用尽」四种事实，不编满意度句（服务端没下发） */
function playerReply(card: ContractDemandCard, wage: number, accepted: boolean, round: number): string {
  if (accepted) return `行，就按 ${money(wage)}m 来。`;
  if (wage < card.floorWage) return '这个数太低了，不谈了。';
  if (round >= card.maxRounds) return '三轮都没谈成，我不奉陪了。';
  return '没谈拢，还差得远。再往上谈谈？';
}

function counterToast(card: ContractDemandCard, res: DemandCounterResult): string {
  if (res.verdict === 'accepted') {
    return `他接受了 ${money(res.acceptedWage ?? card.targetWage)}m/窗。新合同关窗后生效。`;
  }
  if (res.verdict === 'rejected') {
    // 累计第 2 次终局升档（§5.4.4）：服务端 escalated 已把后果换成直拒三件套，回执必须同步说清
    if (res.escalated) return '这是他累计第 2 次没谈成，按「明确放人」处理：保护期立即结束，全联盟会收到通告。';
    return res.source === 'lowball'
      ? '这个数低于他的底线：他拒绝了整条要求，提交了转会申请。'
      : '三轮没谈成。他提交了转会申请，下个窗口还会再提。';
  }
  return `第 ${res.round} 次还价没谈成，还剩 ${Math.max(0, card.maxRounds - res.round)} 轮。`;
}

/* ---------- 还价（卡内就地展开） ---------- */

function CounterPanel({
  card,
  busy,
  onSubmit,
  onClose,
}: {
  card: ContractDemandCard;
  busy: boolean;
  onSubmit: (wage: number) => void;
  onClose: () => void;
}) {
  const [wage, setWage] = useState('');
  const [debounced, setDebounced] = useState('');

  // 输入停下 350ms 再问档位（与签约谈判同节奏）：边敲边打请求既费流量又让胶囊乱跳
  useEffect(() => {
    const t = setTimeout(() => setDebounced(wage), 350);
    return () => clearTimeout(t);
  }, [wage]);

  const wageNum = wage === '' ? Number.NaN : Number(wage);
  // 本地先过一遍规则，不合规只给提示句、不发请求（与 OfferStep 同一纪律）
  const localHint =
    wage === ''
      ? ''
      : !Number.isFinite(wageNum)
        ? '还价要是数字。'
        : wageNum < 0.01
          ? '还价至少 0.01m/窗。'
          : wageNum > WAGE_MAX
            ? `还价最多 ${WAGE_MAX}m/窗。`
            : '';
  const belowFloor = wage !== '' && localHint === '' && wageNum < card.floorWage;
  const atOrAboveTarget = wage !== '' && localHint === '' && wageNum >= card.targetWage;
  const previewOn = wage !== '' && localHint === '' && !belowFloor && !atOrAboveTarget && debounced === wage;
  const preview = useDemandPreview(card.id, debounced, previewOn);

  // 区间条：floor → target 是有效带；低于 floor 时打点钉在左端并变红
  const span = Math.max(0.01, card.targetWage - card.floorWage);
  const pct = Number.isFinite(wageNum) ? Math.min(100, Math.max(0, ((wageNum - card.floorWage) / span) * 100)) : 0;
  const canSubmit = !busy && wage !== '' && localHint === '' && !belowFloor;

  let forecastNode: ReactNode = null;
  if (wage !== '') {
    if (localHint !== '') {
      forecastNode = (
        <>
          <span className="live-label">还价提示</span>
          <span className="live-hint">{localHint}</span>
        </>
      );
    } else if (belowFloor) {
      forecastNode = (
        <>
          <span className="live-label">预计</span>
          <span className="live-pill is-vlow">低于他的底线，等于拒绝整条要求。</span>
        </>
      );
    } else if (atOrAboveTarget) {
      forecastNode = (
        <>
          <span className="live-label">预计</span>
          <span className="live-pill is-hi">等于他的要价，会直接成交。</span>
        </>
      );
    } else if (!preview.isError) {
      forecastNode = (
        <>
          <span className="live-label">预计</span>
          {preview.data ? (
            <span className={`live-pill ${FORECAST_CLASS[preview.data.forecast] ?? 'is-mid'}`}>
              {preview.data.forecast}
              {preview.data.risk ? '（报价过低，可能没谈成）' : ''}
            </span>
          ) : (
            <span className="live-pill is-wait">正在掂量…</span>
          )}
        </>
      );
    }
  }

  return (
    <div className="demand-xpan">
      <p className="hint demand-xpan-sub">
        他要 <b className="mono">{money(card.targetWage)}</b> · 当前{' '}
        <b className="mono">{money(card.currentWage)}</b>
        {card.rcFloor > 0 && (
          <>
            {' '}
            · 违约金 <b className="mono">{rcText(card.rcCurrent)} → {rcText(card.rcFloor)}</b>（固定条款，不参与还价）
          </>
        )}
        {' '}
        · 第 {Math.min(card.round + 1, card.maxRounds)} 次还价，共 {card.maxRounds} 次
      </p>

      <div className="demand-range">
        <div className="demand-range-head">
          <span>他的区间</span>
          <b className="mono">{wage === '' ? '—' : wage}</b>
        </div>
        <div className={`demand-range-track${belowFloor ? ' is-low' : ''}`}>
          <span className="demand-range-pin" style={{ left: `${pct}%` }} />
        </div>
        <div className="demand-range-ends mono">
          <span>他的底线 {money(card.floorWage)}</span>
          <span>要价 {money(card.targetWage)}</span>
        </div>
      </div>

      <div className="inline-form">
        <div className="field">
          <label htmlFor={`demand-wage-${card.id}`}>还价工资（m/窗）</label>
          <input
            id={`demand-wage-${card.id}`}
            className="mono"
            type="number"
            min="0.01"
            max={WAGE_MAX}
            step="0.01"
            value={wage}
            onChange={(e) => setWage(e.target.value)}
          />
        </div>
        <button className="btn" type="button" disabled={!canSubmit} onClick={() => onSubmit(Number(wage))}>
          {busy ? '送出中…' : '送出还价'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>
          收起
        </button>
      </div>

      {forecastNode && (
        <div className="live-row" role="status" aria-live="polite">
          {forecastNode}
        </div>
      )}

      {belowFloor && (
        <p className="demand-lowball" role="alert">
          低于 {money(card.floorWage)} 他会视为拒绝整条要求并提交转会申请；要拒绝请点「拒绝」。
        </p>
      )}

      <p className="hint">
        送出后他会当场表态：接受就按这个数成交，没谈成还有 {Math.max(0, card.maxRounds - card.round - 1)} 轮。
        违约金不参与还价。
      </p>
    </div>
  );
}

/* ---------- 接受（卡内两段式确认） ---------- */

function AcceptPanel({
  card,
  wageContext,
  busy,
  onSubmit,
  onClose,
}: {
  card: ContractDemandCard;
  wageContext: DemandWageContext;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const delta = round2(card.targetWage - card.currentWage);
  const perSeason = round2(delta * SEASON_WINDOWS);
  // 超帽警示（§10.1）：current + 已接受的待生效 + 这一笔 > 工资帽才渲染；wageCap=null（未定级）不画。
  // 数字快照进 over 对象——渲染分支里就不用再对 null 做非空断言。
  const currentTotal = wageContext.currentTotal;
  const wageCap = wageContext.wageCap;
  const pendingDelta = wageContext.pendingDelta ?? 0;
  const projected =
    currentTotal !== null && wageCap !== null && wageCap > 0 ? round2(currentTotal + pendingDelta + delta) : null;
  const over =
    projected !== null && wageCap !== null && projected > wageCap
      ? { projected, over: round2(projected - wageCap), currentTotal: currentTotal ?? 0, pendingDelta }
      : null;

  return (
    <div className="demand-xpan">
      <div className="demand-xpan-title">接受他的要求？</div>
      <div className="demand-rows">
        <div className="demand-row">
          <span>工资</span>
          <b>
            {money(card.currentWage)} <span className="demand-arrow">→</span> {money(card.targetWage)}m / 窗
          </b>
        </div>
        <div className="demand-row">
          <span>每赛季</span>
          <b className="mono">+{money(perSeason)}m</b>
        </div>
        <div className="demand-row">
          <span>违约金</span>
          <b>{card.rcFloor > 0 ? `${rcText(card.rcCurrent)} → ${rcText(card.rcFloor)}` : '不变（他没提违约金）'}</b>
        </div>
        <div className="demand-row">
          <span>费用</span>
          <b className="mono">0</b>
        </div>
        <div className="demand-row">
          <span>生效</span>
          <b>关窗后；关窗前交易按原违约金</b>
        </div>
      </div>

      {over && (
        <div className="banner bad">
          当前 {money(over.currentTotal)}m/窗，另有待生效 +{money(over.pendingDelta)}m；这笔 +{money(delta)}m，接受后{' '}
          {money(over.projected)}m/窗，
          <b>超工资帽 {money(over.over)}m</b>。关窗时需强制拍卖球员。
        </div>
      )}

      <div className="inline-form">
        <button className={`btn${over ? ' btn-danger' : ''}`} type="button" disabled={busy} onClick={onSubmit}>
          {busy ? '接受中…' : over ? '仍然接受' : '确认接受'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>
          再想想
        </button>
      </div>
      <p className="hint">接受后不会立刻扣钱；工资和违约金在关窗时一起生效。关窗前卖人，按原违约金算。</p>
    </div>
  );
}

/* ---------- 拒绝（明确放人 · 卡内两段式） ---------- */

function RejectPanel({
  card,
  busy,
  onSubmit,
  onClose,
}: {
  card: ContractDemandCard;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="demand-xpan">
      <div className="demand-xpan-title">明确放他走？</div>
      <div className="banner warn">
        他的<b>保护期立即结束</b>——
        {card.rcCurrent > 0 ? (
          <>
            任何球队都能按违约金原价 <b className="mono">{rcText(card.rcCurrent)}</b> 激活他
          </>
        ) : (
          <>他合同里没有违约金条款，别的队不能按违约金挖走</>
        )}
        ；全联盟会收到通告，他挂着「不满」标记，直到离队或重新签约。
      </div>
      <div className="inline-form">
        <button className="btn btn-danger" type="button" disabled={busy} onClick={onSubmit}>
          {busy ? '处理中…' : '明确放人'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>
          再想想
        </button>
      </div>
      <p className="hint">
        这个决定不动任何价格：违约金、工资、市场价、成长全部保持原样——只有保护期、通告与「不满」标记会变。
      </p>
    </div>
  );
}

/* ---------- 收口态（已接受 / 已拒绝 / 已过期） ---------- */

function ClosedState({ card, request }: { card: ContractDemandCard; request: TransferRequestCard | null }) {
  if (card.status === 'accepted') {
    return (
      <p className="banner ok">
        <b>已接受 · 关窗后生效</b>（{money(card.targetWage)}m/窗 ·{' '}
        {card.rcFloor > 0 ? `违约金 ${rcText(card.rcFloor)}` : '违约金不变'}）。
        <Link to={playerPath({ id: card.playerId })}>看他的合同 ›</Link>
      </p>
    );
  }

  // 直拒档：三件套（保护期失效 / 全联盟通告 / 不满标记），价格一项都不动
  if (card.resolution === 'direct') {
    return (
      <p className="banner warn">
        已放行 · <b>保护期已结束</b>、全联盟已收通告，他挂着「不满」标记——
        {card.rcCurrent > 0 ? (
          <>
            可被按违约金原价 <b className="mono">{rcText(card.rcCurrent)}</b> 激活
          </>
        ) : (
          <>合同里没有违约金条款，激活不适用</>
        )}
        ，直到离队或重新签约。
        <Link to={playerPath({ id: card.playerId })}>看他的页面 ›</Link>
      </p>
    );
  }

  // 没谈成的第 2 次终局（升档）：后端按「明确放人」的三件套落后果，申请行是 released
  if (request?.status === 'released') {
    return (
      <p className="banner warn">
        这是他累计第 2 次没谈成，按「明确放人」处理：<b>保护期已结束</b>、全联盟已收通告，他挂着「不满」标记，
        直到离队或重新签约。
        <Link to={playerPath({ id: card.playerId })}>看他的页面 ›</Link>
      </p>
    );
  }

  if (request?.status === 'listed') {
    return (
      <p className="banner info">
        已挂牌 · 要价按你定的区间，等出价。<Link to="/market/board">去转会区看 ›</Link>
      </p>
    );
  }

  return (
    <p className="banner info">
      <b>转会申请挂着</b> · 下个窗口他还会再提，而且一次开到市场价。
      <Link to={playerPath({ id: card.playerId })}>去他的页面挂牌 ›</Link>
    </p>
  );
}
