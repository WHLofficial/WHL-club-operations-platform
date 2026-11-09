// API 约定（附录 A）：错误统一 {error, code?}。跨端 DTO 契约的唯一真源在 src/contract/
// （v6.82.0 起按批迁移）：本文件对已迁移类型只做 re-export（见下方「契约 re-export 区」），
// 不得手抄；尚未迁移的 DTO 暂留本层，后续批次迁入契约。
// 第 2 批契约（真源 src/contract/batch2.ts，v6.82.0）：ApiError 的结构化错误明细与
// ocrMatchEntry 的返回类型需要本地绑定，其余类型仅 re-export、不进本文件作用域
// （第 1 批 batch1.ts 的本地绑定随 PlayerDetail 手抄删除一并撤销，只走 re-export）。
import type { MatchOcrResult, NumberConflict, SquadIssue } from '../../../src/contract/batch2.ts';
// （批 4 的 MatchPhase 按测试计划 §6.0 归属表让渡给 B6，api 手抄原地保留，见 MatchPhase 定义处注；
// MatchDecisionResult 已随第 5 批迁 src/contract/batch5.ts。）

// ---- 契约 re-export 区（真源 src/contract/，web 只转发不手抄）----
// 第 1 批（v6.82.0）：workbench + demand（转会台聚合 + 球员要求收件箱），23 型 + P2 补抄
// WorkbenchProofResponse。字段跟随 worker c.json 载荷现实，甄别与 FieldDiff 处置见契约型注。
export type {
  ContractAppliedNotice,
  ContractDemandAttempt,
  ContractDemandCard,
  ContractDemandInbox,
  ContractPendingView,
  DemandAcceptResult,
  DemandCounterResult,
  DemandWageContext,
  DeskSummary,
  PendingContractsResponse,
  PlayerDemandState,
  TransferPanelResponse,
  TransferRequestCard,
  TransferRequestList,
  WageForecast,
  WorkbenchBidRow,
  WorkbenchForcedRow,
  WorkbenchInFlight,
  WorkbenchListingRow,
  WorkbenchProofResponse,
  WorkbenchSearchHit,
  WorkbenchSearchResult,
  WorkbenchSessionRow,
  WorkbenchTransferRow,
} from '../../../src/contract/batch1.ts';
// 第 2 批（v6.82.0）：players / growth / squad / tier——球员库列表与详情、转会记录、比赛页签、
// 导入管线两段式、注册工作台（Squad*）、成长引擎与档位核定、成长录入台与 OCR、
// §6.8 补录 ContractDto / ComplianceReport。字段跟随 worker c.json 载荷现实，甄别与 FieldDiff
// 处置见契约型注（attrValue/MatchEntryListItem 八字段可空化、ImportConfirm.replayed 补抄等）。
export type {
  ComplianceReport,
  ContractDto,
  ContractImportConfirm,
  ContractImportPreview,
  GrowthDetail,
  GrowthEventRow,
  GrowthPeriodRow,
  GrowthPeriodsResponse,
  GrowthSettlementResult,
  ImportConfirm,
  ImportPreview,
  LastDealInfo,
  LevelUpResult,
  MatchEntryInput,
  MatchEntryListItem,
  MatchEntryListResponse,
  MatchEntryPanel,
  MatchEntryPerPlayerResult,
  MatchEntryPlayer,
  MatchEntryRecordedRow,
  MatchEntrySide,
  MatchEntrySubmitResult,
  MatchEntrySuspended,
  MatchOcrEntry,
  MatchOcrResult,
  NumberConflict,
  PlayerDetail,
  PlayerLibraryRow,
  PlayerListItem,
  PlayerListItemPlaystyle,
  PlayerMatchesCompStat,
  PlayerMatchesItem,
  PlayerMatchesResponse,
  PlayerMatchesSeason,
  PlayerTransferRow,
  PlayerTransfersResponse,
  PlayersLibraryResponse,
  PlaystyleDetailRow,
  SquadCompliance,
  SquadIssue,
  SquadNumbersResponse,
  SquadOverview,
  SquadPlayerRow,
  SquadRules,
  TierChangeEntry,
  TierClubWithoutCountry,
  TierConditionDetail,
  TierConditionMeta,
  TierDiffRow,
  TierPlayerDetail,
  TierRecomputeSummary,
  UpgradePlanDto,
} from '../../../src/contract/batch2.ts';
// 第 3 批（v6.82.0）：shop / voucher / venue / weather / naming / brand / finance / ledger /
// shortlist / notification——账本与券流水、财务汇总与 M0、主场战报、收件篮三型、候选名单、
// 球场建设与施工回执、冠名市场全域、招商轮四件套（§6.0 归属本批）、场馆经营全域、天气预报
// 六型、消费中心全域。字段跟随 worker c.json 载荷现实，甄别与 FieldDiff 处置见契约型注
// （BrandQuote.quotaLeft 删 / venueName 去可选、VenuePlanResponse.window.status 收窄 'open'、
// BuildPaymentResult 三键补抄、LedgerEntryBase 抽基型、weather stadium.venueName 按载荷现实入契约）。
export type {
  AdminShopOrderRow,
  AdminShopOrdersResponse,
  BetTerms,
  BetTermsItem,
  BookingRow,
  BrandProfile,
  BrandQuote,
  BuildPaymentResult,
  ClubOffer,
  FinanceMatchday,
  FinanceSummaryResponse,
  FinanceWindow,
  HomeMatchRow,
  HomeMatchesResponse,
  LedgerEntryBase,
  LedgerEntryRow,
  LedgerPage,
  M0Report,
  ManualLedgerResult,
  MarketOfferRow,
  MarketRound,
  MarketRoundReopenResult,
  MarketRoundResponse,
  NamingContract,
  NamingContractBase,
  NamingOfferAcceptResult,
  NamingPackage,
  NamingQuoteResponse,
  NamingRenewResult,
  NamingTerminateResult,
  NotificationItem,
  NotificationsPage,
  NotificationsUnreadByCategory,
  ShortlistIdsResponse,
  ShortlistItem,
  ShortlistPlayer,
  ShortlistResponse,
  ShopCatalog,
  ShopOrderDto,
  ShopOrderMutationResult,
  ShopOrderStatus,
  ShopOrdersResponse,
  ShopPrices,
  ShopSquadStatePlayer,
  ShopSquadStateResponse,
  StadiumBuildInfo,
  VenueActivityOption,
  VenueActivityQuote,
  VenueFigureBlock,
  VenuePlanResponse,
  VenuePolicyChoice,
  VenuePreviewResponse,
  VenueSaveResponse,
  VenueSlotDto,
  VenueSlotQuote,
  VenueTotals,
  VoucherLedgerEntry,
  VoucherLedgerResponse,
  WeatherForecastConfirmedRow,
  WeatherForecastPreview,
  WeatherForecastPreviewMatch,
  WeatherForecastRow,
  WeatherForecastSkippedRow,
  WeatherForecastTriggerResult,
} from '../../../src/contract/batch3.ts';
// 第 4 批（v6.82.0）：club / season / window / match / event / ops / admin 杂项（audit / config /
// import / cpu）——球队页全域、我的球队概览与余额、管理端俱乐部与 CPU 接管向导、赛季与结算三件套、
// 窗口状态机与关窗看板、随机事件玩家侧 + 管理端 + LLM 草稿工坊、运营时刻表、总览 / 名单报表 /
// 审核工作台 / 审计 / 平台参数 / 期初导入。字段跟随 worker c.json 载荷现实，甄别与 FieldDiff
// 处置见契约型注（MyClubOverview.home 必填原状登记 / SeasonRow.ageCap 删 / SeasonSettleResult.champion
// 等四处 workerExtra 补抄 / OpenWindowResult·CloseWindowResult 五键补抄 / ClubBalance 两键保留可选登记 /
// AdminEventTriggeredRow 两键去可选 / AdminRegistrations 三键补抄 / ClubDirectoryRow.leagueTier
// naming 保留原状登记 / ResultQueueRow.windowSeq 去必填登记）。甄别清单机械清点 88 型，其中
// Import* / MatchEntry* / MatchOcr* 已在第 2 批、AdminShop* / ClubOffer / StadiumBuildInfo /
// HomeMatch* 已在第 3 批迁出、MatchPhase / MatchDecisionResult 按 §6.0 归属表让渡 B6 / B5，
// 均不重复转发；另有测试计划 §6.8 漏审补录六型（TournamentRow / BindTournamentResult /
// ResultQueueRow / ConfirmedResultRow / ResultsQueue / ConfirmResultResult）随本批迁入。
export type {
  AdminClubRow,
  AdminEventDraft,
  AdminEventOccurrence,
  AdminEventPoolRow,
  AdminEventTriggerResult,
  AdminEventTriggeredRow,
  AdminOverview,
  AdminRegistrations,
  AdminReviewBatchResult,
  AdminReviewRow,
  AdminReviews,
  AuditEntryRow,
  AuditLogResponse,
  ClubBalance,
  ClubBand,
  ClubContractStructure,
  ClubDetail,
  ClubDirectoryRow,
  ClubEventChooseResult,
  ClubEventOption,
  ClubEventOptionOutcome,
  ClubEventPending,
  ClubEventRecent,
  ClubEventsResponse,
  ClubFormRow,
  ClubPositionGroup,
  ClubStanding,
  ClubSummary,
  ClubTransferRow,
  ClubSquadStructure,
  CloseWindowResult,
  ConfigResponse,
  ConfigRow,
  CpuConvertState,
  CpuRenameLocalResult,
  CpuRenameTourResult,
  CpuSeedOpsResult,
  EventDraftAdoptResult,
  EventDraftStruct,
  LlmDraftResult,
  LlmStatus,
  BindTournamentResult,
  ConfirmedResultRow,
  ConfirmResultResult,
  MyClubOverview,
  OpeningImportResult,
  OpsEndAnchor,
  OpsSaveResult,
  OpsScheduleView,
  OpsStartAnchor,
  OpsState,
  OpsStatusRow,
  OpenWindowResult,
  SeasonBinding,
  SeasonCurrent,
  SeasonRow,
  SeasonSettleResult,
  SeasonBindingsResponse,
  SeasonsCurrent,
  SeasonsResponse,
  SettleCheckResult,
  StageSettleResult,
  TournamentRow,
  ResultQueueRow,
  ResultsQueue,
  StadiumAdmin,
  StadiumInfo,
  WindowOverviewRow,
  WindowRow,
  WindowsResponse,
} from '../../../src/contract/batch4.ts';
// 第 5 批（v6.82.0）：sea / offer / negotiation / transfer——报价设置、报价 / 议价列表详情与
// 五个动作回执（P2 补具名四型 + CancelOwnResult）、谈判会话与三个动作回执、旁路转会回执四型、
// 匹配决定、海捞情报两型与暗标段全域十型。字段跟随 worker c.json 载荷现实，甄别与 FieldDiff
// 处置见契约型注（RcChangeResult.freeRcChange 从响应删除、四型 ok 收窄 true、offer.season/
// windowSeq 加 null、TransferType 补 'activation'、OfferSettingsDto.ok 补抄、随批补甄别三处：
// ReleaseFeeResult/TraineeSignResult.ok 收窄、OfferDetailResponse 拆 Omit<…,'counterpart'>、
// OfferEventRow.actor.name 放宽 null）。DeskTab.tsx「本次免费」死分支删除是全六批唯一 web
// 运行时改动（恒假分支从未渲染，测试计划 §6.5 B5 验收①）。
export type {
  CancelOwnResult,
  FreeAgentResult,
  MatchDecisionResult,
  MyNegotiations,
  NegotiationSession,
  OfferAcceptResult,
  OfferCounterResult,
  OfferDetailResponse,
  OfferEventRow,
  OfferListItem,
  OfferOkResult,
  OfferPlaceResult,
  OfferResult,
  OfferSettingsDto,
  OfferStatus,
  OffersListResponse,
  RcChangeResult,
  ReleaseFeeResult,
  SeaAdminBidRow,
  SeaAdminView,
  SeaBatchDto,
  SeaBatchStatus,
  SeaBidDto,
  SeaBidStatus,
  SeaCancelResult,
  SeaCompRow,
  SeaComps,
  SeaExtendResult,
  SeaOpenSummary,
  SeaPhaseView,
  SeaSignEligibility,
  SeaSubmitResult,
  SeaWinnerDto,
  TerminationResult,
  TraineeSignResult,
  TransferType,
} from '../../../src/contract/batch5.ts';
// 第 6 批（v6.82.0）：market（listings / bids / 激活 / 强拍状态机 DTO）——挂牌状态机两联合与
// feed/详情/浮层拆基型（MarketListingBase 单源）、激活与出价回执、我的出价、市场情报四端点、
// 广告板与海捞速查、可激活名单、强拍四件套（§6.0 归属本批）+ P2 补具名回执四型。字段跟随
// worker c.json 载荷现实，甄别与 FieldDiff 处置见契约型注（MarketDealsRow 三快照键 + 分页两键
// 补抄、TransferBoardRow.ca/pa 可空化、ForcedAuctionResult.ok 收窄 true、ForcedAuctionPreview
// ← worker 内部名 ForcedAuctionInspection；随批补甄别两处：ActivationResult.ok / BidPlaceResult.ok
// 收窄 true、BidPlaceResult.bid 内键按载荷现实为 snake_case created_at）。MarketRound 四件套
// （招商轮域）已归第 3 批、DeskSummary / TransferPanelResponse 已归第 1 批，均不重复转发。
export type {
  ActivationReportResult,
  ActivationResult,
  ActivatablePlayer,
  ActivatableResponse,
  BidPlaceResult,
  ForcedAuctionBlocker,
  ForcedAuctionCancelResult,
  ForcedAuctionPreview,
  ForcedAuctionReference,
  ForcedAuctionResult,
  ListingProofResponse,
  ListingStatus,
  MarketDealsResponse,
  MarketDealsRow,
  MarketListing,
  MarketListingBase,
  MarketListingCreateResult,
  MarketListingDetail,
  MarketListings,
  MatchPhase,
  MyBidRow,
  RumorItem,
  RumorsResponse,
  SeaLookupResponse,
  SeaLookupRow,
  TransferBoardResponse,
  TransferBoardRow,
} from '../../../src/contract/batch6.ts';

export interface MeUser {
  id: number;
  name: string;
  role: 'admin' | 'coach' | 'viewer';
  locked: boolean;
  mustChangePw: boolean;
  /** 权限点随 /api/me 原样下发（v2.1.0）：超管凭 club.config.manage.super 判定 */
  permissions?: string[];
}

/** 超管独立权限点（与 src/lib/session.ts 保持一致）：平台参数全开 */
export const SUPER_ADMIN_PERM = 'club.config.manage.super';

export function isSuperAdmin(user: MeUser | null | undefined): boolean {
  return Boolean(user?.permissions?.includes(SUPER_ADMIN_PERM));
}

/** 登录入口模式（统一认证步骤②）：oidc=认证中心，shared=赛事系统共享会话（旧行为） */
export type AuthMode = 'oidc' | 'shared';

// NumberConflict / SquadIssue 已迁 src/contract/batch2.ts（v6.82.0 第 2 批）：
// ApiError 的结构化错误明细经上方 import type 引用本契约单源。

export class ApiError extends Error {
  status: number;
  code?: string;
  /** 422 校验类错误的明细（如注册合规 issues），由响应体透传 */
  issues?: SquadIssue[];
  /** 409 号码冲突的结构化明细（v6.76.0 号码批量分配） */
  conflicts?: NumberConflict[];

  constructor(status: number, message: string, code?: string, issues?: SquadIssue[], conflicts?: NumberConflict[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.conflicts = conflicts;
  }
}

/** 错误体两种口径：HttpError 是 {error:'中文'}；机器通道与新管理端点（v6.27.0）是 {error:'code', message:'中文'}——有 message 就用它 */
function errMessage(data: unknown, fallback = '请求失败'): string {
  const d = data as { message?: unknown; error?: unknown } | null;
  if (typeof d?.message === 'string' && d.message) return d.message;
  if (typeof d?.error === 'string' && d.error) return d.error;
  return fallback;
}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, errMessage(body), body?.code);
  }
  return body as T;
}

export async function apiSend<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      errMessage(data),
      data?.code,
      Array.isArray(data?.issues) ? data.issues : undefined,
      Array.isArray(data?.conflicts) ? data.conflicts : undefined,
    );
  }
  return data as T;
}

export const apiPost = <T,>(path: string, body?: unknown) => apiSend<T>('POST', path, body);
export const apiPut = <T,>(path: string, body?: unknown) => apiSend<T>('PUT', path, body);
export const apiDelete = <T,>(path: string, body?: unknown) => apiSend<T>('DELETE', path, body);

/** 原始字节上传（v6.4.0 激活证据截图用）：不走 JSON 序列化，Content-Type 由调用方给 */
export async function apiUpload<T>(path: string, contentType: string, body: Blob): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': contentType }, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, errMessage(data), data?.code);
  }
  return data as T;
}

// 赛事系统入口。v5.0.1：用 tour 子域而不是 apex——apex whleague.win 没有部署服务、也无 A 记录，
// 指向它等于给用户一个连不上的按钮（TopBar / RequireUser / Home / AdminLayout 五处外链都用这个常量）。
export const TOUR_SITE_URL = 'https://tour.whleague.win/';

// SeasonsCurrent / MyClubOverview / StadiumInfo / StadiumAdmin / ClubSummary / ClubBand /
// ClubPositionGroup / ClubSquadStructure / ClubContractStructure / ClubTransferRow /
// ClubFormRow / ClubDetail / ClubStanding 已迁 src/contract/batch4.ts（v6.82.0 第 4 批；
// MyClubOverview.home 的 workerMissing 登记与 funds 半旧容忍保留可选等处置见契约型注），
// 本文件只 re-export。

// ---- v0.2.0 DTO（附录 A〔1〕）----

// ---- 球队页（v3.4.0）----

/** R2 媒体对象 key → 公开读取地址（服务端 GET /api/media/* 只读代理，不碰 D1） */
export function mediaUrl(key: string | null | undefined): string | null {
  return key ? `/api/media/${key}` : null;
}

// PlayerListItem / PlayerListItemPlaystyle / PlayerLibraryRow / LastDealInfo /
// PlayersLibraryResponse / ContractDto（§6.8 补录）/ PlayerDetail / PlayerTransferRow /
// PlayerTransfersResponse / PlayerMatches* / ImportPreview / ImportConfirm /
// ContractImportPreview / ContractImportConfirm / SquadRules / SquadIssue / SquadCompliance /
// SquadPlayerRow / SquadNumbersResponse / SquadOverview / NumberConflict / ComplianceReport
// 已迁 src/contract/batch2.ts（v6.82.0 第 2 批），本文件只 re-export。

// ---- v6.54.0 步骤 7：双版本合同（设计 §10.4） ----
// 只对本队教练下发（GET /api/players/:id 与 /api/club/squad 都按会话判归属；
// 球队页阵容小字走独立的 /api/club/pending-contracts，不污染公开缓存）。
// ContractPendingView / ContractAppliedNotice / PlayerDemandState 已迁 src/contract/batch1.ts（v6.82.0 第 1 批）。

// OfferSettingsDto / SeaSignEligibility / SeaCompRow / SeaComps 已迁 src/contract/batch5.ts
// （v6.82.0 第 5 批；OfferSettingsDto.ok 按 workerExtra 补抄可选——仅 PUT 回、GET 不回——
// 处置见契约型注），本文件只 re-export（见顶部契约 re-export 区）。

// ---- v0.7.1 d8：球员库（公开 /api/players，keyset 游标分页）----
// PlayerLibraryRow / LastDealInfo / PlayersLibraryResponse 已迁 src/contract/batch2.ts。

// 俱乐部目录 / 管理端俱乐部列表 / CPU 接管向导六型（ClubDirectoryRow / AdminClubRow /
// CpuConvertState / CpuRenameTourResult / CpuRenameLocalResult / CpuSeedOpsResult）已迁
// src/contract/batch4.ts（v6.82.0 第 4 批；ClubDirectoryRow.leagueTier 的 naming 登记与
// AdminClubRow.transferBanned 去可选等处置见契约型注），本文件只 re-export。

// ImportPreview / ImportConfirm 已迁 src/contract/batch2.ts（ImportConfirm.replayed 按
// workerExtra 处置补抄）。

// OpeningImportResult / ConfigRow / ConfigResponse / AdminOverview / AuditEntryRow /
// AuditLogResponse 已迁 src/contract/batch4.ts（v6.82.0 第 4 批；ConfigRow 行形与
// core/config.ts listMasked/listRaw 逐字段同形、AdminOverview 是 worker 同名接口并源，
// 处置见契约型注），本文件只 re-export。

// ---- v0.3.0 DTO（附录 A〔2〕：注册与体检；通道 C 合同导入）----
// SquadRules / SquadIssue / SquadCompliance / SquadPlayerRow / WindowOverviewRow 原生于此节；
// 前四者已迁 src/contract/batch2.ts（v6.82.0 第 2 批），WindowOverviewRow 归批 4。

// WindowOverviewRow（v6.69.0 期三，GET /api/admin/windows/overview）与 AdminRegistrations
// （v6.67.0 期一名单报表）已迁 src/contract/batch4.ts（v6.82.0 第 4 批；WindowOverviewRow 的
// worker 内部名 SquadAuditRow、AdminRegistrations 的 source/isCpu/unsigned 三处 workerExtra
// 补抄与分支差异处置见契约型注），本文件只 re-export。

// SquadNumbersResponse / SquadOverview / ContractImportPreview / ContractImportConfirm
// 已迁 src/contract/batch2.ts（v6.82.0 第 2 批）。

/** GET /api/club/pending-contracts（v6.54.0 步骤 7）：球队页阵容小字的数据源。
 *  PendingContractsResponse 已迁 src/contract/batch1.ts（v6.82.0 第 1 批）。 */

// ComplianceReport 已迁 src/contract/batch2.ts（v6.82.0 第 2 批，§6.8 补录）。

// ---- v0.4.0 DTO（附录 A〔3〕：转会市场挂牌竞价链）----
// ListingStatus / MatchPhase / MarketListing / MarketListings / MarketListingDetail / ActivationResult /
// BidPlaceResult / MyBidRow 已迁 src/contract/batch6.ts（v6.82.0 第 6 批；两联合真源化、feed/详情
// 拆基型 MarketListingBase 单源、ActivationResult.ok / BidPlaceResult.ok 收窄 true、bid 内键按载荷
// 现实为 created_at、detail listing 的 bidCount 登记保留——FieldDiff 与随批补甄别处置见契约型注），
// 本文件只 re-export（见顶部契约 re-export 区）。

/** 球员转会浮层（v6.74.0 期 C，设计 §6.1）：球员页状态条 / 浮层 / 转会台行展开共用一份响应。
 *  TransferPanelResponse 已迁 src/contract/batch1.ts（v6.82.0 第 1 批；listing 不含 feed 专有
 *  bidCount、settled.wage 为 number|null，甄别 FieldDiff #1/#2 处置见契约型注）。 */

// AdminReviewRow / AdminReviews / AdminReviewBatchResult 已迁 src/contract/batch4.ts
// （v6.82.0 第 4 批；批量回执 ok 恒 true 收窄见契约型注），本文件只 re-export。

// ---- 审核工作台（v6.68.2 期 C） ----
// 五张在途表一次取全：Workbench* 九型已迁 src/contract/batch1.ts（v6.82.0 第 1 批，
// worker 内部名 ↔ 契约名别名对应见契约文件）。

// TransferType / NegotiationSession / MyNegotiations / ReleaseFeeResult / OfferResult /
// TraineeSignResult 已迁 src/contract/batch5.ts（v6.82.0 第 5 批；TransferType 补 'activation'
// 成员、ReleaseFeeResult / TraineeSignResult 的 ok 随批按 worker 字面量收窄 true、OfferResult
// ← worker OfferOutcome 的 naming 处置见契约型注），本文件只 re-export（见顶部契约 re-export 区）。

// 工资预览（v6.40.0）：POST /api/negotiations/:sessionId/preview 的响应。只读——不落库、不耗轮次、
// 不写审计。WageForecast 已迁 src/contract/batch1.ts（v6.82.0 第 1 批，E 类双用：签约谈判
// preview 与 demand 还价档位 preview 同形合一，见契约型注）。

// ---- v6.54.0 球员要求（闹涨薪）：GET /api/club/contract-demands ----
// 收件箱八型已迁 src/contract/batch1.ts（v6.82.0 第 1 批；worker 内部名 DemandCard /
// ClubDemandInbox 等的别名对应见契约文件）。金额单位 m；expected_wage 刻意不下发
// （界面只说「市场价」，§2.1），floor 下发（本队教练还价防呆需要）。

// ---- v0.6.0 DTO（附录 A〔5〕：旁路转会 + 匹配 + 窗口 + 强制拍卖）----

// ---- v6.18.0：市场情报（传闻 / 已达成交易 / 海捞资格 / 激活球员）----
// v6.17.0 的 /api/market/sea-signs、cpu-board、trainees 三个端点已退役：成交情报迁进 /market/intel
// （rumors + deals），可激活名单换成 /api/market/activatable，海捞资格查询走 /api/market/sea-lookup。
// 更早的 FreeAgentRow/FreeAgentsResponse 已随 /api/market/free-agents 下线，别再复活。
// RumorItem / RumorsResponse / MarketDealsRow / MarketDealsResponse / TransferBoardRow /
// TransferBoardResponse / SeaLookupRow / SeaLookupResponse / ActivatablePlayer / ActivatableResponse
// 已迁 src/contract/batch6.ts（v6.82.0 第 6 批；deals 行三快照键与容器分页两键按 workerExtra 补抄、
// TransferBoardRow.ca/pa 按列可空可空化——R-WEB 断点登记见契约型注），本文件只 re-export。

// RcChangeResult / TerminationResult / FreeAgentResult / MatchDecisionResult 已迁
// src/contract/batch5.ts（v6.82.0 第 5 批；RcChangeResult.freeRcChange 按 workerMissing 删——
// 响应从不携带该键，免费通道只落 evidence 供审核豁免，web DeskTab.tsx 的恒假死分支随批删除；
// 四型 ok 按 worker 字面量收窄 true。处置见契约型注），本文件只 re-export。
// WindowRow / WindowsResponse / OpenWindowResult / CloseWindowResult 已迁 src/contract/batch4.ts
// （v6.82.0 第 4 批；Open/Close 五处 workerExtra 补抄的处置见契约型注），本文件只 re-export。

// 强拍状态机四件套（ForcedAuctionReference / ForcedAuctionBlocker / ForcedAuctionPreview /
// ForcedAuctionResult）已迁 src/contract/batch6.ts（v6.82.0 第 6 批；ok 收窄 true、命名 D 处置
// ForcedAuctionPreview ← worker 内部名 ForcedAuctionInspection，见契约型注），本文件只 re-export。

// ---- v0.7.0 DTO（附录 A〔6〕：财政/赛季/赛果/成长/通知/监管）----

// ClubBalance 已迁 src/contract/batch4.ts（v6.82.0 第 4 批；activationIncome/activationCredit
// 按 workerReality 收窄必填——worker 两分支恒发，处置见契约型注）。

// 账本 / 券流水 / 财务汇总 / M0 / 主场战报 / 收件篮 / 候选名单 / 球场建设 / 冠名市场 / 招商轮 /
// 场馆经营 / 天气预报 / 消费中心各型已迁 src/contract/batch3.ts（v6.82.0 第 3 批，见顶部 re-export 区；
// FieldDiff 处置见契约型注）。ManualLedgerKind / MANUAL_LEDGER_KINDS 是 viewmodel（前端奖金模板
// 下拉常量）按口径 7① 留守本文件；NotifyRef / NotifyCategoryId 是共享 core 单源
// （core/notify-meta.ts），本文件已无本地引用，契约 batch3.ts 按名 import 同源（口径 7②）。

// 管理端随机事件 / LLM 草稿工坊九型（AdminEventPoolRow / AdminEventOccurrence /
// AdminEventTriggeredRow / AdminEventTriggerResult / LlmStatus / EventDraftStruct /
// AdminEventDraft / LlmDraftResult / EventDraftAdoptResult）已迁 src/contract/batch4.ts
// （v6.82.0 第 4 批；AdminEventTriggeredRow 的 eventType/deadlineAt 按 typeMismatch 去可选，
// 处置见契约型注），本文件只 re-export。

// 玩家侧随机事件七型（ClubEventOptionOutcome / ClubEventOption / ClubEventPending /
// ClubEventRecent / ClubEventsResponse / ClubEventChooseResult）已迁 src/contract/batch4.ts
// （v6.82.0 第 4 批；worker 内部名 EventOption / EventOutcome 对应见契约型注），本文件只 re-export。

/** 流水 kind → 中文短标签（prize_* 之外的全量枚举见 §7.1；未收录的原样显示 kind） */
export const LEDGER_KIND_LABELS: Record<string, string> = {
  opening_import: '期初导入',
  manual_adjust: '手动调整',
  transfer_in: '买入付款',
  transfer_out: '卖出所得',
  transfer_tax: '转会税',
  delist_fee: '下架费',
  termination_fee: '解约费',
  rc_change_fee: '续约费',
  rc_change_refund: '续约回滚退款',
  match_diff_burn: '匹配差额',
  free_agent_fee: '海捞签入费',
  wage: '工资',
  loyalty: '忠诚支出',
  ticket: '门票',
  commercial: '商业收入',
  broadcast: '转播分成',
  facility_build: '设施建设',
  facility_maintenance: '设施维护',
  stadium_expand: '球场扩建',
  stadium_upgrade: '球场升级',
  facility_upgrade: '设施升级',
  naming_fee: '冠名费',
  naming_bonus: '对赌奖金',
  naming_penalty: '冠名解约赔款',
  luxury_tax: '富人税',
  event: '随机事件',
  shop_purchase: '消费',
};

export function ledgerKindLabel(kind: string): string {
  return LEDGER_KIND_LABELS[kind] ?? kind;
}

// viewmodel（口径 7①，不迁契约）：纯前端奖金模板下拉的展示常量，worker 不下发该形状；
// value 取值域受 worker MANUAL_KIND_RE=/^(manual_adjust|prize_[a-z_]+)$/ 白名单约束
//（admin/finance.ts），worker 正则比本清单宽，前端清单只是子集。
export interface ManualLedgerKind {
  value: string;
  label: string;
  /** §9.1 奖金模板参考值（m）；manual_adjust 无 */
  reference?: number;
}

/** P0 奖金模板（§9.1）+ 手动调整；POST /api/admin/ledger/manual 的 kind 白名单与之对齐 */
export const MANUAL_LEDGER_KINDS: ManualLedgerKind[] = [
  { value: 'manual_adjust', label: '手动调整（冲账 / 纠错）' },
  { value: 'prize_premier_entry', label: '顶级联赛 · 入场奖金', reference: 20 },
  { value: 'prize_premier_win', label: '顶级联赛 · 单场胜', reference: 8.5 },
  { value: 'prize_premier_draw', label: '顶级联赛 · 单场平', reference: 6.6 },
  { value: 'prize_premier_loss', label: '顶级联赛 · 单场负', reference: 4.7 },
  { value: 'prize_second_entry', label: '次级联赛 · 入场奖金', reference: 7.5 },
  { value: 'prize_second_win', label: '次级联赛 · 单场胜', reference: 6.7 },
  { value: 'prize_second_draw', label: '次级联赛 · 单场平', reference: 4.8 },
  { value: 'prize_second_loss', label: '次级联赛 · 单场负', reference: 2.9 },
  { value: 'prize_qualifying', label: '冠军杯 · 资格赛止步保底', reference: 7.5 },
  { value: 'prize_champions_entry', label: '冠军杯 · 小组赛入场', reference: 15 },
  { value: 'prize_champions_win', label: '冠军杯 · 小组赛单场胜', reference: 7.0 },
  { value: 'prize_champions_draw', label: '冠军杯 · 小组赛单场平', reference: 2.5 },
  { value: 'prize_champions_r8', label: '冠军杯 · 八强', reference: 7.5 },
  { value: 'prize_champions_r4', label: '冠军杯 · 四强', reference: 10 },
  { value: 'prize_champions_final', label: '冠军杯 · 决赛', reference: 12.5 },
  { value: 'prize_champions_title', label: '冠军杯 · 夺冠', reference: 5 },
  { value: 'prize_super_win', label: '超级杯 · 胜', reference: 4.0 },
  { value: 'prize_super_loss', label: '超级杯 · 负', reference: 2.0 },
];

// SeasonBinding / SeasonCurrent / SeasonRow / SeasonsResponse / SeasonBindingsResponse 已迁
// src/contract/batch4.ts（v6.82.0 第 4 批；SeasonRow.ageCap 按 workerMissing 删、SeasonCurrent 与
// SeasonsCurrent 同载荷两名的甄别命名处置见契约型注），本文件只 re-export。

// TournamentRow / BindTournamentResult 已迁 src/contract/batch4.ts（v6.82.0 第 4 批，
// 测试计划 §6.8 漏审补录；BindTournamentResult.ok 收窄 true 见契约型注）。

// SettleCheckResult / SeasonSettleResult / StageSettleResult 已迁 src/contract/batch4.ts
// （v6.82.0 第 4 批；SeasonSettleResult.champion 按 workerExtra 补抄，ok 恒 true 收窄见契约型注）。

// ResultQueueRow / ConfirmedResultRow / ResultsQueue / ConfirmResultResult 已迁 src/contract/batch4.ts
// （v6.82.0 第 4 批，§6.8 补录；ResultQueueRow.windowSeq 的 workerMissing 登记与 ConfirmResultResult.ok
// 收窄 true 见契约型注；worker 内部名 ResultQueueItem / ConfirmedResultItem 对应见契约型注）。

// ---- 场次天气预报（v6.15.0）：管理员按 (赛事, 轮次) 预览 / 触发本轮主场预报 ----

/** season_windows.competition_type 中文标签（§11） */
export const COMPETITION_TYPE_LABEL: Record<string, string> = {
  league_premier: '顶级联赛',
  league_second: '次级联赛',
  champions_cup: '冠军杯',
  super_cup: '超级杯',
  qualifying: '资格赛',
};

export const TOUR_STATUS_LABEL: Record<string, string> = {
  draft: '筹备中',
  registering: '报名中',
  running: '进行中',
  archived: '已归档',
};

// ---- 成长引擎（§10，v0.7.0） ----
// GrowthEventRow / UpgradePlanDto / PlaystyleDetailRow / GrowthDetail / LevelUpResult /
// GrowthSettlementResult / GrowthPeriodRow / GrowthPeriodsResponse 已迁
// src/contract/batch2.ts（v6.82.0 第 2 批）。GROWTH_EVENT_LABEL 是 viewmodel（纯前端标签映射）
// 按口径 7① 留守本文件，不迁契约。

/** growth_events.event_type 中文标签 */
export const GROWTH_EVENT_LABEL: Record<string, string> = {
  appearance: '出场',
  rating: '评分',
  goal: '进球',
  assist: '助攻',
  clean_sheet: '零封',
  duels_won: '夺回球权',
  saves: '扑救',
  milestone: '进+攻里程碑',
  trainee_season: '训练营赛季',
  china_plan: '中国计划',
  levelup: '升级',
  reset: '解约重置', // 解约清零的划断标记（值/XP 都是 0）：成长史里说明为什么累计从头开始
};

// ---- v6.48.0：成长档位自动核定（§10.3，/api/admin/growth/tier-*） ----
// TierConditionMeta / TierConditionDetail / TierPlayerDetail / TierDiffRow /
// TierRecomputeSummary / TierClubWithoutCountry / TierChangeEntry 已迁
// src/contract/batch2.ts（v6.82.0 第 2 批）。

// ---- v6.16.0：管理端「成长录入」（按场补录，/api/admin/growth/match-entry） ----
// MatchEntry* 12 型 / MatchOcrEntry / MatchOcrResult 已迁 src/contract/batch2.ts
// （v6.82.0 第 2 批；八字段可空化、officialName 补抄、unmatched[].pos 收窄见契约型注）。

/** 赛后截图识别预填（不写库；image 传不带 data: 前缀的 base64）。
 *  v6.51.3：队名分不清主客时服务端回 400 code=ocr_team_ambiguous；同一张图带上 side 重发即跳过队名匹配。 */
export async function ocrMatchEntry(matchId: number, imageBase64: string, side?: 'home' | 'away'): Promise<MatchOcrResult> {
  return apiPost<MatchOcrResult>(
    `/api/admin/growth/match-entry/${matchId}/ocr`,
    side ? { image: imageBase64, side } : { image: imageBase64 },
  );
}

// ---- v6.3.0：报价 / 议价（/api/offers，全部私有） ----

// OfferStatus / OfferListItem / OffersListResponse / OfferEventRow / OfferDetailResponse 及
// P2 补具名的五个动作回执（OfferPlaceResult / OfferCounterResult / OfferAcceptResult /
// OfferOkResult / CancelOwnResult）已迁 src/contract/batch5.ts（v6.82.0 第 5 批；offer.season /
// windowSeq 加 null、详情拆 Omit<…,'counterpart'>、events actor.name 放宽 null——随批补甄别
// 三处与 FieldDiff 处置见契约型注），本文件只 re-export（见顶部契约 re-export 区）。

/* ---------- 运营时刻表（v6.49.0） ---------- */
// OpsStartAnchor / OpsEndAnchor / OpsState / OpsStatusRow / OpsScheduleView / OpsSaveResult
// 已迁 src/contract/batch4.ts（v6.82.0 第 4 批），本文件只 re-export。
// 锚/状态三联合的真源在 core/ops-schedule.ts，契约按口径 7② 从 core 转发。

/* ---------- 海捞两阶段·暗标段（v6.50.0） ---------- */

// SeaBatchStatus / SeaBidStatus / SeaBidDto / SeaWinnerDto / SeaBatchDto / SeaPhaseView /
// SeaSubmitResult / SeaOpenSummary / SeaExtendResult / SeaCancelResult / SeaAdminBidRow /
// SeaAdminView 已迁 src/contract/batch5.ts（v6.82.0 第 5 批；两联合与 worker sea-sealed.ts:26-27
// 逐字同值，处置见契约型注），本文件只 re-export（见顶部契约 re-export 区）。
