// 身价阶梯（web/src/lib/valueLadder.ts）对拍样例单测（v6.79.0，设计 §2）：
// 断言逐条抄设计文档 §2 的样例表，与插件 pytest TestSnapToLadder 共用同一组（两端一致性锁）。
import { describe, expect, it } from 'vitest';
import { next, prev, snap } from './valueLadder.ts';

describe('snap（距离最小档，并列取低档）', () => {
  // 设计 §2 样例表逐条对拍
  it('低段与整数档：snap(0.4)=1 snap(5)=5 snap(10)=10', () => {
    expect(snap(0.4)).toBe(1);
    expect(snap(5)).toBe(5);
    expect(snap(10)).toBe(10);
  });

  it('10/12 缝与并列取低：snap(10.5)=10 snap(11)=10 snap(11.4)=12', () => {
    expect(snap(10.5)).toBe(10);
    expect(snap(11)).toBe(10); // 距 10 与 12 等距 → 低档
    expect(snap(11.4)).toBe(12);
  });

  it('13/15 缝并列取低：snap(14)=13', () => {
    expect(snap(14)).toBe(13); // 距 13 与 15 等距 → 低档
  });

  it('30/35 缝与并列取低：snap(31)=30 snap(32)=30 snap(32.5)=30 snap(33)=35', () => {
    expect(snap(31)).toBe(30);
    expect(snap(32)).toBe(30);
    expect(snap(32.5)).toBe(30); // 距 30 与 35 等距 → 低档
    expect(snap(33)).toBe(35);
  });

  it('按 5 段：snap(52)=50', () => {
    expect(snap(52)).toBe(50);
  });
});

describe('next（严格下一档）', () => {
  it('设计 §2 样例：next(9)=10 next(10)=12 next(28)=30 next(30)=35 next(35)=40', () => {
    expect(next(9)).toBe(10);
    expect(next(10)).toBe(12);
    expect(next(28)).toBe(30);
    expect(next(30)).toBe(35);
    expect(next(35)).toBe(40);
  });

  it('x 不在档上时同样良定义：落在上一档', () => {
    expect(next(9.5)).toBe(10);
    expect(next(10.5)).toBe(12);
    expect(next(31)).toBe(35);
  });
});

describe('prev（严格上一档）', () => {
  it('设计 §2 样例：prev(12)=10 prev(30)=28 prev(35)=30', () => {
    expect(prev(12)).toBe(10);
    expect(prev(30)).toBe(28);
    expect(prev(35)).toBe(30);
  });

  it('x 不在档上时同样良定义：落在下一档', () => {
    expect(prev(11)).toBe(10);
    expect(prev(31)).toBe(30);
    expect(prev(37)).toBe(35);
  });

  it('1 已是最低档：prev(1) 无邻档 → null', () => {
    expect(prev(1)).toBeNull();
  });
});

describe('防御分支（非有限输入按 x ≤ 0 处理）', () => {
  it('snap → 1，next → 1，prev → null', () => {
    expect(snap(Number.NaN)).toBe(1);
    expect(snap(-3)).toBe(1);
    expect(next(Number.NaN)).toBe(1);
    expect(next(0)).toBe(1);
    expect(prev(Number.NaN)).toBeNull();
    expect(prev(0)).toBeNull();
  });
});
