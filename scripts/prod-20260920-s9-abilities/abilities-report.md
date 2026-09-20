# S9 能力导入（FC Editor s901 → 生产 players）生成报告

- 生成时点：2026-09-20T15:59:02.880Z
- 源目录：`E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901`
- 源行：570（唯一 playerid 570）；生产命中 570
- 落库语句：257 条 → 2 片；回滚语句：2 片（`rollback/`）
- 口径：**Case B**——只改现值（`ca`/`pa`/34 项能力项/`RoleID1-5`/`PSID1-15`），`base_ca` 与 `$.CA`/`$.PA` 不动
- 生成物**不可逐字节复现**：旧值与守卫取自生成时的生产库，且时间戳为生成时点；重跑只会在差异归零后产出空分片

## 逐字段变更（语句里实际出现的槽位次数）

| 字段 | 变更次数 | 说明 |
| --- | --- | --- |
| `ca` | 254 | 源 overallrating → 现值 |
| `pa` | 1 | 源 potential → 现值 |
| `sprintspeed` | 121 | 34 项能力项（两源同名直连） |
| `acceleration` | 97 | 34 项能力项（两源同名直连） |
| `finishing` | 117 | 34 项能力项（两源同名直连） |
| `positioning` | 124 | 34 项能力项（两源同名直连） |
| `shotpower` | 21 | 34 项能力项（两源同名直连） |
| `longshots` | 72 | 34 项能力项（两源同名直连） |
| `volleys` | 15 | 34 项能力项（两源同名直连） |
| `vision` | 109 | 34 项能力项（两源同名直连） |
| `crossing` | 68 | 34 项能力项（两源同名直连） |
| `longpassing` | 86 | 34 项能力项（两源同名直连） |
| `shortpassing` | 200 | 34 项能力项（两源同名直连） |
| `agility` | 25 | 34 项能力项（两源同名直连） |
| `reactions` | 192 | 34 项能力项（两源同名直连） |
| `ballcontrol` | 202 | 34 项能力项（两源同名直连） |
| `dribbling` | 129 | 34 项能力项（两源同名直连） |
| `interceptions` | 114 | 34 项能力项（两源同名直连） |
| `headingaccuracy` | 75 | 34 项能力项（两源同名直连） |
| `defensiveawareness` | 80 | 34 项能力项（两源同名直连） |
| `standingtackle` | 117 | 34 项能力项（两源同名直连） |
| `slidingtackle` | 80 | 34 项能力项（两源同名直连） |
| `jumping` | 30 | 34 项能力项（两源同名直连） |
| `stamina` | 91 | 34 项能力项（两源同名直连） |
| `strength` | 69 | 34 项能力项（两源同名直连） |
| `aggression` | 48 | 34 项能力项（两源同名直连） |
| `gkdiving` | 12 | 34 项能力项（两源同名直连） |
| `gkhandling` | 11 | 34 项能力项（两源同名直连） |
| `gkkicking` | 9 | 34 项能力项（两源同名直连） |
| `gkpositioning` | 11 | 34 项能力项（两源同名直连） |
| `gkreflexes` | 11 | 34 项能力项（两源同名直连） |
| `RoleID1-5` | 9 | 角色槽位（保序追加，不删既有） |
| `PSID1-12` | 51 | 花式槽位（同上） |
| `PSID13-15` | 5 | 金徽槽位（`Playstyles+` 基础名 + 100）；落库后涉及 4 行（02-verify.sql 的 `gold_rows`） |

## 只比对、不写库的字段（README §8 裁决点）

| 字段 | 差异行数 |
| --- | --- |
| `height` | 0 |
| `weight` | 0 |
| `weakfoot` | 0 |
| `PosID1-4` | 0 |
| `players.base_ca` 为 NULL 的行 | 0 |
| `game_attrs.$.CA` ≠ `ca` 的行（Case B 预期的背离） | 0 |
| `game_attrs.$.PA` ≠ `pa` 的行 | 0 |

明文差异：0 条（为 0 才允许生成）
槽位溢出（源项数 > 列数，有即中止生成）：0 行

## 逐队（源行 / CA 上升 / CA 不变 / 有语句的行）

| club_id | 文件 | 源行 | CA 升 | CA 同 | 有语句 |
| --- | --- | --- | --- | --- | --- |
| 1 | `1 - Arsenal.xlsx` | 30 | 10 | 20 | 10 |
| 2 | `2 - Aston Villa.xlsx` | 30 | 6 | 24 | 6 |
| 5 | `5 - Chelsea.xlsx` | 31 | 16 | 15 | 16 |
| 9 | `9 - Liverpool.xlsx` | 37 | 11 | 26 | 11 |
| 10 | `10 - Manchester City.xlsx` | 28 | 10 | 18 | 10 |
| 11 | `11 - Manchester United.xlsx` | 25 | 9 | 16 | 9 |
| 13 | `13 - Newcastle United.xlsx` | 23 | 15 | 8 | 15 |
| 14 | `14 - Nottingham Forest.xlsx` | 23 | 11 | 12 | 11 |
| 21 | `21 - Bayern München.xlsx` | 37 | 25 | 12 | 25 |
| 33 | `33 - TSV 1860 München.xlsx` | 26 | 9 | 17 | 9 |
| 45 | `45 - Juventus.xlsx` | 31 | 20 | 11 | 20 |
| 66 | `66 - Olympique Lyonnais.xlsx` | 31 | 11 | 20 | 11 |
| 73 | `73 - Paris Saint-Germain.xlsx` | 29 | 15 | 14 | 17 |
| 241 | `241 - FC Barcelona.xlsx` | 29 | 20 | 9 | 20 |
| 243 | `243 - Real Madrid.xlsx` | 23 | 8 | 15 | 9 |
| 280 | `280 - Olympiacos.xlsx` | 30 | 15 | 15 | 15 |
| 449 | `449 - Real Betis Balompié.xlsx` | 25 | 11 | 14 | 11 |
| 110374 | `110374 - Fiorentina.xlsx` | 31 | 15 | 16 | 15 |
| 112172 | `112172 - RB Leipzig.xlsx` | 26 | 8 | 18 | 8 |
| 131681 | `131681 - Milano FC.xlsx` | 25 | 9 | 16 | 9 |

无差异行（源与库完全一致）：313

## 未映射文本（源里有、反查表里没有）

| 表 | 文本 | 出现次数 |
| --- | --- | --- |
| role.json | `0` | 1479 |
| playstyle.json | — | 0 |

明确丢弃的生涯特性（不在 PlayStyleID 表内）：`One Club Player`×57、`Injury Prone`×53

## 分片清单

| 文件 | 语句 | 条数 | 字节 | sha256 |
| --- | --- | --- | --- | --- |
| sql/abilities-update-01.sql | 1-200 | 200 | 72167 | `c10ed069c720acf3302cfd10293e1c28be355f2e2c9f25e769d6ed0a1311a6cf` |
| sql/abilities-update-02.sql | 201-257 | 57 | 21666 | `ed3c5367c4b924a5aa788ef8a05bd07959d37850734e27964372b1941010eaa1` |
| rollback/abilities-rollback-01.sql | 1-200 | 200 | 75753 | `24c1a9e9c67a2db4bc8e967c0be8d6f6347902e66eb103cd6e2d16bb79309891` |
| rollback/abilities-rollback-02.sql | 201-257 | 57 | 22704 | `3205a1fce2fe9996f741491135b80b6eef0497c660627c48f0d056f4fa068800` |

## 执行前的本地演练（可选，不碰生产）

```bash
npx wrangler d1 execute whl-club --local --file scripts/prod-20260920-s9-abilities/sql/abilities-update-01.sql
# 断言：changes 与语句数一致；再跑一次 changes = 0
```

## 生产执行（等令）

```bash
npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-abilities/01-precheck.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-abilities/sql/abilities-update-01.sql   # 逐片
npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-abilities/02-verify.sql
node scripts/prod-20260920-s9-abilities/gen-abilities-sql.ts --verify   # 期望「仍有差异的行 0」
```

回滚：`rollback/abilities-rollback-NN.sql` 逆序逐片执行（守卫按导入后的 ca/pa 值，只还原本批动过的字段）。

样例语句（第 1 条）：

```sql
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.sprintspeed', 70, '$.shortpassing', 71, '$.reactions', 75, '$.ballcontrol', 69, '$.interceptions', 80, '$.headingaccuracy', 74, '$.defensiveawareness', 78, '$.standingtackle', 73, '$.slidingtackle', 71, '$.jumping', 81, '$.strength', 81, '$.aggression', 76), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277225 AND ca = 73 AND pa = 84;
```
