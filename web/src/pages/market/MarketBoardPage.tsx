// 在售市场 /market（v2.2.0 拆页，v6.18.0 改名，v6.24.0 卡片改版）：转会区卡柜 + 点击开浮层（详情/出价/匹配决定）。
// v6.24.0：卡片换成 rail 骨架（左栏 CA/PA 大数字）+ 三态徽标 + 底部读秒倒计时，队名一律配 TeamLogo；
// 详情、出价表单、被激活方匹配决定、出价历史全部搬进 MarketListingOverlay（桌面弹层 / ≤760 底部抽屉）。
// 海捞在 /market/free，挂牌+出价+报价+谈判在 /market/desk（v6.23.0 合并），市场情报在 /market/intel。
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { MarketListing } from '../../lib/api.ts';
import { TeamLogo } from '../../components/TeamLogo.tsx';
import { useBoard, useClubBalance, useClubsList, useListingPrefetch, useMarketInvalidation, useMyBids, useMyClub } from '../../lib/queries.ts';
import { attrClass } from '../../lib/players-library.ts';
import { playerPath } from '../../lib/player-link.ts';
import { fmtClock, useCountdown } from '../../lib/use-countdown.ts';
import { AdBoardTeaser } from './MarketAdBoardPage.tsx';
import { MarketListingOverlay, listingBadge, pickDeadline } from './MarketListingOverlay.tsx';
import { FILTER_LABEL, MarketNav, money, type ListingFilter } from './shared.tsx';

export default function MarketBoardPage() {
  const [filter, setFilter] = useState<ListingFilter>('active');
  const [selected, setSelected] = useState<number | null>(null);
  const { club: myClub, isCoach } = useMyClub();
  const { refresh: refreshMine } = useMyBids(isCoach);
  const boardQuery = useBoard(filter);
  const invalidateMarket = useMarketInvalidation();

  const board = boardQuery.data ?? null;
  const loadError = boardQuery.isError
    ? boardQuery.error instanceof Error
      ? boardQuery.error.message
      : '市场打不开了，稍后再试'
    : '';

  // 队徽（v6.60.8）：卡柜此前调 TeamLogo 没传 logoKey，卖方与领先买家的队徽一律回落成「队名哈希色块 + 首字」。
  // 真源是比赛系统 team.logo_key，`GET /api/clubs` 目录已按 club_id 折好（服务端 clubs scope 缓存 24h，前端 30s
  // staleTime），拿它做一次 id → logoKey 映射即可；不在 /market/listings 这个「不缓存、每 30s 就可能重取」的
  // 热端点里再加 AUTH_DB 映射 + TOUR_DB 点查两条只读。目录里没有的 club_id 返回 null，由 TeamLogo 回落。
  const { data: clubsDir } = useClubsList();
  const logoOf = useMemo(() => {
    const logoByClub = new Map<number, string>();
    for (const club of clubsDir?.clubs ?? []) if (club.logoKey) logoByClub.set(club.id, club.logoKey);
    return (clubId: number | null) => (clubId === null ? null : (logoByClub.get(clubId) ?? null));
  }, [clubsDir]);

  // 浮层首开提速（v6.60.8）：卡片被指向/聚焦/按下时先取详情，点开时多半已在缓存（详见 useListingPrefetch）
  const prefetchListing = useListingPrefetch();

  // v6.57.0 收编：可支配读余额端点（含预期收入额度；冻结口径覆盖报价 / 海捞，
  // 旧自算只减挂牌出价冻结，会与账本页「可支配」打架）；myBids 仍留给出价后的刷新回调
  const { data: balSnap } = useClubBalance(isCoach);
  const available = balSnap?.available ?? null;
  const creditLine = balSnap?.creditLine ?? null;

  return (
    <div className="container">
      <h1>转会市场 · 在售市场</h1>
      {loadError && <div className="banner warn">{loadError}</div>}
      <MarketNav />

      {/* v6.31.0：广告板入口小卡片（名单为空时整块不渲染） */}
      <AdBoardTeaser />

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
              <MarketCard
                key={l.id}
                listing={l}
                mine={myClub?.id === l.sellerClub.id}
                logoOf={logoOf}
                onPrefetch={() => prefetchListing(l.id)}
                onOpen={() => setSelected(l.id)}
              />
            ))}
          </div>
        )}
      </section>

      {selected !== null && (
        <MarketListingOverlay
          listingId={selected}
          myClub={myClub ?? null}
          available={available}
          creditLine={creditLine}
          logoOf={logoOf}
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

export function MarketCard({
  listing,
  mine,
  onOpen,
  logoOf,
  onPrefetch,
}: {
  listing: MarketListing;
  mine: boolean;
  onOpen: () => void;
  /** club_id → 队徽 R2 键（真源 = 比赛系统 team.logo_key，见本页 /api/clubs 目录映射）；缺省时 TeamLogo 回落色块 */
  logoOf?: (clubId: number | null) => string | null;
  /** 指向 / 聚焦 / 按下卡片时预取详情（v6.60.8）：点开浮层时详情多半已在缓存 */
  onPrefetch?: () => void;
}) {
  const badge = listingBadge(listing);
  const remaining = useCountdown(pickDeadline(listing));

  return (
    <button
      type="button"
      className={`mkt-card${mine ? ' mkt-mine' : ''}`}
      onClick={onOpen}
      onPointerEnter={onPrefetch}
      onPointerDown={onPrefetch}
      onFocus={onPrefetch}
    >
      <div className="mkt-card-head">
        <TeamLogo name={listing.sellerClub.name} logoKey={logoOf?.(listing.sellerClub.id)} size={22} />
        <Link className="mkt-nm" to={playerPath(listing.player)} onClick={(e) => e.stopPropagation()}>
          {listing.player.name}
        </Link>
        <span className="badge-stack">
          {/* 强拍标记（v6.60.10）：强制拍卖单在卡柜里恒排最前，卡头要能看出这是管理端挂的单，不是普通挂牌 */}
          {listing.type === 'forced' && <span className="badge red">强拍</span>}
          {listing.type === 'activation' && <span className="badge purple">激活</span>}
          <span className={`mkt-badge ${badge.tone}`}>{badge.text}</span>
        </span>
      </div>
      <div className="mkt-card-sub">
        {listing.player.position ?? '—'} · {listing.player.age ?? '—'} 岁
      </div>

      {/* CA/PA 与价格三行包在一层里（v6.60.9）：桌面竖排（CA/PA 一条、价格三行一条），
          ≤760 改成横排——rail 换到右边当竖列，省掉一整条卡高。DOM 顺序不动，靠 CSS order 换位。 */}
      <div className="mkt-card-mid">
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
            <span className="mkt-val mono">{money(listing.askPrice)}m</span>
          </div>
          <div className="mkt-row">
            <span className="mkt-labr">当前最高</span>
            <span className={`mkt-val mono${listing.highestBid != null ? ' mkt-hi' : ''}`}>
              {listing.highestBid == null ? '还没人出价' : `${money(listing.highestBid)}m`}
            </span>
          </div>
          <div className="mkt-row">
            <span className="mkt-labr">出价次数</span>
            <span className="mkt-val mono mkt-count">{listing.bidCount} 次</span>
          </div>
        </div>
      </div>

      <div className="mkt-card-foot">
        <span className={`mkt-timer mono${remaining !== null && remaining < 3600 ? ' mkt-soon' : ''}`}>
          ⏱ 剩 {remaining === null ? '—' : fmtClock(remaining)}
        </span>
        {/* 卡脚右侧是「当前领先买家」（v6.60.8）：此前放的是卖方，与卡头卖方队徽重复，且看不出谁在领先。
            「领先」小标签用来和卡头的卖方徽区分开；无人出价给占位文案，别把卖方名错读成买家。 */}
        {listing.highestBidder === null ? (
          <span className="mkt-tn mkt-tn-none">无人领先</span>
        ) : (
          <span className="mkt-tn" title={`当前领先：${listing.highestBidder.name}`}>
            <span className="mkt-tn-lab">领先</span>
            <TeamLogo name={listing.highestBidder.name} logoKey={logoOf?.(listing.highestBidder.id)} size={16} />
            <span className="mkt-tn-txt">{listing.highestBidder.name}</span>
          </span>
        )}
      </div>
    </button>
  );
}
