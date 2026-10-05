// @vitest-environment jsdom
// v6.31.0 广告板（/market/board + 在售市场页 teaser）前端口径：
// 置顶区只放 emphasis=2（无置顶时整块连标题一起消失）、0/1 进栅格、三档视觉杠杆挂类、
// 图例 / 空态 / 截断提示，「换一批」的手动重排（只动 emphasis=0、每次必换序、付费档永在首），
// 以及 teaser 的三张迷你卡 + 「查看全部 N 人 →」+ 无数据不渲染。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransferBoardResponse, TransferBoardRow } from '../../lib/api.ts';
import MarketAdBoardPage, { AdBoardTeaser } from './MarketAdBoardPage.tsx';

// 组件与 queries 都从 lib/api.ts 取函数：一处 mock，页面与 teaser 都走 apiMock；
// v6.33.0 报价弹层（AdBidModal）的送单走 apiPost，同样在这里接管
const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: apiPostMock };
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
    logoKey: null,
    listPrice: 180,
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
  row({ id: 2, name: '推荐乙', emphasis: 1, ca: 84, pa: 90, listPrice: 60, releaseFee: null }),
  row({ id: 3, name: '普通丙', emphasis: 0, ca: 61, pa: 70 }),
]);

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiPostMock.mockReset();
});

describe('v6.31.0 广告板页（MarketAdBoardPage）', () => {
  it('页头：标题、导航第 2 项「广告板」与说明行', async () => {
    renderPage(MIXED);
    expect(await screen.findByText('置顶甲')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('转会市场 · 广告板');
    expect(screen.getByRole('link', { name: '广告板' }).getAttribute('href')).toBe('/market/board');
    expect(screen.getByText('各队公开挂出的转会名单：标价公开，达线且对方开了自动同意才自动成交；低于标价视为砍价，进人工谈判。')).toBeTruthy();
  });

  it('卡片左上角队徽（v6.32.0）：有 logoKey 出 R2 图，无徽回哈希色块首字（取队名首字）', async () => {
    const { container } = renderPage(
      board([row({ id: 1, name: '有徽丁', logoKey: 'club/1.png' }), row({ id: 2, name: '无徽戊' })]),
    );
    await screen.findByText('有徽丁');
    const imgs = container.querySelectorAll('.adb-card img.team-logo');
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute('src')).toBe('/api/media/club/1.png');
    const fallbacks = container.querySelectorAll('.adb-card .team-logo-fallback');
    expect(fallbacks.length).toBe(1);
    // 回退字是队名首字（夹具 clubName 默认「曼城」），不是球员名
    expect(fallbacks[0].textContent).toBe('曼');
  });

  it('置顶区：只放 emphasis=2 的行，标题带个数与付费位口径', async () => {    const { container } = renderPage(MIXED);
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
    renderPage(board([row({ id: 1, name: '甲' })]));
    expect(await screen.findByText('甲')).toBeTruthy();
    expect(screen.queryByText(/共 .* 人在名单/)).toBeNull();
  });

  it('换一批：无付费加权的行不足 2 个时不渲染按钮（点了也没意义）', async () => {
    const { container } = renderPage(MIXED); // MIXED 只有 1 个 emphasis = 0
    expect(await screen.findByText('普通丙')).toBeTruthy();
    expect(container.querySelector('.adb-shuffle')).toBeNull();
    expect(screen.queryByRole('button', { name: /换一批/ })).toBeNull();
  });

  it('换一批：普通档 ≥2 时点一次必换序（同一批人、付费档仍在首、置顶不进栅格）', async () => {
    const { container } = renderPage(
      board([
        row({ id: 1, name: '置顶甲', emphasis: 2 }),
        row({ id: 2, name: '推荐乙', emphasis: 1 }),
        row({ id: 3, name: '普通丙', emphasis: 0 }),
        row({ id: 4, name: '普通丁', emphasis: 0 }),
        row({ id: 5, name: '普通戊', emphasis: 0 }),
      ]),
    );
    expect(await screen.findByText('普通丙')).toBeTruthy();
    const order = () =>
      [...container.querySelectorAll('.adb-grid .adb-card .adb-nm')].map((el) => el.textContent ?? '');
    const before = order();
    expect(before).toEqual(['推荐乙', '普通丙', '普通丁', '普通戊']);

    const btn = screen.getByRole('button', { name: /换一批/ });
    fireEvent.click(btn);
    const after = order();
    // 每次点都必须换出不同顺序（实现里「洗回原序就再洗 + 兜底反转」保证不空转）
    expect(after).not.toEqual(before);
    expect(after[0]).toBe('推荐乙');
    expect([...after].sort()).toEqual([...before].sort());
    expect(container.querySelector('.adb-grid')!.textContent).not.toContain('置顶甲');

    fireEvent.click(btn);
    expect(order()).not.toEqual(after);
  });

  it('名单变化时手动序自动回落服务端序（旧 id 序列不硬套：不丢人、不重复、不报错）', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rows = (ids: Array<[number, string, 0 | 1 | 2]>) =>
      board(ids.map(([id, name, emphasis]) => row({ id, name, emphasis })));
    apiMock.mockResolvedValue(
      rows([
        [1, '置顶甲', 2],
        [2, '推荐乙', 1],
        [3, '普通丙', 0],
        [4, '普通丁', 0],
        [5, '普通戊', 0],
      ]),
    );
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MarketAdBoardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('普通丙')).toBeTruthy();
    const order = () =>
      [...container.querySelectorAll('.adb-grid .adb-card .adb-nm')].map((el) => el.textContent ?? '');
    fireEvent.click(screen.getByRole('button', { name: /换一批/ }));
    expect(order()).not.toEqual(['推荐乙', '普通丙', '普通丁', '普通戊']);

    // 普通丙退出名单（重新取数后普通档从 3 人变 2 人）⇒ 手动序失效，回落服务端序
    apiMock.mockResolvedValue(
      rows([
        [1, '置顶甲', 2],
        [2, '推荐乙', 1],
        [4, '普通丁', 0],
        [5, '普通戊', 0],
      ]),
    );
    await act(async () => {
      await qc.invalidateQueries();
    });
    expect(await screen.findByText('普通丁')).toBeTruthy();
    expect(order()).toEqual(['推荐乙', '普通丁', '普通戊']);
  });

  it('名单变长时手动序也回落（新进名单的人不能被旧 id 序列挤掉）', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rows = (ids: Array<[number, string, 0 | 1 | 2]>) =>
      board(ids.map(([id, name, emphasis]) => row({ id, name, emphasis })));
    apiMock.mockResolvedValue(
      rows([
        [1, '置顶甲', 2],
        [2, '推荐乙', 1],
        [3, '普通丙', 0],
        [4, '普通丁', 0],
        [5, '普通戊', 0],
      ]),
    );
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MarketAdBoardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('普通丙')).toBeTruthy();
    const order = () =>
      [...container.querySelectorAll('.adb-grid .adb-card .adb-nm')].map((el) => el.textContent ?? '');
    fireEvent.click(screen.getByRole('button', { name: /换一批/ }));
    expect(order().length).toBe(4); // 推荐 + 3 普通

    // 普通己新进名单：旧的手动序（长度 3）必须失效，否则新人会被挤掉（只剩 3 张卡）
    apiMock.mockResolvedValue(
      rows([
        [1, '置顶甲', 2],
        [2, '推荐乙', 1],
        [3, '普通丙', 0],
        [4, '普通丁', 0],
        [5, '普通戊', 0],
        [6, '普通己', 0],
      ]),
    );
    await act(async () => {
      await qc.invalidateQueries();
    });
    expect(await screen.findByText('普通己')).toBeTruthy();
    expect(order()).toEqual(['推荐乙', '普通丙', '普通丁', '普通戊', '普通己']);
  });

  // ---- v6.33.0：卡脚圆形「报」按钮 + 报价弹层（AdBidModal） ----

  it('报价按钮：每张卡（置顶/推荐/普通）卡脚都有，aria-label 点名球员', async () => {
    const { container } = renderPage(MIXED);
    expect(await screen.findByText('普通丙')).toBeTruthy();
    expect(container.querySelectorAll('.adb-bid-btn').length).toBe(3);
    expect(screen.getByRole('button', { name: '给 置顶甲 报价' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '给 推荐乙 报价' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '给 普通丙 报价' })).toBeTruthy();
  });

  it('点击卡脚按钮弹报价层：role=dialog 点名球员，金额初值就是公开标价', async () => {
    renderPage(MIXED);
    fireEvent.click(await screen.findByRole('button', { name: '给 置顶甲 报价' }));
    const dialog = screen.getByRole('dialog', { name: '给 置顶甲 报价' });
    expect(within(dialog).getByText('给 置顶甲 报价')).toBeTruthy();
    // 初值是 String(listPrice)（"180"），不是 amount() 的两位小数格式
    expect((screen.getByLabelText('报价金额') as HTMLInputElement).value).toBe('180');
    expect(screen.getByLabelText('报价附言')).toBeTruthy();
    expect(within(dialog).getByText(/对方标价 180\.00 m/)).toBeTruthy();
  });

  it('送出报价：POST /api/offers 带默认金额=标价、无附言，pending 反馈文案', async () => {
    apiPostMock.mockResolvedValue({ offerId: 7, status: 'pending' });
    renderPage(MIXED);
    fireEvent.click(await screen.findByRole('button', { name: '给 置顶甲 报价' }));
    fireEvent.click(screen.getByRole('button', { name: '送出报价' }));
    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/offers', { playerId: 1, amount: 180, note: undefined }),
    );
    expect(await screen.findByText('报价已送出（#7），等卖家表态。')).toBeTruthy();
  });

  it('弹层金额可改：改动后按新金额送单，附言一并带上', async () => {
    apiPostMock.mockResolvedValue({ offerId: 8, status: 'pending' });
    renderPage(MIXED);
    fireEvent.click(await screen.findByRole('button', { name: '给 推荐乙 报价' }));
    fireEvent.change(screen.getByLabelText('报价金额'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('报价附言'), { target: { value: '交个朋友' } });
    fireEvent.click(screen.getByRole('button', { name: '送出报价' }));
    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/offers', { playerId: 2, amount: 15, note: '交个朋友' }),
    );
  });

  it('送单失败：错误文案透出在弹层侧栏（.bid-err），表单保留可重试', async () => {
    apiPostMock.mockRejectedValue(new Error('先登录'));
    const { container } = renderPage(MIXED);
    fireEvent.click(await screen.findByRole('button', { name: '给 普通丙 报价' }));
    fireEvent.click(screen.getByRole('button', { name: '送出报价' }));
    expect(await screen.findByText('先登录')).toBeTruthy();
    expect(container.querySelector('.bid-err')?.textContent).toBe('先登录');
    expect(screen.getByLabelText('报价金额')).toBeTruthy(); // 没切到结果视图
  });

  it('标价口径：卡内标签是「标价」（原来的「最低报价」全文不再出现）', async () => {
    renderPage(MIXED);
    expect(await screen.findByText('普通丙')).toBeTruthy();
    expect(screen.getAllByText('标价').length).toBe(3); // 每张卡一个
    expect(screen.queryByText('最低报价')).toBeNull();
    expect(document.body.textContent).not.toContain('最低报价');
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
    // v6.33.0：迷你卡整卡是链接，不挂报价按钮（报价入口只在广告板页的卡脚）
    expect(within(mini).queryByRole('button')).toBeNull();
    expect(mini.querySelector('.adb-bid-btn')).toBeNull();
  });

  it('无数据：整块不渲染（不留空卡）', async () => {
    const { container } = renderTeaser(board([], 0));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('广告板')).toBeNull();
  });
});
