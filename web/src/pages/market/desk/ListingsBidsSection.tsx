// 转会台 · 我的出价区（v6.23.0 从 pages/MarketMinePage.tsx 搬入；v6.72.0 期 A 按球员聚合）。
// 同一球员的多笔出价只占一行；行内展开看我在这单上的全部出价 + 历史挂牌，仍能加价。
// 出价表单、余额提示、冻结口径沿用 v6.57.0/v6.24.0；期 A 不新增端点。
import { useState } from 'react';
import { Link } from 'react-router';
import { apiPost, type MyBidRow } from '../../../lib/api.ts';
import { IdTag } from '../../../components/IdTag.tsx';
import { MarketBidForm } from '../../../components/MarketBidForm.tsx';
import { useClubBalance, useListingDetail, useMarketInvalidation, useMyBids, useMyClub } from '../../../lib/queries.ts';
import { playerPath } from '../../../lib/player-link.ts';
import { useToast } from '../../../lib/toast.tsx';
import { useTimeFmt } from '../../../lib/datetime.ts';
import { money } from '../shared.tsx';
import DeskPlayerRow from './DeskPlayerRow.tsx';
import { groupBidsByPlayer, type BidPlayerRow } from './desk-rows.ts';
import { bidBadge, canBidOf } from './status.ts';

export default function ListingsBidsSection() {
  const { isCoach, club: myClub } = useMyClub();
  const { bids: myBids } = useMyBids(isCoach);
  // v6.57.0 收编：可支配 / 冻结读余额端点（含预期收入额度；冻结口径覆盖报价 / 海捞——
  // 旧自算只减挂牌出价冻结，会与账本页「可支配」互相打架）
  const { data: snap } = useClubBalance(isCoach);

  return (
    <section id="desk-bids" aria-label="我的出价">
      {myBids !== null && (
        <MyBidsSection
          bids={myBids}
          myClubId={myClub?.id ?? null}
          available={snap?.available ?? null}
          held={snap?.held ?? null}
          creditLine={snap?.creditLine ?? null}
          balance={myClub?.balance ?? null}
        />
      )}
    </section>
  );
}

/* ---------- 我的出价 ---------- */

function MyBidsSection({
  bids,
  myClubId,
  available,
  held,
  creditLine,
  balance,
}: {
  bids: MyBidRow[];
  myClubId: number | null;
  available: number | null;
  held: number | null;
  creditLine: number | null;
  balance: number | null;
}) {
  const { show, toastNode } = useToast();
  const invalidate = useMarketInvalidation();
  const rows = groupBidsByPlayer(bids);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  function toggle(playerId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function openRow(playerId: number) {
    setExpanded((prev) => new Set(prev).add(playerId));
  }

  async function placeBid(row: BidPlayerRow, amount: number) {
    try {
      await apiPost(`/api/market/listings/${row.currentListingId}/bids`, { amount });
      show(`出价已送出：${money(amount)}m，等窗口收口。`);
      invalidate(row.currentListingId);
    } catch (err) {
      // 表单自己会复位 busy；这里只负责把后端原因说出来
      show(err instanceof Error ? err.message : '出价失败', true);
    }
  }

  return (
    <section className="card">
      <h3>我的出价</h3>
      <p className="hint">
        账户余额 {money(balance)}m，冻结中 {money(held)}m（含报价 / 海捞），
        可支配 {money(available)}m{(creditLine ?? 0) > 0 ? `（含预期收入 ${money(creditLine)}m）` : ''}。出价即冻结，被超出或落选自动解冻。
      </p>
      <p className="hint">
        同一球员只占一行；行内看我在当前挂牌上的全部出价。{bids.length === 100 ? '最多展示最近 100 笔。' : ''}
      </p>
      {toastNode}

      {rows.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">还没出过价。去在售市场挑一件挂单，或到激活页捞别家小将。</p>
        </div>
      ) : (
        <div className="desk-list">
          {rows.map((row) => {
            const open = expanded.has(row.player.id);
            return (
              <DeskPlayerRow
                key={row.player.id}
                player={row.player}
                meta={`${row.current.sellerClubName} · 挂牌 #${row.currentListingId}`}
                amount={`${money(row.amount)}m`}
                badge={row.badge}
                action={row.action}
                expanded={open}
                onToggle={() => toggle(row.player.id)}
                onAction={() => openRow(row.player.id)}
              >
                <BidPlayerPanel
                  row={row}
                  myClubId={myClubId}
                  available={available}
                  creditLine={creditLine}
                  onBid={(amount) => placeBid(row, amount)}
                />
              </DeskPlayerRow>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BidPlayerPanel({
  row,
  myClubId,
  available,
  creditLine,
  onBid,
}: {
  row: BidPlayerRow;
  myClubId: number | null;
  available: number | null;
  creditLine: number | null;
  onBid: (amount: number) => Promise<void>;
}) {
  const { dateTimeSec } = useTimeFmt();
  const detail = useListingDetail(row.currentListingId);
  const listing = detail.data?.listing ?? null;
  const canBid = listing !== null && canBidOf(listing, detail.data?.marketBidPaused ?? false, myClubId);
  // 抬价顶替回加：只取我在这一单上仍 active 的那笔冻结
  const oldHold =
    row.bids.find((b) => b.listingId === row.currentListingId && b.status === 'active')?.amount ?? 0;

  const reason = !listing
    ? '这单挂牌已不在市场，只能看历史。'
    : !listing.windowOpen
      ? '这单所属的转会窗口已经关了，暂不能出价；开窗后再来。'
      : listing.status === 'pending_review'
        ? '这单已截止，正在等管理组审核。'
        : listing.status === 'matched_pending'
          ? '首价已落定，正在等被激活方决定是否匹配。'
          : listing.bidPaused || detail.data?.marketBidPaused
            ? '这单的出价已暂停。'
            : listing.firstBidPending
              ? '激活首价窗内只有激活方可以出价。'
              : '这单暂时不能出价。';

  return (
    <>
      <div>
        <p className="desk-panel-title">我的出价历史</p>
        <ul className="desk-history">
          {row.bids.map((b) => {
            const badge = bidBadge(b);
            const current = b.listingId === row.currentListingId;
            return (
              <li className={`desk-hist-row${current ? ' is-current' : ''}`} key={b.id}>
                <div className="desk-hist-main">
                  <span className="mono">{money(b.amount)}m</span>{' '}
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  <div className="desk-hist-sub">
                    {dateTimeSec(b.createdAt)} · {current ? '当前挂牌' : `历史挂牌 #${b.listingId}`}
                  </div>
                </div>
                <span className="desk-hist-tag">
                  <IdTag kind="出价" value={b.id} />
                </span>
                <Link className="btn btn-sm btn-ghost" to={playerPath(b.player)}>
                  球员页
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="desk-panel-title">当前挂牌</p>
        {detail.isPending && <p className="muted">正在读这单挂牌…</p>}
        {detail.isError && <div className="banner bad">{detail.error instanceof Error ? detail.error.message : '挂牌详情拉取失败'}</div>}
        {listing !== null && canBid && (
          <>
            {/* v6.72.2：两个字段一律按 null 判（详情旧版/缓存缺字段时是 undefined —— 原先 `!== null`
                判真后读 .name 抛错，整页白屏） */}
            <p className="hint">
              要价 <span className="mono">{money(listing.askPrice)}m</span> · 当前最高{' '}
              <span className="mono">{listing.highestBid == null ? '暂无' : `${money(listing.highestBid)}m`}</span>
              {listing.highestBidder != null && <>（{listing.highestBidder.name}）</>}
            </p>
            <MarketBidForm
              mode={listing.firstBidPending && listing.activatedBy === myClubId ? 'activation-first' : 'normal'}
              askPrice={listing.askPrice}
              nextMinBid={listing.nextMinBid}
              available={available}
              creditLine={creditLine}
              oldHold={oldHold}
              onBid={onBid}
            />
          </>
        )}
        {listing !== null && !canBid && <p className="hint">{reason}</p>}
        {!detail.isPending && listing === null && !detail.isError && <p className="hint">{reason}</p>}
      </div>
    </>
  );
}
