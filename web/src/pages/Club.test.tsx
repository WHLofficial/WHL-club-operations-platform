// @vitest-environment jsdom
// /club 重定向壳（web/src/pages/Club.tsx，v3.4.0 步骤 8）：
// 球队中心正文搬进 /clubs/:id 后，老入口靠这里转走 —— 绑定过的转自己的队，没绑的转登记页。
// 三种状态各钉一条：在途不闪跳、已绑定去 /clubs/:id、未绑定去 /bind。
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeUser, MyClubOverview } from '../lib/api.ts';
import Club from './Club.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api.ts', () => ({ api: apiMock }));

// 登录态由用例自己定；Club 的加载闸门是「user 非空 + me/club 在途」
const { authState } = vi.hoisted(() => ({ authState: { user: null as unknown } }));
vi.mock('../lib/auth.tsx', () => ({
  useAuth: () => ({ user: authState.user, authMode: 'shared', authHome: null }),
}));

const COACH: MeUser = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false };

function meFixture(clubId: number | null): MyClubOverview {
  if (clubId === null) return { club: null, balance: null, squadCount: null, window: null, home: null };
  return {
    club: { id: clubId, name: '阿森纳', leagueTier: 'premier', logoKey: null, status: 'active', transferBanned: false },
    balance: 12.5,
    squadCount: 24,
    window: { season: 9, windowSeq: 3 },
    home: null,
  };
}

// 三个落点各放一个哨兵元素，断言「转到了哪一页」比读 URL 更贴近用户看到的东西
function renderClub(me: MyClubOverview | Promise<never> | Error) {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/me/club') {
      if (me instanceof Error) return Promise.reject(me);
      return me instanceof Promise ? me : Promise.resolve(me);
    }
    return Promise.reject(new Error(`未桩的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/club']}>
        <Routes>
          <Route path="/club" element={<Club />} />
          <Route path="/clubs/:id" element={<p>球队详情哨兵</p>} />
          <Route path="/bind" element={<p>球队登记哨兵</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  authState.user = null;
});

describe('/club 重定向壳（v3.4.0 步骤 8）', () => {
  it('绑定过的教练转到自己球队的详情页', async () => {
    authState.user = COACH;
    renderClub(meFixture(73));

    expect(await screen.findByText('球队详情哨兵')).toBeTruthy();
    expect(screen.queryByText('球队登记哨兵')).toBeNull();
  });

  it('没绑俱乐部的登录用户转到球队登记页', async () => {
    authState.user = COACH;
    renderClub(meFixture(null));

    expect(await screen.findByText('球队登记哨兵')).toBeTruthy();
    expect(screen.queryByText('球队详情哨兵')).toBeNull();
  });

  it('me/club 还在途时先给加载态，不抢先跳到 /bind', async () => {
    authState.user = COACH;
    renderClub(new Promise<never>(() => {}));

    expect(await screen.findByText('正在确认你的球队…')).toBeTruthy();
    expect(screen.queryByText('球队登记哨兵')).toBeNull();
    expect(screen.queryByText('球队详情哨兵')).toBeNull();
  });

  // 绑着队的教练碰上瞬时 403/500 时，跳 /bind 会把他送到「一账号只能绑一队」的登记页
  it('me/club 取不到时报错留在原地，不当成没绑队送去登记页', async () => {
    authState.user = COACH;
    renderClub(new Error('403'));

    expect(await screen.findByText('球队信息暂时取不到，稍后再试。')).toBeTruthy();
    expect(screen.queryByText('球队登记哨兵')).toBeNull();
    expect(screen.queryByText('球队详情哨兵')).toBeNull();
  });
});
