// @vitest-environment jsdom
// CPU 接管向导（web/src/pages/admin/CpuConvertPage.tsx，v6.27.0）的组件测试，对应测试计划
// docs/test-plans/v6.27.0-cpu-convert-guide.md 的 D 块：
// - TC-CPU-D1（P0）：无 id（或 id 非法）进选择器，只列 isCpu 的队、链接带上队号
// - TC-CPU-D2（P0）：有 id 进向导，五步卡齐全，步骤 3 的球场名/队壳/奖励分/级别照 suggest 预填
// - TC-CPU-D3（P0）：步骤 1 推送走 POST /clubs/:id/rename-tour，URL 与请求体逐字对
// - TC-CPU-D4（P1）：入口两处的静态契约——接管向导只对 CPU 行开（计划里的 M8 变异就打在
//   ClubsPage 的 `club.isCpu &&` 上；e2e 种子库里没有 CPU 队，这条只活在 JSX 文本里，
//   与 tests/mobile-baseline.test.ts 同风格的扫描兜底）
// 没打 CSS（jsdom 不跑样式表），视觉表现靠 e2e ⑫ 的 375 宽扫描看。
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminClubRow, CpuConvertState } from '../../lib/api.ts';
import CpuConvertPage from './CpuConvertPage.tsx';

// 页面与 adminQueries 都从 ../../lib/api.ts 取函数，一处 mock 两个入口都吃
const { apiMock, apiPostMock, apiSendMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiSendMock: vi.fn(),
}));
vi.mock('../../lib/api.ts', () => ({ api: apiMock, apiPost: apiPostMock, apiSend: apiSendMock }));

const CITY: CpuConvertState = {
  club: { id: 10, name: '曼城 (CPU)', isCpu: true, leagueTier: 'second', status: 'active' },
  tour: { id: 10, name: 'Manchester City' },
  infra: { stadium: false, ledger: false, facilities: 0 },
  binding: { bound: false, userId: null, userName: null, boundAt: null },
  suggest: { newName: '曼城', shellInfluence: 65.75, bonusPoints: 15, leagueTier: 'second', diehardTarget: 1234 },
};

function clubRow(patch: Partial<AdminClubRow> & { id: number; name: string }): AdminClubRow {
  return {
    isCpu: false,
    leagueTier: 'premier',
    status: 'active',
    transferBanned: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    bindings: [],
    latestCode: null,
    ...patch,
  };
}

function renderPage(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <CpuConvertPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function step(no: number): HTMLElement {
  return screen.getByText(new RegExp(`步骤 ${no} ·`)).closest('section')!;
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiPostMock.mockReset();
  apiSendMock.mockReset();
});

describe('CPU 接管向导', () => {
  it('TC-CPU-D1：无 id 进选择器，只列 CPU 队并给出带队号的入口', async () => {
    apiMock.mockResolvedValue({
      clubs: [clubRow({ id: 10, name: '曼城 (CPU)', isCpu: true }), clubRow({ id: 77, name: '皇家马德里' })],
    });
    renderPage('/admin/clubs/cpu-convert');
    expect(await screen.findByText(/曼城/)).toBeTruthy();
    // 真人队不进接管列表
    expect(screen.queryByText(/皇家马德里/)).toBeNull();
    expect(screen.getByRole('link', { name: '进入接管向导' }).getAttribute('href')).toBe('/admin/clubs/cpu-convert?id=10');
  });

  it('TC-CPU-D2：有 id 进向导，五步卡与步骤 3 的四项预填照 suggest', async () => {
    apiMock.mockResolvedValue(CITY);
    renderPage('/admin/clubs/cpu-convert?id=10');
    expect(await screen.findByText(/对手方在赛事系统里现在叫「Manchester City」/)).toBeTruthy();
    for (const no of [1, 2, 3, 4, 5]) expect(step(no)).toBeTruthy();
    // 预填：球场名 = 新队名 + 主场；队壳/奖励分/级别照 suggest
    const ops = step(3);
    expect((within(ops).getByLabelText(/球场名/) as HTMLInputElement).value).toBe('曼城主场');
    expect((within(ops).getByLabelText(/队壳影响力/) as HTMLInputElement).value).toBe('65.75');
    expect((within(ops).getByLabelText(/奖励分/) as HTMLInputElement).value).toBe('15');
    expect((within(ops).getByLabelText(/联赛级别/) as HTMLSelectElement).value).toBe('second');
    // 目标死忠数按 suggest 显示（现算值，不在表单里）
    expect(within(ops).getByText(/初始球迷目标 1234 人/)).toBeTruthy();
  });

  it('TC-CPU-D3：步骤 1 推送走 rename-tour，URL 与请求体逐字对', async () => {
    apiMock.mockResolvedValue(CITY);
    apiPostMock.mockResolvedValue({ ok: true, renamed: true, name: '曼城' });
    renderPage('/admin/clubs/cpu-convert?id=10');
    await screen.findByText(/对手方在赛事系统里现在叫/);
    fireEvent.click(within(step(1)).getByRole('button', { name: '改名并推送' }));
    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/admin/clubs/10/rename-tour', { name: '曼城' }),
    );
    expect(await within(step(1)).findByText(/对手方已改名为「曼城」/)).toBeTruthy();
  });

  it('TC-CPU-D4：入口只对 CPU 行开——ClubsPage 的链接挂在 club.isCpu 下，总览卡指向向导页', () => {
    // vitest 的 cwd = 仓库根（与 tests/mobile-baseline.test.ts 同一读法；jsdom 下 import.meta.url 不是 file: 协议）
    const clubsPage = readFileSync(join(process.cwd(), 'web/src/pages/admin/ClubsPage.tsx'), 'utf8');
    expect(clubsPage).toMatch(/\{club\.isCpu && \([\s\S]{0,200}?cpu-convert\?id=\$\{club\.id\}/);
    const overview = readFileSync(join(process.cwd(), 'web/src/pages/admin/OverviewPage.tsx'), 'utf8');
    expect(overview).toMatch(/key: 'cpuClubs'[\s\S]{0,200}?to: '\/admin\/clubs\/cpu-convert'/);
  });
});
