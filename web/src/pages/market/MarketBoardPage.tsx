// 在售市场 /market（v2.2.0 拆页，v6.18.0 改名，v6.24.0 卡片改版）：转会区卡柜 + 点击开浮层（详情/出价/匹配决定）。
// v6.24.0：卡片换成 rail 骨架（左栏 CA/PA 大数字）+ 三态徽标 + 底部读秒倒计时，队名一律配 TeamLogo；
// 详情、出价表单、被激活方匹配决定、出价历史全部搬进 MarketListingOverlay（桌面弹层 / ≤760 底部抽屉）。
// 海捞在 /market/free，挂牌+出价+报价+谈判在 /market/desk（v6.23.0 合并），市场情报在 /market/intel。
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { MarketListing } from '../../lib/api.ts';
import { TeamLogo } from '../../components/TeamLogo.tsx';
import { useBoard, useMarketInvalidation, useMyBids, useMyClub } from '../../lib/queries.ts';
import { attrClass } from '../../lib/players-library.ts';
import { playerPath } from '../../lib/player-link.ts';
import { fmtClock, useCountdown } from '../../lib/use-countdown.ts';
import { MarketListingOverlay, listingBadge, pickDeadline } from './MarketListingOverlay.tsx';
import { FILTER_LABEL, MarketNav, money, type ListingFilter } from './shared.tsx';

export default function MarketBoardPage() {
  const [filter, setFilter] = useState<ListingFilter>('active');
  const [selected, setSelected] = useState<number | null>(null);
  const { club: myClub, isCoach } = useMyClub();
  const { bids: myBids, refresh: refreshMine } = useMyBids(isCoach);
  const boardQuery = useBoard(filter);
  const invalidateMarket = useMarketInvalidation();

  const board = boardQuery.data ?? null;
  const loadError = boardQuery.isError
    ? boardQuery.error instanceof Error
      ? boardQuery.error.message
      : '市场打不开了，稍后再试'
    : '';

  // 已冻结资金口径：余额 − 持有中的出价（浮层里出价表单显示可动用金额）
  const heldTotal = useMemo(() => (myBids ?? []).filter((b) => b.holdStatus === 'held').reduce((s, b) => s + b.amount, 0), [myBids]);
  const available = myClub?.balance !== null && myClub !== null ? (myClub.balance ?? 0) - heldTotal : null;

  return (
    <div className="container">
      <h1>转会市场 · 在售市场</h1>
      {loadError && <div className="banner warn">{loadError}</div>}
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
          <div className="mkt-grid">
            {board.listings.map((l) => (
              <MarketCard key={l.id} listing={l} mine={myClub?.id === l.sellerClub.id} onOpen={() => setSelected(l.id)} />
            ))}
          </div>
        )}
      </section>

      {selected !== null && (
        <MarketListingOverlay
          listingId={selected}
          myClub={myClub ?? null}
          available={available}
          onClose={() => setSelected(null)}
          onBidDone={() => {
            invalidateMarket(selected);
            refreshMine();
          }}
        />
      )}
    </div>
  );
}

/* ---------- 卡柜单卡（v2.2.0 起；v6.24.0 rail 骨架） ---------- */

export function MarketCard({ listing, mine, onOpen }: { listing: MarketListing; mine: boolean; onOpen: () => void }) {
  const badge = listingBadge(listing);
  const remaining = useCountdown(pickDeadline(listing));

  return (
    <button type="button" className={`mkt-card${mine ? ' mkt-mine' : ''}`} onClick={onOpen}>
      <div className="mkt-card-head">
        <TeamLogo name={listing.sellerClub.name} size={22} />
        <Link className="mkt-nm" to={playerPath(listing.player)} onClick={(e) => e.stopPropagation()}>
          {listing.player.name}
        </Link>
        <span className="badge-stack">
          {listing.type === 'activation' && <span className="badge purple">激活</span>}
          <span className={`mkt-badge ${badge.tone}`}>{badge.text}</span>
        </span>
      </div>
      <div className="mkt-card-sub">
        {listing.player.position ?? '—'} · {listing.player.age ?? '—'} 岁
      </div>

      <div className="mkt-rail">
        <span className="mkt-rail-cell">
          <span className="mkt-rail-lab">CA</span>
          <span className={`mkt-rail-num mono${listing.player.ca === null ? '' : ` ${attrClass(listing.player.ca)}`}`}>
            {listing.player.ca ?? '—'}
          </span>
        </span>
        <span className="mkt-rail-cell">
          <span className="mkt-rail-lab">PA</span>
          <span className={`mkt-rail-num mono${listing.player.pa === null ? '' : ` ${attrClass(listing.player.pa)}`}`}>
            {listing.player.pa ?? '—'}
          </span>
        </span>
      </div>

      <div className="mkt-rows">
        <div className="mkt-row">
          <span className="mkt-labr">{listing.type === 'activation' ? '激活价' : '挂牌价'}</span>
          <span className="mkt-val mono">{money(listing.askPrice)} m</span>
        </div>
        <div className="mkt-row">
          <span className="mkt-labr">当前最高</span>
          <span className={`mkt-val mono${listing.highestBid != null ? ' mkt-hi' : ''}`}>
            {listing.highestBid == null ? '还没人出价' : `${money(listing.highestBid)} m`}
          </span>
        </div>
        <div className="mkt-row">
          <span className="mkt-labr">出价次数</span>
          <span className="mkt-val mono mkt-count">{listing.bidCount} 次</span>
        </div>
      </div>

      <div className="mkt-card-foot">
        <span className={`mkt-timer mono${remaining !== null && remaining < 3600 ? ' mkt-soon' : ''}`}>
          ⏱ 剩 {remaining === null ? '—' : fmtClock(remaining)}
        </span>
        <span className="mkt-tn">
          <TeamLogo name={listing.sellerClub.name} size={16} />
          <span className="mkt-tn-txt">{listing.sellerClub.name}</span>
        </span>
      </div>
    </button>
  );
}
