# WHL-club-operations-platform

WHL 水友联赛的俱乐部运营平台：球员库、阵容与注册、转会市场与谈判、俱乐部财政、设施与冠名、赛果结算与站内信。

单体仓库，一个 Cloudflare Worker 同时提供 API 与前端静态资源（React SPA 构建产物）。

| 项 | 内容 |
|---|---|
| 规则依据 | [PRD.md](./PRD.md)（功能全景与裁决）· [TECH_DESIGN.md](./TECH_DESIGN.md)（架构/数据模型/状态机/公式）· [UI_DESIGN.md](./UI_DESIGN.md)（复古档案室主题） |
| 开发计划 | [ROADMAP.md](./ROADMAP.md)（v0.1.0 起，逐增量记裁决、交付、验收、部署） |
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

两个本地坑（实测踩过）：① 若 `.wrangler/state/v3` 里的 D1 是**用别的方式建的**（`d1_migrations` 表为空），`npm run db:migrate:local` 会从 `0001` 重放并报 `table players already exists`；此时要按缺的迁移手工补（例如 `0028` 的 `contracts.service_ticks / protection_ticks / signed_season / signed_window_seq` 与 `season_windows.is_temporary`、`0027` 的四条排序索引、`0029` 的三条 + `0030` 的一条，补 `0030` 时若报 `index idx_players_club_ca already exists` 说明已补过），否则 `/api/players` 直接 500。② 同一端口上**不要同时跑两个 `wrangler dev`**：Windows 下两个进程会同时听着同一端口，请求随机落到任一个，表现为「HTML 是新的、带 hash 的 JS 却 404 → SPA 兜底回 `200 text/html`」、页面白屏（`Failed to load module script: ... MIME type of "text/html"`）。

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

密钥（wrangler secret，不入库）：`CRON_KEY`（定时/结算接口的 `X-Cron-Key`；生产 2026-09-22 已配，本地联调写进 `.dev.vars`）、`AUTH_BIND_SECRET`（与认证中心 `BIND_SECRET` 同值）、`TEAM_SYNC_SECRET`（v6.1.0：`/api/internal/team-upsert` 的 HMAC 密钥，与赛事仓 `TEAM_SYNC_SECRET` **同值**；生产 2026-09-23 两侧已配）。

变量：`AUTH_MODE`、`OIDC_ISSUER`、`OIDC_CLIENT_ID`、`TOUR_API_BASE`（v5.0.1 起为 `https://tour.whleague.win`，排名代理与球队建档出站都用它）（`PUBLIC_CACHE_TTL_MS` 仍受支持，是缓存 TTL 的显式覆盖、配 `0` 即旁路；生产不配，口径在 `src/lib/cache-policy.ts`）。定时触发 `*/5 * * * *`（结算逾期、自动确认赛果、派发站内信）。

公开 GET（球员库列表、球员名册、俱乐部目录）有守护：同 IP 60 次/60 秒限流，响应走**两级缓存**——L1 进程内 + L2 边缘 Cache API（跨 isolate）。TTL 分级：球员列表 1h、名册与目录 24h；**新鲜度靠写路径主动 purge**（代际键，写后本 isolate 立即失效，跨 colo 靠 KV 版本号，边缘 KV 传播最长 60s），TTL 只是 purge 失效时的自愈上限。写路径 purge 挂在两处中心钩子：`/api/*` 的 middleware（非 GET/HEAD 且响应 2xx 且路径前缀命中）与 cron tick（真改了数据才 purge）。

## 数据库迁移

`src/db/migrations/` 下 36 个文件（`0001_init` … `0036_players_sort_indexes_batch5.sql`），由 `wrangler d1 migrations apply whl-club` 管理，只对 `DB` 生效（另两库只读）。

新增迁移要同时把文件名追加到 `tests/d1.ts` 的 `MIGRATION_FILES`，否则测试夹具与迁移会脱节。

`0001`–`0036` 已 apply 到生产（`0022`–`0027` 于 2026-09-20 完成；`0028`（v3.0.0，纯加列，无回填）于 2026-09-21 随合同导入批完成；`0029`（v3.2.0，三条排序表达式索引）与 `0030`（v3.2.0，`players(club_id, ca DESC, id)`）于 2026-09-22 分别单独 apply；`0031`（v3.3.0，`player_playstyles`）于 2026-09-22T11:40Z apply；`0032`（v4.0.0，显示名 5 列）与 `0033`（v4.0.0，`idx_players_sort_name`）于 2026-09-23T09:29Z 同轮 apply）。提醒：`0027` 的四条表达式索引一次性写约 7.3 万行（4 × 18301 名球员）、`0029` 的三条约 5.5 万行、`0030` 约 1.8 万行，D1 免费档日写配额 10 万行——同类大迁移要单独安排，别和别的写叠加（2026-09-22 当天 `0029` + `0030` 合计用掉 73.2%；`0033` 的 `idx_players_sort_name` 另约 1.83 万行）。**`0034`（遗留项第 5 节下一批次：`uid` / `ps` / 初始视图 `ca` 三条排序索引）于 2026-09-24 单独 apply 到生产** —— 一次写 ≈5.5 万行，实测记账 **54,919 行**（占当日写配额 54.9%，在自留预算 ≤6 万内）；收益实测见 `scripts/d1-read-audit/README.md` §5.5。**`0035`（`position` / `growable` 两条排序索引）于 2026-09-24T23:54Z、`0036`（`badges` / `base_ca` / `foot` 三条）于 2026-09-25T00:00Z apply** —— 拆两批是因为 2026-09-24T23:49Z 实测账号池当日余量只有 ≈44,541 行（2 条放得下、3 条会超）；实测记账 `0035` **36,602 行**（把当日 `whl-club` 写推到 **91,604 行 = 91.6% 配额**，贴顶用满）、`0036` **54,909 行 = 54.9%**；收益实测见 `scripts/d1-read-audit/README.md` §3.3。**索引在涨：`players` 现有 21 条索引**（16 条 `idx_players_sort_*` + 3 条普通索引 + 2 个 UNIQUE 自动索引），每多一条就多 18,301 行/次全量重导成本（口径见 `scripts/players-import/README.md`）。**迁移一旦 apply 到生产就不得再改**（要改就新增下一个文件），否则线上 `d1_migrations` 记账与新环境重放会漂移。

## 测试

- 单元/集成：`npm test`，当前 50 个文件 / 724 个用例（含 `web/src/**` 的前端组件测试，放在 jsdom 环境）。`tests/d1.ts` 用本地 SQLite 执行真实迁移，`tests/tour-team-seed.ts` 提供赛事库夹具。
- 类型：`npm run typecheck`（三份 tsconfig）。
- e2e 冒烟：`npm run test:e2e`，11 个场景（① 首页渲染 ② `/api/me` 会话 ③ 公开接口 ④ 球员库左栏/翻页/排序 ⑤ 市场页 ⑥ 管理端 ⑦ 收件篮 ⑧ 球员库三视口 ⑨ 球队页三视口 ⑩ 球队页匿名引导与 `/club` 兜底 ⑪ 无未捕获前端错误；⑧ 在三视口（1280/900/375）下额外断言多选下拉面板整块落在视口内且 `elementFromPoint` 命中的是面板本身、同行控件底边逐对齐、翻页条文案不撑出横向滚动；截图落 `scratch/`）。第 8 个场景在三视口（1280/900/375）下额外断言：多选下拉面板整块落在视口内且 `elementFromPoint` 命中的是面板本身、同行控件底边逐对齐、翻页条按线上量级文案不撑出页面横向滚动；截图落 `scratch/`。

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

生产状态（2026-09-23 查证 `wrangler deployments status --name whl-club`）：生效 Version **`bd467125-2ccb-4516-86b4-f963bdc5fda6`**（2026-09-23T14:25:21Z，Source `wrangler`，v6.1.0 收口部署；线上首页资产 `index-CpdvAUf3.js` + `index-CgbAjyeh.css`，与本地 `web/dist/assets/` 逐字一致）。v4.0.0–37 的完整版本链与逐版说明见 [AGENTS.md](./AGENTS.md)「当前状态」；以下链截至 2026-09-22：最新部署 Version **`627508e5-f7c6-4e6d-90a2-5f95a82466bb`**（2026-09-22T07:02:52Z，含v3.1.1 + v3.2.0 全部步骤 + **v3.2.1**；`wrangler deploy` CLI 回显的 Current Version ID 同为 `627508e5-…`——v3.2.1 首次与 `deployments status` 一致，Total Upload 533.62 KiB / gzip 127.47 KiB；线上 `/players` 引用 `index-C_n2o0KE.js`，与本地构建同名）；上一版 `7c5b5879-0003-421c-9bf2-6026a4674afe`（2026-09-22T05:25:16Z，含v3.1.1 + **v3.2.0 全部步骤**；`wrangler deploy` CLI 回显的 Current Version ID 为 `7cb80a9b-c213-4ed2-b2f3-183c304808ec`，Total Upload 533.53 KiB / gzip 127.46 KiB）；上一版 `91635aca-92d3-4921-8208-d9f7912aaec7`（2026-09-22T04:19:18Z，含v3.1.1 + v3.2.0 步骤 0–5；CLI 回显 `4d6119f4-aa22-47ea-979b-ce9a46c6736f`，Total Upload 532.29 KiB / gzip 126.89 KiB）；再上一版 `31c58da7-6611-4634-8c22-678a0f9e6876`（2026-09-22T02:17:47Z，Source `Secret Change`——2026-09-22 配 `CRON_KEY` secret 触发的换版，**代码与 `3455087e` 相同**，含v3.1.1）；再上一版 `3455087e-4bdb-4a63-b40f-8df943d80892`（2026-09-21T17:13:35Z，含v3.1.1；CLI 回显 `ff9c2e91-25a0-4ce1-be19-d9b50bc0a136`）；再上一版 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（2026-09-21T14:39Z，含v3.0.0–26；CLI 回显 `81e93c74-228f-4fee-9d87-9fecf602d360`）；此前v2.3.0–24 为 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`、v2.2.0 为 `6ed7446c-0a7e-40ed-b299-7e218b030dd5`、v2.1.0 为 `4d03eb57-cfd2-4d85-92e2-aa89f96528e2`。生产 vars 自v3.2.0 起不再配 `PUBLIC_CACHE_TTL_MS`（缓存口径在 `src/lib/cache-policy.ts` 的分级表里）。生产迁移已到 `0033_players_name_sort_index.sql`（`0032`/`0033` 于 2026-09-23T09:29Z 同轮 apply；`d1 migrations list --remote` 报无需 apply）。v3.2.0 部署后最小化回读（8 请求）全部符合预期：列表响应**已无 `total`**、只剩 `nextCursor`；`/api/players?limit=1` 一次只读 **56 行**（治理前 18,819）。生产数据：球员库 18301 人（全库入籍 570，其中 444 人于 2026-09-20 回填、481 人于 2026-09-21 按 s901 队籍对齐后归入 20 队；自由身 17731 全部 `status='free'`；16 人控队合同 462 行已于 2026-09-21 落库）。仍未执行的生产写：球员库 30 人缺字段补录。

⚠️ **2026-09-21 生产 D1 免费档行读配额耗尽（当日事故）**：`scriptThrewException` 自 15:20:22Z 起、cron 每 5 分钟失败一次，`/api/players*` 一律 500，根因 `D1_ERROR: Your account has exceeded D1's free tier daily row read limit`（当日 whl-club `rowsRead` 4,350,235，免费档上限 5,000,000 行/日）。限额按 **UTC 零点**归零后自动恢复（2026-09-22T00:00:34Z 起 cron 恢复成功）。排查时注意：`/api/health`（只读 `sqlite_schema`）、`wrangler d1 execute --remote`（管理通道不受限）与 `/api/clubs/directory`（缓存键是固定串、stale 刷新还吞错）都**不能**用来判断 D1 是否可用。部署后的最小化生产回读已于 **2026-09-22T00:01:52Z 补做**：`/api/health`、`?sort=name`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster` 全 200，银/金分槽语义实测成立。读消耗的量化与治理见 ROADMAP v3.2.0。

## 约定与边界

- 生产库（`DB` 远端）、赛事库与认证库的写操作、球员库大批量导入/重导（首灌已执行，勿重跑）、任何 `--remote` 命令都需要明确指令后才执行，见 [AGENTS.md](./AGENTS.md)。
- 平台只写自有 `DB`；读赛事/认证库只做只读查询。
- 离线导入分片 `scripts/players-import/sql/` 不入库（可由脚本按源数据逐字节复现，审计凭据是报告里的 sha256 清单）。
