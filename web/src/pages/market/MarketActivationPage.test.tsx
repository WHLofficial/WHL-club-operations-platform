// @vitest-environment jsdom
// v6.60.0 激活页入口（TC-E）：点「激活」不再触发隐藏 file input，而是打开共用截图弹窗；
// 弹窗里选图先预览，确认后才走上传 + 建挂牌（本用例只锁入口与预览，提交链路由组件测试覆盖）。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivatablePlayer } from '../../lib/api.ts';
import MarketActivationPage from './MarketActivationPage.tsx';

const PLAYER: ActivatablePlayer = {
  id: 7,
  fcId: 1007,
  name: '阿切尔比',
  position: 'CB',
  age: 30,
  ca: 150,
  pa: 160,
  status: 'normal',
  club: { id: 9, name: '国际米兰' },
  contractType: 'formal',
  activationFee: 45,
  activatedThisWindow: false,
  justSigned: false,
};

const { apiUploadMock, apiPostMock } = vi.hoisted(() => ({ apiUploadMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, apiUpload: apiUploadMock, apiPost: apiPostMock };
});

vi.mock('../../lib/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries.ts')>();
  return {
    ...actual,
    useMyClub: () => ({
      loading: false,
      isCoach: true,
      club: { id: 1, name: '利物浦', balance: 100, isCoach: true },
      failed: false,
    }),
    useActivatable: () => ({ data: { club: { id: 1, name: '利物浦' }, players: [PLAYER] }, isError: false, error: null }),
  };
});

vi.mock('../../lib/ops-gate.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ops-gate.ts')>();
  return { ...actual, useOpsGate: () => null };
});

beforeEach(() => {
  apiUploadMock.mockReset().mockResolvedValue({ key: 'activation/1/proof.jpg' });
  apiPostMock.mockReset().mockResolvedValue({
    ok: true,
    listingId: 11,
    askPrice: 45,
    kind: 'normal',
    firstBidDeadline: '2026-10-29T12:05:00Z',
  });
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:proof-preview'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe('MarketActivationPage 激活入口（v6.60.0）', () => {
  it('点激活打开共用弹窗，示例用真实队名，选图先预览', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MarketActivationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '激活' }));
    const dialog = await screen.findByRole('dialog', { name: '上传激活通知截图' });
    expect(dialog.textContent).toContain('先在 QQ 私信对方主教练');
    expect(dialog.textContent).toContain('利物浦主教练');
    // 页面原有「证据制」长说明不再出现（口径已收进弹窗）
    expect(screen.queryByText(/证据制/)).toBeNull();

    const file = new File(['x'], 'proof.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('选择激活通知截图'), { target: { files: [file] } });
    expect(await screen.findByAltText('激活通知截图预览')).toBeTruthy();
    expect(screen.getByText('proof.jpg')).toBeTruthy();
  });

  it('确认后先传截图拿 key，再按 playerId + key 建激活，成功后关弹窗并摆出首价', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MarketActivationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '激活' }));
    const file = new File(['x'], 'proof.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('选择激活通知截图'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '确认激活' }));

    await waitFor(() =>
      expect(apiUploadMock).toHaveBeenCalledWith('/api/media/activation', 'image/jpeg', file),
    );
    expect(apiPostMock).toHaveBeenCalledWith('/api/market/activations', {
      playerId: PLAYER.id,
      proofMediaKey: 'activation/1/proof.jpg',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findByRole('status')).textContent).toContain('已激活 阿切尔比');
  });
});
