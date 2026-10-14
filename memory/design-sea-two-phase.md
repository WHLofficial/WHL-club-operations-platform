# 设计定稿：海捞两阶段（暗标段 + 明标段）

来源：用户 2026-10-14 裁决——① 组织方式 = **窗口批次制**（每个转会窗固定两段：开窗时自由身池整体进入暗标批次、统一截止开标，之后进明标段）；② **明标段 = 现有海捞流程原样**（公开、窗口内随时提交、先到先得、审核→工资谈判→过户；不做公开竞价、不复用挂牌链）。

本文件为增量 2（v6.50.0）的设计定稿。全部长在增量 1 的到期引擎与时刻表上。

## 1. 口径（定稿）

1. **暗标段 = 现有海捞的提交表单加三样东西**：金额与出标方保密、统一截止、价高者得。
2. **标的 = 新违约金承诺**（与现有表单同字段 `newReleaseFee`）；**不做 RC 上下限**（沿用现状；PRD 自平衡口径「签得便宜→易被激活挖走」）。
3. **冻结 = 30% × RC**（= 签入费额，复用 `FREE_AGENT_FEE_RATE = 0.3`，`src/core/bypass-rules.ts:10`）；新 `fund_holds.ref_type='sea_sealed'` + 与 `0005_market_bid_guard.sql` / `0037_offers.sql` 同形守卫触发器。截止前可改（替换刷新冻结）可撤（解冻）。
4. **同球员同队限一份密封标**（唯一索引）；只显示倒计时与「我是否已出标」，不泄露他人。
5. **可出标范围沿用现有资格链** `checkSeaSignEligible`（`src/worker/bypass.ts:85-121`：窗口开着 → 球员无归属或 CPU 队 → status 非 retired/listed → 本窗未被本队解约过 → 无在途挂牌/待审单）。
6. **开标 = 每球员最高 RC（同额取最早）**；开标时**重跑资格链**——球员已被挂牌/易主/已有在途单则该标作废并解冻 + 通知；胜出者生成 `transfers(type='free_agent', status='pending_review')` + `review_task` 复用现有链（审核 → 工资谈判 → `completeTransfer` 过户）；其余密封标解冻 + 通知。
7. **开标后公示**胜出者与金额。
8. **明标段 = 剩余池走现有海捞原样**（`POST /api/transfers/free-agent`，零新增机制）；明标段起点 = 暗标终点同一具体时间（时刻表 `transfer_sea_open` 行的起点）。
9. **关窗时批次仍在 sealed ⇒ 自动立即开标**（origin `'user'`，不阻塞关窗）。
10. **语义变化**：暗标段内不能走常规海捞（改提交密封标）；`sea_enabled=false`（默认）时保持现状即时海捞（上线开关 + 回滚位）。
11. **管理端**手动「立即开标 / 延长暗标段 / 取消本窗批次」。
12. 顺带用状态守卫 UPDATE claim 消掉现状 `findInFlight`（`src/worker/bypass.ts:43-57`）/ `createBypassTransfer`（`src/worker/bypass.ts:204-227`）的先查后插 TOCTOU（transfers 无唯一约束）。

## 2. 数据（迁移 `0070_sea_sealed.sql`）

- `sea_batches`：`id`、`season`、`window_seq`、`status`（`sealed` / `settling` / `opened` / `cancelled`）、`sealed_at`、`opened_at`、`deadline_at`、`opened_by`、`note`、`created_at`；`UNIQUE(season, window_seq)`。
- `sea_sealed_bids`：`id`、`batch_id`、`player_id`、`club_id`、`new_release_fee`、`hold_id`、`status`（`sealed` / `won` / `lost` / `void` / `withdrawn`）、`submitted_at`、`updated_at`、`resolved_at`、`void_reason`；`UNIQUE(batch_id, player_id, club_id)`。
- `fund_holds` 守卫触发器 `fund_holds_sea_sealed_guard`（金额下限/上限、冻结不足、批次已结算则拒）。
- 索引：`idx_sea_sealed_bids_batch`、`idx_sea_sealed_bids_player`。

## 3. 引擎适配器

`transfer_sea_sealed`（终点 `absolute` 到点 ⇒ 开标；`window_close` 早于终点 ⇒ 关窗流程调 `openBatch`）：

- scan：`sea_batches WHERE status='sealed' AND deadline_at <= now`（+ 关窗触发的显式调用）。
- close：按球员分组取最高 RC（同额取最早）→ 重跑资格链 → 胜出者建待审单 + `review_task` + 通知；其余解冻 + 通知；批次 `status='opened'`；审计 + 公示数据落库。
- remind：截止前 24h 提醒已出标球队（`reminded_at` 抢占，同 event 域范式）。

## 4. 前端

- `web/src/pages/market/MarketFreePage.tsx`（资格查询页）：批次阶段横幅（暗标段倒计时 / 已开标）+ 开标公示（胜出者与金额）。
- `web/src/pages/player/SideOps.tsx`（球员档案 E 态）：暗标段时把「海捞」按钮换成密封标表单（新违约金输入 + 「已出标，可修改/撤回」态 + 倒计时）；明标段维持原按钮。
- 时间显示一律走 `useTimeFmt()`；倒计时复用 `web/src/lib/use-countdown.ts`。

## 5. 通知（3 模板）

`sea_sealed_lead`（开标胜出）、`sea_sealed_lost`（未胜出/作废）、`sea_batch_open`（开标公告）。双写 `src/worker/notify.ts` 与 `src/core/notify-meta.ts`（`src/core/notify-meta.test.ts` 双向相等守卫）。插件侧只读 qq/text，无需改动。

## 6. 开关

config `sea_enabled`（默认 `false`）、`sea_sealed_hours`（默认 `72`，仅作为管理端表单的默认填充值；实际以时刻表 `transfer_sea_sealed` 行的具体时间为准）。三处同改注册表测试。

## 7. 风险

- **暗标段内球员被挂牌/易主**：开标时重跑资格链作废 + 解冻（已设计）。
- **同球员并发提交**：唯一索引 + 状态守卫 UPDATE claim（已设计）。
- **资金守恒**：冻结（提交）→ 解冻（撤回/未胜出/作废）→ 销毁（胜出后签入费在审核通过时才收，与现状一致）。
- **`sea_enabled=false` 回滚**：暗标段入口关闭、时刻表行 `none` 时同样不开批次，线上行为与今天一致。

## 8. 落地偏差（实现期决定，与上文口径的差；每条附理由）

1. **通知 4 模板**（上文 §5 列 3 个）：为落地 §9 的「截止前提醒」增 `sea_sealed_deadline`（提前 24h，批次级 `reminded_at` 抢占）。类目统一 `window` 而**不是** `offer`——海捞单不是 offer 实体，`notificationRefOf` 取不到可跳转 id（`offer` 类目会强制取 `data.offerId`），返回 null，前端靠海捞页横幅定位。
2. **`sea_enabled=false` 时 tick 整批作废 + 解冻**（`cancelSealedBatches`，reason「海捞两阶段已关闭，本批标作废」）：否则回滚开关后已收的密封冻结会长期悬挂，钱出不来。
3. **批次状态是「收标中」的唯一真源**，写入口不看时刻表行状态：时刻表管「开不开段」，批次管「收不收标」，两把尺子只留一把做判定。
4. **惰性建批要求时刻表 `transfer_sea_sealed` 行的终点是 `absolute` 具体时间**：随窗锚（`window_close`）拿不到统一截止 ⇒ 不开批次，明标段照旧（这是与「三种随窗锚」需求的一处显式让位，管理端表单已提示填具体时间）。
5. **`extendSeaBatch` 批次截止与时刻表行同改**：只改批次会被时刻表到点收口先一步开标（两把尺子变一把）。
6. **签入费在审核通过时才收，并在同批销毁密封冻结**：与现有海捞同口径（审核前不划款）；销毁冻结是为了谈判期内可用额不被「冻结 + 待收」双重扣减。单据被驳回/完成时由 `transfers_sea_sealed_release` 触发器兜底（`rejected` ⇒ 释放 + 标置 `void`；`completed` ⇒ 结算）。
7. **收标期内常规海捞被 409 `sea_sealed_phase` 硬拦**（`createFreeAgent`）：设计原说靠时刻表闸（明标段未开始），实现另加一道防线——即使管理组误把 `transfer_sea_open` 行提前放开，收标期内的常规海捞也不会绕过统一开标；`settling`（正在开标）不拦。
8. **开标公告 `sea_batch_open` 只发「参与但未胜出」的俱乐部**：胜出方已收 `sea_sealed_lead`，重复发只会噪音。
9. **管理端「取消本窗批次」的说明兼作标作废原因**（`void_reason` = 管理组写的 note）：教练看到的是人话，不是内部代号。
10. **`sea_sealed_hours`（默认 72）只是管理端表单的默认时长**，实际截止一律以时刻表 `transfer_sea_sealed` 行的具体时间为准（避免两处真源）。
