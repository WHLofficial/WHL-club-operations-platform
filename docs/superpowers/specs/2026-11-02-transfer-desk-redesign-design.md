# 转会台改版设计（2026-11-02）

> 需求来源：owner 反馈三件事——① 出价/报价页杂乱，同球员每笔出价都占一行；② 转会台缺统一设计语言，风格割裂；③ 入口不易找到。
>
> 裁决（2026-11-02）：三页签保留，行按球员聚合；球员页出口用浮层；内联出价表单保留；深链落到对应页签并展开该球员行；角标口径 A（只算「该你动」的）；顶部沿用现有「转会」入口，宽屏右上角加「我的转会台」小入口；窄屏顶栏红点 + 市场子导航数字；三期各一次 push。本文档只出方案，不动代码。
>
> 二次拍板（2026-11-03，grilling）：Q1 A 球员页登录教练 eager 拉 panel，匿名不拉；Q2 A 谈判行金额 `releaseFee` 优先、`expectedWage` 兜底、都无「待定」；Q3 A 浮层放完整 `MarketBidForm`、内联保留；Q4 A panel 端点挪到期 C；Q5 原 B（卖方视角）经 Q8 事实核查后**撤销**，本增量不做；Q6 A `desk/summary` 不 settle、转会台进入时 30s coalesce；Q7 A 角标 60s 轮询；Q9 A `MarketNav` 放第 2 位（在售市场之后），`/market` 落地仍在售市场。

## 1. 现状与问题

### 1.1 一行一笔：同球员重复

| 文件 | 现状 |
|---|---|
| `web/src/pages/market/desk/ListingsBidsSection.tsx:82-105` | `bids.map` 一笔出价一行；同球员三次加价 = 三行，球员/卖方/资金提示重复三遍 |
| `web/src/pages/market/desk/OffersSection.tsx` | 列表一行一单；同一球员的多轮/多单并列，行内只有单笔金额与轮次 |
| `web/src/pages/market/desk/NegotiationsSection.tsx:224` | 一 session 一卡；同球员的进行中与已结束分散，已结束区又是另一套行样式 |

### 1.2 设计语言割裂

- 出价区是 `<table>`；报价区桌面表格、≤760px 卡片；谈判区卡片 + 对话流。三套行高、字号、徽标位置、按钮样式。
- 页签计数用 `.mono`，市场子导航是 `.seg`，顶栏是 `.nav-tab`，三处选中态各不相同。
- 球员页右翼是 `.side-row` 两列键值（`web/src/pages/player/SideOps.tsx:500-618`），和转会台表格不是一套语言。

### 1.3 入口难找

- 顶栏「转会中心」只到 `/market`（`web/src/components/TopBar.tsx:127-137`）；转会台是市场子导航第 5 项（`web/src/pages/market/shared.tsx:57-77`）。
- 球员页只有「去转会区」→ `/market`，没有直达转会台、更没有直达该球员行的深链。
- 移动端市场子导航是单行横滑（`web/src/styles.css:2112-2125`），第 5 项默认在视野外。

## 2. 目标 / 非目标

**目标**

1. 转会台三个页签都做到「一名球员一行」，历史/多笔记录在行内展开。
2. 三个页签 + 球员页出口共用一套行、徽标、按钮、空态语言。
3. 宽屏右上角一键直达；移动端顶栏红点 + 市场子导航第 2 位数字；球员页可直达该球员行。
4. 不改业务规则、资金口径、审核流程。

**非目标**

- 不改报价/出价/谈判的服务端状态机（只新增两个只读端点；另在 `GET /api/me/bids`、`GET /api/negotiations?mine=1` 两条读路径复用现有 30s 惰性结算）。
- 不做卖方视角（Q8 撤）：`negotiation_sessions` 只对买方开放，卖方没有读/操作入口；若以后要卖方参与或查看买方合同谈判，另立需求。
- 不重做市场其他页（在售/广告板/海捞/激活/情报）的列表样式；只改共享的 `MarketNav` 顺序与角标。
- 不做实时推送/WebSocket；角标按查询缓存刷新。
- 不新增数据库迁移。

## 3. 总览（三期，各一次 push）

| 期 | 内容 | 迁移 | 新端点 |
|---|---|---|---|
| A | 转会台三页签按球员聚合（桌面行内展开、≤760 抽屉）；行展开用现有 `me/bids` + 挂牌详情；`me/bids`、`negotiations` 读路径补 30s coalesce settle | 无 | 无 |
| B | 入口与角标（顶栏小入口/红点、`MarketNav` 第 2 位+数字、深链、桌内待办条） | 无 | `GET /api/market/desk/summary` |
| C | 球员页状态条 + 浮层、已结束只读态、视觉收口与补测；`transfer-panel` 端点随球员页一起上 | 无 | `GET /api/players/:id/transfer-panel` |

每期独立可上线；push 只在 owner 明确下令那一轮执行（push 到 main 即触发 CF Workers Builds 自动部署）。

## 4. 期 A：数据底座与按球员聚合

### 4.1 期 A 不新增端点

- 期 A 只用现有读模型：`GET /api/me/bids`（我参与过的出价，含 `listingId`/`listingStatus`/`askPrice`/`holdStatus`）、`GET /api/offers?box=...`、`GET /api/negotiations?mine=1`；行展开时再按 `listingId` 拉 `GET /api/market/listings/:id`（现有 `useListingDetail`，`keepPreviousData`），拿当前挂牌的 `nextMinBid`/`askPrice`/`windowOpen` 与全俱乐部出价。
- `GET /api/me/bids` 目前 `ORDER BY id DESC LIMIT 100`；本期不加游标，出价页签在 `bids.length === 100` 时显示「最多展示最近 100 笔」提示条，不静默丢行。要全量另立游标需求。
- 不预取挂牌详情：只有展开某一行时才请求；展开态记在 `Set<playerId>` 里，收起不取消请求（TanStack 缓存 30s）。
- 期 A 起，`GET /api/me/bids` 与 `GET /api/negotiations?mine=1` 的读路径补 `settleOverdue(c.env, { origin:'lazy_settle', coalesceMs: 30_000 })`（30s coalesce 参数同款；用 `waitUntil` 后台跑，测试无 executionCtx 时回退 `await`），这样进入转会台时三个列表任一先到就会触发一次惰性结算。`desk/summary` 仍不跑结算（见 §5.1）。
- 期 A 的页面计数仍用现有 query 派生（见 §4.5）；`desk/summary`（期 B）与 `transfer-panel`（期 C）都不在期 A 出现。
- `src/worker/routes/desk.ts` 从期 B 开始建（先只有 summary），期 C 再加 panel；期 A 不动路由。

### 4.2 聚合规则（纯函数）

新增 `web/src/pages/market/desk/desk-rows.ts`，三个页签共用；所有分组/选当前单/徽标/动作都从这里出，组件只负责渲染：

```ts
export function groupBidsByPlayer(bids: MyBidRow[]): BidPlayerRow[];
export function groupOffersByPlayer(items: OfferListItem[]): OfferPlayerRow[];
export function groupNegotiationsByPlayer(sessions: NegotiationSession[]): NegoPlayerRow[];
// 期 A：桌行只有行内数据，动作按域出；不要在这里 import TransferPanelResponse（期 C 才有）
export function bidActionOf(row: BidPlayerRow): RowAction;
export function offerActionOf(row: OfferPlayerRow): RowAction;
export function negoActionOf(row: NegoPlayerRow): RowAction;
// 期 C：球员页拿到 panel 后再统一成一套动作
export function transferActionsOf(panel: TransferPanelResponse): TransferActions;
```

期 A 的 `desk-rows.ts` 不 import `TransferPanelResponse`；`transferActionsOf` 到期 C 再加。期 A 的三个 `*ActionOf` 只返回「显不显示 / 主按钮文案」，最终仍由后端裁决；期 C 的球员页动作矩阵再把它们收口成 `TransferActions`。

**出价**：

- 按 `player.id` 分组。
- 当前单：组内 `listingStatus` 属于 `listed/bidding/matched_pending/pending_review` 的、且 `id` 最大的那条出价所在挂牌；都已结束则取最新一笔所在挂牌。
- 行金额 = 我在当前单上的最新出价；行徽标 = 该笔 `bid.status`；`bidCount` = 我在当前单上的出价笔数。
- 历史 = 组内全部出价（新→旧），每条带挂牌 id/状态；不同挂牌的历史不合并成「同一单」，行内标「当前」与「历史挂牌 #id」。

**报价**：

- 只在同一个 `box` 内按 `player.id` 分组；`in`/`out` 不合并（同一球员可能既收到又送出，语义不同）。
- 当前单优先级：`pending && myTurn` > `pending` > `intent` > 最新 `updatedAt`；历史 = 组内全部。
- 行金额 = 当前单 `amount`；行徽标 = 当前单 `status`（`myTurn` 时加「待你回应」）。

**谈判**：

- 按 `player.id` 分组；当前 = `active` 会话（没有则最新已结束）。**行内只展开当前会话**；已结束不放进球员行，统一留在页尾「已结束的谈判 · N 场」总折叠（§4.5）。
- 行金额：当前会话 `releaseFee` 有值取 `releaseFee`，否则取 `expectedWage`，都无显示「待定」；谈判页签列头写「违约金/工资」，不写「金额」。
- 行徽标：`active && needsReleaseFee(s)` → 「定违约金」；`active` → 「工资谈判 · 剩 N 轮」；`settled` → 「已签约」；`cancelled` → 「已作废」。`needsReleaseFee` 目前是 `NegotiationsSection.tsx:363-370` 的局部函数（条件 `releaseFee === null || (transfer.type === 'forced_auction' && expectedWage === null)`），本期导出或移到 `status.ts`，不能只判 `releaseFee === null`。
- 展开内容直接复用现有 `SessionCard`（`NegotiationsSection.tsx:372`），不重写对话流；`SessionCard` 加 `hideHeader` 供行内使用，并 export。

### 4.3 状态与动作矩阵

统一词表放 `web/src/pages/market/desk/status.ts`，三页签 + 球员页共用：

| 域 | 状态 | 徽标 | 主按钮 |
|---|---|---|---|
| 出价 | `active` | 领先中（sky） | 查看详情 |
| 出价 | `superseded` + 挂牌 `bidding` + `canBid` | 被超出（gold） | 加价 |
| 出价 | `superseded` + 挂牌已结束 | 已结束 · 未中标（gray） | 查看记录 |
| 出价 | `won` | 已中标（green） | 查看记录 |
| 出价 | `won` + 挂牌 `pending_review` | 待审核（purple） | 查看记录 |
| 出价 | `withdrawn` | 已撤回（gray） | 查看记录 |
| 报价 | `pending && myTurn` | 待你回应（gold） | 回应 |
| 报价 | `pending && !myTurn` | 等对方（sky） | 查看 |
| 报价 | `intent` | 意向单 · 等开窗（gold） | 查看 |
| 报价 | `accepted` | 已接受 · 挂牌竞价中（green） | 查看 |
| 报价 | `rejected/withdrawn/expired` | 已结束（gray） | 查看记录 |
| 谈判 | `active && needsReleaseFee(s)` | 定违约金（gold） | 继续谈判 |
| 谈判 | `active` | 工资谈判 · 剩 N 轮（sky） | 继续谈判 |
| 谈判 | `settled` | 已签约（green） | 查看 |
| 谈判 | `cancelled` | 已作废（gray） | 查看 |

球员页动作矩阵（期 C 用 `transferActionsOf(panel)`；期 A 的桌行用 `bidActionOf/offerActionOf/negoActionOf`，不 import `TransferPanelResponse`）：

| 球员/单据状态 | 主按钮 | 次按钮 | 不渲染 |
|---|---|---|---|
| 外队挂牌、我在竞价、`canBid` | 加价 | 查看详情 | — |
| 外队挂牌、激活首价窗、非激活方 | — | 查看详情 | 出价 |
| 外队未挂牌 | 报价 | 激活 | — |
| 本队挂牌 | 查看挂牌 | 匹配决定（`matched_pending` 且我是激活方） | 出价/报价 |
| 已结束 | — | 查看记录 | 出价/报价/激活 |

- 挂牌期报价后端 409 `player_listed`、激活 400；前端不渲染这两个按钮，不让用户点了才吃错。
- `canBid` 口径沿用 `SideOps.tsx:554-560`：`status in (listed,bidding)`、`windowOpen`、`!bidPaused`、`!marketBidPaused`、且 `firstBidPending` 时只有激活方可以出价。
- `status.ts` 也收 listing 状态文案（`listed/bidding`=挂牌中、`pending_review`=待审核、`matched_pending`=等匹配、`delisted`=已结束），球员页状态条直接取，不另写一套。

### 4.4 行组件

新增 `web/src/pages/market/desk/DeskPlayerRow.tsx`：

- 桌面（>760）：`div.desk-row` 五列 grid —— 球员（姓名 + 位置/CA + 对方俱乐部）| 金额（mono 右对齐）| 状态 badge | 主按钮 | chevron。行高 56px。
- 行体本身不加 `role="button"`（避免与主按钮嵌套）：右侧 chevron 用真 `<button>` 承载 `aria-expanded`/`aria-controls`，Enter/Space 切换；行体点击只做鼠标增强，主按钮 `onClick`/`onKeyDown` 停冒泡。
- 展开面板 `div.desk-row-panel`：桌面左历史（时间线）+ 右摘要/动作；≤760 单列。
- 桌面允许多行同时展开（`Set<number>`），方便比价；≤760 点行开抽屉，一次只开一个。
- ≤760 抽屉复用 `useOverlayShell`（`web/src/lib/use-overlay-shell.ts`，760px 断点、锁滚、Esc、Tab 循环、焦点归位）+ 现有 `.mkt-ov*` 底部抽屉壳；不新造浮层。
- 展开内容：
  - 出价：历史行（金额/时间/状态/挂牌号）+ `MarketBidForm`（仅 `canBid` 时渲染；`web/src/components/MarketBidForm.tsx`，`mode` 按 listing 详情同口径：`firstBidPending && activatedBy === 我的俱乐部` → `activation-first`，否则 `normal`；期 A 用 `useListingDetail(listingId)` 取 `nextMinBid`/`askPrice`/`windowOpen`，期 C 改用 `transfer-panel` 的同名字段；`oldHold` 取我在该单 `status='active'` 的出价金额，没有则 0）。
  - 报价：当前单摘要 + 历史 + 「打开谈判桌」按钮（复用现有报价详情浮层，不重写对话流）。
  - 谈判：当前会话的 `SessionCard` 正文；已结束不在此展开，统一在页尾总折叠。

### 4.5 三页签改造

- `ListingsBidsSection.tsx`：表格行换成 `groupBidsByPlayer` 的球员行；保留余额提示；删除一笔一行的 `<tr>`。文件名先保留（避免 import/测试大迁移），组件内部改。
- `OffersSection.tsx`：列表换成 `groupOffersByPlayer` 的球员行；`box/status` 筛选保留；主按钮「回应」直接打开现有 `?offer=<id>` 浮层（`openId` 机制不动）；历史展开只读。
- `NegotiationsSection.tsx`：`active.map` 换成 `groupNegotiationsByPlayer` 的球员行；`DemandSection` 仍在页签顶部；**保留页尾的「已结束的谈判 · N 场」总折叠**（`NegotiationsSection.tsx:247-286` 现有结构不动），球员行内只放当前会话，不再套第二层折叠。
- 页签计数：期 A 先沿用现有 query 派生（`MarketDeskPage.tsx:42-46`），不动数字；期 B 接 `useDeskSummary` 后，页签数字统一改成 A 口径的「待办」数（谈判 active / 报价 pendingMine / 出价被超出），页签下方的 `hint` 再给「进行中 M」。两套数分工写进注释，避免以后又把「领先中」当「待办」。

## 5. 期 B：入口与角标

### 5.1 新端点 `GET /api/market/desk/summary`

- 权限：`requireCoach(..., 'club.squad.manage')`；未绑队返回 `{ negotiations:0, offers:0, bids:0, total:0 }`（200），避免顶栏出现 404 噪音。
- 三条 COUNT 一次 `db.batch`：

```sql
-- 1) 谈判：active 即待办（表无 turn 列）
SELECT COUNT(*) AS n FROM negotiation_sessions WHERE club_id = ? AND status = 'active';

-- 2) 报价：轮到我表态（in 看 seller，out 看 buyer）
SELECT COUNT(*) AS n FROM offers
WHERE status = 'pending'
  AND ((seller_club_id = ? AND turn = 'seller') OR (buyer_club_id = ? AND turn = 'buyer'));

-- 3) 出价：我在该挂牌上的最新一笔已被超出，且挂牌仍在竞价
SELECT COUNT(*) AS n FROM bids b
JOIN listings l ON l.id = b.listing_id
WHERE b.club_id = ?
  AND b.status = 'superseded'
  AND l.status = 'bidding'
  AND b.id = (SELECT MAX(b2.id) FROM bids b2 WHERE b2.listing_id = b.listing_id AND b2.club_id = b.club_id);
```

- 响应 `{ negotiations, offers, bids, total }`；`total` 为三者之和。
- 响应头 `Cache-Control: private, no-store`；用户级计数不能进共享缓存。
- **不跑 `settleOverdue`**（Q6 A）：这是导航角标，不是账本。报价/挂牌的读路径本来就有 30s coalesce 的惰性结算（`src/worker/routes/offers.ts`、`src/worker/routes/market.ts:866`），角标允许落后一个结算窗；把整跑结算挂到每个页面的顶栏会让一次导航多十几趟 D1（生产实测约 220ms/条）。owner 已拍板不跑；若以后要求与列表严格一致，再另议。
- 索引已存在：`idx_negotiation_sessions_club`、`idx_negotiation_sessions_active`、`idx_offers_seller`、`idx_offers_buyer`、`idx_offers_player`、`idx_bids_club`、`idx_bids_status`、`idx_listings_status_*`。零迁移。

### 5.2 前端 `useDeskSummary`

- `web/src/lib/queries.ts`：`qk.deskSummary = ['market','desk','summary']`；`useDeskSummary(enabled)`，`staleTime: 60_000`，`refetchInterval: 60_000`，`refetchIntervalInBackground: false`，`refetchOnWindowFocus: true`。60s 轮询口径已由 owner 拍板（2026-11-03）；切后台自动停，回前台立即补一枪。
- enabled 只在 `isCoach`（coach/admin）时开；匿名/观众不请求。
- 写后失效：`useMarketInvalidation`（出价/挂牌）、`useOffersInvalidation`（报价）、谈判 `refresh` 三处都加 `qk.deskSummary`；否则角标要等 60s 才掉。
- 顶栏/市场子导航/桌内待办条共用这一个 hook，TanStack 缓存只发一次。

### 5.3 顶栏入口

- `web/src/components/TopBar.tsx` 的 `.userbox` 里、收件箱图标之前，加 `NavLink.desk-shortcut` → `/market/desk`：
  - 文案「我的转会台」，右侧数字 pill；`total === 0` 时只显示文案、不显示 0。
  - 仅 `min-width: 901px` 渲染（CSS `display:none` + 媒体查询；DOM 条件也可）。
  - `aria-label="我的转会台，N 项待办"`；数字 >99 显示 `99+`。
- 现有「转会中心」`.nav-tab` 加 `span.nav-dot`：`total > 0` 时渲染；CSS `position:absolute; top:4px; right:4px; width:6px; height:6px; border-radius:50%`，父级 `.nav-tab { position: relative }`。绝对定位**不占布局宽**，360px 下 8 项仍约 326px / 可视 336px，不破坏 `styles.css:1310-1315` 的「不横滑」约束。
- 641–900 也不渲染文字入口：顶栏 8 项在平板宽度已要横滑，再塞 90px 会把导航挤到只剩两三项；这一档靠红点 + 市场子导航数字。
- 不在 ≤640 往顶栏塞数字：数字 pill 至少 14–18px，会打破 360px 预算；真要数字，只能把 8 项之一收进 ≡ 腾 40px，不建议。
- 901–1024 验收：文字入口出现后 nav 仍能横滑到全部 8 项；若挤压，断点提到 1100 或隐藏 `.role-badge`。

### 5.4 市场子导航

- **Q9 已拍板（2026-11-03）：放第 2 位**。`/market` 仍直接渲染 `MarketBoardPage`（`web/src/App.tsx:127`），第一项「在售市场」`to="/market"` 带 `end`，保持 active；「我的转会台」从第 5 位挪到「在售市场」之后，其余顺序不动。
- 顺序改动同步 `tests/mobile-baseline.test.ts:761-767` 的源文本 `indexOf` 断言；320/360 e2e 复核第 2 位可见。
- 该项加 `span.seg-count`：数字 pill，10px 字号 / 14px 高，`total === 0` 不渲染，>99 显示 `99+`；`aria-label` 带全量数字。
- `scrollIntoView` 逻辑保留（`shared.tsx:47-54`）：进入市场先看到前两位；切到「市场情报」时 desk 项会滑出视野，跨页提醒由顶栏红点承担。
- `shared.tsx:46` 的注释明确页签顺序被 `tests/mobile-baseline.test.ts` 按源文本 `indexOf` 锁定；改顺序必须同步改该测试。

### 5.5 深链

- `/market/desk?tab=bids&player=<内部 id>`：落到出价页签并展开该球员行；`tab=offers` / `tab=nego` 同理。
- 只有 `player` 没有 `tab`：默认 `bids`；若该球员不在当前列表，显示提示条「这名球员不在本页签，可能已结束」+ 另外两个页签的链接，不静默丢弃。
- 挂载时 `expanded.add(player)`；数据到位后 `scrollIntoView({ block:'center' })`（jsdom 无此方法，先探测再调，照 `OffersSection.tsx:188-192` 的写法）。
- 现有 `?tab=negotiations`、`?tab=mine`、`?offer=<id>`、`?demand=<id>` 全部保留，回归测试覆盖。
- 球员页出口：
  - 外队挂牌且我出过价 → `/market/desk?tab=bids&player=<id>`；
  - 本队挂牌 → `/market/desk?tab=nego&player=<id>`；
  - 已结束 → `/market/desk?tab=bids&player=<id>`（没有出价记录则 `tab=offers`）。

### 5.6 桌内待办条

- 页签数字 = `useDeskSummary` 的三个数（A 口径，和导航数字/红点同源）；页签下方一行 `hint`：`待办 N · 进行中 M`。
- 「进行中」口径：
  - 谈判：`active` 会话数（与待办相同，M=N）；
  - 报价：`pending` + `intent` 的条数（in/out 合并，按 id 去重）；
  - 出价：分组后当前挂牌仍在 `listed/bidding/matched_pending/pending_review` 的球员行数（含我领先与被超出）。
- 两个数分开，不混成一个；页签数字不再用「active 出价」冒充待办（期 B 改）。

## 6. 期 C：球员页状态条 + 浮层

### 6.1 新端点 `GET /api/players/:id/transfer-panel`

**用途**：球员页浮层与期 C 的转会台行展开共用同一份响应，避免四个列表各拼一份、字段漂移；期 A 的行展开不依赖它（见 §4.1）。

- `:id` 一律**内部 `players.id`**（不是 FC id）：两个调用方手里都已有内部 id（`player.id`），不引入 FC id / 内部 id 的歧义。
- 权限：`requireCoach(c.env, c.req.raw, 'club.squad.manage')`；未绑队也返回公开挂牌部分，个人数组为空。
- 读路径结算：与 `GET /api/market/listings/:id` 同款，`settleOverdue(c.env, { origin:'lazy_settle', coalesceMs:30_000 })` 用 `waitUntil` 后台跑（测试无 executionCtx 时就地 await），**不承诺本次响应已结算完**：响应可能落后一个结算窗；`useTransferPanel` 用 `staleTime 30s` + 写后失效补齐。除结算外不写库、不耗轮次。

响应形状（`web/src/lib/api.ts` 新增 DTO）：

```ts
export interface TransferPanelResponse {
  club: { id: number; name: string } | null; // 我的俱乐部；未绑队为 null
  player: {
    id: number; fcId: number | null; name: string; position: string | null;
    age: number | null; ca: number | null; pa: number | null;
    clubId: number | null; clubName: string | null; isMine: boolean;
    status: string; // 球员状态（listed 等，沿用 players.status）
  };
  listing: (MarketListingDetail['listing'] & { marketBidPaused: boolean }) | null;
  bids: { id: number; clubId: number; clubName: string; amount: number; createdAt: string; status: string }[];
  myBids: { id: number; listingId: number; amount: number; createdAt: string; status: string; holdStatus: string | null }[];
  offers: { in: OfferListItem[]; out: OfferListItem[] };
  negotiation: {
    id: number; status: 'active' | 'settled' | 'cancelled';
    releaseFee: number | null; expectedWage: number | null;
    attemptsUsed: number; remaining: number; expiresAt: string | null;
    settled: { wage: number | null; source: string; message: string } | null;
  } | null;
  transfer: {
    id: number; type: string; fee: number | null;
    fromClubId: number | null; fromClubName: string | null;
    toClubId: number | null; toClubName: string | null;
    completedAt: string | null;
  } | null;
  asOf: string;
}
```

**选单规则**（服务端）：

- `listing`：取该球员 `status IN ('listed','bidding','matched_pending','pending_review')` 的最新一单；没有则取最新 `delisted`；都没有为 `null`。字段与 `GET /api/market/listings/:id` 的 `listing` 完全同口径（含 `releaseFee`、`windowOpen`、`nextMinBid`、`bidStepMin`、`deadlineAt`、`matchPhase`、`firstBidPending`），并带 `marketBidPaused`。`releaseFee` 需按现有 listing 详情同样的方式另查 `contracts`（`is_active = 1`），不要漏；`marketBidPaused` 也走现有 helper，不重新发明口径。
- `bids`：该 `listing_id` 下最近 50 笔，按 `id DESC`（与 `GET /api/market/listings/:id` 一致，本就是公开信息；不是全量）。
- `myBids`：**独立查询，不能从 `bids` 的 50 条里筛**：`SELECT b.id, b.listing_id, b.amount, b.created_at, b.status, f.status AS hold_status FROM bids b JOIN listings l ON l.id=b.listing_id LEFT JOIN fund_holds f ON f.id=b.hold_id WHERE b.club_id=? AND l.player_id=? ORDER BY b.id DESC LIMIT 20`；带 `listing_id`，供前端识别「我的最终出价」属于哪一单。
- `offers`：**in/out 各查一条，各 `LIMIT 20`**（不能一条 `LIMIT 20` 再分侧，否则 20 条全 out 时 in 被饿死）：`WHERE player_id=? AND seller_club_id=? ORDER BY updated_at DESC LIMIT 20` / `WHERE player_id=? AND buyer_club_id=? ORDER BY updated_at DESC LIMIT 20`；分别映射到 `in`/`out`。`myTurn` 口径与 `GET /api/offers` 一致：`status='pending'` 且 `turn` 等于我这一侧（我是卖方看 `turn='seller'`，我是买方看 `turn='buyer'`）。
- `transfer`：最新一笔已完成、`to_club_id IS NOT NULL` 且属于换队类（`type IN ('transfer','activation','match','free_agent','forced_auction')`）的转会，按 `(completed_at IS NULL), completed_at DESC, id DESC LIMIT 1`；用于已结束态的成交价/去向。`fee` 为 null 时显示「未披露」，不能拿 `listing.ask_price` 冒充成交价；`rc_change`/`termination`/`promotion` 不算。
- `negotiation`：`SELECT ... FROM negotiation_sessions WHERE player_id=? AND club_id=? ORDER BY (status='active') DESC, id DESC LIMIT 1`；只回我作为买方的会话摘要，不回 attempts 全文（对话流仍在谈判页签读）。
- 查询批次：球员 + 挂牌（含 `releaseFee`/派生字段的 helper）+ `transfer` + `offers in` + `offers out` + `negotiation` + `myBids` 第一批；`bids` 依赖挂牌 id，第二批。两趟 D1 往返。
- 缓存：`Cache-Control: private, no-store`；前端 `staleTime: 30_000`。

**路由落点**：`src/worker/routes/desk.ts`（期 B 建，先 `/market/desk/summary`；期 C 加 `/players/:id/transfer-panel`），在 `src/worker/index.ts` 里与 `marketRoutes` 同层挂 `/api`。避免塞进 `market.ts` 继续膨胀；也不与 `offers.ts` 的 `/players/:id/offer-settings` 混在一起。

### 6.2 状态条

- **本队挂牌**（`SideOps.tsx:500-548`）：保留要价/最高出价/领先出价方/挂牌编号；加一行状态（按 `listing.status`）：
  - `listed/bidding` → `挂牌中 · 最高 X m · 截止 HH:mm`；
  - `pending_review` → `已截止 · 待管理组审核`；
  - `matched_pending` → `首价落定 · 等匹配`；
  - 已结束走下面分态。
  - 按钮：`查看详情 ›` 开浮层；`去转会区` 保留为次要链接。
- **外队挂牌**（`SideOps.tsx:549-618`）：保留内联 `MarketBidForm`（已定）；加一行：
  - `我的出价 X m · 领先中/被超出 · 共 N 笔`（取 `myBids` 中当前 `listingId` 的最近一笔与笔数）；
  - 状态徽标按 `listing.status`（`pending_review`=待审核、`matched_pending`=等匹配），不写「挂牌中」；
  - `查看详情 ›` 开浮层；
  - 原「去转会区看详情」改成 `/market/desk?tab=bids&player=<id>` 深链，避免两个都去 `/market` 的重复出口。
- **已结束**：新增只读态，按 `transfer` 分态，不能一律写「未中标」：
  - 标题「转会区 · 已结束」；
  - `club` 非空且 `transfer.fromClubId === club.id`（我是卖方）：`已售出 · 成交价 X m（去 {toClubName}）`；
  - `club` 非空且有 `transfer` 且 `transfer.toClubId !== club.id`：若 `myBids` 为空 → `成交价 X m（去 {toClubName}） / 未出价`；否则 `成交价 X m（去 {toClubName}） / 我的最终出价 Y m / 结果：未中标`；
  - `club` 非空且有 `transfer` 且 `transfer.toClubId === club.id`：`已签下 · 成交价 X m`；
  - 无 `transfer`：`已结束 · 未成交/留队`，按 `listing.deadlineNote`（「被匹配，球员留队」「审核驳回」「管理组取消」）显示原因；
  - `fee` 为 null 显示「未披露」；不再渲染出价/报价/激活按钮；文案不再出现「输给」。
- 状态条显示条件：`listing` 为 active（`listed/bidding/matched_pending/pending_review`）；或 `listing` 为 ended 且（`listing.sellerClubId === club.id` / `myBids` 非空 / `offers.in` 或 `out` 非空 / `negotiation` 非 null）；或 `listing` 为 null 但 `negotiation`/`offers`/`myBids` 非空；或（`club` 非空且 `transfer` 非空且（`transfer.fromClubId === club.id` 或 `transfer.toClubId === club.id`））。全部不满足时整条不渲染——不要给所有历史挂牌球员挂一条无信息的「已结束」。
- **无挂牌 · 有在途单据**：`listing` 为 null 且 `negotiation` 非空 → `签约谈判中 · 剩余 N 轮` + 查看详情；`offers`/`myBids` 非空 → `报价/出价 N 笔` + 查看详情；不渲染 listing 相关按钮。

### 6.3 `PlayerTransferDialog`

- 新增 `web/src/pages/market/PlayerTransferDialog.tsx`：`.modal-mask` + `.modal-card.card.transfer-dialog`（`width: min(560px, 100%)`），`role="dialog"`、`aria-modal="true"`。
- 关闭：点遮罩、Esc、右上角 ×；用 `useOverlayShell` 拿焦点陷阱/锁滚/Esc，面板 `panelRef` 挂 `.modal-card`。不引第二套浮层 CSS。
- 内容：`PlayerTransferPanel`，`mode='player'`（dialog 只是球员页的容器，不新增 `'dialog'`；`'desk'` 只给转会台行展开）。
- 挂载点：`SideOps.tsx:1322-1330` 一带，与 `ActivationProofDialog` 并列，避免被右翼 300px 宽度限制。

### 6.4 `PlayerTransferPanel`

新增 `web/src/pages/market/PlayerTransferPanel.tsx`，转会台行展开与球员页浮层共用：

```ts
export function PlayerTransferPanel({
  playerId, mode, onClose, onChanged,
}: {
  playerId: number;
  mode: 'desk' | 'player';
  onClose?: () => void;
  onChanged?: () => void;
});
```

- 取数：`useTransferPanel(playerId)`（新 hook，`staleTime: 30_000`）。期 C 起，登录教练进入球员页即挂载/预取（Q1 A，eager），匿名/观众不请求；浮层打开直接用缓存，行展开与浮层共用同一个 query key，不重复请求。
- 结构：
  1. 头部：球员名 + 位置/CA + 所属俱乐部 + `IdTag kind="球员"`。
  2. 状态条：挂牌状态、要价、最高出价、我的出价、截止时间、出价笔数；本队挂牌另显示领先方与匹配动作。
  3. 出价历史：金额/时间/状态/俱乐部，我的行高亮。
  4. 报价摘要：in/out 各最多 3 条；`mode='desk'` 时「去回应」打开现有报价浮层（`?offer=`）；`mode='player'`（含 dialog）时先 `onClose()` 关掉转会浮层，再导航到 `/market/desk?tab=offers&offer=<id>`，不叠两层浮层。
  5. 谈判摘要：违约金/预期工资/剩余轮数/静默作废倒计时；`mode='player'` 时先关浮层再深链到 `tab=nego`；`mode='desk'` 直接深链。
  6. 动作区：`canBid` 时渲染 `MarketBidForm`（复用，不复制校验；`mode` 同 §4.4 的 `activation-first`/`normal` 判定）；未挂牌时渲染「报价」「激活」（仅 `mode='player'`）；本队挂牌渲染「查看挂牌」「匹配决定」；已结束只渲染「查看记录」。
- 余额/额度不塞进 panel 响应：用 `useClubBalance`（已全局缓存），传 `available`/`creditLine` 给 `MarketBidForm`；`oldHold` 从 `myBids` 里取 `listingId === 当前挂牌 && status === 'active'` 的金额，没有则 0。
- 服务端仍是最终裁决；前端 `transferActionsOf` 只决定「显不显示」，不替代后端校验。

### 6.5 保留 / 删除

- 保留球员页内联 `MarketBidForm`（已定）。
- 删除「去转会区看详情」这种只到 `/market` 的重复出口，换成深链 + 浮层。
- `去转会区` 本队挂牌保留（看全部市场活动），浮层负责本球员细节。

## 7. 设计语言收口

- **一套行**：`desk-row` / `desk-row-panel` 三页签共用；桌面行高 56px，≤760 卡片行高 ≥64px；球员名 14px/600，meta 12px muted，金额 14px mono，徽标 11px。
- **一套徽标**：全部走现有 `.badge` 五色（sky/gold/green/purple/gray/red），标签只从 `status.ts` 取，不在组件里写字符串。
- **一套动作**：每行最多一个主按钮（`.btn` 实心），其余 `.btn-ghost`；禁用原因写 `title`（沿用 `OffersSection.tsx:11` 的注释口径）。
- **一套空态**：`<div className="card empty-state"><p className="muted">…</p></div>`，一句话 + 下一步。
- **计数**：页签计数 `.mono`；导航数字 `.seg-count`；顶栏红点零宽。0 一律不显示。
- **文案**：已结束按 §6.2 分态：我是卖方「已售出」、出价方「未中标」、买方「已签下」、无 transfer「未成交/留队」；展开后「成交价 X m（去 {toClubName}） / 我的最终出价 Y m / 结果 …」；不再出现「输给」。
- **断点**：760px = 行→卡片/抽屉（与 `OffersSection.tsx:53` 的 `CARDS_QUERY` 同源）；640px = 顶栏两行；900px = 右上角文字入口。三个断点写进注释，避免下次又加一套。
- **不改字体/色板**：只复用 CSS 变量；新增 `.desk-*`、`.transfer-dialog`、`.nav-dot`、`.seg-count`、`.desk-shortcut` 追加到 `styles.css` 对应区块。

## 8. 接口与数据细节

### 8.1 `transfer-panel` 查询

```sql
-- 球员 + 所属俱乐部
SELECT p.id, p.fc_id, p.name, p.position, p.age, p.ca, p.pa, p.status,
       p.club_id, cl.name AS club_name
FROM players p LEFT JOIN clubs cl ON cl.id = p.club_id
WHERE p.id = ?;

-- 当前/最近挂牌（与 GET /api/market/listings/:id 的字段对齐）
SELECT l.*, p..., cl.name AS seller_name, ca2.name AS activator_name
FROM listings l
JOIN players p ON p.id = l.player_id
LEFT JOIN clubs cl ON cl.id = l.seller_club_id
LEFT JOIN clubs ca2 ON ca2.id = l.activated_by
WHERE l.player_id = ?
ORDER BY CASE WHEN l.status IN ('listed','bidding','matched_pending','pending_review') THEN 0 ELSE 1 END,
         l.id DESC
LIMIT 1;

-- 该挂牌出价（公开；冻结状态只回我自己的）
SELECT b.id, b.club_id, cl.name AS club_name, b.amount, b.created_at, b.status,
       CASE WHEN b.club_id = ? THEN f.status END AS hold_status
FROM bids b JOIN clubs cl ON cl.id = b.club_id
LEFT JOIN fund_holds f ON f.id = b.hold_id
WHERE b.listing_id = ? ORDER BY b.id DESC LIMIT 50;

-- 该球员与我相关的报价：in/out 各一条，各 LIMIT 20（不要合成一条再分侧）
SELECT o.*, p... FROM offers o JOIN players p ON p.id = o.player_id
WHERE o.player_id = ? AND o.seller_club_id = ?
ORDER BY o.updated_at DESC LIMIT 20;

SELECT o.*, p... FROM offers o JOIN players p ON p.id = o.player_id
WHERE o.player_id = ? AND o.buyer_club_id = ?
ORDER BY o.updated_at DESC LIMIT 20;

-- 我的出价（跨该球员的全部挂牌；不能从 listing 的 50 条里筛）
SELECT b.id, b.listing_id, b.amount, b.created_at, b.status, f.status AS hold_status
FROM bids b
JOIN listings l ON l.id = b.listing_id
LEFT JOIN fund_holds f ON f.id = b.hold_id
WHERE b.club_id = ? AND l.player_id = ?
ORDER BY b.id DESC LIMIT 20;

-- 最新一笔已完成转会（成交价/去向）
SELECT t.id, t.type, t.fee, t.from_club_id, fc.name AS from_club_name,
       t.to_club_id, tc.name AS to_club_name, t.completed_at
FROM transfers t
LEFT JOIN clubs fc ON fc.id = t.from_club_id
LEFT JOIN clubs tc ON tc.id = t.to_club_id
WHERE t.player_id = ? AND t.status = 'completed' AND t.to_club_id IS NOT NULL
  AND t.type IN ('transfer','activation','match','free_agent','forced_auction')
ORDER BY (t.completed_at IS NULL), t.completed_at DESC, t.id DESC LIMIT 1;

-- 我作为买方的谈判会话（列名以 0001/0006/0007/0069 迁移为准）
SELECT id, status, release_fee, expected_wage, attempt_count, settled_wage, settle_source, settled_at
FROM negotiation_sessions
WHERE player_id = ? AND club_id = ?
ORDER BY (status = 'active') DESC, id DESC LIMIT 1;

```

- `attemptsUsed` / `remaining` / `expiresAt` 是 DTO 派生字段：`remaining = maxAttempts - attempt_count`（`src/worker/negotiations.ts:870`），`expiresAt` 按 `expiry_anchor_at + negotiation_silence_hours` 计算（`0069_ops_schedule_expiry.sql:38`），SQL 里没有同名列。
- `settled.message` 不是库列，由 `settleMessage(source)` 生成（`src/worker/negotiations.ts:661` 一带）；panel 要回这句话就复用同一个 helper，别在前端另写一套。
- `SELECT l.*` 只是形状示意：`releaseFee` 走 `contracts`（`is_active=1`），`nextMinBid`/`bidStepMin`/`windowOpen`/`matchPhase`/`firstBidPending`/`marketBidPaused` 都是派生字段，复用 listing 详情的 loader/helper；panel 只组装 DTO。
- `bids` 的 `club_id`/`club_name` 是公开信息（挂牌详情已下发），不构成越权。
- `offers`/`negotiation` 必须带 `club_id` 过滤；不能只按 `player_id` 把别队报价带出来。
- 不做卖方视角（Q8 撤）：`negotiation_sessions` 只对买方开放，卖方没有读/操作入口；见 §2 非目标。

### 8.2 `desk/summary` 口径

- 谈判：`active` 即待办；静默过期但尚未被结算收口的会话仍计入，直到下次结算（`GET /api/negotiations?mine=1` 从期 A 起也跑 30s coalesce settle，见 §4.1）。
- 报价：只算 `pending` 且轮到我；`intent` 是卖方待确认，但 `turn` 不看，**不计入**（与 `pendingMine` 一致；若要算，另加 `intentsMine`，本期不加）。
- 出价：只算「最新一笔被超出 + 挂牌仍 bidding」；自己加价后旧价变 `superseded`，但最新一笔是 `active`，不计；挂牌进入 `matched_pending`/`pending_review` 后不再计。
- 不跑 `settleOverdue`（Q6 A）：角标允许落后一个结算窗；进入转会台时 `me/bids`/`offers`/`negotiations` 任一读路径的 30s coalesce 结算会收口（见 §4.1）。
- 未绑队：全 0，200。

### 8.3 失效与刷新

- 出价成功：`useMarketInvalidation(listingId, playerId?)` → board + myBids + listing detail + `deskSummary` +（传了 playerId 时）`transferPanel`。
- 报价动作：`useOffersInvalidation(playerId?)` → offers 全组 + myClub + `deskSummary` +（传了 playerId 时）`transferPanel`。
- 谈判动作：`qk.myNegotiations` + `deskSummary` + `qc.invalidateQueries(['market','transfer-panel', playerId])`。
- `transferPanel` 的 key：`['market','transfer-panel', playerId]`；两个 hook 都加可选 `playerId` 参数，现有调用点不传、行为不变；桌行/球员页的动作回调传 `player.id`。

## 9. 测试与验收

### 9.1 单测

- `desk-rows.test.ts`：
  - 同球员同挂牌 3 笔出价 → 1 行，历史 3 条；
  - 同球员两个挂牌 → 1 行，当前单选对；
  - 同球员同 box 2 条报价 → 1 行；in/out 不合并；
  - active + ended 谈判 → 1 行，当前 active，已结束不在行内展开；
  - 每个状态的徽标/主按钮矩阵；
  - `forced_auction` + `releaseFee` 已预填 + `expectedWage=null` → 徽标「定违约金」。
- `transfer-panel` 后端测试：
  - 未绑队 → `club:null`、个人数组空、挂牌仍返回；
  - 未知球员 → 404；
  - 别队报价/谈判不出现在响应；
  - `myBids` 的 holdStatus、`myTurn` 口径；
  - 我的出价在 listing 的 50 条之外仍出现在 `myBids`，且带 `listingId`；
  - 20 条 out + 1 条 in：`in` 不被饿死；
  - `transfer` 取最新 completed 且有 `to_club_id`；无 transfer 时 `transfer:null`。
- 读路径结算：`GET /api/me/bids`、`GET /api/negotiations?mine=1` 各补一条 spy，确认调用 `settleOverdue` 且 `coalesceMs=30_000`、走 `waitUntil`；`GET /api/market/desk/summary` 不调用。
- `desk/summary` 后端测试：
  - 0 条 / 各域计数；
  - 自己加价后旧 `superseded` 不计；
  - 非 `bidding` 挂牌不计；
  - 报价 in/out 两侧都算；
  - 未绑队全 0；
  - 响应头 `Cache-Control: private, no-store`。

### 9.2 组件测试

- `MarketDeskPage.test.tsx`：三页签、计数、`?tab=negotiations`/`?tab=mine` 别名、`?player=` 展开；`bids.length === 100` 时提示条。
- `ListingsBidsSection.test.tsx`：一球员一行、展开、加价表单。
- `OffersSection.test.tsx`：一球员一行、回应开浮层、已结束只读。
- `NegotiationsSection.test.tsx`：分组、已结束折叠、`DemandSection` 仍在。
- `DeskPlayerRow.test.tsx`：chevron 是真按钮，键盘可展开；主按钮 Enter 不触发行展开。
- `PlayerTransferPanel.test.tsx` / `PlayerTransferDialog.test.tsx`：`mode='player'`；已结束分态（已售出/未中标/已签下/留队）；dialog 内「去回应」先关闭自己，只留一层浮层。
- `SideOps.test.tsx` / `Player.test.tsx`：三态状态条、浮层开关、内联表单仍在、已结束无动作按钮。
- `TopBar.test.tsx`：登录教练显示入口；`total=0` 无数字；红点条件；观众不请求；`useDeskSummary` 的 `refetchInterval=60_000`（fake timers）。
- `tests/mobile-baseline.test.ts`：`MarketNav` 新顺序、顶栏结构、`.seg` 横滑仍在。
- e2e/smoke：320/360/901/1024 顶栏不横滑；760 行变卡片；浮层在 320 可用。

### 9.3 验收清单

1. 同球员 3 笔出价 = 1 行；展开见 3 条历史。
2. 同球员 2 条报价（同 box）= 1 行；in/out 分开。
3. 三页签计数正确；导航数字 = A 口径；0 不显示；>99 显示 `99+`。
4. 宽屏右上角入口；≤900 不渲染文字入口；≤640 顶栏红点不占宽；901/1024 nav 仍可横滑；`MarketNav` 第 2 位 + 数字；`/market` 落地仍在售市场。
5. 球员页本队/外队/已结束三态；已结束按 transfer 分态（已售出/未中标/已签下/留队）；浮层打开/关闭；dialog 内「去回应」不叠层；内联出价表单仍可用；深链展开；登录教练 eager 拉 panel、匿名不拉。
6. ≤760 行变卡片，点开抽屉；无横向滚动。
7. `?offer=`、`?demand=`、`?tab=negotiations`、`?tab=mine` 不回归。
8. typecheck ×3 / vitest 全量 / build 全绿；生产入口 sha256 与本地一致。

## 10. 上线与回退

- 三期各一次 push；每期独立可回滚。push 只在 owner 明确下令那一轮执行。
- 期 A/B/C 均无迁移；新端点只读，旧页面不依赖，回退前端即可。
- `useDeskSummary` 失败时角标/红点隐藏，不阻塞页面；`useTransferPanel` 失败时行展开显示错误 + 重试，不影响列表本身。
- 上线后回读：`/api/health` 200；入口文件 sha256 与本地构建一致；包内版本串；`/` 的 `Cache-Control: no-store`。

## 11. 风险与取舍

| 风险 | 处理 |
|---|---|
| `MarketNav` 顺序变更影响全站市场页 + 移动端基线测试 | 同期改 `tests/mobile-baseline.test.ts`；320/360 e2e 复核 |
| 顶栏 360px 只剩约 10px 余量 | 小入口 >900；红点绝对定位零宽；不加文字/数字 |
| 聚合把不同挂牌的历史混在一起 | 行内标「当前」与「历史挂牌 #id」；金额只取当前单最新一笔 |
| panel 端点请求量 | 球员页登录教练 eager 一次（Q1 A）；转会台行只在展开时请求；不预取所有行；`staleTime 30s` |
| 角标与列表计数短暂不一致 | 纯 COUNT + 60s stale；文档写明；需要严格一致再切 `settleOverdue` |
| 深链目标不在当前页签 | 提示条 + 另外两个页签链接，不静默 |
| 旧深链 `?offer=` / `?demand=` | 保留现有分支；回归测试 |
| 新端点路由顺序 | 新 `desk.ts` 与 `marketRoutes` 同层挂 `/api`，路径不与现有冲突；`/players/:id/transfer-panel` 用内部 id，不接 FC id |
| 页签计数与角标口径不同被误读 | 桌内待办条把「待办」和「进行中」分两数展示；页签注释写明 |
| `MarketNav` 位置 | Q9 已拍板第 2 位；`/market` 落地仍在售市场；同步 `tests/mobile-baseline.test.ts` |
| `me/bids`/`negotiations` 补 settle 改变现有读路径 | 30s coalesce + `waitUntil`，不压响应、不写账；补 spy 测试；失败不影响列表 |
| 球员页 eager panel 增 2 趟 D1 | 仅登录教练 + 球员详情页；`staleTime 30s`；不做列表预取；浮层复用缓存 |
| `me/bids` 硬上限 100 | 出价页签显示「最多展示最近 100 笔」提示条；要全量另立游标需求 |
| 901–1024 顶栏加文字入口后挤压 nav | 901/1024 e2e；溢出就把断点提到 1100 或隐藏 `.role-badge` |
| `delisted` 不等于「未中标」 | 按 `transfer.toClubId`/`deadlineNote` 分「已售出/未中标/未成交留队」，不一律写未中标 |
| panel 用 `waitUntil` 结算可能落后一个结算窗 | 文档写明不承诺强一致；`staleTime 30s` + 写后失效；需要强一致再改 `await` |

## 12. 文件清单（预计）

**新增**

- `src/worker/routes/desk.ts`（期 B summary；期 C panel）
- `web/src/pages/market/PlayerTransferPanel.tsx`
- `web/src/pages/market/PlayerTransferDialog.tsx`
- `web/src/pages/market/desk/desk-rows.ts` + `desk-rows.test.ts`（期 A 分组/选当前单/`bidActionOf`/`offerActionOf`/`negoActionOf`；期 C 再加 `transferActionsOf`）
- `web/src/pages/market/desk/status.ts`（统一词表；`needsReleaseFee` 从 `NegotiationsSection` 移入或 re-export）
- `web/src/pages/market/desk/DeskPlayerRow.tsx`
- `web/src/pages/market/desk/DeskPlayerRow.test.tsx`
- `web/src/pages/market/PlayerTransferPanel.test.tsx`
- `web/src/pages/market/PlayerTransferDialog.test.tsx`

**修改**

- `web/src/pages/market/desk/MarketDeskPage.tsx`（待办条、深链、计数注释）
- `web/src/pages/market/desk/ListingsBidsSection.tsx`
- `web/src/pages/market/desk/OffersSection.tsx`
- `web/src/pages/market/desk/NegotiationsSection.tsx`（导出 `SessionCard`/`needsReleaseFee`，或把后者移到 `status.ts`；`SessionCard` 加 `hideHeader`）
- `web/src/pages/market/shared.tsx`（`MarketNav` 第 2 位 + 数字）
- `web/src/components/TopBar.tsx`（小入口 + 红点）
- `web/src/pages/player/SideOps.tsx`（状态条 + 浮层 + 深链；dialog 用 `mode='player'`）
- `web/src/lib/queries.ts`（`useDeskSummary` 期 B / `useTransferPanel` 期 C；`useMarketInvalidation`/`useOffersInvalidation` 加可选 `playerId`）
- `web/src/lib/api.ts`（`DeskSummary`、`TransferPanelResponse` 两个 DTO；`myBids` 带 `listingId`，`transfer` 带 `fee/toClubId`）
- `src/worker/routes/market.ts`（`/me/bids` 补 30s coalesce settle）
- `src/worker/routes/negotiations.ts`（`?mine=1` 补 30s coalesce settle）
- `web/src/styles.css`（`desk-*` / `transfer-dialog` / `nav-dot` / `seg-count` / `desk-shortcut`）
- `tests/mobile-baseline.test.ts`（`MarketNav` 顺序、顶栏结构）

**不动**

- 任何业务规则、资金/冻结/结算算法、数据库 schema、cron、审核流程（读路径只加现有 `settleOverdue` 调用，不改算法）。
