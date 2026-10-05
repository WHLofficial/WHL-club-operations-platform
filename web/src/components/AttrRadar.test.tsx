// @vitest-environment jsdom
// v6.34.0 球员对比：AttrRadar 自 Player.tsx 提取为共享件后的口径回归（详情页行为零变化的锁）。
// 硬口径：轴标＝三字母键名＋数值（数值走 attrClass 五档色）；全 0/null 不画数据多边形；
// 归一分母 99（单轴 99 落满刻度）；GK 六轴传入时标签照常渲染；缺失轴出「—」且按 0 归一。
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttrRadar } from './AttrRadar.tsx';
import { attrClass } from '../lib/players-library.ts';

// vitest 没开 globals，Testing Library 的自动清理不会挂上，得自己来
afterEach(cleanup);

// 外场六轴（键序与 ATTR_GROUPS.slice(0,6) 一致：PAC/SHO/PAS/DRI/DEF/PHY）
const OUT_FIELD = [
  { key: 'PAC', value: 82 },
  { key: 'SHO', value: 74 },
  { key: 'PAS', value: 68 },
  { key: 'DRI', value: 80 },
  { key: 'DEF', value: 45 },
  { key: 'PHY', value: 76 },
];

// 门将六轴（radar.ts GK_RADAR 的键序：DIV/HAN/KIC/REF/POS/SPD）
const GK_FIELD = [
  { key: 'DIV', value: 88 },
  { key: 'HAN', value: 81 },
  { key: 'KIC', value: 75 },
  { key: 'REF', value: 90 },
  { key: 'POS', value: 79 },
  { key: 'SPD', value: 65 },
];

describe('AttrRadar 六维雷达（提取共享件后行为零变化）', () => {
  it('六轴标签与数值渲染：轴标三字母、数值五档色、网格四环＋一条数据多边形', () => {
    const { container } = render(<AttrRadar values={OUT_FIELD} />);
    const svg = container.querySelector('svg.attr-radar-svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 232 156');
    expect(svg.getAttribute('aria-label')).toBe('六维雷达');
    const vals = Array.from(container.querySelectorAll('.radar-axis-val'));
    expect(Array.from(container.querySelectorAll('.radar-axis-key'), (el) => el.textContent)).toEqual([
      'PAC',
      'SHO',
      'PAS',
      'DRI',
      'DEF',
      'PHY',
    ]);
    expect(vals.map((el) => el.textContent)).toEqual(['82', '74', '68', '80', '45', '76']);
    // 数值档色逐格＝attrClass 五档（口径来自 players-library，与页面同一份）；
    // SVG 元素的 className 是 SVGAnimatedString，得取 class 属性
    for (const [i, v] of OUT_FIELD.entries()) {
      expect(vals[i].getAttribute('class'), v.key).toBe(`radar-axis-val ${attrClass(v.value)}`);
    }
    expect(container.querySelectorAll('polygon.radar-grid')).toHaveLength(4);
    expect(container.querySelectorAll('polygon.radar-data')).toHaveLength(1);
  });

  it('全 0 不画数据多边形：网格照画、无 polygon.radar-data', () => {
    const { container } = render(<AttrRadar values={OUT_FIELD.map((v) => ({ ...v, value: 0 }))} />);
    expect(container.querySelectorAll('polygon.radar-grid')).toHaveLength(4);
    expect(container.querySelector('polygon.radar-data')).toBeNull();
  });

  it('单轴 99 归一满意：数据点落 R=48 满刻度，其余轴归到圆心、超 99 同点', () => {
    const values = OUT_FIELD.map((v, i) => ({ ...v, value: i === 0 ? 99 : 0 }));
    const { container } = render(<AttrRadar values={values} />);
    const pts = container.querySelector('polygon.radar-data')!.getAttribute('points')!.split(' ');
    // 轴位 0 在正上方（-π/2）：中心 (116,78)＋R=48 ⇒ (116.00, 30.00)
    expect(pts[0]).toBe('116.00,30.00');
    // 其余值为 0 ⇒ 全部落圆心 (116,78)
    expect(pts.slice(1)).toEqual(['116.00,78.00', '116.00,78.00', '116.00,78.00', '116.00,78.00', '116.00,78.00']);
    // 超上限（120）经 min(max(v,0),99) 钳到与 99 同点
    const clamped = render(<AttrRadar values={OUT_FIELD.map((v, i) => ({ ...v, value: i === 0 ? 120 : 0 }))} />);
    expect(clamped.container.querySelector('polygon.radar-data')!.getAttribute('points')!.split(' ')[0]).toBe('116.00,30.00');
  });

  it('GK 轴传入时标签正确：DIV/HAN/KIC/REF/POS/SPD 六键＋数值', () => {
    const { container } = render(<AttrRadar values={GK_FIELD} />);
    expect(Array.from(container.querySelectorAll('.radar-axis-key'), (el) => el.textContent)).toEqual([
      'DIV',
      'HAN',
      'KIC',
      'REF',
      'POS',
      'SPD',
    ]);
    expect(Array.from(container.querySelectorAll('.radar-axis-val'), (el) => el.textContent)).toEqual([
      '88',
      '81',
      '75',
      '90',
      '79',
      '65',
    ]);
    expect(container.querySelectorAll('polygon.radar-data')).toHaveLength(1);
  });

  it('缺失轴（null）：数值出「—」、不带档色、轴照画，数据按 0 归一', () => {
    const values = OUT_FIELD.map((v, i) => ({ ...v, value: i >= 4 ? null : v.value }));
    const { container } = render(<AttrRadar values={values} />);
    const vals = Array.from(container.querySelectorAll('.radar-axis-val'));
    expect(vals.slice(4).map((el) => el.textContent)).toEqual(['—', '—']);
    expect(vals[4].getAttribute('class')).toBe('radar-axis-val');
    // 仍有正值 ⇒ 数据多边形在场；缺失轴的点落圆心
    const pts = container.querySelector('polygon.radar-data')!.getAttribute('points')!.split(' ');
    expect(pts[4]).toBe('116.00,78.00');
    expect(pts[5]).toBe('116.00,78.00');
  });
});
