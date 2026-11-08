// 跨端契约类型真源 · 第 2 批：players / growth / squad / tier（球员库 · 成长引擎 · 注册工作台 · 档位核定 · 成长录入 · 导入管线）
//
// 甄别清单 scratch/contract-audit-batch2.json（2026-11-09）：53 个 disposition=contract 类型 +
// §6.8 漏审补录两枚（ContractDto / ComplianceReport，测试计划 §5 B2 特有验收 ⑧）是唯一真源；
// PlayerMarker 是共享 core 单源（core/squad-rules.ts）按口径 7② 不复制进契约，只按名引用；
// GROWTH_EVENT_LABEL 是 viewmodel（纯前端标签映射）留 web 不迁移（口径 7①）。
// 字段跟随 worker c.json 载荷现实（FieldDiff 处置见各型注释），web/src/lib/api.ts 只 re-export
// 不手抄，worker 侧响应装配点以本文件类型为锚（装配函数 return 标注 / 路由 c.json 泛型）。
//
// 锚点覆盖（本批六文件）：routes/players.ts（列表 / 详情 / 转会记录 / 比赛 / ContractDto 装配）、
// worker/growth.ts（applyLevelUp / listGrowthPeriods）、routes/growth.ts（成长史 / 升级消费）、
// routes/admin/growth.ts（结算 / 成长期 / 录入台三端点 / OCR）、routes/admin/growth-tier.ts
// （档位四端点）、routes/admin/players.ts（导入管线两段）。
// 锚点缺口（登记 registered，生产者在批 2 文件白名单外，契约已建、api 已转发）：
//   · SquadOverview / SquadPlayerRow / SquadRules / SquadCompliance / SquadIssue / SquadNumbersResponse /
//     NumberConflict ← routes/registration.ts（GET /api/club/squad、PUT /api/club/squad/numbers）
//   · TierDiffRow ← worker/growth-tier.ts（经 routes/admin/growth-tier.ts 的 c.json 泛型传导检查）
//   · PlayerMatchesCompStat / Season / Item ← core/player-matches.ts + worker/player-matches.ts
//     （经 routes/players.ts 的 c.json<PlayerMatchesResponse> 传导检查）
//   · PendingContractsResponse 已在第 1 批契约（batch1.ts）单源，本批只转发不重复定义。

import type { ContractAppliedNotice, ContractPendingView, PlayerDemandState } from './batch1.ts';
import type { PlayerMarker, SquadIssueRule } from '../core/squad-rules.ts';
import type { GrowthTierConditionMeta, TierConditionDetail } from '../core/growth-tier.ts';
import type { PlaystyleSource } from '../core/playstyle-rules.ts';

// ---------------------------------------------------------------------------
// 球员库列表行（公开 GET /api/players，keyset 游标分页）
// ---------------------------------------------------------------------------

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
  /** 「不满」徽章（v6.54.0 §5.4）：transfer_requests(released) 存续即 true，全联盟可见（列表/详情都返回；缺省视为 false） */
  unsatisfied?: boolean;
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

/** 合并清单项（v6.63.0）：psid 是存库 ID（银 1-99 / 金 101-199），source 出自 core/playstyle-rules */
export interface PlayerListItemPlaystyle {
  slot: number;
  psid: number;
  gold: boolean;
  source: 'fc' | 'growth' | 'china' | 'shop' | 'external' | 'manual';
}

export interface PlayerLibraryRow extends PlayerListItem {
  growable: boolean;
  // v6.79.0 身价页：模型参考价（公开 /api/players 恒下发，种子前为 null）
  modelValue?: number | null;
  // v6.79.0 身价页：最近成交（仅 withLastDeal=1 时下发；fee 单位 m）
  lastDeal?: LastDealInfo | null;
  clubName: string | null;
  // v6.39.3：队徽 R2 键（真源=比赛系统 team.logo_key）；自由身或未接徽为 null，前端 TeamLogo 回落队名哈希色块
  clubLogoKey: string | null;
  // v2.3.0：多位置槽（PosID1-4 槽位序去重）、球员影响力（规则 4.1.3 现值口径）、现行合同速览
  positions: string[];
  influence: number;
  wage: number | null;
  releaseFee: number | null;
  contractType: string | null;
  // v6.54.0 步骤 7：阵容页小字。列表端点不返回（公开缓存），由 SquadTab 用
  // /api/club/pending-contracts 在「自家队」时合并进来——访客行上恒为 undefined。
  hasPending?: boolean;
  pendingWage?: number | null;
  pendingReleaseFee?: number | null;
  pendingSource?: ContractPendingView['source'] | null;
  // v2.3.0 列联动：筛什么就带什么字段回来（foot/baseCa/fcId 恒回，attrValue 只在 attr 筛选时出现）
  foot: number;
  baseCa: number | null;
  fcId: number | null;
  source: string | null;
  // v3.0.0 窗刻度：效力时长（赛季）；protected = 是否在保护期内（无合同 = null）
  serviceSeasons: number | null;
  protected: boolean;
  /** 甄别 FieldDiff #1（typeMismatch）处置 A：attr 筛选在场时键恒下发（players.ts:976）、值可为
   *  null（v6.61.0 起缺键透传 NULL）——api 手抄 `attrValue?: number` 的值域不含 null 是谎言。
   *  web 读点 players-library.ts:614（`v == null ? '—'`）与 club-columns.tsx:212（`?? '—'`）已带
   *  null 防线，typecheck 不破，无需补丁（R-WEB 复核过）。 */
  attrValue?: number | null;
  // ps 筛选时带回的 PSID1-15 槽位原值（长度 15、缺槽 null；金徽=基础 ID+100，金槽 13+）
  psIds?: (number | null)[];
  // v6.63.0：合并清单（FC 槽减被发放金抑制 + 发放明细），恒回 —— ps 列渲染、
  // 成长/商店选择器的「已拥有」判断、BadgeCounts 的全量计数都从这里出发
  playstyles?: PlayerListItemPlaystyle[];
}

/** 最近成交摘要（v6.79.0 身价页）：仅 /api/players?withLastDeal=1 下发；口径 = status='completed' 且 type ∈ {transfer, activation, forced_auction}（设计 §0 裁决 4，与插件「真实成交」一致）——比 /api/market/deals 严：deals 只过滤 status，还含 free_agent / rc_change / match 等带新违约金的类型 */
export interface LastDealInfo {
  fee: number | null;
  season: number | null;
  windowSeq: number | null;
}

export interface PlayersLibraryResponse {
  players: PlayerLibraryRow[];
  // v3.2.0：服务端不再回 total（整表 COUNT 占单页读量 99.7%）；分页条用 nextCursor 判「还有更多」
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// 球员详情（GET /api/players/:id）
// ---------------------------------------------------------------------------

/** 现行合同卷宗（§6.8 漏审补录，归属 B2）：worker 无同名接口——形状装配在
 *  routes/players.ts:1466-1484（GET /api/players/:id 的 contract 内联对象，13 字段逐一对上，
 *  锚点 = 该装配处以本型为类型位置的局部标注）。字段级甄别随批补：与装配逐字一致；
 *  protectionTicks 可选保持——worker 恒下发键（方向安全同 officialName，登记不动）。 */
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
  /** 保护期绝对刻度（v6.54.0）：双版本合同写「至第 N 窗」用；null/缺省 = 无保护期条款 */
  protectionTicks?: number | null;
  signedSeason: number | null;
  signedWindowSeq: number | null;
}

export interface PlayerDetail {
  player: PlayerListItem & {
    foot: number;
    growable: boolean;
    /** 影响力（v6.34.0 增量 1）：规则 4.1.3 现值口径（与属性 view 无关），与球员库列表同源同值 */
    influence: number;
    /** FC26 存档 id（v4.0.0 寻址口径）：详情响应实际下发，补上此前的类型缺口 */
    fcId: number | null;
    growthXp: number;
    gameAttrs: Record<string, unknown> | null;
    /** 合并清单（v6.63.0）：FC 槽 + 发放明细，含可逆抑制与来源 —— 详情右翼与对比页同吃一份 */
    playstyles: PlayerListItemPlaystyle[];
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
  /** 待生效合同变更（v6.54.0 步骤 7）：仅本队教练视角非空，公开/他队恒 null（§10.4 权限） */
  contractPending?: ContractPendingView | null;
  /** 已生效首窗提示（v6.54.0）：仅本队教练、且生效后还没再关过窗 */
  contractApplied?: ContractAppliedNotice | null;
  /** 球员要求/转会申请的当前窗状态（SideOps 四态块与续约禁用矩阵）；仅本队教练。
   *  投影装配点 players.ts:1488-1496（第 1 批登记的锚点缺口，本批补 c.json 泛型锚）。 */
  demandState?: PlayerDemandState | null;
  /** 海捞资格（v6.17.0）：与后端 createFreeAgent 守卫链同源，左栏海捞按钮的可用性与原因都吃它。
   *  Sea* 域类型归 B5 批契约（甄别 notes 跨批依赖）；B5 落地前形状以本型内联承载（与 api 手抄
   *  SeaSignEligibility 逐字段一致），B5 契约落地后应改引用 sea 域契约单源。 */
  seaSign: { eligible: boolean; reason: string | null };
  /** 海捞成交参照（v6.17.0）：违约金输入框下方的定价锚。同上归 B5，落地前内联承载
   *  （与 api 手抄 SeaComps/SeaCompRow 逐字段一致）。 */
  seaComps: {
    /** same_tier=同档成交（CA±5）；global=同档空时回落全局最近；none=没有参照 */
    scope: 'same_tier' | 'global' | 'none';
    rows: {
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
    }[];
  };
}

// ---------------------------------------------------------------------------
// 球员转会记录（GET /api/players/:id/transfers，v3.3.0）
// ---------------------------------------------------------------------------

/** 只含已完成单据，按完成时间倒序 */
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

// ---------------------------------------------------------------------------
// 球员页「比赛」页签（v6.46.0，公开 GET /api/players/:id/matches）
// 形状真源 = core/player-matches.ts（CompStat/SeasonStats/PlayerMatchItem 逐字段同名），
// 锚点 = routes/players.ts 的 c.json<PlayerMatchesResponse> 泛型传导。
// ---------------------------------------------------------------------------

/** 某赛事（一个赛季内）的汇总；`:id` 口径与 /players/:id 一致（fc_id，兼容内部 id） */
export interface PlayerMatchesCompStat {
  competitionType: string;
  competitionName: string;
  tournamentId: number | null;
  tournamentName: string | null;
  /** 出场 = 成长记录 / 赛事事件 / 赛前真实提交首发 三者任一（伤病缺阵另计一列） */
  appearances: number;
  /** 有评分的场次数（均分只统计这些场次） */
  ratingCount: number;
  /** 两位小数；无评分为 null。合计行 = 该赛季全部评分场次的加权平均 */
  avgRating: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  penMiss: number;
  ownGoal: number;
  injuryOut: number;
  missed: number;
  /** 门将变体：出场场次里对手 0 球 / 失球合计 / 扑救合计（成长库记录值） */
  cleanSheets: number;
  conceded: number;
  saves: number;
}

export interface PlayerMatchesSeason {
  season: number;
  comps: PlayerMatchesCompStat[];
  /** 该赛季合计：competitionName 为「合计」，均分为加权平均 */
  total: PlayerMatchesCompStat;
}

export interface PlayerMatchesItem {
  matchId: number;
  season: number;
  competitionType: string;
  competitionName: string;
  tournamentId: number | null;
  tournamentName: string | null;
  stageName: string | null;
  round: number | null;
  /** 「赛事 · 阶段 · 第 N 轮」拼好的标题 */
  stageLabel: string;
  /** 完赛日（YYYY-MM-DD，取 result_confirmations.finished_at 的日期部分） */
  date: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  /** 对手（side 判不出时为 null） */
  opponent: string | null;
  side: 'home' | 'away' | null;
  scoreHome: number | null;
  scoreAway: number | null;
  rating: number | null;
  saves: number;
  conceded: number | null;
  cleanSheet: boolean;
  /** 事件串（门将带「零封 / 失球 N」前缀与「扑救 N」后缀），如 ['进球 23′', '助攻 67′'] */
  events: string[];
  /** 该场在伤病停赛名单里（只进「缺阵」列，不算出场） */
  missed: boolean;
  appeared: boolean;
  sources: ('growth' | 'event' | 'lineup')[];
}

export interface PlayerMatchesResponse {
  player: { id: number; name: string; position: string | null };
  seasons: PlayerMatchesSeason[];
  matches: PlayerMatchesItem[];
}

// ---------------------------------------------------------------------------
// 导入管线两段式（管理端，通道 A/B 球员 + 通道 C 名单合同模板）
// 锚点 = routes/admin/players.ts 四处 c.json 泛型；形状真源 = worker/players-import.ts
// （previewImport / confirmImport）与 worker/contracts-import.ts（previewContractsImport /
// confirmContractsImport）。
// ---------------------------------------------------------------------------

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
  /** 甄别 FieldDiff（workerExtra）处置 B 补抄：本次重放购买台账的人数（players-import.ts:253/264
   *  累计——upsert 整列覆盖 pa / game_attrs 后按台账把已购属性加回去的「已存在行」人数）。 */
  replayed: number;
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

// ---------------------------------------------------------------------------
// 注册工作台 / 阵容（GET /api/club/squad 等；生产者 routes/registration.ts，批 2 文件白名单外
// ⇒ worker 侧锚点缺口登记 registered，见文件头）
// ---------------------------------------------------------------------------

/** PUT /api/club/squad/numbers 的 409 冲突明细（v6.76.0 号码批量分配）：路由 409 体
 *  {error, code:'number_conflict', conflicts} 走 ApiError.conflicts 消费。 */
export interface NumberConflict {
  number: string;
  playerId: number;
  playerName: string;
}

/** 注册体检的规则面（worker 内部形状 = core/squad-rules.ts SquadRuleContext 的端点投影，registration.ts:252-262） */
export interface SquadRules {
  squadMin: number;
  squadMax: number;
  gkMin: number;
  traineeMax: number;
  wageCap: number | null;
  limits: { ge90: number; ge87: number; growthPa87: number };
  tier: 'premier' | 'second' | null;
}

/** 甄别 FieldDiff #13（typeMismatch）处置 A：rule 收窄为 core 九值联合 SquadIssueRule
 *  （squad_size/gk/trainee_size/trainee_growth/trainee_contract/first_team_contract/ca_pa/
 *  wage_cap/contract）——core/squad-rules.ts:66 是真源，契约不复制字面量（TC-LOCK-07）。
 *  api 手抄的 `rule: string` 比 worker 宽，迁移即自然收窄。 */
export interface SquadIssue {
  rule: SquadIssueRule;
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

/** 注册校验放行档（v6.33.1 特例期开关 registration_check_mode）：
 *  enforce=照常拦；warn=体检照算照显示、但不拦提交；off=教练侧隔离（不体检、不挂红字）。
 */
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
  /** 影响力（v6.37.0）：与 /api/players 同源口径，市场视图列用 */
  influence: number;
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
  // 待生效合同变更（v6.54.0 步骤 7，§10.5）：本端点只服务本队教练。
  // pendingReleaseFee 为 null = 该项不变（RC-only pending 时工资格不加第二行）。
  hasPending?: boolean;
  pendingWage?: number | null;
  pendingReleaseFee?: number | null;
  pendingSource?: ContractPendingView['source'] | null;
  pendingProtectionTicks?: number | null;
  pendingEffectiveWindowSeq?: number | null;
  /** v6.62.0 §5.6：免费续约机会可用（free_rc_change_used=0），续约入口据此提示「本次免费」 */
  freeRcAvailable?: boolean;
}

/** PUT /api/club/squad/numbers（v6.76.0）：最终态批量分配；applied 只含真正变动的球员 */
export interface SquadNumbersResponse {
  ok: boolean;
  applied: { playerId: number; before: string | null; after: string | null }[];
}

export interface SquadOverview {
  club: { id: number; name: string; leagueTier: string | null } | null;
  season: number | null;
  // 报名状态探测（v1.2.0）：true=已报定级赛事（leagueTier 非空）；false=未报名，规则与体检都不做
  registeredInTournament: boolean;
  players: SquadPlayerRow[];
  /** 未签约球员 ID（v6.67.0 D2）：不占人数、不计工资，单开一区 */
  unsigned: number[];
  /** 预计忠诚支出（规则 4.3.2）：中期窗关窗时按现行合同一次性扣，只做展示 */
  loyalty: { total: number; count: number };
  /** 窗口期薪资三段（v6.69.0 期二）：now 与窗末扣费同源；baseline 缺失退两段 */
  wages: {
    cap: number | null;
    baseline: number | null;
    now: number;
    projected: number;
    delta: number | null;
    inCount: number;
    outCount: number;
    overspend: number;
  };
  compliance: SquadCompliance | null;
  rules: SquadRules | null;
  /** 全队待生效合同变更摘要（v6.54.0 步骤 7）：计数 + 工资增量（m/窗） */
  pendingSummary?: { count: number; wageDelta: number };
}

// ---------------------------------------------------------------------------
// 成长引擎（§10，公开 GET /api/players/:id/growth + 教练 POST levelup/china-playstyles
// + 管理端 settlement / periods；锚点 = routes/growth.ts、worker/growth.ts、routes/admin/growth.ts）
// ---------------------------------------------------------------------------

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

/** 升级方案二选一的方案体（worker 内部名 UpgradePlan，worker/growth.ts:94-98 同形） */
export interface UpgradePlanDto {
  ca: number;
  silver: number;
  gold: number;
}

/** 发放明细行（v3.3.0）：psid 是基础 ID（1-99），金徽由 kind 表示。
 *  甄别 FieldDiff #14（typeMismatch）处置 A：createdAt 收为 string | null——列定义
 *  0031_player_playstyles.sql created_at TEXT 可空、worker 行类型 created_at: string|null
 *  原样下发（worker/growth.ts:601-611），现行写路径恒写 so 观测非空，但列可空收不得非空。
 *  另随批补甄别新发现（甄别 fieldDiffs 未列，按 §6.8 前注规则挂 A 类并登记）：
 *  api 手抄 source 三值 'growth'|'china'|'manual' 比 worker 列值域窄——shop-ops.ts:368 直写
 *  'shop'/'external' 发放明细 ⇒ 契约放宽为 core 五值 PlaystyleSource（core 单源，真源
 *  core/playstyle-rules.ts:27）。 */
export interface PlaystyleDetailRow {
  slot: number;
  kind: 'silver' | 'gold';
  psid: number;
  source: PlaystyleSource;
  createdAt: string | null;
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
    /**
     * 档位依据（v6.48.0 §10.3）：自动核定值 + 五条件三态；locked = 管理组人工覆盖过。
     * 老版本部署期间字段可能缺（前端按可选处理）——worker 恒下发（routes/growth.ts:114），
     * 「恒发 vs 可选」方向安全差异按甄别 notes 登记保持可选标记不动。
     */
    tierBasis?: {
      autoTier: number;
      locked: boolean;
      clubCountry: number | null;
      clubCountryName: string | null;
      conditions: TierConditionDetail[];
    };
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
  /** 本次结算依据的成长期（0 = 还没宣告过，全生涯口径） */
  growthPeriodId: number;
  /** 整季训练营固定 XP（默认 40） */
  traineeXp: number;
  /** 半季训练营固定 XP（默认 15） */
  traineeHalfXp: number;
  traineeCount: number;
  traineeFullCount: number;
  traineeHalfCount: number;
  /** 本次实际新入账的人数 / XP（重放时都是 0） */
  traineeCredited: number;
  traineeXpGranted: number;
  chinaCount: number;
  chinaCredited: number;
  milestonesGranted: number;
  pendingLevelUps: { playerId: number; name: string; growthTier: number; pending: number }[];
}

/** 成长期（一个赛季可有多个，通常夹在两个窗口之间）；worker 内部同名 DTO（worker/growth.ts:220，
 *  注释明写『DTO 冻结 camelCase』） */
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

// ---------------------------------------------------------------------------
// 成长档位自动核定（v6.48.0 §10.3，/api/admin/growth/tier-*）
// 条件元数据真源 = core/growth-tier.ts（GrowthTierConditionMeta / TierConditionDetail）：
// 契约按名引用不复制（同 SquadIssueRule 口径，避免第二真源）。
// ---------------------------------------------------------------------------

/** 档位条件元数据：core/growth-tier.ts 的 GrowthTierConditionMeta 以 api 名转发（单源 core） */
export type TierConditionMeta = GrowthTierConditionMeta;
/** 逐条条件的判定结果：命中 / 数据缺失（缺数据不猜，一律记未命中）/ 未命中——core 同名真源转发 */
export type { TierConditionDetail };

/** 单人档位明细（GET /api/admin/growth/:playerId/tier；公开球员页的 tierBasis 是同一口径的子集） */
export interface TierPlayerDetail {
  playerId: number;
  name: string;
  currentTier: number;
  /** true = 人工覆盖过（重算跳过），可解除锁定回到自动值 */
  locked: boolean;
  autoTier: number;
  clubCountry: number | null;
  clubCountryName: string | null;
  conditions: TierConditionDetail[];
}

/** 变更明细行（预览与落库共用；只列档位真的会变/变了的行）；worker 内部同名（worker/growth-tier.ts:39） */
export interface TierDiffRow {
  playerId: number;
  name: string;
  clubId: number | null;
  clubName: string | null;
  currentTier: number;
  nextTier: number;
  conditions: Record<'c1' | 'c2' | 'c3' | 'c4' | 'c5', boolean>;
}

/** 重算汇总（GET 预览 = applied:false、batches:0；POST 落库返回同一形状）。
 *  ok 恒下发（两路由字面量 {ok:true,...}）；conditions 仅 GET 预览带（前端条件说明表用）。 */
export interface TierRecomputeSummary {
  ok: boolean;
  scope: 'players' | 'fcIds' | 'clubs' | 'all';
  scanned: number;
  locked: number;
  up: number;
  down: number;
  unchanged: number;
  applied: boolean;
  batches: number;
  rows: TierDiffRow[];
  truncated: boolean;
  /** 仅 GET 预览带（前端条件说明表用） */
  conditions?: TierConditionMeta[];
}

/** 未设国家的队（GET /api/admin/growth/tier-clubs-without-country）；worker clubsWithoutCountry
 *  返回 {id,name,players}，路由补 countryName:null 透传。 */
export interface TierClubWithoutCountry {
  id: number;
  name: string;
  players: number;
  countryName: null;
}

/** 变更清单行（GET /api/admin/growth/tier-changes，读 audit_log 的 growth_tier* 行） */
export interface TierChangeEntry {
  id: number;
  actor: number | null;
  action: string;
  targetType: string;
  targetId: number | null;
  origin: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

// ---------------------------------------------------------------------------
// 管理端「成长录入」（v6.16.0 按场补录，/api/admin/growth/match-entry；v6.43.0 OCR 预填）
// 锚点 = routes/admin/growth.ts：列表 / 面板 / 提交 / OCR 四处 c.json 泛型 +
// entryMatchItem return 标注（列表行与面板 match 块共用同一份装配）。
// ---------------------------------------------------------------------------

/** 可补录比赛列表行（v6.45.1 起列出全部已确认非弃权场次，按确认时间倒序；v6.46.0 起含杯赛淘汰赛/超级杯/资格赛）。
 *  甄别 FieldDiff #2-#9（typeMismatch）处置 A：competitionType / stageName / stageKind / round /
 *  homeTeam / awayTeam / scoreHome / scoreAway 八字段加 | null——worker 行类型
 *  result_confirmations 列可空（admin/growth.ts:271-278）、entryMatchItem 原样透传（:343-350），
 *  api 手抄的非空声明是谎言；ocrCrossChecks（:627）对 null 比分有分支 ⇒ null 是现实输入。
 *  判级口径为类型层（甄别 notes：非弃权场实际值域未做生产数据验证）。 */
export interface MatchEntryListItem {
  matchId: number;
  season: number;
  windowSeq: number;
  competitionType: string | null;
  stageName: string | null;
  stageKind: string | null;
  round: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  finishedAt: string | null;
  confirmedAt: string | null;
  /** v6.45.0：赛事系统 tournament.id / 赛事名（录入台按赛事分组；赛事库查不到名字时为 null） */
  tournamentId: number | null;
  tournamentName: string | null;
  homeClubId: number | null;
  awayClubId: number | null;
  homeIsCpu: boolean;
  awayIsCpu: boolean;
  /** 该场已录成长事件条数（列表徽标用） */
  recorded: number;
  /**
   * v6.46.0：本场是否计成长 XP（联赛两级全阶段 + 冠军杯小组赛）。
   * false（冠军杯淘汰赛/超级杯/资格赛）= 只能录出场与评分，值照录、XP 恒 0。
   */
  xpEligible: boolean;
}

export interface MatchEntryListResponse {
  matches: MatchEntryListItem[];
}

/** 本场停赛（v6.45.0：赛事仓停赛引擎同口径复算）：reason 三选一，serving/total 组成「第几/共几场」。
 *  形状真源 = worker/tour-suspension.ts MatchSuspension（reason: SuspensionReason 三值逐字同）。 */
export interface MatchEntrySuspended {
  reason: 'red' | 'red_2y' | 'yellow';
  total: number;
  serving: number;
}

/** 一队侧花名册里的球员（v6.45.0：训练营球员与正式球员同口径可录；停赛球员 suspended 非空 = 不可录）。
 *  甄别 FieldDiff #10（workerExtra）：worker 恒下发官方缩写名（admin/growth.ts:440
 *  officialName: p.name）。按 B 类补抄，但收为可选——web 测试夹具 GrowthEntryPage.test.tsx:71
 *  的 player() 工厂返回类型标注 MatchEntryPlayer、无该键，必填会破坏「既有测试文件 git diff
 *  为空」硬断言（批 1 bidCount 先例：类型级消费压着 → 偏离处置字面 + 登记 registered；
 *  收口批 TC-LOCK-08#6 按可选形态落锁，夹具授权后可改必填）。 */
export interface MatchEntryPlayer {
  id: number;
  name: string;
  officialName?: string;
  position: string | null;
  status: string;
  /**
   * v6.52.0：是否计成长 XP（players.growable = 1）。false = 非成长球员：录入照收（比赛数据要用），
   * 但事件 xp 存 0、growth_xp 不累加；面板标灰徽标、本场 XP 显示 0，输入不禁用。
   */
  growable: boolean;
  /** 本场停赛（null = 可录）；面板标红禁行，写端点也会整行拒收 */
  suspended: MatchEntrySuspended | null;
  /** 夺回球权历史累计次数（含本场已录行；v6.42.0 跨场累计基数） */
  duelsTotal: number;
  /** 扑救历史累计次数（含本场已录行） */
  savesTotal: number;
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

/** 单名球员的单场录入（只传有值的字段；后端按 event_type 去重，重复的跳过）。请求侧 DTO：
 *  锚点 = POST /api/admin/growth/match-entry/:matchId 的 body 断言位置。 */
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
  /** 这次实际进账的 XP：新录按事件 XP 累加；改值按差额算（改小累计值会回收，可为负） */
  xp: number;
  written: number;
  /** v6.45.1：改值成功的事件数（来源 manual 的已录事件，值不同即更新原行） */
  updated: number;
  duplicates: number;
}

/** POST /api/admin/growth/match-entry/:matchId 的响应；400 时 body 带 { message } 中文原因 */
export interface MatchEntrySubmitResult {
  ok: boolean;
  written: number;
  /** v6.45.1：改值成功的条数（与 written 分别计数；两者都为 0 时 HTTP 200，否则 201） */
  updated: number;
  duplicates: number;
  totalXp: number;
  perPlayer: MatchEntryPerPlayerResult[];
}

// ---- v6.43.0：截图识别预填（POST /api/admin/growth/match-entry/:matchId/ocr，零 DB 写）----

/** 识别出的单人预填条目（服务端已认人；夺回球权不识别——按裁决保持人工手填）。
 *  形状真源 = core/growth-ocr.ts OcrEntry（matched 六值逐字同）。 */
export interface MatchOcrEntry {
  playerId: number;
  name: string;
  position: string | null;
  draft: { appearance?: true; rating?: number; cleanSheet?: true; saves?: number };
  /** 认人方式：official = 官方缩写名逐字，*folded = 归一化命中，display = 显示名，surname-initial = 姓+首字母形态（v6.51.4），truncated-prefix = 截图名被游戏截断后按前缀认回（v6.51.11） */
  matched: 'official' | 'official-folded' | 'display' | 'display-folded' | 'surname-initial' | 'truncated-prefix';
}

/** 一张截图的识别结果（结构错误 / 交叉校验 / 模型备注都收在 warnings）。
 *  甄别 FieldDiff #12：unmatched[].pos 收窄 string——worker 恒 `string`
 *  （core/growth-ocr.ts:336-339），api 手抄的 `string | null` 比 worker 宽，迁移即收窄。 */
export interface MatchOcrResult {
  team: string | null;
  side: 'home' | 'away';
  kind: 'summary' | 'goalkeeping';
  entries: MatchOcrEntry[];
  /** 认人失败的截图行（表格内手填或忽略） */
  unmatched: { name: string; pos: string }[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 准入体检报告（§6.8 漏审补录，归属 B2）：GET /api/admin/compliance（worker 内联装配于
// routes/admin/reviews.ts:139「准入体检报告」，routes/admin/reviews.ts 不在批 2 白名单 ⇒ worker
// 侧锚点缺口登记 registered）。issues/stats 引用本批 SquadIssue / SquadCompliance['stats']。
// ---------------------------------------------------------------------------

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
