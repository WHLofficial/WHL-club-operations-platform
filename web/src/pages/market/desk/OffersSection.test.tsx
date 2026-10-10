// @vitest-environment jsdom
// v6.29.0 意向单（status=intent）在报价区的渲染与动作，聚焦测试：
// - 状态徽标「意向单·等开窗」；事件流 kind=intent/confirm 文案「挂意向单」/「确认挂牌」
// - 「轮到谁」列：卖方视角「待卖方确认」、买方视角「等对方确认」（intent 的 myTurn 恒 false，不能再显示 —）
// - 「我收到的」页签上的 intentsMine 徽标「（N 待确认挂牌）」
// - 谈判桌动作：卖方「确认挂牌」(accept) + 「放弃」(reject)，买方「撤回意向」(withdraw)，端点逐字对
// v6.40.0 同版本补充（对话式改造）新增覆盖：
// - 谈判桌从行下原地展开改**浮层**（role=dialog；行尾按钮恒叫「谈判桌」+ aria-expanded）
// - R1 拒绝改造（v6.40.1 收敛为「越权不渲染」）：动作按角色与轮次置灰并把理由写进 title；
//   卖方待回复单**任意轮次**都能拒（与轮次无关）；拒绝/放弃/撤回两段式就地确认，点第一下不发请求
// - 报价类金额整数（moneyIntText：12m 而非 12.00）、还价须整数且严格抬高、还价可带 100 字附言
// - 气泡时间到秒；卖方视角多打一枪 offer-settings 才显示底价与自动同意开关（买方看不到）
// - ≤760px 清单换卡片行（.mkt-desk-cards），不再横滑表格
// v6.40.1（角色契约 + 动作栏收敛）新增覆盖：
// - 动作栏按 角色×状态 收敛：拒绝只卖方、撤回只买方、意向单的同意只卖方；按钮集合逐字锁死
// - 卖方视角气泡左右归位（自己的话在 me 侧）；详情 role 键的契约门在 tests/offers.test.ts
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfferDetailResponse, OfferEventRow, OfferListItem, OfferSettingsDto, OffersListResponse } from '../../../lib/api.ts';
import OffersSection from './OffersSection.tsx';

// 组件与 queries 都从 lib/api.ts 取函数：一处 mock，清单 / 详情 / 名单设置都走 apiMock
const { apiMock, apiPostMock } = vi.hoisted(() => ({ apiMock: vi.fn(), apiPostMock: vi.fn() }));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/api.ts')>();
  return { ...mod, api: apiMock, apiPost: apiPostMock };
});

const SETTINGS: OfferSettingsDto = { transferListed: true, minOfferPrice: 8, listPrice: 15, offerAuto: false, notForSale: false };

let mqMatches = false;

function offer(patch: Partial<OfferListItem> = {}): OfferListItem {
  return {
    id: 5,
    player: { id: 9, fcId: null, name: '测试球员', position: 'ST', ca: 51, pa: 82, listPrice: 15 },
    counterpart: { id: 3, name: '对方俱乐部' },
    role: 'seller',
    amount: 12,
    initAmount: 10,
    round: 2,
    note: null,
    status: 'intent',
    turn: 'buyer',
    myTurn: false, // intent 恒 false（契约），动作只看 role
    listingId: null,
    createdAt: '2025-12-29T00:00:00.000Z',
    updatedAt: '2025-12-31T00:00:00.000Z',
    ...patch,
  };
}

function listResponse(items: OfferListItem[], intentsMine = 0): OffersListResponse {
  return { club: { id: 1, name: '我的俱乐部' }, box: 'in', items, nextCursor: null, pendingMine: 0, intentsMine };
}

function ev(kind: string, amount: number | null, at: string, actor: { id: number; name: string } | null, note: string | null = null): OfferEventRow {
  return { kind, amount, note, at, actor };
}

/** 意向单流程：买方 open → 卖方挂意向单 → 卖方确认挂牌（三个事件各代表一条流上的形态） */
function intentEvents(): OfferEventRow[] {
  return [
    ev('open', 10, '2025-12-29T00:00:00.000Z', { id: 2, name: '买方教练' }),
    ev('intent', 12, '2025-12-30T00:00:00.000Z', { id: 1, name: '卖方教练' }, '转会窗口未开，先落意向单，开窗后由卖方确认挂牌'),
    ev('confirm', 12, '2025-12-31T00:00:00.000Z', { id: 1, name: '卖方教练' }),
  ];
}

/** 待回复单流程：买方 open（带附言）→ 卖方 counter（带附言）——两条都是「说话类」，走左右气泡 */
function pendingEvents(): OfferEventRow[] {
  return [
    ev('open', 10, '2025-12-29T00:00:00.000Z', { id: 2, name: '买方教练' }, '先探个底'),
    ev('counter', 12, '2025-12-30T00:00:00.000Z', { id: 1, name: '卖方教练' }, '这个价可以谈'),
  ];
}

function detailResponse(o: OfferListItem, events: OfferEventRow[] = intentEvents()): OfferDetailResponse {
  return {
    offer: {
      ...o,
      buyerClub: { id: 2, name: '买方俱乐部' },
      sellerClub: { id: 1, name: '我的俱乐部' },
      season: 3,
      windowSeq: 2,
      resolvedAt: null,
    },
    events,
  };
}

function renderSection(
  items: OfferListItem[],
  detail?: OfferDetailResponse | Promise<OfferDetailResponse>,
  intentsMine = 0,
  route = '/',
  strict = false,
  narrow = false,
) {
  mqMatches = narrow;
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/offers?')) return Promise.resolve(listResponse(items, intentsMine));
    if (/^\/api\/offers\/\d+$/.test(path)) {
      return detail ? Promise.resolve(detail) : Promise.reject(new Error(`没有详情：${path}`));
    }
    if (/^\/api\/players\/\d+\/offer-settings$/.test(path)) return Promise.resolve(SETTINGS);
    return Promise.reject(new Error(`未预期的请求：${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <OffersSection box="in" status="all" onBoxChange={() => {}} onStatusChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  // StrictMode 开关：dev 下 effect 会连跑两次，深链播种最怕「首跑跳过」型旗标
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** 开桌：点行尾「谈判桌」，等浮层连内容一起就位（详情没回来时浮层只有「正在摊开谈判桌…」骨架） */
async function openDesk(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: '谈判桌' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('button', { name: '还价' });
  return dialog;
}

/** 动作栏按钮文案（顺序即渲染顺序）：v6.40.1 起越权那颗不渲染，集合随 角色×状态 变 */
function actionLabels(desk: HTMLElement): (string | null)[] {
  return Array.from(desk.querySelectorAll('.nego-actions button')).map((b) => b.textContent);
}

beforeEach(() => {
  mqMatches = false;
  window.matchMedia = ((query: string) => ({
    matches: mqMatches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiPostMock.mockReset();
});

describe('v6.29.0 意向单（OffersSection）', () => {
  it('列表：意向单徽标「意向单·等开窗」，卖方视角「轮到谁」= 待卖方确认', async () => {
    renderSection([offer({ role: 'seller' })]);
    expect(await screen.findByText('意向单·等开窗')).toBeTruthy();
    expect(screen.getByText('待卖方确认')).toBeTruthy();
    expect(screen.queryByText('等对方确认')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('列表：买方视角的意向单「轮到谁」= 等对方确认', async () => {
    renderSection([offer({ role: 'buyer' })]);
    expect(await screen.findByText('意向单·等开窗')).toBeTruthy();
    expect(screen.getByText('等对方确认')).toBeTruthy();
    expect(screen.queryByText('待卖方确认')).toBeNull();
  });

  it('「我收到的」页签：intentsMine > 0 时带「N 待确认挂牌」徽标', async () => {
    renderSection([offer()], undefined, 2);
    expect(await screen.findByRole('button', { name: /我收到的（2 待确认挂牌）/ })).toBeTruthy();
  });

  it('谈判桌：卖方意向单 = 确认挂牌(accept) + 放弃(reject 两段式)，事件流认出挂意向单/确认挂牌', async () => {
    const o = offer({ role: 'seller' });
    apiPostMock.mockResolvedValue({ ok: true });
    renderSection([o], detailResponse(o));
    const desk = await openDesk();
    const dialog = within(desk);

    // 事件流：intent → 挂意向单（带系统附言原文），confirm → 确认挂牌（无 note 走兜底句）
    expect(dialog.getByText(/挂意向单 · 12m · 转会窗口未开/)).toBeTruthy();
    expect(dialog.getByText(/确认挂牌 · 12m · 挂牌已生成/)).toBeTruthy();
    // 状态类（intent/confirm）走居中系统行，只有说话类进气泡：这一单只有买方那条 open
    expect(document.querySelectorAll('.nego-sys').length).toBe(2);
    expect(document.querySelectorAll('.nego-b.them').length).toBe(1);
    expect(document.querySelectorAll('.nego-b.me').length).toBe(0);
    // 撤回是买方那颗：卖方桌上不渲染（v6.40.1 越权不渲染）
    expect(dialog.queryByRole('button', { name: '撤回意向' })).toBeNull();
    expect(actionLabels(desk)).toEqual(['还价', '挂意向单（12m）', '放弃']);

    fireEvent.click(dialog.getByRole('button', { name: /挂意向单（12m）/ }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/accept', {}));
    expect(await screen.findByText(/已确认，球员挂牌/)).toBeTruthy();
    apiPostMock.mockClear();

    // 放弃走两段式：第一下只弹确认条，不发请求
    fireEvent.click(dialog.getByRole('button', { name: '放弃' }));
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(within(dialog.getByRole('alert')).getByText(/确认放弃这张意向单？冻结的 12m 将退回买方/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: '确认放弃' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/reject', {}));
    expect(await screen.findByText(/已放弃意向，冻结已退回对方/)).toBeTruthy();
  });

  it('谈判桌：买方意向单只剩「还价」（灰）与「撤回意向」，挂意向单/放弃都不渲染（v6.40.1）', async () => {
    const o = offer({ role: 'buyer', counterpart: { id: 1, name: '卖方俱乐部' } });
    apiPostMock.mockResolvedValue({ ok: true });
    renderSection([o], detailResponse(o));
    const desk = await openDesk();
    const dialog = within(desk);
    expect(await screen.findByText(/关窗期双方已谈成，先挂意向单/)).toBeTruthy();
    expect(dialog.queryByRole('button', { name: /挂意向单（12m）/ })).toBeNull();
    expect(dialog.queryByRole('button', { name: '放弃' })).toBeNull();
    expect(actionLabels(desk)).toEqual(['还价', '撤回意向']);
    expect((dialog.getByRole('button', { name: '还价' }) as HTMLButtonElement).getAttribute('title')).toBe(
      '意向单已谈成，等开窗后确认挂牌',
    );

    fireEvent.click(dialog.getByRole('button', { name: '撤回意向' }));
    expect(apiPostMock).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '确认撤回意向' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/withdraw', {}));
    expect(await screen.findByText(/已撤回意向，冻结资金已退回/)).toBeTruthy();
  });

  it('describe 覆盖：intent 单的 myTurn 恒 false，不再出现「还没轮到你」兜底', async () => {
    const o = offer({ role: 'seller', myTurn: false });
    renderSection([o], detailResponse(o));
    const dialog = within(await openDesk());
    await screen.findByText(/关窗期双方已谈成，先挂意向单/);
    expect(dialog.queryByText(/还没轮到你/)).toBeNull();
  });
});

// v6.40.0 站内信深链落点（?offer=<id>）——从收件篮点进来直接展开谈判桌 + 高亮目标行
describe('v6.40.0 站内信深链落点（OffersSection，TC-JUMP-01）', () => {
  it('?offer=5 且该单在列表里：谈判桌自动展开、目标行挂 .is-target 并带 data-offer-id', async () => {
    const o = offer({ id: 5, status: 'pending' });
    renderSection([o], detailResponse(o, pendingEvents()), 0, '/market/desk?tab=offers&box=in&offer=5');

    // 详情按 id 取 ⇒ 谈判桌直接开着（浮层 role=dialog；行尾按钮恒叫「谈判桌」+ aria-expanded）
    await screen.findByRole('dialog');
    await waitFor(() => expect(document.querySelector('[data-offer-id="5"]')).toBeTruthy());
    const row = document.querySelector('[data-offer-id="5"]') as HTMLElement;
    expect(row.classList.contains('is-target'), '目标行应挂 .is-target').toBe(true);
    expect(screen.getByRole('button', { name: '谈判桌' }).getAttribute('aria-expanded')).toBe('true');
    // 其余行不该被点亮
    expect(document.querySelectorAll('.is-target').length).toBe(1);
  });

  it('?offer=999 不在当前列表里：提示条给出单号，谈判桌仍按 id 打开', async () => {
    const o = offer({ id: 5, status: 'pending' });
    const target = offer({ id: 999, status: 'expired' });
    renderSection([o], detailResponse(target), 0, '/market/desk?tab=offers&box=in&offer=999');

    const hint = await screen.findByRole('status');
    expect(hint.textContent).toContain('#999');
    expect(hint.textContent).toContain('不在当前列表里');
    expect(document.querySelector('.is-target'), '不在列表里就没有可高亮的行').toBeNull();
    expect(document.querySelector('[data-offer-id="5"]')).toBeTruthy();
    // 谈判桌仍按 id 打开：详情请求打的是目标单号，而不是列表里那行
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/offers/999'));
  });

  it('StrictMode 下 ?offer= 的谈判桌不被「首跑跳过」效应收起（dev 双跑 effect）', async () => {
    const o = offer({ id: 5, status: 'pending' });
    renderSection([o], detailResponse(o, pendingEvents()), 0, '/market/desk?tab=offers&box=in&offer=5', true);

    // 双跑第二次若走「收起」分支，播种的 openId 会被清掉 ⇒ 浮层没了、行不再高亮
    await screen.findByRole('dialog');
    await waitFor(() => expect(document.querySelectorAll('.is-target').length).toBe(1));
  });
});

// v6.40.0 同版本补充：报价谈判对话式（浮层 / 两段式确认 / 整数金额 / 窄屏卡片行）；v6.40.1 起动作栏由「四颗常驻 + 置灰」改为按角色收敛（越权那颗不渲染）
describe('v6.40.0 对话式谈判桌（OffersSection）', () => {
  it('待回复单买方视角：动作栏是「还价 / 同意并挂牌 / 撤回报价」，拒绝不渲染；没轮到我时还价与同意置灰', async () => {
    const o = offer({ status: 'pending', role: 'buyer', myTurn: false, counterpart: { id: 1, name: '卖方俱乐部' } });
    renderSection([o], detailResponse(o, pendingEvents()));
    const desk = await openDesk();
    const dialog = within(desk);

    // 拒绝是卖方专属：买方桌上不渲染（v6.40.1）
    expect(dialog.queryByRole('button', { name: '拒绝' })).toBeNull();
    expect(actionLabels(desk)).toEqual(['还价', '同意并挂牌（12m）', '撤回报价']);

    // 还没轮到我：还价与同意置灰，理由写进 title；撤回这颗对买方是亮的
    const counter = dialog.getByRole('button', { name: '还价' });
    expect((counter as HTMLButtonElement).disabled).toBe(true);
    expect(counter.getAttribute('title')).toBe('还没轮到你，等对方表态');
    const accept = dialog.getByRole('button', { name: /同意并挂牌（12m）/ });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    const withdraw = dialog.getByRole('button', { name: '撤回报价' }) as HTMLButtonElement;
    expect(withdraw.disabled).toBe(false);
    // 轮次提示句仍在
    expect(dialog.getByText('还没轮到你，等对方表态。')).toBeTruthy();
  });

  it('动作栏按 角色×状态 收敛：按钮集合逐字锁死（越权那颗不渲染，奇数颗占满整行）', async () => {
    const cases: Array<[string, OfferListItem, string[]]> = [
      ['卖方待回复单', offer({ status: 'pending', role: 'seller', myTurn: true, turn: 'seller' }), ['还价', '同意并挂牌（12m）', '拒绝']],
      ['买方待回复单', offer({ status: 'pending', role: 'buyer', myTurn: true, turn: 'buyer' }), ['还价', '同意并挂牌（12m）', '撤回报价']],
      ['卖方意向单', offer({ status: 'intent', role: 'seller' }), ['还价', '挂意向单（12m）', '放弃']],
      ['买方意向单', offer({ status: 'intent', role: 'buyer' }), ['还价', '撤回意向']],
      // 了结单：渲染门只看角色（越权颗不渲染），状态不满足走置灰——故两角色各剩本角色三颗，全灰
      ['卖方了结单', offer({ status: 'rejected', role: 'seller' }), ['还价', '同意并挂牌（12m）', '拒绝']],
      ['买方了结单', offer({ status: 'rejected', role: 'buyer' }), ['还价', '同意并挂牌（12m）', '撤回报价']],
    ];
    for (const [label, o, expected] of cases) {
      renderSection([o], detailResponse(o));
      expect(actionLabels(await openDesk()), label).toEqual(expected);
      cleanup();
      apiMock.mockReset();
    }
  });

  it('气泡左右归位：对照的是自己那一队（卖方 counter 在 me 侧、买方 open 在 them 侧；买方视角镜像）', async () => {
    const o = offer({ status: 'pending', role: 'seller', myTurn: true, turn: 'seller' });
    renderSection([o], detailResponse(o, pendingEvents()));
    await openDesk();
    const me = Array.from(document.querySelectorAll('.nego-b.me')).map((el) => el.textContent ?? '');
    const them = Array.from(document.querySelectorAll('.nego-b.them')).map((el) => el.textContent ?? '');
    expect(me).toHaveLength(1);
    expect(them).toHaveLength(1);
    expect(me[0]).toContain('这个价可以谈'); // 卖方（sellerClub id 1）自己那条 counter
    expect(them[0]).toContain('先探个底'); // 买方（buyerClub id 2）那条 open
    cleanup();
    apiMock.mockReset();

    const b = offer({ status: 'pending', role: 'buyer', myTurn: false, counterpart: { id: 1, name: '卖方俱乐部' } });
    renderSection([b], detailResponse(b, pendingEvents()));
    await openDesk();
    const meBuyer = Array.from(document.querySelectorAll('.nego-b.me')).map((el) => el.textContent ?? '');
    expect(meBuyer).toHaveLength(1);
    expect(meBuyer[0]).toContain('先探个底');
  });

  it('R1：卖方待回复单任意轮次都能拒（先发起方轮次只能还价的旧限制不适用于拒绝）——两段式确认 + 冻结去向', async () => {
    // turn/round 指向买方发起方（旧 UI 里卖方此刻只能等），拒绝仍必须可点
    const o = offer({ status: 'pending', role: 'seller', myTurn: false, round: 3, turn: 'buyer', amount: 14 });
    apiPostMock.mockResolvedValue({ ok: true });
    renderSection([o], detailResponse(o, pendingEvents()));
    const dialog = within(await openDesk());

    const reject = dialog.getByRole('button', { name: '拒绝' });
    expect((reject as HTMLButtonElement).disabled).toBe(false);
    // 撤回报价是买方那颗：卖方桌上不渲染（v6.40.1）
    expect(dialog.queryByRole('button', { name: '撤回报价' })).toBeNull();
    // 还价仍受轮次约束（规则不动）
    expect((dialog.getByRole('button', { name: '还价' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(reject);
    expect(apiPostMock).not.toHaveBeenCalled();
    const alert = dialog.getByRole('alert');
    expect(alert.textContent).toContain('确认拒绝这份报价？');
    expect(alert.textContent).toContain('冻结的 14m 将退回买方');
    // 「再想想」= 就地反悔，不发请求
    fireEvent.click(within(alert).getByRole('button', { name: '再想想' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(apiPostMock).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole('button', { name: '拒绝' }));
    fireEvent.click(dialog.getByRole('button', { name: '确认拒绝' }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/reject', {}));
    expect(await screen.findByText('已拒绝，冻结已退回对方。')).toBeTruthy();
  });

  it('还价：整数输入（placeholder 为当前价 +1）+ 100 字附言一并送出，toast 用整数金额', async () => {
    const o = offer({ status: 'pending', role: 'seller', myTurn: true, turn: 'seller', amount: 12 });
    apiPostMock.mockResolvedValue({ ok: true, amount: 14 });
    renderSection([o], detailResponse(o, pendingEvents()));
    const dialog = within(await openDesk());

    const amountInput = dialog.getByPlaceholderText('13') as HTMLInputElement;
    expect(amountInput.getAttribute('inputmode')).toBe('numeric');
    // 非数字字符被剔掉（保留小数点是给「须整数」的本地校验留出提示空间）
    fireEvent.change(amountInput, { target: { value: '1a4' } });
    expect(amountInput.value).toBe('14');
    fireEvent.change(dialog.getByPlaceholderText('给对方的一句话'), { target: { value: '再高一点就成' } });

    fireEvent.click(dialog.getByRole('button', { name: '还价' }));
    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/offers/5/counter', { amount: 14, note: '再高一点就成' }),
    );
    expect(await screen.findByText('还价已送出：14m，等对方表态。')).toBeTruthy();
  });

  it('还价：金额非整数或没抬高时该颗置灰（本地校验不发请求）', async () => {
    const o = offer({ status: 'pending', role: 'seller', myTurn: true, turn: 'seller', amount: 12 });
    renderSection([o], detailResponse(o, pendingEvents()));
    const dialog = within(await openDesk());
    const counter = dialog.getByRole('button', { name: '还价' }) as HTMLButtonElement;
    expect(counter.disabled).toBe(true); // 空输入

    fireEvent.change(dialog.getByPlaceholderText('13'), { target: { value: '12.5' } });
    expect(counter.disabled).toBe(true); // 小数：报价必须为整数（offer-rules 同口径）

    fireEvent.change(dialog.getByPlaceholderText('13'), { target: { value: '12' } });
    expect(counter.disabled).toBe(true); // 没抬高

    fireEvent.change(dialog.getByPlaceholderText('13'), { target: { value: '13' } });
    expect(counter.disabled).toBe(false);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('单据头：卖方多打一枪 offer-settings 才显示底价与自动同意；买方不泄底价', async () => {
    const seller = offer({ status: 'pending', role: 'seller', myTurn: true, turn: 'seller' });
    renderSection([seller], detailResponse(seller, pendingEvents()));
    await openDesk();
    await waitFor(() => expect(document.querySelector('.nego-rule')?.textContent).toMatch(/最低报价/));
    const text = document.querySelector('.nego-rule')!.textContent!.replace(/\s+/g, '');
    expect(text).toContain('转会名单：标价15m·最低报价8m·自动同意关');
    expect(text).toContain('低于最低报价自动拒（与开关无关）');
    cleanup();
    apiMock.mockClear();

    const buyer = offer({ status: 'pending', role: 'buyer', myTurn: false, counterpart: { id: 1, name: '卖方俱乐部' } });
    renderSection([buyer], detailResponse(buyer, pendingEvents()));
    await openDesk();
    await waitFor(() => expect(document.querySelector('.nego-rule')?.textContent).toMatch(/标价/));
    const buyerText = document.querySelector('.nego-rule')!.textContent!.replace(/\s+/g, '');
    expect(buyerText).toContain('转会名单：标价15m');
    // 卖方专属的两项（本轮底价 / 自动同意开关）与公开标价分开：买方只有标价 + 规则措辞
    expect(buyerText).not.toContain('最低报价8m');
    expect(buyerText).not.toContain('自动同意关');
    expect(apiMock.mock.calls.some((c) => String(c[0]).includes('/offer-settings'))).toBe(false);
  });

  it('非名单球员（listPrice 为 null）：不留空的名单规则行', async () => {
    const o = offer({ status: 'pending', role: 'buyer', myTurn: false, player: { ...offer().player, listPrice: null } });
    renderSection([o], detailResponse(o, pendingEvents()));
    await openDesk();
    expect(document.querySelector('.nego-rule')).toBeNull();
  });

  it('了结单：留下的动作全灰（title 说明了结）+ 结果句说明冻结去向', async () => {
    const o = offer({ status: 'rejected', role: 'seller', amount: 12 });
    renderSection([o], detailResponse(o, [ev('open', 12, '2025-12-29T00:00:00.000Z', { id: 2, name: '买方教练' }), ev('reject', 12, '2025-12-30T00:00:00.000Z', null)]));
    const desk = await openDesk();
    const dialog = within(desk);
    expect(actionLabels(desk)).toEqual(['还价', '同意并挂牌（12m）', '拒绝']);
    for (const name of [/还价/, /同意并挂牌（12m）/, /拒绝/]) {
      const btn = dialog.getByRole('button', { name }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('title')).toBe('这一单已经了结');
    }
    expect(dialog.queryByRole('button', { name: '撤回报价' })).toBeNull();
    expect(dialog.getByText(/已了结，冻结资金已退回报价方。/)).toBeTruthy();
    // reject 事件 note 为空 ⇒ 走前端兜底句（不重写系统句）
    expect(dialog.getByText(/拒绝 · 12m · 冻结已退回买方/)).toBeTruthy();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('了结单买方视角：本角色三颗全灰（撤回在、按状态灰）+「拒绝」不渲染（v6.40.1）', async () => {
    const o = offer({ status: 'rejected', role: 'buyer', amount: 12 });
    renderSection([o], detailResponse(o, [ev('open', 12, '2025-12-29T00:00:00.000Z', { id: 1, name: '买方教练' }), ev('reject', 12, '2025-12-30T00:00:00.000Z', null)]));
    const desk = await openDesk();
    const dialog = within(desk);
    expect(actionLabels(desk)).toEqual(['还价', '同意并挂牌（12m）', '撤回报价']);
    for (const name of [/还价/, /同意并挂牌（12m）/, /撤回报价/]) {
      const btn = dialog.getByRole('button', { name }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('title')).toBe('这一单已经了结');
    }
    expect(dialog.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it('气泡与系统行时间到秒（YYYY-MM-DD HH:mm:ss）', async () => {
    const o = offer({ status: 'pending', role: 'seller', myTurn: true, turn: 'seller' });
    renderSection([o], detailResponse(o, pendingEvents()));
    await openDesk();
    const stamps = Array.from(document.querySelectorAll('.nego-b-at, .nego-sys-at')).map((el) => el.textContent ?? '');
    expect(stamps.length).toBe(2);
    for (const s of stamps) expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  // ---- v6.33.0：砍价徽标（卖方活单报价 < 公开标价；标价本身公开，徽标不泄底线） ----

  it('砍价徽标：卖方视角活单、12 < 标价 15 → 「当前价」格内标出', async () => {
    renderSection([offer({ status: 'pending', role: 'seller', amount: 12 })]);
    expect(await screen.findByText('测试球员')).toBeTruthy();
    const badge = screen.getByText('砍价');
    expect(badge.className).toContain('badge');
    expect(badge.className).toContain('orange');
    // 挂在整数金额后面，是「当前价」格的一部分，不占独立列（单位 m 由 moneyIntText 自带）
    expect(badge.closest('td')?.textContent).toBe('12m砍价');
  });

  it('砍价徽标：达到/超过标价（16 ≥ 15）不出现', async () => {
    renderSection([offer({ status: 'pending', role: 'seller', amount: 16 })]);
    expect(await screen.findByText('测试球员')).toBeTruthy();
    expect(screen.queryByText('砍价')).toBeNull();
  });

  it('砍价徽标：买方视角即使低于标价也不出现（只卖方看自己收到的单）', async () => {
    renderSection([offer({ status: 'pending', role: 'buyer', amount: 12 })]);
    expect(await screen.findByText('测试球员')).toBeTruthy();
    expect(screen.queryByText('砍价')).toBeNull();
  });

  // ---- ≤760px：表格换卡片行（横滑根因是 .table-wrap{overflow-x:auto}） ----

  it('窄屏：清单渲染卡片行（对手 · 金额 · 轮次 · 秒级时间戳 + 谈判桌），不再渲染表格', async () => {
    renderSection([offer({ status: 'pending', role: 'seller', myTurn: true, turn: 'seller' })], undefined, 0, '/', false, true);
    const cards = await waitFor(() => {
      const el = document.querySelector('.mkt-desk-cards');
      if (!el) throw new Error('还没有卡片列表');
      return el as HTMLElement;
    });
    const card = within(cards);
    expect(card.getByText('测试球员')).toBeTruthy();
    expect(card.getByText('对方俱乐部')).toBeTruthy();
    expect(card.getByText('12m')).toBeTruthy();
    // 窄屏金额写法（m04916）：「对手 · 金额」——十位小数换成「对方俱乐部 · 12m」
    expect(document.querySelector('.dc-mid')?.textContent).toMatch(/对方俱乐部\s*·\s*12m/);
    expect(card.getByText('R2')).toBeTruthy();
    expect(card.getByText('待你表态')).toBeTruthy();
    expect(card.getByText('砍价')).toBeTruthy();
    expect(cards.querySelector('table')).toBeNull();
    expect(cards.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(card.getByRole('button', { name: '谈判桌' })).toBeTruthy();
  });

  it('窄屏：卡片行也能开桌（同一份 openId），目标行高亮仍生效', async () => {
    const o = offer({ id: 5, status: 'pending' });
    renderSection([o], detailResponse(o, pendingEvents()), 0, '/market/desk?tab=offers&box=in&offer=5', false, true);
    await screen.findByRole('dialog');
    await waitFor(() => expect(document.querySelector('.mkt-desk-card.is-target')).toBeTruthy());
    expect(document.querySelectorAll('.is-target').length).toBe(1);
  });
});

// v6.40.2 开桌即读（TC-DESK-11..14）：开桌前先用列表行把单据头画出来（placeholderData 播种），
// 事件流等详情回来再补——「摊开谈判桌」不再是一块空白面板。
describe('v6.40.2 开桌即读（列表行播种，TC-DESK-11..14）', () => {
  /** 悬置的详情请求：先看播种画面，再手动放行真详情 */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it('TC-DESK-11 详情悬置时单据头已可读、事件区给占位；详情回来后事件流替换占位', async () => {
    const o = offer({ id: 5, status: 'pending', role: 'buyer', myTurn: true, turn: 'buyer' });
    const d = deferred<OfferDetailResponse>();
    renderSection([o], d.promise);

    fireEvent.click(await screen.findByRole('button', { name: '谈判桌' }));
    const dialog = (await screen.findByRole('dialog')) as HTMLElement;
    const desk = within(dialog);

    // 单据头全部来自列表行：球员名进 aria-label、当前有效价/首报/R 轮、买卖双方、动作栏
    expect(dialog.getAttribute('aria-label')).toBe('谈判桌 · 测试球员');
    expect(desk.getByText('12m')).toBeTruthy();
    expect(desk.getByText('（首报 10m · R2）')).toBeTruthy();
    expect(desk.getByText('我的俱乐部')).toBeTruthy(); // 买方=本队
    expect(desk.getByText('对方俱乐部')).toBeTruthy(); // 卖方=对手
    expect(actionLabels(dialog)).toEqual(['还价', '同意并挂牌（12m）', '撤回报价']);
    // 事件流还没到：占位句，而不是「这一单还没有事件记录。」
    expect(desk.getByText('正在读取谈判记录…')).toBeTruthy();
    expect(desk.queryByText('这一单还没有事件记录。')).toBeNull();
    expect(document.querySelectorAll('.nego-b').length).toBe(0);

    d.resolve(detailResponse(o, pendingEvents()));
    expect(await desk.findByText(/先探个底/)).toBeTruthy();
    expect(desk.queryByText('正在读取谈判记录…')).toBeNull();
  });

  it('TC-DESK-12 卖方开桌：底价设置请求与详情并行发出（role 取自列表行，不用等详情）', async () => {
    const o = offer({ id: 5, status: 'pending', role: 'seller', myTurn: true, turn: 'seller' });
    const d = deferred<OfferDetailResponse>();
    renderSection([o], d.promise);

    fireEvent.click(await screen.findByRole('button', { name: '谈判桌' }));
    const dialog = (await screen.findByRole('dialog')) as HTMLElement;

    // 详情还悬置着（d 没 resolve），设置端点已经按播种的 player.id 打出去 ⇒ 两请求并行而非串行
    expect(apiMock).toHaveBeenCalledWith('/api/players/9/offer-settings');
    expect(within(dialog).getByText(/转会名单：标价/)).toBeTruthy();

    d.resolve(detailResponse(o));
    expect(await within(dialog).findByText(/最低报价/)).toBeTruthy();
  });

  it('TC-DESK-13 深链 ?offer=999 不在列表：没有可播种的行 ⇒ 仍走「正在摊开谈判桌…」骨架', async () => {
    const o = offer({ id: 5, status: 'pending' });
    const d = deferred<OfferDetailResponse>();
    renderSection([o], d.promise, 0, '/market/desk?tab=offers&box=in&offer=999');

    const dialog = (await screen.findByRole('dialog')) as HTMLElement;
    expect(within(dialog).getByText('正在摊开谈判桌…')).toBeTruthy();
    expect(within(dialog).queryByText('正在读取谈判记录…')).toBeNull();

    d.resolve(detailResponse(offer({ id: 999, status: 'expired' })));
    expect(await within(dialog).findByText('测试球员')).toBeTruthy();
  });

  it('TC-DESK-14 悬停/聚焦行尾「谈判桌」即预取详情，但不打开浮层', async () => {
    const o = offer({ id: 5, status: 'pending' });
    renderSection([o], detailResponse(o, pendingEvents()));
    const btn = await screen.findByRole('button', { name: '谈判桌' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    fireEvent.pointerOver(btn);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/offers/5'));
    expect(document.querySelector('[role="dialog"]'), '预取不该开浮层').toBeNull();

    // 聚焦（键盘 Tab 过来）同样预取
    apiMock.mockClear();
    fireEvent.focusIn(btn);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/offers/5'));
  });
});
