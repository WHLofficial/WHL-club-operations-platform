# 增量计划 v6.50.0：海捞暗标段 + 明标段原样

**版本号说明**：原计划名为 v6.49.0；因并行会话占用 v6.48.0，本批顺延为 **v6.50.0**，迁移号 **0070**。若 growth-tier 未上线，回落为 v6.49.0 / 0069 编号。

依赖：增量 1（v6.49.0）的时刻表与到期引擎必须先上线。设计见 `memory/design-sea-two-phase.md`。

## 范围

只新增**暗标段**；**明标段零新增代码**（现有 `POST /api/transfers/free-agent` 原样）；全部长在增量 1 的引擎上。

## 要改的文件

**新增**
- `src/db/migrations/0070_sea_sealed.sql`（`sea_batches` + `sea_sealed_bids` + `fund_holds_sea_sealed_guard` 触发器 + 唯一索引 + 扫描索引）
- `src/worker/sea-sealed.ts`（提交/修改/撤回密封标、开标 `openBatch`、批次查询）
- `tests/sea-sealed.test.ts`
- `docs/test-plans/v6.50.0-sea-sealed.md`

**修改**
- `tests/d1.ts`（MIGRATION_FILES 追加 `0070_sea_sealed.sql`）
- `src/worker/routes/transfers.ts:43`（海捞入口：暗标段分流到密封标提交）+ 新查询端点（批次阶段/我的出标/公示）
- `src/worker/expiry-ops.ts`（注册适配器 `transfer_sea_sealed`）
- `src/worker/window-machine.ts`（关窗时批次仍 sealed ⇒ 调 `openBatch`，不阻塞关窗）
- `src/worker/bypass.ts`（`findInFlight` / `createBypassTransfer` 改状态守卫 UPDATE claim 消 TOCTOU）
- `src/worker/notify.ts` + `src/core/notify-meta.ts`（`sea_sealed_lead` / `sea_sealed_lost` / `sea_batch_open` 三模板双写）
- `src/core/config.ts`（`sea_enabled`=false / `sea_sealed_hours`=72）+ 三处注册表测试同改
- 前端 `web/src/pages/market/MarketFreePage.tsx:36-103`（批次阶段/倒计时/公示）、`web/src/pages/player/SideOps.tsx:628-681`（密封标表单）
- 管理端（`src/worker/routes/admin/*` + `web/src/pages/admin/MarketPage.tsx`）：立即开标 / 延长暗标段 / 取消本窗批次
- CHANGELOG / ROADMAP / AGENTS

## 分步步骤

1. 落盘计划（本文件 + `design-sea-two-phase.md`）✅
2. 迁移 0070 + `tests/d1.ts` 注册
3. `src/worker/sea-sealed.ts` 后端 + 路由分流 + 资格链复用 + TOCTOU 修复
4. 引擎适配器 + 关窗钩子 + 通知三模板 + config 两键
5. 测试 `tests/sea-sealed.test.ts`（并发唯一 / 冻结三态守恒 / 开标资格重跑 / 关窗立即开标）→ 本地全绿
6. 前端（两处）+ 管理端三操作
7. 本地完整周期演练：提交 → 改 → 撤 → 开标 → 胜出 → 审核 → 谈判 → 过户
8. 生产 apply + push + 回读
9. **单独一步**开 `sea_enabled=true`（回滚位保持）
10. 文档与记忆回写

## 验收标准

- 完整周期演练通过（含未胜出/作废/撤回三条分支）。
- 同球员同队并发提交只落一份（唯一索引 + claim）。
- 冻结/解冻/销毁三态资金守恒（账本可核）。
- 关窗时批次仍在 sealed ⇒ 立即开标且不阻塞关窗。
- `sea_enabled=false` 时线上行为与今天完全一致。

## 风险点

- 暗标段内球员被挂牌/易主 → 开标重跑资格链作废 + 解冻 + 通知。
- 明标段起点需与暗标终点一致（时刻表 `transfer_sea_open` 行起点填同一具体时间；管理端表单提示）。
- 冻结长期占用（暗标段内最多 `sea_sealed_hours`）→ 撤回/未胜出即解冻；冻结额 30%×RC 与签入费一致，不额外占用。
- 与并行会话共享文件（`tests/d1.ts`、`src/core/config.ts`）→ 编辑前重读；提交只 add 本批文件。
