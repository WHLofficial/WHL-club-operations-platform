// @vitest-environment jsdom
// v6.63.3 · 工作台「续约与解约」选中解约球员后的费用预览 hint（TC-FP-07/08）：
// - 违约金 20、效力 1.5 赛季 ⇒「解约费 3.00m（效力 1.5 赛季，审核时收取）」
// - 效力 3.5 赛季 ⇒ 明示免费、不出现金额
// 组件直接渲染（不经 ClubDetail），API 只桩 /api/club/squad 与 /api/club/events（同 overcap 手法）。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyClubOverview, SquadOverview, SquadPlayerRow, SquadRules } from '../../lib/api.ts';
import DeskTab from './DeskTab.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../lib/api.ts', () => ({
  api: apiMock,
  apiPost: vi.fn(),
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

const SQUAD: SquadOverview = {
  club: { id: 1, name: '阿森纳', leagueTier: 'premier' },
  season: 9,
  registeredInTournament: true,
  players: [player({ id: 7, name: '张三' }), player({ id: 8, name: '李四', serviceSeasons: 3.5 })],
  registration: { firstTeam: [7, 8], trainee: [] },
  compliance: null,
  checkMode: 'enforce',
  rules: RULES,
};

const EMPTY_EVENTS = { clubId: 1, pending: [], recent: [] };

function renderDesk() {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/club/squad') return Promise.resolve(SQUAD);
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
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('工作台解约费用预览（v6.63.3）', () => {
  it('效力 1.5 赛季：hint 出解约费 3.00m（违约金 20 × 1.5 × 10%）', async () => {
    renderDesk();
    expect(await screen.findByText(/注册工作台/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('解约球员'), { target: { value: '7' } });
    const hint = screen.getByText(/自由球员名单/);
    expect(hint.textContent).toContain('解约费 3.00m（效力 1.5 赛季，审核时收取）');
    expect(hint.textContent).toContain('解约 张三');
  });

  it('效力 3.5 赛季：hint 明示免费、不出现金额', async () => {
    renderDesk();
    expect(await screen.findByText(/注册工作台/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('解约球员'), { target: { value: '8' } });
    const hint = screen.getByText(/自由球员名单/);
    expect(hint.textContent).toContain('效力 3.5 赛季已满 3 赛季，本次解约免费');
    expect(hint.textContent).not.toContain('解约费');
  });
});
