// @vitest-environment jsdom
// v6.29.0 意向单（status=intent）在报价区的渲染与动作，聚焦测试：
// - 状态徽标「意向单·等开窗」；事件表 kind=intent/confirm 文案「挂意向单」/「确认挂牌」
// - 「轮到谁」列：卖方视角「待卖方确认」、买方视角「等对方确认」（intent 的 myTurn 恒 false，不能再显示 —）
// - 「我收到的」页签上的 intentsMine 徽标「（N 待确认挂牌）」
// - 谈判桌动作：卖方「确认挂牌」(accept) + 「放弃」(reject)，买方「撤回」(withdraw)，端点逐字对
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfferDetailResponse, OfferListItem, OffersListResponse } from '../../../lib/api.ts';
import OffersSection from './OffersSection.tsx';

// 组件与 queries 都从 lib/api.ts 取函数：一处 mock，清单与详情都走 apiMock
const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: apiPostMock };
});

function offer(patch: Partial<OfferListItem> = {}): OfferListItem {
  return {
    id: 5,
    player: { id: 9, fcId: null, name: '测试球员', position: 'ST', ca: 51, pa: 82 },
    counterpart: { id: 3, name: '对方俱乐部' },
    role: 'seller',
    amount: 12,
    initAmount: 10,
    round: 2,
    note: null,
    status: 'intent',
    turn: 'buyer',
    myTurn: false, // intent 恒 false（契约），动作只看 role
    listingId: null,
    createdAt: '2025-12-29T00:00:00.000Z',
    updatedAt: '2025-12-31T00:00:00.000Z',
    ...patch,
  };
}

function listResponse(items: OfferListItem[], intentsMine = 0): OffersListResponse {
  return { club: { id: 1, name: '我的俱乐部' }, box: 'in', items, nextCursor: null, pendingMine: 0, intentsMine };
}

function detailResponse(o: OfferListItem): OfferDetailResponse {
  return {
    offer: {
      ...o,
      buyerClub: { id: 2, name: '买方俱乐部' },
      sellerClub: { id: 1, name: '我的俱乐部' },
      season: 3,
      windowSeq: 2,
      resolvedAt: null,
    },
    events: [
      { kind: 'open', amount: 10, note: null, at: '2025-12-29T00:00:00.000Z', actor: { id: 2, name: '买方教练' } },
      { kind: 'intent', amount: 12, note: null, at: '2025-12-30T00:00:00.000Z', actor: { id: 1, name: '卖方教练' } },
      { kind: 'confirm', amount: 12, note: null, at: '2025-12-31T00:00:00.000Z', actor: { id: 1, name: '卖方教练' } },
    ],
  };
}

function renderSection(items: OfferListItem[], detail?: OfferDetailResponse, intentsMine = 0) {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/offers?')) return Promise.resolve(listResponse(items, intentsMine));
    if (/^\/api\/offers\/\d+$/.test(path)) {
      return detail ? Promise.resolve(detail) : Promise.reject(new Error(`没有详情：${path}`));
    }
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OffersSection box="in" status="all" onBoxChange={() => {}} onStatusChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiPostMock.mockReset();
});

describe('v6.29.0 意向单（OffersSection）', () => {
  it('列表：意向单徽标「意向单·等开窗」，卖方视角「轮到谁」= 待卖方确认', async () => {
    renderSection([offer({ role: 'seller' })]);
    expect(await screen.findByText('意向单·等开窗')).toBeTruthy();
    expect(screen.getByText('待卖方确认')).toBeTruthy();
    expect(screen.queryByText('等对方确认')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('列表：买方视角的意向单「轮到谁」= 等对方确认', async () => {
    renderSection([offer({ role: 'buyer' })]);
    expect(await screen.findByText('意向单·等开窗')).toBeTruthy();
    expect(screen.getByText('等对方确认')).toBeTruthy();
    expect(screen.queryByText('待卖方确认')).toBeNull();
  });

  it('「我收到的」页签：intentsMine > 0 时带「N 待确认挂牌」徽标', async () => {
    renderSection([offer()], undefined, 2);
    expect(await screen.findByRole('button', { name: /我收到的（2 待确认挂牌）/ })).toBeTruthy();
  });

  it('谈判桌：卖方意向单 = 确认挂牌(accept) + 放弃(reject)，事件表认出挂意向单/确认挂牌', async () => {
    const o = offer({ role: 'seller' });
    apiPostMock.mockResolvedValue({ ok: true });
    renderSection([o], detailResponse(o));
    fireEvent.click(await screen.findByRole('button', { name: '谈判桌' }));
    // 事件表：intent → 挂意向单，confirm → 确认挂牌
    expect(await screen.findByText('挂意向单')).toBeTruthy();
    expect(screen.getByText('确认挂牌')).toBeTruthy();
    // 买方的撤回不出现卖方桌上
    expect(screen.queryByRole('button', { name: '撤回' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /确认挂牌（12\.00 m）/ }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/accept', {}));
    expect(await screen.findByText(/已确认，球员挂牌/)).toBeTruthy();
    apiPostMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/reject', {}));
    expect(await screen.findByText(/已放弃意向，冻结已退回对方/)).toBeTruthy();
  });

  it('谈判桌：买方意向单只有「撤回」(withdraw)，没有确认挂牌/放弃', async () => {
    const o = offer({ role: 'buyer', counterpart: { id: 1, name: '卖方俱乐部' } });
    apiPostMock.mockResolvedValue({ ok: true });
    renderSection([o], detailResponse(o));
    fireEvent.click(await screen.findByRole('button', { name: '谈判桌' }));
    expect(await screen.findByText(/关窗期双方已谈成，先挂意向单/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /确认挂牌/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '放弃' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '撤回' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/withdraw', {}));
    expect(await screen.findByText(/已撤回意向，冻结资金已退回/)).toBeTruthy();
  });

  it('describe 覆盖：intent 单的 myTurn 恒 false，不再出现「还没轮到你」兜底', async () => {
    const o = offer({ role: 'seller', myTurn: false });
    renderSection([o], detailResponse(o));
    fireEvent.click(await screen.findByRole('button', { name: '谈判桌' }));
    await screen.findByText(/关窗期双方已谈成，先挂意向单/);
    expect(screen.queryByText(/还没轮到你/)).toBeNull();
  });
});
