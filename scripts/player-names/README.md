# 球员显示名与球衣号派生（v4.0.0，v5.0.1 扩充）

把 FC26 存档里的人名与球衣号派生成本库 `players` 的 `first_name` / `last_name` /
`common_name` / `display_name` / `number` 五列（迁移见
`src/db/migrations/0032_players_display_name_number.sql`）。

`players.name` 的语义不变：仍是 FC26db 官方缩写名（`M. Ødegaard`），也是导入对齐键
`fc_id` 的伴生列。显示处一律 `COALESCE(display_name, players.name)`
（`src/core/player-name.ts` 的 `sqlDisplayName`），所以派生不到名字的人自动回落到缩写名。

## 数据源（本机，只读）

| 文件 | 内容 | 实测 |
| --- | --- | --- |
| `E:/FC26 LE v26.3.5/player_presets/base_players.csv` | `playerid` + `firstnameid` / `lastnameid` / `commonnameid` | 149 列 / 22,348 行；四个文本人名列**全空**，只能走字典；**没有球衣号列**（球衣相关列只有 `playerjerseyname` / `playerjerseynameid` 这类名字字段） |
| `E:/FST存档修改器编辑器v1.2.0/config/playernames.txt` | `nameid → 人名` | UTF-16LE + BOM 的 TSV，41,190 条，max nameid 41,189 |
| `E:/FC26 LE v26.3.5/player_presets/cards.csv` | `playerid → 完整人名` | 55 列 / 24,731 行，覆盖 18,850 个 playerid；**21 个 playerid 的多行名字互相矛盾**（如 237067 同时出现过 `Marcelo Vieira da Silva` 与 `Edson Arantes Nascimento`），这些 pid 一律不采信 |
| `E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901/splitted/*.xlsx` | **球衣号真源**：一队一份、无表头，第 0 列球衣号 / 第 1 列全名，文件名 `<FC26 club_id> - <队名>.xlsx` | 20 队 / 570 人；号码空行 0、队内重号 0 |

字典有两份，另一份 `E:/FC25 CT v25.1.6/other/playernames.csv`（42,029 条）实测与 FC26 的缺号
0 命中，生成器不用它。

远端只读查询（`derive.mjs` 缓存到 `data/*.json`，`--refresh` 重拉）：只剩 `whl-club`
`players(fc_id, name, club_id)` 一份。

**赛事系统 `whl.player` 不再是号码来源。** 2026-09-23 赛事仓的名册同步（v5.0.0 步骤 10）按
「姓名、号码一律以 club 为准」把我方当时的**空号码**写回了它自己的库：570 行 `number` 全空、
`name` 变成我方缩写名。原始号码与全名自此只剩两份外部副本 —— s901 存档表（上表）与
`WHL-tournament-management-system/scripts/fc26-id-rekey/players-dump.json`（2026-09-16 快照），
两者按姓名逐条比对 570/570 一致，所以号码真源从此是 s901。旧脚本里「赛事系统 `player.id` 就是
本库 `fc_id`、球衣号按 `fc_id` 搬」那套假设随之作废；`data/tour-players.json` 是那次刷新留下的
空号码缓存，别再拿它校验。

## 派生规则

显示名：

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

球衣号（存档表文件名里的 FC26 `club_id` 与本库 `players.club_id` 是同一个空间 —— 20 队人数逐个
相同，所以先按队收窄，再在队内认人）：

1. 逐字相同（存档全名 == `players.name`）
2. 归一化相同（小写 + 去变音符号 + 非字母数字转空格 + 折叠空白）
3. 同队同姓唯一
4. 队内唯一余量（这队只剩这一个没认领的人）

每级只认「唯一命中」，认到的从池子里划掉再算下一级；四级后还认不出的、或某队人数对不上的，
写进汇总并让退出码为 1（不落库）。

## 实测结果（2026-09 数据）

```
18,301 人：显示名 17,470，回落 players.name 831
来源：commonname 2,548 / 名+姓 14,527 / cards 兜底 395 / 空 831
球衣号 570 条：逐字相同 565 / 同队同姓唯一 3 / 队内唯一余量 2
```

- **570 名俱乐部球员全部有显示名**（149 commonname / 420 名+姓 / 1 cards 兜底 —— fc 76396
  `Andrea Natali`，字典里这个人 lastnameid 是 0）。
- 831 人派生不出显示名，全是没有任何俱乐部的球员库长尾（导入后新增的补丁球员，字典里 nameid
  大于 41,189，也没有 cards 行），显示回落缩写名。523 人显示名是单词（FC26 只给了常用名）。
- 搜索同时匹配显示名与 `players.name`，所以单词显示名的人仍可按姓搜到（见 `src/worker/routes/players.ts`）。
- 派生名与存档表全名有 5 例是**同一个人的两种口径**，号码照写，姓名不跟随存档表
  （`200104` s901 `Son Heung Min` vs 本库 `Heung Min Son`、`226456` `Fornals` vs `Pablo Fornals`、
  `264432` `Abde` vs `Abdessamad Ezzalzouli`、`264846` `Cristhian Mosquera` vs `Mosquera`、
  `276048` `Fernandez-Pardo` vs `Matias Fernandez-Pardo`）；跨系统同步以 FC26 派生名为准。
- 落库已在生产跑通（2026-09-23）：46 条语句全部成功，`players` 计数为
  `total 18,301 / display_name 17,470 / first_name 17,329 / last_name 17,099 /
  common_name 2,549 / number 570`，点查 fc 20801 = `display_name='Cristiano Ronaldo'` /
  `number='7'`；`GET /api/squads` 回读 20 队 570 人、号码齐全。
  （CSV 里 `first_name` / `last_name` 的非空数比落库数多约 570 / 99 —— 这两列只有 CSV 审计快照
  在写，SQL 侧对「显示名来自 commonname」的行不发名/姓，且没有任何代码读这两列，不影响显示。）
- `common_name` 落库比 SQL 多 1 行：那一行库里本来就有值，`COALESCE` 按设计不覆盖。

## 用法

```bash
node scripts/player-names/derive.mjs            # 读本机存档 + 缓存数据，产出 out/
node scripts/player-names/derive.mjs --refresh  # 先重拉远端只读查询
node scripts/player-names/load.mjs --dry-run    # 只看语句数与体积，不连库
node scripts/player-names/load.mjs --local      # 落到本地 D1
node scripts/player-names/load.mjs --remote --yes-prod --numbers --purge   # 写生产 + 球衣号 + 失效缓存
```

`derive.mjs` 退出码非 0 表示有存档表里的人在本库 `club_id` 下找不到、某队人数对不上、或出现新的
认人失败 —— 先看 `out/display-names.csv` 再决定是否落库。产出物（`data/`、`out/`）不进版本库，
见 `.gitignore`。

`--purge` 不是可选项而是固定收尾：`load.mjs` 直连 D1，不经过 `src/worker/index.ts` 的 purge
中间件，不把 `cache:epoch:public` 加一的话公开读最长 24h 才看到新数据（键里带版本号，一次
bump 同时作废 L1 与 L2）。

## 四个踩过的坑（改这两个脚本前先看）

- **产出文件里不能有 `BEGIN`/`COMMIT`**：D1 拒收 SQL 事务控制语句，本地与远端一样，报
  `please use the state.storage.transaction() … instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements`。
  `load.mjs` 是逐条语句发给 D1 的，所以第一条就抛错、一条都落不了库（fail-closed，不会脏数据）。
  这里也不需要事务：每条语句只按 `fc_id` 更新自己那批行，重复执行结果相同，中断后整体重跑即可。
  `load.mjs` 另有一道守卫：真在文件里读到事务控制语句就直接退出码 2 说清楚，不让它变成一条看不懂的 D1 报错。
- **不要 `spawn('npx.cmd')`**：Node 24 在 Windows 上对 `.cmd`/`.bat` 直接抛 `EINVAL`（`.cmd` 现在必须带
  `shell`，而带 `shell` 又得自己处理引号）。`derive.mjs` / `load.mjs` 都改成用 `process.execPath` 跑
  `node_modules/wrangler/bin/wrangler.js`，绕开这一整类麻烦。
- **写库走 `--command`，不要走 `--file`**：`--file` 是 D1 的 *import* 异步端点（`POST …/import` 然后轮询），
  实测在同一台库上对完全合法的 SQL 报过一整串假错：`{"D1_RESET_DO":true}`、
  「SQL code did not contain a statement」、还有解析出的 `syntax error` offset 比文件本身还长。
  换 `--command`（同步 `/query` 端点）后仍偶发撞到同一类假错 —— 同一条语句隔半分钟重跑就过、
  服务端 `success:true` —— 所以 `load.mjs` 每条失败自动重试 3 次（语句按 `fc_id` 幂等，重试安全）。
  代价是语句要塞进 Windows 命令行（上限约 32KB），所以 `derive.mjs` 的 `BATCH` 是 400（约 22KB），
  `load.mjs` 另有一道 30,000 字符的闸门。
- **`--command` 的 SQL 不能以 `--` 注释开头**：wrangler 用 yargs 解析参数，语句头部的注释行会被当成
  命令行选项，报 `Unknown arguments: 由 scripts/player-names/derive…`（生成文件每条语句都带文件头注释）。
  `load.mjs` 发之前会整行删掉 `--` 注释（数据行都以 `(` 开头，不会被误删）。
