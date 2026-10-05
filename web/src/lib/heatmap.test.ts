import { describe, expect, it } from 'vitest';
import {
  HEAT_CODES,
  HEAT_GK_BAND,
  HEAT_SLOTS,
  HEAT_VIEW,
  heatPositionsOf,
  heatStateOf,
  heatToneClass,
  type HeatCode,
  type HeatSlot,
} from './heatmap.ts';
import { POSITIONS } from './players-library.ts';

const slotOf = (code: HeatCode) => HEAT_SLOTS.find((s) => s.code === code)!;

const overlaps = (a: HeatSlot, b: HeatSlot) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('热区图拓扑', () => {
  it('12 个位置码与球员库 POSITIONS 同集合', () => {
    expect(HEAT_CODES).toHaveLength(12);
    expect([...HEAT_CODES].sort()).toEqual([...POSITIONS].sort());
  });

  it('12 块全在场且 code 唯一，与 HEAT_CODES 同集合', () => {
    expect(HEAT_SLOTS).toHaveLength(12);
    expect(new Set(HEAT_SLOTS.map((s) => s.code)).size).toBe(12);
    expect([...HEAT_SLOTS.map((s) => s.code)].sort()).toEqual([...HEAT_CODES].sort());
  });

  it('每块都落在 viewBox 内', () => {
    for (const s of HEAT_SLOTS) {
      expect(s.x, s.code).toBeGreaterThanOrEqual(0);
      expect(s.y, s.code).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w, s.code).toBeLessThanOrEqual(HEAT_VIEW.w);
      expect(s.y + s.h, s.code).toBeLessThanOrEqual(HEAT_VIEW.h);
    }
  });

  it('块两两不重叠（含 GK 块）', () => {
    for (let i = 0; i < HEAT_SLOTS.length; i++) {
      for (let j = i + 1; j < HEAT_SLOTS.length; j++) {
        expect(overlaps(HEAT_SLOTS[i], HEAT_SLOTS[j]), `${HEAT_SLOTS[i].code}/${HEAT_SLOTS[j].code}`).toBe(false);
      }
    }
  });

  it('三列各 75 宽、列缝 5', () => {
    expect([slotOf('LW').x, slotOf('ST').x, slotOf('RW').x]).toEqual([5, 85, 165]);
    for (const code of ['LW', 'LM', 'LB', 'ST', 'CAM', 'CM', 'CDM', 'CB', 'RW', 'RM', 'RB'] as const) {
      expect(slotOf(code).w, code).toBe(75);
    }
  });

  it('同列块纵向缝隙均为 5', () => {
    for (const column of [['LW', 'LM', 'LB'], ['ST', 'CAM', 'CM', 'CDM', 'CB'], ['RW', 'RM', 'RB']] as const) {
      const sorted = [...column.map(slotOf)].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].y - (sorted[i - 1].y + sorted[i - 1].h), sorted[i].code).toBe(5);
      }
    }
  });

  it('中列五等分 27、左右边前卫/边后卫跨两块 59', () => {
    for (const code of ['ST', 'CAM', 'CM', 'CDM', 'CB'] as const) {
      expect(slotOf(code).h, code).toBe(27);
    }
    for (const code of ['LW', 'LM', 'RW', 'RM'] as const) {
      expect(slotOf(code).h, code).toBe(59);
    }
    expect(slotOf('LB').h).toBe(27);
    expect(slotOf('RB').h).toBe(27);
  });

  it('GK 块 69×26 居中于底部梯形带之上', () => {
    const gk = slotOf('GK');
    expect({ x: gk.x, y: gk.y, w: gk.w, h: gk.h }).toEqual({ x: 88, y: 167, w: 69, h: 26 });
    expect(gk.x + gk.w / 2).toBe(HEAT_VIEW.w / 2);
    const blockBottom = Math.max(...HEAT_SLOTS.filter((s) => s.code !== 'GK').map((s) => s.y + s.h));
    expect(gk.y).toBeGreaterThan(blockBottom);
    expect(HEAT_GK_BAND).toBe('4,164 241,164 204,196 41,196');
    expect(HEAT_GK_BAND.split(' ').every((p) => Number(p.split(',')[0]) <= HEAT_VIEW.w)).toBe(true);
  });
});

describe('heatPositionsOf 位置码清洗', () => {
  it('过滤 12 码外的值并去重，保留输入顺序', () => {
    expect(heatPositionsOf(['CAM', 'XX', 'CAM', 'ST', '', 'GK'])).toEqual(['CAM', 'ST', 'GK']);
  });

  it('空输入返回空数组', () => {
    expect(heatPositionsOf([])).toEqual([]);
    expect(heatPositionsOf(['n/a', '-'])).toEqual([]);
  });
});

describe('heatStateOf 三态映射', () => {
  const allNone = Object.fromEntries(HEAT_CODES.map((c) => [c, 'none'])) as Record<HeatCode, string>;

  it('空位置码全为 none', () => {
    expect(heatStateOf([], false)).toEqual(allNone);
  });

  it('首码主位、其余副位', () => {
    const state = heatStateOf(['ST', 'CAM', 'RW'], false);
    expect(state.ST).toBe('main');
    expect(state.CAM).toBe('sub');
    expect(state.RW).toBe('sub');
    expect(state.CB).toBe('none');
  });

  it('单码只主位一块', () => {
    const state = heatStateOf(['CM'], false);
    expect(state.CM).toBe('main');
    expect(Object.values(state).filter((v) => v !== 'none')).toHaveLength(1);
  });

  it('重复码去重后不占副位', () => {
    const state = heatStateOf(['ST', 'ST', 'CAM'], false);
    expect(state.ST).toBe('main');
    expect(state.CAM).toBe('sub');
  });

  it('12 码外的值一律忽略', () => {
    expect(heatStateOf(['XX', '', 'GKX'], false)).toEqual(allNone);
    const state = heatStateOf(['XX', 'LB'], false);
    expect(state.LB).toBe('main');
    expect(Object.values(state).filter((v) => v !== 'none')).toHaveLength(1);
  });

  it('超过 3 个位置码时全铺副位', () => {
    const state = heatStateOf(['ST', 'CAM', 'RW', 'LB', 'CDM'], false);
    expect(state.ST).toBe('main');
    for (const code of ['CAM', 'RW', 'LB', 'CDM'] as const) expect(state[code], code).toBe('sub');
  });
});

describe('heatStateOf 门将特例', () => {
  it('纯门将只 GK 块主位绿、其余淡显', () => {
    const state = heatStateOf(['GK'], true);
    expect(state.GK).toBe('main');
    expect(Object.values(state).filter((v) => v !== 'none')).toHaveLength(1);
  });

  it('兼场门将 GK 主位、兼位副位', () => {
    const state = heatStateOf(['GK', 'ST'], true);
    expect(state.GK).toBe('main');
    expect(state.ST).toBe('sub');
  });

  it('兼场门将 GK 不在首码时照常按序铺绿', () => {
    const state = heatStateOf(['ST', 'GK'], true);
    expect(state.ST).toBe('main');
    expect(state.GK).toBe('sub');
  });

  it('非门将标志但位置码是 GK 时照常铺绿', () => {
    expect(heatStateOf(['GK'], false).GK).toBe('main');
  });

  it('门将标志但位置码为空时全淡显', () => {
    expect(Object.values(heatStateOf([], true)).every((v) => v === 'none')).toBe(true);
  });
});

describe('heatToneClass', () => {
  it('三态映射到块类名', () => {
    expect(heatToneClass('main')).toBe('heat-main');
    expect(heatToneClass('sub')).toBe('heat-sub');
    expect(heatToneClass('none')).toBe('heat-off');
  });
});
