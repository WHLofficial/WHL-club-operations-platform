// fitDotClass 边界逐点（TC-C-012）：三态阈值 85/50 是本仓定稿，与 tour 战术板四态（红橙黄绿）不同，
// 照抄 fitTileClass 即红。null（跨群 / 无数据）回灰——球员页展示行已过滤跨群，这是兜底分支。
import { describe, expect, it } from 'vitest';
import { FIT_DOT_GOOD, FIT_DOT_MID, fitDotClass } from './dot.ts';

describe('fitDotClass：fit 卡色点三态（绿 ≥85 / 黄 ≥50 / 灰 ＜50）', () => {
  it('边界逐点：85 绿 / 84 黄 / 50 黄 / 49 灰 / 0 灰 / 99 绿 / null 灰', () => {
    expect(fitDotClass(85)).toBe('fit-dot fit-dot-good');
    expect(fitDotClass(84)).toBe('fit-dot fit-dot-mid');
    expect(fitDotClass(50)).toBe('fit-dot fit-dot-mid');
    expect(fitDotClass(49)).toBe('fit-dot fit-dot-low');
    expect(fitDotClass(0)).toBe('fit-dot fit-dot-low');
    expect(fitDotClass(99)).toBe('fit-dot fit-dot-good');
    expect(fitDotClass(null)).toBe('fit-dot fit-dot-low');
  });

  it('阈值常量即定稿口径（绿 85 / 黄 50）', () => {
    expect(FIT_DOT_GOOD).toBe(85);
    expect(FIT_DOT_MID).toBe(50);
  });
});
