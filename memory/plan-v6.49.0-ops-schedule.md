# 增量计划 v6.49.0：运营时刻表 + 到期引擎 + 管理端甘特图（含报价/谈判时限）

**版本号说明**：原计划名为 v6.48.0；因并行会话占用 v6.48.0（growth-tier-auto，迁移 `0068_growth_tier_auto.sql` 已在其工作区未提交），本批顺延为 **v6.49.0**，迁移号从 **0069** 起。若 growth-tier 批次最终未上线，本批回落为 v6.48.0 / 迁移 0068 编号（届时只需改文档号，代码不依赖）。

## 范围

1. **时刻表**（`ops_schedule` 表 + 12 行操作键 + 双锚解析 + 管理端表单 + 读接口）。
2. **统一到期引擎**（`ExpiryAdapter` 注册表 + `runExpiryTick` 接入 `runSettleTick` 第 5 步）。
3. **报价回合时限**（锚 `offers.updated_at`）与**谈判静默超时**（锚 `MAX(negotiation_attempts.created_at)`）两个适配器。
4. **管理端只读甘特图**（手绘 SVG，三层分层）。
5. 教练侧置灰与读秒。

## 要改的文件

**新增**
- `src/core/ops-schedule.ts`（零 import 纯函数：12 键定义、锚类型、解析、校验）
- `src/worker/ops-schedule.ts`（读库 + 窗口联合解析 + `assertOpOpen`）
- `src/worker/expiry-ops.ts`（`ExpiryAdapter{name,scan,close,remind?}` + 注册表 + `runExpiryTick`：逐条 try/catch、LIMIT、now−7d 下界防堵、守卫 UPDATE claim 幂等）
- `src/db/migrations/0069_ops_schedule_expiry.sql`（`ops_schedule` + seed 12 行全 `none` + `offers.reminded_at` + `negotiation_sessions.reminded_at` + 扫描索引）
- `tests/ops-schedule.test.ts`、`tests/expiry-ops.test.ts`
- `web/src/lib/gantt.ts` + `web/src/lib/gantt.test.ts` + `web/src/components/GanttChart.tsx` + `web/src/pages/admin/SchedulePage.tsx`
- `docs/test-plans/v6.49.0-ops-schedule.md`

**修改**
- `tests/d1.ts`（MIGRATION_FILES 追加 `0069_ops_schedule_expiry.sql`）
- `src/worker/index.ts`：`runSettleTick`（183-197）加第 5 步（独立 try/catch）；`tickChanged`（207-216）计入 closed/reminded
- 闸门接入：`src/worker/routes/market.ts:210,736,902`、`offers.ts:235,259,284,297,309`、`negotiations.ts:37,46,62`、`transfers.ts:29,36,43,57`、`routes/admin/*`（forced-auctions）、消费中心 `routes/shop.ts:92`、`routes/clubs.ts:1069,1079,1088,1168,1179,1188,1264`
- `src/worker/offers.ts`（适配器 ① 的收口函数）、`src/worker/negotiations.ts`（适配器 ②）
- `src/worker/notify.ts` + `src/core/notify-meta.ts`（新模板 `negotiation_timeout`，双写）
- `src/core/config.ts`（`offer_turn_hours`=48 / `negotiation_silence_hours`=72）+ 三处注册表测试同改（`tests/config.test.ts`、`tests/market-rounds.test.ts`、`tests/naming-tiers.test.ts`）
- 新端点 `GET /api/ops-schedule`、`GET/PUT /api/admin/ops-schedule[/:opKey]`（审计 `ops_schedule_set`）
- 前端：`web/src/lib/datetime.ts`（`zhWallToUtcIso`）、`web/src/styles.css`（`gantt-*` 段）、`web/src/pages/admin/AdminLayout.tsx`（侧栏项）、教练侧置灰与读秒（挂牌页/报价页/谈判页/`ShopPage.tsx`/`venueCards.tsx`/`VenueTab`）
- `tests/mobile-baseline.test.ts`（甘特图静态锁追加）
- CHANGELOG / ROADMAP / AGENTS

## 分步步骤

1. 落盘记忆（本文件 + `design-ops-schedule-expiry.md`）✅
2. 迁移 0069 + `tests/d1.ts` 注册
3. `src/core/ops-schedule.ts` + `src/worker/ops-schedule.ts` + 闸门接入
4. `src/worker/expiry-ops.ts` + 两适配器 + 通知模板 + config 两键
5. 端点（读接口 + 管理端 PUT）
6. `runSettleTick` 第 5 步 + `tickChanged`
7. 测试（ops-schedule / expiry-ops）→ 本地 vitest 全绿
8. 管理端 SchedulePage + 甘特图三层 + 静态锁
9. 教练侧置灰读秒
10. 本地演练：`wrangler dev` + 手动 `POST /api/cron/tick` 看 summary；设 2 分钟后终点验证自动收口；三种预设各验一次
11. 生产先 apply 迁移再 push → 部署后回读（`/api/health` + 手动 tick + 管理端目视）
12. 文档与记忆回写

## 验收标准

- 单测全绿（新增两个测试文件 + 既有回归）。
- **全行 `none` 时线上行为与今天逐条一致**（尤其报价/谈判不被新增窗口限制）。
- 三种随窗预设解析正确（A/B/C 各验一次）。
- 到点后新操作 409（`op_not_started` / `op_closed`），在途单收口、冻结释放、通知与审计落库。
- 甘特图正确呈现窗口带、开放式终点、「不限制」行；切时区偏好后刻度同步。
- **存量宽限**：存量 pending 报价/谈判不按历史锚实时算，首次扫描按 now+N 小时回填，不批量误杀。

## 风险点

- 时刻表误配全线关闭 → 全行默认 `none` + 管理端状态预览 + 甘特图复核 + 全量审计。
- 自动收口误杀 → 两级提醒 + 存量宽限 + `close_inflight` 逐行可关。
- cron 5 分钟粒度 → 到点误差 ≤5 分钟（与现有挂牌同口径）。
- 与 `expireStaleOffers` 共存 → 触发条件不同、均幂等。
- **并行会话占用共享文件**（`tests/d1.ts`、`tests/config.test.ts`、`src/core/config.ts`）→ 编辑前重读最新内容；提交只 add 本批文件。
