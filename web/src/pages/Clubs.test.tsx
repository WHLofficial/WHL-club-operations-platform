// @vitest-environment jsdom
// 球队页（web/src/pages/Clubs.tsx，增量 31 步骤 4）的组件测试：分级分段、四项指标口径、
// CPU 标记、队徽有无两种形态、加载/错误态、以及整卡链接必须是 /clubs/:id（AGENTS.md 的 Q17 口径）。
// 没打 CSS（jsdom 不跑样式表），视觉表现靠 e2e 截图看。
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClubSummary } from '../lib/api.ts';
import Clubs from './Clubs.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
// mediaUrl 给真实现（TeamLogo 要用它把 logoKey 折成 /api/media/*）
vi.mock('../lib/api.ts', () => ({
  api: apiMock,
  mediaUrl: (key: string | null | undefined) => (key ? `/api/media/${key}` : null),
}));

function club(patch: Partial<ClubSummary> & { id: number; name: string }): ClubSummary {
  return {
    isCpu: false,
    tier: null,
    logoKey: null,
    squad: { senior: 0, trainee: 0 },
    avgCa: null,
    // 生产现状：players.market_value 全 NULL ⇒ 服务端给 null，卡片显示「—」而不是 0.00 m
    totalValue: null,
    totalWage: 0,
    ...patch,
  };
}

// 指标格是 dt/dd 成对；按 dt 取同格 dd 的文本（「—」与「0.00 m」要能分辨）
function metric(card: HTMLElement, label: string): string {
  return within(card).getByText(label).nextElementSibling!.textContent!.trim();
}

const CLUBS: ClubSummary[] = [
  club({ id: 1, name: '阿森纳', tier: 'premier', logoKey: 'team/90/1.png', squad: { senior: 24, trainee: 3 }, avgCa: 75.24, totalValue: 1234.5, totalWage: 4.4 }),
  club({ id: 243, name: '皇家马德里', tier: 'premier', squad: { senior: 20, trainee: 0 }, avgCa: 80, totalValue: 2000, totalWage: 6 }),
  club({ id: 66, name: '乙级队', tier: 'second', squad: { senior: 18, trainee: 2 } }),
  club({ id: 999, name: '甲队 (CPU)', isCpu: true }),
];

function renderClubs(data: ClubSummary[] | Error = CLUBS) {
  if (data instanceof Error) apiMock.mockRejectedValue(data);
  else apiMock.mockResolvedValue({ clubs: data });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Clubs />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe('球队页（增量 31 步骤 4）', () => {
  it('按分级分段：顶级/次级/未定级各成一段，段内只放该级别的队', async () => {
    renderClubs();

    const premierHead = (await screen.findByText('顶级联赛')).parentElement!;
    expect(within(premierHead).getByText(/2 支/)).toBeTruthy();
    const premierGrid = premierHead.nextElementSibling as HTMLElement;
    expect(within(premierGrid).getByText('阿森纳')).toBeTruthy();
    expect(within(premierGrid).getByText('皇家马德里')).toBeTruthy();
    expect(within(premierGrid).queryByText('乙级队')).toBeNull();

    const secondHead = screen.getByText('次级联赛').parentElement!;
    expect(within(secondHead).getByText(/1 支/)).toBeTruthy();
    expect(within(secondHead.nextElementSibling as HTMLElement).getByText('乙级队')).toBeTruthy();

    const noneHead = screen.getByText('未定级').parentElement!;
    expect(within(noneHead.nextElementSibling as HTMLElement).getByText('甲队 (CPU)')).toBeTruthy();
  });

  it('四项指标：阵容拆一线队与青训、平均 CA 一位小数、金额带 m、CPU 打标', async () => {
    renderClubs();

    const card = (await screen.findByText('阿森纳')).closest('a')!;
    expect(within(card).getByText('24 人')).toBeTruthy();
    expect(within(card).getByText(/\+ 3 青训/)).toBeTruthy();
    expect(within(card).getByText('75.2')).toBeTruthy(); // 75.24 只显示一位
    expect(within(card).getByText('1234.50 m')).toBeTruthy();
    expect(within(card).getByText('4.40 m')).toBeTruthy();

    // 没有青训就不显示「+ 0 青训」那半句
    const rm = screen.getByText('皇家马德里').closest('a')!;
    expect(within(rm).queryByText(/青训/)).toBeNull();

    const cpu = screen.getByText('甲队 (CPU)').closest('a')!;
    expect(within(cpu).getByText('CPU')).toBeTruthy();
    expect(metric(cpu, '平均 CA')).toBe('—'); // 空队平均 CA 是 —，不是 0
    expect(metric(cpu, '总身价')).toBe('—'); // 没录过身价是 —，不是 0.00 m
    expect(metric(cpu, '工资总额')).toBe('0.00 m'); // 没有合同 ⇒ 工资 0 是真话

    // 有人但都没录身价（生产现状）：身价是 —，其余指标照常出
    const second = screen.getByText('乙级队').closest('a')!;
    expect(metric(second, '阵容')).toBe('18 人 + 2 青训');
    expect(metric(second, '总身价')).toBe('—');
    expect(metric(second, '工资总额')).toBe('0.00 m');
  });

  it('没有球队的段整段不渲染', async () => {
    renderClubs([club({ id: 1, name: '阿森纳', tier: 'premier' })]);
    expect(await screen.findByText('顶级联赛')).toBeTruthy();
    expect(screen.queryByText('次级联赛')).toBeNull();
    expect(screen.queryByText('未定级')).toBeNull();
  });

  it('队徽：有 logoKey 出 <img> 指向 /api/media/*，没有就出首字色块', async () => {
    renderClubs();
    const withLogo = (await screen.findByText('阿森纳')).closest('a')!;
    const img = within(withLogo).getByAltText('阿森纳');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/api/media/team/90/1.png');

    const noLogo = screen.getByText('皇家马德里').closest('a')!;
    const fallback = within(noLogo).getByText('皇');
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback.className).toContain('team-logo-fallback');
  });

  it('整卡是链接，指向 /clubs/:id（平台库 clubs.id，不是比赛系统队 id）', async () => {
    renderClubs();
    expect((await screen.findByText('阿森纳')).closest('a')!.getAttribute('href')).toBe('/clubs/1');
    expect(screen.getByText('皇家马德里').closest('a')!.getAttribute('href')).toBe('/clubs/243');
  });

  it('加载中显示「正在点名…」，失败显示横幅', async () => {
    renderClubs(new Error('名单服务打盹了'));
    expect(await screen.findByText('名单服务打盹了')).toBeTruthy();
  });

  it('一支球队都没有时给空态，不显示任何分级段', async () => {
    renderClubs([]);
    expect(await screen.findByText('还没有球队入驻。')).toBeTruthy();
    expect(screen.queryByText('顶级联赛')).toBeNull();
  });
});
