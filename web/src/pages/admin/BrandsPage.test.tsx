// @vitest-environment jsdom
// 管理端品牌池（web/src/pages/admin/BrandsPage.tsx，v6.51.0 档案区默认收起）的组件测试：
// - TC-BR-01（P0）：进页面时档案/招商性格区全部收起——每行一个「档案」按钮、零个「收起」、零个 .brand-profile-grid
// - TC-BR-02（P0）：点某行「档案」只展开该行（按钮变「收起」、网格里是该行的值），再点回收起、其他行不受影响
// - TC-BR-03（P1）：窄屏卡片流同样默认收起、同样可展开（走 useMediaQuery 的窄屏分支）
// - TC-BR-04（P2）：「总部」是行业之前的只读展示列（无输入控件）；「来源 / 状态」两列挂 brand-meta-cell（小一号字号 + 禁折），规则本体锁在 styles.css
// 动因：池子 28 家时全部展开会把表格拉到很长（v6.51.0 复审后改默认收起）；两列 2–3 个汉字在窄列里折行（用户反馈）。
// 后端校验（color/origin/style/prefer 非法 400 与长度上限）由 tests/naming-brand-profile.test.ts 守着，这里只管前端形态。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BrandsPage from './BrandsPage.tsx';

const { apiMock, marketMock, media } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  marketMock: vi.fn(),
  media: { narrow: false },
}));
// 页面从 api.ts 取品牌池、从 adminQueries.ts 取招商轮；两处都打桩，未打桩的请求直接抛错
vi.mock('../../lib/api.ts', () => ({ api: apiMock, apiSend: vi.fn() }));
vi.mock('../../lib/adminQueries.ts', () => ({
  MARKET_ROUND_KEY: ['admin', 'market-round'],
  fetchMarketRound: marketMock,
  reopenMarketRound: vi.fn(),
}));
vi.mock('../../lib/datetime.ts', () => ({ useTimeFmt: () => ({ dateTime: (v: string) => v }) }));
vi.mock('../../lib/use-media.ts', () => ({ useMediaQuery: () => media.narrow }));

// 三行夹具：name_en 只在档案网格里以 input 值出现（主行是纯文本），用它锁「展开的是哪一行」
const BRANDS = [
  {
    id: 1,
    brand: '奥维恩',
    heat: 1.3,
    source: 'builtin',
    status: 'adopted',
    industry: '科技',
    tier: '头部',
    tier_locked: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    active_contracts: 1,
    name_en: 'OVIEN',
    full_name: '奥维恩科技集团',
    color: '#1E4E8C',
    slogan: '算力所指，皆是主场',
    hq: '都柏林',
    intro: '测试档案一',
    origin: '',
    style: '进取',
    prefer: '冠军相,大场馆',
  },
  {
    id: 2,
    brand: '维洛',
    heat: 1.1,
    source: 'builtin',
    status: 'adopted',
    industry: '运动',
    tier: '头部',
    tier_locked: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    active_contracts: 0,
    name_en: 'VILO',
    full_name: '维洛运动集团',
    color: '#C8102E',
    slogan: '唯快不破',
    hq: '纽伦堡',
    intro: '测试档案二',
    origin: '',
    style: '进取',
    prefer: '冠军相,高上座',
  },
  {
    id: 3,
    brand: '星海通讯',
    heat: 0.8,
    source: 'builtin',
    status: 'adopted',
    industry: '科技',
    tier: '口碑',
    tier_locked: 0,
    created_at: '2026-10-01T00:00:00.000Z',
    active_contracts: 0,
    name_en: 'XINGHAI',
    full_name: '星海通讯集团',
    color: '#3F51B5',
    slogan: '连接每一座球场',
    hq: '深圳',
    intro: '测试档案三',
    origin: '中资',
    style: '稳健',
    prefer: '大场馆,高上座',
  },
];

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  marketMock.mockReset();
  media.narrow = false;
});

function renderPage() {
  apiMock.mockImplementation(async (url: string) => {
    if (url === '/api/admin/brands') return { brands: BRANDS };
    throw new Error(`未打桩的请求 ${url}`);
  });
  marketMock.mockResolvedValue({ round: null, offers: [] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BrandsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('管理端品牌池 · 档案区默认收起（v6.51.0）', () => {
  it('TC-BR-01：桌面表格进页面全收起', async () => {
    const { container } = renderPage();
    await screen.findByText('奥维恩');

    expect(screen.getAllByRole('button', { name: '档案' })).toHaveLength(BRANDS.length);
    expect(screen.queryAllByRole('button', { name: '收起' })).toHaveLength(0);
    expect(container.querySelectorAll('.brand-profile-grid')).toHaveLength(0);
    // 展开才渲染的档案输入一个都不在
    expect(screen.queryByDisplayValue('VILO')).toBeNull();
  });

  it('TC-BR-02：只展开点中的那一行，再点回收起', async () => {
    const { container } = renderPage();
    await screen.findByText('奥维恩');

    const tr = screen.getByText('维洛').closest('tr');
    if (!(tr instanceof HTMLElement)) throw new Error('没找到维洛行');
    fireEvent.click(within(tr).getByRole('button', { name: '档案' }));

    expect(container.querySelectorAll('.brand-profile-grid')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '收起' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '档案' })).toHaveLength(BRANDS.length - 1);
    // 展开的网格是维洛行的（值取自该行），不是邻居串位
    expect(screen.getByDisplayValue('VILO')).toBeTruthy();
    expect(screen.queryByDisplayValue('OVIEN')).toBeNull();

    fireEvent.click(within(tr).getByRole('button', { name: '收起' }));
    expect(container.querySelectorAll('.brand-profile-grid')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: '收起' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: '档案' })).toHaveLength(BRANDS.length);
  });

  it('TC-BR-03：窄屏卡片流同样默认收起、可展开', async () => {
    media.narrow = true;
    const { container } = renderPage();
    await screen.findByText('奥维恩');

    expect(container.querySelectorAll('.brand-card')).toHaveLength(BRANDS.length);
    expect(screen.getAllByRole('button', { name: '档案' })).toHaveLength(BRANDS.length);
    expect(container.querySelectorAll('.brand-profile-grid')).toHaveLength(0);

    const card = screen.getByText('星海通讯').closest('.brand-card');
    if (!(card instanceof HTMLElement)) throw new Error('没找到星海通讯卡片');
    fireEvent.click(within(card).getByRole('button', { name: '档案' }));

    expect(container.querySelectorAll('.brand-profile-grid')).toHaveLength(1);
    expect(screen.getByDisplayValue('XINGHAI')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '收起' })).toHaveLength(1);
  });

  it('TC-BR-04：「总部」为只读展示列（行业之前）、「来源 / 状态」两列走 brand-meta-cell（小一号字号 + 禁折），CSS 规则在位', async () => {
    const { container } = renderPage();
    await screen.findByText('奥维恩');

    // 列序：品牌 / 总部 / 行业 / 热度 / 档位 / 来源 / 状态 / 生效冠名 / 操作
    const rows = Array.from(container.querySelectorAll('tbody tr')).filter((tr) => tr.querySelectorAll('td').length === 9);
    expect(rows).toHaveLength(BRANDS.length);
    for (const [i, tr] of rows.entries()) {
      const cells = tr.querySelectorAll('td');
      // 总部列：只读文本（不挂输入控件），值取该行 hq
      expect(cells[1]!.textContent).toBe(BRANDS[i]!.hq);
      expect(cells[1]!.querySelector('input, select, textarea')).toBeNull();
      // 列窄时「种子 / 在池 / 自定义 / 已弃用」会被折成两行 ⇒ 两列挂类名（尺寸与禁折写在 styles.css）
      expect(cells[5]!.className).toBe('brand-meta-cell');
      expect(cells[6]!.className).toBe('brand-meta-cell');
      expect(['种子', '自定义']).toContain(cells[5]!.textContent);
      expect(['在池', '已弃用']).toContain(cells[6]!.textContent);
    }
    // 静态锁：规则本体（字号与禁折）必须在 styles.css 里，行内不得带尺寸/字号（相对路径按仓库根解析，vitest cwd = 仓库根）
    const css = readFileSync('web/src/styles.css', 'utf8');
    expect(css).toMatch(/\.brand-meta-cell\s*\{[^}]*font-size:\s*12px;[^}]*white-space:\s*nowrap;/);
  });
});
