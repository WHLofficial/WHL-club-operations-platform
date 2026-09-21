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
import PlayersLibrary from './PlayersLibrary.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api.ts', () => ({ api: apiMock }));

const CLUBS: ClubDirectoryRow[] = [
  { id: 1, name: '阿森纳', leagueTier: 'top' },
  { id: 243, name: '皇家马德里', leagueTier: 'top' },
];

function row(patch: Partial<PlayerLibraryRow> & { id: number; name: string }): PlayerLibraryRow {
  return {
    uid: `fc${200000 + patch.id}`,
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

beforeEach(() => {
  mediaListeners.clear();
  mediaMatches = false;
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
      const body: PlayersLibraryResponse = { players: ROWS, total: ROWS.length, nextCursor: null };
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
    expect(screen.getByText('未设筛选条件')).toBeTruthy();

    const side = document.getElementById('library-side') as HTMLElement;
    await user.click(within(side).getByRole('button', { name: 'ST' }));
    await waitFor(() => expect(search()).toBe('?position=ST&limit=20'));
    expect(screen.getByRole('button', { name: '移除筛选：位置：ST' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^筛选（1）$/ })).toBeTruthy();
    expect(lastListQuery()).toContain('position=ST');

    await user.click(screen.getByRole('button', { name: '移除筛选：位置：ST' }));
    await waitFor(() => expect(search()).toBe('?limit=20'));
    expect(screen.getByText('未设筛选条件')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^筛选$/ })).toBeTruthy();
  });

  it('撤掉「姓名」chip 时搜索框缓冲一起清空（否则再点「找」条件会复活）', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const box = screen.getByPlaceholderText(/按姓名找/);

    await user.type(box, 'sesko');
    expect(box).toHaveProperty('value', 'sesko');
    await user.click(screen.getByRole('button', { name: '找' }));
    await waitFor(() => expect(search()).toBe('?name=sesko&limit=20'));
    expect(screen.getByRole('button', { name: '移除筛选：姓名含「sesko」' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '移除筛选：姓名含「sesko」' }));
    await waitFor(() => expect(search()).toBe('?limit=20'));
    expect(box).toHaveProperty('value', '');
  });

  it('显示列面板：手动去掉一列后出现「恢复自动」，恢复后回到自动清单', async () => {
    const user = open();
    await screen.findByRole('link', { name: 'Šeško' });
    const side = document.getElementById('library-side') as HTMLElement;
    await user.click(within(side).getByText(/^显示列（/));
    await user.click(within(side).getByRole('button', { name: '徽章' }));
    await waitFor(() => expect(headerButtons().some((b) => b.textContent?.startsWith('徽章'))).toBe(false));
    expect(search()).toContain('cols=');

    await user.click(within(side).getByRole('button', { name: '恢复自动' }));
    await waitFor(() => expect(headerButtons().some((b) => b.textContent?.startsWith('徽章'))).toBe(true));
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
    await user.click(within(side).getByRole('button', { name: 'ST' }));
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
    // 摘要条是夹在工具条与表格之间的第三块背景区，chip 是可聚焦按钮，漏掉它 Shift+Tab 就能
    // 落到 chip 上、在遮罩后面把筛选撤掉
    const summary = document.querySelector('.lib-summary') as HTMLElement;
    const aside = document.getElementById('library-side') as HTMLElement;
    expect(main.hasAttribute('inert')).toBe(false);
    expect(summary.hasAttribute('inert')).toBe(false);

    await user.click(screen.getByRole('button', { name: /^筛选/ }));
    expect(main.hasAttribute('inert')).toBe(true);
    expect(toolbar.hasAttribute('inert')).toBe(true);
    expect(summary.hasAttribute('inert')).toBe(true);
    expect(aside.getAttribute('role')).toBe('dialog');
    expect(aside.getAttribute('aria-modal')).toBe('true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(main.hasAttribute('inert')).toBe(false));
    expect(toolbar.hasAttribute('inert')).toBe(false);
    expect(summary.hasAttribute('inert')).toBe(false);
    expect(aside.getAttribute('role')).toBeNull();
  });

  it('变窄时焦点若在左栏里，交给入口按钮（变窄后左栏是 inert 子树，焦点会被踢到 body）', async () => {
    open();
    await screen.findByRole('link', { name: 'Šeško' });
    const toggle = screen.getByRole('button', { name: /^筛选/ });
    // 宽屏左栏常驻，先在里头落个焦点（focusin 委托靠这个记录「焦点在左栏」）
    const aside = document.getElementById('library-side') as HTMLElement;
    const inside = within(aside).getByRole('button', { name: 'ST' });
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
