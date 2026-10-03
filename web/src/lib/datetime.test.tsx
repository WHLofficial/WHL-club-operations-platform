// @vitest-environment jsdom
// v6.25.0：显示时区偏好层的口径测试（docs/test-plans/v6.25.0-timezone-display.md TC-A 组）。
// 核心断言都钉在两个确定档（北京 / UTC）上；system 档 CI 时区不定，只烟测不串具体值。
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { fmtDate, fmtDateTime, fmtTime, getTzPref, setTzPref, tzLabel, useTzPref } from './datetime.ts';

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
