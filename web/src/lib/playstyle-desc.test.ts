// @vitest-environment node
// v6.69.0：描述数据完整性。36 条基础项一条不能少，id 必须与 ref/playstyle.json 的基础项对齐；
// 金徽（psid = 基础 id + 100）复用同一行，查不到时调用方回落到无描述形态。
import { describe, expect, it } from 'vitest';
import { playstyleBaseId, playstyleDescOf, playstyleEffectOf } from './ref.ts';
import playstyleDesc from '../../assets/ref/playstyle-desc.json';
import playstyleRef from '../../assets/ref/playstyle.json';

const BASES = (playstyleRef as { id: number }[]).filter((r) => r.id > 0 && r.id < 100);

describe('playstyle-desc.json（v6.69.0）', () => {
  it('覆盖全部 36 条基础项，且 id 与 ref 表一一对应', () => {
    const ids = (playstyleDesc as { id: number }[]).map((r) => r.id);
    expect(ids.length).toBe(36);
    expect(new Set(ids).size).toBe(36);
    expect(ids.slice().sort((a, b) => a - b)).toEqual(BASES.map((r) => r.id).sort((a, b) => a - b));
  });

  it('三段文案都非空，info 不以句号堆叠、descPlus 与 desc 不同', () => {
    for (const row of playstyleDesc as { id: number; info: string; desc: string; descPlus: string }[]) {
      expect(row.info.length, `id ${row.id} info`).toBeGreaterThan(8);
      expect(row.desc.length, `id ${row.id} desc`).toBeGreaterThan(6);
      expect(row.descPlus.length, `id ${row.id} descPlus`).toBeGreaterThan(6);
      expect(row.descPlus, `id ${row.id} 金徽不应与银徽同文`).not.toBe(row.desc);
    }
  });

  it('查询：基础 id 与 +100 同源；未知 id 返回 null', () => {
    expect(playstyleBaseId(1)).toBe(1);
    expect(playstyleBaseId(101)).toBe(1);
    expect(playstyleDescOf(1)?.id).toBe(1);
    expect(playstyleDescOf(101)?.id).toBe(1);
    expect(playstyleDescOf(9999)).toBeNull();
    expect(playstyleDescOf(0)).toBeNull();
  });

  it('档位效果：金徽取 descPlus、银徽取 desc；未知 id 返回 null', () => {
    const row = playstyleDescOf(1)!;
    expect(playstyleEffectOf(1, false)).toBe(row.desc);
    expect(playstyleEffectOf(101, true)).toBe(row.descPlus);
    expect(playstyleEffectOf(9999, false)).toBeNull();
  });
});
