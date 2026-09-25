// @vitest-environment jsdom
// 球员库页面（web/src/pages/PlayersLibrary.tsx）的组件测试：表头排序驱动、左栏开合与摘要条、
// 窄屏筛选抽屉。前端此前零组件测试（vitest include 不含 web/），搬家后的交互全在这一层，
// 后端的排序/搜索行为则由 tests/players-library.test.ts 覆盖。
//
// 依赖打桩：api（俱乐部目录 / 列表 / 名册三个端点）、matchMedia（useMediaQuery 判断点）。
// 没打 CSS（jsdom 不跑样式表），所以样式类名只做「有没有这个类」的断言，视觉表现靠 e2e 截图看。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubDirectoryRow, PlayerLibraryRow, PlayersLibraryResponse } from '../lib/api.ts';
import PlayersLibrary, { psNames } from './PlayersLibrary.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api.ts', () => ({ api: apiMock }));

const CLUBS: ClubDirectoryRow[] = [
  { id: 1, name: '阿森纳', leagueTier: 'top' },
  { id: 243, name: '皇家马德里', leagueTier: 'top' },
];

function row(patch: Partial<PlayerLibraryRow> & { id: number; name: string }): PlayerLibraryRow {
  return {
    uid: `fc${200000 + patch.id}`,
    number: null,
    clubId: 1,
    position: 'ST',
    age: 24,
    ca: 70,
    pa: 85,
    prestige: 3,
    marketValue: 20,
    status: 'normal',
    growthTier: 2,
    isFutureStar: false,
    chinaPlan: false,
    agentTier: 2,
    badgesSilver: 1,
    badgesGold: 0,
    clubName: '阿森纳',
    growable: true,
    positions: ['ST'],
    influence: 0.42,
    wage: 1.5,
    releaseFee: 30,
    contractType: 'formal',
    foot: 1,
    baseCa: 60,
    fcId: 200000 + patch.id,
    source: 'import',
    serviceSeasons: 1.5,
    protected: true,
    ...patch,
  };
}

const ROWS: PlayerLibraryRow[] = [
  row({ id: 1, name: 'Šeško' }),
  row({ id: 2, name: 'Ødegaard', status: 'free', clubId: null, clubName: null }),
];

// matchMedia 打桩：useMediaQuery 在 useState 初始化时就调它，且要在测试里能切断点
type MediaListener = (event: MediaQueryListEvent) => void;
const mediaListeners = new Set<MediaListener>();
let mediaMatches = false;
function setNarrow(narrow: boolean): void {
  mediaMatches = narrow;
  for (const listener of mediaListeners) listener({ matches: narrow } as MediaQueryListEvent);
}

// 游标式分页条（v3.2.0）：服务端不再回 total，「还有更多 / 已到末页」只能看 nextCursor。
let pageCursor: string | null = null;

beforeEach(() => {
  mediaListeners.clear();
  mediaMatches = false;
  pageCursor = null;
  window.matchMedia = ((query: string) => ({
    matches: mediaMatches,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: MediaListener) => void mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: MediaListener) => void mediaListeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/clubs/directory') return Promise.resolve({ clubs: CLUBS });
    if (path === '/api/players/roster') return Promise.resolve({ roster: '', count: 0 });
    if (path.startsWith('/api/players?')) {
      const body: PlayersLibraryResponse = { players: ROWS, nextCursor: pageCursor };
      return Promise.resolve(body);
    }
    return Promise.reject(new Error(`测试没打桩的请求：${path}`));
  });
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  localStorage.clear();
  window.history.replaceState(null, '', '/players');
});

function open(url = '/players'): ReturnType<typeof userEvent.setup> {
  window.history.replaceState(null, '', url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <PlayersLibrary />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

// 位置改多选下拉后（v3.1.1 步骤 3），选一个位置要先开面板、再勾码位
async function pickPosition(user: ReturnType<typeof userEvent.setup>, side: HTMLElement, pos: string): Promise<void> {
  await user.click(within(side).getByRole('button', { name: /^位置/ }));
  await user.click(within(side).getByRole('checkbox', { name: pos }));
}

// 页面在 effect 里把筛选写回地址栏（replaceState），所以断言直接看 window.location.search
function search(): string {
  return window.location.search;
}

function lastListQuery(): string {
  const calls = apiMock.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/api/players?'));
  return calls[calls.length - 1] ?? '';
}

function headerButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('thead button.th-sort')];
}

function headerButton(label: string): HTMLButtonElement {
  const found = headerButtons().find((b) => b.textContent?.startsWith(label));
  if (!found) throw new Error(`没找到「${label}」表头，现有：${headerButtons().map((b) => b.textContent).join(' / ')}`);
  return found;
}

function headerTh(label: string): HTMLTableCellElement {
  return headerButton(label).closest('th') as HTMLTableCellElement;
}

describe('默认态与表头排序', () => {
  it('默认态不给任何列打 active；点 UID 从升序开始，再点翻向', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });

    // 默认走 players.id（源表注册顺序），没有哪一列真的在排序 —— 全列 ↕，不算假事实
    expect(headerTh('UID').getAttribute('aria-sort')).toBe('none');
    expect(document.querySelectorAll('thead th[aria-sort]:not([aria-sort="none"])')).toHaveLength(0);
    expect(headerButtons()).toHaveLength(12); // 固定 10 列 + 默认两列（身价、徽章）
    expect(search()).toBe('?limit=20');

    await user.click(headerButton('UID'));
    await waitFor(() => expect(search()).toBe('?sort=uid&order=asc&limit=20'));
    expect(headerTh('UID').getAttribute('aria-sort')).toBe('ascending');

    await user.click(headerButton('UID'));
    await waitFor(() => expect(search()).toBe('?sort=uid&order=desc&limit=20'));
    expect(headerTh('UID').getAttribute('aria-sort')).toBe('descending');
  });

  it('筛出来的列也能点排序；删掉该条件后排序与列一起回落默认（否决「排一个看不见的键」）', async () => {
    // 用「效力时长」当样本：它只由筛选带出来（身价/徽章是默认两列，撤掉筛选列也还在，测不出回落）
    const user = open('/players?effective_years_min=0&limit=20');
    await screen.findByRole('link', { name: 'Šeško' });
    expect(headerButton('效力时长')).toBeTruthy();

    await user.click(headerButton('效力时长'));
    await waitFor(() => expect(search()).toBe('?sort=years&order=desc&effective_years_min=0&limit=20'));
    expect(headerTh('效力时长').getAttribute('aria-sort')).toBe('descending');

    await user.click(screen.getByRole('button', { name: '移除筛选：效力时长 ≥ 0 赛季' }));
    await waitFor(() => expect(search()).toBe('?limit=20'));
    expect(headerButtons().some((b) => b.textContent?.startsWith('效力时长'))).toBe(false);
    expect(document.querySelectorAll('thead th[aria-sort]:not([aria-sort="none"])')).toHaveLength(0);
  });

  it('固定列的排序不受别的筛选影响（删掉筛出的列不会误伤）', async () => {
    const user = open('/players?effective_years_min=0&sort=ca&order=desc&limit=20');
    await screen.findByRole('link', { name: 'Šeško' });
    await user.click(screen.getByRole('button', { name: '移除筛选：效力时长 ≥ 0 赛季' }));
    await waitFor(() => expect(search()).toBe('?sort=ca&order=desc&limit=20'));
    expect(headerTh('CA').getAttribute('aria-sort')).toBe('descending');
  });

  it('属性列（attr:）用列名做标签，可点排序', async () => {
    const user = open('/players?attr=sprintspeed&limit=20');
    await screen.findByRole('link', { name: 'Šeško' });
    await user.click(headerButton('sprintspeed'));
    await waitFor(() => expect(search()).toBe('?sort=attr%3Asprintspeed&order=desc&attr=sprintspeed&limit=20'));
    expect(lastListQuery()).toContain('sort=attr%3Asprintspeed');
  });
});

describe('左栏开合与摘要条（宽屏）', () => {
  it('收起/展开把选择记在本地，且不出现遮罩', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const toggle = screen.getByRole('button', { name: /^筛选/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.lib-drawer-mask')).toBeNull();

    await user.click(toggle);
    expect(document.querySelector('.library-shell.collapsed')).not.toBeNull();
    expect(localStorage.getItem('players-library:side')).toBe('closed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle);
    expect(document.querySelector('.library-shell.collapsed')).toBeNull();
    expect(localStorage.getItem('players-library:side')).toBe('open');
  });

  it('上次收起过就默认收起（本地记忆生效）', async () => {
    localStorage.setItem('players-library:side', 'closed');
    open();
    await screen.findByRole('link', { name: 'Šeško' });
    expect(document.querySelector('.library-shell.collapsed')).not.toBeNull();
  });

  it('选中一项筛选：出 chip、工具条计数跟着走，点 chip 的 × 撤掉', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    // 没有筛选条件时摘要条整块不渲染（v3.1.1 步骤 5 起不再留「未设筛选条件」占位）
    expect(screen.queryByRole('group', { name: '已生效的筛选条件' })).toBeNull();

    const side = document.getElementById('library-side') as HTMLElement;
    await pickPosition(user, side, 'ST');
    await waitFor(() => expect(search()).toBe('?position=ST&limit=20'));
    expect(screen.getByRole('button', { name: '移除筛选：位置：ST' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^筛选（1）$/ })).toBeTruthy();
    expect(lastListQuery()).toContain('position=ST');

    await user.click(screen.getByRole('button', { name: '移除筛选：位置：ST' }));
    await waitFor(() => expect(search()).toBe('?limit=20'));
    expect(screen.queryByRole('group', { name: '已生效的筛选条件' })).toBeNull();
    expect(screen.getByRole('button', { name: /^筛选$/ })).toBeTruthy();
  });

  it('撤掉「姓名」chip 时搜索框缓冲一起清空（否则再点「找」条件会复活）', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const box = screen.getByPlaceholderText('查找');

    await user.type(box, 'sesko');
    expect(box).toHaveProperty('value', 'sesko');
    await user.click(screen.getByRole('button', { name: '找' }));
    await waitFor(() => expect(search()).toBe('?name=sesko&limit=20'));
    expect(screen.getByRole('button', { name: '移除筛选：姓名含「sesko」' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '移除筛选：姓名含「sesko」' }));
    await waitFor(() => expect(search()).toBe('?limit=20'));
    expect(box).toHaveProperty('value', '');
  });

  it('PlayStyle 下拉：面板分银/金两段，选金徽章发的是金段 ID（101 = 基础 ID+100）', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const side = document.getElementById('library-side') as HTMLElement;
    // 「更多筛选」默认收起（jsdom 里直接置 open，真实的点摘要动作交给 e2e）
    (side.querySelector('details.lib-adv') as HTMLDetailsElement).open = true;

    await user.click(within(side).getByRole('button', { name: /^PlayStyle/ }));
    const panel = within(side).getByRole('group', { name: 'PlayStyle' });
    expect(within(panel).getByText('银徽章')).toBeTruthy();
    expect(within(panel).getByText('金徽章')).toBeTruthy();
    // 六类分组的中文名（旧版铺的是英文 type）：银金两段各一份
    expect(within(panel).getAllByText('门将')).toHaveLength(2);

    // 选金徽章：旧版这条路径必然 400（前端序列化无白名单 + 后端只收 1-99）
    await user.click(within(side).getByRole('checkbox', { name: '精准搓射 +' }));
    await waitFor(() => expect(search()).toBe('?ps=101&limit=20'));
    expect(lastListQuery()).toContain('ps=101');
    expect(within(side).getByRole('button', { name: /^PlayStyle · 1/ })).toBeTruthy();
  });

  it('显示列下拉：手动去掉一列后出现「恢复自动」，恢复后回到自动清单', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const side = document.getElementById('library-side') as HTMLElement;
    await user.click(within(side).getByRole('button', { name: /^显示列/ }));
    await user.click(within(side).getByRole('checkbox', { name: '徽章' }));
    await waitFor(() => expect(headerButtons().some((b) => b.textContent?.startsWith('徽章'))).toBe(false));
    expect(search()).toContain('cols=');

    await user.click(within(side).getByRole('button', { name: '恢复自动' }));
    await waitFor(() => expect(headerButtons().some((b) => b.textContent?.startsWith('徽章'))).toBe(true));
  });
});

// v3.2.0：服务端不再回 total（那条整表 COUNT 占单页读量 99.7%），分页条改游标式 ——
// 「还有更多 / 已到末页」只能由 nextCursor 推出，这里把两种状态与翻页点击都锁住。
describe('分页条（游标式）', () => {
  it('nextCursor 还在 ⇒ 显示「还有更多」，点下一页真的去取下一页', async () => {
    pageCursor = 'c1';
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });

    expect(screen.getByText('第 1 页 · 已加载 2 名 · 还有更多')).toBeTruthy();
    const next = screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);

    await user.click(next);
    await waitFor(() => expect(screen.getByText('第 2 页 · 已加载 4 名 · 还有更多')).toBeTruthy());
    expect(lastListQuery()).toContain('cursor=c1');
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('nextCursor 为 null ⇒ 显示「已到末页」，下一页按钮禁用（不再白发请求）', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });

    expect(screen.getByText('第 1 页 · 已加载 2 名 · 已到末页')).toBeTruthy();
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);

    const before = apiMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/players?')).length;
    await user.click(screen.getByRole('button', { name: '下一页' }));
    const after = apiMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/players?')).length;
    expect(after).toBe(before);
  });
});

describe('v3.2.0：列表 staleTime（每次未命中都是 D1 实读）', () => {
  it('60s 内重新挂载页面复用缓存，不再重发列表请求', async () => {
    window.history.replaceState(null, '', '/players');
    // 这条要的是「缓存条目还活着」：只关重试，保留默认 gcTime（5 分钟）
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/players']}>
          <PlayersLibrary />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const listCalls = (): number =>
      apiMock.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/api/players?')).length;

    const first = render(tree);
    await screen.findByRole('link', { name: 'Šeško' });
    expect(listCalls()).toBe(1);

    // 切走再回来：仍在 60s 新鲜期内 ⇒ 不该再打一次列表（否则每次进页面都是一轮 D1 实读）
    first.unmount();
    render(tree);
    await screen.findByRole('link', { name: 'Šeško' });
    expect(listCalls()).toBe(1);
  });

  // 反向边界：只测「新鲜期内不重取」的话，staleTime 误设成 Infinity 也能过 —— 过期必须重取
  it('超过 60s 再挂载会重取（staleTime 不是无限）', async () => {
    window.history.replaceState(null, '', '/players');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/players']}>
          <PlayersLibrary />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const listCalls = (): number =>
      apiMock.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/api/players?')).length;

    // shouldAdvanceTime：Testing Library 的 waitFor 靠计时器轮询，装了假表也得让它自己往前走
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const first = render(tree);
      await screen.findByRole('link', { name: 'Šeško' });
      expect(listCalls()).toBe(1);

      first.unmount();
      vi.advanceTimersByTime(61_000);
      render(tree);
      await waitFor(() => expect(listCalls()).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('窄屏筛选抽屉', () => {
  it('开抽屉：遮罩出现、背景锁滚、焦点进抽屉；Esc 关闭并把焦点还给入口按钮', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const toggle = screen.getByRole('button', { name: /^筛选/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.lib-drawer-mask')).toBeNull();

    await user.click(toggle);
    expect(document.querySelector('.lib-drawer-mask')).not.toBeNull();
    expect(document.querySelector('.library-shell.drawer-open')).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭筛选抽屉' }));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.lib-drawer-mask')).toBeNull());
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(toggle);
  });

  it('点遮罩、点 × 都能关，且都把焦点还给入口按钮', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const toggle = screen.getByRole('button', { name: /^筛选/ });

    await user.click(toggle);
    await user.click(document.querySelector('.lib-drawer-mask') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.library-shell.drawer-open')).toBeNull());
    expect(document.activeElement).toBe(toggle);

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: '关闭筛选抽屉' }));
    await waitFor(() => expect(document.querySelector('.library-shell.drawer-open')).toBeNull());
    expect(document.activeElement).toBe(toggle);
  });

  it('抽屉里改筛选不动抽屉本身，摘要条立刻跟上', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    await user.click(screen.getByRole('button', { name: /^筛选/ }));

    const side = document.getElementById('library-side') as HTMLElement;
    await pickPosition(user, side, 'ST');
    await waitFor(() => expect(search()).toBe('?position=ST&limit=20'));
    expect(document.querySelector('.library-shell.drawer-open')).not.toBeNull();
    expect(screen.getByRole('button', { name: '移除筛选：位置：ST' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭筛选抽屉' })).toBeTruthy();
  });

  it('窄屏关着时抽屉 inert（屏幕外那几十个控件不进 Tab 序），宽屏不加', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const aside = document.getElementById('library-side') as HTMLElement;
    expect(aside.hasAttribute('inert')).toBe(true);

    await user.click(screen.getByRole('button', { name: /^筛选/ }));
    expect(aside.hasAttribute('inert')).toBe(false);
  });

  it('开着时抽屉是模态：背景三块区域都 inert，关掉就还原', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const main = document.querySelector('.library-main') as HTMLElement;
    const toolbar = document.querySelector('.lib-toolbar') as HTMLElement;
    // 摘要条（chip 是可聚焦按钮）自v3.1.1 步骤 5 起住在 .library-main 里，靠 main 的 inert 覆盖。
    // 断言包含关系而不是它自己有没有 inert：一旦有人把摘要条搬回 main 外面，Shift+Tab 就又能
    // 落到 chip 上、在遮罩后面把筛选撤掉，而这条测试不会有任何反应
    const bar = document.querySelector('.lib-bar') as HTMLElement;
    expect(main.contains(bar)).toBe(true);
    const aside = document.getElementById('library-side') as HTMLElement;
    expect(main.hasAttribute('inert')).toBe(false);

    await user.click(screen.getByRole('button', { name: /^筛选/ }));
    expect(main.hasAttribute('inert')).toBe(true);
    expect(toolbar.hasAttribute('inert')).toBe(true);
    expect(aside.getAttribute('role')).toBe('dialog');
    expect(aside.getAttribute('aria-modal')).toBe('true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(main.hasAttribute('inert')).toBe(false));
    expect(toolbar.hasAttribute('inert')).toBe(false);
    expect(aside.getAttribute('role')).toBeNull();
  });

  it('变窄时焦点若在左栏里，交给入口按钮（变窄后左栏是 inert 子树，焦点会被踢到 body）', async () => {
    open();
    await screen.findByRole('link', { name: 'Šeško' });
    const toggle = screen.getByRole('button', { name: /^筛选/ });
    // 宽屏左栏常驻，先在里头落个焦点（focusin 委托靠这个记录「焦点在左栏」）
    const aside = document.getElementById('library-side') as HTMLElement;
    const inside = within(aside).getByRole('button', { name: /^位置/ });
    inside.focus();
    expect(document.activeElement).toBe(inside);

    setNarrow(true);
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });

  it('内层已消化的 Esc 不再顺带关抽屉（搜索框按 Esc 只收下拉）', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    await user.click(screen.getByRole('button', { name: /^筛选/ }));

    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    consumed.preventDefault();
    window.dispatchEvent(consumed);
    expect(document.querySelector('.library-shell.drawer-open')).not.toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.library-shell.drawer-open')).toBeNull());
  });

  it('回到宽屏自动放掉抽屉（否则一改窗口尺寸就带遮罩）', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    await user.click(screen.getByRole('button', { name: /^筛选/ }));
    expect(document.querySelector('.library-shell.drawer-open')).not.toBeNull();

    setNarrow(false);
    await waitFor(() => expect(document.querySelector('.library-shell.drawer-open')).toBeNull());
    expect(document.querySelector('.lib-drawer-mask')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    const aside = document.getElementById('library-side') as HTMLElement;
    expect(aside.hasAttribute('inert')).toBe(false);
  });

  it('拉宽时焦点若在抽屉里（× 一拉宽就没了）交还入口按钮，不掉到 body', async () => {
    setNarrow(true);
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const toggle = screen.getByRole('button', { name: /^筛选/ });
    await user.click(toggle);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭筛选抽屉' }));

    setNarrow(false);
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });
});

// v3.2.1：列表的 PlayStyle 单元格。psNames 收的是「数组下标」，而 core/ref 的 playstyleIsGold
// 收的是「槽号（1 起）」—— 传下标时下标 12（= PSID13，金槽）走不到「金槽」分支，银段 ID 落在金槽
// 会被显示成银的，与属性页的 🥇 不一致。这条口径差只有异常数据才看得见，所以按纯函数直测。
describe('psNames：槽号从 1 起', () => {
  it('银槽里的银段 ID 不加「金·」', () => {
    // 下标 0/6 = PSID1/PSID7，都在银槽内
    expect(psNames(row({ id: 1, name: 'A', psIds: [1, null, null, null, null, null, 7] }))).toBe(
      '精准搓射、低射',
    );
  });

  it('PSID13（下标 12）是金槽：银段 ID 也按金徽渲染', () => {
    const psIds = [...Array(12).fill(null), 25]; // 下标 12 ⇒ 槽号 13
    expect(psNames(row({ id: 1, name: 'A', psIds }))).toBe('金·铲球');
  });

  it('金段 ID 无论落哪一槽都按金徽渲染，且显示基础名', () => {
    expect(psNames(row({ id: 1, name: 'A', psIds: [103] }))).toBe('金·大力射门');
    // 金段 ID 落在银槽同样判金（isGoldPlaystyleId 分支）
    expect(psNames(row({ id: 1, name: 'A', psIds: [null, 113, null] }))).toBe('金·长传');
  });

  it('全空槽与空数组都渲染破折号', () => {
    expect(psNames(row({ id: 1, name: 'A', psIds: [null, null] }))).toBe('—');
    expect(psNames(row({ id: 1, name: 'A', psIds: [] }))).toBe('—');
  });
});
