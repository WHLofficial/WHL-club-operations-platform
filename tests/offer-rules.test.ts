// 报价规则纯函数测试（v6.54.1 起：minOfferPriceBounds 有了直接断言；此前只经路由层间接覆盖）
import { describe, expect, it } from 'vitest';
import { minOfferPriceBounds, validateOfferAmount } from '../src/core/offer-rules.ts';

describe('最低报价边界 minOfferPriceBounds', () => {
  it('区间 [1, ⌊1.5×RC⌋]：上限向下取整（v6.54.1），下限恒 1（私密拒线语义不动）', () => {
    expect(minOfferPriceBounds(50)).toEqual({ min: 1, max: 75 });
    expect(minOfferPriceBounds(33)).toEqual({ min: 1, max: 49 }); // 49.5→49
    expect(minOfferPriceBounds(33.3)).toEqual({ min: 1, max: 49 }); // 49.95→49
    expect(minOfferPriceBounds(1)).toEqual({ min: 1, max: 1 }); // 1.5→1
  });

  it('违约金缺失 / 非法返回 null', () => {
    expect(minOfferPriceBounds(null)).toBeNull();
    expect(minOfferPriceBounds(0)).toBeNull();
    expect(minOfferPriceBounds(Number.NaN)).toBeNull();
  });
});

describe('报价金额校验 validateOfferAmount（上限口径回归）', () => {
  it('整数报价 ≤ ⌊1.5×RC⌋ 恒成立，边界取整不收紧报价面', () => {
    expect(validateOfferAmount(75, 50)).toBeNull();
    expect(validateOfferAmount(76, 50)).toContain('不能超过');
    expect(validateOfferAmount(49, 33)).toBeNull(); // 真上限 49.5，整数报价最多 49
  });
});
