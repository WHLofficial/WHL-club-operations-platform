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
