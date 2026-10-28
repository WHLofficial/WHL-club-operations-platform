// @vitest-environment jsdom
// 账本页余额卡（v6.57.0）：balance 端点三新字段的渲染——可支配（含预期收入 X m）拆解行
// 与负可用的中性红字（不写「预期收入已收缩」，归因留给冻结/欠款两类真实原因）。
// jsdom 不跑样式表：红字颜色由 styles.css 的 .ledger-balance-neg 承载（tests/mobile-baseline 静态门另锁）。
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth.tsx';
import Ledger from './Ledger.tsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...mod, api: apiMock };
});

function renderPage(balance: Record<string, unknown>) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/me') return { user: { id: 1, name: '测试教练' }, authMode: 'shared' };
    if (path === '/api/club/balance') return balance;
    if (path.startsWith('/api/club/ledger')) return { entries: [], nextCursor: null };
    throw new Error(`未打桩的请求：${path}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter>
          <Ledger />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** 余额拆解行（可支配/冻结/括注跨 JSX 节点，读整行 textContent 断言） */
function subText(container: HTMLElement): string {
  return container.querySelector('.ledger-balance-sub')?.textContent ?? '';
}

/** 该行数据到达前的占位是「…」；等到占位消失再断数字 */
async function awaitLoaded(container: HTMLElement): Promise<void> {
  await waitFor(() => expect(subText(container)).not.toContain('…'));
}

afterEach(cleanup);

describe('Ledger 余额卡 · 预期收入额度三字段（v6.57.0）', () => {
  it('正可用：可支配行带（含预期收入 X m）拆解，三字段与端点一致', async () => {
    const { container } = renderPage({ club: { id: 1, name: '甲队' }, balance: 100, held: 30, available: 110, expectedIncome: 40, creditLine: 40 });
    await awaitLoaded(container);
    expect(subText(container)).toContain('可支配 110');
    expect(subText(container)).toContain('（含预期收入 40m）');
    expect(subText(container)).toContain('冻结中 30');
    // 正可用不出负余额提示
    expect(container.querySelector('.ledger-balance-neg')).toBeNull();
  });

  it('额度为 0：不渲染「含预期收入」括注（余额 − 冻结即全貌）', async () => {
    const { container } = renderPage({ club: { id: 1, name: '甲队' }, balance: 100, held: 30, available: 70, expectedIncome: 0, creditLine: 0 });
    await awaitLoaded(container);
    expect(subText(container)).toContain('可支配 70');
    expect(subText(container)).not.toContain('含预期收入');
  });

  it('负可用：中性红字（冻结或欠款占用），不写「预期收入已收缩」', async () => {
    const { container } = renderPage({ club: { id: 1, name: '甲队' }, balance: 5, held: 30, available: -5, expectedIncome: 20, creditLine: 20 });
    await waitFor(() => expect(container.querySelector('.ledger-balance-neg')).toBeTruthy());
    expect(subText(container)).toContain('可支配 -5');
    expect(subText(container)).toContain('（含预期收入 20m）');
    const neg = container.querySelector('.ledger-balance-neg')!;
    expect(neg.textContent).toContain('当前可支配为负（冻结或欠款占用），新增报价 / 出价类操作将被拒');
    expect(neg.textContent).not.toContain('收缩');
  });
});
