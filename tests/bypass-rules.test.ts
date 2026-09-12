// 旁路操作规则单测（规则 4.4.2/4.4.3/4.4.4/4.4.6，TECH_DESIGN §6.2/§6.3）
import { describe, expect, it } from 'vitest';
import {
  activationFee,
  freeAgentFee,
  isProtected,
  matchDiff,
  rcChangeFee,
  serviceYears,
  terminationFee,
} from '../src/core/bypass-rules.ts';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const DAY = 86_400_000;

describe('isProtected（保护期判定）', () => {
  it('protected_until 在未来 → 保护期内；已过 → 保护期外', () => {
    expect(isProtected('2026-12-01T00:00:00Z', null, NOW)).toBe(true);
    expect(isProtected('2026-01-01T00:00:00Z', null, NOW)).toBe(false);
  });
  it('protected_until 缺省时按 signed_at + 548 天推算', () => {
    const signed = '2026-06-01T00:00:00Z'; // 103 天前
    expect(isProtected(null, signed, NOW)).toBe(true);
    const old = '2024-06-01T00:00:00Z'; // ~830 天前 > 548
    expect(isProtected(null, old, NOW)).toBe(false);
  });
  it('两者都缺 → 不受保护', () => {
    expect(isProtected(null, null, NOW)).toBe(false);
  });
});

describe('activationFee（激活倍数 4.4.2.3）', () => {
  it('保护期内：RC≤20 → 2 倍，>20 → 1.5 倍', () => {
    expect(activationFee(20, '2027-01-01T00:00:00Z', null, NOW)).toBe(40);
    expect(activationFee(12, '2027-01-01T00:00:00Z', null, NOW)).toBe(24);
    expect(activationFee(30, '2027-01-01T00:00:00Z', null, NOW)).toBe(45);
  });
  it('保护期外：固定 1 倍', () => {
    expect(activationFee(30, '2026-01-01T00:00:00Z', null, NOW)).toBe(30);
    expect(activationFee(12, null, null, NOW)).toBe(12);
  });
  it('激活边界：RC=20 整点按 2 倍（规则「≤20」）', () => {
    expect(activationFee(20, null, '2026-09-10T00:00:00Z', NOW)).toBe(40);
    expect(activationFee(21, null, '2026-09-10T00:00:00Z', NOW)).toBe(31.5);
  });
});

describe('serviceYears / terminationFee（解约费 4.4.4）', () => {
  const YEAR = 365.25 * DAY;
  const fromAgo = (years: number) => new Date(NOW - years * YEAR).toISOString();

  it('效力按 365.25 天/年折算', () => {
    expect(serviceYears(fromAgo(2), NOW)).toBeCloseTo(2, 6);
  });
  it('效力 ≥3 年免费', () => {
    expect(terminationFee(10, fromAgo(3), NOW)).toBe(0);
    expect(terminationFee(10, fromAgo(4.2), NOW)).toBe(0);
  });
  it('未满 3 年：RC×(3−效力)×0.1', () => {
    expect(terminationFee(10, fromAgo(2), NOW)).toBeCloseTo(1, 2);
    expect(terminationFee(10, fromAgo(2.5), NOW)).toBeCloseTo(0.5, 2);
    expect(terminationFee(20, fromAgo(0.5), NOW)).toBeCloseTo(5, 2);
  });
  it('效力起点缺失 → null（调用方拒绝）', () => {
    expect(terminationFee(10, null, NOW)).toBeNull();
  });
});

describe('rcChangeFee（续约费 4.4.6）', () => {
  it('提高 = 差额×30%；降低或不变免费', () => {
    expect(rcChangeFee(10, 15)).toBe(1.5);
    expect(rcChangeFee(10, 20)).toBe(3);
    expect(rcChangeFee(15, 10)).toBe(0);
    expect(rcChangeFee(10, 10)).toBe(0);
  });
});

describe('freeAgentFee（海捞签入费 4.4.3）', () => {
  it('新 RC × 30%', () => {
    expect(freeAgentFee(20)).toBe(6);
    expect(freeAgentFee(5)).toBe(1.5);
    expect(freeAgentFee(1)).toBe(0.3);
  });
});

describe('matchDiff（匹配差额 4.4.2.4）', () => {
  it('新 RC − 原 RC；新 RC 不高于原 RC 报错', () => {
    expect(matchDiff(12, 25)).toBe(13);
    expect(() => matchDiff(12, 12)).toThrow();
    expect(() => matchDiff(12, 10)).toThrow();
  });
});
