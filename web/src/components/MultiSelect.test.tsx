// @vitest-environment jsdom
// 多选下拉（MultiSelect）的单测：开关、连点勾选不自动关、清空、Esc、点面板外。
// jsdom 没有 Popover API（HTMLElement.prototype.showPopover 不存在），组件会走非 top layer 的兜底路径 ——
// 面板照样按 position:fixed 渲染、事件路径一致，DOM 层面都能测；真 top layer 的「不被抽屉裁切」
// 只能在真浏览器里看（e2e）。
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MultiSelect, { panelPlacement, type MultiSelectItem } from './MultiSelect.tsx';

// vitest 没开 globals，Testing Library 的自动清理不会挂上，得自己来
afterEach(cleanup);

const ITEMS: MultiSelectItem[] = [
  { value: 'GK', label: 'GK' },
  { value: 'CB', label: 'CB' },
  { value: 'ST', label: 'ST' },
];

function Harness({ onClear, items = ITEMS }: { onClear?: () => void; items?: MultiSelectItem[] } = {}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <MultiSelect
      label="位置"
      items={items}
      selected={selected}
      onToggle={(v) => setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
      onClear={onClear ?? (() => setSelected([]))}
    />
  );
}

const panel = () => screen.queryByRole('group', { name: '位置' });

describe('多选下拉', () => {
  it('默认收起；点触发器打开、再点关掉', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '位置' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();

    await user.click(trigger);
    expect(panel()).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.click(trigger);
    expect(panel()).toBeNull();
  });

  it('连点多项不会自动关：勾两项后计数与 title 都跟上', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '位置' });
    await user.click(trigger);
    const box = panel() as HTMLElement;
    await user.click(within(box).getByRole('checkbox', { name: 'CB' }));
    await user.click(within(box).getByRole('checkbox', { name: 'ST' }));

    expect(panel()).not.toBeNull();
    expect(trigger.textContent).toContain('位置 · 2');
    expect(trigger.getAttribute('title')).toBe('位置：CB、ST');
    expect((within(panel() as HTMLElement).getByRole('checkbox', { name: 'CB' }) as HTMLInputElement).checked).toBe(true);

    // 再点一次取消
    await user.click(within(panel() as HTMLElement).getByRole('checkbox', { name: 'CB' }));
    expect(trigger.textContent).toContain('位置 · 1');
  });

  it('「清空」一键清掉全部选中，无选中时不可点', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<Harness onClear={onClear} />);
    const trigger = screen.getByRole('button', { name: '位置' });
    await user.click(trigger);
    expect((within(panel() as HTMLElement).getByRole('button', { name: '清空' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(panel() as HTMLElement).getByRole('checkbox', { name: 'GK' }));
    expect((within(panel() as HTMLElement).getByRole('button', { name: '清空' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(within(panel() as HTMLElement).getByRole('button', { name: '清空' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('Esc 关面板、把焦点还给触发器，并且把事件标记为已处理（抽屉不再跟着关一层）', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '位置' });
    await user.click(trigger);
    expect(document.activeElement).toBe(panel());

    let prevented: boolean | null = null;
    const observe = (e: KeyboardEvent) => {
      prevented = e.defaultPrevented;
    };
    document.addEventListener('keydown', observe);
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', observe);

    expect(prevented).toBe(true);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('点面板外关掉面板', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '位置' }));
    expect(panel()).not.toBeNull();

    await user.click(document.body);
    expect(panel()).toBeNull();
  });

  it('段与组标题按出现顺序渲染，换段即重开分组', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        items={[
          { value: '1', label: '精准搓射', section: '银徽章', group: '终结' },
          { value: '2', label: '外脚背', section: '银徽章', group: '终结' },
          { value: '3', label: '长传', section: '银徽章', group: '传球' },
          { value: '101', label: '精准搓射 +', section: '金徽章', group: '终结' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: '位置' }));
    const box = panel() as HTMLElement;
    expect([...box.querySelectorAll('.multiselect-section')].map((el) => el.textContent)).toEqual(['银徽章', '金徽章']);
    // 「终结」出现两次（银段一次、金段一次），不能并成一块
    expect([...box.querySelectorAll('.multiselect-group')].map((el) => el.textContent)).toEqual(['终结', '传球', '终结']);
  });
});

// 落位是纯函数（真实布局量不出来，所以 DOM 里测不了；真浏览器的落位由 e2e 断言）：
// 直接喂几何数字，覆盖「下方够放」「下方只剩一条缝」「上下都不够」三种情形。
describe('panelPlacement', () => {
  const view = { width: 375, height: 812 };

  it('下方空间充足：贴着触发器下沿展开，高度按可用空间给', () => {
    const at = panelPlacement({ top: 100, bottom: 134, left: 40 }, view, 320);
    expect(at.openUp).toBe(false);
    expect(at.top).toBe(140);
    expect(at.bottom).toBeUndefined();
    expect(at.maxHeight).toBe(812 - 134 - 6 - 8);
  });

  it('触发器贴近视口底部：翻到上方贴底，且不会掉出视口', () => {
    const at = panelPlacement({ top: 766, bottom: 800, left: 40 }, view, 320);
    expect(at.openUp).toBe(true);
    expect(at.top).toBeUndefined();
    expect(at.bottom).toBe(812 - 766 + 6);
    // 面板上沿 = 触发器上沿 − 6 − 高度，必须 ≥ 视口内的留白
    expect(at.maxHeight).toBe(766 - 6 - 8);
    expect(view.height - at.bottom! - at.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('下方只剩一条缝（旧实现在这里把面板压到 160 高、溢出视口）：同样翻上去', () => {
    // 触发器底边距视口底 74px ⇒ 下方可用 60px，远不到 MIN_PANEL_ROOM
    const at = panelPlacement({ top: 704, bottom: 738, left: 40 }, view, 320);
    expect(at.openUp).toBe(true);
    expect(at.maxHeight).toBe(704 - 6 - 8);
    expect(view.height - at.bottom! - at.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('上下都放不下（退化视口）：翻到空间较大的一侧，高度兜底到 160', () => {
    // 视口只有 120 高时两侧都不够：below=12 / above=46 ⇒ 取上方的 46，高度按兜底 160
    //（此时确实会溢出，属既定取舍：够不着比只剩一条缝好，真实视口不会这么矮）
    const at = panelPlacement({ top: 60, bottom: 94, left: 4 }, { width: 320, height: 120 }, 320);
    expect(at.openUp).toBe(true);
    expect(at.maxHeight).toBe(160);
    expect(at.left).toBe(8); // 左移不出视口
  });
});
