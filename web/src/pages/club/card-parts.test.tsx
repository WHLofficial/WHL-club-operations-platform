// @vitest-environment jsdom
// v6.37.2：+N 徽章从 span 改 button——手机没有 hover，原先只挂一条 title 等于死元素。
// 渲染契约（1+N 折叠、点击展开全量、再点收回、aria 属性）在这一处钉死。
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardBadges } from './card-parts.tsx';

afterEach(cleanup);

const badges = [
  { kind: 'status' as const, text: '挂牌中' },
  { kind: 'protect' as const, text: '保护期' },
  { kind: 'star' as const, text: '未来之星' },
];

describe('CardBadges 的 +N 展开（v6.37.2）', () => {
  it('收起只显首枚 +N（title 带全量）；点击展开全部徽章，再点收回', () => {
    const { container } = render(<CardBadges badges={badges} />);
    expect(container.querySelectorAll('.sqc-badge')).toHaveLength(2);
    const more = container.querySelector('button.sqc-badge-more') as HTMLButtonElement;
    expect(more).toBeTruthy();
    expect(more.textContent).toBe('+2');
    expect(more.getAttribute('title')).toBe('保护期、未来之星');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.getAttribute('aria-label')).toBe('展开其余 2 枚徽章');

    fireEvent.click(more);
    expect(Array.from(container.querySelectorAll('.sqc-badge'), (el) => el.textContent)).toEqual([
      '挂牌中',
      '保护期',
      '未来之星',
      '收起',
    ]);
    const back = container.querySelector('button.sqc-badge-more') as HTMLButtonElement;
    expect(back.getAttribute('aria-expanded')).toBe('true');
    expect(back.getAttribute('aria-label')).toBe('收回其余 2 枚徽章');

    fireEvent.click(back);
    expect(Array.from(container.querySelectorAll('.sqc-badge'), (el) => el.textContent)).toEqual(['挂牌中', '+2']);
  });

  it('无折叠（只有首枚）不渲染 button；空徽章且无 extra 整块不渲染', () => {
    const { container } = render(<CardBadges badges={badges.slice(0, 1)} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('.sqc-badge')).toHaveLength(1);

    const empty = render(<CardBadges badges={[]} />);
    expect(empty.container.innerHTML).toBe('');
  });
});
