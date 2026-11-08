// @vitest-environment jsdom
// v6.82.0 第 5 批 · TC-B5-01：契约 FieldDiff #1 处置的行为锁——RcChangeResult.freeRcChange 从
// 契约删除（worker 的 rc-change 响应从不携带该键），DeskTab.tsx 续约提交的「本次免费」两死分支
// 随批删除。本锁证删除动作本身不改可见输出：提价（changeFee>0）与降价（changeFee=0）两次提交，
// toast 文案逐字走既有 changeFee / 降价分支，且「本次免费」不再出现。
// 夹具参考现存 DeskTab.bypass-fees.test.tsx（不改它）；API 桩 /api/club/squad 与 /api/club/events，
// 续约提交经被 mock 的 apiPost 回 RcChangeResult 契约形状（无 freeRcChange 键）。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyClubOverview, RcChangeResult, SquadOverview, SquadPlayerRow, SquadRules } from '../../lib/api.ts';
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
  squadCount: 1,
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
    freeRcAvailable: false,
    ...patch,
  };
}

const SQUAD: SquadOverview = {
  club: { id: 1, name: '阿森纳', leagueTier: 'premier' },
  season: 9,
  registeredInTournament: true,
  players: [player({ id: 7, name: '张三' })],
  unsigned: [],
  loyalty: { total: 1.5, count: 3 },
  wages: { cap: 68, baseline: 40, now: 42, projected: 44, delta: 2, inCount: 1, outCount: 0, overspend: 0 },
  compliance: null,
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

// 续约提交的契约回执形状（src/contract/batch5.ts RcChangeResult：无 freeRcChange 键——
// worker 响应现实，freeRcChange 只落 evidence 供审核豁免）。
function rcChangeRes(patch: { oldReleaseFee: number; newReleaseFee: number; changeFee: number }): RcChangeResult {
  return { ok: true, transferId: 901, ...patch };
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
  apiPostMock.mockReset();
});

async function submitRcChange(res: RcChangeResult, newFee: string) {
  apiPostMock.mockResolvedValueOnce(res);
  renderDesk();
  expect(await screen.findByText(/阵容与注册/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('续约球员'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('新违约金（m）'), { target: { value: newFee } });
  fireEvent.click(screen.getByRole('button', { name: '提交续约' }));
  const toast = await screen.findByRole('status');
  return toast.textContent ?? '';
}

describe('工作台续约提交 toast（v6.82.0 TC-B5-01，死分支删除零可见变化）', () => {
  it('提价 changeFee>0：toast 走「加价部分 30%」分支，不出现「本次免费」', async () => {
    const text = await submitRcChange(rcChangeRes({ oldReleaseFee: 20, newReleaseFee: 25, changeFee: 1.5 }), '25');
    expect(text).toContain('续约申请已提交：张三 违约金 20.00 → 25.00m，加价部分 30% 共 1.50m 待审核时收，保护期在本窗关闭时结束。');
    expect(text).not.toContain('本次免费');
    expect(apiPostMock).toHaveBeenCalledWith('/api/transfers/rc-change', { playerId: 7, newReleaseFee: 25 });
  });

  it('降价 changeFee=0：toast 走「降价免费」分支，不出现「本次免费」', async () => {
    const text = await submitRcChange(rcChangeRes({ oldReleaseFee: 25, newReleaseFee: 20, changeFee: 0 }), '20');
    expect(text).toContain('续约申请已提交：张三 违约金 25.00 → 20.00m，降价免费，保护期在本窗关闭时结束。');
    expect(text).not.toContain('本次免费');
  });
});
