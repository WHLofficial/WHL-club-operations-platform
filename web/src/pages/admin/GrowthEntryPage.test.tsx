// v6.45.1 成长录入页 · 面板可改性 + 未保存确认条（TC-ENTRY-E）。
// 钉住的都是「不写测试就会悄悄回退」的口径：
//   1) 格子锁定口径：赛果（auto）的评分/夺回/扑救只读，手录的（manual）可改；出场与零封是「记过」标记，录过就锁；
//   2) 收起面板时脏草稿要走确认条，选「保存并继续」＝先提交再收起（父级持 pending，面板经 saveAllRef 回填结果）；
//   3) 切视图会重挂面板，同样要过确认条；
//   4) 一次「全部保存」超过服务端单批上限（50）要自动分块。
//   5) 截图上传前要过 fileToOcrBase64（v6.51.5 的 2× 放大助手）——这里 mock 掉它只为钉住「页面确实走了这道工序」，
//      放大算法本身由 web/src/lib/ocr-image.test.ts 覆盖。
//   6) 「不保存，继续」只丢当前队侧的草稿（v6.51.11）：换队侧不动另一队侧的草稿（含截图预填），闸门也只看当前队侧。
// 注意：查看模式里「没录过的格子」渲染成 —（没有 input）；面板里的按钮有两个「收起」（列表行上一个、面板头一个），要按面板作用域取。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const ocrImage = vi.hoisted(() => ({
  fileToOcrBase64: vi.fn(async (_file: File) => 'SENTINEL_B64'),
}));

vi.mock('../../lib/ocr-image.ts', () => ({ fileToOcrBase64: ocrImage.fileToOcrBase64 }));

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
    xpEligible: true,
    ...over,
  };
}

function player(id: number, name: string, position: string): MatchEntryPlayer {
  // v6.52.0：面板 DTO 带 growable（false = 非成长，行内标灰、XP 归零）；旧用例的默认球员都可成长
  return { id, name, position, status: 'normal', growable: true, suspended: null, duelsTotal: 30, savesTotal: 20 };
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

/** 列表页渲染。staleTime 缺省 0（测试里点开必重取，断言「取到了什么」最直接）；
 *  悬停预取的用例传 30_000 —— 与生产（web/src/main.tsx）同口径，才测得出「命中缓存不重发」。 */
function renderPage(staleTime?: number) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, ...(staleTime === undefined ? {} : { staleTime }) } },
  });
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <GrowthEntryPage />
      </QueryClientProvider>,
    ),
    client: qc,
  };
}

/** 比赛列表里某一场的行（rows() 只覆盖面板的 .entry-table，列表是外层那张表） */
function listRow(index = 0): HTMLTableRowElement {
  const tr = [...document.querySelectorAll<HTMLTableRowElement>('.match-entry-actions')][index]?.closest('tr');
  if (!tr) throw new Error(`比赛列表没有第 ${index} 行`);
  return tr;
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
  ocrImage.fileToOcrBase64.mockClear();
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
    // 51 行 × 51 次 fireEvent 在 jsdom 下渲染很重（单跑约 4.6s），默认 5s 超时在全量并发时会假失败
  }, 20000);

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

  it('TC-ENTRY-E7 v6.46.0 非 XP 场次（冠军杯淘汰轮）：只录出场与评分，三个计数器禁用、XP 展示按住 0', async () => {
    // 这些场次也放开补录（球员比赛记录的出场与均分要用），但零封/夺回球权/扑救写进去服务端整批 400
    const cup = match({ matchId: 2400, competitionType: 'champions_cup', stageKind: 'elim', stageName: '决赛', xpEligible: false });
    mocks.list.mockResolvedValue({ matches: [cup] });
    mocks.panel.mockResolvedValue({
      ...panel(),
      match: { ...panel().match, matchId: 2400, competitionType: 'champions_cup', stageKind: 'elim', stageName: '决赛', xpEligible: false },
      recorded: [], // 未录过：三个计数器正常该是可勾/可填的，这里的禁用只可能来自「不计 XP」
    });
    renderPage();
    await openEdit();

    // 头部徽章 + 说明块（点明零封/夺回球权/扑救不开放的原因是它们只产 XP）
    expect(document.body.textContent).toContain('本场不计成长 XP（只录出场与评分）');
    expect(document.body.textContent).toContain('零封 / 夺回球权 / 扑救是纯 XP 计数器，本场不开放');
    // 三个计数器禁用；出场与评分照常可录
    for (const col of [4, 5, 6]) expect((cellInput(0, col) as HTMLInputElement).disabled).toBe(true);
    expect((cellInput(0, 2) as HTMLInputElement).disabled).toBe(false); // 出场
    expect((cellInput(0, 3) as HTMLInputElement).readOnly).toBe(false); // 评分
    // XP 列与汇总徽章都按住 0：填了值也不给收益幻觉
    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '8.5' } });
    expect(cell(0, 9).textContent).toBe('0');
    expect(cell(0, 0).textContent).toContain('不计 XP'); // 行首标记：告诉管理组这场录了也不产 XP
  });

  /** 上传一张图（ocrInputRef 藏在面板里的 file input） */
  function pickFile(name = 'a.png') {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], name, { type: 'image/png' })], configurable: true });
    fireEvent.change(input);
  }

  it('TC-ENTRY-E8 队名歧义（v6.51.3）：提示带模型读到的英文原文 + 主队/客队/取消三颗按钮，选边用同一张图续跑', async () => {
    const calls: { body: { image?: string; side?: string } }[] = [];
    const responses = [
      new Response(
        JSON.stringify({
          error:
            '截图队名「FC BAYERN MÜNCHEN」（识别为「慕尼黑」）这场两侧都像（海港联 vs 北岸城），分不清主客——请点按钮选边，或换一张队名更完整的截图',
          code: 'ocr_team_ambiguous',
        }),
        { status: 400 },
      ),
      new Response(
        JSON.stringify({
          team: '北岸城',
          side: 'away',
          kind: 'summary',
          entries: [{ playerId: 20, name: 'Q. Qian', position: 'GK', draft: { appearance: true, rating: 6.4 }, matched: 'official' }],
          unmatched: [],
          warnings: [],
        }),
        { status: 200 },
      ),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        calls.push({ body: JSON.parse(String(init?.body)) as { image?: string; side?: string } });
        return responses.shift() as Response;
      }),
    );

    renderPage();
    await openEdit();
    pickFile();

    // 提示行带英文原文；三颗按钮：两侧各一颗 + 取消（确实传错时用）
    expect(await screen.findByText(/FC BAYERN MÜNCHEN/)).toBeTruthy();
    expect(panelButton('主队 海港联')).toBeTruthy();
    expect(panelButton('客队 北岸城')).toBeTruthy();
    expect(panelButton('取消（这张图不预填）')).toBeTruthy();
    // 歧义不算失败：报告条不落红字
    expect(document.querySelector('.entry-ocr-report')?.className).not.toContain('bad-text');

    fireEvent.click(panelButton('客队 北岸城'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body.side).toBe('away');
    expect(calls[1].body.image).toBe(calls[0].body.image); // 同一张图重发，不用重选文件
    expect(await screen.findByText(/按客队 北岸城/)).toBeTruthy();
  });

  it('TC-ENTRY-E9 确实传错图时点「取消」：不预填、不再打服务端、提示留在报告区', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            error: '截图队名「CHELSEA」这场两侧都像（海港联 vs 北岸城），分不清主客——请点按钮选边，或换一张队名更完整的截图',
            code: 'ocr_team_ambiguous',
          }),
          { status: 400 },
        );
      }),
    );

    renderPage();
    await openEdit();
    pickFile();
    await screen.findByText(/分不清主客/);
    fireEvent.click(panelButton('取消（这张图不预填）'));

    expect(await screen.findByText(/已取消，这张图不预填/)).toBeTruthy();
    expect(document.querySelector('.entry-ocr-choice')).toBeNull(); // 待选行收掉
    expect(calls).toBe(1); // 取消不再打服务端
    expect(cellInput(0, 3)?.value ?? '').toBe('8'); // 手填的评分原样不动
  });

  it('TC-ENTRY-E13 队名对不上（v6.51.8，模型给英文名如 OLYMPIACOS FC）：同样出提示 + 三颗按钮，选边即可救回', async () => {
    const calls: { body: { image?: string; side?: string } }[] = [];
    const responses = [
      new Response(
        JSON.stringify({
          error:
            '截图队名「OLYMPIACOS FC」对不上这场比赛（海港联 vs 北岸城）——确实是这张图的队名，就点按钮选边；传错图请点取消',
          code: 'ocr_team_unmatched',
        }),
        { status: 400 },
      ),
      new Response(
        JSON.stringify({
          team: '海港联',
          side: 'home',
          kind: 'summary',
          entries: [{ playerId: 10, name: 'K. Zhang', position: 'GK', draft: { appearance: true, rating: 6.8 }, matched: 'official' }],
          unmatched: [],
          warnings: [],
        }),
        { status: 200 },
      ),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        calls.push({ body: JSON.parse(String(init?.body)) as { image?: string; side?: string } });
        return responses.shift() as Response;
      }),
    );

    renderPage();
    await openEdit();
    pickFile();

    // 不再是「红字 + 只能重传」：提示行点名截图上的英文原文，三颗按钮照旧
    expect(await screen.findByText(/OLYMPIACOS FC/)).toBeTruthy();
    expect(screen.getByText(/点按钮选边/)).toBeTruthy();
    expect(panelButton('主队 海港联')).toBeTruthy();
    expect(panelButton('客队 北岸城')).toBeTruthy();
    expect(panelButton('取消（这张图不预填）')).toBeTruthy();
    expect(document.querySelector('.entry-ocr-report')?.className).not.toContain('bad-text');

    fireEvent.click(panelButton('主队 海港联'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body.side).toBe('home');
    expect(calls[1].body.image).toBe(calls[0].body.image); // 同一张图重发
    expect(await screen.findByText(/按主队 海港联/)).toBeTruthy();
  });

  it('TC-ENTRY-E10 换队侧「不保存，继续」也真丢草稿（v6.51.4）：切回主队看到服务端基线', async () => {
    renderPage();
    await openEdit();

    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '9' } });
    expect(panelButton('全部保存').disabled).toBe(false);

    // 换队侧不重挂面板（side 是面板 state）：草稿原本会留在主队那一侧
    fireEvent.click(screen.getByRole('button', { name: /^客队 · 北岸城/ }));
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '不保存，继续' }));

    // 客队名单在面板里了；切回主队时已无脏行（不再弹确认条）
    await waitFor(() => expect(rows()[0].textContent).toContain('Q. Qian'));
    expect(screen.queryByText(/录入面板有未保存的改动/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^主队 · 海港联/ }));
    await waitFor(() => expect(rows()[0].textContent).toContain('张三'));
    expect((cellInput(0, 3) as HTMLInputElement).value).toBe('8'); // 草稿被丢弃，回到已录基线
    expect(panelButton('全部保存').disabled).toBe(true);
  });

  it('TC-ENTRY-E11 收起「不保存，继续」后重开同一场：草稿仍在丢弃（回归护栏）', async () => {
    renderPage();
    await openEdit();

    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '9.5' } });
    fireEvent.click(panelButton('收起'));
    fireEvent.click(screen.getByRole('button', { name: '不保存，继续' }));
    await waitFor(() => expect(document.querySelector('.entry-table')).toBeNull());

    await openEdit();
    expect((cellInput(0, 3) as HTMLInputElement).value).toBe('8');
    expect(panelButton('全部保存').disabled).toBe(true);
  });

  it('TC-ENTRY-E12 截图先过放大助手再上传（v6.51.5）：请求体里的 image 就是助手输出', async () => {
    const calls: { body: { image?: string } }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        calls.push({ body: JSON.parse(String(init?.body)) as { image?: string } });
        return new Response(JSON.stringify({ team: '海港联', side: 'home', kind: 'summary', entries: [], unmatched: [], warnings: [] }), { status: 200 });
      }),
    );

    renderPage();
    await openEdit();
    pickFile();

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.image).toBe('SENTINEL_B64');
    expect(ocrImage.fileToOcrBase64).toHaveBeenCalledTimes(1);
    expect((ocrImage.fileToOcrBase64.mock.calls[0][0] as File).name).toBe('a.png');
  });

  it('TC-ENTRY-E14 悬停预取（v6.51.10）：掠过列表行先把面板数据拉进缓存，点开不再发第二趟', async () => {
    const { client } = renderPage(30_000);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: '录数据' });
    expect(mocks.panel).not.toHaveBeenCalled(); // 光渲染列表不预取
    await user.hover(listRow());
    await waitFor(() => expect(mocks.panel).toHaveBeenCalledTimes(1));
    expect(mocks.panel).toHaveBeenCalledWith(1900);
    await waitFor(() => expect(client.getQueryState(['admin', 'growth', 'match-entry', 1900])?.status).toBe('success'));

    fireEvent.click(screen.getByRole('button', { name: '录数据' }));
    await waitFor(() => expect(document.querySelector('.entry-table')).not.toBeNull());
    expect(mocks.panel).toHaveBeenCalledTimes(1); // 面板吃的就是预取那份（新鲜期内不重取）
  });

  it('TC-ENTRY-E15 预取失败不留错误态：点开照旧正常取数，不闪「面板加载失败」', async () => {
    const { client } = renderPage(30_000);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: '录数据' });
    mocks.panel.mockRejectedValueOnce(new Error('网络抖动'));

    await user.hover(listRow());
    await waitFor(() => expect(mocks.panel).toHaveBeenCalledTimes(1));
    // 预取那趟失败后缓存条目要被清掉：留着的话点开时 useQuery 先吃到 error 态，会闪一下失败提示
    await waitFor(() => expect(client.getQueryState(['admin', 'growth', 'match-entry', 1900])).toBeUndefined());

    fireEvent.click(screen.getByRole('button', { name: '录数据' }));
    await waitFor(() => expect(document.querySelector('.entry-table')).not.toBeNull());
    expect(document.body.textContent).not.toContain('面板加载失败');
    expect(mocks.panel).toHaveBeenCalledTimes(2); // 预取失败的那趟 + 点开重取的这趟
  });

  it('TC-ENTRY-E16 换队侧「不保存，继续」只丢当前队侧（v6.51.11）：另一队侧的截图预填保留', async () => {
    // 多选上传两队截图：主队那张预填 L. Li 评分 9、客队那张预填 Q. Qian 评分 7.7。
    // 识别后 setSide 跟着预填走（res.side），所以传完客队那张时当前队侧是客队、两侧都脏。
    const responses = [
      new Response(
        JSON.stringify({
          team: '海港联',
          side: 'home',
          kind: 'summary',
          entries: [{ playerId: 11, name: 'L. Li', position: 'ST', draft: { appearance: true, rating: 9 }, matched: 'official' }],
          unmatched: [],
          warnings: [],
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          team: '北岸城',
          side: 'away',
          kind: 'summary',
          entries: [{ playerId: 20, name: 'Q. Qian', position: 'GK', draft: { appearance: true, rating: 7.7 }, matched: 'official' }],
          unmatched: [],
          warnings: [],
        }),
        { status: 200 },
      ),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift() as Response));

    renderPage();
    await openEdit();
    pickFile('home.png');
    await waitFor(() => expect((cellInput(1, 3) as HTMLInputElement).value).toBe('9')); // 主队侧预填落地（L. Li 行）
    pickFile('away.png');
    await waitFor(() => expect(rows()[0].textContent).toContain('Q. Qian')); // 面板跟着预填切到客队侧

    // 换回主队：当前队侧（客队）有脏行 → 出确认条；「不保存，继续」只丢客队侧的草稿
    fireEvent.click(screen.getByRole('button', { name: /^主队 · 海港联/ }));
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '不保存，继续' }));
    await waitFor(() => expect(rows()[0].textContent).toContain('张三'));
    expect((cellInput(1, 3) as HTMLInputElement).value).toBe('9'); // 主队侧的预填还在（换队侧不动另一侧）

    // 再回客队：主队侧此时有未保存预填 → 照样出确认条，丢的是主队侧；客队侧上一步已回到基线
    fireEvent.click(screen.getByRole('button', { name: /^客队 · 北岸城/ }));
    expect(screen.getByText(/录入面板有未保存的改动/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '不保存，继续' }));
    await waitFor(() => expect(rows()[0].textContent).toContain('Q. Qian'));
    expect((cellInput(0, 3) as HTMLInputElement).value).toBe(''); // 客队侧草稿已丢：评分回到空
    expect((cellInput(0, 2) as HTMLInputElement).checked).toBe(false); // 出场预填也一起丢了
  });

  it('TC-ENTRY-E17 换队侧闸门只看当前队侧（v6.51.11）：另一队侧挂着草稿也不拦', async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      written: 1,
      updated: 0,
      duplicates: 0,
      totalXp: 1,
      perPlayer: [{ playerId: 20, name: 'Q. Qian', xp: 1, written: 1, updated: 0, duplicates: 0 }],
    } satisfies MatchEntrySubmitResult);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              team: '北岸城',
              side: 'away',
              kind: 'summary',
              entries: [{ playerId: 20, name: 'Q. Qian', position: 'GK', draft: { appearance: true, rating: 7.7 }, matched: 'official' }],
              unmatched: [],
              warnings: [],
            }),
            { status: 200 },
          ),
      ),
    );

    renderPage();
    await openEdit();
    // 主队侧先手填一个草稿，留着不保存
    fireEvent.change(cellInput(0, 3) as HTMLInputElement, { target: { value: '9' } });
    // 传客队截图：预填落在客队侧、面板跟过去——当前队侧（客队）脏，主队侧也脏
    pickFile('away.png');
    await waitFor(() => expect(rows()[0].textContent).toContain('Q. Qian'));
    // 把当前队侧存掉：基线前移 ⇒ 客队侧干净，主队侧的草稿还挂着
    fireEvent.click(rowSaveButton());
    await screen.findAllByText(/新录 1 项/); // 等状态行/toast 出现 = 保存真的落地（不能只看保存按钮，保存中它也是禁用的）
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(() => rowSaveButton()).toThrow()); // 客队侧已无脏行

    // 换队侧：当前队侧干净、脏的是另一侧 —— 不该弹确认条（老口径「两侧任一脏就拦」会误拦）
    fireEvent.click(screen.getByRole('button', { name: /^主队 · 海港联/ }));
    await waitFor(() => expect(rows()[0].textContent).toContain('张三'));
    expect(screen.queryByText(/录入面板有未保存的改动/)).toBeNull();
    expect((cellInput(0, 3) as HTMLInputElement).value).toBe('9'); // 主队侧草稿原样保留
  });
});
