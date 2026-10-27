# 设计 · 预期收入额度：窗口内预支未到账的卖人收入

版本：v3（2026-10-28，探索 77 条核验事实 + 四项裁决 + ds 交叉审查 15 条 + GLM-5.3 第三轮终验全部消化）。
**实施顺序（跨设计终验结论）**：本设计（B）在「标价对齐与意向单择一」（A，见 2026-10-27-intent-multi-and-price-align-design.md）**之后**实施，严格串行——A 零迁移可独立收口上线；B 的 0081 触发器重建放在 A 之后的最终 offers 语义上一次写对（多 intent 夹具、收口批），避免两阶段维护；B 在 offers.ts 只有零逻辑的三处文案（§2.2 第 5 项），A 先落地后 B 做增量。
前置阅读：`src/worker/ledger.ts`（余额原语）、`src/db/migrations/0005_market_bid_guard.sql` / `0063_offers_intent.sql` / `0070_sea_sealed.sql`（三个资金触发器）、`src/worker/transfers.ts:281-320`（过户入账）、`src/worker/market-settle.ts`（竞价结算）、探索材料卡「资金域探索材料」、审查报告卡「预期收入设计审查报告」。

## 0. 裁决记录（2026-10-27 用户拍板）

| # | 问题 | 裁决 |
|---|---|---|
| Q1 | 额度来源 | A1：竞价领先出价 + 待审/谈判中成交（transfers `pending_review`/`signing`，金额已定格，**限成交类单据**）；matched_pending 与 activation 类挂牌全程排除 |
| Q2 | 落空处置 | a 自然收缩：额度是实时公式不预入账，落空即缩水，负可用余额挡冻结型支出，「负=欠款」沿用系统现状哲学 |
| Q3 | 折扣率 | 1.0——全额税后净额（用户判断：谈判作废也不至于转会失败，尾部风险接受） |
| Q4 | 作用面 | **转会类全部消费点**：三个冻结闸 + 解约费/海捞明标/匹配差额/续约费等预检型即时扣款（含 chargeBypassFee 批内守卫，见 §2.3）。球场扩建与商场工单**明确排除**（保持现金口径，不吃额度——预期收入是转会周转工具，不是运营消费工具） |
| Q5 | 展示 | 增强档：余额端点新字段 + Ledger/转会台余额行 + 每笔支出确认弹层实时显示「本次动用预期收入 Z m」 |
| — | 多买方并发 | 每球员只取最高一份在途收入（求和会重复计同一份未来收入） |

## 1. 额度公式（核心不变式）

```
expectedIncome(club) = Σ_每球员 在途净额（去重取最高一份）
  在途净额 = 该球员唯一在途源 × (1 − taxRate(源, 金额, 现行RC))
    源① listings：status IN ('listed','bidding') 且 type NOT IN ('activation')
         且存在 active 出价 → 取最高 active 出价额
    源② transfers：status IN ('pending_review','signing')
         且 from_club_id = club
         且 type IN ('transfer','activation','forced_auction')   ← 只认成交类
         → fee（结算时刻已定格）
  taxRate 分支（与过户实算同源，src/worker/transfers.ts:222-224）：
    源① listings.type='forced' 或 源② transfers.type='forced_auction'
      → auction_tax_rate（config，默认 0.5）整单税率
    其余 → 分段累进（tax_rates，默认 0.10/0.20/0.40）按现行 active 合同 RC
creditLine = expectedIncome × k（k = config 键 expected_income_rate，默认 1.0）
available' = balance − Σ(held 冻结) + creditLine
```

- **源② 的 type 过滤是安全前提**（审查 F1/F7/F12）：`rc_change`（续约）、`match`（匹配）、`free_agent`（海捞）、`termination`（解约）四类单 from_club_id 也会等于本队、status 同样经过 pending_review/signing、fee 写的是「新违约金」，但 ownership=false 永不产生卖方收入——不筛类型即凭空造额度（rc_change 交 30% 新老差额就能挂出约 1.5×RC 的假额度，且会盖掉同球员真实卖单的取高）。成交类 transfer 只由 `settleListingForReview`（market-settle.ts:76-84）产出，type 只能是上列三种。
- 源①与源②对同一球员互斥（截止结算同批把 listing 推进、建 transfer；匹配留队同批 delisted+建 match 单——match 单已被 type 过滤排除，天然不破坏互斥）。
- `listed` 无 active 出价的挂拍计零（流拍是负收益——下架费 10% 标价，不是预期收入）。
- 金额改价（审核 `body.fee`）只动 transfers.fee——源②读 transfers.fee 自动跟随；源①不受影响。
- 税按**现行** active 合同 RC 预算；RC 在窗口内被关窗批变更造成的税差是 k=1.0 下的已知敞口（登记，不修）。
- 额度恒生效（不判窗口开关）：关窗后转会通道自关，可用的支出本就少，公式不特判。

## 2. 实现面

### 2.1 触发器重建（迁移 0081，硬前提）

三个资金触发器（0005 bid_guard、0063 offer_guard、0070 sea_sealed_guard）的资金式从
`COALESCE(balance) − Σheld (+本单旧冻结) ≥ NEW.amount` 改为 `… + creditLine(club) ≥ NEW.amount`
（creditLine 子查询内嵌进触发器 SQL，**含 k 项与 type 过滤**，与 §1 公式逐字同源）。审查实测背书：BEFORE INSERT 触发器内放「UNION ALL + 派生表 + GROUP BY + MAX/SUM」的多表子查询、CTE、读 fund_holds 均可行（node:sqlite v24 同引擎实测），读不到递归限制。

触发器内读 config 的三条防御（审查 F3/F9 实测：缺行 → NULL → 比较式不成立 → RAISE 不触发 = **fail-open**）：

- k 项：`MIN(MAX(CAST(COALESCE((SELECT value FROM config WHERE key='expected_income_rate'), '1.0') AS REAL), 0), 1)`，应用层同式同源——第三轮终验实测：**CAST 非法字符串产 0.0 而非 NULL，COALESCE 兜不住**（node:sqlite 实测 CAST('abc' AS REAL)=0.0），单纯 COALESCE 会让「运营写错值」静默归零且难归因；钳制式下写错值 = 关闸（额度 0，fail 严格方向、资金安全），与显式写 0 同义，登记 §3。
- tax_rates 是逗号串（`'0.10,0.20,0.40'`），**不能用 json_extract**（实测 malformed JSON 直接打断每次 INSERT）；若在触发器内解析，instr() 只有双参（实测三参报错）、三段提取须派生表两层 substr（实测可行但繁琐）——**定案：触发器内不解析分段税率**，净额计算整体放应用层共享 SQL 片段（§1 公式的 SQL 文本单点定义、ledger.ts 与触发器 SQL 均引用同一出处文本），触发器只内嵌成品 creditLine 子查询；同源靠测试锁。
- 顺手修现状隐患（第三轮终验收敛修复面）：0081 重建时把三个触发器的**全部 NULL 可达闸位**包死，不止资金式——0005:11-12 挂牌状态闸（`listing 不存在 → NULL NOT IN → 放行`）、0070:52-56 批次状态闸+金额闸（JOIN 无行/标不存在 → NULL → 放行）与资金式（0005:24 无账本行放行，实测复现）同型 fail-open；修法照 0063:71 的 IFNULL 先例。
- **0081 落地三步**：①建迁移文件；②文件名追加进 `tests/d1.ts` 的 `MIGRATION_FILES`（现末条 0080，仓库纪律）——漏掉则同源锁测试静默跑在旧触发器上照样全绿、锁形同虚设；③同源锁断言（下条）。
- **应用层与触发器的同源靠测试锁死**（先例：`tests/players-sort-indexes.test.ts` 的表达式索引同源锁）：`tests/d1.ts` 跑真迁移，夹具构造「balance+冻结不足、但额度足」断言三个触发器放行；「额度来源落空后」拒绝；「config 缺 expected_income_rate 行」与「写非法值 'abc'」时两层一致按钳制式行为（1.0 / 0）；**「非资金闸不变」锁：0081 后 WHL_OFFER_REJECT_CLOSED / WHL_OFFER_REJECT_AMOUNT / 各 deadline 闸逐字不变**（重建只改资金式——设计 A 的既有测试依赖这些错误码，漏抄/改写会造成大面积假红）；变异：删触发器内 k 项 / 删 type 过滤必红。

### 2.2 四处公式真源（审查 F8/F11：第二至四处不是「顺带」，是必改项）

1. `src/worker/ledger.ts`：`availableBalance` 加额度子查询；新增导出 `expectedIncomeBreakdown(db, clubId)`（供 balance 端点与前端展示，返回逐笔在途源明细）。
2. `GET /api/club/balance`（clubs.ts:749-761 手写公式）改统一走 ledger.ts。
3. **`chargeBypassFee` 批内守卫（bypass.ts:156-161，审查定性的第四份真源）**：续约费/海捞签入费/匹配差额的预检走 `availableBalance`（改后含额度），但批内 guardSql 是手写的现金式 `balance − Σheld(+sealedHold) ≥ amount`——不改则预检放行、扣款必 409「资金刚被其他操作占用」且**重试永远不过**（审核死锁）。guardSql 同步加 creditLine 子查询（同一 SQL 片段）。
4. **顺手修 chargeBypassFee 静默失败**（审查 F11 高危细节）：守卫 0 行时账户不扣款，但批内末句 extra_fee UPDATE 无守卫、changes 恒 1，:196-202 只判末句 ⇒ **费用静默不扣、流程照走、海捞密封冻结照样 settled**。修复（第三轮终验收敛）：批内**两条 UPDATE 都挂守卫**——`fund_holds SET status='settled'`（:188，第三轮终验指出设计初稿漏了它）与 extra_fee UPDATE（:191）同挂资金守卫，只判其中任一 changes；只改判定不改语句的话批已提交、冻结照样白 settled。失败显式抛 409。
5. **文案收口清单（第五处真源，第三轮终验补充）**：offers.ts 三处资金不足 400 文案（:172-175 placeOffer、:289-297 counterOffer、:505-510 topUpBuyerHold）与 sea-sealed / market 出价文案——`availableBalance` 改后这些报错里的数字自动含额度而提示语不说明，与 §2.3 的文案承诺脱节；其中 :172-175 与设计 A 的 dup 预检（:166-170）同函数相邻，**A 先行落地后 B 只做增量文案**。

D1 读量：额度子查询按 seller/from_club 过滤在途行（实现时核 `listings`/`transfers` 现有索引，必要时补 `(seller_club_id, status)` / `(from_club_id, status)`——实现计划第一步实测，最坏情况口径量化后再决定建不建）。触发器内嵌子查询的写放大同口径实测（20 队全在途的极端形态）。

### 2.3 前端（增强档）

- 账本页余额行 + 转会台余额行：「可支配 X m（含预期收入 Y m）」；负可用时红字中性文案「当前可支配 −Z m（冻结或欠款占用），新增报价/出价类操作将被拒」——不写「预期收入已收缩」（审查 F15：工资扣穿冻结也会负可用，归因会写错）。
- **两处前端自算的 available 必须收编**（审查 F6/F10/F14）：`MarketBoardPage.tsx:32-34` 与 `ListingsBidsSection.tsx:21-22` 现在自己算 `balance − heldTotal`（且 heldTotal 只统计挂牌出价冻结，漏 offer/海捞暗标）——不改则同一页面两个「可支配」互相打架。两处改读 balance 端点（或共享 helper），heldTotal 口径一并统一。
- 支出确认弹层（报价/还价/接受、转会区出价、海捞暗标/明标、解约、匹配、续约费）：共享 helper（`web/src/lib/credit-line.ts`）计算动用额——**口径与服务端预检一致**（审查 F5/F13 + 第三轮终验补第四处：`动用额 = max(0, 本次支出 − (balance − held + 本人本单旧冻结))`，旧冻结回加项对齐 market.ts:1011-1018 / offers.ts:290-297 / **offers.ts:505-531 topUpBuyerHold（接受还价场景，第三轮终验指出初稿只列三处）** / sea-sealed.ts:324-341；漏回加会在抬价/还价/接受场景把动用额算大一整个旧冻结额、甚至超过 creditLine 本身），>0 时弹层加一行「本次动用预期收入 W m」。数据源为 balance 端点，注意缓存 invalidate 口径。
- 冻结型支出 400 文案更新：「可用资金不足：可支配 X m（已含预期收入 Y m），需要 Z m」。

### 2.4 落空路径（全部零接线，公式自动收缩）

| 落空事件 | 额度行为 |
|---|---|
| 审核驳回（transfers.ts:771-826） | transfers 行终态 → 源②消失 |
| 签约谈判作废/静默超时（negotiations.ts:709-727 作废批；静默超时引擎 negotiations.ts:739 起——第三轮终验订正：初稿误引 bypass.ts:881-898，该区间实为审核通过的分派逻辑） | 同上，挂牌 delisted、源①也不存在 |
| 出价被抬价 | 旧冻结释放新冻结全额，源①取最高——对卖方只升不降 |
| 流拍/下架 | 无 active 出价本就计零 |
| 关窗强制收口 | bidding → 待审（源①→源②连续转换，额度不断档）；listed 带出价被下架 → 计零（已知边角，与现状一致） |

已花超的部分：可用变负 → 冻结型支出（预检+触发器）全挡；扣款侧按三类口径（审查 F4 更正原稿「无闸门照扣」的错误归类）：

- **无余额闸、照扣**（现状哲学「负=欠款」）：工资/富人税（window-payroll.ts:95-126）、下架费、解约费过户扣款、事件负效果、管理端人工记账、冠名赔款。
- **现金闸、不吃额度**（Q4 明确排除）：球场扩建与商场工单——预检/守卫读原始 balance（stadium-ops.ts:88-92、shop-ops.ts:613），有余额校验但**保持现金口径不动**（预期收入是转会周转工具，不是运营消费工具；tests/stadium-ops.test.ts 与 tests/shop-orders.test.ts 现锁此行为，改口径需连改断言——不改）。
- **额度口径**（本设计接入）：三个冻结闸 + chargeBypassFee 三费 + 解约/海捞明标/匹配/续约的预检。

## 3. 已知风险（登记不修）

- **k=1.0 残余敞口**（用户已接受）：在途成交单作废时收入落空，已按额度花出则欠款；发生条件 = 审核驳回（常规动作）、签约谈判静默超时（默认 72h，config `negotiation_silence_hours`）或管理作废——注意待审单（pending_review）无到期引擎，计数时长无界，作废概率随挂单时长累积。
- **税差**：RC 关窗批变更后实际税高于预算，净额高估（金额小，k 键留给运营调）。
- **写错 k 值 = 关闸**：config 的 expected_income_rate 写非法值（如 'abc'）时钳制为 0——额度归零、含额度的预检与触发器统一按无额度工作（fail 严格方向，资金安全），但用户只会看到统一的「可用资金不足」，归因靠审计与本文档；运营侧纪律：只写 0–1 两位小数。
- **触发器读放大**：每次冻结 INSERT 多一次额度子查询（按在途行数扫），实现时按最坏情况口径实测（20 队全在途的极端形态）。
- **待审单无到期引擎**（探索发现，独立缺陷）：买方冻结可无限期占、卖方额度无限期挂——不属本设计修复面，登记；若未来加到期收口，额度公式自动跟随（零接线）。
- **现状 fail-open 隐患**：0005 触发器对无账本行俱乐部放行（审查实测复现）——0081 重建触发器时顺手 COALESCE 修掉（§2.1），其余触发器外的守卫不动。

## 4. 测试面（qa-test-planner 出计划，锁清单）

- 公式：每球员取最高（多买方不重复计）/ listed 无出价计零 / activation 与 matched_pending 排除 / **成交类 type 过滤（rc_change/match/free_agent/termination 单不计——变异：删过滤必红，构造 rc_change 假额度场景）** / **强制拍卖按 auction_tax_rate 整单税率（100m 拍卖净额 = 50m 而非 90m）** / k 键生效。
- 同源锁：三触发器与 ledger.ts 公式等价（d1.ts 真迁移夹具：额度足→放行；来源落空→拒绝；**config 缺 expected_income_rate 行→按 1.0、写非法值 'abc'→按 0（关闸），两层一致**；变异：删触发器 k 项必红、删 type 过滤必红）；**非资金闸不变锁：0081 后 WHL_OFFER_REJECT_CLOSED/AMOUNT 与 deadline 闸逐字不变**；**tests/d1.ts 的 MIGRATION_FILES 已追加 0081**（漏追加则本组测试静默跑旧触发器，锁形同虚设）。
- **chargeBypassFee**：预检含额度放行且批内守卫同步放行（不 409 死锁）；守卫失败显式抛 409（**settled（:188）与 extra_fee（:191）两条 UPDATE 都挂守卫**——变异：恢复只判末句必红、单挂 extra_fee 不挂 settled 必红）。
- 自然收缩：驳回后负可用挡新报价；已 held 冻结不受影响；抬价时「旧冻结回加」在额度收缩后仍正确（净差额口径）；审核改 fee 后源②额度同步变。
- 展示：balance 端点三字段；**MarketBoardPage/ListingsBidsSection 两处自算收编后与端点一致（含 offer/海捞冻结）**；弹层动用额三态（正好够/差一点用额度/抬价净差额——旧冻结回加口径，变异：删回加必红）；负可用中性文案。
- 回归更新：tests/market-rules.test.ts:187-196、tests/offers.test.ts:755、tests/ledger.test.ts:107-108/270-276（旧公式锁）；tests/stadium-ops.test.ts 与 tests/shop-orders.test.ts **保持绿**（现金口径不动即是对 Q4 排除的回归锁）。
- e2e：报价弹层显示动用预期收入（可选，视夹具成本）。

## 7. 审查记录

- 第一轮探索（opencode CLI · deepseek-chat，2026-10-27）：77 条核验事实，材料卡「资金域探索材料」。
- 第二轮（ZCode workflow · opencode-go-chat-2/deepseek-v4.1-flash $high，2026-10-27）：16 条意见 15 条成立（假额度 type 过滤 / fail-open / 拍卖税率 / 第四真源 chargeBypassFee / 动用额回加等），报告卡「预期收入设计审查报告」。
- 第三轮（GLM-5.3 终验 + 体验套餐 Flash 复核，2026-10-28）：20 条意见 18 条成立（本设计占 7，mustFix 3）。消化：§2.1 k 钳制式（CAST 非法值产 0.0 实测）、触发器修复面扩至全部 NULL 可达闸位、0081 落地三步（含 MIGRATION_FILES）、非资金闸不变锁；§2.2 第 4 项 settled 语句补挂守卫、第 5 项 offers.ts 文案清单；§2.3 回加第四处 topUpBuyerHold；§2.4 行号订正（作废批在 negotiations.ts:709-727）；§3 登记写错 k=关闸；实施顺序 A 先 B 后（头部）。type 过滤完备性经第三轮逐建单点全查（0001 枚举七种 × 运行时建单点三处）：白名单无漏、无第五处公式真源。
