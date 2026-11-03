// @vitest-environment jsdom
// v6.34.0 球员对比：PlaystyleBadge 自 Player.tsx 提取为共享件后的口径回归。
// 硬口径：金徽 = `ps-badge ps-gold` + 🥇 + title 带「（金）」；银徽 = 只 `ps-badge` + 🥈 +
// title 带「（银）」（v6.63.0 起金银同构）；名称查 playstyle.json（金徽存库 id = 基础 id + 100），
// 查不到回落 `PS {psid}`。v6.63.0 来源角标：source 非 'fc' 在 pill 尾部挂小标、title 追加全称。
// v6.69.0：整徽 title 追加定位句 + 当前档位效果；openable 在窄屏变按钮并弹 PlaystyleSheet。
// v6.74.1：整徽不再叠 🥇/🥈（图标即档位），图标 404 时才退回 emoji；门将图标多 ps-icon-gk。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlaystyleBadge } from './PlaystyleBadge.tsx';

// vitest 没开 globals，Testing Library 的自动清理不会挂上，得自己来
afterEach(cleanup);

const DESC_1 = '擅长在射门时寻找角度、把球搓向死角的球员。';
const SILVER_1 = '搓射出手更快，弧线更强、精度更高。';
const GOLD_1 = '搓射出手明显更快，弧线拉满，精度极佳。';

/** jsdom 没有 matchMedia，按断点结果给一份最小桩（hook 只读 matches / 订阅 change） */
function mockMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('PlaystyleBadge 共享件（提取后行为零变化）', () => {
  it('金徽：ps-badge ps-gold ＋「（金）」title＋金档图标（v6.74.1 不再叠 🥇）', () => {
    const { container } = render(<PlaystyleBadge psid={101} gold />);
    const badge = container.querySelector('.ps-badge')!;
    expect(badge.getAttribute('class')).toBe('ps-badge ps-gold');
    expect(badge.getAttribute('title')).toBe(`精准搓射 +（金）\n${DESC_1}\n金：${GOLD_1}`);
    const img = badge.querySelector('img.ps-icon')!;
    expect(img.getAttribute('src')).toBe('/assets/icons/playstyles/101.webp');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('class')).toBe('ps-icon ps-icon-gold');
    expect(badge.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    expect(badge.textContent).toBe('精准搓射 +');
  });

  it('银徽：只 ps-badge ＋ title 带（银）标记＋银档图标', () => {
    const { container } = render(<PlaystyleBadge psid={1} gold={false} />);
    const badge = container.querySelector('.ps-badge')!;
    expect(badge.getAttribute('class')).toBe('ps-badge');
    expect(badge.getAttribute('title')).toBe(`精准搓射（银）\n${DESC_1}\n银：${SILVER_1}`);
    const img = badge.querySelector('img.ps-icon')!;
    expect(img.getAttribute('src')).toBe('/assets/icons/playstyles/1.webp');
    expect(img.getAttribute('class')).toBe('ps-icon ps-icon-silver');
    expect(badge.textContent).toBe('精准搓射');
  });

  it('ref 表查不到时回落 `PS {psid}`：仍渲染徽章，图标照挂', () => {
    const { container } = render(<PlaystyleBadge psid={9999} gold={false} />);
    const badge = container.querySelector('.ps-badge')!;
    expect(badge.getAttribute('title')).toBe('PS 9999（银）');
    expect(badge.textContent).toBe('PS 9999');
  });

  it('门将素材（51-56）多一枚 ps-icon-gk：图标换成黑底白字那套 filter', () => {
    const { container } = render(<PlaystyleBadge psid={51} gold={false} />);
    expect(container.querySelector('img.ps-icon')!.getAttribute('class')).toBe('ps-icon ps-icon-silver ps-icon-gk');
    const gold = render(<PlaystyleBadge psid={151} gold />);
    expect(gold.container.querySelector('img.ps-icon')!.getAttribute('class')).toBe('ps-icon ps-icon-gold ps-icon-gk');
  });

  it('图标 404 时退回 🥇/🥈，档位不至于丢（v6.74.1）', () => {
    const { container } = render(<PlaystyleBadge psid={101} gold />);
    const badge = container.querySelector('.ps-badge')!;
    fireEvent.error(badge.querySelector('img.ps-icon')!);
    expect(badge.querySelector('img')).toBeNull();
    expect(Array.from(badge.querySelectorAll('span[aria-hidden="true"]'), (el) => el.textContent)).toEqual(['🥇']);
    expect(badge.textContent).toBe('🥇精准搓射 +');
  });

  it('来源角标（v6.63.0）：非 fc 来源挂小标、title 追加全称；fc 与未传都不挂', () => {
    const { container } = render(<PlaystyleBadge psid={1} gold={false} source="growth" />);
    const badge = container.querySelector('.ps-badge')!;
    expect(badge.getAttribute('title')).toBe(`精准搓射（银） · 来源：成长\n${DESC_1}\n银：${SILVER_1}`);
    expect(badge.querySelector('.ps-badge-source')?.textContent).toBe('成长');
    const fc = render(<PlaystyleBadge psid={1} gold={false} source="fc" />);
    expect(fc.container.querySelector('.ps-badge-source')).toBeNull();
    expect(fc.container.querySelector('.ps-badge')!.getAttribute('title')).toBe(`精准搓射（银）\n${DESC_1}\n银：${SILVER_1}`);
    const none = render(<PlaystyleBadge psid={1} gold={false} />);
    expect(none.container.querySelector('.ps-badge-source')).toBeNull();
  });
});

// v6.35.0：表格 ps 列的 compact 形态。与整徽的差别只有「不拉 webp 图标、不铺 pill 底」，
// 名称/金标记/title 口径仍同源；类名独立（ps-badge-compact），银徽不上色；compact 不标来源（Q2）。
describe('PlaystyleBadge compact（表格 ps 列）', () => {
  it('银徽：只 ps-badge-compact，无图标、无 img', () => {
    const { container } = render(<PlaystyleBadge psid={1} gold={false} compact />);
    const badge = container.querySelector('.ps-badge-compact')!;
    expect(badge.getAttribute('class')).toBe('ps-badge-compact');
    expect(badge.getAttribute('title')).toBe('精准搓射（银）');
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

  it('compact 不标来源：source 传入也只进 title 不出角标（Q2：表格 compact 列不标）', () => {
    const { container } = render(<PlaystyleBadge psid={1} gold={false} compact source="shop" />);
    expect(container.querySelector('.ps-badge-source')).toBeNull();
    expect(container.querySelector('.ps-badge-compact')!.getAttribute('title')).toBe('精准搓射（银） · 来源：商店');
  });
});

// v6.69.0：窄屏（≤640px）没有 hover，openable 的整徽改成按钮，点开底部 sheet 看三段文案；
// 桌面宽屏仍渲染 span + 原生 title。compact 永远不变成按钮。
describe('PlaystyleBadge openable（v6.69.0 窄屏说明）', () => {
  it('窄屏：渲染 button，点击弹出 dialog，含定位句与银/金两档效果', () => {
    mockMatchMedia(true);
    render(<PlaystyleBadge psid={1} gold={false} openable />);
    const btn = screen.getByRole('button', { name: /精准搓射/ });
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    const dialog = screen.getByRole('dialog', { name: '精准搓射 说明' });
    expect(dialog.textContent).toContain(DESC_1);
    expect(dialog.textContent).toContain(`🥈 银徽${SILVER_1}`);
    expect(dialog.textContent).toContain(`🥇 金徽${GOLD_1}`);
  });

  it('窄屏：金徽按钮打开的 sheet 高亮金档', () => {
    mockMatchMedia(true);
    render(<PlaystyleBadge psid={101} gold openable />);
    fireEvent.click(screen.getByRole('button', { name: /精准搓射 \+/ }));
    const dialog = screen.getByRole('dialog');
    const gold = dialog.querySelector('.ps-sheet-effects > div.on')!;
    expect(gold.textContent).toContain(GOLD_1);
  });

  it('关闭：Esc 与关闭键都能收起；遮罩点击也能收起', () => {
    mockMatchMedia(true);
    const { container } = render(<PlaystyleBadge psid={1} gold={false} openable />);
    const btn = screen.getByRole('button', { name: /精准搓射/ });
    fireEvent.click(btn);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement, '关弹层后焦点回到触发徽章').toBe(btn);

    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(btn);
    fireEvent.click(container.querySelector('.ps-sheet-overlay')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('桌面宽屏：openable 仍是 span（原生 title 可读），不渲染按钮', () => {
    mockMatchMedia(false);
    render(<PlaystyleBadge psid={1} gold={false} openable />);
    expect(screen.queryByRole('button', { name: /精准搓射/ })).toBeNull();
    expect(screen.getByTitle(/精准搓射（银）/).tagName).toBe('SPAN');
  });

  it('compact + openable：表格形态永远不变成按钮', () => {
    mockMatchMedia(true);
    const { container } = render(<PlaystyleBadge psid={1} gold={false} compact openable />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.ps-badge-compact')).not.toBeNull();
  });
});
