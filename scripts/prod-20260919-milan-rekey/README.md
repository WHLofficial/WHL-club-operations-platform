# 米兰队 id 收口 131681（2026-09-19 生产执行记录）

把 AC米兰 在赛事系统（tour）与认证中心（auth）两侧残留的 legacy 队号 `47` 统一成游戏真号 `131681`，
使四个 id 空间一致：tour `team.id` = auth `team.tour_team_id` = auth `team.club_id` = 平台 `clubs.id`。

## 为什么是 131681

EAFC 26 里 AC米兰 未授权，游戏用「Milano FC」假名 + 新号 `131681`；第三方 fixed 快照与 EA 的 1..199 段仍带旧 FIFA 号 `47`（EA 的队名参考表里 `47` 与 `131681` 都叫 AC Milan，是两代编号）。
平台侧 `clubs.id`/`players.club_id` 早在v2.0.0 就是 `131681`，auth 的 `club_id` 也是，只有 tour `team.id` 与 auth `tour_team_id` 还是 47
（2026-09-16 的 `fc26-id-rekey` 只做了 tour 1..21 → FC id 的映射，当时米兰落在 47）。

## 执行结果（逐条复查通过）

| 步骤 | 命令 | 实测 |
|---|---|---|
| tour 重键 | `npx wrangler d1 execute whl --remote --command "<01 文件语句序列>"`（在 club 仓目录即可，`whl` 是 TOUR_DB 绑定） | `player.team_id` 25 行、`entry.team_id` 2 行、`team.id` 1 行；其余 6 张引用表 0 行 |
| tour 复查 | 单行多标量子查询 | `team` 仍 20 行、`id=131681` 名 `AC米兰(CPU)`、`id=47` 0 行、`player.team_id=131681` 25 行 / `=47` 0 行、`entry.team_id=131681` 2 行 / `=47` 0 行、`audit_log` 的 `target_id=47 AND target_type='match'` 10 行**未动** |
| auth 重键 | `npx wrangler d1 execute whl-auth --remote --file <02 绝对路径>`（在 auth 仓目录） | 1 行（命令回了 changes=2，该库计数常比实际多 1，以复查为准） |
| auth 复查 | 单行多标量子查询 | `team` 20 行、`tour_team_id=47` 0 行、米兰行 `tour_team_id=club_id=131681`、四支 CPU 队全为 `241->241 / 10->10 / 112172->112172 / 131681->131681` |

club 库无需改动：全库只有 `result_confirmations` 带 `home_team_id`/`away_team_id`/`winner_team` 三列，而该表生产 0 行（尚无已确认赛果）。

## 执行通道的硬约束（本地实测）

D1 的 `PRAGMA defer_foreign_keys = ON` **只在 `--command` / REST `/query` 通道生效**，`--file` 导入通道下失效：

- 无 defer、先改父行：`FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)`（D1 的 `foreign_keys` 实测为 1）。
- 带 defer、父行与子行同批：一次通过（本地 D1 用 `_fk_parent/_fk_child` 同名结构实测，跑完即删表）。
- 批中任一语句失败 → 整批回滚不留半成品（实测：先改一行再故意 `SELECT` 不存在的表，事务失败后该行仍是原值）。

## 不要动的地方

`audit_log` 里 `target_id=47` 的 10 行全是 `target_type='match'`——是**比赛 id 恰好等于 47**，与队号无关，误改会污染审计记录。

## 回滚

两个文件头注释里各带反向 UPDATE（tour 需同样带 `PRAGMA defer_foreign_keys = ON` 走 `--command`；auth 反向 UPDATE 带 `name = 'AC米兰(CPU)'` 守卫）。
