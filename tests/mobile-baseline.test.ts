// 守卫测试：v6.20.0「系统范围手机版窄屏整治」第一批的静态扫描闸门。
// 测试计划：docs/test-plans/v6.20.0-mobile-skeleton-baseline.md（TC-SWP-01 P0、TC-SWP-02/03 P1、TC-SWP-04 P1）。
// v6.21.0 增补（计划 docs/test-plans/v6.21.0-edit-panel-mobile.md）：
// - TC-SWP-05：coach-sticky 粘性首列的静态闸门——e2e ⑮ 在本地观众登录下不渲染教练台（几何断言条件
//   降级），粘性回归由本例兜住；判据按 className 形态计数（P2-2：文本计数会把注释误算进去）。
// - TC-ENT-03/09、TC-REG-02、TC-BRD-02、TC-IMP-03（P1-2：测试计划承诺的静态用例落地）——
//   卡片流类名契约与窄屏/桌面互斥、inputMode、卡片状态枚举、品牌卡对等元信息行、imports 表单重排。
// v6.22.0 增补（计划 docs/test-plans/v6.22.0-public-reading-mobile.md，spec §4）：
// - 公开阅读页（Player 事件卡 / table-sticky-2 三表 / TopBar 渐隐提档 ≤1024 / toast 让位 / dossier 900 档）
//   的静态契约；e2e ⑯ 只在真渲染时红，这里兜「类名/规则被下批重构删掉」的回归。
// v6.30.0 增补（C 段：球队详情页两张球员表列集重定，plan 见 docs/test-plans/ 下 A/B/C 同批计划）：
// - TC-STK 的粘性列位平移：阵容名单（table-sticky-2，≤760）钉「标记 + 号码 + 姓名」三列、UID 不钉；
//   注册名单（coach-sticky，≤640）钉「分配 + 姓名」两列、原第 2 列让位。e2e ⑨ 只断行数与横向溢出，
//   列位/冻结点错位不会红，由本例兜住（判据都是「第 N 列 sticky / 第 M 列不 sticky」的规则级断言）。
//
// 为什么要文本级扫描：这三条约定只活在 JSX/CSS 文本里——表格少包一层 `.table-wrap`、重构时又写回
// `style={{ width: 320 }}`、抽屉关闭钮的 36px 命中区被删——组件测试与单测都不会红；e2e ⑫ 也只在
// 375 视口真溢出时才红（等看见破版已经晚了）。所以用扫描兜住「下批重构的回归」。
//
// 口径（测试计划「最坏情况口径」）：遍历 web/src 全树 *.tsx（含 *.test.tsx，不抽样，当前 52 个）逐文件扫；
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
// v6.30.0 A 段：球队详情页页签化——CoachPanel 拆成六个 club/ 组件，教练台两张 coach-sticky 表随代码走
const DESK_TAB = `${WEB_SRC}/pages/club/DeskTab.tsx`;
const VENUE_TAB = `${WEB_SRC}/pages/club/VenueTab.tsx`;
const SQUAD_TAB = `${WEB_SRC}/pages/club/SquadTab.tsx`;
const GROWTH_ENTRY = `${WEB_SRC}/pages/admin/GrowthEntryPage.tsx`;
const BRANDS_PAGE = `${WEB_SRC}/pages/admin/BrandsPage.tsx`;
const IMPORTS_PAGE = `${WEB_SRC}/pages/admin/ImportsPage.tsx`;
const PLAYER_PAGE = `${WEB_SRC}/pages/Player.tsx`;
const MARKET_INTEL = `${WEB_SRC}/pages/market/MarketIntelPage.tsx`;
// v6.24.0 批次 B：出价历史表从 MarketBoardPage 搬进 MarketListingOverlay 浮层，TC-STK 挂类点随表走
const MARKET_OVERLAY = `${WEB_SRC}/pages/market/MarketListingOverlay.tsx`;
// v6.30.0 A 段：ClubDetail 的阵容名单表随页签搬进 club/SquadTab.tsx，TC-STK 挂类点随之（常量见上）

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
/** 实测全树数（v6.31.0 广告板随代码走：77，含 16 个 *.test.tsx）：只增不减——跌破只可能是遍历器漏目录（最大组口径，不许抽样）。
 *  旧值 52 停在 v6.24.0（转会台/激活页时代），此后各版持续加页（v6.30.0 球队页签化拆出 club/*、v6.31.0 广告板），
 *  本次按实测重设，让「只增不减」重新有牙齿（>= 语义下旧值早已失效）。 */
const TSX_BASELINE = 77;

function read(relPath: string): string {
  return readFileSync(relPath, 'utf8');
}

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * 取出 css 里每个 `@media (<query>) { … }` 块的正文（花括号配平），供「规则是否活在该媒体块内」的判定。
 * v6.31.0 起因广告板在文件末尾又添了 ≤640 块，「取最后一个媒体块再切尾」的写法会误判，故改为按块取正文。
 */
function mediaBlocks(css: string, query: string): string[] {
  const out: string[] = [];
  let at = css.indexOf(query);
  while (at !== -1) {
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out.push(css.slice(open, end + 1));
    at = css.indexOf(query, end);
  }
  return out;
}

// ---- 判据 1：每个 <table> 的紧邻上一非空行必须是 .table-wrap 包裹 ----

/**
 * spec §3 点名页的表数基线（本批实测；只作抽验下限，不是白名单）：
 * 某页跌破 = 包裹/表格被摘或页面被重构，必须显式来看一眼并同步下调基线。
 */
const TABLES_BY_FILE_MIN: Record<string, number> = {
  'web/src/components/ImportPreviewBlock.tsx': 3,
  'web/src/pages/Ledger.tsx': 2,
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
  // v6.30.0 A 段：球队页签化——阵容名单 / 转会两表（parts.TransferTable 复用一次定义）/ 注册表 / 主场战报 / 事件表随代码搬进 club/ 各 Tab；ClubDetail 自身归零不再点名
  'web/src/pages/club/parts.tsx': 1,
  'web/src/pages/club/SquadTab.tsx': 1,
  'web/src/pages/club/DeskTab.tsx': 2,
  'web/src/pages/club/VenueTab.tsx': 1,
  'web/src/pages/market/MarketListingOverlay.tsx': 1,
  // v6.24.0：可激活名单表随 ActivateSection 从 MarketFreePage 搬进新激活页（全树表数不变）
  'web/src/pages/market/MarketActivationPage.tsx': 1,
  'web/src/pages/market/MarketIntelPage.tsx': 1,
  // v6.23.0 转会台：原 Negotiations/Offers/MarketMinePage 三页的表格随代码搬进 desk 三区；
  // v6.32.0：NegotiationsSection 删「已落定的谈判」表（历史归球队中心转会页签）⇒ 2 → 1（报价记录表）
  'web/src/pages/market/desk/ListingsBidsSection.tsx': 1,
  'web/src/pages/market/desk/NegotiationsSection.tsx': 1,
  'web/src/pages/market/desk/OffersSection.tsx': 2,
};
/** 全树 <table> 基线 = 点名页之和（v6.32.0 起 47）：跌破说明扫描器空转（假绿） */
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
    file: 'web/src/pages/market/desk/OffersSection.tsx',
    prop: 'width' as const,
    literal: '12',
    why: '页签行 <span aria-hidden> 分隔装饰块，不承载内容宽度（12px 是视觉分隔，不是布局保底）；v6.23.0 随报价区从 pages/Offers.tsx 搬来',
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
    expect(TSX_FILES).toContain('web/src/pages/club/DeskTab.tsx');
    expect(TSX_FILES).toContain('web/src/pages/club/VenueTab.tsx');
    expect(TSX_FILES).toContain('web/src/pages/club/SquadTab.tsx');
    expect(TSX_FILES).toContain('web/src/pages/club/parts.tsx'); // v6.30.0 A 段：CoachPanel 拆出的六件套都在扫描面内
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

  it('TC-SWP-05 · coach-sticky 粘性首列：DeskTab + VenueTab 合计恰 2 处挂类 + styles.css ≤640 块含 sticky 规则（v6.21.0，v6.30.0 页签化随代码走）', () => {
    // e2e ⑮ 在本地观众登录下教练台不渲染，几何断言条件降级——粘性回归（摘类、删规则）在这里红。
    // v6.30.0 A 段：CoachPanel 拆成 DeskTab（注册名单表 + 事件表）与 VenueTab（主场战报表），挂类总数不变。
    // P2-2（评审）：按 className 形态计数——文本级 /coach-sticky/g 会把注释里的提及误算进去
    const hits = [DESK_TAB, VENUE_TAB].reduce(
      (n, file) => n + (read(file).match(/className="[^"]*\bcoach-sticky\b/g)?.length ?? 0),
      0,
    );
    expect(hits, `DeskTab + VenueTab 的 coach-sticky 挂类（className 形态）应为恰 2 处（注册名单表 + 主场战报表）：实测 ${hits}`).toBe(2);

    // 规则必须活在某个 (max-width: 640px) 媒体块**内部**（≤640 规则域），且真有 position: sticky。
    // v6.31.0：原写法取 lastIndexOf 再切尾——广告板在文件末尾又加了一个 ≤640 块，尾切法会把 coach-sticky 判成「不在域内」。
    // 改成按花括号配平取出每个 ≤640 块的正文再找持有者：既不受新增块位置影响，也不放过「规则漏到全局（桌面也粘）」的真回归。
    const css = read(STYLES_CSS);
    const blocks = mediaBlocks(css, '(max-width: 640px)');
    expect(blocks.length, 'styles.css 找不到 (max-width: 640px) 媒体块').toBeGreaterThan(0);
    const holder = blocks.find((block) => block.includes('.coach-sticky'));
    expect(holder, 'styles.css 的 ≤640 域内没有 .coach-sticky 规则（粘性首列被删 / 漏到全局？）').toBeTruthy();
    expect(holder!, 'styles.css 的 .coach-sticky 规则缺 position: sticky').toMatch(/\.coach-sticky[^{}]*\{[^}]*position:\s*sticky/s);
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

describe('v6.21.0 编辑面板窄屏静态契约（docs/test-plans/v6.21.0-edit-panel-mobile.md，P1-2 落地）', () => {
  /** 类名独立记号匹配（防 table-wrap-broken 式子串假绿，与 TABLE_WRAP_RE 同口径） */
  const token = (cls: string) => new RegExp(`(?<![\\w-])${cls}(?![\\w-])`);

  it('TC-ENT-03 · 成长补录卡片流：六类名契约 + 窄屏/桌面互斥 + sumbar portal（GrowthEntryPage + styles.css）', () => {
    const src = read(GROWTH_ENTRY);

    // 断点常量与 760 档一致（V2 变异：改成 800 会在 761 档漏卡片流）
    expect(src).toContain("const ENTRY_CARDS_QUERY = '(max-width: 760px)'");
    expect(src).toContain('const narrow = useMediaQuery(ENTRY_CARDS_QUERY);');

    // 互斥分支：narrow ? 卡片流 : 表格流——卡片分支在前、else 接表格
    const cardsAt = src.indexOf('<div className="entry-cards">');
    const elseAt = src.indexOf(') : (', cardsAt);
    const tableAt = src.indexOf('<table className="entry-table">');
    expect(cardsAt, 'GrowthEntryPage 缺卡片流分支 entry-cards').toBeGreaterThan(-1);
    expect(elseAt, '卡片流与表格流之间找不到三元 else').toBeGreaterThan(cardsAt);
    expect(tableAt, 'GrowthEntryPage 缺桌面表格分支 entry-table').toBeGreaterThan(elseAt);

    // 表头「全部保存」只留在桌面（≤760 移入汇总条）；汇总条仅窄屏且 portal 到 body
    // （P1-1：.table-wrap 升格容器后布局包容含块会吃掉面板内 fixed 的视口定位，portal 逃出包容子树）
    expect(src).toContain('{!narrow && (');
    expect(src).toContain('{narrow && (');
    expect(src).toContain('createPortal(');
    expect(src).toContain('document.body');

    // styles.css 规则级：六类名各有规则块（TSX 有类、CSS 没规则 = 死类名）
    const rules = cssRules(read(STYLES_CSS));
    for (const cls of ['entry-cards', 'entry-card', 'entry-card-head', 'entry-card-grid', 'entry-card-foot', 'entry-sumbar']) {
      const hit = rules.filter((r) => token(cls).test(r.selector));
      expect(hit.length, `styles.css 找不到 .${cls} 规则块（v6.21.0 卡片流类名契约）`).toBeGreaterThan(0);
    }
    // 汇总条 fixed 是正解（spec §0-2 实测裁决；V3 口径反转：回流内 sticky 才是变异），面板 sticky+100cqw
    // 是 P1-1 的出宽约束修法，容器升格是 100cqw 的前提——三处缺一即红。
    // 按独立选择器取规则（.entry-panel .entry-head 这类后代选择器不计入）；cssRules 的选择器捕获
    // 会带上紧邻的注释文本，先剥注释再比对
    const byExact = (cls: string) =>
      rules.filter((r) => r.selector.split(',').some((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim() === `.${cls}`));
    const sumbar = byExact('entry-sumbar')[0];
    expect(sumbar, 'styles.css 缺独立 .entry-sumbar 规则').toBeTruthy();
    expect(sumbar?.body, '.entry-sumbar 应为 position: fixed 常驻视口底').toMatch(/position:\s*fixed/);
    const panel = byExact('entry-panel')[0];
    expect(panel, 'styles.css 缺独立 .entry-panel 规则').toBeTruthy();
    expect(panel?.body, '.entry-panel 应 sticky left:0 + width:100cqw（评审 P1-1 出宽）').toMatch(/position:\s*sticky[\s\S]*left:\s*0[\s\S]*width:\s*100cqw|left:\s*0[\s\S]*position:\s*sticky/);
    const wrap = byExact('table-wrap').find((r) => /container-type/.test(r.body));
    expect(wrap, '.table-wrap 应升格 container-type: inline-size（100cqw 的容器前提）').toBeTruthy();
  });

  it('TC-ENT-09 · 评分 inputMode="decimal"、整数格 inputMode="numeric"（卡片/表格两分支各就位）', () => {
    const src = read(GROWTH_ENTRY);
    // 卡片流与表格流两分支语义逐条一致：评分 1 处 decimal、夺回球权+扑救各 1 处 numeric（每分支）
    const decimal = src.match(/inputMode="decimal"/g)?.length ?? 0;
    const numeric = src.match(/inputMode="numeric"/g)?.length ?? 0;
    expect(decimal, `inputMode="decimal" 实测 ${decimal} 处（应 2：卡片流+表格流各 1）`).toBe(2);
    expect(numeric, `inputMode="numeric" 实测 ${numeric} 处（应 4：两分支 × 夺回球权/扑救）`).toBe(4);
  });

  it('TC-REG-02 · 卡片状态枚举：已录/训练营/校验/只读/脏行/行保存禁用（P0 净增，卡片分支内）', () => {
    const src = read(GROWTH_ENTRY);
    const cardsAt = src.indexOf('<div className="entry-cards">');
    const tableAt = src.indexOf('<table className="entry-table">');
    expect(cardsAt).toBeGreaterThan(-1);
    expect(tableAt).toBeGreaterThan(cardsAt);
    const branch = src.slice(cardsAt, tableAt); // 卡片分支源码（互斥断言由 TC-ENT-03 兜住）

    // 已录格：来源徽标（同锚去重，无纠正通道如实标注）
    expect(branch, '卡片缺「已录」来源徽标').toContain('badge gray">已录 · ');
    // 训练营：整卡置灰类 + 说明 title
    expect(branch, '卡片缺 row-trainee 置灰类').toContain("row-trainee");
    expect(branch, '卡片缺「训练营不按场次计」标注').toContain('训练营不按场次计');
    // 校验问题：徽标 + invalid 类（评分 7-10 闸）
    expect(branch, '卡片缺「校验问题」徽标').toContain('校验问题');
    expect(branch, '卡片缺 invalid 校验类').toContain("' invalid' : ''");
    // 已录格锁定：只读数值格
    expect(branch, '卡片缺 readOnly 锁定格（entry-num）').toContain('readOnly tabIndex={-1}');
    // 脏行：dirty 描边类 + 行保存禁用条件与桌面一致（ro/保存中/无脏行/有校验问题）
    expect(branch, '卡片缺 dirty 脏行类').toContain("' dirty' : ''");
    expect(branch, '卡片行保存禁用条件与桌面表格不一致').toContain('disabled={ro || saving !== null || !dirtyRow || issues.length > 0}');
  });

  it('TC-BRD-02 · 品牌卡片流契约：类名 + 对等元信息行（P2-4）+ 死规则不回归（P2-3）', () => {
    const src = read(BRANDS_PAGE);
    expect(src).toContain("const NARROW_QUERY = '(max-width: 760px)'");
    expect(src).toContain('className="brand-cards"');
    expect(src).toContain('className="brand-card"');
    expect(src).toContain('className="brand-card-grid"');
    expect(src).toContain('className="brand-new-form"');

    // P2-4：窄屏卡与桌面「来源/状态/生效冠名」三列对等（判定式与桌面 td 同式）
    expect(src, '品牌卡缺 brand-card-meta 元信息行').toContain('className="brand-card-meta"');
    expect(src, '品牌卡缺「来源」判定式（与桌面 td 同口径）').toContain("row.source === 'custom' ? '自定义' : '种子'");
    expect(src, '品牌卡缺「状态」判定式（与桌面 td 同口径）').toContain("row.status === 'adopted' ? '在池' : '已弃用'");
    expect(src, '品牌卡缺「生效冠名」字段').toContain('row.active_contracts');

    // 互斥：窄屏卡片流在前、桌面表格流在后
    const cardsAt = src.indexOf('className="brand-cards"');
    const tableAt = src.indexOf('<div className="table-wrap">');
    expect(cardsAt).toBeGreaterThan(-1);
    expect(tableAt).toBeGreaterThan(cardsAt);

    // styles.css：卡片流规则齐 + 死规则（P2-3 已删）不再回来
    const rules = cssRules(read(STYLES_CSS));
    for (const cls of ['brand-cards', 'brand-card', 'brand-card-grid', 'brand-new-form', 'brand-card-meta']) {
      const hit = rules.filter((r) => token(cls).test(r.selector));
      expect(hit.length, `styles.css 找不到 .${cls} 规则块（v6.21.0 品牌卡类名契约）`).toBeGreaterThan(0);
    }
    const css = read(STYLES_CSS);
    expect(css, '.brand-card-head 是死规则（TSX 用 <b>，P2-3 已删），不许回来').not.toMatch(token('brand-card-head'));
    expect(css, '.brand-card-foot 是死规则（TSX 用 .btn-row，P2-3 已删），不许回来').not.toMatch(token('brand-card-foot'));
  });

  it('TC-IMP-03 · imports 表单 ≤760 重排：.admin-section label.field 单列全宽 + .seg 折行（styles.css）', () => {
    // 规则活在最后一个 ≤760 媒体块（③ imports 块）；面里对得上——ImportsPage 真在用这些类
    const src = read(IMPORTS_PAGE);
    expect((src.match(/className="field"/g) ?? []).length, 'ImportsPage 的 label.field 面变少了，CSS 块前提失效').toBeGreaterThanOrEqual(5);
    expect(src, 'ImportsPage 缺 admin-section 段（.admin-section label.field 前提失效）').toContain('card admin-section');

    const css = read(STYLES_CSS);
    // 按块头注释锚定（v6.22.0 后文件尾部又追加了新的 ≤760 块，lastIndexOf 会锚错块）
    const anchor = css.indexOf('/* ---- ③ 导入页表单重排（v6.21.0）');
    expect(anchor, 'styles.css 找不到 ③ imports 块头注释——块被改名/挪动，锚点需同步').toBeGreaterThan(-1);
    // P2-3：tail 切到本块为止（原来切到 EOF，规则被挪进后面的其他媒体块时仍然绿）
    const start = css.indexOf('@media', anchor);
    const next = css.indexOf('@media', start + 1);
    const block = css.slice(start, next === -1 ? undefined : next);
    expect(block, '≤760 块缺 .admin-section label.field 单列全宽规则').toMatch(/\.admin-section label\.field\s*\{[^}]*width:\s*100%/);
    expect(block, '≤760 块缺 .admin-section label.field .seg 折行规则').toMatch(/\.admin-section label\.field \.seg\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

describe('v6.22.0 公开阅读窄屏静态契约（docs/test-plans/v6.22.0-public-reading-mobile.md，spec §4）', () => {
  /** 类名独立记号匹配（防 table-sticky-2-broken 式子串假绿，与上方 token 同口径） */
  const token = (cls: string) => new RegExp(`(?<![\\w-])${cls}(?![\\w-])`);
  const rules = () => cssRules(read(STYLES_CSS));

  it('公开阅读 · 球员页事件卡契约（TC-PLR）：断点字面 + 卡片/表格互斥 + 类名规则在 CSS + transfer-table nowrap 保留', () => {
    const src = read(PLAYER_PAGE);
    // 断点常量字面（V2 同款变异：改 800 会在 761 档漏卡片流）
    expect(src).toContain("const PLAYER_CARDS_QUERY = '(max-width: 760px)'");
    // 互斥分支：narrow ? 事件卡 : .transfer-table 表格（卡片在前、else 接表格；转会页签）
    const cardsAt = src.indexOf('<div className="event-cards">');
    const elseAt = src.indexOf(') : (', cardsAt);
    const tableAt = src.indexOf('transfer-table', elseAt);
    expect(cardsAt, 'Player.tsx 缺事件卡分支 event-cards').toBeGreaterThan(-1);
    expect(elseAt, '事件卡与表格之间找不到三元 else').toBeGreaterThan(cardsAt);
    expect(tableAt, 'Player.tsx 桌面分支缺 .transfer-table 表格').toBeGreaterThan(elseAt);
    expect(tableAt - elseAt, 'else 与 transfer-table 距离过远——互斥断言可能匹配到别的三元').toBeLessThan(2000);

    // styles.css 规则级：五类名各有规则块（TSX 有类、CSS 没规则 = 死类名）
    for (const cls of ['event-cards', 'event-card', 'event-card-head', 'event-card-grid', 'event-card-foot']) {
      const hit = rules().filter((r) => token(cls).test(r.selector));
      expect(hit.length, `styles.css 找不到 .${cls} 规则块（v6.22.0 事件卡类名契约）`).toBeGreaterThan(0);
    }
    // 桌面 1280 零变化的锚：.transfer-table 的 nowrap 规则不许被顺手删掉
    const nowrap = rules().filter((r) => r.selector.includes('transfer-table') && /white-space:\s*nowrap/.test(r.body));
    expect(nowrap.length, '.transfer-table 的 nowrap 规则缺失（桌面表格分支被改）').toBeGreaterThan(0);
  });

  it('公开阅读 · table-sticky-2 三表挂类 + ≤760 粘性规则 + coach-sticky 原块仍在（TC-STK）', () => {
    // 三张参考型宽表各恰好挂一次（转会记录表 transfer-table 不在本闸门内，恒不挂该类）
    for (const [file, name] of [
      [MARKET_INTEL, 'MarketIntelPage'],
      [MARKET_OVERLAY, 'MarketListingOverlay'],
      [SQUAD_TAB, 'SquadTab'], // v6.30.0 A 段：阵容名单表随页签搬进 SquadTab
    ] as const) {
      const hits = read(file).match(/className="table-sticky-2"/g)?.length ?? 0;
      expect(hits, `${name} 应恰好挂一处 className="table-sticky-2"，实挂 ${hits}`).toBe(1);
    }
    // ≤760 块：sticky 规则 + 列宽变量定义
    const stky = rules().filter((r) => token('table-sticky-2').test(r.selector) && /position:\s*sticky/.test(r.body));
    expect(stky.length, 'styles.css 缺 .table-sticky-2 的 position:sticky 规则（≤760 块）').toBeGreaterThan(0);
    const varDef = rules().filter((r) => token('table-sticky-2').test(r.selector) && /--stky-c1/.test(r.body));
    expect(varDef.length, 'styles.css 缺 .table-sticky-2 的 --stky-c1 列宽变量定义').toBeGreaterThan(0);
    // coach-sticky（≤640，v6.21.0）原块不动：粘性规则仍在（TC-SWP-05 的同类断言再兜一层）
    const coach = rules().filter((r) => token('coach-sticky').test(r.selector) && /position:\s*sticky/.test(r.body));
    expect(coach.length, 'styles.css 缺 .coach-sticky 的 position:sticky 规则（≤640 原块被动了）').toBeGreaterThan(0);
  });

  it('v6.30.0 C 段 · 球队页两张表粘性列位平移：阵容钉标记/号码/姓名（UID 不钉）、注册钉分配/姓名（原第 2 列让位）', () => {
    const css = read(STYLES_CSS);

    // ---- 阵容名单（≤760，table-sticky-2）：据首列标记格认表，冻结点从第 2 列挪到第 4 列（姓名）
    const squadAt = css.indexOf('/* v6.30.0 C 段：阵容名单列集重定后');
    const squadEnd = css.indexOf('/* ---- ⑤ Toast 让位');
    expect(squadAt, '≤760 块缺 v6.30.0 阵容名单粘性段（列集重定后没平移冻结点）').toBeGreaterThan(-1);
    expect(squadEnd, '找不到「⑤ Toast 让位」段头（切片终点失效，请同步本用例）').toBeGreaterThan(squadAt);
    const squadBlock = css.slice(squadAt, squadEnd);
    expect(squadBlock, '阵容表缺 --stky-c2（号码列定宽变量）').toMatch(/--stky-c2:/);
    expect(squadBlock, '阵容表第 4 列（姓名）没被钉住').toMatch(/td:nth-child\(4\)\s*\{[^}]*position:\s*sticky/);
    expect(squadBlock, '阵容表姓名列 left 未按两列宽相加（会与号码列错位）').toMatch(
      /left:\s*calc\(var\(--stky-c1\)\s*\+\s*var\(--stky-c2\)\)/,
    );
    expect(squadBlock, '阵容表第 2 列仍画冻结边（冻结块中间会多一道缝）').toMatch(/td:nth-child\(2\)\s*\{[^}]*border-right:\s*0/);
    // UID（第 3 列）必须不钉：整份 CSS 里 table-sticky-2 家族没有第 3 列的 sticky 规则
    const uidSticky = rules().filter(
      (r) =>
        token('table-sticky-2').test(r.selector) &&
        /nth-child\(3\)/.test(r.selector) &&
        /position:\s*sticky/.test(r.body),
    );
    expect(uidSticky.length, '阵容表把 UID 列也钉住了（应滑到姓名下面，不钉）').toBe(0);

    // ---- 注册名单（≤640，coach-sticky）：第 2 列让位、姓名列（第 5 列）成新冻结点
    const regAt = css.indexOf('/* v6.30.0 C 段：注册名单列集重定后');
    const regEnd = css.indexOf('/* ---- ④ 参考型宽表粘前两列（v6.22.0）');
    expect(regAt, '≤640 块缺 v6.30.0 注册名单粘性段').toBeGreaterThan(-1);
    expect(regEnd, '找不到「④ 参考型宽表粘前两列」段头（切片终点失效，请同步本用例）').toBeGreaterThan(regAt);
    const regBlock = css.slice(regAt, regEnd);
    expect(regBlock, '注册表缺 --coach-sticky-c1 覆盖（分配列放不下会被撑开、姓名列 left 错位）').toMatch(
      /--coach-sticky-c1:\s*10\.5em/,
    );
    expect(regBlock, '注册表第 2 列没让位（应与第 1 列粘连成 10.5em 宽的冻结块）').toMatch(
      /td:nth-child\(2\)\s*\{[^}]*position:\s*static/,
    );
    expect(regBlock, '注册表第 5 列（姓名）没被钉住').toMatch(/td:nth-child\(5\)\s*\{[^}]*position:\s*sticky/);
    expect(regBlock, '注册表姓名列 left 没接 --coach-sticky-c1').toMatch(/left:\s*var\(--coach-sticky-c1\)/);
    // 认表靠第 1 列的分配开关（.seg）：删掉它这条覆盖规则就全失效
    expect(regBlock, '注册表覆盖规则没据第 1 列的分配开关（.seg）认表').toMatch(/:has\(tbody td:nth-child\(1\) \.seg\)/);
  });

  it('公开阅读 · TopBar 渐隐提档 ≤1024：mask 规则整体挪入 1024 块（TC-TOP）', () => {
    // 横滑容器（.nav-links overflow-x:auto + contain:inline-size）是全局基础规则，无需提档；
    // 提档的只有「还有页签没露出来」的渐隐 mask（原 ≤640 块）。
    const css = read(STYLES_CSS);
    const i1024 = css.indexOf('(max-width: 1024px)');
    expect(i1024, 'styles.css 缺 (max-width: 1024px) 块（渐隐提档）').toBeGreaterThan(-1);
    const after = css.slice(i1024 + '(max-width: 1024px)'.length);
    const nextMedia = after.indexOf('@media');
    const block = nextMedia === -1 ? after : after.slice(0, nextMedia);
    expect(block, '≤1024 块缺 .nav-links.can-left 渐隐 mask 规则').toMatch(/\.nav-links\.can-left/);
    // 计划 TC-TOP-01 字面还要求「可横滑」：横滑能力（.nav-links overflow-x:auto + min-width:0）
    // 是全局基础规则，无人钉住时删掉它 mask 无从谈起、全套仍绿（评审 P3 补齐）
    const ovx = declarations(rules(), 'nav-links', 'overflow-x');
    expect(ovx.some((d) => d.value === 'auto'), `.nav-links 应有全局 overflow-x:auto（横滑容器能力），实见 ${JSON.stringify(ovx)}`).toBe(true);
    const minw = declarations(rules(), 'nav-links', 'min-width');
    expect(minw.some((d) => d.value === '0' || d.value === '0px'), `.nav-links 应有 min-width:0（允许收缩进顶栏），实见 ${JSON.stringify(minw)}`).toBe(true);
    // 挪走而非复制：.nav-links.can-left 的每一处出现都落在 1024 块内（两块规则漂移比缺失更难查）
    const idxs = [...css.matchAll(/\.nav-links\.can-left/g)].map((m) => m.index ?? 0);
    expect(idxs.length, 'styles.css 找不到 .nav-links.can-left 渐隐规则').toBeGreaterThan(0);
    for (const i of idxs) {
      expect(i, `.nav-links.can-left 出现在 ≤1024 块之外（index=${i} < ${i1024}）——渐隐应整体提档而非复制`).toBeGreaterThanOrEqual(i1024);
    }
  });

  it('公开阅读 · toast 不再吃点击：pointer-events 让位（TC-TST，spec ⑤）', () => {
    const decls = declarations(rules(), 'toast', 'pointer-events');
    expect(
      decls.some((d) => d.value === 'none'),
      `.toast 应 pointer-events: none（z-index 100 盖住 fixed 汇总条时点击要穿透），实见 ${JSON.stringify(decls)}`,
    ).toBe(true);
  });

  it('公开阅读 · dossier 单列断点 640→900：900 块单列规则在场（TC-PLR）', () => {
    const css = read(STYLES_CSS);
    // 块头注释锚（P2-3：lastIndexOf 在文件尾部追加新 900 块时会锚错块，与 TC-IMP-03 同款隐患）
    const anchor = css.indexOf('/* ---- ① 球员卷宗单列（v6.22.0）');
    expect(anchor, 'styles.css 找不到 ① dossier 块头注释——块被改名/挪动，锚点需同步').toBeGreaterThan(-1);
    const start = css.indexOf('@media', anchor);
    const next = css.indexOf('@media', start + 1);
    const block = css.slice(start, next === -1 ? undefined : next);
    expect(block, '≤900 块缺 .dossier 单列 grid 规则').toMatch(/\.dossier\s*\{[^}]*grid-template-columns:[^;}]*1fr/);
  });

  it('公开阅读 · 媒体块归属（P1-1/P2-1）：② 页签横滑 / ③ 事件卡 / ④ sticky-2 规则必须钉在各自的 ≤760 块内', () => {
    // V4 类变异（把规则从 ≤760 挪进 ≤640 等别的块）对 375 几何断言免疫（641–760 区间「DOM 有、
    // 样式不在」仍全绿）、对全局规则扫描也免疫（只查「存在」不查「在哪个块」）。锚 = v6.22.0 段头
    // 注释（styles.css 尾部新块全部带「---- 」注释头）；块体 = 首个 @media 起到下一个 @media。
    const css = read(STYLES_CSS);
    const blockOf = (header: string, label: string) => {
      const at = css.indexOf(header);
      expect(at, `styles.css 找不到 ${label} 块头注释「${header}」——块被改名/挪动，锚点需同步`).toBeGreaterThan(-1);
      const start = css.indexOf('@media', at);
      expect(start, `${label} 块头注释后找不到 @media`).toBeGreaterThan(at);
      const next = css.indexOf('@media', start + 1);
      return css.slice(start, next === -1 ? undefined : next);
    };
    // ② 页签横滑：overflow-x:auto + flex-wrap:nowrap——删任一条页签会折行，375 文档溢出断言察觉不到
    const b2 = blockOf('/* ---- ② 卷宗页签横滑（v6.22.0）', '②');
    expect(b2, '② ≤760 块缺 .dossier-tabs overflow-x:auto（页签横滑规则被挪块/删除）').toMatch(/\.dossier-tabs\s*\{[^}]*overflow-x:\s*auto/);
    expect(b2, '② ≤760 块缺 .dossier-tabs flex-wrap:nowrap（页签横滑规则被挪块/删除）').toMatch(/\.dossier-tabs\s*\{[^}]*flex-wrap:\s*nowrap/);
    // ③ 事件卡：五类名规则都必须落在 ③ 块内
    const b3 = blockOf('/* ---- ③ 事件卡片流（v6.22.0）', '③');
    for (const cls of ['event-cards', 'event-card', 'event-card-head', 'event-card-grid', 'event-card-foot']) {
      expect(b3, `③ ≤760 块内找不到 .${cls} 规则（媒体块归属被挪走）`).toMatch(token(cls));
    }
    // ④ sticky-2：粘性规则 + 列宽变量都必须落在 ④ 块内
    const b4 = blockOf('/* ---- ④ 参考型宽表粘前两列（v6.22.0）', '④');
    expect(b4, '④ ≤760 块内找不到 table-sticky-2 粘性规则（媒体块归属被挪走）').toMatch(/table\.table-sticky-2 th:nth-child\(1\)[^}]*position:\s*sticky/);
    expect(b4, '④ ≤760 块内找不到 --stky-c1 列宽变量（媒体块归属被挪走）').toContain('--stky-c1');
  });
});

describe('v6.23.0 转会中心导航静态契约（docs/test-plans/v6.23.0-transfer-hub.md）', () => {
  // 为什么还要静态扫描：TC-LNK-01 / 变异 V5、V8 的靶子是「链接指向」——指向错了页面照样渲染、
  // e2e 的结构断言全绿（只有点进去才红），而 /offers?box=in 这种旧写法在 SideOps 的教练分支里
  // 本地夹具根本渲染不出来。所以用全树文本扫描兜「下批重构又写回旧路由」。
  const APP = `${WEB_SRC}/App.tsx`;
  const TOPBAR = `${WEB_SRC}/components/TopBar.tsx`;
  const SHARED = `${WEB_SRC}/pages/market/shared.tsx`;
  const SIDE_OPS = `${WEB_SRC}/pages/player/SideOps.tsx`;
  const DESK = `${WEB_SRC}/pages/market/desk/MarketDeskPage.tsx`;

  it('旧链接零残留：web/src 全树没有 to="/offers"、to="/negotiations"、to="/market/mine"（TC-LNK-01）', () => {
    const offenders: string[] = [];
    for (const file of TSX_FILES) {
      const src = read(file);
      // 只认 Link/NavLink 的 to= 字面量：App.tsx 的 <Route path="/offers"> 是换址入口必须留着，
      // 而「旧页退役」这类注释里出现 /market/mine 不算残留（与 v6.21 P2-2 同口径：按形态计数，不数裸文本）
      if (/to="\/offers["?]/.test(src) || /to="\/negotiations["?]/.test(src) || /to="\/market\/mine["?]/.test(src)) offenders.push(file);
    }
    expect(offenders, `旧路由残留（应指向 /market/desk）：${offenders.join('、')}`).toEqual([]);
    // 三处入口各自的正确落点（V8：SideOps 忘了改就红）
    expect(read(SIDE_OPS), 'SideOps 的「我收到的报价」应指向转会台报价区').toContain('to="/market/desk?tab=offers&box=in"');
    expect(read(SHARED), 'MarketNav 的「我的转会台」应指向 /market/desk').toContain('to="/market/desk"');
  });

  it('导航收敛：TopBar 单入口「转会中心」、MarketNav 六项（V3/V5 红点，v6.31.0 加广告板）', () => {
    const top = read(TOPBAR);
    expect(top, 'TopBar 缺「转会中心」入口').toContain('转会中心');
    expect(top, 'TopBar 仍留着「转会报价」旧入口').not.toContain('转会报价');
    expect(top, 'TopBar 仍留着「签约谈判」旧入口').not.toContain('签约谈判');

    const nav = read(SHARED);
    // v6.31.0：广告板插在「在售市场」之后（第 2 项，按用户裁决不放最末）——与 e2e ⑤c 的 href 清单同源
    const labels = ['在售市场', '广告板', '海捞', '激活', '我的转会台', '市场情报'];
    let prev = -1;
    for (const label of labels) {
      const at = nav.indexOf(label);
      expect(at, `MarketNav 找不到「${label}」`).toBeGreaterThan(-1);
      expect(at, `MarketNav「${label}」顺序不对（应排在上一项之后）`).toBeGreaterThan(prev);
      prev = at;
    }
    for (const href of ['to="/market"', 'to="/market/board"', 'to="/market/free"', 'to="/market/activation"', 'to="/market/desk"', 'to="/market/intel"']) {
      expect(nav, `MarketNav 缺 ${href} 入口`).toContain(href);
    }
  });

  it('换址入口保留 box 映射 + 转会台默认落在谈判区（V1 红点）', () => {
    const app = read(APP);
    expect(app, '/offers 换址应按 in/out 归一 box').toContain("params.get('box') === 'out' ? 'out' : 'in'");
    expect(app, '/offers 换址应带上 tab=offers 与 box').toContain('/market/desk?tab=offers&box=${box}');
    expect(app, '/negotiations 换址应带上 tab=nego').toContain('to="/market/desk?tab=nego"');
    expect(app, '换址要用 replace（旧路由不留历史栈）').toMatch(/<Navigate\s+replace/);
    expect(app, 'App.tsx 不应再挂 /market/mine 路由').not.toContain('path="/market/mine"');

    const desk = read(DESK);
    expect(desk, '?tab 只认 nego|offers|bids（mine 是 bids 的 alias），缺省应落 nego').toContain(
      "tabRaw === 'offers' || tabRaw === 'bids' || tabRaw === 'mine' ? (tabRaw === 'mine' ? 'bids' : tabRaw) : 'nego'",
    );
    // v6.32.0 页签化：流水线说明条精简一行徽标链（机制句唯一讲解点在报价区块 hint，页面不得再重复）；
    // 待办速览条退役（计数进页签），三区块条件挂载（照球队中心 dossier-tabs 模式）
    expect(desk, '转会台缺流水线说明条').toContain('aria-label="转会流水线"');
    expect(desk, '流水线一行缺徽标链（管理组审核段）').toContain('管理组审核');
    expect(desk, '流水线说明条又把机制句抄回来了（唯一讲解点在报价区块 hint）').not.toContain('报价被接受 ≠ 成交');
    expect(desk, '待办速览条应已退役（计数进页签）').not.toContain('待办速览');
    expect(desk, '页签条未用 dossier-tabs（应照球队中心模式）').toContain('seg dossier-tabs');
    // 三个锚 id 分别住在三区组件里，desk 页按页签条件挂载（JSX 里仍按 谈判 → 报价 → 出价 排布）
    for (const [file, id] of [
      ['web/src/pages/market/desk/NegotiationsSection.tsx', 'desk-nego'],
      ['web/src/pages/market/desk/OffersSection.tsx', 'desk-offers'],
      ['web/src/pages/market/desk/ListingsBidsSection.tsx', 'desk-bids'],
    ] as const) {
      expect(read(file), `${file} 缺区块锚 id="${id}"`).toContain(`id="${id}"`);
    }
    const order = ['<NegotiationsSection', '<OffersSection', '<ListingsBidsSection'].map((tag) => desk.indexOf(tag));
    expect(order.every((i) => i > -1), '转会台缺区块组件渲染').toBe(true);
    expect(order, '页签排布顺序应为 签约谈判 → 报价 → 我的出价').toEqual([...order].sort((a, b) => a - b));
    // v6.32.0 IA 裁决：已落定谈判表删除（历史归球队中心转会页签队史）
    expect(read(`${WEB_SRC}/pages/market/desk/NegotiationsSection.tsx`), '「已落定的谈判」表应已删除').not.toContain('已落定的谈判');
    expect(read(`${WEB_SRC}/pages/market/desk/OffersSection.tsx`), '报价区块应承接「报价被接受 ≠ 成交」机制讲解').toContain('报价被接受 ≠ 成交');
  });

  it('激活拆成独立页：/market/activation 路由 + 首价入口；海捞页只剩查询（TC-C03）', () => {
    const app = read(APP);
    expect(app, 'App.tsx 缺 /market/activation 路由').toContain('path="/market/activation"');

    const activation = read(`${WEB_SRC}/pages/market/MarketActivationPage.tsx`);
    expect(activation, '激活页缺激活端点调用').toContain('/api/market/activations');
    expect(activation, '激活页缺「落激活首价」入口（activation-first）').toContain('mode="activation-first"');

    const free = read(`${WEB_SRC}/pages/market/MarketFreePage.tsx`);
    expect(free, '海捞页仍留着激活逻辑（应只剩海捞查询）').not.toContain('/api/market/activations');
    expect(free, '海捞页缺海捞查询区').toContain('SeaLookupSection');
  });
});
