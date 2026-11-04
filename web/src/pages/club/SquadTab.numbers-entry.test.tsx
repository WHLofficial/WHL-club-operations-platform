// @vitest-environment jsdom
// 阵容页「号码分配」入口（v6.76.0）：仅本人执教 + 转会窗开放时露出；点开挂全队浮层。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubSquadStructure, SquadOverview } from '../../lib/api.ts';
import SquadTab from './SquadTab.tsx';

const { rosterMock, pendingMock, seasonsMock, squadMock } = vi.hoisted(() => ({
  rosterMock: vi.fn(),
  pendingMock: vi.fn(),
  seasonsMock: vi.fn(),
  squadMock: vi.fn(),
}));

vi.mock('../../lib/queries.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/queries.ts')>();
  return {
    ...mod,
    useClubRoster: rosterMock,
    useClubPendingContracts: pendingMock,
    useSeasonsCurrent: seasonsMock,
    useSquad: squadMock,
  };
});

const STRUCT: ClubSquadStructure = {
  size: 0,
  senior: 0,
  trainee: 0,
  avgCa: null,
  maxCa: null,
  avgPa: null,
  avgGrowth: null,
  totalValue: null,
  totalWage: 0,
  avgWage: null,
  badgesSilver: 0,
  badgesGold: 0,
  byPosition: [],
  byAge: [],
  byCa: [],
};

const EMPTY_SQUAD = {
  club: { id: 1, name: '我的队', leagueTier: null },
  season: 2026,
  registeredInTournament: false,
  players: [],
  unsigned: [],
  loyalty: { total: 0, count: 0 },
  wages: { cap: null, baseline: null, now: 0, projected: 0, delta: null, inCount: 0, outCount: 0, overspend: 0 },
  compliance: null,
  rules: null,
} as SquadOverview;

function renderTab(own: boolean, windowOpen: boolean) {
  rosterMock.mockReturnValue({ data: { players: [], nextCursor: null }, isError: false, error: null, refetch: vi.fn() });
  pendingMock.mockReturnValue({ data: { pending: [] }, isError: false, error: null, refetch: vi.fn() });
  seasonsMock.mockReturnValue({ data: { season: null, window: windowOpen ? { season: 2026, windowSeq: 1, status: 'open', openedAt: null, closedAt: null } : null, tournaments: [] } });
  squadMock.mockReturnValue(EMPTY_SQUAD);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SquadTab clubId={1} squad={STRUCT} own={own} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rosterMock.mockReset();
  pendingMock.mockReset();
  seasonsMock.mockReset();
  squadMock.mockReset();
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
});

afterEach(cleanup);

describe('SquadTab · 号码分配入口（v6.76.0）', () => {
  it('本队教练 + 开窗：露出入口，点开挂全队浮层', () => {
    renderTab(true, true);
    fireEvent.click(screen.getByRole('button', { name: '号码分配' }));
    expect(screen.getByRole('dialog', { name: '一线队号码分配' })).toBeTruthy();
  });

  it('访客或关窗：不露出入口', () => {
    const visitor = renderTab(false, true);
    expect(screen.queryByRole('button', { name: '号码分配' })).toBeNull();
    visitor.unmount();
    renderTab(true, false);
    expect(screen.queryByRole('button', { name: '号码分配' })).toBeNull();
  });
});
