// @vitest-environment jsdom
// 转会台「我的出价」余额行收编（v6.57.0）：可支配 / 冻结读余额端点（含预期收入额度，
// 冻结口径覆盖报价 / 海捞）——旧自算只减挂牌出价冻结，与账本页「可支配」会互相打架。
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClubBalance } from '../../../lib/api.ts';
import ListingsBidsSection from './ListingsBidsSection.tsx';

// 三份数据源全部桩掉：本用例锁「端点数字直接上屏」，不关心拉取本身
vi.mock('../../../lib/queries.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/queries.ts')>();
  return {
    ...mod,
    useMyClub: () => ({ loading: false, failed: false, isCoach: true, club: { id: 1, name: '甲队', balance: 100, isCoach: true } }),
    useMyBids: () => ({ bids: [], refresh: vi.fn() }),
    useClubBalance: () => ({
      data: { club: { id: 1, name: '甲队' }, balance: 100, held: 30, available: 110, expectedIncome: 40, creditLine: 40 } satisfies ClubBalance,
    }),
  };
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ListingsBidsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('ListingsBidsSection 余额行收编（v6.57.0）', () => {
  it('可支配 / 冻结与余额端点一致，额度 >0 时带（含预期收入）拆解', () => {
    const { container } = renderSection();
    const hint = container.querySelector('#desk-bids .hint');
    expect(hint).toBeTruthy();
    // 文案跨 JSX 节点（换行会进 textContent），断整段拼接后的关键片段；money() 出两位小数
    const text = hint!.textContent ?? '';
    expect(text).toContain('账户余额 100.00m，冻结中 30.00m（含报价 / 海捞）');
    expect(text).toContain('可支配 110.00m');
    expect(text).toContain('（含预期收入 40.00m）');
  });
});
