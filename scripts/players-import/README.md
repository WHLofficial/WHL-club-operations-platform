# 球员库离线导入（FC26db Base → players）

把 FC26db 当季全量球员灌进生产 `players`（首次建库 18301 人）。之所以走离线脚本而不是管理端网页导入：
`POST /api/admin/players/import/{preview,confirm}` 前有 `requireAdmin(..., 'club.players.import')`，需 OIDC 会话，
脚本拿不到 token；而部署前端走 UI 又受部署 gate 限制。

## 用法

```
node scripts/players-import/generate-sql.ts [xlsx路径] [每片语句数]
# 默认：E:/Downloads/FC26db20251217_fixed.xlsx、1000 语句/片
```

流程：读 `Base` 表 + `Growth+` 未来之星名单 → 按 `ID` 去重（源侧重复行整行同内容，保首行）→ 每 1000 行切片喂
`src/core/import.ts` 的 `normalizeImportBatch('A', …)`（与 `web/src/pages/Admin.tsx` 的 `IMPORT_SLICE` 同口径）
→ 经 `src/worker/players-import.ts` 的 `upsertStatement` 渲染成 SQL 字面量。SQL 文本与参数顺序直接取自生产函数
（喂假 DB 捕获 `prepare/bind`），生产改了这里自动跟上，不手抄。

输出：`sql/players-import-NN.sql`（**不入库**，见根 `.gitignore`；30MB 级生成物）+ `players-import-report.md`
（字段口径表、被拦下的行、每片行区间/字节/sha256 清单——sha256 即写进生产 D1 的逐字节内容，是入库的审计凭据）。

## 缺字段球员的增量补录

30 行的 `naID`/`FootID` 在源表是 `#N/A` / `Not Found`，校验拦下（其余 18301 人已入库）。补到这两个值后用：

```
node scripts/players-import/overlay-missing.ts [xlsx路径] [补值CSV]
# 默认：E:/Downloads/FC26db20251217_fixed.xlsx、scripts/players-import/missing-fields-30.csv
```

补值表 `missing-fields-30.csv` 表头 `ID,naID,FootID`（naID 见同目录 `nation-id-reference.csv`，1-218；
FootID 1=右脚 2=左脚）。只补这两列——源行其余字段齐全，`PosID1` 可空，归一化本就允许。
产 `sql/players-import-overlay.sql`（同样靠喂假 DB 捕获 `upsertStatement`，与上面 19 片同口径）
+ `players-import-overlay-report.md`（补录/待填/补值不合法/归一化报错 四类清单）。

## 生产执行记录（2026-09-18）

```
npx wrangler d1 execute whl-club --remote --file scripts/players-import/sql/players-import-NN.sql  # 19 片，按序号
```

写入后核验：`n=18301 / uniq_fcid=18301 / uniq_uid=18301 / bound(club_id)=0 / game_attrs 71 键=18301 / null=0 / bad_json=0`；
`prestige` 分布 `1→17497 2→269 3→466 4→55 5→14`；`china_plan=399`、`is_future_star=104`（Growth+ 名单）、`growable=10474`。
回滚：`DELETE FROM players;`（导入前为空表，全量首灌，无跨表引用）。重跑幂等（`ON CONFLICT(fc_id) DO UPDATE`，只更 FC 源列）。

**写入成本（首灌当时）**：D1 的 `rows_written` 把索引条目也算一行写入——首灌时 `players` 只有 4 个索引（`uid`/`fc_id` 两个 UNIQUE 自动索引、
`idx_players_club`、`idx_players_status`），故每名球员 = 1 行表 + 4 行索引 = **5 次写入**，本次 18301 × 5 ≈ 91.5k 行
（Workers Free 档上限 10 万行/天）。别为验证反复重跑。

**重跑成本已随索引增多放大（2026-09-24 实测订正）**：`players` 现在挂着 **16 个索引**（14 条显式：`idx_players_club`、`idx_players_club_ca`、11 条 `idx_players_sort_*`、`idx_players_status`，加 `uid` / `fc_id` 两个 UNIQUE 自动索引），按 18301 人算全量覆盖的记账：

| 覆盖方式 | 每名球员行写 | 18301 人合计 | 自留预算 ≤6 万/日 |
|---|---|---|---|
| 新插入一行 | 1 + 16 = 17 | 311,117 | ≈6 天 |
| 本文件的 upsert 重跑 | 1 + 10 = **11** | **201,311** | ≈4 天 |
| `DELETE FROM players` 全清 | 1 + 16 = 17 | 311,117 | ≈6 天 |
| 全清 + 重新 INSERT | 17 + 17 = 34 | 622,234 | ≈11 天 |

upsert 只需 11 行，是因为 `UPDATE` 只为「SET 列表里出现过的列」所属的索引写新条目——本文件的 upsert 覆盖 `uid` / `name` / `ca` / `base_ca`（major 模式）/ `pa` / `age` / `prestige` / `game_attrs`，命中的是 `idx_players_sort_uid`、`idx_players_sort_name`、`idx_players_sort_ca`、`idx_players_sort_initial_ca`、`idx_players_sort_pa`、`idx_players_sort_age`、`idx_players_sort_prestige`、`idx_players_sort_ps`、`idx_players_club_ca` 与 `uid` 自动索引共 10 条；`club_id` / `market_value` / `status` / `fc_id` 那 6 条不受影响。

⇒ **一次全量重导已不可能在一天内做完**（首灌 91.5k 一天塞得下，现在 201k 起），须按 19 个分片跨 3–4 个 UTC 日推进；players 每再加一条索引，重导成本就 +18301 行。好消息是 upsert 幂等（`ON CONFLICT(fc_id) DO UPDATE`），中途撞配额可以第二天接着跑、不会弄坏数据——反过来 `DELETE FROM players;` 那条路一旦中断就是半空表、没有回滚点，**不要用它做覆盖**（该语句仅作首灌回滚记录保留）。也**不要**用 `DROP TABLE players` 重建：索引会一起消失，而 `d1_migrations` 仍记着 `0033`/`0034` 已 apply，`wrangler d1 migrations apply` 不会重跑，得手工把那 16 条索引建回来。

## 未入库的输入

- **30 行缺字段**（2026-09-19 深挖后的准确口径）：这些行缺的是**两个**校验必需列——`naID` 与 `FootID`，
  源表分别是 `#N/A` 与 `Not Found`（`nationality`/`Foot`/`PosID1`/`Position1`/`internationalrep` 也一并缺，但 `PosID1` 可空、
  `prestige` 允许 NULL，故只有前两列卡校验）。`FC26db…_backup.xlsx` 的 `Main` 表同为 `#N/A`。本地反查全部落空：
  FC Editor 的队壳表（`player_tables/{teamid} - {Team}.xlsx`）只有 Squad Info 14 列、**没有国籍列**；
  `master.db` 不是可读 SQLite（`file is not a database`）；`_temp/players.txt`（20909 行、含 `nationality`）里这 30 个 ID **一个都没有**。
  在线源（sofifa 转登录页、futbin/fut.gg/fifaindex 403、Wikipedia/Wikidata 出网被拦）均不可用。
  → 按「查不到的逐条报，不猜」搁置：清单在 `missing-fields-30.csv`，补值后用 `overlay-missing.ts` 一条命令入账（幂等）。
- **`club_id` 导入时为 NULL**：导入只写 FC 源列，不碰运营列（§5.4）——本次首灌全体未归属。
  2026-09-19 增量 14 已把 4 支 CPU 队（曼城/巴塞罗那/RB莱比锡/AC米兰）的 107 名球员回填 `club_id`
  （`scripts/prod-20260919-increment14/02-backfill-cpu-club-id.sql`），此后导入侧按 `clubIdForTeam` 直接写 `club_id`。
- **审计行未写**：绕过管理端即无 `players_import` 审计记录，本次以报告 + 分片 sha256 作为凭据。

## 数据缺口

文档（ROADMAP / TECH_DESIGN / 交接）写 18408 人，实际 `Base` 表 max_row=18408 = 表头 1 行 + 数据 18407 行，
多出来的 1 是表头被算进去的。源里另有 76 个重复 ID，故唯一球员 18331。
