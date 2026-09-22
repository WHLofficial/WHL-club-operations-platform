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
  ClubPositionGroup,
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

// 位置分布是三列网格（dt 档名 + dd 人数 + dd 细位），按档名取同一行的后两格
function positionRow(scope: HTMLElement, label: string): { count: string; detail: string } {
  const dt = within(scope).getByText(label);
  const ddCount = dt.nextElementSibling as HTMLElement;
  const ddDetail = ddCount.nextElementSibling as HTMLElement;
  return { count: ddCount.textContent ?? '', detail: ddDetail.textContent ?? '' };
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

  it('位置分布出四档文字档位（0 人档也出）+ 档内细位，不出图示', async () => {
    stubApi();
    renderDetail();

    await screen.findByText('位置分布');
    const pos = sub('位置分布');
    expect(Array.from(pos.querySelectorAll('.club-position-list > dt')).map((el) => el.textContent)).toEqual([
      '门将',
      '后卫',
      '中场',
      '前锋',
      '未知',
    ]);
    // 0 门将也占一行：这是要看见的信号，不是空
    expect(positionRow(pos, '门将')).toEqual({ count: '0 人', detail: '—' });
    expect(positionRow(pos, '后卫')).toEqual({ count: '1 人', detail: 'CB 1' });
    expect(positionRow(pos, '中场')).toEqual({ count: '2 人', detail: 'CM 1 · CAM 1' });
    expect(positionRow(pos, '未知')).toEqual({ count: '1 人', detail: '—' });
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
