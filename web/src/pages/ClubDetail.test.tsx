// @vitest-environment jsdom
// 球队详情页（web/src/pages/ClubDetail.tsx，v3.4.0 步骤 7；v6.30.0 A 段从平铺长页改成页签）的组件测试：
// 页头（队名/分级/排名徽章/自家账目行）+ 页签壳（默认页签、?tab= 深链、非法与无权值回落、切页签写 URL）
// + 各页签内部口径（阵容组三格与三图、名单、运营组、战绩组、自家工作台与主场档案）
// + 按需加载（只有激活页签才打对应端点：阵容页签下不请求 /api/club/home-matches、主场页签下不请求名单）。
// 没打 CSS（jsdom 不跑样式表），视觉表现靠 e2e 截图看；这里只钉结构与内联宽度。
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ClubBand,
  ClubDetail as ClubDetailDto,
  ClubEventsResponse,
  ClubFormRow,
  ClubPositionGroup,
  ClubStanding,
  ClubTransferRow,
  HomeMatchRow,
  HomeMatchesResponse,
  MeUser,
  MyClubOverview,
  PlayerLibraryRow,
  PlayersLibraryResponse,
  SquadCompliance,
  SquadOverview,
  SquadPlayerRow,
  SquadRules,
  StadiumInfo,
} from '../lib/api.ts';
import ClubDetail from './ClubDetail.tsx';
import { qk } from '../lib/queries.ts';

const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
// mediaUrl 给真实现（TeamLogo 要用它把 logoKey 折成 /api/media/*）；
// apiPost 只在注册工作台的提交用例里用到（v6.33.1），其余用例不会触发。
vi.mock('../lib/api.ts', () => ({
  api: apiMock,
  apiPost: apiPostMock,
  mediaUrl: (key: string | null | undefined) => (key ? `/api/media/${key}` : null),
}));

// 自家页签的开关是 useMyClubOverview → useAuth().user，组件测试里给一个可切的假登录态。
// 默认匿名：既有用例一条请求都不多发，只有自家页签的几个用例才把它设成登录。
const { authState } = vi.hoisted(() => ({ authState: { user: null as unknown } }));
vi.mock('../lib/auth.tsx', () => ({
  useAuth: () => ({ user: authState.user, authMode: 'shared', authHome: null }),
}));

function band(key: string, label: string, count: number): ClubBand {
  return { key, label, count };
}

// 分档口径与后端 src/worker/routes/clubs.ts 的 AGE_BANDS / CA_BANDS / YEARS_BANDS 对齐
const BY_AGE: ClubBand[] = [
  band('u18', '≤18', 1),
  band('b19', '19–21', 2),
  band('b22', '22–24', 0),
  band('b25', '25–27', 0),
  band('b28', '28–30', 1),
  band('b31', '≥31', 0),
];
// 五档降序、占比之和 = 阵容人数（5）⇒ 也顺带钉住「比例的分母是全队人数」而不是「各档之和」
const BY_CA: ClubBand[] = [
  band('ca90', '90+', 1),
  band('ca85', '85–89', 1),
  band('ca80', '80–84', 0),
  band('ca70', '70–79', 2),
  band('cau70', '<70', 1),
];
const BY_YEARS: ClubBand[] = [band('le05', '≤0.5', 1), band('y1', '1-1.5', 2)];

// v6.30.0 A 段：位置分布只剩一行文字（档内细位不再展开），detail 字段仍由后端下发但页面不用
const BY_POSITION: ClubPositionGroup[] = [
  { key: 'GK', label: '门将', count: 0, detail: '' },
  { key: 'DF', label: '后卫', count: 1, detail: 'CB 1' },
  { key: 'MF', label: '中场', count: 2, detail: 'CM 1 · CAM 1' },
  { key: 'FW', label: '前锋', count: 1, detail: 'ST 1' },
  { key: 'unknown', label: '未知', count: 1, detail: '' },
];

function transfer(patch: Partial<ClubTransferRow> & { id: number }): ClubTransferRow {
  return {
    type: 'transfer',
    playerId: 7,
    playerFcId: null,
    playerName: '张三',
    fromClubId: null,
    fromClubName: null,
    toClubId: null,
    toClubName: null,
    fee: null,
    extraFee: null,
    season: 9,
    windowSeq: 2,
    completedAt: '2026-09-20T10:00:00Z',
    ...patch,
  };
}

function formRow(patch: Partial<ClubFormRow> & { matchId: number }): ClubFormRow {
  return {
    season: 9,
    competitionType: 'league',
    stageName: '常规赛',
    round: 3,
    homeTeam: '阿森纳',
    awayTeam: '切尔西',
    scoreHome: 2,
    scoreAway: 1,
    penHome: null,
    penAway: null,
    result: 'win',
    finishedAt: '2026-09-21T10:00:00Z',
    ...patch,
  };
}

function detailFixture(patch: Partial<ClubDetailDto> = {}): ClubDetailDto {
  return {
    club: { id: 1, name: '阿森纳', isCpu: false, tier: 'premier', logoKey: 'team/90/1.png' },
    squad: {
      size: 5,
      senior: 4,
      trainee: 1,
      avgCa: 75.24,
      maxCa: 90,
      avgPa: 83.33,
      avgGrowth: 10,
      totalValue: 1234.5,
      totalWage: 4.4,
      avgWage: 1.1,
      badgesSilver: 3,
      badgesGold: 1,
      byPosition: BY_POSITION,
      byAge: BY_AGE,
      byCa: BY_CA,
    },
    contracts: { signed: 3, unprotected: 1, protectedCount: 1, avgYears: 1.5, byYears: BY_YEARS },
    transfers: {
      incoming: [
        transfer({ id: 11, playerName: '张三', fromClubId: 243, fromClubName: '皇家马德里', fee: 12.5, extraFee: 1.5 }),
        transfer({ id: 12, playerName: '李四', fromClubId: null, fromClubName: null, type: 'free_agent' }),
      ],
      outgoing: [transfer({ id: 13, playerName: '王五', toClubId: 66, toClubName: '乙级队', fee: 3 })],
    },
    form: {
      recent: [
        formRow({ matchId: 101 }),
        formRow({ matchId: 102, scoreHome: 1, scoreAway: 1, result: 'draw' }),
        formRow({ matchId: 103, homeTeam: '切尔西', awayTeam: '阿森纳', scoreHome: 2, scoreAway: 0, result: 'loss', penHome: 4, penAway: 3 }),
      ],
      wins: 1,
      draws: 1,
      losses: 1,
    },
    ...patch,
  };
}

function rosterRow(patch: Partial<PlayerLibraryRow> & { id: number; name: string }): PlayerLibraryRow {
  return {
    uid: `fc${patch.id}`,
    number: null,
    clubId: 1,
    position: 'CM',
    age: 24,
    ca: 75,
    pa: 85,
    prestige: 0,
    marketValue: 10,
    status: 'normal',
    // v6.30.0（转会设置）：列表行新必填字段
    transferListed: false,
    notForSale: false,
    growthTier: 0,
    isFutureStar: false,
    chinaPlan: false,
    agentTier: 0,
    marker: null,
    badgesSilver: 0,
    badgesGold: 0,
    growable: true,
    clubName: '阿森纳',
    positions: ['CM'],
    influence: 1.23,
    wage: 0.5,
    releaseFee: null,
    contractType: 'standard',
    foot: 1,
    baseCa: 75,
    fcId: patch.id,
    source: null,
    serviceSeasons: 1.5,
    protected: false,
    ...patch,
  };
}

const ROSTER: PlayersLibraryResponse = {
  players: [
    rosterRow({ id: 7, name: '张三', positions: ['CM', 'CAM'], age: 24, ca: 75, pa: 85, wage: 0.5 }),
    rosterRow({ id: 8, name: '李四', positions: [], age: 19, ca: 60, pa: 88, status: 'trainee', wage: null }),
  ],
  nextCursor: null,
};

// 教练区块的最小名单：rules / compliance / registration 都为 null，工作台里都有兜底分支
function squadFixture(clubId: number): SquadOverview {
  return {
    club: { id: clubId, name: '阿森纳', leagueTier: 'premier' },
    season: 9,
    registeredInTournament: true,
    players: [],
    registration: null,
    compliance: null,
    // v6.33.1：放行档为必填字段（未绑队的早退响应也带）
    checkMode: 'enforce',
    rules: null,
  };
}

// 注册工作台要 rules 非空才挂出表格与提交按钮（既有用例在自家页签里内联了一份同值规则）
const DESK_RULES: SquadRules = {
  squadMin: 18,
  squadMax: 30,
  gkMin: 2,
  traineeMax: 10,
  wageCap: 20,
  limits: { ge90: 2, ge87: 4, growthPa87: 6 },
  tier: 'premier',
};

// 体检夹具（v6.33.1）：放行档用例只关心 issues 怎么被展示，stats 给一份能过类型的零头
function complianceFixture(patch: Partial<SquadCompliance> = {}): SquadCompliance {
  return {
    pass: false,
    issues: [{ rule: 'squad_size', message: '一线队人数不足 18 人', playerIds: [] }],
    stats: { firstTeam: 1, trainee: 0, goalkeepers: 0, ge90: 0, ge87: 0, growthPa87: 0, wageTotal: 0.5 },
    ...patch,
  };
}

// 注册工作台的行夹具（v6.30.0 C 段：/api/club/squad 补了可选列池的字段，行类型跟着长胖）
function deskPlayer(patch: Partial<SquadPlayerRow> & { id: number; name: string }): SquadPlayerRow {
  return {
    fcId: patch.id,
    uid: `fc${patch.id}`,
    number: null,
    position: 'CM',
    age: 24,
    ca: 75,
    pa: 85,
    baseCa: 75,
    marker: null,
    growable: true,
    isFutureStar: false,
    chinaPlan: false,
    prestige: 0,
    status: 'normal',
    marketValue: 10,
    foot: 1,
    growthTier: 0,
    agentTier: 0,
    badgesSilver: 0,
    badgesGold: 0,
    wage: 0.5,
    releaseFee: null,
    contractType: 'formal',
    source: null,
    serviceSeasons: 1.5,
    protected: false,
    psIds: Array.from({ length: 15 }, () => null),
    hasContract: true,
    squad: null,
    ...patch,
  };
}

function homeFixture(): StadiumInfo {
  return {
    name: '酋长球场',
    namingBrand: null,
    capacity: 60000,
    tier: 3,
    tierName: '专业',
    fans: 12000,
    influence: { players: 12.5, shell: 4, bonus: 2, tierCoef: 1.2, total: 20.6 },
    facilities: [{ key: 'pitch', level: 2 }],
  };
}

function homeMatch(patch: Partial<HomeMatchRow> & { matchId: number }): HomeMatchRow {
  return {
    season: 9,
    windowSeq: 3,
    weather: '晴',
    attendance: 55000,
    attendanceRate: 0.92,
    ticket: 5.5,
    commercial: 2,
    broadcast: 0.7,
    total: 8.2,
    opponentId: 66,
    opponentName: '切尔西',
    scoreText: '2 : 1',
    result: '胜',
    ...patch,
  };
}

function meFixture(clubId: number | null, patch: Partial<MyClubOverview> = {}): MyClubOverview {
  if (clubId === null) return { club: null, balance: null, squadCount: null, window: null, home: null };
  return {
    club: { id: clubId, name: '阿森纳', leagueTier: 'premier', logoKey: null, status: 'active', transferBanned: false },
    balance: 12.5,
    squadCount: 24,
    window: { season: 9, windowSeq: 3 },
    // home 为 null：主场页签的两块（球场/设施、战报）都不挂
    home: null,
    ...patch,
  };
}

const EMPTY_EVENTS: ClubEventsResponse = { clubId: 1, pending: [], recent: [] };

interface Stub {
  detail?: ClubDetailDto | Error;
  standing?: ClubStanding | Error;
  roster?: PlayersLibraryResponse | Error;
  me?: MyClubOverview;
  squad?: SquadOverview;
  homeMatches?: HomeMatchesResponse;
  events?: ClubEventsResponse;
}

// 各条请求各走各的桩。先判 standing —— '/api/clubs/1' 是 '/api/clubs/1/standing' 的前缀。
function stubApi({ detail = detailFixture(), standing, roster = ROSTER, me, squad, homeMatches, events }: Stub = {}) {
  const standingBody: ClubStanding | Error = standing ?? { standing: null, note: '本赛季暂无联赛排名' };
  const meBody = me ?? meFixture(null);
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/clubs/') && path.endsWith('/standing')) {
      return standingBody instanceof Error ? Promise.reject(standingBody) : Promise.resolve(standingBody);
    }
    if (path.startsWith('/api/clubs/')) {
      return detail instanceof Error ? Promise.reject(detail) : Promise.resolve(detail);
    }
    if (path.startsWith('/api/players?')) {
      return roster instanceof Error ? Promise.reject(roster) : Promise.resolve(roster);
    }
    if (path === '/api/me/club') return Promise.resolve(meBody);
    if (path === '/api/club/squad') return Promise.resolve(squad ?? squadFixture(meBody.club?.id ?? 0));
    if (path === '/api/club/home-matches') return Promise.resolve(homeMatches ?? { club: null, matches: [] });
    if (path === '/api/club/events') return Promise.resolve(events ?? EMPTY_EVENTS);
    return Promise.reject(new Error(`未桩的请求：${path}`));
  });
}

// 地址探针：切页签只改 query（?tab=），用它的文本钉住 URL 口径
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{`${loc.pathname}${loc.search}`}</span>;
}

function renderDetail(entry = '/clubs/1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/clubs/:id" element={<ClubDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // 连 qc 一起返回：v6.33.1 的三态用例要拿它把 squad 缓存刷成新档位，
  // 验证同一组件树（无 key）下红字跟随新 props 收敛
  return { qc, ...result };
}

function path(): string {
  return screen.getByTestId('loc').textContent ?? '';
}

function pathsCalled(): string[] {
  return apiMock.mock.calls.map((c) => c[0] as string);
}

// 取某个小节的 .club-sub 容器（标题的父节点）
function sub(title: string): HTMLElement {
  return screen.getByText(title).parentElement as HTMLElement;
}

// 「阵容名单」整块（v6.30.0 C 段起）：标题的父节点是 .tier-head（标题 + 「列」开关一行），
// 表/图例/超页提示都在它外面 —— 用 sub('阵容名单') 会落进一个只有标题的空壳，得往上取 .club-sub
function rosterBlock(): HTMLElement {
  return screen.getByText('阵容名单').closest('.club-sub') as HTMLElement;
}

// 主指标格的标签顺序 —— 用来钉住「等权指标网格已经拆成三格主指标 + 明细行」
function heroLabels(scope: HTMLElement): string[] {
  return Array.from(scope.querySelectorAll('.club-hero-item dt')).map((el) => el.textContent ?? '');
}

// 按标签取主指标格的数值：dd 里是「数值 + 可选 hint」，firstChild 就是数值本身（hint 在后面的 span 里）
function statValue(scope: HTMLElement, label: string): string {
  const cell = within(scope).getByText(label).closest('.club-hero-item') as HTMLElement;
  return (cell.querySelector('dd') as HTMLElement).firstChild?.textContent ?? '';
}

function statHint(scope: HTMLElement, label: string): string | null {
  const cell = within(scope).getByText(label).closest('.club-hero-item') as HTMLElement;
  return cell.querySelector('.club-hero-hint')?.textContent?.trim() ?? null;
}

// 明细行按组名取整段文字（能力/资产/荣誉…）
function detailLine(scope: HTMLElement, label: string): string {
  const line = scope.querySelector('.club-detail-line') as HTMLElement;
  return (within(line).getByText(label).closest('span') as HTMLElement).textContent ?? '';
}

// 自家页头的统计格是 span.stat-label + span.stat-value（不是详情页那套 dl/dt/dd），取值要另走一路
function statText(scope: HTMLElement, label: string): string {
  const cell = within(scope).getByText(label).closest('.club-stat') as HTMLElement;
  return (cell.querySelector('.stat-value') as HTMLElement).textContent ?? '';
}

/* ---------- 页签壳 helpers ---------- */

function tabsGroup(): HTMLElement {
  return screen.getByRole('radiogroup', { name: '球队页签' });
}

function tabLabels(): string[] {
  return within(tabsGroup())
    .getAllByRole('button')
    .map((b) => b.textContent ?? '');
}

function activeTab(): string {
  const on = within(tabsGroup())
    .getAllByRole('button')
    .filter((b) => b.className.includes('on'));
  expect(on.length).toBe(1); // 同时只能有一个激活页签
  return on[0].textContent ?? '';
}

async function clickTab(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(within(tabsGroup()).getByRole('button', { name: label }));
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiPostMock.mockReset();
  authState.user = null;
});

describe('球队详情页：页头与页签壳（v6.30.0 A 段）', () => {
  it('队头：队名、分级徽章、队徽、排名徽章；未定级与 CPU 各出灰标', async () => {
    stubApi({ standing: { standing: { tournamentId: 101, stageName: '常规赛', groupName: 'A 组', position: 2, played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 5, goalsAgainst: 3, pts: 6, pointsDeducted: 0 }, note: null } });
    renderDetail();

    expect(await screen.findByText('阿森纳')).toBeTruthy();
    expect(screen.getByText('顶级联赛')).toBeTruthy();
    expect(screen.getByText('联赛第 2 名')).toBeTruthy();
    expect(screen.getByAltText('阿森纳').getAttribute('src')).toBe('/api/media/team/90/1.png');
    expect(screen.queryByText('CPU')).toBeNull();
    expect(screen.queryByText('未定级')).toBeNull();
  });

  it('未定级与 CPU 队：出灰标（tier 为 null 时不能渲染成空白）', async () => {
    stubApi({
      detail: detailFixture({
        club: { id: 999, name: '甲队 (CPU)', isCpu: true, tier: null, logoKey: null },
      }),
    });
    renderDetail('/clubs/999');

    expect(await screen.findByText('甲队 (CPU)')).toBeTruthy();
    expect(screen.getByText('未定级')).toBeTruthy();
    expect(screen.getByText('CPU')).toBeTruthy();
    // 没有 logoKey ⇒ 首字色块
    expect(screen.getByText('甲').className).toContain('team-logo-fallback');
  });

  it('访客默认落在「阵容」页签，且页签条只给三个公开页签', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('阵容组');
    expect(tabLabels()).toEqual(['阵容', '转会', '战绩']);
    expect(activeTab()).toBe('阵容');
    // 无参不进 URL：默认页签不写 ?tab=
    expect(path()).toBe('/clubs/1');
  });

  it('自家默认落在「工作台」页签，页签顺序固定为五个', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(1) });
    renderDetail();

    await screen.findByText(/注册工作台/);
    expect(tabLabels()).toEqual(['工作台', '阵容', '转会', '战绩', '主场']);
    expect(activeTab()).toBe('工作台');
  });

  it('?tab= 深链：访客也能直接落到「转会」，不用先点一下', async () => {
    stubApi();
    renderDetail('/clubs/1?tab=transfers');

    expect(await screen.findByText('运营组')).toBeTruthy();
    expect(activeTab()).toBe('转会');
    expect(path()).toBe('/clubs/1?tab=transfers');
  });

  it('自家 ?tab=venue 深链直接渲染主场档案与主场战报', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(1, { home: homeFixture() }) });
    renderDetail('/clubs/1?tab=venue');

    expect(await screen.findByText('主场档案')).toBeTruthy();
    expect(activeTab()).toBe('主场');
  });

  it('无权/非法 tab 回落第一个可见页签：访客传 desk 或 venue 都不能钻进自家页签', async () => {
    stubApi();
    renderDetail('/clubs/1?tab=desk');

    await screen.findByText('阵容组');
    expect(activeTab()).toBe('阵容');
    // 回落不改 URL（URL 是后端出错的兜底证据，不该被前端悄悄擦掉）
    expect(path()).toBe('/clubs/1?tab=desk');
    expect(screen.queryByText('注册工作台')).toBeNull();

    cleanup();
    apiMock.mockReset();
    stubApi();
    renderDetail('/clubs/1?tab=venue');
    await screen.findByText('阵容组');
    expect(activeTab()).toBe('阵容');
    expect(screen.queryByText('主场档案')).toBeNull();

    cleanup();
    apiMock.mockReset();
    stubApi();
    renderDetail('/clubs/1?tab=nope');
    await screen.findByText('阵容组');
    expect(activeTab()).toBe('阵容');
  });

  it('切页签把选中的 tab 写进 ?tab=（路径不变）', async () => {
    const user = userEvent.setup();
    stubApi();
    renderDetail();

    await screen.findByText('阵容组');
    await clickTab(user, '转会');
    expect(await screen.findByText('运营组')).toBeTruthy();
    expect(path()).toBe('/clubs/1?tab=transfers');

    await clickTab(user, '战绩');
    expect(await screen.findByText('战绩组')).toBeTruthy();
    expect(path()).toBe('/clubs/1?tab=results');

    await clickTab(user, '阵容');
    expect(await screen.findByText('阵容组')).toBeTruthy();
    expect(path()).toBe('/clubs/1?tab=squad');
  });
});

describe('阵容页签：阵容组与名单', () => {
  it('阵容组：只留三格主指标（人数拆一线队/青训、平均值一位小数、金额带 m）', async () => {
    stubApi();
    renderDetail();

    const squadBlock = (await screen.findByText('阵容组')).closest('section') as HTMLElement;
    expect(heroLabels(squadBlock)).toEqual(['阵容人数', '平均 CA', '总身价']);
    expect(statValue(squadBlock, '阵容人数')).toBe('4 人');
    expect(statHint(squadBlock, '阵容人数')).toBe('+ 1 青训');
    expect(statValue(squadBlock, '平均 CA')).toBe('75.2'); // 75.24 只显示一位
    expect(statValue(squadBlock, '总身价')).toBe('1234.50 m');
  });

  it('阵容组明细行：能力 / 资产 / 荣誉三段，各段内用「·」连', async () => {
    stubApi();
    renderDetail();

    const squadBlock = (await screen.findByText('阵容组')).closest('section') as HTMLElement;
    expect(detailLine(squadBlock, '能力')).toBe('能力最高 CA 90.0 · 平均 PA 83.3 · 成长空间 10.0');
    expect(detailLine(squadBlock, '资产')).toBe('资产工资总额 4.40 m · 平均工资 1.10 m');
    expect(detailLine(squadBlock, '荣誉')).toBe('荣誉金徽章 1 枚 · 银徽章 3 枚');
  });

  it('没有青训时不显示「+ 0 青训」，平均工资缺失显示 —', async () => {
    stubApi({
      detail: detailFixture({
        squad: { ...detailFixture().squad, trainee: 0, avgWage: null },
      }),
    });
    renderDetail();

    const squadBlock = (await screen.findByText('阵容组')).closest('section') as HTMLElement;
    expect(statValue(squadBlock, '阵容人数')).toBe('4 人');
    expect(statHint(squadBlock, '阵容人数')).toBeNull();
    expect(detailLine(squadBlock, '资产')).toBe('资产工资总额 4.40 m · 平均工资 —');
  });

  it('全队都没录身价时总身价显示 —（不是 0.00 m）', async () => {
    stubApi({
      detail: detailFixture({ squad: { ...detailFixture().squad, totalValue: null } }),
    });
    renderDetail();

    const squadBlock = (await screen.findByText('阵容组')).closest('section') as HTMLElement;
    expect(statValue(squadBlock, '总身价')).toBe('—');
    expect(detailLine(squadBlock, '资产')).toBe('资产工资总额 4.40 m · 平均工资 1.10 m');
  });

  it('位置分布缩成一行文字（四档 + 未知都出，含 0 人档），不再展开档内细位、不出图示', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('位置分布');
    const pos = sub('位置分布');
    const line = pos.querySelector('.club-position-line') as HTMLElement;
    expect(line.textContent).toBe('门将 0 人 · 后卫 1 人 · 中场 2 人 · 前锋 1 人 · 未知 1 人');
    // 0 门将也照样出现：这是要看见的信号，不是空
    expect(line.textContent).toContain('门将 0 人');
    // 旧的三列网格与档内细位规则已删（v6.30.0 A 段删减项③）
    expect(pos.querySelectorAll('.club-position-list, .club-position-detail').length).toBe(0);
    // 用户裁决「位置不用图示」：这一节不该有任何图形元素
    expect(pos.querySelectorAll('.band-bar, .club-hist-bar, .club-share-seg').length).toBe(0);
  });

  it('年龄结构出竖直直方图：柱高按最高档归一、人数标在柱顶、0 人档不出柱', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('年龄结构');
    const cols = sub('年龄结构').querySelectorAll('.club-hist-col');
    expect(cols.length).toBe(BY_AGE.length);
    expect(Array.from(cols).map((c) => (c.querySelector('.club-hist-count') as HTMLElement).textContent)).toEqual([
      '1',
      '2',
      '0',
      '0',
      '1',
      '0',
    ]);
    // 最大档 2 人 ⇒ 满格；1 人档半格；0 人档高度 0（不是 min-height 假装有 1 人）
    const heights = Array.from(cols).map(
      (c) => (c.querySelector('.club-hist-bar') as HTMLElement).style.height,
    );
    expect(heights).toEqual(['50%', '100%', '0%', '0%', '50%', '0%']);
    expect(Array.from(cols).map((c) => (c.querySelector('.club-hist-label') as HTMLElement).textContent)).toEqual([
      '≤18',
      '19–21',
      '22–24',
      '25–27',
      '28–30',
      '≥31',
    ]);
  });

  it('CA 结构出 100% 堆叠条：段宽分母是全队人数（不是各档之和），带 0–100% 刻度与逐档图例', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('CA 结构');
    const ca = sub('CA 结构');
    // 堆叠条只画有人的档（0 人档画 0 宽段没有意义），所以段数少于档数
    const segs = ca.querySelectorAll('.club-share-seg');
    expect(segs.length).toBe(4);
    // 全队 5 人：1 人档 20%、2 人档 40%。若误按「各档之和归一」，最大档会变 100% ⇒ 这条会红
    expect(Array.from(segs).map((s) => (s as HTMLElement).style.width)).toEqual(['20%', '20%', '40%', '20%']);

    // 图例五档恒出（含 0 人档），label + 人数 + 占比，title 给完整口径
    const legend = ca.querySelectorAll('.club-share-legend-row');
    expect(legend.length).toBe(BY_CA.length);
    expect(Array.from(legend).map((r) => (r.querySelector('.club-share-legend-value') as HTMLElement).textContent)).toEqual([
      '1 人 · 20%',
      '1 人 · 20%',
      '0 人 · 0%',
      '2 人 · 40%',
      '1 人 · 20%',
    ]);
    expect((legend[3] as HTMLElement).getAttribute('title')).toBe('70–79：2 人 · 占全队 40%');
    expect(Array.from(ca.querySelectorAll('.club-share-tick')).map((el) => el.textContent)).toEqual([
      '0%',
      '25%',
      '50%',
      '75%',
      '100%',
    ]);
  });

  it('阵容名单：11 列固定列序，号码/UID/位置/违约金/工资各就各位，人链到 /players/:id', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('阵容名单');
    const roster = rosterBlock();
    // 名单是异步拉的：先等第一行出来，再查表头/列数（不然只剩「正在点名…」）
    await within(roster).findByText('张三');
    const table = within(roster).getByRole('table');
    // 固定列序（v6.30.0 C 段）：标记 / 号码 / UID / 姓名 / 年龄 / 位置 / CA / PA / 违约金 / 工资 / 转会状态
    expect(Array.from(table.querySelectorAll('thead th'), (th) => th.textContent)).toEqual([
      '标记',
      '号码',
      'UID',
      '姓名',
      '年龄',
      '位置',
      'CA',
      'PA',
      '违约金',
      '工资',
      '转会状态',
    ]);
    // 转会状态表头 title 带整张图标词表（桌面 hover 表头也能查）
    expect(table.querySelector('thead th:last-child')!.getAttribute('title')).toBe(
      '拍卖锤 挂牌中 · 清单 转会名单 · 欧元 已标价 · 锁 非卖品',
    );

    const row = (await within(roster).findByText('李四')).closest('tr') as HTMLElement;
    const cells = row.querySelectorAll('td');
    expect(cells).toHaveLength(11);
    expect((cells[0] as HTMLElement).textContent).toBe(''); // 标记：没标
    expect((cells[1] as HTMLElement).textContent).toBe('—'); // 号码没录
    expect((cells[2] as HTMLElement).textContent).toBe('8'); // UID 去掉 fc 前缀
    expect((cells[4] as HTMLElement).textContent).toBe('19');
    expect((cells[5] as HTMLElement).textContent).toBe('—'); // 位置空数组
    expect((cells[8] as HTMLElement).textContent).toBe('—'); // 违约金：没合同
    expect((cells[9] as HTMLElement).textContent).toBe('—'); // 工资：没合同
    expect((cells[10] as HTMLElement).textContent).toBe('—'); // 转会状态：四态全不占
    expect((within(row).getByText('李四') as HTMLAnchorElement).getAttribute('href')).toBe('/players/8');

    const first = (within(roster).getByText('张三') as HTMLElement).closest('tr') as HTMLElement;
    expect(within(first).getByText('CM CAM')).toBeTruthy();
    expect((first.querySelectorAll('td')[9] as HTMLElement).textContent).toBe('0.50 m');
    // 旧的「状态」徽章列已撤（状态并进转会状态图标列），名单里不再出在队/训练营中文徽章
    expect(within(roster).queryByText('在队')).toBeNull();
    expect(within(roster).queryByText('训练营')).toBeNull();
  });

  it('转会状态列：四态各出图标且只出图标，表下那行图例四种俱全', async () => {
    stubApi({
      roster: {
        players: [
          rosterRow({ id: 7, name: '张三', status: 'listed' }), // 挂牌中 → 拍卖锤
          rosterRow({ id: 8, name: '李四', transferListed: true }), // 转会名单 → 清单
          rosterRow({ id: 9, name: '王五', transferPriced: true }), // 已标价 → 欧元
          rosterRow({ id: 10, name: '赵六', notForSale: true }), // 非卖品 → 锁
        ],
        nextCursor: null,
      },
    });
    renderDetail();

    await screen.findByText('阵容名单');
    const roster = rosterBlock();
    await within(roster).findByText('张三');
    const cellOf = (name: string) =>
      (within(roster).getByText(name).closest('tr') as HTMLElement)
        .querySelectorAll('td')[10]!.querySelector('.transfer-status') as HTMLElement;

    expect(cellOf('张三').getAttribute('title')).toBe('挂牌中');
    expect(cellOf('李四').getAttribute('title')).toBe('转会名单');
    expect(cellOf('王五').getAttribute('title')).toBe('已标价');
    expect(cellOf('赵六').getAttribute('title')).toBe('非卖品');
    for (const name of ['张三', '李四', '王五', '赵六']) {
      const cell = cellOf(name);
      expect(cell.querySelector('svg'), name).not.toBeNull();
      // 只出图标：可见文本为空，中文只在 title / aria-label 里
      expect(cell.textContent, name).toBe('');
      expect(cell.getAttribute('aria-label'), name).toBe(cell.getAttribute('title'));
    }
    // 四枚图标互不相同（映射没串）
    const shapes = ['张三', '李四', '王五', '赵六'].map((n) => cellOf(n).querySelector('svg')!.innerHTML);
    expect(new Set(shapes).size).toBe(4);

    // 表下那行图例：窄屏没有 hover，靠它解释图标
    const legend = roster.querySelector('.transfer-status-legend') as HTMLElement;
    expect(Array.from(legend.querySelectorAll('.transfer-legend-item'), (el) => el.textContent)).toEqual([
      '拍卖锤 挂牌中',
      '清单 转会名单',
      '欧元 已标价',
      '锁 非卖品',
    ]);
  });

  it('「列」开关：默认一列不多，勾选写进 ?cols= 且列立刻出现，再点一次收回去', async () => {
    stubApi();
    const user = userEvent.setup();
    renderDetail('/clubs/1');

    await screen.findByText('阵容名单');
    const roster = rosterBlock();
    await within(roster).findByText('张三');
    expect(path()).toBe('/clubs/1');
    expect(within(roster).getAllByRole('columnheader')).toHaveLength(11);

    await user.click(within(roster).getByRole('button', { name: /^列/ }));
    const panel = await screen.findByRole('group', { name: '列' });
    await user.click(within(panel).getByRole('checkbox', { name: '身价' }));

    expect(path()).toBe('/clubs/1?cols=marketValue');
    expect(within(roster).getAllByRole('columnheader')).toHaveLength(12);
    expect(within(roster).getByRole('columnheader', { name: '身价' })).toBeTruthy();
    const first = (within(roster).getByText('张三') as HTMLElement).closest('tr') as HTMLElement;
    expect((first.querySelectorAll('td')[11] as HTMLElement).textContent).toBe('10.00 m');

    await user.click(within(panel).getByRole('checkbox', { name: '身价' }));
    expect(path()).toBe('/clubs/1');
    expect(within(roster).getAllByRole('columnheader')).toHaveLength(11);
  });

  it('名单超过一页时提示去球员库看全部，链接带 club_id', async () => {
    stubApi({ roster: { players: ROSTER.players, nextCursor: 'cursor-1' } });
    renderDetail();

    const hint = await screen.findByText(/只显示前 2 人/);
    expect(within(hint).getByText('去球员库看全部').closest('a')!.getAttribute('href')).toBe('/players?club_id=1');
  });

  it('名单为空时给空态，不渲染空表', async () => {
    stubApi({ roster: { players: [], nextCursor: null } });
    renderDetail();

    await screen.findByText('阵容名单');
    const roster = rosterBlock();
    expect(await within(roster).findByText('队里还没有人。')).toBeTruthy();
    expect(within(roster).queryByRole('table')).toBeNull();
  });

  it('阵容名单里的人链到 fc_id，不是内部 id（v4.0.0）', async () => {
    stubApi({
      roster: {
        players: [rosterRow({ id: 8, name: '李四', fcId: 239085 })],
        nextCursor: null,
      },
    });
    renderDetail();

    await screen.findByText('阵容名单');
    const roster = rosterBlock();
    const link = (await within(roster).findByText('李四')) as HTMLAnchorElement;
    // 内部 id 是 8，但链接必须走 fc_id —— 内部 id 会随重导入变化
    expect(link.getAttribute('href')).toBe('/players/239085');
  });

  it('名单拉失败时给错误提示与重试，不停在「正在点名…」', async () => {
    stubApi({ roster: new Error('名单服务打盹了') });
    renderDetail();

    await screen.findByText('阵容名单');
    const roster = rosterBlock();
    expect(await within(roster).findByText(/名单服务打盹了/)).toBeTruthy();
    expect(within(roster).queryByText('正在点名…')).toBeNull();
    expect(within(roster).getByText('重试')).toBeTruthy();
  });
});

describe('转会页签：运营组', () => {
  it('运营组：合同统计、效力年限图、转入转出表（对手队链 /clubs/:id、自由身不链）', async () => {
    stubApi();
    renderDetail();

    const user = userEvent.setup();
    await screen.findByText('阵容组');
    await clickTab(user, '转会');

    const ops = (await screen.findByText('运营组')).closest('section') as HTMLElement;
    expect(heroLabels(ops)).toEqual(['在册合同', '保护期内', '未保护']);
    expect(statValue(ops, '在册合同')).toBe('3 份');
    expect(statValue(ops, '保护期内')).toBe('1 人');
    expect(statValue(ops, '未保护')).toBe('1 人');
    expect(detailLine(ops, '效力')).toBe('效力平均 1.5 赛季');

    // 效力年限图只在本组归一（最大档 2 人）
    const yearBars = sub('效力年限').querySelectorAll('.band-bar');
    expect(yearBars.length).toBe(BY_YEARS.length);
    expect((yearBars[1] as HTMLElement).style.width).toBe('100%');

    const incoming = within(ops).getByText('皇家马德里');
    expect((incoming as HTMLAnchorElement).getAttribute('href')).toBe('/clubs/243');
    expect(within(ops).getByText('12.50 m +1.50')).toBeTruthy();
    expect(within(ops).getByText('海捞签入')).toBeTruthy();
    // 自由身转入：文字是「自由身」而不是链接
    expect((within(ops).getAllByText('自由身')[0] as HTMLElement).tagName).toBe('TD');

    const outgoing = within(ops).getByText('乙级队');
    expect((outgoing as HTMLAnchorElement).getAttribute('href')).toBe('/clubs/66');
    // 球员名链到档案页
    expect((within(ops).getAllByText('张三')[0] as HTMLAnchorElement).getAttribute('href')).toBe('/players/7');
  });

  it('转会记录里的人优先链 playerFcId（v4.0.0）', async () => {
    stubApi({
      detail: detailFixture({
        transfers: { incoming: [transfer({ id: 21, playerId: 7, playerFcId: 239085, playerName: '张三' })], outgoing: [] },
      }),
    });
    renderDetail('/clubs/1?tab=transfers');

    const ops = (await screen.findByText('运营组')).closest('section') as HTMLElement;
    expect((within(ops).getAllByText('张三')[0] as HTMLAnchorElement).getAttribute('href')).toBe('/players/239085');
  });

  it('没有转会记录时两块各给空态，不渲染空表', async () => {
    stubApi({ detail: detailFixture({ transfers: { incoming: [], outgoing: [] } }) });
    renderDetail('/clubs/1?tab=transfers');

    expect(await screen.findByText('还没有转入记录。')).toBeTruthy();
    expect(screen.getByText('还没有转出记录。')).toBeTruthy();
    const ops = screen.getByText('运营组').closest('section') as HTMLElement;
    expect(within(ops).queryByRole('table')).toBeNull();
  });

  it('转会球员已从球员库消失（playerId 为 null）时出纯文本，不生成 /players/null', async () => {
    stubApi({
      detail: detailFixture({
        transfers: { incoming: [transfer({ id: 21, playerId: null, playerName: '匿名' })], outgoing: [] },
      }),
    });
    renderDetail('/clubs/1?tab=transfers');

    const cell = (await screen.findByText('匿名')) as HTMLElement;
    expect(cell.tagName).toBe('TD');
    expect(screen.queryByRole('link', { name: '匿名' })).toBeNull();
  });
});

describe('战绩页签', () => {
  it('战绩组：排名口径 + 近期战绩的 90 分钟判定与点球标注', async () => {
    stubApi({
      standing: {
        standing: { tournamentId: 101, stageName: '常规赛', groupName: 'A 组', position: 3, played: 10, won: 5, drawn: 2, lost: 3, goalsFor: 18, goalsAgainst: 12, pts: 17, pointsDeducted: 2 },
        note: null,
      },
    });
    renderDetail('/clubs/1?tab=results');

    const form = (await screen.findByText('战绩组')).closest('section') as HTMLElement;
    expect(heroLabels(form)).toEqual(['名次', '积分', '胜平负']);
    expect(within(form).getByText('第 3 名')).toBeTruthy();
    expect(within(form).getByText('10 场')).toBeTruthy();
    expect(within(form).getByText('5 / 2 / 3')).toBeTruthy();
    expect(within(form).getByText('18 : 12')).toBeTruthy();
    expect(within(form).getByText(/扣 2/)).toBeTruthy();
    expect(statHint(form, '积分')).toBe('扣 2');
    expect(detailLine(form, '场次')).toBe('场次10 场');
    expect(detailLine(form, '进失球')).toBe('进失球18 : 12');

    expect(within(form).getByText(/近 3 场：1 胜 1 平 1 负/)).toBeTruthy();
    const rows = form.querySelectorAll('.form-row');
    expect(rows.length).toBe(3);
    expect(within(rows[0] as HTMLElement).getByText('胜')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('平')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('负')).toBeTruthy();
    // 点球大战比分只做标注，不改判定（那场 90 分钟是 2:0 负）
    expect(within(rows[2] as HTMLElement).getByText('点球 4:3')).toBeTruthy();
  });

  it('排名取不到时显示后端给的 note，不留空白也不当报错', async () => {
    stubApi({ standing: { standing: null, note: '排名暂不可用' } });
    renderDetail('/clubs/1?tab=results');

    expect(await screen.findByText('排名暂不可用')).toBeTruthy();
    const form = screen.getByText('战绩组').closest('section') as HTMLElement;
    expect(within(form).getByText('胜')).toBeTruthy(); // 近期战绩照常渲染
  });

  it('排名取不到且后端没给 note 时兜底文案（不是空白）', async () => {
    stubApi({ standing: { standing: null, note: null } });
    renderDetail('/clubs/1?tab=results');

    const form = (await screen.findByText('战绩组')).closest('section') as HTMLElement;
    expect(within(form).getByText('排名暂不可用')).toBeTruthy();
    expect(within(form).queryByText('第 3 名')).toBeNull();
  });

  it('本赛季没有已确认比赛时给空态', async () => {
    stubApi({ detail: detailFixture({ form: { recent: [], wins: 0, draws: 0, losses: 0 } }) });
    renderDetail('/clubs/1?tab=results');

    expect(await screen.findByText('本赛季还没有已确认的比赛。')).toBeTruthy();
  });
});

describe('自家页签：工作台与主场', () => {
  it('工作台：页头账目行（资金/一线队人数/窗口）+ 注册工作台；教练端只有这里能看见这些数字', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(1) });
    renderDetail('/clubs/1');

    // 页头常驻：账目三格不是页签内容，切到别的页签也还在
    const head = (await screen.findByText('资金余额')).closest('.club-head-numbers') as HTMLElement;
    expect(statText(head, '资金余额')).toBe('12.50 m');
    expect(statText(head, '一线队人数')).toBe('24 人');
    expect(within(head).getByText('第 9 赛季 · 窗口 3')).toBeTruthy();
    // 工作台页签里挂着注册工作台（e2e ⑱ 走这条文案）
    expect(await screen.findByText(/注册工作台/)).toBeTruthy();

    await clickTab(userEvent.setup(), '阵容');
    expect(await screen.findByText('阵容组')).toBeTruthy();
    expect(screen.getByText('资金余额')).toBeTruthy();
  });

  it('工作台：转会权限被冻结时出禁令 banner', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    const base = meFixture(1);
    stubApi({ me: meFixture(1, { club: { ...base.club!, transferBanned: true } }) });
    renderDetail('/clubs/1');

    expect(await screen.findByText(/转会权限已被管理组冻结/)).toBeTruthy();
  });

  it('注册工作台：分配列最左 + 11 列固定列序 + 无合同的人留红徽章与禁用 + 「列」开关走 ?regcols=', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({
      me: meFixture(1),
      squad: {
        ...squadFixture(1),
        // rules 非空才挂出筛选 + 表（rules 为 null 时整块换成「正在加载注册规则…」）
        rules: { squadMin: 18, squadMax: 30, gkMin: 2, traineeMax: 10, wageCap: 20, limits: { ge90: 2, ge87: 4, growthPa87: 6 }, tier: 'premier' },
        players: [
          deskPlayer({ id: 7, name: '张三', number: '9', position: 'ST', ca: 80, pa: 88, wage: 0.75, releaseFee: 30, squad: 'first_team' }),
          deskPlayer({ id: 8, name: '李四', hasContract: false }),
        ],
      },
    });
    const user = userEvent.setup();
    renderDetail('/clubs/1');

    const desk = (await screen.findByText(/注册工作台/)).closest('section') as HTMLElement;
    const table = within(desk).getByRole('table');
    // 固定列序（v6.30.0 C 段）：分配最左，其余与阵容名单同序但无转会状态列
    expect(Array.from(table.querySelectorAll('thead th'), (th) => th.textContent)).toEqual([
      '分配',
      '标记',
      '号码',
      'UID',
      '姓名',
      '年龄',
      '位置',
      'CA',
      'PA',
      '违约金',
      '工资',
    ]);

    const firstRow = table.querySelectorAll('tbody tr')[0] as HTMLElement;
    // 第 1 格是分段按钮（分配），第 2 格才是标记 —— 分配确实最左
    expect(firstRow.querySelector('td:nth-child(1) .seg')).not.toBeNull();
    expect(firstRow.querySelector('td:nth-child(2)')!.className).toContain('marker-cell');
    expect(Array.from(firstRow.querySelectorAll('td:nth-child(1) .seg button'), (b) => b.textContent)).toEqual([
      '—',
      '一线',
      '训练营',
    ]);
    expect(firstRow.querySelector('td:nth-child(3)')!.textContent).toBe('9'); // 号码
    expect(firstRow.querySelector('td:nth-child(4)')!.textContent).toBe('7'); // UID 去掉 fc 前缀
    expect(firstRow.querySelector('td:nth-child(10)')!.textContent).toBe('30.00 m'); // 违约金
    expect(firstRow.querySelector('td:nth-child(11)')!.textContent).toBe('0.75 m'); // 工资（与阵容名单同口径）

    // 无合同的人：一线/训练营禁用，姓名格里留「无合同」红徽章（合同列撤了，被拦的原因不能跟着消失）
    const bare = (within(desk).getByText('李四') as HTMLElement).closest('tr') as HTMLElement;
    const buttons = Array.from(bare.querySelectorAll('td:nth-child(1) .seg button')) as HTMLButtonElement[];
    expect(buttons[0]!.disabled).toBe(false); // 「—」永远可点
    expect(buttons[1]!.disabled).toBe(true);
    expect(buttons[2]!.disabled).toBe(true);
    expect(within(bare).getByText('无合同').getAttribute('title')).toBe('等管理组导入合同模板后才能注册');

    // 「列」开关：注册名单写 ?regcols=，跟阵容名单的 ?cols= 分开（两个页签不串味）
    await user.click(within(desk).getByRole('button', { name: /^列/ }));
    const panel = await screen.findByRole('group', { name: '列' });
    await user.click(within(panel).getByRole('checkbox', { name: '合同类型' }));
    expect(path()).toBe('/clubs/1?regcols=contractType');
    expect(within(desk).getAllByRole('columnheader')).toHaveLength(12);
    expect(within(desk).getByRole('columnheader', { name: '合同类型' })).toBeTruthy();
    expect((firstRow.querySelectorAll('td')[11] as HTMLElement).textContent).toBe('正式合同');
  });

  it('特例期 warn 档：挂提示模式 banner；体检不通过时红字照挂、不显示「通过」绿条', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({
      me: meFixture(1),
      squad: {
        ...squadFixture(1),
        checkMode: 'warn',
        rules: DESK_RULES,
        players: [deskPlayer({ id: 7, name: '张三' })],
        compliance: complianceFixture(),
      },
    });
    renderDetail('/clubs/1');

    expect(await screen.findByText(/特例期：注册校验为提示模式/)).toBeTruthy();
    // warn 档红字是真实体检结果，照挂；绿「通过」条不得出现
    expect(screen.getByText('一线队人数不足 18 人')).toBeTruthy();
    expect(screen.queryByText('资格检查通过，可以安心开赛。')).toBeNull();
  });

  it('特例期 warn 档：提交成功后继续用响应里的 issues 挂红字，不清空', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({
      me: meFixture(1),
      squad: {
        ...squadFixture(1),
        checkMode: 'warn',
        rules: DESK_RULES,
        players: [deskPlayer({ id: 7, name: '张三' })],
        compliance: complianceFixture({ issues: [{ rule: 'squad_size', message: '提交前：一线队人数不足', playerIds: [] }] }),
      },
    });
    apiPostMock.mockResolvedValueOnce({
      ok: true,
      season: 9,
      firstTeam: 1,
      trainee: 0,
      wageTotal: 0.5,
      checkMode: 'warn',
      issues: [{ rule: 'gk', message: '提交后：门将不足', playerIds: [] }],
    });
    const user = userEvent.setup();
    renderDetail('/clubs/1');

    const desk = (await screen.findByText(/注册工作台/)).closest('section') as HTMLElement;
    await user.click(within(desk).getByRole('button', { name: '提交注册名单' }));

    // 提交成功的绿「注册完成」条照出，红字换成响应里的 issues（不是被清空）
    expect(await screen.findByText(/第 9 赛季注册完成/)).toBeTruthy();
    expect(screen.getByText('提交后：门将不足')).toBeTruthy();
    expect(screen.queryByText('提交前：一线队人数不足')).toBeNull();
    expect(apiPostMock).toHaveBeenCalledTimes(1);
  });

  it('特例期 off 档：挂隔离 banner，体检不通过也不挂红字；恰好通过也不冒充「通过」', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    const squad = (compliance: SquadCompliance): SquadOverview => ({
      ...squadFixture(1),
      checkMode: 'off',
      rules: DESK_RULES,
      players: [deskPlayer({ id: 7, name: '张三' })],
      compliance,
    });
    stubApi({ me: meFixture(1), squad: squad(complianceFixture()) });
    renderDetail('/clubs/1');

    expect(await screen.findByText(/特例期：注册校验已隔离/)).toBeTruthy();
    expect(screen.queryByText(/名单没过注册校验/)).toBeNull();
    expect(screen.queryByText('一线队人数不足 18 人')).toBeNull();
    expect(screen.queryByText('资格检查通过，可以安心开赛。')).toBeNull();

    // 第二段：快照体检恰好 pass=true 时，off 档同样不显示「通过」绿条（它会被误读成真做过体检）
    cleanup();
    apiMock.mockReset();
    stubApi({ me: meFixture(1), squad: squad(complianceFixture({ pass: true, issues: [] })) });
    renderDetail('/clubs/1');
    expect(await screen.findByText(/特例期：注册校验已隔离/)).toBeTruthy();
    expect(screen.queryByText('资格检查通过，可以安心开赛。')).toBeNull();
  });

  it('特例期：squad 换成 off 档刷新后，红字跟随新 props 收敛（不留上一轮，也不冒充「通过」）', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    const deskSquad = (checkMode: SquadOverview['checkMode']): SquadOverview => ({
      ...squadFixture(1),
      checkMode,
      rules: DESK_RULES,
      players: [deskPlayer({ id: 7, name: '张三' })],
      compliance: complianceFixture(),
    });
    stubApi({ me: meFixture(1), squad: deskSquad('warn') });
    const { qc } = renderDetail('/clubs/1');

    // 首挂 warn 档、体检不通过：红字照挂
    expect(await screen.findByText('一线队人数不足 18 人')).toBeTruthy();

    // 管理员切到 off 档后名单刷新（父组件不给 key ⇒ 同一组件树换 props，不是重新挂载）。
    // 缓存更新的通知走 setTimeout(0)（query-core notifyManager 的调度器），
    // 所以先等新档位的横幅出现，再断言首挂那版红字已经收敛。
    act(() => {
      qc.setQueryData(qk.squad, deskSquad('off'));
    });
    expect(await screen.findByText(/特例期：注册校验已隔离/)).toBeTruthy();
    expect(screen.queryByText('一线队人数不足 18 人')).toBeNull();
    expect(screen.queryByText('资格检查通过，可以安心开赛。')).toBeNull();
  });

  it('主场：主场档案（影响力级别系数文案）+ 近期主场战报 + 去消费中心的一行入口', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({
      me: meFixture(1, { home: homeFixture() }),
      homeMatches: { club: { id: 1, name: '阿森纳' }, matches: [homeMatch({ matchId: 501 }), homeMatch({ matchId: 502, weather: null, result: null, scoreText: null, attendanceRate: null, opponentId: null, opponentName: null })] },
    });
    renderDetail('/clubs/1?tab=venue');

    const stadium = (await screen.findByText('主场档案')).closest('section') as HTMLElement;
    expect(stadium.textContent).toContain('酋长球场');
    expect(stadium.textContent).toContain('专业（3 级）');
    expect(stadium.textContent).toContain('60,000');
    // 影响力构成仍然点名级别系数与系数值（web/src/lib/influence.test.ts 的静态契约）
    expect(stadium.textContent).toContain('× 级别系数');
    expect(stadium.textContent).toContain('1.2');
    expect(within(stadium).getByText('草皮 2 级')).toBeTruthy();

    const matches = (await screen.findByText('近期主场战报')).closest('section') as HTMLElement;
    expect(matches.textContent).toContain('S9 · 窗3');
    expect(matches.textContent).toContain('切尔西');
    expect(matches.textContent).toContain('55,000');
    expect(matches.textContent).toContain('92%');
    expect(matches.textContent).toContain('8.20 m');
    // 未确认的那场：赛果「待定」、比分 —，不编数字
    expect(within(matches).getByText('待定')).toBeTruthy();

    // v6.26.0 起设施经营/冠名/档期整块搬进消费中心，这里只留一行入口
    const entry = screen.getByText('去消费中心经营设施 →') as HTMLAnchorElement;
    expect(entry.closest('a')!.getAttribute('href')).toBe('/shop');
  });

  it('主场：没有球场档案时不渲染两块卡（不占位），入口仍在', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(1) }); // home: null
    renderDetail('/clubs/1?tab=venue');

    const entry = await screen.findByText('去消费中心经营设施 →');
    expect(entry).toBeTruthy();
    expect(screen.queryByText('主场档案')).toBeNull();
    expect(screen.queryByText('近期主场战报')).toBeNull();
  });
});

describe('兜底与按需加载', () => {
  it('详情报错（404 / 未登录）显示后端消息与回列表入口', async () => {
    stubApi({ detail: new Error('球队不存在') });
    renderDetail();

    expect(await screen.findByText('球队不存在')).toBeTruthy();
    expect(screen.getByText('回球队库').closest('a')!.getAttribute('href')).toBe('/clubs');
  });

  it('路径 id 非法时不打任何请求', async () => {
    stubApi();
    renderDetail('/clubs/abc');

    expect(await screen.findByText('球队 ID 不对。')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('按需加载：访客停在阵容页签时只打 detail/standing/名单三个端点', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('阵容组');
    const calls = pathsCalled();
    expect(calls.some((p) => p.startsWith('/api/players?'))).toBe(true);
    // 三个未激活页签的端点一个都不该打
    expect(calls).not.toContain('/api/club/home-matches');
    expect(calls).not.toContain('/api/club/events');
    expect(calls).not.toContain('/api/club/squad');
    // 匿名连自家概览都不打
    expect(calls).not.toContain('/api/me/club');
  });

  it('按需加载：自家阵容页签不打工作台/主场的端点，切到主场才打战报', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(1, { home: homeFixture() }) });
    renderDetail('/clubs/1?tab=squad');

    await screen.findByText('阵容组');
    let calls = pathsCalled();
    expect(calls).toContain('/api/me/club');
    expect(calls.some((p) => p.startsWith('/api/players?'))).toBe(true);
    expect(calls).not.toContain('/api/club/squad'); // 注册名单只在工作台页签拉
    expect(calls).not.toContain('/api/club/events');
    expect(calls).not.toContain('/api/club/home-matches');

    const user = userEvent.setup();
    await clickTab(user, '主场');
    await screen.findByText('主场档案');
    calls = pathsCalled();
    // 切到主场才打战报；工作台的两个端点仍然一个都没打
    expect(calls).toContain('/api/club/home-matches');
    expect(calls).not.toContain('/api/club/squad');
    expect(calls).not.toContain('/api/club/events');
  });

  it('登录者带的是别的队（或没绑队）时不渲染工作台，也不打 /api/club/squad', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(2) });
    renderDetail('/clubs/1?tab=desk'); // 无权页签 ⇒ 回落阵容

    expect(await screen.findByText('阿森纳')).toBeTruthy();
    expect(tabLabels()).toEqual(['阵容', '转会', '战绩']);
    expect(screen.queryByText('注册工作台')).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith('/api/club/squad');
  });
});
