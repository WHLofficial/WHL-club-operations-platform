# 生产批 · 2026-10-17 S9 点球决胜按平局订正（收回 + 重新发）

## 1 缘起与规则

用户令（原文，2026-10-17）：「点球决胜按平局重新发」。

规则：**平比分 + 点球分胜负**的场次，在**小组赛/联赛**口径下按平局发奖（双方各 2.5）；点球胜者只作用于**淘汰赛**口径（晋级与晋级奖金）。
战绩侧口径早已如此（`src/worker/home.ts` formPtsOf 注释「点球决胜按平局计——用户裁决 2026-09-16」、`season-settle.ts` leagueStandings、`naming-ops.ts` betCountSql），**只有发奖侧漏了 stage 闸**。

代码修正（同批，随下次发版上线）：

| 文件 | 函数 | 修正 |
| --- | --- | --- |
| `src/worker/prizes.ts` | `outcome()` | 点球/winner 分支加 stage 闸：`stage_kind ∈ {group, round_robin}` 时平比分即平局（原来无条件看点球） |
| `src/worker/season-settle.ts` | `aggregateRecords()` | ① 同一 stage 闸（小组赛剩余池 `paid` 口径）② 一侧未映射（对手是 CPU 队或目录缺行）时**照样计已映射一侧**（原来整场跳过 ⇒ `paid` 算少、剩余池补发会突破池上限） |

## 2 范围（全库仅这 4 场）

`result_confirmations` 里「平比分 + 点球分胜负」的场次全库恰好 4 场，全部是 S9 冠军杯小组赛（`tournament 3 / stage 6 / stage_kind=group`）；联赛 0 场。

| 比赛 | 对阵 | 比分 | 点球 | 点球胜方 | 原发 | 订正后 |
| --- | --- | --- | --- | --- | --- | --- |
| #10 | 曼联(11) vs 奥林匹亚科斯(280) | 1-1 | 1-3 | 客 280 | 280 +7.00（流水 id=83） | 双方各 +2.50 |
| #16 | AC米兰(CPU)(131681) vs 拜仁慕尼黑(21) | 1-1 | 5-4 | 主 131681（CPU） | 未发（CPU 侧不入账） | 仅 21 +2.50 |
| #18 | 巴塞罗那(241) vs 尤文图斯(45) | 1-1 | 5-3 | 主 241 | 241 +7.00（流水 id=256） | 双方各 +2.50 |
| #22 | 阿斯顿维拉(2) vs RB莱比锡(112172) | 2-2 | 3-4 | 客 112172 | 112172 +7.00（流水 id=264） | 双方各 +2.50 |

注：流水 id=256 / 264 的 memo 是弃权批写的「联赛胜场奖金（比赛 #N，CPU 期补发）」——**标签写错**（该场是冠军杯小组赛），金额与归属正确；本批在收回 memo 里指回原流水 id 以便追溯。

## 3 写入形状

- **收回**（3 笔）：`kind='manual_adjust'`、`ref_type='pk_rollback_prize'`、`ref_id=比赛号`、`amount=-7.00`；不删原流水（保 `balance_after` 链），memo 指回原流水 id。
- **重新发**（7 笔）：`kind='prize'`、`amount=2.50`。
  - 对手侧（4 笔）用**平台 canonical 键**（`match_home`/`match_away` + `ref_id=比赛号`，原键空闲）⇒ 日后代码修订重放该场不会双发。
  - 点球胜方侧（3 笔）canonical 键被原 7.00M 占用 ⇒ 用 `_fix` 键（`match_home_fix`/`match_away_fix`）。
  - CPU 队一侧（#16 的 131681）不补发（平台队打 CPU 队只发平台侧，v2.0.0 裁决 6）。
- 每笔两句（账户按**差额**增减，绝不 SET 绝对值 + 对应流水），`NOT EXISTS` 守卫 ⇒ 重放 `changes=0`。

## 4 逐队净变化（已执行）

| club | 队 | 执行前余额 | 净变化 | 执行后余额 | 构成 |
| --- | --- | --- | --- | --- | --- |
| 280 | 奥林匹亚科斯 | 54.44 | **−4.50** | 49.94 | −7.00（收回）+ 2.50（补发） |
| 11 | 曼联 | 92.62 | **+2.50** | 95.12 | +2.50 |
| 241 | 巴塞罗那 | 45.29 | **−4.50** | 40.79 | −7.00 + 2.50 |
| 45 | 尤文图斯 | 110.59 | **+2.50** | 113.09 | +2.50 |
| 112172 | RB莱比锡 | 2.79 | **−4.50** | **−1.71** | −7.00 + 2.50 |
| 2 | 阿斯顿维拉 | 29.92 | **+2.50** | 32.42 | +2.50 |
| 21 | 拜仁慕尼黑 | 60.60 | **+2.50** | 63.10 | +2.50 |
| 合计 | | | **−3.50** | | 收回 21.00 − 补发 17.50 |

RB莱比锡执行后余额 −1.71（欠账，仓内策略「允许负余额」；其原余额 2.79 不足以抵 −4.50）。

## 5 执行记录（2026-10-17）

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 预检（只读） | `npx wrangler d1 execute whl-club --remote --command …`（`sql/01-precheck.sql` 的 5 组查询） | 4 场全为 `champions_cup/group` ✓；场次流水 3 笔 7.00M + 2 笔 `wx_fix`（天气订正批，无关）✓；`pk_rollback_n=0 / pk_fix_n=0 / canonical_prize_n=3`（胜者侧键被原 7.00M 占用 ⇒ 必须走 `_fix`）✓；守恒 0 ✓ |
| 本地演练 | `node exec-shards.mjs sql/02-clawback.sql --local --persist-to=<state 副本>` 与 `sql/03-topup.sql` 同上 | 20 条语句全提交；余额逐队净变化与预期一致；重放不新增 ✓ |
| 执行 | `node exec-shards.mjs sql/02-clawback.sql --remote --chunk=20 --retry=3`<br>`node exec-shards.mjs sql/03-topup.sql --remote --chunk=20 --retry=3` | 6 条 → changes 6；14 条 → changes 14（**20/20 全部生效**，无 changes=0）|
| 复查（只读） | 见 `sql/04-verify.sql` | `pk_rollback_n=3`、`fix_home_n=1`、`fix_away_n=2`、`canonical_prize_n=7`、`draw_2_5_n=7`、守恒 0 ✓；7 队余额 = 上表 ✓ |
| 重放幂等 | 同执行命令再跑一遍 | 20 条语句 `changes` 全 0 ✓ |

**冠军杯小组赛奖金口径（执行后）**：`kind='prize'` 且该赛事小组赛的 `match_*` / `match_*_fix` 流水 = **35 笔 / 213.50M**（28 胜 × 7.00 = 196.00 + 7 平 × 2.50 = 17.50）；其中被本批收回的 3 笔 7.00M 已由 `pk_rollback_prize` 抵消 ⇒ **实发 192.50M**。

剩余池结算（`season_tournaments` id=3 的 `stage_settled_at` 仍为 null，尚未跑）：修正后的 `paid` 口径 = 25 胜 × 7.00 + 7 平 × 2.50 = **192.50** ⇒ `remaining = 200 − 192.50 = 7.50` ⇒ 按胜场占比分发 0.30/胜 ⇒ **小组赛总支出恰好 = 池上限 200.00** ✓（旧口径 `paid`=168 ⇒ 会补 32 而突破池上限到 228）。

## 6 工件

| 文件 | 字节 | sha256 |
| --- | --- | --- |
| `sql/01-precheck.sql` | 1802 | `7258c4e025bf27aad9fd6ab6012ec964d46ac66140f3add8e85020004895e93d` |
| `sql/02-clawback.sql` | 3610 | `918f218dab30d934a5c7e8cd248ac1ec2effd5d479ff9c171abaa05a12736cc9` |
| `sql/03-topup.sql` | 7496 | `8474d77b24c0509d820d8843e865fcff953d896255475a5e5fa700366eae6052` |
| `sql/04-verify.sql` | 1768 | `d424f7cdf5891c56b6187b736a02ba9fb8ce8ee86bdc29e232abef8891e437d0` |
| `rollback/01-undo.sql` | 12366 | `379a4ef0969a52cf54ecd71291915b414e5207ea961a33cef652a325c9ab8145` |
| `gen-pk-draw-fix.mjs` | — | `2a0268c900b5d6b22d571806e4458b19b0f8694d9b8d4a40b59bd0d48fc72f1d` |
| `exec-shards.mjs` | — | `1b880ee358d6792a547822f368039e382b53caddc653ffde16cdb90fede343d4`（与 `prod-20261006-s9-walkover-fix/` 同文件）|

生成器带自检（净变化 / 逐队 / 逐场 / 笔数 / 键唯一性 / 键选择 / shell 元字符 / 语句字节数），`node gen-pk-draw-fix.mjs --check` 全绿后才落盘。

## 7 回滚

`node exec-shards.mjs rollback/01-undo.sql --remote --chunk=20`：每笔反向一条 `manual_adjust`（`ref_type='batch_rollback_pk'`、`ref_id=20261017`、memo 区分行），保留本批流水；重放 `changes=0`。回滚后逐队余额回到 §4「执行前余额」列。

## 8 遗留与如实登记

- 结算（剩余池 7.50）**未在本批执行**——`stage_settled_at` 为 null，待冠军杯赛事完结时由平台结算流程处理（修正后的代码会给出 7.50）。
- 本批只订正「平比分 + 点球分胜负」；`aggregateRecords` 的「一侧未映射照计」修正影响的是**未来**结算（S9 三张绑定均未结算）⇒ 无需历史订正。
- 资格赛（`qualifying`）路径同有「一侧未映射整场跳过」的写法（本季未绑定，未改，代码内已留注释）。
- `#16` 的 CPU 胜方 `131681` 侧不补发；若日后 CPU 队改为平台队，该场不追溯。
