// 守卫测试：v6.20.0「系统范围手机版窄屏整治」第一批的静态扫描闸门。
// 测试计划：docs/test-plans/v6.20.0-mobile-skeleton-baseline.md（TC-SWP-01 P0、TC-SWP-02/03 P1、TC-SWP-04 P1）。
//
// 为什么要文本级扫描：这三条约定只活在 JSX/CSS 文本里——表格少包一层 `.table-wrap`、重构时又写回
// `style={{ width: 320 }}`、抽屉关闭钮的 36px 命中区被删——组件测试与单测都不会红；e2e ⑫ 也只在
// 375 视口真溢出时才红（等看见破版已经晚了）。所以用扫描兜住「下批重构的回归」。
//
// 口径（测试计划「最坏情况口径」）：遍历 web/src 全树 *.tsx（含 *.test.tsx，不抽样，当前 50 个）逐文件扫；
// 失败信息统一 `文件:行 …`，让 TC-SWP 能直接点名。
//
// 已知边界（宁枉勿纵：命中只让人来看一眼，与 tests/core-zero-import.test.ts 同风格）：
// - 表格判据 = 「<table 行的紧邻上一非空行含 table-wrap」（code-review B 批核对法，当前 48/48 通过）；
//   table-wrap 按独立类名记号匹配（改名成 table-wrap-broken 不算包裹）。包裹行与 <table 之间插注释/条件行、
//   或把包裹与 <table 写进同一行，都会误报。
// - 内联宽判据只认 `style={{ … }}` 字面量块（块边界靠花括号配对；`style={cond ? { … } : …}` 不认）；
//   键只认 camelCase 的 `width` / `minWidth`，流式形态 `min(90px, 100%)` / `min(260px, 86vw)` 不在禁令内；
//   块内注释里的 `width: 320` 也会命中（不剥注释）。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = 'web/src'; // vitest 的 cwd = 仓库根（与 tests/core-zero-import.test.ts 同样的相对路径口径）
const STYLES_CSS = `${WEB_SRC}/styles.css`;
const ADMIN_LAYOUT = `${WEB_SRC}/pages/admin/AdminLayout.tsx`;

/** 递归收集 web/src 全树 .tsx（含 *.test.tsx）；路径统一成 `/`，与 git/文档口径一致 */
function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectTsx(path, out);
    else if (entry.name.endsWith('.tsx')) out.push(path.replaceAll('\\', '/'));
  }
  return out;
}

const TSX_FILES = collectTsx(WEB_SRC).sort();
/** 本批实测全树数（50，含 5 个 *.test.tsx）：只增不减——跌破只可能是遍历器漏目录（最大组口径，不许抽样） */
const TSX_BASELINE = 50;

function read(relPath: string): string {
  return readFileSync(relPath, 'utf8');
}

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// ---- 判据 1：每个 <table> 的紧邻上一非空行必须是 .table-wrap 包裹 ----

/**
 * spec §3 点名页的表数基线（本批实测；只作抽验下限，不是白名单）：
 * 某页跌破 = 包裹/表格被摘或页面被重构，必须显式来看一眼并同步下调基线。
 */
const TABLES_BY_FILE_MIN: Record<string, number> = {
  'web/src/components/ImportPreviewBlock.tsx': 3,
  'web/src/pages/ClubDetail.tsx': 2,
  'web/src/pages/Ledger.tsx': 2,
  'web/src/pages/Negotiations.tsx': 2,
  'web/src/pages/Offers.tsx': 2,
  'web/src/pages/Player.tsx': 3,
  'web/src/pages/PlayersLibrary.tsx': 1,
  'web/src/pages/admin/BrandsPage.tsx': 2,
  'web/src/pages/admin/ClubsPage.tsx': 2,
  'web/src/pages/admin/EventsPage.tsx': 3,
  'web/src/pages/admin/FinancePage.tsx': 1,
  'web/src/pages/admin/GrowthEntryPage.tsx': 2,
  'web/src/pages/admin/MarketPage.tsx': 3,
  'web/src/pages/admin/OverviewPage.tsx': 2,
  'web/src/pages/admin/PlayersPage.tsx': 5,
  'web/src/pages/admin/SeasonsPage.tsx': 3,
  'web/src/pages/admin/SystemPage.tsx': 2,
  'web/src/pages/club/CoachPanel.tsx': 4,
  'web/src/pages/market/MarketBoardPage.tsx': 1,
  'web/src/pages/market/MarketFreePage.tsx': 1,
  'web/src/pages/market/MarketIntelPage.tsx': 1,
  'web/src/pages/market/MarketMinePage.tsx': 1,
};
/** 全树 <table> 基线 = 点名页之和（48）：跌破说明扫描器空转（假绿） */
const TABLE_BASELINE = Object.values(TABLES_BY_FILE_MIN).reduce((sum, n) => sum + n, 0);

function countTables(src: string): number {
  return (src.match(/<table[\s>]/g) ?? []).length;
}

/**
 * 类名必须是独立的 `table-wrap` 记号：改名成 `table-wrap-broken`（或 `table-wrapX`）不算包裹——
 * 子串匹配在这里会假绿，变异自证 V1 就按「临时改名」弄坏。
 */
const TABLE_WRAP_RE = /(?<![\w-])table-wrap(?![\w-])/;

function hasTableWrap(line: string): boolean {
  return TABLE_WRAP_RE.test(line);
}

/** 表格判据：`<table` 行的紧邻上一非空行不含 table-wrap 即命中，返回 `文件:行 …` 定位串 */
function tablesMissingWrap(file: string, src: string): string[] {
  const lines = src.split('\n');
  const offenders: string[] = [];
  lines.forEach((text, i) => {
    if (!/<table[\s>]/.test(text)) return;
    let prev = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].trim() !== '') {
        prev = j;
        break;
      }
    }
    if (prev === -1 || !hasTableWrap(lines[prev])) {
      const above = prev === -1 ? '（文件开头）' : lines[prev].trim();
      offenders.push(`${file}:${i + 1} ${text.trim()}  ←上一非空行：${above}`);
    }
  });
  return offenders;
}

// ---- 判据 2：style={{ … }} 里不得出现固定 width / minWidth ----

type FixedWidth = { file: string; line: number; prop: 'width' | 'minWidth'; literal: string };

/** 固定宽判据：纯数字（px）与 px/rem 字面量才算；`100%`、`min(…)`、`calc(…)`、模板串等流式写法不算 */
function isFixedWidthLiteral(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:px|rem)?$/.test(value.trim());
}

/** 取出全部 `style={{ … }}` 字面量块：花括号配对取块，返回起始行与块文本 */
function styleBlocks(src: string): { line: number; text: string }[] {
  const marker = 'style={{';
  const blocks: { line: number; text: string }[] = [];
  let at = src.indexOf(marker);
  while (at !== -1) {
    let depth = 1;
    let i = at + marker.length;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push({ line: lineAt(src, at), text: src.slice(at + marker.length, i) });
    at = src.indexOf(marker, i + 2);
  }
  return blocks;
}

/** 键必须紧跟在 `{`、逗号或空白之后（挡住 `'border-width'` 这类连字符键误判） */
const STYLE_PROP_RE = /(?:^|[{,\s]+)(width|minWidth)\s*:\s*(?:'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`|([^,\n}]+))/g;

function fixedWidths(file: string, src: string): FixedWidth[] {
  const out: FixedWidth[] = [];
  for (const block of styleBlocks(src)) {
    for (const m of block.text.matchAll(STYLE_PROP_RE)) {
      const literal = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
      if (!isFixedWidthLiteral(literal)) continue;
      out.push({
        file,
        line: block.line + (block.text.slice(0, m.index ?? 0).match(/\n/g)?.length ?? 0),
        prop: m[1] as 'width' | 'minWidth',
        literal,
      });
    }
  }
  return out;
}

/**
 * 允许清单：v6.20.0 评审 P0-1 裁决保留的固定宽（每条带理由）。清单内外双向核对：
 * - 清单外的固定宽 → 红（新写的定宽必须显式登记）；
 * - 清单条目不再恰好命中 1 次（代码改流式/被挪走）→ 也红（条目腐烂要来看一眼）。
 */
const FIXED_WIDTH_ALLOWLIST = [
  {
    file: 'web/src/pages/admin/BrandsPage.tsx',
    prop: 'width' as const,
    literal: '96',
    why: '品牌列表「行业」列的表内 <input> 定宽——min(N,100%) 的百分比分量会改变桌面列宽分配（评审 P0-1），窄屏保底由 .table-wrap 横滚承担',
  },
  {
    file: 'web/src/pages/admin/BrandsPage.tsx',
    prop: 'width' as const,
    literal: '72',
    why: '品牌列表「热度」列的表内 <input> 定宽（同上，评审 P0-1 裁决保留）',
  },
  {
    file: 'web/src/pages/admin/BrandsPage.tsx',
    prop: 'width' as const,
    literal: '84',
    why: '品牌列表「档位」列的表内 <select> 定宽（同上，评审 P0-1 裁决保留）',
  },
  {
    file: 'web/src/pages/admin/SystemPage.tsx',
    prop: 'minWidth' as const,
    literal: '18rem',
    why: '系统页表格内编辑 <input> 的回退定宽（评审 P0-1：保住桌面列宽与横扫前一致），窄屏靠 .table-wrap 横滚',
  },
  {
    file: 'web/src/pages/Offers.tsx',
    prop: 'width' as const,
    literal: '12',
    why: '页签行 <span aria-hidden> 分隔装饰块，不承载内容宽度（12px 是视觉分隔，不是布局保底）',
  },
];

const fixedWidthKey = (v: { file: string; prop: string; literal: string }): string => `${v.file}|${v.prop}|${v.literal}`;
const fmtFixedWidth = (v: FixedWidth): string => `${v.file}:${v.line} style 内 ${v.prop}: ${v.literal}`;

// ---- 判据 3：styles.css 里的抽屉触控目标 ----

type CssRule = { selector: string; body: string; line: number };

/** 极简规则解析：`选择器 { 声明 }`（@media 包裹的内层规则同样能被拆出来；不建 AST，够用即止） */
function cssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const at = (m.index ?? 0) + (m[1].length - m[1].trimStart().length);
    rules.push({ selector: m[1].trim(), body: m[2], line: lineAt(css, at) });
  }
  return rules;
}

/** 收集选择器命中规则的某条声明（值 + 行号）；exactToken 用于 `.btn` 这类不能按子串匹配的短类名 */
function declarations(
  rules: CssRule[],
  selectorPart: string,
  prop: string,
  exactToken = false,
): { value: string; line: number }[] {
  const out: { value: string; line: number }[] = [];
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g');
  for (const rule of rules) {
    const hit = rule.selector.split(',').some((sel) => {
      const s = sel.trim();
      return exactToken ? s.split(/\s+/).includes(selectorPart) : s.includes(selectorPart);
    });
    if (!hit) continue;
    for (const m of rule.body.matchAll(re)) out.push({ value: m[1].trim(), line: rule.line });
  }
  return out;
}

function minAtLeast(rules: CssRule[], selector: string, prop: string, min: number, exactToken = false): { ok: boolean; seen: string } {
  const decls = declarations(rules, selector, prop, exactToken);
  return {
    ok: decls.some((d) => Number.parseInt(d.value, 10) >= min),
    seen: decls.map((d) => `styles.css:${d.line} ${prop}: ${d.value}`).join(' / ') || '未找到该声明',
  };
}

describe('v6.20.0 窄屏整治静态扫描闸门（docs/test-plans/v6.20.0-mobile-skeleton-baseline.md）', () => {
  it('TC-SWP-01 · <table> 穷尽包裹 .table-wrap（web/src 全树 tsx，不抽样）', () => {
    // 最大组口径：扫描面 = 全树 *.tsx（不是抽样清单）；计数跌破基线 = 遍历器漏目录，不许静默通过
    expect(TSX_FILES.length, `web/src 全树 *.tsx 计数 ${TSX_FILES.length}，跌破基线 ${TSX_BASELINE}（遍历器漏目录？）`).toBeGreaterThanOrEqual(TSX_BASELINE);
    expect(TSX_FILES).toContain('web/src/pages/club/CoachPanel.tsx');
    expect(TSX_FILES).toContain('web/src/components/MultiSelect.test.tsx'); // *.test.tsx 也在扫描面内

    const offenders: string[] = [];
    const below: string[] = [];
    let tables = 0;
    for (const file of TSX_FILES) {
      const src = read(file);
      tables += countTables(src);
      offenders.push(...tablesMissingWrap(file, src));
    }
    for (const [file, min] of Object.entries(TABLES_BY_FILE_MIN)) {
      const got = countTables(read(file));
      if (got < min) below.push(`${file}: 扫描到 ${got} 处 <table>，低于本批基线 ${min}（包裹被摘或页面重构；确认后同步下调基线）`);
    }

    expect(tables, `全树 <table> 计数 ${tables} 跌破本批基线 ${TABLE_BASELINE}：扫描器空转 = 假绿`).toBeGreaterThanOrEqual(TABLE_BASELINE);
    expect(below, 'spec 点名页的表数跌破基线：先查是不是包裹/表格被摘').toEqual([]);
    expect(offenders, '这些 <table> 的紧邻上一非空行不是 .table-wrap 包裹（v6.20.0 P-表格保底）').toEqual([]);
  });

  it('TC-SWP-02/03 · 内联固定 width/minWidth 禁令（style={{…}} 字面量，白名单外零命中）', () => {
    const found = TSX_FILES.flatMap((file) => fixedWidths(file, read(file)));
    const allowed = new Set(FIXED_WIDTH_ALLOWLIST.map(fixedWidthKey));
    const problems: string[] = [];

    for (const entry of FIXED_WIDTH_ALLOWLIST) {
      const hits = found.filter((v) => fixedWidthKey(v) === fixedWidthKey(entry));
      if (hits.length !== 1) {
        problems.push(`允许清单条目命中 ${hits.length} 次（应为 1）——${fixedWidthKey(entry)}（${entry.why}）`);
      }
    }
    for (const v of found) {
      if (allowed.has(fixedWidthKey(v))) continue;
      problems.push(`${fmtFixedWidth(v)} —— 固定宽禁令：改流式 min(N, 100%)，或按 v6.20.0 裁决登记允许清单（带理由）`);
    }

    expect(problems, '内联固定宽禁令（TC-SWP-02/03）：白名单外零命中、白名单条条命中').toEqual([]);
  });

  it('TC-SWP-04 · 抽屉触控目标：三个类存在且命中区 ≥36px（styles.css 规则级）', () => {
    const rules = cssRules(read(STYLES_CSS));

    // 1) 窄屏抽屉的类名契约：styles.css 里必须有规则块
    for (const cls of ['.admin-nav-toggle', '.admin-drawer-close', '.admin-nav-link']) {
      const hit = rules.filter((r) => r.selector.includes(cls));
      expect(hit.length, `styles.css 找不到 ${cls} 规则块（v6.20.0 窄屏抽屉类名契约）`).toBeGreaterThan(0);
    }

    // 2) × 关闭钮：命中区 ≥36×36（评审 P1-1）
    const closeW = minAtLeast(rules, '.admin-drawer-close', 'min-width', 36);
    const closeH = minAtLeast(rules, '.admin-drawer-close', 'min-height', 36);
    expect(closeW.ok, `.admin-drawer-close 缺 min-width ≥36（${closeW.seen}）`).toBe(true);
    expect(closeH.ok, `.admin-drawer-close 缺 min-height ≥36（${closeH.seen}）`).toBe(true);

    // 3) 导航项：窄屏触控高度 ≥36（当前在 @media (max-width: 760px) 的 .admin-sidebar .admin-nav-link 里）
    const linkH = minAtLeast(rules, '.admin-nav-link', 'min-height', 36);
    expect(linkH.ok, `.admin-nav-link 缺 min-height ≥36（${linkH.seen}）`).toBe(true);

    // 4) 切换钮自己只给布局（justify-self），≥36px 命中区来自它同时带的 .btn（当前 .btn 的 min-height: 36px
    //    在 @media (max-width: 640px) 块内，375 基线命中；641–760 区间属现状边界，本批裁决不动 styles.css）
    const cls = /className=["']([^"']*admin-nav-toggle[^"']*)["']/.exec(read(ADMIN_LAYOUT));
    const tokens = cls ? cls[1].split(/\s+/) : [];
    expect(tokens, `${ADMIN_LAYOUT} 的 admin-nav-toggle 必须同时带 btn（它的 ≥36px 命中区由 .btn 提供）`).toContain('btn');
    const btnH = minAtLeast(rules, '.btn', 'min-height', 36, true);
    expect(btnH.ok, `.btn 缺 min-height ≥36（${btnH.seen}）：admin-nav-toggle 的触控高度靠它`).toBe(true);
  });

  it('判据自检 · 固定宽字面量与表格包裹识别的最小正反例（防扫描器空转）', () => {
    // 固定宽：纯数字（px）与 px/rem 字面量；流式写法不算
    for (const fixed of ['96', '96px', '18rem']) {
      expect(isFixedWidthLiteral(fixed), `${fixed} 应判为固定宽`).toBe(true);
    }
    for (const flow of ['100%', 'min(90px, 100%)', 'min(260px, 86vw)', 'min(9rem, 100%)', 'calc(100% - 12px)', 'auto']) {
      expect(isFixedWidthLiteral(flow), `${flow} 是流式写法，不该判为固定宽`).toBe(false);
    }

    // 表格包裹：包了 → 不命中；裸表 → 命中并点名行号；改名成 table-wrap-broken 不算包裹（子串陷阱）
    const wrapped = ['<div className="table-wrap">', '  <table className="t">', '  </table>', '</div>'].join('\n');
    expect(tablesMissingWrap('x.tsx', wrapped)).toEqual([]);
    expect(hasTableWrap('<div className="table-wrap hidden">')).toBe(true);
    expect(hasTableWrap('<div className="table-wrap-broken">'), '改名成 table-wrap-broken 不算包裹').toBe(false);
    const naked = ['<div className="card">', '  <table className="t">', '  </table>', '</div>'].join('\n');
    const hit = tablesMissingWrap('x.tsx', naked);
    expect(hit.length).toBe(1);
    expect(hit[0]).toContain('x.tsx:2');
  });
});
