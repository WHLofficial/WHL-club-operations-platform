// @vitest-environment jsdom
// v6.54.0 步骤 8 · 注册工作台提交前预检（设计 §10.5 / TC-RD-31 #4 / TC-RD-38）：
// - current 合规 + projected 只差工资帽 ⇒ 弹「关窗后将超过工资帽」，**不**发 POST
// - 「仍要提交」两段式后才真的提交，且提交的是当前窗合规名单（ids 不变）
// - 「去处理」只关弹窗并滚到待生效明细
// - 没有 pending / 特例期 warn 放行档 ⇒ 不弹窗，直接提交
// 组件直接渲染（不经 ClubDetail），API 只桩 /api/club/squad 与 /api/club/events。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyClubOverview, RegistrationResult, SquadOverview, SquadPlayerRow, SquadRules } from '../../lib/api.ts';
import DeskTab from './DeskTab.tsx';

const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../lib/api.ts', () => ({
  api: apiMock,
  apiPost: apiPostMock,
  mediaUrl: (key: string | null | undefined) => (key ? `/api/media/${key}` : null),
}));

const OVERVIEW: MyClubOverview = {
  club: { id: 1, name: '阿森纳', leagueTier: 'premier', logoKey: null, status: 'active', transferBanned: false },
  balance: 12.5,
  squadCount: 2,
  window: { season: 9, windowSeq: 1 },
  home: null,
};

const RULES: SquadRules = {
  squadMin: 2,
  squadMax: 30,
  gkMin: 1,
  traineeMax: 10,
  wageCap: 20,
  limits: { ge90: 99, ge87: 99, growthPa87: 99 },
  tier: 'premier',
};

function player(patch: Partial<SquadPlayerRow> & { id: number; name: string }): SquadPlayerRow {
  return {
    fcId: patch.id,
    uid: `fc${patch.id}`,
    number: null,
    position: 'CM',
    age: 24,
    ca: 70,
    pa: 80,
    baseCa: 70,
    marker: null,
    growable: true,
    isFutureStar: false,
    chinaPlan: false,
    prestige: 0,
    influence: 0,
    status: 'normal',
    marketValue: 10,
    foot: 1,
    growthTier: 0,
    agentTier: 0,
    badgesSilver: 0,
    badgesGold: 0,
    wage: 1,
    releaseFee: 20,
    contractType: 'formal',
    source: null,
    serviceSeasons: 1.5,
    protected: false,
    psIds: Array.from({ length: 15 }, () => null),
    hasContract: true,
    squad: 'first_team',
    ...patch,
  };
}

/** 当前 19.50m/窗（≤帽 20）、关窗后 21.50m/窗（超帽 1.50） */
function squadFixture(patch: Partial<SquadOverview> = {}): SquadOverview {
  return {
    club: { id: 1, name: '阿森纳', leagueTier: 'premier' },
    season: 9,
    registeredInTournament: true,
    players: [
      player({
        id: 7,
        fcId: 7007,
        name: '张三',
        position: 'GK',
        wage: 10,
        releaseFee: 20,
        hasPending: true,
        pendingWage: 12,
        pendingReleaseFee: 25,
        pendingSource: 'demand',
      }),
      player({ id: 8, name: '李四', wage: 9.5 }),
    ],
    registration: { firstTeam: [7, 8], trainee: [] },
    compliance: null,
    checkMode: 'enforce',
    rules: RULES,
    ...patch,
  };
}

const EMPTY_EVENTS = { clubId: 1, pending: [], recent: [] };

const OK_RESULT: RegistrationResult = {
  ok: true,
  season: 9,
  firstTeam: 2,
  trainee: 0,
  wageTotal: 19.5,
  checkMode: 'enforce',
  issues: [],
};

function renderDesk(squad: SquadOverview) {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/club/squad') return Promise.resolve(squad);
    if (path === '/api/club/events') return Promise.resolve(EMPTY_EVENTS);
    return Promise.reject(new Error(`未桩的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DeskTab overview={OVERVIEW} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // useMediaQuery 走 matchMedia（jsdom 没有）：恒 false = 桌面口径
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
  // 「去处理」会 scrollIntoView（jsdom 未实现）
  Element.prototype.scrollIntoView = vi.fn();
  apiPostMock.mockResolvedValue(OK_RESULT);
});

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiPostMock.mockReset();
});

describe('注册工作台：关窗后超帽的提交前确认（v6.54.0 §10.5 / TC-RD-38）', () => {
  it('projected 只差工资帽：点提交先弹确认，未确认绝不发 POST', async () => {
    renderDesk(squadFixture());
    expect(await screen.findByText(/注册工作台/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /提交注册名单/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('关窗后将超过工资帽');
    expect(dialog.textContent).toContain('当前窗合规；问题出在待生效合同');
    // 数字行与驱动明细：19.50 → 21.50 / 帽 20.00 · 超 1.50；顶过帽的是张三（+2.00 · 球员要求）
    expect(dialog.textContent).toContain('19.50');
    expect(dialog.textContent).toContain('21.50');
    expect(dialog.textContent).toContain('超 1.50');
    expect(dialog.textContent).toContain('张三');
    expect(dialog.textContent).toContain('+2.00');
    expect(dialog.textContent).toContain('球员要求');
    expect(apiPostMock).not.toHaveBeenCalled();

    // 两段式：第一击只变红，第二击才提交当前窗合规名单（ids 不变）
    fireEvent.click(screen.getByRole('button', { name: '仍要提交' }));
    expect(apiPostMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '再点一次确认提交' }));
    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).toHaveBeenCalledWith('/api/club/registrations', { firstTeam: [7, 8], trainee: [] });
    // 提交成功条照常出，弹窗已关
    expect(await screen.findByText(/第 9 赛季注册完成/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('「去处理」关弹窗并滚到待生效明细（不发 POST）', async () => {
    renderDesk(squadFixture());
    expect(await screen.findByText(/注册工作台/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /提交注册名单/ }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: '去处理（看待生效明细）' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('没有 pending：不弹窗，直接提交', async () => {
    renderDesk(
      squadFixture({
        players: [player({ id: 7, name: '张三', position: 'GK', wage: 10 }), player({ id: 8, name: '李四', wage: 9.5 })],
      }),
    );
    expect(await screen.findByText(/注册工作台/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /提交注册名单/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiPostMock).toHaveBeenCalledTimes(1);
  });

  it('特例期 warn 放行档：关窗后超帽也不弹窗（该档的语义就是提交放行）', async () => {
    renderDesk(squadFixture({ checkMode: 'warn' }));
    expect(await screen.findByText(/特例期：注册校验为提示模式/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /提交注册名单/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiPostMock).toHaveBeenCalledTimes(1);
  });
});
