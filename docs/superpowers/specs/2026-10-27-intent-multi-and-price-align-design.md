# 设计 · 标价↔最低报价自动对齐 + 意向单多笔并存·开窗择一

版本：v1（2026-10-27，两轮模型交叉审查后定稿；裁决已全部落定）。
前置阅读：`src/worker/offers.ts`（报价/议价编排）、`src/db/migrations/0037_offers.sql` + `0063_offers_intent.sql`（表与 partial unique）、`web/src/pages/player/SideOps.tsx`（报价设置面板）、`web/src/pages/market/desk/OffersSection.tsx`（转会台报价区）。
数据快照（2026-10-26 生产只读探针）：在途 intent 9 条（9 球员）、pending 3 条、`list_price < min_offer_price` 违例 0 行、同买方 pending+intent 并存 0 行。

## 1. 事项一：标价低于最低报价 → 最低报价自动对齐 + 明确提示

### 1.1 触发条件（按旧值分流）

「正向对齐」与「反向 400」在请求体上是同一谓词（`effectiveList < effectiveMin`），必须用库中旧值区分用户意图：

- `setOfferSettings` 的球员 SELECT（现 `offers.ts:982-985`）补查库里旧 `list_price`/`min_offer_price`。
- `effectiveList < effectiveMin` 时：
  - 新标价**低于**旧标价（用户在降标价；**旧标价为 NULL 即首次设标价，同样视为此支**——从无到有没有「反向」语义）→ **对齐**：`effectiveMin = effectiveList`（无论请求是否显式传了更高的 min——标价是主导方），响应体新增 `minOfferPriceAdjusted: { from: number | null, to: number }`（`from` 取**库中旧 min**，无旧值给 null，不取请求值）；
  - 标价未动或上升（是最低报价越的界，旧标价非 NULL）→ **400 拒绝**。

### 1.2 校验顺序与审计

- 对齐放在**所有区间校验之后**：min 区间 → 标价区间 → 旧值分流（对齐或 400）。不得提前，否则显式超上限的最低报价（如 80 > ⌊1.5RC⌋=75）会被静默替换成标价存进去（本应 400）。
- 对齐后新最低报价 ≥ 标价下限（五折线）≥ min 自身下限，边界恒成立，无需再校验。
- 审计 `offer_settings.after` **仅对齐发生时**追加 `minAlignedTo: <number>`；无条件加键会打破 `tests/offers.test.ts:656-658` 的严格 `toEqual`（同段 :659 是 v6.33.0 私密值哨兵 `not.toContain`，重写断言时不得改弱——行号以 describe 名定位为准，两设计落地会互相漂移）。
- 自动应答（`autoRespondKind`）不改：对齐后拒线 = 同意线，无窄带；存量 pending 报价不回溯（自动应答只在 placeOffer 时算）。
- 不加数据库列、零迁移。

### 1.3 前端

- `SideOps.tsx saveSettings()`（≈:253-264）现丢弃响应体、硬编码「报价设置已保存。」——改为消费响应：`minOfferPriceAdjusted` 非 null 时 toast「最低报价已随标价降至 X m（最低报价不能高于标价）」。
- `minDraft`/`listPriceDraft` 用响应值回灌，空值沿用文件现成写法（:157-158 的 `=== null ? '' : String(v)`）；直接 `String(null)` 会产出 `"null"` 字符串 → 脏判恒真 → 下次保存发 NaN 必 400。
- `OfferSettingsDto`（api.ts）加 `minOfferPriceAdjusted?: { from: number; to: number } | null`。PUT 后 invalidate `qk.offerSettings` 已存在（SideOps.tsx:239）。

## 2. 事项二：意向单多笔并存 + 开窗卖方择一 + 落选通知

### 2.1 唯一性闸门

| 闸 | 现状 | 改为 |
|---|---|---|
| `enterIntent` NOT EXISTS（offers.ts:544） | 球员级 | **买方级**（`AND x.buyer_club_id = offers.buyer_club_id`） |
| `placeOffer` dup 预检（:166-170） | `status='pending'` | `status IN ('pending','intent')` |
| `acceptOffer` 关窗预检（:640-648） | 球员级 | 买方级 |
| `idx_offers_active_pair`（0063） | (player, buyer) WHERE pending | 不动（intent 唯一走 NOT EXISTS 原子闸，零迁移） |

- **幽灵单回滚**：dup 预检是读不是闸。同买方并发自动同意时：P1 已转 intent 后 P2 的插入不撞 partial unique（只挂 pending），P2 的 `enterIntent` 买方级闸挡回后 placeOffer 抛 409——但 P2 的 pending 行 + 冻结已提交。修复：placeOffer 的 auto_accept 路径 `enterIntent` 返回 false 时，先把本次插入的单连同冻结终态化（`finalizeOffer` rejected + 释放），再抛 409。

### 2.2 确认（择一）流程

`acceptOffer` intent 分支的 occupy（:603-607）守卫叠加两个 NOT EXISTS：

```
AND NOT EXISTS (SELECT 1 FROM offers x WHERE x.player_id = offers.player_id
                AND x.status = 'accepted' AND x.listing_id IS NULL)   -- 双确认
AND NOT EXISTS (SELECT 1 FROM players p WHERE p.id = offers.player_id
                AND p.not_for_sale = 1)                                -- 非卖品赛跑
```

- 双确认：第二笔直接 409，不走「accepted 悬挂 → 自愈 → 过期」的闪变路径。
- 非卖品赛跑：fulfill 的挂牌守卫只查 `players.status='normal'` 不查 `not_for_sale`（setOfferSettings 只改标记不改 status），不加守卫会照样挂牌、卖家被挂牌态锁死、「非卖品压一切」被破坏。
- pending 分支的 `acceptOfferCore` occupy（:375）同加非卖品守卫（同类赛跑开窗期存在）。
- **顺手补毫秒窗**（第三轮终验）：occupy 与 fulfill 批之间的同请求窗内翻非卖品仍会过 fulfill 的挂牌守卫（INSERT 的 EXISTS 只查 club/status='normal'）——fulfill 批首 INSERT 的 EXISTS 追加 `AND not_for_sale = 0`，失败即走既有「球员状态刚被改过」409/自愈路径，成本一行。

**收口批**（在 `fulfillAcceptedOffer` 批内，注意批语义约束：语句无条件执行、`last_insert_rowid` 在 `INSERT INTO bids`（:446-450）之后不再指向挂牌行，故 freshListing 式守卫在该位置恒假）：

1. 新增一条 UPDATE，插在「兄弟 pending→expired」（:452-457）之后、既有 blanket 释放（:459-463）**之前**：

```sql
UPDATE offers SET status='expired', resolved_at=…, updated_at=…
WHERE player_id=? AND status='intent' AND id != ?
  AND EXISTS (SELECT 1 FROM listings WHERE player_id=? AND status='listed')
```

守卫用「该球员的 listed 挂牌真实存在」：批开始时球员必无 listed 挂牌（intent 确认前置 `player_status='normal'`，expireStaleOffers 保证），批内 INSERT 是唯一来源 ⇒ 挂牌失败时守卫恒假、不误伤他人 intent。不带窗过滤（跨窗存活的老意向单一并收，Q2d 裁决）。

2. 释放冻结与 expire 事件**复用既有 blanket 两条**（:459-463 按 `ref_id IN (该球员 status='expired')` 释放、:471-475 给全部 expired 单插事件）：收口 UPDATE 排在它们之前，新收单自动被覆盖（intent 单的 hold 仍是 `ref_type='offer'`，转正只发生在被确认那一单）——零新增释放/事件语句、零重复、零漏放。落选事件无 note（blanket 形态），谈判桌显示普通过期行，登记可接受。

3. 落选通知放 `fulfillAcceptedOffer` **成功判定之后**（与 `rollbackRcChangeForPlayer` 同位置，offers.ts:486-490）：查同球员落选 intent 买方、逐个发 `offer_intent_lost`。一个位置覆盖三条调用路径（intent 确认 / 开窗期同意 pending / 自愈补履约），调用方无需各自补发。排除胜者买方。

### 2.3 通知与深链

- 新模板 `offer_intent_lost`，`src/core/notify-meta.ts` 注册（label/category + notificationRefOf 映射 `offer:<自己单 id>`）、`src/worker/notify.ts` 模板行插在 `offer_intent_closed`（:75-76）之后、`web/src/lib/notify-links.ts` **显式映射** `/market/desk?tab=offers&box=out&offer=<自己单 id>`：
  - 不得进 `NEGO_TEMPLATES`（归类后深链被改写为 `/market/desk?tab=nego`，签约谈判页不显示意向单）；
  - 不得依赖默认（`offerBoxOf` 默认 box=in，落选方是买方、单在 box=out）。
- 文案：「{player} 已与其他球队达成意向并挂牌，你的意向单自动失效，仍可去转会区出价竞争（冻结已解冻）」。
- 站内信与通知中心均消费同一注册表，无额外工作。

### 2.4 `finalizeOffer` 终态守卫（现状资金洞，随本增量修）

`finalizeOffer`（offers.ts:691-710）批内只有第一条 UPDATE 有状态守卫；冻结释放（:695）、事件（:697-699）、审计（:701-708）无条件执行。撤回/拒绝与确认赛跑输掉时（第一条 changes=0），冻结仍被释放——若赢家已把该 hold 转成 `ref_type='listing'`（bids 指向它），成交扣款将无冻结可扣（ledgerMovement 无余额守卫，余额可打负）。

修复：批内后三条语句各挂 `AND (SELECT status FROM offers WHERE id = ?) = ?`（目标终态），changes=0 时四条全空转。这是现状代码就存在的洞，与本设计「买方随时撤回」的交互面直接相关。

### 2.5 提醒与文案

- `window-machine.ts:243-254` 开窗提醒按 (seller, player) 聚合：卖方一条带条数「N 家求购 {player}，开窗了，去转会台择一确认挂牌」；买方各自一条「转会窗口已开，{player} 存在 {N} 家意向竞争，等待卖方选择（可随时撤回解冻）」。存量 9 条/9 球员 ⇒ 聚合后行为与现状一致。聚合改写时**翻页取全**（LIMIT 200 循环 OFFSET 直到取空——第三轮终验：现状单轮 LIMIT 200 在 >200 条时静默丢提醒，聚合重写顺手补上）。
- `market.ts:252-253` 挂牌硬锁保留（有任一 intent 即锁），文案去「一条」。
- `OffersSection` 卖方列表：多条 intent 各占一行可各自确认（天然支持）；同球员多条时列表 hint「确认一条后其余自动失效」。`routes/offers.ts:97` intentsMine 计数自动变大（正确）。
- `src/core/offer-rules.ts` 的 `OfferStatus` 类型补 `'intent'`（字符串裸用已久，加分支前先补）。

### 2.6 资金冻结影响评估

- 放开前 1 家 / 放开后 N 家各冻**自己的**报价额，互不影响他人可用余额（placeOffer 只预检自己），不存在总池锁死。
- 占用时长 = 关窗期 + 开窗后卖方拖延期；买方有完全主动权：随时撤回即时解冻（撤回自身即走 finalizeOffer，2.4 修复后不再有资金风险）、非卖品化/球员状态变/对方直接挂牌自动解冻。
- 卖方拖延的极端场景（多家冻到下窗）接受，登记观察项（Q2b：第一期不做确认时限）。

## 3. 不做的事（YAGNI / 已裁决）

- 意向单数量上限（Q2a：不设，20 队天然 ≤19 家）。
- 开窗后确认时限（Q2b：第一期不做；观察拖延泛滥再议「开窗后 N 天未确认自动过期」）。
- 按比例冻结：否——报价即全额冻结是全系统不变式（挂牌出价同口径），破坏「达线即成」确定性。
- 存量数据订正：违例 0 行，无脚本；9 条在途 intent 天然满足买方级唯一。
- 「卖方一键全拒意向单」新端点：rejectOffer 逐条已有。
- 数据库迁移：零。

## 4. 测试面（qa-test-planner 出计划，此处为锁清单）

- 重写：`tests/offer-intents.test.ts:201-231`（球员级→买方级）、`tests/window-machine.test.ts` 开窗提醒断言（聚合+条数）、`tests/offers.test.ts:583` describe（list<min 分流）。
- 新增：降标价触发对齐 / 抬底线 400 两方向 / 首次设标价（旧 NULL）走对齐支；对齐落库值+响应字段；审计仅对齐时加键（:656-658 保持绿、:659 哨兵不弱化）；minDraft 回灌空值；多买方各落 intent；同买方第二条 409；**幽灵单回滚——单线程 vitest 不可达真并发（顺序复现必被 dup 预检 409 挡住，到不了 enterIntent false 分支）：把「回滚终态化」抽成独立函数（如 `rollbackGhostOffer`）直测（夹具插一条 pending+held hold，调回滚，断言单终态 rejected+冻结 released+事件/审计落账），触发条件写注释说明属真并发窗**；确认 A→B expired+释放+lost 通知（深链 box=out&offer=自己单）；开窗期同意 pending 也收 intent 兄弟；双确认第二笔 409；非卖品化与确认赛跑被 occupy 守卫拦；**fulfill INSERT 的 not_for_sale 守卫**；挂牌失败不误伤 intent；跨窗老 intent 被收；finalizeOffer 终态守卫（变异：删守卫，撤回竞速输掉时不得释放赢家已转 listing 的冻结）。
- 最坏情况口径：并发双确认、LIMIT 200 扫描下多 intent 球员、blanket 释放覆盖新收单（变异：删收口 UPDATE 必红）、notificationLink 对 lost 模板落点。

## 5. 裁决记录（2026-10-27）

| # | 问题 | 裁决 |
|---|---|---|
| Q1a | 反向（最低价越界高于标价） | 不允许出现，400 拒绝（落地形态见 §1.1 旧值分流） |
| Q1b | 对齐痕迹持久化 | 不加列；toast + 回显 + 审计留痕 |
| Q2a | 意向单数量上限 | 不设 |
| Q2b | 开窗后确认时限 | 第一期不做，登记观察 |
| Q2c | 落选通知 | 新模板 offer_intent_lost，深链显式映射 |
| Q2d | 跨窗老意向单 | 随本窗确认一并失效，文案中性 |

## 6. 审查记录

- 第一轮：opencode CLI（DeepSeek 官方 API · deepseek-chat），2026-10-26——收口批挂真挂牌之下、hold 定点释放、落选通知深链陷阱三要点已吸收。
- 第二轮：ZCode workflow（opencode-go-chat-2/deepseek-v4.1-flash $high），2026-10-27——10 条意见 7 条复核成立，全部消化：§1.1 旧值分流、§1.2 顺序与审计写法、§1.3 回灌写法、§2.1 幽灵单回滚、§2.2 occupy 双守卫与收口批重写、§2.3 深链显式映射、§2.4 finalizeOffer 资金洞。报告卡片见 workflow 运行记录。
- 第三轮（GLM-5.3 终验，2026-10-28）：20 条意见 18 条成立（本设计占 6，其中 mustFix 2）。消化：§1.1 首挂（旧 NULL）归对齐支 + `from` 取库值定义 + 显式传更高 min 也对齐（标价主导）；§2.1 fulfill INSERT 补 not_for_sale（毫秒窗）；§2.3 补 notify.ts 模板行位置；开窗聚合翻页取全（LIMIT 200 静默丢提醒）；§4 幽灵单回滚可测性（抽函数直测）。误报澄清：「漏 notify-meta 注册步」系审查员只持精简摘要所致（spec 原文本有）；「finishOffer 错名」系摘要笔误。行号订正 :660→:659。**实施顺序：本设计（A）先行，预期收入（B）随后，严格串行**（跨设计终验结论：A 零迁移可独立收口，B 的 0081 触发器重建放在 A 之后的最终 offers 语义上一次写对）。
