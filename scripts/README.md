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
| `e2e/smoke.mjs` | 平台 e2e 冒烟（9 场景），见下 | `npm run test:e2e` 或 `node scripts/e2e/smoke.mjs [baseUrl]` |
| `measure-d1-reads.mjs` | **D1 读量定标**（v3.2.0 步骤 1）：用真实路由 + 假 D1 抓下它实际执行的 SQL，内联参数后打生产读 `meta.rows_read`。30 个球员库形状 + 6 个成本探针 | `node scripts/measure-d1-reads.mjs [--local] [--dump] [--only=<id>] [--probes] [--json-out=<path>]` |
| `measure-surface-reads.mjs` | **全站读面普查**（v3.2.0 步骤 6）：同机制，覆盖 18 个 URL 读面 + 3 个 cron 任务；只执行 SELECT（GET 里可能藏 `settleOverdue` 的写） | `node scripts/measure-surface-reads.mjs [--local] [--dump] [--only=<id>] [--json-out=<path>]` |
| `d1-read-audit/` | 上面两支的**机件与报告**：`harness.mjs`（真实路由 + 假 D1 + 内联器 + 生产 `rows_read`）与 `README.md`（读量报告：形状表、成本模型、阈值与候选清单、普查与处置） | 见 `scripts/d1-read-audit/README.md` |
| `ledger-audit/` | **财政域留痕覆盖**（v6.3.1，v6.3.2 补 origin 列）：`README.md` 是普查报告（每个账本 kind 的写入点 / 审计 action / actor 来源 / 来源通道 origin、白名单理由、已知次级缺陷、生产实证），`coverage.sql` 是 12 条只读复核查询（含 `Σbalance − Σamount = 0` 守恒硬断言，S11 / S12 查 v6.3.2 的 origin 分布） | 见 `scripts/ledger-audit/README.md` |

## e2e/

`smoke.mjs` 用 `playwright-core` 驱动**本机 Chrome**（`C:/Program Files/Google/Chrome/Application/chrome.exe`，未装浏览器二进制）。前置：`npm run build` + `npm run dev`（默认打 `http://127.0.0.1:8791`，可用 `E2E_BASE` / `E2E_CHROME` 或第二个参数覆盖）。场景：首页渲染、`/api/me`、公开接口、球员库翻页与排序、市场页、管理端、收件篮、**球员库三视口（1280×900 / 900×800 / 375×812）截图与控件探针**、无未捕获前端错误；失败截图落 `scratch/e2e-fail-*.png`。

第 8 个场景除了截图，还断言只有真浏览器才有意义的三类事实（v3.1.1 加）：① 多选下拉面板整块落在视口内、`document.elementFromPoint` 命中的是面板本身、面板与触发器不重叠、高度 ≥160（唯一能抓「Popover 没进 top layer ⇒ 面板看得见点不到」的判据）；② 工具条与左栏各自的同行控件**底边逐对齐**（`align-items: flex-end` 下顶边本就允许不同），并把「同行控件 N 对」打进日志以防空集静默通过；③ 把翻页条文案临时换成线上量级（「共 34835 名球员 · 共 1742 页 · 第 1 页」）后量**页面级**横向溢出（量 `.library-pager` 自身没用：CJK 会换行，`scrollWidth` 恒等于 `clientWidth`）。

本地 D1 必须是**迁移全量已 apply** 的状态（`.wrangler/state/v3` 中 `d1_migrations` 若为空这层就靠不住，详见根 README 快速开始的「两个本地坑」），缺列时 `/api/players` 报 500、场景 4/8 会失败。

脚本会往**本地** KV 种一条 `sess:<随机 token>` 会话（`--local`，该命名空间与赛事/竞猜共用，`--remote` 等于生产写），结束时删除。**两条登录通道都种**（v3.1.1 起）：兼容模式走 KV `whl_session` → `sess:{token}`；OIDC 模式走 D1 `oidc_session` 行（`token_hash = sha256(cookie 值)`）+ `__Host-club_session` cookie，本地没有该表时那一半自动跳过，两个 cookie 同时带上。若 dev 用非默认 persist 目录（如 `wrangler dev --persist-to .wrangler/rehearsal`），必须用同一个目录跑 e2e（`E2E_PERSIST_TO=.wrangler/rehearsal`），否则会话种在另一边、页面会跳认证中心。

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

**批量执行器**：`prod-20260920-s9-contracts/exec-shards.mjs` 把「多行 SQL 分片」折成单行、按条数与命令行字节上限分批走 `--command`，逐批回显 `changes` / `rows_written`（默认 `--local`，加 `--remote` 才碰生产；`--dry` 只算批次）。用它要注意两条 Windows 实测限制：`--command` 只吃**单行** SQL（多行报 `incomplete input: SQLITE_ERROR [code: 7500]`）；命令行受 `cmd.exe` 字节数约束（中文按 3 字节算，约 5.5KB 的批会被拒「命令行太长」），故脚本压到 4000 字节 / 10 条。另有三条守卫：语句含 shell 元字符（`"` `%` `&` `|` `<` `>`）直接拒绝（SQL 是塞进 `--command "…"` 交 shell 的，元字符会被 shell 抢先解释）；`wrangler` 在 Windows 上偶发子进程崩溃（exit `3221226505` / `UV_HANDLE_CLOSING` 断言，与 SQL 无关），重跑即过，但自动重试默认**关**（批中途崩溃时前面的语句可能已落库），工件带守卫、重放 `changes = 0` 时才用 `--retry=3` 打开。

## prod-20260920-*（一次性生产工件；四条均已执行）

| 目录 | 内容 | 状态 |
|---|---|---|
| `prod-20260920-s9-window-baseline/` | S9 窗基线：SQL 直造「季初常规窗（season 9 / window_seq 1）已关」一条，再把 62 场已确认比赛的 `window_seq` 由 0 改 1（另 `match_attendance` 50 行） | **已执行**（2026-09-20 经 `--command` 逐条跑；changes 1 / 62 / 50 与期望一致，验收 9 项全中，见该目录 README 第十节） |
| `prod-20260920-s9-club-align/` | s901 队壳文件 → 570 人队籍对齐（16 人控队 + 4 CPU）：481 条 `UPDATE players SET club_id`（改队 158 + 认领 323），只写队籍一列；排在合同批之前跑 | **已执行**（2026-09-21 经 `--file` 逐片跑；481 语句 / rows_written 962 / touched 481；验收：已对齐 570、剩余差异 0、入籍 874、自由身 17427，逐队人数与预估逐队吻合；见该目录 README 第十四节） |
| `prod-20260920-s9-abilities/` | FC Editor s901 → 20 队（含 CPU）570 人现值能力（Case B：只改 `ca`/`pa` + `json_set` 合并 34 项能力项与 `RoleID1-5`/`PSID1-15`，**不动 `base_ca`/`$.CA`/`$.PA`/队籍**） | **已执行**（2026-09-21 经 `--file` 两片：200 + 57 条语句 / rows_written 400 + 112 / changes 201 + 58；逐行复核 `--verify` 源行 570 / 命中 570 / 差异 0；验收六列 —— `touched` 257、`delta_gt0` 254、`null_core` 0、`gold_rows` 35、`gold_slots` 36、`ca_vs_attr` 254；见该目录 README 第十三节） |
| `prod-20260920-s9-contracts/` | 一线队-S9.csv → 16 人控队合同：队籍对齐后 **462 行全部可导**（原预测 378 = claim 298 + create 80 已归零）；462 条带守卫的 `INSERT … SELECT`（10 片）+ 生成器 `gen-contracts-sql.ts`（含 `--verify`）+ 执行器 `exec-shards.mjs` + 预检/验收/回滚/报告 | **已执行**（2026-09-21：先 apply 迁移 0028，再经 `exec-shards.mjs --remote` 跑 10 片 = 462 语句 / changes 462 / rows_written 1386；逐行复核 462 / 命中 462 / 差异 0；验收 11 列全中 + 逐队 16 行与效力年分布全中；`players` 未被动、守卫表仍 0；见该目录 README 第十一节） |

四个目录都受上面「执行纪律」约束。硬前置（**均已满足**）：合同批要求 **迁移 0028 已 apply**（2026-09-21 已 apply；离线 SQL 通道显式写刻度列，**不需要**先部署v3.0.0 —— 该部署仍是网页面板通道的残留风险，见该目录 README §11.8）；能力批只依赖 `json_set`（已在生产只读验证可用）；队籍批只写 `players.club_id`（该列**无外键**，`--file` 可用）且要求 `contracts`/`listings`/`registrations`/`negotiation_sessions`/`transfers`/`bids` 全为 0（执行前 `01-precheck.sql` 复核）。

建议顺序：**队籍对齐 → 合同 → 能力**（队籍先对，合同批才不带 84 行冲突；能力与另两批无依赖，可任意时点插入）。四批已于 2026-09-21 全部执行完毕。

## prod-20260921-*（一次性生产工件；已执行）

| 目录 | 内容 | 状态 |
|---|---|---|
| `prod-20260921-s9-free-leftover/` | S9 队籍收尾：把「平台在册但不在联盟世界 20 队名单里」的 **304 人**释放为自由身（`club_id → NULL` + `status → 'free'`，用户 2026-09-21 裁定口径）；304 条幂等 UPDATE 2 片 + 回滚 + 预检/验收/报告/README | **已执行**（2026-09-21：304 语句 / rows_written 912；验收六列全中 —— 在册 570、自由身 17731、`free` 304、`still_rostered` 0、`status_not_free` 0、`touched` 304；逐队名单回到联盟世界人数） |
| `prod-20260921-s9-free-status/` | 全部自由身补标 `status = 'free'`（用户 2026-09-21 裁决「球员库里只要没在 20 队的 status 都应该是 free」）：一条带守卫的批量 UPDATE，把其余 **17427** 名既存自由身（`status` 仍为 `normal`）补齐；只写 `status`/`updated_at` 两列，回滚按 `updated_at` 时间戳精确圈定 | **已执行**（2026-09-21：单条 UPDATE / rows_written 34854 / `touched` 17427；验收七列全中 —— 自由身 17731 全 `free`、在册 570 全 `normal`、`bad_free_with_club` 0、守卫表全 0） |

两批都只写 `players.club_id` / `players.status`（两列都**无外键**，`--file` 可用），要求 6 张守卫表全 0；排在合同批之前、与另两批无 fc_id 交集。详见各自 README（含逐队分布、验收判据与本地演练记录）。

## prod-20260926-*（一次性生产工件）

| 目录 | 内容 | 状态 |
|---|---|---|
| `prod-20260926-rollback-stadium-expand/` | 回滚 2026-09-21 慕尼黑1860（club 33）那笔球场扩建：`stadiums` 容量 12500→12000、建设券 0.13→0；**按补偿分录口径**给 `ledger_accounts.balance` 加回 0.50 并插一条 `manual_adjust` 流水指回原流水（**不删不改原 id=141**，账本只增，删行会破坏 `balance_after` 链）。3 句同批 + 预检 / 验收 / 反向回滚 / README | **已执行**（2026-09-26 经 `--file`：`changes=4`、`last_row_id=163`；验收全绿 —— 容量 12000 / 券 0 / club 33 余额 56.51 / `manual_adjust` 1 条 / 原 `stadium_expand` 仍在 / **守恒断言 `Σbalance − Σamount = 0`**） |
| `prod-20260926-audit-origin-backfill/` | **审计来源通道回填**（v6.3.2）：把迁移 `0039` 之前的历史 `audit_log` 行（100 行）的 `origin` 按旧代码能确凿认定的通道填上 —— `lazy_settle`（actor 为 NULL 的结算类）/ `cron_tick`（`actor = 0` 的自动赛果确认）/ `backchannel`（`actor = 0` 的全端登出）/ `user`（`actor` 非空 ⇒ 人类入口）。每条都带 `origin IS NULL` 守卫（可重跑），回滚用 `id <= 100` 边界。预检 / 回填 / 验收 / 回滚 / README | **迁移已 apply，回填未执行**（`npm run db:migrate:remote` 已于 2026-09-26 执行、`0039` 落地；只跑过只读预检：100 行 / 命中 `cron_tick` 74、`backchannel` 3、`lazy_settle` 0、`user` 23；`02-backfill.sql` 需另行授权） |

口径详见该目录 README。触发原因与留痕普查见 [`ledger-audit/README.md`](./ledger-audit/README.md)：这是一笔**没有审计留痕**的支出（操作人靠邻行 `club_bind` 反推），v6.3.1 已把球场三端点、冠名解约、审核附加费与关窗批的留痕补齐，并用 `tests/ledger-audit-lock.test.ts` 锁死。

## revenue-import/

从 revenue 插件库迁主场域数据（只迁 `stadiums` / `club_facilities`）。

| 文件 | 用途 | 性质 |
|---|---|---|
| `export_revenue.py` | 读插件 SQLite 导出平台主场域 SQL | 产工件 |
| `stadium-import-prod.sql` | 显式 `club_id` 版的导入工件 | **已执行** |
| `stadium-import-report.md` | 迁移报告 | — |

用法：`python scripts/revenue-import/export_revenue.py "E:/Downloads/revenue_system (2).db"`。注意必须用显式 `club_id` 的版本——靠队名子查询匹配不到时会落 NULL 并触发 rowid 自增造脏行。
