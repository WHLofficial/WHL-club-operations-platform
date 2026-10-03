// @vitest-environment jsdom
// v6.24.0 批次 B：读秒 hook 的口径测试——TC-B01 单例 1Hz tick（首个订阅开表、最后一个退订停表）、
// TC-B02 锚点后只走 performance 单调时钟（本地校时回拨不跳变），外加 fmtClock 的显示口径。
// 单调时钟用 performance.now 的显式桩手动推进，不依赖 fake timers 对 performance 的支持。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { fmtClock, useCountdown } from './use-countdown.ts';

function Probe({ deadline, testId }: { deadline: string | null; testId: string }) {
  const remaining = useCountdown(deadline);
  return <span data-testid={testId}>{remaining === null ? 'null' : String(remaining)}</span>;
}

const DEADLINE = '2026-01-01T00:10:00.000Z';

/** 单调时钟读数（performance.now 的桩），测试手动推进 */
let mono = 0;

/** 推进 n 毫秒：先推单调时钟再走定时器（回调读的是推进后的读数） */
function tick(ms: number) {
  mono += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  mono = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => mono);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCountdown（TC-B01 单例 tick）', () => {
  it('多张卡共用一个 interval，最后一个退订时停表', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    const first = render(<Probe deadline={DEADLINE} testId="a" />);
    const second = render(<Probe deadline={DEADLINE} testId="b" />);
    // 两个订阅者只开一只表（长列表共用一个 1Hz tick）
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('a').textContent).toBe('600');
    expect(screen.getByTestId('b').textContent).toBe('600');

    tick(1000);
    expect(screen.getByTestId('a').textContent).toBe('599');
    expect(screen.getByTestId('b').textContent).toBe('599');

    first.unmount();
    expect(clearSpy).not.toHaveBeenCalled();
    second.unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('deadlineAt 为 null 时不订阅、值为 null', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    render(<Probe deadline={null} testId="n" />);
    expect(screen.getByTestId('n').textContent).toBe('null');
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe('useCountdown（TC-B02 校时回拨）', () => {
  it('系统时钟被回拨一小时后读秒照常递减，不跳变', () => {
    render(<Probe deadline={DEADLINE} testId="c" />);
    expect(screen.getByTestId('c').textContent).toBe('600');

    tick(5000);
    expect(screen.getByTestId('c').textContent).toBe('595');

    // 本地 Date 被校时回拨一小时——锚点后不再读本地 Date，读秒不受影响
    mono += 0;
    act(() => {
      vi.setSystemTime(new Date('2025-12-31T23:00:00.000Z'));
    });
    tick(1000);
    expect(screen.getByTestId('c').textContent).toBe('594');
  });

  it('到点后停在 0，不出现负数', () => {
    render(<Probe deadline="2026-01-01T00:00:02.000Z" testId="d" />);
    expect(screen.getByTestId('d').textContent).toBe('2');
    tick(5000);
    expect(screen.getByTestId('d').textContent).toBe('0');
  });
});

describe('fmtClock', () => {
  it('hh:mm:ss 补零，超 24 小时带天数前缀', () => {
    expect(fmtClock(0)).toBe('00:00:00');
    expect(fmtClock(59)).toBe('00:00:59');
    expect(fmtClock(3661)).toBe('01:01:01');
    expect(fmtClock(90061)).toBe('1天 01:01:01');
  });
});
