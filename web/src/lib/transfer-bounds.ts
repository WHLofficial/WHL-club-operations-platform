// 转会价格区间的前端口径（v6.54.1）：直接派生自 src/core 的同名规则——上限取
// minOfferPriceBounds 的 max（⌊1.5×违约金⌋，OFFER_CAP_RC 注释写明与挂牌上限同源）、
// 下限取 listingPriceBounds 的 min（max(1, ⌈min(0.5×违约金, 0.5×身价)⌉)）。
// 服务端是唯一真源（越界仍会 400），这里只给侧栏的区间提示；core 是单一出处，不在此复制公式。
import { listingPriceBounds } from '../../../src/core/market-rules.ts';
import { minOfferPriceBounds } from '../../../src/core/offer-rules.ts';

export function offerCapOf(releaseFee: number | null): number | null {
  return minOfferPriceBounds(releaseFee)?.max ?? null;
}

export function listingFloorOf(releaseFee: number | null, marketValue: number | null): number | null {
  // listingPriceBounds 只收 number（market-rules 口径）：违约金非法在这里先挡，
  // 与 offers.ts 的调用点同款守卫
  if (releaseFee === null || !Number.isFinite(releaseFee) || releaseFee <= 0) return null;
  return listingPriceBounds(releaseFee, marketValue)?.min ?? null;
}
