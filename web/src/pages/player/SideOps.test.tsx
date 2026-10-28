// @vitest-environment jsdom
// v6.55.0 报价设置对齐回执（TC-A-007）：saveSettings 消费 PUT 响应——
// 对齐发生时 toast「最低报价已随标价降至 X m（最低报价不能高于标价）」，并用响应值回灌全部草稿；
// null 一律回灌成 ''（不得出现字符串 'null'：脏判恒真 → 下次保存发 NaN 必 400 的回归）。
// 基建先例：web/src/pages/player/MatchesTab.test.tsx（jsdom + Testing Library）、
// Player.test.tsx（api 模块只换实现、importOriginal 摊开真实导出）。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfferSettingsDto } from '../../lib/api.ts';
import { resetOpsSchedule } from '../../lib/ops-gate.ts';
import { SideOps } from './SideOps.tsx';

const { apiMock, apiPutMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPutMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPut: apiPutMock, apiPost: vi.fn(), apiUpload: vi.fn() };
});

// settings 端点回的现值（面板草稿的预填源）；PUT 的响应由各用例单独 mock
const SETTINGS: OfferSettingsDto = { transferListed: true, minOfferPrice: 40, listPrice: 60, offerAuto: false, notForSale: false };

function stubApi(): void {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/players/1/offer-settings') return Promise.resolve(SETTINGS);
    // useOpsGate 的模块级单例：返回空表 ⇒ 闸门未加载，不置灰（真闸在服务端）
    if (path === '/api/ops-schedule') return Promise.resolve({ rows: [] });
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
}

function renderOps() {
  const show = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SideOps
          player={{
            id: 1,
            name: '球员甲',
            status: 'normal',
            transferListed: true,
            listPrice: 60,
            offerAuto: false,
            notForSale: false,
            marketValue: null,
          }}
          contract={null}
          contractPending={null}
          demandState={null}
          isMine
          isFree={false}
          isCpu={false}
          isCoach
          myClubId={1}
          windowOpen
          seaSign={{ eligible: false, reason: null }}
          seaComps={{ scope: 'none', rows: [] }}
          pendingMine={0}
          onShowContract={() => {}}
          show={show}
          refreshAll={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { show };
}

/** 等 settings 到达并灌入草稿（min 40 / 标价 60） */
async function ready(): Promise<{ minInput: HTMLInputElement; listInput: HTMLInputElement }> {
  const minInput = (await screen.findByLabelText('最低报价')) as HTMLInputElement;
  await waitFor(() => expect(minInput.value).toBe('40'));
  const listInput = screen.getByLabelText('标价') as HTMLInputElement;
  expect(listInput.value).toBe('60');
  return { minInput, listInput };
}

beforeEach(() => {
  stubApi();
  resetOpsSchedule();
});

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiPutMock.mockReset();
});

describe('SideOps 报价设置对齐回执（v6.55.0，TC-A-007）', () => {
  it('对齐：toast 文案逐字 + min/标价草稿按响应回灌（min 跟到 50，不取请求里的 40）', async () => {
    apiPutMock.mockResolvedValue({
      ok: true,
      transferListed: true,
      minOfferPrice: 50,
      listPrice: 50,
      offerAuto: false,
      notForSale: false,
      minOfferPriceAdjusted: { from: 40, to: 50 },
    });
    const { show } = renderOps();
    const { minInput, listInput } = await ready();

    // 降标价 60 → 50：脏判成立，保存按钮可点
    fireEvent.change(listInput, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(apiPutMock).toHaveBeenCalledTimes(1));
    expect(apiPutMock.mock.calls[0][0]).toBe('/api/players/1/offer-settings');
    expect(apiPutMock.mock.calls[0][1]).toMatchObject({ transferListed: true, minOfferPrice: 40, listPrice: 50, offerAuto: false, notForSale: false });

    await waitFor(() => expect(show).toHaveBeenCalledWith('最低报价已随标价降至 50 m（最低报价不能高于标价）'));
    // 用响应值回灌：min 跟到对齐后的 50、标价 50，草稿不再停在「标价 < 最低报价」的脏值上
    await waitFor(() => expect(minInput.value).toBe('50'));
    expect(listInput.value).toBe('50');
  });

  it('null 回灌：min/标价都回灌成空串，绝不出现字符串 "null"', async () => {
    apiPutMock.mockResolvedValue({
      ok: true,
      transferListed: true,
      minOfferPrice: null,
      listPrice: null,
      offerAuto: false,
      notForSale: false,
      minOfferPriceAdjusted: { from: null, to: 50 },
    });
    const { show } = renderOps();
    const { minInput, listInput } = await ready();

    fireEvent.change(listInput, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(show).toHaveBeenCalled());

    // String(null) 会产出 "null" 字符串 → 脏判恒真 → 下次保存发 NaN 必 400：这里锁死回灌写法
    await waitFor(() => expect(minInput.value).toBe(''));
    expect(listInput.value).toBe('');
    expect(minInput.value).not.toBe('null');
    expect(listInput.value).not.toBe('null');
  });

  it('未对齐：返回「报价设置已保存。」，草稿不被响应重灌（对齐回执只在 adjusted 非空时出现）', async () => {
    apiPutMock.mockResolvedValue({
      ok: true,
      transferListed: true,
      minOfferPrice: 40,
      listPrice: 55,
      offerAuto: false,
      notForSale: false,
      minOfferPriceAdjusted: null,
    });
    const { show } = renderOps();
    const { listInput } = await ready();

    fireEvent.change(listInput, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(show).toHaveBeenCalledWith('报价设置已保存。'));
    expect(listInput.value).toBe('55');
  });
});
