import { describe, expect, it } from 'vitest';
import { attemptExpected, directFail, expectedWage, satisfactionText, successRate } from '../src/worker/negotiation-secret.ts';

describe('negotiation-secret', () => {
  it('expectedWage', () => {
    expect(expectedWage(5, 10, 0.02, 1.9, 0.45)).toBe(1.2);
    expect(expectedWage(8, 50, 0.02, 1.9, 0.45)).toBe(6.05);
    expect(expectedWage(10, 100, 0.02, 1.9, 0.45)).toBe(12.62);
    expect(expectedWage(7, 20, 0.02, 1.9, 0.45)).toBe(3.11);
  });

  it('attemptExpected', () => {
    expect(attemptExpected(6.04, 1, 0.95)).toBe(6.04);
    expect(attemptExpected(6.04, 2, 0.95)).toBe(5.74);
    expect(attemptExpected(6.04, 3, 0.95)).toBe(5.74);
    expect(attemptExpected(1.2, 2, 0.95)).toBe(1.14);
  });

  it('successRate', () => {
    expect(successRate(10, 10, -9, 0.8)).toBe(1);
    expect(successRate(20, 6.04, -9, 0.8)).toBe(1);
    expect(successRate(4.832, 6.04, -9, 0.8)).toBeCloseTo(0.5, 10);
    expect(successRate(5.436, 6.04, -9, 0.8)).toBeCloseTo(0.9046509, 6);
    expect(successRate(3.624, 6.04, -9, 0.8)).toBeCloseTo(0.0109869, 6);
    expect(successRate(5.436, 6.04, -4.5, 0.8)).toBeCloseTo(0.754915, 5);
    expect(successRate(5.436, 6.04, -9, 0.75)).toBeCloseTo(0.9669107, 5);
  });

  it('directFail', () => {
    expect(directFail(0.2, 0.25, 0.5, 0.49)).toBe(true);
    expect(directFail(0.2, 0.25, 0.5, 0.5)).toBe(false);
    expect(directFail(0.3, 0.25, 0.5, 0.1)).toBe(false);
    expect(directFail(0.24, 0.25, 0.7, 0.69)).toBe(true);
  });

  it('satisfactionText', () => {
    expect(satisfactionText(1, 0.25, 0.6, 0.9)).toBe('😍 经纪人非常满意');
    expect(satisfactionText(0.9, 0.25, 0.6, 0.9)).toBe('😍 经纪人非常满意');
    expect(satisfactionText(0.89, 0.25, 0.6, 0.9)).toBe('🙂 经纪人比较满意');
    expect(satisfactionText(0.6, 0.25, 0.6, 0.9)).toBe('🙂 经纪人比较满意');
    expect(satisfactionText(0.59, 0.25, 0.6, 0.9)).toBe('😐 经纪人不太满意');
    expect(satisfactionText(0.25, 0.25, 0.6, 0.9)).toBe('😐 经纪人不太满意');
    expect(satisfactionText(0.24, 0.25, 0.6, 0.9)).toBe('😠 经纪人很不满意');
  });
});
