// 球员转会浮层（v6.74.0 期 C，设计 §6.3/§6.4）：球员页底部抽屉与状态条「查看详情」共用。
// 六段固定顺序：头部 → 状态条 → 出价历史 → 报价摘要 → 谈判摘要 → 动作区。
// 数据只认 GET /api/players/:id/transfer-panel（与挂牌详情同口径），不在这里拼第二套状态。
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiPost, type BidPlaceResult, type TransferPanelResponse } from '../../../lib/api.ts';
import { qk, useClubBalance, useMarketInvalidation, useTransferPanel } from '../../../lib/queries.ts';
import { useQueryClient } from '@tanstack/react-query';
import { MarketBidForm } from '../../../components/MarketBidForm.tsx';
import { IdTag } from '../../../components/IdTag.tsx';
import { useToast } from '../../../lib/toast.tsx';
import { fmtClock, useCountdown } from '../../../lib/use-countdown.ts';
import { canBidOf, offerBadge } from './status.ts';
import { money } from '../shared.tsx';
import { playerPath } from '../../../lib/player-link.ts';
import { TeamLogo } from '../../../components/TeamLogo.tsx';
import { useTimeFmt } from '../../../lib/datetime.ts';

function PanelBadge({ label, cls }: { label: string; cls: string }) {
  return <span className={`badge ${cls}`}>{label}</span>;
}

function bidStatusText(status: string): string {
  if (status === 'active') return '领先中';
  if (status === 'superseded') return '被超出';
  if (status === 'won') return '已中标';
  if (status === 'withdrawn') return '已撤回';
  return status;
}

/** 挂牌状态徽标：与转会台/挂牌详情同一套文案（只补「挂牌中/已结束」两态） */
function listingBadgeOf(p: TransferPanelResponse): { label: string; cls: string } {
  const l = p.listing;
  // 在流程内的新单优先：球员成交后又被挂牌时，不能拿旧 transfer 判成「已结束」
  if (l !== null) {
    if (l.status === 'pending_review') return { label: '待审核', cls: 'purple' };
    if (l.status === 'matched_pending') return { label: '等匹配', cls: 'purple' };
    if (l.status === 'listed' || l.status === 'bidding') return { label: '挂牌中', cls: 'sky' };
  }
  if (p.transfer !== null && p.transfer.completedAt !== null) return { label: '已结束', cls: 'gray' };
  if (l === null) return { label: '无挂牌', cls: 'gray' };
  return { label: '已结束', cls: 'gray' };
}

/** 已结束状态的说明行（设计 §6.2 分态：我是卖方 / 我是买方 / 出过价 / 未成交） */
function endedText(p: TransferPanelResponse, myClubId: number | null): string {
  const t = p.transfer;
  if (t !== null && t.completedAt !== null) {
    const fee = t.fee === null ? '未披露' : `${money(t.fee)}m`;
    if (t.fromClubId === myClubId) return `已售出 · 成交价 ${fee}（去 ${t.toClubName ?? '—'}）`;
    if (t.toClubId === myClubId) return `已签下 · 成交价 ${fee}`;
    return `成交价 ${fee}（${t.fromClubName ?? '—'} → ${t.toClubName ?? '—'}）`;
  }
  const myLost = p.myBids.some((b) => b.status === 'active' || b.status === 'superseded');
  if (myLost) return `已结束 · 未中标${p.listing?.deadlineNote ? ` · ${p.listing.deadlineNote}` : ''}`;
  return `已结束 · 未成交${p.listing?.deadlineNote ? ` · ${p.listing.deadlineNote}` : ''}`;
}

export function PlayerTransferPanel({
  playerId,
  mode,
  onClose,
  onChanged,
}: {
  playerId: number;
  /** desk = 转会台行展开（不叠浮层）；player = 球员页浮层（跳转前先关层） */
  mode: 'desk' | 'player';
  onClose?: () => void;
  onChanged?: () => void;
}) {
  const query = useTransferPanel(playerId);
  const p = query.data ?? null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateMarket = useMarketInvalidation();
  const { show, toastNode } = useToast();
  const { data: balSnap } = useClubBalance(true);
  const [busy, setBusy] = useState(false);
  const fmt = useTimeFmt();

  const listing = p?.listing ?? null;
  const deadline = listing === null ? null : (listing.matchPhase === 'matching' ? listing.matchDeadline : listing.firstBidPending ? listing.activationDeadline : listing.deadlineAt);
  const left = useCountdown(deadline);

  function go(path: string) {
    onClose?.();
    navigate(path);
  }

  async function submitBid(amount: number) {
    if (p === null || listable(p) === null || busy) return;
    const l = listable(p)!;
    setBusy(true);
    try {
      await apiPost<BidPlaceResult>(`/api/market/listings/${l.id}/bids`, { amount });
      invalidateMarket(l.id);
      void qc.invalidateQueries({ queryKey: qk.transferPanel(playerId) });
      onChanged?.();
      show('出价已提交', false);
    } catch (err) {
      show(err instanceof Error ? err.message : '出价失败', true);
    } finally {
      setBusy(false);
    }
  }

  // 可出价的前提：有绑定俱乐部 + 单仍在流程内 + 窗口/暂停/首价窗资格（status.ts 统一口径）。
  // 未绑队教练 club=null：面板仍可看公开段，但不能出价（后端也无俱乐部可记）。
  function listable(x: TransferPanelResponse) {
    const l = x.listing;
    if (l === null || x.club === null) return null;
    return canBidOf(l, l.marketBidPaused, x.club.id) ? l : null;
  }

  if (query.isLoading) {
    return <div className="transfer-panel"><p className="side-sub">正在查这名球员的转会状态…</p></div>;
  }
  if (p === null) {
    return <div className="transfer-panel"><p className="side-sub">转会状态没取到，稍后再试。</p></div>;
  }

  const badge = listingBadgeOf(p);
  const live = listing !== null && (listing.status === 'listed' || listing.status === 'bidding' || listing.status === 'matched_pending' || listing.status === 'pending_review');
  const canBid = listable(p) !== null;
  const isActivator = listing !== null && listing.activatedBy !== null && listing.activatedBy === (p.club?.id ?? null);
  const oldHold = listing === null ? 0 : (p.myBids.find((b) => b.listingId === listing.id && b.status === 'active')?.amount ?? 0);
  const myBid = listing === null ? null : (p.myBids.find((b) => b.listingId === listing.id) ?? null);

  return (
    <div className="transfer-panel">
      {toastNode}
      <header className="transfer-panel-head">
        <TeamLogo name={p.player.clubName ?? ''} />
        <div>
          <div className="transfer-panel-name">
            <Link to={playerPath(p.player)}>{p.player.name}</Link>
            <IdTag kind="球员" value={p.player.id} />
          </div>
          <div className="side-sub">
            {p.player.position ?? '—'} · CA {p.player.ca ?? '—'}
            {p.player.clubName ? ` · ${p.player.clubName}` : ''}
          </div>
        </div>
        <PanelBadge label={badge.label} cls={badge.cls} />
      </header>

      <section className="transfer-panel-sec">
        <div className="transfer-panel-title">状态</div>
        {live && listing !== null ? (
          <>
            <div className="side-row">
              <span className="attr-name">{listing.type === 'activation' ? '激活价' : '挂牌价'}</span>
              <span className="mono">{money(listing.askPrice)}m</span>
            </div>
            <div className="side-row">
              <span className="attr-name">当前最高</span>
              <span className="mono gold-text">
                {listing.highestBidder ? `${listing.highestBidder.name} · ${money(listing.highestBid)}m` : listing.highestBid != null ? `${money(listing.highestBid)}m` : '暂无出价'}
              </span>
            </div>
            {myBid && (
              <div className="side-row">
                <span className="attr-name">我的出价</span>
                <span>
                  {money(myBid.amount)}m · <span className={myBid.status === 'active' ? 'gold-text' : ''}>{bidStatusText(myBid.status)}</span>
                </span>
              </div>
            )}
            <div className="side-row">
              <span className="attr-name">挂牌编号</span>
              <span><IdTag kind="挂牌" value={listing.id} /></span>
            </div>
            <p className="side-sub">
              {listing.status === 'pending_review'
                ? '已截止 · 待管理组审核'
                : listing.status === 'matched_pending'
                  ? '首价落定 · 等匹配'
                  : `挂牌中${left !== null ? ` · 截止 ${fmtClock(left)}` : ''}`}
            </p>
            {listing.deadlineNote && <p className="side-sub">{listing.deadlineNote}</p>}
          </>
        ) : (
          <>
            <p className="side-sub">{endedText(p, p.club?.id ?? null)}</p>
            {myBid !== null && (
              <div className="side-row">
                <span className="attr-name">我的最终出价</span>
                <span className="mono">{money(myBid.amount)}m</span>
              </div>
            )}
            {p.listing !== null && (
              <div className="side-row">
                <span className="attr-name">挂牌编号</span>
                <span><IdTag kind="挂牌" value={p.listing.id} /></span>
              </div>
            )}
          </>
        )}
        {p.negotiation?.status === 'active' && (
          <p className="side-sub">
            合同谈判中 · 剩 {p.negotiation.remaining} 轮
            {p.negotiation.expiresAt !== null ? ` · ${fmt.dateTime(p.negotiation.expiresAt)}` : ''}
          </p>
        )}
      </section>

      {live && listing !== null && (
        <section className="transfer-panel-sec">
          <div className="transfer-panel-title">出价历史</div>
          {p.bids.length === 0 ? (
            <p className="side-sub">还没有人出价。</p>
          ) : (
            p.bids.slice(0, 5).map((b) => (
              <div className="side-row" key={b.id}>
                <span>{b.clubName}</span>
                <span className="mono">
                  {money(b.amount)}m · {bidStatusText(b.status)}
                </span>
              </div>
            ))
          )}
        </section>
      )}

      {(p.offers.in.length > 0 || p.offers.out.length > 0) && (
        <section className="transfer-panel-sec">
          <div className="transfer-panel-title">报价</div>
          {p.offers.in.slice(0, 3).map((o) => (
            <button type="button" className="transfer-panel-link" key={`in-${o.id}`} onClick={() => go(`/market/desk?tab=offers&offer=${o.id}`)}>
              <span>收 · {o.counterpart.name}</span>
              <span className="mono">{money(o.amount)}m</span>
              <PanelBadge label={offerBadge(o).label} cls={offerBadge(o).cls} />
            </button>
          ))}
          {p.offers.out.slice(0, 3).map((o) => (
            <button type="button" className="transfer-panel-link" key={`out-${o.id}`} onClick={() => go(`/market/desk?tab=offers&offer=${o.id}`)}>
              <span>发 · {o.counterpart.name}</span>
              <span className="mono">{money(o.amount)}m</span>
              <PanelBadge label={offerBadge(o).label} cls={offerBadge(o).cls} />
            </button>
          ))}
        </section>
      )}

      {p.negotiation !== null && (
        <section className="transfer-panel-sec">
          <div className="transfer-panel-title">签约谈判</div>
          <div className="side-row">
            <span className="attr-name">新违约金</span>
            <span className="mono">{p.negotiation.releaseFee !== null ? `${money(p.negotiation.releaseFee)}m` : '未定'}</span>
          </div>
          <div className="side-row">
            <span className="attr-name">预期工资</span>
            <span className="mono">{p.negotiation.expectedWage !== null ? `${money(p.negotiation.expectedWage)}m` : '未定'}</span>
          </div>
          <div className="side-row">
            <span className="attr-name">剩余轮数</span>
            <span>{p.negotiation.status === 'active' ? p.negotiation.remaining : '—'}</span>
          </div>
          {p.negotiation.settled !== null && <p className="side-sub">{p.negotiation.settled.message}</p>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => go('/market/desk?tab=nego')}>
            去谈判页签
          </button>
        </section>
      )}

      <section className="transfer-panel-sec">
        <div className="transfer-panel-title">动作</div>
        {canBid && listing !== null ? (
          <MarketBidForm
            mode={listing.firstBidPending && isActivator ? 'activation-first' : 'normal'}
            askPrice={listing.askPrice}
            nextMinBid={listing.nextMinBid}
            available={balSnap?.available ?? null}
            creditLine={balSnap?.creditLine ?? null}
            oldHold={oldHold}
            onBid={submitBid}
          />
        ) : (
          <p className="side-sub">
            {listing !== null && (listing.status === 'listed' || listing.status === 'bidding')
              ? !listing.windowOpen && listing.type !== 'forced'
                ? '窗口已关，开窗后再来。'
                : listing.bidPaused || listing.marketBidPaused
                  ? '这单暂时停价。'
                  : listing.firstBidPending && !isActivator
                    ? '激活首价窗内只有激活方可以出价。'
                    : '这单暂时不能出价。'
              : '没有可进行的市场动作。'}
          </p>
        )}
        <div className="side-btns">
          <Link className="btn btn-sm btn-ghost" to={`/market/desk?tab=bids&player=${p.player.id}`}>
            去转会台看记录
          </Link>
          {mode === 'desk' && p.listing !== null && <span className="side-sub">挂牌编号 <IdTag kind="挂牌" value={p.listing.id} /></span>}
        </div>
      </section>
    </div>
  );
}
