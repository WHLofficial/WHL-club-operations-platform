// @vitest-environment jsdom
// v6.34.0 球员对比：PlaystyleBadge 自 Player.tsx 提取为共享件后的口径回归（两页行为零变化的锁）。
// 硬口径：金徽 = `ps-badge ps-gold` + 🥇 + title 带「（金）」；银徽 = 只 `ps-badge` + 🥈 + title 原样；
// 名称查 playstyle.json（金徽存库 id = 基础 id + 100），查不到回落 `PS {psid}`。
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlaystyleBadge } from './PlaystyleBadge.tsx';

// vitest 没开 globals，Testing Library 的自动清理不会挂上，得自己来
afterEach(cleanup);

describe('PlaystyleBadge 共享件（提取后行为零变化）', () => {
  it('金徽：ps-badge ps-gold ＋🥇＋「（金）」title＋金段图标', () => {
    const { container } = render(<PlaystyleBadge psid={101} gold />);
    const badge = container.querySelector('.ps-badge')!;
    expect(badge.getAttribute('class')).toBe('ps-badge ps-gold');
    expect(badge.getAttribute('title')).toBe('精准搓射 +（金）');
    const img = badge.querySelector('img.ps-icon')!;
    expect(img.getAttribute('src')).toBe('/assets/icons/playstyles/101.webp');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(Array.from(badge.querySelectorAll('span[aria-hidden="true"]'), (el) => el.textContent)).toEqual(['🥇']);
    expect(badge.textContent).toBe('🥇精准搓射 +');
  });

  it('银徽：只 ps-badge ＋🥈＋ title 不加后缀', () => {
    const { container } = render(<PlaystyleBadge psid={1} gold={false} />);
    const badge = container.querySelector('.ps-badge')!;
    expect(badge.getAttribute('class')).toBe('ps-badge');
    expect(badge.getAttribute('title')).toBe('精准搓射');
    expect(badge.querySelector('img.ps-icon')!.getAttribute('src')).toBe('/assets/icons/playstyles/1.webp');
    expect(badge.textContent).toBe('🥈精准搓射');
  });

  it('ref 表查不到时回落 `PS {psid}`：仍渲染徽章，图标照挂', () => {
    const { container } = render(<PlaystyleBadge psid={9999} gold={false} />);
    const badge = container.querySelector('.ps-badge')!;
    expect(badge.getAttribute('title')).toBe('PS 9999');
    expect(badge.textContent).toBe('🥈PS 9999');
  });
});

// v6.35.0：表格 ps 列的 compact 形态。与整徽的差别只有「不拉 webp 图标、不铺 pill 底」，
// 名称/金标记/title 口径仍同源；类名独立（ps-badge-compact），银徽不上色。
describe('PlaystyleBadge compact（表格 ps 列）', () => {
  it('银徽：只 ps-badge-compact，无图标、无 img', () => {
    const { container } = render(<PlaystyleBadge psid={1} gold={false} compact />);
    const badge = container.querySelector('.ps-badge-compact')!;
    expect(badge.getAttribute('class')).toBe('ps-badge-compact');
    expect(badge.getAttribute('title')).toBe('精准搓射');
    expect(badge.querySelector('img')).toBeNull();
    expect(badge.querySelector('.ps-badge')).toBeNull();
    expect(Array.from(badge.querySelectorAll('span[aria-hidden="true"]'), (el) => el.textContent)).toEqual(['🥈']);
    expect(badge.textContent).toBe('🥈精准搓射');
  });

  it('金徽：多一枚 ps-badge-compact-gold（底色走 --badge-gold-* token）＋🥇＋「（金）」title', () => {
    const { container } = render(<PlaystyleBadge psid={3} gold compact />);
    const badge = container.querySelector('.ps-badge-compact')!;
    expect(badge.getAttribute('class')).toBe('ps-badge-compact ps-badge-compact-gold');
    expect(badge.getAttribute('title')).toBe('大力射门（金）');
    expect(badge.textContent).toBe('🥇大力射门');
  });
});
