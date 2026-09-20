// 旁路操作规则单测（规则 4.4.2/4.4.3/4.4.4/4.4.6，TECH_DESIGN §6.2/§6.3）
// 增量 25：效力与保护期按转会窗刻度（1 个常规窗关窗 = 0.5 赛季）
import { describe, expect, it } from 'vitest';
import {
  activationFee,
  freeAgentFee,
  isProtected,
  matchDiff,
  protectionTicksFor,
  rcChangeFee,
  serviceSeasons,
  terminationFee,
} from '../src/core/bypass-rules.ts';

describe('serviceSeasons（效力 = 0.5 × 常规窗关窗数）', () => {
  it('签约基数到当前窗数折算赛季', () => {
    expect(serviceSeasons(0, 0)).toBe(0);
    expect(serviceSeasons(0, 1)).toBe(0.5);
    expect(serviceSeasons(0, 3)).toBe(1.5);
    expect(serviceSeasons(0, 6)).toBe(3);
  });
  it('去掉签约前已关的窗（基数），中途转入不叠加前任效力', () => {
    expect(serviceSeasons(4, 5)).toBe(0.5);
    expect(serviceSeasons(4, 4)).toBe(0);
  });
  it('当前窗数小于基数（数据异常）按 0 兜底，不出现负效力', () => {
    expect(serviceSeasons(5, 3)).toBe(0);
  });
});

describe('protectionTicksFor / isProtected（保护期 4.3.1）', () => {
  it('正式合同保护期 = 签约基数 + 3 窗（1.5 赛季），训练营无保护期（4.3.4）', () => {
    expect(protectionTicksFor(0, 'formal')).toBe(3);
    expect(protectionTicksFor(4, 'formal')).toBe(7);
    expect(protectionTicksFor(0, 'trainee')).toBeNull();
  });
  it('当前窗数未到保护期结束点 → 保护中；到达即解除', () => {
    expect(isProtected(3, 0)).toBe(true);
    expect(isProtected(3, 2)).toBe(true);
    expect(isProtected(3, 3)).toBe(false);
    expect(isProtected(3, 4)).toBe(false);
  });
  it('无保护期（null）→ 不受保护', () => {
    expect(isProtected(null, 0)).toBe(false);
  });
});

describe('activationFee（激活倍数 4.4.2.3）', () => {
  it('保护期内：RC≤20 → 2 倍，>20 → 1.5 倍', () => {
    expect(activationFee(20, 3, 0)).toBe(40);
    expect(activationFee(12, 3, 1)).toBe(24);
    expect(activationFee(30, 3, 2)).toBe(45);
  });
  it('保护期外：固定 1 倍', () => {
    expect(activationFee(30, 3, 3)).toBe(30);
    expect(activationFee(12, null, 0)).toBe(12);
  });
  it('激活边界：RC=20 整点按 2 倍（规则「≤20」）', () => {
    expect(activationFee(20, 3, 0)).toBe(40);
    expect(activationFee(21, 3, 0)).toBe(31.5);
  });
});

describe('terminationFee（解约费 4.4.4）', () => {
  it('效力 ≥3 年（6 个常规窗）免费', () => {
    expect(terminationFee(10, 0, 6)).toBe(0);
    expect(terminationFee(10, 2, 8)).toBe(0);
  });
  it('未满 3 年：RC×(3−效力)×0.1', () => {
    expect(terminationFee(10, 0, 4)).toBeCloseTo(1, 2); // 效力 2.0 赛季
    expect(terminationFee(10, 0, 5)).toBeCloseTo(0.5, 2); // 2.5
    expect(terminationFee(20, 0, 1)).toBeCloseTo(5, 2); // 0.5
  });
  it('刚签约（效力 0）→ 全额 ×3×0.1', () => {
    expect(terminationFee(10, 3, 3)).toBeCloseTo(3, 2);
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
