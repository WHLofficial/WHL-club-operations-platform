// @vitest-environment jsdom
// 管理端总览（web/src/pages/admin/OverviewPage.tsx，v6.28.0）的组件测试：
// - TC-OVW-E1（P0）：计数卡 8 张（v6.27.0 的 6 张 + v6.28.0 两张待办卡），顺序与文案逐字锁定
// - TC-OVW-E2（P0）：两张新卡的 to 分别指向 /admin/shop 与 /admin/events（点一下就到对应列表页）
// - TC-OVW-E3（P1）：刷新按钮仍走 ?fresh=1 强拉（服务端 60s isolate 缓存口径没被绕过）
// 计数本身的口径（SQL WHERE）由后端 tests/admin-system.test.ts 的夹具守着，这里只管前端形态。
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminOverview, M0Report } from '../../lib/api.ts';
import OverviewPage from './OverviewPage.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
// 页面与 TanStack Query 都从 api.ts 取数，一处 mock 全吃；ledgerKindLabel 用恒等实现（M0 表里只做展示）
vi.mock('../../lib/api.ts', () => ({ api: apiMock, ledgerKindLabel: (kind: string) => kind }));

// 8 个计数各给一个互不相同的值：卡片串位/串 key 时断言必红
const OVERVIEW: AdminOverview = {
  openReviews: 1,
  resultQueue: 2,
  activeListings: 3,
  clubs: 4,
  cpuClubs: 5,
  players: 6,
  pendingShopOrders: 7,
  pendingEvents: 8,
  at: '2026-10-04T12:00:00.000Z',
};

const M0: M0Report = { m0: 1234.56, held: 100, available: 1134.56, byKind: [], byClub: [] };

const CARD_LABELS = [
  '待审核成交',
  '赛果队列',
  '活跃挂牌',
  '俱乐部',
  'CPU 队',
  '球员',
  '待审消费工单',
  '待选事件',
];

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

function renderPage() {
  apiMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/admin/overview')) return OVERVIEW;
    if (url === '/api/admin/m0') return M0;
    throw new Error(`未打桩的请求 ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 卡片 = .field（总览的计数卡），按标题文案取到整张
function cardOf(label: string): HTMLElement {
  const card = screen.getByText(label).closest('.field');
  if (!(card instanceof HTMLElement)) throw new Error(`没找到卡片 ${label}`);
  return card;
}

describe('管理端总览计数卡（v6.28.0）', () => {
  it('TC-OVW-E1：8 张卡、顺序与文案逐字锁定', async () => {
    const { container } = renderPage();
    await screen.findByText('待审消费工单');

    const cards = [...container.querySelectorAll('.field')];
    expect(cards).toHaveLength(8);
    expect(cards.map((c) => c.querySelector('span')?.textContent)).toEqual(CARD_LABELS);

    // 每张卡的计数取到对应键的值（夹具值互不相同，串位必红）
    expect(within(cardOf('待审消费工单')).getByText('7')).toBeTruthy();
    expect(within(cardOf('待选事件')).getByText('8')).toBeTruthy();
    expect(within(cardOf('CPU 队')).getByText('5')).toBeTruthy();
    expect(within(cardOf('球员')).getByText('6')).toBeTruthy();
  });

  it('TC-OVW-E2：两张新卡带副标题、计数可点且落到对应列表页', async () => {
    renderPage();
    await screen.findByText('待审消费工单');

    const shop = cardOf('待审消费工单');
    expect(shop.textContent).toContain('等管理组审核的购买工单');
    expect(within(shop).getByRole('link').getAttribute('href')).toBe('/admin/shop');

    const events = cardOf('待选事件');
    expect(events.textContent).toContain('等教练做选择的事件');
    expect(within(events).getByRole('link').getAttribute('href')).toBe('/admin/events');

    // 既有卡的路由不许被挤掉
    expect(within(cardOf('CPU 队')).getByRole('link').getAttribute('href')).toBe('/admin/clubs/cpu-convert');
  });

  it('TC-OVW-E3：刷新按钮走 ?fresh=1 强拉一次', async () => {
    renderPage();
    await screen.findByText('待审消费工单');

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/admin/overview?fresh=1'));
  });
});
