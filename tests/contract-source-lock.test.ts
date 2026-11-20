// v6.82.0 契约层源码锁（TC-LOCK-01…08）：跨端 DTO 的唯一真源在 src/contract/，web 只准转发。
//
// 为什么用文本扫描而不是 TypeScript 编译器 API：这些锁要防的正是「编译得过、运行时白屏」的漂移
// （字段类型写宽/写窄、联合少一值、worker 装配点丢了 c.json 泛型）。编译器不检查「api.ts 有没有手抄」，
// 也不会告诉你某个 c.json 泛型被顺手删了；而正则扫描对重构友好——只锁「特征串在不在」，不锁行号。
//
// 口径说明（v6.82.0 收口实测）：
//   - src/contract/ 没有 index.ts barrel，只有 batch1.ts…batch6.ts，故清单写死这六个文件；
//   - 六文件的 `export interface|type Name` 声明共 273 名；另有 7 名是对 core 的
//     `export type { Name };` 转发（TierConditionDetail / ShopPrices / VenueSlotQuote / VenueTotals /
//     OpsEndAnchor / OpsStartAnchor / OpsState）——它们不是 api.ts 多抄的，而是「273 vs 280」
//     差值的全部来源；契约导出面必须按「声明 ∪ 转发」算，才与 api.ts 的 280 个 re-export 逐名相等；
//   - TC-LOCK-08 的漂移表来自测试计划 §6/§6.8。§6.1 有一条须按实际代码订正：计划写「listing 拆掉
//     bidCount」，实际 bidCount 留在 TransferPanelListing / MarketListing 上，MarketListingBase
//     仍是单源并被 batch1 extends（见 batch1.ts 的 TransferPanelListing 与 batch6.ts 的
//     MarketListingBase/MarketListing），本文件按下锁的是「基型单源 + bidCount 在场」。
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_DIR = join(ROOT, 'src', 'contract');
const CONTRACT_FILES = ['batch1.ts', 'batch2.ts', 'batch3.ts', 'batch4.ts', 'batch5.ts', 'batch6.ts'] as const;
const API_TS = join(ROOT, 'web', 'src', 'lib', 'api.ts');
const API_SRC = readFileSync(API_TS, 'utf8');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function readContract(file: string): string {
  return readFileSync(join(CONTRACT_DIR, file), 'utf8');
}

/** 递归收集 .ts/.tsx 绝对路径 */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * 本地 `interface Name {` / `type Name =` 声明。刻意要求「{ 或 = 紧跟名字」：
 * `import type { … }` 里的内联 `type Name,` 不算声明（否则会把 import 清单误判成手抄）。
 */
function localTypeDeclarations(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/^[ \t]*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{]*\{/gm)) names.push(m[1]);
  for (const m of src.matchAll(/^[ \t]*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=\n]*>)?\s*=/gm)) names.push(m[1]);
  return names;
}

interface ContractSurface {
  /** `export interface|type Name` 声明 → 所在文件 */
  declared: Map<string, string>;
  /** `export type { Name };` 对 core 的转发 → 所在文件（这些名不来自契约层自身定义） */
  forwarded: Map<string, string>;
}

function contractSurface(): ContractSurface {
  const declared = new Map<string, string>();
  const forwarded = new Map<string, string>();
  for (const file of CONTRACT_FILES) {
    const src = readContract(file);
    for (const m of src.matchAll(/^export (?:interface|type)\s+([A-Za-z_$][\w$]*)/gm)) {
      declared.set(m[1], file);
    }
    for (const m of src.matchAll(/^export type \{([^}]*)\};/gm)) {
      for (const item of m[1].split(',')) {
        const name = item.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) forwarded.set(name, file);
      }
    }
  }
  return { declared, forwarded };
}

/** api.ts 的六块 `export type { … } from '…/contract/batchN.ts';` → 名到契约文件 */
function apiReexports(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of API_SRC.matchAll(/^export type \{([\s\S]*?)\} from '([^']+)';/gm)) {
    const file = m[2].split('/').pop() ?? m[2];
    for (const item of m[1].split(',')) {
      const name = item.trim();
      if (name) out.set(name, file);
    }
  }
  return out;
}

/** worker 文件从 src/contract/batchN.ts 引入的类型名（原名 → 契约文件），支持 `X as XDto` */
function contractImports(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/import type \{([^}]*)\} from '([^']*contract\/batch\d\.ts)';/g)) {
    const file = m[2].split('/').pop() ?? m[2];
    for (const item of m[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/)[0].trim();
      if (name) out.set(name, file);
    }
  }
  return out;
}

/** 取 `export type Name = …;` 的联合体字面量（TransferType 这类多行联合也能取全） */
function unionMembers(src: string, name: string): { strings: string[]; hasNull: boolean } {
  const m = src.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
  if (!m) throw new Error(`找不到联合类型 ${name}`);
  return { strings: [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]), hasNull: /\bnull\b/.test(m[1]) };
}

/** 取 interface 体（按花括号配对截取，体内嵌套对象不会提前截断） */
function interfaceBody(src: string, name: string): string {
  // `extends Base` / 类型参数都允许，花括号起点取自匹配本身
  const open = src.match(new RegExp(`export interface ${name}\\b[^{]*\\{`));
  if (!open || open.index === undefined) throw new Error(`找不到 interface ${name}`);
  const bodyStart = open.index + open[0].length;
  let depth = 1;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
    }
  }
  throw new Error(`interface ${name} 花括号不配对`);
}

const SURFACE = contractSurface();
const SURFACE_ALL = new Map([...SURFACE.declared, ...SURFACE.forwarded]);

// ---------------------------------------------------------------------------
// TC-LOCK-01：契约导出面 ↔ api.ts re-export 逐名对账，且 api.ts 不得手抄
// ---------------------------------------------------------------------------
describe('TC-LOCK-01 契约导出面与 api.ts 转发', () => {
  it('六批契约 = 273 声明 + 7 个 core 转发；与 api.ts 的 280 个 re-export 0 缺 0 多 0 错位', () => {
    expect(readdirSync(CONTRACT_DIR).sort()).toEqual([...CONTRACT_FILES].sort()); // 没有 index.ts barrel
    expect(SURFACE.declared.size).toBeGreaterThan(250); // 防正则失配后空集通过
    expect(SURFACE.forwarded.size).toBe(7);
    expect(SURFACE_ALL.size).toBe(SURFACE.declared.size + SURFACE.forwarded.size);

    const reexports = apiReexports();
    expect(reexports.size).toBe(SURFACE_ALL.size);

    const missing = [...SURFACE_ALL.keys()].filter((n) => !reexports.has(n));
    const extra = [...reexports.keys()].filter((n) => !SURFACE_ALL.has(n));
    const misplaced = [...SURFACE_ALL].filter(([n, file]) => reexports.get(n) !== file).map(([n]) => n);
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    expect(misplaced).toEqual([]);
  });

  it('7 个「多出」名是契约对 core 的 export type 转发，不是 api.ts 手抄', () => {
    expect([...SURFACE.forwarded.keys()].sort()).toEqual([
      'OpsEndAnchor',
      'OpsStartAnchor',
      'OpsState',
      'ShopPrices',
      'TierConditionDetail',
      'VenueSlotQuote',
      'VenueTotals',
    ]);
    for (const [name, file] of SURFACE.forwarded) {
      expect(SURFACE.declared.has(name), `${name} 不应同时是契约本地声明`).toBe(false);
      // 契约文件必须 import type 自 ../core/（真源在 core，契约只转发）
      const src = readContract(file);
      expect(src, `${file} 未从 core 引入 ${name}`).toMatch(new RegExp(`import type \\{[^}]*\\b${name}\\b[^}]*\\} from '\\.\\./core/`));
      // api.ts 只准有转发行，不能出现同名 interface/type 定义
      expect(API_SRC, `api.ts 手抄了 ${name}`).not.toMatch(new RegExp(`export (?:interface|type) ${name}\\b`));
    }
  });

  it('api.ts 本地类型只剩 MeUser / AuthMode / ManualLedgerKind，且都不在契约导出面', () => {
    const local = localTypeDeclarations(API_SRC);
    expect([...local].sort()).toEqual(['AuthMode', 'ManualLedgerKind', 'MeUser']);
    for (const name of local) expect(SURFACE_ALL.has(name)).toBe(false);
    // 逐名兜底：契约面里任何一名都不许在 api.ts 出现本地定义（含将来新增的契约型）
    for (const name of SURFACE_ALL.keys()) {
      expect(API_SRC, `api.ts 手抄了 ${name}`).not.toMatch(
        new RegExp(`^[ \\t]*(?:export\\s+)?(?:interface\\s+${name}\\b[^{]*\\{|type\\s+${name}\\s*(?:<[^=\\n]*>)?\\s*=)`, 'm'),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// TC-LOCK-02：契约层是纯类型层——只准 import type，来源只准 ./ 或 ../core/
// ---------------------------------------------------------------------------
describe('TC-LOCK-02 契约层纯类型约束', () => {
  it('所有 import 都是 import type，且来源只允许同批文件或 core', () => {
    const allowed = /^(?:\.\/[\w.-]+\.ts|\.\.\/core\/[\w.-]+\.ts)$/;
    let imports = 0;
    for (const file of CONTRACT_FILES) {
      const src = readContract(file);
      for (const line of src.split('\n')) {
        if (!/^\s*import\b/.test(line)) continue;
        expect(line.trimStart().startsWith('import type '), `${file} 的 import 不是 import type：${line}`).toBe(true);
      }
      for (const m of src.matchAll(/^import[^;]*?from '([^']+)';/gm)) {
        imports++;
        expect(m[1], `${file} 引入了契约层之外的模块`).toMatch(allowed);
      }
    }
    expect(imports).toBeGreaterThanOrEqual(10); // batch1/2/3/4 的既有 import 数，防止扫描失配
  });

  it('没有任何运行时导出（const/function/class/enum/default）与普通 export {', () => {
    for (const file of CONTRACT_FILES) {
      const src = readContract(file);
      expect(src).not.toMatch(/^export (?:const|let|var|function|class|enum|default)\b/m);
      expect(src, `${file} 出现非 type 的 export {`).not.toMatch(/^export \{(?!\s*type\b)/m);
      expect(src, `${file} 出现动态 import()`).not.toMatch(/\bimport\s*\(/);
      expect(src, `${file} 出现 require()`).not.toMatch(/\brequire\s*\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-LOCK-03：worker 装配点锚点表——每条锁「文件 + 契约型 + 特征源串」，不锁行号
// ---------------------------------------------------------------------------
interface Anchor {
  file: string;
  type: string;
  /** 该文件里必须出现的特征串：c.json<Type> / `: Type` / `return ... Type` 等 */
  needle: string;
}

const ANCHORS: readonly Anchor[] = [
  // 第 1 批：desk / contract-demands（worker 侧用 as 别名，needle 用导入别名）
  { file: 'src/worker/routes/desk.ts', type: 'DeskSummary', needle: 'c.json<DeskSummaryDto>' },
  { file: 'src/worker/routes/desk.ts', type: 'TransferPanelResponse', needle: 'c.json<TransferPanelResponseDto>' },
  { file: 'src/worker/routes/contract-demands.ts', type: 'ContractDemandInbox', needle: 'c.json<ContractDemandInboxDto>' },
  { file: 'src/worker/routes/contract-demands.ts', type: 'DemandAcceptResult', needle: 'c.json<DemandAcceptResultDto>' },
  { file: 'src/worker/routes/contract-demands.ts', type: 'WageForecast', needle: 'c.json<WageForecastDto>' },
  // 第 2 批：players / growth / registration / admin growth / admin players
  { file: 'src/worker/routes/players.ts', type: 'PlayersLibraryResponse', needle: 'c.json<PlayersLibraryResponse>' },
  { file: 'src/worker/routes/players.ts', type: 'PlayerDetail', needle: 'c.json<PlayerDetail>' },
  { file: 'src/worker/routes/players.ts', type: 'PlayerTransfersResponse', needle: 'c.json<PlayerTransfersResponse>' },
  { file: 'src/worker/routes/players.ts', type: 'PlayerMatchesResponse', needle: 'c.json<PlayerMatchesResponse>' },
  { file: 'src/worker/routes/growth.ts', type: 'GrowthDetail', needle: 'c.json<GrowthDetail>' },
  { file: 'src/worker/routes/registration.ts', type: 'SquadOverview', needle: 'c.json<SquadOverview>' },
  { file: 'src/worker/routes/registration.ts', type: 'SquadNumberUpdateResponse', needle: 'c.json<SquadNumberUpdateResponse>' },
  { file: 'src/worker/routes/admin/growth.ts', type: 'MatchOcrResult', needle: 'c.json<MatchOcrResult>' },
  { file: 'src/worker/routes/admin/growth.ts', type: 'MatchEntryListResponse', needle: 'c.json<MatchEntryListResponse>' },
  { file: 'src/worker/routes/admin/players.ts', type: 'ImportConfirm', needle: 'c.json<ImportConfirm>' },
  // 第 3 批：clubs / shop / admin finance
  { file: 'src/worker/routes/clubs.ts', type: 'LedgerPage', needle: 'c.json<LedgerPage>' },
  { file: 'src/worker/routes/clubs.ts', type: 'FinanceSummaryResponse', needle: 'c.json<FinanceSummaryResponse>' },
  { file: 'src/worker/routes/clubs.ts', type: 'BuildPaymentResult', needle: 'c.json<BuildPaymentResult>' },
  { file: 'src/worker/routes/clubs.ts', type: 'NamingQuoteResponse', needle: 'c.json<NamingQuoteResponse>' },
  { file: 'src/worker/routes/clubs.ts', type: 'VenuePlanResponse', needle: 'c.json<VenuePlanResponse>' },
  { file: 'src/worker/routes/shop.ts', type: 'ShopCatalog', needle: 'c.json<ShopCatalog>' },
  { file: 'src/worker/routes/shop.ts', type: 'ShopOrderMutationResult', needle: 'c.json<ShopOrderMutationResult>' },
  { file: 'src/worker/routes/admin/finance.ts', type: 'M0Report', needle: 'c.json<M0Report>' },
  // 第 4 批：球队 / 窗口 / 赛季 / 事件 / 配置
  { file: 'src/worker/routes/clubs.ts', type: 'ClubDetail', needle: 'c.json<ClubDetail>' },
  { file: 'src/worker/routes/clubs.ts', type: 'MyClubOverview', needle: 'c.json<MyClubOverview>' },
  { file: 'src/worker/routes/admin/market.ts', type: 'OpenWindowResult', needle: 'c.json<OpenWindowResult>' },
  { file: 'src/worker/routes/admin/market.ts', type: 'CloseWindowResult', needle: 'c.json<CloseWindowResult>' },
  { file: 'src/worker/routes/admin/seasons.ts', type: 'SeasonSettleResult', needle: 'c.json<SeasonSettleResult>' },
  { file: 'src/worker/routes/admin/seasons.ts', type: 'ResultsQueue', needle: 'c.json<ResultsQueue>' },
  { file: 'src/worker/routes/admin/seasons.ts', type: 'ReplayHooksResult', needle: 'c.json<ReplayHooksResult>' },
  { file: 'src/worker/routes/admin/events.ts', type: 'LlmStatus', needle: 'c.json<LlmStatus>' },
  { file: 'src/worker/routes/admin/events.ts', type: 'EventDraftAdoptResult', needle: 'c.json<EventDraftAdoptResult>' },
  { file: 'src/worker/routes/admin/config.ts', type: 'ConfigResponse', needle: 'c.json<ConfigResponse>' },
  // 第 5 批：offers / 暗标
  { file: 'src/worker/routes/offers.ts', type: 'OffersListResponse', needle: 'c.json<OffersListResponse>' },
  { file: 'src/worker/routes/offers.ts', type: 'OfferSettingsDto', needle: 'c.json<OfferSettingsDto>' },
  { file: 'src/worker/routes/admin/sea-sealed.ts', type: 'SeaAdminView', needle: 'c.json<SeaAdminView>' },
  { file: 'src/worker/activations.ts', type: 'MatchDecisionResult', needle: '): Promise<MatchDecisionResult> {' },
  // 第 6 批：market（c.json 泛型 + 三个装配函数返回标注）
  { file: 'src/worker/routes/market.ts', type: 'MarketListings', needle: 'c.json<MarketListings>' },
  { file: 'src/worker/routes/market.ts', type: 'BidPlaceResult', needle: 'c.json<BidPlaceResult>' },
  { file: 'src/worker/routes/market.ts', type: 'MarketDealsResponse', needle: '): Promise<MarketDealsResponse> => {' },
  { file: 'src/worker/routes/market.ts', type: 'TransferBoardResponse', needle: '): Promise<TransferBoardResponse> => {' },
  { file: 'src/worker/routes/market.ts', type: 'MarketListingDetail', needle: '): MarketListingDetail {' },
  { file: 'src/worker/routes/admin/market.ts', type: 'ForcedAuctionResult', needle: 'c.json<ForcedAuctionResult>' },
];

describe('TC-LOCK-03 worker 装配锚点', () => {
  it('43 条锚点的特征串在场，且类型确实从对应批次的契约文件 import', () => {
    expect(ANCHORS.length).toBeGreaterThanOrEqual(38);
    expect(ANCHORS.length).toBeLessThanOrEqual(45);
    for (const anchor of ANCHORS) {
      const src = read(anchor.file);
      expect(src, `${anchor.file} 丢了 ${anchor.type} 的锚点串`).toContain(anchor.needle);
      const imported = contractImports(src).get(anchor.type);
      expect(imported, `${anchor.file} 未从 src/contract 引入 ${anchor.type}`).toBe(SURFACE_ALL.get(anchor.type));
    }
  });
});

// ---------------------------------------------------------------------------
// TC-LOCK-04：AGENTS.md 的纪律条款不许被删（契约层的长期约束）
// ---------------------------------------------------------------------------
describe('TC-LOCK-04 AGENTS.md 契约纪律', () => {
  it('含 src/contract/、唯一真源、api.ts、不得手抄 四个关键字', () => {
    const agents = read('AGENTS.md');
    for (const needle of ['src/contract/', '唯一真源', '`web/src/lib/api.ts`', '不得手抄']) {
      expect(agents, `AGENTS.md 缺「${needle}」`).toContain(needle);
    }
    // 全文件 toContain 会被其他条目的同词互保（MV-06 初跑未红）：契约纪律必须整行四词同现。
    const contractLine = agents.split('\n').find((line) => line.includes('src/contract/') && line.includes('api.ts'));
    expect(contractLine, 'AGENTS.md 找不到契约纪律行').toBeDefined();
    for (const needle of ['src/contract/', '唯一真源', '`web/src/lib/api.ts`', '不得手抄']) {
      expect(contractLine, `契约纪律行缺「${needle}」`).toContain(needle);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-LOCK-05：web/src 除 api.ts 外不许出现任何契约型的本地定义（手抄会绕过唯一真源）
// ---------------------------------------------------------------------------
describe('TC-LOCK-05 web 侧零手抄', () => {
  it('web/src（排除 lib/api.ts）没有契约名的 interface/type 定义', () => {
    const files = walkTs(join(ROOT, 'web', 'src')).filter((f) => f !== API_TS);
    expect(files.length).toBeGreaterThan(100); // 防目录/扩展名口径变化导致空扫
    const copied: string[] = [];
    for (const file of files) {
      for (const name of localTypeDeclarations(readFileSync(file, 'utf8'))) {
        if (SURFACE_ALL.has(name)) copied.push(`${file}:${name}`);
      }
    }
    expect(copied).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TC-LOCK-06：三个 core 单源类型在契约层只 import、不重定义
// ---------------------------------------------------------------------------
describe('TC-LOCK-06 core 单源类型', () => {
  it('PlayerMarker / NotifyRef / NotifyCategoryId 只在 core 定义，契约层按名 import', () => {
    const contractText = CONTRACT_FILES.map((f) => readContract(f)).join('\n');
    for (const name of ['PlayerMarker', 'NotifyRef', 'NotifyCategoryId']) {
      expect(contractText, `契约层重定义了 ${name}`).not.toMatch(new RegExp(`export (?:interface|type) ${name}\\b`));
    }
    expect(readContract('batch2.ts')).toMatch(
      /import type \{[^}]*\bPlayerMarker\b[^}]*\} from '\.\.\/core\/squad-rules\.ts';/,
    );
    expect(readContract('batch3.ts')).toMatch(
      /import type \{[^}]*\bNotifyCategoryId\b[^}]*\bNotifyRef\b[^}]*\} from '\.\.\/core\/notify-meta\.ts';/,
    );
    expect(read('src/core/squad-rules.ts')).toMatch(/export type PlayerMarker =/);
    expect(read('src/core/notify-meta.ts')).toMatch(/export type NotifyCategoryId =/);
    expect(read('src/core/notify-meta.ts')).toMatch(/export interface NotifyRef \{/);
    // 契约里的消费点也必须指向 import 名（而不是悄悄写成 string）
    expect(interfaceBody(readContract('batch2.ts'), 'PlayerListItem')).toMatch(/\bmarker: PlayerMarker \| null;/);
    expect(readContract('batch3.ts')).toMatch(/\bNotifyRef\b/);
  });
});

// ---------------------------------------------------------------------------
// TC-LOCK-07：联合字面量清单（多一值/少一值都不会有编译错误，只能文本锁）
// ---------------------------------------------------------------------------
describe('TC-LOCK-07 联合字面量清单', () => {
  it('契约层六个联合逐字锁死', () => {
    const batch5 = readContract('batch5.ts');
    const batch6 = readContract('batch6.ts');
    const batch3 = readContract('batch3.ts');

    expect(unionMembers(batch6, 'ListingStatus').strings.sort()).toEqual([
      'bidding',
      'delisted',
      'listed',
      'matched_pending',
      'pending_review',
    ]);
    expect(unionMembers(batch5, 'TransferType').strings.sort()).toEqual([
      'activation',
      'forced_auction',
      'free_agent',
      'match',
      'promotion',
      'rc_change',
      'termination',
      'transfer',
    ]);
    expect(unionMembers(batch6, 'MatchPhase').strings.sort()).toEqual(['first_bid', 'matching']);
    expect(unionMembers(batch6, 'MatchPhase').hasNull).toBe(true);
    expect(unionMembers(batch3, 'VenuePolicyChoice').strings.sort()).toEqual(['fans', 'money', 'reputation']);
    expect(unionMembers(batch3, 'ShopOrderStatus').strings.sort()).toEqual(['approved', 'pending', 'rejected']);
    expect(unionMembers(batch5, 'SeaBatchStatus').strings.sort()).toEqual([
      'cancelled',
      'opened',
      'sealed',
      'settling',
    ]);
    expect(unionMembers(batch5, 'SeaBidStatus').strings.sort()).toEqual(['lost', 'sealed', 'void', 'withdrawn', 'won']);
  });

  it('MatchOcrEntry.matched 六值逐字锁死', () => {
    const body = interfaceBody(readContract('batch2.ts'), 'MatchOcrEntry');
    const field = body.match(/\n\s*matched: ([^;]+);/);
    expect(field).not.toBeNull();
    const values = [...(field?.[1] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
    expect(values).toEqual([
      'display',
      'display-folded',
      'official',
      'official-folded',
      'surname-initial',
      'truncated-prefix',
    ]);
  });

  it('SquadIssue.rule 引用 core 的 SquadIssueRule（九值），契约层不复制字面量', () => {
    const core = read('src/core/squad-rules.ts');
    expect(unionMembers(core, 'SquadIssueRule').strings.sort()).toEqual([
      'ca_pa',
      'contract',
      'first_team_contract',
      'gk',
      'squad_size',
      'trainee_contract',
      'trainee_growth',
      'trainee_size',
      'wage_cap',
    ]);
    const batch2 = readContract('batch2.ts');
    expect(batch2).toMatch(/import type \{[^}]*\bSquadIssueRule\b[^}]*\} from '\.\.\/core\/squad-rules\.ts';/);
    expect(interfaceBody(batch2, 'SquadIssue')).toMatch(/\brule: SquadIssueRule;/);
    expect(batch2, '契约层复制了 SquadIssue.rule 的字面量').not.toMatch(/\brule: '/);
    expect(batch2).not.toMatch(/export (?:interface|type) SquadIssueRule\b/);
  });
});

// ---------------------------------------------------------------------------
// TC-LOCK-08：测试计划 §6/§6.8 的漂移处置表（present 必在 / absent 必不在）
// 注：§6.1 已按实际代码订正——bidCount 并未拆掉，而是留在 TransferPanelListing 与
// MarketListing 上，MarketListingBase 保持单源并被 batch1 extends（见第一条）。
// ---------------------------------------------------------------------------
interface DriftCase {
  file: string;
  /** 该行锁的契约型（失败信息用） */
  type: string;
  present?: readonly string[];
  absent?: readonly string[];
}

const DRIFT_CASES: readonly DriftCase[] = [
  // ---- 第 1 批 ----
  {
    file: 'src/contract/batch1.ts',
    type: 'TransferPanelResponse',
    present: ['interface TransferPanelListing extends MarketListingBase {', 'bidCount: number;'],
    absent: ['interface TransferPanelListing {'],
  },
  {
    file: 'src/contract/batch1.ts',
    type: 'TransferPanelResponse',
    present: ['settled: { wage: number | null; source: string; message: string } | null;'],
  },
  // ---- 第 2 批 ----
  { file: 'src/contract/batch2.ts', type: 'PlayerLibraryRow', present: ['attrValue?: number | null;'], absent: ['attrValue?: number;'] },
  {
    file: 'src/contract/batch2.ts',
    type: 'MatchEntryListItem',
    present: [
      'competitionType: string | null;',
      'stageName: string | null;',
      'stageKind: string | null;',
      'round: number | null;',
      'homeTeam: string | null;',
      'awayTeam: string | null;',
      'scoreHome: number | null;',
      'scoreAway: number | null;',
    ],
  },
  { file: 'src/contract/batch2.ts', type: 'MatchEntryPlayer', present: ['officialName?: string;'], absent: ['officialName: string;'] },
  { file: 'src/contract/batch2.ts', type: 'ImportConfirm', present: ['replayed: number;'] },
  { file: 'src/contract/batch2.ts', type: 'MatchOcrResult', present: ['unmatched: { name: string; pos: string }[];'] },
  { file: 'src/contract/batch2.ts', type: 'PlaystyleDetailRow', present: ['createdAt: string | null;'] },
  { file: 'src/contract/batch2.ts', type: 'SquadIssue', present: ['rule: SquadIssueRule;'], absent: ["rule: '"] },
  {
    file: 'src/contract/batch2.ts',
    type: 'SquadNumberUpdateResponse',
    present: ['export interface SquadNumberUpdateResponse {\n  ok: true;\n  id: number;\n  number: string | null;'],
  },
  // ---- 第 3 批 ----
  { file: 'src/contract/batch3.ts', type: 'BrandQuote', present: ['venueName: string | null;'], absent: ['quotaLeft:'] },
  { file: 'src/contract/batch3.ts', type: 'VenuePlanResponse', present: ["status: 'open';"], absent: ["status: 'closed';"] },
  { file: 'src/contract/batch3.ts', type: 'BuildPaymentResult', present: ['capacity?: number;', 'tier?: number;', 'level?: number;'] },
  {
    file: 'src/contract/batch3.ts',
    type: 'LedgerEntryRow',
    present: ['export interface LedgerEntryBase {', 'export interface LedgerEntryRow extends LedgerEntryBase {}'],
  },
  { file: 'src/contract/batch3.ts', type: 'M0Report', present: ['m0: number;', 'held: number;', 'available: number;'] },
  // ---- 第 4 批 ----
  { file: 'src/contract/batch4.ts', type: 'OpenWindowResult', present: ['venueReset: boolean;', 'venueNotified: number;', 'demandsCreated: number;'] },
  { file: 'src/contract/batch4.ts', type: 'CloseWindowResult', present: ['payroll: CloseWindowPayrollSummary;', 'home: CloseWindowHomeSummary;'] },
  { file: 'src/contract/batch4.ts', type: 'SeasonSettleResult', present: ['champion: SeasonChampionBonus;'] },
  { file: 'src/contract/batch4.ts', type: 'AdminRegistrations', present: ["source?: 'archive' | 'live';", 'isCpu: boolean;', 'unsigned?: number;'] },
  // SeasonRow 的「无 ageCap」用精确块锁：注释里会提到 ageCap，字符串缺席断言会误伤
  { file: 'src/contract/batch4.ts', type: 'SeasonRow', present: ['export interface SeasonRow {\n  season: number;\n  status: string;\n}'] },
  { file: 'src/contract/batch4.ts', type: 'MyClubOverview', present: ['home: StadiumInfo | null;'], absent: ['home?: StadiumInfo | null;'] },
  { file: 'src/contract/batch4.ts', type: 'AdminEventTriggeredRow', present: ['eventType: string;', 'deadlineAt: string | null;'], absent: ['eventType?: string;'] },
  { file: 'src/contract/batch4.ts', type: 'ClubDirectoryRow', present: ['leagueTier: string;'] },
  { file: 'src/contract/batch4.ts', type: 'SeasonsCurrent', present: ['export type SeasonsCurrent = SeasonCurrent;'] },
  { file: 'src/contract/batch4.ts', type: 'WindowOverviewRow', present: ['wageAfter: number;', 'activeSessions: number;'] },
  {
    file: 'src/contract/batch4.ts',
    type: 'TournamentRow / BindTournamentResult（§6.8）',
    present: ['export interface TournamentRow {\n  id: number;\n  name: string;\n  status: string;\n}', 'export interface BindTournamentResult {\n  ok: true;'],
  },
  { file: 'src/contract/batch4.ts', type: 'ResultQueueRow（§6.8）', present: ['windowSeq?: number;', 'competitionType: string | null;'] },
  { file: 'src/contract/batch4.ts', type: 'ResultsQueue（§6.8）', present: ['queue: ResultQueueRow[];', 'confirmed: ConfirmedResultRow[];'] },
  { file: 'src/contract/batch4.ts', type: 'ConfirmResultResult（§6.8）', present: ['export interface ConfirmResultResult {\n  ok: true;'] },
  {
    file: 'src/contract/batch4.ts',
    type: 'ReplayHooksResult（§6.8 / v6.86.0）',
    present: ['export interface ReplayHooksResult {\n  ok: true;\n  result: ConfirmedResultRow;'],
  },
  // ---- 第 5 批 ----
  { file: 'src/contract/batch5.ts', type: 'RcChangeResult', present: ['export interface RcChangeResult {\n  ok: true;', 'changeFee: number;'], absent: ['freeRcChange:'] },
  {
    file: 'src/contract/batch5.ts',
    type: '四个 ok:true 回执',
    present: [
      'export interface OfferPlaceResult {\n  ok: true;',
      'export interface OfferCounterResult {\n  ok: true;',
      'export interface OfferAcceptResult {\n  ok: true;',
      'export interface OfferOkResult {\n  ok: true;',
    ],
  },
  { file: 'src/contract/batch5.ts', type: 'OfferSettingsDto', present: ['ok?: true;'] },
  { file: 'src/contract/batch5.ts', type: 'OfferDetailResponse', present: ['season: number | null;', 'windowSeq: number | null;'] },
  { file: 'src/contract/batch5.ts', type: 'OfferResult', present: ["result: 'success' | 'fail' | 'direct' | 'forced';"], absent: ['export interface OfferOutcome'] },
  // ---- 第 6 批 ----
  { file: 'src/contract/batch6.ts', type: 'MarketDealsRow', present: ['playerLevel: number | null;', 'playerRole: string | null;', 'snapshotSource: string | null;'] },
  { file: 'src/contract/batch6.ts', type: 'MarketDealsResponse', present: ['nextCursor: string | null;', 'hasMore: boolean;'] },
  { file: 'src/contract/batch6.ts', type: 'TransferBoardRow', present: ['export interface TransferBoardRow {', 'ca: number | null;', 'pa: number | null;'] },
  { file: 'src/contract/batch6.ts', type: 'ForcedAuctionPreview', present: ['ForcedAuctionInspection'], absent: ['export interface ForcedAuctionInspection'] },
  { file: 'src/contract/batch6.ts', type: 'ForcedAuctionResult', present: ['export interface ForcedAuctionResult {\n  ok: true;'] },
];

describe('TC-LOCK-08 漂移处置表', () => {
  it('30–40 行处置逐条在场/缺席', () => {
    expect(DRIFT_CASES.length).toBeGreaterThanOrEqual(30);
    expect(DRIFT_CASES.length).toBeLessThanOrEqual(40);
    for (const drift of DRIFT_CASES) {
      const src = read(drift.file);
      for (const needle of drift.present ?? []) {
        expect(src, `${drift.file} / ${drift.type} 缺 ${JSON.stringify(needle)}`).toContain(needle);
      }
      for (const needle of drift.absent ?? []) {
        expect(src, `${drift.file} / ${drift.type} 不应含 ${JSON.stringify(needle)}`).not.toContain(needle);
      }
    }
    // 全文件 toContain 存在同名字段互保的盲区（MV-04 初跑未红）：ca/pa 这类跨型同名字段
    // 必须回到 TransferBoardRow 自身类型体里锁，否则改一个型、另一个型仍留着同串就假绿。
    const boardBody = interfaceBody(readContract('batch6.ts'), 'TransferBoardRow');
    expect(boardBody).toContain('ca: number | null;');
    expect(boardBody).toContain('pa: number | null;');
  });

  it('§6.1 订正：MarketListingBase 单源，batch1 的 listing 仍带 bidCount', () => {
    const batch1 = readContract('batch1.ts');
    const batch6 = readContract('batch6.ts');
    expect(batch1).toMatch(/import type \{ MarketListingBase \} from '\.\/batch6\.ts';/);
    expect(batch6).toContain('export interface MarketListingBase {');
    expect(batch6).toContain('export interface MarketListing extends MarketListingBase {');
    expect(interfaceBody(batch6, 'MarketListing')).toMatch(/\bbidCount: number;/);
    expect(interfaceBody(batch6, 'MarketListingDetail')).toMatch(/\blisting: MarketListing & \{/);
  });
});
