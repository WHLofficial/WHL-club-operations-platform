// 市场参数装配（§13 config 键 → 市场引擎上下文），与 squad-context 同范式：缺省回退注册表默认值。
import { createConfigService } from '../core/config.ts';
import { parseTradeCalendar, type TradeCalendar } from '../core/market-rules.ts';

export interface MarketContext {
  floorRc: number;
  floorValue: number;
  capRc: number;
  bidStepMin: number;
  delistFeeRate: number;
  deadlineHours: [number, number];
  silenceHours: number;
  calendar: TradeCalendar;
  taxRates: { r1: number; r2: number; r3: number };
  auctionTaxRate: number;
  activationWindowMin: number;
}

function num(v: number | null, fallback: number): number {
  return Number.isFinite(v) ? (v as number) : fallback;
}

export async function loadMarketContext(db: D1Database): Promise<MarketContext> {
  const config = createConfigService(db);
  const [floorCoefs, capCoef, bidStep, delistRate, deadline, silence, calendarRaw, taxRatesRaw, auctionRate, activationMin] = await Promise.all([
    config.getNumberList('listing_floor_coefs'),
    config.getNumber('listing_cap_coef'),
    config.getNumber('bid_step_min'),
    config.getNumber('delist_fee_rate'),
    config.getNumberList('deadline_hours'),
    config.getNumber('silence_hours'),
    config.get('trade_calendar'),
    config.getNumberList('tax_rates'),
    config.getNumber('auction_tax_rate'),
    config.getNumber('activation_window_min'),
  ]);
  const rates = taxRatesRaw && taxRatesRaw.length === 3 ? taxRatesRaw : [0.1, 0.2, 0.4];
  return {
    floorRc: num(floorCoefs?.[0] ?? null, 0.5),
    floorValue: num(floorCoefs?.[1] ?? null, 0.5),
    capRc: num(capCoef, 1.5),
    bidStepMin: num(bidStep, 1),
    delistFeeRate: num(delistRate, 0.1),
    deadlineHours: [
      Math.trunc(num(deadline?.[0] ?? null, 18)),
      Math.trunc(num(deadline?.[1] ?? null, 23)),
    ] as [number, number],
    silenceHours: num(silence, 3),
    calendar: parseTradeCalendar(calendarRaw),
    taxRates: { r1: rates[0], r2: rates[1], r3: rates[2] },
    auctionTaxRate: num(auctionRate, 0.5),
    activationWindowMin: num(activationMin, 5),
  };
}
