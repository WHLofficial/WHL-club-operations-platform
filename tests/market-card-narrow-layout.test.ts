// 回归锁（v6.60.9）：挂牌卡窄屏（≤760）要把 CA/PA 从「挂牌价上面一条」重排到价格三行右边的竖列，
// 靠的是 .mkt-card-mid 在媒体块里由 column 翻成 row + 给 rail/rows 分配 order 与伸缩比。
// 组件测试只保证 DOM 里有这层容器（web/src/pages/market/MarketCard.test.tsx），
// 真正决定几何的是 CSS，所以这里扫文本兜住「媒体块被删 / order 被拿掉 / 容器又变回 column」。
// 口径同 tests/mobile-baseline.test.ts：文本级扫描、cwd = 仓库根。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STYLES_CSS = 'web/src/styles.css';
const CARD_TSX = 'web/src/pages/market/MarketBoardPage.tsx';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** 取第一个内含 needle 的媒体块块体（大括号配对切；找不到给空串） */
function mediaBlockContaining(css: string, header: string, needle: string): string {
  let from = 0;
  for (;;) {
    const at = css.indexOf(header, from);
    if (at < 0) return '';
    const open = css.indexOf('{', at);
    if (open < 0) return '';
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = css.slice(open + 1, end);
    if (body.includes(needle)) return body;
    from = end + 1;
  }
}

describe('挂牌卡窄屏 CA/PA 右侧竖列（v6.60.9）', () => {
  it('桌面 .mkt-card-mid 是竖排容器（CA/PA 一条压在价格三行上面）', () => {
    const css = read(STYLES_CSS);
    expect(css, '找不到 .mkt-card-mid 基规则（可能已改名，本锁需同步）').toMatch(
      /\.mkt-card-mid\s*\{[^}]*flex-direction:\s*column/,
    );
  });

  it('≤760 块里翻成横排：rail 靠 order 换到右边，rows 吃满左侧剩余宽度', () => {
    const css = read(STYLES_CSS);
    const block = mediaBlockContaining(css, '@media (max-width: 760px)', '.mkt-card-mid');
    expect(block, '≤760 缺 .mkt-card-mid 的媒体块规则（窄屏又变回竖排，一条卡高涨回去）').not.toBe('');
    expect(block, '≤760 .mkt-card-mid 应翻成横排').toMatch(/\.mkt-card-mid\s*\{[^}]*flex-direction:\s*row/);
    expect(block, '窄屏 rail 必须 order: 1 才排得到右侧（DOM 里它在前）').toMatch(
      /\.mkt-card-mid\s+\.mkt-rail\s*\{[^}]*order:\s*1/,
    );
    expect(block, '窄屏 rows 应 flex: 1 1 auto 吃掉左侧剩余宽度').toMatch(
      /\.mkt-card-mid\s+\.mkt-rows\s*\{[^}]*flex:\s*1 1 auto/,
    );
  });

  it('DOM 里 rail 与 rows 都在 .mkt-card-mid 内（否则上面的 order 规则挂不上）', () => {
    const src = read(CARD_TSX);
    const mid = src.indexOf('<div className="mkt-card-mid">');
    expect(mid, '卡片缺 .mkt-card-mid 容器').toBeGreaterThan(-1);
    expect(src.indexOf('<div className="mkt-rail">'), 'rail 应在容器之后').toBeGreaterThan(mid);
    expect(src.indexOf('<div className="mkt-rows">'), 'rows 应在容器之后').toBeGreaterThan(mid);
  });
});
