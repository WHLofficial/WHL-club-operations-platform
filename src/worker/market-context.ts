// 市场参数装配（§13 config 键 → 市场引擎上下文），与 squad-context 同范式：缺省回退注册表默认值。
// v6.65.0：11 个键从逐键 SELECT 合成一条 `key IN (…)` 查询——生产 listings 端点 TTFB 实测 12–16s，
// 真凶在结算的逐行 note UPDATE（见 market-settle.ts），这里顺带把冷 isolate 的 11 趟 config 往返砍成 1 趟；
// 所有市场读写端点（含结算）共用本装配。
import { createConfigService, parseNumberListValue, parseNumberValue, type ConfigKey } from '../core/config.ts';
import { parseTradeCalendar, type TradeCalendar } from '../core/market-rules.ts';

// 装配面键单；trade_calendar 走原值字符串（parseTradeCalendar 自行解析），不进 JSON 解析
const CONTEXT_KEYS = [
  'listing_floor_coefs',
  'listing_cap_coef',
  'bid_step_min',
  'delist_fee_rate',
  'deadline_hours',
  'silence_hours',
  'trade_calendar',
  'tax_rates',
  'auction_tax_rate',
  'activation_window_min',
  'match_window_hours',
] as const satisfies readonly ConfigKey[];

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
  matchWindowHours: number;
}

function num(v: number | null, fallback: number): number {
  return Number.isFinite(v) ? (v as number) : fallback;
}

export async function loadMarketContext(db: D1Database): Promise<MarketContext> {
  const raw = await createConfigService(db).getMany(CONTEXT_KEYS);
  const floorCoefs = parseNumberListValue('listing_floor_coefs', raw.listing_floor_coefs ?? null);
  const capCoef = parseNumberValue('listing_cap_coef', raw.listing_cap_coef ?? null);
  const bidStep = parseNumberValue('bid_step_min', raw.bid_step_min ?? null);
  const delistRate = parseNumberValue('delist_fee_rate', raw.delist_fee_rate ?? null);
  const deadline = parseNumberListValue('deadline_hours', raw.deadline_hours ?? null);
  const silence = parseNumberValue('silence_hours', raw.silence_hours ?? null);
  const calendarRaw = raw.trade_calendar ?? null;
  const taxRatesRaw = parseNumberListValue('tax_rates', raw.tax_rates ?? null);
  const auctionRate = parseNumberValue('auction_tax_rate', raw.auction_tax_rate ?? null);
  const activationMin = parseNumberValue('activation_window_min', raw.activation_window_min ?? null);
  const matchHours = parseNumberValue('match_window_hours', raw.match_window_hours ?? null);
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
    matchWindowHours: num(matchHours, 24),
  };
}
