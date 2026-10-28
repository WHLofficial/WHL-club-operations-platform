// @vitest-environment jsdom
// v6.24.0 批次 B 出价表单口径：TC-B05 非整数出价禁提交（前端拦下、不发请求）、
// TC-B06 预填跟随 nextMinBid（用户没手改过才跟随）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarketBidForm } from './MarketBidForm.tsx';

afterEach(cleanup);

describe('MarketBidForm（v6.24.0）', () => {
  it('TC-B05 非整数出价禁提交，整数才可提交', async () => {
    const onBid = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MarketBidForm mode="normal" askPrice={10} nextMinBid={11} available={500} onBid={onBid} />);

    const input = screen.getByLabelText('出价（m）');
    const submit = screen.getByRole('button', { name: /出价（至少/ }) as HTMLButtonElement;

    await user.clear(input);
    await user.type(input, '11.5');
    expect(submit.disabled).toBe(true);
    await user.click(submit);
    expect(onBid).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '12');
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    expect(onBid).toHaveBeenCalledWith(12);
  });

  it('TC-B06 用户没改过时预填跟随 nextMinBid，手改后不再被覆盖', async () => {
    const user = userEvent.setup();
    const props = { mode: 'normal' as const, askPrice: 10, available: null, onBid: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<MarketBidForm {...props} nextMinBid={11} />);
    const input = screen.getByLabelText('出价（m）') as HTMLInputElement;
    // 预填 = 符合规则的最低出价（服务端 nextMinBid：无人出价 = ceil(askPrice)，有人出价 = ceil(最高价 + 1)）
    expect(input.value).toBe('11');

    rerender(<MarketBidForm {...props} nextMinBid={15} />);
    expect(input.value).toBe('15');

    await user.clear(input);
    await user.type(input, '20');
    rerender(<MarketBidForm {...props} nextMinBid={30} />);
    expect(input.value).toBe('20');
  });
});

// v6.57.0 动用预期收入提示：口径 = creditUse（出价 − (available − creditLine + 旧冻结)），
// 三态 = 正好够不显示 / 差一点显示 / 快照缺失不显示；oldHold 回加（抬价顶替）单独锁。
// 提示文案跨 JSX 节点，断言读 hint 的 textContent（不去匹配被换行拆开的花括号段）。
describe('MarketBidForm 动用预期收入提示（v6.57.0）', () => {
  const hintText = (): string => Array.from(document.querySelectorAll('span.hint')).map((el) => el.textContent ?? '').join('\n');

  it('差一点用额度：提示行出现且金额正确', async () => {
    const user = userEvent.setup();
    render(
      <MarketBidForm
        mode="normal"
        askPrice={10}
        nextMinBid={11}
        available={130}
        creditLine={40}
        onBid={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    // 预填 11：现金自由 90 ⇒ 11 不动用额度，无提示
    expect(hintText()).not.toContain('本次动用预期收入');
    const input = screen.getByLabelText('出价（m）');
    await user.clear(input);
    await user.type(input, '120');
    // 现金自由 90 ⇒ 动用 30（不是 120——120 是出价额）
    expect(hintText()).toContain('本次动用预期收入 30.00m');
    expect(hintText()).toContain('当前可支配 130.00m');
  });

  it('正好够（现金部分足够）与快照缺失：都不显示提示', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MarketBidForm mode="normal" askPrice={10} nextMinBid={11} available={130} creditLine={40} onBid={vi.fn().mockResolvedValue(undefined)} />,
    );
    let input = screen.getByLabelText('出价（m）');
    await user.clear(input);
    await user.type(input, '90');
    expect(hintText()).not.toContain('本次动用预期收入');

    rerender(
      <MarketBidForm mode="normal" askPrice={10} nextMinBid={11} available={null} creditLine={null} onBid={vi.fn().mockResolvedValue(undefined)} />,
    );
    input = screen.getByLabelText('出价（m）');
    await user.clear(input);
    await user.type(input, '120');
    expect(hintText()).not.toContain('本次动用预期收入');
  });

  it('oldHold 回加：抬价顶替旧冻结后按净差额算动用额', async () => {
    const user = userEvent.setup();
    render(
      <MarketBidForm
        mode="normal"
        askPrice={10}
        nextMinBid={11}
        available={130}
        creditLine={40}
        oldHold={30}
        onBid={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const input = screen.getByLabelText('出价（m）');
    await user.clear(input);
    // 净差额基准 = 90 + 30 = 120：出 120 动用 0（不回加会误报动用 30）
    await user.type(input, '120');
    expect(hintText()).not.toContain('本次动用预期收入');
    await user.clear(input);
    await user.type(input, '140');
    expect(hintText()).toContain('本次动用预期收入 20.00m');
  });
});
