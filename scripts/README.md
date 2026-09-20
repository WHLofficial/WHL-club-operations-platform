# scripts/ 索引

运维、数据与联调脚本。本目录多数脚本只读或只产工件，但有几个直接写生产库，动手前先看清「性质」列。

| 性质 | 含义 |
|---|---|
| 只读 | 只读数据或只产工件，可随时跑 |
| 产工件 | 生成 SQL / 报告供人工复核，本身不写库 |
| 写生产 | 直接写远端库，**需明确指令**，一次授权不延续 |
| 未执行 | 一次性生产工件已备好但尚未执行，等管理组下令 |

## 顶层

| 脚本 | 用途 | 用法 |
|---|---|---|
| `calibrate_tokens.py` | UI_DESIGN §6-1 量化校色：对徽章原图取四主令牌候选值并算白字对比度 | `python scripts/calibrate_tokens.py <badge.jpg>` |
| `gen_ref_json.py` | 从 FC26db 源抽 NationID / PlayStyleID / PositionID / RoleID / TeamID 五表写 `web/assets/ref/*.json` | `python scripts/gen_ref_json.py [FC26db xlsx 路径]`（默认 `E:\Downloads\FC26db20251217_fixed.xlsx`） |
| `list_wrangler.ps1` | 列本机 wrangler 相关 node 进程的 PID 与命令行（排查端口占用） | PowerShell 直接跑 |
| `smoke-oidc-local.mjs` | 双服务联调冒烟：club 8795（OIDC）× auth 8792（真认证中心），手推 authorize → 登录 → callback → `/api/me` → back-channel 登出 → end_session | 见文件头注释；需先起 auth 仓本地服务，注意 auth 登录限流 5 次/15 分钟 |
| `e2e/smoke.mjs` | 平台 e2e 冒烟（8 场景），见下 | `npm run test:e2e` 或 `node scripts/e2e/smoke.mjs [baseUrl]` |

## e2e/

`smoke.mjs` 用 `playwright-core` 驱动**本机 Chrome**（`C:/Program Files/Google/Chrome/Application/chrome.exe`，未装浏览器二进制）。前置：`npm run build` + `npm run dev`（默认打 `http://127.0.0.1:8791`，可用 `E2E_BASE` / `E2E_CHROME` 或第二个参数覆盖）。场景：首页渲染、`/api/me`、公开接口、球员库翻页与排序、市场页、管理端、收件篮、无未捕获前端错误；失败截图落 `scratch/e2e-fail-*.png`。

脚本会往**本地** KV 种一条 `sess:<随机 token>` 会话（`--local`，该命名空间与赛事/竞猜共用，`--remote` 等于生产写），结束时删除。当前默认兼容模式；若 dev 以 OIDC 模式跑，需改种 `oidc_session` 行 + `__Host-club_session` cookie（文件头注释有说明）。

## players-import/

FC26 源数据导入工具链。走离线脚本而不是管理端网页导入的原因见 [README.md](./players-import/README.md)（网页端点要 OIDC 会话，脚本拿不到）。

| 文件 | 用途 | 性质 |
|---|---|---|
| `generate-sql.ts` | 读 FC26db 源，复用端上 `normalizeImportBatch` + `upsertStatement` 生成分片 SQL 与报告（含 sha256 清单） | 产工件 |
| `dry-run.ts` | 只读试算：校验结果、批次计划、队籍覆盖、422 失败面 | 只读 |
| `overlay-missing.ts` | 30 行缺 `naID`/`FootID` 球员的增量补录（幂等） | 产工件 |
| `missing-fields-30.csv` | 上者的补值清单 | — |
| `nation-id-reference.csv` | 国籍 id 参照表 | — |
| `players-import-report.md` | 首灌报告（含 sha256 清单） | — |
| `players-import-overlay-report.md` | 补录报告 | — |
| `sql/players-import-01..19.sql` | 首灌分片（**gitignored**，可由脚本逐字节复现） | **已执行**（2026-09-18，19 片逐片 `--file` 直写生产） |

用法：`node scripts/players-import/generate-sql.ts [xlsx路径] [每片语句数] [--mode minor|major]`（默认源 `E:/Downloads/FC26db20251217_fixed.xlsx`、1000 语句/片）。执行分片用 `npx wrangler d1 execute whl-club --remote --file <片>`——首灌分片不含外键依赖，`--file` 可行；**但写生产，需明令**（含外键或大事务的工件另有纪律，见下方「执行纪律」）。

球员库**首灌已于 2026-09-18 执行**：源 18407 数据行 − 76 重复 = 18331 唯一行，入库 **18301**（2026-09-20 查生产 `SELECT COUNT(*) FROM players` = 18301），被校验拦下 30 行（源值缺 `naID` / `FootID`）；**30 人缺字段补录（`overlay-missing.ts`）尚未执行**。首灌后勿再重跑全量分片。

## rekey-team/

换队号（rekey）**只读预演**工具：核查三库现状、出硬闸、产分步 SQL 工件与执行 README，本身不写任何库。

```bash
node scripts/rekey-team/rekey-team.mjs --old 47 --new 131681 [--guard 'AC米兰(CPU)'] [--touch-club] [--remote] [--out DIR]
```

默认 `--local`；`--touch-club` 是换壳模式（`clubs.id` 一起搬），缺省是收口模式（只换游戏队号）。口径与实战记录见 [README.md](./rekey-team/README.md)。

## prod-20260919-*（一次性生产 SQL 工件）

| 目录 | 内容 | 状态 |
|---|---|---|
| `prod-20260919-increment14/` | 00 迁移记账 / 01 CPU 队 / 02 回填 CPU club_id / 03 换队号 / 04 认证侧队号关联，各带期望 changes 与回滚语句 | **已执行** |
| `prod-20260919-increment15/001-add-bid-paused.sql` | 迁移 0021 `listings.bid_paused` | **已执行** |
| `prod-20260919-milan-rekey/` | 01 赛事库换队号 / 02 认证库队号，四 id 空间统一（米兰 47 → 131681） | **已执行** |
| `prod-20260919-roster-backfill/` | 16 队队籍回填，444 人幂等 UPDATE，只写队籍不造合同 | **已执行**（2026-09-20，444 行；复查 assigned 全库 551 = CPU 4 队 107 + 本批 444，free 17750） |

**执行纪律**：含外键或大事务的工件必须走 `--command` 或 D1 REST `/query`，`--file` 通道会让 `PRAGMA defer_foreign_keys` 失效，整批回滚。执行前先看该目录 README 的核查清单与期望 changes。

## prod-20260920-*（一次性生产工件；窗基线已执行，两条导入未执行）

| 目录 | 内容 | 状态 |
|---|---|---|
| `prod-20260920-s9-window-baseline/` | S9 窗基线：SQL 直造「季初常规窗（season 9 / window_seq 1）已关」一条，再把 62 场已确认比赛的 `window_seq` 由 0 改 1（另 `match_attendance` 50 行） | **已执行**（2026-09-20 经 `--command` 逐条跑；changes 1 / 62 / 50 与期望一致，验收 9 项全中，见该目录 README 第十节） |
| `prod-20260920-s9-contracts/` | 一线队-S9.csv → 16 人控队合同：378 行可导（claim 298 + create 80）、84 行异队冲突、164 行无目标队；README 含映射规则、分类预测与 6 个裁决点 | **未执行**（工件待产） |
| `prod-20260920-s9-abilities/` | FC Editor s901 → 20 队（含 CPU）570 人能力：只改 `ca`/`base_ca`/`pa` + `json_set` 合并 34 项能力与 `height`/`weight`/`weakfoot`，**不动队籍** | **未执行**（工件待产） |

三个目录都受上面「执行纪律」约束。另外两条硬前置：合同批要求 **迁移 0028 已 apply 且增量 25 已部署**（否则 `service_ticks`/`protection_ticks` 写不进去，或落成「无保护期」）；能力批只依赖 `json_set`（已在生产只读验证可用）。

## revenue-import/

从 revenue 插件库迁主场域数据（只迁 `stadiums` / `club_facilities`）。

| 文件 | 用途 | 性质 |
|---|---|---|
| `export_revenue.py` | 读插件 SQLite 导出平台主场域 SQL | 产工件 |
| `stadium-import-prod.sql` | 显式 `club_id` 版的导入工件 | **已执行** |
| `stadium-import-report.md` | 迁移报告 | — |

用法：`python scripts/revenue-import/export_revenue.py "E:/Downloads/revenue_system (2).db"`。注意必须用显式 `club_id` 的版本——靠队名子查询匹配不到时会落 NULL 并触发 rowid 自增造脏行。
