// @vitest-environment jsdom
// v6.40.0 签约谈判对话式，聚焦测试：
// - 报价记录表折进卡内对话流：开场系统行 / 我方报价右气泡 / 经纪人逐轮反馈左气泡 / 结果系统行
// - 两套金额口径并存：工资类两位小数（5.50m/半赛季），违约金与成交价走整数（9m / 12.5m）
// - 气泡与系统行时间到秒；老行没 feedback 时只留我方那条气泡（不假装有反馈）
// - 工资实时档位四态：空输入不显示 / 本地不合规只给提示且**不发请求** / 等回话「正在掂量…」/ 档位胶囊（带谈崩风险后缀）
// - 预览请求失败整行不显示（静默：预览不该拦住出价）
// - 两步动作仍在流底部：定违约金 POST /:transferId/release-fee、报价 POST /:sessionId/offer、训练营两段式
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NegotiationSession } from '../../../lib/api.ts';
import NegotiationsSection from './NegotiationsSection.tsx';

const { apiMock, apiPostMock, authMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn(), authMock: vi.fn() }));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: apiPostMock };
});
vi.mock('../../../lib/auth.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/auth.tsx')>();
  return { ...mod, useAuth: authMock };
});

authMock.mockReturnValue({ user: { id: 1, name: '教练甲', role: 'coach' }, authMode: 'shared', authHome: null });

const ME_CLUB = {
  club: { id: 1, name: '阿森纳', leagueTier: 'premier', logoKey: null, status: 'normal' },
  balance: 100,
  squadCount: 3,
  window: { season: 9, windowSeq: 1 },
  home: null,
};

function negoSession(patch: Partial<NegotiationSession> = {}): NegotiationSession {
  return {
    id: 21,
    transferId: 31,
    status: 'active',
    transfer: { type: 'transfer', status: 'pending_review', fee: 12.5 },
    fromClubName: '阿森纳',
    toClubName: '巴塞罗那',
    player: { id: 7, fcId: 100007, name: '中场丙', position: 'CM', age: 24, ca: 74, pa: 82 },
    agentTier: 2,
    agentTierLabel: '二级经纪人',
    releaseFee: null,
    rcBounds: [4, 8],
    expectedWage: 5.5,
    attemptsUsed: 0,
    remaining: 3,
    expiresAt: null,
    lastSatisfaction: null,
    lastRisk: false,
    attempts: [],
    settled: null,
    ...patch,
  };
}

/** 违约金已定 + 打过一轮没谈拢：对话流里应有 1 条右气泡 + 1 条左气泡 */
const WAGE_ROUND: Partial<NegotiationSession> = {
  id: 22,
  transferId: 32,
  releaseFee: 9,
  rcBounds: [6, 12],
  attemptsUsed: 1,
  remaining: 2,
  lastSatisfaction: '😐 经纪人不太满意（报价过低，有谈崩风险）',
  lastRisk: true,
  attempts: [
    {
      attemptNo: 1,
      offeredWage: 5,
      result: 'fail',
      at: '2026-09-20T11:00:00.000Z',
      feedback: '😐 经纪人不太满意（报价过低，有谈崩风险）',
    },
  ],
};

function renderNego(sessions: NegotiationSession[]) {
  apiMock.mockImplementation((path: string) => {
    if (path === '/api/me/club') return Promise.resolve(ME_CLUB);
    if (path === '/api/negotiations?mine=1') return Promise.resolve({ sessions });
    // v6.54.0：页签顶部多了「球员要求」分组——本文件只测签约谈判，收件箱一律空
    if (path === '/api/club/contract-demands')
      return Promise.resolve({
        active: [],
        accepted: [],
        recent: [],
        wageContext: { currentTotal: null, pendingDelta: null, wageCap: null },
      });
    if (path === '/api/club/transfer-requests') return Promise.resolve({ requests: [] });
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/market/desk']}>
        <NegotiationsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 输工资并等防抖（350ms）过去；等什么由调用方按态断言 */
async function typeWage(value: string) {
  fireEvent.change(screen.getByLabelText('工资报价（m/半赛季）'), { target: { value } });
}

beforeEach(() => {
  apiPostMock.mockReset();
  apiPostMock.mockImplementation(() => Promise.resolve({ ok: true }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('v6.40.0 签约谈判对话流（NegotiationsSection）', () => {
  it('第一步：开场系统行 + 只有定违约金表单，没有工资报价框', async () => {
    renderNego([negoSession({})]);
    expect(await screen.findByText(/谈判会话开启：先定新违约金/)).toBeTruthy();
    expect(screen.queryByLabelText('工资报价（m/半赛季）')).toBeNull();
    expect(document.querySelector('.nego-b')).toBeNull(); // 还没谈过：一条气泡都没有
  });

  it('第一步提交：POST /:transferId/release-fee，toast 带整数违约金与两位小数预期工资', async () => {
    renderNego([negoSession({})]);
    apiPostMock.mockResolvedValue({ ok: true, releaseFee: 9, expectedWage: 5.5 });
    fireEvent.change(await screen.findByLabelText('新违约金（m）'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: '定违约金，出预期工资' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/negotiations/31/release-fee', { fee: 9 }));
    expect(await screen.findByText('违约金定为 9m。经纪人预期工资 5.50m/半赛季，开谈吧。')).toBeTruthy();
  });

  it('工资回合：违约金与预期工资进系统行，我方报价在右、经纪人反馈在左，报价记录表已折进对话流', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    expect(await screen.findByText(/违约金定为/)).toBeTruthy();

    const sys = Array.from(document.querySelectorAll('.nego-sys')).map((el) => el.textContent ?? '');
    expect(sys.some((t) => t.includes('9m') && t.includes('5.50m/半赛季'))).toBe(true);
    expect(sys.some((t) => t.includes('.00m') === false && t.includes('违约金定为 9m'))).toBe(true);

    const me = document.querySelectorAll('.nego-b.me');
    const them = document.querySelectorAll('.nego-b.them');
    expect(me.length).toBe(1);
    expect(them.length).toBe(1);
    expect(me[0].textContent).toContain('第 1 轮工资报价');
    expect(me[0].textContent).toContain('5.00m/半赛季'); // 工资两位小数
    expect(them[0].textContent).toContain('😐 经纪人不太满意（报价过低，有谈崩风险）');
    expect(document.querySelectorAll('table').length).toBe(0); // 报价记录表没了
  });

  it('气泡与系统行时间到秒（YYYY-MM-DD HH:MM:SS）', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    const stamp = await waitFor(() => {
      const el = document.querySelector('.nego-b-at');
      if (!el) throw new Error('还没有气泡时间');
      return el.textContent ?? '';
    });
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('老行没有 feedback（0066 之前的记录）：只留我方那条气泡', async () => {
    renderNego([
      negoSession({
        ...WAGE_ROUND,
        lastSatisfaction: null,
        lastRisk: false,
        attempts: [{ attemptNo: 1, offeredWage: 5, result: 'fail', at: '2026-09-20T11:00:00.000Z', feedback: null }],
      }),
    ]);
    await screen.findByText(/违约金定为/);
    expect(document.querySelectorAll('.nego-b.me').length).toBe(1);
    expect(document.querySelectorAll('.nego-b.them').length).toBe(0);
  });

  it('结果系统行：成 / 直败 各带自己的句子（fail 不写系统行，左气泡就是那一轮的回应）', async () => {
    renderNego([
      negoSession({
        ...WAGE_ROUND,
        attempts: [
          { attemptNo: 1, offeredWage: 4, result: 'fail', at: '2026-09-20T11:00:00.000Z', feedback: '😐 经纪人不太满意' },
          { attemptNo: 2, offeredWage: 6, result: 'direct_fail', at: '2026-09-20T12:00:00.000Z', feedback: '😠 经纪人很不满意（报价过低，有谈崩风险）' },
        ],
      }),
    ]);
    const sys = Array.from(await screen.findAllByText(/直败 ·/)).map((el) => el.textContent ?? '');
    expect(sys.some((t) => t.includes('报价过低，谈判直接失败，已按该次预期工资结算'))).toBe(true);
    const all = Array.from(document.querySelectorAll('.nego-sys')).map((el) => el.textContent ?? '');
    expect(all.filter((t) => t.includes('未成')).length).toBe(0);
  });

  it('结算句走 settled.message（成约后刷新前的那一帧也要看得见）', async () => {
    renderNego([
      negoSession({ ...WAGE_ROUND, settled: { wage: 6.25, source: 'negotiation', message: '报价被经纪人接受，按你的报价签约' } }),
    ]);
    expect(await screen.findByText('报价被经纪人接受，按你的报价签约')).toBeTruthy();
  });

  it('金额口径：成交价与违约金走整数（12.5m / 9m），训练营按钮 0.75m 与违约金 5m', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    const card = (await screen.findByText(/违约金定为/)).closest('section.card') as HTMLElement;
    expect(card.textContent).toContain('成交价 12.5m');
    expect(card.textContent).not.toContain('12.50m');
    expect(screen.getByRole('button', { name: '直接签训练营（0.75m / 违约金 5m）' })).toBeTruthy();
  });

  it('档位四态①：没输工资时整行不显示', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    await screen.findByText(/违约金定为/);
    expect(document.querySelector('.live-row')).toBeNull();
  });

  it('档位四态②：本地不合规只给提示句，不发预览请求', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    await screen.findByText(/违约金定为/);
    await typeWage('4'); // 上一次报价 5，必须抬高
    expect(await screen.findByText('必须高于上一次报价 5.00m。')).toBeTruthy();
    expect(document.querySelector('.live-row')?.textContent).toContain('报价提示');
    expect(document.querySelector('.live-pill')).toBeNull();
    await new Promise((r) => setTimeout(r, 450)); // 防抖窗过去也不该发
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('档位四态③④：合规工资问一次预览并上档位胶囊（含风险后缀与配色类）', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    await screen.findByText(/违约金定为/);
    apiPostMock.mockImplementation((path: string) => {
      if (path === '/api/negotiations/22/preview') return Promise.resolve({ forecast: '成功率很低', risk: true });
      return Promise.resolve({ ok: true });
    });
    await typeWage('6');
    const pill = await screen.findByText(/成功率很低/, {}, { timeout: 3000 });
    expect(pill.className).toContain('is-vlow');
    expect(pill.textContent).toBe('成功率很低（有谈崩风险）');
    expect(apiPostMock).toHaveBeenCalledWith('/api/negotiations/22/preview', { wage: 6 });
    // 档位只上胶囊，不改写事后满意度句（两套词各表各的）
    expect(document.body.textContent).toContain('😐 经纪人不太满意');
  });

  it('预览失败静默：整行不显示，报价按钮照旧可点', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    await screen.findByText(/违约金定为/);
    apiPostMock.mockImplementation((path: string) => {
      if (path === '/api/negotiations/22/preview') return Promise.reject(new Error('预览挂了'));
      return Promise.resolve({ ok: true });
    });
    await typeWage('6');
    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelector('.live-row')).toBeNull();
    expect((screen.getByRole('button', { name: /报价（剩 2 轮）/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('工资报价：POST /:sessionId/offer，没谈拢时按风险染色提示', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    await screen.findByText(/违约金定为/);
    apiPostMock.mockResolvedValue({
      result: 'fail',
      attemptNo: 2,
      remaining: 1,
      satisfaction: '😐 经纪人不太满意',
      risk: true,
    });
    await typeWage('6');
    fireEvent.click(screen.getByRole('button', { name: /报价（剩 2 轮）/ }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/negotiations/22/offer', { wage: 6 }));
    expect(await screen.findByText(/第 2 轮没谈拢，还剩 1 轮/)).toBeTruthy();
  });

  it('训练营两段式：点第一下不签约，确认后才 POST trainee', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    await screen.findByText(/违约金定为/);
    fireEvent.click(screen.getByRole('button', { name: '直接签训练营（0.75m / 违约金 5m）' }));
    expect(apiPostMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认：按 0.75m / 5m 签进训练营' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/negotiations/22/trainee', {}));
  });

  it('没有进行中的谈判时给引导，不渲染任何卡片', async () => {
    renderNego([]);
    expect(await screen.findByText(/现在没有进行中的谈判/)).toBeTruthy();
    expect(document.querySelector('#desk-nego section.card')).toBeNull();
  });
});

// v6.65.2：每条会话可折叠（B 交互 + C 信息密度）。折叠是视图态——正文 hidden 而不卸载，
// 已填的工资草稿必须活过一轮收起/展开。
describe('v6.65.2 谈判卡折叠', () => {
  const FOLD_KEY = 'whl-nego-fold-v1';
  const SEEN_KEY = 'whl-nego-seen-v1';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function foldButtons() {
    return screen.getAllByRole('button', { name: /(展开|收起)谈判详情/ }) as HTMLButtonElement[];
  }

  it('两条以上默认全收起：正文隐藏，chevron 均 aria-expanded=false', async () => {
    renderNego([negoSession({}), negoSession(WAGE_ROUND)]);
    await screen.findAllByText('中场丙');
    // 正文仍在 DOM 里（输入态要活着），但整块带 hidden
    expect(document.querySelectorAll('.nego-body').length).toBe(2);
    expect(document.querySelectorAll('.nego-body:not([hidden])').length).toBe(0);
    const buttons = foldButtons();
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('点 chevron 展开该条：aria-expanded 翻真，正文显示', async () => {
    renderNego([negoSession({}), negoSession(WAGE_ROUND)]);
    await screen.findAllByText('中场丙');
    fireEvent.click(foldButtons()[0]);
    expect(foldButtons()[0].getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.nego-body:not([hidden])').length).toBe(1);
  });

  it('点卡头非交互区也能切换；点 chevron 只翻一次（不因冒泡翻两次）', async () => {
    renderNego([negoSession({}), negoSession(WAGE_ROUND)]);
    const name = (await screen.findAllByText('中场丙'))[0];
    fireEvent.click(name.closest('h3')!); // 卡头空白区（h3 自身，非链接/按钮）
    expect(foldButtons()[0].getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(foldButtons()[0]);
    expect(foldButtons()[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('收起再展开：已填的工资草稿还在（正文用 hidden 没被卸载）', async () => {
    renderNego([negoSession(WAGE_ROUND)]);
    const input = (await screen.findByLabelText('工资报价（m/半赛季）')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5.5' } });
    fireEvent.click(foldButtons()[0]);
    expect(foldButtons()[0].getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(foldButtons()[0]);
    const again = screen.getByLabelText('工资报价（m/半赛季）') as HTMLInputElement;
    expect(again.value).toBe('5.5');
  });

  it('localStorage 记的 closed 优先于默认值，且已回流的会话键会被裁掉', async () => {
    localStorage.setItem(FOLD_KEY, JSON.stringify({ '21': 'closed', '999': 'closed' }));
    renderNego([negoSession({})]); // 单条，但本地记了收起
    await screen.findByText('中场丙');
    expect(foldButtons()[0].getAttribute('aria-expanded')).toBe('false');
    const stored = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as Record<string, string>;
    expect(stored['999']).toBeUndefined();
  });

  it('摘要行三段常驻；末轮反馈晚于最后展开时间时提示「有新反馈」', async () => {
    localStorage.setItem(FOLD_KEY, JSON.stringify({ '22': 'closed' }));
    localStorage.setItem(SEEN_KEY, JSON.stringify({ '22': '2026-09-19T00:00:00.000Z' }));
    renderNego([negoSession(WAGE_ROUND), negoSession({})]);
    await screen.findAllByText('中场丙');
    const sums = Array.from(document.querySelectorAll('.nego-sum')).map((el) => el.textContent ?? '');
    const fresh = sums.find((t) => t.includes('有新反馈'));
    expect(fresh).toBeTruthy();
    const text = fresh ?? '';
    expect(text).toContain('上次报价');
    expect(text).toContain('预期工资');
    expect(text).toContain('静默还剩');
  });
});
