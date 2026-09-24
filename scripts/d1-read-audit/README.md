# 球员库 D1 读量定标报告（增量 28 步骤 1；步骤 4/6/7 已补测）

**测量日期**：2026-09-22（UTC） · **目标**：生产 `whl-club`（`73154873-d5ae-42b0-a630-25f5ef60053d`）· **原始数据**：[`measurements.json`](./measurements.json)（30 形状 + 6 探针，步骤 1 基线）、[`measurements-after.json`](./measurements-after.json)（同 30 形状，步骤 7 验收复测）、[`surface-measurements.json`](./surface-measurements.json)（全站 21 条读面，步骤 6 普查）

**为什么要这份报告**：2026-09-21 免费档 5,000,000 行/日读配额被耗尽，`/api/players*` 全线 500、cron 每 5 分钟失败。用户诉求原话：「目前球员库相对稳定，现在查找的 D1 读消耗过大！」治理前必须先知道「每个形状一次读多少行」——否则物化哪些列、缓存给多长 TTL 都只能靠猜。本报告是增量 28 步骤 4/5 的输入。

---

## 一、结论摘要

1. **默认浏览一页 18,819 行里，COUNT 占 18,763 行（99.7%）**，主查询只占 56 行。而 COUNT **不带 cursor、每翻一页都重算整表**。
2. **全表扫形状的成本几乎全在全表扫本身**：无索引排序的主查询 37,635 行，而「只选 id、不 join 的全表扫 + 排序」就已 36,602 行。**受控探针证明两个 LEFT JOIN 的成本是 0**（同样扫描 + 排序，加不加 JOIN 都是 36,602）；真实主查询比它多的 1,033 行来自宽投影/窗刻度子查询，**未做受控探针隔离，属未解释项**（占该形状 2%）。原先设想的「两段式（先选 id 再 join 补字段）能砍一半」**实测只省 2.6%，假设不成立**。
3. **带排序的全表扫是 2 行/行（18,301 → 36,602），不带排序是 1 行/行（18,301）**；能提前停下的路径是 21–64 行。⇒ **全表扫形状的唯一出路是让它能走索引提前停下**，于是**写配额成了步骤 4 的硬约束**（每条索引 ≈ 18,301 行写，免费档 10 万行/日）。
4. **最贵的单次形状是 11 个全表扫排序（56,398–56,400 行/次）与姓名查找（36,606 行/次）**；免费档下前者单独跑只能承受 **88 次/日**。
5. **索引不是「有列索引就行」**：`sort=club` 与 `sort=status` 虽有 `club_id` / `status` 的列索引，排序表达式是 `COALESCE(club_id,0)` 与 CASE 权重 ⇒ **索引失配，实测仍是 37,635 行**。同理 `view=initial` 把 `ca` 换成 `COALESCE(base_ca, ca)`，0027 的索引立刻失效（61 → 37,635）。
6. 三个零写成本的杠杆已在计划内：**去 COUNT（步骤 2）**、**边缘缓存 + 分级 TTL（步骤 3）**、**前端 staleTime（步骤 5）**。去掉 COUNT 后默认浏览一页 56 行，容量从 265 次/日升到 89,285 次/日。
7. **治理后的现状见 §3.2（验收表）与 §5.5（豁免清单）**：默认浏览 18,819 → **56 行**、三个无索引排序键靠迁移 0029 降到 22–53 行、海捞名单 36,274 → **843 行**（§7.2）、管理端 overview 的全表 COUNT 接入两级缓存（§7.3）。仍 >1,000 行/次的形状是 **8 个全表扫排序键（37,635–37,637）与姓名查找（18,304）**，因写配额与表达式形态逐条豁免（§5.5）。第 4、5 条是**治理前**的基线，保留原值以便对照。

---

## 二、方法

**测量手段（用户裁决 Q1）**：`wrangler d1 execute whl-club --remote --json`，读回每条的 `meta.rows_read` / `meta.duration`。

**关键设计：SQL 不手抄。** 读量的形状完全由路由拼出来的表达式决定（`sqlFold` 的 87 项链、`PS_COUNT_EXPR` 的 15 槽计数、29 个排序表达式、各种 COALESCE/CAST/CASE），手抄一份必然与线上漂移，而且漂移是静默的 —— 数字看着合理，其实测的是另一个查询。所以脚本用 **Hono 的 `app.request()` 直接调真实路由**（`src/worker/routes/players.ts` 的 default export），注入一个只记录不执行的假 D1，把路由实际执行的 SQL 与绑定参数抓下来，参数内联成字面量后交给 `wrangler`。副作用（好的那个）：路由改了 SQL，重跑脚本测到的就是新形状 —— 步骤 7 的验收复测直接复用。

**三条必须知道的边界**：
- **测的是管理通道，不是 worker 通道。** 管理通道在 9/21 配额触顶期间照样成功（配额上限只阻断 worker 侧真实表读），所以测量不受当日余量约束；但测出的 `rows_read` 是「这条 SQL 读多少行」的物理事实，与走哪条通道无关 —— 已用两个已知基准交叉验证：主查询 LIMIT 2 = 7 行、`COUNT(*) FROM players` = 18,301 行，与 9/21 排查时的数字一致。
- **`--local` 不回传 `meta.rows_read`**（实测全 `null`），所以本地只能验证脚本机制，数字必须打生产。**本地与远端的读数不可混读**：本地 `.wrangler/state/v3` 是空库（`players` 只有 e2e 夹具的 9 行），所以就算某天本地开始回传行数，也只会看到个位数 —— 本报告第三、七节的所有数字都是 `target: remote` 的生产读数（JSON 里的 `target` 字段即此口径）。
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

### 3.1 步骤 4 复测（0029 三条索引，2026-09-22 生产实测）

步骤 4 给 `prestige` / `club` / `status` 建了表达式索引（迁移 `0029_players_sort_indexes_batch2.sql`，三条共 ≈54,903 行写）。
复测用同一脚本、同一 URL，但**列表已不带 COUNT 语句**（步骤 2 去掉），所以「建索引后」是纯主查询读量：

| 形状 | 建索引前（§三基线，含 COUNT） | 建索引后（仅主查询） | 降幅 |
| --- | --- | --- | --- |
| `sort=prestige` | 56,398（主查询 37,635 + COUNT 18,763） | **53** | −99.9% |
| `sort=club` | 56,398 | **43** | −99.9% |
| `sort=status` | 56,398 | **22** | −99.9% |

单次耗时 1.4–2.0ms（建索引前 135–152ms）。⇒ 验收目标「无索引形状 ≤1,000 行」在这三个形状上达成；与本地 `EXPLAIN QUERY PLAN` 探针（`scratch/idx-probe.mjs`：建索引前 `SCAN players … USE TEMP B-TREE FOR ORDER BY`、建索引后 `SCAN players USING INDEX …` 且无临时排序，带游标的页同样吃索引）结论一致。
其余 8 个全表扫排序键（`view=initial&sort=ca`、`wage`、`name`、`ps`、`influence`、`uid`、`years`、`protected`）仍是 37,635 行/次，见 §5.1 分类与 §5.3 写配额张力。

**已知缺口：「同一列既筛选又排序」时这三条索引用不上**（2026-09-22 本地 `EXPLAIN QUERY PLAN` 实测，20,000 行夹具）：

| 查询 | 计划 |
| --- | --- |
| `WHERE players.status = ? ORDER BY <status CASE> DESC, id DESC` | `SEARCH players USING COVERING INDEX idx_players_status (status=?)` + `USE TEMP B-TREE FOR ORDER BY` |
| `WHERE players.club_id = ? ORDER BY COALESCE(players.club_id,0) DESC, id DESC` | `SEARCH players USING COVERING INDEX idx_players_club (club_id=?)` + `USE TEMP B-TREE FOR ORDER BY` |
| `WHERE players.ca >= ? ORDER BY COALESCE(players.ca,0) DESC, id DESC` | `SCAN players USING INDEX idx_players_sort_ca`（**无临时排序**，两条都吃上） |

原因：`status` / `club_id` 的筛选条件写的是**裸列**（`players.status = ?`），与排序用的 CASE / `COALESCE(club_id,0)` 是**两个不同的表达式**，索引没法同时服务；优化器于是挑了 0001 建的窄列索引来过滤，再把命中的行丢进临时 B 树排序。`ca` 之所以两用都成，是因为它的筛选是范围（`>=`）、排序表达式又与索引同源，B 树顺序天然满足。

**不阻断**：读量受「命中行数」约束（`status='normal'` 约 4 千、`club_id=?` 约 1 千），不是全表扫，所以验收目标「有索引形状 ≤70 行」在这类组合上不成立但也不会回到 37,635。要收掉它得让筛选也用同一表达式（`COALESCE(club_id,0) = ?`），那会改变 `club_id IS NULL` 的语义（0 与 NULL 混同）⇒ 本增量不动，登记为后续候选。

### 3.2 步骤 7 验收复测（全 30 形状，2026-09-22 生产实测）

治理手段全部落地后的完整验收表（原始数据 [`measurements-after.json`](./measurements-after.json)，本次消耗 **338,980 行**，比步骤 1 的 118 万便宜得多，因为 COUNT 已经不在了）。「改前」= 步骤 1 基线（含 COUNT；`prestige`/`club`/`status` 三个键的改前值取步骤 1 原值 56,398，不是 §3.1 的建索引后值）。

| 形状 | 改前 | 现在 | 变化 | 达标（≤70 有索引 / ≤1,000 无索引） |
| --- | --- | --- | --- | --- |
| 默认浏览一页 `?limit=20` | 18,819 | **56** | −99.7% | ✅（缓存命中 0） |
| 第 5 页 `&cursor=100` | 18,815 | **52** | −99.7% | ✅ |
| 初始视图 `&view=initial` | 18,819 | **56** | −99.7% | ✅ |
| `sort=id` | 18,819 | **56** | −99.7% | ✅ |
| `sort=ca`（0027） | 18,821 | **58** | −99.7% | ✅ |
| `sort=pa`（0027） | 18,824 | **61** | −99.7% | ✅ |
| `sort=age`（0027） | 18,785 | **22** | −99.9% | ✅ |
| `sort=market_value`（0027） | 18,785 | **22** | −99.9% | ✅ |
| `sort=prestige`（0029） | 56,398 | **53** | −99.9% | ✅ |
| `sort=club`（0029） | 56,398 | **43** | −99.9% | ✅ |
| `sort=status`（0029） | 56,398 | **22** | −99.9% | ✅ |
| `club_id=5` | 127 | **64** | −50% | ✅ |
| `club_id=free` | 17,754 | **22** | −99.9% | ✅ |
| `status=normal` | 1,090 | **58** | −95% | ✅ |
| `growable=1` | 18,683 | **95** | −99.5% | ✅（无索引但受命中行数约束） |
| `position=ST` | 18,507 | **110** | −99.4% | ✅（同上） |
| `ps=25` | 18,629 | **293** | −98.4% | ✅（同上） |
| `attr=sprintspeed&attr_min=80` | 18,593 | **88** | −99.5% | ✅（同上） |
| `ca_min=80` | 18,638 | **56** | −99.7% | ✅（靠 0027 索引，见 §3.1 缺口说明） |
| 名册 `/players/roster` | 18,301 | **18,301**（命中 0） | 单次不变 | ✅ 治理的是频次（24h TTL + 写后精确 purge） |
| 球员详情 `/players/1` | 4 | **4** | — | ✅ |
| **8 个全表扫排序键** | 56,398–56,400 | 37,635–37,637 | 仅 −33%（去 COUNT） | ❌ **逐条豁免，见 §5.5** |
| **姓名查找 `name=sesko`** | 36,606 | 18,304 | −50% | ❌ **豁免（子串查找用不了 B-tree）** |

**容量推演**（免费档 5,000,000 行/日）：默认浏览一页从 **265 次/日** 升到 **89,285 次/日**；最贵的仍可触发的形状（37,635 行的 `sort=name`）**133 次/日**，而它只在用户点了表头姓名列时才发生。**结论：本增量的主指标（默认浏览 ≤70、有索引形状 ≤70）全部达成；无索引的 8 个排序键与姓名查找按计划记豁免理由（写配额 + 表达式形态决定）。**

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
| **0029 已建（步骤 4）** | `prestige` **53**、`club` **43**、`status` **22** | 22–53 | ✅ 已解决 |
| **可建 players 单表表达式索引（剩余 13 个）** | `base_ca`、`badges`、`growth_gap`、`uid`、`position`、`growable`、`foot`、`growth_tier`、`future_star`、`china_plan`、`agent_tier`、`fc_id`、`ps` | 37,635 | ✅ 可以（每条 ≈18,301 行写），按天分批 |
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
2. 索引**分批 + 分天**，每批 ≤3 条。**第一批（3 条 = 54,903 行写，卡在 6 万预算内）**取表达式最安全、且前端列序/筛选面板直接暴露的键：`prestige`、`club`、`status`。选它们的理由不是热度（用户已裁决当前频次数据无意义），而是：都是单表纯列/COALESCE/CASE 表达式（不像 `ps` 有 15 项链、不像 `name` 有 87 项链），建索引风险最低，而它们又都是球员库默认列/默认排序下拉里可见的列。**→ 已于 2026-09-22 执行（迁移 `0029`，生产实测 53 / 43 / 22 行，见 §3.1）**；同源锁死见 `tests/players-sort-indexes.test.ts`。
3. 剩余键登记为「**已量化、待配额**」的分天清单，不假装已解决（剩余 13 个可建索引的键 = 238k 行写 ≈ 4 天）。每批后跑一次 `--only=<形状>` 复测确认。**2026-09-24 进展**：§5.5 点名的下一批 3 条（`view=initial&sort=ca` / `sort=uid` / `sort=ps`）已写成迁移 `0034`（三条 ≈5.5 万行写，**已于 2026-09-24 apply 到生产**，实测记账 54,919 行 `rows_written`）；同批的 `sort=name` 更早已由迁移 `0033`（2026-09-23 apply）完成 ⇒ **§5.5 的「下一批候选」这一栏已清空**，清单上还剩 **11** 个可建索引的键 = §5.1 那一行的 13 个单表排序键 − 本批的 `uid` / `ps` 2 个（即 `base_ca` / `badges` / `growth_gap` / `position` / `growable` / `foot` / `growth_tier` / `future_star` / `china_plan` / `agent_tier` / `fc_id`）。两个**不在**这 11 里的口径：① §5.1 的 `view=initial` 另一套口径还剩 `pa` / `growth_gap` 两个变体（本批只做了该口径下的 `ca`）；② `name` 已由 `0033` 完成。
4. `name` 索引先跑深度体检（`scripts/check-name-fold-depth.mjs` 同源思路）—— **已于 2026-09-23（迁移 `0033`）完成**，87 项链在真引擎上通过；`influence` / `years` / `protected` / `ct.*` 四个维度改判为「需物化列或改查询」，不在本增量做。

### 5.4 验收目标的修正（计划偏差，需记录）

计划写的「默认浏览一页 ≤20 行」**按实测不可达**：limit 20 会取 21 行，每输出一行至少读 1 行玩家数据（走 PK 索引时约 2.7 行/行，含两处字段来源）⇒ 实测 `sort=id` 主查询 **56 行**。有索引的排序下限是 21–64 行（`sort=age` 22、`sort=market_value` 22、`sort=ca` 58、`filter-club` 64）。

**建议改为**：
- 默认浏览一页（`sort=id`）：**≤70 行**（现 18,819 ⇒ 去掉 COUNT 后 56，命中缓存 0）。
- 有索引的排序/筛选形状：**≤70 行**（实测 22–64）。
- 无索引的排序/筛选形状：目标 **≤1,000 行**，**必须靠新建索引达成**；本增量因写配额只能覆盖第一批，未覆盖的逐条记豁免理由（见 5.3）。
- 名册端点：单次 18,301 行不变，靠 24h TTL + 写后精确删控制**频次**。

### 5.5 未达标形状的豁免清单（步骤 7 验收，逐条理由）

按 5.4 的规则，下列形状本增量结束时仍 >1,000 行/次，逐条记理由。「下一批候选」= 形态允许静态索引、只差写配额（每条 18,301 行写，免费档 10 万/日、自留 6 万/日 ⇒ 每天最多 3 条）。

| 形状 | 现读量 | 豁免理由 | 何时能收 |
| --- | --- | --- | --- |
| `view=initial&sort=ca` | 37,635 | 初始视图把 `ca` 换成 `COALESCE(players.base_ca, players.ca)`（`src/worker/routes/players.ts:507`），而 `buildSortExprs` 又把它套成 `COALESCE(${caExpr}, 0)`（`players.ts:71`），与 0027 的 `COALESCE(ca, 0)` **是两个表达式**，索引静默失配（61 → 37,635） | **已收**：迁移 `0034`（2026-09-24 apply）—— 实测 37,635 → **54** 行/次。表达式必须是完整的 `(COALESCE(COALESCE(base_ca, ca), 0), id)` —— 只建内层 `COALESCE(base_ca, ca)` 匹配不上外层那圈 `COALESCE(…, 0)` |
| `sort=uid` | 37,635 | 表达式是 `CAST(SUBSTR(players.uid, 3) AS INTEGER)`，可静态索引，只是没排进第一批 | **已收**：迁移 `0034`（2026-09-24 apply）—— 实测 37,635 → **24** 行/次 |
| `sort=ps` | 37,635 | `PS_COUNT_EXPR` 是 15 项 `(json_extract(…) IS NOT NULL)` 相加的长链（每项必须自带括号）；建索引前要先过**表达式树深度体检**（D1 上限 100，参照增量 27 姓名折叠 253 项链撞墙的教训） | **已收**：迁移 `0034`（2026-09-24 apply）—— 实测 37,635 → **22** 行/次。深度体检已于 2026-09-24 通过：15 项链在真引擎上建得出来，`json_extract` 可进索引表达式（`scripts/check-sort-index-feasibility.mjs`） |
| `sort=wage` / `release_fee` / `contract_type` / `source` | 37,635 | 排序键在 `contracts`（`ct.*`），players 单表索引无从下手；contracts 的排序键又依赖窗口刻度，不能静态索引 | 需物化列或改查询，本增量不做 |
| `sort=years` / `protected` | 37,637 | 同上，且表达式还内联 `CURRENT_TICKS_SQL`（`season_windows` 子查询），随赛季推进变化 | 同上 |
| `sort=influence` | 37,635 | 表达式内联**运行时 config 系数**（`attendance_model`），系数一改索引立刻失效 | 不能静态索引 |
| `sort=name` | 37,635 | 排序表达式是 `sqlFold('players.name')`（87 项链折叠）；理论上可索引但要先过深度体检 | **已完成**：迁移 `0033`（2026-09-23 apply）—— 87 项链折叠在真引擎上通过，与显示名 5 列同轮落库 |
| 姓名查找 `?name=sesko` | 18,304 | `LIKE '%sesko%'` 是**子串**查找，任何 B-tree 都用不了（含 `sqlFold` 折叠后的 LIKE）；唯一出路是 FTS5 trigram 虚表（架构级改动，名字段是低频操作、只在提交时发一次请求） | 独立主题，登记 |
| `attr:<键>` 34 键排序/筛选 | 未单独实测 | 排序表达式 `COALESCE(json_extract(game_attrs,'$.<key>') + 0, 0)`，34 个键各要一条索引（62 万行写）或一个物化子表 | 需物化子表，本增量不做 |

无筛选的筛选形状（`growable=1` 95、`position=ST` 110、`ps=25` 293、`attr≥80` 88）虽然也 >70，但它们**没有索引可用且读量受命中行数约束**，未列入豁免——它们已随去 COUNT 从 1.8 万降到百级，再降需要子表/物化列（§5.2），属计划外。

---

## 六、复测口径（步骤 7 复用）

```bash
node scripts/measure-d1-reads.mjs --json-out=scripts/d1-read-audit/measurements-after.json
```
把新表与本报告第三节逐形状对比，逐条写明「改前 → 改后」。JSON 支持增量合并（`--only=` / `--probes` 分次跑不会互相覆盖，也不会让报错/`--dump` 的空壳条目覆盖已有测量），所以补测单个形状不必重跑全套。

`measurements.json` 的字段随脚本演进而分层，读它时按 `list_rows` / `count_rows` 是否存在判断口径：**有**这两列的条目是步骤 2（去 COUNT）之后、用现行脚本跑的（目前是步骤 4 复测的 `sort-prestige` / `sort-club` / `sort-status` 三条，`list_rows` 即主查询读量）；**没有**的条目是步骤 1 的产物，只有 `statements` / `metas` / `rows_read_total`，其中 `metas[1]` 是当时的主查询、`metas[2]` 是当时还在的 COUNT。旧条目若被重打印，`list_rows` 缺省会显示为 0、整行读量落进「其它」列——不是数据错，是列口径不同。

**本次测量总消耗：约 118 万行**（免费档 24%），其中 `measurements.json` 里逐形状最新值合计 **1,084,282 行**，差额来自重复运行（探针两次、补测 7 个新形状、`detail` 补测）与 wrangler 偶发失败后的重试。测量走管理通道，不占用、也不受限于当日免费档的**强制**上限。

---

## 七、全站读面普查与处置（步骤 6）

**目的**：第三节只量了 `/api/players` 的形状。但配额是按**账号**计的，任何读面都能把免费档打爆（2026-09-21 的事故里 cron 也在失败）。所以把站内所有读面都量一遍，按「单次读量 × 可触发面」排优先级处置。

**工具**：`scripts/measure-surface-reads.mjs`（18 个 URL 读面 + 展开的 3 个 cron 任务 = 21 条），与 `measure-d1-reads.mjs` 共用 `scripts/d1-read-audit/harness.mjs` 的「真实路由 + 假 D1 抓 SQL + 打生产读 `meta.rows_read`」机件。

三个方法要点：
1. **每个读面跑在独立进程**（`--only=<id>`）：`src/core/config.ts` 把 config 读在 isolate 内缓存 60s，同进程连跑多个读面会把后面读面的配置读量抹成 0。
2. **只执行 SELECT**（`selectOnly`）：GET 里也可能藏写语句 —— `/api/market/*` 每次请求前先跑 `settleOverdue`，原样拿去打生产就是真写。
3. **鉴权靠假会话**：假 D1 对 `oidc_session` 查询回一份管理员 claims + 请求带 `cookie: __Host-club_session=probe-token`，才能过 `requireUser` / `requireAdmin` 抓到业务 SQL（否则在 401 处提前退出，一条都抓不到）。

### 7.1 普查结果（2026-09-22 生产实测，`surface-measurements.json`）

| 读面 | 单次读量（行） | 语句数 | 备注 |
| --- | --- | --- | --- |
| `GET /api/market/free-agents` | **36,274 → 843** | 5 | 全站最大读放大器，教练可触发、无缓存；**已于本步骤处置** |
| `GET /api/admin/overview` | 18,449（冷）/ 0（命中） | 8 | 含 `SELECT COUNT(*) FROM players`；仅管理端；**已加两级缓存** |
| `GET /api/me/club` | 105 | 14 | 登录后每次页面加载 |
| `cron:autoConfirmResults` | 75 | 3 | 288 轮/日 |
| `GET /api/club/squad` | 65 | 6 | |
| `GET /api/clubs/directory` | 20 | 1 | 已缓存（24h） |
| `GET /api/notifications` | 15 | 3 | |
| `GET /api/market/listings` | 11 | 17 | 含 `settleOverdue` 的 11 个 config 读 |
| `GET /api/market/listings/:id` | 9 | 21 | 同上 |
| `GET /api/club/ledger` | 9 | 4 | |
| `GET /api/club/stadium/build-info` | 9 | 10 | |
| `GET /api/notifications/unread-count` | 8 | 2 | 前端每 60s 轮询 |
| `cron:settleOverdue` | 7 | 16 | 288 轮/日 |
| `GET /api/market/trainees` | 4 | 6 | |
| `GET /api/players/:id` | 4 | 4 | |
| `GET /api/seasons/current` | 3 | 3 | |
| `GET /api/club/balance` | 2 | 4 | |
| `GET /api/players/:id/growth` | 2 | 4 | |
| `GET /api/me/bids` | 1 | 4 | |
| `GET /api/transfers/:id` | 1 | 1 | |
| `cron:dispatchPendingNotifications` | 0 | 0 | 生产未配 `SYNC_BASE_URL` ⇒ `skipped:'unconfigured'` 空转 |

**除两个 ≥10,000 行的读面外，全站单次读量都 ≤105 行**；cron 三段合计 82 行/轮 × 288 轮/日 ≈ **2.4 万行/日**（可忽略）。

**判定（按计划阈值「<10,000 行 ⇒ 登记不动」）**：其余 19 条读面全部登记为「已量化、不动」。容量推演：最重的 `/api/me/club`（105 行/次）在免费档下可承受 **47,619 次/日**；前端唯一轮询的 `/api/notifications/unread-count`（8 行/次、60s 一次）单标签页不过 **1.15 万行/日**；市场端点的 11 行 config 读来自每次请求前的 `settleOverdue`（`ORDER BY l.id LIMIT 100` 且生产无逾期项，故极便宜）。**加索引或改查询都不值得**——它们的成本不构成任何风险。

### 7.2 处置一：`/api/market/free-agents`（36,274 → 843，降 97.7%）

**病灶**：原查询是 `WHERE (p.club_id IS NULL OR p.club_id IN (SELECT id FROM clubs WHERE is_cpu=1)) AND p.status IN ('free','normal') ORDER BY p.ca DESC, p.id LIMIT 300`。生产 **17,731 名球员 `club_id IS NULL`（占 97%）**，SQLite 对 `OR` 走 `MULTI-INDEX OR` + `USE TEMP B-TREE FOR ORDER BY` ⇒ 必须把 17,731 行全部读出来排序。

**先试索引（失败）**：新建 `idx_players_club_ca ON players(club_id, ca DESC, id)`（迁移 `0030`）后单独重测仍是 **36,271 行** —— 索引能供 `club_id = ?` 这一个等值条件，但 `OR` 的另一半与 `ORDER BY` 仍要求全读。本地 `node:sqlite` 探针（20,000 行合成）逐个试 `(club_id, ca DESC, id)` / `(status, ca DESC, id)` / `(ca DESC, id)` / `(club_id, status, ca DESC, id)`，**没有一条能消掉 `TEMP B-TREE`**。

**再试改写（分两层）**：
1. 拆成 `UNION ALL` 两分支（无归属 / CPU 队）后 **19,141 行**：无归属支 **300 行**（沿 `idx_players_club_ca` 走 ca 序、够了就停），但 CPU 支仍 **18,540 行**（`club_id IN (子查询)` 让优化器改用 `idx_players_status`，两个 status 值 + 过滤 → 停不下来）。
2. 把 CPU 支的连接写成 **`FROM clubs cp CROSS JOIN players p ON p.club_id = cp.id`**（以 clubs 为驱动表固定连接顺序）⇒ 计划变成 `SCAN cp | SEARCH p USING INDEX idx_players_club (club_id=?)`，**239 行**，且结果与旧版逐行一致 ✓。生产 EXPLAIN 确认，本地探针 `scratch/free-agents-probe*.mjs` 复现同一结论。
   - 变体对照：`FROM clubs cp JOIN players p ON p.club_id = cp.id`（不加 CROSS JOIN）仍 18,982 行（优化器不理会书写顺序）；加 `INDEXED BY idx_players_club_ca` 同样 239 行 ⇒ **不需要索引提示**。
   - SQLite 坑：复合 SELECT 的分支不能自带 `ORDER BY` / `LIMIT`（报 `ORDER BY clause should come after UNION ALL not before`）⇒ 每个分支必须包一层 `SELECT * FROM (...)`。

**同源锁死**：`tests/market-routes.test.ts` 的「海捞名单查询计划」用例用**真实路由 SQL** 跑 `EXPLAIN QUERY PLAN`，断言含 `idx_players_club_ca`、含 `SCAN cp`、不含 `MULTI-INDEX OR`（理由同 `tests/players-sort-indexes.test.ts`：退化只体现在读量上，接口返回一模一样）。已做变异验证（把 `CROSS JOIN` 换回 `LEFT JOIN` ⇒ 用例立刻红）。

**顺带登记的产品问题（本增量不处理）**：池子已是 17,731 人而 `LIMIT 300` 无分页、无筛选（路由里「约 107 人 + 190+」的注释早已失真）⇒ 除 CA 最高的 300 人之外都看不到。

### 7.3 处置二：`/api/admin/overview`（冷 18,449 不变，频次靠缓存）

它是「单次贵但只在管理端触发」的形状：`Promise.all` 五条里 `SELECT COUNT(*) AS n FROM players` 占 18,301 行，其余（review_tasks / listings / clubs / results）合计 148 行。原来只有 module 级 isolate 缓存（60s）+ `?fresh=1`，**挡不住多 isolate**。

**处置**：把这条全表 COUNT 抽成 `countAllPlayers(c)`（`src/worker/routes/players.ts`），挂到**公开列表同一个 scope `players`** 的两级缓存上（`cachedJson('players:count:all', ttlForScope('players', …), …)`）⇒ 与列表共享同一份代际键，写路径 purge 一起失效；1h 内多 isolate 只算一次，命中即 0 行。

**口径**：治理的是**频次**不是单次 —— 冷缓存仍 18,449 行（见 7.1 表，普查脚本用 `PUBLIC_CACHE_TTL_MS: '0'` 旁路缓存，故表里是冷路径值）。带筛选的总数仍走内部端点 `GET /api/cron/players-count`，不共用本缓存。

### 7.4 顺带修掉的工具障碍

`src/worker/authClient.ts` 的 `AuthApiError` 原本用 TS **参数属性**（`constructor(public code: string, …)`）—— 那是唯一需要「代码生成」的 TS 语法，Node 的类型剥离不支持（`TypeScript parameter property is not supported in strip-only mode`）⇒ 凡 import 它的模块在 Node 里都加载不了，`/api/clubs/directory`、`/api/me/club`、`/api/club/balance`、`/api/club/ledger`、`/api/club/stadium/build-info` 五个读面抓不到 SQL。改成显式字段赋值后 18 个读面全部可测。

