# rekey-team：换队号预演工具（增量 17）

给定旧/新游戏队号，对三库做**只读预演**（不写任何数据），产出米兰口径（`../prod-20260919-milan-rekey`）的分步 SQL 工件 + 执行 README。真正的执行永远走 README 里印好的 wrangler 命令，由人工复核后进行；生产执行须管理组明确下令。

## 四个 id 空间与检查口径

| 库 | 数据库 | 「游戏队号」所在列 | 说明 |
|---|---|---|---|
| tour | `whl` | `team.id` | 主键即游戏队号 |
| auth | `whl-auth` | `team.tour_team_id`（`team.club_id`） | `team.id` 是内部序号 1..N，**不能**拿它对游戏队号 |
| club | `whl-club` | `clubs.id` | 主键即游戏队号（增量 17 起新建队强制） |

## 覆盖面（按列名自动发现，逐表计数）

- **tour**：所有 `*_team_id` 列（player/entry/team_member/tactic/injury/…）+ `team.id` 父行
- **auth**：`team.tour_team_id`；`--touch-club` 时加 `team.club_id`
- **club**（仅 `--touch-club`）：所有 `*_club_id` 列 + `home_team_id`/`away_team_id`/`winner_team` + `clubs.id` 父行
- **只报数永不生成 UPDATE**：`*_target_id` 类撞号高发列（`audit_log.target_id` 里 match id 撞号是米兰口径的著名陷阱）

## 用法

```bash
# 收口模式（米兰口径）：平台 clubs.id 已是新号，只搬 tour 与 auth
node scripts/rekey-team/rekey-team.mjs --old 47 --new 131681 --guard 'AC米兰(CPU)'

# 换壳模式：clubs.id 一起从 old 搬到 new，club 库子表生成 03 工件
node scripts/rekey-team/rekey-team.mjs --old 2 --new 997 --guard '旧队名' --touch-club

# 生产预演（--remote 查真库，auth 侧自动切到 ../WHL-auth-service 执行）
node scripts/rekey-team/rekey-team.mjs --old 47 --new 131681 --guard 'AC米兰(CPU)' --remote
```

- `--guard '队名'`：auth UPDATE 的 name 守卫，强烈建议总是带（防新号将来被别的队占用时误改）
- `--out DIR`：工件输出目录，默认 `scripts/prod-<日期>-rekey-<old>-to-<new>`
- `--auth-cwd`：覆盖 auth 仓目录（默认 `../WHL-auth-service`，仅 `--remote` 时用到）

## 硬闸（预演不过不产出工件）

1. 旧号在任一涉及库里不存在（按上表口径查）
2. 新号在任一涉及库里已被占用

另报告但不拦截：触发器/视图清单（存在时需人工确认生成 SQL 是否需要配套处理）。

## 生成物

- `01-tour-rekey-team-id.sql`：`PRAGMA defer_foreign_keys = ON` + 子表 UPDATE + `team.id` 父行，子表即使 0 行也写上（幂等保障）
- `02-auth-tour-team-id.sql`：`tour_team_id`（及换壳模式的 `club_id`）单行 UPDATE，带 name 守卫
- `03-club-rekey-clubs-id.sql`（仅换壳模式）：同 01 结构，`clubs.id` + 全部子表
- `README.md`：预演核查报告 + 逐条执行命令 + 实测记录表格模板 + 回滚说明

## 执行通道硬约束（同米兰口径）

`PRAGMA defer_foreign_keys = ON` **只在 `--command` / REST `/query` 通道生效**，`--file` 导入通道下失效——01/03 必须把文件去掉注释后用 `--command` 执行；02 是单行 UPDATE 无 defer 需求，`--file` 也可以。批中任一语句失败整批回滚。

## 已知边界

- Windows 下工具内部直调 `node node_modules/wrangler/bin/wrangler.js`（`npx`/shell 壳会打碎带空格的 SQL）
- wrangler 本地起 workerd 偶发 `fetch failed`，工具自动重试至多两次
- D1 的 `UNION ALL` 复合查询上限极低（实测 8 条即拒），计数探针用标量子查询并列（一批 100 个）
- 本地演练共享 club 仓 `.wrangler/state`（auth 本地副本只在 club 仓有）；`--remote` 时 auth 切 auth 仓执行
