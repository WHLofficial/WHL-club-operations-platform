// 对比域纯函数（web/src/lib/compare.ts）单测：URL 解析 / 配色 / 胜负标记 / 组均。
import { describe, expect, it } from 'vitest';
import { COMPARE_COLORS, colorFor, groupAverages, parseCompareIds, rowMarks } from './compare.ts';

const EMPTY = { ids: [] as number[], droppedInvalid: 0, droppedDuplicate: 0, overLimit: 0 };

describe('parseCompareIds（URL ids 解析）', () => {
  it('空入参：空名单且零计数（含纯分隔符）', () => {
    for (const raw of [null, undefined, '', '   ', ',']) {
      expect(parseCompareIds(raw)).toEqual(EMPTY);
    }
  });

  it('逗号切分并容忍前后空格；空段静默跳过', () => {
    expect(parseCompareIds('1,2').ids).toEqual([1, 2]);
    expect(parseCompareIds(' 1 ,  2 ').ids).toEqual([1, 2]);
    expect(parseCompareIds('1,,2,').ids).toEqual([1, 2]);
    expect(parseCompareIds('007,8').ids).toEqual([7, 8]);
  });

  it('非法项：非数字 / 带字母混写 / 小数 / 0 / 负数 / 超安全整数巨数', () => {
    expect(parseCompareIds('abc')).toEqual({ ...EMPTY, droppedInvalid: 1 });
    expect(parseCompareIds('12abc')).toEqual({ ...EMPTY, droppedInvalid: 1 });
    expect(parseCompareIds('1.5')).toEqual({ ...EMPTY, droppedInvalid: 1 });
    expect(parseCompareIds('0')).toEqual({ ...EMPTY, droppedInvalid: 1 });
    expect(parseCompareIds('-3')).toEqual({ ...EMPTY, droppedInvalid: 1 });
    // 400 位数字：/^\d+$/ 能过但 Number 溢出成 Infinity ⇒ 不算合法 id
    expect(parseCompareIds('9'.repeat(400))).toEqual({ ...EMPTY, droppedInvalid: 1 });
    expect(parseCompareIds('abc,,0')).toEqual({ ...EMPTY, droppedInvalid: 2 });
  });

  it('去重保序（后出现者计 droppedDuplicate）', () => {
    expect(parseCompareIds('3,1,3')).toEqual({ ...EMPTY, ids: [3, 1], droppedDuplicate: 1 });
    expect(parseCompareIds('5,5,5')).toEqual({ ...EMPTY, ids: [5], droppedDuplicate: 2 });
  });

  it('超过 3 人按 URL 顺序取前 3；去重先于取前 3', () => {
    expect(parseCompareIds('4,3,2,1')).toEqual({ ...EMPTY, ids: [4, 3, 2], overLimit: 1 });
    expect(parseCompareIds('1,1,2,2,3,4')).toEqual({
      ...EMPTY,
      ids: [1, 2, 3],
      droppedDuplicate: 2,
      overLimit: 1,
    });
  });

  it('混合串：四类计数互不干扰', () => {
    expect(parseCompareIds(' 7 ,abc,0,7,9,11,13 ,')).toEqual({
      ids: [7, 9, 11],
      droppedInvalid: 2,
      droppedDuplicate: 1,
      overLimit: 1,
    });
  });
});

describe('COMPARE_COLORS / colorFor（本命色随人走）', () => {
  it('三色常量：A 焦橙深 / B 深蓝灰 / C 深紫', () => {
    expect(COMPARE_COLORS).toEqual(['#8e5426', '#37505e', '#6d4aa8']);
  });

  it('索引 0/1/2 固定映射（色只由索引决定，移除中间一人其余人不换色）', () => {
    expect(colorFor(0)).toBe('#8e5426');
    expect(colorFor(1)).toBe('#37505e');
    expect(colorFor(2)).toBe('#6d4aa8');
  });

  it('越界索引回退 A 色（正常最多 3 人用不到）', () => {
    expect(colorFor(3)).toBe('#8e5426');
    expect(colorFor(-1)).toBe('#8e5426');
    expect(colorFor(Number.NaN)).toBe('#8e5426');
  });
});

describe('rowMarks（胜负标记乙）', () => {
  it('唯一最大值加粗，其余常规', () => {
    expect(rowMarks([1, 2, 3])).toEqual([false, false, true]);
  });

  it('等值（平手）两侧都加粗：并列最高全粗', () => {
    expect(rowMarks([3, 3, 1])).toEqual([true, true, false]);
    expect(rowMarks([2, 2, 2])).toEqual([true, true, true]);
    expect(rowMarks([5, 5])).toEqual([true, true]);
  });

  it('null/undefined/NaN 视为无值不参与，也不被标粗', () => {
    expect(rowMarks([1, 2, null])).toEqual([false, true, false]);
    expect(rowMarks([7, undefined])).toEqual([true, false]);
    expect(rowMarks([Number.NaN, 5, 3])).toEqual([false, true, false]);
  });

  it('全无值 → 全 false；只有一个有效值 → 该值 true', () => {
    expect(rowMarks([null, undefined])).toEqual([false, false]);
    expect(rowMarks([])).toEqual([]);
    expect(rowMarks([4])).toEqual([true]);
    expect(rowMarks([null, 4, null])).toEqual([false, true, false]);
  });

  it('0 是有效值（不是「无值」）', () => {
    expect(rowMarks([0, 0])).toEqual([true, true]);
    expect(rowMarks([0, 1])).toEqual([false, true]);
  });
});

describe('groupAverages（对比页六组组均）', () => {
  it('恒出前六组（无 GKP），label 即三字母组名', () => {
    const rows = groupAverages({});
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.key)).toEqual(['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY']);
    expect(rows.map((r) => r.label)).toEqual(['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY']);
  });

  it('有值组出取整均值，缺值组 null', () => {
    const rows = groupAverages({
      sprintspeed: 81,
      acceleration: 80,
      finishing: 90,
      positioning: 90,
      shotpower: 90,
      longshots: 90,
      penalties: 90,
      volleys: 90,
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    expect(byKey.get('PAC')).toBe(81); // (81+80)/2 = 80.5 → 81
    expect(byKey.get('SHO')).toBe(90);
    for (const k of ['PAS', 'DRI', 'DEF', 'PHY']) expect(byKey.get(k), k).toBeNull();
  });
});
