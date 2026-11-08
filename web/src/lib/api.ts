// API 约定（附录 A）：错误统一 {error, code?}。跨端 DTO 契约的唯一真源在 src/contract/
// （v6.82.0 起按批迁移）：本文件对已迁移类型只做 re-export（见下方「契约 re-export 区」），
// 不得手抄；尚未迁移的 DTO 暂留本层，后续批次迁入契约。
// 第 2 批契约（真源 src/contract/batch2.ts，v6.82.0）：ApiError 的结构化错误明细与
// ocrMatchEntry 的返回类型需要本地绑定，其余类型仅 re-export、不进本文件作用域
// （第 1 批 batch1.ts 的本地绑定随 PlayerDetail 手抄删除一并撤销，只走 re-export）。
import type { MatchOcrResult, NumberConflict, SquadIssue } from '../../../src/contract/batch2.ts';

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

/** 当前赛季与窗口（GET /api/seasons/current，公开）。球员页窗门控只消费 window.status */
export interface SeasonsCurrent {
  season: { season: number; status: string } | null;
  window: { season: number; windowSeq: number; status: string; openedAt: string | null; closedAt: string | null } | null;
  tournaments: { id: number; tournamentId: number; competitionType: string | null }[];
}

// ---- v0.2.0 DTO（附录 A〔1〕）----

export interface MyClubOverview {
  club: { id: number; name: string; leagueTier: string | null; logoKey: string | null; status: string; transferBanned?: boolean } | null;
  balance: number | null;
  // v6.65.3：可支配拆解（消费中心顶部条用），与消费守卫同口径；半旧响应无此字段
  funds?: { available: number; balance: number; held: number; creditLine: number; vouchers: number } | null;
  squadCount: number | null;
  window: { season: number; windowSeq: number } | null;
  // v1.5.0：主场档案（球场/设施/影响力构成）；无球场行 = null
  home: StadiumInfo | null;
}

export interface StadiumInfo {
  name: string | null;
  namingBrand: string | null;
  /** 冠名落点名（v6.51.0）：「品牌·球场名」；老合同为空快照时按现球场名现拼；无冠名 null */
  namingVenueName: string | null;
  capacity: number;
  tier: number;
  tierName: string | null;
  fans: number;
  influence: { players: number; shell: number; bonus: number; tierCoef: number; total: number };
  facilities: { key: string; level: number }[];
}

// v1.5.0：管理端球场档案（GET /clubs/:id/stadium）
export interface StadiumAdmin {
  stadium: { clubId: number; name: string | null; capacity: number; tier: number; shellInfluence: number; bonusPoints: number; fans: number };
  tier: { name: string; min_seats: number; max_seats: number; base_maintenance: number; per_10k_rate: number; attend_coef: number; upgrade_cost: number } | null;
  facilities: { key: string; level: number }[];
  influence: { players: number; shell: number; bonus: number; tierCoef: number; total: number };
}

// ---- 球队页（v3.4.0）----

/** R2 媒体对象 key → 公开读取地址（服务端 GET /api/media/* 只读代理，不碰 D1） */
export function mediaUrl(key: string | null | undefined): string | null {
  return key ? `/api/media/${key}` : null;
}

/**
 * 球队列表条目（GET /api/clubs）。tier 由平台按当季定级赛事报名派生：
 * 未登记目录 / 本季未报名 ⇒ null（列表归「未定级」段）。
 */
export interface ClubSummary {
  id: number;
  name: string;
  isCpu: boolean;
  tier: 'premier' | 'second' | null;
  /** 比赛系统 team.logo_key；本平台自己的 clubs.logo_key 是休眠列，全仓不写不读 */
  logoKey: string | null;
  /** 阵容人数：senior = 一线队，trainee = 训练营（players.status = 'trainee'） */
  squad: { senior: number; trainee: number };
  /** 平均 CA，保留 1 位小数；全队无人时为 null */
  avgCa: number | null;
  /**
   * 全队身价合计。`players.market_value` 是运营列（导入不写、只有 admin PATCH 会写），
   * 一个人都没录过时服务端给 null ⇒ 前端显示「—」而不是 0.00m
   */
  totalValue: number | null;
  totalWage: number;
}

/** 分档统计的一档（年龄 / CA / 效力），服务端给什么档就渲染什么档，前端不重算边界 */
export interface ClubBand {
  key: string;
  label: string;
  count: number;
}

/** 位置四档之一（门将/后卫/中场/前锋，另加「未知」兜底档） */
export interface ClubPositionGroup {
  key: string;
  label: string;
  count: number;
  /** 档内细位明细，形如「RB 1 · CB 2」；无细位数据时为空串 */
  detail: string;
}

export interface ClubSquadStructure {
  size: number;
  senior: number;
  trainee: number;
  avgCa: number | null;
  maxCa: number | null;
  avgPa: number | null;
  /** 平均成长空间（pa − ca），只统计还有空间的人；全员到顶时为 null */
  avgGrowth: number | null;
  /** 同 ClubSummary.totalValue：全队都没录身价时为 null */
  totalValue: number | null;
  totalWage: number;
  avgWage: number | null;
  badgesSilver: number;
  badgesGold: number;
  /** 位置分布：四档恒出（含 0 人档），末尾可能多一项「未知」 */
  byPosition: ClubPositionGroup[];
  byAge: ClubBand[];
  byCa: ClubBand[];
}

/** 合同结构：合同无固定到期日，只有保护期与效力赛季数，所以不叫「合同到期」 */
export interface ClubContractStructure {
  signed: number;
  unprotected: number;
  protectedCount: number;
  /** 平均效力（赛季），0.5 的整数倍 */
  avgYears: number | null;
  byYears: ClubBand[];
}

export interface ClubTransferRow {
  id: number;
  type: string;
  /** transfers.player_id 无 NOT NULL ⇒ 可能为空，为 null 时页面只出球员名不链档案 */
  playerId: number | null;
  /** 球员档案链接用的 FC26 ID（v4.0.0）；为空时回落 playerId */
  playerFcId: number | null;
  playerName: string | null;
  fromClubId: number | null;
  fromClubName: string | null;
  toClubId: number | null;
  toClubName: string | null;
  fee: number | null;
  extraFee: number | null;
  season: number | null;
  windowSeq: number | null;
  completedAt: string | null;
}

export interface ClubFormRow {
  matchId: number;
  season: number;
  competitionType: string | null;
  stageName: string | null;
  /** result_confirmations.round 是 INTEGER（迁移 0009），不是轮次名 */
  round: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  penHome: number | null;
  penAway: number | null;
  /** 90 分钟口径：点球大战不改判定；双弃权双方都记负。拿不到本方队 id 时为 null */
  result: 'win' | 'draw' | 'loss' | null;
  finishedAt: string | null;
}

/** 球队详情（GET /api/clubs/:id，需登录）。阵容名单不在这里——前端复用 GET /api/players?club_id=N */
export interface ClubDetail {
  club: { id: number; name: string; isCpu: boolean; tier: 'premier' | 'second' | null; logoKey: string | null };
  squad: ClubSquadStructure;
  contracts: ClubContractStructure;
  transfers: { incoming: ClubTransferRow[]; outgoing: ClubTransferRow[] };
  form: { recent: ClubFormRow[]; wins: number; draws: number; losses: number };
}

/** 当季联赛排名（GET /api/clubs/:id/standing）。取不到时 standing 为 null、note 给原因 */
export interface ClubStanding {
  standing: {
    tournamentId: number;
    stageName: string | null;
    groupName: string | null;
    /** 名次按积分榜已排好的行序取下标（比赛系统 DTO 的 rank 字段恒为 0） */
    position: number;
    played: number | null;
    won: number | null;
    drawn: number | null;
    lost: number | null;
    goalsFor: number | null;
    goalsAgainst: number | null;
    pts: number | null;
    pointsDeducted: number | null;
  } | null;
  note: string | null;
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

/** 报价设置（GET/PUT /api/players/:id/offer-settings，v6.33.0）：设置面板的私密预填源 */
export interface OfferSettingsDto {
  transferListed: boolean;
  /** 私密最低报价（全系统私密，仅本队教练经本端点可见） */
  minOfferPrice: number | null;
  /** 公开标价（进转会名单必填，其他队可见） */
  listPrice: number | null;
  offerAuto: boolean;
  notForSale: boolean;
  /** 标价低于最低报价被自动对齐的回执（v6.55.0，仅 PUT 返回）：from=库中旧最低报价（首挂无旧值 null），to=对齐后的最低报价 */
  minOfferPriceAdjusted?: { from: number | null; to: number } | null;
}

/** 海捞资格判定（v6.17.0） */
export interface SeaSignEligibility {
  eligible: boolean;
  /** 不可海捞的原因（后端原文）；可签时为 null */
  reason: string | null;
}

/** 海捞成交参照行（v6.17.0） */
export interface SeaCompRow {
  playerId: number;
  playerName: string;
  playerCa: number | null;
  fromClubName: string | null;
  toClubName: string | null;
  newReleaseFee: number | null;
  signFee: number | null;
  season: number | null;
  windowSeq: number | null;
  completedAt: string | null;
}

export interface SeaComps {
  /** same_tier=同档成交（CA±5）；global=同档空时回落全局最近；none=没有参照 */
  scope: 'same_tier' | 'global' | 'none';
  rows: SeaCompRow[];
}

// ---- v0.7.1 d8：球员库（公开 /api/players，keyset 游标分页）----
// PlayerLibraryRow / LastDealInfo / PlayersLibraryResponse 已迁 src/contract/batch2.ts。

// 俱乐部目录（公开，球员库筛选下拉用）
export interface ClubDirectoryRow {
  id: number;
  name: string;
  leagueTier: string;
}

export interface AdminClubRow {
  id: number;
  name: string;
  /** CPU 队标记（v6.27.0）：true = 电脑队，可从俱乐部管理进入接管向导 */
  isCpu: boolean;
  leagueTier: string;
  status: string;
  transferBanned?: boolean;
  /** 队壳国家（v6.48.0 §10.3，FC 国家编号）：成长档位 c2 的比对基准；null = 未设，管理端提示补录 */
  country: number | null;
  countryName: string | null;
  createdAt: string;
  bindings: { userId: number; userName: string | null; boundAt: string }[];
  latestCode: { expiresAt: string | null; usedBy: number | null; usedAt: string | null; createdAt: string } | null;
}

// ---- CPU 接管向导（v6.27.0）：把电脑队转成真人可接管的俱乐部，五步一条线 ----

/** GET /api/admin/clubs/:id/cpu-convert 的接管状态（五步向导整页吃这一份） */
export interface CpuConvertState {
  club: { id: number; name: string; isCpu: boolean; leagueTier: string | null; status: string };
  /** 赛事系统对手方；查无此队时为 null（步骤 1 可跳过） */
  tour: { id: number; name: string } | null;
  /** 运营基建现状：是否有球场行 / 是否有账本 / 设施行数 */
  infra: { stadium: boolean; ledger: boolean; facilities: number };
  binding: { bound: boolean; userId: number | null; userName: string | null; boundAt: string | null };
  /** 建议值：新队名 / 队壳影响力 / 奖励分 / 定级 / 初始球迷目标 */
  suggest: { newName: string; shellInfluence: number; bonusPoints: number; leagueTier: 'premier' | 'second' | null; diehardTarget: number };
}

/** POST /api/admin/clubs/:id/rename-tour：renamed=false 表示对手方队名本就一致（幂等） */
export interface CpuRenameTourResult {
  ok: boolean;
  renamed: boolean;
  name: string;
}

/** POST /api/admin/clubs/:id/rename-local：changed=false 表示此前已摘 CPU 标（幂等，不回 name）；撞名走 409 */
export interface CpuRenameLocalResult {
  ok: boolean;
  changed: boolean;
  name?: string;
}

/** POST /api/admin/clubs/:id/seed-ops：created 是本次实际新建的部件（已存在的为 false / 0） */
export interface CpuSeedOpsResult {
  ok: boolean;
  created: { stadium: boolean; ledger: boolean; facilities: number };
  leagueTier: 'premier' | 'second';
}

// ImportPreview / ImportConfirm 已迁 src/contract/batch2.ts（ImportConfirm.replayed 按
// workerExtra 处置补抄）。

export interface OpeningImportResult {
  written: number;
  skipped: number;
}

export interface ConfigRow {
  key: string;
  value: string | null;
  secret: boolean;
}

export interface ConfigResponse {
  config: ConfigRow[];
  /** 超管=true：明文 + 可编辑（PUT /api/admin/config） */
  editable: boolean;
}

export interface AdminOverview {
  openReviews: number;
  resultQueue: number;
  activeListings: number;
  clubs: number;
  /** 待接管的电脑队数（v6.27.0） */
  cpuClubs: number;
  players: number;
  /** 待审消费工单数（v6.28.0，shop_orders.status='pending'） */
  pendingShopOrders: number;
  /** 待选事件数（v6.28.0，选择型 pending 的 event_occurrences） */
  pendingEvents: number;
  at: string;
}

export interface AuditEntryRow {
  id: number;
  actor: number | null;
  action: string;
  targetType: string;
  targetId: number | null;
  // 触发通道（v6.3.2）：'user'/'cron_tick'/'lazy_settle'/'backchannel'/'machine'；历史行为 null
  origin: string | null;
  before: string | null;
  after: string | null;
  at: string;
}

export interface AuditLogResponse {
  entries: AuditEntryRow[];
}

// ---- v0.3.0 DTO（附录 A〔2〕：注册与体检；通道 C 合同导入）----
// SquadRules / SquadIssue / SquadCompliance / SquadPlayerRow / WindowOverviewRow 原生于此节；
// 前四者已迁 src/contract/batch2.ts（v6.82.0 第 2 批），WindowOverviewRow 归批 4。

/** GET /api/admin/windows/overview（v6.69.0 期三）：关窗页实时看板逐队一行 */
export interface WindowOverviewRow {
  clubId: number;
  name: string;
  isCpu: boolean;
  tier: string | null;
  firstTeam: number;
  trainee: number;
  unsigned: number;
  wageNow: number;
  /** 关窗后工资（v6.72.3）：现行合同 + 本窗到期落地的续约/涨薪 */
  wageAfter: number;
  wageCap: number | null;
  overspend: number;
  pass: boolean;
  issues: { rule: string; message: string }[];
  pendingTransfers: number;
  activeSessions: number;
}

// SquadNumbersResponse / SquadOverview / ContractImportPreview / ContractImportConfirm
// 已迁 src/contract/batch2.ts（v6.82.0 第 2 批）。

/** GET /api/club/pending-contracts（v6.54.0 步骤 7）：球队页阵容小字的数据源。
 *  PendingContractsResponse 已迁 src/contract/batch1.ts（v6.82.0 第 1 批）。 */

export interface AdminRegistrations {
  season: number | null;
  clubs: {
    clubId: number;
    clubName: string;
    leagueTier: string | null;
    firstTeam: number;
    trainee: number;
    wageTotal: number;
    players: { playerId: number; name: string; squad: string }[];
  }[];
}

// ComplianceReport 已迁 src/contract/batch2.ts（v6.82.0 第 2 批，§6.8 补录）。

// ---- v0.4.0 DTO（附录 A〔3〕：转会市场挂牌竞价链）----

export type ListingStatus = 'listed' | 'bidding' | 'matched_pending' | 'pending_review' | 'delisted';

export type MatchPhase = 'first_bid' | 'matching' | null;

export interface MarketListing {
  id: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null };
  sellerClub: { id: number | null; name: string };
  type: string;
  askPrice: number;
  status: ListingStatus;
  listedAt: string;
  lastBidAt: string | null;
  bidPaused: boolean;
  highestBid: number | null;
  /** 领先出价方（v6.4.0 改动 5）：active 出价的俱乐部，出价历史里每单至多一条 active */
  highestBidder: { id: number; name: string } | null;
  bidCount: number;
  activatedBy: number | null;
  activationDeadline: string | null;
  matchDeadline: string | null;
  matchPhase: MatchPhase;
  firstBidPending: boolean;
  deadlineAt: string | null;
  deadlineNote: string | null;
}

export interface MarketListings {
  listings: MarketListing[];
  cursor: number | null;
}

export interface MarketListingDetail {
  marketBidPaused: boolean;
  listing: MarketListing & {
    releaseFee: number | null;
    windowOpen: boolean;
    nextMinBid: number;
    bidStepMin: number;
    activatorName: string | null;
  };
  bids: { id: number; clubId: number; clubName: string; amount: number; createdAt: string; status: string }[];
}

/** 球员转会浮层（v6.74.0 期 C，设计 §6.1）：球员页状态条 / 浮层 / 转会台行展开共用一份响应。
 *  TransferPanelResponse 已迁 src/contract/batch1.ts（v6.82.0 第 1 批；listing 不含 feed 专有
 *  bidCount、settled.wage 为 number|null，甄别 FieldDiff #1/#2 处置见契约型注）。 */

export interface ActivationResult {
  ok: boolean;
  listingId: number;
  askPrice: number;
  kind: 'trainee' | 'normal';
  firstBidDeadline: string;
}

export interface BidPlaceResult {
  ok: boolean;
  bid: { id: number; amount: number; createdAt: string };
  /** 落定后刷新的绝对截止时刻（激活首价落定即转入公开竞价，同口径刷新；存量无 listed_day 时为 null） */
  deadlineAt: string | null;
  /** 激活单落首价后的去向（v6.24.0）：bidding = 已转入公开竞价，截止后由结算按合同类型分流 */
  matchPhase?: 'bidding';
}

export interface MyBidRow {
  id: number;
  listingId: number;
  amount: number;
  createdAt: string;
  status: string;
  holdStatus: 'held' | 'released' | 'settled' | null;
  listingStatus: ListingStatus;
  askPrice: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; ca: number | null; pa: number | null };
  sellerClubName: string;
}

/** 转会台待办汇总（v6.73.0 期 B）：导航角标 / 桌内待办条共用；未绑队全 0。
 *  DeskSummary 已迁 src/contract/batch1.ts（v6.82.0 第 1 批）。 */

export interface AdminReviewRow {
  id: number;
  kind: string;
  status: string;
  payload: Record<string, unknown> | null;
  note: string | null;
  decidedAt: string | null;
  // 激活举报核查任务（v6.4.0 改动 4）；transfer_confirm 行为 null
  report: { listingId: number | null; listingStatus: string | null; askPrice: number | null; proofKey: string | null; activatorClubName: string | null; activatorClubId: number | null } | null;
  transfer: {
    id: number;
    type: string;
    status: string;
    fee: number | null;
    tax: number | null;
    extraFee: number | null;
    player: { id: number; fcId: number | null; name: string; position: string | null; ca: number | null; pa: number | null };
    fromClubName: string | null;
    toClubName: string | null;
    fromClubId: number | null;
    toClubId: number | null;
  };
}

export interface AdminReviews {
  reviews: AdminReviewRow[];
}

/** 批量批准 / 驳回的逐条结果（v6.68.0 期 B）：一条失败不影响其它。 */
export interface AdminReviewBatchResult {
  ok: boolean;
  results: { id: number; ok: boolean; error?: string }[];
}

// ---- 审核工作台（v6.68.2 期 C） ----
// 五张在途表一次取全：Workbench* 九型已迁 src/contract/batch1.ts（v6.82.0 第 1 批，
// worker 内部名 ↔ 契约名别名对应见契约文件）。

/** 转会单类型（与 src/worker 侧 transfer.type 取值一致；v6.67.0 由 string 收紧为联合类型） */
export type TransferType =
  | 'transfer'
  | 'free_agent'
  | 'match'
  | 'forced_auction'
  | 'rc_change'
  | 'promotion'
  | 'termination';

export interface NegotiationSession {
  id: number;
  transferId: number;
  status: 'active' | 'settled' | 'cancelled';
  transfer: { type: TransferType; status: string; fee: number | null };
  fromClubName: string | null;
  toClubName: string | null;
  player: { id: number; fcId: number | null; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null };
  agentTier: number;
  agentTierLabel: string;
  releaseFee: number | null;
  rcBounds: [number, number] | null;
  expectedWage: number | null;
  attemptsUsed: number;
  remaining: number;
  // v6.65.2：静默作废时刻（后端按 anchor + negotiation_silence_hours 算好），卡头倒计时用
  expiresAt: string | null;
  lastSatisfaction: string | null;
  lastRisk: boolean;
  attempts: { attemptNo: number; offeredWage: number; result: string; at: string; feedback: string | null }[];
  settled: { wage: number | null; source: string; message: string } | null;
  // v6.65.4 已结束区：结束时间 / 结局 / 作废原因（进行中的会话三项都是 null，attempts 也只给进行中）
  endedAt: string | null;
  outcome: 'signed' | 'void' | null;
  voidReason: string | null;
}

// GET /api/negotiations?mine=1 的响应（v6.65.4 起进行中与已结束分开）：
// sessions = 进行中全量；ended = 已结束一页（默认 10 条，按结束时间倒序）；endedNextBefore = 下一页游标
export interface MyNegotiations {
  sessions: NegotiationSession[];
  ended: NegotiationSession[];
  endedNextBefore: number | null;
}

// 工资预览（v6.40.0）：POST /api/negotiations/:sessionId/preview 的响应。只读——不落库、不耗轮次、
// 不写审计。WageForecast 已迁 src/contract/batch1.ts（v6.82.0 第 1 批，E 类双用：签约谈判
// preview 与 demand 还价档位 preview 同形合一，见契约型注）。

export interface ReleaseFeeResult {
  ok: boolean;
  releaseFee: number;
  expectedWage: number;
}

export interface OfferResult {
  result: 'success' | 'fail' | 'direct' | 'forced';
  attemptNo: number;
  remaining: number;
  wage?: number;
  satisfaction?: string;
  risk?: boolean;
  message?: string;
}

export interface TraineeSignResult {
  ok: boolean;
  result: 'trainee';
  wage: number;
  message: string;
}

// ---- v6.54.0 球员要求（闹涨薪）：GET /api/club/contract-demands ----
// 收件箱八型已迁 src/contract/batch1.ts（v6.82.0 第 1 批；worker 内部名 DemandCard /
// ClubDemandInbox 等的别名对应见契约文件）。金额单位 m；expected_wage 刻意不下发
// （界面只说「市场价」，§2.1），floor 下发（本队教练还价防呆需要）。

// ---- v0.6.0 DTO（附录 A〔5〕：旁路转会 + 匹配 + 窗口 + 强制拍卖）----

// ---- v6.18.0：市场情报（传闻 / 已达成交易 / 海捞资格 / 激活球员）----
// v6.17.0 的 /api/market/sea-signs、cpu-board、trainees 三个端点已退役：成交情报迁进 /market/intel
// （rumors + deals），可激活名单换成 /api/market/activatable，海捞资格查询走 /api/market/sea-lookup。
// 更早的 FreeAgentRow/FreeAgentsResponse 已随 /api/market/free-agents 下线，别再复活。

/** 转会传闻（GET /api/market/rumors，公开）：系统按窗口派生，真真假假，不下发真假字段 */
export interface RumorItem {
  id: string;
  text: string;
  playerId: number;
  playerName: string;
  clubName: string;
}

export interface RumorsResponse {
  rumors: RumorItem[];
}

/** 已达成交易行（GET /api/market/deals，公开，completed_at 倒序 ≤50 条） */
export interface MarketDealsRow {
  id: number;
  type: string;
  playerId: number;
  playerName: string;
  /** 原东家；null = 无归属（真自由身） */
  fromClubName: string | null;
  /** 去向；null = 球员去自由身 */
  toClubName: string | null;
  /** 金额语义随 type：transfer/activation/forced_auction=成交价；free_agent/rc_change/match=新违约金；termination=0（前端显示 —） */
  fee: number | null;
  /** 附加销毁费（如匹配差额回收） */
  extraFee: number | null;
  season: number | null;
  windowSeq: number | null;
  completedAt: string | null;
}

export interface MarketDealsResponse {
  deals: MarketDealsRow[];
}

/**
 * 转会广告板行（GET /api/market/transfer-board，公开，v6.31.0）：只收 `players.transfer_listed = 1`。
 * 与 /api/players 列表的差别：这里**下发公开标价数值 listPrice**（v6.33.0；最低报价转全系统私密），并带着重度与挂出时间。
 */
export interface TransferBoardRow {
  id: number;
  uid: string;
  fcId: number | null;
  name: string;
  positions: string[];
  age: number | null;
  ca: number;
  pa: number;
  clubId: number | null;
  // v6.64.2：端点已排除无东家的球员（club_id 为空不进名单），但类型必须照真实载荷写——
  // 旧类型声明的 string 让「队名 null」骗过了 typecheck，直接在 TeamLogo 里抛错白屏。
  clubName: string | null;
  /** 挂牌队的 R2 队徽 key（v6.32.0；无徽 null → TeamLogo 回落队名哈希色块） */
  logoKey: string | null;
  listPrice: number | null;
  /** 现行合同违约金（无合同 → null，显示「—」） */
  releaseFee: number | null;
  /** 进入转会名单的时刻（历史存量未回填 → null） */
  listedAt: string | null;
  /** 着重度现行最高档：0 普通 / 1 推荐 / 2 置顶（付费流程预留，本版只读） */
  emphasis: 0 | 1 | 2;
  /** 置顶到期时刻（仅 emphasis = 2 有） */
  emphasisUntil: string | null;
  status: string;
  notForSale: boolean;
  transferPriced: boolean;
}

export interface TransferBoardResponse {
  players: TransferBoardRow[];
  /** 转会名单总人数（可能大于 players.length），用于「查看全部 N 人」与截断提示 */
  total: number;
}

/** 海捞资格查询行（GET /api/market/sea-lookup，教练：ID 点查或名字 LIKE，≤8 条） */
export interface SeaLookupRow {
  id: number;
  fcId: number | null;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  clubName: string | null;
  seaSign: { eligible: boolean; reason: string | null };
}

export interface SeaLookupResponse {
  results: SeaLookupRow[];
}

/** 可激活球员行（GET /api/market/activatable，教练：外队球员 CA 降序 ≤100 条） */
export interface ActivatablePlayer {
  id: number;
  fcId: number | null;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  status: string;
  club: { id: number; name: string };
  contractType: 'formal' | 'trainee';
  /** 激活费：训练营固定 5m，正式球员按违约金与保护期计；正式合同缺违约金时为 null（不可激活） */
  activationFee: number | null;
  activatedThisWindow: boolean;
  /** 刚签约（服务刻度内）：本窗不能被激活 */
  justSigned: boolean;
}

export interface ActivatableResponse {
  club: { id: number; name: string } | null;
  players: ActivatablePlayer[];
}

export interface RcChangeResult {
  ok: boolean;
  transferId: number;
  oldReleaseFee: number;
  newReleaseFee: number;
  changeFee: number;
  /** v6.62.0 §5.6：本次走了免费通道（提价免差额、保护期不变；降价也置 true） */
  freeRcChange?: boolean;
}

export interface TerminationResult {
  ok: boolean;
  transferId: number;
  terminationFee: number;
}

export interface FreeAgentResult {
  ok: boolean;
  transferId: number;
  newReleaseFee: number;
  signFee: number;
}

export interface MatchDecisionResult {
  ok: boolean;
  decision: 'match' | 'pass';
  newReleaseFee?: number;
  diff?: number;
}

export interface WindowRow {
  season: number;
  windowSeq: number;
  status: string;
  /** v3.0.0：临时窗（效力与工资不推进、不收冠名费；维护费按本窗主场数照收） */
  isTemporary: boolean;
  openedAt: string | null;
  closedAt: string | null;
}

export interface WindowsResponse {
  seasons: { season: number; status: string }[];
  windows: WindowRow[];
}

export interface OpenWindowResult {
  ok: boolean;
  season: number;
  windowSeq: number;
  /** v3.0.0：本次开的是临时窗 */
  isTemporary: boolean;
  rerolled: number;
  /** 开窗时勾选了「同时宣告新成长期」 */
  growthPeriodDeclared: boolean;
}

export interface CloseWindowResult {
  ok: boolean;
  season: number;
  windowSeq: number;
  /** v3.0.0：本次关的是临时窗 */
  isTemporary: boolean;
  /** 忠诚支出（v6.47.0 起为俱乐部扣款）：count = 人次数、total = 扣款金额绝对值（正数） */
  loyalty: { count: number; total: number };
  forceSettled: number;
}

/** 强制拍卖人选参考值（v6.51.0：队内非门将 CA 前六只作参考，不再强制） */
export interface ForcedAuctionReference {
  playerId: number;
  /** EA 球员 ID（球员页 URL 上的号）；可能为空 */
  fcId: number | null;
  playerName: string;
  clubId: number | null;
  clubName: string | null;
  position: string | null;
  ca: number | null;
  /** 门将（前六参考口径不含门将） */
  isGk: boolean;
  /** 队内非门将 CA 排名（并列取并列最优名次）；门将 / 缺 CA 为 null */
  caRank: number | null;
  /** 队内非门将第六名的 CA（前六参考线）；有 CA 的非门将不足六人为 null */
  topSixLine: number | null;
  /** 是否落在队内非门将 CA 前六（参考值，不强制）；门将 / 缺 CA 为 null */
  inTopSix: boolean | null;
  /** 队内有 CA 的非门将人数 */
  nonGkWithCa: number;
}

export interface ForcedAuctionBlocker {
  status: number;
  message: string;
  errCode?: string;
}

/** GET /api/admin/forced-auctions/preview：人选参考 + 现在挂出会被拒的原因 */
export interface ForcedAuctionPreview {
  reference: ForcedAuctionReference;
  blockers: ForcedAuctionBlocker[];
}

export interface ForcedAuctionResult {
  ok: boolean;
  listingId: number;
  askPrice: number;
  reference: ForcedAuctionReference;
}

// ---- v0.7.0 DTO（附录 A〔6〕：财政/赛季/赛果/成长/通知/监管）----

export interface ClubBalance {
  club: { id: number; name: string } | null;
  balance: number | null;
  held: number | null;
  available: number | null;
  /** 在途卖人收入（税后净额，未乘 k；v6.57.0 起随余额端点下发） */
  expectedIncome: number | null;
  /** 预期收入额度 = expectedIncome × k（已含在 available 里，展示拆解用） */
  creditLine: number | null;
  /** v6.64.0：被激活挂牌在途税后净额（未乘 k，expectedIncome 的组成部分） */
  activationIncome?: number | null;
  /** v6.64.0：activationIncome × k（「其中被激活挂牌」展示口径，与 creditLine 同层真部分和） */
  activationCredit?: number | null;
}

// 账本 / 券流水 / 财务汇总 / M0 / 主场战报 / 收件篮 / 候选名单 / 球场建设 / 冠名市场 / 招商轮 /
// 场馆经营 / 天气预报 / 消费中心各型已迁 src/contract/batch3.ts（v6.82.0 第 3 批，见顶部 re-export 区；
// FieldDiff 处置见契约型注）。ManualLedgerKind / MANUAL_LEDGER_KINDS 是 viewmodel（前端奖金模板
// 下拉常量）按口径 7① 留守本文件；NotifyRef / NotifyCategoryId 是共享 core 单源
// （core/notify-meta.ts），本文件已无本地引用，契约 batch3.ts 按名 import 同源（口径 7②）。

/** 随机事件（v6.10.0，D 块）：池只读启停 + 管理端触发 + 流水 */
export interface AdminEventPoolRow {
  id: number;
  event_id: string;
  name: string;
  category: string;
  weight: number;
  /** instant = 触发即结算；choice = 选项型（v6.11.0 开放） */
  event_type: string;
  conditions_json: string;
  effects_json: string;
  options_json: string | null;
  soft_conditions: number;
  template: string;
  source: string;
  /** adopted | discarded */
  status: string;
  created_at: string;
}

export interface AdminEventOccurrence {
  id: number;
  club_id: number;
  club_name: string | null;
  season: number;
  window_seq: number;
  event_id: string;
  event_name: string;
  event_type: string;
  /** pending | resolved */
  status: string;
  effects_json: string;
  notes_json: string | null;
  choice_no: number | null;
  deadline_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  text: string | null;
  created_at: string;
}

export interface AdminEventTriggeredRow {
  occurrenceId: number;
  clubId: number;
  clubName: string;
  eventId: string;
  eventName: string;
  /** instant | choice（v6.11.0 起选择型也可点名触发） */
  eventType?: string;
  /** 选择型的选定时限（ISO；不设时限为 null） */
  deadlineAt?: string | null;
  text: string;
  notes: string[];
  effects: Record<string, unknown>;
}

export interface AdminEventTriggerResult {
  season: number;
  windowSeq: number;
  /** 参与掷点的队数 */
  clubs: number;
  /** 实际触发条数 */
  triggered: number;
  /** 掷中但没有候选可用（条件全挡、已达单事件上限或待选事件已满）的队数 */
  capped: number;
  events: AdminEventTriggeredRow[];
}

/** LLM 草稿工坊（v6.12.0，D3）：生成 → 审校修订 → 采纳进池 / 废弃 */
export interface LlmStatus {
  configured: boolean;
}

/** struct 草稿 / 自定义事件的规范化结构（数值已过 clampEventDraft 钳制） */
export interface EventDraftStruct {
  event_id: string;
  name: string;
  category: string;
  weight: number;
  event_type: 'instant' | 'choice';
  conditions: Record<string, unknown>;
  effects: Record<string, unknown>;
  options: { no: number; name: string; desc: string; outcomes: { w: number; effects: Record<string, unknown> }[] }[];
  template: string;
}

export interface AdminEventDraft {
  id: number;
  /** text = 改写现有事件文案；struct = 新事件结构草稿 */
  kind: string;
  payload_json: string;
  payload: unknown;
  source_event_id: string | null;
  note: string;
  /** draft | adopted | discarded */
  status: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface LlmDraftResult {
  id: number;
  kind: string;
  payload: unknown;
  adjustments: string[];
}

export interface EventDraftAdoptResult {
  id: number;
  kind: string;
  /** text = 被改写的事件 event_id；struct = 新入池事件的 event_id */
  target: string;
}

/** 玩家侧随机事件（v6.11.0，D2）：待选 + 近期已结算 */
export interface ClubEventOptionOutcome {
  w: number;
  effects: Record<string, unknown>;
}

export interface ClubEventOption {
  no: number;
  name: string;
  desc: string;
  outcomes: ClubEventOptionOutcome[];
}

export interface ClubEventPending {
  id: number;
  eventId: string;
  eventName: string;
  /** 选定时限（ISO；null = 不设时限、不会自动兜底） */
  deadlineAt: string | null;
  text: string;
  options: ClubEventOption[];
}

export interface ClubEventRecent {
  id: number;
  eventId: string;
  eventName: string;
  eventType: string;
  choiceNo: number | null;
  optionName: string;
  /** true = 超时/无效选项号按最差结果兜底 */
  auto: boolean;
  skipped: boolean;
  effects: Record<string, unknown>;
  notes: string[];
  text: string;
  resolvedBy: string;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ClubEventsResponse {
  clubId: number;
  pending: ClubEventPending[];
  recent: ClubEventRecent[];
}

export interface ClubEventChooseResult {
  event: {
    id: number;
    eventId: string;
    eventName: string;
    optionNo: number | null;
    optionName: string;
    auto: boolean;
    effects: Record<string, unknown>;
    notes: string[];
    text: string;
  };
}

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

export interface SeasonBinding {
  id: number;
  tournamentId: number;
  competitionType: string | null;
  stageSettledAt?: string | null;
}

export interface SeasonCurrent {
  season: { season: number; status: string } | null;
  window: {
    season: number;
    windowSeq: number;
    status: string;
    openedAt: string | null;
    closedAt: string | null;
  } | null;
  tournaments: SeasonBinding[];
}

export interface SeasonRow {
  season: number;
  status: string;
  ageCap?: number | null;
}

export interface SeasonsResponse {
  seasons: SeasonRow[];
}

export interface SeasonBindingsResponse {
  bindings: SeasonBinding[];
}

export interface TournamentRow {
  id: number;
  name: string;
  status: string;
}

export interface BindTournamentResult {
  ok: boolean;
  tournament: { id: number; name: string };
}

export interface SettleCheckResult {
  ok: boolean;
  season: number;
  blockers: string[];
  warnings: string[];
}

export interface SeasonSettleResult {
  ok: boolean;
  growable: number;
  warnings: string[];
}

export interface StageSettleResult {
  ok: boolean;
  items: number;
}

export interface ResultQueueRow {
  matchId: number;
  season: number;
  windowSeq: number;
  competitionType: string | null;
  stageName: string | null;
  round: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  penHome: number | null;
  penAway: number | null;
  walkoverSide: string | null;
  winnerTeam: string | null;
  finishedAt: string | null;
}

export interface ConfirmedResultRow {
  id: number;
  matchId: number;
  season: number;
  windowSeq: number;
  competitionType: string | null;
  stageName: string | null;
  round: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  winnerTeam: string | null;
  confirmedAt: string;
  needsReview: boolean;
  reviewNote: string | null;
}

export interface ResultsQueue {
  queue: ResultQueueRow[];
  confirmed: ConfirmedResultRow[];
}

export interface ConfirmResultResult {
  ok: boolean;
  result: ConfirmedResultRow;
  /**
   * 确认钩子自动记的成长事件（v6.52.0 起非成长球员的事件照记但 XP 为 0 ⇒ granted 只代表
   * 「新入账的成长事件条数」，不再宣称 XP 条数）；unresolved=没匹配上的俱乐部/球员名（补录用）
   */
  xp: { granted: number; unresolved: string[] };
}

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

// v6.29.0：intent = 意向单（关窗期双方谈成，资金继续冻结；开窗后由卖方确认才物化挂牌）
export type OfferStatus = 'pending' | 'intent' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

export interface OfferListItem {
  id: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; ca: number | null; pa: number | null; listPrice: number | null };
  counterpart: { id: number; name: string };
  role: 'buyer' | 'seller';
  amount: number;
  initAmount: number;
  round: number;
  note: string | null;
  status: OfferStatus;
  turn: 'buyer' | 'seller';
  myTurn: boolean;
  listingId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OffersListResponse {
  club: { id: number; name: string };
  box: 'in' | 'out';
  items: OfferListItem[];
  nextCursor: string | null;
  /** 轮到我表态的条数（球员页「我收到的报价」入口徽标用） */
  pendingMine: number;
  /** v6.29.0：我是卖方、等我确认挂牌（或放弃）的意向单条数 */
  intentsMine: number;
}

export interface OfferEventRow {
  kind: string;
  amount: number | null;
  note: string | null;
  at: string;
  actor: { id: number; name: string } | null;
}

export interface OfferDetailResponse {
  offer: OfferListItem & {
    buyerClub: { id: number; name: string };
    sellerClub: { id: number; name: string };
    season: number;
    windowSeq: number;
    resolvedAt: string | null;
  };
  events: OfferEventRow[];
}

/* ---------- 运营时刻表（v6.49.0） ---------- */

export type OpsStartAnchor = 'none' | 'window_open' | 'absolute';
export type OpsEndAnchor = 'none' | 'window_close' | 'absolute';
export type OpsState = 'unrestricted' | 'not_started' | 'open' | 'closed';

export interface OpsStatusRow {
  key: string;
  label: string;
  group: string;
  desc: string;
  startAnchor: OpsStartAnchor;
  startAt: string | null;
  endAnchor: OpsEndAnchor;
  endAt: string | null;
  requiresWindow: boolean;
  closeInflight: boolean;
  note: string;
  state: OpsState;
  stateLabel: string;
  /** 解析后的起点（随窗锚 = 窗口 openedAt）；没开窗时为 null */
  resolvedStartAt: string | null;
  /** 解析后的终点；endIsWindowClose=true 时为 null（动态边界，关窗即止） */
  resolvedEndAt: string | null;
  endIsWindowClose: boolean;
}

export interface OpsScheduleView {
  now: string;
  window: { openedAt: string; closedAt: string | null } | null;
  rows: OpsStatusRow[];
}

export interface OpsSaveResult {
  ok: true;
  row: OpsStatusRow;
}

/* ---------- 海捞两阶段·暗标段（v6.50.0） ---------- */

export type SeaBatchStatus = 'sealed' | 'settling' | 'opened' | 'cancelled';
export type SeaBidStatus = 'sealed' | 'won' | 'lost' | 'void' | 'withdrawn';

/** 我的密封标（金额保密：只有出标方自己看得到；开标胜出后随公示公开） */
export interface SeaBidDto {
  playerId: number;
  playerName: string;
  newReleaseFee: number;
  status: SeaBidStatus;
  voidReason: string;
  updatedAt: string | null;
}

/** 开标公示行（谁以多少胜出） */
export interface SeaWinnerDto {
  playerId: number;
  playerName: string;
  clubId: number;
  clubName: string;
  amount: number;
}

export interface SeaBatchDto {
  id: number;
  season: number;
  windowSeq: number;
  status: SeaBatchStatus;
  sealedAt: string | null;
  deadlineAt: string;
  openedAt: string | null;
}

/** GET /api/transfers/sea-sealed：state off=未启用 / none=不在暗标段 / sealed=收标中 / closing=已截止等开标 / open=已开标 */
export interface SeaPhaseView {
  enabled: boolean;
  state: 'off' | 'none' | 'sealed' | 'closing' | 'open';
  batch: SeaBatchDto | null;
  myBids: SeaBidDto[];
  results: SeaWinnerDto[];
}

export interface SeaSubmitResult {
  ok: true;
  bidId: number;
  playerId: number;
  newReleaseFee: number;
  signFee: number;
  /** 本次是改标（原冻结已刷新）还是首标 */
  updated: boolean;
}

export interface SeaOpenSummary {
  ok: true;
  batchId: number;
  already: boolean;
  won: number;
  lost: number;
  voided: number;
}

export interface SeaExtendResult {
  ok: true;
  batch: { id: number; season: number; windowSeq: number; status: SeaBatchStatus; deadlineAt: string; note: string };
}

/** 取消本窗批次：全部标作废 + 冻结解冻 */
export interface SeaCancelResult {
  ok: true;
  voided: number;
}

export interface SeaAdminBidRow {
  bidId: number;
  playerId: number;
  playerName: string;
  clubId: number;
  clubName: string;
  newReleaseFee: number;
  status: SeaBidStatus;
  holdStatus: string | null;
  voidReason: string;
  submittedAt: string | null;
  updatedAt: string | null;
}

/** GET /api/admin/sea-sealed：逐标明账（管理端看得到金额与出标方，教练侧看不到） */
export interface SeaAdminView {
  enabled: boolean;
  batch: (SeaBatchDto & { note: string; remindedAt: string }) | null;
  bids: SeaAdminBidRow[];
  summary: { players: number; bids: number; clubs: number; top: number };
}
