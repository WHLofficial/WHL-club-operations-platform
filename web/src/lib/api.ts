// API 约定（附录 A）：错误统一 {error, code?}；前端消费的 DTO 在此层冻结
import type { PlayerMarker } from '../../../src/core/squad-rules.ts';

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
    throw new ApiError(res.status, errMessage(data), data?.code, Array.isArray(data?.issues) ? data.issues : undefined);
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
  squadCount: number | null;
  window: { season: number; windowSeq: number } | null;
  // v1.5.0：主场档案（球场/设施/影响力构成）；无球场行 = null
  home: StadiumInfo | null;
}

export interface StadiumInfo {
  name: string | null;
  namingBrand: string | null;
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
   * 一个人都没录过时服务端给 null ⇒ 前端显示「—」而不是 0.00 m
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

export interface PlayerListItem {
  id: number;
  uid: string;
  /** 显示名（v4.0.0）：FC26 存档派生的人名，派生不到（长尾球员）时回落官方缩写名 */
  name: string;
  /** FC26db 官方缩写名（`E. Haaland`）：与显示名不同时列在名字下方小字 */
  officialName?: string;
  /** 球衣号（v4.0.0）：1–99 的字符串，由所属俱乐部设定；没定号或已换队（换队即清空）时为 null */
  number: string | null;
  clubId: number | null;
  position: string | null;
  age: number | null;
  ca: number;
  pa: number;
  prestige: number | null;
  marketValue: number | null;
  status: string;
  /** 转会设置（v6.30.0，列表行口径）：挂牌中 / 非卖品 */
  transferListed: boolean;
  notForSale: boolean;
  /** 是否设过最低报价的摘要：列表端点只给布尔，min_offer_price 数值不下发（v6.33.0 起详情也只给公开标价 listPrice，故详情对象上没有本键） */
  transferPriced?: boolean;
  growthTier: number;
  isFutureStar: boolean;
  chinaPlan: boolean;
  agentTier: number;
  badgesSilver: number;
  badgesGold: number;
  /** 标记（v6.5.0）：规则 4.2.2 三档互斥切分，初始CA 恒按 COALESCE(base_ca, ca)、PA 取现值；不落档为 null */
  marker: PlayerMarker | null;
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
  // v3.0.0 窗刻度：效力时长（赛季，1 常规窗 = 0.5）；protected = 是否在保护期内
  serviceSeasons: number;
  protected: boolean;
  signedSeason: number | null;
  signedWindowSeq: number | null;
}

export interface PlayerDetail {
  player: PlayerListItem & {
    foot: number;
    growable: boolean;
    growthXp: number;
    gameAttrs: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
    // 报价设置（v6.3.0；v6.4.0 加 offer_auto 与名单解耦；v6.33.0 标价）——球员页左栏报价设置与五态判据吃这几个字段；
    // minOfferPrice 数值转全系统私密，公开面只下发标价 listPrice，私密底线走 offer-settings 端点
    transferListed: boolean;
    listPrice: number | null;
    offerAuto: boolean;
    notForSale: boolean;
  };
  club: { id: number; name: string } | null;
  contract: ContractDto | null;
  /** 海捞资格（v6.17.0）：与后端 createFreeAgent 守卫链同源，左栏海捞按钮的可用性与原因都吃它 */
  seaSign: SeaSignEligibility;
  /** 海捞成交参照（v6.17.0）：违约金输入框下方的定价锚 */
  seaComps: SeaComps;
}

/** 报价设置（GET/PUT /api/players/:id/offer-settings，v6.33.0）：设置面板的私密预填源 */
export interface OfferSettingsDto {
  transferListed: boolean;
  /** 私密最低报价（全系统私密，仅本队教练经本端点可见） */
  minOfferPrice: number | null;
  /** 公开标价（进转会名单必填，其他队可见） */
  listPrice: number | null;
  offerAuto: boolean;
  notForSale: boolean;
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

/** 转会记录（v3.3.0）：只含已完成单据，按完成时间倒序 */
export interface PlayerTransferRow {
  id: number;
  type: string;
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

export interface PlayerTransfersResponse {
  transfers: PlayerTransferRow[];
}

// ---- v0.7.1 d8：球员库（公开 /api/players，keyset 游标分页）----

export interface PlayerLibraryRow extends PlayerListItem {
  growable: boolean;
  clubName: string | null;
  // v2.3.0：多位置槽（PosID1-4 槽位序去重）、球员影响力（规则 4.1.3 现值口径）、现行合同速览
  positions: string[];
  influence: number;
  wage: number | null;
  releaseFee: number | null;
  contractType: string | null;
  // v2.3.0 列联动：筛什么就带什么字段回来（foot/baseCa/fcId 恒回，attrValue 只在 attr 筛选时出现）
  foot: number;
  baseCa: number | null;
  fcId: number | null;
  source: string | null;
  // v3.0.0 窗刻度：效力时长（赛季）；protected = 是否在保护期内（无合同 = null）
  serviceSeasons: number | null;
  protected: boolean;
  attrValue?: number;
  // ps 筛选时带回的 PSID1-15 槽位原值（长度 15、缺槽 null；金徽=基础 ID+100，金槽 13+）
  psIds?: (number | null)[];
}

export interface PlayersLibraryResponse {
  players: PlayerLibraryRow[];
  // v3.2.0：服务端不再回 total（整表 COUNT 占单页读量 99.7%）；分页条用 nextCursor 判「还有更多」
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
  /** CPU 队标记（v6.27.0）：true = 电脑队，可从俱乐部管理进入接管向导 */
  isCpu: boolean;
  leagueTier: string;
  status: string;
  transferBanned?: boolean;
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

export interface ImportPreview {
  channel: 'A' | 'B';
  mode: 'minor' | 'major';
  stats: {
    total: number;
    valid: number;
    error: number;
    warning: number;
    insertEstimate: number;
    updateEstimate: number;
    growthPlayers: number; // 成长增量 δ>0、将被换版规则触及的球员数
    xpToWipe: number; // 大换版时将被清零的经验总量（小换版恒 0）
  };
  errors: { row: number; field: string; message: string }[];
  warnings: { row: number; field: string; message: string }[];
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
  mode: 'minor' | 'major';
  growthPlayers: number;
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

/**
 * 注册校验放行档（v6.33.1 特例期开关 registration_check_mode）：
 * enforce=照常拦；warn=体检照算照显示、但不拦提交；off=教练侧隔离（不体检、不挂红字）。
 */
export type RegistrationCheckMode = 'enforce' | 'warn' | 'off';

export interface SquadPlayerRow {
  id: number;
  fcId: number | null;
  uid: string;
  name: string;
  number: string | null;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  baseCa: number | null;
  // v6.30.0 C 段：注册工作台的固定列（标记/UID）与可选列池要用的字段，口径同 PlayerListItem
  marker: PlayerMarker | null;
  growable: boolean;
  isFutureStar: boolean;
  chinaPlan: boolean;
  prestige: number | null;
  status: string;
  marketValue: number | null;
  foot: number | null;
  growthTier: number;
  agentTier: number;
  badgesSilver: number;
  badgesGold: number;
  wage: number | null;
  releaseFee: number | null;
  contractType: string | null;
  source: string | null;
  serviceSeasons: number | null;
  protected: boolean;
  /** PlayStyle 槽位原值（15 槽、缺槽 null）；只有本端点无条件下发 */
  psIds: (number | null)[];
  hasContract: boolean;
  squad: 'first_team' | 'trainee' | null;
}

export interface SquadOverview {
  club: { id: number; name: string; leagueTier: string | null } | null;
  season: number | null;
  // 报名状态探测（v1.2.0）：true=已报定级赛事（leagueTier 非空）；false=未报名，提交会被 400 拦下
  registeredInTournament: boolean;
  players: SquadPlayerRow[];
  registration: { firstTeam: number[]; trainee: number[] } | null;
  compliance: SquadCompliance | null;
  /** 当前放行档（v6.33.1）：未绑定队的早退响应也会带，按必填处理 */
  checkMode: RegistrationCheckMode;
  rules: SquadRules | null;
}

export interface RegistrationResult {
  ok: boolean;
  season: number;
  firstTeam: number;
  trainee: number;
  wageTotal: number;
  /** 提交时的放行档（v6.33.1） */
  checkMode: RegistrationCheckMode;
  /** 本次体检问题；enforce 通过时恒为 []，warn/off 下可能非空（off 由前端隐藏） */
  issues: SquadIssue[];
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

// ---- v0.4.0 DTO（附录 A〔3〕：转会市场挂牌竞价链）----

export type ListingStatus = 'listed' | 'bidding' | 'matched_pending' | 'pending_review' | 'delisted';

export type MatchPhase = 'first_bid' | 'matching' | null;

export interface MarketListing {
  id: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null };
  sellerClub: { id: number; name: string };
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

export interface AdminReviewRow {
  id: number;
  kind: string;
  status: string;
  payload: Record<string, unknown> | null;
  note: string | null;
  decidedAt: string | null;
  // 激活举报核查任务（v6.4.0 改动 4）；transfer_confirm 行为 null
  report: { listingStatus: string | null; askPrice: number | null; proofKey: string | null; activatorClubName: string | null } | null;
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
  };
}

export interface AdminReviews {
  reviews: AdminReviewRow[];
}

export interface NegotiationSession {
  id: number;
  transferId: number;
  status: 'active' | 'settled' | 'cancelled';
  transfer: { type: string; status: string; fee: number | null };
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
  clubId: number;
  clubName: string;
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
  loyalty: { count: number; total: number };
  forceSettled: number;
}

export interface ForcedAuctionResult {
  ok: boolean;
  listingId: number;
  askPrice: number;
}

// ---- v0.7.0 DTO（附录 A〔6〕：财政/赛季/赛果/成长/通知/监管）----

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

// 近期主场战报（v6.7.0，B1）：本队主场比赛的天气/上座/三项收入 + 对手与比分
export interface HomeMatchRow {
  matchId: number;
  season: number;
  windowSeq: number;
  weather: string | null;
  attendance: number;
  attendanceRate: number | null;
  ticket: number;
  commercial: number;
  broadcast: number;
  total: number;
  opponentId: number | null;
  opponentName: string | null;
  scoreText: string | null;
  result: string | null;
}

export interface HomeMatchesResponse {
  club: { id: number; name: string } | null;
  matches: HomeMatchRow[];
}

// 窗口财务汇总（v6.7.0，B2）：比赛日按 match_attendance 精确归窗，其余流水按 created_at 落窗
export interface FinanceMatchday {
  matches: number;
  attendance: number;
  ticket: number;
  commercial: number;
  broadcast: number;
  total: number;
}

export interface FinanceWindow {
  windowSeq: number;
  status: string;
  isTemporary: boolean;
  openedAt: string;
  closedAt: string | null;
  matchday: FinanceMatchday;
  byKind: Record<string, number>;
  net: number;
  closingBalance: number | null;
}

export interface FinanceSummaryResponse {
  club: { id: number; name: string } | null;
  season: number | null;
  windows: FinanceWindow[];
  outside: { byKind: Record<string, number>; net: number; total: number } | null;
  totals: { matchday: FinanceMatchday; net: number; closingBalance: number | null } | null;
}

// 站内信收件篮（v2.4.0）
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

// 设施经营预览（v2.5.0）
export interface StadiumBuildInfo {
  credit: number;
  balance: number;
  expansionPer100: number;
  maxOpenTier: number;
  refundRatio: number;
  /** v6.30.0 施工开窗闸：当前是否有开着的转会窗口——关窗时三类施工按钮全部置灰（后端同口径 409 no_window） */
  open: boolean;
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

// 冠名市场（v2.6.0）
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
  /** 品牌档位（v6.13.0 C2）：头部 / 新兴 / 口碑 */
  tier: string;
  /** 档位名额余量（v6.13.0 C2）：null = 不限（口碑档）；0 = 已满不可签 */
  quotaLeft: number | null;
  baseFee: number;
  packages: NamingPackage[];
}

export interface NamingContractBase {
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
  /** 品牌方情绪（v6.12.0）：0–2，<0.8 低落 / 0.8–1.2 平静 / >1.2 高涨（C2 起按窗演化） */
  satisfaction: number;
}

/** 读端点（quote）在基础字段上附加档位与情绪地板；accept 端点只回基础字段（v6.14.0 C3） */
export interface NamingContract extends NamingContractBase {
  /** 品牌档位（v6.13.0 C2）：头部 / 新兴 / 口碑 */
  tier: string;
  /** 当前档位的情绪地板（v6.13.0 C2，低情绪预警用）；品牌不在池中时为 null */
  satisfyFloor: number | null;
}

/** 招商轮收到的报价（v6.14.0 C3）：pending = 待签；queued = 已选「到期后自动接替」排队中 */
export interface ClubOffer {
  id: number;
  brand: string;
  tier: string;
  packageNo: number;
  amount: number;
  windows: number;
  status: 'pending' | 'queued';
  /** 过期时刻（ISO）；过期后读端点不再下发，签约时后端也会拦 */
  expireAt: string;
}

export interface NamingQuoteResponse {
  contract?: NamingContract;
  /** 续约候选（有现约时下发）：按当前队况与品牌现热度现算的同一品牌报价；品牌已弃用则缺省 */
  renewal?: BrandQuote | null;
  /** 收到的报价（v6.14.0 C3）：签约入口只此一处（品牌直签列表已退役） */
  offers: ClubOffer[];
}

export interface NamingTerminateResult {
  brand: string;
  penalty: number;
  windowsRemaining: number;
}

/** 接报价结果（v6.14.0 C3）：signed 直接签；terminated 解约旧约再签（带赔金）；queued 登记到期接替 */
export interface NamingOfferAcceptResult {
  result: 'signed' | 'terminated' | 'queued';
  penalty: number;
  contract: NamingContractBase | null;
}

// ---- 招商轮（v6.14.0 C3，管理端只读视图 + 手动「清盘+开轮」）----

export interface MarketRound {
  id: number;
  opened_season: number;
  opened_window: number;
  status: 'open' | 'settled';
  opened_at: string;
  settled_at: string | null;
}

/** 报价流水（含已签/已废全状态）；club_name 为 null = 队伍已不在登记册 */
export interface MarketOfferRow {
  id: number;
  round_id: number;
  club_id: number;
  package_no: number;
  amount: number;
  windows: number;
  status: 'pending' | 'accepted' | 'queued' | 'expired';
  created_at: string;
  expire_at: string;
  brand: string;
  club_name: string | null;
}

export interface MarketRoundResponse {
  /** 当前 open 轮优先，没有则最近一条已结轮；一次都没开过时为 null */
  round: MarketRound | null;
  offers: MarketOfferRow[];
}

export interface MarketRoundReopenResult {
  ok: boolean;
  hadOpenRound: boolean;
  offerCount: number;
  offersPerClub: { clubId: number; brands: string[] }[];
}

/** 主场档期（v6.9.0）：每窗非比赛日档位的活动预订，收益在窗末随关窗结算 */
export interface BookingActivityOption {
  key: string;
  name: string;
  /** 预计收入区间（固定收入活动上下界相同）；实际值窗末按档位种子结算 */
  incomeMin: number;
  incomeMax: number;
}

export interface BookingRow {
  id: number;
  slotNo: number;
  activityType: string;
  activityName: string;
  bookedBy: string;
  createdAt: string;
}

export interface BookingsResponse {
  clubId: number;
  /** 查的这一窗是否就是当前开窗（关了的历史窗只能看不能改） */
  open: boolean;
  season: number | null;
  windowSeq: number | null;
  /** 每窗档位总数（config activity_slots） */
  slots: number;
  catalog: BookingActivityOption[];
  bookings: BookingRow[];
}

export interface BookingResult {
  booking: BookingRow;
  /** 同一档位被改订时原活动（首次预订为 null） */
  previous: BookingRow | null;
}

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
  /** 确认钩子自动 XP：granted=入账事件数，unresolved=没匹配上的俱乐部/球员名（补录用） */
  xp: { granted: number; unresolved: string[] };
}

// ---- 场次天气预报（v6.15.0）：管理员按 (赛事, 轮次) 预览 / 触发本轮主场预报 ----

/** 预览行：预报值（match_weather）与已确认实际天气（match_attendance）可能同时存在 */
export interface WeatherForecastPreviewMatch {
  matchId: number;
  /** 主队平台俱乐部；tour 主队无映射（CPU 队 / 信息缺失）时为 null */
  homeClubId: number | null;
  homeClubName: string | null;
  awayTeamName: string | null;
  stageName: string | null;
  /** 比赛系统侧是否已完赛 */
  finished: boolean;
  /** 主场球场；无球场行（含 CPU 队）为 null */
  stadium: { name: string | null; capacity: number; tier: number } | null;
  /** 预报天气；未预报为 null */
  weather: string | null;
  /** 预报时抽定的天气系数；未预报为 null */
  wxCoef: number | null;
  /** 已确认的实际天气（有 match_attendance 行）；未确认为 null */
  confirmedWeather: string | null;
  /** 已确认的上座与三分收入；未确认为 null（收入四件套只在管理端预览出，公开 /api/fixtures 不带） */
  attendance: number | null;
  ticket: number | null;
  commercial: number | null;
  broadcast: number | null;
  /** 跳过原因（无平台映射 / 无球场行）；可预报的场次为 null */
  skippedReason: string | null;
}

export interface WeatherForecastPreview {
  tournamentId: number;
  round: number;
  matches: WeatherForecastPreviewMatch[];
}

/** 触发结果里本次新落库（forecast）与先前已存在（existing）的预报行 */
export interface WeatherForecastRow {
  matchId: number;
  homeClubName: string | null;
  awayTeamName: string | null;
  weather: string;
  wxCoef: number;
}

/** 已确认（有 match_attendance 行）而跳过的场次 */
export interface WeatherForecastConfirmedRow {
  matchId: number;
  homeClubName: string | null;
  awayTeamName: string | null;
  weather: string | null;
}

/** 无法预报的场次及原因 */
export interface WeatherForecastSkippedRow {
  matchId: number;
  homeClubName: string | null;
  awayTeamName: string | null;
  reason: string;
}

/** POST /api/admin/weather/forecast 返回：四段各自独立计数 */
export interface WeatherForecastTriggerResult {
  tournamentId: number;
  round: number;
  forecast: WeatherForecastRow[];
  existing: WeatherForecastRow[];
  confirmed: WeatherForecastConfirmedRow[];
  skipped: WeatherForecastSkippedRow[];
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

// ---- 成长引擎（§10，v0.7.0） ----

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

/** 发放明细行（v3.3.0）：psid 是基础 ID（1-99），金徽由 kind 表示 */
export interface PlaystyleDetailRow {
  slot: number;
  kind: 'silver' | 'gold';
  psid: number;
  source: 'growth' | 'china' | 'manual';
  createdAt: string;
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
    /** 中国计划自选银徽章名额（config.china_badges − 已发数） */
    chinaPlaystyles: { quota: number; granted: number; left: number };
  };
  /** 发放明细：与 FC 源槽合并后才是这名球员完整的 PlayStyle 清单 */
  playstyleDetails: PlaystyleDetailRow[];
  events: GrowthEventRow[];
}

export interface LevelUpResult {
  ok: boolean;
  plan: UpgradePlanDto;
  levelsApplied: number;
  pendingLeft: number;
  /** 本次落下的明细（存库形式：银 1-99 / 金 101-199） */
  playstyles: { slot: number; psid: number; gold: boolean }[];
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

// ---- v6.16.0：管理端「成长录入」（按场补录，/api/admin/growth/match-entry） ----

/** 可补录比赛列表行（近 50 场，已按可计 XP 口径过滤，按确认时间倒序） */
export interface MatchEntryListItem {
  matchId: number;
  season: number;
  windowSeq: number;
  competitionType: string;
  stageName: string;
  stageKind: string;
  round: number;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  finishedAt: string | null;
  confirmedAt: string | null;
  homeClubId: number | null;
  awayClubId: number | null;
  homeIsCpu: boolean;
  awayIsCpu: boolean;
  /** 该场已录成长事件条数（列表徽标用） */
  recorded: number;
}

export interface MatchEntryListResponse {
  matches: MatchEntryListItem[];
}

/** 一队侧花名册里的球员（status = 'trainee' 即训练营，不按场次计） */
export interface MatchEntryPlayer {
  id: number;
  name: string;
  displayName: string;
  position: string | null;
  status: string;
}

export interface MatchEntrySide {
  clubId: number | null;
  isCpu: boolean;
  players: MatchEntryPlayer[];
}

/** 已录成长事件行（eventType 见 GROWTH_EVENT_LABEL；source: manual = 管理组补录，其余 = 赛果同步） */
export interface MatchEntryRecordedRow {
  playerId: number;
  eventType: string;
  value: number;
  xp: number;
  source: string;
}

/** 单场录入面板（GET /api/admin/growth/match-entry/:matchId） */
export interface MatchEntryPanel {
  match: MatchEntryListItem;
  sides: { home: MatchEntrySide; away: MatchEntrySide };
  recorded: MatchEntryRecordedRow[];
}

/** 单名球员的单场录入（只传有值的字段；后端按 event_type 去重，重复的跳过） */
export interface MatchEntryInput {
  playerId: number;
  appearance?: boolean;
  rating?: number;
  cleanSheet?: boolean;
  duelsWon?: number;
  saves?: number;
}

export interface MatchEntryPerPlayerResult {
  playerId: number;
  name: string;
  xp: number;
  written: number;
  duplicates: number;
}

/** POST /api/admin/growth/match-entry/:matchId 的响应；400 时 body 带 { message } 中文原因 */
export interface MatchEntrySubmitResult {
  ok: boolean;
  written: number;
  duplicates: number;
  totalXp: number;
  perPlayer: MatchEntryPerPlayerResult[];
}

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

// ---- 消费中心（v6.26.0）----

export interface ShopPrices {
  paPerPoint: number;
  clubShell: number;
  badgeSilver: number;
  badgeGold: number;
  badgeSilverToGold: number;
  roleAddPlus: number;
  roleAddPlusPlus: number;
  roleUpgrade: number;
  roleRemove: number;
  positionAdd: number;
  positionRemove: number;
  positionReplace: number;
}

export interface ShopCatalog {
  prices: ShopPrices;
  paCap: number;
  hpremiumClubIds: number[];
}

export interface ShopSquadStatePlayer {
  id: number;
  name: string;
  number: number | null;
  growable: boolean;
  pa: number | null;
  position: string | null;
  /** 热区，定长 4 位（下标 = 槽号 - 1，主位在前，空槽 null） */
  zones: (string | null)[];
  roles: { slot: number; roleId: number }[];
  ownedSilver: number[];
  ownedGold: number[];
  silverUsed: number;
  goldUsed: number;
}

export interface ShopSquadStateResponse {
  clubId: number;
  players: ShopSquadStatePlayer[];
}

export type ShopOrderStatus = 'pending' | 'approved' | 'rejected';

export interface ShopOrderDto {
  id: number;
  source: 'club' | 'external';
  clubId: number;
  orderedBy: number;
  category: 'pa' | 'badge' | 'badge_upgrade' | 'role' | 'position' | 'club_shell';
  categoryLabel: string;
  payload: Record<string, unknown> | null;
  summary: string;
  amount: number | null;
  status: ShopOrderStatus;
  note: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface ShopOrdersResponse {
  clubId: number;
  orders: ShopOrderDto[];
}

export interface AdminShopOrderRow extends ShopOrderDto {
  clubName: string | null;
}

export interface AdminShopOrdersResponse {
  orders: AdminShopOrderRow[];
}
