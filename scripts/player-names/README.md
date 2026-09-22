# 球员显示名派生（增量 32）

把 FC26 存档里的人名派生成本库的显示名，落到 `players` 的 `first_name` / `last_name` /
`common_name` / `display_name` / `number` 五列（迁移见
`src/db/migrations/0032_players_display_name_number.sql`）。

`players.name` 的语义不变：仍是 FC26db 官方缩写名（`M. Ødegaard`），也是导入对齐键
`fc_id` 的伴生列。显示处一律 `COALESCE(display_name, players.name)`
（`src/core/player-name.ts` 的 `sqlDisplayName`），所以派生不到名字的人自动回落到缩写名。

## 数据源（本机，只读）

| 文件 | 内容 | 实测 |
| --- | --- | --- |
| `E:/FC26 LE v26.3.5/player_presets/base_players.csv` | `playerid` + `firstnameid` / `lastnameid` / `commonnameid` | 148 列 / 22,348 行；四个文本人名列**全空**，只能走字典 |
| `E:/FST存档修改器编辑器v1.2.0/config/playernames.txt` | `nameid → 人名` | UTF-16LE + BOM 的 TSV，41,190 条，max nameid 41,189 |
| `E:/FC26 LE v26.3.5/player_presets/cards.csv` | `playerid → 完整人名` | 55 列 / 24,731 行，覆盖 18,850 个 playerid；**21 个 playerid 的多行名字互相矛盾**（如 237067 同时出现过 `Marcelo Vieira da Silva` 与 `Edson Arantes Nascimento`），这些 pid 一律不采信 |

字典有两份，另一份 `E:/FC25 CT v25.1.6/other/playernames.csv`（42,029 条）实测与 FC26 的缺号
0 命中，生成器不用它。

远端只读查询（`derive.mjs` 缓存到 `data/*.json`，`--refresh` 重拉）：

- `whl-club` `players(fc_id, name, club_id)`
- `whl` `player(id, name, number, team_id)` —— **赛事系统的 `player.id` 就是本库 `players.fc_id`**，
  `team_id` 就是 `club_id`（实测 570 行 570 命中、0 条归属不一致），所以球衣号按 `fc_id` 搬，
  绝不按名字匹配
- `whl-auth` `team(club_id, tour_team_id)`

## 派生规则

```
commonname 原样
|| 「名 姓」        （名、姓都能在字典里查到）
|| cards.csv 完整人名（字典缺号或缺栏时兜底；名字矛盾的 pid 不用）
|| 空              （SQL 侧回落 players.name）
```

`commonname` 原样优先，包括它只有一个词的情况：FC26 对熟脸球员就存单词常用名
（`Ederson`、`Marquinhos`、`Fabinho`、`Estêvão`、`Cristiano Ronaldo`），赛事系统里也正是这些写法。
加「补姓」启发式会把这 51 名俱乐部球员改坏（`Ederson` → `Ederson Santana de Moraes`），实测过，
已否掉。

## 实测结果（2026-09 数据）

```
18,301 人：显示名 17,470，回落 players.name 831
来源：commonname 2,548 / 名+姓 14,527 / cards 兜底 395 / 空 831
赛事系统 570 人：本库命中 570，球衣号可搬 570 条，归属不一致 0 条
```

- **570 名俱乐部球员全部有显示名**（149 commonname / 420 名+姓 / 1 cards 兜底 —— fc 76396
  `Andrea Natali`，字典里这个人 lastnameid 是 0）。
- 570 人里 565 人派生结果与赛事系统逐字相同；5 例差异是赛事系统自己的短名/语序，派生规则不跟随
  （`200104` `Son Heung Min` vs `Heung Min Son`、`226456` `Fornals` vs `Pablo Fornals`、
  `264432` `Abde` vs `Abdessamad Ezzalzouli`、`264846` `Cristhian Mosquera` vs `Mosquera`、
  `276048` `Fernandez-Pardo` vs `Matias Fernandez-Pardo`）。后续跨系统同步以 FC26 派生名为准。
- 831 人派生不出显示名，全是没有任何俱乐部的球员库长尾（导入后新增的补丁球员，字典里 nameid
  大于 41,189，也没有 cards 行），显示回落缩写名。523 人显示名是单词（FC26 只给了常用名）。
- 搜索同时匹配显示名与 `players.name`，所以单词显示名的人仍可按姓搜到（见 `src/worker/routes/players.ts`）。

## 用法

```bash
node scripts/player-names/derive.mjs            # 读本机存档 + 缓存数据，产出 out/
node scripts/player-names/derive.mjs --refresh  # 先重拉远端只读查询
node scripts/player-names/load.mjs --dry-run    # 只看语句数与体积，不连库
node scripts/player-names/load.mjs --local      # 落到本地 D1
node scripts/player-names/load.mjs --remote --yes-prod   # 写生产，必须显式双开关；也可加 --numbers 搬球衣号
```

`derive.mjs` 退出码非 0 表示赛事系统有人在本库 `fc_id` 里找不到、或出现新的逐字不一致 —— 先看
`out/display-names.csv` 再决定是否落库。产出物（`data/`、`out/`）不进版本库，见 `.gitignore`。
