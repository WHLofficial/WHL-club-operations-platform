// @vitest-environment jsdom
// 收件篮组件测试（v6.40.0）：徽章 / 未读置顶 + 日期分组 / 整行跳转 / 类目页签与「本类全部已读」
// / 见过即已读（含无 IntersectionObserver 退化）。
// 用例见 docs/test-plans/v6.40.0-notification-badges.md 第四节（TC-UI-01–04、TC-CAT-01/02、TC-SEEN-01/02）。
// jsdom 不跑样式表：几何（两行卡片、≥44px、页签横滑）由 tests/mobile-baseline.test.ts 的静态门与 e2e 375 视口守。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFY_CATEGORIES, NOTIFY_META } from '../../../src/core/notify-meta.ts';
import type { NotificationItem } from '../lib/api.ts';
import { AuthProvider } from '../lib/auth.tsx';
import Notifications from './Notifications.tsx';

const { apiMock, postMock } = vi.hoisted(() => ({ apiMock: vi.fn(), postMock: vi.fn() }));
vi.mock('../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: postMock };
});

// 分组标签按「日历日」比对：正午锚点保证 今天 / 昨天 不随跑测试的钟点漂移
const NOON = new Date();
NOON.setHours(12, 0, 0, 0);
const TODAY = NOON.toISOString();

function item(patch: Partial<NotificationItem> & { id: number; template: string }): NotificationItem {
  return { clubId: 5, text: '摘要文本', ref: null, createdAt: TODAY, readAt: TODAY, ...patch };
}

let ALL: NotificationItem[] = [];
let BY_CATEGORY: Record<string, number> = {};

/** 按模板集合给出行（桩服务端只做类目过滤，真实过滤口径在 tests/notify.test.ts 的 L3 断言） */
function rowsOfCategory(cat: string): NotificationItem[] {
  const ids = new Set(NOTIFY_CATEGORIES.filter((c) => c.id === cat).flatMap((c) => [c.id]));
  return ALL.filter((n) => {
    const meta = NOTIFY_META[n.template];
    return meta ? ids.has(meta.category) : false;
  });
}

function renderPage(route = '/notifications') {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/me') return { user: { id: 1, name: '测试教练' }, authMode: 'shared' };
    if (path.startsWith('/api/notifications/unread-count')) {
      if (path.includes('by=category')) return { unread: 4, byCategory: BY_CATEGORY };
      return { unread: 4 };
    }
    if (path.startsWith('/api/notifications')) {
      const cat = /category=([a-z]+)/.exec(path)?.[1] ?? '';
      return { items: cat ? rowsOfCategory(cat) : ALL, nextCursor: null, unread: 4 };
    }
    throw new Error(`未打桩的请求：${path}`);
  });
  postMock.mockImplementation(async (path: string, body: unknown) => {
    if (path !== '/api/notifications/read') throw new Error(`未打桩的写请求：${path}`);
    return { marked: (body as { ids?: number[] }).ids?.length ?? 1 };
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Where() {
    const loc = useLocation();
    return <span data-testid="where">{`${loc.pathname}${loc.search}`}</span>;
  }
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <Where />
          <Routes>
            <Route path="/notifications" element={<Notifications />} />
            <Route path="*" element={<span data-testid="landed">已跳转</span>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** 测试用 IntersectionObserver：把实例与观察到的元素交出来，由测试手动触发「进入视口」 */
class FakeIO {
  static insts: FakeIO[] = [];
  els = new Set<Element>();
  constructor(private cb: IntersectionObserverCallback) {
    FakeIO.insts.push(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
  }
  takeRecords() {
    return [];
  }
  /** 让所有已观察到的元素「进入视口」 */
  enterAll() {
    for (const el of [...this.els]) {
      this.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
}

function installFakeIO() {
  FakeIO.insts = [];
  (globalThis as Record<string, unknown>).IntersectionObserver = FakeIO;
  return () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;
  };
}

/** 渲染后等首次数据到位（列表或空态任一出现，才说明首屏查询已落地） */
async function ready() {
  await screen.findByRole('heading', { name: /收件篮/ });
  await waitFor(() => expect(document.querySelector('.inbox-list, .empty-state')).toBeTruthy());
}

beforeEach(() => {
  ALL = [];
  BY_CATEGORY = {};
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  postMock.mockReset();
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
});

describe('收件篮 · 徽章（TC-UI-01）', () => {
  it('30 个模板各出中文 label + 类目色 + 原始模板名挂 title；未知模板退化', async () => {
    ALL = [
      ...Object.keys(NOTIFY_META).map((t, i) => item({ id: i + 1, template: t, text: `第 ${i + 1} 条` })),
      item({ id: 99, template: 'brand_new', text: '尚未纳入元数据的模板' }),
    ];
    renderPage();
    await waitFor(() => expect(screen.getAllByText('第 30 条').length).toBe(1));

    const list = document.querySelector('.inbox-rows') as HTMLElement;
    // 配色按字面量锁（不从被测常量自证：类目挪错 / 换色都要当场红）
    const TONE: Record<string, string> = {
      result: 'green',
      growth: 'gold',
      offer: 'blue',
      activation: 'sky',
      event: 'orange',
      naming: 'purple',
      shop: 'red',
      window: 'gray',
    };
    for (const [template, meta] of Object.entries(NOTIFY_META)) {
      const badge = within(list).getByTitle(template);
      expect(badge.textContent).toBe(meta.label);
      expect(badge.className).toBe(`badge ${TONE[meta.category]}`);
    }

    // 每类一枚代表对，模板 → 文案 / 配色全字面量：把模板挪到别类 ⇒ 此表红
    const SPEC: Array<[string, string, string]> = [
      ['result_confirmed', '赛果确认', 'green'],
      ['levelup', '球员成长', 'gold'],
      ['offer_received', '收到报价', 'blue'],
      ['activation_notice', '激活通知', 'sky'],
      ['event_triggered', '事件触发', 'orange'],
      ['naming_offer', '冠名报价', 'purple'],
      ['shop_order_approved', '工单通过', 'red'],
      ['window_signals', '窗口信号', 'gray'],
    ];
    for (const [template, label, tone] of SPEC) {
      const badge = within(list).getByTitle(template);
      expect(badge.textContent, `${template} 文案`).toBe(label);
      expect(badge.className, `${template} 配色`).toBe(`badge ${tone}`);
    }

    const unknown = within(list).getByTitle('brand_new');
    expect(unknown.textContent).toBe('brand_new');
    expect(unknown.className).toBe('badge');
  });
});

describe('收件篮 · 未读置顶与日期分组（TC-UI-02）', () => {
  it('未读全在前、同组按时间倒序、分隔线给 今天 / 昨天 / 以下为已读', async () => {
    const at = (msAgo: number) => new Date(NOON.getTime() - msAgo).toISOString();
    ALL = [
      // 服务端按 id 倒序（最新在前）：已读的今天行排在最前，页面必须把它压到未读之后
      item({ id: 5, template: 'result_confirmed', text: '今天已读', createdAt: at(0) }),
      item({ id: 4, template: 'levelup', text: '今天未读·晚', createdAt: at(3_600_000), readAt: null }),
      item({ id: 3, template: 'offer_received', text: '今天未读·早', createdAt: at(7_200_000), readAt: null }),
      item({ id: 2, template: 'shop_order_approved', text: '昨天未读', createdAt: at(86_400_000), readAt: null }),
      item({ id: 1, template: 'event_deadline', text: '昨天已读', createdAt: at(90_000_000) }),
    ];
    renderPage();
    await ready();

    const rows = [...document.querySelectorAll('.inbox-rows .inbox-item')];
    expect(rows.map((li) => (li as HTMLElement).dataset.notifyId)).toEqual(['4', '3', '2', '5', '1']);

    const dayHeads = [...document.querySelectorAll('.inbox-day')].map((d) => d.textContent);
    expect(dayHeads).toEqual(['今天', '昨天', '以下为已读', '今天', '昨天']);
    expect(document.querySelectorAll('.inbox-day.is-sep').length).toBe(1);
  });

  it('标已读不回改本页视觉：红点按本次加载的 readAt 留着，列表不重排', async () => {
    const undo = installFakeIO();
    try {
      ALL = [item({ id: 1, template: 'levelup', text: '未读一条', readAt: null })];
      renderPage();
      await ready();
      expect(document.querySelectorAll('.inbox-dot').length).toBe(1);

      FakeIO.insts[0].enterAll();
      await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));

      expect(document.querySelectorAll('.inbox-dot').length).toBe(1);
      expect(document.querySelector('.inbox-item')!.className).toContain('is-unread');
    } finally {
      undo();
    }
  });
});

describe('收件篮 · 整行跳转（TC-UI-03）', () => {
  it('有落点的行整行是按钮：点了落到 /market/desk?tab=offers&box=in&offer=42', async () => {
    ALL = [item({ id: 1, template: 'offer_received', text: '有报价', ref: { type: 'offer', id: 42 } })];
    renderPage();
    await ready();

    const btn = within(document.querySelector('.inbox-rows') as HTMLElement).getByRole('button', { name: /去处理：收到报价/ });
    expect(btn.className).toContain('inbox-row-btn');
    expect(within(btn).getByText('去处理 ›')).toBeTruthy();

    await userEvent.click(btn);
    expect(screen.getByTestId('where').textContent).toBe('/market/desk?tab=offers&box=in&offer=42');
  });

  it('无落点的行不可点：不渲染 button、也没有「去处理 ›」', async () => {
    ALL = [
      item({ id: 1, template: 'event_triggered', text: '事件（带 clubId 可点）', clubId: 5 }),
      item({ id: 2, template: 'event_triggered', text: '事件（无 clubId）', clubId: null }),
      item({ id: 3, template: 'brand_new', text: '未知模板' }),
    ];
    renderPage();
    await ready();

    const rows = [...document.querySelectorAll('.inbox-rows .inbox-item')];
    expect(within(rows[0] as HTMLElement).getByRole('button')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(rows[2] as HTMLElement).queryByRole('button')).toBeNull();
    expect(document.querySelectorAll('.inbox-go').length).toBe(1);
    expect(document.querySelectorAll('.inbox-item[data-notify-id="2"] .inbox-row')![0].tagName).toBe('DIV');
  });
});

describe('收件篮 · 类目页签（TC-CAT-01）', () => {
  it('页签 = 全部 + 8 类，未读数为 0 的类不显示数字，点类目写 URL ?cat= 并只渲该类', async () => {
    ALL = [
      item({ id: 1, template: 'offer_received', text: '报价一条', ref: { type: 'offer', id: 7 } }),
      item({ id: 2, template: 'shop_order_approved', text: '工单一条' }),
    ];
    BY_CATEGORY = { offer: 2 };
    renderPage();
    await ready();

    const tabs = document.querySelector('.seg.inbox-tabs') as HTMLElement;
    expect(within(tabs).getAllByRole('button').length).toBe(9); // 全部 + 8 类
    await waitFor(() => expect(within(tabs).getByRole('button', { name: /报价/ }).textContent).toBe('报价2'));
    expect(within(tabs).getByRole('button', { name: /全部/ }).textContent).toBe('全部4');
    // 商城/成长等类目未读为 0 ⇒ 只有类目名，不带数字
    expect(within(tabs).getByRole('button', { name: '商城' }).textContent).toBe('商城');

    await userEvent.click(within(tabs).getByRole('button', { name: /报价/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/notifications?cat=offer'));
    await waitFor(() => expect(screen.queryByText('工单一条')).toBeNull());
    expect(screen.getByText('报价一条')).toBeTruthy();
  });

  it('直接带 ?cat=shop 进入即预筛，等于请求里带 category=shop', async () => {
    ALL = [
      item({ id: 1, template: 'offer_received', text: '报价一条', ref: { type: 'offer', id: 7 } }),
      item({ id: 2, template: 'shop_order_rejected', text: '工单一条' }),
    ];
    BY_CATEGORY = { shop: 1 };
    renderPage('/notifications?cat=shop');
    await waitFor(() => expect(screen.getByText('工单一条')).toBeTruthy());

    expect(screen.queryByText('报价一条')).toBeNull();
    expect(apiMock.mock.calls.some(([p]) => String(p).includes('category=shop'))).toBe(true);
  });

  it('非法 ?cat= 按「全部」处理（不空窗、不报错）', async () => {
    ALL = [item({ id: 1, template: 'levelup', text: '成长一条' })];
    renderPage('/notifications?cat=nope');
    await waitFor(() => expect(screen.getByText('成长一条')).toBeTruthy());
  });
});

describe('收件篮 · 本类全部已读（TC-CAT-02）', () => {
  it('全部页签 ⇒ read{all:true}；类目页签 ⇒ read{all:true,category} 且按钮文案跟着走', async () => {
    ALL = [item({ id: 1, template: 'shop_order_approved', text: '工单一条', readAt: null })];
    BY_CATEGORY = { shop: 1 };
    renderPage('/notifications?cat=shop');
    await ready();

    const btn = await screen.findByRole('button', { name: '本类全部已读' });
    await userEvent.click(btn);
    expect(postMock).toHaveBeenCalledWith('/api/notifications/read', { all: true, category: 'shop' });
  });

  it('全类页签按钮是「全部已读」并只发 {all:true}', async () => {
    ALL = [item({ id: 1, template: 'levelup', text: '成长一条', readAt: null })];
    renderPage();
    await ready();

    await userEvent.click(await screen.findByRole('button', { name: '全部已读' }));
    expect(postMock).toHaveBeenCalledWith('/api/notifications/read', { all: true });
  });
});

describe('收件篮 · 见过即已读（TC-SEEN-01/02）', () => {
  it('进入视口的未读行合批一次 POST，已读行不发', async () => {
    const undo = installFakeIO();
    try {
      ALL = [
        item({ id: 1, template: 'levelup', text: '未读甲', readAt: null }),
        item({ id: 2, template: 'levelup', text: '未读乙', readAt: null }),
        item({ id: 3, template: 'levelup', text: '已读丙', readAt: TODAY }),
      ];
      renderPage();
      await ready();

      expect(FakeIO.insts.length).toBe(1);
      expect(FakeIO.insts[0].els.size).toBe(3);
      FakeIO.insts[0].enterAll();

      await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
      const body = postMock.mock.calls[0][1] as { ids: number[] };
      expect([...body.ids].sort((a, b) => a - b)).toEqual([1, 2]);

      // 再次触发（重渲染/滚动回调重放）不再重复发
      FakeIO.insts[0].enterAll();
      await new Promise((r) => setTimeout(r, 10));
      expect(postMock).toHaveBeenCalledTimes(1);
    } finally {
      undo();
    }
  });

  it('没有 IntersectionObserver 时退化为渲染即标记', async () => {
    expect(typeof globalThis.IntersectionObserver).toBe('undefined');
    ALL = [item({ id: 1, template: 'offer_received', text: '未读一条', ref: { type: 'offer', id: 7 }, readAt: null })];
    renderPage();
    await ready();

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect((postMock.mock.calls[0][1] as { ids: number[] }).ids).toEqual([1]);
  });
});

describe('收件篮 · 结构（TC-UI-04）', () => {
  it('行内是 head/text/time 三个可直接排布的块，页签容器用 .seg（几何归静态门与 e2e）', async () => {
    ALL = [item({ id: 1, template: 'levelup', text: '一条', ref: { type: 'player', id: 6 } })];
    renderPage();
    await ready();

    const row = document.querySelector('.inbox-row') as HTMLElement;
    expect(row.querySelector('.inbox-head .badge')).toBeTruthy();
    expect(row.querySelector('.inbox-text')).toBeTruthy();
    expect(row.querySelector('.inbox-time')).toBeTruthy();
    expect(document.querySelector('.seg.inbox-tabs')).toBeTruthy();
  });
});
