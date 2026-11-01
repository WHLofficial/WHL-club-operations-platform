// @vitest-environment jsdom
// v6.30.0 施工开窗闸（消费中心·设施经营卡）：
// - 门控改吃 build-info 的 open（不再单拉窗口端点）；关窗时扩建 / 升档 / 五类子设施按钮全部置灰
// - 按钮 title 与卡内一行提示同文案「转会窗口没开，开窗后才能施工」
// - 关窗优先于其他置灰理由（未开放 / 容量不足）：title 不得被状态原因顶掉
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StadiumBuildInfo } from '../../lib/api.ts';
import { FacilityOpsCard, NamingCard } from './venueCards.tsx';

// 组件从 lib/api.ts 取 api：一处 mock 覆盖全部请求
const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: apiPostMock };
});

const CLOSED_HINT = '转会窗口没开，开窗后才能施工';

function buildInfo(patch: Partial<StadiumBuildInfo> = {}): StadiumBuildInfo {
  return {
    voucherBalance: 1.5,
    balance: 12,
    available: 12,
    expansionPer100: 1.2,
    maxOpenTier: 3,
    maxOpenTierName: '大区级',
    facilityCap: 1,
    refundRatio: 0.5,
    open: true,
    tier: { level: 0, name: '社区球场', capacity: 20000, minSeats: 10000, maxSeats: 30000 },
    nextTier: { name: '市级球场', minSeats: 25000, upgradeCost: 8, open: true },
    facilities: [
      { key: 'commercial', level: 0, cap: 1, nextCost: 3, canUpgrade: true },
      { key: 'broadcast', level: 0, cap: 1, nextCost: 3.5, canUpgrade: true },
      { key: 'pitch', level: 0, cap: 1, nextCost: 4, canUpgrade: true },
      { key: 'youth', level: 0, cap: 1, nextCost: 4.5, canUpgrade: true },
      { key: 'medical', level: 0, cap: 1, nextCost: 5, canUpgrade: true },
    ],
    ...patch,
  };
}

function renderCard(info: StadiumBuildInfo) {
  // 只认 build-info 一条请求：组件若还偷拉窗口端点（旧 useSeasonsCurrent 口径），这里直接报错
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/club/stadium/build-info') return Promise.resolve(info);
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FacilityOpsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  apiMock.mockReset();
  apiPostMock.mockReset();
});

describe('v6.30.0 施工开窗闸（设施经营卡）', () => {
  it('关窗：扩建 / 升档 / 四类子设施按钮全部置灰，title 与卡内提示同文案（医疗本轮隐藏）', async () => {
    renderCard(buildInfo({ open: false }));
    expect(await screen.findByText('设施经营')).toBeTruthy();

    // 卡内一行提示
    expect(screen.getByText(/转会窗口没开，开窗后才能施工/)).toBeTruthy();

    const expand = screen.getByRole('button', { name: '扩建' }) as HTMLButtonElement;
    expect(expand.disabled).toBe(true);
    expect(expand.getAttribute('title')).toBe(CLOSED_HINT);

    const tier = screen.getByRole('button', { name: '升级' }) as HTMLButtonElement;
    expect(tier.disabled).toBe(true);
    expect(tier.getAttribute('title')).toBe(CLOSED_HINT);

    // 四类子设施各一个按钮：金额互不相同，逐一点名；医疗中心本轮不展示
    for (const name of ['升级 3.00M', '升级 3.50M', '升级 4.00M', '升级 4.50M']) {
      const btn = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('title')).toBe(CLOSED_HINT);
    }

    expect(screen.queryByRole('button', { name: '升级 5.00M' })).toBeNull();
    expect(screen.queryByText('医疗中心')).toBeNull();
    // 卡内六个施工按钮全灰，一个可点的都没有
    expect(screen.getAllByRole('button').filter((b) => !(b as HTMLButtonElement).disabled).length).toBe(0);
  });

  it('开窗：三类施工按钮恢复可用，置灰文案消失', async () => {
    renderCard(buildInfo());
    expect(await screen.findByText('设施经营')).toBeTruthy();
    expect(screen.queryByText(/转会窗口没开/)).toBeNull();

    const expand = screen.getByRole('button', { name: '扩建' }) as HTMLButtonElement;
    expect(expand.disabled).toBe(false);
    expect(expand.getAttribute('title')).toBeNull();

    const tier = screen.getByRole('button', { name: '升级' }) as HTMLButtonElement;
    expect(tier.disabled).toBe(false);
    expect(tier.getAttribute('title')).toBeNull();

    const facility = screen.getByRole('button', { name: '升级 3.00M' }) as HTMLButtonElement;
    expect(facility.disabled).toBe(false);
    expect(facility.getAttribute('title')).toBe('升到 1：3.00M');

    // v6.59.0 文案：档位带 (X)、座位下限改「建议达到」、子设施说明逐条
    expect(screen.getAllByText(/社区球场 \(1\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/建议达到 25,000 座/)).toBeTruthy();
    expect(screen.queryByText(/至少 25,000 座/)).toBeNull();
    expect(screen.getByText(/每场商业收入 \+0\.1m \/ 万观众/)).toBeTruthy();
  });

  it('关窗优先：状态原因（未开放）不改写 title，提示仍指向开窗', async () => {
    renderCard(
      buildInfo({
        open: false,
        nextTier: { name: '市级球场', minSeats: 25000, upgradeCost: 8, open: false },
      }),
    );
    expect(await screen.findByText('设施经营')).toBeTruthy();
    // 按钮文案仍是状态原因（未开放），但 title 与提示统一为开窗闸
    const tier = screen.getByRole('button', { name: '未开放' }) as HTMLButtonElement;
    expect(tier.disabled).toBe(true);
    expect(tier.getAttribute('title')).toBe(CLOSED_HINT);
    expect(screen.queryByText(/档暂未开放/)).toBeNull();
  });

  it('子设施到当前档位上限：提示「已达上限（升级球场后解锁）」，不是「满级」', async () => {
    renderCard(
      buildInfo({
        facilities: [
          { key: 'commercial', level: 1, cap: 1, nextCost: null, canUpgrade: false },
          { key: 'broadcast', level: 0, cap: 1, nextCost: 3.5, canUpgrade: true },
        ],
      }),
    );
    expect(await screen.findByText('设施经营')).toBeTruthy();
    expect(screen.getByText('已达上限（升级球场后解锁）')).toBeTruthy();
    expect(screen.queryByText('满级')).toBeNull();
    expect(screen.queryByRole('button', { name: '升级 3.00M' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// v6.65.3 冠名退约确认弹窗先亮赔款（TC-W-04）：quote 下发 terminatePenalty 预览，
// 确认文案带具体金额；键缺失（半旧响应）明示「无赔金」
describe('v6.65.3 冠名退约确认弹窗先亮赔款', () => {
  const contract = {
    id: 1,
    clubId: 112172,
    brand: '锐步',
    baseFee: 3,
    packageNo: 1,
    pkgName: '轻量',
    feePerWindow: 4,
    windowsTotal: 6,
    windowsRemaining: 3,
    bonusAmount: 0,
    betAttend: null,
    betFans: null,
    status: 'active',
    startedSeason: 9,
    startedWindow: 1,
    satisfaction: 1,
    venueName: null,
    betTerms: null,
    brandProfile: null,
    tier: '口碑',
    satisfyFloor: null,
  };

  function renderNaming(quote: Record<string, unknown>) {
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/club/naming/quote') return Promise.resolve(quote);
      return Promise.reject(new Error(`未预期的请求：${path}`));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NamingCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('有赔款：退约确认文案带「赔金 2.40M」并说明可透支', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderNaming({ contract, terminatePenalty: 2.4, offers: [] });
    fireEvent.click(await screen.findByText('退冠名'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const text = String(confirmSpy.mock.calls[0]![0]);
    expect(text).toContain('将赔 2.40M');
    expect(text).toContain('余额不足将扣成负数');
  });

  it('键缺失或赔款为 0：确认文案明示「无赔金」', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderNaming({ contract: { ...contract, windowsRemaining: 1 }, offers: [] });
    fireEvent.click(await screen.findByText('退冠名'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(String(confirmSpy.mock.calls[0]![0])).toContain('无赔金');
  });
});
