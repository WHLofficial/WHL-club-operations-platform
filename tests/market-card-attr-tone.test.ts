// 回归锁（v6.60.8）：挂牌卡的 CA/PA 一直挂着 attr-* 档位类，但 `.mkt-rail-num` 自己写了
// `color: var(--ink)`——同特异性、又后定义，把五档档位色整片压成墨色，卡片上两颗大数字双双失去分档。
// 组件测试看不出这层：它只断言 className 里带不带 attr-weak / attr-good（`MarketCard.test.tsx`），
// 层叠结果只有 CSS 能决定。所以这里扫文本兜住「覆盖规则被下批重构删掉 / 基规则又被搬到覆盖之后」。
// 口径同 tests/mobile-baseline.test.ts：文本级扫描、cwd = 仓库根（vitest 约定）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STYLES_CSS = 'web/src/styles.css';
const TIERS = ['bad', 'weak', 'mid', 'solid', 'good'] as const;

function read(): string {
  return readFileSync(STYLES_CSS, 'utf8');
}

describe('挂牌卡 CA/PA 五档配色（v6.60.8）', () => {
  it('五档覆盖规则都在，且各自回到全仓统一的 --attr-* token', () => {
    const css = read();
    for (const tier of TIERS) {
      expect(
        css,
        `.mkt-rail-num.attr-${tier} 的覆盖规则缺失（同特异性下 .mkt-rail-num 的 --ink 会把它压掉）`,
      ).toMatch(new RegExp(`\\.mkt-rail-num\\.attr-${tier}\\s*\\{\\s*color:\\s*var\\(--attr-${tier}\\);`));
    }
  });

  it('覆盖规则排在 .mkt-rail-num 基规则之后——同特异性只靠顺序取胜', () => {
    const css = read();
    const base = css.indexOf('.mkt-rail-num {');
    expect(base, '找不到 .mkt-rail-num 基规则（可能已改名，本锁需同步）').toBeGreaterThan(-1);
    for (const tier of TIERS) {
      const override = css.indexOf(`.mkt-rail-num.attr-${tier} {`);
      expect(override, `找不到 .mkt-rail-num.attr-${tier} 覆盖规则`).toBeGreaterThan(base);
    }
  });
});
