// 转会价格区间前端口径（web/src/lib/transfer-bounds.ts）单测：
// 与 src/core/market-rules.ts 的 listingPriceBounds、offer-rules.ts 的上限取整同规（v6.54.1）。
import { describe, expect, it } from 'vitest';
import { listingFloorOf, offerCapOf } from './transfer-bounds.ts';

describe('offerCapOf（报价/标价上限 = ⌊1.5×违约金⌋）', () => {
  it('小数向下取整，整数不变', () => {
    expect(offerCapOf(33)).toBe(49); // 49.5→49
    expect(offerCapOf(33.3)).toBe(49); // 49.95→49
    expect(offerCapOf(50)).toBe(75);
  });

  it('违约金缺失 / 非法回 null（侧栏显示 —）', () => {
    expect(offerCapOf(null)).toBeNull();
    expect(offerCapOf(0)).toBeNull();
    expect(offerCapOf(-5)).toBeNull();
    expect(offerCapOf(Number.NaN)).toBeNull();
  });
});

describe('listingFloorOf（标价/挂牌下限 = max(1, ⌈min(0.5×违约金, 0.5×身价)⌉)）', () => {
  it('违约金/身价五折取低后向上取整；身价缺失只用违约金项', () => {
    expect(listingFloorOf(33, null)).toBe(17); // 16.5→17
    expect(listingFloorOf(33, 95)).toBe(17); // min(16.5, 47.5)=16.5→17
    expect(listingFloorOf(33, 30)).toBe(15); // min(16.5, 15)=15，整数 ceil 不动
    expect(listingFloorOf(50, null)).toBe(25);
  });

  it('五折被 1m 绝对下限顶起', () => {
    expect(listingFloorOf(1, 100)).toBe(1);
  });

  it('违约金缺失 / 非法回 null（侧栏显示 —）', () => {
    expect(listingFloorOf(null, 100)).toBeNull();
    expect(listingFloorOf(0, null)).toBeNull();
    expect(listingFloorOf(Number.NaN, null)).toBeNull();
  });
});
