# 设计 · 成长档位自动核定（v6.48.0）

> 一句话：§10.3 的五条件从「管理组逐人手工判断」改为「平台自动核定 + 人工覆盖（锁定）」，为此补上 `clubs.country` 数据与档位重算流程。
> 状态：设计逐节获用户批准（第 1-2 节 m08987「没问题」／第 3-5 节 m08993「没问题」）；本文档为落盘版，用户过目后转计划实施。

## 0. 缘起与现状

用户 m08652「检查一下成长档位计算是否正确」→ 排查结论（m08780 交付）：

- 平台**不存在**自动档位计算。`growth_tier` 是运营列（`src/db/migrations/0001_init.sql:18` `growth_tier INTEGER DEFAULT 1, -- 成长档位 1-5`），只有两个写入口，都是人工：
  - 单人核定 `POST /api/admin/growth/:playerId/tier`（`src/worker/routes/admin/growth.ts:229-250`，注释原文「档位核定（§10.3）：条件叠加由管理组按现实资料判断，平台只落核定结果与审计」）；
  - 批量编辑（`src/worker/routes/admin/players.ts:47`）。
- 生产实查（远程 D1 whl-club）：**18301/18301 全员 1 档**；`audit_log` 里 `growth_tier_set` 0 条、含 `growthTier` 的批量编辑留痕 0 条 ⇒ 从未核定过任何人。
- 按 §10.3 平台现有字段可自动判的三条件（中国籍 399 / ≤18 1152 / 未来之星 104，并集 1614）应全部 >1 档 ⇒ 1614 人档位未落实。
- 两条人工条件当时无数据支撑：无「现实效力俱乐部」字段、players 无 nation 列、clubs 无 country 列。

用户 m08781 三问后的查证（m08877 交付）：

- **现实效力俱乐部 → 按来源球队**：`game_attrs.TeamID` 覆盖 100%，前端已以「来源球队」展示（`web/src/pages/Player.tsx:703/733`；术语三改见 AGENTS.md:83）。
- **naID**：在 `game_attrs.naID`，覆盖 18301/18301；`china_plan` 由它派生（`src/core/import.ts:227`，`CHINA_NA_ID = 155`，`src/core/fc26.ts:5`）。
- **clubs.country 可以录**：但用户 m08929 明确否决统计派生——「不不不，不要用国籍众数，这是不准确的」⇒ 值只能来自现实事实。

## 1. 目标与非目标

目标：

1. 档位由平台按 §10.3 五条件自动核定，可升可降（当前状态为准）；
2. 人工可覆盖并锁定，锁定后自动重算跳过，可解除；
3. 补 `clubs.country` 数据与维护入口（建档必填 / 换壳必填 / 管理端可改 / 机器通道留空可补）；
4. 首次回填（预计 1768 人升档、0 降档）。

非目标（明确不做）：

- 年龄滚动（`age` 仍只在导入时由 birthdate 算一次，`src/core/import.ts:189`；全仓无年龄滚动，`src/worker/window-machine.ts:149` 只改 agent_tier）；
- `growable`「赛季结算重判」（注释与实现不符，另案）；
- 档位对已发升级的回溯（不回溯，只影响之后的升级方案选择）。

## 2. 数据层（第 1 节）

**档位存列（物化）+ 事件驱动重算，不做读时派生。** 理由：球员库按档位排序/筛选依赖列（`src/worker/routes/players.ts:90` `COALESCE(players.growth_tier, 0)` 配 0035-0038 排序索引），派生表达式会失去索引；「锁定」状态本身需要存储。规则函数为唯一真源，重算只写差异行。

新增字段（迁移 `0068_growth_tier_auto.sql`）：

| 字段 | 定义 | 语义 |
|---|---|---|
| `clubs.country` | `INTEGER`（可空） | 队壳所属国家，FC NationID 空间；NULL = 未设 |
| `players.growth_tier_locked` | `INTEGER NOT NULL DEFAULT 0` | 1 = 人工锁定，自动重算跳过 |

**20 行国家种子值**（现实事实，人工逐队核对；非众数派生。管理端可改）：

| id | 队 | country | id | 队 | country |
|---|---|---|---|---|---|
| 1 | 阿森纳 | 14 英格兰 | 66 | 里昂 | 18 法国 |
| 2 | 阿斯顿维拉 | 14 | 73 | 巴黎圣日耳曼 | 18 |
| 5 | 切尔西 | 14 | 241 | 巴塞罗那 | 45 西班牙 |
| 9 | 利物浦 | 14 | 243 | 皇家马德里 | 45 |
| 10 | 曼城（CPU） | 14 | 280 | 奥林匹亚科斯 | 22 希腊 |
| 11 | 曼联 | 14 | 449 | 皇家贝蒂斯 | 45 |
| 13 | 纽卡斯尔联 | 14 | 110374 | 佛罗伦萨 | 27 意大利 |
| 14 | 诺丁汉森林 | 14 | 112172 | RB莱比锡 | 21 德国 |
| 21 | 拜仁慕尼黑 | 21 德国 | 131681 | AC米兰（CPU） | 27 |
| 33 | 慕尼黑1860 | 21 | | | |
| 45 | 尤文图斯 | 27 意大利 | | | |

值域校验：服务端目前无国家清单（只有前端 `web/assets/ref/nation.json`，218 条）⇒ 同源生成 `src/core/nations.ts`，并加一致性断言测试防漂移。

审计证据：沿用 `createAuditStatement`（用法 `src/worker/routes/admin/growth.ts:238-246`，`DB.batch([UPDATE, createAuditStatement(...)])`）；origin 透传调用方（人工 `'user'` / 机器 `'machine'` / cron `'cron_tick'`；**审计契约 `AuditOrigin` 里没有 `'system'`**，机器通道一律 `actor=null`）、`action: 'growth_tier_set'`、`after: { tier, conditions: {c1..c5} }`；每批次另写一条汇总（升/降/不变计数）。

## 3. 规则层（第 2 节）

`tier = MIN(1 + c1 + c2 + c3 + 2·c4 + c5, 5)`，下限 1：

| 条件 | 判定 | 生产命中 |
|---|---|---|
| c1 现实效力与队壳一致 | `club_id IS NOT NULL AND game_attrs.TeamID = club_id` | 89 |
| c2 会籍与队壳国家一致 | `clubs.country IS NOT NULL AND game_attrs.naID = clubs.country` | ≈137 |
| c3 中国国籍（大陆） | `china_plan = 1`（= naID 155 China PR） | 399 |
| c4 未来之星 | `is_future_star = 1` | 104 |
| c5 ≤18 岁 | `age <= 18` | 1152 |

口径：

- **c3「大陆」精确**：China PR 155 / Hong Kong 158 / Macau 172 / Chinese Taipei 213 是四个独立 id，`china_plan` 只认 155，港澳门台不算（与 §10.3 措辞一致）。
- **缺数据不猜**：club_id / TeamID / country 缺任一，对应条件记 false；管理端显式列出「未设国家的队」，避免静默少 +1。
- **回落按当前状态**：转会、换壳、年满 19、未来之星摘牌如实升降。
- 影响面：档位只决定升级方案选择（`src/worker/growth.ts:92-109` DEFAULT_UPGRADE_PLANS：档1 [1CA] … 档5 [5CA]/[3CA+1金]/[3CA+2银]）与展示；已发升级不回溯。
- 预演（按当前生产数据）：档1 16533 / 档2 1612 / 档3 113 / 档4 27 / 档5 16 ⇒ 非 1 档 1768 人（三条件并集 1614 + 仅 c1/c2 命中追加约 154），全为升档、0 降档。

## 4. 触发点与写入点（第 3 节）

共享重算器 `recomputeGrowthTiers(db, scope)`（scope = 球员 id 集 / 队 id 集 / 全量）：只写差异行，锁定跳过，UPDATE 与审计同批（50-100 条/批，避免 D1 大事务）。

| # | 触发点 | scope | 说明 |
|---|---|---|---|
| 1 | 球员导入收尾（`src/worker/players-import.ts`） | 本批球员分片 | 输入 TeamID/naID/age/china_plan/新增行 is_future_star |
| 2 | 合同导入（`src/worker/contracts-import.ts:253` 写 club_id） | 本批球员 | 影响 c1/c2 |
| 3 | 转会完成 / 解约 / 其它写 `players.club_id` 路径 | 单球员 | 实施前全量 grep 枚举；加源码扫描测试锁清单 |
| 4 | 换壳（rekey 换壳模式） | 该队球员 | 03 工件更新 clubs.id/country 后，按检查清单跑一键重算（工件内不放 JS） |
| 5 | 管理端改 `clubs.country` | 该队球员 | 数据修正，不锁定 |
| 6 | 管理端设 `is_future_star`（批量编辑） | 该球员 | 数据修正，不锁定 |
| 7 | 单人核定 tier / 批量编辑 growthTier | —— | 写值 + 置锁（不重算） |
| 8 | 解除锁定 | 单球员 | 立即重算回自动值 |
| 9 | 一键全量重算（管理端页） | 全量 | 预览 → 确认；上线回填 + 兜底 |

不挂钩：赛季结算（不改变输入）、窗口机器（只动 agent_tier）。

## 5. 管理端交互（第 4 节）

- 新页 `web/src/pages/admin/TierPage.tsx`（AdminLayout）：一键全量重算（计数条「升 N/降 N/不变 N」+ 明细表「球员/当前档/建议档/命中条件/升降」，默认前 200 行可搜）、变更清单（读审计）、未设国家的队（含「会籍本可命中却无法判定」人数）。
- PlayersPage 核定区：文案改「自动核定，人工可覆盖」+ 锁定状态 + 解除锁定按钮。
- ClubsPage：建档表单加国家（必填）+ 编辑入口（展示 nation 名）。
- Player.tsx（:423）：详情页显示档位 + 依据（5 条件逐条，命中打勾、缺数据标「数据缺失」）；列表徽章维持 >1 才显示。
- 球员库筛选/排序/列不变（读同一列）。

## 6. 首次回填 + 测试 + 文档（第 5 节）

首次回填（上线后管理端操作，不写死在迁移里）：一键重算 → 预览（预期见 §3 预演）→ 确认 → 回读分布 + 抽查：

- 哈兰德：club_id 14 诺丁汉森林 ≠ TeamID 10 曼城 ⇒ c1 假；naID 36 ≠ 14 ⇒ c2 假 ⇒ 档 1；
- 贝林厄姆：club_id 2 阿斯顿维拉，naID 14 英格兰 = 阿斯顿维拉 country 14 ⇒ c2 真 ⇒ 档 2。

测试闸门：

- 单测：规则边界（age 18/19、country NULL、club_id NULL、TeamID 缺失/非数字、cap 5、锁定跳过、港澳门台不算中国籍）；`src/core/nations.ts` ↔ `web/assets/ref/nation.json` 一致性；SQL 表达式与 TS 纯函数在同组 fixture 上结果一致。
- 路由/集成：建档必填国家、改国家、单人核定置锁、解除锁定、重算预览与确认、批量编辑两字段行为分离、导入后重算（未设国家时 c2 记假）。
- 源码扫描测试：写 `players.club_id` 的语句必须在挂钩清单。
- e2e（`scripts/e2e/smoke.mjs`）：建档（带国家）→ 改国家 → 重算 → 档位变化回读；未设国家提示。
- 变异（约 5-8 处）：去 MIN cap、`<=18`→`<18`、锁定判断取反、country NULL 当命中、审计丢条件。
- 顺序：typecheck + 全量 vitest + build + e2e 全量 + 生产回读。

文档收口：TECH_DESIGN §10.3 改写 + §4.1/§5.2 补 `clubs.country`、ROADMAP、CHANGELOG、AGENTS.md、测试计划 `docs/test-plans/v6.48.0-growth-tier-auto.md`、版本号 6.48.0。

## 7. 用户决策记录（硬约束）

| ref | 决策 | 含义 |
|---|---|---|
| m08781 | 现实效力按「来源球队」 | c1 用 game_attrs.TeamID |
| m08929 | 「不不不，不要用国籍众数，这是不准确的」 | 国家值禁止统计派生，只能现实事实录入 |
| m08955「1」 | 防线走硬约束 | 建档必填 + rekey `--new-country` 必填 + 编辑入口兜底 + 机器通道留空标「未设国家」 |
| m08967「A」 | 自动核定 + 人工覆盖 | 锁定标记、自动跳过、可解除；首次回填预览→确认 |
| m08970「A」 | 回落按当前状态 | 可升可降，如实反映转会/换壳/年满 19/摘牌 |
| m08987 / m08993 | 逐节批准 | 第 1-2 节 / 第 3-5 节设计通过 |

## 8. 关键实现坐标

- `src/db/migrations/0001_init.sql:18` growth_tier 列定义；`src/db/migrations/0001_init.sql:32-39` clubs DDL（现无 country）
- `src/worker/routes/admin/growth.ts:229-250` 单人核定（改为置锁）；`:188` 结算入口（不挂钩）
- `src/worker/routes/admin/players.ts:30-60` parsePlayerUpdates（两字段行为分离）
- `src/worker/growth.ts:92-109` DEFAULT_UPGRADE_PLANS；`:575-659` applyLevelUp（读 growth_tier）
- `src/worker/players-import.ts:143-161` 导入 INSERT（不含 growth_tier）；`src/core/import.ts:189/203-227` age/naID/china_plan/teamid
- `src/worker/contracts-import.ts:253` 写 club_id
- `src/worker/routes/admin/clubs.ts:35/57/97` 建档三入口
- `scripts/rekey-team/rekey-team.mjs:115` club_id 列覆盖；`:198-203` 换壳附加闸
- 前端：`web/src/pages/Player.tsx:423` 徽章；`web/src/pages/admin/PlayersPage.tsx:~549` 核定区；`web/src/pages/admin/ClubsPage.tsx:190-206` 建档表单

## 9. 风险与已否决

- 否决：国籍众数/统计派生（m08929）。
- 风险：机器通道建队（`src/worker/routes/internal.ts`）留空 country ⇒ c2 静默少 +1 ⇒ 对策：管理端「未设国家的队」提示。
- 风险：新增写 club_id 路径漏挂钩 ⇒ 对策：源码扫描测试。
- 风险：导入批量重算触发 D1 rows read（§17 预算）⇒ 分片 + 只写差异。
- 风险：档位变更影响升级方案选择，用户预期落差 ⇒ 口径写明「不回溯已发升级」，管理端变更清单可见原因。
