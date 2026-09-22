# 球员库 D1 读量定标报告（增量 28 步骤 1）

**测量日期**：2026-09-22（UTC） · **目标**：生产 `whl-club`（`73154873-d5ae-42b0-a630-25f5ef60053d`）· **原始数据**：[`measurements.json`](./measurements.json)（30 形状 + 6 探针）

**为什么要这份报告**：2026-09-21 免费档 5,000,000 行/日读配额被耗尽，`/api/players*` 全线 500、cron 每 5 分钟失败。用户诉求原话：「目前球员库相对稳定，现在查找的 D1 读消耗过大！」治理前必须先知道「每个形状一次读多少行」——否则物化哪些列、缓存给多长 TTL 都只能靠猜。本报告是增量 28 步骤 4/5 的输入。

---

## 一、结论摘要

1. **默认浏览一页 18,819 行里，COUNT 占 18,763 行（99.7%）**，主查询只占 56 行。而 COUNT **不带 cursor、每翻一页都重算整表**。
2. **全表扫形状的成本几乎全在全表扫本身**：无索引排序的主查询 37,635 行，而「只选 id、不 join 的全表扫 + 排序」就已 36,602 行。**受控探针证明两个 LEFT JOIN 的成本是 0**（同样扫描 + 排序，加不加 JOIN 都是 36,602）；真实主查询比它多的 1,033 行来自宽投影/窗刻度子查询，**未做受控探针隔离，属未解释项**（占该形状 2%）。原先设想的「两段式（先选 id 再 join 补字段）能砍一半」**实测只省 2.6%，假设不成立**。
3. **带排序的全表扫是 2 行/行（18,301 → 36,602），不带排序是 1 行/行（18,301）**；能提前停下的路径是 21–64 行。⇒ **全表扫形状的唯一出路是让它能走索引提前停下**，于是**写配额成了步骤 4 的硬约束**（每条索引 ≈ 18,301 行写，免费档 10 万行/日）。
4. **最贵的单次形状是 11 个全表扫排序（56,398–56,400 行/次）与姓名查找（36,606 行/次）**；免费档下前者单独跑只能承受 **88 次/日**。
5. **索引不是「有列索引就行」**：`sort=club` 与 `sort=status` 虽有 `club_id` / `status` 的列索引，排序表达式是 `COALESCE(club_id,0)` 与 CASE 权重 ⇒ **索引失配，实测仍是 37,635 行**。同理 `view=initial` 把 `ca` 换成 `COALESCE(base_ca, ca)`，0027 的索引立刻失效（61 → 37,635）。
6. 三个零写成本的杠杆已在计划内：**去 COUNT（步骤 2）**、**边缘缓存 + 分级 TTL（步骤 3）**、**前端 staleTime（步骤 5）**。去掉 COUNT 后默认浏览一页 56 行，容量从 265 次/日升到 89,285 次/日。

---

## 二、方法

**测量手段（用户裁决 Q1）**：`wrangler d1 execute whl-club --remote --json`，读回每条的 `meta.rows_read` / `meta.duration`。

**关键设计：SQL 不手抄。** 读量的形状完全由路由拼出来的表达式决定（`sqlFold` 的 87 项链、`PS_COUNT_EXPR` 的 15 槽计数、29 个排序表达式、各种 COALESCE/CAST/CASE），手抄一份必然与线上漂移，而且漂移是静默的 —— 数字看着合理，其实测的是另一个查询。所以脚本用 **Hono 的 `app.request()` 直接调真实路由**（`src/worker/routes/players.ts` 的 default export），注入一个只记录不执行的假 D1，把路由实际执行的 SQL 与绑定参数抓下来，参数内联成字面量后交给 `wrangler`。副作用（好的那个）：路由改了 SQL，重跑脚本测到的就是新形状 —— 步骤 7 的验收复测直接复用。

**三条必须知道的边界**：
- **测的是管理通道，不是 worker 通道。** 管理通道在 9/21 配额触顶期间照样成功（配额上限只阻断 worker 侧真实表读），所以测量不受当日余量约束；但测出的 `rows_read` 是「这条 SQL 读多少行」的物理事实，与走哪条通道无关 —— 已用两个已知基准交叉验证：主查询 LIMIT 2 = 7 行、`COUNT(*) FROM players` = 18,301 行，与 9/21 排查时的数字一致。
- **`--local` 不回传 `meta.rows_read`**（实测全 `null`），所以本地只能验证脚本机制，数字必须打生产。
- **假 D1 的偏差**：详情形状实测 4 条语句，是因为假 D1 让 `club_id` 取到 1 从而走进了 clubs 分支；生产里 id=1 的球员若没有俱乐部就是 3 条（影响 4 vs 3 行，可忽略）。列表形状的 COUNT 行被假 D1 喂成 `n: null`，只影响返回值、不影响 SQL。

**平台坑**：`%` 不能原样进命令行（Windows 的 `execSync` 走 cmd.exe，`'%sesko%'` 会被当变量展开成 `''`，LIKE 会变成另一种形状）⇒ 字面量里的 `%` 一律拼成 `char(37)`（SQLite 语义等价：`||` 拼回 TEXT，LIKE 结果一致）；多行 SQL 进 `--command` 会偶发失败 ⇒ 折叠空白（折叠必须跳过字符串字面量内部）。

**脚本用法**：
```bash
node scripts/measure-d1-reads.mjs                        # 全量形状打生产
node scripts/measure-d1-reads.mjs --only=default         # 只跑一个形状
node scripts/measure-d1-reads.mjs --probes               # 只跑设计探针
node scripts/measure-d1-reads.mjs --dump                 # 只打印抓到的 SQL，不执行（不花读量）
node scripts/measure-d1-reads.mjs --json-out=scripts/d1-read-audit/measurements.json
```

---

## 三、形状实测（30 个）

「主查询 / COUNT」是把每条语句的 `rows_read` 拆开（配置探测恒为 0 行、约每分钟一次，已从表里剔除）。「容量」= `5,000,000 ÷ 合计`，即该形状**单独**把免费档日读量吃满所需的请求数。

| 形状 | URL | 主查询 | COUNT | 合计 | 容量（次/日） | 去掉 COUNT 后 |
| --- | --- | --- | --- | --- | --- | --- |
| 默认浏览（第 1 页，limit 20） | `/players?limit=20` | 56 | 18,763 | 18,819 | 265 | 89,285 |
| 第 5 页（cursor=100） | `/players?limit=20&cursor=100` | 52 | 18,763 | 18,815 | 265 | 96,153 |
| 初始视图（base_ca / json PA） | `/players?limit=20&view=initial` | 56 | 18,763 | 18,819 | 265 | 89,285 |
| sort=id（PK） | `/players?limit=20&sort=id` | 56 | 18,763 | 18,819 | 265 | 89,285 |
| sort=ca（0027 表达式索引） | `/players?limit=20&sort=ca` | 58 | 18,763 | 18,821 | 265 | 86,206 |
| sort=pa（0027 表达式索引） | `/players?limit=20&sort=pa` | 61 | 18,763 | 18,824 | 265 | 81,967 |
| sort=age（0027 表达式索引） | `/players?limit=20&sort=age` | 22 | 18,763 | 18,785 | 266 | 227,272 |
| sort=market_value（0027 表达式索引） | `/players?limit=20&sort=market_value` | 22 | 18,763 | 18,785 | 266 | 227,272 |
| **view=initial + sort=ca（0027 索引失配）** | `/players?limit=20&view=initial&sort=ca` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=club（有 club_id 列索引但表达式失配）** | `/players?limit=20&sort=club` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=status（有 status 列索引但 CASE 失配）** | `/players?limit=20&sort=status` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=wage（contracts 表，无法静态索引）** | `/players?limit=20&sort=wage` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=prestige（无索引）** | `/players?limit=20&sort=prestige` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=name（无索引 + 折叠表达式）** | `/players?limit=20&sort=name` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=ps（15 槽计数表达式）** | `/players?limit=20&sort=ps` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=influence（CASE + ROUND）** | `/players?limit=20&sort=influence` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=uid（CAST/SUBSTR）** | `/players?limit=20&sort=uid` | **37,635** | 18,763 | **56,398** | **88** | 132 |
| **sort=years（含窗刻度子查询）** | `/players?limit=20&sort=years` | **37,637** | 18,763 | **56,400** | **88** | 132 |
| **sort=protected（含窗刻度子查询）** | `/players?limit=20&sort=protected` | **37,637** | 18,763 | **56,400** | **88** | 132 |
| club_id=5（有索引） | `/players?limit=20&club_id=5` | 64 | 63 | 127 | 39,370 | 78,125 |
| club_id=free（`club_id IS NULL`，17,731 名自由身） | `/players?limit=20&club_id=free` | 22 | 17,732 | 17,754 | 281 | 227,272 |
| status=normal（有索引） | `/players?limit=20&status=normal` | 58 | 1,032 | 1,090 | 4,587 | 86,206 |
| growable=1（无索引） | `/players?limit=20&growable=1` | 95 | 18,588 | 18,683 | 267 | 52,631 |
| position=ST（主列 + PosID2-4 槽 OR） | `/players?limit=20&position=ST` | 110 | 18,397 | 18,507 | 270 | 45,454 |
| ps=25（12 个银槽 OR） | `/players?limit=20&ps=25` | 293 | 18,336 | 18,629 | 268 | 17,064 |
| attr=sprintspeed & attr_min=80 | `/players?limit=20&attr=sprintspeed&attr_min=80` | 88 | 18,505 | 18,593 | 268 | 56,818 |
| ca_min=80（不匹配 0027 表达式索引） | `/players?limit=20&ca_min=80` | 56 | 18,582 | 18,638 | 268 | 89,285 |
| **name=sesko（折叠 LIKE）** | `/players?limit=20&name=sesko` | **18,304** | 18,302 | **36,606** | **136** | 273 |
| 名册端点（固定键，group_concat 全表） | `/players/roster` | 18,301 | — | 18,301 | 273 | 273 |
| 球员详情（4 条 PK 窄查询） | `/players/1` | 4（1+1+1+1） | — | 4 | 1,250,000 | 1,250,000 |

**单次耗时**（同表 `duration` 合计，供参考）：索引路径 1–11ms；全表扫 19–46ms；`sort=ps` 258ms、`sort=years` 152ms、`sort=status` 152ms、`sort=wage` 135ms（表达式复杂时 CPU 也上来了，但 D1 按行计费，不是按 CPU）。

**注意几处「有索引也没用」**：`sort=club` / `sort=status` 的列索引服务不了它们的排序表达式；`ca_min=80` 的区间筛选不匹配 0027 的 `COALESCE(ca,0)` 表达式索引（56 行是主查询走 id 序提前停下，COUNT 那边照旧全表扫 18,582）。反之 `club_id=free`（`IS NULL`）能吃上 `idx_players_club`，主查询只读 22 行。

---

## 四、成本模型（6 个设计探针）

| 探针 | 读量 | 说明 |
| --- | --- | --- |
| 全表扫、不排序（`WHERE growable = 1`） | 18,301 | **1 行/行** |
| 全表扫 + 排序（只选 id、不 join） | 36,602 | **2 行/行** —— 排序让整表走了两遍 |
| 全表扫 + 排序 + 两个 LEFT JOIN（受控对比） | 36,602 | **与上一条完全相同 ⇒ JOIN 成本为 0** |
| 全表扫 + 排序 + 两个 LEFT JOIN + 宽投影（真实主查询） | 37,635 | 比上面多 1,033 行，来源未隔离（宽投影/窗刻度子查询） |
| 两段式（21 个 id 先选出，再 join 补字段） | 36,654 | **只省 2.6%，假设不成立** |
| 能提前停下的路径（rowid 序 LIMIT 21） | 21 | 索引/rowid 序的收益量级 |
| COUNT 去掉 LEFT JOIN | 18,301 | join 只让 COUNT 多读 462 行 |

**由这组数字得出的判断**：
- 「改造查询结构」这条路**不值得走**：全表扫 + 排序的 36,602 行是 SQLite 为 ORDER BY 建临时索引/排序器再扫一遍的代价，换成两段式/子查询都躲不掉（实测 36,654）。
- 「去掉 JOIN」也不值得：受控探针显示 JOIN 在扫描路径上是 0 成本。
- 要降，只能让查询**在索引上走并提前停下**：0027 的 `sort=ca` 61 行、`sort=age`/`market_value` 22 行，对比无索引的 37,635 行 —— **降 99.8%**。
- 有索引的筛选同理：`club_id=5` 全形状 127 行、`club_id=free` 17,754 行、`status=normal` 1,090 行。

---

## 五、阈值判定与候选清单

计划里写死的阈值：**单次 ≥10,000 行 且能被 UI 触发 ⇒ 做；≥10,000 但不可触发 ⇒ 记豁免；<10,000 ⇒ 不动**。

### 5.1 排序键（29 个）分类

| 类别 | 键 | 单次主查询 | 能不能靠索引解决 |
| --- | --- | --- | --- |
| **已有 0027 表达式索引**（实测快） | `ca` 58、`pa` 61、`age` 22、`market_value` 22 | 22–61 | 已解决 |
| **可建 players 单表表达式索引** | `prestige`、`base_ca`、`badges`、`growth_gap`、`uid`、`club`、`position`、`status`、`growable`、`foot`、`growth_tier`、`future_star`、`china_plan`、`agent_tier`、`fc_id`、`ps` | 37,635 | ✅ 可以（每条 ≈18,301 行写） |
| **表达式含 87 项链，深度存疑** | `name`（`sqlFold('players.name')`） | 37,635 | ⚠️ 表达式树深度上限 100（增量 26 的坑），建索引前必须用真引擎实测 |
| **不能建静态表达式索引** | `wage`、`release_fee`、`contract_type`、`source`（在 `ct.*`）、`protected`、`years`（依赖 `ct.*` + `season_windows` 子查询）、`influence`（内联运行时 config 系数，系数一改索引全废） | 37,635–37,637 | ❌ 需物化列或改查询结构 |
| **需物化子表** | `attr:<属性键>`（34 键，值在 `game_attrs` JSON 里） | 未实测（形状同全表扫） | ❌ 架构级 |
| **另一套口径** | `view=initial` 下的 `ca`/`pa`/`growth_gap`（`COALESCE(base_ca, ca)` / `COALESCE(json PA, pa)`） | 37,635（实测 `view=initial&sort=ca`） | ❌ 要用 initial 视图就得再建一套索引 |

### 5.2 筛选分类

- **有索引**：`club_id`（`=5` 127 行、`IS NULL` 17,754 行）、`status`（1,090 行）。
- **无索引**（主查询 18.4k–18.6k，COUNT 另算）：`growable`、`position`（4 槽 OR）、`ps`（12–15 槽 OR）、`attr`、`ca`/`pa`/`age`/`prestige`/`base_ca`/`market_value` 区间（不匹配 0027 的 COALESCE 表达式索引）、`badges_*`、`foot`、`growth_tier`、`is_future_star`、`china_plan`、`agent_tier`、`fc_id`、`has_contract`、全部 `ct.*` 维度。
- **`name` 折叠 LIKE**：36,606 行，且 `LIKE '%x%'` **B-tree 索引无效**，要降只能上 FTS5 + trigram。豁免理由：低频（前端只在提交时发一次，不是打字即请求）。

### 5.3 写配额张力（步骤 4 前必须裁决）

免费档**写**上限 10 万行/日，计划自留预算 ≤6 万行/日 ⇒ **每天最多建 3 条索引**（每条 18,301 行写）。
而 5.1 表里「可建索引」的有 **16 个排序键**，加上筛选列与 34 个 attr 键，全做要 **120 万行以上写、至少 20 天**，且 `CREATE INDEX` 本身会拖慢写入。

**建议（步骤 4 按此执行）**：
1. 先做**零写成本**的三件事（步骤 2/3/5）：把最常见的默认浏览路径从 18,819 行压到 56 行（命中缓存时 0 行）。
2. 索引**分批 + 分天**，每批 ≤3 条。**第一批（3 条 = 54,903 行写，卡在 6 万预算内）**建议取表达式最安全、且前端列序/筛选面板直接暴露的键：`prestige`、`club`、`status`。选它们的理由不是热度（用户已裁决当前频次数据无意义），而是：都是单表纯列/COALESCE/CASE 表达式（不像 `ps` 有 15 项链、不像 `name` 有 87 项链），建索引风险最低，而它们又都是球员库默认列/默认排序下拉里可见的列。
3. 剩余键登记为「**已量化、待配额**」的分天清单，不假装已解决。每批后跑一次 `--only=<形状>` 复测确认。
4. `name` 索引先跑深度体检（`scripts/check-name-fold-depth.mjs` 同源思路）；`influence` / `years` / `protected` / `ct.*` 四个维度改判为「需物化列或改查询」，不在本增量做。

### 5.4 验收目标的修正（计划偏差，需记录）

计划写的「默认浏览一页 ≤20 行」**按实测不可达**：limit 20 会取 21 行，每输出一行至少读 1 行玩家数据（走 PK 索引时约 2.7 行/行，含两处字段来源）⇒ 实测 `sort=id` 主查询 **56 行**。有索引的排序下限是 21–64 行（`sort=age` 22、`sort=market_value` 22、`sort=ca` 58、`filter-club` 64）。

**建议改为**：
- 默认浏览一页（`sort=id`）：**≤70 行**（现 18,819 ⇒ 去掉 COUNT 后 56，命中缓存 0）。
- 有索引的排序/筛选形状：**≤70 行**（实测 22–64）。
- 无索引的排序/筛选形状：目标 **≤1,000 行**，**必须靠新建索引达成**；本增量因写配额只能覆盖第一批，未覆盖的逐条记豁免理由（见 5.3）。
- 名册端点：单次 18,301 行不变，靠 24h TTL + 写后精确删控制**频次**。

---

## 六、复测口径（步骤 7 复用）

```bash
node scripts/measure-d1-reads.mjs --json-out=scripts/d1-read-audit/measurements-after.json
```
把新表与本报告第三节逐形状对比，逐条写明「改前 → 改后」。JSON 支持增量合并（`--only=` / `--probes` 分次跑不会互相覆盖，也不会让报错/`--dump` 的空壳条目覆盖已有测量），所以补测单个形状不必重跑全套。

**本次测量总消耗：约 118 万行**（免费档 24%），其中 `measurements.json` 里逐形状最新值合计 **1,084,282 行**，差额来自重复运行（探针两次、补测 7 个新形状、`detail` 补测）与 wrangler 偶发失败后的重试。测量走管理通道，不占用、也不受限于当日免费档的**强制**上限。
