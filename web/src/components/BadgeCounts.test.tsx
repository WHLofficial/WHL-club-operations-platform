// @vitest-environment jsdom
// v6.35.0 徽章统一：计数的口径（金在前 / 零值抑制 / 三密度文案）在这一处钉死。
// 之前五种文案（🥇×n / 🥇 ×n / 🥇 n/3 / 金 n / n金）散在四页，顺序还有银在前的；
// 组件化后顺序与抑制规则只此一份，页面只选密度。
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BadgeCounts, badgeCountItems, badgeCountLabel } from './BadgeCounts.tsx';

afterEach(cleanup);

describe('badgeCountItems：金在前 + 零值抑制', () => {
  it('两枚都有：金在前', () => {
    expect(badgeCountItems(3, 2)).toEqual([
      { kind: 'gold', n: 2 },
      { kind: 'silver', n: 3 },
    ]);
  });

  it('零值抑制：0 金只出银、0 银只出金', () => {
    expect(badgeCountItems(3, 0)).toEqual([{ kind: 'silver', n: 3 }]);
    expect(badgeCountItems(0, 2)).toEqual([{ kind: 'gold', n: 2 }]);
  });

  it('两枚全 0 出空数组（调用方自己决定「—」还是「不加徽章」）', () => {
    expect(badgeCountItems(0, 0)).toEqual([]);
  });
});

describe('badgeCountLabel：三密度文案', () => {
  it('icon 用 emoji + × 计数，text / chip 用「数字在前 + 金/银」', () => {
    expect(badgeCountLabel('gold', 2, 'icon')).toBe('🥇×2');
    expect(badgeCountLabel('silver', 1, 'icon')).toBe('🥈×1');
    expect(badgeCountLabel('gold', 2, 'text')).toBe('2金');
    expect(badgeCountLabel('silver', 1, 'chip')).toBe('1银');
  });
});

describe('BadgeCounts 渲染', () => {
  it('icon 密度：两枚各带 title（符号读不出金/银），类名 badge-count badge-count-icon', () => {
    const { container } = render(<BadgeCounts silver={1} gold={2} density="icon" />);
    const spans = Array.from(container.querySelectorAll('span.badge-count'));
    expect(spans.map((el) => el.textContent)).toEqual(['🥇×2', '🥈×1']);
    expect(spans.map((el) => el.getAttribute('class'))).toEqual(['badge-count badge-count-icon', 'badge-count badge-count-icon']);
    expect(spans.map((el) => el.getAttribute('title'))).toEqual(['金徽章', '银徽章']);
  });

  it('text 密度：类名带金银（颜色走 token），不挂 title', () => {
    const { container } = render(<BadgeCounts silver={3} gold={2} density="text" />);
    const spans = Array.from(container.querySelectorAll('span.badge-count'));
    expect(spans.map((el) => el.textContent)).toEqual(['2金', '3银']);
    expect(spans.map((el) => el.getAttribute('class'))).toEqual([
      'badge-count badge-count-text-gold',
      'badge-count badge-count-text-silver',
    ]);
    expect(spans[0].getAttribute('title')).toBeNull();
  });

  it('chip 密度：走 badge-chip 底块类（原 lib-card-chip 家族）', () => {
    const { container } = render(<BadgeCounts silver={1} gold={1} density="chip" />);
    expect(container.querySelector('.badge-chip.badge-chip-gold')?.textContent).toBe('1金');
    expect(container.querySelector('.badge-chip.badge-chip-silver')?.textContent).toBe('1银');
  });

  it('全 0 不渲染任何节点', () => {
    const { container } = render(<BadgeCounts silver={0} gold={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('className 附到每枚计数上（对比页定宽），sep 换分隔符', () => {
    const { container } = render(
      <BadgeCounts silver={3} gold={2} density="text" className="cmp-badgecnt" sep={<span className="cmp-dt">·</span>} />,
    );
    const spans = Array.from(container.querySelectorAll('span.cmp-badgecnt'));
    expect(spans.map((el) => el.textContent)).toEqual(['2金', '3银']);
    expect(spans.map((el) => el.getAttribute('class'))).toEqual([
      'badge-count badge-count-text-gold cmp-badgecnt',
      'badge-count badge-count-text-silver cmp-badgecnt',
    ]);
    expect(container.querySelector('span.cmp-dt')?.textContent).toBe('·');
  });
});
