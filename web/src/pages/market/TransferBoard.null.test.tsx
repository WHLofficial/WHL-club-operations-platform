// @vitest-environment jsdom
// TC-B6-01（v6.82.0 测试计划 §5 B6② / §6.7 #6/#7，P1）：TransferBoardRow.ca / pa 契约可空化
// （players 列可空、端点 SQL 无 COALESCE，0001_init.sql:12-13；v6.64.2 clubName 同款白屏先例）
// 后的 R-WEB 行为锁——夹具造 ca/pa = NULL 行，看板行该格渲染「—」且不崩；非 null 行渲染数值
// 与色阶类名不变（防线只挡 null，不改变既有输出）。新增文件：不改任何既有测试（§4 零改动线），
// 驱动模式照搬同目录 MarketAdBoardPage.test.tsx。
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransferBoardResponse, TransferBoardRow } from '../../lib/api.ts';
import MarketAdBoardPage, { AdBoardTeaser } from './MarketAdBoardPage.tsx';

// 页面与 teaser 都从 lib/api.ts 取数据：一处 mock，其余请求拒绝（页面自有 catch 兜底）
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock };
});

function row(patch: Partial<TransferBoardRow> = {}): TransferBoardRow {
  return {
    id: 1,
    uid: 'p1',
    fcId: null,
    name: '缺档球员',
    positions: ['ST'],
    age: 24,
    ca: 94,
    pa: 95,
    clubId: 3,
    clubName: '曼城',
    logoKey: null,
    listPrice: 180,
    releaseFee: 240,
    listedAt: '2026-10-03T00:00:00.000Z',
    emphasis: 0,
    emphasisUntil: null,
    status: 'normal',
    notForSale: false,
    transferPriced: true,
    ...patch,
  };
}

function shell(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function stub(fixture: TransferBoardResponse) {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/market/transfer-board')) return Promise.resolve(fixture);
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('TC-B6-01 · TransferBoardRow ca/pa 可空防线', () => {
  it('ca/pa = NULL 的看板行：两格渲染「—」且不崩（R-WEB 防线）', async () => {
    stub({ players: [row({ id: 9, ca: null, pa: null })], total: 1 });
    const { container } = shell(<MarketAdBoardPage />);
    await waitFor(() => expect(container.querySelector('.adb-card')).not.toBeNull());
    const nums = container.querySelectorAll('.adb-card .adb-rail-num');
    expect(nums).toHaveLength(2);
    expect(nums[0].textContent).toBe('—');
    expect(nums[1].textContent).toBe('—');
    expect(screen.getByText('缺档球员')).toBeTruthy();
  });

  it('非 null 行渲染不变：数值与色阶类名照旧（防线只挡 null）', async () => {
    stub({ players: [row({ id: 10, ca: 94, pa: 95 })], total: 1 });
    const { container } = shell(<MarketAdBoardPage />);
    await waitFor(() => expect(container.querySelector('.adb-card')).not.toBeNull());
    const nums = container.querySelectorAll('.adb-card .adb-rail-num');
    expect(nums[0].textContent).toBe('94');
    expect(nums[0].className).toBe('adb-rail-num attr-good');
    expect(nums[1].textContent).toBe('95');
  });

  it('在售市场页 teaser：ca/pa = NULL 行的迷你卡同样渲染「—」且不崩', async () => {
    stub({ players: [row({ id: 11, ca: null, pa: null })], total: 1 });
    const { container } = shell(<AdBoardTeaser />);
    await waitFor(() => expect(container.querySelector('.adb-mini')).not.toBeNull());
    const nums = container.querySelectorAll('.adb-mini-nums b');
    expect(nums).toHaveLength(2);
    expect(nums[0].textContent).toBe('—');
    expect(nums[1].textContent).toBe('—');
  });
});
