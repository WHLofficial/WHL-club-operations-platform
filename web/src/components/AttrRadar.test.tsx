// @vitest-environment jsdom
// v6.35.0 雷达泛化口径：head/big/small/mini 四变体共享一件。
// 硬口径：head = 轴名 + 数值（数值走 attrClass 五档色）、五档环带（边界 99/80/70/60/50、半径 v/99×R）；
// 归一分母 99（单轴 99 落满刻度）；全 0/null 不画数据多边形；big/small 多序列带本命色、只出键名；mini 无文字无点。
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttrRadar } from './AttrRadar.tsx';
import { attrClass } from '../lib/players-library.ts';
import { axesFor } from '../lib/radar.ts';

// vitest 没开 globals，Testing Library 的自动清理不会挂上，得自己来
afterEach(cleanup);

// 外场六轴（键序与 ATTR_GROUPS.slice(0,6) 一致：PAC/SHO/PAS/DRI/DEF/PHY）
const OUT_AXES = axesFor(false);
const OUT_VALUES = [82, 74, 68, 80, 45, 76];
// 门将六轴（radar.ts GK_RADAR 的键序：DIV/HAN/KIC/REF/POS/SPD）
const GK_AXES = axesFor(true);
const GK_VALUES = [88, 81, 75, 90, 79, 65];
// 环带五档色（外→内：绿/榈绿/琥珀金/橙/红）
const BAND_COLORS = ['#2b8a3e', '#66a80f', '#b7892b', '#fd7e14', '#e03131'];
// jsdom 把内联样式的 hex 归一成 rgb()，断言前先转（与 PlayerCompare.test.tsx 的 hexToRgb 同口径）；
// 内联样式要 SVGElement（Element 上没有 style）
const rgb = (hex: string) =>
  `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const svgEls = (root: HTMLElement, sel: string) => Array.from(root.querySelectorAll(sel), (el) => el as SVGElement);

const head = (values: readonly (number | null)[]) =>
  render(<AttrRadar axes={OUT_AXES} series={[{ values }]} variant="head" ariaLabel="六维雷达" />);

describe('AttrRadar head 变体（属性页签头部）', () => {
  it('轴标＝三字母键名＋数值，数值逐格套 attrClass 五档色', () => {
    const { container } = head(OUT_VALUES);
    const svg = container.querySelector('svg.radar-svg')!;
    expect(svg.getAttribute('class')).toBe('radar-svg radar-svg-head');
    expect(svg.getAttribute('viewBox')).toBe('0 0 232 156');
    expect(svg.getAttribute('aria-label')).toBe('六维雷达');
    expect(Array.from(container.querySelectorAll('.radar-axis-key'), (el) => el.textContent)).toEqual([
      'PAC',
      'SHO',
      'PAS',
      'DRI',
      'DEF',
      'PHY',
    ]);
    const vals = Array.from(container.querySelectorAll('.radar-axis-val'));
    expect(vals.map((el) => el.textContent)).toEqual(['82', '74', '68', '80', '45', '76']);
    // 数值档色逐格＝attrClass 五档（口径来自 players-library，与页面同一份）；
    // SVG 元素的 className 是 SVGAnimatedString，得取 class 属性
    for (const [i, v] of OUT_VALUES.entries()) {
      expect(vals[i].getAttribute('class'), String(v)).toBe(`radar-axis-val ${attrClass(v)}`);
    }
  });

  it('五档环带：边界 99/80/70/60/50，半径 v/99×R，外→内档色', () => {
    const { container } = head(OUT_VALUES);
    const bands = svgEls(container, 'polygon.radar-band');
    expect(bands).toHaveLength(5);
    expect(bands.map((el) => el.style.fill)).toEqual(BAND_COLORS.map(rgb));
    expect(bands.map((el) => el.style.stroke)).toEqual(BAND_COLORS.map(rgb));
    // 顶环＝外框：轴位 0 在正上方，半径 48 ⇒ (116.00,30.00)；80 分位环半径 80/99×48
    expect(bands[0].getAttribute('points')!.split(' ')[0]).toBe('116.00,30.00');
    expect(bands[1].getAttribute('points')!.split(' ')[0]).toBe(`116.00,${(78 - (80 / 99) * 48).toFixed(2)}`);
    expect(container.querySelectorAll('line.radar-axis')).toHaveLength(6);
    expect(container.querySelectorAll('polygon.radar-data')).toHaveLength(1);
    expect(container.querySelectorAll('circle.radar-dot')).toHaveLength(6);
  });

  it('全 0 不画数据多边形与白点：环带与轴线照画', () => {
    const { container } = head(OUT_VALUES.map(() => 0));
    expect(container.querySelectorAll('polygon.radar-band')).toHaveLength(5);
    expect(container.querySelector('polygon.radar-data')).toBeNull();
    expect(container.querySelector('circle.radar-dot')).toBeNull();
  });

  it('单轴 99 归一满意：数据点与白点落 R=48 满刻度，其余轴归到圆心、超 99 同点', () => {
    const { container } = head(OUT_VALUES.map((_, i) => (i === 0 ? 99 : 0)));
    const pts = container.querySelector('polygon.radar-data')!.getAttribute('points')!.split(' ');
    // 轴位 0 在正上方（-π/2）：中心 (116,78)＋R=48 ⇒ (116.00, 30.00)
    expect(pts[0]).toBe('116.00,30.00');
    // 其余值为 0 ⇒ 全部落圆心 (116,78)
    expect(pts.slice(1)).toEqual(['116.00,78.00', '116.00,78.00', '116.00,78.00', '116.00,78.00', '116.00,78.00']);
    const dots = container.querySelectorAll('circle.radar-dot');
    expect([dots[0].getAttribute('cx'), dots[0].getAttribute('cy')]).toEqual(['116.00', '30.00']);
    expect([dots[1].getAttribute('cx'), dots[1].getAttribute('cy')]).toEqual(['116.00', '78.00']);
    // 超上限（120）经钳制到与 99 同点
    const clamped = head(OUT_VALUES.map((_, i) => (i === 0 ? 120 : 0)));
    expect(clamped.container.querySelector('polygon.radar-data')!.getAttribute('points')!.split(' ')[0]).toBe('116.00,30.00');
  });

  it('GK 六轴传入时标签正确：DIV/HAN/KIC/REF/POS/SPD 六键＋数值', () => {
    const { container } = render(
      <AttrRadar axes={GK_AXES} series={[{ values: GK_VALUES }]} variant="head" ariaLabel="六维雷达" />,
    );
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

  it('缺失轴（null）：数值出「—」、不带档色、轴照画，数据与白点按 0 归一', () => {
    const { container } = head(OUT_VALUES.map((v, i) => (i >= 4 ? null : v)));
    const vals = Array.from(container.querySelectorAll('.radar-axis-val'));
    expect(vals.slice(4).map((el) => el.textContent)).toEqual(['—', '—']);
    expect(vals[4].getAttribute('class')).toBe('radar-axis-val');
    const pts = container.querySelector('polygon.radar-data')!.getAttribute('points')!.split(' ');
    expect(pts[4]).toBe('116.00,78.00');
    expect(pts[5]).toBe('116.00,78.00');
  });

  it('series 给 attrs 时按 groupAverage 现算组值（详情页路径，无 values）', () => {
    const { container } = render(
      <AttrRadar
        axes={OUT_AXES}
        series={[{ attrs: { sprintspeed: 60, acceleration: 80 } }]}
        variant="head"
        ariaLabel="六维雷达"
      />,
    );
    const vals = Array.from(container.querySelectorAll('.radar-axis-val'));
    expect(vals[0].textContent).toBe('70'); // PAC = 均(冲刺 60, 加速 80)
    expect(vals.slice(1).map((el) => el.textContent)).toEqual(['—', '—', '—', '—', '—']);
  });
});

describe('AttrRadar 对比页变体（big / small / mini）', () => {
  const cmpSeries = [
    { color: '#8e5426', values: OUT_VALUES },
    { color: '#37505e', values: [70, 70, 70, 70, 70, 70] },
  ];

  it('big：中性环带、多序列各带本命色数据多边形与白点、标签只出键名', () => {
    const { container } = render(
      <AttrRadar
        axes={OUT_AXES}
        series={cmpSeries}
        variant="big"
        bands="neutral"
        className="cmp-radar-big"
        ariaLabel="六维雷达（双色叠图）"
      />,
    );
    const svg = container.querySelector('svg.radar-svg')!;
    expect(svg.getAttribute('class')).toBe('radar-svg radar-svg-big cmp-radar-big');
    expect(svg.getAttribute('viewBox')).toBe('0 0 170 176');
    expect(svg.getAttribute('aria-label')).toBe('六维雷达（双色叠图）');
    // 中性环带：同一类名、无内联色（颜色在 CSS）
    const bands = svgEls(container, 'polygon.radar-band');
    expect(bands).toHaveLength(5);
    expect(bands.every((el) => el.getAttribute('class') === 'radar-band radar-band-neutral')).toBe(true);
    expect(bands.every((el) => el.style.fill === '')).toBe(true);
    // 两条序列：各自本命色 + 各 6 个白点（描边跟本命色）
    const polys = svgEls(container, 'polygon.radar-data');
    expect(polys.map((el) => el.style.stroke)).toEqual([rgb('#8e5426'), rgb('#37505e')]);
    expect(polys.map((el) => el.style.fill)).toEqual([rgb('#8e5426'), rgb('#37505e')]);
    const dots = svgEls(container, 'circle.radar-dot');
    expect(dots).toHaveLength(12);
    expect(dots.map((el) => el.style.stroke).slice(0, 6)).toEqual(Array.from({ length: 6 }, () => rgb('#8e5426')));
    // 标签只出键名（无数值 tspan）
    expect(container.querySelectorAll('.radar-axis-val')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll('.radar-axis-key'), (el) => el.textContent)).toEqual([
      'PAC',
      'SHO',
      'PAS',
      'DRI',
      'DEF',
      'PHY',
    ]);
  });

  it('small：viewBox 120×104、单序列、键名照出', () => {
    const { container } = render(
      <AttrRadar axes={OUT_AXES} series={[cmpSeries[0]]} variant="small" bands="neutral" className="cmp-radar-small" />,
    );
    const svg = container.querySelector('svg.radar-svg')!;
    expect(svg.getAttribute('class')).toBe('radar-svg radar-svg-small cmp-radar-small');
    expect(svg.getAttribute('viewBox')).toBe('0 0 120 104');
    expect(container.querySelectorAll('polygon.radar-data')).toHaveLength(1);
    expect(container.querySelectorAll('.radar-axis-key')).toHaveLength(6);
  });

  it('mini：无文字、无白点、aria-hidden 且不挂 role/label', () => {
    const { container } = render(
      <AttrRadar
        axes={OUT_AXES}
        series={[{ color: '#8e5426', values: OUT_VALUES }]}
        variant="mini"
        bands="neutral"
        className="cmp-bar-radar"
        ariaHidden
      />,
    );
    const svg = container.querySelector('svg.radar-svg')!;
    expect(svg.getAttribute('class')).toBe('radar-svg radar-svg-mini cmp-bar-radar');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('aria-label')).toBeNull();
    expect(container.querySelectorAll('text')).toHaveLength(0);
    expect(container.querySelectorAll('circle.radar-dot')).toHaveLength(0);
    expect(container.querySelectorAll('polygon.radar-data')).toHaveLength(1);
  });

  it('多序列里有全 0 的一条：该条不画多边形，其余照画', () => {
    const { container } = render(
      <AttrRadar
        axes={OUT_AXES}
        series={[{ color: '#8e5426', values: OUT_VALUES }, { color: '#37505e', values: OUT_VALUES.map(() => 0) }]}
        variant="big"
        bands="neutral"
      />,
    );
    expect(container.querySelectorAll('polygon.radar-data')).toHaveLength(1);
  });
});
