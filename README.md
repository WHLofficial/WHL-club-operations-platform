# WHL-club-operations-platform

WHL 水友联赛的俱乐部运营平台：球员库、阵容与注册、转会市场与谈判、俱乐部财政、设施与冠名、赛果结算与站内信。

单体仓库，一个 Cloudflare Worker 同时提供 API 与前端静态资源（React SPA 构建产物）。

| 项 | 内容 |
|---|---|
| 规则依据 | [PRD.md](./PRD.md)（功能全景与裁决）· [TECH_DESIGN.md](./TECH_DESIGN.md)（架构/数据模型/状态机/公式）· [UI_DESIGN.md](./UI_DESIGN.md)（复古档案室主题） |
| 开发计划 | [ROADMAP.md](./ROADMAP.md)（增量 0 起，逐增量记裁决、交付、验收、部署） |
| 变更记录 | [CHANGELOG.md](./CHANGELOG.md) |
| 许可 | [LICENSE](./LICENSE)（AGPL-3.0） |

## 技术栈

- 运行时：Cloudflare Workers（Hono 4 路由）
- 数据：D1 ×3、KV ×1、R2 ×1（绑定见 [wrangler.jsonc](./wrangler.jsonc)）
- 前端：React 19 + react-router 7 + TanStack Query 5 + Vite 6
- 认证：jose（OIDC 或兼容模式，见下）
- 测试：Vitest 3；e2e 冒烟用 playwright-core 驱动本机 Chrome
- 语言/工具链：TypeScript 5.6、wrangler 4

## 快速开始

前置：Node 与 npm（本机实测 Node v24.12.0 / npm 11.6.2）、已 `npm install`。Windows 上用 Git Bash。

```bash
# 1) 本地数据库建表
npm run db:migrate:local

# 2) 启动 worker（默认 8791 端口，含 API 与 web/dist 静态资源）
npm run dev

# 3) 只改前端时，另开一个终端跑 Vite（/api 代理到 127.0.0.1:8791）
npm run dev:web
```

注意：`npm run dev` 提供的前端是 `web/dist` 的构建产物，改前端后不 `npm run build` 就看不到变化；要即时预览用 `npm run dev:web`。

登录模式由 `wrangler.jsonc` 的 `AUTH_MODE` 决定：默认 `oidc`（认证中心 `https://auth.whleague.win`，client `club`）。撤掉 `AUTH_MODE` 即回兼容模式——读 cookie `whl_session` → KV `sess:{token}` → 赛事库 `user` 表。想在本机跑真 OIDC 联调，用 `npm run dev:oidc`（8795 端口，issuer 指向本地 8792），配套冒烟脚本见 `scripts/smoke-oidc-local.mjs`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | `wrangler dev --port 8791` |
| `npm run dev:oidc` | `wrangler dev --port 8795`，issuer/client 指向本地认证中心 8792 |
| `npm run dev:web` | Vite 前端开发服务器（`/api` 代理到 8791） |
| `npm run build` | `vite build`，产物 `web/dist` |
| `npm run typecheck` | 三份 tsconfig 全量 `tsc --noEmit`（根 / worker / tests） |
| `npm test` | `vitest run` |
| `npm run test:e2e` | e2e 冒烟 `node scripts/e2e/smoke.mjs`（需先 build + dev 在跑） |
| `npm run deploy` | `npm run build && wrangler deploy` |
| `npm run db:migrate:local` | 本地 D1 打迁移 |
| `npm run db:migrate:remote` | 生产 D1 打迁移（写操作，需明令） |

e2e 冒烟默认打 `http://127.0.0.1:8791`，用本机 Chrome（`C:/Program Files/Google/Chrome/Application/chrome.exe`），可用 `E2E_BASE` / `E2E_CHROME` 或第二个参数覆盖；失败截图落 `scratch/`。脚本会往**本地** KV 种一条 `sess:<随机 token>` 会话并在结束时删除（`--local`，该命名空间与赛事/竞猜共用，远端写等于生产写）。

## 绑定资源

| 绑定 | 类型 | 名称 / id | 用途 |
|---|---|---|---|
| `DB` | D1 | whl-club / `73154873-d5ae-42b0-a630-25f5ef60053d` | 平台自有库，**唯一可写**；迁移目录 `src/db/migrations` |
| `TOUR_DB` | D1 | whl / `ec3cc695-70bc-47ab-a454-5ca62ec22dd6` | 赛事系统库，只读（用户、队号、赛事绑定） |
| `AUTH_DB` | D1 | whl-auth / `b76d1129-77ae-4844-931c-1c7b00a9b048` | 认证中心库，只读（账号、团队、绑定码） |
| `SESSION_KV` | KV | `87e2d78308bc47e9b36dc6de53be0458` | 兼容模式会话 `sess:{token}`（与赛事/竞猜共用命名空间） |
| `MEDIA` | R2 | whl-media | 媒体资源 |
| `ASSETS` | Assets | `./web/dist` | 前端产物，SPA 回落，`/api/*` 优先走 worker |

密钥（wrangler secret，不入库）：`CRON_KEY`（定时/结算接口的 `X-Cron-Key`）、`AUTH_BIND_SECRET`（与认证中心 `BIND_SECRET` 同值）。

变量：`AUTH_MODE`、`OIDC_ISSUER`、`OIDC_CLIENT_ID`、`PUBLIC_CACHE_TTL_MS`。定时触发 `*/5 * * * *`（结算逾期、自动确认赛果、派发站内信）。

公开 GET（球员库列表、俱乐部目录）有进程内守护：同 IP 60 次/60 秒限流，响应走 TTL + stale-while-revalidate 缓存，TTL 取 `PUBLIC_CACHE_TTL_MS`（当前 20000ms），未配置或为 0 即旁路。缓存与限流都是 isolate 内的 `Map`，重启即清、多 isolate 不共享。

## 数据库迁移

`src/db/migrations/` 下 27 个文件（`0001_init` … `0027_players_sort_indexes.sql`），由 `wrangler d1 migrations apply whl-club` 管理，只对 `DB` 生效（另两库只读）。

新增迁移要同时把文件名追加到 `tests/d1.ts` 的 `MIGRATION_FILES`，否则测试夹具与迁移会脱节。

`0022`–`0027` 均未在生产 apply（生产迁移停在 0021）；其中 `0027` 会一次性写约 7.3 万行（4 条表达式索引 × 18301 名球员），D1 免费档日写配额 10 万行，部署日需单独安排。

## 测试

- 单元/集成：`npm test`，当前 30 个文件 / 387 个用例。`tests/d1.ts` 用本地 SQLite 执行真实迁移，`tests/tour-team-seed.ts` 提供赛事库夹具。
- 类型：`npm run typecheck`（三份 tsconfig）。
- e2e 冒烟：`npm run test:e2e`，8 个场景（首页、`/api/me`、公开接口、球员库翻页与排序、市场页、管理端、收件篮、无未捕获前端错误）。

## 目录结构

```
src/
  core/        纯函数域逻辑（config、市场/谈判/阵容规则、FC26 导入归一、税、成长）
  lib/         http、session、oidc、crypto、audit、guard（限流+缓存）、ratelimit
  worker/      路由装配与各业务模块（结算、通知、成长、窗口、奖品、冠名、设施…）
    routes/    对外端点：admin/ 九域（clubs、config、finance、growth、market、overview、players、reviews、seasons）+ auth/clubs/growth/market/negotiations/notifications/players/registration/seasons/transfers
  db/migrations/  D1 迁移
web/src/       前端：pages/（用户端 + admin/ + market/）、components/、lib/（api、auth、queries、adminQueries）
tests/         Vitest 用例与 D1/赛事库夹具
scripts/       运维与数据脚本，索引见 scripts/README.md
docs/          附属插件与集成说明
```

## 部署

生产域名 `club.whleague.win`（custom domain），Worker 名 `whl-club`。

```bash
npm run build && wrangler deploy
```

生产状态（2026-09-20 查证 `wrangler deployments list --name whl-club`）：最新部署 Version `6ed7446c-0a7e-40ed-b299-7e218b030dd5`（2026-09-19T13:58:25Z），即增量 16 的用户端重构；此前增量 15 为 Version `4d03eb57-cfd2-4d85-92e2-aa89f96528e2`。此后无部署，增量 17–24 的本地提交尚未上线，生产迁移停在 0021。

## 约定与边界

- 生产库（`DB` 远端）、赛事库与认证库的写操作、球员库大批量导入/重导（首灌已执行，勿重跑）、任何 `--remote` 命令都需要明确指令后才执行，见 [AGENTS.md](./AGENTS.md)。
- 平台只写自有 `DB`；读赛事/认证库只做只读查询。
- 离线导入分片 `scripts/players-import/sql/` 不入库（可由脚本按源数据逐字节复现，审计凭据是报告里的 sha256 清单）。
