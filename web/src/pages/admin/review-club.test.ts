// @vitest-environment jsdom
// 审核队列「俱乐部」列（2026-11-04 设计稿 §7）：取义纯函数逐类型锁定 + ReviewsSection 渲染用例。
// 文件名按设计稿定为 .test.ts（不吃 JSX），渲染用例的 Provider 包装层用 createElement 搭。
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminReviewRow } from '../../lib/api.ts';
import { reviewClubDisplay } from './review-club.ts';
import { ReviewsSection } from './MarketPage.tsx';

/* ---------- 纯函数：取义口径 ---------- */

type RowOverrides = Partial<Pick<AdminReviewRow, 'report'>> & {
  type?: string;
  fromClubName?: string | null;
  fromClubId?: number | null;
  toClubName?: string | null;
  toClubId?: number | null;
};

// 渲染用例会被 ReviewsSection 用 r.id 当 <tr key>：每行必须唯一，否则 React 报同 key 警告
let nextReviewId = 1;

function row(o: RowOverrides = {}): AdminReviewRow {
  const { type, fromClubName, fromClubId, toClubName, toClubId, ...rest } = o;
  return {
    id: nextReviewId++,
    kind: 'transfer_confirm',
    status: 'open',
    payload: null,
    note: null,
    decidedAt: null,
    report: null,
    transfer: {
      id: 101,
      type: 'transfer',
      status: 'pending',
      fee: 10,
      tax: null,
      extraFee: null,
      player: { id: 9, fcId: null, name: '球员甲', position: null, ca: 80, pa: 90 },
      fromClubName: '曼联',
      fromClubId: 1,
      toClubName: '尤文图斯',
      toClubId: 2,
      ...(type !== undefined ? { type } : {}),
      ...(fromClubName !== undefined ? { fromClubName } : {}),
      ...(fromClubId !== undefined ? { fromClubId } : {}),
      ...(toClubName !== undefined ? { toClubName } : {}),
      ...(toClubId !== undefined ? { toClubId } : {}),
    },
    ...rest,
  };
}

describe('reviewClubDisplay：按单据类型取俱乐部（设计稿 §3）', () => {
  it('普通单：from → to 两端保留、arrow=true、无角色', () => {
    const d = reviewClubDisplay(row());
    expect(d).toEqual({
      main: [
        { name: '曼联', id: 1 },
        { name: '尤文图斯', id: 2 },
      ],
      arrow: true,
      role: null,
      origin: null,
    });
  });

  it('强拍转出端为空：空端仍保留在 main 里（由渲染层出 —），箭头不消失', () => {
    const d = reviewClubDisplay(row({ type: 'forced_auction', fromClubName: null, fromClubId: null }));
    expect(d.main).toEqual([
      { name: '', id: null },
      { name: '尤文图斯', id: 2 },
    ]);
    expect(d.arrow).toBe(true);
  });

  it('海捞（真自由身）：只签入方 +「签入」，没有原队行', () => {
    const d = reviewClubDisplay(
      row({ type: 'free_agent', fromClubName: null, fromClubId: null, toClubName: 'RB莱比锡', toClubId: 7 }),
    );
    expect(d).toEqual({ main: [{ name: 'RB莱比锡', id: 7 }], arrow: false, role: '签入', origin: null });
  });

  it('海捞（CPU 原队）：origin 带原队名与 id，供第二行「原队 X」', () => {
    const d = reviewClubDisplay(
      row({ type: 'free_agent', fromClubName: '佛罗伦萨', fromClubId: 5, toClubName: 'RB莱比锡', toClubId: 7 }),
    );
    expect(d.origin).toEqual({ name: '佛罗伦萨', id: 5 });
    expect(d.main).toEqual([{ name: 'RB莱比锡', id: 7 }]);
    expect(d.role).toBe('签入');
  });

  it('海捞（名字空但 id 在）：按「任一非空」仍给 origin，渲染层出「原队 —」', () => {
    const d = reviewClubDisplay(row({ type: 'free_agent', fromClubName: null, fromClubId: 5 }));
    expect(d.origin).toEqual({ name: '', id: 5 });
  });

  it('解约：只解约方（from 端），toClub 即使非空也不进 main', () => {
    const d = reviewClubDisplay(row({ type: 'termination', fromClubName: '拜仁慕尼黑', fromClubId: 3 }));
    expect(d).toEqual({ main: [{ name: '拜仁慕尼黑', id: 3 }], arrow: false, role: '解约', origin: null });
  });

  it('续约：from 端 +「续约」', () => {
    const d = reviewClubDisplay(row({ type: 'rc_change', fromClubName: '巴塞罗那', fromClubId: 4 }));
    expect(d).toEqual({ main: [{ name: '巴塞罗那', id: 4 }], arrow: false, role: '续约', origin: null });
  });

  it('匹配留队：from 端 +「留队」', () => {
    const d = reviewClubDisplay(row({ type: 'match', fromClubName: '巴塞罗那', fromClubId: 4 }));
    expect(d).toEqual({ main: [{ name: '巴塞罗那', id: 4 }], arrow: false, role: '留队', origin: null });
  });

  it('激活举报：report 优先于 transfer.type，只出激活方 +「激活方」', () => {
    const r = row({
      type: 'transfer',
      report: { listingId: 55, listingStatus: 'active', askPrice: 3, proofKey: 'k.png', activatorClubName: '巴黎圣日耳曼', activatorClubId: 6 },
    });
    const d = reviewClubDisplay(r);
    expect(d).toEqual({ main: [{ name: '巴黎圣日耳曼', id: 6 }], arrow: false, role: '激活方', origin: null });
  });
});

/* ---------- 渲染：俱乐部列落在「球员」之后，普通单两端挂 IdTag ---------- */

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
// ReviewsSection 的数据全走 TanStack Query 包 api()；apiPost 只在事件里被调，给个空实现即可
vi.mock('../../lib/api.ts', () => ({ api: apiMock, apiPost: vi.fn() }));

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

function renderReviews(rows: AdminReviewRow[]) {
  apiMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/admin/reviews')) return { reviews: rows };
    throw new Error(`未打桩的请求 ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(MemoryRouter, null, createElement(ReviewsSection)),
    ),
  );
}

// 待审页签下 td 序：tick(0) 球员(1) 俱乐部(2) 单据(3)……——锁定俱乐部列紧跟球员（设计稿 §3 列序）
function clubTdOf(transferId: number): HTMLElement {
  const tr = document.getElementById(`review-transfer-${transferId}`);
  if (!(tr instanceof HTMLElement)) throw new Error(`没找到成交行 review-transfer-${transferId}`);
  const td = tr.querySelectorAll('td')[2];
  if (!(td instanceof HTMLElement)) throw new Error(`review-transfer-${transferId} 没有第 3 个 td`);
  return td;
}

describe('审核队列「俱乐部」列渲染（TC-RV-CLUB-04 / 06）', () => {
  it('普通单：单元格同时出现两个 IdTag kind=俱乐部；表头俱乐部紧跟球员', async () => {
    const normal = row();
    const emptyEnds = row({
      type: 'forced_auction',
      fromClubName: null,
      fromClubId: null,
      toClubName: null,
      toClubId: null,
    });
    emptyEnds.transfer.id = 102;
    emptyEnds.transfer.player = { ...emptyEnds.transfer.player, name: '球员乙' };
    // 名字在场但 id 为空的端（TC-RV-CLUB-06 的另一半）：也只出 —，不挂 IdTag
    const noIdEnd = row({ type: 'activation', fromClubName: '曼联', fromClubId: null });
    noIdEnd.transfer.id = 103;
    noIdEnd.transfer.player = { ...noIdEnd.transfer.player, name: '球员丙' };
    const { container } = renderReviews([normal, emptyEnds, noIdEnd]);
    await screen.findByText('球员甲');

    // 列序：勾选列 th 无文本，俱乐部必须排在球员与单据之间
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['', '球员', '俱乐部', '单据', '内容', '金额（m）', '状态', '操作']);

    const td = clubTdOf(101);
    expect(td.textContent).toContain('曼联');
    expect(td.textContent).toContain('尤文图斯');
    expect(within(td).getByRole('button', { name: '俱乐部 #1，点击复制' })).toBeTruthy();
    expect(within(td).getByRole('button', { name: '俱乐部 #2，点击复制' })).toBeTruthy();
    // 本格里只有这两个可复制标签（球员/转会 IdTag 都在别的格）
    expect(within(td).getAllByRole('button')).toHaveLength(2);

    // 全空值（最坏情况）：两端只出 —，不挂任何 IdTag，箭头仍在
    const emptyTd = clubTdOf(102);
    expect(emptyTd.textContent).toBe('— → —');
    expect(within(emptyTd).queryAllByRole('button')).toHaveLength(0);

    // 名字在、id 空：该端只出 —，整格只剩另一个 IdTag
    const noIdTd = clubTdOf(103);
    expect(noIdTd.textContent).toBe('— → 尤文图斯 #2');
    expect(within(noIdTd).queryAllByRole('button')).toHaveLength(1);
  });

  it('方式单与激活举报：角色小字、原队第二行、激活举报行的俱乐部格都在（TC-RV-CLUB-05）', async () => {
    const withId = (r: AdminReviewRow, id: number) => {
      r.transfer.id = id;
      return r;
    };
    const faCpu = withId(
      row({ type: 'free_agent', fromClubName: '佛罗伦萨', fromClubId: 5, toClubName: 'RB莱比锡', toClubId: 7 }),
      301,
    );
    const faFree = withId(row({ type: 'free_agent', fromClubName: null, fromClubId: null, toClubName: 'RB莱比锡', toClubId: 7 }), 302);
    const term = withId(row({ type: 'termination', fromClubName: '拜仁慕尼黑', fromClubId: 3 }), 303);
    const rc = withId(row({ type: 'rc_change', fromClubName: '巴塞罗那', fromClubId: 4, toClubName: '巴塞罗那', toClubId: 4 }), 304);
    const stay = withId(row({ type: 'match', fromClubName: '巴塞罗那', fromClubId: 4, toClubName: '巴塞罗那', toClubId: 4 }), 305);
    const report = row({
      report: { listingId: 55, listingStatus: 'active', askPrice: 3, proofKey: 'k.png', activatorClubName: '巴黎圣日耳曼', activatorClubId: 6 },
    });
    renderReviews([faCpu, faFree, term, rc, stay, report]);
    await screen.findByText('激活举报');

    // 海捞（CPU 原队）：签入方 +（签入）+ 第二行「原队 佛罗伦萨」，两端各挂一个 IdTag
    const cpuTd = clubTdOf(301);
    expect(cpuTd.textContent).toContain('RB莱比锡 #7（签入）');
    expect(cpuTd.textContent).toContain('原队 佛罗伦萨 #5');
    expect(within(cpuTd).getAllByRole('button')).toHaveLength(2);

    // 海捞（真自由身）：没有原队行，只有签入方一个 IdTag
    const freeTd = clubTdOf(302);
    expect(freeTd.textContent).toContain('RB莱比锡 #7（签入）');
    expect(freeTd.textContent).not.toContain('原队');
    expect(within(freeTd).getAllByRole('button')).toHaveLength(1);

    // 解约 / 续约 / 留队：单端 + 角色小字
    expect(clubTdOf(303).textContent).toContain('拜仁慕尼黑 #3（解约）');
    expect(clubTdOf(304).textContent).toContain('巴塞罗那 #4（续约）');
    expect(clubTdOf(305).textContent).toContain('巴塞罗那 #4（留队）');

    // 激活举报行没有 review-transfer-* id，从「激活举报」徽章定位行；俱乐部格同样是第 3 个 td
    const reportTr = screen.getByText('激活举报').closest('tr');
    if (!(reportTr instanceof HTMLElement)) throw new Error('没找到激活举报行');
    const reportTd = reportTr.querySelectorAll('td')[2];
    if (!(reportTd instanceof HTMLElement)) throw new Error('激活举报行没有第 3 个 td');
    expect(reportTd.textContent).toContain('巴黎圣日耳曼 #6（激活方）');
    expect(within(reportTd).getAllByRole('button')).toHaveLength(1);
  });
});
