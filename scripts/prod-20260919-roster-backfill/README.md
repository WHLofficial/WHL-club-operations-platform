# 16 队队籍回填预检报告（2026-09-19）

目标：把 16 支人控俱乐部的球员队籍（`players.club_id`）按游戏队号补齐。**只写队籍，不造合同**；合同等用户提供信息后另批。生产执行等管理组明确下令，本批只交付预检 + SQL 工件。

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
| 4 CPU 队（10/241/112172/131681） | 4 | 107 | 107 | 增量 14 已完成，不动 |
| 其他（自由身/非联赛） | 629 | 17750 | 0 | 保持 NULL，不动 |

特例说明：AC米兰 `clubs.id=131681`，快照 TeamID=47（FC26 改名改号），CPU 队籍增量 14 已按 47→131681 处理，不在本批。全库 TeamID 组共 649 个，合计 18301 人与首灌记录吻合。

## 执行（等令后）

```bash
# 执行前复查一遍 16 队未入籍数与上表一致（数字变了先停下查原因）：
npx wrangler d1 execute whl-club --remote --json --command "SELECT json_extract(game_attrs,'\$.TeamID') AS tid, SUM(club_id IS NULL) AS unassigned FROM players WHERE json_extract(game_attrs,'\$.TeamID') IN (1,2,5,9,11,13,14,21,33,45,66,73,243,280,449,110374) GROUP BY tid"

# 执行（--file 通道即可：纯 UPDATE，无 defer 需求）：
npx wrangler d1 execute whl-club --remote --file scripts/prod-20260919-roster-backfill/01-roster-backfill-16.sql

# 执行后复查：每队 unassigned=0、assigned=行数，全库 club_id IS NULL 应剩 17750
npx wrangler d1 execute whl-club --remote --json --command "SELECT SUM(club_id IS NOT NULL) AS assigned, SUM(club_id IS NULL) AS free FROM players"
```

预期 `rows_written`：444 行 + 索引条目（players 有 club_id 相关索引时每行多 1 次），远低于免费档日配额。

## 回滚

见 SQL 文件尾注释：可整批 `club_id = NULL` 回滚，但仅限「无新转会/注册发生」的前提下；否则按队逐队回滚。执行前建议把执行时间点记进审计。
