// 国家名表镜像（v6.48.0 §10.3）：src/core/nations.ts 与 web/assets/ref/nation.json 逐条一致。
// 队壳国家是档位 c2 的比对基准，两侧（管理端下拉 / Worker 展示）报出不同的国家名会直接误导录入。
import { describe, expect, it } from 'vitest';
import { NATION_NAMES, nationName } from '../src/core/nations.ts';
import nationRef from '../web/assets/ref/nation.json';

describe('nations 镜像（v6.48.0）', () => {
  it('与 web/assets/ref/nation.json 条数与逐条键值一致', () => {
    const refIds = nationRef.map((n) => n.id);
    expect(Object.keys(NATION_NAMES).map(Number).sort((a, b) => a - b)).toEqual([...refIds].sort((a, b) => a - b));
    for (const entry of nationRef) {
      expect(NATION_NAMES[entry.id], `NationID ${entry.id}`).toBe(entry.name);
    }
  });

  it('关键编号钉死（档位判定与录入下拉都依赖这几个）', () => {
    expect(nationName(14)).toBe('England');
    expect(nationName(155)).toBe('China PR');
    expect(nationName(27)).toBe('Italy');
    expect(nationName(21)).toBe('Germany');
    expect(nationName(18)).toBe('France');
    expect(nationName(45)).toBe('Spain');
    expect(nationName(22)).toBe('Greece');
    // 港澳台是独立 NationID：不算中国国籍（c3 只认 155，见 §10.3 与导入侧判定）
    expect(nationName(158)).toBe('Hong Kong');
    expect(nationName(172)).toBe('Macau');
    expect(nationName(213)).toBe('Chinese Taipei');
  });

  it('查不到 / 非法入参回 null（不抛错）', () => {
    expect(nationName(999999)).toBeNull();
    expect(nationName(null)).toBeNull();
    expect(nationName(undefined)).toBeNull();
    expect(nationName('')).toBeNull();
    expect(nationName('abc')).toBeNull();
    expect(nationName(14.5)).toBeNull();
  });

  it('宽容入参：字符串数字照查（D1 取出来可能是 TEXT）', () => {
    expect(nationName('14')).toBe('England');
    expect(nationName('155')).toBe('China PR');
  });
});
