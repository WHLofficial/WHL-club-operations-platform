// 跨端契约类型真源 · 第 4 批：club / season / window / match / event / ops / admin 杂项（audit / config / import / cpu）
//
// 甄别清单 scratch/contract-audit-batch4.json（2026-11-09）机械清点 88 型，其中 22 型已在
// 第 2/3 批迁走（ImportPreview / ImportConfirm / ContractImportPreview / ContractImportConfirm /
// MatchEntry* 九型 / MatchOcrEntry / MatchOcrResult 归 batch2.ts；AdminShopOrderRow /
// AdminShopOrdersResponse / ClubOffer / StadiumBuildInfo / HomeMatchRow / HomeMatchesResponse
// 归 batch3.ts），本文件承载剩余 66 个 disposition=contract 类型，是唯一真源。
// 字段跟随 worker c.json 载荷现实（FieldDiff 处置见各型注释），web/src/lib/api.ts 只 re-export
// 不手抄，worker 侧响应装配点以本文件类型为锚（装配函数 return 标注 / 路由 c.json 泛型）。
// 命名口径（甄别 naming 3 条）：契约名 = web/api 名（web 全仓按名 import，保旧零改动）；
// worker 内部名（EventOption / EventOutcome / TriggeredEvent / TriggerResult / SquadAuditRow /
// StandingDto 等）不动，对应关系见各型注释。
// 纯类型层：只允许 import type（来源限本目录与 src/core），禁止任何运行时导出。
// Ops 三个锚/状态联合的真源在 core/ops-schedule.ts（worker 与契约共用同一份），按口径 7②
// 从 core 转发、不复制第二份；其余各型 worker 真源散在 src/worker/**（非 core），按批 1 纪律
// 在本文件内定义形状、worker 侧删除同名定义改 import 契约（同批 3 的 naming-ops / shop-ops 做法）。
//
// FieldDiff 处置速览（①总则：字段以 workerReality 为准）：
//   · workerExtra 补抄：OpenWindowResult.venueReset/venueNotified/demandsCreated、
//     CloseWindowResult.payroll/home（形状内联为契约内部辅助型）、SeasonSettleResult.champion、
//     ImportConfirm.replayed（批 2 已补）、AdminRegistrations.source/clubs[].isCpu/clubs[].unsigned
//   · typeMismatch 按 workerReality 收窄：AdminEventTriggeredRow.eventType/deadlineAt 去可选、
//     MyClubOverview.club.transferBanned 与 AdminClubRow.transferBanned 去可选、
//     MatchDecisionResult / SettleCheckResult / StageSettleResult / SeasonSettleResult /
//     AdminReviewBatchResult / OpenWindowResult / CloseWindowResult 的 ok 收窄字面 true
//   · typeMismatch 保留原状（登记）：ClubBalance.activationIncome/activationCredit——worker 恒发
//     但 web 测试夹具与 queries fallback 压着可选（处置同上，见 ClubBalance 型注）
//   · workerMissing 登记（保留原状）：MyClubOverview.home（未绑定分支不发该键，web
//     ClubDetail.tsx:154 把它直接传给 `StadiumInfo | null` 形参，改可选会 break 白名单外文件——
//     批 1 bidCount 同款处置；消费端 VenueTab 的 `{home && …}` 真值判断把 undefined 一并兜住）
//   · workerMissing 删字段：SeasonRow.ageCap（端点不吐，web 全仓零读取）
//   · naming 保留原状：ClubDirectoryRow.leagueTier（worker SQL 原样透传 league_tier，契约随 api
//     写 camel——PlayersLibrary.test.tsx:26 夹具字面量压着 camel 键，测试文件在白名单外，同批 1
//     先例登记不修，真修正随夹具授权联动；web 运行时读点只取 id/name，不撒谎处不爆雷。
//     ⚠️ 测试计划 §6.5#14 处置「A+键名改 league_tier」与夹具硬断言冲突，本批按「既有测试
//     git diff 为空」硬线保留 camel，分歧登记）
//   · 归属让渡：MatchPhase / MatchDecisionResult 两型机械清点落入本批清单，但测试计划 §6.0
//     归属表固定分别归 B6 / B5（真源文件 market.ts / activations.ts 也不在本批白名单），
//     本文件不建、api 手抄原地保留，避免双真源
//   · §6.8 漏审补录六型（随批补甄别）：TournamentRow / BindTournamentResult / ResultQueueRow /
//     ConfirmedResultRow / ResultsQueue / ConfirmResultResult（season 域绑定与赛果队列装配，
//     装配点 routes/admin/seasons.ts 在本批白名单内；ResultQueueItem / ConfirmedResultItem 是
//     worker/results.ts 内部名——results.ts 在白名单外，内部名不动只登记）

// ---------------------------------------------------------------------------
// 球队页（v3.4.0）：列表 / 详情 / 排名（GET /api/clubs、/api/clubs/:id、/api/clubs/:id/standing）
// worker 装配：routes/clubs.ts（列表行 :131-147、bandCounts :231-240、详情 :386-470、
// StandingDto :503-516、排名代理 :593-613）
// ---------------------------------------------------------------------------

/** 球员库目录行（GET /api/clubs/directory，公开）。worker SQL 原样透传 `league_tier`
 *  （snake_case），契约随 api 手抄保留 camel 键——FieldDiff naming 处置见文件头注。 */
export interface ClubDirectoryRow {
  id: number;
  name: string;
  leagueTier: string;
}

/** 球队列表条目（GET /api/clubs）。tier 由平台按当季定级赛事报名派生：未登记目录 / 本季未报名 ⇒ null。 */
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

/** 当季联赛排名（GET /api/clubs/:id/standing）。取不到时 standing 为 null、note 给原因。
 *  worker 内部名 StandingDto（routes/clubs.ts）；未配 TOUR_API_BASE 早退分支发同一形状。 */
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

// ---------------------------------------------------------------------------
// 我的球队（GET /api/me/club、/api/club/balance）
// ---------------------------------------------------------------------------

/** 主场档案块（/me/club 的 home，v1.5.0）。worker 同形内联类型在 routes/clubs.ts me/club 装配点。 */
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

/** 我的球队概览。⚠️ FieldDiff workerMissing（已登记 registered）：未绑定 / 无 club 行分支
 *  （routes/clubs.ts:665/:673）只发 {club,balance,squadCount,window}，**不发 home 键**；
 *  契约保留必填原状（web ClubDetail.tsx:154 直接把它传给 `StadiumInfo | null` 形参，
 *  改可选会 break 白名单外文件），消费端 `myOverview.home` 在未绑定态是 undefined，
 *  VenueTab 的 `{home && …}` 真值判断把它一并兜住。funds 保持可选是 api 有意的半旧响应容忍
 *  （v6.65.3 缓存旧快照无该键），非谎言。 */
export interface MyClubOverview {
  club: { id: number; name: string; leagueTier: string | null; logoKey: string | null; status: string; transferBanned: boolean } | null;
  balance: number | null;
  /** v6.65.3：可支配拆解（消费中心顶部条用），与消费守卫同口径；半旧响应无此字段 */
  funds?: { available: number; balance: number; held: number; creditLine: number; vouchers: number } | null;
  squadCount: number | null;
  window: { season: number; windowSeq: number } | null;
  /** v1.5.0：主场档案（球场/设施/影响力构成）；无球场行 = null。分支差异见型注 */
  home: StadiumInfo | null;
}

/** 财政余额（GET /api/club/balance）。⚠️ workerReality 是两键恒发（未绑定分支显式发 null、
 *  绑定分支恒展开 balanceSnapshot），但 api 手抄保留可选、且 web 有类型级消费压着它：
 *  ListingsBidsSection.test.tsx:19 夹具字面量与 queries.ts 的 6 键 fallback 联合都缺这两键
 *  （两文件均在本批白名单外，既有测试零改动硬线）——按批 1 bidCount 同款处置保留可选原状并
 *  登记，真收窄随测试夹具授权联动；运行时读点全部真值链（Ledger.tsx:235 一带），不爆雷。 */
export interface ClubBalance {
  club: { id: number; name: string } | null;
  balance: number | null;
  held: number | null;
  available: number | null;
  /** 在途卖人收入（税后净额，未乘 k；v6.57.0 起随余额端点下发） */
  expectedIncome: number | null;
  /** 预期收入额度 = expectedIncome × k（已含在 available 里，展示拆解用） */
  creditLine: number | null;
  /** v6.64.0：被激活挂牌在途税后净额（未乘 k，expectedIncome 的组成部分）；worker 恒发（见型注） */
  activationIncome?: number | null;
  /** v6.64.0：activationIncome × k（「其中被激活挂牌」展示口径，与 creditLine 同层真部分和）；worker 恒发（见型注） */
  activationCredit?: number | null;
}

// ---------------------------------------------------------------------------
// 管理端俱乐部与 CPU 接管向导（GET /clubs、/clubs/:id/stadium、/clubs/:id/cpu-convert 等）
// worker 装配：routes/admin/clubs.ts（行 :236-253、stadium :338-357、cpu 五步 :460-611）
// ---------------------------------------------------------------------------

// v1.5.0：管理端球场档案（GET /clubs/:id/stadium）。tier 块沿用 home.ts TierEntry 的
// snake_case 键（min_seats 等，loadTierTable 行原样透传），api 同形照抄、逐字段一致。
export interface StadiumAdmin {
  stadium: { clubId: number; name: string | null; capacity: number; tier: number; shellInfluence: number; bonusPoints: number; fans: number };
  tier: { name: string; min_seats: number; max_seats: number; base_maintenance: number; per_10k_rate: number; attend_coef: number; upgrade_cost: number } | null;
  facilities: { key: string; level: number }[];
  influence: { players: number; shell: number; bonus: number; tierCoef: number; total: number };
}

export interface AdminClubRow {
  id: number;
  name: string;
  /** CPU 队标记（v6.27.0）：true = 电脑队，可从俱乐部管理进入接管向导 */
  isCpu: boolean;
  /** 报名派生级别（deriveClubTier → Tier 联合）；未报名为 null，管理端标「未定级」 */
  leagueTier: 'premier' | 'second' | null;
  status: string;
  /** worker 恒发（transfer_banned === 1）；api 手抄的可选按 workerReality 收窄 */
  transferBanned: boolean;
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

// ---------------------------------------------------------------------------
// 赛季（GET /api/seasons/current 公开 + /api/admin/seasons*）
// worker 装配：routes/seasons.ts:34-46、routes/admin/seasons.ts:39-129、season-settle.ts
// ---------------------------------------------------------------------------

/** 赛季绑定行（admin GET /seasons/:id/tournaments）。公开 /api/seasons/current 的 tournaments
 *  行不带 stageSettledAt 键（SQL 只取三列）⇒ 可选如实表达两侧分支。 */
export interface SeasonBinding {
  id: number;
  tournamentId: number;
  competitionType: string | null;
  stageSettledAt?: string | null;
}

/** 当前赛季与窗口（GET /api/seasons/current，公开）。球员页窗门控只消费 window.status。
 *  §6.5#15 合一裁决：同载荷两份手抄并成一份，唯一真源挂 adminQueries 的消费名 SeasonCurrent。 */
/** SeasonCurrent = GET /api/seasons/current 的载荷唯一真源（与 SeasonsCurrent 同载荷两份手抄
 *  并成一份）。SeasonsCurrent 是 web queries.ts:311 的在役消费名，作转发别名
 *  （批 3 NamingQuote = BrandQuote 同款），api 两名都转发、web 保旧零改动。 */
export interface SeasonCurrent {
  season: { season: number; status: string } | null;
  window: { season: number; windowSeq: number; status: string; openedAt: string | null; closedAt: string | null } | null;
  tournaments: SeasonBinding[];
}

/** SeasonsCurrent = SeasonCurrent 的转发别名（历史消费名，见上）。 */
export type SeasonsCurrent = SeasonCurrent;

/** 赛季行（admin GET /seasons）。⚠️ FieldDiff workerMissing（已删字段）：端点只 SELECT
 *  season,status 不下发 ageCap（DB 有列、端点不吐），api 手抄的 `ageCap?: number | null`
 *  在 web 全仓零读取 ⇒ 契约不再携带。真要下发随 worker 加键、契约再补。 */
export interface SeasonRow {
  season: number;
  status: string;
}

export interface SeasonsResponse {
  seasons: SeasonRow[];
}

export interface SeasonBindingsResponse {
  bindings: SeasonBinding[];
}

/** 赛季结算前置检查（GET /seasons/:id/settle-check）。worker `{ ok: true, season, …check }`
 *  恒发 ok:true ⇒ 收窄字面（api 手抄 boolean 按 workerReality 修）。 */
export interface SettleCheckResult {
  ok: true;
  season: number;
  blockers: string[];
  warnings: string[];
}

/** 冠军加成明细（v6.13.0 C2，season-settle.ts ChampionBonusDetail 同形——worker 真源在
 *  非 core 文件，按批 1 纪律在本文件冻结形状）。契约内部辅助型，不出 barrel。 */
interface SeasonChampionBonus {
  applied: boolean;
  /** 跳过原因（applied=false 时给人看的口径，进结算 warnings 触发 acknowledged 流程） */
  note: string | null;
  clubId: number | null;
  clubName: string | null;
  brand: string | null;
  heatDelta: number;
  satDelta: number;
}

/** 赛季结算（POST /seasons/:id/settle-season）。⚠️ FieldDiff workerExtra（已补抄）：
 *  worker 恒发 champion（v6.13.0 冠军加成），api 手抄无此字段、web 未消费（潜伏）——
 *  契约按 workerReality 补上。 */
export interface SeasonSettleResult {
  ok: true;
  growable: number;
  warnings: string[];
  champion: SeasonChampionBonus;
}

/** 赛事完结结算（POST /season-bindings/:id/stage-settle）。worker return 恒 ok:true。 */
export interface StageSettleResult {
  ok: true;
  items: number;
}

// ---------------------------------------------------------------------------
// §6.8 漏审补录（随批补甄别）：赛事绑定下拉 / 绑定回执 / 赛果队列三型 / 确认回执
// worker 真源：routes/admin/seasons.ts:169-187 装配 + worker/results.ts 内部名
// ResultQueueItem / ConfirmedResultItem（results.ts 在本批白名单外，内部名不动、只登记命名差）
// ---------------------------------------------------------------------------

/** 赛事下拉行（GET /api/admin/tournaments，TOUR_DB tournament 表只读跨库；wrap {tournaments}）。 */
export interface TournamentRow {
  id: number;
  name: string;
  status: string;
}

/** 绑定赛事回执（POST /api/admin/seasons/:id/bind-tournament）。worker 恒 ok:true ⇒ 收窄字面。 */
export interface BindTournamentResult {
  ok: true;
  tournament: { id: number; name: string };
}

/** 待确认赛果队列行（GET /api/admin/results/queue 的 queue[]；worker 内部名 ResultQueueItem）。
 *  ⚠️ 随批补甄别 diff（workerMissing，保留原状并登记）：api 手抄的 `windowSeq` worker 队列
 *  行**不下发**（results.ts queueResults 的 pending 构造无 window_seq——tour 赛程行没有窗口号），
 *  而 SeasonsPage.tsx:445 读 `r.windowSeq` 渲染「窗undefined」（潜伏显示缺陷，类型谎言曝光的
 *  现场之一）；SeasonsPage 与 results.ts 均在本批白名单外 ⇒ 按批 1 bidCount 同款保留可选原状，
 *  真删除随「results.ts 补发 window_seq 或前端删读点」的行为增量另立。confirmed[] 行的
 *  window_seq 真实下发（result_confirmations 列），同名单列行的 windowSeq 是真值。 */
export interface ResultQueueRow {
  matchId: number;
  season: number;
  /** queue[] 行运行时恒 undefined（worker 不发，见型注）；confirmed[] 行真值 */
  windowSeq?: number;
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

/** 已确认赛果行（GET /api/admin/results/queue 的 confirmed[]；worker 内部名 ConfirmedResultItem）。 */
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

/** 赛果队列响应（worker results.ts queueResults 回 {queue, confirmed}）。 */
export interface ResultsQueue {
  queue: ResultQueueRow[];
  confirmed: ConfirmedResultRow[];
}

/** 赛果确认回执（POST /api/admin/results/:id/confirm，201）。worker 恒 ok:true ⇒ 收窄字面。 */
export interface ConfirmResultResult {
  ok: true;
  result: ConfirmedResultRow;
  /**
   * 确认钩子自动记的成长事件（v6.52.0 起非成长球员的事件照记但 XP 为 0 ⇒ granted 只代表
   * 「新入账的成长事件条数」，不再宣称 XP 条数）；unresolved=没匹配上的俱乐部/球员名（补录用）
   */
  xp: { granted: number; unresolved: string[] };
}

// ---------------------------------------------------------------------------
// 窗口（GET/POST /api/admin/windows*；状态机 window-machine.ts + 看板 squad-audit.ts）
// ---------------------------------------------------------------------------

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

/** 开窗回执（POST /admin/windows/open，201）。⚠️ FieldDiff workerExtra（已补抄）：worker 恒发
 *  venueReset / venueNotified / demandsCreated（v6.54.0 涨薪要求条数），api 手抄无此三键。 */
export interface OpenWindowResult {
  ok: true;
  season: number;
  windowSeq: number;
  /** v3.0.0：本次开的是临时窗 */
  isTemporary: boolean;
  rerolled: number;
  /** 开窗时勾选了「同时宣告新成长期」 */
  growthPeriodDeclared: boolean;
  /** 本窗是否重置了场馆档期（v6.53.0 关窗清档后开窗复位） */
  venueReset: boolean;
  /** 档期重置广播的俱乐部数 */
  venueNotified: number;
  /** 本窗新生成的球员涨薪要求条数（v6.54.0 §8；生成失败时保持 0，靠 cron 幂等补跑） */
  demandsCreated: number;
}

/** 关窗工资批摘要（window-payroll.ts PayrollSummary 同形）。契约内部辅助型，不出 barrel。 */
interface CloseWindowPayrollSummary {
  wageClubs: number;
  wageTotal: number;
  taxClubs: number;
  taxTotal: number;
  /** 触发级别下限（帽值 − wage_floor_gap）按下限扣的队数（v6.39.0；v6.47.0 起 gap=0 ⇒ 恒为 0） */
  wageFloorClubs: number;
}

/** 关窗主场批摘要（home.ts HomeWindowSummary 同形，14 键）。契约内部辅助型，不出 barrel。 */
interface CloseWindowHomeSummary {
  maintenanceClubs: number;
  maintenanceTotal: number;
  fansClubs: number;
  namingClubs: number;
  namingTotal: number;
  activityClubs: number;
  /** v6.53.0：本窗活动**净现金**（gross − opsCost − damage），不再是毛收入 */
  activityTotal: number;
  /** v6.53.0：本窗活动运营成本合计（已含在 activityTotal 的减项里，单独披露便于对账） */
  activityOpsCost: number;
  moodClubs: number;
  terminatedClubs: number;
  /** v6.14.0 C3 招商轮：本轮定向递出的报价数 / 接班转正的队数（临时窗恒 0） */
  marketOffers: number;
  activatedClubs: number;
  /** v6.54.0 §5.7：本批 apply 的待生效合同变更条数（含 demand / renewal / rejection 三类） */
  pendingApplied: number;
  /** v6.54.0 §5.7：因离队而作废的待生效条数 */
  pendingVoided: number;
}

/** 关窗回执（POST /admin/windows/close）。⚠️ FieldDiff workerExtra（已补抄）：worker 恒发
 *  payroll（关窗工资批摘要）与 home（关窗主场批摘要，含 activityClubs/activityTotal），
 *  api 手抄无此两键。ok 按 workerReality 收窄字面。 */
export interface CloseWindowResult {
  ok: true;
  season: number;
  windowSeq: number;
  /** v3.0.0：本次关的是临时窗 */
  isTemporary: boolean;
  /** 忠诚支出（v6.47.0 起为俱乐部扣款）：count = 人次数、total = 扣款金额绝对值（正数） */
  loyalty: { count: number; total: number };
  forceSettled: number;
  payroll: CloseWindowPayrollSummary;
  home: CloseWindowHomeSummary;
}

/** 关窗页实时看板逐队一行（GET /admin/windows/overview，v6.69.0 期三；wrap 在 {clubs} 下）。
 *  worker 内部名 SquadAuditRow（squad-audit.ts，loadWindowOverview）——甄别 naming：
 *  仅类型名不同，16 字段同名同型。 */
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

// ---------------------------------------------------------------------------
// 市场域两型（Match 前缀机械清点划入本批，但 §6.0 归属表固定：MatchPhase 归 B6（真源
// routes/market.ts:200-207，批 1 TransferPanelListing.matchPhase 内联联合同轮改引用）、
// MatchDecisionResult 归 B5（真源 activations.ts:185-190，ok: true 收窄也随 B5 落）——
// 本批不建、避免双真源；api 手抄原地保留等对应批迁移。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 随机事件 · 玩家侧（GET /api/club/events、POST /api/club/events/:id/choose，v6.11.0 D2）
// worker 真源：event-ops.ts（内部名 EventOption / EventOutcome / ClubEventsView）
// ---------------------------------------------------------------------------

/** 选项里的一条结果分支：权重 w + 效果表（插件 options_json 同形）。worker 内部名 EventOutcome。 */
export interface ClubEventOptionOutcome {
  w: number;
  effects: Record<string, unknown>;
}

/** 选择型事件的一个选项。worker 内部名 EventOption（parseEventOptions 产出）。 */
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

/** 教练端事件视图（GET /api/club/events）：{ clubId, ...listClubEvents } 的顶层装配形状。 */
export interface ClubEventsResponse {
  clubId: number;
  pending: ClubEventPending[];
  recent: ClubEventRecent[];
}

/** 玩家选定回执（POST /api/club/events/:id/choose）：resolveEvent 结算投影包一层 {event}。 */
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

// ---------------------------------------------------------------------------
// 随机事件 · 管理端（/api/admin/events*，v6.10.0 D 块 + v6.11.0 D2 + v6.12.0 D3）
// worker 真源：routes/admin/events.ts（POOL_COLUMNS raw 行 / DraftRow / draftView）+
// event-ops.ts（内部名 TriggeredEvent / TriggerResult / EventDraftStruct）
// ---------------------------------------------------------------------------

/** 事件池行（GET /admin/events/pool，wrap {events}）：POOL_COLUMNS 的 raw 行，snake_case 原样。 */
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

/** 事件流水行（GET /admin/events/occurrences，wrap {occurrences}）：JOIN clubs 出 club_name 的 raw 行。 */
export interface AdminEventOccurrence {
  id: number;
  club_id: number;
  club_name: string | null;
  season: number;
  window_seq: number;
  event_id: string;
  event_name: string;
  event_type: string;
  /** pending | resolved | expired（v6.12.0 起超时兜底记 expired，读侧兼容） */
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

/** 触发批的单事件行（worker 内部名 TriggeredEvent）。⚠️ FieldDiff typeMismatch（已修）：
 *  worker eventType 恒发 string、deadlineAt 恒发 string|null，api 手抄的可选按 workerReality 去掉。 */
export interface AdminEventTriggeredRow {
  occurrenceId: number;
  clubId: number;
  clubName: string;
  eventId: string;
  eventName: string;
  /** instant=当刻结算 / choice=进待定等玩家选（v6.11.0 开放） */
  eventType: string;
  /** 选择型的截止时刻（ISO；instant 与「不设时限」都是 null） */
  deadlineAt: string | null;
  text: string;
  notes: string[];
  effects: Record<string, unknown>;
}

/** 触发回执（POST /admin/events/trigger）：{ season, windowSeq, ...TriggerResult }。 */
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

/** 生成入口的可用性探针（GET /admin/events/llm-status）。Llm* 前缀是甄别别名（事件草稿域）。 */
export interface LlmStatus {
  configured: boolean;
}

/** struct 草稿 / 自定义事件的规范化结构（数值已过 clampEventDraft 钳制）。
 *  worker 同名接口 EventDraftStruct（event-ops.ts）——契约建真源后 worker 删本地定义改 import。 */
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

/** 草稿行（GET /admin/events/drafts，wrap {drafts}）：DraftRow + JSON.parse 出的 payload。 */
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

/** 草稿生成回执（POST /admin/events/llm-draft，201）：text 分支 payload={template}、
 *  struct 分支 payload=EventDraftStruct，adjustments 是钳制/裁剪说明（text 恒 []）。 */
export interface LlmDraftResult {
  id: number;
  kind: string;
  payload: unknown;
  adjustments: string[];
}

/** 采纳回执（POST /admin/events/drafts/:id/adopt）：text = 被改写的事件 event_id；struct = 新入池事件的 event_id */
export interface EventDraftAdoptResult {
  id: number;
  kind: string;
  target: string;
}

// ---------------------------------------------------------------------------
// 运营时刻表（v6.49.0）。锚/状态三联合真源在 core/ops-schedule.ts（前后端共用一份），
// 按口径 7② 从 core 转发不复制；行/视图/保存回执真源在 worker/ops-schedule.ts。
// ---------------------------------------------------------------------------

import type { OpsEndAnchor, OpsStartAnchor, OpsState } from '../core/ops-schedule.ts';

export type { OpsEndAnchor, OpsStartAnchor, OpsState };

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
  /** 当前窗口参照（core OpsWindowRef 同形）；没开窗时为 null */
  window: { openedAt: string; closedAt: string | null } | null;
  rows: OpsStatusRow[];
}

/** 保存回执（PUT /admin/ops-schedule）：worker 恒 ok:true。 */
export interface OpsSaveResult {
  ok: true;
  row: OpsStatusRow;
}

// ---------------------------------------------------------------------------
// 管理杂项：总览 / 名单报表 / 审核工作台 / 审计 / 平台参数 / 期初导入
// ---------------------------------------------------------------------------

/** 管理端总览轻计数（GET /admin/overview，isolate 级 60s 缓存）。worker 同名接口
 *  AdminOverview（routes/admin/overview.ts）——契约建真源后 worker 删本地定义改 import。 */
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

/** 名单报表（GET /admin/registrations，v6.67.0 期一 archive/live 双分支）。⚠️ FieldDiff
 *  workerExtra（已补抄）：worker 顶层恒发 source（但 season=null 早退分支不发 ⇒ 可选）、
 *  逐队 isCpu（两分支恒发 ⇒ 必填）与 unsigned（仅 live 分支发 ⇒ 可选）。 */
export interface AdminRegistrations {
  season: number | null;
  source?: 'archive' | 'live';
  clubs: {
    clubId: number;
    clubName: string;
    isCpu: boolean;
    leagueTier: string | null;
    firstTeam: number;
    trainee: number;
    /** 仅 live（当前赛季现算）分支下发；archive 存档分支无此键 */
    unsigned?: number;
    wageTotal: number;
    players: { playerId: number; name: string; squad: string }[];
  }[];
}

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

/** 批量批准 / 驳回的逐条结果（POST /admin/reviews/batch，v6.68.0 期 B）：一条失败不影响其它；
 *  顶层 ok worker 恒发 true ⇒ 收窄字面。 */
export interface AdminReviewBatchResult {
  ok: true;
  results: { id: number; ok: boolean; error?: string }[];
}

/** 审计日志行（GET /admin/audit-log）。origin = 触发通道（v6.3.2）；历史行为 null。 */
export interface AuditEntryRow {
  id: number;
  actor: number | null;
  action: string;
  targetType: string;
  targetId: number | null;
  /** 'user'/'cron_tick'/'lazy_settle'/'backchannel'/'machine'；历史行为 null */
  origin: string | null;
  before: string | null;
  after: string | null;
  at: string;
}

export interface AuditLogResponse {
  entries: AuditEntryRow[];
}

/** 平台参数行（GET /admin/config）：core/config.ts listMasked/listRaw 的行形（两方法 return
 *  内联同形）——core 不导出命名接口，契约按批 1 纪律冻结形状、不复制进 core。 */
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

/** 期初余额导入回执（POST /admin/ledger/opening-import，finance.ts）。Import 域别名，
 *  机械清点按 Import 前缀划入本批。 */
export interface OpeningImportResult {
  written: number;
  skipped: number;
}
