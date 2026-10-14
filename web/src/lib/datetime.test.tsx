// @vitest-environment jsdom
// v6.25.0：显示时区偏好层的口径测试（docs/test-plans/v6.25.0-timezone-display.md TC-A 组）。
// 核心断言都钉在两个确定档（北京 / UTC）上；system 档 CI 时区不定，只烟测不串具体值。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { fmtAgo, fmtDate, fmtDateTime, fmtDayLabel, fmtTime, getTzPref, setTzPref, tzLabel, useTimeFmt, useTzPref, utcIsoToZhWall, zhWallToUtcIso, zoneOffsetMs } from './datetime.ts';

afterEach(() => {
  localStorage.clear();
  cleanup();
});

describe('fmtDateTime（TC-A02/A03 确定性格式）', () => {
  it('默认档 = 北京时间：UTC 13:00 → 21:00，短横线格式', () => {
    expect(getTzPref()).toBe('asia/shanghai');
    expect(fmtDateTime('2026-10-03T13:00:00Z')).toBe('2026-10-03 21:00');
  });

  it('utc 档 = 原样钟面', () => {
    setTzPref('utc');
    expect(fmtDateTime('2026-10-03T13:00:00Z')).toBe('2026-10-03 13:00');
  });

  it('TC-A10 跨日进位：23:59 与次日 00:01 边界不串日', () => {
    expect(fmtDateTime('2026-10-03T15:59:00Z')).toBe('2026-10-03 23:59');
    expect(fmtDateTime('2026-10-03T16:01:00Z')).toBe('2026-10-04 00:01');
  });

  it('fmtTime / fmtDate 口径', () => {
    setTzPref('utc');
    expect(fmtTime('2026-10-03T13:05:00Z')).toBe('10-03 13:05');
    expect(fmtDate('2026-10-03T13:05:00Z')).toBe('2026-10-03');
  });

  it('TC-A04 非法与空输入统一回 —（不许抛错或回原串）', () => {
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime(undefined)).toBe('—');
    expect(fmtDateTime('')).toBe('—');
    expect(fmtDateTime('not-a-date')).toBe('—');
    expect(fmtTime('not-a-date')).toBe('—');
    expect(fmtDate(null)).toBe('—');
  });
});

describe('偏好持久化与事件同步（TC-A05/A06）', () => {
  it('setTzPref 写 localStorage，非法存量值回落默认北京', () => {
    setTzPref('utc');
    expect(localStorage.getItem('whl.tz')).toBe('utc');
    localStorage.setItem('whl.tz', 'hacker');
    expect(getTzPref()).toBe('asia/shanghai');
  });

  function Probe() {
    const pref = useTzPref();
    return <span data-testid="pref">{pref}</span>;
  }

  it('本页 setTzPref → whl:tz-change → 订阅组件即时重渲染', () => {
    render(<Probe />);
    expect(screen.getByTestId('pref').textContent).toBe('asia/shanghai');
    act(() => {
      setTzPref('utc');
    });
    expect(screen.getByTestId('pref').textContent).toBe('utc');
  });

  it('跨标签页 storage 事件同样驱动重渲染', () => {
    render(<Probe />);
    act(() => {
      localStorage.setItem('whl.tz', 'utc');
      window.dispatchEvent(new StorageEvent('storage', { key: 'whl.tz' }));
    });
    expect(screen.getByTestId('pref').textContent).toBe('utc');
  });
});

describe('system 档（TC-A07 烟测，不串具体钟面）', () => {
  it('合法值、不等于空串占位', () => {
    setTzPref('system');
    expect(getTzPref()).toBe('system');
    expect(tzLabel('system')).toBe('本机时区');
    const out = fmtDateTime('2026-10-03T13:00:00Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(out).not.toBe('—');
  });
});

// v6.31.0 广告板卡脚「挂出 今天 / 昨天 / N 天前」的语义（TC-ADB-38）：
// 相对时间同样走显示时区（换偏好即换结果），且不许页面自己算。
describe('fmtAgo（v6.31.0 相对日期）', () => {
  const NOW = new Date('2026-10-05T04:00:00Z'); // 北京 2026-10-05 12:00 / UTC 2026-10-05 04:00

  function withNow<T>(fn: () => T): T {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      return fn();
    } finally {
      vi.useRealTimers();
    }
  }

  it('按显示时区的日历日算差：今天 / 昨天 / N 天前（不是按 24 小时差）', () => {
    setTzPref('asia/shanghai');
    withNow(() => {
      expect(fmtAgo('2026-10-05T02:00:00Z')).toBe('今天');
      // 北京日历日仍是 10-05（UTC 还停在 10-04）：按 24 小时差算会错判成「昨天」
      expect(fmtAgo('2026-10-04T17:00:00Z')).toBe('今天');
      expect(fmtAgo('2026-10-04T02:00:00Z')).toBe('昨天');
      expect(fmtAgo('2026-10-01T02:00:00Z')).toBe('4 天前');
    });
  });

  it('换显示时区，同一时刻的「几天前」跟着换', () => {
    setTzPref('utc');
    withNow(() => {
      expect(fmtAgo('2026-10-04T17:00:00Z')).toBe('昨天'); // UTC 钟面下就是昨天
    });
  });

  it('缺失 / 非法 / 未来时刻：— / — / 今天（不出负数天）', () => {
    withNow(() => {
      expect(fmtAgo(null)).toBe('—');
      expect(fmtAgo(undefined)).toBe('—');
      expect(fmtAgo('')).toBe('—');
      expect(fmtAgo('not-a-date')).toBe('—');
      expect(fmtAgo('2026-10-06T02:00:00Z')).toBe('今天');
    });
  });

  it('useTimeFmt().ago 与 fmtAgo 同源（页面不许自算相对时间）', () => {
    function Probe() {
      const t = useTimeFmt();
      return <span data-testid="ago">{t.ago('2026-10-04T02:00:00Z')}</span>;
    }
    withNow(() => {
      render(<Probe />);
      expect(screen.getByTestId('ago').textContent).toBe('昨天');
    });
    cleanup();
  });
});

// v6.40.0 收件篮日期分组：「今天 / 昨天 / YYYY-MM-DD」三档，日历日口径与 fmtAgo 同源
describe('fmtDayLabel（v6.40.0 分组标签）', () => {
  const NOW = new Date('2026-10-05T04:00:00Z'); // 北京 2026-10-05 12:00

  function withNow<T>(fn: () => T): T {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      return fn();
    } finally {
      vi.useRealTimers();
    }
  }

  it('今天 / 昨天 / 更早给 YYYY-MM-DD（按显示时区的日历日）', () => {
    setTzPref('asia/shanghai');
    withNow(() => {
      expect(fmtDayLabel('2026-10-05T02:00:00Z')).toBe('今天');
      expect(fmtDayLabel('2026-10-04T17:00:00Z')).toBe('今天'); // 北京日历日仍是 10-05
      expect(fmtDayLabel('2026-10-04T02:00:00Z')).toBe('昨天');
      expect(fmtDayLabel('2026-09-30T02:00:00Z')).toBe('2026-09-30');
      expect(fmtDayLabel('2026-08-01T02:00:00Z')).toBe('2026-08-01');
    });
  });

  it('换显示时区，同一时刻的标签跟着换；缺失 / 非法 ⇒ —', () => {
    setTzPref('utc');
    withNow(() => {
      expect(fmtDayLabel('2026-10-04T17:00:00Z')).toBe('昨天'); // UTC 钟面下就是昨天
      expect(fmtDayLabel('2026-10-02T17:00:00Z')).toBe('2026-10-02');
    });
    expect(fmtDayLabel(null)).toBe('—');
    expect(fmtDayLabel('not-a-date')).toBe('—');
  });

  it('useTimeFmt().dayLabel 同源（页面分组文案走 hook）', () => {
    function Probe() {
      const t = useTimeFmt();
      return <span data-testid="day">{t.dayLabel('2026-10-04T02:00:00Z')}</span>;
    }
    withNow(() => {
      render(<Probe />);
      expect(screen.getByTestId('day').textContent).toBe('昨天');
    });
    cleanup();
  });
});

// v6.49.0 运营时刻表：北京时间墙钟 ↔ UTC（表单填写口径，与显示偏好无关）
describe('zhWallToUtcIso / utcIsoToZhWall（时刻表表单）', () => {
  it('北京时间 20:00 → UTC 12:00；反向回到同一墙钟串', () => {
    expect(zhWallToUtcIso('2026-07-05T20:00')).toBe('2026-07-05T12:00:00.000Z');
    expect(utcIsoToZhWall('2026-07-05T12:00:00.000Z')).toBe('2026-07-05T20:00');
  });

  it('跨日进位：北京 00:30 → 前一 UTC 日 16:30', () => {
    expect(zhWallToUtcIso('2026-07-05T00:30')).toBe('2026-07-04T16:30:00.000Z');
    expect(utcIsoToZhWall('2026-07-04T16:30:00.000Z')).toBe('2026-07-05T00:30');
  });

  it('带秒的墙钟串也认（秒原样保留）', () => {
    expect(zhWallToUtcIso('2026-07-05T20:00:30')).toBe('2026-07-05T12:00:30.000Z');
  });

  it('口径与显示偏好无关：切 UTC 档后同一墙钟串仍按北京时间解释', () => {
    setTzPref('utc');
    expect(zhWallToUtcIso('2026-07-05T20:00')).toBe('2026-07-05T12:00:00.000Z');
    expect(utcIsoToZhWall('2026-07-05T12:00:00.000Z')).toBe('2026-07-05T20:00');
  });

  it('非法输入 ⇒ null / 空串（含被 Date 归一化的 2 月 30 日）', () => {
    expect(zhWallToUtcIso('2026-02-30T10:00')).toBeNull();
    expect(zhWallToUtcIso('2026-13-01T10:00')).toBeNull();
    expect(zhWallToUtcIso('2026-07-05T24:00')).toBeNull();
    expect(zhWallToUtcIso('2026-07-05')).toBeNull();
    expect(zhWallToUtcIso('')).toBeNull();
    expect(zhWallToUtcIso(null)).toBeNull();
    expect(utcIsoToZhWall(null)).toBe('');
    expect(utcIsoToZhWall('nope')).toBe('');
  });

  it('zoneOffsetMs：北京 +8h、UTC 0；午夜边界不串（日刻度对齐的真源）', () => {
    const t = Date.parse('2026-07-05T13:37:00Z');
    expect(zoneOffsetMs(t)).toBe(8 * 3600_000);
    setTzPref('utc');
    expect(zoneOffsetMs(t)).toBe(0);
  });
});
