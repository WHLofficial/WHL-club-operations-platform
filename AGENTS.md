# AGENTS.md · WHL-club-operations-platform

本文件收窄用户级 `~/.zcode/AGENTS.md` 的通用规矩，只写本仓库特有的事实与纪律。冲突时以代码与 `wrangler.jsonc` 为准，并顺手更正本文。

## 项目速览

Cloudflare Worker（Hono）同时提供 API 与前端静态资源，前端是 React 19 SPA，构建产物 `web/dist` 即 Worker 的 `ASSETS` 绑定。

三个 D1 库，**只有 `DB`（whl-club）可写**：

| 绑定 | 库 | 权限 |
|---|---|---|
| `DB` | whl-club `73154873-d5ae-42b0-a630-25f5ef60053d` | 可写，迁移目录 `src/db/migrations` |
| `TOUR_DB` | whl `ec3cc695-70bc-47ab-a454-5ca62ec22dd6` | 只读 |
| `AUTH_DB` | whl-auth `b76d1129-77ae-4844-931c-1c7b00a9b048` | 只读 |

`SESSION_KV`（id `87e2d78308bc47e9b36dc6de53be0458`）与赛事/竞猜共用命名空间，`MEDIA` 是 R2 桶 `whl-media`。生产域名 `club.whleague.win`，Worker 名 `whl-club`。

## 危险清单（未获明确指令一律不执行）

- `npm run deploy`、`wrangler deploy`、任何 `--remote` 写操作（`d1 execute` / `d1 migrations apply` / `kv key put` / `r2`）。
- 生产 D1 的迁移 apply、`scripts/prod-*/` 下任何 SQL 工件、`scripts/players-import/sql/` 分片导入。
- 球员库全量**重**导入（首灌已于 2026-09-18 执行，入库 18301 人，勿重跑分片）、30 人缺字段补录（`overlay-missing.ts`）。16 队队籍回填（`scripts/prod-20260919-roster-backfill/`）已于 2026-09-20 执行完毕（444 人），工件内守卫 `club_id IS NULL` 使其幂等，但无新指令不要再跑。
- `git push` 与发布。

一次授权不延续到下一轮。执行前先说明影响面（行数、配额、不可逆点）再等确认。

只读查证是安全的，例如 `wrangler deployments list --name whl-club`、`wrangler d1 migrations list whl-club --remote`。

## 开发

```bash
npm run db:migrate:local   # 本地 D1 建表
npm run dev                # worker + web/dist 静态资源，8791
npm run dev:web            # 只改前端时用（Vite，/api 代理到 8791）
```

- 端口：`dev` 8791、`dev:oidc` 8795（本地认证中心 8792）、e2e 冒烟默认打 8791。
- 改前端不 `npm run build` 就看不到变化（`dev` 吃 `web/dist` 产物）；要即时预览用 `dev:web`。
- 登录模式由 `wrangler.jsonc` 的 `AUTH_MODE` 决定：`oidc`（默认）或撤掉走兼容模式（cookie `whl_session` → KV `sess:{token}` → 赛事库 `user` 表）。会话解析在 `src/lib/session.ts`，cookie 名在 `src/lib/oidc.ts`。

## 测试

- `npm test`（Vitest，当前 31 文件 / 397 用例）、`npm run typecheck`（三份 tsconfig）、`npm run build`——功能点提交前至少跑 test + typecheck。
- `npm run test:e2e`：需要先 `npm run build` 且 `npm run dev` 在跑，用本机 Chrome（`playwright-core`，未装浏览器二进制）。
- `tests/d1.ts` 用本地 SQLite 执行真实迁移：**新增迁移必须把文件名追加进它的 `MIGRATION_FILES`**，否则夹具与迁移脱节。
- 夹具里的赛事库/认证库数据在 `tests/tour-team-seed.ts` 等处，按需扩充，不要连远端。

## 代码与提交

- 代码注释与提交信息用中文；提交信息走 `type(scope): 说明`（`feat` / `fix` / `docs` / `chore` / `refactor`），小步、单语义。
- 每个功能点提交后用 code-review-skill 审一遍再收口。
- 改文件只用 Edit/Write 工具，不要用终端脚本（sed/awk/echo/python 重定向）写文件。
- 纯逻辑放 `src/core/`（无 IO，便于测），HTTP/会话/缓存工具放 `src/lib/`，业务编排放 `src/worker/`，端点放 `src/worker/routes/`。
- 公开 GET 走 `src/lib/guard.ts`：`assertPublicRate` 限流 + `cachedJson` 两级缓存（L1 进程内 + L2 边缘 Cache API，增量 28）；TTL 口径在 `src/lib/cache-policy.ts`（列表 1h / 名册 24h / 目录 24h，`PUBLIC_CACHE_TTL_MS` 只是显式覆盖、配 `0` 即旁路）；新鲜度靠写路径 purge（代际键 `cache:epoch:public`），缓存键要用 `canonicalQuery` 归一，避免参数顺序不同造成重复装载。
- 前端数据层统一用 TanStack Query（`web/src/lib/queries.ts` 用户端、`adminQueries.ts` 管理端），写后精确 invalidate，不引 useMutation。
- **球队页 URL 的 id 一律是平台库 `clubs.id`**（`/clubs/:id`），不得用比赛系统 `tour_team_id`；跨库映射（`AUTH_DB.team.club_id → tour_team_id`）只在服务端内部做。此规则长期有效，后续新增的球队相关路由同样照此。

## 文档纪律

- 每个增量完成后：`ROADMAP.md` 加一节（裁决 / 交付 / 验收 / 待办），`CHANGELOG.md` 加条目，测试与用例数写实测值。
- 跨会话可复用结论写进记忆目录 `~/.zcode/cli/memories/projects/whl-club-operations-platform-59a36e78dc8d8fb3/memory/`，并在其 `MEMORY.md` 加一行索引。
- 每个增量开工前先在记忆目录落一份计划文件（目标、交付物、步骤、验收口径、风险边界）再动手。
- 路径、命令、按钮、版本号必须亲自查证后再写进文档；未验证的要标「未验证」。
- `scratch/` 与 `handoff-*.md` 已 gitignore，属本地草稿，不进提交。

## 当前状态（2026-09-21 生产数据批执行后）

- 增量 17–24 已推送（`9f05116..29c8199`，51 个提交，其中 50 个是增量 17–24，另 1 个 `29c8199` 是部署记录回写）并部署上线；本地与 `origin/main` 的差值以 `git rev-list --count origin/main..HEAD` 为准。
- **增量 25 与增量 26 已于 2026-09-21 推送（`29c8199..d17cbdd`，39 个提交 = 增量 25 一行 21 个 + 增量 26 的 18 个）并部署上线**。增量 26 是球员库筛选搬进左栏（左栏 / 表头点排序 / 姓名去变音搜索 / 窄屏抽屉），只改代码与文档、**未写任何生产数据**（折叠表依据生产库只读扫描 `scripts/scan-name-chars.mjs --remote`，未写）。ROADMAP 增量 25 节的「交付」只列 5 个代码提交，另 16 个是随后的 S9 生产批工件与执行记录。
- **增量 27 已于 2026-09-21 推送（`89e039d..30c7cdc`，7 个提交）并部署上线（生产 Version `3455087e-4bdb-4a63-b40f-8df943d80892`，2026-09-21T17:13:35Z）**：球员库左栏 UI 收口——位置 / 显示列 / PlayStyle 改多选下拉（原生 Popover）、区间上下限成对一行两列、属性下拉按七组写中文名、摘要条与翻页条合并一行、同行控件底边对齐。顺带修掉**点金徽 chip 必然 400**，并把 PlayStyle 命中语义收口为「银值只比银槽 `PSID1-12`、金值只比金槽 `PSID13-15`」（槽位与白名单常量统一在 `src/core/fc26.ts`）。**生产读消耗的量化与治理经用户裁决挪到增量 28**（2026-09-21 当日 D1 读额度已超限），本增量未改缓存 / 限流 / 查询行为、未写生产数据。
- ⚠️ **2026-09-21 当日生产 D1 免费档行读配额耗尽（事故，非增量 27 引入）**：`scriptThrewException` 自 15:20:22Z 起、cron 每 5 分钟失败一次，`/api/players*` 一律 500（根因 `D1_ERROR: Your account has exceeded D1's free tier daily row read limit`；当日 whl-club `rowsRead` 4,350,235 / 上限 5,000,000）。限额按 **UTC 零点**归零，之后自动恢复。判断 D1 是否可用**不能**用 `/api/health`（只读 `sqlite_schema`）或 `wrangler d1 execute --remote`（管理通道不受限），也不能用 `/api/clubs/directory`（缓存键是固定串 + stale 刷新吞错）。部署后的最小化生产回读已顺延到额度归零之后，并已于 **2026-09-22T00:01:52Z（归零后 1 分 52 秒）补做**：`/api/health`、`?sort=name`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster` 全 200，另 2 次请求实测银/金分槽语义在生产成立；cron 最后一次失败 23:55:17Z、00:00:34Z 起恢复成功。
- 生产最新 Version **`adb3a5ae-dbc5-4648-bf62-383e1108923d`**（2026-09-22T17:58:17Z，含**增量 31 全部步骤 + 总身价 null 修复**）与 **`64020454-405c-479a-9a62-8197444f4f52`**（2026-09-22T17:58:08Z）相隔 9 秒、产物一致（线上首页资产 `index-C7pOcE6p.js` + `index-BT5YAIcz.css`，与本地 `web/dist/assets/` 逐字一致），`wrangler deploy` CLI 回显的是后者；上一版 **`7a178d81-dccc-4696-a7d7-7d8c61eaa683`**（2026-09-22T17:42:20Z，含增量 31 步骤 0–11b）；上一版 **`d266036d-aa2e-43be-94ac-7f40972df7bb`**（2026-09-22T11:42:02Z，含增量 27 + 28 全部步骤 + 29 + **增量 30**；`wrangler deploy` CLI 回显的 Current Version ID 与 `deployments list` 记录同为 `d266036d-…`）；上一版 **`627508e5-f7c6-4e6d-90a2-5f95a82466bb`**（2026-09-22T07:02:52Z，含增量 27 + 增量 28 全部步骤 + **增量 29**）；上一版 `7c5b5879-0003-421c-9bf2-6026a4674afe`（2026-09-22T05:25:16Z，含增量 27 + **增量 28 全部步骤**；`wrangler deploy` CLI 回显的 Current Version ID 为 `7cb80a9b-c213-4ed2-b2f3-183c304808ec`）；上一版 `91635aca-92d3-4921-8208-d9f7912aaec7`（2026-09-22T04:19:18Z，含增量 27 + 增量 28 步骤 0–5；CLI 回显 `4d6119f4-aa22-47ea-979b-ce9a46c6736f`），再上一版为 `31c58da7-6611-4634-8c22-678a0f9e6876`（2026-09-22T02:17:47Z，Source `Secret Change`——配 `CRON_KEY` 触发的换版，代码与 `3455087e` 相同），再上一版 `3455087e-4bdb-4a63-b40f-8df943d80892`（2026-09-21T17:13:35Z，含增量 27），再上一版 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（2026-09-21T14:39Z，含增量 25–26）。`wrangler deploy` CLI 回显的 Current Version ID 与 `wrangler deployments status` 里的 Version 是两个值（增量 26 为 `81e93c74-…` vs `b83ec876-…`，增量 27 为 `ff9c2e91-…` vs `3455087e-…`，增量 28 为 `4d6119f4-…` vs `91635aca-…` 与 `7cb80a9b-…` vs `7c5b5879-…`；**增量 29 与增量 30 两者一致**，增量 31 为 `64020454-…` vs `adb3a5ae-…`）。**配 secret 也会换版本**（`wrangler secret put` 生成 Source `Secret Change` 的新版本）。生产 vars 自增量 28 起**不再配 `PUBLIC_CACHE_TTL_MS`**（缓存口径改由 `src/lib/cache-policy.ts` 的分级表承载，变量退化为显式覆盖）。生产迁移已到 **0031**（`0031_player_playstyles.sql` 于 2026-09-22T11:40Z 单独 apply，报 `Executed 4 commands`；生产原在 0030）。**迁移一旦 apply 到生产就不得再改**，要改新增下一个文件。网页面板建合同不再落 DDL 默认刻度（增量 25 代码已上线）。
- **2026-09-22 生产 secrets 已补配 `CRON_KEY`**（此前只有 `AUTH_BIND_SECRET`）：内部端点 `/api/cron/tick` 与增量 28 的 `/api/cron/players-count` 从此都真正受 `X-Cron-Key` 守卫保护（此前 tick 在生产是 fail-open：未配 secret 就放行）。生产实测无密钥 POST tick 回 **403 `{"error":"cron 密钥不对"}`**。本地联调值写进 `.dev.vars`（gitignore）。
- **增量 28（球员库 D1 读消耗量化与治理）已全流程收口，2026-09-22 分两次推送并部署（步骤 0–5 → `91635aca-…`，步骤 6–7 → `7c5b5879-…`）**：0–1 量化（`b7ca169`，30 形状 + 6 探针，报告落 `scripts/d1-read-audit/`）；2 去整表 COUNT + `total` 改游标式 + 内部计数端点 `GET /api/cron/players-count`（`d9beff0`，fail-closed + 只认 `X-Cron-Key` 头；`4fb483a` 为生产补配 CRON_KEY 的文档）；3 分级 TTL + 边缘 Cache API + 代际键 purge + 中心化挂钩（`3671c33`）；4 迁移 `0029` 三条表达式索引 + 同源锁死测试（`c6d1d22`）；5 前端 `staleTime`（`dbf55c7`，全局 30s / 列表 60s）；6 全站读面普查 + 处置两个 ≥10k 读面（`d4aebc2`，`free-agents` 36,274 → 843 行、`admin-overview` 的全表 COUNT 接入两级缓存，迁移 `0030`）；7 验收复测 + 部署 + 最小化回读（`6db903a`）。**成果**：默认浏览一页 18,819 → **56 行**（容量 265 → 89,285 次/日）；`sort=prestige/club/status` 56,398 → 53/43/22；筛选各形状全部降到百级。**未达标形状逐条豁免**（报告 §5.5）：8 个全表扫排序键 → 37,635–37,637（只降 33%）、姓名查找 → 18,304（子串匹配用不了 B-tree，需 FTS5 trigram）。验收：typecheck 三份全清、vitest **39 文件 / 539 例**、build 同 hash、e2e 9/9、8 请求回读全符预期（列表已无 `total`）。**登记未做**：下一批 4 条候选索引（`view=initial&sort=ca`/`uid`/`ps`/`name`，每条 18,301 行写、每天最多 3 条）、FTS5 姓名子串、`attr:*` 34 键物化子表、海捞池 `LIMIT 300` 无分页（产品级问题）。
- **增量 29（球员库 UI 缺陷收口）已推送（`76aaeb9..91bc2d3`，5 提交）并部署上线（Version `627508e5-f7c6-4e6d-90a2-5f95a82466bb`，2026-09-22T07:02:52Z），4 个代码提交（`e3b5033`/`da875f1`/`b8739d5`/`fa29934`）+ 1 个文档提交（`91bc2d3`）**：按用户 m12257 指令（建索引搁置 / 海捞池后续调整 / 只修球员库 UI 小瑕疵）修三处缺陷 —— 档案页徽章扫全 15 槽（原先只渲染 `PSID1-7`+`PSID13-15`，`PSID8-12` 的银徽章可筛不可见）、多选面板高度上限收进组件（原先内联 `maxHeight` 顶掉 CSS 的 `min(70vh, 480px)`，高窗口下可长到近满屏）、球员库单元格一律不折行（列宽不够改由 `.table-wrap` 横向滚动，实测表格最小宽 876px vs 桌面容器 854px）。顺带修两个真 bug：`psNames` 把 0 起下标当槽号（银段 ID 落金槽会在列表显示成银）、`tests/core-zero-import.test.ts` 把 `Array.from(` 误判为依赖。5 项裁决与分步记录见 `ROADMAP.md` 增量 29 节。
- **增量 30（球员面板专项整改）已推送（`5394268..da7a1f6`，8 个提交 `f4d4a68`/`e74148f`/`de3c04c`/`60c8dd5`/`1c44506`/`d38b39f`/`6bd9138`/`da7a1f6`）并部署上线（Version `d266036d-aa2e-43be-94ac-7f40972df7bb`，2026-09-22T11:42:02Z），生产迁移 `0031` 已 apply**：按用户一次下达的六项整改——① 术语三改（到顶→非成长、经纪人档位→经纪人性格、档案→合同、效力球队→来源球队；历史记录与「主场/球场档案」语义保持原貌）；② 合同卷宗对齐与字体（`.dossier-table` 作用域）；③ 六维雷达搬到左栏球员卡下方；④ PlayStyles 嵌进属性网格第二行空位；⑤ **徽章 × PlayStyle 合并**——新增 `player_playstyles` 明细表（迁移 `0031`，`psid` 存基础 ID、金徽由 kind 表示）、`applyLevelUp` 第 5 参 `picks`（带徽章方案必须一次选满）、新端点 `POST /api/growth/china-playstyles/:playerId`（把 `china_badges` 落成真发放）、离队回收与解约清空、大换版按 kind 留最早 `ceil(n/3)`；徽章上限口径**统一为 12 银 / 3 金**（`badge_cap_silver` 默认 15→12，DDL CHECK 仍 0..15、历史台账不 clamp）；⑥ 第 4 页签「转会记录」+ 新端点 `GET /api/players/:id/transfers`。评审修掉 1 个真缺陷（海捞真自由身被当成离队、误删 china 明细并扣台账；回归测试 + 变异验证）。验收：typecheck 三份全清、vitest **40 文件 / 573 例全绿**、build 成功、真浏览器逐项复核；上线核对 4 次只读请求全符预期（线上产物 `index-C56W4cF9.js`、`/players/1/transfers` 通、growth 带 `playstyleDetails` 与 `chinaPlaystyles{quota:3}`、`badges_silver_min=13` 回 400「应为 0-12」）。**生产 `config` 本来没有 `badge_cap_silver` 行**，迁移里那条 `UPDATE` 空转，上限由代码默认值 12 生效。详见 `ROADMAP.md` 增量 30 节。
- **增量 31（球队页：公开列表 + 登录详情 + 自家队中心合并 + 只读媒体路由）已完成步骤 0–12（含步骤 11a/11b 两轮用户整改），17 个提交，已推送（`466df81..d759b86` 16 个 + `d759b86..2ad239b` 1 个）并部署上线**。提交清单：`70dc811`/`545ad90`/`e0411de`/`5dbfe41`/`a84c748`/`779ee6b`/`5b90031`/`32068be`/`00092b4`/`57e68a6`/`829063f`/`aa0aea2`/`50e69f5`/`6464d0b`/`5f7c3d6`/`d759b86`/`2ad239b`。按用户 m12793 指令（新增球队页列表 + 详情，特别注意性能与 D1 额度）：新增公开 `GET /api/clubs`（一次算完 20 队、无逐队查询）、登录可见 `GET /api/clubs/:id` + `GET /api/clubs/:id/standing`（排名代理）、公开只读 `GET /api/media/*`（**零 D1 读**，镜像比赛系统媒体路由）；前端 `/clubs` 列表页（三段卡片）、`/clubs/:id` 详情页（阵容组 / 运营组 / 战绩组，年龄竖直直方图与 CA 100% 堆叠条均 CSS 自绘）、`TeamLogo` 组件、入口四处；原 897 行「我的球队中心」（`web/src/pages/Club.tsx`）整体搬进 `web/src/pages/club/CoachPanel.tsx`，`/club` 改为重定向壳（在途加载态 / 未绑定去 `/bind` / 已绑定去 `/clubs/<我的队>`），教练区块只在「登录者正是本队教练」时于详情页渲染。**本增量零迁移**（计划中的 `0032` 部分索引在步骤 1 读量实测后被裁掉，故推送无生产 DDL 耦合；生产迁移仍到 0031）。验收：typecheck 三份全清、vitest **46 文件 / 642 例全绿**、build 成功（`index-C7pOcE6p.js` 474.57 kB / gzip 149.44 kB + `index-BT5YAIcz.css`）、e2e **11/11**（三视口）。读量（生产实测）：列表聚合 1,032 行、详情 151/165 行、排名 11 行、媒体 0 行（验收线 3,000 / 500）。**步骤 12 生产回读发现并修掉一个生产可见缺陷**：`GET /api/clubs` 20 队 `totalValue` 全 0 —— 根因是 `players.market_value` 生产 18,301 行**全 NULL**（该列属运营列，`src/core/import.ts:3` 明写导入绝不触碰），而聚合写的是 `SUM(COALESCE(p.market_value, 0))`，把「没人录过」压成 0；改为 `SUM(p.market_value)`（全 NULL 出 NULL）+ `?? null`，前端 `money(null)` 回 `—`（与球员库 `web/src/pages/PlayersLibrary.tsx:58` 口径一致），提交 `2ad239b`。回读另确认：匿名 `GET /api/clubs/1` → 401（符合裁决 Q1）、`GET /api/clubs` → 200 且 20 队 `logoKey` 20/20 非空、生产已配 `TOUR_API_BASE="https://whleague.win"`。**步骤 9 证伪了一个此前的「真 bug」结论**：`clubFormPts` 绑 club id 而 `result_confirmations` 存的是比赛系统队 id，但生产 20 队 `club_id` = `tour_team_id` 全等、69 条赛果全落在这 20 值内 ⇒ 函数算得出真值，战绩系数并非恒 1.0；定性为潜伏缺陷（米兰在 2026-09-19 rekey 前曾长期恒返中性 4），只订正注释、不改行为。评审修掉 1 个真缺陷（新增 `.pos-chip` 覆盖球员页 `.pos-chip-main` 底色致浅底浅字不可读 ⇒ 新增类一律带 `club-` 前缀）与 1 个真实误判（`/club` 把「请求失败」当「未绑定」⇒ `MyClubState` 新增 `failed`）。详见 `ROADMAP.md` 增量 31 节与 `CHANGELOG.md`。
- 生产数据（2026-09-21）：球员库 18301 人——在册 **570**（20 队全 `status='normal'`，含 4 支 CPU 队）、自由身 **17731**（全 `status='free'`）；16 人控队合同 **462** 行（2026-09-21 由 `一线队-S9.csv` 导入）。六条 S9 生产批（窗基线 / 队籍对齐 / 遗留释放 / 自由身补标 / 能力导入 / 合同导入）全部执行完毕，逐批工件与执行记录见 `scripts/README.md` 与各批目录 README。
- 尚未执行的生产写：球员库 30 人缺字段补录（`scripts/players-import/overlay-missing.ts`）。
