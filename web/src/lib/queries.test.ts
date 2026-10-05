// @vitest-environment jsdom
// v6.34.0 评审 P1-1：详情查询键必须统一 String 归一——详情页 useParams 是 string、
// 对比页传 fc_id 可能是 number；键不一致会「同 id 两份缓存、跨页重复请求」。
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api.ts', () => ({
  api: vi.fn(async () => ({ player: { id: 7 } })),
}));

import { api } from './api.ts';
import { qk, usePlayerDetail } from './queries.ts';

const apiMock = vi.mocked(api);

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

describe('usePlayerDetail 缓存键归一', () => {
  beforeEach(() => {
    apiMock.mockClear();
  });

  it('qk.player 键形为 [player, id]', () => {
    expect(qk.player('7')).toEqual(['player', '7']);
  });

  it('number 与 string 同 id 共用同一份缓存，只发一次请求', async () => {
    // staleTime 拉满：否则第二次挂载会按 stale 重取，测不出「键是否同一份缓存」
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const first = renderHook(() => usePlayerDetail(7), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => usePlayerDetail('7'), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/api/players/7');
    expect(client.getQueryData(qk.player('7'))).toBeTruthy();
  });

  it('id 缺省/null/空串不发请求，且键落空串槽', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const id of [undefined, null, '']) {
      renderHook(() => usePlayerDetail(id), { wrapper: wrapper(client) });
    }
    await Promise.resolve();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
