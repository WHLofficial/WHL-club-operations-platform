// 转会台统一状态词表（v6.72.0 期 A）：三页签 + 球员页共用。
// 徽标只从这里取，组件里不再各写一套字符串；主按钮「显不显示」仍由各域的 *ActionOf 决定，
// 后端始终是最终裁决。
import type { MarketListingDetail, MyBidRow, NegotiationSession, OfferListItem } from '../../../lib/api.ts';

export interface Badge {
  label: string;
  cls: string;
}

/** 挂牌仍在转会流程内（含等匹配/待审核），可用于选出「当前单」 */
export function isActiveListing(status: string): boolean {
  return status === 'listed' || status === 'bidding' || status === 'matched_pending' || status === 'pending_review';
}

/**
 * 第一步（定新违约金）是否还没做完（v6.67.0）。
 * 常规 = `releaseFee === null`；强制拍卖放开后还会遇到「RC 已预填、但预期工资未确认」的在途单
 * （数据库里 `release_fee` 留着当预填值、`expected_wage` 清空），这类同样要回到第一步。
 */
export function needsReleaseFee(s: NegotiationSession): boolean {
  return s.releaseFee === null || (s.transfer.type === 'forced_auction' && s.expectedWage === null);
}

export function bidBadge(b: MyBidRow): Badge {
  if (b.status === 'won' && b.listingStatus === 'pending_review') return { label: '待审核', cls: 'purple' };
  if (b.status === 'active') return { label: '领先中', cls: 'sky' };
  if (b.status === 'superseded') {
    return isActiveListing(b.listingStatus)
      ? { label: '被超出', cls: 'gold' }
      : { label: '已结束 · 未中标', cls: 'gray' };
  }
  if (b.status === 'won') return { label: '已中标', cls: 'green' };
  if (b.status === 'withdrawn') return { label: '已撤回', cls: 'gray' };
  return { label: b.status, cls: 'gray' };
}

export function offerBadge(o: OfferListItem): Badge {
  if (o.status === 'pending' && o.myTurn) return { label: '待你回应', cls: 'gold' };
  if (o.status === 'pending') return { label: '等对方', cls: 'sky' };
  if (o.status === 'intent') return { label: '意向单·等开窗', cls: 'gold' };
  if (o.status === 'accepted') return { label: '已接受·挂牌竞价中', cls: 'green' };
  return { label: '已结束', cls: 'gray' };
}

export function negoBadge(s: NegotiationSession): Badge {
  if (s.status === 'active') {
    return needsReleaseFee(s)
      ? { label: '定违约金', cls: 'gold' }
      : { label: `工资谈判 · 剩 ${s.remaining} 轮`, cls: 'sky' };
  }
  if (s.status === 'settled') return { label: '已签约', cls: 'green' };
  return { label: '已作废', cls: 'gray' };
}

/** 挂牌状态文案（球员页状态条直接取，不另写一套） */
export function listingStatusText(status: string): string {
  if (status === 'listed' || status === 'bidding') return '挂牌中';
  if (status === 'pending_review') return '待审核';
  if (status === 'matched_pending') return '等匹配';
  if (status === 'delisted') return '已结束';
  return status;
}

/** 出价资格，口径与球员页 SideOps.tsx:554-560 一致；前端只决定「显不显示」，后端仍会复核 */
export function canBidOf(
  l: MarketListingDetail['listing'],
  marketBidPaused: boolean,
  myClubId: number | null,
): boolean {
  return (
    (l.status === 'listed' || l.status === 'bidding') &&
    (l.windowOpen || l.type === 'forced') &&
    !l.bidPaused &&
    !marketBidPaused &&
    !(l.firstBidPending && l.activatedBy !== myClubId)
  );
}
