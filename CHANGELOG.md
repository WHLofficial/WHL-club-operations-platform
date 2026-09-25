# 变更记录

本项目按**各仓语义化版本**推进（2026-09-25 起；此前为全项目共享增量号，原号与新版本的对照表见 [ROADMAP.md](./ROADMAP.md) 顶部），每次生产部署以 Cloudflare Worker 的 Version id 标记（仓库无 git tag）。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

各版本的裁决、交付清单与验收数字见 [ROADMAP.md](./ROADMAP.md)。

## [v6.2.0] · 球员页展示层改版（2026-09-25，本地已收口：未 push 未部署）

**新增**
- 球员页左栏五态骨架 `SideOps`（`web/src/pages/Player.tsx`）：本队未挂牌 = 报价设置（转会名单 / 最低报价 / 非卖品，全禁用）+ 续约/挂牌/解约 + 「我收到的报价」入口；本队挂牌中 = 「转会区 · 本队挂牌中」信息卡；别队真人 = 报价/激活；非卖品 = 报价禁用（后端暂无字段，运行时不可达）；CPU 队/自由身 = 海捞签入。**控件全部禁用，真实数据与动作接线在 v6.3.0 报价子系统。**
- 属性页签头部两栏：左 = 标题/位置/角色，右 = **队徽 96px**（`TeamLogo`，logoKey 借公开 `GET /api/clubs` 的 `ClubSummary.logoKey`，哈希色块兜底）+ **232×156 光图六维雷达**（轴标签 = 三字母 + 数值；`radar-card` 卡框与文字 legend 整块删除）。

**变更**
- 状态词两表合一：删 `web/src/lib/ref.ts` 的 `STATUS_LABEL`（正常/无归属），全站统一用 `players-library.ts` 那套（在队/自由身）。
- 术语：「挂牌板 / 挂牌单」→「转会区」（市场板 h3 一处界面文案 + 6 处注释；页面大标题「转会市场」不动）。
- **转会窗门控（用户裁决「转会操作只有窗开时开放，管理端可手动开关」）**：球员页左栏接公开 `GET /api/seasons/current`，关窗出「转会窗未开放」提示条（后端六类转会写操作本就有 409 `no_window` 守卫、管理端开/关窗 UI 已存在，均零改动）；**改号也归转会窗管**（用户补令）——`POST /api/club/players/:id/number` 加窗守卫（关窗 409），球员页号码编辑入口关窗收起改只读。
- 队徽与 CPU 判据数据源：球员详情页按需拉公开 `GET /api/clubs`（与球队页共用 `qk.clubsList` 缓存键，服务端 24h scope 缓存）。
- `package.json` 版本 6.1.1 → 6.2.0。

**实测**：typecheck 三份全清；vitest **51 文件 / 728 例全绿**（含新增关窗 409 用例）；build 成功（主 bundle gzip 183.15 KB，较 v6.1.1 +0.7 KB）；e2e **11/11**；五态浏览器手测 + 窗关/窗开两态翻转实测全过（本地夹具临时翻转、测后还原），截图落 `scratch/manual-*.png`。

## [v6.1.1] · Sentry 错误追踪接入（2026-09-25，已上线：Version `b05e86db`）

**新增**
- `wrangler.jsonc`：`compatibility_flags: ["nodejs_compat"]`（Sentry SDK 依赖 AsyncLocalStorage）+ `version_metadata` 绑定（Sentry release 自动 = Cloudflare 部署版本 ID）。
- `src/worker/index.ts`：`@sentry/hono/cloudflare` 的 `sentry()` 中间件挂在一切路由之前（errors-only：`tracesSampleRate: 0`，SDK 默认过滤让带 status 的 3xx/4xx 业务错误不上报）；cron 从 `ctx.waitUntil` 改 `await` 并加 `withMonitor('club-settle-tick')`（Sentry Crons check-in 监控）；新增 `POST /api/cron/sentry-probe`（CRON_KEY 守卫）作上线验证探针。`app.onError` 与全部报错 JSON 形状不动。
- `src/worker/env.ts`：`SENTRY_DSN?`（secret，未配 = SDK 完全不初始化、零上报零网络）、`SENTRY_ENVIRONMENT?`、`CF_VERSION_METADATA?`。
- `web/src/lib/sentry.ts` + `main.tsx`：`@sentry/react` errors-only 初始化（不引 replay/ErrorBoundary）；DSN 空串 = 未接入。
- `tests/sentry.test.ts` 3 例（DSN 未配旁路 / 探针 403 / 探针 500 JSON 形状）。

**变更**
- `tests/media.test.ts`：waitUntil 精确计数 `toHaveLength(1)` 放宽为 `≥1`——Sentry 会在同一 executionCtx 登记自己的 flush drain（生产语义：让 isolate 活到事件发完）。
- `package.json` 版本 6.1.0 → 6.1.1；新增依赖 `@sentry/hono` / `@sentry/cloudflare` / `@sentry/react`（v11.0.0，首个第三方 SaaS 运行时依赖）。

**实测**：typecheck 三份全清；vitest **51 文件 / 727 例全绿**（基线 724）；build 成功且主 bundle `index-BqdBJFJR.js`（477,874 B / gzip 149,563 B）**与改动前逐字节同 hash**——前端 DSN 为空串时 rollup 把整个 SDK 死代码消除，填 DSN 后须实测增量（硬线 ~35KB gzip）；e2e **11/11**；`wrangler deploy --dry-run` worker 打包通过。

**上线（2026-09-25）**：Sentry 账号已建（EU 区 org，6 项目）；生产 `SENTRY_DSN` 已配（Source `Secret Change`，Version `6066268f-…`，10:01:17Z）；前端 DSN 已填（提交 `a502043`）并实测 @sentry/react 进包 gzip 增量 **32.92 KB**（149,563 → 182,479 B，硬线内贴线过）；push 后 Workers Builds 自动部署 Version **`b05e86db-…`**（10:24:56Z），回读 `/api/health` 200、`POST /api/cron/sentry-probe` 无 key 403（该路由只在 v6.1.1 代码 ⇒ 新代码生效）、线上首页资产 `index-DwvQl1O1.js` 与本地 dist 逐字一致。**待回读**：带生产 CRON_KEY 打 probe 在控制台见事件、Crons 页确认 `club-settle-tick` monitor（首个 `*/5` 整点自动创建）。配额口径：errors 5k/月 = org 级共享池（6 项目共用，官方文档核对）；免费档全 org 只含 1 个 cron monitor（check-in 次数不占 errors 额度）。

## [维护] · 排序索引 batch 4/5：迁移 `0035` / `0036`（2026-09-24 / 09-25，两个迁移已 apply 到生产：无运行时行为变化）

用户 m04225 裁决「先看看剩余写限额，能推几条是几条」⇒ 先实测当日配额，再按余量把第 5 节清单上的排序索引推进生产。**不改 `src/` 与 `web/`**：只有两个迁移、测试与文档 ⇒ 运行时代码与前端产物零变化。

**新增**
- `src/db/migrations/0035_players_sort_indexes_batch4.sql`（**2026-09-24T23:54Z apply，UTC 归零前 6 分钟**，报 `Executed 3 commands`）：`idx_players_sort_position`（12 项 `CASE position WHEN 'GK' THEN 1 … ELSE 0 END, id`，逐字等于 `src/worker/routes/players.ts` 的 `POSITION_SORT_CASE`，**索引侧必须去掉 `players.` 限定符**，否则 SQLite 报 `the "." operator prohibited in index expressions`）+ `idx_players_sort_growable`（`COALESCE(growable, 0), id`）。选这两条的理由：它们是 `web/src/lib/players-library.ts` 的 `FIXED_COLUMNS`（位置 / 成长，永远在表头、不可隐藏），暴露面最大，表达式也最安全。
- `src/db/migrations/0036_players_sort_indexes_batch5.sql`（**2026-09-25T00:00Z 归零后 apply**，报 `Executed 4 commands`）：`idx_players_sort_badges`（`(COALESCE(badges_silver, 0) + COALESCE(badges_gold, 0)), id`）、`idx_players_sort_base_ca`（`COALESCE(base_ca, 0), id`）、`idx_players_sort_foot`（`COALESCE(foot, 0), id`）。**刻意跳过 `growth_gap`**（理由写进迁移注释）：它在默认视图下可静态索引，但 `view=initial` 口径下 pa/ca 换成另一套表达式，单独建默认视图那条只覆盖一半场景 ⇒ 与 `view=initial` 的 `pa` 变体同轮处理。
- `scripts/measure-d1-reads.mjs` 补 5 条探针：`sort-position` / `sort-growable` / `sort-badges` / `sort-base-ca` / `sort-foot`（原 SHAPES 里没有这 5 个键，不补就没有「改后」读数可对）。
- `tests/players-sort-indexes.test.ts` 的 `INDEXED_SORTS` 11 → **16 条**（新增 5 条各带 cursor / `order=asc` 三形状），`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0035` / `0036`。

**配额实测**（`scratch/quota-check.mjs`，走 Cloudflare GraphQL `d1AnalyticsAdaptiveGroups`）
- 2026-09-24T23:49Z：`whl-club` 读 221,080（4.4%）/ 写 54,997（55.0%）；**账号池余量 ≈44,541 行 ⇒ 2 条索引（36,602）放得下、3 条（54,903）会超** —— 这是把本批拆成 `0035`（2 条）/ `0036`（3 条）并跨归零点分两次 apply 的根本原因。
- 2026-09-24 终值：`whl-club` 写 **91,604 行 = 91.6%**（`0034` 的 54,919 + `0035` 的 36,602 + 零头），当日写额度贴顶用满。
- 2026-09-25（归零后）：`whl-club` 写 **54,909 行 = 54.9%**（`0036` 的 3 条）。
- 顺带修了脚本里**过期的库名映射**（实际 `whl` = `ec3cc695-70bc-47ab-a454-5ca62ec22dd6`、`whl-auth` = `8f48bd5e-5d1b-4d62-ba4f-bf9b0cdb09eb`、第四个库 `b76d1129-77ae-4844-931c-1c7b00a9b048`；`whl-club` 一直是对的），并支持 `node scratch/quota-check.mjs 2026-09-24` 查指定 UTC 日期。

**收益实测**（`scripts/d1-read-audit/measurements-after.json`，改前 → 改后）

| 形状 | 索引来源 | 改前 | 改后 |
| --- | --- | --- | --- |
| `sort=position` | `0035` | 37,635 | **22** |
| `sort=growable` | `0035` | 37,635 | **22** |
| `sort=badges` | `0036` | 37,635 | **22** |
| `sort=base_ca` | `0036` | 37,635 | **54** |
| `sort=foot` | `0036` | 37,635 | **22** |

**副产品**：`0036` 生效**前**实测 `sort=badges` / `sort=base_ca` / `sort=foot` 三条恰好各 **37,635 行**，把审计报告 §5.1 那句「剩余键各 37,635 行/次」的类级推断变成了直接实测。一次测量假象：`sort=foot` 首跑报 `0 行 [0 + undefined]`（statements 0 条、0ms），重跑即得 22 行 —— 是 wrangler 偶发抓取失败，不是索引问题。

**生产核对**：`sqlite_master` 里 `idx_players_sort_%` **11 → 16 条**（两次只读 `wrangler d1 execute --remote`，`rows_written: 0`）；`players` 表索引总数 **16 → 21**。

**操作技巧（下次复用）**：`wrangler d1 migrations apply` 会把目录里**所有 pending 一次做完**，所以为了在归零前只推 `0035`，先把 `0036` 临时 `mv` 到 `scratch/0036-pending.sql`，`npx wrangler d1 migrations list whl-club --remote` 确认只剩 `0035`，apply 后再 `mv` 回 `src/db/migrations/`。首次 apply 撞了一次 `AuthenticationError`（wrangler 日志 `"errorType":"AuthenticationError"`、`durationMs:2699`），**直接重试同一条命令即成功**（令牌抖动，不是权限问题）。

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **50 文件 / 724 例全绿**（`0034` 批之后是 709，本批 +15 = 5 条形状 × 3）。

**文档同步**：`scripts/d1-read-audit/README.md` 新增 §3.3（三批收益合并表 + 探针口径 + 写入记账）、§5.1 分类行改为「已建 7 / 剩余 6」、§5.3 第 3 条补 2026-09-25 进展、§5.5 补 5 行「已收」、§六 补 `--only=` 只接一个形状与 5 条新探针的说明；`scripts/players-import/README.md` 写入成本口径 **16 → 21 索引**（upsert 重跑 11 → **14 行/人 = 256,214**，全量重导须跨 **5** 个 UTC 日）；`README.md` 迁移 34 → **36**；`ROADMAP.md` 维护节加 batch 4/5 段；`AGENTS.md` 生产迁移段 `0034` → `0036` 与当前状态 bullet。

**下一批待令**：清单上还剩 **6** 个可建索引的键（`growth_gap` / `growth_tier` / `future_star` / `china_plan` / `agent_tier` / `fc_id`），仍按「每天最多 3 条」分批；`view=initial` 口径另欠 `pa` / `growth_gap` 两个变体。

## [维护] · 上线口径订正：push 到 main 会触发 CF 自动部署（2026-09-24，文档：无运行时行为变化）

2026-09-24 实测确认：本仓与 `tour` / `whl-auth` / `whl-guess` 四仓都接了 Cloudflare 的 Git 集成（Workers Builds）—— `git push origin main` 之后约 30–60 秒，CF 在服务端自动构建并部署对应 Worker，不需要任何本地命令。证据：同日三仓推送（用户只下令 push、未下令 deploy）后 `whl-club` 部署 `04:33:27.890Z`（Version `a65570f8-…`）、`whl-auth` `04:33:45.766Z`（`458e0e94-…`）、`whl-guess` `04:34:15.675Z`（`c6d741aa-…`），顺序与 push 顺序一致、间隔 30–60 秒；未推送的 `tour` 无新部署。同轮更早还有一次交叉验证：手动 `npm run deploy` 出的 `a573ade7`（03:37:53Z）两分钟后被 push 触发的 `c5e796f6`（03:40:13Z）顶掉。

排除项与取证边界：四仓都没有 `.github/` ⇒ 不是 GitHub Actions，是 CF 服务端的集成；`wrangler deployments list` 的 Source 字段**不区分**来源（自动部署同样报 `wrangler` / `Unknown (deployment)`，因为构建容器里跑的就是 `wrangler deploy`）；构建日志拿不到 —— OAuth token 缺 `workers_builds` 读权限（`/accounts/<id>/builds/*` 一律 `Authentication error`，wrangler 无 `builds` 子命令）⇒ 构建命令是否含 typecheck 未能验证，只能看 CF 面板 Settings → Builds。

⇒ `AGENTS.md` 危险清单的 `git push` 条与「部署即 push」段已同步订正：**push 即上线，「只推不部署」不存在；已 push 后不必再手动 `npm run deploy`（冗余且会被自动部署顶掉）；push 前必须本地 `npm run typecheck` + `npm test` 全绿。**

## [维护] · players 全量覆盖的写入成本口径订正（2026-09-24，文档：无运行时行为变化）

用户 m02214 问「如果随后更新或者完全覆盖了 players 表，索引需要重写吗」⇒ 结论：走 `INSERT` / `UPDATE` / `DELETE`（含本仓导入用的 `INSERT ... ON CONFLICT(fc_id) DO UPDATE` upsert）时 SQLite 自动维护全部索引，无需 `REINDEX`；`UPDATE` 只为「SET 列表里出现过的列」所属的索引写新条目。唯一例外是 `DROP TABLE players` 式重建 —— 索引一起消失（本条目写作时是 16 条，`0035`/`0036` 之后是 **21 条**），而 `d1_migrations` 仍记着 `0033`–`0036` 已 apply ⇒ `wrangler d1 migrations apply` 不会重跑，必须手工重建。

`scripts/players-import/README.md` 的「写入成本」段此前仍写首灌当时的「4 个索引 / 每人 5 次写入 / 91.5k」，现已拆为「（首灌当时）」+ 新增「重跑成本已随索引增多放大（2026-09-24 实测订正）」小节：16 索引清单（14 条显式 + `uid` / `fc_id` 两个 UNIQUE 自动索引）、四种覆盖方式的成本表（新插入 17 行/人 = 311,117；本文件的 upsert 重跑 11 行/人 = **201,311**；`DELETE FROM players` 全清 17 行/人 = 311,117；全清 + 重灌 34 行/人 = 622,234），以及两条纪律 —— 不要用 `DELETE FROM players;` 做覆盖（中断即半空表、无回滚点，该语句仅作首灌回滚记录保留；upsert 幂等可中断续跑）、不要用 `DROP TABLE` 重建。⇒ 全量重导已不可能一天做完（201k 起，须按 19 个分片跨 3–4 个 UTC 日；首灌当时 91.5k 一天塞得下，该数字已不可复现）。（2026-09-25 起该口径已随 `0035`/`0036` 再订正为 **21 索引**：新插入 22 行/人 = 402,622、upsert 重跑 **14 行/人 = 256,214**、全清 22 行/人、全清+重灌 44 行/人 = 805,244，须跨 5 个 UTC 日；详见本文件同批「排序索引 batch 4/5」条目。）

## [维护] · 遗留项第 5 节最小步 —— 下一批排序索引写成迁移 0034（2026-09-24，迁移 `0034` 已 apply 到生产并部署上线（Version `a573ade7-…`）：无运行时行为变化）

遗留项普查第 5 节（D1 读量治理后续批次）的结论是「主体已在v3.2.0 治完，剩下的是**写配额换读量**的排期清单，属产品判断而非配额判断」（2026-09-22 搁置它的当日理由——写配额被 `0029`+`0030` 吃掉 73.2%——现已不成立：2026-09-24 实测当日写 10 行 / 读 2,969 行）。本轮只走最小步：先做候选表达式的真引擎体检，再写下一批索引与同源测试锁，代码部分**不动生产**（迁移的 apply 于同日单独授权执行，见文末）。

**新增**
- `scripts/check-sort-index-feasibility.mjs`：候选排序表达式体检器（仿 `scripts/check-name-fold-depth.mjs`，`wrangler d1 execute --local --persist-to .wrangler/rehearsal` 逐条 `CREATE INDEX` 后立刻 `DROP`，零配额）。本轮 15 个候选（13 个可建索引键 + 初始视图 `ca` + `attr` 抽样）**15/15 通过** ⇒ D1 表达式树深度上限 100 对这批形态不构成限制（`ps` 的 15 项链可通过），且 **`json_extract` 可以出现在索引表达式里**（索引侧表达式禁止 `.` 限定符，故写非限定列名）。
- `src/db/migrations/0034_players_sort_indexes_batch3.sql`（**2026-09-24 已 apply 到生产**）三条排序索引：
  - `idx_players_sort_uid ON players(COALESCE(CAST(SUBSTR(uid, 3) AS INTEGER), 0), id)`
  - `idx_players_sort_ps ON players(((json_extract(game_attrs, '$.PSID1') IS NOT NULL) + … + (… '$.PSID15' …)), id)`（15 项，逐字与 `src/worker/routes/players.ts` 的 `PS_COUNT_EXPR` 同源，由 `PS_SLOT_COUNT` 生成）
  - `idx_players_sort_initial_ca ON players(COALESCE(COALESCE(base_ca, ca), 0), id)` —— 必须是这层**完整嵌套**：`buildSortExprs` 在初始视图的 `caExpr = COALESCE(players.base_ca, players.ca)` 外还套了一层 `COALESCE(…, 0)`，只建内层匹配不上（这正是 `view=initial&sort=ca` 此前静默失配成 37,635 行/次的原因）。
- `tests/players-sort-indexes.test.ts`：`INDEXED_SORTS` 由 8 条扩到 **11 条**（改三元组 `[sort, index, extra?]`，支持 `&view=initial` 这类附加查询串），每条仍是「真实路由 SQL 的 `EXPLAIN QUERY PLAN` 必须命中指定索引」+ cursor / `order=asc` 三形状；新增 2 条同源锁（`ps` 表达式必须由 `PS_SLOT_COUNT` 生成、initial-ca 必须含完整嵌套 `COALESCE`）。`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0034`。

**验证**
- 定点：`npx vitest run tests/players-sort-indexes.test.ts` **37 例全绿**（原 26 + 新 11）。
- 变异验证（`scratch/mutate-0034.mjs`，已备份还原）：把 initial-ca 索引改成只建内层、`ps` 索引删掉 `PSID15` 一项 ⇒ **8 例变红**（两条形状各 3 条 EXPLAIN + 各 1 条同源锁）⇒ 新锁不是空转。
- `npm run typecheck`（三份 tsconfig）全清；`npx vitest run` **50 文件 / 709 例全绿**（原 698 + 11）。
- 文档同步：`README.md` 迁移 33 → **34**（当时写明 `0034` 已写好未 apply、一次 ≈5.5 万行写须单独占配额日；同日 apply 后已改为「已 apply」并写入实测数字）、测试 698 → **709**；`scripts/d1-read-audit/README.md` §5.3 第 3/4 条与 §5.5 三行订正 —— 顺带查明 §5.5 的 `sort=name` 候选**早已由迁移 `0033`（2026-09-23 apply）完成**，该行此前已过期。

**生产 apply（2026-09-24 已执行，用户授权「0034应用」）**：`0034` 三条索引合计实测 **54,919 行 `rows_written`**（占当日写配额 54.9%，在自留预算 ≤6 万内）；生产侧核对 —— `sqlite_master` 里 `idx_players_sort_%` 共 11 条，三条新索引在 `EXPLAIN QUERY PLAN` 下均为 `SCAN players USING COVERING INDEX`；收益实测（读数落 `scripts/d1-read-audit/measurements-after.json`）：`view=initial&sort=ca` 37,635 → **54**、`sort=uid` → **24**、`sort=ps` → **22** 行/次。worker 已于同日部署上线（Version `a573ade7-b32f-4c85-bbaf-56a07e612281`，2026-09-24T03:37:52Z，Source `Unknown (deployment)`；wrangler 报 `No updated asset files to upload` ⇒ 无运行时代码与产物变化，线上首页资产仍 `index-CpdvAUf3.js` + `index-CgbAjyeh.css`）。清单上还剩 11 个可建索引的键（`base_ca` / `badges` / `growth_gap` / `position` / `growable` / `foot` / `growth_tier` / `future_star` / `china_plan` / `agent_tier` / `fc_id` 一类），按每天最多 3 条继续分批。



## [维护] · 遗留项普查收口（第 0/4/6 节）— 文档订正 + 死代码清理（2026-09-23，**未部署**：无运行时行为变化）

三路深度普查（文档层 / 代码层 / 记忆层）把本仓遗留项按 0–8 节登记；本轮执行其中第 0（过期表述）、4（代码层清理）、6（文档数字漂移）三节。

**文档订正（第 0/6 节）**
- v6.1.0 的「未提交未部署」全部订正为已提交、已推送、已部署：`AGENTS.md`（v6.1.0 bullet 首句、⑩ 部署前置、`npm test` 数字、生产版本链补生效版 `bd467125`）、`ROADMAP.md`（状态行与待办①②）、`CHANGELOG.md`（v6.1.0 节标题与状态段）。
- 数字漂移：`README.md` 迁移 30 → **33**（`0001`…`0033`，含 `0032`/`0033` 于 2026-09-23T09:29Z 同轮 apply）、测试 39 文件 / 539 例 → **50 / 698**、e2e 9 → **11 场景**、生产状态 `627508e5` / 迁移 `0030` → **`bd467125` / `0033`**；密钥补 `TEAM_SYNC_SECRET`、变量补 `TOUR_API_BASE`。
- 「v3.0.0 未部署」残留风险订正：`ROADMAP.md` v3.0.0 台账行与 `scripts/prod-20260920-s9-contracts/README.md` §11.8 首条都改为「2026-09-21 已随 Version `b83ec876` 上线，面板建合同不再落 DDL 默认刻度」。

**代码清理（第 4 节）**
- 删 10 个零引用导出（逐个 `grep -rn "\b名字\b"` 复核，只命中定义行）：`web/src/lib/api.ts` 的 `MeResponse` / `apiPatch` / `ClubDto` / `TransferDetail` / `ReviewDecisionResult`、`web/src/lib/ref.ts` 的 `PlayStyleRow` / `RoleRow`、`src/worker/tourClient.ts` 的 `pushError`（其「出站失败只回报文案不抛」的口径注释移到 `PushResult` 上）、`src/worker/market-settle.ts` 的 `transferTypeFor`、`src/worker/stadium-ops.ts` 的 `FacilityKey`。
- 订正 3 处过期注释：`src/worker/home.ts`（设施扩建/升级已随v2.5.0 落地，见 `src/worker/stadium-ops.ts`）、`src/worker/results.ts`（站内信派发已实现）、`wrangler.jsonc`（cron 逻辑已在 `src/worker/index.ts` 的 `scheduled()` 实现）。`src/db/migrations/0018_home.sql` 的同类过期注释**刻意不动**——该迁移已 apply 到生产，按仓库规矩不得再改。

**验证**：`npm run typecheck`（三份 tsconfig）全清、`npx vitest run` **50 文件 / 698 例全绿**。

## [已上线] · v6.1.0 — 球队与俱乐部双向建档同步（tour + club 两仓）（2026-09-23，本仓 Version `bd467125-2ccb-4516-86b4-f963bdc5fda6` / 赛事仓 Version `02590a8e-f314-4721-a823-147817a5ce17`）

本轮两仓同时改（本仓 `WHL-club-operations-platform` + 赛事仓 `WHL-tournament-management-system`），**两仓均已提交、推送并部署上线**（本仓 4 提交 `be28524` / `ce49e77` / `8379508` / `f250c29`，`origin/main` = `f250c29`；赛事仓 4 提交 `ad80d75` / `588f384` / `1ab678a` / `5f07002`，该仓 `origin/main` = `5f07002`）。部署前两侧都已 `wrangler secret put TEAM_SYNC_SECRET`（同值）；生产实测无签名 `POST /api/internal/team-upsert` 在两个 host 上都回 403 `{"error":"bad_signature","message":"签名校验失败"}` ⇒ 路由在线、密钥在位且 fail-closed 生效（密钥缺失会回 503，故 403 已排除「未配」）。**未验证**：两侧密钥是否同值（无只读 HMAC 端点，唯一验法是一次零写 upsert 探测 = 生产写动作）。

**背景**：球队（`team.id`）与俱乐部（`clubs.id`）本来就是同一个号（游戏内球队编号，两库早前一起 rekey 过），但两边只能各建各的 —— 赛事系统建队不登记俱乐部；本仓建俱乐部又硬性要求「赛事系统里先有这支队」（否则 404「赛事系统里没有这支球队，请先在赛事系统建队」）。谁先建都得手工去另一侧补一次。

**边界调整（v5.0.0 的例外）**：v5.0.0 定下「名册只拉不推」（赛事仓 `worker/lib/clubRoster.ts` 顶部原文），本轮只对**「球队建档」**这一个写动作破例放开对称推送，**名册仍一行都不推**。理由：建档是一次性事件、两侧都可能先发起、且赛事仓读不到本仓库（反向拉不出「本仓有而赛事无」）。赛事仓那段注释已原文保留并补上这次调整的声明。

**新增**
- `src/lib/hmac.ts`：`hmacHex` + `verifyTeamSync`（签名串 `` `POST|${path}|${ts}|${rawBody}` ``、头 `X-Timestamp`/`X-Sign`、HMAC-SHA256 小写 hex、时间窗 ±300s，与认证中心 `machine.ts` 同一口径）。本仓 `src/worker/notify.ts` 原先私有的 `hmacHex` 抽到这里共用。
- `src/worker/tourClient.ts`：`pushTeamToTour`（**永不抛错**，失败回中文口径：未配基址 / 未配密钥 / 对方不可达 / 透传对方 message）。
- `src/worker/routes/internal.ts`：`POST /api/internal/team-upsert`（幂等建档：同 id 已有则 200 `{created:false, nameDiffers}` **不覆写**）。未配密钥 → **503**（写端点 fail-closed，不像 `assertCronKey` 那样「没配就放行」）。
- `src/worker/routes/admin/teamSync.ts`：`GET /api/admin/team-sync` 三段差异（只有赛事有 / 只有本仓有 / 两边名字不同）+ `POST /api/admin/team-sync/apply`（**每次重算 diff 再动手**，防照几分钟前的清单盲写；不匹配当前差异 → 409）。
- 前端 `web/src/pages/admin/ClubsPage.tsx` 新增「球队同步对账」卡片（`web/src/lib/adminQueries.ts` 加 `TEAM_SYNC_KEY` / `fetchTeamSync`）。
- `tests/team-sync.test.ts` 26 例：入站端点（正签建档 + 认证登记 + 审计 actor 留空 / 幂等 nameDiffers / 签名矩阵 错签·缺签·过期·非数字全 403 且不落库 / 换密钥 403 / 未配密钥 503 / 入参校验 400 / 名字被占 409）、公开缓存失效登记、`computeTeamSyncDiff` 纯函数、对账端点、出站 `pushTeamToTour`、**跨仓签名金标准**、**真实风险**各一组。

**变更**
- `src/worker/routes/admin/clubs.ts`：原 `POST /clubs` 的核心抽成导出的 `createClubFromTourTeam()`（名字 ≤40、`leagueTier` 只收 premier/second、id 撞号 409、名字重复 409、审计 `club_create`、`authRegisterTeam` 失败不回滚只置 `authLinked=false`）；`POST /clubs` 改为「赛事系统已有该队 → 原逻辑；没有 → **先推建队，成功再本地建档**；推送失败 → 502 且不建档」。原来的「赛事系统里没有这支球队」404 被自动建队取代。
- `src/worker/env.ts` 加 `TEAM_SYNC_SECRET`；`src/worker/index.ts` 挂 `/api/internal`。
- **`src/lib/cache-policy.ts` 的 `WRITE_SCOPE_PREFIXES` 加 `/api/internal`** —— 否则「建了俱乐部但公开目录最长陈旧 24h」。

**赛事仓侧（tour，权威文档见其 `PRD.md` / `TECH_DESIGN.md` §4.5）**
- 新增 `worker/lib/clubSync.ts`（出站 + 验签）、`worker/lib/teamBulk.ts`（「游戏球队 ID 队名」解析，`NAME_MAX = 40` / `BULK_MAX = 64`）、`worker/routes/internal.ts`（入站端点）。
- `worker/routes/admin/teams.ts`：建队/批量建队改「游戏球队 ID + 队名」并推送（**队名上限 32 → 40** 对齐本仓 `clubs.name`），新增 `POST /:id/sync-club` 重试入口。
- `worker/routes/admin/tournaments.ts`：批量报名同样改「ID + 队名」，**改为按 id 认队**（原先按名字），名字不一致进 `nameMismatch` 报告（登记以库里为准）。
- 前端 `src/pages/AdminTeams.tsx`（游戏球队 ID 输入 + EA 目录软校验：命中显示官方队名、未命中黄字警告但允许建队；同步按钮 + 失败红字）、`src/pages/TournamentManage.tsx`。
- 新增 `shared/fc26Teams.json`（由本仓 `web/assets/ref/team.json` 复制，696 条）+ `shared/fc26Teams.ts`（`fc26TeamName` / `isKnownFc26Team`）。

**验收**
- 本仓 `npm run typecheck` 全清（三个 tsconfig）；`npx vitest run` **50 文件 / 698 例全通过**。
- 赛事仓 `npm run typecheck` 全清；`npx vitest run` **16 文件 204 例通过 + 1 文件 7 例跳过**。
- **跨仓签名金标准**（两仓各一份、逐字同值）：`GOLDEN_SECRET = "increment-37-golden-secret"` / `GOLDEN_TS = 1767225600` / `GOLDEN_RAW = '{"id":700,"name":"Arsenal","operator":1}'` / `GOLDEN_HEX = "1437a305e893ae6c65364c50cc953a178e1edfa38f2f2040ae961966db065d30"`。hex 是 `node:crypto` 独立算出的**死值**（不是用被测代码算的），两侧任一方偷改算法/路径/签名串立刻红；两边还各有「入站接受对面那份金标准签名」的用例证明常量互通。

**已知后果 / 真实风险（已测出并留痕）**
- **推送不可撤销**：从本仓发起时先推、后本地建档；若推送成功而本地名字撞车 409，赛事系统那支队撤不回来，只能靠对账页的「只有赛事有」列出来处理。`tests/team-sync.test.ts` 的「真实风险」describe 钉住了这条可见性。
- 认证中心 `club_id` 已被别的球队占用（`club_taken` 400）**不阻断建档**：`authLinked=false`、俱乐部行照落，管理端可点「重新登记」补。
- 赛事仓 `UNIQUE(org_id, name)`：入站建档前先单查名字占用并 409 点名「队名「X」已被球队 #N 占用」（原 catch 回的是「球队 ID #N 已被占用」，会把本仓操作员带偏）。
- **明确不做**：改名不联动（只在对账页显示 `nameDiffers`）；删队不联动（本仓没有删除端点）；球员名册仍严格只拉；报名、赛果、账目一律不动。

## [已上线] · tour 侧增量 — 赛事仓错误契约收口 + 账号投影对账（tour 单仓，不占本仓版本号）（2026-09-23，Version 9c51052f-a50c-44c8-8078-b318fd7f226b）

本轮**本仓没有任何代码改动**，交付全部落在赛事仓 `WHL-tournament-management-system`（其权威文档是 `PRD.md` / `TECH_DESIGN.md`，后者已随本轮补 §4.2 与 §8）；本节进本仓 CHANGELOG 是因为当时沿用「全项目共享增量号」旧规则（该规则已于 2026-09-25 废止，改用各仓语义化版本 ⇒ 本仓不为这一轮分配版本号，正文一律称它「tour 侧增量」）。赛事仓 2 个提交（`7f4d69a` 代码 + `952f470` 文档）**已 push**（`dee2292..952f470`），连同 v5.0.0 的 4 个提交一并补齐，该仓 `origin/main` = `952f470`。部署：`9c51052f-…`，2026-09-23T13:02:42Z，Source `wrangler`，`Total Upload: 582.96 KiB / gzip: 133.33 KiB`。

**编号**：赛事仓那轮代码注释原写「34」，而 34（apex 域名收口）与 35（显示名与球衣号落库）当日已被本仓占用 ⇒ 当时在共享序列下回填为「36」（改 6 处标签：`worker/index.ts`、`worker/routes/oidc.ts`、`tests/oidc.test.ts`）。

**修复**
- **账号投影（`FOREIGN KEY constraint failed` 致 500 的根因）**：账号真源收口认证中心后赛事库 `user` 表没有写入方，而 14 列外键仍指向 `user(id)`（`tactic.created_by` / `match_event.created_by` / `audit_log.actor_user_id` …）⇒ 新账号「登录一切正常，写存档或报分才 500」。新增 `worker/lib/accountMirror.ts`：`mirrorAccountStmt` 是 `INSERT INTO user (id, name, password_hash, role, locked, created_at) VALUES (?, ?, ?, 'coach', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, locked = excluded.locked, created_at = excluded.created_at`（**`role` 与 `password_hash` 绝不进 updater**，口令写哨兵值 `"!oidc-no-password"`）；`runAccountMirror` 为整点对账入口，只补行与改名、**不删行**。`worker/routes/oidc.ts` 的 callback 把账号投影与 `INSERT INTO oidc_session` 放进同一批 `c.env.DB.batch([...])`（否则症状是「登录成功但一写就撞外键」）。
- **未捕获异常一律回 JSON**：`worker/index.ts` 新增 `app.onError`，回 `c.json({ error: "internal", message: "服务异常，请稍后重试" }, 500)` 并留日志。Hono 默认输出 `text/plain` 的 `Internal Server Error`，前端 `res.json()` 解析失败、只剩一句「请求失败（500）」，报错无明细（2026-09-23 那次只能反查 D1 才定位到外键）。
- **错误文案收口**：`src/api.ts` 新增 `fallbackMessage(status)`（≥500「服务暂时不可用（N），请稍后重试」/ 404「内容不存在或已被删除」/ 401「登录已过期，请重新登录」/ 403「没有权限执行此操作」/ 其余「请求失败（N）」），并把 `TypeError` 转成「网络异常，请检查网络后重试」（WebKit 报 `Load failed`、Chromium 报 `Failed to fetch`，原样抛会把英文糊上界面）；worker 侧统一 `{ error, message }` 形状（`portal.ts`「该比赛暂无战报（仅完赛场自动成文）」「该轮暂无综述」「轮次参数不合法」、`interact.ts`「比赛 id 不合法」、`admin/announcements.ts` 三个 code + 中文 message），19 个页面与组件消费。

**新增**
- `scripts/oidc-user-mirror/20260923-backfill-user-13-17.sql`（幂等 `ON CONFLICT(id) DO NOTHING`）；**实测未执行** —— 整点对账已自行补齐 user 13–17，回填 SQL 已无操作对象，留着当恢复路径。
- `tests/oidc.test.ts` 3 例：登录回调把账号投影进本库 user 表 / 定时对账补没登录过的账号并同步改名与注册时间且不删行 / 未捕获异常 500 回 JSON 且日志留方法与路径。

**验收**
- 赛事仓 `npm run typecheck` 全清；`npx vitest run` **15 文件 / 147 例通过 + 1 文件 7 例跳过**（`tests/admin.live.test.ts` 属基线；v5.0.0 评审后基线 15/144 ⇒ +3 例）；`npm run build` 成功（`dist/assets/index-CR7ktr7d.js` 444.71 kB / gzip 144.17 kB、`index-C4fgwNax.css` 69.80 kB）；`wrangler d1 migrations list whl --remote` ⇒ `✅ No migrations to apply!`。
- 部署后回读：`/api/health` 200、`/api/public/announcement` 200、`/api/public/weekly` 200（`weekStart 2026-09-21` / `played 7` / `goals 20`）；`/api/public/matches/999999/report` ⇒ 404 `{"error":"not_found","message":"该比赛暂无战报（仅完赛场自动成文）"}`、`/api/public/tournaments/999/round/999/1` ⇒ 404 `{"error":"not_found","message":"该轮暂无综述"}` ⇒ 新错误契约在线；线上 `index-CR7ktr7d.js` 内含三条新前端文案。
- 名册同步已实际开跑：赛事库 `whl.player` 实测 `{"total":570,"with_number":570,"distinct_num":71}`，`id 20801 = Cristiano Ronaldo / team 45 / #7`（旧 id 241/243 已因v5.0.0 rekey 不存在）⇒ 赛事库是从本仓拉回显示名与 s901 号码的下游镜像。

**已知后果**
- ~~赛事仓 6 个提交未 push~~ —— **已订正**：2026-09-23 已 push（`dee2292..952f470`）。口径更新：用户同日明确「部署推送都得一块啊」，此后「部署」即同时授权该仓 push。
- 赛事仓当日 **08:37:07Z（`71de6d01-…`）与 08:47:45Z（`49563d64-…`）已部署过两次** ⇒ v5.0.0 + 本轮代码在本地提交之前就已上线（这也是整点 cron 覆盖赛事库号码成立的前提）。
- 门户路由挂在 `/api/public`（`worker/index.ts:32` 的 `app.route("/api/public", portalRoutes)`），**不是 `/api/portal`**；`wrangler deployments list` 列的 id 是 deployment id 而非 version id（版本要读 JSON 的 `versions[].version_id`）。

## [已上线] · v6.0.0 — 显示名与球衣号落库：号码真源迁到 FC26 存档表（s901）+ D1 写通道整改（2026-09-23，Version 835031b5-1ddb-428e-9805-01ce3cc9a3c5）

本轮**没有任何 `src/` 或 `web/src/` 代码改动**（表结构与读端点早在v4.0.0/v5.0.1 上线），改动集中在 `scripts/player-names/` 两个脚本与文档；生产数据落库已执行并生效（不经 HTTP 写路径，早于部署即对用户可见）。`scripts/` 与文档已推送（`3f33aab..d4dcf34`）并随 Version `835031b5-…`（2026-09-23T12:12:42Z）部署上线，线上下发的 Worker 与资产同上一版（wrangler 报 `No updated asset files to upload`）。

**修复**
- **生产 `players` 五列落库**：`scripts/player-names/load.mjs --remote --yes-prod --numbers --purge` 执行 46 条语句（`display_name.sql` 44 条 / `number.sql` 2 条）全部成功、无重试。落库前 `display_name`/`first_name`/`number` 计数全 0，落库后 `total 18301 / display_name 17470 / first_name 17329 / last_name 17099 / common_name 2549 / number 570`。
- **缓存失效（`load.mjs` 新增 `--purge`）**：读 `cache:epoch:public` 现值 +1 写回（实测 **1 → 2**）。这一步不是可选项 —— 脚本直写 D1 不走 HTTP，`src/worker/index.ts:25-42` 的 purge 中间件（判据「非 GET/HEAD + 响应 2xx + 路径命中 `WRITE_SCOPE_PREFIXES`」）不触发，而分级 TTL 是 players 1h / roster 24h / clubs 24h，不 bump 代际键则公开读最长 24h 才看到新值；代际键带版本号（`src/lib/guard.ts:105`），bump 一次 L1 + L2 同时作废。
- **号码真源从赛事库改到 FC26 存档表（s901）**：`derive.mjs` 不再读 `whl.player`。原因见「已知后果」——赛事仓的名册同步按「姓名、号码一律以 club 为准」写库，`/api/squads` 于 2026-09-23T09:29:30Z 首次上线后，下一个整点 cron 用我方当时的**空号码**覆盖了赛事库 `player` 的 570 个号码（`name` 同时被换成我方缩写名，570/570 逐字相同即证据；D1 时间点回读不可用，只能靠外部副本恢复）。
- **`derive.mjs --refresh` 在本机崩溃**：`Error: spawnSync npx.cmd EINVAL`（errno -4071，Node v24.12.0），与v4.0.0 评审在 `load.mjs` 修掉的是同一类 bug（当时只修了 `load.mjs`）⇒ 改用 `execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', …])` 跑 `node_modules/wrangler/bin/wrangler.js`。

**新增**
- 号码派生源 `E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901/splitted`：20 个 xlsx（一队一份，文件名 `<FC26 club_id> - <队名>.xlsx`，表体只有两列无表头：球衣号 + 全名），实测 570 人 / 20 队 / 号码空行 0 / 队内重号 0，与赛事仓 Sep16 独立副本 `players-dump.json` 姓名号码 **570/570 一致**。`readS901()` 用 `xlsx@^0.18.5` 读表；文件名不合规或号码为空一律 `exit 2`。
- 认人四级阶梯（每级只认唯一命中，`claimed` Set 防重复占用）：逐字相同 → 归一化相同 → 同队同姓唯一 → 队内唯一余量。实测 **565 / 3 / 2 / 0**，逐队人数对账 `clubCountMismatch = 0`。
- `load.mjs` 的每条语句失败自动重试 3 次（`sleep(2000)`）+ `cleanForCommand()` 注释行清洗 + `MAX_SQL_CHARS = 30_000` 上限保护。

**变更**
- **D1 写通道由 `--file` 改为 `--command`**：`--file` 走 D1 异步 import 端点，对**合法** SQL 间歇性报假错（已见 `{"D1_RESET_DO":true}`、《SQL code did not contain a statement. [code: 7500]》、`syntax error` 且 offset 比文件本身还长、`X [ERROR] {` 截断），同一条语句隔 30 秒重跑就 `success:true / rows_written:400`；`WRANGLER_LOG_SANITIZE=false` 抓到的请求体完整无误，换随机文件名与 md5 去重无关。`--command` 走同步 /query 端点。
- `derive.mjs` 的 `BATCH` 由 1000 降到 **400**（每批约 22KB，要塞进 Windows 命令行）。
- `derive.mjs` 的 `REMOTE` 删掉 `tour-players`（db `whl`）与 `team-map`（db `whl-auth`），只剩 `players`（db `whl-club`）；审计 CSV 表头 `tour_name,tour_number` → `s901_name,s901_number`。
- `scripts/player-names/README.md` 整篇重写：数据源表加 s901（标注**球衣号真源**）、记「赛事系统 `whl.player` 不再是号码来源」、球衣号四级阶梯、生产落库计数与回读结果、`--purge` 的存在理由、踩坑清单由两条扩到四条。

**验收**
- 预检 `--dry-run --numbers --purge` ⇒ `44 条 / 最大 22645 B` + `2 条 / 最大 7062 B` = **46 条 / 977642 B**；只给 `--remote` ⇒ `拒绝执行：写生产必须同时给 --remote --yes-prod。`；`derive.mjs` 退出码 0。
- 落库 ⇒ `完成 46/46` + `公开缓存版本号 1 → 2`，exit 0；KV 复核 = `2`。
- 点查 fc 20801 ⇒ `Cristiano Ronaldo` / `C. Ronaldo` / `dos Santos Aveiro` / `Cristiano Ronaldo` / `7`；五例同人异名落库正确（200104 `Heung Min Son`#7、226456 `Pablo Fornals`#12、264432 `Abdessamad Ezzalzouli`#15、264846 `Mosquera`#4、276048 `Matias Fernandez-Pardo`#27）。
- 独立复算（按行解析生成 SQL 的 VALUES、处理 `''` 转义）：17,470 数据行、fn 17,329 / ln 17,099 / cn 2,548 / dn 17,470 非 NULL、重复 fc 0；号码侧 570/570 s901 行在 `number.sql` 中都有「同 club_id 且持有该号码」的人，异常 0。
- 公开回读：`GET /api/squads` ⇒ 200 / 30,983 B，20 队 570 人、`number !== null` **570**；`GET /api/players?limit=2` ⇒ 200，含 `name:'Erling Haaland'` + `officialName:'E. Haaland'`（列表小字有真值）。
- 回归：`npm run typecheck` 三份全清；`npx vitest run` **49 文件 / 667 例全绿**，与v5.0.1 基线逐项一致（本轮无 `src`/`web` 改动）。

**已知后果**
- **赛事库自此只是下游镜像**：赛事仓 cron（**已于tour 侧增量 开跑**，实测赛事库 `whl.player` 570/570 已具号码）会把 `/api/squads` 的显示名与号码写回 `whl.player`（方向正确，但本仓是唯一真源，赛事库任何本地改动都会被下一次整点覆写）。
- 831 人回落官方缩写名（FC26 后期补丁新增 `nameid > 41,189`，本机字典没有），本轮未动。
- 两处口径差无影响：`out/display-names.csv` 的 first_name/last_name 非空数（17,897 / 17,198）比落库多（这两列只有 CSV 审计快照在写，全仓无代码读它们，`grep` 只命中 `src/core/player-name.ts:5` 注释）；`common_name` 落库 2,549 比 SQL 多 1 行（那行库里本来就有值，`COALESCE` 按设计不覆盖）。
- `data/tour-players.json` 缓存已被 `--refresh` 覆盖成空号码版本，不再能当交叉校验源。

## [已上线] · v5.0.1 — apex 域名收口（排名代理 530 根因）+ 边缘 504 归因（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

3 个提交（`9506d00` / `ea6d717` / `5ae73e8`）已推送（`2ad239b..5ae73e8`）并部署，**同轮把v4.0.0/v5.0.0 一起带上线**；**生产迁移 0032/0033 同轮 apply**（用户裁决「先 apply 0032+0033 再整条部署」）。

**修复**
- `whleague.win`（主域 apex）不部署任何服务、DNS 也无 A 记录（`nslookup -type=A` 对 8.8.8.8 / 223.5.5.5 / 1.1.1.1 均无答案，`curl` 返回 000），赛事系统正确入口是 `tour.whleague.win`。三处生效引用改 tour 子域：`wrangler.jsonc` 的 `TOUR_API_BASE`、`web/src/lib/api.ts:70` 的 `TOUR_SITE_URL`（6 处外链：`TopBar.tsx:92` / `RequireUser.tsx:27` / `admin/AdminLayout.tsx:45` / `Home.tsx:24`、`:42`、`:81`）、`src/worker/routes/auth.ts:35` 的 `TOUR_HOME`（用在 `:52`/`:83`/`:274`，生产 `AUTH_MODE=oidc` 暂不可达）。
- **生产 5xx 根因**：`TOUR_API_BASE` 配 apex 时，`src/worker/routes/clubs.ts:574-575` 每次都请求 `https://whleague.win/api/public/tournaments/<id>/standings` 并必然 **530**（CF 分析 24h 内 `/2/standings` 17 次、`/1/standings` 15 次）。因 `clubs.ts:604` 只在变量**缺失**时优雅降级（返回「排名暂不可用」），配了死地址反而每次真发请求、每次都失败 ⇒ 球队详情页排名区块永久不可用而其余区块正常，长期不显形。
- 同步 `tests/oidc.test.ts:231`/`:240` 断言与 `src/worker/env.ts:27-29` 注释。

**新增**
- `tests/domains.test.ts`（6 例）域名回归锁：四例锁三个常量（非 apex 且是 `whleague.win` 子域）、一例全仓扫描（`src` + `web/src` + `tests` + `wrangler.jsonc` + `web/index.html`，零排除项）、一例锁 `src/lib/oidc.ts` 不出现真正的 `Domain=` 赋值且 `OIDC_*COOKIE` 都以 `__Host-` 开头。判据 `EFFECTIVE_APEX = /https:\/\/whleague\.win(?![a-z0-9.-])/` 不误伤子域与注释里的裸 apex；本文件自己用 `APEX_URL` 拼接、无连续 apex 字面量，故全仓扫描无需排除自身。

**不改（含理由）**
- `src/lib/oidc.ts:6` 注释里的 `Domain=whleague.win`：cookie 域属性、跨子域共享会话的前提，apex 在此正确（两个 cookie 都是 `__Host-` 前缀，本身不许设 Domain）。
- 赛事仓 `WHL-tournament-management-system/worker/routes/oidc.ts:36` 注释仍写「线上 whleague.win」（实际 tour 子域）：超本仓范围，只报不改。

**边缘 504 归因（结论：不改代码）**：CF 分析 24h 的 `cache.whl-club.internal` 79 次与 `club.whleague.win` 30 次**都不是用户请求**，而是边缘 Cache API 自身的操作记录 —— 前者 host 由 `src/lib/guard.ts:158` 的 `L2_ORIGIN` 合成（无 route、无 DNS，路径即 `l2Key` 输出格式），后者只是键改用真实 URL（`src/worker/routes/media.ts:43`/`:56` 用 `c.req.url`）。这解释了 504 名单按 host 精确二分（club 侧清一色 `/api/media/*`，零 `/api/clubs*` 与 `/api/players*`）。已排除媒体文件缺失（两个 504 样本 URL 在两个 host 上都 200）。**判定：不需要动 `src/lib/cache-policy.ts` 或 `cachedJson`**（standing 300s 是全站最短 TTL、也是它在 `.internal` 占多数的原因，5 分钟是排名产品语义）。登记两处潜伏风险不改：冷回填 `await l2Put` 在响应关键路径（`guard.ts:248`，media 侧已挪进 `waitUntil`）、`l2Match`/`l2Put`/`caches.default.match`/R2 `get`/`arrayBuffer` 全无超时。

**验收**：`npm run typecheck` 三份全清；`npx vitest run` **49 文件 / 667 例全绿**（v5.0.0 基线 48/661 ⇒ +1 文件 / +6 例）；`npm run build` 成功（`index-C6eShBli.js` + `index-CgbAjyeh.css`）；dist 扫描无 apex。变异验证：三个常量各自改回 apex ⇒ 每次**恰好 2 例红**。上线核对：`tour.whleague.win/api/public/tournaments/{1,2}/standings` 均 **200**（3403B / 7131B）、`whleague.win` 仍 000、`/api/health` / `/api/clubs` / `/api/squads` / `/api/players?view=initial` / `/api/players/roster` 全 200、`/api/clubs/1` 与 `/api/clubs/1/standing` 匿名 401、线上资产与本地 dist 逐字一致、线上 JS 内域名只剩 `guess.whleague.win` 与 `tour.whleague.win`。**未验证**：`/api/clubs/:id/standing` 端到端（需登录会话，匿名 401）；CF 分析 530 归零需按 24h 窗口在面板观察。

**已知后果**：~~生产 `players.display_name` 仍全 NULL（落库脚本未跑）⇒ 显示名与球衣号对用户仍不可见（回落缩写名）~~ —— **已在v6.0.0 订正**：生产落库已执行（17,470 显示名 / 570 号码），`/api/squads` 与 `/api/players` 回读已出真值；~~赛事仓未部署 ⇒ `/api/squads` 已上线但赛事侧名册同步尚未开跑~~ —— **已在tour 侧增量 订正**（赛事仓 2026-09-23 部署，整点名册同步已开跑）。

## [已上线] · v5.0.0 — 名册真源归位：全平台一线队名册端点 + 赛事平台拉取同步 + 球员写入口下线（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

本仓 2 个提交（`aed2f67` + 评审 `d84371d`）+ 赛事仓 2 个提交（`ffcbc40` + 评审 `728f523`）。**本仓部分已于 2026-09-23 随v5.0.1 一并推送并部署**（`/api/squads` 生产实测 200 / 29670B）；**赛事仓部分已于 2026-09-23 部署（tour 侧增量；当日 08:37Z / 08:47Z 两次 + 13:02Z 一次）**，名册同步 cron 已开跑（赛事库 `whl.player` 570/570 具号码）。v4.0.0 把球衣号编辑入口搬回本平台后，赛事系统的 `player` 表成了第二份真源（两个写者互相覆盖），本增量把名册真源收到本平台并关掉赛事侧的写路径。

**新增**
- 端点 `GET /api/squads`（`src/worker/routes/squads.ts`）：一次 JOIN 出 20 队 570 人的一线队名册，返回 `{ squads: [{ clubId, clubName, players: [{ fcId, name, number }] }] }`。公开只读，`assertPublicRate` + `cachedJson`（roster scope，24h）；姓名走 `sqlDisplayName()`，`ORDER BY c.name, p.fc_id` 后 JS 线性归并，不做 N+1。
- 赛事仓 `worker/lib/clubRoster.ts`：`fetchClubSquads` / `syncRosters`（三方对账，以 fcId 当 `player.id`）/ `runRosterSync`（cron 入口，失败只记日志不抛）。
- 赛事仓端点 `POST /api/admin/sync-rosters`（`?dryRun=1` 只算不写，非 dryRun 写审计）；`wrangler.jsonc` 加 `triggers.crons = ["0 * * * *"]` 与 `vars.CLUB_API_BASE`（撤掉该行 = 同步整体跳过，即回滚开关）。

**变更**
- **赛事系统球员表转为只读镜像**：`POST /:id/players`、`POST /:id/players/bulk`、`PATCH /:id/players/:pid`、`DELETE /:id/players/:pid` 四个端点删除，`TeamDetail.tsx` 的录入 / 批量导入 / 改名 / 删除 UI 换成只读名单表；队级端点（建队 / 批量建队 / 改名 / 删队 / 队徽）保留。
- 赛事仓同步的三条防御：空快照整体跳过；形状坏抛错不写库；只对快照里出现过的队做删除（一次拉取失败不会清空别队名单）。外键拒绝的删除进 `kept` 报告保留（有比赛事件 / 伤停引用的球员不能删）。

**评审修复（`d84371d` / `728f523`）**
- 本仓 `tests/squads.test.ts` 种子行序改成两队 id 交替 + status 交替：原种子恰好是「插入序 = 期望输出序」，把 `ORDER BY c.name, p.fc_id` 删掉测试照样绿，而归并是「相邻行同 club_id 才并组」、正确性全押在那条 ORDER BY 上。改后删 ORDER BY 或删尾列都能定向变红。
- 赛事仓 `fetchClubSquads` 补 `AbortSignal.timeout(10_000)`（原来没有 signal，对方挂住时 cron 的 catch 永不执行、一行日志都没有）；快照里某队 `players: []` 直接抛错（原来只挡 `squads.length === 0`，挡不住「快照非空但某队名单空」，该队会被当 stale 整队删光）。各补一条测试并变异验证定向变红。

**验收**：本仓 typecheck 三份全清、vitest **48 文件 / 661 例全绿**（v4.0.0 基线 47/659）、build 产物 `index-Bco7kOHW.js` 与v4.0.0 逐字同 hash（只加后端路由）、e2e **11/11**；赛事仓 typecheck 全清、vitest **15 文件 / 144 例通过 + 1 文件跳过**（基线 14/121，评审后 142→144）、build 成功。读量实测走 `idx_players_status` 点查（无 `SCAN p`，约 570 行）。变异验证四处定向变红（空快照守卫、未知队过滤、ORDER BY 整条 / 尾列、拉取超时信号）。

**已知后果（评审查出，本轮不改）**：没有一线队球员的俱乐部整个从 `squads` 数组消失（赛事仓只对快照里出现过的队做删除 ⇒ 被清空的队会留陈旧镜像行，失败方向是保留而非丢数据）；赛事仓自动删除球员后 `tactic.roster_json` / `tactic_submission.assign_json` 会留悬挂 id（JSON 无外键，教练下次保存战术会撞 400，手工删除时代同样存在）；伤停的 CASCADE 实际不可达（伤停必挂 `match_event`，而 `match_event.player_id` 是 NO ACTION ⇒ 删除会失败行进 `kept`）。

## [已上线] · v4.0.0 — 球员名口径改造：FC26 派生显示名 + 球衣号归属转移 + 档案页按 fc_id 寻址（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

用户 m01803「开工」，任务 = 球员名口径改造（显示名取自 FC26 存档）+ 球衣号归属从赛事平台转回本平台 + 球员档案页 URL 改 fc_id + 两系统阵容同步 + D1 读额度优化。8 个提交（`c07c18a` / `54a98ef` / `341c7cd` / `e2d81ed` / `097cd34` / `6135bbc` / `770875b` / `0e6a524`）。**代码已于 2026-09-23 随v5.0.1 一并推送并部署，生产迁移 0032/0033 同轮 apply**（apply 后实测：新增列 5、`idx_players_sort_name` 存在、`display_name` 非空 0 / 总行 18301）；**生产数据落库（`scripts/player-names/load.mjs --remote --yes-prod`）仍未执行** ⇒ 显示名与球衣号功能对用户暂不可见（`COALESCE(display_name, name)` 回落缩写名）。跨仓部分（赛事平台转只读 + 阵容同步）另立v5.0.0。

**新增**
- 迁移 `0032_players_display_name_number.sql`：`players` 加 `first_name` / `last_name` / `common_name` / `display_name` / `number` 五列（全 TEXT）。`players.name` 语义不变（仍是 FC26db 官方缩写名，导入对齐键仍是 fc_id）。
- 迁移 `0033_players_name_sort_index.sql`：`idx_players_sort_name` 姓名排序表达式索引（排序键换成折叠的显示名后同源重建）。
- `scripts/player-names/`：`derive.mjs`（从 FC26 存档 `base_players.csv` + `playernames.txt` + `cards.csv` 派生显示名与球衣号，产出落库 SQL + 审计 CSV）、`load.mjs`（逐条语句写 D1，`--dry-run` / `--local` / `--remote --yes-prod`）、`README.md`。
- 端点 `POST /api/club/players/:id/number`：教练给本队球员定号 / 改号 / 清号（整数 1–99、同俱乐部不重复、写审计）。球衣号数据源由赛事平台 `player.number` 转来（570/570 按 fc_id 归属、归属不一致 0）。
- 前端 `web/src/lib/player-link.ts` 的 `playerPath()`；`src/core/player-name.ts` 的 `sqlDisplayName()` / `rowDisplayName()`；`src/worker/player-ref.ts` 的 `firstPlayerByRef()`。

**变更**
- **球员名显示口径**：所有面向前端的球员名字段改为 FC26 派生的显示名（`COALESCE(display_name, name)`）。派生规则 = `commonname 原样 || 名+姓 || cards.csv 完整人名（矛盾则弃用） || 空回落 players.name`。18,301 人派生成功 17,470（commonname 2,548 / 名+姓 14,527 / cards 兜底 395），**570 名俱乐部球员全部有显示名**。列表行同时出 `officialName`（官方缩写名），前端在两者不同时出小字。
- **姓名搜索改双列 OR**（显示名 + `players.name`，同一 pattern 推两次）：只看显示名则按姓搜不到几百个单词显示名的人（`Ederson`/`Isaac`），只看 `name` 则 `Erling Haaland` 搜不到。
- **球员档案页 URL 改 fc_id**：`GET /players/:id` 与 `/transfers`、`/growth` 先按 `fc_id = ?` 点查、未命中回落内部 `id`（fc_id 空间 19541–279948 与内部 id 1–18301 零重叠，两次都是唯一索引点查）；前端链接统一走 `playerPath()`，旧 id URL 自动 replace 成规范地址。写端点仍只收内部 id。
- **阵容表加只读号码列**；合同页签恒有「球衣号」行（仅本队教练可改）；谈判成约后弹「给新援定号」（可跳过）。
- **比赛结果归属改按 fc_id 认人**：原先靠 `club_id + name` 等值匹配，而赛事平台存完整人名、本库存官方缩写名 ⇒ 两侧写法不同的人会漏；现在先 `WHERE fc_id = ?`（不按 club_id 过滤，转会后旧比赛仍算他的成长），姓名只作回落。

**修复**
- 换队与解约清空球衣号（球衣号属于俱乐部，留着旧号会让「同队不重复」在两个队之间打架）；合同导入的认领 UPDATE 同样清。
- **落库脚本三处跑不通**（评审发现，均实测确认）：`derive.mjs` 产出 `BEGIN;`/`COMMIT;` 而 D1 拒收 SQL 事务控制语句 ⇒ 一条都落不了库（已去掉事务控制，并说明每条语句按 fc_id 独立更新、可整体重跑）；`number.sql` 的 CTE 列数不匹配（声明 6 列只给 2 值）；`load.mjs` 用 `spawnSync('npx.cmd')` 在 Node 24 / Windows 上直接 `EINVAL`（改用 `process.execPath` 跑 `node_modules/wrangler/bin/wrangler.js`）。另修 `load.mjs` 语句计数器（原先传对象、永远 0）并加事务控制语句守卫。

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **47 文件 / 659 例全绿**（v3.4.0 基线 46/642）；`npm run build` 成功（`index-Bco7kOHW.js` 477.77 kB / gzip 150.38 kB）；`npm run test:e2e` **11/11 通过**。变异验证四处定向变红（索引表达式错一字符退化 `TEMP B-TREE`、`fc_id` 归属加 `AND 0`、两处 `number = NULL` 删除、链接回落顺序反转）。落库链路本地端到端跑通且幂等（19 条语句，fc 20801 落成 `Cristiano Ronaldo` / `7`）。

## [已上线] · v3.4.0 — 球队页：公开列表 + 登录详情 + 自家队中心合并 + 只读媒体路由（2026-09-22）

用户 m12793 下达「新增球队页（列表 + 详情）」，并特别要求注意性能、省 D1 额度。17 个提交（`70dc811` / `545ad90` / `e0411de` / `5dbfe41` / `a84c748` / `779ee6b` / `5b90031` / `32068be` / `00092b4` / `57e68a6` / `829063f` / `aa0aea2` / `50e69f5` / `6464d0b` / `5f7c3d6` / `d759b86` / `2ad239b`），**已推送（`466df81..d759b86` 16 个 + `d759b86..2ad239b` 1 个）并部署上线**（生产 Version `7a178d81-dccc-4696-a7d7-7d8c61eaa683` → `64020454-405c-479a-9a62-8197444f4f52` / `adb3a5ae-dbc5-4648-bf62-383e1108923d`）。**本增量零迁移**（计划中的 `0032` 部分索引在步骤 1 实测后被裁掉），故推送无生产 DDL 耦合；生产迁移仍到 0031。

**新增**
- 端点 `GET /api/clubs`（公开）：一次算完 20 队，固定 4 条 whl-club 语句 + AUTH_DB/TOUR_DB 各 1~2 条，**无逐队查询**；clubs scope 缓存 24h + `assertPublicRate`。响应 `{ clubs: [{ id, name, isCpu, tier, logoKey, squad:{senior,trainee}, avgCa, totalValue, totalWage }] }`。
- 端点 `GET /api/clubs/:id`（需登录）+ `GET /api/clubs/:id/standing`（排名代理）：队头 / 阵容结构 / 合同结构 / 转会往来 / 近期战绩；阵容一条语句取全队后在 JS 里算三个维度分布，避免三条 GROUP BY。
- 端点 `GET /api/media/*`（公开）：镜像比赛系统的媒体路由，**只读不写、不碰任何 D1**，是球队页里唯一的零 D1 读面。key 白名单 `/^(team|tournament)\/\d+\//`、边缘缓存命中即返、`immutable` + ETag。
- 前端页面 `web/src/pages/Clubs.tsx`（公开，按顶级/次级/未定级三段卡片）、`web/src/pages/ClubDetail.tsx`（阵容组 / 运营组 / 战绩组，三组结构分析全用 **CSS 自绘图表**，不引图表库）、组件 `web/src/components/TeamLogo.tsx`（有 logoKey 出 `<img>`，否则按队名哈希出首字色块）。
- 入口四处：顶栏「球队」页签、首页 nav-card、球员库归属球队列、球员档案页眉队名；市场页卖方名与出价方名也链到 `/clubs/:id`。

**变更**
- `/club` 从「我的球队中心」页改为**重定向壳**：在途给加载态、未绑定去 `/bind`、已绑定去 `/clubs/<我的队>`。原 897 行内容整体搬进 `web/src/pages/club/CoachPanel.tsx`，只在详情页里、且登录者正是本队教练时渲染。搬迁中故意去掉的只有三处：页面外壳（container + h1）、`!overview?.club` 分支（改 `return null`）、`club-head` 里的队名与分级徽章（详情页页头已给）。
- 球队页 URL 的 id 一律是**平台库 `clubs.id`**（裁决 Q17，已写进 `AGENTS.md`）。
- **详情页结构分析按用户裁决整改**（步骤 11a，用户 m14999 批准；配色只用站点既有调色板变量，不新造颜色）：位置分布改**门将/后卫/中场/前锋四档纯文字**（原 `GK CB CM ST` 是错的，且按裁决不用图示），档内给细位明细；年龄结构改**等宽 3 岁箱 + 竖直直方图**（`≤18 / 19–21 / 22–24 / 25–27 / 28–30 / ≥31`，代价已知：当季 `age_cap` 不再是档界）；CA 结构改 **`90+ / 85–89 / 80–84 / 70–79 / <70` 横向占比条**（分母是全队人数而非各档之和，带 0–100% 刻度轴与行尾人数）；三组指标区由等权 10 格网格改为「**三格主指标 + 一行语义明细**」（能力 / 资产 / 荣誉）。效力年限保持原普通升序横向柱状图。
- **详情页结构分析的样式整改**（步骤 11b，用户 m15308/m15319；用户明确「不是换展示项目，是样式上太割裂」⇒ 只改样式、不增删数据项）：主指标与明细行收进同一块 `.club-summary`（淡奶油底 + 一道左侧焦橙竖线，**去掉逐格竖线与明细行顶部分割线**——那正是「小字与上方割裂」的来源）；年龄直方图去掉 `max-width: 460px` 并把轨道高由 72px 提到 **128px**（原 460×72 是 6.4:1 扁条，现约 370×128 = 2.9:1）；CA 由「逐档横条」改为**一根 100% 堆叠条 + 0–100% 刻度轴 + 逐档图例**（段色是同一 `--terracotta` 的深浅阶梯，**颜色仍只来自 CSS**，只渲染非零档）；阵容组三张图进 `.club-figures` 宽屏三列铺满卡片、运营组用 `.club-split`（左 summary / 右效力年限图，900px 折一列），消掉右侧大片空白。顺带修两处实测缺陷：`.band-label` 宽 4.5em → 6.5em + `nowrap`（「3 赛季及以上」原会折两行）、0 人档不再渲染 `.band-bar`（`min-width: 2px` 会把 0 读成「有一点」，与直方图 0 人不出柱同口径）。

**修复**
- **CSS 类名冲突污染球员档案页**（评审发现）：本增量新追加的 `.pos-chip` 与 `web/src/pages/Player.tsx:568` 在用的 `.pos-chip-main` 同特异性且位置更晚，覆盖其 `background:var(--ink)` 而 `color:var(--paper)` 仍生效，**球员页第一个位置徽章变浅底浅字不可读**。修法是新增类一律带 `club-` 前缀。
- **`/club` 重定向把「请求失败」当成「未绑定」**（评审发现）：`useMyClub` 在 `isError` 时 `club: null`，而全局 `retry: false` ⇒ 一次失败即终态，会把绑着队的教练送去写着「一账号只能绑一支队」的 `/bind`。修法是 `MyClubState` 新增 `failed`，壳在该状态下留在原地报错。
- 订正两处**错误注释**：`src/worker/routes/clubs.ts` 与 `src/worker/home.ts` 里原先写「`clubFormPts` 绑 club id 才恒不命中」——生产实测证伪（见下）。
- **「总身价」全站显示 `0.00 m`**（部署后最小化回读抓到）：`GET /api/clubs` 20 队 `totalValue` 全 0。根因是 `players.market_value` 生产 18,301 行**全 NULL**（该列属运营列，`src/core/import.ts:3` 明写导入「绝不触碰运营列（status/contracts/badges/growth/market_value/agent_tier）」，只有 admin PATCH 会写），而 `CLUB_SQUAD_AGG_SQL` 写的是 `SUM(COALESCE(p.market_value, 0))`，把「没人录过」压成 0 这个具体的假话。修法：聚合改 `SUM(p.market_value)`（全 NULL 时 SUM 出 NULL）、`totalValue` 类型改 `number | null`、前端 `money(null)` 回 `—`（与球员库 `web/src/pages/PlayersLibrary.tsx:58` 同口径）；**`totalWage` 口径不变**（CPU 队无合同 ⇒ 0 是真话）。提交 `2ad239b`，重新部署后生产复验 20 队全部 `null`。

**结论（步骤 9，只读核对，不改代码行为）**
- `result_confirmations.home_team_id / away_team_id` 存的是**比赛系统队 id**（迁移 0017），而 `clubFormPts` 绑的是 club id，语义上确实是两套 id。
- 但生产实测（2026-09-22）AUTH_DB `team` 表 20 行**逐队 `club_id` = `tour_team_id`**，`result_confirmations` 69 行的队 id 全落在这 20 个值内且 20 队各有 6–7 条已确认赛果 ⇒ 函数**算得出真值**，此前「命中恒 0 ⇒ 战绩系数恒 1.0」的结论**是错的**。
- 定性为**潜伏缺陷，非现行故障**：米兰的 `tour_team_id` 曾长期是 legacy 47 而 `club_id` 是 131681，直到 2026-09-19 rekey 才统一，那段时间本函数对米兰恒返中性 4。将来若新增 club 的 id 不等于其 tour 队 id，本函数会静默退化成「永远中性」。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **46 文件 / 642 例全绿**（v3.3.0 基线 40/573）；`npm run build` 成功（`web/dist/assets/index-C7pOcE6p.js` 474.57 kB / gzip 149.44 kB、`index-BT5YAIcz.css` 34.57 kB / gzip 7.58 kB）；`npm run test:e2e` **11/11 通过**（三视口；新增球队页两场景，截图落 `scratch/e2e-clubs-*.png` 与 `scratch/e2e-clubs-detail-*.png`）。
- 上线回读（2026-09-22）：`https://club.whleague.win/` 200 且首页资产与本地 build 逐字一致；匿名 `GET /api/clubs/1` → 401（符合裁决 Q1）；`GET /api/clubs` → 200、20 队、`logoKey` 20/20 非空；生产已配 `TOUR_API_BASE="https://whleague.win"`；生产迁移查得「✅ No migrations to apply!」⇒ 已在 0031。
- 读量（生产实测）：`/api/clubs` 聚合 1,032 行（全表 18,301，SQLite 靠 `WHERE club_id IS NOT NULL` 范围扫跳过 17,731 行 NULL）；`GET /api/clubs/:id` 151 行（club 1）/ 165 行（club 9，生产阵容最大 37 人）；`/api/clubs/:id/standing` 11 行；`/api/media/*` **0 行 D1**。验收线为列表 ≤3,000 行、详情 ≤500 行。
- 变异验证多处均能定向变红（教练区块身份判定、`/club` 两个 Navigate 目标、`failed` 分支、`平均成长空间`、积分榜 TTL、CA 条分母、直方图归一、图表溢出）。
- **本机 e2e 对球队页读端点仍是打桩**：本地 TOUR_DB 的 `team` 表 schema 陈旧（无 `logo_key` / `club_id`，只有 4 行）⇒ 那两个端点在 127.0.0.1 必然 500，属环境陈旧而非代码回归；本地库补到与生产同形后可撤桩。
- 详见 `ROADMAP.md` v3.4.0 节。

## [已上线] · v3.3.0 — 球员面板专项整改：术语三改 + 合同卷宗对齐 + 六维图与 PlayStyles 归位 + 徽章×PlayStyle 合并 + 转会记录页签（2026-09-22，Version d266036d-aa2e-43be-94ac-7f40972df7bb）

用户一次下达六项球员面板整改。前四项是文案与布局，后两项动了数据层：**「徽章」从「只有计数、身份靠管理组在 FC 阵容文件人工落实」改为平台自己记明细**（`player_playstyles`），并补上球员转会记录页签。8 个提交（`f4d4a68` / `e74148f` / `de3c04c` / `60c8dd5` / `1c44506` / `d38b39f` / `6bd9138` / `da7a1f6`），**已推送（`5394268..da7a1f6`）、已部署、生产迁移 `0031` 已 apply**。

**新增**
- `src/core/fc26.ts` 新增 PlayStyle 发放口径：`PS_GRANTABLE_BASE_IDS`（36 项基础 ID：1-8 / 11-16 / 21-26 / 31-35 / 41-45 / 51-56，与 `web/assets/ref/playstyle.json` 银段逐项一致）、`isGrantablePlaystyleId`、`playstyleIdOf(base, kind)`、`playstyleKindOf`、`playstyleSlotRange`（银 1-12 / 金 13-15）、`nextFreePlaystyleSlot`、`playstyleSlotsOf(attrs)`、`mergePlaystyleSlots`、`planPlaystylePicks`（白名单 → 段内重复 → 已拥有 → 银数量 → 金数量 → 落槽，逐层报错）。
- 迁移 `0031_player_playstyles.sql`：明细表 `player_playstyles`（`player_id / slot / kind / psid(基础 ID 1-99) / source(growth|china|manual) / granted_by / created_at`）+ `UNIQUE(player_id,slot)` + `UNIQUE(player_id,kind,psid)` + 段界 CHECK + 索引；末尾把 `config.badge_cap_silver` 由 `15` 改写为 **`12`**。`tests/d1.ts` 的 `MIGRATION_FILES` 已登记。
- 新端点 `POST /api/growth/china-playstyles/:playerId`（本队教练或管理组）：把一直没人读的 `china_badges`（默认 3）落成真发放，名额**一次发满**、`source='china'`，离队即回收。
- 新端点 `GET /api/players/:id/transfers`（公开只读）：只列 `status='completed'` 的单据，LEFT JOIN clubs 出双方队名，按 `completed_at DESC, id DESC` 取最近 50 条。
- 前端：球员详情第 4 页签「**转会记录**」；`web/src/lib/ref.ts` 导出 `TRANSFER_TYPE_LABEL`（从 `web/src/pages/admin/MarketPage.tsx` 抽出共用）；`Player.tsx` 新增 `PlaystylePickGrid` 选择器与中国计划发放块。

**变更**
- **术语三改全系统对齐**（21 文件，纯文案/注释）：「到顶」→「**非成长**」、「经纪人档位」→「**经纪人性格**」、「档案」→「**合同**」（限指代球员合同页签/成长记录的那批）、「效力球队」→「**来源球队**」。**例外保持原貌**：CHANGELOG/ROADMAP 历史条目、`PRD.md:5` 版本行、已 apply 的迁移注释、`scripts/prod-*/README`，以及「主场/球场档案」语义与主题名「复古档案室」、容器名「档案卡 `.dossier`」；摘要条 chip 与球员库表格列名仍叫「经纪人」（沿用v3.1.1 裁决）。
- 合同卷宗排版：新增 `.dossier-table` 作用域 —— 标签列定宽 6.5em、值列统一左对齐、数值列等宽 `tabular-nums`（此前 `td.mono` 三行与 `td.num` 两行字体与对齐不一致，因为全局 `.mono` 规则根本不存在）。
- 六维雷达从属性页**搬到左栏球员卡下方**（`.dossier-side` 纵列 + `.radar-card`），属性页网格第二行空位放 **PlayStyles 卡**（桌面固定 4 列、`.ps-card` 跨两列、900px 以下两列）。
- **徽章 × PlayStyle 合并**：升级方案带徽章时**必须一并交 `picks`**（数量须与方案一致、白名单内、同段不重复、未被 FC 源同段占用、槽位有空），台账 `badges_silver/badges_gold` 与明细 `player_playstyles` 同批写；徽章上限口径**统一为 12 银 / 3 金**（`badge_cap_silver` 默认 15→12，筛选校验与 admin 校验文案同步改 0-12；**DDL CHECK 仍 0..15、历史台账不 clamp**）。
- 回收与折算：转会成约删 `source='china'` 明细并同步减台账；解约删该球员全部明细；大换版（major）按 kind 保留最早 `ceil(n/3)` 行（`FOLD_PLAYSTYLES_SQL`，`generate-sql.ts` 拼在最后一片末尾）。
- `GET /api/players/:id/growth` 返回 `playstyleDetails` 与 `player.chinaPlaystyles {quota,granted,left}`；属性页 PlayStyles 列表 = FC 源槽 ∪ 明细（按 kind+基础 ID 去重，FC 源优先）。
- 文档口径同步：`TECH_DESIGN.md` 决策表第 10 条把「15 与 12 是两个口径，别混」改写为**已统一**并补发放/回收口径，`player_playstyles` DDL 入 §5 建表清单，§10.2/§10.4 补 picks 与明细折算，config 表 `badge_cap_silver` 改 12，端点表加 2 行；`UI_DESIGN.md` 球员详情行改为四页签 + 左栏雷达卡 + PS 卡嵌网格 + 徽章墙 x/12。

**修复**
- **`src/worker/transfers.ts` 海捞签入误回收中国计划徽章**（评审发现）：china 明细回收原先只 gate 在 `!amendment`，于是**海捞真自由身**（`type='free_agent'` 且 `from_club_id IS NULL`）被当成离队 —— 签入即删掉他的 china 明细并扣台账。改为 `amendment || transfer.from_club_id === null ? 0 : (COUNT…)`（从 CPU 队摘人 `from_club_id` 不为空，照旧回收）。回归测试 `tests/bypass-routes.test.ts` 新增「海捞真自由身是签入不是离队」，变异验证（去掉守卫）可复现两行明细被删。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **40 文件 / 573 例全绿**（v3.2.1 基线 39/550）；`npm run build` 成功（`web/dist/assets/index-C56W4cF9.js` 457.55 kB / gzip 145.20 kB）。
- 真浏览器复核（本地 8791，球员 9100 / 9001）：合同页签 7 行全左对齐、数值列等宽；属性页网格恰 4 列、第二行 = DEF/PHY + PS 卡（5 银 + 1 金）；左栏雷达卡常驻；升级方案选满 35 个银选项之一后确认 ⇒ `ca 76→78`、明细落 `{slot:2,silver,psid:2,source:'growth'}`（跳过被 FC PSID1 占用的槽 1）；中国计划发 3 个 ⇒ 徽章墙 🥈 4/12、明细 3 行 `source='china'`；转会页签 6 列无横向溢出。
- 变异验证：海捞守卫（去掉 ⇒ 明细被删）、折算 SQL、槽号口径、白名单过滤均能变红。
- **上线核对（2026-09-22T11:42Z，4 次线上只读请求）**：迁移 `0031` apply 报 `Executed 4 commands`；`player_playstyles` 表与索引各 1、当时 0 行；生产 `config` 无 `badge_cap_silver` 行（迁移那条 `UPDATE` 空转，上限由代码默认值 12 生效）；线上 `/players` HTML 引用 `assets/index-C56W4cF9.js`（与本地产物同名）；`GET /api/players/1/transfers` ⇒ `{"transfers":[]}`；`GET /api/players/1/growth` ⇒ 含 `playstyleDetails` 与 `player.chinaPlaystyles = {quota:3,granted:0,left:3}`；`GET /api/players?badges_silver_min=13` ⇒ 400「badges_silver_min 应为 0-12」（上限 12 已上线）。

**待办**
- 记录不改的遗留：台账可能 > 12（历史 cap 15）会显示「🥈 15/12」；徽章墙分母硬编码 12/3；方案卡 disabled 让「先选满再确认」toast 在 UI 上不可达；双击发放撞 UNIQUE 会让第二个请求 500（不写脏数据）；0 徽章方案多传 picks 被静默忽略。
- PlayStyle 图标资产包仍待供给（`assets/icons/playstyles/{id}.webp`，缺图降级 🥇🥈）。
- 生产 `player_playstyles` 上线时 0 行，首次真实发放（升级选徽章方案 / 中国计划）建议人工跟一单核对明细落槽。

## [已上线] · v3.2.1 — 球员库 UI 缺陷收口：档案页 15 槽徽章 + 多选面板高度上限 + 表格不折行（2026-09-22，Version 627508e5-f7c6-4e6d-90a2-5f95a82466bb）

v3.2.0 上线后，用户 m12257 裁决「建索引先搁置（当日写限额不足）、海捞池后续会有新调整、球员库 UI 小瑕疵可以现在修」，本增量只修三处 UI 缺陷，不建索引、不动海捞池契约、不写生产数据。5 个提交已于 2026-09-22 推送（`76aaeb9..91bc2d3`）并部署为 Version `627508e5-f7c6-4e6d-90a2-5f95a82466bb`，部署后线上 `/players` 的 HTML 引用 `index-C_n2o0KE.js` / `index-D-qmdoLZ.css`，与本地 `web/dist/assets/` 同名。本轮**不跑生产 API 回读**（不涉后端，省 D1 读额度）。

**新增**
- `src/core/fc26.ts` 新增 `PS_SLOT_KEYS`：由 `PS_SLOT_COUNT` 派生的 `PSID1 … PSID15` 槽位键表（此前档案页是手抄数组，与槽数常量无关联）。
- `web/src/lib/ref.ts` 新增 `playstyleBadges(attrs)`（返回 `{ psid, slot, gold }[]`，扫全 15 槽、只收正整数槽值、`slot` 1 起）与 `PlaystyleBadgeSlot` 类型。

**变更**
- 球员档案页（`web/src/pages/Player.tsx`）的 PlayStyles 徽章由手抄的 `PSID1-7` + `PSID13-15` 改为**按槽位扫全 15 槽**（银 `PSID1-12` + 金 `PSID13-15`），只渲染有值的槽、不给空槽占位 —— 落在 `PSID8-12` 的银徽章从此可见（v3.1.1 遗留 ②；生产实测 `PSID8` 有 3 人）。
- 多选下拉面板的高度上限从 CSS 收回到组件：`web/src/components/MultiSelect.tsx` 新增 `PANEL_MAX_PX = 480` / `PANEL_MAX_VH = 0.7`，`place()` 取 `min(可用空间, 480, 0.7 × 视口高)`（不低于兜底 160px）；`web/src/styles.css` 里那条被内联样式顶掉、从未生效的 `.multiselect-panel { max-height: min(70vh, 480px) }` 删除（遗留 ④）。
- 球员库表格单元格**一律不折行**（`.library-main td { white-space: nowrap }`），列宽不够时由外层 `.table-wrap` 横向滚动承担；管理员页表格不受影响（遗留 ⑤）。
- 摘要条「筛选（N）」的计数口径经用户裁决**维持现状**（数 chip 条数，位置选 12 个仍显示 1），文档里「已接受」改写为「已裁决维持现状」（遗留 ③）。
- 文档口径同步：`TECH_DESIGN.md` 徽章决策表把「档案页只渲染 `PSID1-7`+`PSID13-15` ⇒ `PSID8-12` 可筛不可见」整句替换为全 15 槽口径，并点明「槽号是 1 起」与「徽章墙 🥈 x/15 的 15 是 `badge_cap_silver` 台账上限、与 12 个银槽是两个口径，别混」；`UI_DESIGN.md` 补 15 槽渲染（不给空槽占位）、单元格不折行（附实测宽度）与面板上限；`ROADMAP.md` v3.1.1 遗留段落逐条改口径。

**修复**
- `web/src/pages/PlayersLibrary.tsx` 的 `psNames` 把 `.map` 的 **0 起下标**当槽号传给 `playstyleIsGold(psid, slot)`（后者语义是 1 起）⇒ 下标 12（= `PSID13` 金槽）走不到金槽分支，银段 ID 落在金槽时列表显示成银、与档案页 🥇 不一致（仅异常数据可见）。改为 `slot + 1`，并把 `psNames` 导出以便单测。
- `tests/core-zero-import.test.ts` 的依赖判据 `/^\s*(import|export\s+.*from)/` 会把 `export const PS_SLOT_KEYS: readonly string[] = Array.from(` 里的 `Array.from` 误判为依赖（`from` 命中），把零依赖模块判红。改为抽出 `hasStaticDependency(line)`：`import` 行首 ∥ `export … from '…'`（带引号）∥ 任意位置的 `import(`/`require(`（抓动态 import），并补判据自测。
- `web/src/lib/api.ts` 之类的既有契约未动；`GET /api/players` 等接口行为与本增量无关（纯前端 + 文档）。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 550 例全绿**（v3.2.0 基线 39/539 ⇒ 步骤 1 +5、步骤 2 +2、评审修正 +4）；`npm run build` 成功（`web/dist/assets/index-C_n2o0KE.js` 451.12 kB / gzip 143.00 kB + `index-D-qmdoLZ.css` 27.62 kB / gzip 6.36 kB）；本地 8791 + `npm run test:e2e` **9/9 通过**（三视口表格探针：0 个折行单元格、表格最小宽 876px vs 容器 854 / 815 / 290）。
- 三处改动都做过**变异验证**：`flatMap` 改 `slice(0, 7)` ⇒ 2 例红；面板上限改 `Infinity` ⇒ 5 例红；删掉 `white-space: nowrap` ⇒ e2e 报「108 个单元格仍会折行」；`psNames` 改回 0 起下标 ⇒ 1 例红。
- 不跑生产 API 回读（纯前端改动，省 D1 读额度）；部署后只取线上 `/players` HTML 核对 JS hash。

**待办**
- 推送 + 部署 + 线上产物核对（步骤 5）。
- 不在本增量范围（用户已指令搁置或另有安排）：下一批 4 条候选排序索引（`view=initial&sort=ca` / `uid` / `ps` / `name`，写限额不足）、姓名子串 FTS5、`attr:*` 34 键物化子表、海捞池 `LIMIT 300` 无分页无筛选、30 人 `naID`/`FootID` 补录、PlayStyle 图标包待供给。

## [已上线] · v3.2.0 — 球员库 D1 读消耗治理：去整表 COUNT + 两级缓存与代际失效 + 6 条索引 + 全站读面普查（2026-09-22，Version 7c5b5879-0003-421c-9bf2-6026a4674afe）

v3.1.1 收尾时生产 `/api/players*` 全线 500，排查确认是 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起，比部署早约 2 小时）。用户就此立项：「目前球员库相对稳定，现在查找的 D1 读消耗过大！」。先量化再治理——用「真实路由 + 假 D1 抓 SQL」的测量脚本打生产读 `meta.rows_read`，拿到 30 个形状的物理事实，再按写配额（免费档 10 万行/日）排优先级。全部步骤已于 2026-09-22 推送并部署为 Version `7c5b5879-0003-421c-9bf2-6026a4674afe`（步骤 0–5 先上 `91635aca`，步骤 6 再上 `7c5b5879`），部署后 8 请求最小化回读全部符合预期。

- **新增**
  - **测量工具两件**：`scripts/measure-d1-reads.mjs`（球员库 30 形状 + 6 设计探针）与 `scripts/measure-surface-reads.mjs`（全站 21 条读面），共用 `scripts/d1-read-audit/harness.mjs`。核心手法是**用 Hono 的 `app.request()` 调真实路由 + 注入只记录不执行的假 D1**，把路由实际执行的 SQL 与绑定参数原样抓下来内联后打生产 —— 不手抄 SQL，所以路由改了 SQL 复测自动跟着变（步骤 7 的验收复测直接复用）。三个必须知道的约束：每个读面跑在独立进程（`--only=<id>`，否则 `config` 的 isolate 内 60s 缓存把后续读面抹成 0）；只执行 SELECT（`selectOnly`，GET 里也可能藏写语句）；鉴权靠假 D1 回管理员 claims + 探针 cookie。
  - **定标报告** `scripts/d1-read-audit/README.md`（含原始数据 `measurements.json` / `measurements-after.json` / `surface-measurements.json`）：30 形状基线、6 探针、成本模型、阈值判定与候选清单、全站普查、验收表与豁免清单。
  - **内部计数端点 `GET /api/cron/players-count`**：列表去掉整表 COUNT 后，唯一还需要总数的地方（管理端筛选计数）走这里。**fail-closed**：未配 `CRON_KEY` 一律 403；密钥**只认 `X-Cron-Key` 请求头**（不接受 `?key=`，避免密钥进日志）。
  - **分级缓存**：`src/lib/cache-policy.ts` 的 TTL 单一来源表（球员库列表 1h、名册 24h、俱乐部目录 24h；`PUBLIC_CACHE_TTL_MS` 退化为显式覆盖，配 `0` 即旁路、生产**不配**），KV 代际键 `cache:epoch:public`（isolate 记忆 5s）配写路径 purge，`EPOCH_FAIL_SHORT_MS = 60_000` 兜 KV 读失败。
  - **迁移 `0029_players_sort_indexes_batch2.sql`**（声望 / 归属 / 状态三条排序表达式索引）与 **`0030_players_club_ca_index.sql`**（`players(club_id, ca DESC, id)`，为海捞名单驱动表连接备的）。
  - **同源锁死测试**：`tests/players-sort-indexes.test.ts` 断言语义 SQL 的 `EXPLAIN QUERY PLAN` 命中对应索引；`tests/market-routes.test.ts` 新增「海捞名单查询计划」用例（断言含 `idx_players_club_ca`、含 `SCAN cp`、不含 `MULTI-INDEX OR`）；`tests/admin-system.test.ts` 用记录型 D1 断言 overview 的全表 COUNT 一小时内只跑一次。都做了变异验证（改回去立刻红）。
- **变更**
  - **球员库列表去掉整表 COUNT**：`GET /api/players` 响应**不再有 `total`**，只有 `players` + `nextCursor`（keyset 游标；无更多数据时 `nextCursor` 为 `null`）。前端翻页条文案随之改为游标式（「第 N 页 · 已加载 N 名 · 还有更多／已到末页」），不再显示总数。
  - **两级缓存取代单层**：`cachedJson` 由「进程内 Map 单层」改为 **L1 进程内 + L2 边缘 Cache API**（合成 URL 作键、`cache-control: max-age` 管过期、全程 try/catch 旁路）；缓存键 = `${scope}:v${epoch}:${canonicalQuery}`。
  - **失效从 TTL 兜底改为写路径 purge**：挂钩收敛到两处 —— `/api/*` middleware（非 GET/HEAD + 2xx + `scopesForWritePath` 命中）与 `scheduled()`（tick 真改了数据才 purge）；每次 purge 只做一次 KV 写（代际键单版本）。
  - **前端 `staleTime`**：React Query 全局默认 30s、球员库列表 60s，并补两处写后失效。
  - **`/api/market/free-agents` 查询改写**：原 `WHERE (p.club_id IS NULL OR p.club_id IN (CPU 子查询))` 在生产 97% 球员无归属的数据下退化为 `MULTI-INDEX OR` + 临时排序（36,274 行/次），改写为 `UNION ALL` 两分支 + CPU 支用 `FROM clubs cp CROSS JOIN players p ON p.club_id = cp.id` 固定连接顺序 ⇒ **843 行/次（降 97.7%）**，结果集与旧版逐行一致（25 组随机数据 top-300 逐字节比对全等）。
  - **`/api/admin/overview` 的全表 COUNT 接入球员库列表同 scope 的两级缓存**（`countAllPlayers`，冷缓存仍 18,449 行但 1h 内多 isolate 只算一次、命中 0 行）。
  - **`AuthApiError` 去掉 TS 参数属性**（唯一需要代码生成的语法，Node 类型剥离不支持），否则 `authClient` 的六个读面在测量脚本里加载不了。
  - **`public/admin` 三处产物均为本次构建**：`index-DZu3s6Fn.js`（与步骤 5 同 hash，步骤 6 无前端改动）。
- **修复**
  - **生产 `/api/players*` 全线 500 的真因**（v3.1.1 收尾时的悬案）：D1 免费档当日行读配额耗尽，限额按 UTC 零点归零、自动恢复。排查中确立**三个假阳性判据**：`/api/health` 只读 `sqlite_schema`（不计配额）；`wrangler d1 execute --remote` 是管理通道（不受限）；`/api/clubs/directory` 缓存键是固定字符串且 stale 刷新分支吞掉 loader 错误（D1 全挂也回 200）。拿真错误文本的办法：临时给 onError 加 `__diag` 字段 + `wrangler dev --remote`（本地代码 + 生产绑定，不需部署）。
  - **`selectOnly` 原本放行整个 `WITH`**（`WITH … DELETE` 在 SQLite 合法 ⇒ 等于把写语句送上生产）⇒ 收紧为「`SELECT`，或 `WITH` 且不含写动词」并单测 9 种入参。
  - **`?attr=` 单独给会 400**（前端选一个属性就报错）⇒ `attr` 单独给合法、区间空串等同没给。
- **验收**
  - 30 形状生产复测（仅耗 338,980 行）：默认浏览一页 **18,819 → 56 行**（第 5 页 52、初始视图 56、`sort=id` 56）；`sort=ca/pa` 18,821/18,824 → **58/61**、`sort=age`/`market_value` → **22/22**（0027）；`sort=prestige/club/status` 56,398 → **53/43/22**（0029）；筛选各形状全部降到百级（`club_id=5` 64、`club_id=free` 22、`status=normal` 58、`growable=1` 95、`position=ST` 110、`ps=25` 293、`attr≥80` 88、`ca_min=80` 56）。容量推演：默认浏览从 **265 次/日** 升到 **89,285 次/日**。
  - 未达标形状逐条豁免（报告 §5.5）：8 个全表扫排序键 56,398–56,400 → 37,635–37,637（只降 33% = 纯去 COUNT；键在 `contracts`、依赖窗刻度子查询或内联运行时 config 系数的都不能静态索引），姓名查找 36,606 → 18,304（`LIKE '%x%'` 子串匹配用不了 B-tree，只能 FTS5 trigram）。
  - 测试 `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 539 例全绿**；`npm run test:e2e` 9/9；最小化回读 8 请求全符预期（`/api/health` 200、`/api/players?limit=1` 200 且**已无 `total`**、`sort=prestige`/`sort=status` 200、`/api/players/roster` 200、`/api/clubs/directory` 200、`/api/market/free-agents` 与 `/api/admin/overview` 均 401 未登录而非 500）。
  - 额度（UTC 2026-09-22）：读 1,993,427 行（39.9%）、写 73,220 行（73.2%）。
- **待办 / 登记未做**
  - 下一批可建索引（每条 18,301 行写，免费档自留 6 万/日 ⇒ 每天最多 3 条）：`view=initial&sort=ca`（`COALESCE(base_ca, ca)`）、`sort=uid`、`sort=ps`（15 项链，须先过 D1 表达式树深度体检）、`sort=name`。
  - 姓名子串查找的 FTS5 trigram、`attr:*` 34 键的物化子表：独立主题。
  - 海捞池已 17,731 人而 `LIMIT 300` 无分页无筛选（「除 CA 最高 300 人外都看不到」是产品级问题，本增量只治读量、不动契约）。

## [已上线] · v3.1.1 — 球员库左栏 UI 收口：多选下拉替代 chip 墙 + 区间成对 + PlayStyle 银/金分槽（2026-09-21，Version 3455087e-4bdb-4a63-b40f-8df943d80892）

用户对刚上线的v3.1.0 左栏提了 8 条反馈（同行元素未对齐、表格上方空白过多、查找框灰字过长、位置 16 个 chip 太占地方、同一属性的上下限占两行、「属性键」用英文键、「经纪人」叫法、PlayStyle 与显示列也该是多选下拉），另附带要求**修掉金徽筛选**。本轮只改前端与筛选语义，**不写任何生产数据、不碰缓存与限流数值**；生产读消耗的量化与治理被用户明确挪到下一增量（当日 D1 读额度已超限，见 ROADMAP v3.1.1 节的「裁决」与「遗留」）。本增量已于 2026-09-21 推送（`89e039d..30c7cdc`，7 个提交）并部署为 Version `3455087e-4bdb-4a63-b40f-8df943d80892`；部署后生产 `/api/players*` 一律 500，排查确认为 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起全站真实表读失败，比本次部署早约 2 小时；限额按 UTC 零点归零），最小化生产回读顺延到额度归零之后。**回读已于 2026-09-22T00:01:52Z（本地 08:01，归零后 1 分 52 秒）补做**：`/api/health`、`?sort=name`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster` 六个端点全部 200，另用 `?ps=125&limit=3` / `?ps=25&limit=3` 各一次（合计 8 请求）实测银/金分槽语义在生产成立（金值只命中 `PSID13-15`、银值只命中 `PSID1-12`，互不串），cron 自 00:00:34Z 起恢复成功。

- **新增**
  - **`MultiSelect` 多选下拉组件**（`web/src/components/MultiSelect.tsx`）：走原生 **Popover API**（面板进 top layer，不被窄屏抽屉的 `position:fixed + overflow-y:auto` 裁切），自管 open 态（浏览器的 light-dismiss 一勾就关，多选要能连点），三条关闭路（再点触发器 / 点面板外 / Esc——Esc 里 `preventDefault()`，否则一次 Esc 会连抽屉一起关），面板位置按触发器 `getBoundingClientRect()` 现算并随滚动/缩放跟随，**下方不足 220px 就翻到触发器上方贴底**。位置（12 码位）、显示列（18 列）、PlayStyle 三处接入（v3.1.1）。
  - **属性中文名表成为单一来源**：`web/src/lib/ref.ts` 新增导出 `ATTR_LABELS`（34 项中文名）与 `ATTR_GROUPS`（七组：速度 / 射门 / 传球 / 盘带 / 防守 / 体格 / 门将），球员档案页（原来自写两份、未导出）与筛选面板共用同一份，并有 `ref.test.ts` 断言「与 `ATTR_KEYS` 逐序全等、无重复」。
  - **控件行统一**：`:root` 新增 `--control-h: 34px` 与 `.control-row`（工具条与左栏共用），同行控件底边齐平（v3.1.1）。
  - **e2e 探针**（`scripts/e2e/smoke.mjs` ⑧）：多选面板几何与命中测试（整块在视口内、`elementFromPoint` 命中面板内部、与触发器不重叠、高度 ≥160）、同行控件底边逐对对齐（并断言量到非空）、翻页条按线上量级文案量页面横向溢出（v3.1.1）。
- **变更**
  - **区间上下限合并成对**：原先 14 个 `num()` 每个占一行（「CA ≥」「CA ≤」各一行），改为每对一行两列、label 在左、placeholder 标「最低 / 最高」——CA / PA / 成长空间 / 初始 CA / 年龄 / 身价 / 影响力 7 对 + 属性 1 对（选中属性后出现，label 是该属性中文名）+ 合同 3 对（工资 / 解约金 / 效力时长）（v3.1.1）。
  - **位置**：16 个 chip（四个组 chip + 12 个码位）→ 多选下拉，只放 12 个码位（`POSITION_GROUPS` 随之下线）；点选仍是多选，URL 仍是 `position=CB,ST`（v3.1.1）。
  - **PlayStyle**：72 个 chip（银金同列、点金徽必然 400）→ 多选下拉，顶层分「银徽章 / 金徽章」两段、段内按 EA 六类（射门 / 传球 / 防守 / 控球 / 体格 / 门将）分组，各 36 项；不带搜索框（v3.1.1）。
  - **显示列**：`details` + chip 组 → 同一个多选下拉（`恢复自动` 移入面板页脚，仅手动改过时出现）（v3.1.1）。
  - **摘要条与翻页条合并成一行**（chips 靠左、翻页靠右，都在表格正上方），无筛选时不再渲染「未设筛选条件」占位——原先摘要条是全宽独立一行、分页条居中在表格上方，两者叠加出约 150px 空白（v3.1.1）。
  - 搜索框占位由 `按姓名找（支持去变音：sesko → Šeško）` 改为 **`查找`**（`aria-label="按姓名找"` 保留，去变音能力不变，只去掉占位里的教学文案）（v3.1.1）。
  - 筛选面板「属性键」→ **「属性」**，下拉 34 项按七组 `<optgroup>` 分组、选项写中文名（原先 34 个英文键平铺）；「经纪人」→ **「经纪人性格」**（仅筛选面板 label 与档案页的「经纪人性格 🕴」；摘要条 chip 的「经纪人：温和」与表格列名仍叫「经纪人」，用户裁决值此）；（v3.1.1）。
  - **PlayStyle 命中语义收口**：库里 15 个 PS 槽 = **银槽 1-12 + 金槽 13-15**（金徽落库存「基础 ID + 100」）。改为**银值只比银槽、金值只比金槽**，不再「基础 ID 或 其 +100 命中任一槽」——旧语义下筛银徽章会捞出只挂金徽章的球员（v3.1.1）。
  - PlayStyle 筛选参数白名单由「1-99」改为 **「银 1-99 ∪ 金 101-199」**（100 是空档）+ 去重 + 上限 100 项（超限 400）；槽位与段位常量（`PS_SLOT_COUNT=15` / `PS_SILVER_SLOT_COUNT=12` / `PS_GOLD_BASE=100` / `isPlaystyleId` / `isGoldPlaystyleId`）全部落到 `src/core/fc26.ts`，前后端与档案页共用，不再各写写死字面量（v3.1.1）。
- **修复**
  - **点金徽 chip 必然 400**：前端 `filtersToQuery` 序列化 `ps` 时没有任何白名单、后端只收 1-99，而旧面板铺出的金徽 chip 会序列化成 101-156 ⇒ 随本轮语义收口改掉（v3.1.1）。
  - **多选面板掉出视口**（真浏览器实测）：触发器贴近视口底部时，面板落在 806–966 而视口高 800，掉在视口外、点不到也滚不到 ⇒ 落位改为「下方不足 220px 翻到上方贴底」；同时落位**必须在 `showPopover()` 之后**（之前面板是 `display:none`，`offsetWidth` / `scrollHeight` 量到 0，「面板想要多高」恒为 0，翻转几乎永不触发）（v3.1.1）。
  - **窄屏勾选框标签被拆成三行**：375px 抽屉里 `.lib-adv-grid .field.check` 被 flex 压到 96px，「仅未来之星」渲染成「仅未 / 来之 / 星」⇒ 加 `white-space: nowrap`，整条换行而不拆字（v3.1.1）。
  - 两条 e2e 断言被评审指出是空洞的：翻页条原断 `scrollWidth > clientWidth`（CJK 会换行，永不可能失败）、同行判据原按 `top` 归行（`.control-row` 是 `align-items:flex-end`，底边对齐的成对控件顶边本就不同，会被判成不同行而跳过）⇒ 改为「页面级横向溢出」与「纵向相交归行 + 比底边 + 断言量到非空」（v3.1.1）。
- **待办**
  - **球员库 D1 读消耗的量化与治理**（v3.2.0）：本增量原计划的第一步是打生产实测，但 2026-09-21 当日 D1 读额度已超限（免费档按 UTC 零点归零），用户裁决整体挪到下一增量 ⇒ 本增量**未做任何读消耗测量，也未改缓存 / 限流 / 查询行为**。
  - **档案页只渲染银槽 `PSID1-7` 与金槽 `PSID13-15`**，而筛选与导入的口径是银槽 1-12 ⇒ 落在 `PSID8-12` 的银徽章「可筛不可见」（既存问题，v3.1.1 未修；**v3.2.1 已修**）。
  - 摘要条「筛选（N）」数的是 chip 条数：位置选 12 个仍显示 1（chip 粒度按用户裁决合并，计数口径随之如此，已接受）。
  - 1280 宽下表格里「Baseline Utd」「20.00 m」「2金7银」会折行（列宽所致，非本轮引入）。

## [已上线] · v3.0.0–26 — Version b83ec876（2026-09-21）

2026-09-21 推送 39 个提交（`29c8199..d17cbdd`）→ 部署 Worker（v3.1.0 只改代码与文档、无需迁移；v3.0.0 的 `0028` 已于同日随合同导入批 apply）。`wrangler deploy` CLI 回显 Current Version ID `81e93c74-228f-4fee-9d87-9fecf602d360`；`wrangler deployments status` 的 100% 流向为 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（同一批、相隔 5 秒，与v2.3.0–24 的 `90bfd78f` / `c0e0d130` 同形态）。

生产回读：`/api/health` 三资源 ok；`/api/players?limit=1` 200；`/api/players?sort=name` 200（修复前直接 500）；`/api/players?name=sesko` 返回 `B. Šeško`（去变音折叠在线上生效）；`/api/players/roster` 200 / 325262 字节；`ca` / `market_value` / `attr:finishing` / `years` 四个排序键与 `effective_years_min` / `protected` / `attr=finishing&attr_min` 三个筛选查询全 200。

## v3.1.0 — 球员库筛选搬进左栏（2026-09-21 上线，见上方部署记录）

- **新增**
  - **姓名去变音搜索**：新增 `src/core/name-fold.ts`，JS 侧 `foldName` 与 SQL 侧 `sqlFold` 用同一张 `FOLD_SPEC` 映射表（两侧规则同源，避免「折了一侧、另一侧没折」的静默漏搜）；球员库 `?name=` 改 `sqlFold('players.name') LIKE ? ESCAPE '\'`，「sesko」能搜到「Šeško」；导入侧 `warnUnfoldable` 对表外字符只警告不挡行，配套硬闸 `unmappedNameChars` 与只读脚本 `scripts/scan-name-chars.mjs`、链深守卫 `scripts/check-name-fold-depth.mjs`（v3.1.0）。
  - **轻量名册端点** `GET /api/players/roster`：单条 SQL 拼「姓名|俱乐部ID|球员ID」多行文本，5 分钟缓存下限；前端**聚焦搜索框才拉**（从不点搜索框的人不付这个代价），之后本地过滤 + 键盘上下选 + 点条目跳 `/players/:id`（v3.1.0）。
  - **球员库左栏**：筛选与显示列搬进球员列左侧 sticky 定宽栏（260px），桌面可收起且收起态记 `localStorage`；生效条件摘要条常驻、每条 chip 可单独撤销（v3.1.0）。
  - **窄屏筛选抽屉**：900px 断点下左栏改为左侧滑出抽屉，遮罩 / × / Esc 三条关闭路、背景锁滚、焦点陷阱与归位（v3.1.0）。
  - **前端组件测试基建**：devDeps 加 jsdom 与 @testing-library（react / dom / user-event），`vitest.config.ts` 加 react 插件并把 include 扩到 `web/**/*.test.ts(x)`（v3.1.0）。
- **变更**
  - **排序键 6 → 29 个**（表头每一列都可排）：`SORT_KEY_NAMES` 与 `TEXT_SORT_KEYS` 提到零 import 的 `src/core/players-sort.ts`，前后端共用同一份（原来各写一份字面量）；文本键（`name` / `contract_type` / `source`）走文本游标 `decodeTextCursor`；新增 `attr:<属性键>` 排序键，属性白名单与后端同源（`FC26_GAME_ATTR_COLUMNS` 从 `sprintspeed` 起切，34 项 = 29 外场 + 5 门将）（v3.1.0）。
  - 球员库排序交互由下拉框改为**点表头**，两态循环（升 → 降 → 升），`sort`/`order` 继续留 URL；默认态不给任何列打 active（服务端默认按 `players.id ASC`，标「UID ↑」是说假话）（v3.1.0）。
  - `PlayersLibrary.tsx` 853 → 598 行（`a7b92c0` 抽离那一步为 340 行，后续左栏/抽屉/表头排序各步又增回）：筛选控件抽成 `web/src/components/FilterPanel.tsx`（12 props），筛选模型拆到 `web/src/lib/players-library.ts`（Filters / EMPTY_FILTERS / RANGE_URL_KEYS / COL_DEFS / autoColsFor / sortColumnVisible / parseColsParam），行为不变（v3.1.0）。
  - 顶栏高度不再写死：`web/src/components/TopBar.tsx` 用 ResizeObserver（**`box: 'border-box'`**）实测回写 `--topbar-h`，吸顶元素避让顶栏（用户放大字号后顶栏更高，写死的 54px/102px 会压住侧栏）（v3.1.0）。
- **修复**
  - **`sqlFold` 的 REPLACE 链撞 D1 表达式树深度上限**：253 项链在真引擎上报 `D1_ERROR: Expression tree is too large (maximum depth 100)`，`?name=` 与 `sort=name` 直接 500（node:sqlite 上限 1000，本地单测测不出）⇒ 折叠表裁到生产实测 87 项，并加 `SQL_FOLD_DEPTH_LIMIT` / `SQL_FOLD_ENTRY_BUDGET` 与守卫脚本（v3.1.0）。
  - **焦点陷阱漏掉收起 `<details>` 里的元素**：Chrome 对收起 details 内元素不返回 `offsetParent === null`，导致清单末位错位、Tab 逃到 body（375 实测第 25 次）⇒ 显式排除 `details:not([open])` 后代、保留其 summary（v3.1.0）。
  - **关闭抽屉的焦点归位不能在同帧 focus()**：入口按钮所在工具条此时是 inert，`focus()` 被浏览器静默忽略、activeElement 掉到 body ⇒ 改为置标记、由 effect 在 `drawerOpen` 变 false 后再 focus（v3.1.0）。
  - 窄屏吸顶规则按类名裸命中抽屉内的筛选行，把「位置」那组 chip 头两行压住 ⇒ 规则改名 `.lib-toolbar` 并限定作用域；抽屉抬头补 sticky（v3.1.0）。
  - `foldName` 删掉 NFD 与整段 `toLowerCase`（只做查表替换 + ASCII 小写），`unmappedNameChars` 加形状变体判据 `FOLD_SHAPED`（弯引号/花式空格/不可见字符原先被跳过、永不报警）（v3.1.0）。
  - `attrSortExpr` 加 `+ 0`、`growth_gap` 两侧 COALESCE（属性值混字符串会让游标 NaN 或比较恒假）（v3.1.0）。
  - 锁滚在 Windows 经典滚动条下整页横跳 16px ⇒ `html, body { scrollbar-gutter: stable }`（v3.1.0）。
- **待办**
  - ~~本轮只改代码与文档，未 push 未部署~~ → **2026-09-21 已随 Version `b83ec876` 推送并部署**（`29c8199..d17cbdd`，39 个提交）；v3.0.0 的 worker 也一并上线。
  - 窄屏抽屉锁滚靠 `body { overflow: hidden }`，iOS 上不彻底（已加 `overscroll-behavior: contain` 兜底，真机未验）。

## v3.0.0 — 合同期与财政节点改窗刻度（2026-09-21 上线，见上方部署记录）

- **新增**
  - **合同期改窗刻度**（迁移 0028）：`contracts` 加 `service_ticks`（签约基数 = 签约时点已关常规窗数）/`protection_ticks`（保护期结束的绝对窗数）/`signed_season`+`signed_window_seq`（展示），`season_windows` 加 `is_temporary`；效力 = 0.5 × 已关常规窗数（1 常规窗 = 半赛季），保护期 = 签约后 3 个常规窗，解约免费门槛 = 6 个常规窗（3 赛季）；纯函数在 `src/core/bypass-rules.ts`，计数助手 `src/worker/contract-ticks.ts`（v3.0.0）。
  - **窗分型**：开窗 `POST /api/admin/windows/open` body 加 `temporary`；同赛季常规窗上限 2（季初 + 中期，第 3 个非临时窗硬拦 409）；季初/中期不落库，按同赛季非临时窗顺序派生（v3.0.0）。
  - **忠诚奖金改发放点**：从赛季结算按钮移到**赛季中期窗关窗**时发（`kind='loyalty' ref_type='window' ref_id=season*100+windowSeq` 幂等，逐队合并一条流水），关窗响应回显 `loyalty`（v3.0.0）。
  - **导入历史合同**：按 `effective_from` 反查签约基数并落保护期刻度（训练营无保护期），`service_ticks`/`protection_ticks` 随之 upsert（v3.0.0）。
- **变更**
  - 关窗扣款顺序改 **富人税 → 工资**，富人税税基含未扣工资（`资金` 与 `ΣRC+资金` 取多，不再减本窗工资）；临时窗只扣富人税 + 维护费（不扣工资、不收冠名租金也不递减剩余窗数），死忠演化每种窗照做（v3.0.0）。
  - 续约/匹配把保护期收口到审核通过当下：`protection_ticks` 置为当前已关常规窗数（判定恒不成立），`service_ticks` 效力基数不动（v3.0.0）。
  - 球员库/球员详情/球队页的效力与保护期按赛季展示（`serviceSeasons`/`protected`），筛选 `effective_years_*`、`protected=in|out` 改窗刻度 SQL；管理端开窗表单加「临时窗」复选框、窗列表加窗类型列（v3.0.0）。
  - `contracts.protected_until`（旧口径 signed_at + 548 天）保留留档，判定不再读；`loyalty_tiers` 档位单位由「年」改「赛季」（数值不变）（v3.0.0）。
- **修复**
  - 球员库效力筛选原会把无合同的球员按基数 0 当满效力：加 `ct.player_id IS NOT NULL` 闸（v3.0.0）。
  - 空数组求和得到 `-0` 会让关窗响应与断言别扭：`PayrollSummary` 汇总归一为 `0`（v3.0.0）。
- **待办**
  - 迁移 0028 **已于 2026-09-21 随合同导入批 apply 到生产**（生产迁移现到 0028）；~~worker 仍未部署~~ → **2026-09-21 已随 Version `b83ec876` 部署上线**（网页面板建合同不再落 DDL 默认刻度）。
  - 0028 是纯加列迁移（5 条 `ALTER TABLE ADD COLUMN`，无数据回填——apply 时生产 `contracts` 与 `season_windows` 分别为 0 / 1 行），比 0027 的 7.3 万行写轻得多。

## [已上线] · v2.3.0–24 — Version 90bfd78f（2026-09-20）

2026-09-20 推送 50 个提交（`9f05116..fe60273`）→ 生产迁移 apply 0022–0027（生产迁移现到 0027）→ 部署 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`。生产回读：`/api/health` 三资源 ok；0026 的 CPU 回填核对通过（id 10 / 241 / 112172 / 131681 均 `is_cpu=1`）；v2.3.0–23 新增路由在生产返回 401（未登录）而非 404。

### 新增

- **球员库**：接口补 `total` 与整套筛选域（身价/声望/成长空间/初始 CA/惯用脚/成长档位/未来之星/中国计划/经纪人档位/PlayStyle 多选/位置四槽多选/细分属性区间/合同域）；页面改版为 SoFIFA 式可变列 + 更多筛选折叠面板 + URL query 持久化（v2.3.0）。
- **俱乐部目录工具**：新建俱乐部必填游戏队号（赛事库校验 + 队名预填 + 指定 id 建行 + 认证目录 upsert，失败可重试）；`GET /api/clubs/directory`；管理端多教练绑定逐个解绑；换队号 rekey 只读预演工具 `scripts/rekey-team/`（v2.3.0）。
- **站内信收件篮**：`GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`，未读判定用独立列 `read_at`（迁移 0022），赛果确认与升级两处写入点内部改双通道（每个绑定账号一条 web 行进收件篮，绑了 QQ 的另加一条 qq 投递行）（v2.4.0）。
- **设施经营**：球场扩建、档位升级、子设施升级与建设券（迁移 0023 给 `stadiums` 加 `build_credit` 列），用户端 `GET /api/club/stadium/build-info` 与 `expand` / `upgrade` / `facilities/upgrade`，管理端 `GET|POST /api/admin/clubs/:id/stadium`；建设支出按 25% 返券、券只抵后续建设支出（先券后钱），config 新增 `facility_prices` 与 `stadium_max_open_tier` 两键（v2.5.0）。
- **冠名市场**：品牌池报价 / 签约 / 退约 + 窗末收租（迁移 0024 `naming_contracts`，费用条款快照列化 + 部分唯一索引拦一队双签），`GET /api/club/naming/quote` 与 `sign` / `terminate`，config 新增 `naming_params`（v2.6.0）。
- **赛果自动化**：cron 自动确认赛果（每轮上限 20 场，actor=0 系统留痕）、通知钩子重放 `POST /api/admin/results/:id/replay-hooks`、人工复核（迁移 0025 给 `result_confirmations` 加 `needs_review` / `review_note`）与 auth 三事件审计，config 新增 `results_auto_confirm`（v2.7.0）。
- **换版机制**：小换版 / 大换版两种模式（CA 换算与成长清零口径），导入预览警告与合同校验（v2.8.0）。
- **性能与守护**：`players` 四条排序表达式索引（迁移 0027）；公开 GET 的进程内限流与 TTL + stale-while-revalidate 缓存（`src/lib/guard.ts`，`PUBLIC_CACHE_TTL_MS`）；e2e 冒烟脚本 `scripts/e2e/smoke.mjs`（8 场景）与 `npm run test:e2e`（v2.8.1）。

### 变更

- `clubs.is_cpu` 列化（迁移 0026，由队名后缀回填），CPU 队不再靠名称判断（v2.8.0）。
- 顶栏响应式重排：桌面单行，窄屏品牌/用户区与导航分两行横滑（v2.3.0）。
- 公开 GET 的缓存与限流都是 isolate 内 `Map`：重启即清、多 isolate 不共享；KV 方案因免费档写配额否决。

### 修复

- 赛果通知钩子重放会重复发通知：重放跳过通知钩子（v2.7.0 收口审查发现）。
- 确认钩子（XP / 通知 / 奖金 / 上座）原先同步执行且裸奔，任一失败会把已入档的确认炸掉并让重试撞 409：改为逐个吞错收集（v2.7.0）。
- 账本幂等闸原按 `(kind, ref_type, ref_id)` 全局查重，多队同窗结算只有第一队落账：改按 `(club_id, kind, ref_type, ref_id)`（v2.6.0 前置修复，生产未触发）。
- 收件篮「标记已读」在 ids 超过 D1 单查询绑定参数上限 100 时报 500：改按 100 分块 `db.batch`（v2.4.0 收口审查发现）。
- 设施升级批次漏了 `build_credit` 的 UPDATE，建设券只进提示不落库（v2.5.0 冒烟发现）。
- 合同导入的 `clubId` 不存在时预览放行、落库才撞外键 500：preview 与 confirm 都改 404（v2.8.0）。
- 换队号 rekey 在换壳模式下 `tour_team_id` 空闲但认证库 `club_id` 已被占，只在执行期才炸：预演加撞号闸（v2.3.0）。
- 缓存键直接用原始查询串导致 `?a=1&b=2` 与 `?b=2&a=1` 重复装载：改为 `canonicalQuery` 归一；缓存条目无上限（键外部可控）会堆内存：加 64 条上限按插入序淘汰（v2.8.1 收口审查发现）。
- 球员库「上一页」用 `fetchPreviousPage` 会与页码错位，改为页码状态 + 缓存回退；无限查询最后一页按钮仍亮（v5 里 `getNextPageParam` 返回 `null` 仍算有下一页）（v2.2.0 收口审查发现）。

### 文档

- `README.md` 重写（原先只有一行标题）：定位、文档索引、技术栈、快速开始、命令表、绑定资源与权限、迁移纪律、测试、目录结构、部署现状（v2.8.2）。
- 新建项目级 `AGENTS.md`（危险操作清单、开发与测试口径、代码与提交规范）与 `CHANGELOG.md`（本文件）、`scripts/README.md`（脚本性质分级 + 生产工件执行状态）（v2.8.2）。
- `TECH_DESIGN.md` 与代码对齐：§13 补 5 个已落地 config 键并修正 2 个「待定」键、§15 假设加分类口径与编号归位、§17.1 补表达式索引规约、§17.3 按 `src/lib/guard.ts` 现状改写并写明「不用 KV 做 SWR」的裁决、§12 与假设 23 记 web 收件篮落地、附录 A 通知行拆分并标注冻结范围（v2.8.2）。
- 删除过期草稿 `handoff-20260916.md`（停在v1.5.0），其中仍有效的三条（球员库逐队源数据位置与字段口径、导入通道选择、`--file` 通道外键陷阱）已迁入 ROADMAP 与 `scripts/README.md`（v2.8.2）。

### 待办

- push 与部署已于 2026-09-20 完成（见本节开头的部署记录）；0027 的 7.3 万行写已随当日 apply 计入。
- 生产回填已于 2026-09-20 执行完毕：16 队队籍（`scripts/prod-20260919-roster-backfill/`，444 人，只写队籍不造合同），复查全库 assigned 551 = 4 支 CPU 队 107 + 本批 444、free 17750。
- `clubs.is_cpu` 四个 CPU 队（id 10 / 241 / 112172 / 131681）回填已于 2026-09-20 部署后核对通过（均 `is_cpu=1`）。
- 遗留：球员库 30 人缺字段补录未执行（源数据缺 `naID`/`FootID`，`scripts/players-import/overlay-missing.ts`）。

## [已上线] · v2.2.0 用户端重构 — Version 6ed7446c（2026-09-19）

- Market 拆为三页：`/market`（挂牌板 + 详情出价，公开）、`/market/free`（海捞签入 + 训练营激活，需登录）、`/market/mine`（我的挂牌 + 我的出价，需登录）。
- 用户端登录守卫 `RequireUser`（软卡不重定向）与 `AuthContext`（`/api/me` 全站单点拉取，顶栏/首页/管理端的 props 钻透退役）。
- 用户端 8 页数据层接入 TanStack Query，写后精确 invalidate。
- 注册合规逐人标红：按球员展开行级红底 + 规则短标签。

## [已上线] · v2.1.0 管理端重构 — Version 4d03eb57（2026-09-19）

- 管理端从单页拆为左侧栏壳 + 8 个子路由（总览/赛季/球员/导入/转会/俱乐部/财政/系统），React.lazy 分包；后端 `admin.ts` 拆为 `routes/admin/` 八域，URL 零变更。
- 新增暂停出价：全局 config 开关 `market_bid_paused` + 单挂牌列（迁移 0021 `listings.bid_paused`），只挡新出价，不改变结算时刻。
- config 超管全开（独立权限点 `club.config.manage.super`，GET 明文 / PUT 逐键编辑 + 审计 `config_set`）、`GET /api/admin/overview`（isolate 60s 缓存 + `?fresh=1`）、`GET /api/admin/audit-log`。
- 统一两段式确认按钮 `ConfirmButton`，批量维护改结构化逐行预览。

## [已上线] · 早期v0.1.0–14（2026-09-12 ~ 2026-09-19）

- v0.1.0 地基：纯 Worker + 共享登录 + schema + SPA 壳。
- v0.2.0 球队与球员主数据（管理端最小集）。
- v0.3.0 阵容注册与合规。
- v0.4.0 转会市场（挂牌竞价链）。
- v0.5.0 签约谈判（signing）。
- v0.6.0 旁路操作 + 激活匹配 + 窗口。
- v0.7.0 财政、赛季与通知（MVP 收口）；6.1 走查修复与球员库（四裁决落地）。
- v1.0.0 球队绑定上收认证中心（auth + tour + club 三仓，`AUTH_DB` 只读接入）。
- v1.1.0 球员库统一 + FC26 ID 对齐。
- v1.2.0 分级派生（报名定级，club 单仓）。
- v1.3.0 异常告警 + 管理介入 + 批量维护。
- v1.4.0 赛季结算域。
- v1.5.0 主场收入域（存量主场数据迁移）。
- v1.6.0 成长域校准（成长期 / 解约清零 / 中国计划闸门）。
- v2.0.0 CPU 队与队籍口径（`clubs.is_cpu` 代码侧与球员库首灌）。

早期各次的部署 Version 记录见 `wrangler deployments list --name whl-club` 与 ROADMAP 对应章节。
