// @vitest-environment jsdom
// v6.24.0 批次 B 卡片口径（TC-B03）：状态徽标三态统一——只看挂单状态与首价窗，不看是否已有人出价；
// 顺带锁住 rail 骨架的 CA/PA 五档配色挂类与底部读秒文案。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { MarketListing } from '../../lib/api.ts';
import { MarketCard } from './MarketBoardPage.tsx';

function listing(patch: Partial<MarketListing> = {}): MarketListing {
  return {
    id: 1,
    player: { id: 9, fcId: null, name: '测试球员', position: 'ST', age: 21, ca: 51, pa: 82 },
    sellerClub: { id: 3, name: '卖方俱乐部' },
    type: 'normal',
    askPrice: 12,
    status: 'listed',
    listedAt: '2025-12-31T00:00:00.000Z',
    lastBidAt: null,
    bidPaused: false,
    highestBid: null,
    highestBidder: null,
    bidCount: 0,
    activatedBy: null,
    activationDeadline: null,
    matchDeadline: null,
    matchPhase: null,
    firstBidPending: false,
    deadlineAt: null,
    deadlineNote: null,
    ...patch,
  };
}

function renderCard(l: MarketListing) {
  return render(
    <MemoryRouter>
      <MarketCard listing={l} mine={false} onOpen={() => {}} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('MarketCard 状态徽标三态（TC-B03）', () => {
  it('listed 已有人出价仍是「竞价中」——徽标不看有没有人出价', () => {
    renderCard(listing({ status: 'listed', highestBid: 99, highestBidder: { id: 4, name: '别家' }, bidCount: 3 }));
    expect(screen.getByText('竞价中')).toBeTruthy();
    expect(screen.queryByText('等激活方出价')).toBeNull();
    expect(screen.queryByText('等待匹配')).toBeNull();
  });

  it('listed 无人出价也是「竞价中」——没出价不等于在等激活方', () => {
    renderCard(listing({ status: 'listed', highestBid: null, bidCount: 0 }));
    expect(screen.getByText('竞价中')).toBeTruthy();
    expect(screen.queryByText('等激活方出价')).toBeNull();
  });

  it('bidding 也是「竞价中」', () => {
    renderCard(listing({ status: 'bidding', highestBid: 20, bidCount: 1 }));
    expect(screen.getByText('竞价中')).toBeTruthy();
  });

  it('激活首价窗（activation + listed + 已有激活方）显示「等激活方出价」', () => {
    renderCard(
      listing({
        type: 'activation',
        status: 'listed',
        activatedBy: 7,
        firstBidPending: true,
        activationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
    expect(screen.getByText('等激活方出价')).toBeTruthy();
    expect(screen.queryByText('竞价中')).toBeNull();
  });

  it('matched_pending 显示「等待匹配」', () => {
    renderCard(listing({ status: 'matched_pending', matchPhase: 'matching', matchDeadline: new Date(Date.now() + 3600_000).toISOString() }));
    expect(screen.getByText('等待匹配')).toBeTruthy();
  });
});

describe('MarketCard rail 与读秒（v6.24.0）', () => {
  it('CA/PA 挂五档配色类，底部是 hh:mm:ss 读秒而不是「截止」文案', () => {
    renderCard(listing({ deadlineAt: new Date(Date.now() + 3600_000).toISOString() }));
    expect(screen.getByText('51').className).toContain('attr-weak');
    expect(screen.getByText('82').className).toContain('attr-good');
    expect(screen.getByText(/^⏱ 剩 \d{2}:\d{2}:\d{2}$/)).toBeTruthy();
    expect(screen.queryByText(/截止/)).toBeNull();
  });

  it('没有截止时刻时读秒位置显示占位', () => {
    renderCard(listing({ deadlineAt: null }));
    expect(screen.getByText('⏱ 剩 —')).toBeTruthy();
  });

  it('队名与卖方 logo 同排出现在卡脚', () => {
    renderCard(listing());
    expect(screen.getByText('卖方俱乐部')).toBeTruthy();
  });
});
