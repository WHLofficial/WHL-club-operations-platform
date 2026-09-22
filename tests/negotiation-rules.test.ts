// 谈判公开规则单测（§6.7：等级映射 / 成长年龄 / 新 RC 区间）
import { describe, expect, it } from 'vitest';
import { abilityLevel, AGENT_TIER_LABELS, ratingLevel, releaseFeeBounds, TRAINEE_RELEASE_FEE, TRAINEE_WAGE } from '../src/core/negotiation-rules.ts';

describe('ratingLevel（十档映射）', () => {
  it.each([
    [99, 10], [93, 10],
    [92, 9], [90, 9],
    [89, 8], [87, 8],
    [86, 7], [84, 7],
    [83, 6], [80, 6],
    [79, 5], [75, 5],
    [74, 4], [70, 4],
    [69, 3], [65, 3],
    [64, 2], [60, 2],
    [59, 1], [1, 1],
  ])('%i → %d', (rating, level) => {
    expect(ratingLevel(rating)).toBe(level);
  });
});

describe('abilityLevel（成长年龄混合）', () => {
  it('年龄 ≤ 成长年龄：CA 与 PA 等级取半，可 .5 步进', () => {
    expect(abilityLevel(75, 90, 24, 25)).toBe(7); // (5 + 9) / 2
    expect(abilityLevel(80, 93, 25, 25)).toBe(8); // (6 + 10) / 2
    expect(abilityLevel(75, 88, 18, 25)).toBe(6.5); // (5 + 8) / 2
  });
  it('年龄 > 成长年龄：只看 CA 等级', () => {
    expect(abilityLevel(75, 95, 26, 25)).toBe(5);
    expect(abilityLevel(85, 88, 30, 25)).toBe(7);
  });
});

describe('releaseFeeBounds（规则 4.3.1）', () => {
  it.each([
    [1, 1, 11], // 下限至少 1
    [5, 1, 15],
    [20, 10, 30],
    [21, 11, 31], // >20 走 ±50%：ceil(10.5)=11、floor(31.5)=31
    [30, 15, 45],
    [100, 50, 150],
  ])('旧 RC %i → [%i, %i]', (oldFee, low, high) => {
    expect(releaseFeeBounds(oldFee)).toEqual([low, high]);
  });
});

describe('训练营合同常量与档位名', () => {
  it('双固定（4.3.4(1)）', () => {
    expect(TRAINEE_WAGE).toBe(0.75);
    expect(TRAINEE_RELEASE_FEE).toBe(5);
  });
  it('经纪人性格名齐全', () => {
    expect(AGENT_TIER_LABELS[1]).toBe('温和');
    expect(AGENT_TIER_LABELS[2]).toBe('普通');
    expect(AGENT_TIER_LABELS[3]).toBe('苛刻');
  });
});
