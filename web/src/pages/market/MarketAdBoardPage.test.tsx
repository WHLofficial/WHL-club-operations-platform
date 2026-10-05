// @vitest-environment jsdom
// v6.31.0 广告板（/market/board + 在售市场页 teaser）前端口径：
// 置顶区只放 emphasis=2（无置顶时整块连标题一起消失）、0/1 进栅格、三档视觉杠杆挂类、
// 图例 / 空态 / 截断提示，以及 teaser 的三张迷你卡 + 「查看全部 N 人 →」+ 无数据不渲染。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransferBoardResponse, TransferBoardRow } from '../../lib/api.ts';
import MarketAdBoardPage, { AdBoardTeaser } from './MarketAdBoardPage.tsx';

// 组件与 queries 都从 lib/api.ts 取函数：一处 mock，页面与 teaser 都走 apiMock
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock };
});

function row(patch: Partial<TransferBoardRow> = {}): TransferBoardRow {
  return {
    id: 1,
    uid: 'p1',
    fcId: null,
    name: '哈兰德',
    positions: ['ST'],
    age: 24,
    ca: 94,
    pa: 95,
    clubId: 3,
    clubName: '曼城',
    minOfferPrice: 180,
    releaseFee: 240,
    listedAt: '2026-10-03T00:00:00.000Z',
    emphasis: 0,
    emphasisUntil: null,
    status: 'normal',
    notForSale: false,
    transferPriced: true,
    ...patch,
  };
}

function board(players: TransferBoardRow[], total = players.length): TransferBoardResponse {
  return { players, total };
}

function stub(fixture: TransferBoardResponse) {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/market/transfer-board')) return Promise.resolve(fixture);
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
}

function shell(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPage(fixture: TransferBoardResponse) {
  stub(fixture);
  return shell(<MarketAdBoardPage />);
}

function renderTeaser(fixture: TransferBoardResponse) {
  stub(fixture);
  return shell(<AdBoardTeaser />);
}

// 三档夹具：1 置顶 + 1 推荐 + 1 普通
const MIXED = board([
  row({ id: 1, name: '置顶甲', emphasis: 2, emphasisUntil: '2026-10-12T12:00:00.000Z' }),
  row({ id: 2, name: '推荐乙', emphasis: 1, ca: 84, pa: 90, minOfferPrice: 60, releaseFee: null }),
  row({ id: 3, name: '普通丙', emphasis: 0, ca: 61, pa: 70 }),
]);

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('v6.31.0 广告板页（MarketAdBoardPage）', () => {
  it('页头：标题、导航第 2 项「广告板」与说明行', async () => {
    renderPage(MIXED);
    expect(await screen.findByText('置顶甲')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('转会市场 · 广告板');
    expect(screen.getByRole('link', { name: '广告板' }).getAttribute('href')).toBe('/market/board');
    expect(screen.getByText('各队公开挂出的转会名单：标价公开，出价达线自动成交，低于自动拒。')).toBeTruthy();
  });

  it('置顶区：只放 emphasis=2 的行，标题带个数与付费位口径', async () => {
    const { container } = renderPage(MIXED);
    expect(await screen.findByText('置顶甲')).toBeTruthy();
    expect(screen.getByText('1 个 · 付费位，按到期时间排')).toBeTruthy();
    // 带标题的「置顶」在 .adb-band-lab 里（卡片角标也是「置顶」二字 ⇒ 必须按带子作用域取，不能全局 getByText）
    expect(within(container.querySelector('.adb-band') as HTMLElement).getByText('置顶')).toBeTruthy();
    const fc = container.querySelector('.adb-fcard');
    expect(fc).toBeTruthy();
    expect(fc!.textContent).toContain('置顶甲');
    expect(container.querySelectorAll('.adb-fcard').length).toBe(1);
    // 置顶行的脚部：到期日（走 useTimeFmt().date）
    expect(fc!.textContent).toContain('置顶到 2026-10-12');
  });

  it('无置顶行：整条带子连标题一起不渲染', async () => {
    const { container } = renderPage(
      board([row({ id: 2, name: '推荐乙', emphasis: 1 }), row({ id: 3, name: '普通丙' })]),
    );
    expect(await screen.findByText('推荐乙')).toBeTruthy();
    expect(container.querySelector('.adb-feature')).toBeNull();
    expect(container.querySelector('.adb-fcard')).toBeNull();
    expect(screen.queryByText(/付费位，按到期时间排/)).toBeNull();
    expect(screen.queryByText('置顶')).toBeNull();
  });

  it('栅格：emphasis 0/1 进 .adb-grid，置顶行不进栅格', async () => {
    const { container } = renderPage(MIXED);
    expect(await screen.findByText('普通丙')).toBeTruthy();
    const grid = container.querySelector('.adb-grid');
    expect(grid).toBeTruthy();
    expect(grid!.textContent).toContain('推荐乙');
    expect(grid!.textContent).toContain('普通丙');
    expect(grid!.textContent).not.toContain('置顶甲');
    expect(within(grid as HTMLElement).getByText('推荐乙').closest('.adb-card')?.className).toContain('emph-1');
  });

  it('推荐（着重度 1）：橙角标「推荐」+ 金色左轨 emph-1 类 + 名字加粗', async () => {
    renderPage(MIXED);
    expect(await screen.findByText('推荐乙')).toBeTruthy();
    const card = screen.getByText('推荐乙').closest('.adb-card') as HTMLElement;
    expect(card.className).toContain('emph-1');
    const badge = within(card).getByText('推荐');
    expect(badge.className).toContain('badge');
    expect(badge.className).toContain('orange');
    expect(screen.getByText('推荐乙').className).toContain('adb-nm');
  });

  it('置顶（着重度 2）：金角标「置顶」+ 通栏卡 emph-2 类', async () => {
    const { container } = renderPage(MIXED);
    expect(await screen.findByText('置顶甲')).toBeTruthy();
    const fc = container.querySelector('.adb-fcard') as HTMLElement;
    expect(fc.className).toContain('emph-2');
    const badge = within(fc).getByText('置顶');
    expect(badge.className).toContain('badge');
    expect(badge.className).toContain('gold');
    expect(within(fc).getByText('置顶甲').className).toContain('adb-nm');
  });

  it('普通（着重度 0）：无角标、无 emph 类，CA/PA 走既有色阶、金额与缺失值口径', async () => {
    renderPage(MIXED);
    expect(await screen.findByText('普通丙')).toBeTruthy();
    const plain = screen.getByText('普通丙').closest('.adb-card') as HTMLElement;
    expect(plain.className).not.toContain('emph-1');
    expect(within(plain).queryByText('推荐')).toBeNull();
    expect(within(plain).queryByText('置顶')).toBeNull();
    // attrClass 五档阈值：≤50 bad / ≤60 weak / ≤70 mid / ≤80 solid / >80 good（web/src/lib/players-library.ts:71）
    expect(within(plain).getByText('61').className).toContain('attr-mid');
    const rec = screen.getByText('推荐乙').closest('.adb-card') as HTMLElement;
    expect(within(rec).getByText('84').className).toContain('attr-good');
    expect(within(rec).getByText('60.00 m')).toBeTruthy();
    expect(within(rec).getByText('—')).toBeTruthy(); // 无合同：违约金显示 —，不拼「— M」
  });

  it('状态图标与图例：名单行出「转会名单」图标，页底有图例', async () => {
    const { container } = renderPage(MIXED);
    expect(await screen.findByText('普通丙')).toBeTruthy();
    expect(screen.getAllByLabelText('转会名单').length).toBeGreaterThan(0);
    expect(container.querySelector('.transfer-status-legend')).toBeTruthy();
  });

  it('空态：两行文案，且不出栅格', async () => {
    const { container } = renderPage(board([], 0));
    expect(await screen.findByText('现在没有球队挂出转会名单。')).toBeTruthy();
    expect(screen.getByText('球员被列入转会名单后就会出现在这里。')).toBeTruthy();
    expect(container.querySelector('.adb-grid')).toBeNull();
    expect(container.querySelector('.transfer-status-legend')).toBeNull();
  });

  it('截断提示：total 大于展示数时出「共 N 人在名单，这里展示前 M 人」', async () => {
    renderPage(board([row({ id: 1, name: '甲' }), row({ id: 2, name: '乙' })], 12));
    expect(await screen.findByText('甲')).toBeTruthy();
    expect(screen.getByText('共 12 人在名单，这里展示前 2 人')).toBeTruthy();
  });

  it('不截断时（total = 展示数）不出截断提示', async () => {
    renderPage(board([row({ id: 1, name: '甲' })], 1));
    expect(await screen.findByText('甲')).toBeTruthy();
    expect(screen.queryByText(/共 .* 人在名单/)).toBeNull();
  });
});

describe('v6.31.0 在售市场页小卡片（AdBoardTeaser）', () => {
  it('卡头与三张迷你卡：「N 人在名单」+「查看全部 N 人 →」链 /market/board', async () => {
    const { container } = renderTeaser(
      board(
        [
          row({ id: 1, name: '置顶甲', fcId: 71, emphasis: 2 }),
          row({ id: 2, name: '推荐乙', emphasis: 1 }),
          row({ id: 3, name: '普通丙' }),
        ],
        12,
      ),
    );
    expect(await screen.findByText('置顶甲')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('广告板');
    expect(screen.getByText('12 人在名单')).toBeTruthy();
    expect(screen.getByText('各队公开挂出的转会名单。')).toBeTruthy();
    expect(container.querySelectorAll('.adb-mini').length).toBe(3);
    const more = screen.getByRole('link', { name: '查看全部 12 人 →' });
    expect(more.getAttribute('href')).toBe('/market/board');
  });

  it('迷你卡：整张是球员链接（playerPath，fcId 优先），角标与状态图标随行', async () => {
    const { container } = renderTeaser(board([row({ id: 1, name: '置顶甲', fcId: 71, emphasis: 2 })], 1));
    expect(await screen.findByText('置顶甲')).toBeTruthy();
    const mini = container.querySelector('.adb-mini') as HTMLElement;
    expect(mini.getAttribute('href')).toBe('/players/71');
    expect(mini.className).toContain('emph-2');
    expect(within(mini).getByText('置顶').className).toContain('gold');
    expect(within(mini).getByLabelText('转会名单')).toBeTruthy();
    expect(within(mini).getByText('180.00 m')).toBeTruthy();
  });

  it('无数据：整块不渲染（不留空卡）', async () => {
    const { container } = renderTeaser(board([], 0));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('广告板')).toBeNull();
  });
});
