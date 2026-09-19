// API 约定（附录 A）：错误统一 {error, code?}；前端消费的 DTO 在此层冻结
export interface MeUser {
  id: number;
  name: string;
  role: 'admin' | 'coach' | 'viewer';
  locked: boolean;
  mustChangePw: boolean;
  /** 权限点随 /api/me 原样下发（增量 15）：超管凭 club.config.manage.super 判定 */
  permissions?: string[];
}

/** 超管独立权限点（与 src/lib/session.ts 保持一致）：平台参数全开 */
export const SUPER_ADMIN_PERM = 'club.config.manage.super';

export function isSuperAdmin(user: MeUser | null | undefined): boolean {
  return Boolean(user?.permissions?.includes(SUPER_ADMIN_PERM));
}

/** 登录入口模式（统一认证步骤②）：oidc=认证中心，shared=赛事系统共享会话（旧行为） */
export type AuthMode = 'oidc' | 'shared';

export interface MeResponse {
  user: MeUser | null;
  authMode: AuthMode;
  /** 认证中心地址（OIDC 模式才有；改密等引导直链用） */
  authHome?: string | null;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  /** 422 校验类错误的明细（如注册合规 issues），由响应体透传 */
  issues?: SquadIssue[];

  constructor(status: number, message: string, code?: string, issues?: SquadIssue[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? '请求失败', body?.code);
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
    throw new ApiError(res.status, data?.error ?? '请求失败', data?.code, Array.isArray(data?.issues) ? data.issues : undefined);
  }
  return data as T;
}

export const apiPost = <T,>(path: string, body?: unknown) => apiSend<T>('POST', path, body);
export const apiPut = <T,>(path: string, body?: unknown) => apiSend<T>('PUT', path, body);
export const apiPatch = <T,>(path: string, body?: unknown) => apiSend<T>('PATCH', path, body);
export const apiDelete = <T,>(path: string, body?: unknown) => apiSend<T>('DELETE', path, body);

export const TOUR_SITE_URL = 'https://whleague.win/';

// ---- 增量 1 DTO（附录 A〔1〕）----

export interface ClubDto {
  id: number;
  name: string;
  leagueTier: string;
  status: string;
  createdAt?: string;
}

export interface MyClubOverview {
  club: { id: number; name: string; leagueTier: string | null; logoKey: string | null; status: string; transferBanned?: boolean } | null;
  balance: number | null;
  squadCount: number | null;
  window: { season: number; windowSeq: number } | null;
  // 增量 12：主场档案（球场/设施/影响力构成）；无球场行 = null
  home: StadiumInfo | null;
}

export interface StadiumInfo {
  name: string | null;
  namingBrand: string | null;
  capacity: number;
  tier: number;
  tierName: string | null;
  fans: number;
  influence: { players: number; shell: number; bonus: number; total: number };
  facilities: { key: string; level: number }[];
}

// 增量 12：管理端球场档案（GET /clubs/:id/stadium）
export interface StadiumAdmin {
  stadium: { clubId: number; name: string | null; capacity: number; tier: number; shellInfluence: number; bonusPoints: number; fans: number };
  tier: { name: string; min_seats: number; max_seats: number; base_maintenance: number; per_10k_rate: number; attend_coef: number; upgrade_cost: number } | null;
  facilities: { key: string; level: number }[];
  influence: { players: number; shell: number; bonus: number; total: number };
}

export interface PlayerListItem {
  id: number;
  uid: string;
  name: string;
  clubId: number | null;
  position: string | null;
  age: number | null;
  ca: number;
  pa: number;
  prestige: number | null;
  marketValue: number | null;
  status: string;
  growthTier: number;
  isFutureStar: boolean;
  chinaPlan: boolean;
  agentTier: number;
  badgesSilver: number;
  badgesGold: number;
}

export interface ContractDto {
  id: number;
  clubId: number | null;
  releaseFee: number | null;
  wage: number | null;
  contractType: string;
  source: string | null;
  signedAt: string | null;
  effectiveFrom: string | null;
  protectedUntil: string | null;
}

export interface PlayerDetail {
  player: PlayerListItem & {
    foot: number;
    growable: boolean;
    growthXp: number;
    gameAttrs: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  };
  club: { id: number; name: string } | null;
  contract: ContractDto | null;
}

// ---- 增量 6.1 d8：球员库（公开 /api/players，keyset 游标分页）----

export interface PlayerLibraryRow extends PlayerListItem {
  growable: boolean;
  clubName: string | null;
  // 增量 17：多位置槽（PosID1-4 槽位序去重）、球员影响力（规则 4.1.3 现值口径）、现行合同速览
  positions: string[];
  influence: number;
  wage: number | null;
  releaseFee: number | null;
  contractType: string | null;
  // 增量 17 列联动：筛什么就带什么字段回来（foot/baseCa/fcId 恒回，attrValue 只在 attr 筛选时出现）
  foot: number;
  baseCa: number | null;
  fcId: number | null;
  source: string | null;
  protectedUntil: string | null;
  effectiveFrom: string | null;
  attrValue?: number;
  // ps 筛选时带回的 PSID1-15 槽位原值（长度 15、缺槽 null；金徽=基础 ID+100，金槽 13+）
  psIds?: (number | null)[];
}

export interface PlayersLibraryResponse {
  players: PlayerLibraryRow[];
  total: number;
  nextCursor: string | null;
}

// 俱乐部目录（公开，球员库筛选下拉用）
export interface ClubDirectoryRow {
  id: number;
  name: string;
  leagueTier: string;
}

export interface AdminClubRow {
  id: number;
  name: string;
  leagueTier: string;
  status: string;
  transferBanned?: boolean;
  createdAt: string;
  bindings: { userId: number; userName: string | null; boundAt: string }[];
  latestCode: { expiresAt: string | null; usedBy: number | null; usedAt: string | null; createdAt: string } | null;
}

export interface ImportPreview {
  channel: 'A' | 'B';
  stats: { total: number; valid: number; error: number; insertEstimate: number; updateEstimate: number };
  errors: { row: number; field: string; message: string }[];
  samples: {
    fcId: number;
    uid: string;
    name: string;
    ca: number;
    pa: number;
    age: number | null;
    foot: number;
    position: string | null;
    prestige: number | null;
    chinaPlan: boolean;
    futureStar: boolean;
  }[];
}

export interface ImportConfirm {
  written: number;
  insertedEstimate: number;
  updatedEstimate: number;
  batches: number;
  channel: 'A' | 'B';
}

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
  players: number;
  at: string;
}

export interface AuditEntryRow {
  id: number;
  actor: number | null;
  action: string;
  targetType: string;
  targetId: number | null;
  before: string | null;
  after: string | null;
  at: string;
}

export interface AuditLogResponse {
  entries: AuditEntryRow[];
}

// ---- 增量 2 DTO（附录 A〔2〕：注册与体检；通道 C 合同导入）----

export interface SquadRules {
  squadMin: number;
  squadMax: number;
  gkMin: number;
  traineeMax: number;
  wageCap: number | null;
  limits: { ge90: number; ge87: number; growthPa87: number };
  tier: 'premier' | 'second' | null;
}

export interface SquadIssue {
  rule: string;
  message: string;
  playerIds: number[];
}

export interface SquadCompliance {
  pass: boolean;
  issues: SquadIssue[];
  stats: {
    firstTeam: number;
    trainee: number;
    goalkeepers: number;
    ge90: number;
    ge87: number;
    growthPa87: number;
    wageTotal: number;
  };
}

export interface SquadPlayerRow {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  growable: boolean;
  isFutureStar: boolean;
  chinaPlan: boolean;
  status: string;
  marketValue: number | null;
  wage: number | null;
  releaseFee: number | null;
  contractType: string | null;
  hasContract: boolean;
  squad: 'first_team' | 'trainee' | null;
}

export interface SquadOverview {
  club: { id: number; name: string; leagueTier: string | null } | null;
  season: number | null;
  // 报名状态探测（增量 9）：true=已报定级赛事（leagueTier 非空）；false=未报名，提交会被 400 拦下
  registeredInTournament: boolean;
  players: SquadPlayerRow[];
  registration: { firstTeam: number[]; trainee: number[] } | null;
  compliance: SquadCompliance | null;
  rules: SquadRules | null;
}

export interface RegistrationResult {
  ok: boolean;
  season: number;
  firstTeam: number;
  trainee: number;
  wageTotal: number;
}

export interface ContractImportPreview {
  channel: 'C';
  clubId: number;
  stats: { total: number; valid: number; error: number; insertEstimate: number; updateEstimate: number };
  errors: { row: number; field: string; message: string }[];
  samples: {
    uid: string;
    playerName: string | null;
    releaseFee: number;
    wage: number;
    contractType: string;
    effectiveFrom: string;
    outcome: 'create' | 'update' | 'claim';
  }[];
}

export interface ContractImportConfirm {
  written: number;
  insertedEstimate: number;
  updatedEstimate: number;
  batches: number;
  channel: 'C';
  clubId: number;
}

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

export interface ComplianceReport {
  season: number | null;
  clubs: {
    clubId: number;
    clubName: string;
    leagueTier: string | null;
    pass: boolean;
    issues: SquadIssue[];
    stats: SquadCompliance['stats'] | null;
  }[];
}

// ---- 增量 3 DTO（附录 A〔3〕：转会市场挂牌竞价链）----

export type ListingStatus = 'listed' | 'bidding' | 'matched_pending' | 'pending_review' | 'delisted';

export type MatchPhase = 'first_bid' | 'matching' | null;

export interface MarketListing {
  id: number;
  player: { id: number; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null };
  sellerClub: { id: number; name: string };
  type: string;
  askPrice: number;
  status: ListingStatus;
  listedAt: string;
  lastBidAt: string | null;
  bidPaused: boolean;
  highestBid: number | null;
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

export interface ActivatableTrainee {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  club: { id: number; name: string };
  activationFee: number;
  activatedThisWindow: boolean;
}

export interface TraineesResponse {
  club: { id: number; name: string } | null;
  trainees: ActivatableTrainee[];
}

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
  /** 激活单落首价后的去向：review=训练营直进待审，matching=正式合同进 24h 匹配窗 */
  matchPhase?: 'review' | 'matching';
  matchDeadline?: string | null;
  settledForReview?: boolean;
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
  player: { id: number; name: string; position: string | null; ca: number | null; pa: number | null };
  sellerClubName: string;
}

export interface TransferDetail {
  transfer: {
    id: number;
    type: string;
    status: string;
    player: { id: number; name: string };
    fromClub: { id: number; name: string } | null;
    toClub: { id: number; name: string } | null;
    fee: number | null;
    tax: number | null;
    extraFee: number | null;
    matched: boolean;
    season: number | null;
    windowSeq: number | null;
    createdAt: string | null;
    completedAt: string | null;
  };
}

export interface AdminReviewRow {
  id: number;
  status: string;
  payload: Record<string, unknown> | null;
  note: string | null;
  decidedAt: string | null;
  transfer: {
    id: number;
    type: string;
    status: string;
    fee: number | null;
    tax: number | null;
    extraFee: number | null;
    player: { id: number; name: string; position: string | null; ca: number | null; pa: number | null };
    fromClubName: string | null;
    toClubName: string | null;
  };
}

export interface AdminReviews {
  reviews: AdminReviewRow[];
}

export interface ReviewDecisionResult {
  ok: boolean;
  status: 'completed' | 'signing' | 'already' | 'rejected';
}

export interface NegotiationSession {
  id: number;
  transferId: number;
  status: 'active' | 'settled' | 'cancelled';
  transfer: { type: string; status: string; fee: number | null };
  fromClubName: string | null;
  toClubName: string | null;
  player: { id: number; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null };
  agentTier: number;
  agentTierLabel: string;
  releaseFee: number | null;
  rcBounds: [number, number] | null;
  expectedWage: number | null;
  attemptsUsed: number;
  remaining: number;
  lastSatisfaction: string | null;
  lastRisk: boolean;
  attempts: { attemptNo: number; offeredWage: number; result: string }[];
  settled: { wage: number | null; source: string; message: string } | null;
}

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

// ---- 增量 5 DTO（附录 A〔5〕：旁路转会 + 匹配 + 窗口 + 强制拍卖）----

export interface FreeAgentRow {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  /** 现东家（增量 14：CPU 队球员可被海捞，名单里要能看出他为什么在海捞池） */
  clubName: string | null;
  bannedThisWindow: boolean;
}

export interface FreeAgentsResponse {
  club: { id: number; name: string } | null;
  freeAgents: FreeAgentRow[];
}

export interface RcChangeResult {
  ok: boolean;
  transferId: number;
  oldReleaseFee: number;
  newReleaseFee: number;
  changeFee: number;
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
  rerolled: number;
  /** 开窗时勾选了「同时宣告新成长期」 */
  growthPeriodDeclared: boolean;
}

export interface CloseWindowResult {
  ok: boolean;
  season: number;
  windowSeq: number;
  forceSettled: number;
}

export interface ForcedAuctionResult {
  ok: boolean;
  listingId: number;
  askPrice: number;
}

// ---- 增量 6 DTO（附录 A〔6〕：财政/赛季/赛果/成长/通知/监管）----

export interface ClubBalance {
  club: { id: number; name: string } | null;
  balance: number | null;
  held: number | null;
  available: number | null;
}

export interface LedgerEntryRow {
  id: number;
  kind: string;
  amount: number;
  balanceAfter: number;
  refType: string | null;
  refId: number | null;
  memo: string | null;
  createdAt: string;
}

export interface LedgerPage {
  club: { id: number; name: string } | null;
  entries: LedgerEntryRow[];
  nextCursor: number | null;
}

export interface ManualLedgerResult {
  ok: boolean;
  balance: number;
}

// 站内信收件篮（增量 18）
export interface NotificationItem {
  id: number;
  template: string;
  text: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsPage {
  items: NotificationItem[];
  nextCursor: number | null;
  unread: number;
}

// 设施经营预览（增量 19）
export interface StadiumBuildInfo {
  credit: number;
  balance: number;
  expansionPer100: number;
  maxOpenTier: number;
  refundRatio: number;
  tier: { level: number; name: string | null; capacity: number; minSeats: number | null; maxSeats: number | null };
  nextTier: { name: string; minSeats: number; upgradeCost: number; open: boolean; capacityOk: boolean } | null;
  facilities: { key: string; level: number; nextCost: number | null }[];
}

export interface BuildPaymentResult {
  cost: number;
  creditUsed: number;
  cash: number;
  refund: number;
}

// 冠名市场（增量 20）
export interface NamingPackage {
  packageNo: number;
  pkgName: string;
  windows: number;
  feePerWindow: number;
  bonusAmount: number;
  betAttend: number | null;
  betFans: number | null;
}

export interface BrandQuote {
  brand: string;
  heat: number;
  industry: string;
  baseFee: number;
  packages: NamingPackage[];
}

export interface NamingContract {
  id: number;
  clubId: number;
  brand: string;
  baseFee: number;
  packageNo: number;
  pkgName: string;
  feePerWindow: number;
  windowsTotal: number;
  windowsRemaining: number;
  bonusAmount: number;
  betAttend: number | null;
  betFans: number | null;
  status: string;
  startedSeason: number;
  startedWindow: number;
}

export interface NamingQuoteResponse {
  contract?: NamingContract;
  brands?: BrandQuote[];
}

export interface NamingTerminateResult {
  brand: string;
  penalty: number;
  windowsRemaining: number;
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
};

export function ledgerKindLabel(kind: string): string {
  return LEDGER_KIND_LABELS[kind] ?? kind;
}

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
  loyalty: number;
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
}

export interface ResultsQueue {
  queue: ResultQueueRow[];
  confirmed: ConfirmedResultRow[];
}

export interface ConfirmResultResult {
  ok: boolean;
  result: ConfirmedResultRow;
  /** 确认钩子自动 XP：granted=入账事件数，unresolved=没匹配上的俱乐部/球员名（补录用） */
  xp: { granted: number; unresolved: string[] };
}

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

// ---- 成长引擎（§10，增量 6） ----

export interface GrowthEventRow {
  id: number;
  matchRef: string | null;
  season: number | null;
  windowSeq: number | null;
  eventType: string;
  value: number;
  xp: number;
  source: string;
  createdAt: string;
}

export interface UpgradePlanDto {
  ca: number;
  silver: number;
  gold: number;
}

export interface GrowthDetail {
  player: {
    id: number;
    name: string;
    ca: number;
    growthTier: number;
    growthXp: number;
    levelsApplied: number;
    badgesSilver: number;
    badgesGold: number;
    growable: boolean;
    status: string;
    xpPerLevel: number;
    pendingLevelUps: number;
    upgradePlans: UpgradePlanDto[];
  };
  events: GrowthEventRow[];
}

export interface LevelUpResult {
  ok: boolean;
  plan: UpgradePlanDto;
  levelsApplied: number;
  pendingLeft: number;
}

export interface GrowthSettlementResult {
  ok: boolean;
  season: number;
  half: boolean;
  /** 本次结算依据的成长期（0 = 还没宣告过，全生涯口径） */
  growthPeriodId: number;
  traineeXp: number;
  traineeCount: number;
  chinaCount: number;
  milestonesGranted: number;
  pendingLevelUps: { playerId: number; name: string; growthTier: number; pending: number }[];
}

/** 成长期（一个赛季可有多个，通常夹在两个窗口之间） */
export interface GrowthPeriodRow {
  id: number;
  season: number | null;
  startEventId: number;
  source: string;
  note: string | null;
  declaredBy: number | null;
  declaredAt: string | null;
}

export interface GrowthPeriodsResponse {
  current: GrowthPeriodRow | null;
  periods: GrowthPeriodRow[];
}

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

/** 管理组可补录的事件类型（比赛系统没有的数据或漏记兜底），hint 是 §10.1 折算口径 */
export const MANUAL_GROWTH_TYPES: { type: string; label: string; hint: string; needsValue: boolean }[] = [
  { type: 'appearance', label: '出场', hint: '固定 1 XP', needsValue: false },
  { type: 'rating', label: '评分', hint: '7.0-10.0：7 档 1 · 8 档 2 · 9 档 3 · 10 档 4', needsValue: true },
  { type: 'clean_sheet', label: '零封', hint: '固定 0.5 XP', needsValue: false },
  { type: 'duels_won', label: '夺回球权', hint: '每 12 次 1 XP', needsValue: true },
  { type: 'saves', label: '扑救', hint: '每 8 次 1 XP，单场超 8 额外 +1', needsValue: true },
];

// ---- M0 货币监控（PRD：Σ俱乐部余额报表，观察通胀） ----

export interface M0Report {
  /** 货币总量：Σ ledger_accounts.balance */
  m0: number;
  /** 冻结中资金（fund_holds held） */
  held: number;
  /** 可流动 = M0 − 冻结 */
  available: number;
  /** 各记账 kind 净额（收入为正、支出为负），观察通胀来源 */
  byKind: { kind: string; total: number; n: number }[];
  /** 按余额降序的俱乐部明细 */
  byClub: { id: number; name: string; balance: number }[];
}
