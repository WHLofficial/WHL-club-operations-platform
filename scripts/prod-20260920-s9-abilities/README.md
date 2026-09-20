# S9 20 队球员能力导入（数据源 FC Editor s901）

> **状态：工件已生成（2026-09-20），未执行。** 等生产写令。
> 源目录：`E:\BaiduNetdiskDownload\FC Editor by decoruiz Alpha v21.5_2\player_tables\s901`
> 用户口径：「导入现有 20 队（包括 CPU）的球员能力，这些能力差是大换版继承结果」。
> 落库口径=**Case B**（用户 2026-09-20 裁定）：只改**现值**，不动**基准**。队籍不属本批（另开 `scripts/prod-20260920-s9-club-align/`）。

## 1. 要做什么

把 `s901/*.xlsx` 里 20 支队的球员**现值能力**落进生产 `players`：

- 写：`ca`、`pa`、`game_attrs` 里 **34 项能力项**、`RoleID1-5`、`PSID1-15`。
- 不写：`base_ca`、`game_attrs` 的 `$.CA`/`$.PA`、`height`/`weight`/`weakfoot`/`skillmoves`/`PosID1-4`、`club_id`、合同、状态、成长字段。

⇒ 这批涨幅以 **delta = `ca` − `base_ca`** 的形式存在（254 行为正）：后续换版按 delta 继承（minor 全额、major 取 1/3）、解约时被剥掉、报名合规与「初始视图」仍按换版前的基准算。**这是 Case B 的代价，已被用户接受**（早前推荐「base 一起刷」被否）。

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

⇒ 上表的「队籍一致/不一致/无队籍」三列本批**不用**：用户已裁定队籍单独成批（`scripts/prod-20260920-s9-club-align/`，481 条语句），能力批只碰能力列。

## 4. 为什么不能走通道 B（`channel: 'B'` 整行导入）

`src/worker/players-import.ts:141-176` 的 `upsertStatement` 冲突路径会写 `name / pa / age / foot / position / prestige / china_plan / game_attrs / updated_at`，对 s901 有三个破坏性副作用（已逐行核对代码）：

1. **`prestige = excluded.prestige`，而通道 B 的 `prestige` 硬编码为 `null`（`src/core/import.ts` 通道 B 归一化段）⇒ 570 人国际声望全被清空**（影响球员库声望列、球员影响力系数、`src/worker/home.ts:112`）。
2. **`game_attrs` 整列被换成 61 键 Editor 形态**，而生产多处按 **FC26 71 键**取键：`src/worker/routes/players.ts:131`（view=initial 的 `$.PA`）、`:139`（按 `$.PA` 排序）、`:195-197`（位置筛选 `$.PosID2/3/4`）、`:336`（PlayStyle 筛选 `$.PSID1-15`）、`:440-443`（卷宗 `$.PosID1-4`），前端 `web/src/pages/Player.tsx:389-440` 读 `$.weakfoot`/`$.skillmoves`/`$.height`/`$.weight`。Editor 侧键名不同（`weakfootabilitytypecode`）、且缺 `skillmoves`/`hashighqualityhead`/`internationalrep`/`PosID*`/`PSID*`/`RoleID*` ⇒ 筛选、排序、卷宗会同时失效。
3. **`age` 按导入日重算、`foot`/`position` 被 Editor 文本覆盖、`name` 被 `commonname` 覆盖**。

⇒ 结论：**不走通道 B**，写能力专用离线工件。

## 5. 落库设计（已实现：`gen-abilities-sql.ts`）

每行一条 `UPDATE`，只把「真的有差」的键写进 `json_set`：

```sql
UPDATE players
   SET ca = 76, pa = 84,
       game_attrs = json_set(game_attrs, '$.finishing', 71, '$.gkreflexes', 12, /* … 有差的 34 项 … */),
       updated_at = '<生成时点>'
 WHERE fc_id = 277225 AND ca = 73 AND pa = 84;   -- 乐观闸：重放/错版 changes = 0
```

- 守卫 `WHERE fc_id = ? AND ca = 旧 AND pa = 旧` ⇒ 重复执行 `changes = 0`（本地演练已证，见 §12）。
- 生成器内断言：SQL 文本里**不得出现 `base_ca`**、不得出现 `'$.CA'`/`'$.PA'` 写入 —— 违反 Case B 直接 throw。
- **库内空槽哨兵是 `0` 而不是 NULL**（角色/花式），位置是 `-1`；回滚写原样值（`0` 就还 `0`，不改成 NULL）。

键映射核对（`src/core/fc26.ts` 的 `FC26_GAME_ATTR_COLUMNS` vs s901 表头）：

| 目标键 | s901 列 | 说明 |
| --- | --- | --- |
| 34 项能力（`sprintspeed`…`gkreflexes`） | 同名 34 列 | **名字集合完全一致**（仅列序不同），逐字直接落；键名由 `FC26_GAME_ATTR_COLUMNS.slice(indexOf('sprintspeed'))` 取，与 `src/worker/routes/players.ts:22` 同源，不手抄 |
| `height` / `weight` | `height` / `weight` | 同名，但实测差异 **0 行** ⇒ 不写 |
| `weakfoot` | `weakfootabilitytypecode` | 唯一改名项，实测差异 **0 行** ⇒ 不写 |
| `skillmoves` | 无 | s901 没有 ⇒ 保持原值不动 |
| `hashighqualityhead`、`internationalrep` | 无 | 不动 |
| `PosID1-4` | `Position`/`Position2-4` | 实测差异 **0 行** ⇒ 不写 |
| `RoleID1-5` / `PSID1-15` | `role1-5`（文本）、`Playstyles`/`Playstyles+`（文本） | **本批同步**（反查表见 §5.1；保序追加、不删不重排） |
| `$.CA`/`$.PA`/`base_ca` | `overallrating`/`potential` | **Case B 明确不动**（只写列 `ca`/`pa`） |
| `naID` / `TeamID` / `ID` | `nationality`、`teamid`、`playerid` | **不动**（队籍见 `scripts/prod-20260920-s9-club-align/`） |

### 5.1 文本 → ID 反查表（纠正早前「无反查表」的错判）

反查表**存在且在仓库里**：`web/assets/ref/{position,role,playstyle,nation,team}.json`，生成器 `scripts/gen_ref_json.py`，默认源就是 `E:\Downloads\FC26db20251217_fixed.xlsx` —— 与 s901 同源的 RoleID（99 条）/ PlayStyleID（73 条，含 `+` 变体 ID 101–156）/ PositionID（13 条）三张表。前端球员卡本来就是拿它们渲染位置/角色/金徽的（`web/src/lib/ref.ts`、`web/src/pages/Player.tsx:379-382`）。

实测（2026-09-20，570 行全量）：

| 源列 | 目标键 | 未命中 | 规则 |
| --- | --- | --- | --- |
| `Position`/`Position2-4` | `PosID1-4` | **0** | `None`/空 → 无槽；`-` → −1 |
| `role1-5` | `RoleID1-5` | **0** | 归一化 `Half Winger` → `Half-Winger`（表里带连字符）；`++` 版 = 基础 ID + 100；`0` → 空槽 |
| `Playstyles` | `PSID1-12` | 2 个值（`One club player` ×57、`Injury prone` ×53） | 逗号分隔逐项查表；**这两个不在 PlayStyleID 表内**（生涯特性非花式，来源 `Base` 的文本列同样如此）⇒ 丢弃 |
| `Playstyles+` | `PSID13-15` | **0** | 列里给的是**基础名**（如 `Enforcer`），落库 **+100** 进金槽（与 `web/src/lib/api.ts:179` 注「金徽=基础 ID+100，金槽 13+」一致） |

### 5.2 若全量同步，570 行里到底会变多少（实测）

| 字段 | 变化行数 | 形态 |
| --- | --- | --- |
| `ca` | **254** | 只升不降（均值 +0.89，max +8） |
| `pa` | 1 | 只升 |
| `height` / `weight` / `weakfoot` | **0 / 0 / 0** | 两源本就一致 —— 换版不动身体与逆足 |
| `PosID1-4` | **0** | 两源位置完全一致 |
| `RoleID1-5` | 9 | 全是**源多一个角色**（例：`[13,9,11]` vs 库内 `[13,9]`），无删除、无替换 |
| `PSID1-12` | 36 | 35 行源多一个；1 行替换（`fc_id 243812`：源 32 顶掉库内 1） |
| `PSID13-15`（金徽） | 4 | 全部是源新增金徽（如 101 `Finesse Shot +`、151/155 门将金徽） |

即：本批真正要落的只有 **CA 254 行 + PA 1 行（+ 角色 9 / 花式 40 行，若裁决同步）**；身体属性、逆足、位置三项改动数为 0，可以完全不写。改动方向单一——**s901 是增量侧、库内是子集**，不会删掉任何既有角色/花式。


通道能力已验证（2026-09-20 只读）：D1 支持 `json_set`（`json_extract(json_set(game_attrs,'$.CA',77),'$.CA')` 返回 77）；生产 `game_attrs` 是合法 JSON、Kane（`fc_id = 202126`）为 **71 键**，`$.CA`=89、`$.PA`=89、`$.height`=188、`$.weight`=86、`$.weakfoot`=4、`$.skillmoves`=2、`$.PosID2`=-1、`$.PSID1`=5、`$.ID`=202126。

## 6. 大换版折算口径（Case B 下本批不参与折算）

生产现状：**全库 `ca == base_ca`（δ 恒 0）、`growth_xp`/`levels_applied`/徽章全 0** ⇒ 换版公式的 `max(δ,0)` 项现在恒为 0。

Case B 下 `base_ca` 不动，本批**只把 `ca` 抬到源值**，于是：

- 本批涨幅全部变成 **δ = `ca` − `base_ca` > 0**（254 行为正，0.89–8 点），这正是「归为成长」的效果。
- 下一次换版（通道 A/B 整行导入）：minor ⇒ `ca = 源CA + δ`；major ⇒ `ca = 源CA + ceil(δ/3)`，且 `base_ca` 才被刷成源 CA、`growth_xp`/`levels_applied`/徽章按 major 折算。
- 解约（`src/worker/transfers.ts:352-363`）把 `ca` 回 `base_ca` ⇒ **本批涨幅会被没收**（成长态归零）。
- ⚠️ 本批之后**不要**对这 20 队走通道 A/B 整行导入：那会把 `base_ca = excluded.ca` 一并刷掉，δ 归零（等于把本批变成「改基准」）。

## 7. 影响面

- **报名合规不动**：`initialCa = base_ca ?? ca`（`src/core/squad-rules.ts:17-20`、`src/worker/routes/registration.ts:69`、`src/worker/routes/admin/reviews.ts:157`）⇒ 合规按换版前的基准算，本批不改合规结论。球员库的「初始 CA」列与 `view=initial` 排序同理（读 `base_ca` / `$.PA`）。
- **球员库现值列 / 卷宗现值会变**：`ca` 254 人 +1~8 点（`routes/players.ts` 的现值列与 `cur_ca`/`cur_pa`）。
- **成长**：`ca` 变化不影响等级判定（`growth.ts:420/493` 只看 `growth_xp`），`growable`/`growth_tier`/`growth_xp`/`is_future_star`/徽章不动 ⇒ 不会凭空触发升级。
- `market_value` 不重算（既有行为：改能力不触发身价重算）。
- **离线 SQL 不写 `audit_log`**；要留痕可另插一条 audit。
- 写入量：257 条语句 ≈ 257 × 5（1 行 + 4 索引）≈ **1.3k rows_written**（免费档 10 万/天，安全）。

## 8. 裁决（已定，2026-09-20）

| # | 议题 | 裁决 |
| --- | --- | --- |
| 1 | 落级口径 | **Case B**：只改现值、不动基准（用户裁定「这批应该不改变 base，让此次变动归为成长」） |
| 2 | `height`/`weight`/`weakfoot` | **不写**（实测差异 0 行；早前「推荐同步」是按同源推理的错判，已更正） |
| 3 | `PosID1-4` | **不同步**（实测 0 行差异；且位置影响报名阵容规则，不扩大范围） |
| 4 | `RoleID1-5` / `PSID1-15` | **同步**（9 + 51 槽位，只增不删、保序追加） |
| 5 | 队籍 | **本批不动**，另开 `scripts/prod-20260920-s9-club-align/`（481 条语句） |
| 6 | `audit_log` | **不写**（`prod-20260919-*` 惯例；靠本目录 README + 报告留痕） |
| 7 | `nationality` / `contractvaliduntil` | **不补**（合同来自另一个源：`一线队-S9.csv`） |
| 8 | 金徽落槽 | `Playstyles+` 基础名 **+100** 落 `PSID13-15`（与 `web/src/lib/api.ts:179` 前端口径一致）；`NumofPS` 不动（全仓无人读） |
| 9 | `One club player` / `Injury prone` | **丢弃**（不在 PlayStyleID 表内，属生涯特性） |

## 9. 执行步骤（许可后）

1. `node gen-abilities-sql.ts --verify` —— 只读复核：期望「缺失 0 / 剩余差异 0 行」（退出码 0；有差异退 4）。
2. `node gen-abilities-sql.ts` 重跑生成（若距离上次生成已久，旧值与守卫会重新抓；报告写明生成时点）。
3. 执行前复查：`01-precheck.sql`（570 个 `fc_id` 全部命中、`game_attrs` 全部 `json_valid`、守卫计数）。
4. 逐片执行 `sql/abilities-update-0N.sql`（本批**不碰任何外键列**，`--file` 可用；`scripts/README.md:66` 的 `--command` 纪律是为含外键/大事务的工件设的）。
5. 跑 `02-verify.sql` + `01-precheck.sql` 复查（`from_null` 之类计数应归零）。
6. 需要回退时逐片执行 `rollback/abilities-rollback-0N.sql`（按新值守卫，重复执行 changes = 0），再跑一次 `--verify` 看差异是否回到 257。

## 10. 验收

```sql
-- 逐人核对（只读）：把 s901 的 overallrating 与落库后 ca 比对，期望 0 行不等
-- 生成器把这份比对做成了 --verify 模式（等价于逐行重算）：期望「剩余差异 0 行」
-- 现值列：ca / pa / RoleID / PSID
-- Case B 下这些**故意不等**，不是错误：
--   players.base_ca 与 json_extract(game_attrs,'$.CA') 仍停在换版前
--   json_extract(game_attrs,'$.PA') 同 players.pa 的关系不再成立（$.PA 不写）
SELECT COUNT(*) FROM players WHERE fc_id IN (…) AND json_valid(game_attrs) = 0;   -- 期望 0
SELECT COUNT(*) FROM players WHERE fc_id IN (…) AND ca < 1 OR ca > 99;            -- 期望 0
```

## 11. 工件清单（已产，2026-09-20）

| 文件 | 内容 |
| --- | --- |
| `gen-abilities-sql.ts` | 读 s901 + 反查表 + 只读抓生产旧值 → 产分片/回滚/预检/验收/报告；支持 `--verify`、`--local` |
| `sql/abilities-update-01.sql`、`-02.sql` | 257 条 `UPDATE`（2 片 ×200）—— **gitignore** |
| `rollback/abilities-rollback-01.sql`、`-02.sql` | 同 257 条反向（写回原样值，含槽位 `0` 哨兵）—— 提交留档 |
| `01-precheck.sql` | 执行前只读复查 |
| `02-verify.sql` | 执行后只读验收 |
| `abilities-report.md` | 逐字段变更计数、逐队明细、未映射文本、分片 sha256、演练与执行步骤 |

## 12. 本地演练（已完成，不碰生产）

`scratch/abilities-local-dryrun.mjs`（一次性探针，gitignored）：本地 D1 造 2 行夹具（`fc_id 277225`/`269186`，槽位灌哨兵 `111`），加 `AFTER UPDATE ON players` 触发器计数（本地 `meta` 没有 `changes` 字段，只能这样记）。

| 步骤 | 结果 |
| --- | --- |
| 首跑 `sql/abilities-update-01.sql` | 触发器日志 2（只有这 2 条命中，其余 255 条守卫不匹配） |
| 再跑一次 | 日志仍 2 ⇒ **幂等闸成立** |
| 把 `fc_id 277225` 的 `ca` 改成 999 再跑 | 日志仍 2、`ca` 保持 999 ⇒ 错版被拒 |
| 读回 | `fc 277225` `ca 73→76`、`pa` 无变更、`base_ca 72` 未动；`fc 269186` `ca 74→76`、`base_ca 73` 未动；槽位与语句字面量一致 |

⇒ `json_set`、守卫条件、`base_ca` 不动、槽位写法四件事都已验证。

另外两处自审后加固的闸（2026-09-20 复审）：
- **槽位溢出即中止**：源项数 > 列数（角色 5 / 花式 12 / 金徽 3）时不再静默截断——`mergeSlots` 返回 `dropped`，生成器计入 `slots_dropped` 并以退出码 5 中止（**不能用 `--allow-skipped` 放过**，那属数据丢失）。真实数据实测 `slots_dropped = 0`（报告 §末行「槽位溢出…0 行」）。
- **`skipped`（只比对不写的字段有差异）** 默认中止并给退出码 3；真实数据实测 0 条（§5.2 的 `height`/`weight`/`weakfoot`/`PosID` 全 0 差异）。
