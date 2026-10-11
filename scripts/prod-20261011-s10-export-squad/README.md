# S10 队表导出（FC Editor `Squad Info` 61 列）

> 离线生成器：读生产 D1 的平台真值 → 写 20 个 `Squad Info` xlsx，供 FC Editor 做 s10 存档。
> **只读生产**（两条 SELECT，不写任何库）；不碰 FC Editor 安装目录（只读它的 `player_tables/s901` 做对照）。
> 线上 / 平台内自助导出**不在本轮**，见 `ROADMAP.md` 的远期条目。

## 1 形态

```
gen-export.ts          生成器（node 直接跑，Node 24 原生类型剥离，无 tsx）
  --out <目录>         输出目录（默认 scratch/export-s10）
  --squad all|first_team   球员范围（默认 all = 一线队 + 训练营）
  --prev <s901 目录>   对照 / 三列缺口取值来源（默认 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901）
  --source <players.json>  改用上次的快照当输入（不连 D1；离线重算用）
  --retry <次数>       D1 单条查询重试（默认 5，间隔 3s）
  --local              改读本地 D1（wrangler dev 的 .wrangler/state）
  --dry-run            只统计不写文件
  --verify             读回产物逐列自检（值 + 单元格类型 + 表头 + 行数 + 文件集合）
  --diff-prev          与 --prev 目录全字段全字符对照
退出码：0 通过 / 2 参数或输入错 / 3 导出失败 / 4 自检或 A 硬闸不通过
```

产物（`--out` 下）：20 个 `<clubId> - <队名>.xlsx` + `players.json`（快照；含每人的 s901 文本，**仅供对照报告**）+ `export-report.md`；
`--verify` 写 `verify-report.md`，`--diff-prev` 写 `diff-prev-report.md`。

## 2 用法

```bash
cd C:/Users/bhdjb/whlProgram/WHL-club-operations-platform

# ① 默认导出（20 队 / 570 人 → scratch/export-s10）
node scripts/prod-20261011-s10-export-squad/gen-export.ts

# ② 指定目录（可直接写进 FC Editor 的存档队表目录）
node scripts/prod-20261011-s10-export-squad/gen-export.ts --out "E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s10"

# ③ 只要一线队 / ④ 干跑看行数 / ⑤ 自检 / ⑥ 与 s901 全字段全字符对照
node scripts/prod-20261011-s10-export-squad/gen-export.ts --squad first_team
node scripts/prod-20261011-s10-export-squad/gen-export.ts --dry-run
node scripts/prod-20261011-s10-export-squad/gen-export.ts --verify
node scripts/prod-20261011-s10-export-squad/gen-export.ts --diff-prev
```

**下一次（s11）**：把上一代的目录传给 `--prev`，平台没有的三列（生日 / 加盟日 / 合同到期）就按上一代续上（角色 / 花式仍按线上库出，不沿用上一代写法）：

```bash
node scripts/prod-20261011-s10-export-squad/gen-export.ts --prev "<上一代目录>" --out "<新一代目录>"
```

## 3 列映射（61 列，表头真源 = `src/core/fc26.ts` 的 `FC_EDITOR_GAME_ATTR_COLUMNS`）

| # | Editor 列 | 取值 | 空值写法 |
|---|---|---|---|
| 1 | playerid | `players.fc_id` | — |
| 2 | firstname | `players.first_name` | 空串 |
| 3 | lastname | `players.last_name` | 空串 |
| 4 | commonname | `players.common_name` | 空串 |
| 5 | Position | `game_attrs.PosID1` → `ref/position.json` | `None` |
| 6 | Position2 | `game_attrs.PosID2` → 同上 | `None` |
| 7 | Position3 | `game_attrs.PosID3` → 同上 | `None` |
| 8 | Position4 | `game_attrs.PosID4` → 同上 | `None` |
| 9 | number | `players.number` | 单元格留空 |
| 10 | teamid | `players.club_id` | — |
| 11 | playerjointeamdate | **s901 原值**（平台无此字段） | 单元格留空（新人） |
| 12 | contractvaliduntil | **s901 原值**（平台无日历到期日） | 单元格留空（新人） |
| 13 | overallrating | `players.ca`（现值，**不是** `$.CA`） | — |
| 14 | potential | `players.pa`（现值，**不是** `$.PA`） | — |
| 15 | birthdate | **s901 原值**（平台只有 age，无生日） | 单元格留空（新人） |
| 16 | nationality | `game_attrs.naID`（数字 naID，原样） | — |
| 17 | preferredfoot | `players.foot`（1 → `Right` / 0 → `Left`） | 空串（foot 异常时） |
| 18 | weakfootabilitytypecode | `game_attrs.weakfoot` | — |
| 19 | height | `game_attrs.height` | — |
| 20 | weight | `game_attrs.weight` | — |
| 21 | finishing | `game_attrs.finishing` | — |
| 22 | headingaccuracy | `game_attrs.headingaccuracy` | — |
| 23 | longshots | `game_attrs.longshots` | — |
| 24 | shotpower | `game_attrs.shotpower` | — |
| 25 | volleys | `game_attrs.volleys` | — |
| 26 | crossing | `game_attrs.crossing` | — |
| 27 | longpassing | `game_attrs.longpassing` | — |
| 28 | shortpassing | `game_attrs.shortpassing` | — |
| 29 | ballcontrol | `game_attrs.ballcontrol` | — |
| 30 | curve | `game_attrs.curve` | — |
| 31 | dribbling | `game_attrs.dribbling` | — |
| 32 | defensiveawareness | `game_attrs.defensiveawareness` | — |
| 33 | slidingtackle | `game_attrs.slidingtackle` | — |
| 34 | standingtackle | `game_attrs.standingtackle` | — |
| 35 | aggression | `game_attrs.aggression` | — |
| 36 | composure | `game_attrs.composure` | — |
| 37 | interceptions | `game_attrs.interceptions` | — |
| 38 | positioning | `game_attrs.positioning` | — |
| 39 | reactions | `game_attrs.reactions` | — |
| 40 | vision | `game_attrs.vision` | — |
| 41 | acceleration | `game_attrs.acceleration` | — |
| 42 | agility | `game_attrs.agility` | — |
| 43 | balance | `game_attrs.balance` | — |
| 44 | jumping | `game_attrs.jumping` | — |
| 45 | sprintspeed | `game_attrs.sprintspeed` | — |
| 46 | stamina | `game_attrs.stamina` | — |
| 47 | strength | `game_attrs.strength` | — |
| 48 | freekickaccuracy | `game_attrs.freekickaccuracy` | — |
| 49 | penalties | `game_attrs.penalties` | — |
| 50 | gkdiving | `game_attrs.gkdiving` | — |
| 51 | gkhandling | `game_attrs.gkhandling` | — |
| 52 | gkkicking | `game_attrs.gkkicking` | — |
| 53 | gkpositioning | `game_attrs.gkpositioning` | — |
| 54 | gkreflexes | `game_attrs.gkreflexes` | — |
| 55 | role1 | `game_attrs.RoleID1` → `ref/role.json` 的 `en` | `0` |
| 56 | role2 | `RoleID2` → 同上 | `0` |
| 57 | role3 | `RoleID3` → 同上 | `0` |
| 58 | role4 | `RoleID4` → 同上 | `0` |
| 59 | role5 | `RoleID5` → 同上 | `0` |
| 60 | Playstyles | `PSID1..12` → `ref/playstyle.json` 银表基础名 | 空串 |
| 61 | Playstyles+ | `PSID13..15`（−100）→ 银表基础名 | 空串 |

键名口径：库内 `game_attrs` 用 FC26 的 71 键（`PosID1-4` / `RoleID1-5` / `PSID1-15` / `naID` / `height` / `weight` / `weakfoot`），
Editor 侧 61 列用的是它的列名——**34 项能力两侧同名**，其余靠上表换名（`scripts/prod-20260920-s9-abilities/README.md:65` 同源）。

## 4 口径（8 条）

1. **三列缺口**（`birthdate` / `playerjointeamdate` / `contractvaliduntil`）：平台没有这三个字段，按用户裁定「s901 照抄，新人留空」——取值一律来自 `--prev` 目录里同一个 `playerid` 的单元格（连类型一起搬，日期是 `DD/MM/YYYY` 文本、合同是年份数字）。
2. **姓名三列**：平台是真源。v6.0.0 起由 `scripts/player-names/derive.mjs` 从 **FC26 字典**（`playernames.txt`，按 `base_players.csv` 的 `firstnameid` / `lastnameid` / `commonnameid` 索引）灌入，优先级 `commonnameid` → 名+姓 → `cards.csv` 全名兜底；逐人审计表在 `scripts/player-names/out/display-names.csv`（带 `source` 列）。**它与 s901 的 `commonname` 列不同源**——见 §6。导出按库内三列走；三列全空时才回退 `players.name` 按末空格拆分（记数），不猜 s901。
3. **`overallrating` / `potential` 取 `players.ca` / `players.pa`（现值）**，不取 `game_attrs.$.CA/$.PA`（那是最初导入的底稿）——`abilities-report.md` 的 `ca_vs_attr 254` 就是这两者的差。
4. **角色 / 花式文本忠实线上库**：文本一律取平台自己的反查表 `web/assets/ref/{role,playstyle}.json` 的 `en`，**不还原 s901 的写法**——平台表写 `CM Half-Winger +`（s901 是 `CM Half Winger +`）、`GK Sweeper Keeper  +`（双空格照平台表出）、`GK Ball-Playing Keeper +`（大小写照平台表出）。
5. **花式顺序按库内槽位**：`PSID1..12` / `PSID13..15` 的槽序（平台侧真值），**不按 s901 重排**。
6. **s901 有、库内无槽位的花式不回填**：`One Club Player` / `Injury Prone` 这类生涯特性不在 PlayStyleID 表里、库内无槽位 ⇒ 导出**不写**（2026-10-11 共 98 行命中，只记数备查）。用户 2026-10-11 裁定「特性和数值等忠实于线上库，不要回填」。
7. **金槽归一**：`PSID13-15` 存的是 101..156（= 银表 id + 100），导出减 100 后取银表基础名（s901 的 `Playstyles+` 给的就是基础名，如 `Enforcer`）。
8. **槽位空判定**：角色 / 花式 `≤ 0` 为空，位置 `< 0` 为空（`PosID 0` 是 GK 真值）——与 `scripts/prod-20260920-s9-abilities/gen-abilities-sql.ts` 同口径。银槽持金 id / 金槽持银 id 会记数报警。

## 5 验收留痕（2026-10-11）

- **类型检查**：`npx tsc --noEmit …（本文件单跑，strict + noUnusedLocals）` → 0 error。
- **导出**：20 队 / **570 人**，逐队行数与 s901 **差 +0 全中**（30/30/31/37/28/25/23/23/37/26/31/31/29/29/23/30/25/31/26/25）；异常清单只剩 1 条：`s901 花式库内无槽位（不回填）：98`（角色 0 条）。
- **自检 `--verify`**：✅ 通过——读回 20 个 xlsx，61 列逐列比值 + 单元格类型（数字列 `t=n` / 文本列 `t=s`）+ 表头 + 行数 + 文件集合，0 差异。
- **对照 `--diff-prev`（全字段全字符）**：61 列逐列、逐字符比对 **570 人 × 61 列 = 34,770 个单元格**，不做 trim / 大小写 / 标点归一（`null` 与空串都表示「没有字符」故等值）。结果：

  | 分级 | 差异 | 说明 |
  |---|---|---|
  | A 硬闸（身份 / 位置 / 队伍 / 国籍 / 身体 / 逆足 / 三列缺口） | **0** | 通过（S9 时两侧逐字一致，非 0 即停下人工确认） |
  | B 数值（overallrating / potential / 34 项能力） | **0** | 与 s901 逐字相同 |
  | C 文本（role1-5 / Playstyles / Playstyles+） | **180** | 平台库槽位 + 反查表出值，三类成因见 §6.1 |
  | D 平台侧可编辑（firstname / lastname / commonname / number） | **6** | 见 §6.2 |

  差异共 **168 人 / 186 处**；`s901 有、本次导出无` **0 人**；退出码只看 A（0 通过 / 非 0 为 4）。
  哨兵交叉核对：产物 `commonname` 空串 421 = s901 418 + 平台侧 3 人清空；`Position2=None` 162、`role2=0` 134、`Playstyles+` 空 471 与 s901 **逐项相同**；`Playstyles` 空串 52 = s901 51 + 1 人（s901 的花式列只有生涯特性 ⇒ 按线上库出就是空）。
- **`--out` / `--squad`**：`--out scratch/export-s10-firstteam --squad first_team` → 20 文件 / **505 人**（S9 名册 505 一线队 + 65 训练营；CPU 队 10 / 131681 无训练营合同，25 人全在一线队），`--verify` 同样 ✅。
- **交付落点（2026-10-11）**：正式交付用 `--source scratch/export-s10/players.json --out "E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s10"` 把 20 个 xlsx 写进 FC Editor 的 `player_tables/s10/`（**新建目录，未动 s901**）；该目录只放 20 个 xlsx（与 s901 同形），`players.json` 与三份报告留在 `scratch/export-s10-fc-editor/`。落点处 `--verify` ✅、`--diff-prev` 与上表逐项相同（A 0 / B 0 / C 180 / D 6）。
- **独立复核**（不依赖本脚本的 `--verify`）：直接用 SheetJS 读 `s10/5 - Chelsea.xlsx` → sheet `Squad Info`、`!ref A1:BI32`（与 s901 的 Chelsea 文件**同一个 ref**）、61 列表头、31 数据行，首行 `playerid 259031 / Liam / Delap / number 29 / teamid 5 / overallrating 80 / role1 "ST Advanced Forward +" / Playstyles "Power Shot, Enforcer, Quick Step"`（花式顺序即库内 `PSID` 槽序，s901 写的是 `Power Shot, Quick Step, Enforcer`）。

## 6 与 s901 的差异（A / B 均 0；C 180 处、D 6 处，逐条列出备查）

导出**忠实线上库**，所以与 2026-09-05 的 s901 快照存在差异是预期内的；只有 A 硬闸要求 0。
这些差异**不是映射缺陷**，是平台侧真值与那份快照不同。取证：`SELECT fc_id, first_name, last_name, common_name, display_name FROM players WHERE fc_id IN (…)` + 姓名派生审计表 `scripts/player-names/out/display-names.csv`（列：`fc_id, our_name, club_id, display_name, source, first_name, last_name, common_name, s901_name, s901_number`）。

### 6.1 C 文本 180 处（三类成因，全部是平台侧真值）

| 成因 | 处数 | 例 |
|---|---|---|
| **写法**：平台反查表的拼写与 s901 不同（连字符 / 双空格 / 大小写） | role1×35、role2×17、role3×8、role4×6、role5×1（合计 67） | fc 272455 `role2`：s901 `CM Half Winger +` → 本次 `CM Half-Winger +`（平台表写法） |
| **顺序**：库内槽序 ≠ s901 顺序（库内是「并集 + 保序追加」） | 含在 Playstyles×113 内 | fc 243812 Rodrygo：s901 `Dead Ball, Gamechanger, Inventive, Technical, Rapid` → 本次 `Finesse Shot, Dead Ball, Gamechanger, Inventive, Technical, Rapid`（`PSID1=1`，按槽序出；平台侧另有一个第 6 银槽 `PSID6=32` 也照出） |
| **生涯特性不回填**：`One Club Player` / `Injury Prone` 不在 PlayStyleID 表里、库内无槽位 | Playstyles×113 内，命中 98 行 | fc 241651：s901 末位 `One Club Player` → 本次无；fc 245630：s901 末位 `Injury Prone` → 本次无 |

Playstyles×113 的分解（实测，三者可叠加）：**98 行**因生涯特性被去掉（共 110 个条目——98 人，其中 12 人各带 2 个）+ **1 行**因平台侧后加的花式（fc 243812 第 6 银槽 `PSID6=32`）+ **14 行**纯槽序不同（集合相同、顺序不同）。role1-5 的 67 处**全部只是写法**——逐条归一化（连字符→空格 / 折叠空白 / 小写）后 67/67 相同，0 处真实差异。

### 6.2 D 平台侧可编辑 6 处（姓名三列 / 球衣号，平台是真源）

| # | fc_id | 列 | s901 | 本次导出（= 平台真值） | 取证 |
|---|---|---|---|---|---|
| 1 | 76396 | lastname | `Natali` | （空） | 字典的 `lastnameid` 缺号 ⇒ `last_name` 空（`source=cards`：显示名走 `cards.csv` 兜底 `Andrea Natali`，**与 s901 的写法一致**）；库内 `first_name="Andrea"` / `display_name="Andrea Natali"` ⇒ **平台侧 `last_name` 缺值**，建议补上再重导（只有这一列受影响） |
| 2 | 200104 | commonname | `Son Heung Min` | （空） | 审计表 `source=full`（字典无 `commonnameid` ⇒ 用名+姓）⇒ 平台显示名 `Heung Min Son`；`common_name` 在库内是**空串**（`display_name.sql` 里写的是 NULL，之后被平台侧改成空串） |
| 3 | 226456 | commonname | `Fornals` | `Pablo Fornals` | 审计表 `source=common` ⇒ 字典的 commonname = `Pablo Fornals`（与 s901 的 `Fornals` 不同） |
| 4 | 264432 | commonname | `Abde` | （空） | 审计表 `source=full`（字典无 commonname）⇒ 显示名 `Abdessamad Ezzalzouli` |
| 5 | 264846 | commonname | `Cristhian Mosquera` | `Mosquera` | 审计表 `source=common` ⇒ 字典的 commonname = `Mosquera` |
| 6 | 276048 | commonname | `Fernandez-Pardo` | （空） | 审计表 `source=full`（字典无 commonname）⇒ 显示名 `Matias Fernandez-Pardo` |

第 2–6 行正是 `derive.mjs` 头注释记的「565 例逐字 + **5 例同人异名**」——两侧名字来自不同源（平台走 FC26 字典，s901 走 FC Editor 的 `commonname` 列），不是谁错了。
姓名三列与球衣号**在平台内可编辑**（`players` 的 `first_name` / `last_name` / `common_name` / `number`），导出以平台为真源；
若要让存档与 s901 逐字相同，就在平台侧改回来再重导（改完重跑 `--verify` + `--diff-prev` 即可复核，D 栏会随之变化）。

## 7 未做 / 边界

- 不写生产库（只两条 SELECT）。对 FC Editor 安装目录**默认只读**（读它的 `player_tables/s901` 当 `--prev`）；2026-10-11 交付时经 `--out` 明确指定，在 `player_tables/` 下**新建** `s10/` 放 20 个 xlsx，未改 s901 与其它任何文件。
- 不做线上 / 平台内自助导出（`ROADMAP.md` 远期条目）；不往 FC Editor 反写。
- **忠实线上库的边界**：除三列缺口（生日 / 加盟日 / 合同到期，靠 `--prev` 续传）外，61 列全部来自线上库——`players` / `contracts` / `registrations` + `game_attrs` + 平台反查表 `web/assets/ref/*.json`；s901 的写法、顺序、生涯特性一律不参与出值，只在 `--diff-prev` 报告里列差异。
- 平台没有的三个字段（生日 / 加盟日 / 合同到期）靠 `--prev` 目录续传，**首次出现的球员留空**，需要在 FC Editor 里手填。
- 训练营判定用 `registrations.season=9` 的 `squad`（用户 m00980 拍定：持训练营合同 = 训练营，其余一线队），不是 `players.status`。
- 产物体积比 s901 大：s901 12.8–16.9 KB / 本次 58.3–82.7 KB（两边写盘实现不同）。内容以 `--verify` 读回为准——值、单元格类型、表头、行数逐项全中。
- 未在 FC Editor 里实际导入验证（本轮无 FC Editor 环境）；导入后若编辑器报字段问题，拿 `--diff-prev` 的逐列计数表对照排查。
