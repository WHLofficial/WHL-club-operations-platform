// @vitest-environment jsdom
// v6.54.0 步骤 6 · 转会台「球员要求」分组（DemandSection）聚焦测试：
// - 五态同屏：新要求 / 谈判中 / 已接受待生效 / 已拒绝（明确放人 / 没谈成）/ 已过期
// - 分组头：处理中计数 + wageContext 胶囊（当前 · 待生效）
// - 深链 ?tab=negotiations&demand=<id>：目标卡高亮（.is-target），落在过期折叠里也自动展开
// - 卡内还价：低于「他的底线」送出置灰 + 红字，且**不发**档位预览；区间内 350ms 防抖后出四档词；送出即时判定
// - 接受两段式：数字行齐备；projected 超帽时渲染警示并把按钮降为「仍然接受」
// - 明确放人两段式：三件套后果句 + 二次按钮
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractDemandCard, DemandWageContext } from '../../../lib/api.ts';
import DemandSection from './DemandSection.tsx';

const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: apiPostMock };
});

const WAGE_CONTEXT: DemandWageContext = { currentTotal: 66.6, pendingDelta: 1.5, wageCap: 68 };

function demand(patch: Partial<ContractDemandCard> = {}): ContractDemandCard {
  return {
    id: 1,
    playerId: 7,
    playerName: '张三',
    position: 'ST',
    age: 24,
    ca: 178,
    season: 9,
    windowSeq: 1,
    status: 'pending',
    resolution: null,
    currentWage: 2.5,
    targetWage: 3.7,
    floorWage: 3.33,
    raisePct: 0.48,
    rcCurrent: 20,
    rcFloor: 25,
    round: 0,
    maxRounds: 3,
    expiresAt: '2026-10-27T06:00:00.000Z',
    createdAt: '2026-10-24T07:02:11.000Z',
    resolvedAt: null,
    appliedAt: null,
    attempts: [],
    ...patch,
  };
}

function inbox(over: {
  active?: ContractDemandCard[];
  accepted?: ContractDemandCard[];
  recent?: ContractDemandCard[];
  wageContext?: DemandWageContext;
} = {}) {
  return {
    active: over.active ?? [],
    accepted: over.accepted ?? [],
    recent: over.recent ?? [],
    wageContext: over.wageContext ?? WAGE_CONTEXT,
  };
}

function renderDemand(data: ReturnType<typeof inbox>, entry = '/market/desk?tab=negotiations') {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/club/contract-demands') return Promise.resolve(data);
    if (path === '/api/club/transfer-requests') return Promise.resolve({ requests: [] });
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <DemandSection isCoach />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiPostMock.mockReset();
  apiPostMock.mockImplementation(() => Promise.resolve({ ok: true }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('v6.54.0 球员要求 · 五态与分组头（DemandSection）', () => {
  it('五态同屏：新要求 / 谈判中 / 已接受 / 明确放人 / 没谈成；分组头带计数与 wageContext 胶囊', async () => {
    const { container } = renderDemand(
      inbox({
        active: [
          demand({}),
          demand({
            id: 2,
            playerId: 8,
            playerName: '李四',
            position: 'LW',
            round: 1,
            attempts: [{ round: 1, wage: 3.5, accepted: false, at: '2026-10-24T07:20:03.000Z' }],
          }),
        ],
        accepted: [
          demand({ id: 3, playerId: 9, playerName: '王五', status: 'accepted', resolution: 'accepted', resolvedAt: '2026-10-24T08:10:00.000Z' }),
        ],
        recent: [
          demand({
            id: 4,
            playerId: 10,
            playerName: '赵六',
            status: 'rejected',
            resolution: 'direct',
            resolvedAt: '2026-10-24T04:30:00.000Z',
          }),
          demand({ id: 5, playerId: 11, playerName: '孙七', status: 'rejected', resolution: 'collapse' }),
          demand({ id: 6, playerId: 12, playerName: '周八', status: 'expired', resolution: 'expired' }),
        ],
      }),
    );

    expect(await screen.findByText('球员要求')).toBeTruthy();
    // 分组头：处理中 2 条 + 当前/待生效口径
    const pill = container.querySelector('.demand-pill')!;
    expect(pill.textContent).toContain('当前');
    expect(pill.textContent).toContain('66.60');
    expect(pill.textContent).toContain('+1.50');
    expect(container.querySelector('.demand-group-head .badge')!.textContent).toBe('2');

    // 新要求：轮次徽标 + 三个动作键
    expect(screen.getByText('第 1/3 轮 · 剩 3 轮')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^按 3\.70 接受$/ }).length).toBeGreaterThan(0);
    // 谈判中：上一轮还价与他的当场回应进对话流
    expect(screen.getByText(/第 1 次还价/)).toBeTruthy();
    expect(screen.getByText('没谈拢，还差得远。再往上谈谈？')).toBeTruthy();
    expect(screen.getByText('第 2/3 轮 · 剩 2 轮')).toBeTruthy();

    // 已接受：关窗后生效 + 双版本合同入口
    expect(screen.getByText(/已接受 · 关窗后生效/)).toBeTruthy();
    // 明确放人：三件套；没谈成：申请挂着
    expect(screen.getByText(/已放行 · 关窗起/)).toBeTruthy();
    expect(screen.getByText(/转会申请挂着/)).toBeTruthy();
    // 已过期：尾部弱化行
    expect(screen.getByText(/这个窗口没有谈成/)).toBeTruthy();
  });

  it('空态：分组头不渲染，只留一句话', async () => {
    const { container } = renderDemand(inbox());
    expect(await screen.findByText('这个窗口没有球员提出要求。')).toBeTruthy();
    expect(container.querySelector('.demand-group-head')).toBeNull();
  });

  it('深链 ?demand=<id> 高亮目标卡', async () => {
    const { container } = renderDemand(
      inbox({ active: [demand({}), demand({ id: 2, playerId: 8, playerName: '李四' })] }),
      '/market/desk?tab=negotiations&demand=2',
    );
    await screen.findByText('球员要求');
    expect(container.querySelector('[data-demand-id="2"]')!.className).toContain('is-target');
    expect(container.querySelector('[data-demand-id="1"]')!.className).not.toContain('is-target');
  });
});

describe('v6.54.0 球员要求 · 卡内还价（DemandSection）', () => {
  it('低于他的底线：送出置灰 + 红字防呆，且不发档位预览', async () => {
    renderDemand(inbox({ active: [demand({})] }));
    fireEvent.click(await screen.findByRole('button', { name: '还价' }));
    const input = screen.getByLabelText('还价工资（m/窗）');
    fireEvent.change(input, { target: { value: '3.10' } });

    expect(screen.getByRole('button', { name: '送出还价' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/低于 3\.33 他会视为拒绝整条要求并提交转会申请/)).toBeTruthy();
    expect(screen.getByText('低于他的底线，等于拒绝整条要求。')).toBeTruthy();

    // 等过防抖窗口，确认没有发预览请求（本地拦住了）
    await new Promise((r) => setTimeout(r, 420));
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('区间内：350ms 防抖后出档位；送出 POST counter 并 toast 即时判定', async () => {
    renderDemand(inbox({ active: [demand({})] }));
    apiPostMock.mockImplementation((path: string) => {
      if (path === '/api/club/contract-demands/1/preview') return Promise.resolve({ forecast: '成功率过半', risk: false });
      if (path === '/api/club/contract-demands/1/counter')
        return Promise.resolve({
          demandId: 1,
          verdict: 'negotiating',
          source: null,
          acceptedWage: null,
          round: 1,
          eff: 3.7,
          p: 0.6,
          escalated: false,
        });
      return Promise.resolve({ ok: true });
    });

    fireEvent.click(await screen.findByRole('button', { name: '还价' }));
    fireEvent.change(screen.getByLabelText('还价工资（m/窗）'), { target: { value: '3.5' } });

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/club/contract-demands/1/preview', { wage: 3.5 }),
    );
    expect(await screen.findByText('成功率过半')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '送出还价' }));
    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/club/contract-demands/1/counter', { wage: 3.5 }),
    );
    expect(await screen.findByText('第 1 次还价没谈成，还剩 2 轮。')).toBeTruthy();
    // 送出成功即收起输入区（判定结果进对话流，不留悬空表单）
    expect(screen.queryByLabelText('还价工资（m/窗）')).toBeNull();
  });

  it('填到他的要价：本地提示直接成交，不发预览', async () => {
    renderDemand(inbox({ active: [demand({})] }));
    fireEvent.click(await screen.findByRole('button', { name: '还价' }));
    fireEvent.change(screen.getByLabelText('还价工资（m/窗）'), { target: { value: '3.70' } });
    expect(screen.getByText('等于他的要价，会直接成交。')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 420));
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe('v6.54.0 球员要求 · 接受与明确放人（DemandSection）', () => {
  it('接受两段式：工资/每赛季/违约金/费用/生效齐备；超帽时警示并把按钮降为「仍然接受」', async () => {
    renderDemand(inbox({ active: [demand({})], wageContext: WAGE_CONTEXT }));
    fireEvent.click(await screen.findByRole('button', { name: '按 3.70 接受' }));

    expect(screen.getByText('接受他的要求？')).toBeTruthy();
    // 数字行整体断言（避免「2.50」同时命中开场气泡）
    const rows = document.querySelector('.demand-rows')!.textContent ?? '';
    expect(rows).toContain('2.50');
    expect(rows).toContain('3.70');
    // 每赛季 = 2 × (3.70 − 2.50) = 2.40
    expect(rows).toContain('+2.40m');
    // 66.60 + 1.50 + 1.20 = 69.30，帽 68.00 ⇒ 超 1.30
    expect(screen.getByText(/超工资帽 1\.30m/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: '仍然接受' });

    apiPostMock.mockResolvedValue({ demandId: 1, wage: 3.7, releaseFee: 25 });
    fireEvent.click(confirm);
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/club/contract-demands/1/accept', {}));
    expect(await screen.findByText('已接受；新合同在窗口关闭后生效。')).toBeTruthy();
  });

  it('未超帽不渲染警示行，按钮是「确认接受」', async () => {
    renderDemand(
      inbox({
        active: [demand({})],
        wageContext: { currentTotal: 50, pendingDelta: 0, wageCap: 68 },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: '按 3.70 接受' }));
    expect(screen.queryByText(/超工资帽/)).toBeNull();
    expect(screen.getByRole('button', { name: '确认接受' })).toBeTruthy();
  });

  it('明确放人两段式：三件套后果句 + 二次点击才发请求', async () => {
    renderDemand(inbox({ active: [demand({})] }));
    fireEvent.click(await screen.findByRole('button', { name: '拒绝' }));

    expect(screen.getByText('明确放他走？')).toBeTruthy();
    expect(screen.getByText(/保护期结束/)).toBeTruthy();
    expect(screen.getByText(/全联盟会收到通告/)).toBeTruthy();
    // 静止期不得发请求——两段式的意义就在这
    expect(apiPostMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '明确放人' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/club/contract-demands/1/reject', {}));
    expect(await screen.findByText('已明确放人。关窗起他的保护期结束，全联盟会收到通告。')).toBeTruthy();
  });
});

describe('v6.54.0 球员要求 · 过期折叠（DemandSection）', () => {
  const expired4 = [6, 7, 8, 9].map((id) =>
    demand({
      id,
      playerId: 100 + id,
      playerName: `过期${id}`,
      position: null,
      status: 'expired',
      resolution: 'expired',
    }),
  );

  it('超过 2 条过期：先展示 2 条，其余折叠成计数行，点开全出', async () => {
    renderDemand(inbox({ recent: expired4 }));
    await screen.findByText('球员要求');
    expect(screen.getByText('过期6')).toBeTruthy();
    expect(screen.getByText('过期7')).toBeTruthy();
    expect(screen.queryByText('过期8')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /还有 2 条没谈成（过期）· 展开/ }));
    expect(screen.getByText('过期8')).toBeTruthy();
    expect(screen.getByText('过期9')).toBeTruthy();
  });

  it('深链落在折叠里的过期卡：自动展开并高亮', async () => {
    const { container } = renderDemand(inbox({ recent: expired4 }), '/market/desk?tab=negotiations&demand=9');
    await screen.findByText('球员要求');
    expect(screen.getByText('过期9')).toBeTruthy();
    expect(container.querySelector('[data-demand-id="9"]')!.className).toContain('is-target');
  });
});
