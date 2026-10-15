# 计划 · 成长档位自动核定（v6.48.0）

> 依据：[memory/design-growth-tier-auto.md](./design-growth-tier-auto.md)（设计逐节获批准：第 1-2 节 m08987 / 第 3-5 节 m08993）。
> 版本：**6.48.0**（package.json 现 `6.47.0`）；迁移号 **0068**（现最新 `0067_settle_scan_indexes.sql`）。

## 交付清单（按实施序）

1. **迁移 `src/db/migrations/0068_growth_tier_auto.sql`**：`ALTER TABLE clubs ADD COLUMN country INTEGER;` + `ALTER TABLE players ADD COLUMN growth_tier_locked INTEGER NOT NULL DEFAULT 0;` + 20 行 `UPDATE clubs SET country = ...`（值见 design §2 表）。
2. **`src/core/nations.ts`**：由 `web/assets/ref/nation.json` 同源生成（id→name + `isKnownNationId`），加一致性断言测试。
3. **`src/core/growth-tier.ts`**：规则真源——SQL 表达式构造器（c1..c5 + `MIN(1+...,5)`）+ TS 纯函数镜像 + 条件元数据（label/说明，供前端依据展示）；测试断言两者在同组 fixture 上结果一致。
4. **`src/worker/growth-tier.ts`**：`recomputeGrowthTiers(db, scope)`——scope 支持球员 id 集 / 队 id 集 / 全量；返回预览（升/降/不变 + 明细）或落库；只写差异行、锁定跳过（`growth_tier_locked = 0`）、分片 50-100 条 `DB.batch([UPDATE, createAuditStatement])`；审计 `origin: 'system'`、`action: 'growth_tier_set'`、`after { tier, conditions }` + 批次汇总行。
5. **触发点挂钩**：① 球员导入收尾（`src/worker/players-import.ts`）② 合同导入（`src/worker/contracts-import.ts`）③ 实施前 `grep -rn "club_id = " src/worker` 全量枚举写 `players.club_id` 的路径（转会/解约等）逐个挂钩 ④ 管理端改国家 ⑤ 批量编辑 `isFutureStar`（重算不锁定）⑥ 单人核定 / 批量编辑 `growthTier`（写值 + 置锁）⑦ 解除锁定（单人重算）⑧ 一键全量（管理端）。
6. **端点**：`src/worker/routes/admin/clubs.ts` 建档 body 加 `country`（必填、`isKnownNationId` 校验）+ 新增改国家端点（改后触发该队重算）；`src/worker/routes/admin/growth.ts` 加 `GET|POST /growth/tier-recompute`（预览/落库）、`GET /growth/tier-changes`（审计清单）、`POST /growth/:playerId/tier/unlock`（单人核定端点改置锁）；`parsePlayerUpdates` 两字段行为分离（`src/worker/routes/admin/players.ts:30-60`）；players/clubs 列表下发 `growthTierLocked` / `country`。
7. **前端**：新页 `web/src/pages/admin/TierPage.tsx`（重算预览/确认 + 变更清单 + 未设国家的队）+ AdminLayout 挂载；`PlayersPage.tsx` 核定区（锁定状态 + 解除按钮 + 文案）；`ClubsPage.tsx` 建档国家（必填）+ 编辑；`web/src/pages/Player.tsx:423` 详情档位 + 5 条件依据；球员库列/筛选不动。
8. **rekey 工具**：`scripts/rekey-team/rekey-team.mjs` 换壳模式 `--new-country` 必填 + `03-club-rekey-clubs-id.sql` 附 `UPDATE clubs SET country`；README 加「执行后跑一键重算」检查清单。
9. **测试**：单测（规则边界 / 国家清单一致 / SQL↔TS 一致）、路由集成（建档必填、改国家、置锁、解锁、重算预览与确认、批量编辑分离、导入后重算）、源码扫描（写 `players.club_id` 的语句必须在挂钩清单）、e2e（`scripts/e2e/smoke.mjs` 新增一例）、变异 5-8 处。
10. **文档收口**：TECH_DESIGN §10.3 改写（自动核定 + 公式 + 锁定 + 触发点）+ §4.1/§5.2 补 `clubs.country`；ROADMAP 条目；CHANGELOG `[v6.48.0]`；AGENTS.md 状态；`docs/test-plans/v6.48.0-growth-tier-auto.md`；package.json `6.48.0`。
11. **上线序**：迁移 0068 **先 apply 到生产**（代码读 `clubs.country`，缺列会报错）→ push → CF Version 回读（自定义域名）→ 管理端一键重算回填 → 回读分布（预期档1 16533 / 2 1612 / 3 113 / 4 27 / 5 16）→ 抽查哈兰德（档 1）/ 贝林厄姆（档 2）→ 发布记录回写（按惯例本地 commit 不 push）。

## 闸门（每步交付前）

- `npm run typecheck` 三份 tsconfig 0 error；
- `npx vitest run` 全量（当前基线 122 文件 / 1997 例，净增用例）；
- `npm run build`；
- `node scripts/e2e/smoke.mjs` 全量；
- 变异测试（5-8 处：去 MIN cap、`<=18`→`<18`、锁定判断取反、country NULL 当命中、审计丢条件）；
- 生产回读经自定义域名。

## 风险与回滚

- 迁移只加列 + 填 20 行，无破坏性；代码回滚后新列闲置（不写 DROP 回滚）。
- 档位回填幂等可逆：重算只写差异；人工锁定可解除；审计留全量证据。

## 明确不做（design §1）

- 年龄滚动（`age` 仍只在导入时算一次）；`growable` 赛季重判；已发升级的档位回溯。
