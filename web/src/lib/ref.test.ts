// 参考表与后端白名单的一致性（增量 27 步骤 2）：属性中文名表从 pages/Player.tsx 提到 ref.ts 后，
// 筛选面板的「属性」下拉改用它分组渲染 —— 一旦与 ATTR_KEYS 错位，下拉里就会缺项或露出英文键，
// 而这类漂移在界面上只是「少了一个选项」，不会报错、不会红测试，所以在这里钉死。
import { describe, expect, it } from 'vitest';
import { ATTR_GROUPS, ATTR_LABELS } from './ref.ts';
import { ATTR_KEYS } from './players-library.ts';

describe('属性中文名表', () => {
  it('键与后端 ATTR_KEYS 逐序全等（不多、不少、不换序）', () => {
    expect(Object.keys(ATTR_LABELS)).toEqual([...ATTR_KEYS]);
  });

  it('七组分组恰好按列顺序覆盖全部属性，且无重复', () => {
    const grouped = ATTR_GROUPS.flatMap((g) => [...g.keys]);
    // 分组顺序 = 列顺序：这样下载七组小标题就是 ATTR_KEYS 的切分，不是另一份需要单独维护的表
    expect(grouped).toEqual([...ATTR_KEYS]);
    expect(new Set(grouped).size).toBe(ATTR_KEYS.length);
  });

  it('每一项都有中文名（下拉里不会落回英文键）', () => {
    const missing = [...ATTR_KEYS].filter((k) => !ATTR_LABELS[k]);
    expect(missing).toEqual([]);
  });
});
