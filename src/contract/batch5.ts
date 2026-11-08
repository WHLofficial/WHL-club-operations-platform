// 跨端契约类型真源 · 第 5 批：sea / offer / negotiation / transfer
//
// 甄别清单 scratch/contract-audit-batch5.json（2026-11-09）机械清点 49 型，其中 18 型按
// 测试计划 §6.0 跨批归属表让渡、不在本文件重复建形（禁止双真源）：ClubTransferRow 已归
// batch4.ts（第 4 批已迁）；PlayerTransferRow / PlayerTransfersResponse 已归 batch2.ts（第 2 批
// 已迁）；TransferPanelResponse / WorkbenchTransferRow / WorkbenchSearchHit / WorkbenchSearchResult /
// WageForecast / TransferRequestCard / TransferRequestList 已归 batch1.ts（第 1 批已迁）；
// ClubOffer 已归 batch3.ts（第 3 批已迁）；TransferBoardRow / TransferBoardResponse /
// SeaLookupRow / SeaLookupResponse / ForcedAuctionReference / ForcedAuctionBlocker /
// ForcedAuctionPreview / ForcedAuctionResult 归 batch6（市场域，第 6 批随批迁出，api 手抄原地
// 保留到该批）。本文件承载剩余 31 个 disposition=contract 类型 + P2 随批补具名端点回执 5 型，
// 是唯一真源。字段跟随 worker c.json 载荷现实（FieldDiff 处置见各型注释），web/src/lib/api.ts
// 只 re-export 不手抄，worker 侧响应装配点以本文件类型为锚（装配函数 return 标注 / 路由 c.json
// 泛型）。
//
// 本批 worker 锚点（五文件白名单内，同批 1 纪律「worker 删同名定义改 import 契约」）：
//   · bypass.ts：RcChangeResult / TerminationResult / FreeAgentResult / CancelOwnResult
//   · sea-sealed.ts：SeaBatchStatus / SeaBidStatus / SeaBidDto / SeaWinnerDto / SeaBatchDto /
//     SeaPhaseView / SeaSubmitResult / SeaOpenSummary / SeaAdminBidRow / SeaAdminView
//   · offers.ts：OfferSettingsDto（setOfferSettings return）、OfferPlaceResult（placeOffer
//     return Omit 基）、OfferCounterResult / OfferAcceptResult / OfferOkResult
//   · routes/offers.ts：OffersListResponse / OfferDetailResponse / OfferSettingsDto 两端点 +
//     五个动作回执的 c.json 泛型
// 锚点待落登记（真源文件不在本批五文件白名单，留待脚本统一收口 / 后续批次，本批不越界）：
//   NegotiationSession / MyNegotiations / ReleaseFeeResult / OfferResult（worker 内部名
//   OfferOutcome）/ TraineeSignResult ← negotiations.ts；SeaSignEligibility / SeaCompRow /
//   SeaComps ← routes/players.ts（PlayerDetail.seaSign / seaComps 内嵌形状）；SeaExtendResult ←
//   routes/admin/sea-sealed.ts（extendSeaBatch 的路由层映射）；MatchDecisionResult ←
//   activations.ts（worker 内部名 MatchResult）；TransferType 是 transfers.type 的 DB 写值联合
//   （market-settle.ts CASE / bypass.ts 各 create* / desk.ts IN 列表），无单点装配锚。
//
// FieldDiff 处置速览（甄别 9 条，编号按测试计划 §6.6 处置表）：
//   · workerMissing 删字段：#1 RcChangeResult.freeRcChange（C 类；web DeskTab.tsx 死分支随批删除，
//     全六批唯一 web 运行时改动，测试计划 §6.5 B5 验收①）
//   · typeMismatch 收窄：#2-#5 RcChangeResult / TerminationResult / FreeAgentResult /
//     MatchDecisionResult 的 ok 字面 true；#7/#8 OfferDetailResponse.offer.season/windowSeq 加
//     `| null`（v6.29.0 关窗期发起未归窗）
//   · workerExtra 补抄：#6 OfferSettingsDto.ok?: true（仅 PUT 回、GET 不回）
//   · 联合补成员：#9 TransferType 补 'activation'（八成员）
//   · naming：#10 OfferResult ← worker OfferOutcome（字段全同仅名异）
//   · 随批补甄别（甄别清单未记 diff，本批核证 worker 真源后按口径 5 处置）：
//     ① ReleaseFeeResult.ok / TraineeSignResult.ok 收窄字面 true（worker 字面量
//     negotiations.ts:297/:589，api 手抄 boolean 宽松；web 读点均为真值判断，无 `=== false`
//     比较——本会话 web 全仓 grep 实证），收窄零影响
//     ② OfferDetailResponse.offer 拆 Omit<OfferListItem,'counterpart'>（详情装配
//     routes/offers.ts:201-231 从不发 counterpart，api 经 extends 继承出谎言；web 零读取）
//     ③ OfferEventRow.actor.name 放宽 `| null`（actor_club_id 无 FK，0037_offers.sql:35-42；
//     现行写路径观测恒非空；web 只读 actor.id）
//
// 纯类型层：只允许 import type（本文件无外部依赖，自包含）。

// ---------------------------------------------------------------------------
// 报价设置（v6.33.0 / v6.4.0 解耦）：GET/PUT /api/players/:id/offer-settings
// worker 装配：PUT src/worker/offers.ts setOfferSettings；GET src/worker/routes/offers.ts:382-388
// ---------------------------------------------------------------------------

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
  /** FieldDiff #6（workerExtra，B 处置）：PUT 回 ok:true（offers.ts setOfferSettings），
   *  GET 不回该键（routes/offers.ts:382-388）⇒ 可选、恒 true */
  ok?: true;
}

// ---------------------------------------------------------------------------
// 海捞情报（v6.17.0）：球员详情内嵌 seaSign / seaComps（GET /api/players/:id，公开）
// worker 装配：routes/players.ts:1323-1394（seaComps）/:1498（seaSign）——不在本批五文件
// 白名单，锚点待落登记；形状以下方注释所引装配处为准。
// ---------------------------------------------------------------------------

/** 海捞资格判定（v6.17.0；worker seaVerdicts 守卫链同源，routes/players.ts:1498） */
export interface SeaSignEligibility {
  eligible: boolean;
  /** 不可海捞的原因（后端原文）；可签时为 null */
  reason: string | null;
}

/** 海捞成交参照行（v6.17.0；toComp 映射 routes/players.ts:1358-1375） */
export interface SeaCompRow {
  playerId: number;
  playerName: string;
  playerCa: number | null;
  fromClubName: string | null;
  toClubName: string | null;
  newReleaseFee: number | null;
  /** 签入费 = 新违约金 × 30%；fee ≤ 0 的历史行落 null（前端 money(null) 出「—」） */
  signFee: number | null;
  season: number | null;
  windowSeq: number | null;
  completedAt: string | null;
}

export interface SeaComps {
  /** same_tier=同档成交（CA±5 内最近 ≤5 笔）；global=同档空时回落全局最近 3 笔；none=没有参照 */
  scope: 'same_tier' | 'global' | 'none';
  rows: SeaCompRow[];
}

// ---------------------------------------------------------------------------
// 谈判（v6.3.0 起）：GET /api/negotiations?mine=1 与三个动作回执
// worker 装配：negotiations.ts toDto :855-894（routes/negotiations.ts:59 直返）、listMySessions
// :897-901、submitReleaseFee :297-370、offerWage（OfferOutcome）:373-381、chooseTrainee :589-604
// ——negotiations.ts 不在本批五文件白名单，锚点待落登记；形状以上述装配处为准。
// ---------------------------------------------------------------------------

/** 转会单类型（transfers.type 取值；v6.67.0 由 string 收紧为联合）。
 *  FieldDiff #9（B 处置）：worker 实写含 'activation'（激活转会）——market-settle.ts:79 CASE、
 *  desk.ts:214 IN 列表、transfers.ts 文件头 §6.3 分支注释；api 手抄七成员漏抄 ⇒ 契约八成员。 */
export type TransferType =
  | 'transfer'
  | 'activation'
  | 'free_agent'
  | 'match'
  | 'forced_auction'
  | 'rc_change'
  | 'promotion'
  | 'termination';

/** 签约谈判会话（worker toDto，negotiations.ts:855-894）。transfer.type 用 TransferType 标称：
 *  DB 实写含 'activation'（FieldDiff #9 的同源消费点）。 */
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
  /** v6.65.2：静默作废时刻（后端按 anchor + negotiation_silence_hours 算好），卡头倒计时用 */
  expiresAt: string | null;
  lastSatisfaction: string | null;
  lastRisk: boolean;
  attempts: { attemptNo: number; offeredWage: number; result: string; at: string; feedback: string | null }[];
  settled: { wage: number | null; source: string; message: string } | null;
  /** v6.65.4 已结束区：结束时间 / 结局 / 作废原因（进行中的会话三项都是 null，attempts 也只给进行中） */
  endedAt: string | null;
  outcome: 'signed' | 'void' | null;
  voidReason: string | null;
}

/** GET /api/negotiations?mine=1 的响应（v6.65.4 起进行中与已结束分开）：
 *  sessions = 进行中全量；ended = 已结束一页（默认 10 条，按结束时间倒序）；endedNextBefore = 下一页游标 */
export interface MyNegotiations {
  sessions: NegotiationSession[];
  ended: NegotiationSession[];
  endedNextBefore: number | null;
}

/** 提交新违约金回执（POST /api/negotiations/:transferId/release-fee；worker submitReleaseFee，
 *  negotiations.ts:297 `Promise<{ ok: true; releaseFee: number; expectedWage: number }>`）。
 *  随批补甄别：ok 收窄字面 true（worker 字面量，甄别清单未记此 diff）。 */
export interface ReleaseFeeResult {
  ok: true;
  releaseFee: number;
  expectedWage: number;
}

/** 出价回合回执（POST /api/negotiations/:id/offer）。naming（FieldDiff #10，D 处置）：
 *  worker 内部名 OfferOutcome（negotiations.ts:373，offerWage 返回），契约名 = web 名 OfferResult。 */
export interface OfferResult {
  result: 'success' | 'fail' | 'direct' | 'forced';
  attemptNo: number;
  remaining: number;
  wage?: number;
  satisfaction?: string;
  risk?: boolean;
  message?: string;
}

/** 直签训练营回执（POST /api/negotiations/:id/trainee；worker chooseTrainee，
 *  negotiations.ts:589 `Promise<{ ok: true; result: 'trainee'; wage: number; message: string }>`）。
 *  随批补甄别：ok 收窄字面 true（worker 字面量，甄别清单未记此 diff）。 */
export interface TraineeSignResult {
  ok: true;
  result: 'trainee';
  wage: number;
  message: string;
}

// ---------------------------------------------------------------------------
// 旁路转会回执（v0.6.0）：POST /api/transfers/{rc-change,termination,free-agent,cancel}
// worker 装配：bypass.ts（本批锚点已落，worker 删本地同名定义改 import 本文件）
// ---------------------------------------------------------------------------

/** 续约单回执（POST /api/transfers/rc-change，worker createRcChange bypass.ts:229）。
 *  FieldDiff #1（workerMissing，C 处置）：api 手抄的 freeRcChange 字段删除——worker 响应从不携带
 *  {ok,transferId,oldReleaseFee,newReleaseFee,changeFee} 之外的键（bypass.ts:221-227/334）；
 *  免费通道只落 evidence.freeRcChange（bypass.ts:319）供审核侧豁免扣款（:921、routes/transfers.ts
 *  的审核链），HTTP 响应无关。web DeskTab.tsx:639 的 `res.freeRcChange === true` 恒假死分支随本批
 *  删除（两分支从未渲染，删除零可见变化；测试计划 §6.5 B5 验收①，全六批唯一 web 运行时改动）。
 *  FieldDiff #2（A 处置）：ok 收窄字面 true（bypass.ts:222）。 */
export interface RcChangeResult {
  ok: true;
  transferId: number;
  oldReleaseFee: number;
  newReleaseFee: number;
  changeFee: number;
}

/** 解约单回执（POST /api/transfers/termination，worker createTermination bypass.ts:345）。
 *  FieldDiff #3（A 处置）：ok 收窄字面 true（bypass.ts:340）。 */
export interface TerminationResult {
  ok: true;
  transferId: number;
  terminationFee: number;
}

/** 海捞单回执（POST /api/transfers/free-agent，worker createFreeAgent bypass.ts:530）。
 *  FieldDiff #4（A 处置）：ok 收窄字面 true（bypass.ts:524）。 */
export interface FreeAgentResult {
  ok: true;
  transferId: number;
  newReleaseFee: number;
  signFee: number;
}

/** 教练自助取消回执（POST /api/transfers/cancel，worker 同名 CancelOwnResult bypass.ts:454）。
 *  P2 随批补具名（甄别 notes：web SideOps.tsx:299 不接返回，web 内联不动）。 */
export interface CancelOwnResult {
  ok: true;
  status: 'cancelled' | 'rejected';
}

// ---------------------------------------------------------------------------
// 匹配决定（v6.14.0）：POST /api/market/listings/:id/match-decision
// worker 装配：activations.ts MatchResult :185-190（本文件在白名单外，锚点待落登记）
// ---------------------------------------------------------------------------

/** 被激活方的匹配决定回执。naming：worker 内部名 MatchResult，契约名 = web 名 MatchDecisionResult。
 *  FieldDiff #5（A 处置）：ok 收窄字面 true（activations.ts:186）。 */
export interface MatchDecisionResult {
  ok: true;
  decision: 'match' | 'pass';
  newReleaseFee?: number;
  diff?: number;
}

// ---------------------------------------------------------------------------
// 报价 / 议价（/api/offers，全部私有，v6.3.0）：列表 / 详情 / 五个动作回执
// worker 装配：routes/offers.ts（本批锚点已落，c.json 泛型）+ offers.ts（动作 return 标注）
// ---------------------------------------------------------------------------

/** offers.status 取值（worker 无具名联合：写集 = offers.ts 各收口语句 pending/accepted/expired/
 *  intent/rejected/withdrawn，路由过滤白名单 routes/offers.ts:23 同值；intent = 关窗期意向单
 *  v6.29.0）。 */
export type OfferStatus = 'pending' | 'intent' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

/** 报价列表行（worker 装配 routes/offers.ts:104-122；desk.ts:139-156 offerOf 同形） */
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

/** 谈判桌事件行（offer_events 投影，routes/offers.ts:224-230）。actor.name 按载荷现实带 null：
 *  offer_events.actor_club_id 无 FK（0037_offers.sql:35-42，仅注释「NULL = 系统」），LEFT JOIN
 *  clubs 理论可落空；现行写路径恒写真实 club id，观测恒非空。web 全仓只读 actor.id（本会话
 *  grep 实证）→ 放宽零影响。随批补甄别（甄别清单未记此 diff，锚点锁当场暴露）。 */
export interface OfferEventRow {
  kind: string;
  amount: number | null;
  note: string | null;
  at: string;
  actor: { id: number; name: string | null } | null;
}

/** GET /api/offers/:id 响应（routes/offers.ts:201-231）。offer.season / windowSeq 按 FieldDiff
 *  #7/#8（A 处置）为 `number | null`：关窗期发起的单子尚未归窗（v6.29.0，offers.ts:66-67
 *  「NULL = 关窗期发起，尚未归窗」），开窗确认时才写回——api 手抄漏 null 是谎言。
 *  另一随批补甄别（workerMissing，A 处置）：详情装配不发 counterpart（发 buyerClub / sellerClub
 *  两键替代），api 经 `extends OfferListItem` 继承出谎言字段 ⇒ Omit 拆谎；web 全仓零读取
 *  （PlayerTransferPanel.tsx:230 读的是 TransferPanelResponse 自带 counterpart），零 web 影响。 */
export interface OfferDetailResponse {
  offer: Omit<OfferListItem, 'counterpart'> & {
    buyerClub: { id: number; name: string };
    sellerClub: { id: number; name: string };
    season: number | null;
    windowSeq: number | null;
    resolvedAt: string | null;
  };
  events: OfferEventRow[];
}

/** P2 随批补具名（甄别 notes：无 api 命名类型的端点回执，web 内联不动）：
 *  POST /api/offers（routes/offers.ts:255，201）。worker placeOffer 返回 {offerId,status,auto}
 *  （status 实值四枚：offers.ts:243/:253/:259/:267），路由补 ok:true 包装。 */
export interface OfferPlaceResult {
  ok: true;
  offerId: number;
  status: 'pending' | 'intent' | 'accepted' | 'rejected';
  auto: 'auto_accept' | 'auto_reject' | null;
}

/** POST /api/offers/:id/counter 回执（worker counterOffer，offers.ts:275）。 */
export interface OfferCounterResult {
  ok: true;
  amount: number;
  /** 还价轮次（core/offer-rules.ts OfferTurn 同值：'buyer' | 'seller'） */
  turn: 'buyer' | 'seller';
}

/** POST /api/offers/:id/accept 回执（worker acceptOffer，offers.ts:634）：开窗期 accepted 转挂牌、
 *  关窗期 intent 落意向单（v6.29.0）。 */
export interface OfferAcceptResult {
  ok: true;
  status: 'accepted' | 'intent';
  listingId: number | null;
}

/** POST /api/offers/:id/reject 与 /withdraw 共用回执（worker rejectOffer / withdrawOffer，
 *  offers.ts:808/:836，均 {ok:true}）。 */
export interface OfferOkResult {
  ok: true;
}

// ---------------------------------------------------------------------------
// 海捞两阶段 · 暗标段（v6.50.0）：教练侧阶段视图 / 出标回执 + 管理端视图与三个动作
// worker 装配：sea-sealed.ts（本批锚点已落，worker 删本地同名定义改 import 本文件）；
// SeaExtendResult 的路由层映射在 routes/admin/sea-sealed.ts:26-42（白名单外，锚点待落登记）
// ---------------------------------------------------------------------------

/** sea_batches.status（worker sea-sealed.ts:26 逐字同值） */
export type SeaBatchStatus = 'sealed' | 'settling' | 'opened' | 'cancelled';

/** sea_sealed_bids.status（worker sea-sealed.ts:27 逐字同值） */
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

/** 批次摘要（worker SeaPhaseView.batch 内联形状，sea-sealed.ts:149-157/208-217） */
export interface SeaBatchDto {
  id: number;
  season: number;
  windowSeq: number;
  status: SeaBatchStatus;
  sealedAt: string | null;
  deadlineAt: string;
  openedAt: string | null;
}

/** GET /api/transfers/sea-sealed：state off=未启用 / none=不在暗标段 / sealed=收标中 /
 *  closing=已截止等开标 / open=已开标 */
export interface SeaPhaseView {
  enabled: boolean;
  state: 'off' | 'none' | 'sealed' | 'closing' | 'open';
  batch: SeaBatchDto | null;
  /** 我在本批次的标（只有自己可见） */
  myBids: SeaBidDto[];
  /** 最近一次开标的公示（谁以多少胜出） */
  results: SeaWinnerDto[];
}

/** 出标 / 改标回执（POST /api/transfers/sea-sealed，worker submitSealedBid sea-sealed.ts:292） */
export interface SeaSubmitResult {
  ok: true;
  bidId: number;
  playerId: number;
  newReleaseFee: number;
  signFee: number;
  /** 本次是改标（原冻结已刷新）还是首标 */
  updated: boolean;
}

/** 开标回执（管理端立即开标 / 到点 / 关窗钩子共用，worker openSeaBatch sea-sealed.ts:477） */
export interface SeaOpenSummary {
  ok: true;
  batchId: number;
  already: boolean;
  won: number;
  lost: number;
  voided: number;
}

/** 延长暗标段回执（POST /api/admin/sea-sealed/extend；worker extendSeaBatch 返回 SeaBatchRow，
 *  路由层映射 routes/admin/sea-sealed.ts:26-42 出 {ok,batch}。锚点待落登记） */
export interface SeaExtendResult {
  ok: true;
  batch: { id: number; season: number; windowSeq: number; status: SeaBatchStatus; deadlineAt: string; note: string };
}

/** 取消本窗批次回执：全部标作废 + 冻结解冻（worker cancelSeaBatch sea-sealed.ts:902） */
export interface SeaCancelResult {
  ok: true;
  voided: number;
}

/** 管理端逐标行（loadSeaAdminView sea-sealed.ts:741-805：管理端看得到金额与出标方，教练侧看不到） */
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

/** GET /api/admin/sea-sealed 响应（loadSeaAdminView sea-sealed.ts:755-827）。
 *  batch = 教练侧 SeaBatchDto 再加 note / remindedAt 两个管理端字段。 */
export interface SeaAdminView {
  enabled: boolean;
  batch: (SeaBatchDto & { note: string; remindedAt: string }) | null;
  bids: SeaAdminBidRow[];
  summary: { players: number; bids: number; clubs: number; top: number };
}
