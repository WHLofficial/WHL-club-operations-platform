// @vitest-environment jsdom
// v6.32.0 转会台页签化，页面级聚焦测试（区块内部行为归各自组件，见 OffersSection.test.tsx）：
// - 默认落签约谈判、三区块条件挂载（一次只挂一个）
// - 页签自带计数：谈判=active 会话数 / 报价=两侧 pendingMine 之和 / 出价=active 出价数
// - ?tab= 深链语义：offers+bids 直落、mine alias 不改写 URL、非法值回落 nego 也不改写、点当前页签不写 URL
// - 待办速览条退役、流水线说明条精简一行（机制句收进报价区块 hint）
// - 门禁三分支（教练身份失败 / 非教练）、计数查询与区块查询同键去重
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarketDeskPage from './MarketDeskPage.tsx';

const { apiMock, authMock } = vi.hoisted(() => ({ apiMock: vi.fn(), authMock: vi.fn() }));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: vi.fn() };
});
vi.mock('../../../lib/auth.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/auth.tsx')>();
  return { ...mod, useAuth: authMock };
});

// useMyClub 读 /api/me/club；登录态由 useAuth 决定（默认教练）
authMock.mockReturnValue({
  user: { id: 1, name: '教练甲', role: 'coach' },
  authMode: 'shared',
  authHome: null,
});

const ME_CLUB = {
  club: { id: 1, name: '阿森纳', leagueTier: 'premier', logoKey: null, status: 'normal' },
  balance: 100,
  squadCount: 3,
  window: { season: 9, windowSeq: 1 },
  home: null,
};

const OFFERS_IN = { club: { id: 1, name: '阿森纳' }, box: 'in', items: [], nextCursor: null, pendingMine: 1, intentsMine: 0 };
// out 侧 pendingMine=2：报价计数「两侧之和」这个不变量只有在这才可分辨（e2e 夹具 out=0 分不出，见测试计划 §3）
const OFFERS_OUT = { club: { id: 1, name: '阿森纳' }, box: 'out', items: [], nextCursor: null, pendingMine: 2, intentsMine: 0 };

const negoSession = (over: Record<string, unknown>) => ({
  id: 21,
  transferId: 31,
  status: 'active',
  transfer: { type: 'transfer', status: 'pending_review', fee: 12.5 },
  fromClubName: '阿森纳',
  toClubName: '巴塞罗那',
  player: { id: 7, fcId: 100007, name: '中场丙', position: 'CM', age: 24, ca: 74, pa: 82 },
  agentTier: 2,
  agentTierLabel: '二级经纪人',
  releaseFee: null,
  rcBounds: [4, 8],
  expectedWage: 5.5,
  attemptsUsed: 0,
  remaining: 3,
  lastSatisfaction: null,
  lastRisk: false,
  attempts: [],
  settled: null,
  ...over,
});
const NEGOTIATIONS = {
  sessions: [
    negoSession({}),
    negoSession({ id: 22, transferId: 32, releaseFee: 9, rcBounds: [6, 12], remaining: 2, attemptsUsed: 1 }),
    // settled 会话：页签计数不得计入（只数 active），也不再渲染「已落定的谈判」表
    negoSession({
      id: 23,
      transferId: 33,
      status: 'settled',
      releaseFee: 9,
      remaining: 0,
      attemptsUsed: 1,
      settled: { wage: 6.25, source: 'negotiation', message: '谈妥签约' },
      player: { id: 8, fcId: 100008, name: '前锋丁', position: 'ST', age: 26, ca: 78, pa: 80 },
    }),
  ],
};

const BIDS = {
  bids: [
    { id: 51, listingId: 11, amount: 8, createdAt: '2026-09-20T09:00:00Z', status: 'active', holdStatus: 'held', listingStatus: 'bidding', askPrice: 7, sellerClubName: '巴黎圣日耳曼', player: { id: 5, fcId: 100005, name: '边锋戊' } },
    { id: 52, listingId: 12, amount: 15, createdAt: '2026-09-19T09:00:00Z', status: 'won', holdStatus: 'held', listingStatus: 'pending_review', askPrice: 14, sellerClubName: '巴塞罗那', player: { id: 7, fcId: 100007, name: '中场丙' } },
    { id: 53, listingId: 13, amount: 6, createdAt: '2026-09-18T09:00:00Z', status: 'won', holdStatus: 'settled', listingStatus: 'matched_pending', askPrice: 6, sellerClubName: 'AC米兰', player: { id: 9, fcId: 100009, name: '后卫己' } },
  ],
};

function stubApi(over: { clubError?: boolean } = {}) {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/me/club') {
      return over.clubError ? Promise.reject(new Error('取不到')) : Promise.resolve(ME_CLUB);
    }
    if (path === '/api/negotiations?mine=1') return Promise.resolve(NEGOTIATIONS);
    if (path === '/api/me/bids') return Promise.resolve(BIDS);
    if (path === '/api/offers?box=in&status=pending') return Promise.resolve(OFFERS_IN);
    if (path === '/api/offers?box=out&status=pending') return Promise.resolve(OFFERS_OUT);
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
}

// URL 探针：MemoryRouter 不写 window.location，用路由位置断言 ?tab= 语义
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.pathname + loc.search}</span>;
}

// 历史探针：location.key 只在导航（push/replace）时变化，普通 re-render 不变 ⇒
// 集合大小 = 实际发生的导航次数 + 1。专防「点当前页签又写了一次 URL」这类不改变 search 串的坏改。
function HistoryProbe({ seen }: { seen: Set<string> }) {
  const loc = useLocation();
  seen.add(loc.key);
  return null;
}

function renderDesk(entry = '/market/desk', stubOpts: { clubError?: boolean } = {}) {
  stubApi(stubOpts);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const seenKeys = new Set<string>();
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <HistoryProbe seen={seenKeys} />
        <LocationProbe />
        <MarketDeskPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, seenKeys };
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('v6.32.0 转会台页签化（MarketDeskPage）', () => {
  it('默认落签约谈判页签：只挂 nego 区块，流水线一行在场，待办速览退役', async () => {
    const { container } = renderDesk();
    // 夹具两条 active 会话都链「中场丙」⇒ findAllByText
    expect((await screen.findAllByText('中场丙')).length).toBeGreaterThan(0); // active 会话卡渲染
    expect(container.querySelector('#desk-nego')).toBeTruthy();
    expect(container.querySelector('#desk-offers')).toBeNull();
    expect(container.querySelector('#desk-bids')).toBeNull();
    // 流水线一行：徽标链在，机制句不再重复（唯一讲解点在报价区块 hint）
    const pipe = container.querySelector('[aria-label="转会流水线"]')!;
    expect(pipe).toBeTruthy();
    expect(pipe.textContent).toContain('管理组审核');
    expect(container.querySelector('[aria-label="待办速览"]')).toBeNull();
    // settled 会话既不渲染也不进「已落定的谈判」表（TC-CLEAN-01）
    expect(screen.queryByText('前锋丁')).toBeNull();
    expect(screen.queryByText('已落定的谈判')).toBeNull();
  });

  it('页签计数：谈判 2（只数 active）/ 报价 3（in 1 + out 2）/ 出价 1（只数 active）', async () => {
    renderDesk();
    expect((await screen.findAllByText('中场丙')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /签约谈判\s*2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /报价\s*3/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /我的出价\s*1/ })).toBeTruthy();
  });

  it('点页签切换条件挂载：切报价 → nego 卸载；机制句「报价被接受 ≠ 成交」在报价 hint', async () => {
    renderDesk();
    await screen.findAllByText('中场丙');
    fireEvent.click(screen.getByRole('button', { name: /报价\s*3/ }));
    // 行内 span 会把整句拆成多个文本节点 ⇒ 用正则做子串匹配
    expect(await screen.findByText(/报价被接受 ≠ 成交/)).toBeTruthy();
    expect(screen.queryByText('中场丙')).toBeNull(); // 谈判区块已卸载
    expect(screen.getByTestId('loc').textContent).toBe('/market/desk?tab=offers');
  });

  it('深链 ?tab=offers&box=out：直落报价页签且「我送出的」选中', async () => {
    const { container } = renderDesk('/market/desk?tab=offers&box=out');
    await screen.findByText(/报价被接受 ≠ 成交/);
    expect(container.querySelector('#desk-offers')).toBeTruthy();
    expect(container.querySelector('#desk-nego')).toBeNull();
    const boxSeg = container.querySelector('[aria-label="报价页签"]')!;
    expect(boxSeg.querySelector('button.on')!.textContent).toContain('我送出的');
  });

  it('旧链 ?tab=mine 是 bids 的 alias：渲染出价区块且 URL 不改写', async () => {
    const { container } = renderDesk('/market/desk?tab=mine');
    expect(await screen.findByText('边锋戊')).toBeTruthy();
    expect(container.querySelector('#desk-bids')).toBeTruthy();
    expect(container.querySelector('#desk-nego')).toBeNull();
    expect(screen.getByTestId('loc').textContent).toBe('/market/desk?tab=mine');
  });

  it('非法 ?tab=xxx 回落签约谈判，且不改写 URL', async () => {
    const { container } = renderDesk('/market/desk?tab=xxx');
    expect((await screen.findAllByText('中场丙')).length).toBeGreaterThan(0);
    expect(container.querySelector('#desk-nego')).toBeTruthy();
    expect(screen.getByTestId('loc').textContent).toBe('/market/desk?tab=xxx');
  });

  it('点当前页签不写 URL（同址不新增历史记录，导航次数 = 0）', async () => {
    const { seenKeys } = renderDesk('/market/desk?tab=bids');
    expect(await screen.findByText('边锋戊')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /我的出价\s*1/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId('loc').textContent).toBe('/market/desk?tab=bids');
    // key 集合只含初始条目 ⇒ 两次点击零导航
    expect(seenKeys.size).toBe(1);
  });

  it('报价页签挂载不引入额外语义的 /api/offers 形状（计数与区块共用 in&pending / out&pending 两键）', async () => {
    // 注：区块挂载时同键因 staleTime=0 的 refetchOnMount 会重发一次（v6.23.0 以来既有语义），
    // 这里锁的真实不变量是「请求形状集合不扩大」——没有第三个 /api/offers 键被发明出来。
    renderDesk('/market/desk?tab=offers');
    await screen.findByText(/报价被接受 ≠ 成交/);
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(0));
    const offerPaths = apiMock.mock.calls.map(([p]) => p as string).filter((p) => p.startsWith('/api/offers'));
    expect(new Set(offerPaths)).toEqual(
      new Set(['/api/offers?box=in&status=pending', '/api/offers?box=out&status=pending']),
    );
  });

  it('门禁：非教练只给观众引导；身份取不到不误诊成未绑定', async () => {
    authMock.mockReturnValue({ user: { id: 2, name: '观众乙', role: 'spectator' }, authMode: 'shared', authHome: null });
    const { container: c1 } = renderDesk();
    expect(await screen.findByText(/这里只对教练开放/)).toBeTruthy();
    expect(c1.querySelector('#desk-nego')).toBeNull();
    cleanup();

    // 先 stub 再渲染：mount 即拉 /api/me/club，渲染后才换 stub 会漏接（假绿成有数据）
    authMock.mockReturnValue({ user: { id: 1, name: '教练甲', role: 'coach' }, authMode: 'shared', authHome: null });
    const { container: c2 } = renderDesk('/market/desk', { clubError: true });
    expect(await screen.findByText(/俱乐部身份暂时取不到/)).toBeTruthy();
    expect(c2.querySelector('#desk-nego')).toBeNull();
  });
});
