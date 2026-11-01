// @vitest-environment jsdom
// v6.67.0：审核队列里 match 单的摘要要能看出「原违约金」，否则「新 3m / 差额 2m」会被读成「差额 = 出价」。
// payload 由 activations.ts 冻结，只有 previousBid / newReleaseFee / diff，没有 oldReleaseFee ⇒ 用「新 − 差额」反算。
import { describe, expect, it } from 'vitest';
import type { AdminReviewRow } from '../../lib/api.ts';
import { bypassSummary } from './MarketPage.tsx';

function review(payload: Record<string, unknown>): AdminReviewRow {
  return { transfer: { type: 'match', player: { name: '中场丙' } }, payload } as unknown as AdminReviewRow;
}

describe('v6.67.0 审核队列摘要', () => {
  it('match：补出「原 Xm」（新 3 − 差额 2 = 1）', () => {
    expect(
      bypassSummary(review({ kind: 'match', previousBid: 2, newReleaseFee: 3, diff: 2 })),
    ).toBe('匹配留队：新违约金 3.00m（原 1.00m） > 出价 2.00m，回收差额 2.00m');
  });

  it('match：payload 缺字段时原值退化成「—」，不抛错', () => {
    expect(bypassSummary(review({ kind: 'match', previousBid: 2, newReleaseFee: 3 }))).toBe(
      '匹配留队：新违约金 3.00m（原 —） > 出价 2.00m，回收差额 —m',
    );
  });
});
