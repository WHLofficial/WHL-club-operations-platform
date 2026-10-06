// @vitest-environment jsdom
// 球员详情页（web/src/pages/Player.tsx）的「对比」入口测试（v6.34.0 步骤 7 建立；
// v6.37.0 入口从跳球员库改为页内浮层选人，计划 docs/test-plans/v6.37.0-compare-entry-overlay.md）：
// 入口在球员卡 CA/PA 数字行下方、点击开浮层（ComparePickerOverlay），确认后落
// /players/compare?ids=<fcId,...>（首位恒自己）。fc_id 用 ≠ 内部 id 的夹具，
// 混用内部 id 的变异才会红。
// 左栏 SideOps（会拉报价设置等私有端点）与登录态打桩；详情数据走 api 打桩（照
// PlayerCompare.test.tsx 的 mock 手法：importOriginal 摊开真实导出、只换 api）。
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerDetail } from '../lib/api.ts';
import Player from './Player.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: apiMock };
});
// 公开页不要求登录：真实 useAuth 在 provider 外会抛，打桩成未登录（教练分支全关）
vi.mock('../lib/auth.tsx', () => ({ useAuth: () => ({ user: null }) }));
// 左栏操作区与本用例无关（会依赖俱乐部登录态与多个私有端点）：整块换成空实现
vi.mock('./player/SideOps.tsx', () => ({ SideOps: () => null }));

// 属性页签雷达/属性网格要的 34 属性 + 位置/角色/徽章槽（口径同 PlayerCompare.test.tsx）
const ATTR_BASE: Record<string, unknown> = {
  sprintspeed: 94,
  acceleration: 90,
  finishing: 88,
  positioning: 80,
  shotpower: 84,
  longshots: 70,
  penalties: 75,
  volleys: 60,
  vision: 70,
  crossing: 65,
  freekickaccuracy: 55,
  longpassing: 60,
  shortpassing: 56,
  curve: 50,
  agility: 80,
  balance: 72,
  reactions: 80,
  composure: 74,
  ballcontrol: 76,
  dribbling: 78,
  interceptions: 40,
  headingaccuracy: 50,
  defensiveawareness: 45,
  standingtackle: 30,
  slidingtackle: 28,
  jumping: 70,
  stamina: 84,
  strength: 76,
  aggression: 60,
  gkdiving: 10,
  gkhandling: 12,
  gkkicking: 8,
  gkpositioning: 9,
  gkreflexes: 11,
  height: 182,
  weight: 74,
  weakfoot: 3,
  skillmoves: 4,
  PosID1: 25, // ST（主位）
  PosID2: 27, // LW
  RoleID1: 3, // RB 边后卫 +
  PSID1: 1, // 精准搓射（银）
  PSID13: 101, // 精准搓射 +（金，槽 13）
};

function detail(id: number, over: Partial<PlayerDetail['player']> = {}): PlayerDetail {
  return {
    player: {
      id,
      uid: `fc${200000 + id}`,
      name: '林承宇',
      officialName: 'L. Chengyu',
      number: '9',
      clubId: null,
      position: 'ST',
      age: 24,
      ca: 147,
      pa: 165,
      prestige: 3,
      marketValue: 12.4,
      status: 'free',
      transferListed: false,
      notForSale: false,
      growthTier: 2,
      isFutureStar: false,
      chinaPlan: false,
      agentTier: 2,
      badgesSilver: 3,
      badgesGold: 2,
      marker: null,
      foot: 1,
      growable: true,
      influence: 8.13,
      // TC-CMP-DET-02 夹具要求：fc_id ≠ 内部 id（跳 ?ids=<内部 id> 的变异才会红）
      fcId: 20801,
      growthXp: 0,
      gameAttrs: ATTR_BASE,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      listPrice: null,
      offerAuto: false,
      ...over,
    },
    // 自由身：不拉 /api/clubs、不渲染球队链接；合同区块按空合同渲染
    club: null,
    contract: null,
    seaSign: { eligible: false, reason: null },
    seaComps: { scope: 'none', rows: [] },
  };
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    // 详情页加载后会做规范 URL 跳转（?/players/1 → /players/20801），两个 id 都认
    if (/^\/api\/players\/\d+$/.test(path)) return Promise.resolve(detail(1));
    if (path === '/api/seasons/current') return Promise.resolve({ window: { status: 'open' } });
    // 成长记录本例不关心：失败按 null 展示（页面本身就是这样兜的）
    if (/^\/api\/players\/\d+\/growth$/.test(path)) return Promise.reject(new Error('用例不打桩成长数据'));
    return Promise.reject(new Error(`测试没打桩的请求：${path}`));
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function open(id = 1): ReturnType<typeof userEvent.setup> {
  window.history.replaceState(null, '', `/players/${id}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/players/${id}`]}>
        {/* 页面自己 useParams 取 id：必须走真实路由匹配，直接挂组件会拿不到 :id */}
        <Routes>
          <Route path="/players/:id" element={<Player />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('TC-CMP-DET：详情页「对比」入口（v6.34.0 建立，v6.37.0 改为点击开浮层）', () => {
  it('TC-CMP-PICK-01 · 入口在球员卡 CA/PA 数字行下方，渲染为按钮（不再是 link）', async () => {
    open();
    const entry = await screen.findByRole('button', { name: '⇄ 加入对比' });

    // 位置＝球员卡内 .player-card-numbers（CA/PA/身价）之后
    const wrap = entry.closest('.player-card-compare') as HTMLElement;
    const numbers = document.querySelector('.player-card-numbers') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(numbers.nextElementSibling).toBe(wrap);
  });

  it('TC-CMP-DET-01 · 入口随左栏常驻卡渲染：切到「合同」页签后仍在', async () => {
    const user = open();
    await screen.findByRole('button', { name: '⇄ 加入对比' });

    await user.click(screen.getByRole('button', { name: '合同' }));
    expect(screen.getByRole('button', { name: '⇄ 加入对比' })).toBeTruthy();
  });

  it('TC-CMP-DET-02 边界 · fcId 缺失（长尾球员）时不渲染入口，不拿内部 id 拼链接', async () => {
    apiMock.mockImplementation((path: string) => {
      if (/^\/api\/players\/\d+$/.test(path)) return Promise.resolve(detail(1, { fcId: null }));
      if (path === '/api/seasons/current') return Promise.resolve({ window: { status: 'open' } });
      if (/^\/api\/players\/\d+\/growth$/.test(path)) return Promise.reject(new Error('用例不打桩成长数据'));
      return Promise.reject(new Error(`测试没打桩的请求：${path}`));
    });
    open();
    await screen.findByText('林承宇');
    expect(screen.queryByRole('button', { name: '⇄ 加入对比' })).toBeNull();
  });
});

// ---- 选人浮层（v6.37.0）：名册与俱乐部目录打桩 + 挂 /players/compare 探针路由 ----

/** 确认导航的落点：把 query 原样渲染出来当断言探针（MemoryRouter 里不戳真实 history） */
function CmpProbe() {
  const { search } = useLocation();
  return <div data-testid="cmp-probe">{search}</div>;
}

const HAALAND = { name: 'Erling Haaland', clubId: 501, fcId: 20811 };
const BELLINGHAM = { name: 'Jude Bellingham', clubId: 501, fcId: 20812 };
const RASHFORD = { name: 'Marcus Rashford', clubId: 502, fcId: 20813 };

function pickerRoster(): string {
  return [
    `${HAALAND.name}|${HAALAND.clubId}|${HAALAND.fcId}`,
    `${BELLINGHAM.name}|${BELLINGHAM.clubId}|${BELLINGHAM.fcId}`,
    `${RASHFORD.name}|${RASHFORD.clubId}|${RASHFORD.fcId}`,
    // 自己（自由身、无俱乐部段）也在名册里：搜自己时必须被「排除自己」滤掉
    `林承宇|20801`,
  ].join('\n');
}

function clubSummary() {
  return {
    clubs: [{ id: 501, name: '曼城', isCpu: false, tier: null, logoKey: null, squad: { senior: 25, trainee: 0 } }],
  };
}

/** 打开选人浮层：roster 响应可换（TC-CMP-PICK-08 的挂起 / 失败态用） */
function openPicker(
  roster: () => Promise<unknown> = () => Promise.resolve({ roster: pickerRoster(), count: 4 }),
): ReturnType<typeof userEvent.setup> {
  // 直接从 fc_id 地址进：从内部 id 进会在详情落定后被规范 URL 效果 navigate 到 /players/<fcId>，
  // queryKey 换新导致整页重挂载，第一下点击会点在被 React 换掉的游离节点上（onClick 不触发）
  window.history.replaceState(null, '', '/players/20801');
  apiMock.mockImplementation((path: string) => {
    if (/^\/api\/players\/\d+$/.test(path)) return Promise.resolve(detail(1));
    if (path === '/api/seasons/current') return Promise.resolve({ window: { status: 'open' } });
    if (/^\/api\/players\/\d+\/growth$/.test(path)) return Promise.reject(new Error('用例不打桩成长数据'));
    if (path === '/api/players/roster') return roster();
    if (path === '/api/clubs') return Promise.resolve(clubSummary());
    return Promise.reject(new Error(`测试没打桩的请求：${path}`));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/players/20801']}>
        <Routes>
          <Route path="/players/:id" element={<Player />} />
          {/* 静态段排序高于 :id，确认导航会落在这里 */}
          <Route path="/players/compare" element={<CmpProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** 开浮层 + 等弹窗就绪（多数用例的第一步） */
async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: '⇄ 加入对比' }));
  return screen.findByRole('dialog', { name: '加入对比' });
}

describe('TC-CMP-PICK：选人浮层（v6.37.0）', () => {
  it('TC-CMP-PICK-02 · 打开后三槽初始态：自己占 A、两空位、提示/计数/确认闸齐全', async () => {
    const user = openPicker();
    const dialog = await openDialog(user);

    expect(within(dialog).getByText('林承宇')).toBeTruthy();
    expect(within(dialog).getAllByText('空位')).toHaveLength(2);
    expect(within(dialog).getByText('再选 2 人即可开始对比')).toBeTruthy();
    expect(within(dialog).getByText('已选 1/3')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '开始对比' }).hasAttribute('disabled')).toBe(true);
    // 空查询不出候选列表
    expect(within(dialog).getByText('输入姓名搜索球员')).toBeTruthy();
  });

  it('TC-CMP-PICK-03 · 搜索候选出「姓名+球队」，点行入槽 B 且确认解锁', async () => {
    const user = openPicker();
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText('搜索球员姓名'), 'erl');
    const rows = () => dialog.querySelectorAll('.cmp-picker-item');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Erling Haaland');
    expect(rows()[0].textContent).toContain('曼城'); // 俱乐部名来自目录 501

    await user.click(rows()[0]);
    // 入槽 B：槽行出名字与移除钮；候选行变已选态
    expect(within(dialog).getByRole('button', { name: '移除 Erling Haaland' })).toBeTruthy();
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByText('已选 2/3')).toBeTruthy();
    expect(within(dialog).getByText('再选 1 人即可开始对比')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '开始对比' }).hasAttribute('disabled')).toBe(false);
  });

  it('TC-CMP-PICK-04 · 确认导航：own 恒在首位（色 A 契约），浮层关闭', async () => {
    const user = openPicker();
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText('搜索球员姓名'), 'erl');
    await user.click(dialog.querySelectorAll('.cmp-picker-item')[0]);
    await user.click(within(dialog).getByRole('button', { name: '开始对比' }));

    expect(await screen.findByTestId('cmp-probe').then((el) => el.textContent)).toBe('?ids=20801,20811');
    expect(screen.queryByRole('dialog', { name: '加入对比' })).toBeNull();
  });

  it('TC-CMP-PICK-05 · 选满 2 人后未选候选禁用、提示换满员；候选里搜不到自己', async () => {
    const user = openPicker();
    const dialog = await openDialog(user);
    const input = within(dialog).getByLabelText('搜索球员姓名');

    await user.type(input, 'a'); // 三名候选都含 a：按折叠名序 erl < jude < marcus
    const rows = () => dialog.querySelectorAll('.cmp-picker-item');
    expect(rows()).toHaveLength(3);
    expect(rows()[2].textContent).toContain('俱乐部 502'); // 目录没有 502 的回退显示

    await user.click(rows()[0]);
    await user.click(rows()[1]);

    expect(within(dialog).getByText('名额已满（含自己共 3 人）')).toBeTruthy();
    expect(within(dialog).getByText('已选 3/3')).toBeTruthy();
    expect((rows()[2] as HTMLButtonElement).disabled).toBe(true);
    expect((rows()[0] as HTMLButtonElement).disabled).toBe(false); // 已选行仍可点（= 移除）

    // 排除自己：名册里有 林承宇（20801），候选里必须搜不到
    await user.clear(input);
    await user.type(input, '林承宇');
    expect(within(dialog).getByText('没有匹配「林承宇」的球员')).toBeTruthy();
  });

  it('TC-CMP-PICK-06 · 槽 ✕ 移除恢复空位与名额；候选行再点一次等效移除', async () => {
    const user = openPicker();
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText('搜索球员姓名'), 'erl');
    await user.click(dialog.querySelectorAll('.cmp-picker-item')[0]);

    await user.click(within(dialog).getByRole('button', { name: '移除 Erling Haaland' }));

    expect(within(dialog).getAllByText('空位')).toHaveLength(2);
    expect(within(dialog).getByText('已选 1/3')).toBeTruthy();

    // 候选行再点一次等效移除：先点回选中，再点同一行取消
    await user.click(dialog.querySelectorAll('.cmp-picker-item')[0]);
    expect(within(dialog).getAllByText('空位')).toHaveLength(1);
    expect(dialog.querySelectorAll('.cmp-picker-item')[0].getAttribute('aria-pressed')).toBe('true');
    await user.click(dialog.querySelectorAll('.cmp-picker-item')[0]);
    expect(within(dialog).getAllByText('空位')).toHaveLength(2);
    expect(dialog.querySelectorAll('.cmp-picker-item')[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-CMP-PICK-07a · Esc 关闭浮层', async () => {
    const user = openPicker();
    await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '加入对比' })).toBeNull());
  });

  it('TC-CMP-PICK-07b · 点遮罩（面板外）关闭浮层', async () => {
    const user = openPicker();
    await openDialog(user);
    fireEvent.click(document.querySelector('.cmp-picker-ov')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '加入对比' })).toBeNull());
  });

  it('TC-CMP-PICK-07c · 点 ✕ 关闭浮层', async () => {
    const user = openPicker();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '加入对比' })).toBeNull());
  });

  it('TC-CMP-PICK-08 · 名册加载中与拉取失败各有兜底文案，不白屏', async () => {
    const user = openPicker(() => new Promise(() => {})); // 永不 resolve：挂加载态
    let dialog = await openDialog(user);
    expect(within(dialog).getByText('名册加载中…')).toBeTruthy();

    cleanup();
    const user2 = openPicker(() => Promise.reject(new Error('名册炸了')));
    dialog = await openDialog(user2);
    expect(within(dialog).getByText('名册暂时拉不到，稍后再试')).toBeTruthy();
  });

  it('TC-CMP-PICK-09 · 打开后焦点落关闭钮；Esc 关闭后焦点回入口按钮', async () => {
    const user = openPicker();
    const entry = await screen.findByRole('button', { name: '⇄ 加入对比' });
    await user.click(entry);
    await screen.findByRole('dialog', { name: '加入对比' });
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭'));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(entry));
  });
});

// ---- 属性页签头部（v6.35.0：位置热区图接入 + 三列布局 + 雷达 head 变体档色）----

/** 属性页签头部容器（页签默认就是 attrs，加载完即有） */
async function attrHead(): Promise<HTMLElement> {
  const title = await screen.findByText('FC 属性（当季源数据）');
  const head = title.closest('.attr-head');
  expect(head).not.toBeNull();
  return head as HTMLElement;
}

describe('TC-CMP-ATTR：属性页签头部（v6.35.0）', () => {
  it('TC-CMP-ATTR-01 · 热区图与雷达并排进头部：三列布局、PosID1 主位 + PosID2 副位', async () => {
    open();
    const head = await attrHead();

    // 有位置数据 ⇒ 不回退两列（.attr-head-noheat 只在空态加）
    expect(head.classList.contains('attr-head-noheat')).toBe(false);
    expect(head.querySelector('.attr-head-visual svg.heat-svg')).toBeTruthy();
    // 热区图三态：PosID1=ST 主位、PosID2=LW 副位、其余 10 块淡显
    expect(head.querySelectorAll('rect.heat-block')).toHaveLength(12);
    expect(head.querySelectorAll('rect.heat-block.heat-main')).toHaveLength(1);
    expect(head.querySelector('text.heat-code.heat-main')?.textContent).toBe('ST');
    expect(head.querySelectorAll('rect.heat-block.heat-sub')).toHaveLength(1);
    expect(head.querySelector('text.heat-code.heat-sub')?.textContent).toBe('LW');
    expect(head.querySelectorAll('rect.heat-block.heat-off')).toHaveLength(10);
    // 雷达仍是 head 变体（232×156、六轴），与热区图同处右列
    const radar = head.querySelector('svg.radar-svg-head');
    expect(radar).not.toBeNull();
    expect(radar!.getAttribute('viewBox')).toBe('0 0 232 156');
    expect(radar!.querySelectorAll('.radar-axis-key')).toHaveLength(6);
  });

  it('TC-CMP-ATTR-02 · 雷达五档环带 + 数值套档色（v6.19.0 缺 fill 的缺陷已修）', async () => {
    open();
    const head = await attrHead();
    const radar = head.querySelector('svg.radar-svg-head')!;

    expect(radar.querySelectorAll('polygon.radar-band')).toHaveLength(5);
    const vals = Array.from(radar.querySelectorAll('.radar-axis-val'));
    // 组均（四舍五入）：PAC 92 / SHO 76 / PAS 59 / DRI 77 / DEF 39 / PHY 73
    expect(vals.map((el) => el.textContent)).toEqual(['92', '76', '59', '77', '39', '73']);
    // 档色类挂在数值 tspan 上（fill 由 styles.css 的 .radar-axis-val.attr-* 双类选择器给）
    expect(vals[0].getAttribute('class')).toBe('radar-axis-val attr-good');
    expect(vals[4].getAttribute('class')).toBe('radar-axis-val attr-bad');
  });

  it('TC-CMP-ATTR-03 · 空位置数据：热区图不渲染、头部回退两列，雷达照常', async () => {
    apiMock.mockImplementation((path: string) => {
      if (/^\/api\/players\/\d+$/.test(path)) {
        return Promise.resolve(detail(1, { gameAttrs: { ...ATTR_BASE, PosID1: null, PosID2: null } }));
      }
      if (path === '/api/seasons/current') return Promise.resolve({ window: { status: 'open' } });
      if (/^\/api\/players\/\d+\/growth$/.test(path)) return Promise.reject(new Error('用例不打桩成长数据'));
      return Promise.reject(new Error(`测试没打桩的请求：${path}`));
    });
    open();
    const head = await attrHead();

    expect(head.classList.contains('attr-head-noheat')).toBe(true);
    expect(head.querySelector('svg.heat-svg')).toBeNull();
    expect(head.querySelector('svg.radar-svg-head')).not.toBeNull();
  });

  it('TC-CMP-ATTR-04 · 纯门将：热区图只有 GK 块主位、雷达换 GK 六轴', async () => {
    apiMock.mockImplementation((path: string) => {
      if (/^\/api\/players\/\d+$/.test(path)) {
        return Promise.resolve(detail(1, { position: 'GK', gameAttrs: { ...ATTR_BASE, PosID1: 0, PosID2: null } }));
      }
      if (path === '/api/seasons/current') return Promise.resolve({ window: { status: 'open' } });
      if (/^\/api\/players\/\d+\/growth$/.test(path)) return Promise.reject(new Error('用例不打桩成长数据'));
      return Promise.reject(new Error(`测试没打桩的请求：${path}`));
    });
    open();
    const head = await attrHead();

    expect(head.querySelectorAll('rect.heat-block.heat-main')).toHaveLength(1);
    expect(head.querySelector('text.heat-code.heat-main')?.textContent).toBe('GK');
    expect(head.querySelectorAll('rect.heat-block.heat-off')).toHaveLength(11);
    const keys = Array.from(head.querySelectorAll('.radar-axis-key'), (el) => el.textContent);
    expect(keys).toEqual(['DIV', 'HAN', 'KIC', 'REF', 'POS', 'SPD']);
  });
});
