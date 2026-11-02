// @vitest-environment jsdom
// v6.69.0：PlayStyles 图鉴页。36 条基础项按六类分组，每条双图标 + 中英名 + 定位句 + 银/金两档效果；
// 数据缺失时回落「暂无说明」而不是崩。入口本身在 TopBar 菜单里（另有用例）。
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Playstyles from './Playstyles.tsx';
import playstyleRef from '../../assets/ref/playstyle.json';

afterEach(cleanup);

describe('PlayStyles 图鉴页（v6.69.0）', () => {
  it('六类分组齐全，36 张卡一张不少', () => {
    const { container } = render(<Playstyles />);
    expect(Array.from(container.querySelectorAll('.ps-section h2'), (h) => h.textContent)).toEqual([
      '射门',
      '传球',
      '防守',
      '控球',
      '体格',
      '门将',
    ]);
    expect(container.querySelectorAll('.ps-card').length).toBe(36);
  });

  it('单卡：中英名、银/金两枚图标、定位句与两档效果都在', () => {
    const { container } = render(<Playstyles />);
    const card = Array.from(container.querySelectorAll('.ps-card')).find((el) =>
      el.querySelector('.ps-card-name strong')?.textContent === '精准搓射',
    )!;
    expect(card.querySelector('.ps-card-en')?.textContent).toBe('Finesse Shot');
    const icons = Array.from(card.querySelectorAll('img.ps-card-icon'), (img) => img.getAttribute('src'));
    expect(icons).toEqual(['/assets/icons/playstyles/1.webp', '/assets/icons/playstyles/101.webp']);
    expect(card.querySelector('.ps-card-info')?.textContent).toContain('搓向死角');
    const effects = Array.from(card.querySelectorAll('.ps-card-effects dd'), (dd) => dd.textContent);
    expect(effects[0]).toContain('弧线更强');
    expect(effects[1]).toContain('弧线拉满');
  });

  it('每张卡都有两枚图标与两档效果（没有漏写 desc 的条目）', () => {
    const { container } = render(<Playstyles />);
    for (const card of Array.from(container.querySelectorAll('.ps-card'))) {
      const name = card.querySelector('.ps-card-name strong')?.textContent;
      expect(card.querySelectorAll('img.ps-card-icon').length, name).toBe(2);
      expect(card.querySelectorAll('.ps-card-effects dd').length, name).toBe(2);
      expect(card.querySelector('.hint')?.textContent, name).not.toBe('暂无说明。');
    }
  });

  it('标题与口径说明在页头；基础项数量与 ref 表一致', () => {
    const bases = (playstyleRef as { id: number }[]).filter((r) => r.id > 0 && r.id < 100);
    render(<Playstyles />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PlayStyles 图鉴');
    expect(screen.getByText(/最多 12 枚银徽 \+ 3 枚金徽/)).toBeTruthy();
    expect(bases.length).toBe(36);
  });
});
