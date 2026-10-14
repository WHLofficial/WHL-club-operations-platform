// 甘特图几何纯函数（web/src/lib/gantt.ts）单测：刻度粒度、对齐、可视范围、条几何四组。
// 时刻表的值本身在 tests/ops-schedule.test.ts 锁；这里只锁「怎么画」。
import { describe, expect, it } from 'vitest';
import { GANTT_EMPTY_SPAN_MS, GANTT_PAD_MS, alignFloor, fracOf, ganttRange, minorStepOf, nowFrac, pickTickStep, rowBar, ticksIn } from './gantt.ts';

const H = 3600_000;
const DAY = 24 * H;
const ZH = 8 * H; // 北京时间偏移（对齐用）
const iso = (ms: number) => new Date(ms).toISOString();

describe('pickTickStep / minorStepOf（刻度粒度）', () => {
  it('四档边界：≤6h 每小时 / ≤48h 每 6h / ≤14d 每天 / 更长每周', () => {
    expect(pickTickStep(1 * H)).toEqual({ stepMs: H, kind: 'time' });
    expect(pickTickStep(6 * H)).toEqual({ stepMs: H, kind: 'time' });
    expect(pickTickStep(6 * H + 1)).toEqual({ stepMs: 6 * H, kind: 'time' });
    expect(pickTickStep(48 * H)).toEqual({ stepMs: 6 * H, kind: 'time' });
    expect(pickTickStep(48 * H + 1)).toEqual({ stepMs: DAY, kind: 'day' });
    expect(pickTickStep(14 * DAY)).toEqual({ stepMs: DAY, kind: 'day' });
    expect(pickTickStep(14 * DAY + 1)).toEqual({ stepMs: 7 * DAY, kind: 'week' });
  });

  it('次刻度只在 6h 档出现（每小时一条细线）；1h/天/周档没有次刻度', () => {
    expect(minorStepOf({ stepMs: 6 * H, kind: 'time' })).toBe(H);
    expect(minorStepOf({ stepMs: H, kind: 'time' })).toBeNull();
    expect(minorStepOf({ stepMs: DAY, kind: 'day' })).toBeNull();
    expect(minorStepOf({ stepMs: 7 * DAY, kind: 'week' })).toBeNull();
  });
});

describe('alignFloor / ticksIn（对齐到显示时区）', () => {
  it('日刻度落在北京午夜：UTC 前一日 16:00 = 北京 00:00', () => {
    const t = Date.parse('2026-07-05T13:37:00Z');
    const dayStart = alignFloor(t, DAY, ZH);
    expect(iso(dayStart)).toBe('2026-07-04T16:00:00.000Z');
  });

  it('UTC 档（offset 0）日刻度落在 UTC 午夜', () => {
    const t = Date.parse('2026-07-05T13:37:00Z');
    expect(iso(alignFloor(t, DAY, 0))).toBe('2026-07-05T00:00:00.000Z');
  });

  it('ticksIn 含区间内所有对齐点，且不越界（起止各自向内取）', () => {
    const from = Date.parse('2026-07-05T00:30:00Z');
    const to = Date.parse('2026-07-05T05:30:00Z');
    const ticks = ticksIn(from, to, H, 0).map(iso);
    expect(ticks).toEqual([
      '2026-07-05T01:00:00.000Z',
      '2026-07-05T02:00:00.000Z',
      '2026-07-05T03:00:00.000Z',
      '2026-07-05T04:00:00.000Z',
      '2026-07-05T05:00:00.000Z',
    ]);
  });

  it('区间比一个步长还短 ⇒ 没有刻度（不硬塞一条假的）', () => {
    expect(ticksIn(Date.parse('2026-07-05T00:10:00Z'), Date.parse('2026-07-05T00:20:00Z'), H, 0)).toEqual([]);
  });

  it('倒置区间返回空数组（不抛）', () => {
    expect(ticksIn(1000, 0, H, 0)).toEqual([]);
  });
});

describe('ganttRange（可视范围）', () => {
  it('取 min(窗口 openedAt, 各行起止, now) − 1h 到 max(...) + 1h', () => {
    const now = Date.parse('2026-07-05T12:00:00Z');
    const range = ganttRange({
      now,
      windowOpenedAt: '2026-07-05T04:00:00Z',
      rows: [{ resolvedStartAt: '2026-07-05T04:00:00Z', resolvedEndAt: '2026-07-08T12:00:00Z' }],
    });
    expect(iso(range.from)).toBe('2026-07-05T03:00:00.000Z');
    expect(iso(range.to)).toBe('2026-07-08T13:00:00.000Z');
  });

  it('行上没有任何时间点（窗口已关）⇒ now ± 24h', () => {
    const now = Date.parse('2026-07-05T12:00:00Z');
    const range = ganttRange({ now, windowOpenedAt: null, rows: [{ resolvedStartAt: null, resolvedEndAt: null }] });
    expect(range.to - range.from).toBe(GANTT_EMPTY_SPAN_MS * 2);
    expect(iso(range.from)).toBe('2026-07-04T12:00:00.000Z');
    expect(iso(range.to)).toBe('2026-07-06T12:00:00.000Z');
  });

  it('所有点都贴在 now 上 ⇒ 至少留 2h 窗（两侧 1h）', () => {
    const now = Date.parse('2026-07-05T12:00:00Z');
    const range = ganttRange({ now, windowOpenedAt: null, rows: [{ resolvedStartAt: null, resolvedEndAt: null }] });
    expect(range.to - range.from).toBeGreaterThanOrEqual(GANTT_PAD_MS * 2);
  });

  it('坏 ISO 被忽略（不把 NaN 带进范围）', () => {
    const now = Date.parse('2026-07-05T12:00:00Z');
    const range = ganttRange({
      now,
      windowOpenedAt: 'not-a-date',
      rows: [{ resolvedStartAt: 'nope', resolvedEndAt: '2026-07-05T13:00:00Z' }],
    });
    expect(Number.isFinite(range.from)).toBe(true);
    expect(iso(range.to)).toBe('2026-07-05T14:00:00.000Z');
  });
});

describe('fracOf / nowFrac（归一化与钳制）', () => {
  const range = { from: Date.parse('2026-07-05T00:00:00Z'), to: Date.parse('2026-07-05T10:00:00Z') };

  it('中点 0.5，左缘 0，右缘 1', () => {
    expect(fracOf(Date.parse('2026-07-05T05:00:00Z'), range)).toBe(0.5);
    expect(fracOf(range.from, range)).toBe(0);
    expect(fracOf(range.to, range)).toBe(1);
  });

  it('越界钳制到 0 / 1（条不会画到框外）', () => {
    expect(fracOf(range.from - 5 * H, range)).toBe(0);
    expect(fracOf(range.to + 5 * H, range)).toBe(1);
  });

  it('空范围（from = to）返回 0，不产生 NaN', () => {
    expect(fracOf(123, { from: 100, to: 100 })).toBe(0);
  });

  it('nowFrac 就是 fracOf(now)', () => {
    const now = Date.parse('2026-07-05T07:30:00Z');
    expect(nowFrac(range, now)).toBe(fracOf(now, range));
  });
});

describe('rowBar（一行 → 条几何）', () => {
  const range = { from: Date.parse('2026-07-05T00:00:00Z'), to: Date.parse('2026-07-05T10:00:00Z') };
  const row = (over: Partial<Parameters<typeof rowBar>[0]> = {}) => ({
    startAnchor: 'absolute',
    endAnchor: 'absolute',
    resolvedStartAt: '2026-07-05T02:00:00Z',
    resolvedEndAt: '2026-07-05T06:00:00Z',
    endIsWindowClose: false,
    ...over,
  });

  it('两端具体时间 ⇒ 实条 0.2–0.6，不开放式', () => {
    expect(rowBar(row(), range)).toEqual({ kind: 'bar', left: 0.2, right: 0.6, openEnded: false });
  });

  it('两端都不限制 ⇒ none（满宽斜纹）', () => {
    expect(rowBar(row({ startAnchor: 'none', endAnchor: 'none', resolvedStartAt: null, resolvedEndAt: null }), range)).toEqual({ kind: 'none' });
  });

  it('随关窗止（终点动态）⇒ 条到右缘 + openEnded', () => {
    const bar = rowBar(
      row({ startAnchor: 'window_open', endAnchor: 'window_close', resolvedStartAt: '2026-07-05T01:00:00Z', resolvedEndAt: null, endIsWindowClose: true }),
      range,
    );
    expect(bar).toEqual({ kind: 'bar', left: 0.1, right: 1, openEnded: true });
  });

  it('只限起点（终点不限制）⇒ 条从起点到右缘 + openEnded', () => {
    const bar = rowBar(row({ endAnchor: 'none', resolvedEndAt: null }), range);
    expect(bar).toEqual({ kind: 'bar', left: 0.2, right: 1, openEnded: true });
  });

  it('起点不限制但终点有具体时间 ⇒ 条从左缘起（一直可用，到点结束）', () => {
    const bar = rowBar(row({ startAnchor: 'none', resolvedStartAt: null }), range);
    expect(bar).toEqual({ kind: 'bar', left: 0, right: 0.6, openEnded: false });
  });

  it('随窗锚但窗口已关（两端都解析不出）⇒ window_closed 灰纹，不假装有时间', () => {
    const bar = rowBar(row({ startAnchor: 'window_open', endAnchor: 'window_close', resolvedStartAt: null, resolvedEndAt: null, endIsWindowClose: true }), range);
    expect(bar).toEqual({ kind: 'window_closed' });
  });

  it('终点早于起点（数据脏）⇒ 不产生负宽条，左右自动对调', () => {
    const bar = rowBar(row({ resolvedStartAt: '2026-07-05T08:00:00Z', resolvedEndAt: '2026-07-05T02:00:00Z' }), range);
    expect(bar).toEqual({ kind: 'bar', left: 0.2, right: 0.8, openEnded: false });
  });

  it('条端点越出可视范围 ⇒ 钳到 0 / 1（画满整行）', () => {
    const bar = rowBar(row({ resolvedStartAt: '2026-07-01T00:00:00Z', resolvedEndAt: '2026-07-09T00:00:00Z' }), range);
    expect(bar).toEqual({ kind: 'bar', left: 0, right: 1, openEnded: false });
  });
});
