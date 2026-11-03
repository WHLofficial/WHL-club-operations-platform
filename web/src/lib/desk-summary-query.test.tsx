// @vitest-environment jsdom
// v6.73.0 期 B：useDeskSummary 的刷新口径——教练启用、60s 轮询、同键只发一份。
// 角标/红点/页签数字共用这一个 hook；轮询停了角标就会一直停在旧值，所以这里钉死间隔。
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('./api.ts', () => ({ api: apiMock, apiPost: vi.fn() }));

import { qk, useDeskSummary } from './queries.ts';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => apiMock.mockReset());
afterEach(() => vi.useRealTimers());

describe('useDeskSummary（v6.73.0 期 B）', () => {
  it('enabled=false（匿名/观众）不发请求', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useDeskSummary(false), { wrapper: wrapper(client) });
    await Promise.resolve();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('命中 /api/market/desk/summary，60s 后自动再拉一次', async () => {
    vi.useFakeTimers();
    apiMock.mockResolvedValue({ negotiations: 1, offers: 2, bids: 0, total: 3 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useDeskSummary(true), { wrapper: wrapper(client) });

    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledWith('/api/market/desk/summary');

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
  });

  it('query key 固定为 [market, desk, summary]（顶栏/子导航/桌内共缓存）', () => {
    expect(qk.deskSummary).toEqual(['market', 'desk', 'summary']);
  });
});
