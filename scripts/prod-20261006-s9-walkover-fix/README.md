# 生产批 · 2026-10-06 S9 弃权场奖金订正（收回 + 补发 + 上座清零）

## 1 缘起与范围

用户令（原文）：

1. 「查询生产库中巴塞罗那和莱比锡赛果，按赛果发场次奖金，并查询杯赛小组赛奖金池是否已分配完毕。」
2. 「弃权场败方不发钱，检查全库，收回这些奖金，并修订规则。」
3. 「这些原则要在代码层面修复。」

范围（生产库 `whl-club`，全部 `result_confirmations` 已确认赛果）：

| 块 | 范围 | 笔数 | 金额 |
| --- | --- | --- | --- |
| ① 收回 | 全库 10 场弃权场上，弃权方被错发的胜场奖金 + 弃权场的比赛日收入 | 9 | 39.74 M |
| ② 补发 | 弃权场胜方（原本零流水）+ CPU 期（241 巴塞罗那 / 112172 RB莱比锡 当时 `is_cpu=1`）被跳过的赛果奖金 | 12 | 75.20 M |
| ③ 差额 | 弃权场真胜者当时只拿到「出场补贴」（被当败方），补到胜场奖金 | 5 | 19.00 M |
| 合计 | | 26 | 净 +54.46 M |

另有 ④ 数据面收尾（不涉金额）：5 场弃权场残留的 `match_attendance` 行收入四件套清零（账本已收回，界面聚合不能还显示），见 §3.1。**代码层修订另枚（v6.36.0）**：`src/core/walkover.ts` 唯一出处 + 8 处读者改调 + 测试，见 §7 第 1 条。

## 2 口径

### 2.1 弃权语义（本批的根因）

- tour 仓 `WHL-tournament-management-system/migrations/0013_walkover.sql` 注释：`''` = 普通场；`'home'`/`'away'` = 单方弃权（比分记 0:3，弃权方 0）；`'both'` = 双弃权。
- 生产 tour 库（`whl`）10 场弃权场的 `note` 逐场写「主队弃权」/「客队弃权」，`winner` 一律是对手 —— 双向核对一致。
- ⇒ **`result_confirmations.walkover_side` = 弃权方（判负方）**。
- 平台 `src/worker/prizes.ts:93-106` 的 `outcome()` 把它当胜方读（`if (m.walkoverSide === 'home') return 'home'`），导致「弃权方拿胜场奖金、真胜者拿出场补贴」。同款反向读法还在 `season-settle.ts:56-57 / 124-125 / 337-341`、`event-ops.ts:331-332`、`home.ts:212-213`、`naming-ops.ts:394 / 608-609` —— 本批只订正账本数据，**代码修订另开**（见 §7）。

### 2.2 发钱规则（用户拍板）

1. 弃权场：**胜方照发胜场奖金**（联赛 `win` / 冠军杯小组 `win`）；**弃权方一分不发**（连败方出场补贴也没有）。
2. 弃权场：**不发比赛日收入**（`kind='revenue'`，`ref_type='match'`）—— 用户选择连收入一并收回。
3. 非弃权场：按赛果照发（胜 / 平 / 负），含 CPU 期被整队跳过者。
4. CPU 队不发（`is_cpu=1`：曼城 `10`、AC米兰 `131681`）—— 平台既有闸 `src/worker/prizes.ts:57-73`（`cpuClubIds`），本批对齐，**不给它们补发**。
5. 金额取 `src/core/config.ts` 的 `CONFIG_DEFAULTS.prize_table`（生产 `config` 表无 `prize_table` 覆盖）：`league_premier { win 8.5, draw 6.6, loss 4.7 }`、`league_second { win 6.7, draw 4.8, loss 2.9 }`、`champions_group { win 7.0, draw 2.5 }`。

### 2.3 写入形状

- **收回 = 补偿分录**（不删原流水，避免打断 `balance_after` 链）：`kind='manual_adjust'`，`ref_type='wo_rollback_prize'` / `'wo_rollback_revenue'`，`ref_id=matchId`，memo 指回原流水 id。
- **补发 = canonical 键**：`kind='prize'` + `ref_type='match_home'|'match_away'` + `ref_id=matchId` —— 与平台发奖同键，故日后代码修好后重放该场仍不会双发。
- **差额 = `_fix` 键**：原 canonical 键已被「出场补贴」流水占用，另立 `ref_type='match_home_fix'|'match_away_fix'`。
- 每笔两句（账户 upsert + 流水），与 `src/worker/ledger.ts:29-63` 的 `ledgerMovement` 同形；幂等闸 = 同键 `NOT EXISTS`（离线批可能被通道拆批，故不用 `changes()>0`）。

### 2.4 逐队净变化

| club | 队 | 基线余额 | 净变化 | 期望余额 |
| --- | --- | --- | --- | --- |
| 1 | 阿森纳 | 35.53 | +3.80 | 39.33 |
| 2 | 阿斯顿维拉 | 16.41 | +2.51 | 18.92 |
| 14 | 诺丁汉森林 | 88.62 | +3.80 | 92.42 |
| 21 | 拜仁慕尼黑 | 55.93 | −4.80 | 51.13 |
| 241 | 巴塞罗那 | −61.48 | +56.40 | −5.08 |
| 449 | 皇家贝蒂斯 | 69.92 | −20.94 | 48.98 |
| 110374 | 佛罗伦萨 | 27.25 | +1.89 | 29.14 |
| 112172 | RB莱比锡 | −57.69 | +11.80 | −45.89 |

其余 10 队余额不受影响。

## 3 工件表

| 文件 | 字节 | 语句 | 期望 changes | sha256（前 12） |
| --- | --- | --- | --- | --- |
| `sql/01-precheck.sql` | 2784 | 5 | 只读 | — |
| `sql/02-clawback.sql` | 10296 | 18 | 18 | `2f6f2785d16c` |
| `sql/03-topup-missing.sql` | 11959 | 24 | 24 | `26578de03070` |
| `sql/04-topup-delta.sql` | 5520 | 10 | 10 | `17676ce5a66d` |
| `sql/05-verify.sql` | 2046 | 1 | 只读 | `492ef945c96d` |
| `sql/06-attendance-cleanup.sql` | 2271 | 5 | 5 | `b660a2d12802` |
| `rollback/01-undo.sql` | 30943 | 52 | 52 | `0f80a98d9f26` |
| `rollback/05-attendance-restore.sql` | 1773 | 5 | 5 | `0114fe559eb2` |

完整 sha256 / 明细（26 笔逐笔 club/match/amount/memo + 5 行上座清零）见 `sql/manifest.json`（入库）。

生成器：`node gen-walkover-fix.ts`（重建 SQL + manifest，内含 `selfCheck()`：键不重复 / 不给弃权方补发 / 不与已发流水同场整笔双发 / 上座行与收入收回一一对应 / 总额硬断言 39.74·75.20·19.00·54.46）；`node gen-walkover-fix.ts --verify`（只读复核：逐队余额、逐键在位、上座行已清零、守恒位，退出码非 0 即差异）。

> 补生成后续分片时用 `--ts=<ISO>` 传回本批时间戳（`2026-10-06T04:23:06Z`），否则 02–05 分片里的 `created_at` 会变、与已执行 SQL 不再逐字一致。`sql/06` 与 `rollback/05` 是执行后补出的分片（见 §4 步骤 ④），已按此重新生成，四个写分片的 sha256 与执行时逐字一致。

### 3.1 上座清零（`sql/06-attendance-cleanup.sql`）

10 场弃权场里有 5 场留下 `match_attendance` 行（与 ② 里收回的 5 笔比赛日收入一一对应）：

| 比赛 | club | 队 | 上座（原→0） | 门票（原→0） | 天气（保留） |
| --- | --- | --- | --- | --- | --- |
| #2 | 449 | 皇家贝蒂斯 | 9081 | 1.36 | 雨 |
| #31 | 449 | 皇家贝蒂斯 | 7202 | 1.08 | 多云 |
| #38 | 110374 | 佛罗伦萨 | 12735 | 1.91 | 晴 |
| #165 | 21 | 拜仁慕尼黑 | 12699 | 1.90 | 晴 |
| #172 | 2 | 阿斯顿维拉 | 8575 | 1.29 | 多云 |

（5 行 `commercial` 与 `broadcast` 均为 0；门票合计 7.54 M = ② 里收回的比赛日收入合计。）

**为什么清零而不是删行**：账本里的收入已按用户裁决收回（`sql/02`），而球队页「近期主场战报」与财政页「比赛日收入」窗口聚合都从这张表读 ⇒ 不清零就会出现「钱已收回、界面还显示」。行本身必须保留：① 它是收入幂等闸（`src/worker/home.ts:327` 按 `match_id` 查存在性）；② 主场战报以它挂载，弃权场仍要显示「弃权负 / 弃权胜」；③ `weather` 供「已确认取实际天气」（`src/worker/routes/fixtures.ts`）。

## 4 执行记录

执行通道：`node exec-shards.mjs sql/<文件> --remote --chunk=20 --retry=2`（详见 §6）。

| 步骤 | 工件 | 批数 | 语句 | changes | rows_written | 失败批 |
| --- | --- | --- | --- | --- | --- | --- |
| 执行前预检 | `sql/01-precheck.sql` | — | 5 | 只读 | — | 0 |
| ① 收回 | `sql/02-clawback.sql` | 3 | 18 | **18** | 45 | 0 |
| ② 补发 | `sql/03-topup-missing.sql` | 3 | 24 | **24** | 60 | 0 |
| ③ 差额 | `sql/04-topup-delta.sql` | 2 | 10 | **10** | 25 | 0 |
| ④ 上座清零 | `sql/06-attendance-cleanup.sql` | 1 | 5 | **5** | 5 | 0 |
| 合计 | | 9 | 57 | **57** | 135 | 0 |

步骤 ④ 在本批账本写入（步骤 ①–③）之后单独执行 —— 是「收入已收回」的数据面收尾，见 §3.1。

验收（全部命中，差异 0）：

- `sql/05-verify.sql`（④ 之后跑，已含上座列）：`bal_1 39.33 | bal_2 18.92 | bal_14 92.42 | bal_21 51.13 | bal_241 24.92 | bal_449 48.98 | bal_110374 29.14 | bal_112172 -15.89 | wo_rollback_n 9 | fix_n 5 | wo_prize_n 22 | wo_att_n 5 | wo_att_dirty_n 0 | conserve 0`。
- `node gen-walkover-fix.ts --verify`：逐队余额 8/8 ✓、上座行 5/5 已清零 ✓、收回键 9/9 ✓、补发键 12/12 ✓、差额键 5/5 ✓、**只读复核：差异 0 ✓**。
- 守恒位 `Σbalance − Σamount = 0` ✓（本批前后均为 0）。
- 执行前预检（2026-10-06）：弃权场 10 行 ✓；相关流水 14 行（9 收回 + 5 差额，无第 15 行）✓；8 队基线余额与表 2.4 逐项一致 ✓；本批键占用全 0 ✓。
- **批后余额漂移（不是本批差异）**：241 巴塞罗那与 112172 RB莱比锡各 +30.00 —— 管理员「接队资金」手动入账（`ledger_entries` id 271 / 272，`kind='manual_adjust'`、`ref_type='manual'`、created_at 2026-10-06T04:43:58Z / 04:44:11Z）。生成器已把这两笔记为 `POST_BATCH`（表 2.4 的期望余额是批执行时刻的口径：−5.08 / −45.89，含接队资金后为 24.92 / −15.89）。

## 5 回滚

账本：`node exec-shards.mjs rollback/01-undo.sql --remote --chunk=20 --retry=2`（9 批 / 52 语句）。

- 逆序补偿：先撤差额、再撤补发、最后撤收回；账户按差额加减（绝不 `SET` 绝对值）+ 一条反向流水（`kind='manual_adjust'`，`ref_type='batch_rollback_wo'`，`ref_id=20261006`，memo 指回原笔）。
- 每句带守卫（按 memo 精确匹配本批流水）⇒ 重放 changes=0；未执行本批时执行回滚同样 changes=0。
- 原流水一律保留（删流水会打断 `balance_after` 链，仓内先例 `scripts/prod-20260926-rollback-stadium-expand/`）。

上座：`node exec-shards.mjs rollback/05-attendance-restore.sql --remote --chunk=20 --retry=2`（1 批 / 5 语句）。

- 把 5 行的 `attendance`/`ticket`/`commercial`/`broadcast` 写回原值（原值硬编码在 `ATT_ROWS`，与 `sql/06` 一一对应）。
- 守卫为「四列全为 0」⇒ 只撤本批的清零，人工改过或未清零都不命中，重放 changes=0。
- 回滚顺序建议与执行相反：先 `rollback/05`（上座）再 `rollback/01`（账本）。

## 6 执行器通道纪律

`exec-shards.mjs`（自 `scripts/prod-20261005-s9-cpu-contracts/` 复制）：

- 用法 `node exec-shards.mjs <sql> --remote|--local [--chunk=20] [--dry] [--retry=N] [--persist-to=dir]`；不带 `--remote` 默认 `--local`；`--dry` 只打印批计划。
- **单条语句 > 4000 字节 exit 3**；语句含 `"` `%` `&` `|` `<` `>` exit 3（`--command` 经 shell）⇒ 本批 SQL 里比较一律用 `!=`、引号只用单引号；`--persist-to=` 必须用等号形式（空格形式会被静默忽略）。
- `--retry` 只对带守卫、重放 changes=0 的工件安全；`--local` 不回传 `meta.changes`（恒 0）。
- 只读查询走 `npx wrangler d1 execute whl-club --remote --file=sql/01-precheck.sql`（`--file` 只回汇总）；要取值逐条走 `--command`（本批用 `scratch/qsplit.mjs`，不经 shell ⇒ `%`/`<`/`>` 安全）。
- Windows 偶发 `exit 3221226505` + `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c`，重试即过。

## 7 遗留与后续

1. **代码已修（v6.36.0）**：弃权语义订正落地 —— 新建 `src/core/walkover.ts`（`isWalkover` / `walkoverWinnerSide` / `walkoverLoser` 唯一出处）+ 8 处读者改调（`prizes.ts` 的 `outcome` 极性与「弃权方一分不发」、`home.ts` 的 `formPtsOf` 与 `matchAttendanceStatements` 弃权早退、`results.ts` 传 `walkoverSide`、`season-settle.ts` 三处、`event-ops.ts`、`naming-ops.ts` 两处、`clubs.ts` 主场战报文案）+ 新建 `tests/walkover-semantics.test.ts`（16 例）与 6 个老测试订正 + 离线副本 `scripts/prod-20261004-influence-recalc/engine.mjs` 同步。**本批是数据订正**；代码修好后重放这些场次不会双发（补发键与平台同键）。
2. **杯赛小组赛奖金池未分配**：`season_tournaments` 三条（tournament 1 league_premier / 2 league_second / 3 champions_cup）`stage_settled_at` 全为 NULL，全库无任何非 `match_home`/`match_away` 的 `prize` 流水（入场奖金 / 资格赛保底 / 冠军杯小组赛剩余池一分未发）。结算前应先完成第 1 条（池按小组赛成绩分配，弃权极性会直接影响口径）—— 第 1 条现已完成，可结算。
3. **CPU 队奖金不发**：曼城 `10`、AC米兰 `131681` 即使 `is_cpu=1` 期间拿到赛果也不入账（既有口径）。本批弃权场里有 3 场胜方是 CPU 队（#48 AC米兰、#165 曼城、#182 曼城），**未补发**，合计 21.90 M 视为登记不改。
4. **双弃权（`walkover_side='both'`）**：tour 侧语义存在，生产 10 场弃权场里没有 `both`，本批未涉及；代码层已按「双方都不发钱、不发比赛日收入、战绩各记一负」定义（`src/core/walkover.ts` + `tests/walkover-semantics.test.ts` 覆盖）。
5. **生产 cron 会持续写 `prize`/`revenue`**：验收断言一律用守恒位与逐队余额（不用全库笔数）。批后另有管理员「接队资金」手动入账 2 笔（241 / 112172 各 +30.00，见 §4 末条），已在生成器里记为 `POST_BATCH`。
6. **弃权场的死忠（fans）演化未回滚**：那 5 场当时与上座同批跑了 `evolveFans`（`src/worker/home.ts:403`），本批只清零了上座/收入，**fans 递推结果保留**（登记不改）—— 精确回滚要按窗重放整条死忠链（属离线重算引擎的活，`scripts/prod-20261004-influence-recalc/`）。新代码起弃权场不再演化死忠。
7. **弃权场 XP 已按「不发放」处理**（`src/worker/results.ts:559` 的布尔闸，旧口径就正确），本批未涉及；已发的 XP 不回收（登记不改）。
