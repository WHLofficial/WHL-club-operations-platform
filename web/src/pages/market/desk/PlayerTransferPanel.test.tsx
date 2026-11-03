// @vitest-environment jsdom
// 球员转会浮层（v6.74.0 期 C，设计 §9.2）：
// 六段数据只认 transfer-panel；已结束按 transfer 分态（已售出 / 未中标 / 已签下 / 留队）；
// 浮层内点报价先关自己再跳转（不叠两层），Esc / 关闭按钮都能退出。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransferPanelResponse } from '../../../lib/api.ts';
import { PlayerTransferPanel } from './PlayerTransferPanel.tsx';
import { PlayerTransferDialog } from './PlayerTransferDialog.tsx';

const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: apiPostMock };
});

function makePanel(overrides: Partial<TransferPanelResponse> = {}): TransferPanelResponse {
  return {
    club: { id: 1, name: '我的队' },
    player: {
      id: 7,
      fcId: 1007,
      name: '测试球员',
      position: 'ST',
      age: 25,
      ca: 80,
      pa: 88,
      clubId: 2,
      clubName: '挂牌方',
      isMine: false,
      status: 'listed',
    },
    listing: {
      id: 31,
      player: { id: 7, fcId: 1007, name: '测试球员', position: 'ST', age: 25, ca: 80, pa: 88 },
      sellerClub: { id: 2, name: '挂牌方' },
      type: 'normal',
      askPrice: 50,
      status: 'bidding',
      listedAt: '2026-01-01T00:00:00Z',
      lastBidAt: '2026-01-02T00:00:00Z',
      bidPaused: false,
      highestBid: 55,
      highestBidder: { id: 3, name: '对手队' },
      bidCount: 2,
      activatedBy: null,
      activationDeadline: null,
      matchDeadline: null,
      matchPhase: null,
      firstBidPending: false,
      deadlineAt: '2026-01-03T00:00:00Z',
      deadlineNote: null,
      releaseFee: 70,
      windowOpen: false,
      nextMinBid: 56,
      bidStepMin: 1,
      activatorName: null,
      marketBidPaused: false,
    },
    bids: [
      { id: 1, clubId: 3, clubName: '对手队', amount: 55, createdAt: '2026-01-02T00:00:00Z', status: 'active' },
      { id: 2, clubId: 1, clubName: '我的队', amount: 50, createdAt: '2026-01-01T00:00:00Z', status: 'superseded' },
    ],
    myBids: [
      { id: 2, listingId: 31, amount: 50, createdAt: '2026-01-01T00:00:00Z', status: 'superseded', holdStatus: 'released' },
    ],
    offers: {
      in: [
        {
          id: 41,
          player: { id: 7, fcId: 1007, name: '测试球员', position: 'ST', ca: 80, pa: 88, listPrice: 60 },
          counterpart: { id: 3, name: '对手队' },
          role: 'seller',
          amount: 45,
          initAmount: 45,
          round: 0,
          note: null,
          status: 'pending',
          turn: 'seller',
          myTurn: true,
          listingId: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      out: [],
    },
    negotiation: null,
    transfer: null,
    asOf: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function renderPanel(panel: TransferPanelResponse, onClose = vi.fn()) {
  apiMock.mockResolvedValue(panel);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PlayerTransferPanel playerId={7} mode="player" onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  apiMock.mockReset();
  apiPostMock.mockReset();
});
afterEach(cleanup);

describe('PlayerTransferPanel · 状态与分态', () => {
  it('挂牌中：要价/最高/我的出价/挂牌编号/截止都在；窗口关闭时不渲染出价表单', async () => {
    renderPanel(makePanel());
    await screen.findAllByText(/挂牌中/);
    expect(screen.getByText('50.00m')).toBeTruthy();
    expect(screen.getByText(/对手队 · 55.00m/)).toBeTruthy();
    expect(screen.getByText(/我的出价/)).toBeTruthy();
    expect(screen.getByText('窗口已关，开窗后再来。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /落激活首价/ })).toBeNull();
  });

  it('已售出（我是卖方）：成交价 + 去向，不出现「未中标」', async () => {
    renderPanel(
      makePanel({
        listing: null,
        bids: [],
        myBids: [],
        offers: { in: [], out: [] },
        transfer: { id: 9, type: 'transfer', fee: 61, fromClubId: 1, fromClubName: '我的队', toClubId: 4, toClubName: '新东家', completedAt: '2026-01-05T00:00:00Z' },
      }),
    );
    await screen.findByText(/已售出 · 成交价 61.00m（去 新东家）/);
    expect(screen.queryByText(/未中标/)).toBeNull();
  });

  it('出过价但没中标：未中标，不冒充留队', async () => {
    renderPanel(
      makePanel({
        listing: { ...makePanel().listing!, status: 'delisted', deadlineNote: '窗口结束无人匹配' },
        myBids: [{ id: 3, listingId: 31, amount: 52, createdAt: '2026-01-02T00:00:00Z', status: 'superseded', holdStatus: 'released' }],
      }),
    );
    await screen.findByText(/已结束 · 未中标 · 窗口结束无人匹配/);
  });

  it('我是买方成交：已签下', async () => {
    renderPanel(
      makePanel({
        listing: null,
        bids: [],
        myBids: [],
        offers: { in: [], out: [] },
        transfer: { id: 10, type: 'transfer', fee: 58, fromClubId: 2, fromClubName: '挂牌方', toClubId: 1, toClubName: '我的队', completedAt: '2026-01-05T00:00:00Z' },
      }),
    );
    await screen.findByText(/已签下 · 成交价 58.00m/);
  });

  it('未绑队教练：公开段照常，但不渲染出价表单', async () => {
    renderPanel(makePanel({ club: null, listing: { ...makePanel().listing!, windowOpen: true } }));
    await screen.findAllByText(/挂牌中/);
    expect(screen.queryByRole('button', { name: /出价（至少/ })).toBeNull();
  });

  it('成交后又被重新挂牌：徽标以在流程内的新单为准，不显示已结束', async () => {
    renderPanel(
      makePanel({
        transfer: { id: 9, type: 'transfer', fee: 61, fromClubId: 2, fromClubName: '挂牌方', toClubId: 1, toClubName: '我的队', completedAt: '2026-01-05T00:00:00Z' },
      }),
    );
    await screen.findAllByText(/挂牌中/);
    expect(screen.queryByText('已结束')).toBeNull();
  });

  it('谈判摘要：剩余轮数与成约文案', async () => {
    renderPanel(
      makePanel({
        listing: null,
        bids: [],
        myBids: [],
        offers: { in: [], out: [] },
        negotiation: {
          id: 5,
          status: 'settled',
          releaseFee: 70,
          expectedWage: 3,
          attemptsUsed: 2,
          remaining: 1,
          expiresAt: null,
          settled: { wage: 3, source: 'negotiation', message: '报价被经纪人接受，按你的报价签约' },
        },
      }),
    );
    await screen.findByText('签约谈判');
    expect(screen.getByText('报价被经纪人接受，按你的报价签约')).toBeTruthy();
  });
});

describe('PlayerTransferDialog · 单层浮层', () => {
  it('点报价先关自己再跳转；Esc 关闭', async () => {
    const panel = makePanel();
    const onClose = vi.fn();
    apiMock.mockResolvedValue(panel);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PlayerTransferDialog playerId={7} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    fireEvent.click(await screen.findByText('收 · 对手队'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
});
