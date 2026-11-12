// @vitest-environment jsdom
// 转 CPU 向导（web/src/pages/admin/ToCpuPage.tsx，v6.84.0）的组件测试：
// - 入口：选择器只列人类队；ClubsPage 的「转 CPU」只挂在 !club.isCpu 行；App 路由已挂
// - 阻断：预检 blockers 非空时步骤 2/3 的动作禁用并说明
// - 权限：OIDC 账号缺 club.bindings.unbind 时步骤 4 禁用并说明
// - 部分解绑失败：逐行展示失败账号与原因，可重试
// - 复核：五项 checks 全通过时显示 ready
// - 确认框：保留阵容/合同、可被海捞、CPU 不收转会费、余额与券回收不退回
// 没打 CSS（jsdom 不跑样式表），视觉表现靠 e2e 扫描。
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminClubRow, CpuDetachState } from '../../lib/api.ts';
import type { AuthState } from '../../lib/auth.tsx';
import ToCpuPage from './ToCpuPage.tsx';

// 页面从 ../../lib/api.ts 取函数、从 ../../lib/auth.tsx 取登录态；两处 mock 后页面不碰网络
const { apiMock, apiPostMock, apiSendMock, authMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiSendMock: vi.fn(),
  authMock: vi.fn(),
}));
vi.mock('../../lib/api.ts', () => ({ api: apiMock, apiPost: apiPostMock, apiSend: apiSendMock }));
vi.mock('../../lib/auth.tsx', () => ({ useAuth: authMock }));

function clubRow(patch: Partial<AdminClubRow> & { id: number; name: string }): AdminClubRow {
  return {
    isCpu: false,
    leagueTier: 'premier',
    status: 'active',
    transferBanned: false,
    country: null,
    countryName: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    bindings: [],
    latestCode: null,
    ...patch,
  };
}

/** 干净的人类队：没有阻断，绑定 1 个账号，队名还没带 CPU 后缀 */
const HUMAN: CpuDetachState = {
  club: { id: 77, name: '皇家马德里', isCpu: false, leagueTier: 'premier', status: 'active' },
  tour: { id: 77, name: 'Real Madrid' },
  bindings: [{ userId: 5, userName: '张三', boundAt: '2026-11-01T00:00:00.000Z' }],
  unusedCodes: [],
  contracts: { active: 3, total: 4 },
  players: 25,
  balance: 12.5,
  vouchers: 2.5,
  suggest: { newName: '皇家马德里 (CPU)', nameError: null },
  blockers: [],
  warnings: [],
  checks: { isCpu: false, tourName: false, localName: false, bindings: false, codes: true, funds: false },
  ready: false,
};

/** 已转换、六项复核全过 */
const READY: CpuDetachState = {
  ...HUMAN,
  club: { ...HUMAN.club, name: '皇家马德里 (CPU)', isCpu: true },
  tour: { id: 77, name: '皇家马德里 (CPU)' },
  bindings: [],
  balance: 0,
  vouchers: 0,
  checks: { isCpu: true, tourName: true, localName: true, bindings: true, codes: true, funds: true },
  ready: true,
};

const SHARED_ADMIN: AuthState = {
  // 兼容模式：permissions 恒空，权限判定回落 admin 角色（与 requireAdmin 同口径）
  user: { id: 1, name: '管理组', role: 'admin', locked: false, mustChangePw: false, permissions: [] },
  authMode: 'shared',
  authHome: null,
};

function renderPage(url: string, auth: AuthState = SHARED_ADMIN) {
  authMock.mockReturnValue(auth);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ToCpuPage />
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
  authMock.mockReset();
});

describe('转 CPU 向导', () => {
  it('入口：选择器只列人类队；ClubsPage 只在 !isCpu 行开「转 CPU」，路由已挂', async () => {
    apiMock.mockResolvedValue({
      clubs: [clubRow({ id: 10, name: '曼城 (CPU)', isCpu: true }), clubRow({ id: 77, name: '皇家马德里' })],
    });
    renderPage('/admin/clubs/to-cpu');
    expect(await screen.findByText(/皇家马德里/)).toBeTruthy();
    // CPU 队不进转 CPU 列表
    expect(screen.queryByText(/曼城/)).toBeNull();
    expect(screen.getByRole('link', { name: '进入转换向导' }).getAttribute('href')).toBe('/admin/clubs/to-cpu?id=77');

    // 静态契约：入口挂在 !club.isCpu 下，CPU 行仍只开接管向导
    const clubsPage = readFileSync(join(process.cwd(), 'web/src/pages/admin/ClubsPage.tsx'), 'utf8');
    expect(clubsPage).toMatch(/\{!club\.isCpu && \([\s\S]{0,200}?to-cpu\?id=\$\{club\.id\}/);
    expect(clubsPage).toMatch(/\{club\.isCpu && \([\s\S]{0,200}?cpu-convert\?id=\$\{club\.id\}/);
    const app = readFileSync(join(process.cwd(), 'web/src/App.tsx'), 'utf8');
    expect(app).toMatch(/path="clubs\/to-cpu"/);
  });

  it('阻断：预检有阻断项时步骤 2/3 的动作禁用并说明', async () => {
    apiMock.mockResolvedValue({
      ...HUMAN,
      blockers: [{ key: 'listings', label: '卖方未终态挂牌', detail: '还有 1 条挂着的挂牌' }],
    });
    renderPage('/admin/clubs/to-cpu?id=77');
    expect(await screen.findByText(/还有 1 条挂着的挂牌/)).toBeTruthy();
    expect(within(step(1)).getByText('存在阻断')).toBeTruthy();

    const tourBtn = within(step(2)).getByRole('button', { name: '改名并推送' }) as HTMLButtonElement;
    expect(tourBtn.disabled).toBe(true);
    expect(within(step(2)).getByText(/预检有阻断项，改名按钮已禁用/)).toBeTruthy();

    const localBtn = within(step(3)).getByRole('button', { name: '改名并转 CPU' }) as HTMLButtonElement;
    expect(localBtn.disabled).toBe(true);
    expect(within(step(3)).getByText(/预检有阻断项，转换按钮已禁用/)).toBeTruthy();
  });

  it('权限：OIDC 账号缺 club.bindings.unbind 时步骤 4 禁用并说明', async () => {
    apiMock.mockResolvedValue({ ...HUMAN, club: { ...HUMAN.club, isCpu: true }, checks: { ...HUMAN.checks, isCpu: true } });
    const oidcNoUnbind: AuthState = {
      user: { id: 2, name: '普通管理', role: 'admin', locked: false, mustChangePw: false, permissions: ['club.clubs.manage'] },
      authMode: 'oidc',
      authHome: null,
    };
    renderPage('/admin/clubs/to-cpu?id=77', oidcNoUnbind);
    expect(await screen.findByText(/当前账号没有 club\.bindings\.unbind 权限/)).toBeTruthy();
    const btn = within(step(4)).getByRole('button', { name: /一键解绑全部/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('部分解绑失败：逐行展示失败账号与原因，并可重试', async () => {
    apiMock.mockResolvedValue({
      ...HUMAN,
      club: { ...HUMAN.club, isCpu: true },
      bindings: [
        { userId: 5, userName: '张三', boundAt: '2026-11-01T00:00:00.000Z' },
        { userId: 6, userName: null, boundAt: '2026-11-02T00:00:00.000Z' },
      ],
      checks: { ...HUMAN.checks, isCpu: true },
    });
    apiPostMock.mockResolvedValue({
      ok: false,
      unbound: [5],
      alreadyUnbound: [],
      failed: [{ userId: 6, code: 'auth_unavailable', message: '认证中心暂时不可用' }],
    });
    renderPage('/admin/clubs/to-cpu?id=77');
    await screen.findByText(/步骤 4 ·/);
    expect(within(step(4)).getByText(/张三/)).toBeTruthy();

    const btn = within(step(4)).getByRole('button', { name: '一键解绑全部（2）' });
    fireEvent.click(btn); // 第一次只进入确认态
    fireEvent.click(btn);
    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/admin/clubs/77/to-cpu/unbind-all', {}),
    );
    expect(await within(step(4)).findByText(/失败 1 个/)).toBeTruthy();
    expect(within(step(4)).getByText('auth_unavailable')).toBeTruthy();
    expect(within(step(4)).getByText('认证中心暂时不可用')).toBeTruthy();
    expect(within(step(4)).getByRole('button', { name: '重试失败的账号' })).toBeTruthy();
  });

  it('复核：六项 checks 全通过时显示 ready', async () => {
    apiMock.mockResolvedValue(READY);
    renderPage('/admin/clubs/to-cpu?id=77');
    expect(await screen.findByText(/六项全部通过，转换完成/)).toBeTruthy();
    const review = step(5);
    expect(within(review).getAllByText('通过').length).toBe(6);
    expect(within(review).queryByText('未通过')).toBeNull();
  });

  it('确认框写明四项后果（阵容/合同、海捞、不收转会费、余额与券不退回）', async () => {
    apiMock.mockResolvedValue(HUMAN);
    renderPage('/admin/clubs/to-cpu?id=77');
    await screen.findByText(/对手方在赛事系统里现在叫/);
    const local = step(3);
    expect(within(local).getByText(/保留现有阵容与合同/)).toBeTruthy();
    expect(within(local).getByText(/转 CPU 后球员可被其他球队海捞/)).toBeTruthy();
    expect(within(local).getByText(/CPU 队不收转会费/)).toBeTruthy();
    expect(within(local).getByText(/余额 12.50m、消费券 2.50 将被回收，重新接管时不退回/)).toBeTruthy();
  });
});
