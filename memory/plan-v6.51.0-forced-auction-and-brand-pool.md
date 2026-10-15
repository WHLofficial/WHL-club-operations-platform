# 增量计划 v6.51.0：强制拍卖人选解禁 + 品牌池扩编（统一中文名 + 9 家新品牌）

**版本号说明**：判级 minor（新增只读端点 + 行为放宽 + 数据扩编，无破坏性迁移）。迁移号 **0071**（接在海捞 0070 之后）。

依赖：无（品牌池扩编沿用 v6.8.0 热度规则与 v6.13.0 档位校准口径）。测试计划见 `docs/test-plans/v6.51.0-forced-auction-and-brand-pool.md`。
用户口径（m13213）：「把管理端强制拍卖改为无限制，本队非门将CA前六仅作为一个校验参考值，不强制；品牌池写一些新东西，并统一品牌名为中文。」

## 范围

① **强拍人选解禁**：删掉三道人选硬闸（门将 / 缺 CA / 非前六）；保留五道闸（存在且有归属 / 开窗 / 时刻表段 / CPU 队 / 状态非 normal 与在流程里）；前六降为参考值随响应回报；新增只读预检端点，预检与建单同源同文案。
② **品牌池加料**：品牌名统一中文（`CVS Health` → 西维斯健康）+ 9 家新品牌 + 四个新行业系数。档位 / 名额 / 热度规则口径一律不动。

## 要改的文件（已全部落地）

**新增**
- `src/db/migrations/0071_brand_pool_expand.sql`（改名两处幂等 UPDATE + 9 行 `INSERT OR IGNORE`；不写 BEGIN/COMMIT，回滚三行见文件头）
- `docs/test-plans/v6.51.0-forced-auction-and-brand-pool.md`、本文件

**修改**
- `src/worker/ops-schedule.ts`（抽出 `opBlockReason`，`assertOpOpen` 复用；行为零变化）
- `src/worker/bypass.ts`（新导出 `ForcedAuctionReference` / `ForcedAuctionBlocker` / `ForcedAuctionInspection` / `inspectForcedAuction`；`createForcedAuction` 去三道硬闸、响应带 `reference`）
- `src/worker/routes/admin/market.ts`（+ `GET /api/admin/forced-auctions/preview`；注释改「人选不限，前六仅参考」）
- `src/core/config.ts`（`naming_industry_factors` 默认表 + 汽车 1.05 / 金融 1.15 / 制造 1.1 / 文旅 0.9）
- `web/src/lib/api.ts`（`ForcedAuctionReference` / `ForcedAuctionBlocker` / `ForcedAuctionPreview`；`ForcedAuctionResult.reference`）
- `web/src/pages/admin/MarketPage.tsx`（`referenceLine()` + 输入即显参考值 + 提示文案与 toast 改「参考不强制」）
- `tests/d1.ts`（MIGRATION_FILES + `0071_brand_pool_expand.sql`）
- `tests/forced-auction.test.ts`（首例改写 + 2 例新增）、`tests/naming-ops.test.ts`、`tests/market-rounds.test.ts`（16 家口径）
- `scripts/e2e/smoke.mjs`（㉓ + 头注释）
- `PRD.md` / `TECH_DESIGN.md`（规则行 + 端点行）、`CHANGELOG.md` / `ROADMAP.md` / `AGENTS.md`、`package.json` 6.51.0

## 分步（1–8 已完成，9 待令）

1. 现状取证：`createForcedAuction` 三闸位置与文案、品牌池 7 家、`naming_contracts` 生产 0 行、招商轮/档位敏感断言全集 ✅
2. 服务层：`opBlockReason` 抽取 → `inspectForcedAuction` → `createForcedAuction` 改写 ✅
3. 路由：预检端点 ✅
4. 前端：DTO + 参考值行 + 文案 / toast ✅
5. 迁移 `0071` + `tests/d1.ts` 注册 ✅
6. 测试改写与计数同步（7→16）+ smoke ㉓ ✅
7. 闸门：`npm run typecheck` 三份 0 error、`npx vitest run` **131 文件 / 2149 例**全绿、`npm run build` 成功 ✅
8. 文档与版本号（PRD / TECH_DESIGN / CHANGELOG / ROADMAP / AGENTS / 本文件 / 测试计划 / `package.json` 6.51.0）✅
9. 待令：迁移 `0071` apply 生产 → push → 部署 → 回读

## 口径备忘

- **参考值算法**：`caRank` = 同队**非门将且 `ca IS NOT NULL`** 中 `ca` 严格高于该球员的数量 + 1（并列共享名次）；`topSixLine` = 同队非门将 `ca` 降序第 6 名（队内非门将带 CA 者不足 6 人则 `null`，仍按队口径给出）；`inTopSix = caRank <= 6`；门将 / 缺 CA ⇒ `caRank = inTopSix = null`。`nonGkWithCa` 一并回报，供管理端判断参考是否可信。
- **预检与建单同源**：建单先 `inspectForcedAuction`，`blockers[0]` 有则抛同文案 `HttpError`；预检端点只读，不写库、不占位、不建挂牌。
- **保留的五道闸**：无归属 404「球员不存在或没有归属」/ 无窗 409「转会窗口没开，现在不能发起强制拍卖」（errCode `no_window`）/ 时刻表段未开或已结束（`opBlockReason` 的 `op_not_started` / `op_closed`）/ CPU 队 400「CPU 队球员不参与强制拍卖（CPU 队不入账）」/ 状态与在流程（listed「这名球员已经在挂牌流程里了」、其他「当前状态不能强制拍卖」、在流程「这名球员已经有一单在市场流程里了，等它结束再操作」）。
- **品牌热度与档位**：新品牌 heat 0.68–0.95（全部 < 1.0）⇒ 头部仍是亚马逊 1.3 / 麒麟生物 1.2 / 阿迪达斯 1.1；仅 极星运动 0.95 / 鲸涛饮品 0.91 记「新兴」（可口可乐 1.0 / 海底捞 0.9 原有）；关窗自动校准照旧按热度重算（`tier_locked` 优先、topK 按俱乐部数）。招商轮报价量随之从 7 家口径变 16 家（头部名额 1 队 / 新兴 2 队 / 口碑不限，`offersPerBrand` 默认 3 不变）。
- **新行业系数**：汽车 1.05 / 金融 1.15 / 制造 1.1 / 文旅 0.9（未登记行业回 1.0；**config 键数不变** ⇒ 插件 `market_industry_templates` 同值口径与 CONFIG_KEYS 长度断言不受影响）。
- **迁移回滚**：两处改名 UPDATE 反向执行 + `DELETE FROM brand_pool WHERE brand IN ('青云乳业','长风汽车','白马体育','极星运动','天工重工','鲸涛饮品','磐石银行','迅达通讯','星野文旅')`。
