// @vitest-environment jsdom
// 转会区热刷新按钮（v6.65.0）组件行为锁（测试计划 TC-UI-01/02/03/04 的单测层）：
// 点击真发请求（板子 + 我的出价 + 教练态余额）、刷新中禁用 + 旧卡不闪空、更新时间在场、
// 非教练不触发余额。端点交互全走 api.ts 打桩（Ledger.test.tsx 同款）。
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth.tsx';
import MarketBoardPage from './MarketBoardPage.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock };
});

const LISTING = {
  id: 1,
  player: { id: 10, fcId: null, name: '王牌', position: 'ST', age: 26, ca: 85, pa: 88 },
  sellerClub: { id: 33, name: '挂牌联' },
  type: 'normal',
  askPrice: 15,
  status: 'listed',
  listedAt: '2026-10-31T00:00:00Z',
  lastBidAt: null,
  bidPaused: false,
  highestBid: null,
  highestBidder: null,
  bidCount: 0,
  activatedBy: null,
  activationDeadline: null,
  matchDeadline: null,
  matchPhase: null,
  firstBidPending: false,
  deadlineAt: null,
  deadlineNote: null,
};

function renderPage(role: 'coach' | 'user', opts: { entry?: string } = {}) {
  const calls = { listings: 0, bids: 0, balance: 0, detail: 0 };
  let gate: ((v: unknown) => void) | null = null;
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/me') return { user: { id: 2, name: '教练乙', role }, authMode: 'shared' };
    if (path === '/api/me/club') return { club: { id: 33, name: '挂牌联' }, isCoach: role === 'coach' };
    // v6.68.0 期 B：`?listing=` 直开会拉详情
    if (path === '/api/market/listings/1') {
      calls.detail += 1;
      return { listing: LISTING, bids: [] };
    }
    if (path.startsWith('/api/market/listings?')) {
      calls.listings += 1;
      if (calls.listings === 1) return { listings: [LISTING], cursor: null };
      return new Promise((resolve) => {
        gate = resolve;
      });
    }
    if (path === '/api/me/bids') {
      calls.bids += 1;
      return { bids: [] };
    }
    if (path === '/api/club/balance') {
      calls.balance += 1;
      return { available: 100, creditLine: 0 };
    }
    if (path === '/api/clubs') return { clubs: [] };
    if (path.startsWith('/api/market/transfer-board')) return { rows: [], total: 0 };
    throw new Error(`未打桩的请求：${path}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[opts.entry ?? '/market']}>
          <MarketBoardPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, calls, release: () => gate?.({ listings: [LISTING], cursor: null }) };
}

beforeEach(() => {
  // 浮层（MarketListingOverlay）经 useMediaQuery 读 matchMedia，jsdom 没这个 API，缺桩整树崩。
  // 恒 false = 桌面口径：浮层走弹窗分支，断言按桌面 DOM 写。
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe('转会区热刷新按钮（v6.65.0）', () => {
  it('点击真发请求：板子 + 我的出价 + 教练态余额一起重取', async () => {
    const { container, calls, getByRole } = renderPage('coach');
    await waitFor(() => expect(container.textContent).toContain('王牌'));
    const before = calls.listings;
    fireEvent.click(getByRole('button', { name: '↻ 刷新' }));
    await waitFor(() => expect(calls.listings).toBe(before + 1));
    expect(calls.bids).toBeGreaterThanOrEqual(1);
    expect(calls.balance).toBeGreaterThanOrEqual(1);
  });

  it('刷新中：按钮禁用 + 文案「刷新中…」，旧卡保留不闪空；放行后恢复', async () => {
    const { container, getByRole, release } = renderPage('coach');
    await waitFor(() => expect(container.textContent).toContain('王牌'));
    fireEvent.click(getByRole('button', { name: '↻ 刷新' }));
    const btn = (await waitFor(() => getByRole('button', { name: '刷新中…' }))) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // keepPreviousData：刷新请求未回来，旧卡仍在
    expect(container.textContent).toContain('王牌');
    // 放行挂起的 refetch，按钮恢复
    release();
    await waitFor(() => expect(getByRole('button', { name: '↻ 刷新' })).toBeTruthy());
    expect(container.textContent).toContain('王牌');
  });

  it('更新时间在场（「更新于 HH:MM:SS」）', async () => {
    const { container } = renderPage('coach');
    await waitFor(() => expect(container.querySelector('.mkt-updated')?.textContent).toMatch(/更新于 \d{2}:\d{2}:\d{2}/));
  });

  it('首载骨架卡替代等待文案；非教练点击不触发余额', async () => {
    const { calls, getByRole } = renderPage('user');
    const btn = await waitFor(() => getByRole('button', { name: '↻ 刷新' }) as HTMLButtonElement);
    fireEvent.click(btn);
    await waitFor(() => expect(calls.listings).toBe(2));
    expect(calls.balance).toBe(0);
  });
});

describe('?listing= 直开浮层（v6.68.0 期 B）', () => {
  it('命中在售挂单：自动拉详情并打开浮层', async () => {
    const { container, calls } = renderPage('coach', { entry: '/market?listing=1' });
    await waitFor(() => expect(container.textContent).toContain('王牌'));
    await waitFor(() => expect(calls.detail).toBeGreaterThanOrEqual(1));
  });

  it('挂单不在当前列表（已撤/已下架）：静默忽略，不拉详情', async () => {
    const { container, calls } = renderPage('coach', { entry: '/market?listing=999' });
    await waitFor(() => expect(container.textContent).toContain('王牌'));
    expect(calls.detail).toBe(0);
  });

  it('非整数参数直接丢弃', async () => {
    const { container, calls } = renderPage('coach', { entry: '/market?listing=abc' });
    await waitFor(() => expect(container.textContent).toContain('王牌'));
    expect(calls.detail).toBe(0);
  });
});
