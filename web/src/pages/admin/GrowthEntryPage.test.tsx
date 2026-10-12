// v6.45.1 成长录入页 · 面板可改性 + 未保存确认条（TC-ENTRY-E）。
// 钉住的都是「不写测试就会悄悄回退」的口径：
//   1) 格子锁定口径：赛果（auto）的评分/夺回/扑救只读，手录的（manual）可改；出场与零封是「记过」标记，录过就锁；
//   2) 收起面板时脏草稿要走确认条，选「保存并继续」＝先提交再收起（父级持 pending，面板经 saveAllRef 回填结果）；
//   3) 切视图会重挂面板，同样要过确认条；
//   4) 一次「全部保存」超过服务端单批上限（50）要自动分块。
// 注意：查看模式里「没录过的格子」渲染成 —（没有 input）；面板里的按钮有两个「收起」（列表行上一个、面板头一个），要按面板作用域取。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GrowthEntryPage from './GrowthEntryPage.tsx';
import type {
  MatchEntryListItem,
  MatchEntryPanel,
  MatchEntryPlayer,
  MatchEntrySubmitResult,
} from '../../lib/api.ts';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  panel: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('../../lib/adminQueries.ts', () => ({
  MATCH_ENTRY_LIST_KEY: ['admin', 'growth', 'match-entry'],
  fetchMatchEntryList: mocks.list,
  fetchMatchEntryPanel: mocks.panel,
  matchEntryPanelKey: (matchId: number) => ['admin', 'growth', 'match-entry', matchId],
  submitMatchEntry: mocks.submit,
}));

function match(over: Partial<MatchEntryListItem> = {}): MatchEntryListItem {
  return {
    matchId: 1900,
    season: 7,
    windowSeq: 2,
    competitionType: 'league_premier',
    stageName: '常规赛',
    stageKind: 'league',
    round: 3,
    homeTeam: '海港联',
    awayTeam: '北岸城',
    scoreHome: 2,
    scoreAway: 1,
    finishedAt: '2026-07-01T09:00:00Z',
    confirmedAt: '2026-07-01T10:00:00Z',
    tournamentId: 5,
    tournamentName: '第七赛季联赛',
    homeClubId: 1,
    awayClubId: 2,
    homeIsCpu: false,
    awayIsCpu: false,
    recorded: 3,
    ...over,
  };
}

function player(id: number, name: string, position: string): MatchEntryPlayer {
  return { id, name, position, status: 'normal', suspended: null, duelsTotal: 30, savesTotal: 20 };
}

/** 主场两人：张三（手录评分 8 + 手录出场）、L. Li（赛果零封）；客场一人 */
function panel(over: Partial<MatchEntryPanel> = {}): MatchEntryPanel {
  return {
    match: match(),
    sides: {
      home: { clubId: 1, isCpu: false, players: [player(10, '张三', 'GK'), player(11, 'L. Li', 'ST')] },
      away: { clubId: 2, isCpu: false, players: [player(20, 'Q. Qian', 'GK')] },
    },
    recorded: [
      { playerId: 10, eventType: 'rating', value: 8, xp: 2, source: 'manual' },
      { playerId: 10, eventType: 'appearance', value: 1, xp: 1, source: 'manual' },
      { playerId: 11, eventType: 'clean_sheet', value: 1, xp: 0.5, source: 'auto' },
    ],
    ...over,
  };
}

/** 面板名单行（主场在前，一人一行）：td = 0 球员/1 位置/2 出场/3 评分/4 零封/5 夺回球权/6 扑救/7 进球/8 助攻/9 本场XP/10 操作 */
function rows(): HTMLTableRowElement[] {
  return [...document.querySelectorAll<HTMLTableRowElement>('.entry-table tbody tr')];
}

function cell(rowIndex: number, colIndex: number): HTMLTableCellElement {
  const td = rows()[rowIndex].querySelectorAll('td')[colIndex];
  if (!td) throw new Error(`第 ${rowIndex} 行没有第 ${colIndex} 列`);
  return td as HTMLTableCellElement;
}

/** 格子里的输入框（查看模式里「没录过的格子」是 — 文本，没有 input，此时这里拿到 null 是预期行为） */
function cellInput(rowIndex: number, colIndex: number): HTMLInputElement | null {
  return cell(rowIndex, colIndex).querySelector('input');
}

/** 面板作用域内按文案取按钮（列表行上也有「收起」） */
function panelButton(name: string): HTMLButtonElement {
  const panelEl = document.querySelector('.entry-panel');
  if (!panelEl) throw new Error('录入面板还没打开');
  const btn = [...panelEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!btn) throw new Error(`面板里没有「${name}」按钮`);
  return btn as HTMLButtonElement;
}

/** 组头文案（.match-entry-group 的 td：赛事视图「赛事名 · N 场」，轮次视图「第 N 轮 · 赛事名 · N 场」） */
function groupHeads(): string[] {
  return [...document.querySelectorAll('.match-entry-group td')].map((td) => td.textContent ?? '');
}

/** 表内行级「保存」（只有脏行且输入合法才可点） */
function rowSaveButton(): HTMLButtonElement {
  const btns = [...document.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === '保存' && !(b as HTMLButtonElement).disabled,
  );
  if (btns.length === 0) throw new Error('没有可点的行内「保存」按钮');
  return btns[0] as HTMLButtonElement;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GrowthEntryPage />
    </QueryClientProvider>,
  );
}

/** 打开某场的录入面板并等名单渲染完 */
async function openEdit() {
  fireEvent.click(await screen.findByRole('button', { name: '录数据' }));
  await waitFor(() => expect(document.querySelector('.entry-table')).not.toBeNull());
}

beforeEach(() => {
  // useMediaQuery 直接吃 window.matchMedia（jsdom 没实现，自己打桩成桌面宽度）
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mocks.list.mockReset();
  mocks.panel.mockReset();
  mocks.submit.mockReset();
  mocks.list.mockResolvedValue({ matches: [match()] });
  mocks.panel.mockResolvedValue(panel());
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TC-ENTRY-E 录入面板可改性（v6.45.1）', () => {
  it('TC-ENTRY-E1 手录值可改、赛果值只读、记过标记锁定；查看模式全锁', async () => {
    renderPage();
    await openEdit();

    // 张三：手录评分 8 → 可改，格子带 editable；手录出场 → 记过标记，勾选且禁用
    const rating = cellInput(0, 3) as HTMLInputElement;
    expect(rating.value).toBe('8');
    expect(rating.readOnly).toBe(false);
    expect(rating.disabled).toBe(false);
    expect(cell(0, 3).className).toContain('recorded');
    expect(cell(0, 3).className).toContain('editable');
    expect((cellInput(0, 2) as HTMLInputElement).disabled).toBe(true);
    expect((cellInput(0, 2) as HTMLInputElement).checked).toBe(true);
    // 未录的零封仍可勾
    expect((cellInput(0, 4) as HTMLInputElement).disabled).toBe(false);
    expect((cellInput(0, 4) as HTMLInputElement).checked).toBe(false);

    // L. Li：赛果零封 → 只读（禁用 + 灰底，不带 editable）；未录的评分可填
    expect((cellInput(1, 4) as HTMLInputElement).disabled).toBe(true);
    expect((cellInput(1, 4) as HTMLInputElement).checked).toBe(true);
    expect(cell(1, 4).className).toContain('recorded');
    expect(cell(1, 4).className).not.toContain('editable');
    expect((cellInput(1, 3) as HTMLInputElement).readOnly).toBe(false);

    // 查看模式：录过的格子锁死，没录过的格子渲染成 —
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    await waitFor(() => expect(cellInput(0, 3)?.readOnly).toBe(true));
    expect((cellInput(0, 2) as HTMLInputElement).disabled).toBe(true);
    expect(cellInput(0, 4)).toBeNull();
    expect(cell(0, 4).textContent).toBe('—');
    expect(cellInput(1, 3)).toBeNull();
    expect(cell(1, 3).textContent).toBe('—');
    expect((cellInput(1, 4) as HTMLInputElement).disabled).toBe(true);
  });

  it('TC-ENTRY-E2 收起面板时脏草稿走确认条，「保存并继续」先提交再收起', async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      written: 0,
      updated: 1,
      duplicates: 0,
      totalXp: 1,
      perPlayer: [{ playerId: 10, name: '张三', xp: 1, written: 0, updated: 1, duplicates: 0 }],
    } satisfies MatchEntrySubmitResult);
    renderPage();
    await openEdit();

    expect(panelButton('全部保存').disabled).toBe(true); // 无改动不可点

    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '9' } });
    expect(panelButton('全部保存').disabled).toBe(false);

    fireEvent.click(panelButton('收起'));
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();
    // 面板没被丢掉，草稿还在
    expect((cellInput(0, 3) as HTMLInputElement).value).toBe('9');

    // 「继续编辑」＝什么都不做，草稿保留
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByText(/录入面板有未保存的改动/)).toBeNull();
    expect((cellInput(0, 3) as HTMLInputElement).value).toBe('9');

    fireEvent.click(panelButton('收起'));
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    // 只提交改过的字段（锁定字段永不出网：出场/零封都是锁的）
    expect(mocks.submit.mock.calls[0][0]).toBe(1900);
    expect(mocks.submit.mock.calls[0][1]).toEqual([{ playerId: 10, rating: 9 }]);
    // 保存成功后照旧执行收起：确认条与面板都消失
    await waitFor(() => expect(document.querySelector('.entry-table')).toBeNull());
    expect(screen.queryByText(/录入面板有未保存的改动/)).toBeNull();
    // 面板 toast 报「改 1 项」（差额 +1）
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('改 1 项'));
  });

  it('TC-ENTRY-E3 切换视图同样要过确认条（切视图会重挂面板丢草稿）', async () => {
    renderPage();
    await openEdit();
    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '9' } });

    expect(groupHeads().some((t) => t.startsWith('第七赛季联赛'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '按轮次' }));
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();
    expect(groupHeads().some((t) => t.startsWith('第 3 轮'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '不保存，继续' }));
    await waitFor(() => expect(groupHeads().some((t) => t.startsWith('第 3 轮'))).toBe(true));
    // 轮次视图的单层组头要带出赛事名（否则认不出这轮属于哪个赛事）
    expect(groupHeads().some((t) => t.startsWith('第 3 轮') && t.includes('第七赛季联赛'))).toBe(true);
    // 切视图会把面板重挂（树形变了），草稿丢掉 → 回到已录的基线值 8；偏好落 localStorage
    await waitFor(() => expect((cellInput(0, 3) as HTMLInputElement).value).toBe('8'));
    expect(localStorage.getItem('whl.growth-entry.view')).toBe('round');

    // 反向同样要过闸门：轮次视图里改一版草稿，点「按赛事」也先弹确认条
    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '9.5' } });
    fireEvent.click(screen.getByRole('button', { name: '按赛事' }));
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();
    expect(groupHeads().some((t) => t.startsWith('第 3 轮'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '不保存，继续' }));
    await waitFor(() => expect(groupHeads().some((t) => t.startsWith('第七赛季联赛'))).toBe(true));
    expect(localStorage.getItem('whl.growth-entry.view')).toBe('tournament');
  });

  it('TC-ENTRY-E4 一次保存超过服务端单批上限（50）自动分块提交', async () => {
    const many = Array.from({ length: 51 }, (_, i) => player(100 + i, `球员${i + 1}`, 'MF'));
    mocks.panel.mockResolvedValue(
      panel({
        sides: { home: { clubId: 1, isCpu: false, players: many }, away: { clubId: 2, isCpu: false, players: [] } },
        recorded: [],
      }),
    );
    mocks.submit.mockImplementation((_matchId: number, entries: { playerId: number }[]) =>
      Promise.resolve({
        ok: true,
        written: entries.length,
        updated: 0,
        duplicates: 0,
        totalXp: entries.length * 2,
        perPlayer: entries.map((e) => ({ playerId: e.playerId, name: '球员', xp: 2, written: 1, updated: 0, duplicates: 0 })),
      } satisfies MatchEntrySubmitResult),
    );
    renderPage();
    await openEdit();

    expect(rows()).toHaveLength(51);
    for (let i = 0; i < 51; i += 1) fireEvent.change(cellInput(i, 3) as HTMLInputElement, { target: { value: '8' } });

    fireEvent.click(panelButton('全部保存'));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[0][1]).toHaveLength(50);
    expect(mocks.submit.mock.calls[1][1]).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('新录 51 项'));
  });

  it('TC-ENTRY-E5 行内保存还在飞就收起：确认条等它落地再算脏行，不重复提交', async () => {
    // 手动放行的提交：先扣住不 resolve，验证「在飞」期间的收起行为
    const gate: { resolve: (v: MatchEntrySubmitResult) => void } = { resolve: () => undefined };
    mocks.submit.mockImplementation(
      () =>
        new Promise<MatchEntrySubmitResult>((res) => {
          gate.resolve = res;
        }),
    );
    renderPage();
    await openEdit();

    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '9' } });
    fireEvent.click(rowSaveButton());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));

    // 还在飞：基线没前移 ⇒ 这一行仍算脏，收起要先警告
    fireEvent.click(panelButton('收起'));
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    await Promise.resolve();
    expect(mocks.submit).toHaveBeenCalledTimes(1); // 在飞的还没落地，不另起一批

    // 落地后这一行的基线前移 ⇒ 已无脏行：直接放行收起，也不重复提交
    gate.resolve({
      ok: true,
      written: 0,
      updated: 1,
      duplicates: 0,
      totalXp: 1,
      perPlayer: [{ playerId: 10, name: '张三', xp: 1, written: 0, updated: 1, duplicates: 0 }],
    });
    await waitFor(() => expect(document.querySelector('.entry-table')).toBeNull());
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it('TC-ENTRY-E6 清空已录的手录值按非法输入拦下（清空=删事件，没有删除通道），确认条不放行', async () => {
    renderPage();
    await openEdit();

    // 张三的评分是手录 8（可改）：擦掉不打新值
    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '' } });
    expect(document.body.textContent).toContain('已录的评分不能清空');
    // 行内保存被禁用（issues 非空），所以没有「可点的保存」按钮
    expect(() => rowSaveButton()).toThrow();

    // 收起要警告；「保存并继续」发现非法行 ⇒ 不提交、不放行、面板留在原地（草稿还在）
    fireEvent.click(panelButton('收起'));
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('有 1 行输入不合法'));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(document.querySelector('.entry-table')).not.toBeNull();
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();
    expect((cellInput(0, 3) as HTMLInputElement).value).toBe('');
  });
});
