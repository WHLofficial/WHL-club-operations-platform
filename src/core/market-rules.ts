// 转会市场规则纯函数（规则 4.4.1/4.4.7/4.4.8，TECH_DESIGN §6.5/§6.6）：
// 挂牌价边界、出价步长、截止惰性判定（18-23 点静默 + 交易日历顺延）、下架费。
// 时区固定 Asia/Shanghai（无夏令时）；所有金额单位 m，保留两位。

export const LISTING_ABSOLUTE_FLOOR = 1;

export interface ListingPriceBounds {
  min: number;
  max: number;
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// 挂牌价（4.4.1.1）：≥1m；下限 = min(0.5×违约金, 0.5×身价)；上限 = 1.5×违约金。
// 身价缺失时下限只用违约金项；下限 > 上限（违约金过低）返回 null，挂牌不可行。
export function listingPriceBounds(
  releaseFee: number,
  marketValue: number | null,
  coefs: { floorRc: number; floorValue: number; capRc: number } = { floorRc: 0.5, floorValue: 0.5, capRc: 1.5 },
): ListingPriceBounds | null {
  if (!Number.isFinite(releaseFee) || releaseFee <= 0) return null;
  const floors = [releaseFee * coefs.floorRc];
  if (marketValue !== null && Number.isFinite(marketValue) && marketValue > 0) {
    floors.push(marketValue * coefs.floorValue);
  }
  const min = Math.max(LISTING_ABSOLUTE_FLOOR, round2(Math.min(...floors)));
  const max = round2(releaseFee * coefs.capRc);
  if (min > max) return null;
  return { min, max };
}

// 出价校验（4.4.1.2）：首笔 ≥ 挂牌价（4.4.7 无人接价即流拍，低于挂牌价的出价会强迫卖家贱卖，
// 所以首价以挂牌价为底）；抬价 ≥ 当前最高 + 最小步长。返回可读错误，null = 通过。
export function validateBidAmount(
  amount: number,
  highestActive: number | null,
  askPrice: number,
  stepMin = 1,
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return '出价金额不对';
  if (highestActive === null) {
    if (amount < askPrice) return `首笔出价不得低于挂牌价 ${round2(askPrice)} m`;
    return null;
  }
  if (amount < round2(highestActive + stepMin)) {
    return `抬价至少要比当前最高价多 ${round2(stepMin)} m（当前最高 ${round2(highestActive)} m）`;
  }
  return null;
}

export type TradeCalendar = 'none' | { holidays: string[] };

// 交易日（§15-1 假设）：'none' = 全部自然日；json 节假日表 = 表内日期不开窗
export function isTradingDay(dateStr: string, calendar: TradeCalendar): boolean {
  if (calendar === 'none') return true;
  return !calendar.holidays.includes(dateStr);
}

const TZ_MS = 8 * 3600_000;

// 某时刻的上海日历日（YYYY-MM-DD）
export function shanghaiDateStr(ms: number): string {
  return new Date(ms + TZ_MS).toISOString().slice(0, 10);
}

function parseDayMs(dateStr: string): number {
  return Date.parse(`${dateStr}T12:00:00+00:00`);
}

function dayWindowMs(dateStr: string, hour: number): number {
  return Date.parse(`${dateStr}T${String(hour).padStart(2, '0')}:00:00+08:00`);
}

export interface BidDeadlineInput {
  lastBidAt: string | null;
  listedDay: string;
  now: Date;
  deadlineHours: [number, number];
  silenceHours: number;
  calendar: TradeCalendar;
}

export interface BidDeadlineResult {
  met: boolean;
  deadlineAt: string;
  deadlineDay: string;
}

// 截止判定（4.4.7）：挂牌次日起，在交易日 {start}:00-{end}:00 时段内找「自上一出价起
// 连续 silenceHours 小时无新出价」且整段落在时段内的最早时刻；落不下就顺延到下一交易日。
// 无人出价的挂牌不走本判定（等到窗尾按 4.4.7 下架），lastBidAt 为 null 时以挂牌时刻为静默起点。
export function bidDeadline(input: BidDeadlineInput): BidDeadlineResult {
  const [startHour, endHour] = input.deadlineHours;
  const lastBidMs = input.lastBidAt !== null ? Date.parse(input.lastBidAt) : Date.parse(`${input.listedDay}T00:00:00+08:00`);
  const baseDayMs = parseDayMs(input.listedDay);
  const nowMs = input.now.getTime();

  for (let offset = 1; offset <= 90; offset++) {
    const dayStr = shanghaiDateStr(baseDayMs + offset * 86_400_000);
    if (!isTradingDay(dayStr, input.calendar)) continue;
    const windowStart = dayWindowMs(dayStr, startHour);
    const windowEnd = dayWindowMs(dayStr, endHour);
    const blockStart = Math.max(lastBidMs, windowStart);
    const blockEnd = blockStart + input.silenceHours * 3600_000;
    if (blockEnd <= windowEnd) {
      return {
        met: nowMs >= blockEnd,
        deadlineAt: new Date(blockEnd).toISOString(),
        deadlineDay: dayStr,
      };
    }
  }
  // 交易日历 90 天内找不到可判定时段：视为永不截止，窗口收尾兜底
  const fallbackDay = shanghaiDateStr(baseDayMs + 90 * 86_400_000);
  return {
    met: false,
    deadlineAt: new Date(dayWindowMs(fallbackDay, endHour)).toISOString(),
    deadlineDay: fallbackDay,
  };
}

export function parseTradeCalendar(raw: string | null): TradeCalendar {
  if (raw === null || raw === 'none') return 'none';
  try {
    const parsed = JSON.parse(raw) as { holidays?: unknown };
    if (parsed && Array.isArray(parsed.holidays) && parsed.holidays.every((h) => typeof h === 'string')) {
      return { holidays: parsed.holidays };
    }
  } catch {
    // 非法配置回退自然日（沿 config defaults 纪律）
  }
  return 'none';
}

// 下架费（4.4.7）：挂牌价的 10%（费率可配置），窗口收尾无人出价时由挂牌方支付
export function delistFee(askPrice: number, rate = 0.1): number {
  if (!Number.isFinite(askPrice) || askPrice < 0) throw new RangeError('挂牌价须为非负数值');
  return round2(askPrice * rate);
}
