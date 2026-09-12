// 交易税（TECH_DESIGN §6.6）：分段累进，卖方付，基数成交价 P。
//   tax(P, RC) = min(P, RC)×r1 + max(0, min(P, 1.5RC) − RC)×r2 + max(0, P − 1.5RC)×r3
// 强制拍卖特例：整单一档税率（默认 50%）。税额销毁（回收），卖家净得 P − tax。

export interface TaxRates {
  r1: number;
  r2: number;
  r3: number;
}

export const DEFAULT_TAX_RATES: TaxRates = { r1: 0.1, r2: 0.2, r3: 0.4 };
export const DEFAULT_AUCTION_TAX_RATE = 0.5;

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function assertMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label}须为非负数值`);
}

export function transferTax(price: number, releaseFee: number, rates: TaxRates = DEFAULT_TAX_RATES): number {
  assertMoney(price, '成交价');
  assertMoney(releaseFee, '违约金');
  const band1 = Math.min(price, releaseFee) * rates.r1;
  const band2 = Math.max(0, Math.min(price, releaseFee * 1.5) - releaseFee) * rates.r2;
  const band3 = Math.max(0, price - releaseFee * 1.5) * rates.r3;
  return round2(band1 + band2 + band3);
}

export function auctionTax(price: number, rate: number = DEFAULT_AUCTION_TAX_RATE): number {
  assertMoney(price, '成交价');
  return round2(price * rate);
}
