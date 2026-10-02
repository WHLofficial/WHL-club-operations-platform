// v6.19.0 球员库移动端卡片化 + 全仓五档配色：前端纯函数层测试。
// 放 web/src/lib（根 tsconfig 有 DOM；tests/ 是 node+workers-types 语义，import 用 window 的
// web 模块会 TS2304，给 tsconfig.tests 加 DOM lib 又与 workers-types 的 CacheStorage 冲突）。
// TC 编号与预期对应 docs/test-plans/v6.19.0-players-mobile-cards.md。
// lensChips / SORT_KEY_LABELS / money 组在卡片网格提交落地后补进本文件。
import { describe, expect, it } from 'vitest';
import { attrClass } from './players-library.ts';

describe('attrClass 五档分段（sofifa 实测口径，阈值 50/60/70/80）', () => {
  it('TC-AC-01 · 八个边界值各归对档', () => {
    expect(attrClass(50)).toBe('attr-bad');
    expect(attrClass(51)).toBe('attr-weak');
    expect(attrClass(60)).toBe('attr-weak');
    expect(attrClass(61)).toBe('attr-mid');
    expect(attrClass(70)).toBe('attr-mid');
    expect(attrClass(71)).toBe('attr-solid');
    expect(attrClass(80)).toBe('attr-solid');
    expect(attrClass(81)).toBe('attr-good');
  });

  it('TC-AC-02 · 域端点与类名退役', () => {
    expect(attrClass(0)).toBe('attr-bad');
    expect(attrClass(99)).toBe('attr-good');
    const all = new Set([0, 25, 50, 51, 55, 60, 61, 65, 70, 71, 75, 80, 81, 90, 99].map(attrClass));
    expect([...all].sort()).toEqual(['attr-bad', 'attr-good', 'attr-mid', 'attr-solid', 'attr-weak']);
  });
});
