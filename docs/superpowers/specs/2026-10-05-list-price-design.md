# 设计 · v6.33.0 转会名单公开标价 + 最低价全系统私密 + 广告板圆形报价按钮

日期：2026-10-05 · 状态：已拍板（用户 brainstorming 六轮决策）· 实现：本仓库单仓，零跨仓

## 0. 结论速览

1. `players` 新增 `list_price REAL`（迁移 0065）：**公开标价**，进转会名单必填，区间 `[最低价, round2(违约金×1.5)]`（下限无底线时为 1）。
2. `min_offer_price` 转为**全系统私密**：只有设置方（本队教练）经 `GET /api/players/:id/offer-settings` 可见；任何公开端点、通知、审计都不再出现其数值。
3. 自动应答双线：**拒线 = 最低报价**（不变），**同意线 = 标价 ?? 最低报价**（名单内钉标价，名单外回落最低报价，保 v6.4.0 解耦语义）。低于标价且高于底线的出价 = **砍价**，必进人工谈判。
4. 广告板卡脚加**圆形「报价」按钮**，点击弹层直接 `POST /api/offers`（与球员页 C 态同端点、同三态反馈）。`accepted` 的用户措辞：**「对方已接受：球员已挂牌进入转会区，你暂时领先（视同你出了第一笔出价）」**——不是成交，报价方会被继续竞价。

## 1. 背景与泄漏面核查（改前实测）

`min_offer_price` 数值在改造前有**两个公开出口**（`GET /api/players/:id` 详情 players.ts:1094、`GET /api/market/transfer-board` market.ts:501——后者注释宣称「唯一公开出口」与前者矛盾），另有三个间接泄漏：

| # | 泄漏面 | 证据 | 处置 |
|---|---|---|---|
| 1 | 球员详情端点（公开 + cachedJson 两级缓存） | `minOfferPrice: p.min_offer_price` | 换发 `listPrice` |
| 2 | 广告板端点（匿名公开） | `minOfferPrice: r.min_offer_price` | 换发 `listPrice` |
| 3 | 自动拒通知 | 模板渲染 `（${data.min} m）` 把底线数值发给买方 | 文案去数值 |
| 4 | `GET /api/offers/:id` 谈判桌 | 核查**干净**（SQL 与响应均无 min） | 不改 |
| 5 | `setOfferSettings` 审计 | audit `after` 落 `minOfferPrice` 数值进 audits 表 | 改布尔 `offerFloorOn`，另存公开 listPrice |

详情端点走 `cachedJson`（L1 进程 + L2 边缘，键 = URL），不能按会话个体化响应 ⇒ 私密底线必须走独立端点（见 §3.4）。

## 2. 数据模型（迁移 0065_list_price.sql）

```sql
ALTER TABLE players ADD COLUMN list_price REAL;
UPDATE players SET list_price = min_offer_price
WHERE transfer_listed = 1 AND min_offer_price IS NOT NULL AND list_price IS NULL;
```

- 不变量（由写路径保证）：`list_price IS NOT NULL ⇒ transfer_listed = 1`。退名单 / 设非卖品都清 `list_price`（与 `transfer_listed_at` 清戳对称）；最低报价保留（私密线继续生效）。
- 回填：生产现名单仅 1 人（Bryan Mbeumo，min 18）→ 标价回填 18，广告板数字连续（同一个 18 从「最低报价」变「标价」）。
- 无索引：list_price 不筛不排。
- 发布顺序硬约束：先 apply 再 push（CF Workers Builds 无迁移步骤）。

## 3. 写路径

### 3.1 autoRespondKind 双线化（src/core/offer-rules.ts）

```ts
autoRespondKind(listPrice, minOfferPrice, offerAuto, amount) {
  if (minOfferPrice != null && amount < minOfferPrice) return 'auto_reject';   // 拒线不变
  const line = listPrice ?? minOfferPrice;                                     // 同意线
  if (line == null || offerAuto !== 1 || amount < line) return null;
  return 'auto_accept';
}
```

四象限：名单内双线（`<min` 拒 / `[min, ask)` 砍价人工 / `≥ask`+开关 自动接受）；名单外只有 min（回落原 v6.4.0 行为）；名单内没设 min（`<ask` 人工，`≥ask`+开关 接受）；都为空（null，走人工）。

### 3.2 setOfferSettings（src/worker/offers.ts）

- 入参加 `listPrice`；min 与 listPrice **共用同一 bounds**（任一有值才查违约金合同，无合同 400「定不了报价线」）。
- 校验：进名单必填标价（400「进转会名单必须给一个公开标价（其他队看得到；低于标价的报价视为砍价）」）；标价区间两界 400；`标价 < 最低报价` → 400「标价 X m 不能低于最低报价 Y m（低于线就成砍价了）」。
- 原校验「进名单必须给最低报价」**删除**（min 变可选）。
- 名单外传标价**静默忽略**（`effectiveList = transferListed && !notForSale ? listPrice : null`）。
- UPDATE 加 `list_price=?`（绑定序：transfer_listed, list_price, min_offer_price, offer_auto, not_for_sale, transfer_listed(戳复用), id, club_id）。
- audit `after = {transferListed, listPrice, offerFloorOn: min!==null, offerAuto, notForSale}`——**最低报价数值不落审计**。
- `effectiveAuto` 判定改为「存在任一线（标价或底线）才可开」。

### 3.3 placeOffer

SELECT 加 `p.list_price`；自动应答换双线调用；自动拒通知**不再携带 min 实参**。其余（冻结、意向单、挂牌事务）一字不动。

### 3.4 新端点 GET /api/players/:id/offer-settings

守卫链与 PUT 完全同构（requireCoach `club.squad.manage` + getBoundClub + assertTradable + 本队 404 + listed 409 + 非 normal 400），响应 `{transferListed, minOfferPrice, listPrice, offerAuto, notForSale}`。用途：设置面板私密预填与脏判（前端 SideOps）。

## 4. 读路径 / 公开面

| 端点 | 改动 |
|---|---|
| `GET /api/players/:id` | `minOfferPrice` → `listPrice`（PLAYER_DETAIL_COLUMNS 换列） |
| `GET /api/players` 列表 | 不变（布尔摘要；`transferPriced` 仍由 min 派生，无数值） |
| `GET /api/market/transfer-board` | SQL 与响应 `min_offer_price` → `list_price`；`transferPriced` 改 list_price 派生 |
| `GET /api/offers`（列表） | item.player 加 `listPrice`（砍价徽标数据源） |
| `GET /api/offers/:id`（谈判桌） | 同加 `listPrice`（本就干净，加公开标价给谈判双方参照） |
| 通知 | `offer_auto_rejected`：「低于对方底线，直接被拒，冻结已退回」（无数值）；`offer_auto_accepted`：「达到对方的线」 |

## 5. 前端

- **SideOps A 态**：预填源从详情换 `useOfferSettings`（filledFor ref 防「保存→invalidate→refetch」覆盖用户草稿；settings 没到禁存）；转会名单 seg 正下方**「标价（m）· 公开」必填输入**（listDraft 为真时显示，区间提示 `[min??1, offerCap]`）；最低报价 label 加「· 仅自己可见」；自动同意开关在「无可用线」时禁用（名单内看标价、名单外看底线）；dirty 与 payload 加 listPrice；保存后 invalidate `qk.offerSettings`。
- **SideOps C 态**：显示「对方标价 X m：低于标价视为砍价（…）；达标价且对方开了自动同意才直接成交，否则进人工谈判。」（底线不出）；三态反馈文案见 §0.4。
- **广告板**：Amounts 标签「最低报价」→「**标价**」（值换 listPrice）；BoardCard/FeaturedCard 卡脚加 `.adb-bid-btn`（28px 金底圆钮「报」，aria-label/title「给 X 报价」）；**AdBidModal**（复用 `.modal-mask`/`.modal-card`）：标价参照行 + 金额（初值=标价）+ 附言 → `POST /api/offers` → 弹层内三态反馈 / 错误透出（401「先登录」不做会话预判）；MiniCard（整卡链接）不加按钮、文字价换源。
- **OffersSection**：卖方视角活单 `amount < player.listPrice` → 「砍价」badge（橙）。
- 样式只加 `.adb-bid-btn` / `.modal-title` / `.bid-err`，不引新色（金底 #f5e8cf 复刻 v6.31.0 先例）。

## 6. 测试

- 后端：设置校验矩阵（必填/两界/标价≥底线/清列/audit 布尔）、autoRespondKind 四象限、GET offer-settings 守卫链、通知无数值、谈判桌与广告板 **0 处 minOfferPrice 哨兵**、详情端点反转断言。
- 前端：弹层（初值/提交/三态/未登录错误）、圆钮在场、Amounts 标签、砍价徽标三态、mobile-baseline 行数基线。
- e2e：⑤e 加圆钮数量与弹层探针（预填/取消）。
- 变异 7 条（最坏情况口径）：①同意线改回 min ②去必填校验 ③板端点重发 minOfferPrice ④通知模板回填数值 ⑤退名单不清 list_price ⑥去报价按钮 ⑦audit after 回填数值。

## 7. 发布

0065 先 apply 生产（回读：列在场/回填 1 行/台账 head）→ push 触发 CF 自动部署 → **bump `cache:epoch:public`**（详情旧形状 L2 缓存最长 24h）→ 回读（board/detail 新形状、`minOfferPrice` 0 处、按钮+弹层探针）。docs 收口只本地 commit 不 push。
