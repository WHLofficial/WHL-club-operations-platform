// @vitest-environment jsdom
// 球员对比页（web/src/pages/PlayerCompare.tsx）组件测试（v6.34.0 步骤 5+6）。
// 覆盖计划 docs/test-plans/v6.34.0-player-compare.md 的 TC-CMP-URL/STATE/DESK/RADAR/TBL/MISC/POS/MOB
// 组件可测条目；请求计数断言走 api 打桩（按 id 逐路返回/失败/悬挂）。
// jsdom 不跑样式表：加粗/定宽/吸顶几何只锁类名与 DOM 结构，真实视觉由 e2e 截图兜底（最坏情况口径）。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerDetail } from '../lib/api.ts';
import { COMPARE_COLORS } from '../lib/compare.ts';
import PlayerCompare from './PlayerCompare.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
// 用 importOriginal 摊开真实导出（queries.ts 还要 apiPost 等常量），只换 api 本体
vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: apiMock };
});

// matchMedia 打桩：useMediaQuery 在 useState 初始化时就调它，测试里能切断点（照 PlayersLibrary.test.tsx）
type MediaListener = (event: MediaQueryListEvent) => void;
const mediaListeners = new Set<MediaListener>();
let mediaMatches = false;
function setNarrow(narrow: boolean): void {
  mediaMatches = narrow;
  for (const listener of mediaListeners) listener({ matches: narrow } as MediaQueryListEvent);
}

// ---- 夹具 ----

// 34 属性 + 位置/角色/徽章槽：player A 的基线值；player B 用 override 造出胜负/平手格
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
  PosID3: 16, // LM
  RoleID1: 3, // RB 边后卫 +（role-plus 口径）
  RoleID2: 103, // RB 边后卫 ++（role-plusplus 口径）
  PSID1: 1, // 精准搓射（银）
  PSID13: 101, // 精准搓射 +（金，槽 13）
};

function attrsOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...ATTR_BASE, ...over };
}

function detail(
  id: number,
  over: Partial<PlayerDetail['player']> = {},
  attrs: Record<string, unknown> | null = attrsOf(),
  extra: Partial<PlayerDetail> = {},
): PlayerDetail {
  return {
    player: {
      id,
      uid: `fc${200000 + id}`,
      name: `球员${id}`,
      officialName: `P.${id}`,
      number: null,
      clubId: 1,
      position: 'ST',
      age: 24,
      ca: 82,
      pa: 88,
      prestige: 3,
      marketValue: 20,
      status: 'normal',
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
      fcId: 200000 + id,
      growthXp: 0,
      gameAttrs: attrs,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      listPrice: null,
      offerAuto: false,
      ...over,
    },
    club: { id: 1, name: '阿森纳' },
    contract: null,
    seaSign: { eligible: false, reason: null },
    seaComps: { scope: 'none', rows: [] },
    ...extra,
  };
}

type Behavior = 'pending' | 'fail' | 'missing' | PlayerDetail;
let behaviors: Record<string, Behavior>;
let calls: string[];

beforeEach(() => {
  mediaListeners.clear();
  mediaMatches = false;
  behaviors = {};
  calls = [];
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
    calls.push(path);
    const key = path.split('/').pop() ?? '';
    const b = behaviors[key];
    if (b === undefined) return Promise.reject(new Error(`测试没打桩的请求：${path}`));
    if (b === 'fail') return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
    if (b === 'missing') return Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
    if (b === 'pending') return new Promise(() => {});
    return Promise.resolve(b);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

function open(url: string) {
  window.history.replaceState(null, '', url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <PlayerCompare />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, user: userEvent.setup() };
}

/** 只数详情端点（本页不许打其它端点，POS-04 的「不发 /growth」也靠它兜） */
function playerCalls(): string[] {
  return calls.filter((c) => /^\/api\/players\/\d+$/.test(c));
}

function calledIds(): string[] {
  return playerCalls().map((c) => c.split('/').pop() ?? '');
}

/** 属性行/杂项行/元信息行按行名取行元素（label 唯一时可用） */
function rowOf(label: string): HTMLElement {
  const el = screen.getByText(label).closest('.cmp-row, .cmp-meta-row');
  if (!el) throw new Error(`找不到对比行：${label}`);
  return el as HTMLElement;
}

function valueCellsOf(label: string): HTMLElement[] {
  return Array.from(rowOf(label).querySelectorAll<HTMLElement>('.cmp-v'));
}

function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

// ---- TC-CMP-URL · URL 解析与降级 ----

describe('TC-CMP-URL：URL 即事实源', () => {
  it('TC-CMP-URL-01 · 无 ids：0 人页面级空态、零请求、URL 不改写', () => {
    open('/players/compare');
    expect(screen.getByText('还没有选择球员')).toBeTruthy();
    expect(screen.getByRole('link', { name: '去球员库选人' }).getAttribute('href')).toBe('/players');
    expect(calls).toEqual([]);
    expect(window.location.search).toBe('');
  });

  it('TC-CMP-URL-01 变体 · ?ids= 空串同为 0 人态且零请求', () => {
    open('/players/compare?ids=');
    expect(screen.getByText('还没有选择球员')).toBeTruthy();
    expect(playerCalls()).toEqual([]);
  });

  it('TC-CMP-URL-02 · 非法 id：忽略＋计数提示、不产生请求、URL 保留原串', async () => {
    behaviors = { '1': detail(1), '2': detail(2) };
    const { user } = open('/players/compare?ids=abc,1,2');
    await waitFor(() => expect(playerCalls().length).toBe(2));
    expect(calledIds()).toEqual(['1', '2']);
    expect(screen.getByText('已忽略 1 个无效 id')).toBeTruthy();
    expect(window.location.search).toBe('?ids=abc,1,2');
    void user;
  });

  it('TC-CMP-URL-03 · 重复 id：去重保序、各一次请求、提示在场', async () => {
    behaviors = { '5': detail(5), '3': detail(3) };
    const { container } = open('/players/compare?ids=5,5,3,3,5');
    await waitFor(() => expect(container.querySelectorAll('.cmp-card').length).toBe(2));
    expect(calledIds()).toEqual(['5', '3']);
    expect(screen.getByText('重复的球员已自动去重')).toBeTruthy();
    const names = Array.from(container.querySelectorAll('.cmp-ids .cmp-name')).map((e) => e.textContent);
    expect(names).toEqual(['球员5', '球员3']);
  });

  it('TC-CMP-URL-04 · 超 3：按 URL 顺序取前 3、只请求前 3、提示且 URL 不改写', async () => {
    behaviors = { '4': detail(4), '2': detail(2), '7': detail(7) };
    const { container } = open('/players/compare?ids=4,2,7,9,1');
    await waitFor(() => expect(container.querySelectorAll('.cmp-radar-small').length).toBe(3));
    expect(calledIds()).toEqual(['4', '2', '7']);
    expect(screen.getByText('最多同时对比 3 人，已只取前 3 位')).toBeTruthy();
    expect(window.location.search).toBe('?ids=4,2,7,9,1');
  });

  it('TC-CMP-URL-05 · 单人：合法单人态（雷达＋空槽）、不出对比表、不重定向', async () => {
    behaviors = { '7': detail(7) };
    const { container } = open('/players/compare?ids=7');
    await waitFor(() => expect(screen.getByText('还差 1 名球员')).toBeTruthy());
    // v6.37.0 修：回球员库带 ?compare=<fcId> 预置勾选本球员（原先裸 /players 丢掉当前球员）
    expect(screen.getByRole('link', { name: '＋ 从球员库选' }).getAttribute('href')).toBe('/players?compare=7');
    expect(container.querySelectorAll('.cmp-radar-big').length).toBe(1);
    expect(container.querySelector('.cmp-table')).toBeNull();
    expect(container.querySelector('.cmp-misc')).toBeNull();
    expect(window.location.search).toBe('?ids=7');
  });
});

// ---- TC-CMP-STATE · 状态机 ----

describe('TC-CMP-STATE：9 态', () => {
  it('TC-CMP-STATE-01 · 加载中：骨架文案在场、请求数＝存活人数、不闪错态', () => {
    behaviors = { '7': 'pending', '8': 'pending' };
    open('/players/compare?ids=7,8');
    expect(screen.getByText('正在调阅球员数据…')).toBeTruthy();
    expect(playerCalls().length).toBe(2);
    expect(screen.queryByText('球员数据没取到')).toBeNull();
  });

  it('TC-CMP-STATE-02 · 未知 id（404）：丢弃＋提示、不留重试槽', async () => {
    behaviors = { '1': detail(1), '999': 'missing' };
    open('/players/compare?ids=1,999');
    await waitFor(() => expect(screen.getByText('未找到 id 999 对应的球员，已忽略')).toBeTruthy());
    expect(screen.getByText('还差 1 名球员')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('TC-CMP-STATE-03 · 部分失败：留可重试槽、重试只重拉失败者、成功者零新请求', async () => {
    behaviors = { '1': detail(1), '2': 'fail' };
    const { container, user } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeTruthy());
    expect(screen.getByText('有 1 名球员的数据没取到，其余球员已照常显示')).toBeTruthy();
    expect(container.querySelectorAll('.cmp-card').length).toBe(1);

    behaviors['2'] = detail(2, { name: '球员2' });
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(container.querySelectorAll('.cmp-heatmap').length).toBe(2));
    expect(container.querySelector('.cmp-radar-big')).toBeTruthy();
    expect(playerCalls().filter((c) => c.endsWith('/1')).length).toBe(1);
    expect(playerCalls().filter((c) => c.endsWith('/2')).length).toBe(2);
  });

  it('TC-CMP-STATE-04 · 全部失败：页面级错误态＋重试恢复为 2 人形态', async () => {
    behaviors = { '1': 'fail', '2': 'fail' };
    const { container, user } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(screen.getByText('球员数据没取到')).toBeTruthy());
    expect(container.querySelector('.cmp-table')).toBeNull();

    behaviors = { '1': detail(1), '2': detail(2) };
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(container.querySelectorAll('.cmp-card').length).toBe(2));
    expect(container.querySelector('.cmp-table')).toBeTruthy();
  });

  it('TC-CMP-STATE-05 · 存活数变化后形态重判：3 人丢 1 → 回落 2 人（叠图＋热区图）', async () => {
    behaviors = { '1': detail(1), '2': 'missing', '3': detail(3) };
    const { container } = open('/players/compare?ids=1,2,3');
    await waitFor(() => expect(container.querySelector('.cmp-radar-big')).toBeTruthy());
    expect(container.querySelectorAll('.cmp-radar-small').length).toBe(0);
    expect(container.querySelectorAll('.cmp-heatmap').length).toBe(2);
    expect(valueCellsOf('冲刺速度').length).toBe(2);
  });

  it('TC-CMP-STATE-06 · 多类提示并存：非法/重复/超 3/404 四条同场且互不吞没', async () => {
    behaviors = { '1': detail(1), '2': detail(2), '3': 'missing' };
    const { container } = open('/players/compare?ids=abc,1,1,2,3,4');
    await waitFor(() => expect(container.querySelectorAll('.cmp-card').length).toBe(2));
    expect(screen.getByText('已忽略 1 个无效 id')).toBeTruthy();
    expect(screen.getByText('重复的球员已自动去重')).toBeTruthy();
    expect(screen.getByText('最多同时对比 3 人，已只取前 3 位')).toBeTruthy();
    expect(screen.getByText('未找到 id 3 对应的球员，已忽略')).toBeTruthy();
  });
});

// ---- TC-CMP-DESK · 桌面形态与顶栏 ----

describe('TC-CMP-DESK：桌面结构', () => {
  it('TC-CMP-DESK-01/06 · 2 人桌面：顶栏（URL chip＋编辑名单）＋双卡＋叠图＋热区图＋双栏表＋杂项与四行', async () => {
    behaviors = { '1': detail(1), '2': detail(2) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelectorAll('.cmp-card').length).toBe(2));

    expect(screen.getByRole('heading', { name: '球员对比' })).toBeTruthy();
    expect(container.querySelector('.cmp-urlchip')?.textContent).toBe('/players/compare?ids=1,2');
    expect(screen.getByRole('link', { name: '编辑名单' }).getAttribute('href')).toBe('/players?compare=1%2C2');

    expect(container.querySelectorAll('.cmp-heatmap').length).toBe(2);
    // 热区图本体（v6.35.0）：两张 12 块图，主位照 PosID1=ST、副位 LW/LM
    const heats = container.querySelectorAll('.cmp-heatmap svg.heat-svg');
    expect(heats.length).toBe(2);
    expect(container.querySelectorAll('.cmp-heatmap rect.heat-block').length).toBe(24);
    expect(
      Array.from(container.querySelectorAll('.cmp-heatmap text.heat-code.heat-main'), (el) => el.textContent),
    ).toEqual(['ST', 'ST']);
    expect(
      Array.from(container.querySelectorAll('.cmp-heatmap text.heat-code.heat-sub'), (el) => el.textContent),
    ).toEqual(['LW', 'LM', 'LW', 'LM']);
    expect(container.querySelectorAll('.cmp-radar-big .radar-data').length).toBe(2);
    expect(container.querySelectorAll('.cmp-table .cmp-gh').length).toBe(6);
    expect(container.querySelector('.cmp-misc')).toBeTruthy();
    expect(container.querySelector('.cmp-meta')).toBeTruthy();
    expect(screen.getByRole('link', { name: '球员1' }).getAttribute('href')).toBe('/players/200001');
  });

  it('TC-CMP-DESK-02 · 3 人桌面：三张并排小雷达、不出热区图、每行 3 值格、第三人深紫', async () => {
    behaviors = { '1': detail(1), '2': detail(2), '3': detail(3) };
    const { container } = open('/players/compare?ids=1,2,3');
    await waitFor(() => expect(container.querySelectorAll('.cmp-card').length).toBe(3));
    expect(container.querySelectorAll('.cmp-radar-small').length).toBe(3);
    expect(container.querySelector('.cmp-radar-big')).toBeNull();
    expect(container.querySelectorAll('.cmp-heatmap').length).toBe(0);
    expect(valueCellsOf('冲刺速度').length).toBe(3);
    const dots = container.querySelectorAll<HTMLElement>('.cmp-ids .cmp-dot');
    expect(dots[2].style.background).toBe(hexToRgb(COMPARE_COLORS[2]));
  });
});

// ---- TC-CMP-RADAR · 轴选择与组均 ----

describe('TC-CMP-RADAR：雷达与班组均', () => {
  function axisLabels(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('.radar-axis-key')).map((e) => e.textContent ?? '');
  }

  it('TC-CMP-RADAR-01 · 混比（门将＋外场）统一外场六轴、轴标只出三字母键名', async () => {
    behaviors = { '1': detail(1, { position: 'GK' }), '2': detail(2, { position: 'ST' }) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-radar-big')).toBeTruthy());
    expect(axisLabels(container)).toEqual(['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY']);
    expect(axisLabels(container).some((k) => k === 'DIV')).toBe(false);
  });

  it('TC-CMP-RADAR-02 · 纯门将（全员 GK）用 GK 六轴', async () => {
    behaviors = { '1': detail(1, { position: 'GK' }), '2': detail(2, { position: 'GK' }) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-radar-big')).toBeTruthy());
    expect(axisLabels(container)).toEqual(['DIV', 'HAN', 'KIC', 'REF', 'POS', 'SPD']);
  });

  it('TC-CMP-RADAR-03/TBL-07 · gameAttrs 为 null：不崩、轴照画、值显示「—」且不参与加粗', async () => {
    behaviors = { '1': detail(1, {}, null), '2': detail(2, {}, null) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-table')).toBeTruthy());
    expect(axisLabels(container).length).toBe(6);
    const cells = valueCellsOf('冲刺速度');
    expect(cells.map((c) => c.textContent)).toEqual(['—', '—']);
    expect(cells.some((c) => c.classList.contains('cmp-bold'))).toBe(false);
    expect(screen.getByText('影响力')).toBeTruthy();
  });

  it('TC-CMP-RADAR-01 变体 · 组头取 groupAverages（仅六组、只留组名、无「组均」字样）', async () => {
    behaviors = { '1': detail(1), '2': detail(2) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-table')).toBeTruthy());
    const heads = Array.from(container.querySelectorAll('.cmp-table .cmp-gh'));
    expect(heads.map((h) => h.querySelector('.cmp-row-label')?.textContent)).toEqual(['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY']);
    // PAC = round((94+90)/2) = 92；胜方（A）加粗
    const first = heads[0].querySelectorAll<HTMLElement>('.cmp-v');
    expect(first[0].textContent).toBe('92');
    expect(first[0].classList.contains('cmp-bold')).toBe(true);
    expect(document.body.textContent?.includes('组均')).toBe(false);
  });
});

// ---- TC-CMP-TBL · 属性表与胜负标记 ----

describe('TC-CMP-TBL：属性表与胜负标记乙', () => {
  const B_ATTRS = { sprintspeed: 78, acceleration: 70, influence: 5.6 };

  it('TC-CMP-TBL-01 · 6 组头＋34 属性行（含 GKP 5 项、右栏末）', async () => {
    behaviors = { '1': detail(1), '2': detail(2) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-table')).toBeTruthy());
    expect(container.querySelectorAll('.cmp-table .cmp-row:not(.cmp-gh)').length).toBe(34);
    const labels = Array.from(container.querySelectorAll('.cmp-table .cmp-row:not(.cmp-gh) .cmp-row-label')).map((e) => e.textContent);
    expect(labels.slice(-5)).toEqual(['扑救', '手型', '开球', '站位', '反应扑救']);
  });

  it('TC-CMP-TBL-02/06 · 胜方加粗、数字本命色、属性格不套五档色（身份卡 CA 仍套）', async () => {
    behaviors = { '1': detail(1), '2': detail(2, {}, attrsOf(B_ATTRS)) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-table')).toBeTruthy());
    const cells = valueCellsOf('冲刺速度');
    expect(cells.map((c) => c.textContent)).toEqual(['94', '78']);
    expect(cells[0].classList.contains('cmp-bold')).toBe(true);
    expect(cells[1].classList.contains('cmp-bold')).toBe(false);
    expect(cells[0].style.color).toBe(hexToRgb(COMPARE_COLORS[0]));
    expect(cells[1].style.color).toBe(hexToRgb(COMPARE_COLORS[1]));
    for (const c of cells) {
      expect(/attr-(bad|weak|mid|solid|good)/.test(c.className)).toBe(false);
    }
    expect(container.querySelector('.cmp-capa-num.attr-good')).toBeTruthy();
  });

  it('TC-CMP-TBL-03 · 等值两侧都加粗（平手＝至少不落下风）', async () => {
    behaviors = { '1': detail(1), '2': detail(2) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-table')).toBeTruthy());
    // 反应 80/80 为平手；花式 4★/4★ 同为平手（杂项行）
    for (const label of ['反应', '花式']) {
      const cells = valueCellsOf(label);
      expect(cells.every((c) => c.classList.contains('cmp-bold'))).toBe(true);
    }
  });

  it('TC-CMP-TBL-04 · 不可比行不标：惯用脚 / 徽章数 / 位置 / 角色', async () => {
    behaviors = { '1': detail(1), '2': detail(2) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-meta')).toBeTruthy());
    expect(valueCellsOf('惯用脚').some((c) => c.classList.contains('cmp-bold'))).toBe(false);
    const badgeRow = rowOf('徽章数');
    expect(badgeRow.querySelectorAll('.cmp-bold').length).toBe(0);
    expect(container.querySelectorAll('.cmp-meta .cmp-bold').length).toBe(0);
  });
});

// ---- TC-CMP-MISC · 杂项区 ----

describe('TC-CMP-MISC：杂项区', () => {
  it('TC-CMP-MISC-01/02 · 行序逐字（惯用脚/身高/体重/逆足/花式/影响力）、惯用脚不标胜负', async () => {
    behaviors = { '1': detail(1), '2': detail(2) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-misc')).toBeTruthy());
    const labels = Array.from(container.querySelectorAll('.cmp-misc .cmp-row-label')).map((e) => e.textContent);
    expect(labels).toEqual(['杂项', '惯用脚', '身高', '体重', '逆足', '花式', '影响力']);
    // 身高 182/182 为平手 → 双粗；惯用脚不标（muted 且无 cmp-bold）
    const footCells = valueCellsOf('惯用脚');
    expect(footCells.map((c) => c.textContent)).toEqual(['右脚', '右脚']);
    expect(footCells.every((c) => c.classList.contains('cmp-bold'))).toBe(false);
    expect(footCells.every((c) => c.classList.contains('cmp-mut'))).toBe(true);
  });

  it('TC-CMP-MISC-03 · 影响力两位小数、不用国际声望★；身高体重标优胜', async () => {
    behaviors = {
      '1': detail(1, { prestige: 5 }),
      '2': detail(2, { influence: 5.6 }, attrsOf({ ...ATTR_BASE, height: 178, weight: 70 })),
    };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-misc')).toBeTruthy());
    const infl = valueCellsOf('影响力');
    expect(infl[0].textContent).toBe('8.13');
    expect(infl[1].textContent).toBe('5.60');
    expect(infl[0].classList.contains('cmp-bold')).toBe(true);
    // 声望★ 不进对比页（prestige 5 → starText 五满星不出现在任何位置）
    expect(container.textContent?.includes('★★★★★')).toBe(false);
    expect(container.textContent?.includes('国际声望')).toBe(false);
    const heights = valueCellsOf('身高');
    expect(heights.map((c) => c.textContent)).toEqual(['182', '178']);
    expect(heights[0].classList.contains('cmp-bold')).toBe(true);
  });
});

// ---- TC-CMP-POS · 位置·角色·徽章·徽章数 ----

describe('TC-CMP-POS：四行成组', () => {
  async function openTwo() {
    behaviors = { '1': detail(1), '2': detail(2) };
    const utils = open('/players/compare?ids=1,2');
    await waitFor(() => expect(utils.container.querySelector('.cmp-meta')).toBeTruthy());
    return utils;
  }

  it('TC-CMP-POS-01/02/03 · 四行标签齐（定宽类）＋主位深底＋副位与角色口径', async () => {
    const { container } = await openTwo();
    const labels = Array.from(container.querySelectorAll('.cmp-meta .cmp-meta-label')).map((e) => e.textContent);
    expect(labels).toEqual(['位置', '角色', '徽章', '徽章数']);
    expect(labels.every((l) => l !== null)).toBe(true);
    expect(container.querySelectorAll('.cmp-meta-row .cmp-meta-cell').length).toBe(8); // 四行 × 2 人
    const main = container.querySelector('.cmp-meta .pos-chip-main');
    expect(main?.textContent).toBe('ST');
    expect(container.querySelector('.cmp-meta .role-plus')).toBeTruthy();
    expect(container.querySelector('.cmp-meta .role-plusplus')).toBeTruthy();
  });

  it('TC-CMP-POS-04 · 徽章＝FC 源槽清单（银＋金各一）且不打 /growth 等额外端点', async () => {
    const { container } = await openTwo();
    const badgeCells = rowOf('徽章').querySelectorAll('.ps-badge');
    expect(badgeCells.length).toBe(4); // 每人 2 枚（PSID1 银 + PSID13 金）
    expect(rowOf('徽章').querySelectorAll('.ps-gold').length).toBe(2);
    expect(calls.every((c) => /^\/api\/players\/\d+$/.test(c))).toBe(true);
    expect(calls.some((c) => c.includes('growth'))).toBe(false);
    void container;
  });

  it('TC-CMP-POS-05 · 徽章数金在前：`2金 · 3银`（台账计数 badgesGold/badgesSilver，v6.35.0 走 BadgeCounts）', async () => {
    const { container } = await openTwo();
    const row = rowOf('徽章数');
    const cells = row.querySelectorAll('.cmp-meta-cell');
    expect(cells.length).toBe(2);
    const text = cells[0].textContent ?? '';
    expect(text.startsWith('2金')).toBe(true);
    expect(text.indexOf('金')).toBeLessThan(text.indexOf('银'));
    expect(text).toContain('3银');
    const blocks = within(cells[0] as HTMLElement).getAllByText(/^\d+[金银]$/);
    expect(blocks.map((b) => b.textContent)).toEqual(['2金', '3银']);
    expect(blocks.map((b) => b.getAttribute('class'))).toEqual([
      'badge-count badge-count-text-gold cmp-badgecnt',
      'badge-count badge-count-text-silver cmp-badgecnt',
    ]);
    expect(cells[0].querySelector('.cmp-dt')?.textContent).toBe('·');
    expect(container.querySelector('.cmp-badgecnt')).toBeTruthy();
  });

  it('TC-CMP-POS-06 · 徽章数两枚全 0：与相邻空态一致出「—」，不出计数块', async () => {
    behaviors = { '1': detail(1, { badgesGold: 0, badgesSilver: 0 }), '2': detail(2, { badgesGold: 0, badgesSilver: 0 }) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelector('.cmp-meta')).toBeTruthy());
    const cells = rowOf('徽章数').querySelectorAll('.cmp-meta-cell');
    expect(cells.length).toBe(2);
    for (const cell of cells) {
      expect(cell.querySelector('.cmp-mut')?.textContent).toBe('—');
      expect(cell.querySelector('.cmp-badgecnt')).toBeNull();
    }
    expect(container.querySelectorAll('.cmp-badgecnt').length).toBe(0);
  });
});

// ---- TC-CMP-MOB · 移动端断点（组件侧可测条目）----

describe('TC-CMP-MOB：≤840px', () => {
  it('TC-CMP-MOB-01 · 2 人窄屏：不出热区图、叠图仍在、属性行仍单行多值', async () => {
    setNarrow(true);
    behaviors = { '1': detail(1), '2': detail(2, {}, attrsOf({ sprintspeed: 78, acceleration: 70 })) };
    const { container } = open('/players/compare?ids=1,2');
    await waitFor(() => expect(container.querySelectorAll('.cmp-card').length).toBe(2));
    expect(container.querySelectorAll('.cmp-heatmap').length).toBe(0);
    expect(container.querySelector('.cmp-radar-big')).toBeTruthy();
    const cells = valueCellsOf('冲刺速度');
    expect(cells.length).toBe(2);
    expect(cells.map((c) => c.textContent)).toEqual(['94', '78']);
  });

  it('TC-CMP-MOB-02 · 3 人窄屏：三张并排小雷达仍在、每行 3 值', async () => {
    setNarrow(true);
    behaviors = { '1': detail(1), '2': detail(2), '3': detail(3) };
    const { container } = open('/players/compare?ids=1,2,3');
    await waitFor(() => expect(container.querySelectorAll('.cmp-card').length).toBe(3));
    expect(container.querySelectorAll('.cmp-radar-small').length).toBe(3);
    expect(valueCellsOf('冲刺速度').length).toBe(3);
    expect(container.querySelectorAll('.cmp-heatmap').length).toBe(0);
  });
});
