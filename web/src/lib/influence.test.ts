import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { influenceCoefText } from './influence.ts';

describe('influenceCoefText（v6.28.0 A 段：影响力构成文案的级别系数显示）', () => {
  it('出厂两档按原值显示：1.2 / 1', () => {
    expect(influenceCoefText(1.2)).toBe('1.2');
    expect(influenceCoefText(1)).toBe('1');
  });

  it('浮点尾巴去掉（0.1+0.2 这类值不显示 0.30000000000000004）', () => {
    expect(influenceCoefText(0.1 + 0.2)).toBe('0.3');
    expect(influenceCoefText(1.1500000000000001)).toBe('1.15');
  });

  it('坏值兜底显示 1（后端坏值本就回 1.0，这里防前端拿到 NaN/Infinity 显示成 NaN）', () => {
    expect(influenceCoefText(Number.NaN)).toBe('1');
    expect(influenceCoefText(Number.POSITIVE_INFINITY)).toBe('1');
  });

  it('静态契约：两处影响力构成文案都走级别系数（回退到旧加法文案即红）', () => {
    // vitest 的 cwd = 仓库根（与 CpuConvertPage.test.tsx / mobile-baseline.test.ts 同一读法）
    for (const rel of ['web/src/pages/club/CoachPanel.tsx', 'web/src/pages/admin/ClubsPage.tsx']) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src).toContain('× 级别系数');
      expect(src).toContain('influenceCoefText(');
    }
  });
});
