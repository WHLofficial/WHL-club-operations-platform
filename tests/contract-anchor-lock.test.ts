// 契约锚点源码锁（v6.86.0 收口批）：
// worker 端点响应一律以 src/contract/ 为真源标注（import type + c.json 泛型 / Promise 返回标注），
// 本文件按施工表逐条锁住源码形态，防止后续改动把锚点换回本地重复定义或悄悄变宽。
// 样板：tests/listing-source-lock.test.ts —— readFileSync + 空白归一化（\s+ → 单空格，跨行写法同样命中）
// + 防假绿计数。判据不剥注释：注释里残留的本地定义同样算违规（宁枉勿纵）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 整段文本空白归一化：连续空白（含换行/缩进）折叠为单空格后再逐字匹配 */
const norm = (s: string): string => s.replace(/\s+/g, ' ');

/** 读文件并归一化；文件缺失时 readFileSync 直接抛错（路径写错不静默） */
function src(file: string): string {
  return norm(readFileSync(file, 'utf8'));
}

/**
 * 自检用：把期望串「错一个字」——首个 ASCII 字母换成 X（是 X 则换 Y）。
 * 用于证明判据不是恒真：改动后的串在真实源码里必须失配。
 */
function typoOf(s: string): string {
  const at = s.search(/[A-Za-z]/);
  expect(at, `自检串里找不到字母，无法构造错字样本：${s.slice(0, 60)}`).toBeGreaterThanOrEqual(0);
  const ch = s[at] === 'X' ? 'Y' : 'X';
  const mutated = s.slice(0, at) + ch + s.slice(at + 1);
  expect(mutated, '错字样本必须与原串不同').not.toBe(s);
  return mutated;
}

/** 施工表涉及的全部受锁文件（worker + web 消费侧，相对仓库根） */
const FILES = {
  negotiations: 'src/worker/negotiations.ts',
  negotiationsRoutes: 'src/worker/routes/negotiations.ts',
  results: 'src/worker/results.ts',
  growthTier: 'src/worker/growth-tier.ts',
  growthTierRoutes: 'src/worker/routes/admin/growth-tier.ts',
  registration: 'src/worker/routes/registration.ts',
  seaSealed: 'src/worker/routes/admin/sea-sealed.ts',
  players: 'src/worker/routes/players.ts',
  seasonsRoutes: 'src/worker/routes/admin/seasons.ts',
  webApi: 'web/src/lib/api.ts',
  seasonsPage: 'web/src/pages/admin/SeasonsPage.tsx',
  playerPage: 'web/src/pages/Player.tsx',
  negotiationsSection: 'web/src/pages/market/desk/NegotiationsSection.tsx',
} as const;

describe('施工表路径自检', () => {
  it('13 个受锁文件全部可读且非空（防路径写错把锁扫空）', () => {
    const paths = Object.values(FILES);
    expect(paths.length).toBeGreaterThan(0);
    for (const f of paths) {
      expect(src(f).length, `${f} 内容为空`).toBeGreaterThan(50);
    }
  });
});

describe('negotiations 契约锚点锁', () => {
  it('WageForecast 归 batch1、其余五型归 batch5，本地重复定义退役，路由五端点泛型逐字', () => {
    const worker = src(FILES.negotiations);
    // 契约 import：WageForecast 真源在 batch1（batch5 无此 export）；其余五型在 batch5
    expect(worker, 'negotiations:WageForecast 契约 import').toContain(
      "import type { WageForecast } from '../contract/batch1.ts';",
    );
    expect(worker, 'negotiations:NegotiationSession 等 batch5 import').toContain(
      "import type { MyNegotiations, NegotiationSession, OfferResult, ReleaseFeeResult, TraineeSignResult, TransferType } from '../contract/batch5.ts';",
    );
    // 返回标注（空白归一化后逐字）
    expect(worker, 'negotiations:ReleaseFeeResult submitReleaseFee 返回标注').toContain('): Promise<ReleaseFeeResult> {');
    expect(worker, 'negotiations:OfferResult offerWage 返回标注').toContain('): Promise<OfferResult> {');
    expect(worker, 'negotiations:WageForecast previewWage 返回标注').toContain('): Promise<WageForecast> {');
    expect(worker, 'negotiations:TraineeSignResult chooseTrainee 返回标注').toContain('): Promise<TraineeSignResult> {');
    expect(worker, 'negotiations:MyNegotiations listMySessions 返回标注').toContain(
      'export async function listMySessions(env: Env, clubId: number, opts: MySessionsOpts = {}): Promise<MyNegotiations> {',
    );
    // SessionListRow 两字段按 DB 真值域收窄（status 三值 / transfer_type 八值）
    expect(worker, 'negotiations:NegotiationSession SessionListRow.status 收窄').toContain(
      "status: 'active' | 'settled' | 'cancelled';",
    );
    expect(worker, 'negotiations:NegotiationSession SessionListRow.transfer_type 收窄').toContain(
      'transfer_type: TransferType;',
    );
    expect(worker, 'negotiations:NegotiationSession toDto 返回标注').toContain(
      'const toDto = (r: SessionListRow, attempts: AttemptListRow[], voidReason: string | null): NegotiationSession => {',
    );
    // 本地重复定义退役（不剥注释：注释里残留同样算违规；裸 interface 字样连非导出变体一并拦下）
    expect(worker, '本地 interface WageForecast 必须退役（真源 batch1.ts）').not.toContain('interface WageForecast');
    expect(worker, '本地 interface MySessionsResult 必须退役（契约名 MyNegotiations）').not.toContain(
      'interface MySessionsResult',
    );
    expect(worker, '本地 interface OfferOutcome 必须退役（契约名 OfferResult）').not.toContain('interface OfferOutcome');

    const routes = src(FILES.negotiationsRoutes);
    expect(routes, 'routes/negotiations WageForecast import').toContain(
      "import type { WageForecast } from '../../contract/batch1.ts';",
    );
    expect(routes, 'routes/negotiations batch5 import').toContain(
      "import type { MyNegotiations, OfferResult, ReleaseFeeResult, TraineeSignResult } from '../../contract/batch5.ts';",
    );
    expect(routes, 'routes/negotiations 我的会话泛型').toContain(
      'return c.json<MyNegotiations>(await listMySessions(c.env, clubId, { endedBefore, endedLimit }));',
    );
    expect(routes, 'routes/negotiations release-fee 泛型').toContain('return c.json<ReleaseFeeResult>(result);');
    expect(routes, 'routes/negotiations offer 泛型').toContain(
      'return c.json<OfferResult>(await offerWage(c.env, sessionId, clubId, user.id, body?.wage));',
    );
    expect(routes, 'routes/negotiations preview 泛型').toContain(
      'return c.json<WageForecast>(await previewWage(c.env, sessionId, clubId, user.id, body?.wage));',
    );
    expect(routes, 'routes/negotiations trainee 泛型').toContain(
      'return c.json<TraineeSignResult>(await chooseTrainee(c.env, sessionId, clubId, user.id));',
    );
    // 防假绿计数：五个端点各一处泛型，不多不少
    expect(routes.match(/return c\.json</g) ?? [], 'routes/negotiations 泛型端点数应为 5').toHaveLength(5);
  });
});

describe('results 契约锚点锁', () => {
  it('三型换源 batch4，ResultQueueItem/ConfirmedResultItem 退役，装配与回放签名逐字', () => {
    const text = src(FILES.results);
    expect(text, 'results:ResultQueueRow/ConfirmedResultRow/ResultsQueue 契约 import').toContain(
      "import type { ConfirmedResultRow, ResultQueueRow, ResultsQueue } from '../contract/batch4.ts';",
    );
    expect(text, 'results:ConfirmedResultRow toConfirmedItem 返回标注').toContain('}): ConfirmedResultRow {');
    expect(text, 'results:ResultsQueue queueResults 返回标注').toContain(
      'export async function queueResults(env: Env): Promise<ResultsQueue> {',
    );
    expect(text, 'results:ResultQueueRow 排序中间行类型（_sortKey 私有键不进响应）').toContain(
      'const queue: (ResultQueueRow & { _sortKey: string })[] = pending.map(({ m, season, competitionType }) => ({',
    );
    expect(text, 'results:ResultsQueue 下发前剥离 _sortKey').toContain(
      'queue: queue.map(({ _sortKey: _ignored, ...item }) => item),',
    );
    expect(text, 'results:ConfirmedResultRow confirmResult 签名内 result 标注').toContain('result: ConfirmedResultRow;');
    expect(text, 'results:ConfirmedResultRow replayHooksForMatch 返回标注').toContain(
      'export async function replayHooksForMatch(env: Env, matchIdInput: unknown): Promise<ConfirmedResultRow> {',
    );
    // 本地重复定义退役（裸 interface 字样连非导出变体一并拦下）
    expect(text, '本地 interface ResultQueueItem 必须退役（契约名 ResultQueueRow）').not.toContain(
      'interface ResultQueueItem',
    );
    expect(text, '本地 interface ConfirmedResultItem 必须退役（契约名 ConfirmedResultRow）').not.toContain(
      'interface ConfirmedResultItem',
    );

    // spec ①（v6.86.0）：replay-hooks 回执建模——seasons.ts 路由泛型 + 契约 import 在场；
    // 防假绿计数只锁新锚恰 1 处（seasons 端点集在增长，全文件 return c.json< 总数登记不锁，
    // 测试计划 §8.10：施工前 9 处 / 施工后 10 处，全量锁每加一个泛型端点即碎）
    const seasons = src(FILES.seasonsRoutes);
    expect(seasons, 'seasons:ReplayHooksResult replay-hooks 回执泛型').toContain(
      'return c.json<ReplayHooksResult>({ ok: true, result }, 201);',
    );
    expect(seasons, 'seasons:ReplayHooksResult 契约 import').toContain('ReplayHooksResult,');
    expect(seasons.match(/c\.json<ReplayHooksResult>/g) ?? [], 'ReplayHooksResult 泛型应为 1 处').toHaveLength(1);
    // web 消费侧（TC-RH-03）：re-export 必经 api.ts（紧随 ConfirmResultResult 补登）+
    // SeasonsPage 调用点零改动（apiPost<{ ok: true }> 不读 result，正向在场锁）
    expect(src(FILES.webApi), 'web api:ReplayHooksResult 紧随 ConfirmResultResult 补登').toContain(
      'ConfirmResultResult, ReplayHooksResult,',
    );
    expect(src(FILES.seasonsPage), 'SeasonsPage replay-hooks 调用点零改动').toContain(
      'await apiPost<{ ok: true }>(`/api/admin/results/${matchId}/replay-hooks`, {});',
    );
  });
});

describe('growth-tier 契约锚点锁', () => {
  it('TierDiffRow 换源 batch2，core 键型 import 退役，路由泛型与换源登记注释在场', () => {
    const worker = src(FILES.growthTier);
    expect(worker, 'growth-tier:TierDiffRow 契约 import').toContain(
      "import type { TierDiffRow } from '../contract/batch2.ts';",
    );
    // TierRecomputeSummary / applyTierRecompute 的 rows 引用自动指契约型
    expect(worker, 'growth-tier rows 引用契约型（传导）').toContain('rows: TierDiffRow[];');
    // core import 列表不再引入 GrowthTierConditionKey（唯一用途随本地定义消失）
    expect(worker, 'worker/growth-tier 不再 import GrowthTierConditionKey').not.toContain('GrowthTierConditionKey');
    expect(worker, '本地 interface TierDiffRow 必须退役').not.toContain('interface TierDiffRow');

    const routes = src(FILES.growthTierRoutes);
    expect(routes, 'routes/admin/growth-tier 契约 import（v6.82.0 第 2 批锚点保持）').toContain(
      "import type { TierChangeEntry, TierClubWithoutCountry, TierPlayerDetail, TierRecomputeSummary } from '../../../contract/batch2.ts';",
    );
    expect(routes, 'TierDiffRow 换源登记注释（施工表联动项）').toContain('TierDiffRow 形状真源已归 contract/batch2.ts');
    // 防假绿计数：四端点里两处 c.json<TierRecomputeSummary>（预览 / 执行）
    expect(routes.match(/c\.json<TierRecomputeSummary>/g) ?? [], 'TierRecomputeSummary 泛型应为 2 处').toHaveLength(2);
  });
});

describe('registration 契约锚点锁', () => {
  it('三型换源 batch2，本地 NumberConflict 退役，传导锚点（players/rules/issues/compliance）在场', () => {
    const text = src(FILES.registration);
    expect(text, 'registration:SquadOverview/SquadNumbersResponse/NumberConflict 契约 import').toContain(
      "import type { NumberConflict, SquadNumbersResponse, SquadOverview } from '../../contract/batch2.ts';",
    );
    // SquadOverview：主响应顶层泛型（players/rules/issues/compliance 等子对象全靠它传导）
    expect(text, 'registration:SquadOverview 主响应泛型').toContain('return c.json<SquadOverview>({');
    // SquadPlayerRow：players.map 字面量随顶层泛型传导（不另起局部变量）
    expect(text, 'registration:SquadPlayerRow players.map 传导').toContain('players: players.map((p) => {');
    // SquadCompliance：checkSquad 返回 core SquadCheckResult，与契约同形
    expect(text, 'registration:SquadCompliance checkSquad 传导').toContain(
      '? checkSquad(view.firstTeam.map(viewToSquadPlayer), view.trainee.map(viewToSquadPlayer), rules)',
    );
    // SquadIssue：契约按名引 core 九值联合，未签约补丁复用同形状
    expect(text, 'registration:SquadIssue 未签约补丁 rule 成员').toContain("rule: 'contract',");
    expect(text, 'registration:SquadIssue 补丁置 pass=false').toContain('compliance.pass = false;');
    // SquadRules：七字段内联投影随顶层泛型传导
    expect(text, 'registration:SquadRules squadMin 投影').toContain('squadMin: rules.squadMin,');
    expect(text, 'registration:SquadRules tier 投影').toContain('tier: rules.tier,');
    // NumberConflict：本地 interface 退役，resolveNumberAssignments 返回型承载
    expect(text, 'registration:NumberConflict resolveNumberAssignments 返回型').toContain(
      'conflicts: NumberConflict[]',
    );
    // 409 冲突体有意不并入契约（走 ApiError.conflicts 消费），错误通道保持原样
    expect(text, 'registration 号码冲突 409 错误通道不并入契约').toContain(
      "return c.json({ error: '有号码和队友冲突，先处理标红的号码', code: 'number_conflict', conflicts }, 409);",
    );
    expect(text, 'registration:SquadNumbersResponse 批量改号回执泛型').toContain(
      'return c.json<SquadNumbersResponse>({ ok: true, applied });',
    );
    // 本地重复定义退役
    expect(text, '本地 interface NumberConflict 必须退役').not.toContain('interface NumberConflict');
  });
});

describe('sea-sealed 契约锚点锁', () => {
  it('四型换源 batch5，路由四端点泛型逐字（SeaExtendResult 映射六键在场）', () => {
    const text = src(FILES.seaSealed);
    expect(text, 'sea-sealed:SeaAdminView/SeaCancelResult/SeaExtendResult/SeaOpenSummary 契约 import').toContain(
      "import type { SeaAdminView, SeaCancelResult, SeaExtendResult, SeaOpenSummary } from '../../../contract/batch5.ts';",
    );
    expect(text, 'sea-sealed:SeaAdminView 列表泛型').toContain(
      'return c.json<SeaAdminView>(await loadSeaAdminView(c.env));',
    );
    expect(text, 'sea-sealed:SeaOpenSummary 开标泛型').toContain(
      'return c.json<SeaOpenSummary>(await openNow(c.env, user.id ?? null, batchId));',
    );
    expect(text, 'sea-sealed:SeaExtendResult 延期泛型').toContain('return c.json<SeaExtendResult>({');
    // 映射六键（batch 行 → 契约 batch 对象）
    expect(text, 'sea-sealed:SeaExtendResult batch.id').toContain('id: batch.id,');
    expect(text, 'sea-sealed:SeaExtendResult batch.season').toContain('season: batch.season,');
    expect(text, 'sea-sealed:SeaExtendResult batch.windowSeq').toContain('windowSeq: batch.window_seq,');
    expect(text, 'sea-sealed:SeaExtendResult batch.status').toContain('status: batch.status,');
    expect(text, 'sea-sealed:SeaExtendResult batch.deadlineAt').toContain('deadlineAt: batch.deadline_at,');
    expect(text, 'sea-sealed:SeaExtendResult batch.note').toContain('note: batch.note,');
    expect(text, 'sea-sealed:SeaCancelResult 取消泛型').toContain(
      'return c.json<SeaCancelResult>(await cancelCurrentBatch(c.env, user.id ?? null, batchId, note));',
    );
    // 防假绿计数：四端点各一处泛型
    expect(text.match(/return c\.json</g) ?? [], 'sea-sealed 泛型端点数应为 4').toHaveLength(4);
  });
});

describe('players 既有锚点复核锁', () => {
  it('seaComps 局部标注与 PlayerDetail 泛型既有锚点仍在（防后续改动回退）', () => {
    const text = src(FILES.players);
    expect(text, 'players seaComps 局部标注（SeaSignEligibility 探测）').toContain(
      "const seaComps: SeaComps = { scope: 'none', rows: [] };",
    );
    expect(text, 'players 详情泛型 c.json<PlayerDetail>').toContain('return c.json<PlayerDetail>({');
  });
});

describe('锁判据自检（错一个字必须不匹配，防恒真）', () => {
  it('每组抽代表锚点错一字后，在对应源码里必须失配', () => {
    // 逐组代表锚点：覆盖「契约 import」「返回标注」「泛型」「收窄字段」「传导」「既有锚点」六类判据
    const samples: { file: string; expected: string; label: string }[] = [
      {
        file: FILES.negotiations,
        expected: "import type { WageForecast } from '../contract/batch1.ts';",
        label: 'negotiations WageForecast import',
      },
      {
        file: FILES.negotiations,
        expected: '): Promise<ReleaseFeeResult> {',
        label: 'negotiations ReleaseFeeResult 返回标注',
      },
      {
        file: FILES.negotiationsRoutes,
        expected: 'return c.json<OfferResult>(await offerWage(c.env, sessionId, clubId, user.id, body?.wage));',
        label: 'negotiations routes offer 泛型',
      },
      {
        file: FILES.results,
        expected: 'export async function queueResults(env: Env): Promise<ResultsQueue> {',
        label: 'results queueResults 返回标注',
      },
      {
        file: FILES.results,
        expected: 'const queue: (ResultQueueRow & { _sortKey: string })[] = pending.map(({ m, season, competitionType }) => ({',
        label: 'results 排序中间行类型',
      },
      {
        file: FILES.seasonsRoutes,
        expected: 'return c.json<ReplayHooksResult>({ ok: true, result }, 201);',
        label: 'seasons replay-hooks 泛型',
      },
      {
        file: FILES.seasonsRoutes,
        expected: 'ReplayHooksResult,',
        label: 'seasons ReplayHooksResult import',
      },
      {
        file: FILES.growthTier,
        expected: "import type { TierDiffRow } from '../contract/batch2.ts';",
        label: 'growth-tier TierDiffRow import',
      },
      {
        file: FILES.growthTierRoutes,
        expected: 'TierDiffRow 形状真源已归 contract/batch2.ts',
        label: 'growth-tier routes 换源登记注释',
      },
      {
        file: FILES.registration,
        expected: 'return c.json<SquadOverview>({',
        label: 'registration SquadOverview 泛型',
      },
      {
        file: FILES.registration,
        expected:
          '? checkSquad(view.firstTeam.map(viewToSquadPlayer), view.trainee.map(viewToSquadPlayer), rules)',
        label: 'registration SquadCompliance 传导',
      },
      {
        file: FILES.seaSealed,
        expected: 'return c.json<SeaCancelResult>(await cancelCurrentBatch(c.env, user.id ?? null, batchId, note));',
        label: 'sea-sealed cancel 泛型',
      },
      {
        file: FILES.players,
        expected: 'return c.json<PlayerDetail>({',
        label: 'players 详情泛型',
      },
    ];
    for (const { file, expected, label } of samples) {
      const text = src(file);
      // 前置：原串必须命中（确认样本本身有效，不是拿一个本来就匹配不上的串做自检）
      expect(text, `${label}：自检样本原串应在场`).toContain(expected);
      const typo = typoOf(expected);
      expect(text, `${label}：错一字后的串必须失配（判据不是恒真）`).not.toContain(typo);
    }
  });

  it('退役判据自检：本地定义字样在场时必须能被抓到（判据方向正确）', () => {
    // absent 判据是 not.toContain：给它喂一段含本地定义的合成文本，必须命中
    expect('export interface WageForecast { forecast: string; risk: boolean; }').toContain('export interface WageForecast');
    expect('interface MySessionsResult { sessions: unknown[]; }').toContain('interface MySessionsResult');
    expect('export interface OfferOutcome { result: string; }').toContain('export interface OfferOutcome');
    expect('export interface ResultQueueItem { matchId: number; }').toContain('export interface ResultQueueItem');
    expect('export interface ConfirmedResultItem { matchId: number; }').toContain('export interface ConfirmedResultItem');
    expect('import type { GrowthTierConditionKey } from "../core/growth-tier.ts";').toContain('GrowthTierConditionKey');
    expect('interface NumberConflict { number: string; playerId: number; }').toContain('interface NumberConflict');
    // 真实源码方向：worker/growth-tier.ts 里 GrowthTierConditionKey 必须真的不在场（不是判据写反）
    expect(src(FILES.growthTier)).not.toContain('GrowthTierConditionKey');
  });
});
