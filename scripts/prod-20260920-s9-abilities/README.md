# S9 20 队球员能力导入（数据源 FC Editor s901）

> **状态：未执行。** 等生产写令。
> 源目录：`E:\BaiduNetdiskDownload\FC Editor by decoruiz Alpha v21.5_2\player_tables\s901`
> 用户口径：「导入现有 20 队（包括 CPU）的球员能力，这些能力差是大换版继承结果」。

## 1. 要做什么

把 `s901/*.xlsx` 里 20 支队的球员**能力值**（CA/PA + 34 项细分能力）落进生产 `players`，**不动队籍**。

## 2. 源解剖

- 20 个文件，命名 `<clubs.id> - <ClubName>.xlsx`，前缀正好是平台 `clubs.id`（`1` Arsenal … `131681` Milano FC）。mtime 2026-09-05。
- 每文件单 sheet `Squad Info`、**61 列**、合计 **570 行**，`playerid` 全唯一、无重复、无 Excel 错误值。
- 逐队行数：1→30、2→30、5→31、9→37、10→28、11→25、13→23、14→23、21→37、33→26、45→31、66→31、73→29、241→29、243→23、280→30、449→25、110374→31、112172→26、131681→25。
- 另有 `splitted/`（20 个同名 xlsx、2 列无表头 = number + commonname，合计 550 行）是派生打印清单，忽略。
- 哨兵值：`Position2-4` 空 = `None`、`role2-5` 空 = `0`、`commonname` 空 418、`Playstyles+` 空 471、`Playstyles` 空 51。
- 数值域（实检）：overallrating 56–94、potential 61–95、PA<CA **0 例**、34 项能力全在 1–99、height 166–201、weight 56–99、有效球员 0 人缺 overallrating。

## 3. 命中情况（2026-09-20 只读实测）

- 匹配键 = `players.fc_id`（`uid` 恒 `fc{fc_id}`）。**s901 的 570 个 playerid 在生产库命中 570/570，缺失 0**。
- 队籍对比（与文件名前缀比）：一致 **89**、不一致 **158**、生产库里 `club_id IS NULL` **323**。
- CA 对比：**升 254 / 降 0 / 同 316**，均值 **+0.89**，最大 **+8**。

| 文件 | 行 | 命中 | 队籍一致 | 不一致 | 无队籍 | CA 升 | 降 | 同 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Arsenal | 30 | 30 | 3 | 5 | 22 | 10 | 0 | 20 |
| 10 Manchester City | 28 | 28 | 3 | 2 | 23 | 10 | 0 | 18 |
| 11 Manchester United | 25 | 25 | 5 | 8 | 12 | 9 | 0 | 16 |
| 110374 Fiorentina | 31 | 31 | 3 | 8 | 20 | 15 | 0 | 16 |
| 112172 RB Leipzig | 26 | 26 | 0 | 15 | 11 | 8 | 0 | 18 |
| 13 Newcastle United | 23 | 23 | 4 | 12 | 7 | 15 | 0 | 8 |
| 131681 Milano FC | 25 | 25 | 3 | 9 | 13 | 9 | 0 | 16 |
| 14 Nottingham Forest | 23 | 23 | 1 | 11 | 11 | 11 | 0 | 12 |
| 2 Aston Villa | 30 | 30 | 8 | 10 | 12 | 6 | 0 | 24 |
| 21 Bayern München | 37 | 37 | 3 | 5 | 29 | 25 | 0 | 12 |
| 241 FC Barcelona | 29 | 29 | 3 | 11 | 15 | 20 | 0 | 9 |
| 243 Real Madrid | 23 | 23 | 7 | 4 | 12 | 8 | 0 | 15 |
| 280 Olympiacos | 30 | 30 | 2 | 1 | 27 | 15 | 0 | 15 |
| 33 TSV 1860 München | 26 | 26 | 0 | 11 | 15 | 9 | 0 | 17 |
| 449 Real Betis | 25 | 25 | 8 | 4 | 13 | 11 | 0 | 14 |
| 45 Juventus | 31 | 31 | 11 | 6 | 14 | 20 | 0 | 11 |
| 5 Chelsea | 31 | 31 | 13 | 3 | 15 | 16 | 0 | 15 |
| 66 Olympique Lyonnais | 31 | 31 | 1 | 15 | 15 | 11 | 0 | 20 |
| 73 Paris Saint-Germain | 29 | 29 | 6 | 9 | 14 | 15 | 0 | 14 |
| 9 Liverpool | 37 | 37 | 5 | 9 | 23 | 11 | 0 | 26 |
| **合计** | **570** | **570** | **89** | **158** | **323** | **254** | **0** | **316** |

⇒ s901 是**联盟改过的世界**（球员已按联盟转会流动），平台 `club_id` 是 EA 原始队籍。**CA 只升不降**，与「大换版继承结果」口径一致。

## 4. 为什么不能走通道 B（`channel: 'B'` 整行导入）

`src/worker/players-import.ts:141-176` 的 `upsertStatement` 冲突路径会写 `name / pa / age / foot / position / prestige / china_plan / game_attrs / updated_at`，对 s901 有三个破坏性副作用（已逐行核对代码）：

1. **`prestige = excluded.prestige`，而通道 B 的 `prestige` 硬编码为 `null`（`src/core/import.ts` 通道 B 归一化段）⇒ 570 人国际声望全被清空**（影响球员库声望列、球员影响力系数、`src/worker/home.ts:112`）。
2. **`game_attrs` 整列被换成 61 键 Editor 形态**，而生产多处按 **FC26 71 键**取键：`src/worker/routes/players.ts:131`（view=initial 的 `$.PA`）、`:139`（按 `$.PA` 排序）、`:195-197`（位置筛选 `$.PosID2/3/4`）、`:336`（PlayStyle 筛选 `$.PSID1-15`）、`:440-443`（卷宗 `$.PosID1-4`），前端 `web/src/pages/Player.tsx:389-440` 读 `$.weakfoot`/`$.skillmoves`/`$.height`/`$.weight`。Editor 侧键名不同（`weakfootabilitytypecode`）、且缺 `skillmoves`/`hashighqualityhead`/`internationalrep`/`PosID*`/`PSID*`/`RoleID*` ⇒ 筛选、排序、卷宗会同时失效。
3. **`age` 按导入日重算、`foot`/`position` 被 Editor 文本覆盖、`name` 被 `commonname` 覆盖**。

⇒ 结论：**不走通道 B**，写能力专用离线工件。

## 5. 落库设计（推荐）

只改 4 个业务字段 + `game_attrs` 内的能力键，其余一律不动：

```sql
UPDATE players
   SET ca = ?, base_ca = ?, pa = ?,
       game_attrs = json_set(game_attrs,
         '$.CA', ?, '$.PA', ?, '$.height', ?, '$.weight', ?, '$.weakfoot', ?,
         '$.finishing', ?, '$.headingaccuracy', ?, /* … 34 项 … */ '$.gkreflexes', ?),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE fc_id = ?;
```

键映射核对（`src/core/fc26.ts` 的 `FC26_GAME_ATTR_COLUMNS` vs s901 表头）：

| 目标键 | s901 列 | 说明 |
| --- | --- | --- |
| 34 项能力（`finishing`…`gkreflexes`） | 同名 34 列 | **名字集合完全一致**（仅列序不同），逐字直接落 |
| `height` / `weight` | `height` / `weight` | 同名 |
| `weakfoot` | `weakfootabilitytypecode` | **唯一改名项**，须映射 |
| `skillmoves` | 无 | s901 没有 ⇒ 保持原值不动 |
| `hashighqualityhead`、`internationalrep` | 无 | 不动 |
| `PosID1-4` / `RoleID1-5` / `PSID1-15` / `naID` / `TeamID` / `ID` | `Position`/`Position2-4`、`role1-5`（文本）、`Playstyles`（文本）、`nationality`、`teamid`、`playerid` | **不动**（见 §8 裁决点） |

通道能力已验证（2026-09-20 只读）：D1 支持 `json_set`（`json_extract(json_set(game_attrs,'$.CA',77),'$.CA')` 返回 77）；生产 `game_attrs` 是合法 JSON、Kane（`fc_id = 202126`）为 **71 键**，`$.CA`=89、`$.PA`=89、`$.height`=188、`$.weight`=86、`$.weakfoot`=4、`$.skillmoves`=2、`$.PosID2`=-1、`$.PSID1`=5、`$.ID`=202126。

## 6. 大换版折算口径

生产现状：**全库 `ca == base_ca`（δ 恒 0）、`growth_xp`/`levels_applied`/徽章全 0**。

⇒ 大换版（`major`）与直接取源值在数学上等价：`ca = 源 CA + ceil(max(δ,0)/3) = 源 CA`。本批**直接落源值**：`ca = base_ca = overallrating`、`pa = potential`。落完后 δ 仍为 0，后续换版从新基数起算。

## 7. 影响面

- 报名合规：`initialCa = base_ca ?? ca`（`src/core/squad-rules.ts:17-20`），570 人的报名初始 CA 会变（其中 254 人升 0.89–8 点）。S9 报名尚未提交（`registrations` 0 行），本次改动只影响后续合规判定。
- 成长：`ca` 变化会进 `workers/growth.ts` 的等级判定，但 `growable`/`growth_xp`/`is_future_star` 不动。
- `market_value` 不重算（既有行为，改能力不会触发身价重算）。
- **离线 SQL 不写 `audit_log`**；要留痕可另插一条 audit。
- 写入量：570 行 ×（1 行 + 4 索引）≈ **2.9k rows_written**（免费档 10 万/天，安全）。

## 8. 裁决点

1. **是否同步 `height`/`weight`/`weakfoot`** —— 推荐**是**（同源、同键、卷宗直接展示）。
2. **是否改队籍**（158 人不一致）—— 推荐**否**。指令只说能力；改队籍会一次性动 158 人归属，与 roster-backfill 口径冲突，属另一批。
3. **是否同步位置/角色**（`Position2-4`、`role1-5`）—— 推荐**否**。`role*` 在 s901 是文本（如 `CB Stopper +`）、平台是数字 ID（`RoleID1-5`），`src/core/fc26.ts` 注释已裁决「无反查表，仅存档展示」，强行映射会出错；位置改动影响报名阵容规则。
4. **是否写 `audit_log`** —— 离线工件默认不写（`prod-20260919-*` 惯例）。
5. **是否顺带补 `nationality`/`contractvaliduntil`** —— 推荐**否**（合同是另一个源：`一线队-S9.csv`）。

## 9. 执行步骤（许可后）

1. **只读备份**：`SELECT id, fc_id, ca, base_ca, pa, game_attrs FROM players WHERE fc_id IN (…)` → 导出 JSON（570 行）。
2. 产工件 `gen-abilities-sql.ts`（读 s901 20 个 xlsx → 按 §5 映射 → 产 `01-abilities-20.sql` + 报告）；用备份导出产 `99-rollback.sql`（逐行还原 `ca/base_ca/pa/game_attrs`）。
3. 执行前复查（只读）：570 个 `fc_id` 全部存在、`game_attrs` 全部 `json_valid = 1`。
4. 执行 `01-abilities-20.sql`（走 `--command` 或 D1 REST `/query`，不用 `--file`）。
5. 跑 `02-verify.sql`。

## 10. 验收

```sql
-- 逐行核对：把 s901 的 overallrating 与落库后 ca 比对，期望 570 行全部相等
SELECT COUNT(*) FROM players WHERE fc_id IN (…) AND json_extract(game_attrs,'$.CA') <> ca;  -- 期望 0
SELECT COUNT(*) FROM players WHERE fc_id IN (…) AND pa <> json_extract(game_attrs,'$.PA');  -- 期望 0
SELECT COUNT(*) FROM players WHERE fc_id IN (…) AND game_attrs IS NULL;                      -- 期望 0
-- 未受影响的字段抽样：prestige / skillmoves 不为空的人数应与执行前一致
```

## 11. 工件清单（待产）

| 文件 | 内容 |
| --- | --- |
| `gen-abilities-sql.ts` | 读 s901 → 映射 → 产 SQL 与报告（逐文件 sha256、字段口径、跳过原因） |
| `01-abilities-20.sql` | 570 条 `UPDATE players … WHERE fc_id = ?` |
| `02-verify.sql` | 上面 §10 的只读验收 |
| `99-rollback.sql` | 由备份导出生成，逐行还原 |
| `backup-20260920-players-s901.json` | 执行前只读导出（本地留档，不入库） |
