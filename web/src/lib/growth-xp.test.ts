// TC-UI-XP：前端 XP 折算必须与后端 src/worker/growth.ts xpForEvent 同口径（两边改必须同步）。
import { describe, expect, it } from 'vitest';
import { entryXp, growthXpForEvent } from './growth-xp.ts';

describe('growthXpForEvent（对照后端 xpForEvent）', () => {
  it('出场固定 1 XP', () => {
    expect(growthXpForEvent('appearance', 1)).toBe(1);
  });

  it('评分分档：7.0→1 · 8.0→2 · 9.0→3 · 10.0→4，不足 7 → 0', () => {
    expect(growthXpForEvent('rating', 7)).toBe(1);
    expect(growthXpForEvent('rating', 7.5)).toBe(1);
    expect(growthXpForEvent('rating', 8)).toBe(2);
    expect(growthXpForEvent('rating', 8.9)).toBe(2);
    expect(growthXpForEvent('rating', 9)).toBe(3);
    expect(growthXpForEvent('rating', 10)).toBe(4);
    expect(growthXpForEvent('rating', 6.9)).toBe(0);
  });

  it('零封 / 进球 / 助攻各 0.5 XP', () => {
    expect(growthXpForEvent('clean_sheet', 1)).toBe(0.5);
    expect(growthXpForEvent('goal', 1)).toBe(0.5);
    expect(growthXpForEvent('assist', 1)).toBe(0.5);
  });

  it('夺回球权每 12 次 1 XP', () => {
    expect(growthXpForEvent('duels_won', 12)).toBe(1);
    expect(growthXpForEvent('duels_won', 11)).toBe(0);
    expect(growthXpForEvent('duels_won', 25)).toBe(2);
  });

  it('扑救每 8 次 1 XP，单场超 8 额外 +1', () => {
    expect(growthXpForEvent('saves', 8)).toBe(1);
    expect(growthXpForEvent('saves', 9)).toBe(2);
    expect(growthXpForEvent('saves', 7)).toBe(0);
    expect(growthXpForEvent('saves', 17)).toBe(3);
  });

  it('非补录类型（里程碑等）折算 0', () => {
    expect(growthXpForEvent('milestone', 5)).toBe(0);
    expect(growthXpForEvent('unknown', 3)).toBe(0);
  });
});

describe('entryXp（一行录入合计）', () => {
  it('全项：出场 + 8.5 评分 + 零封 + 12 夺回 + 9 扑救 = 1 + 2 + 0.5 + 1 + 2 = 6.5', () => {
    expect(entryXp({ appearance: true, rating: 8.5, cleanSheet: true, duelsWon: 12, saves: 9 })).toBe(6.5);
  });

  it('空录入 0 XP', () => {
    expect(entryXp({})).toBe(0);
    expect(entryXp({ rating: null, duelsWon: null, saves: null })).toBe(0);
  });

  it('只勾出场 1 XP', () => {
    expect(entryXp({ appearance: true })).toBe(1);
  });

  it('不达标输入按 0 档计（负数/超上限由页面拦截，这里只保证不产出 NaN）', () => {
    expect(entryXp({ rating: 6.5 })).toBe(0);
    expect(entryXp({ saves: 7 })).toBe(0);
    expect(entryXp({ duelsWon: 11 })).toBe(0);
  });
});
