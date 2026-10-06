# S9 期初对齐批 · 执行报告（2026-10-06）

**结论：四步全部落库成功，changes 合计 631、失败批 0、只读复核差异 0。**

- 生成时刻 `BATCH_TS = 2026-10-06T03:08:00.611Z`；预检快照 `2026-10-06T03:07:28.071Z`（`--remote`，只读）。
- 生产库 `whl-club`；零迁移、零 API 契约变更、零前端改动。
- 本批**只跑正向**；`rollback/` 四件未执行（仅在需要撤销时按序跑，见 README §7）。

---

## §1 执行明细

| 步骤 | 工件 | 批数 | 语句 | **changes** | rows_written | 失败批 |
|---|---|---|---|---|---|---|
| ① 期初财政导入 | `sql/02-finance-import.sql` | 4 | 32 | **32** | 80 | 0 |
| ② 扣一次工资 | `sql/03-wages.sql` | 4 | 36 | **36** | 90 | 0 |
| ③ 效力 +0.5 | `sql/04-tenure.sql` | 26 | 517 | **517** | 517 | 0 |
| ④ 保护期收口 + 补录 | `sql/05-status-records.sql` | 5 | 52 | **46** | 214 | 0 |
| 合计 | | 39 | 637 | **631** | 901 | 0 |

④ 的 52 条语句里有 **6 条 changes = 0**（保护期语句中 6 条的合同本已 `protection_ticks = 1` 或为 NULL 被护栏跳过）
⇒ 46 = 18（真改值的保护期）+ 28（补录行），与期望完全一致。

执行命令（统一 `--chunk=20 --retry=2`）：

```
node exec-shards.mjs sql/02-finance-import.sql --remote --chunk=20 --retry=2
node exec-shards.mjs sql/03-wages.sql          --remote --chunk=20 --retry=2
node exec-shards.mjs sql/04-tenure.sql         --remote --chunk=20 --retry=2
node exec-shards.mjs sql/05-status-records.sql --remote --chunk=20 --retry=2
```

---

## §2 与计划的差异

**无。** 逐项核对：

| 项 | 计划（manifest 期望） | 实得 | 差异 |
|---|---|---|---|
| ① changes | 32 | 32 | 0 |
| ② changes | 36 | 36 | 0 |
| ③ changes | 517 | 517 | 0 |
| ④ changes | 46 | 46 | 0 |
| 财政导入合计 | +968.25 m | +968.25 m | 0 |
| 工资扣减合计 | −1022.68 m | −1022.68 m | 0 |
| 补录行数 | 28（match 24 + rc_change 4） | 28 | 0 |
| 保护期收口 | 24 人（18 条真改值） | 24 人 / 18 条 | 0 |
| 跳过行 | 2（Anderson / Vlahović） | 2 | 0 |

---

## §3 验收数据

### 3.1 验收 A：`node gen-opening-align.ts "E:/Downloads/一线队-S9.csv" --verify`（只读）

```
账本/补录聚合：{"oi_n":16,"oi_sum":968.25,"wage_n":18,"wage_sum":-1022.68,"rec_match":24,"rec_rc":4,"ptk1_all":96}
match-once 名额占用（type=match AND status=completed）：24 名
只读复核：差异 0 ✓
```

复核内容：18 队余额 = 快照 + 期初 − 工资（阈值 0.011）；517 份合同 `service_ticks = 快照 − 1`；
24 名标记球员 `protection_ticks = 1`；match-once 占用 24 名。

### 3.2 验收 B：`sql/06-verify.sql`（只读）

```
sum_balances 905.73 | oi_n 16 | oi_sum 968.25 | wage_n 18 | wage_sum -1022.68
stk_sum -1109 | ptk1_n 24 | rec_match 24 | rec_rc 4 | rec_all 28
```

（`--file` 方式跑时 wrangler 只回「Total queries executed / Rows read」汇总，取列值要用 `--command` 单行形式。）

### 3.3 逐队余额（期初 + 图值 − 工资）

| club | 名称 | 期初 | 期初导入 | 工资 | **落库后** |
|---|---|---|---|---|---|
| 1 | 阿森纳 | 32.14 | +51.76 | −48.37 | **35.53** |
| 2 | 阿斯顿维拉 | 33.87 | +40.79 | −58.25 | **16.41** |
| 5 | 切尔西 | 67.77 | +2.05 | −49.23 | **20.59** |
| 9 | 利物浦 | 70.00 | +119.37 | −73.55 | **115.82** |
| 11 | 曼联 | 75.08 | +60.49 | −63.68 | **71.89** |
| 13 | 纽卡斯尔联 | 67.66 | +53.59 | −57.48 | **63.77** |
| 14 | 诺丁汉森林 | 53.14 | +84.10 | −48.62 | **88.62** |
| 21 | 拜仁慕尼黑 | 34.25 | +78.66 | −56.98 | **55.93** |
| 33 | 慕尼黑1860 | 82.82 | +60.83 | −62.53 | **81.12** |
| 45 | 尤文图斯 | 66.25 | +92.46 | −65.56 | **93.15** |
| 66 | 里昂 | 74.68 | +72.90 | −67.57 | **80.01** |
| 73 | 巴黎圣日耳曼 | 75.51 | +119.75 | −66.44 | **128.82** |
| 241 | 巴塞罗那 | 0 | 0（用户排除） | −61.48 | **−61.48** |
| 243 | 皇家马德里 | 63.61 | +20.90 | −56.77 | **27.74** |
| 280 | 奥林匹亚科斯 | 40.29 | +45.66 | −37.62 | **48.33** |
| 449 | 皇家贝蒂斯 | 58.51 | +44.78 | −33.37 | **69.92** |
| 110374 | 佛罗伦萨 | 64.58 | +20.16 | −57.49 | **27.25** |
| 112172 | RB莱比锡 | 0 | 0（用户排除） | −57.69 | **−57.69** |
| — | 全库合计 | **960.16** | **+968.25** | **−1022.68** | **905.73** |

（CPU 队 10 曼城 / 131681 AC米兰 无 `ledger_accounts` 行，未参与。）

### 3.4 效力与保护期

- 517 份现行合同 `service_ticks` 全部 = 快照值 − 1；`stk_sum = −1109`（快照和 −592 − 517）。
- 24 名标记球员 `protection_ticks = 1`（保护期收口）；全库 `protection_ticks = 1` 的现行合同 96 份（含本批前的既有）。
- 补录 28 行 `transfers`：`type='match'` 24（`matched = 1`）+ `type='rc_change'` 4；全部 `season=9 / window_seq=1 / status='completed'`。

---

## §4 留痕与偏差

1. **本地演练误写入已还原**：形状演练时 `exec-shards.mjs` 的 `--persist-to` 用了空格形式（该脚本只认 `--persist-to=<dir>`），
   一次误跑把 5 种演练形状写进了**本地 dev 夹具**（`.wrangler/state`）。已用 `scratch/probe-rollback.sql` 抵消 + 定向删除
   4 条演练流水 + 还原 `contracts.id = 1` 的 `protection_ticks`，核对回到基线（`ledger_entries` 11 / club 2 余额 99.2 /
   `service_ticks` 0 / `protection_ticks` NULL / `transfers` 21）。**生产不受影响**（误跑用的是 `--local`）。
2. **副本演练**：`.wrangler/state` 的副本（`scratch/rehearsal-state`）上验证了 5 种形状 + 双向幂等（连跑两次 changes = 0）
   + 回滚净差 0；副本已删。
3. **生成器修一处**：`queryRemote()` 原样把多行 SQL 塞进 `--command`，Windows 的 `shell: true` 走 `cmd.exe` 会截断多行参数
   （wrangler 报 exit 1、stderr 为空）⇒ 已改成折单行（`sql.replace(/\s+/g, ' ')`），`--verify` 随即通过。
   该修改不影响已生成的 SQL 工件（工件只由快照 + CSV 决定，sha256 见 `sql/manifest.json`）。
4. **快照采集两次**：首采 2026-10-06T02:52:38Z（用于审阅），执行前重采 2026-10-06T03:07:28.071Z（用于生成，保证
   逐队余额期望与写入时刻一致）；两次之间生产无变化（幂等闸 opening_import 0 / wage 0 / transfers 0 复核通过）。
5. **未收富人税、未收 match/rc_change 差额费**：按用户令只做四项写入（税与审核费属关窗批/审核路径的范畴）。
6. **消费券未落库**：券值只留在 `opening-finance.json` 与 README §2.1。

---

## §5 后续

- 若需撤销：按 README §7 的逆序跑 `rollback/` 四件（补偿分录，重放安全）。
- 若日后接管 CPU 队（10 曼城 / 131681 AC米兰）或图片里平台无队的 3 行（托特纳姆热刺 / 科莫 / 国际米兰），
  另开批处理，不要改本批工件。
- 端上 `POST /api/admin/ledger/opening-import` 对这 16 队现在是「已导入」状态（同 kind 幂等），符合本批口径。
