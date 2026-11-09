// 跨端契约类型真源 · 第 6 批：market（listings / bids / 激活 / 强拍状态机 DTO）
//
// 甄别清单 scratch/contract-audit-batch6.json（2026-11-09）28 个 disposition=contract 类型，
// 其中 6 型按测试计划 §6.0 跨批归属表让渡、不在本文件重复建形（禁止双真源）：
// MarketRound / MarketOfferRow / MarketRoundResponse / MarketRoundReopenResult 已归 batch3.ts
// （第 3 批已迁，招商轮域）、DeskSummary / TransferPanelResponse 已归 batch1.ts（第 1 批已迁）。
// 本文件承载其余 22 型 + P2 随批补具名回执 4 型，是唯一真源。字段跟随 worker c.json 载荷现实
// （FieldDiff 处置见各型注释），web/src/lib/api.ts 只 re-export 不手抄，worker 侧响应装配点以
// 本文件类型为锚（装配函数 return 标注 / 路由 c.json 泛型）。
//
// 本批 worker 锚点（七文件白名单；desk.ts / admin/brands.ts 已由第 1/3 批锚定，本批无需再动）：
//   · routes/market.ts：feed / 挂牌回执 / rumors / deals / board / sea-lookup / activatable /
//     listingDetailOf（return 标注）/ 出价回执 / 我的出价 / 举报回执 / 凭证地址——c.json 泛型
//   · routes/admin/market.ts：强拍三端点 c.json 泛型
//   · bypass.ts：删本地 ForcedAuctionReference / ForcedAuctionBlocker / ForcedAuctionResult
//     改 import 本文件（同名定义，锚点形态 c）；ForcedAuctionInspection 是 worker 内部名
//     （naming D 处置：契约名 = web 名 ForcedAuctionPreview），保留原名引用契约类型
//   · activations.ts：删本地 ActivationResult 改 import 本文件；submitMatch return 标注为
//     batch5.ts 的 MatchDecisionResult（第 5 批登记的锚点缺口在本批兑现，worker 内部名 MatchResult 退役）
//   · rumors.ts：删本地 RumorItem 改 import 本文件（同名定义，锚点形态 c）
//
// FieldDiff 处置速览（甄别 9 条，编号按测试计划 §6.7 处置表）：
//   · workerExtra 补抄：#1-#5 MarketDealsRow 三快照键 + MarketDealsResponse 分页两键（B 处置，
//     web 只消费 .deals 零影响）
//   · typeMismatch：#6/#7 TransferBoardRow.ca/pa 改 number|null（列可空无 COALESCE，
//     0001_init.sql:12-13；同款白屏先例 = v6.64.2 clubName）——R-WEB 断点见 TransferBoardRow 注
//   · typeMismatch：#9 ForcedAuctionResult.ok 收窄字面 true
//   · naming：#8 ForcedAuctionPreview ← worker 内部名 ForcedAuctionInspection（形状全同）
//   · 随批补甄别（甄别清单未记 diff，本批核证 worker 真源后按口径 5 处置）：
//     ① ActivationResult.ok 收窄字面 true（activations.ts:30 worker 本地声明即是 ok: true）
//     ② BidPlaceResult.ok 收窄字面 true（market.ts:1251 字面量）且 bid 内键是 snake_case
//        created_at（market.ts:1245-1251 原样透传 DB 行，api 手抄的 createdAt 是谎言；web 全仓
//        不读 res.bid——本会话 grep 实证，改键零影响）
//     ③ ListingStatus / MatchPhase 联合真源化（TC-LOCK-07 清单行；MatchPhase 归属 B6，§6.0 固定）
//
// 纯类型层：只允许 import type（本文件自包含，无外部依赖）。

// ---------------------------------------------------------------------------
// 挂牌状态机（GET /api/market/listings 全家 + 出价 / 结算链）
// ---------------------------------------------------------------------------

/** listings.status 五值（worker LISTING_STATUSES，routes/market.ts:50 逐字同值）：
 *  listed=在售 / bidding=竞价中 / matched_pending=等被激活方匹配 / pending_review=待审核 / delisted=已下架 */
export type ListingStatus = 'listed' | 'bidding' | 'matched_pending' | 'pending_review' | 'delisted';

/** 激活单撮合相位（worker 只在 type==='activation' 分支产出，非激活单恒 null——routes/market.ts:200-207
 *  与 listingDetailOf:975-982 同一 ternary）。'bidding' 不在此列：那是出价回执 BidPlaceResult.matchPhase
 *  的专用值（激活首价落定即转入公开竞价的去向标记，api 侧历来分开声明）。 */
export type MatchPhase = 'first_bid' | 'matching' | null;

/** 挂牌行公共核（18 字段）：feed（GET /api/market/listings）与详情 / 转会浮层（listingDetailOf
 *  routes/market.ts:914-994，desk.ts:302 复用同一装配）逐字共用——拆基型消手抄分叉
 *  （测试计划 §6.7 #12，甄别 highlights 末条「勿各自手抄分叉」）。不含 feed 专有的 bidCount。 */
export interface MarketListingBase {
  id: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null };
  /** 卖家；id null = 无归属（强制拍卖可对自由身发起，v6.60.5） */
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
  activatedBy: number | null;
  activationDeadline: string | null;
  matchDeadline: string | null;
  matchPhase: MatchPhase;
  firstBidPending: boolean;
  /** 截止绝对时刻（v6.4.0）：优先落库列，存量行 NULL 回落实时算；激活首价窗豁免（看 activationDeadline） */
  deadlineAt: string | null;
  deadlineNote: string | null;
}

/** 转会区 feed 行 = 公共核 + bidCount（feed 专有：LEFT JOIN 分组子查询 bid_total ?? 0，
 *  routes/market.ts:196；详情装配 listingDetailOf 不算 bidCount）。 */
export interface MarketListing extends MarketListingBase {
  bidCount: number;
}

export interface MarketListings {
  listings: MarketListing[];
  cursor: number | null;
}

/** GET /api/market/listings/:id 响应（listingDetailOf 装配，routes/market.ts:914-994）。
 *  ⚠️ 登记 registered（甄别 FieldDiff B1 #1 / 计划 §6.7 #12 的未竟部分）：listing 上的 bidCount
 *  键是 workerMissing——listingDetailOf 从不下发它（只有 feed 才有），api 手抄经 extends 继承出谎言；
 *  本应随本批拆基型删掉，但 web 有两处类型级消费压着它（MarketListingOverlay.tsx:192 OverlayBody
 *  形参 = MarketListing & {…}、PlayerTransferPanel.test.tsx:47 夹具字面量 bidCount:2），两文件均
 *  在第 6 批白名单外、R-WEB 防线与夹具授权未随本批 ask 下发 ⇒ 按 ask ⑤「workerMissing 且前端真在
 *  消费：不改行为、记入 registered」保留键原状（与 batch1.ts TransferPanelListing 同款处置）。
 *  web 运行时读点为零（读的是 feed，MarketBoardPage.tsx:261）。 */
export interface MarketListingDetail {
  marketBidPaused: boolean;
  listing: MarketListing & {
    /** 现行合同违约金（无合同 null） */
    releaseFee: number | null;
    windowOpen: boolean;
    /** 最低可出价 = ceil(最高价+步长) / ceil(挂牌价)（评审修复 P2-②，整数准入） */
    nextMinBid: number;
    bidStepMin: number;
    /** 激活方队名（首价窗提示用）；无激活方 null */
    activatorName: string | null;
  };
  /** 出价历史（最近 50 笔，b.id DESC） */
  bids: { id: number; clubId: number; clubName: string; amount: number; createdAt: string; status: string }[];
}

// ---------------------------------------------------------------------------
// 激活挂牌（4.4.2）：POST /api/market/activations（market.ts:830 转发 createActivation）
// ---------------------------------------------------------------------------

/** FieldDiff（随批补甄别）：ok 收窄字面 true——worker 本地声明即是 ok: true（activations.ts:30），
 *  api 手抄的 boolean 宽松；web 消费点只读 listingId/askPrice/kind/firstBidDeadline 与 res.ok
 *  真值判断（MarketListingOverlay.tsx:80），收窄零影响。 */
export interface ActivationResult {
  ok: true;
  listingId: number;
  askPrice: number;
  kind: 'trainee' | 'normal';
  /** 激活方落首价的绝对截止时刻 */
  firstBidDeadline: string;
}

// ---------------------------------------------------------------------------
// 出价（POST /api/market/listings/:id/bids，market.ts:1251）与我的出价（GET /api/me/bids）
// ---------------------------------------------------------------------------

/** FieldDiff（随批补甄别，甄别清单未记）：① ok 收窄字面 true（worker 字面量）；② bid 内键按
 *  载荷现实是 snake_case created_at——worker 把 DB 行原样透传（market.ts:1245-1248 .first 行类型
 *  {id, amount, created_at} → :1251 c.json 直接 spread），api 手抄的 createdAt: string 是谎言键；
 *  web 全仓不读 res.bid（MarketActivationPage / MarketListingOverlay / PlayerTransferPanel 三处
 *  apiPost<BidPlaceResult> 调用点本会话逐点核证），改键零影响。 */
export interface BidPlaceResult {
  ok: true;
  bid: { id: number; amount: number; created_at: string };
  /** 落定后刷新的绝对截止时刻（激活首价落定即转入公开竞价，同口径刷新；存量无 listed_day 时为 null） */
  deadlineAt: string | null;
  /** 激活单落首价后的去向（v6.24.0）：bidding = 已转入公开竞价，截止后由结算按合同类型分流 */
  matchPhase?: 'bidding';
}

/** 我的出价行（GET /api/me/bids，market.ts:1300-1311）。响应容器 {club,bids} 无具名契约类型
 *  （甄别 notes：web queries.ts 内联），worker 锚点 = 行级 map 标注（routes/market.ts）。 */
export interface MyBidRow {
  id: number;
  listingId: number;
  amount: number;
  createdAt: string;
  status: string;
  /** fund_holds.status 三值（0001_init.sql 注释）；无资金冻结行（LEFT JOIN 落空）时 null */
  holdStatus: 'held' | 'released' | 'settled' | null;
  listingStatus: ListingStatus;
  askPrice: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; ca: number | null; pa: number | null };
  /** COALESCE(cl.name,'自由身')：强制拍卖对自由身发起时卖家名兜底 */
  sellerClubName: string;
}

// ---------------------------------------------------------------------------
// 市场情报（v6.18.0）：传闻 / 最近成交（GET /api/market/rumors、/deals，公开）
// ---------------------------------------------------------------------------

/** 转会传闻（GET /api/market/rumors，公开）：系统按窗口派生，真真假假，不下发真假字段；
 *  id 是种子派生的稳定 id（rumors.ts，r{season}-{window}-{slot}），同窗载荷恒定 */
export interface RumorItem {
  id: string;
  text: string;
  /** 内嵌链接目标：玩家点过去自行查证真假 */
  playerId: number;
  playerName: string;
  clubName: string;
}

export interface RumorsResponse {
  rumors: RumorItem[];
}

/** 已达成交易行（GET /api/market/deals，公开，completed_at 倒序默认 ≤50 条）。
 *  FieldDiff #1-#3（workerExtra，B 处置）：playerLevel / playerRole / snapshotSource = 0093 成交
 *  快照三键（routes/market.ts:477-479，未回填/未写入为 null；snapshot_at 只落库不下发），api 手抄
 *  全没抄——web 只读 11 个老字段（MarketIntelPage.tsx:105-129 本会话核证），补抄零影响。 */
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
  /** 0093 成交快照：成交时 CA 档（未回填 null） */
  playerLevel: number | null;
  /** 0093 成交快照：成交时角色 */
  playerRole: string | null;
  /** 0093 成交快照：快照来源（未回填 null） */
  snapshotSource: string | null;
}

/** FieldDiff #4/#5（workerExtra，B 处置）：nextCursor / hasMore = model-refit Phase 3 公开分页
 *  （routes/market.ts:481-482，base64(completed_at|id) 游标），api 手抄没抄；web 只取 .deals
 *  （queries.ts:431），补抄零影响。 */
export interface MarketDealsResponse {
  deals: MarketDealsRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// 转会广告板（GET /api/market/transfer-board，公开，v6.31.0）与海捞速查（/sea-lookup，教练）
// ---------------------------------------------------------------------------

/** 转会广告板行（GET /api/market/transfer-board，公开，v6.31.0）：只收 `players.transfer_listed = 1`。
 *  与 /api/players 列表的差别：这里**下发公开标价数值 listPrice**（v6.33.0；最低报价转全系统私密），
 *  并带着重度与挂出时间。
 *  FieldDiff #6/#7（typeMismatch，A 处置）：ca / pa 为 `number | null` —— SQL 直读 p.ca/p.pa 无
 *  COALESCE（routes/market.ts:544/:609-610），列可空（0001_init.sql:12-13），api 手抄的非空 number
 *  是谎言（同文件 :1453 注释刚记过 clubName 同类白屏坑，v6.64.2）。
 *  ⚠️ R-WEB 断点（本批登记，未实施）：web 消费点 MarketAdBoardPage.tsx:54/:58/:163 的
 *  attrClass(row.ca/row.pa) 形参是 number，契约可空化后四处调用 typecheck 红——补 `?? '—'` 或
 *  null 分支防线的文件不在第 6 批白名单，防线与 TC-B6-01 夹具测试登记 deferred。 */
export interface TransferBoardRow {
  id: number;
  uid: string;
  fcId: number | null;
  name: string;
  positions: string[];
  age: number | null;
  ca: number | null;
  pa: number | null;
  clubId: number | null;
  /** v6.64.2：端点已排除无东家的球员（club_id 为空不进名单），但类型必须照真实载荷写——
   *  旧类型声明的 string 让「队名 null」骗过了 typecheck，直接在 TeamLogo 里抛错白屏。 */
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
  /** 资格判定 = seaVerdicts 七关链（player-flow-state.ts），与球员详情 seaSign / createFreeAgent 同源 */
  seaSign: { eligible: boolean; reason: string | null };
}

export interface SeaLookupResponse {
  results: SeaLookupRow[];
}

// ---------------------------------------------------------------------------
// 可激活球员（GET /api/market/activatable，教练，v6.18.0）
// ---------------------------------------------------------------------------

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
  /** contracts.contract_type 二值（0001_init.sql:59 列注释 formal/trainee） */
  contractType: 'formal' | 'trainee';
  /** 激活费：训练营固定 5m，正式球员按违约金与保护期计；正式合同缺违约金时为 null（不可激活） */
  activationFee: number | null;
  activatedThisWindow: boolean;
  /** 刚签约（服务刻度内）：本窗不能被激活 */
  justSigned: boolean;
}

export interface ActivatableResponse {
  /** 未绑队回 {club:null, players:[]}（routes/market.ts:722） */
  club: { id: number; name: string } | null;
  players: ActivatablePlayer[];
}

// ---------------------------------------------------------------------------
// 强制拍卖状态机 DTO（规则 4.4.5，v6.51.0；worker 装配 bypass.ts:594-645，路由 admin/market.ts）
// ---------------------------------------------------------------------------

/** 人选参考值（v6.51.0：队内非门将 CA 前六只作参考，不再强制） */
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

/** 现在挂牌会被拒的原因（按闸门顺序；空数组 = 可挂） */
export interface ForcedAuctionBlocker {
  status: number;
  message: string;
  errCode?: string;
}

/** GET /api/admin/forced-auctions/preview：人选参考 + 现在挂出会被拒的原因。
 *  FieldDiff #8（naming，D 处置）：worker 内部名 ForcedAuctionInspection（bypass.ts:621），
 *  契约名 = web 名 ForcedAuctionPreview，形状 {reference, blockers} 全同。 */
export interface ForcedAuctionPreview {
  reference: ForcedAuctionReference;
  blockers: ForcedAuctionBlocker[];
}

/** POST /api/admin/forced-auctions 回执（createForcedAuction bypass.ts:627-632）。
 *  FieldDiff #9（typeMismatch，A 处置）：ok 收窄字面 true（worker 字面量）。 */
export interface ForcedAuctionResult {
  ok: true;
  listingId: number;
  askPrice: number;
  reference: ForcedAuctionReference;
}

// ---------------------------------------------------------------------------
// P2 随批补具名（甄别 notes：无 api 命名类型的在役回执，web 内联消费不动）
// ---------------------------------------------------------------------------

/** POST /api/market/listings 回执（routes/market.ts:347，201）：挂牌成功回执。web SideOps.tsx:888
 *  内联消费（漏了 ok），内联不动。 */
export interface MarketListingCreateResult {
  ok: true;
  listingId: number;
  /** 本次挂牌价的规则区间（违约金/身价五折取低且 ≥1m ～ 违约金 1.5 倍） */
  min: number;
  max: number;
}

/** POST /api/admin/forced-auctions/:id/cancel 回执（cancelForcedAuction bypass.ts:817）。
 *  web MarketPage.tsx:701 无类型，内联不动。 */
export interface ForcedAuctionCancelResult {
  ok: true;
}

/** POST /api/market/listings/:id/activation-report 回执（routes/market.ts:878，201）：
 *  只建管理核查任务，不改挂牌状态、不冻结匹配窗（v6.4.0 改动 4）。 */
export interface ActivationReportResult {
  ok: true;
}

/** GET /api/market/listings/:id/proof 回执（routes/market.ts:897）：激活凭证 R2 地址。
 *  可见范围 = 卖方俱乐部 + 管理员；公开 feed 不带此字段（匿名端点不公开 QQ 截图）。 */
export interface ListingProofResponse {
  url: string;
}
