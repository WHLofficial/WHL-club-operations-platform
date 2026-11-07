// @vitest-environment jsdom
// v6.79.0 评审修复锁定：手输负数是非法输入（服务端 parsePlayerUpdates 对 v<0 必 400、≤200 条整批拒），
// 前端按「不会提交」拦在前端（红字提示 + 不入 items）；off-ladder 正数仍是只提示照常提交——两路差异不许合流。
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiPostMock = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api.ts')>();
  // 单行清单：id=71 现身价 10（在档）；页形状只给组件实际读的字段（id/name/position/age/ca/marketValue/modelValue/lastDeal）
  const page = {
    players: [
      {
        id: 71,
        name: '测试球员',
        display_name: '测试球员',
        club_id: 1,
        clubName: '甲队',
        position: 'ST',
        age: 24,
        ca: 140,
        pa: 160,
        marketValue: 10,
        modelValue: 9,
        lastDeal: null,
      },
    ],
    nextCursor: null,
  };
  return {
    ...mod,
    api: vi.fn(async (url: string) => {
      if (url.startsWith('/api/clubs')) return { clubs: [{ id: 1, name: '甲队' }] };
      return page;
    }),
    apiPost: (...args: unknown[]) => apiPostMock(...args),
  };
});

vi.mock('../../lib/toast.tsx', () => ({ useToast: () => ({ show: vi.fn(), toastNode: null }) }));

import ValuesPage from './ValuesPage.tsx';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ValuesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 列表是异步拉的：等数据落表、行渲染出来再拿输入框 */
async function waitForInput(container: HTMLElement): Promise<HTMLInputElement> {
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = container.querySelector<HTMLInputElement>('input[aria-label="测试球员 身价"]');
    expect(input, '身价输入框（aria-label=测试球员 身价）应出现').toBeTruthy();
  });
  return input!;
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('button.primary');
  expect(btn, '底部提交按钮应存在').toBeTruthy();
  return btn!;
}

afterEach(() => {
  cleanup();
  apiPostMock.mockClear();
});

describe('ValuesPage 手输校验（v6.79.0 评审：负数拦截）', () => {
  it('负数：红字「不是有效身价（须为非负数），不会提交」、不显示 off-ladder 文案、不入批（按钮禁用，apiPost 零调用）', async () => {
    const { container } = renderPage();
    const input = await waitForInput(container);

    fireEvent.change(input, { target: { value: '-5' } });

    const text = container.textContent ?? '';
    expect(text).toContain('不是有效身价（须为非负数），不会提交');
    // 负数走非法输入路径，不再挂「不在档上（照常提交）」——那句话对负数是错的
    expect(text).not.toContain('不在档上（照常提交）');
    expect(submitButton(container).disabled).toBe(true);
    expect(container.textContent).toContain('暂存 1 条，可提交 0 条');
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('对照 off-ladder 正数（11，snap=12）：仍红字「不在档上（照常提交）」且照常入批提交', async () => {
    const { container } = renderPage();
    const input = await waitForInput(container);

    fireEvent.change(input, { target: { value: '11' } });

    const text = container.textContent ?? '';
    expect(text).toContain('不在档上（照常提交）');
    expect(text).not.toContain('不会提交');
    expect(text).toContain('可提交 1 条');
    expect(submitButton(container).disabled).toBe(false);

    submitButton(container).click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(apiPostMock).toHaveBeenCalledWith('/api/admin/players/batch', { items: [{ id: 71, marketValue: 11 }] });
  });

  it('在档正数（12）照常提交，负数修复不误伤正常路径', async () => {
    const { container } = renderPage();
    fireEvent.change(await waitForInput(container), { target: { value: '12' } });
    expect(container.textContent).not.toContain('不会提交');
    expect(container.textContent).not.toContain('不在档上（照常提交）');
    submitButton(container).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(apiPostMock).toHaveBeenCalledWith('/api/admin/players/batch', { items: [{ id: 71, marketValue: 12 }] });
  });
});
