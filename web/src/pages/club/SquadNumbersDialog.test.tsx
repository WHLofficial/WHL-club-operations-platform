// @vitest-environment jsdom
// 一线队号码分配浮层（v6.76.0）：
// 草稿内落位/对调/清除、最终态保存、409 冲突保留草稿并标红、脏改动关闭确认、
// 球员页入口预选当前球员并选中其号码。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type SquadOverview, type SquadPlayerRow } from '../../lib/api.ts';
import { SquadNumbersDialog } from './SquadNumbersDialog.tsx';

const { apiMock, apiPutMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPutMock: vi.fn() }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPut: apiPutMock };
});

function row(id: number, name: string, number: string | null, position: string, ca = 100): SquadPlayerRow {
  return {
    id,
    fcId: 1000 + id,
    uid: `uid-${id}`,
    name,
    number,
    position,
    age: 25,
    ca,
    pa: ca,
    baseCa: ca,
    marker: null,
    growable: true,
    isFutureStar: false,
    chinaPlan: false,
    prestige: null,
    influence: 0,
    status: 'normal',
    marketValue: null,
    foot: null,
    growthTier: 1,
    agentTier: 1,
    badgesSilver: 0,
    badgesGold: 0,
    wage: null,
    releaseFee: null,
    contractType: null,
    source: null,
    serviceSeasons: null,
    protected: false,
    psIds: [],
    hasContract: true,
    squad: 'first_team',
  };
}

const PLAYERS = [
  row(1, '门将一', '1', 'GK', 110),
  row(2, '甲', null, 'GK', 105),
  row(3, '乙', null, 'CB', 95),
  row(4, '丁', '9', 'CB', 90),
  row(5, '丙', null, 'CM', 85),
  row(6, '戊', null, 'ST', 80),
  row(7, '己', null, 'ST', 75),
];

function squad(players: SquadPlayerRow[] = PLAYERS): SquadOverview {
  return {
    club: { id: 1, name: '我的队', leagueTier: 'S' },
    season: 2026,
    registeredInTournament: true,
    players,
    unsigned: [],
    loyalty: { total: 0, count: 0 },
    wages: { cap: 100, baseline: 50, now: 50, projected: 50, delta: 0, inCount: 7, outCount: 0, overspend: 0 },
    compliance: null,
    rules: null,
  } as SquadOverview;
}

function renderDialog(props: { preselectPlayerId?: number } = {}) {
  apiMock.mockResolvedValue(squad());
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <SquadNumbersDialog {...props} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...view, onClose, qc };
}

beforeEach(() => {
  apiMock.mockReset();
  apiPutMock.mockReset();
  // 桌面口径；窄屏分支由 CSS/真机走查兜
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

describe('SquadNumbersDialog · 草稿与保存', () => {
  it('默认选中第一名未分配球员；点空号位落草稿，保存提交最终态', async () => {
    const { onClose } = renderDialog();
    await screen.findByRole('dialog', { name: '一线队号码分配' });
    // 首位未分配 = GK 甲（id 2）
    await screen.findAllByText('甲');
    fireEvent.click(screen.getByRole('button', { name: '7 号，空' }));
    expect(screen.getByText('草稿 1 项')).toBeTruthy();

    apiPutMock.mockResolvedValue({ ok: true, applied: [{ playerId: 2, before: null, after: '7' }] });
    fireEvent.click(screen.getByRole('button', { name: '保存号码' }));
    await waitFor(() => expect(apiPutMock).toHaveBeenCalledTimes(1));
    expect(apiPutMock).toHaveBeenCalledWith('/api/club/squad/numbers', {
      assignments: [{ playerId: 2, number: '7' }],
    });
    await screen.findByText('已保存 1 项');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点已占用号码：与持有者直接对调，保存两份最终态', async () => {
    renderDialog();
    await screen.findByRole('dialog', { name: '一线队号码分配' });
    fireEvent.click(await screen.findByRole('button', { name: '9 号，丁' }));
    expect(screen.getByText('草稿 2 项')).toBeTruthy();

    apiPutMock.mockResolvedValue({
      ok: true,
      applied: [
        { playerId: 2, before: null, after: '9' },
        { playerId: 4, before: '9', after: null },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '保存号码' }));
    await waitFor(() => expect(apiPutMock).toHaveBeenCalledTimes(1));
    expect(apiPutMock.mock.calls[0]![1]).toEqual({
      assignments: [
        { playerId: 2, number: '9' },
        { playerId: 4, number: null },
      ],
    });
    await screen.findByText('已保存 2 项');
  });

  it('选中持有者后可清除号码；撤销回退最后一步', async () => {
    renderDialog();
    await screen.findByRole('dialog', { name: '一线队号码分配' });
    // 先取消自动预选，再点号码，才是「选中持有者」而不是「与持有者对调」
    fireEvent.click(await screen.findByRole('button', { name: '取消选择' }));
    fireEvent.click(await screen.findByRole('button', { name: '1 号，门将一' }));
    fireEvent.click(screen.getByRole('button', { name: '清除号码' }));
    expect(screen.getByText('草稿 1 项')).toBeTruthy();
    const undoBtn = screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement;
    fireEvent.click(undoBtn);
    await screen.findByText('没有改动');
  });

  it('409 冲突：保留草稿、冲突格标红、保存不可用，背景数据刷新', async () => {
    const { qc } = renderDialog();
    await screen.findByRole('dialog', { name: '一线队号码分配' });
    fireEvent.click(await screen.findByRole('button', { name: '9 号，丁' }));
    apiPutMock.mockRejectedValue(
      new ApiError(409, '9 号已被 丁 占用', 'number_conflict', undefined, [{ number: '9', playerId: 4, playerName: '丁' }]),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存号码' }));
    await screen.findByText('1 处冲突 · 保存不可用');
    expect(screen.getByRole('button', { name: '9 号，甲' }).className).toContain('is-conflict');
    expect((screen.getByRole('button', { name: '保存号码' }) as HTMLButtonElement).disabled).toBe(true);
    expect(qc.getQueryState(['club', 'squad'])).toBeTruthy();
  });

  it('有脏改动时关闭先确认；继续编辑不丢草稿，放弃才关', async () => {
    const { onClose } = renderDialog();
    await screen.findByRole('dialog', { name: '一线队号码分配' });
    fireEvent.click(await screen.findByRole('button', { name: '7 号，空' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('alertdialog', { name: '放弃未保存的号码改动' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('草稿 1 项')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃并关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SquadNumbersDialog · 球员页入口', () => {
  it('预选当前球员并选中他的号码', async () => {
    renderDialog({ preselectPlayerId: 4 });
    await screen.findByRole('dialog', { name: '一线队号码分配' });
    await waitFor(() => expect(screen.getByRole('button', { name: '9 号，丁' }).className).toContain('is-selected'));
    expect(screen.getAllByText('丁').length).toBeGreaterThan(0);
  });
});

describe('SquadNumbersDialog · 移动端布局回归', () => {
  it('选中条不参与 flex 压缩，换行后的操作按钮不会压到号码格标题', () => {
    const css = readFileSync('web/src/styles.css', 'utf8');
    expect(css).toMatch(/\.sqn-selection \{[^}]*flex: none;/s);
  });
});
