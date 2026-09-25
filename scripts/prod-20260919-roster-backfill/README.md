# 16 队队籍回填预检报告（2026-09-19）

> **执行记录（2026-09-20，用户下令执行）**：按下方「执行」段先跑执行前复查——16 队逐队 `unassigned` 等于 `total`、合计 444 与上表逐一吻合，全库基线 `club_id IS NOT NULL` = 107（CPU 4 队：10→26 / 241→28 / 112172→29 / 131681→24）、`IS NULL` = 18194、总计 18301，16 个目标 `clubs.id` 行俱在且队名与上表一致。随后 `--file` 直写：`Total queries executed: 16`、`Rows written: 888`（= 444 行 × 2，`players` 上有 `idx_players_club(club_id)`，每行更新带一次索引写；meta 的 `changes` 报 445 与 `rows_written` 及实际数据不符，D1 该字段跨批语句本就不可靠，以实际查询为准）。
>
> 执行后复查：16 队逐队 `assigned` 等于 `total` 且写入口径正确（`MIN(club_id)` 等于该队 TeamID），`SELECT COUNT(*) WHERE club_id IN (16 个 id)` = **444**；全库 `assigned` = **551**（= 107 + 444）、`free` = **17750**、总计 18301 不变；CPU 4 队仍 107 未被动过。**本批已完成，勿再重跑**（守卫 `club_id IS NULL` 使其幂等，重跑 changes 为 0）。
>
> 目标：把 16 支人控俱乐部的球员队籍（`players.club_id`）按游戏队号补齐。**只写队籍，不造合同**；合同等用户提供信息后另批。生产执行等管理组明确下令，本批只交付预检 + SQL 工件。

## 映射口径（预检逐一核对成立）

`players.game_attrs` 的快照 `TeamID`（`web/assets/ref/team.json` 的 id）**等于** `clubs.id`：

| clubs.id | 队名 | team.json 快照名 | 待入籍 |
|---:|---|---|---:|
| 1 | 阿森纳 | Arsenal | 24 |
| 2 | 阿斯顿维拉 | Aston Villa | 24 |
| 5 | 切尔西 | Chelsea | 30 |
| 9 | 利物浦 | Liverpool | 28 |
| 11 | 曼联 | Manchester United | 26 |
| 13 | 纽卡斯尔联 | Newcastle United | 29 |
| 14 | 诺丁汉森林 | Nottingham Forest | 28 |
| 21 | 拜仁慕尼黑 | FC Bayern München | 27 |
| 33 | 慕尼黑1860 | TSV 1860 München | 29 |
| 45 | 尤文图斯 | Juventus | 26 |
| 66 | 里昂 | Olympique Lyonnais | 27 |
| 73 | 巴黎圣日耳曼 | Paris Saint-Germain | 25 |
| 243 | 皇家马德里 | Real Madrid | 31 |
| 280 | 奥林匹亚科斯 | Olympiacos FC | 29 |
| 449 | 皇家贝蒂斯 | Real Betis Balompié | 31 |
| 110374 | 佛罗伦萨 | Fiorentina | 30 |
| **合计** | | | **444** |

佐证（首灌样本人群 TeamID 与队名吻合）：Haaland/Rodri TeamID=10（曼城）、Mbappé/Bellingham TeamID=243（皇马）、Salah TeamID=9（利物浦）、Kane TeamID=21（拜仁）、Dembélé TeamID=73（巴黎）。

## 全库分布（生产 whl-club，2026-09-19 实测）

| 分组 | TeamID 组数 | 人数 | club_id 已写 | 处置 |
|---|---:|---:|---:|---|
| 16 人控队 | 16 | 444 | 0 | 本批回填 |
| 4 CPU 队（10/241/112172/131681） | 4 | 107 | 107 | v2.0.0 已完成，不动 |
| 其他（自由身/非联赛） | 629 | 17750 | 0 | 保持 NULL，不动 |

特例说明：AC米兰 `clubs.id=131681`，快照 TeamID=47（FC26 改名改号），CPU 队籍v2.0.0 已按 47→131681 处理，不在本批。全库 TeamID 组共 649 个，合计 18301 人与首灌记录吻合。

## 执行（已于 2026-09-20 执行完毕）

```bash
# 执行前复查一遍 16 队未入籍数与上表一致（数字变了先停下查原因）：
npx wrangler d1 execute whl-club --remote --json --command "SELECT json_extract(game_attrs,'\$.TeamID') AS tid, SUM(club_id IS NULL) AS unassigned FROM players WHERE json_extract(game_attrs,'\$.TeamID') IN (1,2,5,9,11,13,14,21,33,45,66,73,243,280,449,110374) GROUP BY tid"

# 执行（--file 通道即可：纯 UPDATE，无 defer 需求）：
npx wrangler d1 execute whl-club --remote --file scripts/prod-20260919-roster-backfill/01-roster-backfill-16.sql

# 执行后复查：每队 unassigned=0、assigned=行数，全库 club_id IS NULL 应剩 17750
npx wrangler d1 execute whl-club --remote --json --command "SELECT SUM(club_id IS NOT NULL) AS assigned, SUM(club_id IS NULL) AS free FROM players"
```

预期 `rows_written`：444 行 + 索引条目（`players` 上有 `idx_players_club(club_id)`，每行多 1 次写，实测 888），远低于免费档日配额。

## 回滚

见 SQL 文件尾注释：可整批 `club_id = NULL` 回滚，但仅限「无新转会/注册发生」的前提下；否则按队逐队回滚。

本批执行前的状态已实测留档：这 444 行当时 `club_id` 全为 NULL，且全库 `club_id` 落在本批 16 个 id 上的行恰为这 444 行（其余 107 行属 4 支 CPU 队），因此只要此后无涉及这 16 队的转会/注册发生，整批回滚即可精确还原。

执行审计：本仓无「脚本写生产即插 `audit_log`」的惯例（`audit_log` 记的是应用内动作，如 `target_id=47` 那 10 行 match 撞号）；本批的记录即本 README 的执行记录段 + `scripts/README.md` 状态表。
