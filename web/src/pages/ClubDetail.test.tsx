// @vitest-environment jsdom
// 球队详情页（web/src/pages/ClubDetail.tsx，增量 31 步骤 7）的组件测试：
// 三组（阵容 / 运营 / 战绩）的字段口径、柱状图归一、名单与转会链接口径（Q17：队链接一律 /clubs/:id）、
// 排名降级文案、以及 id 非法 / 详情报错的兜底。
// 没打 CSS（jsdom 不跑样式表），视觉表现靠 e2e 截图看；这里只钉结构与内联宽度。
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ClubBand,
  ClubDetail as ClubDetailDto,
  ClubFormRow,
  ClubStanding,
  ClubTransferRow,
  MeUser,
  MyClubOverview,
  PlayerLibraryRow,
  PlayersLibraryResponse,
  SquadOverview,
} from '../lib/api.ts';
import ClubDetail from './ClubDetail.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
// mediaUrl 给真实现（TeamLogo 要用它把 logoKey 折成 /api/media/*）
vi.mock('../lib/api.ts', () => ({
  api: apiMock,
  mediaUrl: (key: string | null | undefined) => (key ? `/api/media/${key}` : null),
}));

// 教练区块的开关是 useMyClub → useMyClubOverview → useAuth().user，组件测试里给一个可切的假登录态。
// 默认匿名：既有用例一条请求都不多发，只有教练区块的两个用例才把它设成登录。
const { authState } = vi.hoisted(() => ({ authState: { user: null as unknown } }));
vi.mock('../lib/auth.tsx', () => ({
  useAuth: () => ({ user: authState.user, authMode: 'shared', authHome: null }),
}));

function band(key: string, label: string, count: number): ClubBand {
  return { key, label, count };
}

const BY_AGE: ClubBand[] = [
  band('u21', '≤20', 1),
  band('b21', '21-23', 2),
  band('b24', '24-26', 0),
  band('b27', '27-29', 0),
  band('b30', '30+', 1),
];
const BY_CA: ClubBand[] = [band('u60', '<60', 0), band('b60', '60-69', 1), band('b90', '90+', 1)];
const BY_YEARS: ClubBand[] = [band('le05', '≤0.5', 1), band('y1', '1-1.5', 2)];

function transfer(patch: Partial<ClubTransferRow> & { id: number }): ClubTransferRow {
  return {
    type: 'transfer',
    playerId: 7,
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
      byPosition: [
        { position: 'CM', count: 2 },
        { position: 'ST', count: 1 },
        { position: '未知', count: 1 },
      ],
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
    clubId: 1,
    position: 'CM',
    age: 24,
    ca: 75,
    pa: 85,
    prestige: 0,
    marketValue: 10,
    status: 'normal',
    growthTier: 0,
    isFutureStar: false,
    chinaPlan: false,
    agentTier: 0,
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
    fcId: 1,
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

interface Stub {
  detail?: ClubDetailDto | Error;
  standing?: ClubStanding | Error;
  roster?: PlayersLibraryResponse | Error;
  me?: MyClubOverview;
  squad?: SquadOverview;
}

// 教练区块的最小名单：rules / compliance / registration 都为 null，CoachPanel 里都有兜底分支
function squadFixture(clubId: number): SquadOverview {
  return {
    club: { id: clubId, name: '阿森纳', leagueTier: 'premier' },
    season: 9,
    registeredInTournament: true,
    players: [],
    registration: null,
    compliance: null,
    rules: null,
  };
}

function meFixture(clubId: number | null): MyClubOverview {
  if (clubId === null) return { club: null, balance: null, squadCount: null, window: null, home: null };
  return {
    club: { id: clubId, name: '阿森纳', leagueTier: 'premier', logoKey: null, status: 'active', transferBanned: false },
    balance: 12.5,
    squadCount: 24,
    window: { season: 9, windowSeq: 3 },
    // home 为 null：主场档案三块（球场/设施/冠名）都不挂，教练区块只留队头
    home: null,
  };
}

// 各条请求各走各的桩。先判 standing —— '/api/clubs/1' 是 '/api/clubs/1/standing' 的前缀。
function stubApi({ detail = detailFixture(), standing, roster = ROSTER, me, squad }: Stub = {}) {
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
    return Promise.reject(new Error(`未桩的请求：${path}`));
  });
}

function renderDetail(entry = '/clubs/1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/clubs/:id" element={<ClubDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// 取某个小节的 .club-sub 容器（标题的父节点）
function sub(title: string): HTMLElement {
  return screen.getByText(title).parentElement as HTMLElement;
}

// 按标签取统计格的数值 —— 「1 人」这类值在页面上会重复出现，直接 getByText 会撞车
function statValue(scope: HTMLElement, label: string): string {
  const cell = within(scope).getByText(label).closest('.club-stat') as HTMLElement;
  return (cell.querySelector('dd') as HTMLElement).textContent ?? '';
}

// 教练工作台的统计格是 span.stat-label + span.stat-value（不是详情页那套 dl/dt/dd），取值要另走一路
function statText(scope: HTMLElement, label: string): string {
  const cell = within(scope).getByText(label).closest('.club-stat') as HTMLElement;
  return (cell.querySelector('.stat-value') as HTMLElement).textContent ?? '';
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  authState.user = null;
});

describe('球队详情页（增量 31 步骤 7）', () => {
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

  it('阵容组统计：人数拆一线队与青训、平均值一位小数、金额带 m、徽章计数', async () => {
    stubApi();
    renderDetail();

    const squadBlock = (await screen.findByText('阵容组')).closest('section') as HTMLElement;
    expect(statValue(squadBlock, '阵容人数')).toBe('4 人 + 1 青训');
    expect(statValue(squadBlock, '平均 CA')).toBe('75.2'); // 75.24 只显示一位
    expect(statValue(squadBlock, '最高 CA')).toBe('90.0');
    expect(statValue(squadBlock, '平均 PA')).toBe('83.3');
    expect(statValue(squadBlock, '平均成长空间')).toBe('10.0');
    expect(statValue(squadBlock, '总身价')).toBe('1234.50 m');
    expect(statValue(squadBlock, '工资总额')).toBe('4.40 m');
    expect(statValue(squadBlock, '平均工资')).toBe('1.10 m');
    expect(statValue(squadBlock, '银徽章')).toBe('3 枚');
    expect(statValue(squadBlock, '金徽章')).toBe('1 枚');
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
    expect(statValue(squadBlock, '平均工资')).toBe('—');
  });

  it('位置分布出 chip（含未知项），年龄/CA 柱状图按最大档归一', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('位置分布');
    const cm = screen.getByText('CM').parentElement as HTMLElement;
    expect(within(cm).getByText('2')).toBeTruthy();
    expect((screen.getByText('未知').parentElement as HTMLElement).textContent).toContain('1');

    // 年龄：最大档 2 人 ⇒ 该档满格，1 人档半格；空档仍是 0 宽（min-width 由 CSS 兜）
    const ageBars = sub('年龄结构').querySelectorAll('.band-bar');
    expect(ageBars.length).toBe(BY_AGE.length);
    expect((ageBars[1] as HTMLElement).style.width).toBe('100%');
    expect((ageBars[0] as HTMLElement).style.width).toBe('50%');
    expect((ageBars[2] as HTMLElement).style.width).toBe('0%');

    // CA 图独立归一（最大档 1 人 ⇒ 满格），不会串用年龄图的比例
    const caBars = sub('CA 结构').querySelectorAll('.band-bar');
    expect((caBars[1] as HTMLElement).style.width).toBe('100%');
  });

  it('阵容名单：编号去掉 fc 前缀、状态徽章、工资缺失显示 —，人链到 /players/:id', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('阵容名单');
    const roster = sub('阵容名单');
    const row = (within(roster).getByText('李四') as HTMLElement).closest('tr') as HTMLElement;
    expect(within(row).getByText('8')).toBeTruthy();
    expect(within(row).getByText('训练营')).toBeTruthy();
    // 位置空数组与无合同工资都落成 —（这一行两处）
    expect(within(row).getAllByText('—').length).toBe(2);
    const cells = row.querySelectorAll('td');
    expect((cells[2] as HTMLElement).textContent).toBe('—'); // 位置
    expect((cells[7] as HTMLElement).textContent).toBe('—'); // 工资
    expect((within(row).getByText('李四') as HTMLAnchorElement).getAttribute('href')).toBe('/players/8');

    const first = (within(roster).getByText('张三') as HTMLElement).closest('tr') as HTMLElement;
    expect(within(first).getByText('CM CAM')).toBeTruthy();
    expect(within(first).getByText('在队')).toBeTruthy();
    expect(within(first).getByText('0.50 m')).toBeTruthy();
  });

  it('名单超过一页时提示去球员库看全部，链接带 club_id', async () => {
    stubApi({ roster: { players: ROSTER.players, nextCursor: 'cursor-1' } });
    renderDetail();

    const hint = await screen.findByText(/只显示前 2 人/);
    expect(within(hint).getByText('去球员库看全部').closest('a')!.getAttribute('href')).toBe('/players?club_id=1');
  });

  it('运营组：合同统计、效力年限图、转入转出表（对手队链 /clubs/:id、自由身不链）', async () => {
    stubApi();
    renderDetail();

    const ops = (await screen.findByText('运营组')).closest('section') as HTMLElement;
    expect(statValue(ops, '在册合同')).toBe('3 份');
    expect(statValue(ops, '保护期内')).toBe('1 人');
    expect(statValue(ops, '未保护')).toBe('1 人');
    expect(statValue(ops, '平均效力')).toBe('1.5 赛季');

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

  it('没有转会记录时两块各给空态，不渲染空表', async () => {
    stubApi({ detail: detailFixture({ transfers: { incoming: [], outgoing: [] } }) });
    renderDetail();

    expect(await screen.findByText('还没有转入记录。')).toBeTruthy();
    expect(screen.getByText('还没有转出记录。')).toBeTruthy();
    const ops = screen.getByText('运营组').closest('section') as HTMLElement;
    expect(within(ops).queryByRole('table')).toBeNull();
  });

  it('战绩组：排名口径 + 近期战绩的 90 分钟判定与点球标注', async () => {
    stubApi({
      standing: {
        standing: { tournamentId: 101, stageName: '常规赛', groupName: 'A 组', position: 3, played: 10, won: 5, drawn: 2, lost: 3, goalsFor: 18, goalsAgainst: 12, pts: 17, pointsDeducted: 2 },
        note: null,
      },
    });
    renderDetail();

    const form = (await screen.findByText('战绩组')).closest('section') as HTMLElement;
    expect(within(form).getByText('第 3 名')).toBeTruthy();
    expect(within(form).getByText('10 场')).toBeTruthy();
    expect(within(form).getByText('5 / 2 / 3')).toBeTruthy();
    expect(within(form).getByText('18 : 12')).toBeTruthy();
    expect(within(form).getByText(/扣 2/)).toBeTruthy();

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
    renderDetail();

    expect(await screen.findByText('排名暂不可用')).toBeTruthy();
    const form = screen.getByText('战绩组').closest('section') as HTMLElement;
    expect(within(form).getByText('胜')).toBeTruthy(); // 近期战绩照常渲染
  });

  it('排名取不到且后端没给 note 时兜底文案（不是空白）', async () => {
    stubApi({ standing: { standing: null, note: null } });
    renderDetail();

    const form = (await screen.findByText('战绩组')).closest('section') as HTMLElement;
    expect(within(form).getByText('排名暂不可用')).toBeTruthy();
    expect(within(form).queryByText('第 3 名')).toBeNull();
  });

  it('名单拉失败时给错误提示与重试，不停在「正在点名…」', async () => {
    stubApi({ roster: new Error('名单服务打盹了') });
    renderDetail();

    await screen.findByText('阵容名单');
    const roster = sub('阵容名单');
    expect(await within(roster).findByText(/名单服务打盹了/)).toBeTruthy();
    expect(within(roster).queryByText('正在点名…')).toBeNull();
    expect(within(roster).getByText('重试')).toBeTruthy();
  });

  it('转会球员已从球员库消失（playerId 为 null）时出纯文本，不生成 /players/null', async () => {
    stubApi({
      detail: detailFixture({
        transfers: { incoming: [transfer({ id: 21, playerId: null, playerName: '匿名' })], outgoing: [] },
      }),
    });
    renderDetail();

    const cell = (await screen.findByText('匿名')) as HTMLElement;
    expect(cell.tagName).toBe('TD');
    expect(screen.queryByRole('link', { name: '匿名' })).toBeNull();
  });

  it('本赛季没有已确认比赛时给空态', async () => {
    stubApi({ detail: detailFixture({ form: { recent: [], wins: 0, draws: 0, losses: 0 } }) });
    renderDetail();

    expect(await screen.findByText('本赛季还没有已确认的比赛。')).toBeTruthy();
  });

  it('详情报错（404 / 未登录）显示后端消息与回列表入口', async () => {
    stubApi({ detail: new Error('球队不存在') });
    renderDetail();

    expect(await screen.findByText('球队不存在')).toBeTruthy();
    expect(screen.getByText('回球队列表').closest('a')!.getAttribute('href')).toBe('/clubs');
  });

  it('路径 id 非法时不打任何请求', async () => {
    stubApi();
    renderDetail('/clubs/abc');

    expect(await screen.findByText('球队 ID 不对。')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('登录者正是本队教练时挂出教练工作台（含只有教练看得到的资金与窗口）', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(1) });
    renderDetail('/clubs/1');

    expect(await screen.findByText('教练工作台')).toBeTruthy();
    const head = screen.getByText('资金余额').closest('.club-head') as HTMLElement;
    expect(statText(head, '资金余额')).toBe('12.50 m');
    expect(statText(head, '一线队名单')).toBe('24 人');
    expect(within(head).getByText('第 9 赛季 · 窗口 3')).toBeTruthy();
  });

  it('登录者带的是别的队（或没绑队）时不渲染教练工作台', async () => {
    authState.user = { id: 5, name: '教练甲', role: 'coach', locked: false, mustChangePw: false } satisfies MeUser;
    stubApi({ me: meFixture(2) });
    renderDetail('/clubs/1');

    expect(await screen.findByText('阿森纳')).toBeTruthy();
    expect(screen.queryByText('教练工作台')).toBeNull();
    // 别队的页面上连 /api/me/club 之外的教练端读面都不该打
    expect(apiMock).not.toHaveBeenCalledWith('/api/club/squad');
  });
});
