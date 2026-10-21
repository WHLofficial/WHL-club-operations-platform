// @vitest-environment jsdom
// v6.53.0 场馆经营 P0：档期页（/venue）。
// 本文件锁的是「前端不自己算」的几条边界：槽数取服务端 slotCount、单档数字取 quote、
// 整窗合计取 preview、保存只发改动槽、失败保留草稿、无窗不得保存。数字全部由夹具给出。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth.tsx';
import { resetOpsSchedule } from '../../lib/ops-gate.ts';
import {
  ApiError,
  type VenuePlanResponse,
  type VenuePolicyChoice,
  type VenuePreviewResponse,
  type VenueTotals,
} from '../../lib/api.ts';
import VenuePlanPage from './VenuePlanPage.tsx';

const { apiMock, postMock, putMock } = vi.hoisted(() => ({ apiMock: vi.fn(), postMock: vi.fn(), putMock: vi.fn() }));

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  // 保留真实 ApiError（页面用 instanceof 判断），只把三个网络入口换掉
  return { ...mod, api: apiMock, apiPost: postMock, apiPut: putMock, apiDelete: vi.fn() };
});

const TOTALS: VenueTotals = { gross: 12.345, opsCost: 1.234, expectedDamage: 0.5, expectedNet: 10.611, attendanceMod: 1.15, reputationGain: 3 };

const PREVIEW: VenuePreviewResponse = { slots: [], totals: TOTALS, unlockReasons: {} };

/** 5 项可排 + 1 项 idle（页面应把 idle 滤掉，只渲染 5 张卡） */
const ACTIVITIES: VenuePlanResponse['activities'] = [
  { key: 'youth_camp', name: '青训营', blurb: '带小球员踢一场', unlocked: true, requirements: [] },
  { key: 'concert', name: '演唱会', blurb: '搭台唱一晚', unlocked: true, requirements: [] },
  { key: 'community', name: '社区日', blurb: '免费开放一天', unlocked: true, requirements: [] },
  {
    key: 'esports',
    name: '电竞比赛',
    blurb: '转播吃席',
    unlocked: false,
    requirements: [{ label: '转播设施', need: 2, current: 1 }],
  },
  { key: 'friendly', name: '友谊赛', blurb: '约个对手热身', unlocked: true, requirements: [] },
  { key: 'idle', name: '空置', blurb: '不排', unlocked: true, requirements: [] },
];

function makePlan(over: Partial<VenuePlanResponse> = {}): VenuePlanResponse {
  const slotCount = over.slotCount ?? 3;
  const rec = (policy: string): VenuePlanResponse['recommendations'][VenuePolicyChoice] => ({
    policy,
    picks: Array.from({ length: slotCount }, (_, i) => ({ slotNo: i + 1, activity: 'concert' })),
    totals: TOTALS,
  });
  return {
    clubId: 1,
    window: {
      status: 'open',
      season: 3,
      windowSeq: 2,
      openedAt: '2026-07-01T00:00:00Z',
      closesAt: '2026-07-20T00:00:00Z',
      reminderSent: false,
    },
    capacity: 22000,
    hasStadium: true,
    slotCount,
    slotCap: 4,
    reputation: 12,
    attendance: { mod: 1, matchesLeft: 0, clamp: [0.5, 2] },
    facilities: [
      { key: 'broadcast', label: '转播', level: 2 },
      { key: 'youth', label: '青训', level: 1 },
      { key: 'commercial', label: '商业', level: 0 },
    ],
    activities: ACTIVITIES,
    slots: Array.from({ length: slotCount }, (_, i) => ({
      slotNo: i + 1,
      saturation: 1,
      booked: null,
      quote: null,
      options: [],
    })),
    policy: null,
    recommendations: { money: rec('多排演唱会'), fans: rec('多排青训营'), reputation: rec('多排社区日') },
    bookings: [],
    configWarning: null,
    ...over,
  };
}

function renderPage(plan: VenuePlanResponse, opts: { preview?: () => Promise<unknown>; save?: () => Promise<unknown> } = {}) {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/me') return Promise.resolve({ user: { id: 1, name: '测试教练', role: 'coach' }, authMode: 'shared', authHome: null });
    if (path === '/api/me/club') return Promise.resolve({ club: { id: 1, name: '我的俱乐部' }, balance: 120.5 });
    if (path === '/api/club/venue-plan') return Promise.resolve(plan);
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
  postMock.mockImplementation(opts.preview ?? (() => Promise.resolve(PREVIEW)));
  putMock.mockImplementation(opts.save ?? (() => Promise.resolve({ slots: [], policy: null, totals: TOTALS })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/venue']}>
          <VenuePlanPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const saveBtn = () => screen.getByRole('button', { name: '保存档期' }) as HTMLButtonElement;
const tableSelects = () => screen.getAllByRole('combobox') as HTMLSelectElement[];

beforeEach(() => {
  // 运营时刻表有 60s 模块级缓存，跨用例必须清，否则第二条用例读的是上一条的 snapshot
  resetOpsSchedule();
});

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  postMock.mockReset();
  putMock.mockReset();
});

describe('v6.53.0 档期页：档位由服务端给', () => {
  it('渲染 3 档、三张方针卡、5 张活动卡（idle 不展示）', async () => {
    const { container } = renderPage(makePlan());

    await screen.findByText('第 1 档');
    expect(container.querySelectorAll('.vop-slot')).toHaveLength(3);
    expect(container.querySelectorAll('.vop-policy')).toHaveLength(3);
    expect(container.querySelectorAll('.vop-act')).toHaveLength(5);
  });

  it.each([
    [2, 12000],
    [3, 17000],
    [3, 22000],
    [4, 35000],
  ])('slots.length=%i、容量 %i 的夹具渲染出同样多的档位', async (slotCount, capacity) => {
    const { container } = renderPage(makePlan({ slotCount, capacity }));

    await screen.findByText('第 1 档');
    expect(container.querySelectorAll('.vop-slot')).toHaveLength(slotCount);
    // 容量来自服务端（本窗可能只有 2 档），前端不得按容量自行推算档数
    expect(document.body.textContent).toContain(`${capacity.toLocaleString('zh-CN')} 座`);
  });

  it('hasStadium=false 时标注「未建球场，按 2 档试排」', async () => {
    renderPage(makePlan({ hasStadium: false, capacity: 0, slotCount: 2 }));

    expect(await screen.findByText('未建球场，按 2 档试排')).toBeTruthy();
  });
});

describe('v6.53.0 档期页：未解锁项', () => {
  it('下拉里未解锁的活动 disabled 且标「（未解锁）」，活动卡 title 给出差什么', async () => {
    renderPage(makePlan());
    await screen.findByText('第 1 档');

    const option = Array.from(tableSelects()[0].options).find((o) => o.textContent?.startsWith('电竞比赛'));
    expect(option).toBeTruthy();
    expect(option?.disabled).toBe(true);
    expect(option?.textContent).toContain('（未解锁）');

    const card = screen.getByRole('button', { name: /电竞比赛/ });
    expect(card.getAttribute('title')).toBe('转播设施 1/2');
    expect(card.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('v6.53.0 档期页：保存', () => {
  it('无窗时保存按钮 disabled，title 说明是「没有进行中的转会窗」而不是「没有改动」', async () => {
    renderPage(makePlan({ window: null }));

    const btn = await screen.findByRole('button', { name: '保存档期' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    expect(btn.getAttribute('title')).toContain('当前没有进行中的转会窗');
    expect(document.body.textContent).toContain('当前没有进行中的转会窗，可以先试排');
  });

  it('只改一档时 apiPut 只发这一档', async () => {
    renderPage(makePlan());
    await screen.findByText('第 1 档');

    fireEvent.change(tableSelects()[1], { target: { value: 'concert' } });
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    fireEvent.click(saveBtn());

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock.mock.calls[0][0]).toBe('/api/club/venue-plan');
    expect(putMock.mock.calls[0][1]).toEqual({ slots: [{ slotNo: 2, activity: 'concert' }] });
    // 保存成功给反馈，且草稿清空（按钮回到「还没有改动」）
    expect(await screen.findByText('档期已保存')).toBeTruthy();
    await waitFor(() => expect(saveBtn().disabled).toBe(true));
  });

  it('保存失败保留草稿，并把服务端文案落到页内', async () => {
    renderPage(makePlan());
    await screen.findByText('第 1 档');

    fireEvent.change(tableSelects()[0], { target: { value: 'concert' } });
    putMock.mockRejectedValueOnce(new ApiError(400, '转播设施 L2 才能排电竞'));
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    fireEvent.click(saveBtn());

    await waitFor(() => expect(document.querySelector('.vop-error')?.textContent).toContain('转播设施 L2 才能排电竞'));
    expect(tableSelects()[0].value).toBe('concert');
    expect(saveBtn().disabled).toBe(false);
  });

  it('点「按此方针排满」后保存的是全窗（槽数 = slots.length），并带上方针', async () => {
    renderPage(makePlan());
    await screen.findByText('第 1 档');

    const policyBtns = screen.getAllByRole('button', { name: '按此方针排满' });
    expect(policyBtns).toHaveLength(3);
    fireEvent.click(policyBtns[0]);
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    fireEvent.click(saveBtn());

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const body = putMock.mock.calls[0][1] as { slots: { slotNo: number; activity: string | null }[]; policy?: string };
    expect(body.slots).toHaveLength(3);
    expect(body.slots.map((s) => s.slotNo)).toEqual([1, 2, 3]);
    expect(body.policy).toBe('money');
  });
});

describe('v6.53.0 档期页：预览（整窗合计）', () => {
  it('首帧就送完整 picks，连续改两档只多发一次请求', async () => {
    renderPage(makePlan());
    await screen.findByText('第 1 档');

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(postMock.mock.calls[0][0]).toBe('/api/club/venue-plan/preview');
    const first = postMock.mock.calls[0][1] as { slots: { slotNo: number; activity: string | null }[] };
    // 预览必须送「全部槽」，否则服务端没法按同类序位算饱和
    expect(first.slots).toEqual([
      { slotNo: 1, activity: null },
      { slotNo: 2, activity: null },
      { slotNo: 3, activity: null },
    ]);

    const selects = tableSelects();
    fireEvent.change(selects[0], { target: { value: 'concert' } });
    fireEvent.change(selects[1], { target: { value: 'community' } });

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const second = postMock.mock.calls[1][1] as { slots: { slotNo: number; activity: string | null }[] };
    expect(second.slots.map((s) => s.activity)).toEqual(['concert', 'community', null]);

    // 250ms 防抖：再等一拍不应有第三次请求
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('合计取预览返回的 totals（不是逐档相加）', async () => {
    renderPage(makePlan());
    await screen.findByText('第 1 档');

    await waitFor(() => expect(document.querySelector('.vop-summary')?.textContent).toContain('10.611'));
    expect(document.querySelector('.vop-summary')?.textContent).toContain('+10.611');
  });

  it('预览失败时给提示但仍可保存', async () => {
    renderPage(makePlan(), { preview: () => Promise.reject(new Error('boom')) });

    expect(await screen.findByText('预期数字暂时算不出，保存仍可用服务端校验。')).toBeTruthy();

    fireEvent.change(tableSelects()[0], { target: { value: 'concert' } });
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
  });
});
