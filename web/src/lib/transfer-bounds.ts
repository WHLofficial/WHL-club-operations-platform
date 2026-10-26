// 转会价格区间的前端口径（v6.54.1）：与 src/core/market-rules.ts 的 listingPriceBounds、
// offer-rules.ts 的上限同规——下限 = max(1, ⌈min(0.5×违约金, 0.5×身价)⌉)、上限 = ⌊1.5×违约金⌋。
// 服务端是唯一真源（越界仍会 400），这里只给侧栏的区间提示；口径若变两处要一起动。
export function offerCapOf(releaseFee: number | null): number | null {
  return releaseFee !== null && Number.isFinite(releaseFee) && releaseFee > 0 ? Math.floor(releaseFee * 1.5) : null;
}

export function listingFloorOf(releaseFee: number | null, marketValue: number | null): number | null {
  if (releaseFee === null || !Number.isFinite(releaseFee) || releaseFee <= 0) return null;
  const floors = [releaseFee * 0.5];
  if (marketValue !== null && Number.isFinite(marketValue) && marketValue > 0) {
    floors.push(marketValue * 0.5);
  }
  return Math.max(1, Math.ceil(Math.min(...floors)));
}
