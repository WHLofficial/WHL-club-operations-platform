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
- 生产最新 Version **`31c58da7-6611-4634-8c22-678a0f9e6876`**（2026-09-22T02:17:47Z，Source `Secret Change`——配 `CRON_KEY` 触发的换版，**代码与 `3455087e` 相同**，含增量 27）；上一版为 `3455087e-4bdb-4a63-b40f-8df943d80892`（2026-09-21T17:13:35Z，含增量 27），再上一版 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（2026-09-21T14:39Z，含增量 25–26）。`wrangler deploy` CLI 回显的 Current Version ID 与 `wrangler deployments status` 里的 Version 是两个值（增量 26 为 `81e93c74-…` vs `b83ec876-…`，增量 27 为 `ff9c2e91-…` vs `3455087e-…`）。**配 secret 也会换版本**（`wrangler secret put` 生成 Source `Secret Change` 的新版本）。生产迁移已到 **0028**（`0028_contract_window_ticks.sql` 于 2026-09-21 随合同导入批 apply；`d1 migrations list whl-club --remote` 报 No migrations to apply）。网页面板建合同不再落 DDL 默认刻度（增量 25 代码已上线）。
- **2026-09-22 生产 secrets 已补配 `CRON_KEY`**（此前只有 `AUTH_BIND_SECRET`）：内部端点 `/api/cron/tick` 与增量 28 的 `/api/cron/players-count` 从此都真正受 `X-Cron-Key` 守卫保护（此前 tick 在生产是 fail-open：未配 secret 就放行）。生产实测无密钥 POST tick 回 **403 `{"error":"cron 密钥不对"}`**。本地联调值写进 `.dev.vars`（gitignore）。
- **增量 28（球员库 D1 读消耗量化与治理）进行中**：步骤 0–2 已完成并提交（`b7ca169` 量化报告 = 30 形状 + 6 探针实测；`d9beff0` 去整表 COUNT + `total` 改游标式 + 内部计数端点 `GET /api/cron/players-count`，fail-closed + 只认 `X-Cron-Key` 头），**未 push、未部署**；缓存分层（分级 TTL + 边缘 Cache API + 代际键 purge）与物化索引是后续步骤。去 COUNT 后默认浏览一页由 18,819 行降到 56 行（命中缓存 0 行）。
- 生产数据（2026-09-21）：球员库 18301 人——在册 **570**（20 队全 `status='normal'`，含 4 支 CPU 队）、自由身 **17731**（全 `status='free'`）；16 人控队合同 **462** 行（2026-09-21 由 `一线队-S9.csv` 导入）。六条 S9 生产批（窗基线 / 队籍对齐 / 遗留释放 / 自由身补标 / 能力导入 / 合同导入）全部执行完毕，逐批工件与执行记录见 `scripts/README.md` 与各批目录 README。
- 尚未执行的生产写：球员库 30 人缺字段补录（`scripts/players-import/overlay-missing.ts`）。
