# 管理后台审核工作台设计（2026-11-02）

> 需求来源：owner 反馈「管理面板审核根本不好用，要输好多 ID，有些 AI 比如挂牌 ID 我都无法在 UI 层面获取到」。
> 裁决（grilling 2026-11-02）：ID 对**全站露出**；干预面板改为**在途列表 + 搜索兜底**；审核队列**支持批选**；本轮**只出方案文档，不动代码**。

## 1. 问题

### 1.1 八个要手输实体 ID 的输入框

| 文件:行 | 输入框 | 目标实体 | 后端无替代入口 |
|---|---|---|---|
| `web/src/pages/admin/MarketPage.tsx:311` | ID（出价/挂牌/谈判混用） | 3 类实体 | ✅ 无 |
| `web/src/pages/admin/MarketPage.tsx:524` | 球员 ID（平台或 FC） | 球员 | ✅ 无 |
| `web/src/pages/admin/PlayersPage.tsx:588` | 球员 ID | 球员内部 id | ✅ 无 |
| `web/src/pages/admin/AdminShopPage.tsx:273` | 俱乐部 id | 俱乐部 | ✅ 无 |
| `web/src/pages/admin/AdminShopPage.tsx:282` | 球员 id / FC id | 球员 | ✅ 无 |
| `web/src/pages/admin/ClubsPage.tsx:219` | 游戏球队 ID | 新俱乐部 id | ✅ 无（外部系统值，合理） |
| `web/src/pages/admin/EventsPage.tsx:126` | 俱乐部 id（可多选） | 俱乐部 | ✅ 无 |
| `web/src/pages/admin/TierPage.tsx:154` | 只重算某队 | 俱乐部 | ✅ 无 |

### 1.2 三个「UI 上读不到」的 ID

- **出价 id**：全站只当 React key 用（`web/src/pages/market/desk/ListingsBidsSection.tsx:82`），出价历史浮层也不渲染。
- **挂牌 id**：仅三处临时露出——谈判桌「已挂牌 #」（`web/src/pages/market/desk/OffersSection.tsx:579`）、挂牌成功 toast（`web/src/pages/player/SideOps.tsx:792`）、强拍暂停 toast（`web/src/pages/admin/MarketPage.tsx:499`）。在售板卡片、挂牌浮层、激活页、球员页、转会台均无。
- **谈判会话 id**：只用于 DOM `id`/`aria`（`web/src/pages/market/desk/NegotiationsSection.tsx:422`、`:438`、`:530`、`:692`），界面不显示。

### 1.3 审核队列不可引用

`GET /api/admin/reviews` 已经返回 `transfer.id`（`src/worker/routes/admin/reviews.ts:227`），但前端不渲染；行里没有单据号、没有挂牌号，球员名是纯文本（`web/src/pages/admin/MarketPage.tsx:223`）。激活举报行只有「处理完毕」（`:200-209`），无直链。

### 1.4 一个 ID 框承载三类实体

市场干预区 5 个动作共用同一个正整数校验（`web/src/pages/admin/MarketPage.tsx:310-324`），填错类型只能等后端 404/409。

## 2. 目标 / 非目标

**目标**

1. 任何实体在 UI 上出现的地方，都能读到它的 ID 并一键复制。
2. 审核队列自解释：单据号、球员链接、直链跳处置点，并支持批选。
3. 管理动作不再依赖「先记住 ID」——在途单据直接列表化，搜索只作兜底。

**非目标**

- 不改任何业务规则、结算口径、资金流向。
- 不做「游戏球队 ID 候选列表」（外部系统数据，平台内无法枚举）。
- 不重做审核队列的视觉风格，只补信息与交互。
- 不做移动端专项适配（沿用现有响应式断点）。

## 3. 总览

三期，互相独立可分别上线（**分三次 push**，见 §10）：

| 期 | 内容 | 迁移 | 新接口 |
|---|---|---|---|
| A | 全站 ID 露出（组件 + 落点表） | 无 | 1 个 DTO 字段 |
| B | 审核队列可引用 + 批选 + 在售板支持 `?listing=` | 无 | 1 个批量端点 |
| C | 独立工作台 `/admin/workbench`（在途列表 + 强拍活动 + 凭证 + 搜索） | `0089` 加 `idx_bids_status` | 1 个在途端点（搜索复用同端点前缀，见 §6.3） |

## 4. 期 A：全站 ID 露出

### 4.1 组件

新增 `web/src/lib/clipboard.ts`（全站目前没有封装，只有 `ClubsPage.tsx:494`、`CpuConvertPage.tsx:389` 两处裸 `navigator.clipboard`，均无 try/catch）：

```ts
/** 复制文本；优先 navigator.clipboard，不可用/被拒时退回临时 textarea + execCommand。 */
export async function copyText(text: string): Promise<boolean>
```

新增 `web/src/components/IdTag.tsx`：

```tsx
export function IdTag({ kind, value, className }: { kind: '挂牌' | '出价' | '谈判' | '转会' | '球员' | '俱乐部'; value: number | string; className?: string }) {
  // 渲染成 <button class="id-tag" title="点击复制">#123</button>
  // 点击：copyText(String(value)) 成功 → toast「已复制 挂牌 #123」
}
```

- 视觉（Q5 裁决）：**灰色 `#123` 文本按钮**，无背景色、等宽小号，点击即复制并 toast；`title` 提示「点击复制」。
- 复制失败降级：`copyText` 返回 false ⇒ 选中该文本 + toast「复制失败，请手动复制（已选中）」。
- 统一 `kind` 词表，避免各处自造文案。
- 组件自带 `useToast` 实例并渲染 `toastNode`（沿用仓库既有「每个页面自持 toast」的约定）。

### 4.2 落点（只列当前有渲染的位置）

| 位置 | 加什么 |
|---|---|
| `web/src/pages/market/MarketBoardPage.tsx` 卡片 | 挂牌 `#id`（拍卖/激活/普通都加） |
| `web/src/pages/market/MarketListingOverlay.tsx` 头部 | 挂牌 `#id`、卖方俱乐部 `#id` |
| `web/src/pages/market/desk/ListingsBidsSection.tsx` 我的出价行 | 出价 `#id`、挂牌 `#id` |
| `web/src/pages/market/desk/NegotiationsSection.tsx` 会话卡头 | 谈判 `#id`、转会 `#id` |
| `web/src/pages/market/desk/OffersSection.tsx` 报价卡 | 挂牌 `#id`（已有）、转会 `#id` |
| `web/src/pages/player/SideOps.tsx` 侧栏挂牌区块 | 挂牌 `#id` |
| `web/src/pages/admin/MarketPage.tsx` 强拍活动表 | 挂牌 `#id`（行内已有暂停/取消按钮） |
| `web/src/pages/admin/PlayersPage.tsx` 待升级表 | 球员内部 `#id` |
| `web/src/pages/admin/ClubsPage.tsx` 俱乐部表 | 已有 `名称 #id`，改为 `IdTag` |
| `web/src/pages/admin/AdminShopPage.tsx` 工单行 | 已有 `#{o.id}`，改为 `IdTag`；行内补俱乐部 `#id` |

### 4.3 服务端唯一改动

`GET /api/admin/reviews` 的 `report` 对象补 `listingId`（`src/worker/routes/admin/reviews.ts:227` 的 `l.id` 与 `rt.ref_id` 同值，直接透出 `rt.ref_id`，`report.listingId`），供期 B 的直链使用。

## 5. 期 B：审核队列

### 5.1 行内信息

- 标题行：球员名（改为链接 → `/players/<fc_id>`）+ `IdTag 球员` + `IdTag 转会`（或 `IdTag 挂牌`）。
- 激活举报行：补 `IdTag 挂牌`、「激活方」已是俱乐部名，改为链接 + `IdTag 俱乐部`。
- 金额行不变。

### 5.2 直链「去处置」

每条待审行右侧加一个「去处置」按钮：

- `transfer_confirm` → 跳 `/admin/market?entity=transfer&id=<id>`。**B 期落地为「定位 + 高亮队列行」**（2.6s 褪色），不写进干预框：干预框的五个动作只认挂牌/出价/谈判 id，把 transfer id 塞进去等于让它被当成另一类实体解释，点错动作的风险大于便利。C 期由 `/admin/workbench?entity=transfer&id=<id>` 接管同一组参数并在在途表里展开该行。
- `activation_report` → 跳 `/market?listing=<id>`。**这是新增行为**：`MarketBoardPage` 目前不读任何查询参数（`useState` 开浮层），B 期给它加一次性读取——命中且在售（`listed`/`bidding`/`matched_pending`）就自动打开浮层，参数无效或被消费后从 URL 移除（`replace`），不污染历史。
- `?entity=listing|bid|session&id=<id>`（工作台搜索/外链兜底）→ 预填干预框并滚到干预区——这三类才是干预框认的 id。

期 B 落地「带参跳转 + 高亮」，期 C 再把工作台接上。

### 5.3 键盘操作

`j` / `k` 上下移动当前行高亮，`a` 批准当前行、`r` 驳回（均弹出原因框，默认值沿用上次填写），`Esc` 取消。仅在队列区获得焦点时生效，避免与输入框冲突。

### 5.4 批选

- 每行加勾选；表头全选（仅当页 100 条）。
- 底部操作条：「批量批准（N）」「批量驳回（N）」，均要求填一次原因。
- 拒绝混类型批选：只允许勾选同一 `kind`（`transfer_confirm`），勾到 `activation_report` 时提示「激活举报需逐条处理」。
- **批量不支持改价**（Q1 裁决）：当前单条 approve 也不带金额入参，批量沿用；调剂需要改价就逐条走现有流程。

### 5.5 新端点

```
POST /api/admin/reviews/batch
body: { action: 'approve' | 'reject', ids: number[], note?: string }
resp: { ok: true, results: Array<{ id: number; ok: boolean; error?: string }> }
```

- 上限 50 条；`ids` 去重；逐条调用现有核心（`approveTransferDeal` / 驳回核心，见 `src/worker/routes/admin/reviews.ts:311`），**不加外层事务**——单条失败只记录，不影响其它。
- 每条仍写各自的审计（与单条端点一致），额外写一条 `admin_review_batch` 汇总（`after: { action, ids, ok, failed }`）。
- 任一 id 不属于 `open` 状态 → 该条返回 `ok:false, error:'已处理'`，不抛整体 400。

## 6. 期 C：审核工作台（独立页 `/admin/workbench`）

### 6.1 布局

**独立路由** `/admin/workbench`（挂在 `AdminLayout` 侧栏，Q3 裁决）：审核队列仍留在 `/admin/market`，两者互不搬迁，工作台只管「在途单据 + 动作」。

```
[ 搜索：球员 / 俱乐部 / 单据 ID ]        ← 兜底，命中后跳到对应表并展开该行
────────────────────────────────
在途挂牌（listed / bidding / matched_pending）  N 条  [☐ 含 CPU]
活跃出价                                        N 条  [☐ 含 CPU]
进行中谈判                                      N 条  [☐ 含 CPU]
待审转会（pending_review / signing）             N 条  [☐ 含 CPU]
强拍活动（type='forced'，bidding / pending_review）
```

每表列：`编号 | 球员 | 双方 | 金额/阶段 | 截止 | 凭证 | 动作`

- 编号列一律用 `IdTag`（期 A 的组件），点一下就能复制——这是本页取代「手输 ID」的核心。
- **凭证列**（Q12 裁决）：`type='activation'` 且 `activation_proof` 非空的行显示「凭证」按钮，新窗口打开 `/api/media/<key>`。**不依赖举报任务是否存在**——数据源直接是 `listings.activation_proof`；同时 `/admin/market` 审核队列里原有的举报截图入口保留（两处都能看）。
- **强拍活动表**（Q6 裁决）：行内直接给「暂停/恢复出价」「取消强拍」「强制送审」「强制作废」，复用现有端点，取代现在 `/admin/market` 里那张只读活动表。
- CPU 过滤（Q2 裁决）：四个转会在途表默认**隐藏** `clubs.is_cpu=1` 的参与方，表头勾选后显示全部；强拍表不过滤（强拍本身就是运营动作）。
- 每行动作按实体类型只出现对应的那些（取代现在「5 个按钮 + 一个框」），全部弹原因框。

### 6.2 搜索

单一输入框，回车或停顿 300ms 触发：

- 纯数字：并行探测 `player.id`、`player.fc_id`、`club.id`、`listing.id`、`bid.id`、`negotiation_sessions.id`、`transfer.id`，命中什么返回什么（分类候选）。
- 非数字：`players.name/display_name LIKE`、`clubs.name LIKE`，各取前 10。
- 选中一条候选后：跳转或填入对应在途表并展开该行（无缝切到 6.1 的动作）。

### 6.3 新端点

**一个**在途端点（Q8 裁决：单端点全包，一次请求够工作台渲染；公开在售 feed 的查询抽成公共函数两处复用，避免两份 SQL 漂移）：

```
GET /api/admin/workbench/in-flight?cpu=0|1   // 默认 cpu=0：隐藏 CPU 参与方
resp: {
  listings: Array<{ id, playerId, playerName, sellerClubId, sellerClubName, type, status, askPrice, highestBid, bidCount, deadlineAt, hasProof }>,
  bids: Array<{ id, listingId, playerId, playerName, clubId, clubName, amount, status, createdAt }>,
  sessions: Array<{ id, playerId, playerName, clubId, clubName, transferId, releaseFee, expectedWage, round, attemptCount, expiresAt }>,
  transfers: Array<{ id, playerId, playerName, fromClubId, fromName, toClubId, toName, type, status, fee, createdAt }>,
  forced: Array<{ listingId, playerId, playerName, sellerClubId, sellerClubName, status, askPrice, highestBid, bidPaused, deadlineAt }>,
  counts: { listings, bids, sessions, transfers, forced }
}

GET /api/admin/workbench/search?q=<string>
resp: { results: Array<{ kind: 'player'|'club'|'listing'|'bid'|'negotiation'|'transfer', id, label, sublabel? }> }
```

- 各表 `LIMIT 50`、按截止/创建时间升序（最急的在前）。
- `listings` 只回 `hasProof` 布尔（凭证 key 不随列表下发，点「凭证」时再取 `/api/media/<key>`；如需直接给 URL，则另开 `GET /api/admin/workbench/proof/:listingId` 做权限判定后 302 到媒体地址）。
- 全部 `requireAdmin`；只读，无审计（读操作不写审计，与现有 `/reviews` 一致）。

## 7. 权限与审计

- 所有新端点 `requireAdmin`，与现有 admin 路由同源（`src/worker/routes/admin/index.ts` 挂载）。
- 写操作一律沿用「必须填原因 + 写审计」的现有约定；批量端点额外一条汇总审计。
- 不引入新权限位，不区分角色（当前后台只有 admin）。
- **激活凭证的可见范围（Q12 裁决）**：管理员（审核队列 + 工作台凭证列）与**该挂牌的卖方俱乐部**可见，其余人不可见。
  - 公开 feed `GET /api/market/listings` **不加** `activationProof` 字段（现状本来就没有，保持）。
  - 卖方侧走新端点 `GET /api/market/listings/:id/proof`：要求登录且 `viewer.clubId === seller_club_id`（admin 亦放行），返回 `{ url: '/api/media/<key>' }`；无凭证 404，非卖方 403。前端落点：`/market/desk` 的挂牌卡与 `/market` 浮层（`isSeller` 分支）各加一个「凭证」按钮。
  - 这样避免给公开端点加身份解析（它现在只有 IP 限速、无 `requireUser`），也不扩大 QQ 截图里个人信息的暴露面。

## 8. 数据与迁移

**一处迁移（期 C）**：`src/db/migrations/0089_bids_status_index.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids (status);
```

- 理由（Q9-B 裁决）：生产 `bids` 目前只有 **133 行**（superseded 87 / won 26 / active 19 / withdrawn 1），当下不加也能跑；但工作台的「活跃出价」按 `status='active'` 过滤会成为热点查询，且未来行数只增不减，顺手补上。
- 其余查询全部基于现有表：`listings`、`bids`、`negotiation_sessions`（列见 `src/worker/negotiations.ts` 的 `SESSION_COLS`）、`transfers`、`players`、`clubs`。
- 现有索引覆盖情况（核对过）：`listings` 有 `(status, listed_at DESC)` / `(status, last_bid_at)` / 唯一 `(player_id) WHERE status IN (...)`；`negotiation_sessions` 有 `(status, created_at)`；`transfers` 有 `(status, completed_at DESC, id DESC)`。⇒ 只有 `bids.status` 缺索引。

## 9. 测试策略

| 层 | 用例 |
|---|---|
| 后端 | `tests/admin-workbench.test.ts`：在途四类各返回正确行数与字段；搜索纯数字命中 6 类、非数字只搜名字；批量审批 3 条混合（成功 / 已处理 / 不存在）分别 `ok:true / error`；批量超过 50 条 400；非 admin 401 |
| 后端回归 | `tests/shop-orders.test.ts`、`tests/deal-revert.test.ts` 不受影响（不动这些路径） |
| 前端 | `IdTag` 组件测试（渲染、点击复制调用、复制失败降级）；审核队列测试（渲染单据号、勾选后按钮数量、混类型禁用、键盘 a/r 调用对应接口）；工作台测试（四表渲染、行动作按钮类型正确、搜索候选点击后展开） |
| 变异 | ①去掉 `requireAdmin` → 401 用例变红；②批选上限从 50 改 100 → 400 用例变红；③`IdTag` 不写剪贴板 → 组件测试变红 |

## 10. 分期与工作量（估）

| 期 | 内容 | 估 |
|---|---|---|
| A | `copyText` + `IdTag` + 10 处落点 + reviews DTO 补 `listingId` | 0.5 天 |
| B | 队列信息/直链/键盘/批选 + `POST /reviews/batch` + 在售板 `?listing=` | 1 天 |
| C | `0089` 索引 + `GET /workbench/in-flight` + `/workbench/search` + `/listings/:id/proof` + 独立页五表 UI | 1.5 天 |

- 每期独立提交、独立验收、**分三次 push**（Q4 裁决：A → B → C，各自验收上线，不攒在一起）。
- 依赖：期 B/C 都用期 A 的 `IdTag`；期 C 的「去处置」链接接管期 B 的 `?entity=&id=` 参数。

## 11. 风险与已知边界

1. **在途表可能很长**（赛程末段同时有几十条）：先 `LIMIT 50` + 按截止排序，不做分页；不够再加。
2. **搜索纯数字探测 6 张表**：6 条索引查询，单次成本可接受；加 300ms 防抖与最短 1 字符限制。
3. **批选误伤**：只允许同类型、上限 50、必须填原因、结果逐条回显；不做「一键全选所有页」。**逐条不跨单原子**——单条 approve 本身是两次 `db.batch`（`completeTransfer` 然后 `openNegotiationSession`，见 `src/worker/transfers.ts:883`、`src/worker/negotiations.ts:220`），批量外层也不加事务，因此「部分成功」是必然可发生的状态，UI 必须逐条回显而不是只报总数。
4. **ID 全站露出**：俱乐部教练会看到自己的出价/挂牌/会话号，无权限含义，纯引用用途；不暴露他人数据（这些号本来就随各自列表可见）。
5. **键盘快捷键**：只在队列区聚焦时生效，避免与页面其它输入框冲突。
6. **激活举报**仍只能「处理完毕」——它有独立的处理语义（记录核查结论），本轮不改行为，只补直链与编号。
7. **`/market?listing=` 是公开页新增行为**：只接受整数、只认在售三态，参数无效静默忽略并从 URL 清除；不引入「按 id 探测任意挂牌」的能力（浮层数据仍来自同一个 active feed）。
8. **凭证端点**：`GET /api/market/listings/:id/proof` 必须两端都判（登录 + 卖方/admin），否则等于把 QQ 截图公开；返回的是 `/api/media/<key>` 这个本来就可公开读的路径，所以权限只在「拿到 key」这一步。
9. **CPU 过滤是展示层过滤**：默认隐藏 CPU 参与方，可能让运营误以为「没有在途单」；表格标题显示「已隐藏 N 条 CPU 单」提示。

## 12. 判级

**minor**（纯管理端可用性与可引用性；一期小迁移只加索引、零资金影响、零业务规则变化）。三期合计新增约 2 个后端文件、1 个前端组件 + 若干页面改动。

## 13. 决策记录（grilling 2026-11-02）

| # | 问题 | 裁决 |
|---|---|---|
| Q1 | 批量审批是否支持改价 | **不支持**，沿用单条 approve 不带金额的现状 |
| Q2 | 在途表是否默认隐藏 CPU | **默认隐藏**，表头可切换 |
| Q3 | 工作台位置 | **独立页 `/admin/workbench`**，审核队列不搬 |
| Q4 | 上线方式 | **A→B→C 分三次 push**，各自验收 |
| Q5 | ID 形态 | 灰色 `#123` 文本按钮，点击复制 + toast |
| Q6 | 强拍活动表 | **并入工作台**，行内含暂停/恢复出价、取消强拍、强制送审、强制作废 |
| Q7 | 激活举报直链落点 | 给 `/market` 加 `?listing=` 支持（在售板读参自动开浮层） |
| Q8 | 在途挂牌数据源 | 单端点全包，公开 feed 的查询抽公共函数复用 |
| Q9 | `bids.status` 索引 | **加**，`0089_bids_status_index.sql` |
| Q10 | 批选失败语义 | 逐条继续、结果逐条回显，不回滚已成功的 |
| Q11 | B 期「去处置」过渡 | 带参 `/admin/market?entity=&id=`，B 期写进现有干预框，C 期接管 |
| Q12 | 激活凭证可见范围 | 管理员 + 卖方俱乐部；公开 feed 不加字段，走 `/listings/:id/proof` |

## 14. 已知假设（已核对，勿再按旧稿理解）

1. ~~在售板浮层已支持 `/market?listing=`~~ —— **不支持**，`MarketBoardPage` 无 `useSearchParams`，浮层由 `useState` 打开；`?listing=` 是本设计**新增**的行为（Q7）。
2. 全站没有剪贴板封装，只有 `ClubsPage.tsx:494`、`CpuConvertPage.tsx:389` 两处裸调用且无 try/catch ⇒ 本设计新增 `web/src/lib/clipboard.ts` 并顺手让这两处改用它（低风险重构，不改变行为）。
3. `GET /api/market/listings?status=active` 是公开无鉴权端点，返回体**没有** `activationProof`；已有字段含 `id / player{id,fcId,name,...} / sellerClub{id,name} / type / status / askPrice / highestBid / highestBidder / bidCount / deadlineAt / matchPhase`。
4. 激活截图的唯一现有入口是 `/admin/market` 审核队列的举报行（`MarketPage.tsx:181-186`），且 `proofKey` 来自 `review_tasks` payload ⇒ **举报处理掉之后就看不到了**（Q12 正是补这个缺口）。
5. 现有全局 keydown 只处理 Escape/Tab，无 j/k/a/r 冲突。
