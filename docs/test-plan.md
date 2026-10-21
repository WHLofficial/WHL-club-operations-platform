# 测试计划 · WHL-club-operations-platform

> 版本基线：v6.53.0（2026-10-20 滚动更新；初版 2026-09-27）。本计划按仓库现状编制，随功能增量滚动更新。
> 铁律（全程适用）：**最坏情况口径** —— 报「通过 / 零收益 / 无 downside」之前，先写出会让它失效的情形并取数。详见 AGENTS.md「测试」节与记忆 `testing-worstcase-principle.md`。

---

## 1. 总览

| 项 | 内容 |
|---|---|
| 被测对象 | Cloudflare Worker（Hono）API + React 19 SPA（`web/dist` 为 ASSETS 绑定），生产域名 `club.whleague.win` |
| 核心风险 | ① push 即部署（main 触发 CF Workers Builds）；② D1 免费档配额（读 5M 行/日、写按日）；③ 三库架构只有 `DB` 可写；④ 迁移 apply 后不可改；⑤ 公开缓存两级 + 代际键 purge |
| 测试分层 | L1 静态检查 → L2 单测 → L3 D1 集成 → L4 e2e 冒烟 → L5 生产只读回读 → L6 读量/性能治理 |
| 现有自动化基线 | typecheck 三份 tsconfig；Vitest **144 文件 / 2390 例**；e2e 冒烟 **29 场景 / 三视口**；D1 读量探针 `scripts/d1-read-audit/` |

## 2. 范围

**In scope（按功能域）**

| 功能域 | 入口 | 关键不变量 |
|---|---|---|
| 认证与会话 | `auth.ts`、`src/lib/oidc.ts`、`session.ts` | cookie `__Host-` 前缀；`AUTH_MODE` 两模式都通；401 语义 |
| 球员库 | `players.ts`、`PlayersLibrary.tsx` | 筛选/排序同源口径（v6.4.1 裁决）；keyset 游标无 `total`；标记 🔴🟡🟢 三档互斥 |
| 球员页 | `Player.tsx`、`player/` | 按 `fc_id` 寻址；徽章 12 银 / 3 金；PlayStyle 银/金分槽语义 |
| 成长系统 | `growth.ts`、`growth.test.ts` | 带徽章方案必须一次选满；离队回收 / 解约清空；配额 `quota:3` |
| 市场与转会 | `market.ts`、`offers.ts`、`transfers.ts`、`web/src/pages/market/` | 截止时刻落库两级判定；过线出价被触发器原子拦截；激活必附截图（R2 ≤5MB）；举报只建核查任务不自动改数据 |
| 谈判 / 合同 | `negotiations.ts`、`contract-ticks` | 合同刻度不落 DDL 默认；换队/解约清球衣号 |
| 财政账本 | `admin/finance.ts`、`ledger` | 账本只追加不篡改（audit-lock）；人类触发的财政写入必留痕（`origin` 列） |
| 赛季结算 | `seasons.ts`、cron `club-settle-tick` | cron 幂等；fail-closed；Sentry monitor 挂钩 |
| 球场档期（v6.53.0） | `src/core/venue.ts`、`src/worker/venue-ops.ts`、`web/src/pages/venue/` | 槽数 = 容量派生（2/3/4）再被 `activity_slots` 钳制（0 = 关闭）；饱和按同类序位；设施/声望三闸；关窗三条流水 + 一队一窗幂等；K=5 逐场递减、事件预置一场即清 |
| 注册合规 | `squad-rules.ts` | 规则 4.2.2 三档与标记口径一致 |
| 球队页 | `clubs.ts`、`Clubs*.tsx`、`club/CoachPanel.tsx` | URL id 一律 `clubs.id`（长期规则）；匿名详情 401 |
| 跨仓同步 | `squads.ts`（拉）、`internal.ts` + `tourClient.ts`（推）、admin `teamSync.ts` | 名册只拉不推；`team-upsert` 签名 fail-closed（未配密钥 503、错签 403）；幂等建档不覆写 |
| 媒体 | `media.ts`、R2 | 公开只读零 D1 读；写端点教练鉴权、key 服务端生成 |
| 管理端 | `admin/*`、`web/src/pages/admin/` | 审核/对账/导入各端点权限与审计 |
| 缓存与限流 | `guard.ts`、`cache-policy.ts` | 写路径必 purge 代际键；缓存键 `canonicalQuery` 归一 |

**Out of scope**

- 赛事仓（tour）、认证中心（auth）、竞猜（guess）三仓自身 —— 各仓自立计划；本计划只测本仓侧的契约端（签名、形状、超时、fail-closed）。
- 压测 / 多实例并发 —— 免费档单 Worker，无此场景。
- Figma 视觉比对 —— 本项目无设计稿交付物，UI 验收以真浏览器逐项复核代替（e2e + 手工）。
- 生产写操作演练 —— 未获明确指令一律不执行（危险清单）。

## 3. 测试环境

| 环境 | 用途 | 启动方式 |
|---|---|---|
| 本地 D1 + worker | L2/L3/L4 全部 | `npm run db:migrate:local` → `npm run dev`（8791） |
| Vite dev server | 前端即时预览 | `npm run dev:web`（/api 代理到 8791） |
| e2e | L4 黑盒冒烟 | 先 `npm run build` 再 `npm run dev`，`npm run test:e2e`（playwright-core + 本机 Chrome） |
| 生产 | 仅只读回读与只读探针 | `wrangler deployments list --name whl-club`、`scripts/d1-read-audit/*.mjs` |

测试数据：夹具在 `tests/tour-team-seed.ts` 等；真实迁移由 `tests/d1.ts` 用本地 SQLite 执行（**新增迁移必须追加进 `MIGRATION_FILES`**）；生产规模口径（18,301 人 / 570 在册 / 20 队）只用于读量推算，不落生产。

## 4. 分层策略与准入准出

### L1 静态检查（每次提交前必跑）
`npm run typecheck`（三份 tsconfig 全清）+ `npm run build`。e2e 前必须 build（dev 吃 `web/dist` 产物）。

### L2 单元测试（Vitest）
纯逻辑放 `src/core/` 零 IO（`core-zero-import.test.ts` 守护）。覆盖口径：
- 边界值与**最大组**（不是只测恰好命中的小样本）；
- 变异验证：按**将来最可能的重构方式**弄坏，确认失败的正是目标断言；
- 错误态：e2e 补失败态，单测补 4xx 语义。

### L3 D1 集成
- 真迁移 + 幂等重跑 + 「账本与库脱节」双验证；
- 排序索引：`tests/players-sort-indexes.test.ts` 的 `INDEXED_SORTS`（现 23 条）锁同源与 EXPLAIN 计划；
- **筛选/排序性能结论必须分两口径量**（筛选键 = 排序键 / ≠ 排序键），只量一格会得出错误配方（v6.4.1 教训）；脚手架 `scripts/d1-read-audit/probe-samesource.mjs`（只读、走管理通道）。

### L4 e2e 冒烟（发布闸门）
29 场景 / 三视口（桌面 / 窄屏 / 中屏）。已知本机限制：`TOUR_DB` 本地旧 schema ⇒ 球队页两端点用 `page.route()` 打桩（打完即撤），属预期。新功能进冒烟的标准：公开关键路径 + 登录关键路径 + 一个失败态。

### L5 生产只读回读（每次上线后）
最小集：`/api/health`、`/api/players?limit=1`、`/api/market/listings`、`/api/clubs`、`/api/squads` 全 200；线上首页资产 hash 与本地 dist **逐字一致**（⚠️ 比对前必须先在最新版本号下重构建，`__APP_VERSION__` 注入不同会导致假不一致）；受守卫端点验 **401/403 而非 404**（401 才证明路由在新代码里）。

### L6 读量与性能治理（每次涉及查询改动后）
`scripts/measure-d1-reads.mjs` 刷新 `measurements-after.json`（该文件由线上端点产生，**未部署前仍是旧代码读数**）；新形状按六轴量（同列 / 方向 / 选择性 / NULL 分布 / JOIN+LIMIT / 有无 TEMP B-TREE），成本按全量规模 18,301 人算。

**准入**：本地迁移可 apply、typecheck 全清、夹具可跑。
**准出（发版闸门）**：typecheck 三份全清 + Vitest 全绿 + e2e 全绿 + build 成功；涉及迁移的，迁移已 apply 到生产且只读核验列/索引在场；涉及查询的，L6 读数已刷新且无形状回归。

## 5. 手工测试用例（自动化未覆盖的关键流程）

> 以下用例需真实浏览器 + 登录态手工执行；每轮大版本（跨功能域改动）至少跑 P0，小版本按 touched 域挑用例。

### TC-MKT-001：挂牌 → 出价 → 截止 → 结算全流程（P0，市场域）

**前置**：教练 A（卖方）登录，持有一名可挂牌球员；教练 B（买方）登录另一浏览器档案；两号均有足额资金。

| # | 步骤 | 预期 |
|---|---|---|
| 1 | A 在球员页 SideOps 挂牌，设最低报价线 + 截止时刻 | 挂牌成功；`deadline_at` 落库为绝对时刻；转会区卡片出现 |
| 2 | B 出价**低于**最低线 | 即时退回（自动拒，与 `offer_auto` 无关）；B 资金未冻结 |
| 3 | B 出价达到最低线 | 成功；资金冻结（`fund_holds` 触发器在库层拦截过线出价） |
| 4 | 另一买方在截止时刻之后尝试出价 | 被拒（库层 + 展示层两级判定；存量 NULL 行回落实时算） |
| 5 | 等待截止 / 手动结算 | 最高价成交；资金划转；账本出现成对分录；`audit_log.origin` 正确 |
| 6 | A 查看通知 | 成交通知到达，金额与买方正确 |

### TC-MKT-002：激活证据与举报（P0，市场域）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 买方激活被挂牌球员，**不传截图** | 激活被拒（证据制：必附 QQ 通知截图） |
| 2 | 传 ≤5MB 图片再激活 | 成功；图片落 R2，key 服务端生成 |
| 3 | 传 >5MB 文件 | 4xx，文案可读（`fallbackMessage` 契约） |
| 4 | 被激活方（B 态）点举报 | 只建 `activation_report` 核查任务；**不冻结匹配窗、不改数据** |
| 5 | 管理端 `POST /api/admin/reviews/:id/resolve` 处理 | 任务收口，结果可见 |

### TC-PLR-001：球员库筛选 × 排序组合矩阵（P0，球员库域）

**前置**：本地库灌入夹具（含 NULL 值行：`market_value`、`foot`、`growth_gap` 任一侧 NULL 等）。

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 同键组合：`sort=growth_tier&growth_tier=1`（等值 + 同键排序） | 走裸列写法，无 `TEMP B-TREE`；结果与裸列语义一致（NULL 不进等值命中） |
| 2 | 异键组合：`sort=ca&position=中场` | 同源写法命中表达式索引 |
| 3 | 区间键：`growth_gap` 两侧任一为 NULL 的球员 | 套 `COALESCE` 同源写法下不被静默漏行/混入（双侧 `IS NOT NULL` 守卫语义核对） |
| 4 | 标记：`?marker=ge90,ge87` 多值 + 不落档球员 | 三档互斥；不落档整格空置，不进任何档命中 |
| 5 | EXPLAIN 每条 `INDEXED_SORTS` | `SEARCH … USING INDEX` / 覆盖索引扫描，无全表 `SCAN players`（覆盖索引扫描除外，见 L3） |

### TC-GRW-001：成长加点与徽章方案（P1，成长域）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 选择带徽章的加点方案但少选徽章 | 提交被拒（必须一次选满） |
| 2 | 选满后提交 | 属性 + 徽章落库；`player_playstyles` 明细正确（银值只落银槽 `PSID1-12`） |
| 3 | 徽章数推到上限（12 银 / 3 金）再尝试加 | 被拒，文案报 0-12 / 0-3 口径 |
| 4 | 球员离队 / 解约 | 徽章回收、china 明细清空、台账扣回——与谈判/转会路径各自验证（v3.3.0 海捞真自由身回归用例在 `growth.test.ts`） |

### TC-SYNC-001：跨仓建队联动与对账（P1，同步域）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 无签名 `POST /api/internal/team-upsert` | 403 `bad_signature`；**未配密钥**场景 503（fail-closed） |
| 2 | 金标准签名（`tests/team-sync.test.ts` 常量）打同端点 | 200；同 id 重放 200 `{created:false}` 且不覆写名字 |
| 3 | 本仓建俱乐部（赛事侧无此队） | 先推建队成功再本地建档；推送失败 502 且**不建档** |
| 4 | 管理端「球队同步对账」 | 三段差异正确；`apply` 每次重算 diff 再动手 |
| 5 | 缓存核验 | 建档后公开目录立即刷新（`WRITE_SCOPE_PREFIXES` 含 `/api/internal`，代际键已 bump） |

### TC-OPS-001：管理端财政与审核留痕（P1，账本域）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 人类触发一笔财政写入（球场 / 冠名 / 审核附加费） | 账本分录 + `audit_log` 行齐备，`origin='user'`、actor=人类 id |
| 2 | 机器路径（cron 结算）产生写入 | `origin='cron_tick'` / `'lazy_settle'`，actor=NULL |
| 3 | 尝试篡改历史账本行 | 被 audit-lock 拒绝 |

### 回归套件执行顺序（发版前）

1. **Smoke（~15 分钟）**：typecheck → `npm test` → build → e2e 29 场景。任一红 → 停，先修。
2. **P0 定向（30–60 分钟）**：按本次 diff 触及的功能域，执行上文对应 TC；涉及查询改动的跑 L6 探针两口径。
3. **Full 回归（发大版时）**：全部 TC + `INDEXED_SORTS` 全量 EXPLAIN + 迁移幂等重跑 + 生产 L5 清单。

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| push 到 main 即自动部署，误推未验证代码 | 中 | 高 | push 前跑 Smoke 全绿；docs 枚只本地 commit 不 push；一次授权不延续到返工轮 |
| D1 免费档读配额耗尽（历史事故 2026-09-21） | 中 | 高 | L6 治理 + 分级 TTL + 判断 D1 可用**不能**用 `/api/health`（只读 sqlite_schema 不受限），要看 `/api/players*` 实际响应 |
| 写配额贴顶时排迁移（batch 纪律：≈18,301 行/索引） | 中 | 中 | apply 前实测当日余量，按额度排条数；迁移 apply 后不可改，错了只能加下一个文件 |
| 写路径忘 purge 代际键 → 公开缓存最长 24h 陈旧 | 中 | 中 | 脚本直写 D1 必须手动 bump `cache:epoch:public`（v6.0.0 教训）；TC-SYNC-001 第 5 步核验 |
| 迁移文件未追加 `MIGRATION_FILES` → 夹具与迁移脱节 | 低 | 中 | 代码评审 checklist 固定项 |
| 跨仓同步方向错误覆盖数据（v6.0.0 号码被空值覆盖事故） | 低 | 高 | 名册只拉不推的铁律 + 同步前 `?dryRun=1` + 快照守卫四条 |
| 本地 `.wrangler/state` 陈旧态导致迁移报错 | 中 | 低 | 已知：schema 在而 `d1_migrations` 空时用 `--file` 落列，不重跑 migrate |
| e2e 只验渲染不验后端语义（打桩路径） | 低 | 中 | 后端形状与读量由 L2/L3 覆盖，e2e 只补关键路径 + 失败态 |

## 7. 缺陷报告约定

标题格式 `[域] 现象 when 操作`（例：`[市场] 出价 400 when 截止时刻带秒`）。必附：环境（本地 8791 / 生产）、复现步骤、期望 vs 实际、控制台/日志证据；UI 缺陷附截图与视口宽度（三视口断点以 e2e 脚本定义为准）。严重级：P0 = 数据错 / 资金错 / 全站 500；P1 = 主流程断无 workaround；P2 = 有 workaround；P3 = 视觉 / 文案。

## 8. 交付物与追踪

- 计划本文档；用例执行记录按轮次记在 `scratch/`（gitignore，不进提交）。
- 每增量收口：`ROADMAP.md` 验收节写实测值（typecheck / Vitest 文件数与用例数 / e2e 通过数 / 读量实测），`CHANGELOG.md` 同步。
- 覆盖缺口登记到 ROADMAP 待办，不静默丢弃（例：已登记的 FTS5 姓名子串、海捞池分页）。
