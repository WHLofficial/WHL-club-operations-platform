// 旁路费用预览（v6.63.3）：预览数必须与 core 规则函数同值——解约档用「效力赛季数 ×2
// 还原已关窗数差、签约基数取 0」的等价调用；与后端提交实算的端到端同源锁在 tests/。
import { describe, expect, it } from 'vitest';
import { freeAgentFee, serviceSeasons, terminationFee } from '../../../src/core/bypass-rules.ts';
import { freeAgentFeePreview, terminationFeePreview } from './bypass-fee-preview.ts';

describe('terminationFeePreview（解约费预览，规则 4.4.4）', () => {
  it('与 core terminationFee 按窗刻度实算同值（效力 ×2 还原窗数差）', () => {
    // 服务端真实路径：签约基数 5、已关 8 窗 ⇒ 效力 1.5 赛季（serviceSeasons 同款）
    expect(serviceSeasons(5, 8)).toBe(1.5);
    expect(terminationFeePreview(45, 1.5)).toBe(terminationFee(45, 5, 8));
    expect(terminationFeePreview(45, 1.5)).toBe(6.75);
  });

  it('半赛季步进逐档与旧内联公式 round2(rc × (3 − 效力) × 0.1) 相等（渲染数字不漂移）', () => {
    for (const seasons of [0, 0.5, 1, 1.5, 2, 2.5]) {
      expect(terminationFeePreview(45, seasons)).toBe(
        Math.round((45 * (3 - seasons) * 0.1 + Number.EPSILON) * 100) / 100,
      );
    }
  });

  it('效力满 3 赛季免费：回 0（免费档），不是 null', () => {
    expect(terminationFeePreview(45, 3)).toBe(0);
    expect(terminationFeePreview(45, 4.5)).toBe(0);
  });

  it('违约金 / 效力缺失或非法回 null——调用侧退回公式文案，不冒充免费', () => {
    expect(terminationFeePreview(null, 1.5)).toBe(null);
    expect(terminationFeePreview(0, 1.5)).toBe(null);
    expect(terminationFeePreview(-5, 1.5)).toBe(null);
    expect(terminationFeePreview(Number.NaN, 1.5)).toBe(null);
    expect(terminationFeePreview(45, null)).toBe(null);
  });
});

describe('freeAgentFeePreview（海捞费预览 = 新违约金 × 30%，规则 4.4.3）', () => {
  it('有效输入与 core freeAgentFee 同值', () => {
    expect(freeAgentFeePreview('20')).toBe(freeAgentFee(20));
    expect(freeAgentFeePreview('20')).toBe(6);
    expect(freeAgentFeePreview('33.33')).toBe(10); // 9.999 → round2
  });

  it('空串 / 非数 / 非正回 null', () => {
    expect(freeAgentFeePreview('')).toBe(null);
    expect(freeAgentFeePreview('  ')).toBe(null);
    expect(freeAgentFeePreview('abc')).toBe(null);
    expect(freeAgentFeePreview('0')).toBe(null);
    expect(freeAgentFeePreview('-5')).toBe(null);
  });
});
