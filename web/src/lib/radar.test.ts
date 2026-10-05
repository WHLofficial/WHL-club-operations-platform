// 雷达纯函数（web/src/lib/radar.ts）单测：口径自 pages/Player.tsx 提取，逐字锁定（含取整/钳制/小数边界）。
import { describe, expect, it } from 'vitest';
import { ATTR_GROUPS } from './ref.ts';
import { GK_RADAR, axesFor, axisValue, groupAverage, starText } from './radar.ts';

describe('GK_RADAR / axesFor（轴选择）', () => {
  it('门将六轴：键序 DIV/HAN/KIC/REF/POS/SPD，SPD 取 冲刺+加速 均值', () => {
    expect(GK_RADAR.map((a) => a.key)).toEqual(['DIV', 'HAN', 'KIC', 'REF', 'POS', 'SPD']);
    expect(GK_RADAR.map((a) => a.label)).toEqual(['扑救', '手型', '开球', '反应', '站位', '速度']);
    expect(GK_RADAR.find((a) => a.key === 'DIV')?.keys).toEqual(['gkdiving']);
    expect(GK_RADAR.find((a) => a.key === 'SPD')?.keys).toEqual(['sprintspeed', 'acceleration']);
  });

  it('axesFor(true) 出门将六轴；axesFor(false) 出外场前六组（无 GKP）', () => {
    expect(axesFor(true)).toBe(GK_RADAR);
    expect(axesFor(false).map((a) => a.key)).toEqual(['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY']);
    expect(axesFor(false)).toEqual(ATTR_GROUPS.slice(0, 6));
    expect(axesFor(false).map((a) => a.key)).not.toContain('GKP');
  });
});

describe('groupAverage（组内有效值均值）', () => {
  it('无有效值回 null（空键清单 / 键全缺 / 全非数 / 全非有限）', () => {
    expect(groupAverage([], {})).toBeNull();
    expect(groupAverage(['a', 'b'], {})).toBeNull();
    expect(groupAverage(['a', 'b'], { a: 'abc', b: undefined })).toBeNull();
    expect(groupAverage(['a', 'b'], { a: Infinity, b: -Infinity })).toBeNull();
  });

  it('取整走 Math.round（.5 进位；不足 .5 舍去）', () => {
    expect(groupAverage(['a', 'b'], { a: 80, b: 81 })).toBe(81);
    expect(groupAverage(['a', 'b'], { a: 80, b: 80 })).toBe(80);
    expect(groupAverage(['a', 'b', 'c'], { a: 80, b: 80, c: 81 })).toBe(80);
  });

  it('缺值只用有效值参与（不是按键数除）；数字字符串照常参与', () => {
    expect(groupAverage(['a', 'b'], { a: 80 })).toBe(80);
    expect(groupAverage(['a', 'b'], { a: '80', b: '90' })).toBe(85);
    expect(groupAverage(['a', 'b'], { a: '80', b: 'x' })).toBe(80);
  });

  it('逐字口径保留 Number(null) === 0（显式 null 计 0 参与均值，不是「缺值」）', () => {
    expect(groupAverage(['a', 'b'], { a: null, b: 90 })).toBe(45);
    expect(groupAverage(['a'], { a: null })).toBe(0);
  });
});

describe('starText（★/☆ 档位）', () => {
  it('≤0 与非有限一律 —', () => {
    for (const v of [0, -1, -0.5, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(starText(v)).toBe('—');
    }
  });

  it('缺值与非数串也不出星', () => {
    expect(starText(undefined)).toBe('—');
    expect(starText(null)).toBe('—');
    expect(starText('')).toBe('—');
    expect(starText('abc')).toBe('—');
    expect(starText({})).toBe('—');
  });

  it('1-5 星与封顶 5 星', () => {
    expect(starText(1)).toBe('★☆☆☆☆');
    expect(starText(3)).toBe('★★★☆☆');
    expect(starText(5)).toBe('★★★★★');
    expect(starText(6)).toBe('★★★★★');
  });

  it('数字字符串先 Number 收口（对比页直喂 attrs 原值）', () => {
    expect(starText('3')).toBe('★★★☆☆');
  });

  it('小数按原式 repeat 截断口径，不额外取整', () => {
    expect(starText(3.5)).toBe('★★★☆');
    expect(starText(4.5)).toBe('★★★★');
  });
});

describe('axisValue（轴值归一 0-1）', () => {
  it('组均 / 99：99 → 1、0 → 0', () => {
    expect(axisValue({ sprintspeed: 99, acceleration: 99 }, 'PAC')).toBe(1);
    expect(axisValue({ sprintspeed: 0, acceleration: 0 }, 'PAC')).toBe(0);
    expect(axisValue({ sprintspeed: 50, acceleration: 50 }, 'PAC')).toBe(50 / 99);
  });

  it('钳制 [0,99]：超 99 截顶、负值归零', () => {
    expect(axisValue({ sprintspeed: 200, acceleration: 200 }, 'PAC')).toBe(1);
    expect(axisValue({ sprintspeed: -30, acceleration: -30 }, 'PAC')).toBe(0);
  });

  it('缺值 / 非数 / 未知轴键一律 0', () => {
    expect(axisValue({}, 'PAC')).toBe(0);
    expect(axisValue({ sprintspeed: 'abc' }, 'PAC')).toBe(0);
    expect(axisValue({ sprintspeed: 99 }, 'NOPE')).toBe(0);
  });

  it('门将轴：单键直取；SPD 取 冲刺+加速 组均', () => {
    expect(axisValue({ gkdiving: 99 }, 'DIV')).toBe(1);
    expect(axisValue({ gkdiving: 49 }, 'DIV')).toBe(49 / 99);
    expect(axisValue({ sprintspeed: 60, acceleration: 80 }, 'SPD')).toBe(70 / 99);
  });

  it('GKP 组也在轴表中（属性表侧可用，五键均值）', () => {
    const attrs = { gkdiving: 99, gkhandling: 99, gkkicking: 99, gkpositioning: 99, gkreflexes: 99 };
    expect(axisValue(attrs, 'GKP')).toBe(1);
  });
});
