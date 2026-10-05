// @vitest-environment jsdom
// v6.35.0 位置热区图组件口径：12 块全在场、三态类名（heat-main/heat-sub/heat-off）、
// 拓扑几何照 spec §1.1（245×200 三列网格 + 底部梯形 GK 带）、aria 主位/副位摘要。
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PositionHeatmap } from './PositionHeatmap.tsx';
import { HEAT_GK_BAND, HEAT_SLOTS } from '../lib/heatmap.ts';

// vitest 没开 globals，Testing Library 的自动清理不会挂上，得自己来
afterEach(cleanup);

const renderHeat = (posCodes: readonly string[], isGk = false, className?: string) =>
  render(<PositionHeatmap posCodes={posCodes} isGk={isGk} className={className} />);

describe('PositionHeatmap 位置热区图', () => {
  it('12 块全在场：viewBox 245×200、图底 + GK 梯形带 + 12 块与 12 个缩写', () => {
    const { container } = renderHeat(['ST']);
    const svg = container.querySelector('svg.heat-svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 245 200');
    expect(svg.getAttribute('role')).toBe('img');
    expect(container.querySelector('rect.heat-pitch')!.getAttribute('rx')).toBe('8');
    expect(container.querySelector('polygon.heat-band')!.getAttribute('points')).toBe(HEAT_GK_BAND);
    expect(container.querySelectorAll('rect.heat-block')).toHaveLength(12);
    expect(container.querySelectorAll('text.heat-code')).toHaveLength(12);
    expect(Array.from(container.querySelectorAll('text.heat-code'), (el) => el.textContent)).toEqual(
      HEAT_SLOTS.map((s) => s.code),
    );
  });

  it('块几何照拓扑：抽查 LW/ST/GK 三块坐标与尺寸', () => {
    const { container } = renderHeat(['ST']);
    const rectOf = (code: string) => {
      const slot = HEAT_SLOTS.find((s) => s.code === code)!;
      return container.querySelectorAll('rect.heat-block')[HEAT_SLOTS.indexOf(slot)];
    };
    for (const code of ['LW', 'ST', 'GK']) {
      const slot = HEAT_SLOTS.find((s) => s.code === code)!;
      const rect = rectOf(code);
      expect(
        [rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')],
        code,
      ).toEqual([String(slot.x), String(slot.y), String(slot.w), String(slot.h)]);
    }
  });

  it('三态着色：主位一块 heat-main、其余位置码 heat-sub、未踢 heat-off', () => {
    const { container } = renderHeat(['ST', 'CAM', 'RW']);
    expect(container.querySelectorAll('rect.heat-block.heat-main')).toHaveLength(1);
    expect(container.querySelectorAll('rect.heat-block.heat-sub')).toHaveLength(2);
    expect(container.querySelectorAll('rect.heat-block.heat-off')).toHaveLength(9);
    const mainCode = container.querySelector('text.heat-code.heat-main')!;
    expect(mainCode.textContent).toBe('ST');
    // 块与缩写同态：类名一致
    expect(container.querySelector('rect.heat-block.heat-main')!.getAttribute('class')).toBe('heat-block heat-main');
  });

  it('纯门将只有 GK 块主位绿、其余 11 块淡显', () => {
    const { container } = renderHeat(['GK'], true);
    expect(container.querySelectorAll('rect.heat-block.heat-main')).toHaveLength(1);
    expect(container.querySelector('text.heat-code.heat-main')!.textContent).toBe('GK');
    expect(container.querySelectorAll('rect.heat-block.heat-off')).toHaveLength(11);
    expect(container.querySelector('svg.heat-svg')!.getAttribute('aria-label')).toBe('位置热区图（主位 GK）');
  });

  it('兼场门将 GK 主位、场员位副位', () => {
    const { container } = renderHeat(['GK', 'CB'], true);
    const mains = Array.from(container.querySelectorAll('text.heat-code.heat-main'), (el) => el.textContent);
    const subs = Array.from(container.querySelectorAll('text.heat-code.heat-sub'), (el) => el.textContent);
    expect(mains).toEqual(['GK']);
    expect(subs).toEqual(['CB']);
  });

  it('空位置码：12 块全淡显、aria 摘要说明无位置数据', () => {
    const { container } = renderHeat([]);
    expect(container.querySelectorAll('rect.heat-block.heat-off')).toHaveLength(12);
    expect(container.querySelector('svg.heat-svg')!.getAttribute('aria-label')).toBe('位置热区图（无位置数据）');
  });

  it('aria 摘要按位置码优先级列出主位与副位', () => {
    const { container } = renderHeat(['CAM', 'ST', 'LW', 'RW']);
    expect(container.querySelector('svg.heat-svg')!.getAttribute('aria-label')).toBe(
      '位置热区图（主位 CAM，副位 ST、LW、RW）',
    );
  });

  it('className 透传（对比页需要自己的宽度约束）', () => {
    const { container } = renderHeat(['ST'], false, 'cmp-heatmap');
    expect(container.querySelector('svg.heat-svg')!.getAttribute('class')).toBe('heat-svg cmp-heatmap');
  });
});
