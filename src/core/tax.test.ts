import { describe, expect, it } from 'vitest';
import { auctionTax, transferTax } from './tax.ts';

describe('transferTax 分段累进（§6.6）', () => {
  it('P=0 时税为 0', () => {
    expect(transferTax(0, 10)).toBe(0);
  });

  it('P ≤ RC 全段按第一档 10%', () => {
    expect(transferTax(7.5, 10)).toBe(0.75);
    expect(transferTax(10, 10)).toBe(1);
  });

  it('P=1.5RC 时第一档 + 第二档 20%', () => {
    expect(transferTax(15, 10)).toBe(2);
  });

  it('P > 1.5RC 时三段累加', () => {
    expect(transferTax(20, 10)).toBe(4);
    expect(transferTax(50, 30)).toBe(8);
  });

  it('P < RC 按实际成交价计', () => {
    expect(transferTax(3, 40)).toBe(0.3);
  });

  it('结果保留两位小数', () => {
    expect(transferTax(33.33, 30)).toBe(3.67);
  });

  it('税率可配置（§13 tax_rates）', () => {
    expect(transferTax(20, 10, { r1: 0.1, r2: 0.3, r3: 0.5 })).toBe(5);
  });

  it('非法输入拒绝', () => {
    expect(() => transferTax(-1, 10)).toThrow();
    expect(() => transferTax(10, -5)).toThrow();
    expect(() => transferTax(Number.NaN, 10)).toThrow();
    expect(() => transferTax(10, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('auctionTax 强制拍卖特例（§6.6）', () => {
  it('默认整单税率 50%', () => {
    expect(auctionTax(5)).toBe(2.5);
    expect(auctionTax(12.34)).toBe(6.17);
  });

  it('税率可配置（§13 auction_tax_rate）', () => {
    expect(auctionTax(10, 0.3)).toBe(3);
  });

  it('P=0 时税为 0，非法输入拒绝', () => {
    expect(auctionTax(0)).toBe(0);
    expect(() => auctionTax(-2)).toThrow();
  });
});
