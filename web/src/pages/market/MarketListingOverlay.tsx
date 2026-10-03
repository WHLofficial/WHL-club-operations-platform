// 挂牌浮层（v6.24.0 批次 B）：桌面 = 居中弹层，≤760px = 底部抽屉（上滑出），createPortal 挂到 body。
// 内容 = 球员信息 + 出价表单（MarketBidForm）+ 被激活方的匹配决定 + 出价历史；
// 读秒与卡片共用同一绝对截止字段（pickDeadline + useCountdown），打开是接续而不是重置。
// 卡片与浮层共用的口径函数（listingBadge / pickDeadline）放在本文件，避免与 MarketBoardPage 循环引用。
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { apiPost, type BidPlaceResult, type MarketListing, type MatchDecisionResult } from '../../lib/api.ts';
import { MarketBidForm } from '../../components/MarketBidForm.tsx';
import { TeamLogo } from '../../components/TeamLogo.tsx';
import { playerPath } from '../../lib/player-link.ts';
import { useListingDetail, useMarketInvalidation, type MarketMyClub } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';
import { fmtClock, useCountdown } from '../../lib/use-countdown.ts';
import { BID_STATUS_LABEL, money } from './shared.tsx';

/** 卡片 / 浮层共用的状态徽标：三态统一，不看是否已有人出价（内部 listed/bidding 留给结算）。 */
export function listingBadge(l: Pick<MarketListing, 'status' | 'type' | 'activatedBy'>): { text: string; tone: string } {
  if (l.status === 'matched_pending') return { text: '等待匹配', tone: 'mkt-badge-wait' };
  if (l.type === 'activation' && l.status === 'listed' && l.activatedBy !== null) {
    return { text: '等激活方出价', tone: 'mkt-badge-actwait' };
  }
  if (l.status === 'listed' || l.status === 'bidding') return { text: '竞价中', tone: 'mkt-badge-bid' };
  if (l.status === 'pending_review') return { text: '待审核', tone: 'mkt-badge-plain' };
  if (l.status === 'delisted') return { text: '已下架', tone: 'mkt-badge-plain' };
  return { text: l.status, tone: 'mkt-badge-plain' };
}

/** 读秒锚的绝对截止字段：匹配窗看 matchDeadline、激活首价窗看 activationDeadline，其余看 deadlineAt。 */
export function pickDeadline(
  l: Pick<MarketListing, 'matchPhase' | 'matchDeadline' | 'firstBidPending' | 'activationDeadline' | 'deadlineAt'>,
): string | null {
  if (l.matchPhase === 'matching') return l.matchDeadline ?? null;
  if (l.firstBidPending) return l.activationDeadline ?? null;
  return l.deadlineAt ?? null;
}

/** 绝对截止时刻（浮层里「（M月D日 HH:MM 判定）」用）。 */
export function deadlineAbsolute(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MarketListingOverlay({
  listingId,
  myClub,
  available,
  onClose,
  onBidDone,
}: {
  listingId: number;
  myClub: MarketMyClub | null;
  available: number | null;
  onClose: () => void;
  /** 出价 / 匹配决定成功后让页面刷新「已冻结资金」口径 */
  onBidDone: () => void;
}) {
  const narrow = useMediaQuery('(max-width: 760px)');
  const detailQuery = useListingDetail(listingId);
  const detail = detailQuery.data ?? null;
  const invalidateMarket = useMarketInvalidation();
  const { show, toastNode } = useToast();
  const [success, setSuccess] = useState<string | null>(null);
  const [matchFee, setMatchFee] = useState<string>('');
  const [matchBusy, setMatchBusy] = useState(false);
  const [passArmed, setPassArmed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const l = detail === null ? null : detail.listing;
  const remaining = useCountdown(l === null ? null : pickDeadline(l));

  async function handleBid(amount: number) {
    if (l === null) return;
    try {
      const res = await apiPost<BidPlaceResult>(`/api/market/listings/${l.id}/bids`, { amount });
      if (res.ok) {
        if (res.matchPhase === 'review') {
          show(`首价 ${money(amount)} m 已落定：训练营球员成交，单子已送管理组审核。`);
        } else if (res.matchPhase === 'matching') {
          show(`首价 ${money(amount)} m 已落定：进入 24 小时匹配窗，等 ${l.sellerClub.name} 决定是否匹配。`);
        } else {
          setSuccess(`✓ 出价成功（${money(amount)} m），截止时刻已刷新。`);
        }
        invalidateMarket(l.id);
        onBidDone();
      }
    } catch (err) {
      show(err instanceof Error ? err.message : '出价失败', true);
    }
  }

  // 被激活方的匹配决定：新 RC 必须高于首价（整数 m），差额在审核通过时销毁
  async function decideMatch(newFee: number | null) {
    if (l === null || matchBusy) return;
    setMatchBusy(true);
    try {
      const res = await apiPost<MatchDecisionResult>(`/api/transfers/match`, {
        listingId: l.id,
        ...(newFee === null ? {} : { newReleaseFee: newFee }),
      });
      show(
        res.decision === 'pass'
          ? '已放行：按激活价成交，转管理组审核。'
          : `已提交匹配：新违约金 ${(res.newReleaseFee ?? 0).toFixed(2)} m，差额 ${(res.diff ?? 0).toFixed(2)} m 待审核时回收，球员留队。`,
      );
      setPassArmed(false);
      setMatchFee('');
      invalidateMarket(l.id);
      onBidDone();
    } catch (err) {
      show(err instanceof Error ? err.message : '提交失败', true);
    } finally {
      setMatchBusy(false);
    }
  }

  // 最新出价 / 匹配决定的资金口径可能会变：重新拉一次刷新（由外层完成）

  return createPortal(
    <div className={narrow ? 'mkt-ov mkt-ov-drawer' : 'mkt-ov'} onClick={onClose} role="presentation">
      <div
        className="mkt-ov-panel"
        role="dialog"
        aria-modal="true"
        aria-label="挂牌详情"
        onClick={(e) => e.stopPropagation()}
      >
        {narrow && <div className="mkt-ov-grab" aria-hidden="true" />}
        {toastNode}
        {l === null || detail === null ? (
          <div className="mkt-ov-body">
            <p className="muted">
              {detailQuery.isError
                ? detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : '详情打不开了，稍后再试'
                : '正在开浮层…'}
            </p>
            <button className="btn btn-ghost" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        ) : (
          <OverlayBody
            listing={l}
            detail={detail}
            myClub={myClub}
            available={available}
            remaining={remaining}
            success={success}
            matchFee={matchFee}
            matchBusy={matchBusy}
            passArmed={passArmed}
            onClose={onClose}
            onBid={handleBid}
            onMatchFee={setMatchFee}
            onDecide={decideMatch}
            onPassArm={setPassArmed}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function OverlayBody({
  listing: l,
  detail,
  myClub,
  available,
  remaining,
  success,
  matchFee,
  matchBusy,
  passArmed,
  onClose,
  onBid,
  onMatchFee,
  onDecide,
  onPassArm,
}: {
  listing: MarketListing & { releaseFee: number | null; windowOpen: boolean; nextMinBid: number; activatorName: string | null };
  detail: NonNullable<ReturnType<typeof useListingDetail>['data']>;
  myClub: MarketMyClub | null;
  available: number | null;
  remaining: number | null;
  success: string | null;
  matchFee: string;
  matchBusy: boolean;
  passArmed: boolean;
  onClose: () => void;
  onBid: (amount: number) => Promise<void>;
  onMatchFee: (v: string) => void;
  onDecide: (newFee: number | null) => void;
  onPassArm: (v: boolean) => void;
}) {
  const badge = listingBadge(l);
  const deadline = pickDeadline(l);
  const isActivator = myClub !== null && l.activatedBy === myClub.id;
  const isSeller = myClub !== null && myClub.id === l.sellerClub.id;
  const baseCanBid =
    myClub !== null &&
    myClub.isCoach &&
    myClub.id !== l.sellerClub.id &&
    (l.status === 'listed' || l.status === 'bidding') &&
    l.windowOpen &&
    !l.bidPaused &&
    !detail.marketBidPaused;
  const canBid = baseCanBid && !(l.firstBidPending && !isActivator);
  const bidHint = !l.windowOpen
    ? '这单所属的转会窗口已经关了。'
    : l.bidPaused
      ? '这单被管理组暂停出价，已出的价与到期结算不受影响。'
      : detail.marketBidPaused
        ? '全市场出价已暂停（管理组干预中），恢复后再来。'
        : l.status === 'pending_review'
          ? '这单已截止，正在等管理组审核。'
          : l.status === 'matched_pending'
            ? `首价已落定，24 小时匹配窗内等 ${l.sellerClub.name} 决定是否匹配（${deadlineAbsolute(l.matchDeadline)} 截止）。`
            : l.status === 'delisted'
              ? '这单已经下架。'
              : isSeller
                ? '自家的挂牌，等别人来出价。'
                : l.firstBidPending && !isActivator
                  ? `激活首价窗内只有 ${l.activatorName ?? '激活方'} 可以出价（${deadlineAbsolute(l.activationDeadline)} 前须落价）。`
                  : null;
  const halfPrice = l.matchPhase === 'matching' ? (l.highestBid ?? l.askPrice) : null;
  const note = isSeller
    ? '这是你的挂牌：竞价截止后最高价进审核过户；可在球员页维护报价设置。窗尾无人出价将自动下架（收下架费）。'
    : l.matchPhase === 'matching' && halfPrice !== null
      ? `竞价已截止。被激活方 ${l.activatorName ?? l.sellerClub.name} 可在匹配窗内付「新违约金 > ${money(halfPrice)} m」的差额把球员留下，到期未匹配则按 ${money(halfPrice)} m 成交。`
      : l.firstBidPending
        ? `首价窗内只有 ${l.activatorName ?? '激活方'} 可以出价，金额固定为激活价；落价后进入公开竞价。`
        : null;
  const oldRc = l.releaseFee ?? 0;
  const matchDiff = matchFee === '' ? null : Math.max(0, Number(matchFee) - oldRc);

  return (
    <div className="mkt-ov-body">
      <div className="mkt-ov-head">
        <h3 className="mkt-ov-name">{l.player.name}</h3>
        <span className={`mkt-badge ${badge.tone}`}>{badge.text}</span>
        <button className="mkt-ov-x" type="button" aria-label="关闭" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="mkt-ov-sub">
        <Link to={playerPath(l.player)}>{l.player.position ?? '—'}</Link> · {l.player.age ?? '—'} 岁 · CA{' '}
        <span className="mono">{l.player.ca ?? '—'}</span> · PA <span className="mono">{l.player.pa ?? '—'}</span>
      </p>

      <dl className="mkt-ov-rows">
        <div>
          <dt>{l.type === 'activation' ? '激活价' : '挂牌价'}</dt>
          <dd className="mono">{money(l.askPrice)} m</dd>
        </div>
        <div>
          <dt>{l.matchPhase === 'matching' ? '最终最高' : '当前最高'}</dt>
          <dd className="mono mkt-ov-hi">
            {l.highestBid == null
              ? '还没人出价'
              : l.highestBidder
                ? `${l.highestBidder.name} · ${money(l.highestBid)} m`
                : `${money(l.highestBid)} m`}
          </dd>
        </div>
        <div>
          <dt>截止</dt>
          <dd className="mono">
            {remaining === null ? '—' : `⏱ 剩 ${fmtClock(remaining)}`}
            {deadline !== null && <span className="mkt-ov-abs">（{deadlineAbsolute(deadline)} 判定）</span>}
          </dd>
        </div>
        <div>
          <dt>卖方</dt>
          <dd className="mkt-ov-club">
            <TeamLogo name={l.sellerClub.name} size={16} /> {l.sellerClub.name}
          </dd>
        </div>
      </dl>

      {note !== null && <p className="mkt-ov-note">{note}</p>}
      {l.type === 'activation' && (
        <p className="mkt-ov-note">
          激活价落定首价即成交价（激活挂牌不开放后续竞价）：训练营合同直进待审；正式合同进 24 小时匹配窗，由{' '}
          {l.sellerClub.name} 决定匹配（球员留队）还是放行。买方签约时可直签训练营合同（不占下放名额）或谈正式合同。
        </p>
      )}
      {bidHint !== null && <p className="mkt-ov-note">{bidHint}</p>}
      {success !== null && <p className="mkt-ov-ok">{success}</p>}

      {canBid && l.firstBidPending && isActivator && (
        <>
          <MarketBidForm mode="activation-first" askPrice={l.askPrice} nextMinBid={l.nextMinBid} available={available} onBid={onBid} />
          <span className="hint">{deadlineAbsolute(l.activationDeadline)} 前不落价，激活作废还占本窗额度。</span>
        </>
      )}
      {canBid && !l.firstBidPending && l.matchPhase === null && (
        <MarketBidForm mode="normal" askPrice={l.askPrice} nextMinBid={l.nextMinBid} available={available} onBid={onBid} />
      )}

      {isSeller && l.matchPhase === 'matching' && (
        <div className="admin-section">
          <h4>匹配决定（被激活方）</h4>
          <p className="hint">
            匹配：给球员一份新违约金（整数 m，须高于首价 {money(l.highestBid)} m，不受幅度限制），审核通过时回收新旧差额
            {oldRc > 0 ? <>（现违约金 {money(oldRc)} m）</> : null}，球员留队且本球员生涯只能被匹配这一次。
            放行：按激活价成交送管理组审核。
          </p>
          <div className="inline-form">
            <div className="field">
              <label htmlFor="match-fee">匹配新违约金（m）</label>
              <input
                id="match-fee"
                className="mono"
                type="number"
                min={Math.floor((l.highestBid ?? 0) + 1)}
                step="1"
                value={matchFee}
                onChange={(e) => onMatchFee(e.target.value)}
                placeholder={String(Math.floor((l.highestBid ?? 0) + 1))}
              />
            </div>
            <button
              className="btn"
              type="button"
              disabled={matchBusy || matchFee === '' || !Number.isInteger(Number(matchFee)) || Number(matchFee) <= (l.highestBid ?? 0)}
              onClick={() => onDecide(Number(matchFee))}
            >
              {matchBusy ? '提交中…' : '提交匹配'}
            </button>
            <button
              className={`btn btn-ghost${passArmed ? ' btn-armed' : ''}`}
              type="button"
              disabled={matchBusy}
              onClick={() => (passArmed ? onDecide(null) : onPassArm(true))}
              onBlur={() => onPassArm(false)}
            >
              {passArmed ? '再点一次确认放行' : '放行（不匹配）'}
            </button>
          </div>
          {matchDiff !== null && matchDiff > 0 && (
            <p className="hint">
              预估差额回收 <span className="mono">{matchDiff.toFixed(2)}</span> m（新违约金 {Number(matchFee).toFixed(2)} − 现违约金{' '}
              {oldRc.toFixed(2)}），审核通过时从账户回收。
            </p>
          )}
        </div>
      )}

      <h4>出价历史</h4>
      {detail.bids.length === 0 ? (
        <p className="muted">还没有出价记录。第一口价就是挂牌价起。</p>
      ) : (
        <div className="table-wrap">
          <table className="table-sticky-2">
            <thead>
              <tr>
                <th>出价方</th>
                <th className="num">金额（m）</th>
                <th>时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {detail.bids.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="mkt-ov-bidder">
                      <TeamLogo name={b.clubName} size={16} />
                      <Link to={`/clubs/${b.clubId}`}>{b.clubName}</Link>
                    </span>
                  </td>
                  <td className="num mono">{money(b.amount)}</td>
                  <td className="mono">{b.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <span className={`badge ${b.status === 'active' ? 'sky' : b.status === 'won' ? 'gold' : 'gray'}`}>
                      {BID_STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
