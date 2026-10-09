// @vitest-environment jsdom
// v6.40.0：商城工单深链（?order=<id>）——从收件篮「工单通过 / 工单驳回」点进来直接展开目标工单并高亮。
// 页面很重（左主栏商品 + 球场三卡 + 右栏工单），这里只给工单链路上的端点备料：
// 目录端点故意失败 ⇒ 商品卡走「读不出来」分支，不牵连价格表夹具（本文件不测商品卡）。
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth.tsx';
import ShopPage from './ShopPage.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() };
});

function order(patch: Record<string, unknown> = {}) {
  return {
    id: 9,
    source: 'club',
    clubId: 1,
    orderedBy: 1,
    category: 'pa',
    categoryLabel: '买 PA',
    payload: { playerId: 6, amount: 5 },
    summary: '给 罗德里 加 5 点 PA',
    amount: 25,
    status: 'rejected',
    note: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: '名额已满',
    createdAt: '2026-10-07T03:00:00.000Z',
    updatedAt: '2026-10-07T04:00:00.000Z',
    ...patch,
  };
}

function renderShop(route: string, orders: Record<string, unknown>[]) {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/me') return Promise.resolve({ user: { id: 1, name: '测试教练', role: 'coach' }, authMode: 'shared', authHome: null });
    if (path === '/api/me/club') return Promise.resolve({ club: { id: 1, name: '我的俱乐部' }, balance: 120.5 });
    if (path === '/api/shop/orders') return Promise.resolve({ clubId: 1, orders });
    if (path === '/api/shop/squad-state') return Promise.resolve({ players: [] });
    if (path === '/api/seasons/current') return Promise.resolve({ window: { status: 'closed' } });
    if (path === '/api/shop/catalog') return Promise.reject(new Error('本测试不拉商品目录'));
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <ShopPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const hintOf = () => document.querySelector('.banner.warn[role="status"]');

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('v6.40.0 站内信深链落点（ShopPage 工单，TC-JUMP-02）', () => {
  it('?order=9 且该单在列表里：目标工单直接展开并挂 .is-target', async () => {
    renderShop('/shop?order=9', [order({ id: 9 }), order({ id: 8, status: 'approved', summary: '别的工单' })]);

    await waitFor(() => expect(document.querySelector('[data-order-id="9"]')).toBeTruthy());
    const row = document.querySelector('[data-order-id="9"]') as HTMLElement;
    expect(row.classList.contains('is-target'), '目标工单行应挂 .is-target').toBe(true);
    // 已展开：详情块才有的「单号 #9」与备注/载荷都在
    expect(row.textContent).toContain('#9');
    expect(row.textContent).toContain('理由：名额已满');
    // 未命中 ?order= 的行不被点亮
    expect(document.querySelectorAll('.is-target').length).toBe(1);
    expect(hintOf(), '命中的情况没有提示条').toBeNull();
  });

  it('?order=999 不在列表里：给出单号的提示条，且没有可高亮的行', async () => {
    renderShop('/shop?order=999', [order({ id: 9 })]);

    await waitFor(() => expect(document.querySelector('[data-order-id="9"]')).toBeTruthy());
    const hint = hintOf();
    expect(hint, '目标单不在列表里应给提示条').toBeTruthy();
    expect(hint?.textContent).toContain('#999');
    expect(hint?.textContent).toContain('不在当前列表里');
    expect(document.querySelector('.is-target'), '没有目标行就没有高亮').toBeNull();
  });

  it('不带 ?order=：没有高亮也没有提示条（老行为不变）', async () => {
    renderShop('/shop', [order({ id: 9 })]);

    await waitFor(() => expect(document.querySelector('[data-order-id="9"]')).toBeTruthy());
    expect(document.querySelector('.is-target')).toBeNull();
    expect(hintOf()).toBeNull();
    // 默认收起：详情块（单号）不渲染
    expect((document.querySelector('[data-order-id="9"]') as HTMLElement).textContent).not.toContain('单号');
  });
});
