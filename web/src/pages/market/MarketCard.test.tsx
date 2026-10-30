// @vitest-environment jsdom
// v6.24.0 批次 B 卡片口径（TC-B03）：状态徽标三态统一——只看挂单状态与首价窗，不看是否已有人出价；
// 顺带锁住 rail 骨架的 CA/PA 五档配色挂类与底部读秒文案。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function renderCard(
  l: MarketListing,
  logoOf?: (clubId: number | null) => string | null,
  onPrefetch?: () => void,
) {
  return render(
    <MemoryRouter>
      <MarketCard listing={l} mine={false} logoOf={logoOf} onPrefetch={onPrefetch} onOpen={() => {}} />
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
});

// v6.60.8：卡脚右侧从卖方改成当前领先买家（卖方身份由卡头的队徽承担）
describe('MarketCard 卡脚领先买家（v6.60.8）', () => {
  it('有出价时卡脚右侧是领先买家，不再重复卖方队名', () => {
    renderCard(listing({ highestBid: 99, highestBidder: { id: 4, name: '领先俱乐部' }, bidCount: 2 }));
    expect(screen.getByText('领先俱乐部')).toBeTruthy();
    expect(screen.queryByText('卖方俱乐部')).toBeNull();
  });

  it('无人出价时卡脚右侧给占位文案，不拿卖方名充数', () => {
    renderCard(listing());
    expect(screen.getByText('无人领先')).toBeTruthy();
    expect(screen.queryByText('卖方俱乐部')).toBeNull();
  });

  it('卖方与领先买家的队徽都吃 club_id → logoKey 映射，不再回落色块', () => {
    const { container } = renderCard(
      listing({ highestBid: 99, highestBidder: { id: 4, name: '领先俱乐部' }, bidCount: 2 }),
      (clubId) => (clubId === null ? null : `club-${clubId}.png`),
    );
    expect(screen.getByAltText('卖方俱乐部').getAttribute('src')).toBe('/api/media/club-3.png');
    expect(screen.getByAltText('领先俱乐部').getAttribute('src')).toBe('/api/media/club-4.png');
    expect(container.querySelectorAll('.team-logo-fallback').length).toBe(0);
  });

  it('映射缺 key 时才回落色块（自由身卖方 / 目录里没有的队）', () => {
    const { container } = renderCard(listing({ highestBid: 99, highestBidder: { id: 4, name: '领先俱乐部' }, bidCount: 2 }), () => null);
    expect(container.querySelectorAll('.team-logo-fallback').length).toBe(2);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

// v6.60.9：CA/PA 与价格三行包进 .mkt-card-mid，窄屏才有得换位（几何规则在 styles.css ≤760 块）
describe('MarketCard 中段容器（v6.60.9）', () => {
  it('rail 与价格三行同属 .mkt-card-mid，DOM 顺序仍是 CA/PA 在前（换位交给 CSS order）', () => {
    const { container } = renderCard(listing({ highestBid: 99, highestBidder: { id: 4, name: '领先俱乐部' }, bidCount: 2 }));
    const mid = container.querySelector('.mkt-card-mid');
    expect(mid).toBeTruthy();
    expect(mid!.children[0]!.className).toBe('mkt-rail');
    expect(mid!.children[1]!.className).toBe('mkt-rows');
    // 卡脚留在容器外，始终占整卡宽
    expect(mid!.querySelector('.mkt-card-foot')).toBeNull();
  });
});

// v6.60.8：浮层是点开才挂载的，详情请求原本也压到那一刻。卡片被指向 / 按下 / 聚焦时先预取，
// 点开时详情多半已在缓存（hook 侧口径见 queries.ts 的 useListingPrefetch）
describe('MarketCard 详情预取（v6.60.8）', () => {
  it('指针进入、按下、聚焦都触发预取，点击仍只负责开浮层', () => {
    const prefetched = vi.fn();
    let opened = 0;
    render(
      <MemoryRouter>
        <MarketCard listing={listing()} mine={false} onPrefetch={prefetched} onOpen={() => { opened += 1; }} />
      </MemoryRouter>,
    );
    const card = screen.getByRole('button');
    // React 的 onPointerEnter 是从 pointerover 合成出来的，所以这里发 pointerOver
    fireEvent.pointerOver(card);
    fireEvent.pointerDown(card);
    fireEvent.focus(card);
    expect(prefetched).toHaveBeenCalledTimes(3);
    expect(opened).toBe(0);
    fireEvent.click(card);
    expect(opened).toBe(1);
  });
});

// v6.60.10：强制拍卖单在卡柜里恒排最前（后端排序口径见 tests/market-listing-order.test.ts），
// 卡头再用一枚「强拍」徽标说清这单是管理端挂的，不是卖方自己挂的普通单
describe('MarketCard 强拍徽标（v6.60.10）', () => {
  it('type=forced 出「强拍」，普通单与激活单都不出', () => {
    const { unmount } = renderCard(listing({ type: 'forced' }));
    expect(screen.getByText('强拍')).toBeTruthy();
    unmount();

    const normal = renderCard(listing({ type: 'normal' }));
    expect(screen.queryByText('强拍')).toBeNull();
    normal.unmount();

    renderCard(listing({ type: 'activation', activatedBy: 4 }));
    expect(screen.queryByText('强拍')).toBeNull();
  });
});
