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
- 球员库 18408 全量导入、30 人缺字段补录（`overlay-missing.ts`）、16 队队籍回填（`scripts/prod-20260919-roster-backfill/`，444 人，等管理组下令）。
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

- `npm test`（Vitest，当前 30 文件 / 387 用例）、`npm run typecheck`（三份 tsconfig）、`npm run build`——功能点提交前至少跑 test + typecheck。
- `npm run test:e2e`：需要先 `npm run build` 且 `npm run dev` 在跑，用本机 Chrome（`playwright-core`，未装浏览器二进制）。
- `tests/d1.ts` 用本地 SQLite 执行真实迁移：**新增迁移必须把文件名追加进它的 `MIGRATION_FILES`**，否则夹具与迁移脱节。
- 夹具里的赛事库/认证库数据在 `tests/tour-team-seed.ts` 等处，按需扩充，不要连远端。

## 代码与提交

- 代码注释与提交信息用中文；提交信息走 `type(scope): 说明`（`feat` / `fix` / `docs` / `chore` / `refactor`），小步、单语义。
- 每个功能点提交后用 code-review-skill 审一遍再收口。
- 改文件只用 Edit/Write 工具，不要用终端脚本（sed/awk/echo/python 重定向）写文件。
- 纯逻辑放 `src/core/`（无 IO，便于测），HTTP/会话/缓存工具放 `src/lib/`，业务编排放 `src/worker/`，端点放 `src/worker/routes/`。
- 公开 GET 走 `src/lib/guard.ts`：`assertPublicRate` 限流 + `cachedJson` TTL/SWR 缓存（`PUBLIC_CACHE_TTL_MS`，未配即旁路）；缓存键要用 `canonicalQuery` 归一，避免参数顺序不同造成重复装载。
- 前端数据层统一用 TanStack Query（`web/src/lib/queries.ts` 用户端、`adminQueries.ts` 管理端），写后精确 invalidate，不引 useMutation。

## 文档纪律

- 每个增量完成后：`ROADMAP.md` 加一节（裁决 / 交付 / 验收 / 待办），`CHANGELOG.md` 加条目，测试与用例数写实测值。
- 跨会话可复用结论写进记忆目录 `~/.zcode/cli/memories/projects/whl-club-operations-platform-59a36e78dc8d8fb3/memory/`，并在其 `MEMORY.md` 加一行索引。
- 每个增量开工前先在记忆目录落一份计划文件（目标、交付物、步骤、验收口径、风险边界）再动手。
- 路径、命令、按钮、版本号必须亲自查证后再写进文档；未验证的要标「未验证」。
- `scratch/` 与 `handoff-*.md` 已 gitignore，属本地草稿，不进提交。

## 当前状态（2026-09-20）

- 本地领先 `origin/main` 一批未推送提交（增量 17–24 的本地收口；实时数以 `git rev-list --count origin/main..HEAD` 为准），未 push、未部署。
- 生产最新 Version `6ed7446c-0a7e-40ed-b299-7e218b030dd5`（2026-09-19T13:58Z，增量 16）；生产迁移停在 0021，0022–0027 待 apply（0027 一次性约 7.3 万行写，需单独择日）。
