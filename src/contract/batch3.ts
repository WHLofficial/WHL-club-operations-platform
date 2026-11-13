// 跨端契约类型真源 · 第 3 批：shop / voucher / venue / weather / naming / brand / finance / ledger / shortlist / notification
//
// 甄别清单 scratch/contract-audit-batch3.json（2026-11-09）：62 个 disposition=contract 类型 +
// §6.8 漏审补录一枚（M0Report，测试计划 §5 B3 特有验收 ⑨）是唯一真源；
// ManualLedgerKind / MANUAL_LEDGER_KINDS 是 viewmodel（前端奖金模板下拉常量，value 域受 worker
// MANUAL_KIND_RE 白名单约束、正则更宽）按口径 7① 留守 web 不迁移；
// NotifyRef / NotifyCategoryId 是共享 core 单源（core/notify-meta.ts）按口径 7② 不复制进契约，
// 只按名 import 引用；ShopPrices / VenueSlotQuote / VenueTotals 的真源已在 core（shop.ts:154 /
// venue.ts:78 / venue.ts:90），本文件按名转发、不复制第二份。
// 字段跟随 worker c.json 载荷现实（FieldDiff 处置见各型注释），web/src/lib/api.ts 只 re-export
// 不手抄，worker 侧响应装配点以本文件类型为锚（装配函数 return 标注 / 路由 c.json 泛型）。
//
// 锚点覆盖（ask ② 授权七文件）：routes/shop.ts（catalog / squad-state / orders 三读端点 c.json
// 泛型 + 提交回执）、shop-ops.ts（squadStateOf / orderDto / loadShopSettings 装配 return 标注、
// ShopOrderRow.status 行锁）、naming-ops.ts（buildPackages / parseBetTerms / terminateNaming
// return 标注、NamingPackage / BetTerms / BetTermsItem / NamingQuote 改契约单源）、venue-ops.ts
// （core VenueQuote ⊒ 契约 VenueFigureBlock 编译期结构锁）。
// 锚点缺口（登记 registered，生产者在 ask ② 白名单外，契约已建、api 已转发）：
//   · LedgerEntryRow / LedgerPage / VoucherLedgerEntry / VoucherLedgerResponse / Finance* /
//     HomeMatchRow / HomeMatchesResponse / Shortlist* / StadiumBuildInfo / Naming* 装配与
//     BookingRow / VenuePlanResponse / VenuePreviewResponse / VenueSaveResponse / BuildPaymentResult
//     ← routes/clubs.ts（GET/POST/PUT /api/club/*）
//   · NotificationItem / NotificationsPage / NotificationsUnreadByCategory ← routes/notifications.ts
//   · ManualLedgerResult / M0Report ← routes/admin/finance.ts
//   · MarketRound / MarketOfferRow / MarketRoundResponse / MarketRoundReopenResult ← routes/admin/brands.ts
//   · AdminShopOrderRow / AdminShopOrdersResponse ← routes/admin/shop.ts
//   · WeatherForecast* 六型 ← weather-ops.ts + routes/admin/weather.ts
//   · ShopPrices 运行时与类型真源在 core/shop.ts（本文件转发）；VenueSlotQuote / VenueTotals 在
//     core/venue.ts（本文件转发）——core 两文件也在 ask ② 白名单外，不再另行标注。

import type { NotifyCategoryId, NotifyRef } from '../core/notify-meta.ts';
import type { ShopPrices } from '../core/shop.ts';
import type { VenueSlotQuote, VenueTotals } from '../core/venue.ts';

// ---------------------------------------------------------------------------
// 账本（GET /api/club/ledger，clubs.ts:779-829 装配；甄别 workerSource :815-828）

/** 账本行基型：LedgerEntryRow（资金）与 VoucherLedgerEntry（消费券）逐字段同形，worker 侧同列结构
 *  （ledger_entries / voucher_entries），抽公共基型消重（甄别 notes；两 export 名保留）。 */
export interface LedgerEntryBase {
  id: number;
  kind: string;
  amount: number;
  balanceAfter: number;
  refType: string | null;
  refId: number | null;
  memo: string | null;
  createdAt: string;
}

export interface LedgerEntryRow extends LedgerEntryBase {}

export interface LedgerPage {
  club: { id: number; name: string } | null;
  entries: LedgerEntryRow[];
  nextCursor: number | null;
}

/** POST /api/admin/ledger/manual 回执（admin/finance.ts:128-131） */
export interface ManualLedgerResult {
  ok: boolean;
  balance: number;
}

// ---------------------------------------------------------------------------
// 消费券流水（GET /api/club/vouchers，clubs.ts:832-883 装配）：与账本同形，读 voucher_entries；
// balance 仅绑定俱乐部时下发（club:null 分支无 balance 键）⇒ 可选如实

export interface VoucherLedgerEntry extends LedgerEntryBase {}

export interface VoucherLedgerResponse {
  club: { id: number; name: string } | null;
  balance?: number;
  entries: VoucherLedgerEntry[];
  nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// 财务汇总（GET /api/club/finance-summary，clubs.ts:1155-1245 装配；窗口按 v6.7.0 B2 口径归窗）

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

/** M0 货币监控（GET /api/admin/m0，admin/finance.ts:140 装配；§6.8 漏审补录）：Σ俱乐部余额报表 */
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

// ---------------------------------------------------------------------------
// 近期主场战报（v6.7.0 B1；GET /api/club/home-matches，clubs.ts:1035-1102 装配；§6.0 归属 B3）

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

// ---------------------------------------------------------------------------
// 站内信收件篮（GET /api/notifications，notifications.ts:82-102 装配；v6.40.0 起每行带 clubId 与 ref）

// 站内信收件篮（v2.4.0；v6.40.0 起每行带 clubId 与 ref 供整行跳转）
export interface NotificationItem {
  id: number;
  clubId: number | null;
  template: string;
  text: string;
  /** ref 三型（offer / player / shop_order）真源 = core/notify-meta.ts（写侧 notify.ts notificationRefOf、
   *  读侧 notifications.ts parseRef 共用同一共享源，非手抄） */
  ref: NotifyRef | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsPage {
  items: NotificationItem[];
  nextCursor: number | null;
  unread: number;
}

// 类目未读分布（v6.40.0，unread-count?by=category）：只含 >0 的已登记类目（categoryOf 只出已登记类目）
export interface NotificationsUnreadByCategory {
  unread: number;
  byCategory: Partial<Record<NotifyCategoryId, number>>;
}

// ---------------------------------------------------------------------------
// 候选名单（v6.58.0；GET /api/club/shortlist 与 /ids，clubs.ts:903-970 装配）

// 候选名单（v6.58.0）：俱乐部私有的球员跟踪名单
export interface ShortlistPlayer {
  name: string;
  fcId: number | null;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  marketValue: number | null;
  clubId: number | null;
  clubName: string | null;
  status: string | null;
}

export interface ShortlistItem {
  id: number;
  playerId: number;
  note: string | null;
  createdAt: string;
  player: ShortlistPlayer;
}

export interface ShortlistResponse {
  clubId: number;
  cap: number;
  items: ShortlistItem[];
}

export interface ShortlistIdsResponse {
  clubId: number;
  playerIds: number[];
  entries: { id: number; playerId: number }[];
}

// ---------------------------------------------------------------------------
// 球场建设域（GET /api/club/stadium/build-info clubs.ts:1241-1305；expand/upgrade 回执 stadium-ops.ts）

// 设施经营预览（v2.5.0）
export interface StadiumBuildInfo {
  /** 消费券余额（v6.58.0 由建设券升格，字段名从 credit 改为 voucherBalance） */
  voucherBalance: number;
  balance: number;
  /** v6.65.3：可支配（余额 − 现行冻结 + 在途收入额度），与施工守卫同口径展示 */
  available: number;
  expansionPer100: number;
  maxOpenTier: number;
  /** 开放进度上限对应的档位名（前端展示「开放至 地区级 (2)」） */
  maxOpenTierName: string | null;
  /** 子设施当前可升到的等级上限（随球场档位，tier+1，最高 5） */
  facilityCap: number;
  refundRatio: number;
  /** v6.30.0 施工开窗闸：当前是否有开着的转会窗口——关窗时三类施工按钮全部置灰（后端同口径 409 no_window） */
  open: boolean;
  tier: { level: number; name: string | null; capacity: number; minSeats: number | null; maxSeats: number | null };
  nextTier: { name: string; minSeats: number; upgradeCost: number; open: boolean } | null;
  facilities: { key: string; level: number; cap: number; nextCost: number | null; canUpgrade: boolean }[];
}

/** 三类施工端点共用回执（stadium-ops.ts:233 / :330 / :434）：cost/creditUsed/cash/refund 恒发；
 *  capacity = POST /club/stadium/expand（扩建）独发、tier = POST /club/stadium/upgrade（球场升档）
 *  独发、level = POST /club/facilities/upgrade（子设施升级）独发——各端点下发其一，不拆三型。
 *  （FieldDiff workerExtra ×3 处置 B：补可选键。） */
export interface BuildPaymentResult {
  cost: number;
  creditUsed: number;
  cash: number;
  refund: number;
  /** 仅扩建端点下发：扩建后的新容量 */
  capacity?: number;
  /** 仅球场升档端点下发：新档位号 */
  tier?: number;
  /** 仅子设施升级端点下发：新等级 */
  level?: number;
}

// ---------------------------------------------------------------------------
// 冠名市场 / 品牌域（naming-ops.ts + clubs.ts:1338-1500 装配；甄别 workerSource naming-ops.ts:98-131 等）

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
  baseFee: number;
  /** 签下将命名的球场名（v6.51.0）；无球场名时 null（worker 恒发，naming-ops.ts:914——
   *  FieldDiff 处置 A：去可选；api 手抄的 `venueName?:` 是谎）。 */
  venueName: string | null;
  packages: NamingPackage[];
  // v6.13.0 C2 的 quotaLeft（档位名额余量）已删（FieldDiff 处置 C）：worker quoteBrands→NamingQuote
  // 不含此字段、clubs.ts renewal 原样下发不补，全仓 web 零消费（甄别 grep 仅 api 手抄一处）。
}

/** 品牌企业档案（v6.51.0 批 2）：合同卡/报价卡渲染 slogan、属地、色块与「中资」标签用
 *  （clubs.ts:1349-1361 brandProfileDto；offerDto 内 intro 恒空串 :1415）。 */
export interface BrandProfile {
  nameEn: string;
  color: string;
  slogan: string;
  hq: string;
  intro: string;
  /** 空串 = 境外品牌；「中资」= 中资品牌（前端显示小标签） */
  origin: string;
  /** 招商性格（v6.51.0 批 3）：稳健 / 进取 / 对赌，空串 = 未登记（按档位递套餐） */
  style: string;
  /** 招商偏好标签（逗号分隔）：冠军相 / 高上座 / 死忠规模 / 大场馆 */
  prefer: string;
}

/** 对赌条款快照项（v6.51.0 批 3）：签约时抽定的指标与阈值。
 *  联合字面量按 worker 载荷现实收窄（naming-ops.ts:190-201）：m 真源 = BET_METRICS 六值、
 *  guard = BetGuard 四值（'' | floor | ceil | pool_default）。契约层禁 import src/worker/**，
 *  故复制字面量（TC-LOCK-07 联合字面量先例）；worker 侧 BET_METRICS / BetGuard 改值时
 *  naming-ops 的契约 import 处 typecheck 即红。 */
export interface BetTermsItem {
  m: 'attend' | 'sellout' | 'fans' | 'points' | 'goals' | 'cleansheet';
  /** 达线阈值：比率型为比率（0.612），计数型为整数场次/次数（7） */
  threshold: number;
  /** 阈值反解所用基线（比率型 = 窗均值；计数型 = 每场均值） */
  baseline: number;
  /** 阈值反解所用样本口径的场次数 */
  nBase: number;
  /** 反解时的目标达线概率（回测纠偏后的 p） */
  pTarget: number;
  /** '' | 'floor' | 'ceil' | 'pool_default'（护栏标记，ceil = 少池钳到上限，pool_default = 池默认基线） */
  guard: '' | 'floor' | 'ceil' | 'pool_default';
}

/** 条款快照（naming_contracts.bet_terms，JSON v2；空串/旧格式 ⇒ 结算回落旧绝对线）。
 *  v 恒 2、strength 恒 BET_P_BY_STRENGTH 三键（'strong'|'mid'|'weak'）——按 worker 现实收窄
 *  （naming-ops.ts:204-213）。 */
export interface BetTerms {
  v: 2;
  seed: number[];
  p: number;
  strength: 'strong' | 'mid' | 'weak';
  backtest: { hitRate: number | null; windows: number };
  /** G1b 被剔除的指标（含不适用与触界），按指标库固定序 */
  dropped: BetTermsItem['m'][];
  items: BetTermsItem[];
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
  /** 冠名落点名快照（v6.51.0）：老合同为 null（前端回落品牌名） */
  venueName: string | null;
  /** 对赌条款快照（v6.51.0 批 3）：null = 旧口径（按 betAttend/betFans 绝对线一条判定） */
  betTerms: BetTerms | null;
  /** 品牌企业档案（v6.51.0 批 2）：品牌不在池中时为 null */
  brandProfile: BrandProfile | null;
}

/** 读端点（quote）在基础字段上附加档位与情绪地板；accept 端点只回基础字段（v6.14.0 C3） */
export interface NamingContract extends NamingContractBase {
  /** 品牌档位（v6.13.0 C2）：头部 / 新兴 / 口碑 */
  tier: string;
  /** 当前档位的情绪地板（v6.13.0 C2，低情绪预警用）；品牌不在池中时为 null */
  satisfyFloor: number | null;
}

/** 招商轮收到的报价（v6.14.0 C3）：pending = 待签；queued = 已选「到期后自动接替」排队中
 *  （行源 market-ops.ts:108-125 listClubOffers，status 限定 pending(轮 open)|queued）。 */
export interface ClubOffer {
  id: number;
  brand: string;
  tier: string;
  /** 行业（v6.51.0 批 2）：报价卡属地行「城市 · 行业」用 */
  industry: string;
  packageNo: number;
  /** 套餐名（v6.84.5）：稳健 / 进取 / 对赌；直接展示，不用内部序号 */
  pkgName: string;
  /** 套餐底价（v6.84.5）：对赌奖金按底价计算，前端展示实际金额用 */
  baseFee: number;
  amount: number;
  windows: number;
  status: 'pending' | 'queued';
  /** 过期时刻（ISO）；过期后读端点不再下发，签约时后端也会拦 */
  expireAt: string;
  /** 签下将命名的球场名（v6.51.0）：无球场名时空串（前端不加行） */
  venueName: string;
  /** 对赌条款快照（v6.84.4）：报价期抽定；null = 非对赌套餐或存量旧报价 */
  betTerms: BetTerms | null;
  /** 品牌企业档案（v6.51.0 批 2） */
  brandProfile: BrandProfile | null;
}

export interface NamingQuoteResponse {
  contract?: NamingContract;
  /** v6.65.3：退约赔款预览（有现约时下发）——确认弹窗先亮金额；服务端退约时现算为准 */
  terminatePenalty?: number;
  /** 续约候选（有现约时下发）：按当前队况与品牌现热度现算的同一品牌报价；品牌已弃用则缺省 */
  renewal?: BrandQuote | null;
  /** 收到的报价（v6.14.0 C3）：签约入口只此一处（品牌直签列表已退役） */
  offers: ClubOffer[];
}

/** 提前解约回执（terminateNaming naming-ops.ts:1047-1049；POST /club/naming/terminate） */
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

/** POST /api/club/naming/renew 回执（clubs.ts:1491 回 { contract: namingContractDto(…) } 整包；
 *  甄别 notes P2 随批补具名——web venueCards.tsx 只内联消费窄版，内联不动）。 */
export interface NamingRenewResult {
  contract: NamingContractBase;
}

// ---- 招商轮（v6.14.0 C3，管理端只读视图 + 手动「清盘+开轮」；端点在 /api/admin/brands/market-round，
//      服务招商轮，名字带 Market* 但归属冠名/招商轮域（甄别 notes：真源 brands.ts:301 + market-ops.ts:262））----

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

// ---------------------------------------------------------------------------
// 场馆经营域（v6.53.0 P0；GET/POST/PUT /api/club/venue-plan*，clubs.ts:1527-1969 装配）

/** 主场档期行的形状（v6.9.0 端点已下线，v6.53.0 的 GET /club/venue-plan 仍复用这个形状；
 *  行源 venue-ops.ts VenueBookingRow snake_case，clubs.ts bookingDto 转 camel） */
export interface BookingRow {
  id: number;
  slotNo: number;
  activityType: string;
  activityName: string;
  bookedBy: string;
  createdAt: string;
}

/** 方针枚举，与 `clubs.venue_policy` 的取值一致（空串 = 没选过，前端用 null 表示；
 *  真源 clubs.ts VENUE_POLICIES 三值，契约层复制字面量）。 */
export type VenuePolicyChoice = 'money' | 'fans' | 'reputation';

/** 单槽/整窗共用的六个数字。口径全在服务端（百万、已四舍五入）：前端只展示，绝不逐槽加总。
 *  形状真源 = core/venue.ts（VenueTotals 六数 / VenueQuote 的六数子集）；venue-ops.ts 有
 *  core VenueQuote ⊒ 本型的编译期结构锁。 */
export interface VenueFigureBlock {
  gross: number;
  opsCost: number;
  expectedDamage: number;
  expectedNet: number;
  attendanceMod: number;
  reputationGain: number;
}

/** 整窗合计：饱和系数按同类序位算，逐槽相加会高估，所以合计只认服务端这一份。
 *  转发 core/venue.ts 单源（quotePlan 返回形状），不复制第二份。 */
export type { VenueTotals };

/** 草稿逐槽结果（`POST /club/venue-plan/preview` 的 slots[]、`PUT /club/venue-plan` 的 slots[]）。
 *  转发 core/venue.ts 单源（quotePlan 逐槽返回形状），不复制第二份。 */
export type { VenueSlotQuote };

/** GET 里某一槽若排某个活动时的口径（`slots[].quote` 与 `slots[].options[]` 共用） */
export interface VenueActivityQuote extends VenueFigureBlock {
  activity: string;
}

/** `slots[].options[]`：非空 unlockReason = 这一项当前排不了（设施/声望门槛），文案由服务端给 */
export type VenueActivityOption = VenueActivityQuote & { unlockReason: string | null };

/** GET /api/club/venue-plan：档期一屏的全部真源（槽数、门槛、推荐、已排都不前端算） */
export interface VenuePlanResponse {
  clubId: number;
  /** null = 当前没有进行中的窗：档期仍可试排，但保存会 409 */
  window: {
    /** worker getVenueWindow 只查 status='open'（clubs.ts:1553-1559）⇒ 恒 'open'
     *  （FieldDiff 处置 A：api 手抄的 'closed' 分支收窄删除）。 */
    status: 'open';
    season: number;
    windowSeq: number;
    openedAt: string;
    /** 只在 window !== null 时给；`opened_at` 为空（存量脏行）时为 null ⇒ 前端降级为「管理员手工关窗」 */
    closesAt: string | null;
    reminderSent: boolean;
  } | null;
  capacity: number;
  /** false = 没有 stadium 行：按 2 档试排，不回落 20000 容量 */
  hasStadium: boolean;
  /** 派生槽数（= slots.length，自检用；前端不自己算） */
  slotCount: number;
  /** config activity_slots（每窗档位上限） */
  slotCap: number;
  reputation: number;
  attendance: { mod: number; matchesLeft: number; clamp: [number, number] };
  facilities: { key: string; label: string; level: number }[];
  /** 含 idle（保存校验用），UI 过滤掉只渲染 5 张活动卡 */
  activities: {
    key: string;
    name: string;
    blurb: string;
    unlocked: boolean;
    requirements: { label: string; need: number; current: number }[];
  }[];
  slots: {
    slotNo: number;
    saturation: number;
    /** 已保存的活动 key；null = 空槽 */
    booked: string | null;
    /** 该槽已排活动在本窗的同类序位口径；空槽 null */
    quote: VenueActivityQuote | null;
    /** 该槽「若排某类」的口径，含 idle；是「下一个同类」的算法，别拿来回填当前已排槽 */
    options: VenueActivityOption[];
  }[];
  policy: VenuePolicyChoice | null;
  recommendations: Record<VenuePolicyChoice, { policy: string; picks: { slotNo: number; activity: string }[]; totals: VenueTotals }>;
  /** 本窗已落库的档期（元素形状与旧 BookingRow 一致；bookedBy 是 TEXT，赠档写「事件」） */
  bookings: BookingRow[];
  /** 旧 activity_config（legacyKeys）非空时的提示 */
  configWarning: string | null;
}

/** 页面与纯函数层共用的槽 DTO（`slots[]` 的元素） */
export type VenueSlotDto = VenuePlanResponse['slots'][number];

/** POST /api/club/venue-plan/preview：只读、不落库、不需要开窗 */
export interface VenuePreviewResponse {
  slots: VenueSlotQuote[];
  totals: VenueTotals;
  /** 槽号 → 排不了的原因（预览不 reject 门槛，只回报） */
  unlockReasons: Record<number, string>;
}

/** PUT /api/club/venue-plan 的回执：保存后整窗的预期口径 */
export interface VenueSaveResponse {
  slots: VenueSlotQuote[];
  policy: VenuePolicyChoice | null;
  totals: VenueTotals;
}

// ---------------------------------------------------------------------------
// 天气预报域（weather-ops.ts buildRoundView :143-188 + ForecastResult :60-76；管理端 /api/admin/weather/forecast）

/** 预览行：预报值（match_weather）与已确认实际天气（match_attendance）可能同时存在。
 *  stadium.venueName 按载荷现实入契约（weather-ops.ts:178 实发，worker 内部接口 RoundMatchView:47
 *  漏声明属陈旧——登记不改，契约不照抄陈旧声明）。 */
export interface WeatherForecastPreviewMatch {
  matchId: number;
  /** 主队平台俱乐部；tour 主队无映射（CPU 队 / 信息缺失）时为 null */
  homeClubId: number | null;
  homeClubName: string | null;
  awayTeamName: string | null;
  stageName: string | null;
  /** 比赛系统侧是否已完赛 */
  finished: boolean;
  /** 主场球场；无球场行（含 CPU 队）为 null。venueName = 冠名落点名（v6.51.0，无冠名空串） */
  stadium: { name: string | null; capacity: number; tier: number; venueName: string } | null;
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

// ---------------------------------------------------------------------------
// 消费中心域（v6.26.0；routes/shop.ts + shop-ops.ts + routes/admin/shop.ts + core/shop.ts）

/** 价目 12 键：真源 core/shop.ts:154（运行时默认价与类型同处一份），转发不复制。 */
export type { ShopPrices };

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
  /** 名单桶（normal / listed / trainee…）：只用于下拉分组 */
  status: string;
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

/** 工单状态三态：真源 shop_orders.status 列（shop-ops.ts ShopOrderRow / 审批流转写值） */
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
  /** 券抵额（v6.58.0）：实付现金 = amount − voucherUsed */
  voucherUsed: number;
  cashPaid: number | null;
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

/** 管理端工单行（GET /api/admin/shop/orders）：orderDto + clubName ?? null */
export interface AdminShopOrderRow extends ShopOrderDto {
  clubName: string | null;
}

export interface AdminShopOrdersResponse {
  orders: AdminShopOrderRow[];
}

/** 工单提交/代录/审批/拒绝共用回执 `{ order, summary }`（教练端 POST /api/shop/orders
 *  routes/shop.ts:115；管理端代录与 approve/reject routes/admin/shop.ts:71/:83/:96——
 * 甄别 notes P2 随批补具名，web 内联窄版不动）。 */
export interface ShopOrderMutationResult {
  order: ShopOrderDto;
  summary: string;
}
