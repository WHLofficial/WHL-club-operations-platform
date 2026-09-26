// 市场板 /market（v2.2.0 拆页）：转会区（卡柜）+ 单卡详情与出价历史 + 匹配决定（24h 窗）。
// 原 Market.tsx 的转会区与 DetailSection 原样搬迁；海捞/我的挂牌/我的出价分到 /market/free、/market/mine。
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { apiPost, type BidPlaceResult, type MarketListing, type MarketListingDetail, type MatchDecisionResult } from '../../lib/api.ts';
import { useListingDetail, useMarketInvalidation, useBoard, useMyBids, useMyClub, type MarketMyClub } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { playerPath } from '../../lib/player-link.ts';
import {
  BID_STATUS_LABEL,
  FILTER_LABEL,
  LISTING_STATUS_BADGE,
  LISTING_STATUS_LABEL,
  MarketNav,
  deadlineText,
  money,
  type ListingFilter,
} from './shared.tsx';

export default function MarketBoardPage() {
  const { show, toastNode } = useToast();
  const [filter, setFilter] = useState<ListingFilter>('active');
  const [selected, setSelected] = useState<number | null>(null);
  const { club: myClub, isCoach } = useMyClub();
  const { bids: myBids, refresh: refreshMine } = useMyBids(isCoach);
  const boardQuery = useBoard(filter);
  const detailQuery = useListingDetail(selected);
  const invalidateMarket = useMarketInvalidation();

  const board = boardQuery.data ?? null;
  const detail = detailQuery.data ?? null;
  const loadError = boardQuery.isError
    ? boardQuery.error instanceof Error
      ? boardQuery.error.message
      : '市场打不开了，稍后再试'
    : '';

  // 详情拉失败 → toast（旧行为）；成功态由 Query 缓存接管
  useEffect(() => {
    if (detailQuery.isError) {
      show(detailQuery.error instanceof Error ? detailQuery.error.message : '详情打不开了', true);
    }
  }, [detailQuery.isError, detailQuery.error, show]);

  const afterBidOrList = () => {
    invalidateMarket(selected);
    refreshMine();
  };

  const heldTotal = useMemo(() => (myBids ?? []).filter((b) => b.holdStatus === 'held').reduce((s, b) => s + b.amount, 0), [myBids]);
  const available = myClub?.balance !== null && myClub !== null ? (myClub.balance ?? 0) - heldTotal : null;

  return (
    <div className="container">
      <h1>转会市场</h1>
      {loadError && <div className="banner warn">{loadError}</div>}
      {toastNode}
      <MarketNav />

      <section className="card">
        <h3>转会区</h3>
        <div className="seg" role="radiogroup" aria-label="按状态筛选挂牌">
          {(Object.keys(FILTER_LABEL) as ListingFilter[]).map((f) => (
            <button key={f} type="button" className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        {board === null ? (
          loadError ? null : (
            <p className="muted">正在翻卡柜…</p>
          )
        ) : board.listings.length === 0 ? (
          <div className="empty-state">
            <p className="muted">
              {filter === 'active' ? '还没有挂牌。窗口开了之后，这里就是市场。' : '这一栏暂时没有单子。'}
            </p>
          </div>
        ) : (
          <div className="market-grid">
            {board.listings.map((l) => (
              <MarketCard
                key={l.id}
                listing={l}
                mine={myClub?.id === l.sellerClub.id}
                selected={selected === l.id}
                onSelect={() => setSelected(selected === l.id ? null : l.id)}
              />
            ))}
          </div>
        )}
      </section>

      {detail && (
        <DetailSection
          key={detail.listing.id}
          detail={detail}
          myClub={myClub}
          available={available}
          onBid={async (amount) => {
            try {
              const res = await apiPost<BidPlaceResult>(`/api/market/listings/${detail.listing.id}/bids`, { amount });
              if (res.ok) {
                if (res.matchPhase === 'review') {
                  show(`首价 ${money(amount)} m 已落定：训练营球员成交，单子已送管理组审核。`);
                } else if (res.matchPhase === 'matching') {
                  show(`首价 ${money(amount)} m 已落定：进入 24 小时匹配窗，等 ${detail.listing.sellerClub.name} 决定是否匹配。`);
                } else {
                  show(`出价 ${money(amount)} m 已提交，资金冻结中。`);
                }
              }
              await afterBidOrList();
            } catch (err) {
              show(err instanceof Error ? err.message : '出价失败', true);
            }
          }}
          onDecided={(msg) => { show(msg); afterBidOrList(); }}
          onError={(m) => show(m, true)}
        />
      )}
    </div>
  );
}

/* ---------- 卡柜单卡 ---------- */

function MarketCard({
  listing,
  mine,
  selected,
  onSelect,
}: {
  listing: MarketListing;
  mine: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`market-card${selected ? ' on' : ''}${mine ? ' mine' : ''}`} onClick={onSelect}>
      <div className="market-card-head">
        <Link to={playerPath(listing.player)} onClick={(e) => e.stopPropagation()}>
          {listing.player.name}
        </Link>
        <span className="badge-stack">
          {listing.type === 'activation' && <span className="badge purple">激活</span>}
          <span className={`badge ${LISTING_STATUS_BADGE[listing.status] ?? 'gray'}`}>
            {LISTING_STATUS_LABEL[listing.status] ?? listing.status}
          </span>
        </span>
      </div>
      <div className="market-card-sub">
        {listing.player.position ?? '—'} · {listing.player.age ?? '—'} 岁 ·{' '}
        <span className="mono">{listing.player.ca ?? '—'}</span> ·{' '}
        <span className="mono">{listing.player.pa ?? '—'}</span>
      </div>
      <div className="market-card-price">
        <span className="stat-label">{listing.type === 'activation' ? '激活价' : '挂牌价'}</span>
        <span className="mono">{money(listing.askPrice)} m</span>
      </div>
      <div className="market-card-price">
        <span className="stat-label">当前最高</span>
        <span className="mono gold-text">{money(listing.highestBid)} m</span>
      </div>
      <div className="market-card-foot">
        <span>
          {listing.matchPhase === 'matching'
            ? '等被激活方决定是否匹配'
            : listing.firstBidPending
              ? '等激活方落首价'
              : listing.bidCount > 0
                ? `${listing.bidCount} 次出价`
                : '还没人出价'}
        </span>
        {listing.matchPhase === 'matching' ? (
          <span className="mono">{deadlineText(listing.matchDeadline)} 前决定</span>
        ) : listing.firstBidPending ? (
          <span className="mono">{deadlineText(listing.activationDeadline, '')} 前须落价</span>
        ) : (
          listing.status === 'bidding' && <span className="mono">{deadlineText(listing.deadlineAt)}</span>
        )}
      </div>
      <div className="market-card-club">{listing.sellerClub.name}</div>
    </button>
  );
}

/* ---------- 详情 + 出价历史 + 出价表单 ---------- */

function DetailSection({
  detail,
  myClub,
  available,
  onBid,
  onDecided,
  onError,
}: {
  detail: MarketListingDetail;
  myClub: MarketMyClub | null;
  available: number | null;
  onBid: (amount: number) => Promise<void>;
  onDecided: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const l = detail.listing;
  const [amount, setAmount] = useState<string>(String(l.nextMinBid));
  const [busy, setBusy] = useState(false);
  const [matchFee, setMatchFee] = useState<string>('');
  const [matchBusy, setMatchBusy] = useState(false);
  const [passArmed, setPassArmed] = useState(false);
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
  // 激活首价窗：只有激活方能落价，且金额固定为挂牌价
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
            ? `首价已落定，24 小时匹配窗内等 ${l.sellerClub.name} 决定是否匹配（${deadlineText(l.matchDeadline)} 截止）。`
            : l.status === 'delisted'
              ? '这单已经下架。'
              : myClub?.id === l.sellerClub.id
                ? '自家的挂牌，等别人来出价。'
            : l.firstBidPending && !isActivator
              ? `激活首价窗内只有 ${l.activatorName ?? '激活方'} 可以出价（${deadlineText(l.activationDeadline, '')} 前须落价）。`
              : null;

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await onBid(l.firstBidPending && isActivator ? l.askPrice : Number(amount));
    } finally {
      setBusy(false);
    }
  }

  // 被激活方的匹配决定：新 RC 必须高于首价（整数 m），差额在审核通过时销毁
  async function decideMatch(newFee: number | null) {
    if (matchBusy) return;
    setMatchBusy(true);
    try {
      const res = await apiPost<MatchDecisionResult>(`/api/transfers/match`, {
        listingId: l.id,
        ...(newFee === null ? {} : { newReleaseFee: newFee }),
      });
      onDecided(
        res.decision === 'pass'
          ? '已放行：按激活价成交，转管理组审核。'
          : `已提交匹配：新违约金 ${(res.newReleaseFee ?? 0).toFixed(2)} m，差额 ${(res.diff ?? 0).toFixed(2)} m 待审核时回收，球员留队。`,
      );
      setPassArmed(false);
      setMatchFee('');
    } catch (err) {
      onError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setMatchBusy(false);
    }
  }

  const oldRc = l.releaseFee ?? 0;
  const matchDiff = matchFee === '' ? null : Math.max(0, Number(matchFee) - oldRc);

  return (
    <section className="card">
      <h3>
        {l.player.name} · 挂牌详情
        {l.type === 'activation' && <span className="badge purple">激活</span>}
        <span className={`badge ${LISTING_STATUS_BADGE[l.status] ?? 'gray'}`}>{LISTING_STATUS_LABEL[l.status] ?? l.status}</span>
      </h3>
      <p className="hint">
        卖方 <Link to={`/clubs/${l.sellerClub.id}`}>{l.sellerClub.name}</Link> · {l.type === 'activation' ? `激活价 ${money(l.askPrice)} m（${l.activatorName ?? '激活方'} 发起）` : `挂牌价 ${money(l.askPrice)} m`} ·
        违约金 {money(l.releaseFee)} m ·{' '}
        {l.matchPhase === 'matching'
          ? <>匹配窗截止 <span className="mono">{deadlineText(l.matchDeadline)}</span></>
          : l.firstBidPending
            ? <>激活首价窗 <span className="mono">{deadlineText(l.activationDeadline, '')}</span> 前须落价</>
            : l.status === 'bidding'
              ? <>截止判定 <span className="mono">{deadlineText(l.deadlineAt)}</span></>
              : (l.deadlineNote ?? '尚未进入竞价')}
      </p>
      {l.type === 'activation' && (
        <p className="hint">
          激活价落定首价即成交价（激活挂牌不开放后续竞价）：训练营合同直进待审；正式合同进 24 小时匹配窗，
          由 {l.sellerClub.name} 决定匹配（球员留队）还是放行。买方签约时可直签训练营合同（不占下放名额）或谈正式合同。
        </p>
      )}
      {bidHint && <p className="hint">{bidHint}</p>}

      {canBid && l.firstBidPending && isActivator && (
        <div className="inline-form">
          <button className="btn" type="button" disabled={busy} onClick={submit}>
            {busy ? '出价中…' : `落激活首价（${money(l.askPrice)} m）`}
          </button>
          <span className="hint">
            激活金额固定，出价即冻结；{deadlineText(l.activationDeadline, '')} 前不落价，激活作废还占本窗额度。
          </span>
        </div>
      )}

      {canBid && !l.firstBidPending && l.matchPhase === null && (
        <div className="inline-form">
          <div className="field">
            <label htmlFor="bid-amount">出价（m）</label>
            <input
              id="bid-amount"
              className="mono"
              type="number"
              min={l.nextMinBid}
              step="0.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button className="btn" type="button" disabled={busy || Number(amount) < l.nextMinBid} onClick={submit}>
            {busy ? '出价中…' : `出价（至少 ${l.nextMinBid.toFixed(2)} m）`}
          </button>
          <span className="hint">
            出价即冻结资金{available !== null ? <>，当前可支配 {money(available)} m</> : null}。
          </span>
        </div>
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
                onChange={(e) => setMatchFee(e.target.value)}
                placeholder={String(Math.floor((l.highestBid ?? 0) + 1))}
              />
            </div>
            <button
              className="btn"
              type="button"
              disabled={matchBusy || matchFee === '' || !Number.isInteger(Number(matchFee)) || Number(matchFee) <= (l.highestBid ?? 0)}
              onClick={() => decideMatch(Number(matchFee))}
            >
              {matchBusy ? '提交中…' : '提交匹配'}
            </button>
            <button
              className={`btn btn-ghost${passArmed ? ' btn-armed' : ''}`}
              type="button"
              disabled={matchBusy}
              onClick={() => (passArmed ? decideMatch(null) : setPassArmed(true))}
              onBlur={() => setPassArmed(false)}
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
          <table>
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
                    <Link to={`/clubs/${b.clubId}`}>{b.clubName}</Link>
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
    </section>
  );
}
