# S9 期初对齐批：期初财政导入 + 窗末工资 + 效力 +0.5 + 标记球员落点

**状态：已执行（2026-10-06，生产）**。四步全部落库，changes 合计 631、失败批 0；只读复核差异 0。
生成时刻 `BATCH_TS = 2026-10-06T03:08:00.611Z`（本批所有 `created_at` / `completed_at` / `updated_at` 的字面量），
预检快照 `snapshot.json` 采集于 `2026-10-06T03:07:28.071Z`（`--remote`，只读）。

---

## §1 缘起与范围

用户四道令（按序执行）：

| # | 用户令 | 落库工件 |
|---|---|---|
| ① | 「导入生产库联赛真人队（除莱比锡和巴塞罗那外）的初始财政」（含图片映射与「有任何不清楚的问我」） | `sql/02-finance-import.sql` |
| ② | 「导入完成后各队扣除一次工资」 | `sql/03-wages.sql` |
| ③ | 「随后球员效力时长+0.5」 | `sql/04-tenure.sql` |
| ④ | CSV `一线队-S9.csv` col28 标记的 30 名「已续约1 / 已匹配」在平台落成写入（用户拍板：**保护期收口 + 补录转会单**，并纠正「匹配过的才不能再匹配，续约过的还能匹」） | `sql/05-status-records.sql` |

用户四口径拍板：**只导 16 支真人队**（图片 7 行跳过）／**累加**（非覆盖）／**消费券本轮不建字段、只留痕**／
**②③④ 范围 = 18 支真人队全做**（含 241 巴塞罗那与 112172 RB莱比锡，二者余额 0 ⇒ 扣完转负，用户已知）。
执行节奏 = 「出工件后按序执行」。

**范围**：生产 D1 `whl-club`；18 支真人队的 `ledger_accounts` / `ledger_entries`、517 份现行 `contracts`、
28 行 `transfers`。**零迁移、零 API 契约变更、零前端改动**。

---

## §2 口径表

### 2.1 财政导入（图片 → 平台 club，累加）

| 图片行 | 财政 | 消费券 | 平台 club |
|---|---|---|---|
| 皇家社会 | 51.76 | | 1 阿森纳 |
| 阿斯顿维拉 | 40.79 | | 2 阿斯顿维拉 |
| 切尔西 | 2.05 | 1 | 5 切尔西 |
| 利物浦 | 119.37 | 11 | 9 利物浦 |
| 巴塞罗那 | 60.49 | 7 | 11 曼联 |
| 纽卡斯尔联 | 53.59 | | 13 纽卡斯尔联 |
| 诺丁汉森林 | 84.10 | | 14 诺丁汉森林 |
| 斯图加特 | 78.66 | 10 | 21 拜仁慕尼黑 |
| 慕尼黑1860 | 60.83 | | 33 慕尼黑1860 |
| 尤文图斯 | 92.46 | 17 | 45 尤文图斯 |
| 拜仁慕尼黑 | 72.90 | 12 | 66 里昂 |
| 巴黎圣日耳曼 | 119.75 | 11 | 73 巴黎圣日耳曼 |
| 那不勒斯 | 20.90 | | 243 皇家马德里 |
| 奥林匹亚科斯 | 45.66 | 1 | 280 奥林匹亚科斯 |
| 皇家贝蒂斯 | 44.78 | | 449 皇家贝蒂斯 |
| 佛罗伦萨 | 20.16 | | 110374 佛罗伦萨 |

合计 **+968.25 m**。跳过 7 行：托特纳姆热刺 103.61 / 科莫 35.25 / 国际米兰 58.63（平台无此队）、
曼城 8.89（只有 CPU 队 10）、AC米兰 59.60（只有 CPU 队 131681）、勒沃库森 78.92（→241 巴塞罗那，用户排除令）、
RB莱比锡 50.60（→112172，用户排除令）。消费券值（里昂 12 / 巴塞罗那 20 / 尤文 17 / 拜仁 10 / 巴黎 11 /
曼联 7 / AC米兰 7 / 国米 7 / 切尔西 1 / 奥林匹亚科斯 1）**只在本表留痕，未落库**——平台无券字段。

**写入形状**：走 `src/worker/ledger.ts:29-63` 的 `ledgerMovement` 等价对（账户 upsert + 流水），
`kind = 'opening_import'`、`ref_type`/`ref_id` 留 NULL（与端上 `POST /api/admin/ledger/opening-import` 同 kind，
故端上日后调用会把这 16 队判为「已导入」跳过）、memo `期初余额导入`、金额 = 图中值（**累加**，
端上那条接口是覆盖语义，表达不了本令）。幂等闸 = `NOT EXISTS (… kind='opening_import' AND club_id=…)`。

### 2.2 窗末工资（18 队）

`kind='wage'`、`ref_type='window'`、`ref_id = 901`（S9 第 1 窗）、memo `球员工资（S9 第 1 窗，N 人现行合同）`、
`delta = −ROUND(SUM(contracts.wage), 2)`（`is_active = 1 AND club_id IS NOT NULL AND wage IS NOT NULL`）。
合计 **−1022.68 m**。**只扣工资，不收富人税**（`src/worker/window-payroll.ts` 的关窗批还会收 20%/5% 税，用户只令扣工资）。
工资口径与关窗批一致（`src/worker/window-payroll.ts:27-98`）。

### 2.3 效力 +0.5（517 份现行合同）

`效力（赛季）= 0.5 × (closedRegularTicks − contracts.service_ticks)`（`src/worker/contract-ticks.ts:5`），
平台 `closedRegularTicks = 1`。端上等价物是「再关一个常规窗」，但那会改 `season_windows` 状态、影响开窗与全平台口径，
故本批**逐合同 `service_ticks = service_ticks − 1`**——两者在所有消费者上逐项等价
（`src/worker/routes/players.ts:104` 效力显示、`src/worker/routes/clubs.ts:384`、`src/worker/routes/market.ts:722` justSigned、
`src/worker/activations.ts:87`、`src/worker/window-machine.ts:310` + `src/worker/season-settle.ts:257-264` 忠诚奖金、
`src/worker/transfers.ts:113` 签约基数）。范围 = 18 队 517 份 `is_active = 1` 合同（生产 `is_active=1 AND club_id IS NULL` 为 0 行）。

### 2.4 标记球员落点（④）

CSV `col28` 状态：`已匹配` 25 行 / `已续约1` 5 行（30 行）。**保护期收口**：24 名有现行合同的标记球员
`protection_ticks = 1`（= 平台续约/匹配路径的写法 `src/worker/transfers.ts:263`：保护期到当下收口，
判定 `currentTicks < protection_ticks` 恒不成立），带 `protection_ticks IS NOT NULL` 护栏（不给训练营凭空发保护期）；
首跑真改值 18 条（0/−1 → 1），其余 6 条本已 = 1 或 NULL ⇒ 幂等复跑 changes 0。

**补录转会单 28 行**（`transfers`，均 `status='completed'`、`season=9`、`window_seq=1`、`from_club_id = to_club_id = 本队`、
`fee` = CSV 违约金、`tax` NULL、`extra_fee` 0、`created_at = completed_at = BATCH_TS`）：

- `type='match'` 24 行（CSV `已匹配`）：`matched = 1`，evidence `json_object('oldReleaseFee', 现 RC, 'previousBid', NULL, 'listingId', NULL, 'leagueMark', '已匹配')`，
  `idempotency_key = 's9-league-match:<player_id>'`。**效果**：占满 `src/worker/activations.ts:232-237` 的
  「match 一次性」名额（该查询只认 `type='match' AND status='completed'`）⇒ 这 24 人日后不能再被匹配。
- `type='rc_change'` 4 行（CSV `已续约1`，佛罗伦萨 4 名：Salah / Marquinhos / Çalhanoğlu / Romagnoli）：
  `matched = 0`，`idempotency_key = 's9-league-rc_change:<player_id>'`，**不占匹配名额**（用户口径：续约过的还能再匹配）。
- 窗号取 1（已关窗）⇒ `src/worker/bypass.ts:712-780` 的「4.4.10 窗内回滚」恒不触发（回滚只找当前开窗的 rc_change 行）。
- 本批**不收任何资金**（端上 match/rc_change 审核会收差额销毁费，属另一批的范畴）。

**跳过 2 行**（README 与 report 均已登记）：

| fc_id | 姓名 | 标记 | 原因 |
|---|---|---|---|
| 254243 | 埃利奥特·安德森 | 已匹配 | 自由身无队籍（`club_id` NULL）⇒ `from/to_club_id` 无从落款 |
| 246430 | 杜尚·弗拉霍维奇 | 已续约1 | 自由身/在解约——4.4.10 窗内解约会令续约无效，补录会造假记录 |

---

## §3 工件表

| 文件 | 字节 | 语句 | 期望 changes | 说明 |
|---|---|---|---|---|
| `sql/01-precheck.sql` | 2784 | 6 | 0 | 只读预检（A 余额 / B 工资 / C 现行合同 / D 幂等闸 / E 窗 / F 30 名标记球员） |
| `sql/02-finance-import.sql` | 14465 | 32 | 32 | 16 队 × （账户 1 + 流水 1） |
| `sql/03-wages.sql` | 17008 | 36 | 36 | 18 队 × （账户 1 + 流水 1） |
| `sql/04-tenure.sql` | 58758 | 517 | 517 | 517 份现行合同各 1 行 |
| `sql/05-status-records.sql` | 20644 | 52 | 46 | 保护期收口 24 条语句（其中 18 条真改值）+ 补录 28 行 |
| `sql/06-verify.sql` | 1437 | 1 | 0 | 只读复查 |
| `sql/manifest.json` | 11949 | — | — | 生成清单（含每文件 sha256） |
| `rollback/01-finance-import.sql` | 12823 | 32 | 32 | 16 队 × （账户 −、补偿流水 +） |
| `rollback/02-wages.sql` | 13737 | 36 | 36 | 18 队 × （账户 +、补偿流水 +） |
| `rollback/03-tenure.sql` | 58237 | 517 | 517 | 517 份合同各 1 行（`service_ticks + 1`） |
| `rollback/04-status-records.sql` | 3450 | 25 | 52 | 删 28 行补录单 + 保护期还原到快照值 |

**所有写语句都带守卫**（`NOT EXISTS` 幂等闸 / 逐行 `WHERE` 值守卫）⇒ **重放 changes = 0**，可安全 `--retry`。
语句内不出现 `"` `%` `&` `|` `<` `>`（过 `exec-shards.mjs` 的 shell 元字符闸；`<>` 已改写为 `!=`），单条最长 516 字节（< 4000）。

生成器：`gen-opening-align.ts`（Node 24 直接跑 TS），`node gen-opening-align.ts "E:/Downloads/一线队-S9.csv"`；
`--verify` 走只读复核，`--local` 走本地。快照采集器：`capture-snapshot.mjs`（`--remote` 默认）。

---

## §4 执行记录

| 步骤 | 命令 | 结果 |
|---|---|---|
| 预检 | `node capture-snapshot.mjs --remote` | 20 队余额 / 18 队工资 / 517 合同 / 幂等闸全 0 / S9 W1 closed / 30 名标记球员；`snapshot.json` @2026-10-06T03:07:28.071Z |
| ① 财政导入 | `node exec-shards.mjs sql/02-finance-import.sql --remote --chunk=20 --retry=2` | 4 批，**changes 32**，rows_written 80，失败批 0 |
| ② 扣工资 | `node exec-shards.mjs sql/03-wages.sql --remote --chunk=20 --retry=2` | 4 批，**changes 36**，rows_written 90，失败批 0 |
| ③ 效力 +0.5 | `node exec-shards.mjs sql/04-tenure.sql --remote --chunk=20 --retry=2` | 26 批，**changes 517**，失败批 0 |
| ④ 落点 | `node exec-shards.mjs sql/05-status-records.sql --remote --chunk=20 --retry=2` | 5 批，**changes 46**（6 条语句 changes=0 = 已达标/护栏跳过），失败批 0 |
| 验收 A | `node gen-opening-align.ts "E:/Downloads/一线队-S9.csv" --verify` | 聚合 {oi_n 16, oi_sum 968.25, wage_n 18, wage_sum −1022.68, rec_match 24, rec_rc 4}；match-once 占用 24 名；**只读复核差异 0**（18 队余额 = 快照 + 期初 − 工资；517 合同 `service_ticks = 快照 − 1`；24 名标记球员 `protection_ticks = 1`） |
| 验收 B | `sql/06-verify.sql`（只读） | `sum_balances 905.73` / `oi_n 16` / `oi_sum 968.25` / `wage_n 18` / `wage_sum −1022.68` / `stk_sum −1109` / `ptk1_n 24` / `rec_match 24` / `rec_rc 4` / `rec_all 28` |
| 汇总核对 | 逐队余额 SQL | 18 队全部命中期望（见 report.md §3） |

**本批只跑正向，未跑回滚**（回滚工件仅在需要撤销时按序执行）。

---

## §5 本地演练

本地 D1 是 30 人 dev 夹具（clubs 只有 1/2/777/3、`contracts` id 1..21），生产工件的 club/player id 在本地不存在
⇒ **数据级演练不可行**，只能做**形状级**演练（与 `scripts/prod-20261005-s9-cpu-contracts/` §5 同款先例）。
本批在 `.wrangler/state` 的**副本**（`scratch/rehearsal-state`）上以 `scratch/probe-shapes.sql`（7 条）与
`scratch/probe-rollback.sql`（7 条）镜像了全部 5 种写入形状，实测结论：

- 账户 upsert + 流水对的差值语义正确（+1.00 / −0.50 精确落账，`balance_after` 读同批更新后余额）；
- `json_object` evidence 的 `transfers` 插入形状可用（本地插入 1 行、回滚删除 1 行）；
- 保护期 `protection_ticks IS NOT NULL` 护栏按预期跳过 NULL（训练营）合同；
- **幂等**：正向连跑 2 次、回滚连跑 2 次，第二次全部 changes = 0（守卫有效）；
- 回滚的补偿分录把余额精确还原（净差 0）。

**教训（已修）**：`exec-shards.mjs` 只认 `--persist-to=<dir>`（等号形式），
写成空格形式 `--persist-to <dir>` 会被静默忽略并打到默认 `.wrangler/state`；
一次误跑把演练形状写进了**本地 dev 夹具**，已用回滚件 + 定向清理还原到基线
（`ledger_entries` 11 行、club 2 余额 99.2、contract 1 `service_ticks` 0 / `protection_ticks` NULL、`transfers` 21 行，
已核对一致）。生产不受影响。

---

## §6 执行器通道纪律（`exec-shards.mjs`）

```
node exec-shards.mjs <sql 文件> --remote|--local [--chunk=20] [--dry] [--retry=N] [--persist-to=<dir>]
```

- 不带 `--remote` 默认 `--local`；`--dry` 只打印批计划（不执行）。
- 单条语句 > 4000 字节 ⇒ exit 3；语句含 `"` `%` `&` `|` `<` `>` ⇒ exit 3（`--command` 经 shell）。
- `--retry` 只对**带守卫、重放 changes=0** 的工件开；`--local` 不回传 `meta.changes`（恒 0，本地按行数判）。
- 读-only 预检/复查走 `wrangler d1 execute --file`（`--file` 下整批一个事务）。
- Windows 偶发 `exit 3221226505` + `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c` ⇒ 重试即过。

---

## §7 回滚

按序执行（每条语句都带守卫 ⇒ 重放 changes = 0）：

```
node exec-shards.mjs rollback/04-status-records.sql --remote --chunk=20   # 先撤 ④：删 28 行补录单 + 保护期还原
node exec-shards.mjs rollback/03-tenure.sql         --remote --chunk=20   # 撤 ③：service_ticks + 1
node exec-shards.mjs rollback/02-wages.sql          --remote --chunk=20   # 撤 ②：余额 + 工资、补 manual_adjust 流水
node exec-shards.mjs rollback/01-finance-import.sql --remote --chunk=20   # 撤 ①：余额 − 期初、补 manual_adjust 流水
```

**账本口径**：回滚不删原流水（会打断 `balance_after` 链），而是**补偿分录**（`kind='manual_adjust'`、
`ref_type='batch_rollback_finance' | 'batch_rollback_wage'`、`ref_id = 20261006`、memo 指回原批）。
`transfers` 补录行按 `idempotency_key` 精确删除。回滚后余额与效力刻度回到快照值。

---

## §8 遗留与登记不改

1. **曼城 10 与 AC 米兰 131681 仍无合同**：CSV 里 4 名标记球员（71351 Mokio / 251566 Martinelli / 261865 Miguel Gutiérrez
   → 曼城；264309 Güler → AC 米兰）落在 CPU 队，本批只补了 match 记录、没有合同行（既有遗留，非本批新缺陷；
   需要时按 `scripts/prod-20261005-s9-cpu-contracts/` 的生成器扩到四队重跑）。
2. **消费券未建模**：图片券列只在本 README 与 `opening-finance.json` 留痕，平台无字段（用户口径：本轮不建）。
3. **图片 3 行无对应真人队**（托特纳姆热刺 / 科莫 / 国际米兰）⇒ 未导入；日后若接管需另批补。
4. **241 巴塞罗那 −61.48 / 112172 RB莱比锡 −57.69**：余额转负是用户已知的口径结果（账本无负余额约束）。
5. **效力 +0.5 是逐合同刻度**，`season_windows` 仍只有 1 个已关常规窗；日后端上关窗会自然再 +0.5（口径不冲突）。
6. **`transfers` 的 `created_at` 用批生成时刻**（联赛事件真实日期未知）——页面按「S9 第 1 窗」+ 日期展示。
