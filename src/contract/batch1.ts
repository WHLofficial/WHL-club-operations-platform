// 跨端契约类型真源 · 第 1 批：workbench + demand（转会台聚合 + 球员要求收件箱）
//
// 甄别清单 scratch/contract-audit-batch1.json（2026-11-09）：本文件 23 个 disposition=contract
// 类型 + P2 随批补抄 WorkbenchProofResponse 是唯一真源；字段跟随 worker c.json 载荷现实
// （FieldDiff 处置见各型注释），web/src/lib/api.ts 只 re-export 不手抄，worker 侧响应装配点
// 以本文件类型为锚（装配函数 return 标注 / 路由 c.json 泛型）。
// 命名口径（甄别 naming 17 条）：契约名 = web/api 名（web 全仓按名 import，保旧零改动）；
// worker 内部名（WorkbenchListing / DemandCard / PendingContractView / SearchHit 等）不动，
// 对应关系见各型注释。
// 纯类型层：只允许 import type（来源限本目录与 src/core），禁止任何运行时导出。

// ---------------------------------------------------------------------------
// 转会台（desk / workbench 前台）
// ---------------------------------------------------------------------------

/** 转会台待办汇总（v6.73.0 期 B）：GET /api/market/desk/summary；导航角标 / 桌内待办条共用；
 *  未绑队回全 0（desk.ts EMPTY 字面量）。worker 侧无内部别名，形状即字面。 */
export interface DeskSummary {
  negotiations: number;
  offers: number;
  bids: number;
  total: number;
}

/** 转会浮层 offers 成员行：worker desk.ts offerOf 装配，与 offers 域 OfferListItem（api 手抄）
 *  逐字段一致。status/turn 值域甄别核实归 offers 批（B5）复核——B5 契约落地后本型应改引用
 *  offers 域契约单源，不在此复制命名联合（契约内部辅助型，不出 barrel）。 */
interface TransferPanelOffer {
  id: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; ca: number | null; pa: number | null; listPrice: number | null };
  counterpart: { id: number; name: string };
  role: 'buyer' | 'seller';
  amount: number;
  initAmount: number;
  round: number;
  note: string | null;
  status: 'pending' | 'intent' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
  turn: 'buyer' | 'seller';
  myTurn: boolean;
  listingId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 转会浮层 listing 成员：worker 走 listingDetailOf 装配（market.ts，与 GET /market/listings/:id
 *  详情同口径）+ marketBidPaused。契约内部辅助型（不出 barrel）：
 *  ① bidCount 键的甄别 FieldDiff #1（workerMissing）按「登记 registered、保留必填键原状」处置
 *     —— web 两处类型级消费在本批白名单外，真删除随 B6 拆 MarketListingBase 基型联动，见键注；
 *  ② status / matchPhase 两处字面联合随 B6 的 ListingStatus / MatchPhase 契约命名化后改引用
 *     （甄别核实 worker 全部写值与联合无失配）。 */
interface TransferPanelListing {
  id: number;
  player: { id: number; fcId: number | null; name: string; position: string | null; age: number | null; ca: number | null; pa: number | null };
  sellerClub: { id: number | null; name: string };
  type: string;
  askPrice: number;
  status: 'listed' | 'bidding' | 'matched_pending' | 'pending_review' | 'delisted';
  listedAt: string;
  lastBidAt: string | null;
  bidPaused: boolean;
  highestBid: number | null;
  /** 领先出价方：active 出价的俱乐部，出价历史里每单至多一条 active */
  highestBidder: { id: number; name: string } | null;
  /** ⚠️ 甄别 FieldDiff #1（workerMissing，已登记 registered）：worker 该路径（listingDetailOf 装配）
   *  不下发 bidCount，只有 feed（GET /market/listings）才有；api 手抄经 MarketListingDetail['listing']
   *  继承出的必填键是谎言。但 web 有两处类型级消费都压着它：PlayerTransferPanel.tsx:112 把本型
   *  传进 canBidOf（形参 = MarketListingDetail['listing']，要求 bidCount:number）、
   *  PlayerTransferPanel.test.tsx:47 夹具字面量写 bidCount:2（既有测试文件零改动硬线）——两个文件
   *  均在第 1 批文件白名单外，且拆基型（MarketListingBase）按计划归 B6 联动 ⇒ 本批保留必填键
   *  原状并登记，真删除随 B6 拆基型 + 夹具授权一并落地。web 运行时读点为零（读的是 feed）。 */
  bidCount: number;
  activatedBy: number | null;
  activationDeadline: string | null;
  matchDeadline: string | null;
  /** 激活单的撮合相位；worker 只在 type==='activation' 分支产出，非激活单恒 null */
  matchPhase: 'first_bid' | 'matching' | null;
  firstBidPending: boolean;
  deadlineAt: string | null;
  deadlineNote: string | null;
  releaseFee: number | null;
  windowOpen: boolean;
  nextMinBid: number;
  bidStepMin: number;
  activatorName: string | null;
  marketBidPaused: boolean;
}

/** 球员转会浮层（v6.74.0 期 C，设计 §6.1）：GET /api/players/:id/transfer-panel。
 *  球员页状态条 / 浮层 / 转会台行展开共用一份响应；未绑队回公开部分（club=null、个人数组空集）。
 *
 *  甄别 FieldDiff #2（typeMismatch）：negotiation.settled.wage 契约为 number | null ——
 *  worker 行类型 settled_wage:number|null 原样下发未收窄（desk.ts）；全部 settle 写路径都绑定
 *  wage、运行时实际非空，api 手抄的 `number` 收不得（且与 NegotiationSession.settled.wage 的
 *  number|null 手抄互相矛盾）。web 读点为零（grep 证），无需防线。 */
export interface TransferPanelResponse {
  club: { id: number; name: string } | null;
  player: {
    id: number;
    fcId: number | null;
    name: string;
    position: string | null;
    age: number | null;
    ca: number | null;
    pa: number | null;
    clubId: number | null;
    clubName: string | null;
    isMine: boolean;
    status: string;
  };
  /** 在流程内的最新一单；没有则回落最新已结束单；从未挂牌为 null（形状见 TransferPanelListing） */
  listing: TransferPanelListing | null;
  /** 该挂牌的出价历史（最近 50 笔，b.id DESC） */
  bids: { id: number; clubId: number; clubName: string; amount: number; createdAt: string; status: string }[];
  /** 我的出价（b.club_id 圈定，独立查询——别家更早的价不会把我挤出窗口）；
   *  holdStatus 联合 = fund_holds.status 三值（0001_init.sql 注释）+ 无资金冻结行时 null（甄别核实无失配） */
  myBids: {
    id: number;
    listingId: number;
    amount: number;
    createdAt: string;
    status: string;
    holdStatus: 'held' | 'released' | 'settled' | null;
  }[];
  /** 报价 in（我是卖方）/ out（我是买方）各最多 20 条：合成一条会让一侧饿死 */
  offers: { in: TransferPanelOffer[]; out: TransferPanelOffer[] };
  /** 只回我作为买方的会话摘要（attempts 全文留在谈判页签） */
  negotiation:
    | {
        id: number;
        status: 'active' | 'settled' | 'cancelled';
        releaseFee: number | null;
        expectedWage: number | null;
        attemptsUsed: number;
        remaining: number;
        /** 静默作废时刻：anchor + negotiation_silence_hours；无锚 null */
        expiresAt: string | null;
        /** settled 行的口径与文案；wage 见型注 FieldDiff #2 */
        settled: { wage: number | null; source: string; message: string } | null;
      }
    | null;
  /** 最近一张已完成的转会单（type 在五类之内、to_club_id 非空） */
  transfer:
    | {
        id: number;
        type: string;
        fee: number | null;
        fromClubId: number | null;
        fromClubName: string | null;
        toClubId: number | null;
        toClubName: string | null;
        completedAt: string | null;
      }
    | null;
  asOf: string;
}

// ---------------------------------------------------------------------------
// 审核工作台（workbench，v6.68.2 期 C）
// ---------------------------------------------------------------------------
// 五张在途表 + 搜索兜底，一次取全。worker 内部名 ↔ 契约名别名（甄别 naming 6 条）：
// WorkbenchListing→WorkbenchListingRow、WorkbenchBid→WorkbenchBidRow、WorkbenchSession→
// WorkbenchSessionRow、WorkbenchTransfer→WorkbenchTransferRow、WorkbenchForced→
// WorkbenchForcedRow、SearchHit→WorkbenchSearchHit；生产锚点 = workbench.ts 的
// loadInFlight / searchWorkbench return 标注（admin/workbench.ts 两端点原样 c.json 透传）。

/** 在途挂牌行（worker 内部名 WorkbenchListing，workbench.ts:13） */
export interface WorkbenchListingRow {
  id: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  sellerClubId: number | null;
  sellerClubName: string;
  type: string;
  status: string;
  askPrice: number;
  highestBid: number | null;
  bidCount: number;
  bidPaused: boolean;
  deadlineAt: string | null;
  hasProof: boolean;
}

/** 在途出价行（worker 内部名 WorkbenchBid，workbench.ts:30） */
export interface WorkbenchBidRow {
  id: number;
  listingId: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  clubId: number;
  clubName: string;
  amount: number;
  createdAt: string;
}

/** 在途谈判会话行（worker 内部名 WorkbenchSession，workbench.ts:42） */
export interface WorkbenchSessionRow {
  id: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  clubId: number;
  clubName: string;
  transferId: number;
  releaseFee: number | null;
  expectedWage: number | null;
  attemptCount: number;
  expiryAnchorAt: string | null;
}

/** 在途转会单行（worker 内部名 WorkbenchTransfer，workbench.ts:56） */
export interface WorkbenchTransferRow {
  id: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  fromClubId: number | null;
  fromName: string;
  toClubId: number | null;
  toName: string;
  type: string;
  status: string;
  fee: number | null;
  createdAt: string;
}

/** 强制拍卖行（worker 内部名 WorkbenchForced，workbench.ts:71；不过 CPU 过滤） */
export interface WorkbenchForcedRow {
  listingId: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  sellerClubId: number | null;
  sellerClubName: string;
  status: string;
  askPrice: number;
  highestBid: number | null;
  bidPaused: boolean;
  deadlineAt: string | null;
}

/** 五张在途表一次取全：GET /api/admin/workbench/in-flight（worker loadInFlight return 标注锚点）。
 *  每表上限 50，超出由前端显示「50+」；hidden = 默认隐藏 CPU 时四张转会类表各被藏掉多少条
 *  （强拍表不过滤，不在内）。 */
export interface WorkbenchInFlight {
  listings: WorkbenchListingRow[];
  bids: WorkbenchBidRow[];
  sessions: WorkbenchSessionRow[];
  transfers: WorkbenchTransferRow[];
  forced: WorkbenchForcedRow[];
  counts: { listings: number; bids: number; sessions: number; transfers: number; forced: number };
  /** 默认隐藏 CPU 时，四张转会类表各被藏掉多少条（强拍表不过滤，所以不在内） */
  hidden: { listings: number; bids: number; sessions: number; transfers: number };
}

/** 工作台搜索命中（worker 内部名 SearchHit，workbench.ts:356）：GET /api/admin/workbench/search */
export interface WorkbenchSearchHit {
  kind: 'player' | 'club' | 'listing' | 'bid' | 'negotiation' | 'transfer';
  id: number;
  label: string;
  sublabel?: string;
}

/** GET /api/admin/workbench/search 响应容器（空态 {results:[]} 与有结果态同形） */
export interface WorkbenchSearchResult {
  results: WorkbenchSearchHit[];
}

/** GET /api/admin/workbench/proof/:listingId 回执（P2 随批补具名：甄别 notes「具名覆盖缺口，
 *  迁移时需补」；web 页面现用内联 api<{url:string}>，保旧不动）。 */
export interface WorkbenchProofResponse {
  url: string;
}

// ---------------------------------------------------------------------------
// 球员要求 / 双版本合同投影（demand，v6.54.0）
// ---------------------------------------------------------------------------

/** 待生效合同变更（worker 内部名 PendingContractView，demand-ops.ts:1859）。
 *  下发路 = GET /api/club/pending-contracts（整包 pending 数组）、GET /api/players/:id 的
 *  contractPending、GET /api/club/squad 的 pendingSummary 投影。只对本队教练下发（§10.4 权限）。 */
export interface ContractPendingView {
  playerId: number;
  playerName: string | null;
  /** demand=球员要求 / renewal=普通续约 / rejection=直拒后的保护期调整 */
  source: 'demand' | 'renewal' | 'rejection';
  /** 来源要求行（只有 demand/rejection 有） */
  demandId: number | null;
  /** 现行合同旧值（对比列左侧） */
  wageCurrent: number;
  releaseFeeCurrent: number | null;
  protectionTicksCurrent: number | null;
  /** 关窗后的新值；releaseFee / protectionTicks 为 null = 该项不变（0079 注释，非「没值」） */
  wage: number;
  releaseFee: number | null;
  protectionTicks: number | null;
  /** 该 pending 在哪一窗关闭时生效（表里只有窗序号，没有赛季列） */
  effectiveWindowSeq: number;
  rcFee: number;
  freeRcChange: boolean;
}

/** 已生效待通知态（§10.4「已生效态」：生效后首个窗口内顶部一行小字，下一窗消失；直拒档不产生）。
 *  worker 内部名 AppliedContractView（demand-ops.ts:1950）；下发路 = GET /api/players/:id 的 contractApplied。 */
export interface ContractAppliedNotice {
  source: ContractPendingView['source'];
  appliedAt: string;
  /** 只在 demand 来源有（contract_demands.current_wage 存了提要求时的旧工资）；
   *  renewal 走审批单、表里不存旧值 ⇒ null，前端退回不带旧值的文案 */
  oldWage: number | null;
}

/** 球员要求/转会申请的当前窗状态（球员页 SideOps 四态块与续约禁用矩阵）。
 *  worker 真源 = loadPlayerContractState（PlayerContractState）在 routes/players.ts:1488-1496
 *  的四字段投影（去掉 pending/applied，那两块拆到 contractPending/contractApplied）；
 *  demand/transferRequest 内联形状即 worker PlayerDemandView / PlayerTransferRequestView。
 *  锚点缺口（登记）：投影装配点 players.ts 归 B2 文件范围，本批未接线，B2 落地时补
 *  c.json 泛型锚。 */
export interface PlayerDemandState {
  /** 当前开窗窗口；无开窗 null */
  window: { season: number; windowSeq: number } | null;
  /** 当前窗的要求行（void 不返回——B 分支占位行没有可展示的面） */
  demand:
    | {
        id: number;
        status: string;
        resolution: string | null;
        currentWage: number;
        targetWage: number;
        floorWage: number;
        rcCurrent: number;
        rcFloor: number;
        round: number;
        maxRounds: number;
        expiresAt: string;
        appliedAt: string | null;
        /** 最近一轮还价（SideOps「上轮你出 X 未成」）；没有还价记录 null */
        lastCounterWage: number | null;
      }
    | null;
  /** 本窗任意状态（含 expired / void 占位）是否存在要求行：续约禁用矩阵的硬判据 */
  demandThisWindow: boolean;
  /** 本窗存续转会申请（pending/listed/released 任取最新一条）；没有 null */
  transferRequest: { id: number; status: string; source: string; listingId: number | null } | null;
}

/** GET /api/club/pending-contracts（v6.54.0 步骤 7）：球队页阵容小字的数据源。
 *  独立端点天然按会话鉴权、不落公开缓存（塞进公开的 /api/players 会踩 §10.4 权限）。 */
export interface PendingContractsResponse {
  pending: ContractPendingView[];
}

/** 逐轮记录（卡内对话流的「你的每次还价 + 他的当场回应」）。
 *  worker 内部名 DemandAttemptView（demand-ops.ts:1569）；wage=经理本轮还价，accepted=球员判定。 */
export interface ContractDemandAttempt {
  /** 第几轮还价（1 起；UNIQUE(demand_id, round)） */
  round: number;
  /** 经理本轮还价（球员不还价，只判定） */
  wage: number;
  accepted: boolean;
  at: string;
}

/** 收件箱卡（§10.1 对话流卡的字段契约；金额单位 m）。worker 内部名 DemandCard
 *  （demand-ops.ts:1578，装配 toCard）。expected_wage 刻意不下发——界面口径是「市场价」
 *  不显示精确值（§2.1），floor 下发（本队教练可见，还价防呆需要，§7）。 */
export interface ContractDemandCard {
  id: number;
  playerId: number;
  playerName: string | null;
  position: string | null;
  age: number | null;
  ca: number | null;
  season: number;
  windowSeq: number;
  /** pending/countered=待处理（后者只是存量行兼容）；accepted；rejected；expired；void（不出收件箱） */
  status: string;
  /** 终局来源：direct=明确放人 / collapse=3 轮谈崩 / lowball=低于底线 / expired=过期；非终局 null */
  resolution: string | null;
  currentWage: number;
  targetWage: number;
  floorWage: number;
  raisePct: number;
  rcCurrent: number;
  /** 待生效违约金 floor；0 = 无 RC（wage-only，还价不涉及违约金行） */
  rcFloor: number;
  round: number;
  maxRounds: number;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  /** 已接受行关窗 apply 后置值；null = 待生效 */
  appliedAt: string | null;
  attempts: ContractDemandAttempt[];
}

/** wageContext（§7）：接受确认弹窗超帽警示的三个输入（§10.1 分组头 pill 同源）。
 *  worker 内部名 WageContext（demand-ops.ts:1608）。wageCap=null 表示未定级/派生异常，前端不画帽线。 */
export interface DemandWageContext {
  /** 当前窗 Σ active 合同工资（m/窗） */
  currentTotal: number | null;
  /** 已接受未生效增量 Σ(pending.wage_new − 现行 wage)——闹涨薪与普通续约的 pending 一并计入（§10.5 同口径） */
  pendingDelta: number | null;
  /** 工资帽（按级别派生，squad-context 同口径）；未定级/无可用赛季/派生异常为 null */
  wageCap: number | null;
}

/** 球员要求收件箱：GET /api/club/contract-demands（worker 内部名 ClubDemandInbox，
 *  demand-ops.ts:1617，装配 listClubDemands）。只读本俱乐部（club_id 圈定）；
 *  void（离队作废）不出本表——作废发生在球员离队之后，教练经站内信与审计面看（§10.4 的澄清）。 */
export interface ContractDemandInbox {
  /** 当前开窗的待处理（新/谈判中），按剩余时间升序（§10.1 排序）；无开窗 = 空组（窗外不可操作） */
  active: ContractDemandCard[];
  /** 已接受待生效（关窗 apply 前，applied_at 为空） */
  accepted: ContractDemandCard[];
  /** 最近终局（expired/rejected，供对话流收口与后果态渲染），resolved_at 降序截尾 */
  recent: ContractDemandCard[];
  wageContext: DemandWageContext;
}

/** POST /api/club/contract-demands/:id/counter 的同请求即时判定结果（§5.3）。
 *  worker 内部名 CounterDemandResult（demand-ops.ts:775）；negotiating 不是持久态，
 *  落在卡上=还价记录 + 轮次。 */
export interface DemandCounterResult {
  demandId: number;
  verdict: 'accepted' | 'negotiating' | 'rejected';
  /** rejected 终局的档位：collapse=3 轮谈崩 / lowball=低于底线；其余 null */
  source: 'collapse' | 'lowball' | null;
  acceptedWage: number | null;
  /** 本轮轮次（1 起） */
  round: number;
  /** 本轮衰减后的球员期望 */
  eff: number;
  /** 本轮判定所用成功率 */
  p: number;
  /** 段内第 2 次终局升档（谈崩/低还价也走直拒三件套，§5.4.4） */
  escalated: boolean;
}

/** POST /api/club/contract-demands/:id/accept 回执（worker 内部名 AcceptDemandResult，
 *  demand-ops.ts:985）。接受 target + rc_floor：写 pending 变更（source='demand'、rc_fee=0），
 *  不收费、不走同队转会。 */
export interface DemandAcceptResult {
  demandId: number;
  /** 成交工资 = 开场要价 target（§5.3「经理接受 target」） */
  wage: number;
  /** 待生效违约金（wage-only 行为 null=不变） */
  releaseFee: number | null;
}

/** 存续转会申请行（GET /api/club/transfer-requests；worker 与 api 同名 TransferRequestCard，
 *  demand-ops.ts:1831，装配 listClubTransferRequests）。released 一并返回：直拒档的「不满」
 *  徽章以它为载体（存续直到重签/离队，§5.4）；resolved=已关闭不进列表。 */
export interface TransferRequestCard {
  id: number;
  playerId: number;
  playerName: string | null;
  demandId: number | null;
  /** 终局来源：direct=明确放人 / collapse=3 轮谈崩 / lowball=低于底线（§5.4 梯度输入） */
  source: string;
  /** pending=申请挂起 / listed=已挂牌 / released=「不满」徽章存续（直拒档后果载体） */
  status: string;
  listingId: number | null;
  lastListingWindowSeq: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** GET /api/club/transfer-requests 响应容器（worker 内部名 ClubTransferRequestList，demand-ops.ts:1846） */
export interface TransferRequestList {
  requests: TransferRequestCard[];
}

/** 工资预览（E 类双用合一，甄别 naming 末条注明）：forecast 是服务端按 0.2/0.5/0.8 量化出的
 *  成功率档位（四档文案只在 worker 侧维护），risk = 报价过低有谈崩风险的危险后缀开关。
 *  双用端点：POST /api/negotiations/:sessionId/preview（v6.40.0 签约谈判 previewWage）与
 *  POST /api/club/contract-demands/:id/preview（还价档位 previewDemand，worker 内部名
 *  DemandPreviewResult，demand-ops.ts:1796）——同词同界同真源（negotiation-secret.previewForecast），
 *  契约单一承载不拆二型。只读：不落库、不耗轮次、不写审计。 */
export interface WageForecast {
  forecast: string;
  risk: boolean;
}
