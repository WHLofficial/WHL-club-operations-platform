# 生产批：S9 冠军杯小组赛池降到 192.5 + 次级入场奖金补至顶级水平

- **批次目录**：`scripts/prod-20261017-s9-pool-and-entry-topup/`
- **执行日期**：2026-10-17（生产已执行完毕）
- **缘起（用户指令）**：①「降低奖金池到192.5」（m03014）②「即本赛季不再留冠军杯小组赛奖池里的剩余部分进行分配」（m03018）③「将次级入场奖金补发到顶级水平」（m03020）
- **作用域**：生产 D1 `whl-club`（`73154873-d5ae-42b0-a630-25f5ef60053d`），只读预检 + 两处写入（`config` 一行 upsert、`ledger_entries` + `ledger_accounts` 7 家）。**不改代码、不改迁移、不动 `src/core/config.ts` 默认值**。

## 1. 规则与口径

### 1.1 池 200 → 192.5
- `src/worker/season-settle.ts:146-156`：冠军杯小组赛结算 `remaining = round(pool − paid, 2)`，仅当 `remaining > 0 && totalWins > 0` 才按胜场占比分给有胜场的队。
- `paid` = 窗内小组赛/单循环行的 **按侧** 累计：胜 7.00 / 平 2.50（弃权判负；`is_cpu` 一侧不计）。
- S9 实测 `paid = 192.50`（25 胜 × 7.00 + 7 平 × 2.50）⇒ **池写 192.5 时 `remaining = 0`** ⇒ 本赛季不再分配剩余池（用户 ② 的意图）。
- 池只有降到 `≤ paid` 才成为硬上限；写 192.5 与写 180 / 120 在 S9 效果相同（都只省下原本要分配的 7.50）。
- 写入方式：`config` 表 upsert 整串 `prize_table` JSON，**用 SQL 侧 `json_object(...)` 构造**（不走字面双引号，见 §4 通道约束）。除 `champions_group.pool` 外其余字段与 `src/core/config.ts:137-146` 代码默认逐字一致（生成器自检逐字段比对）。
- 为什么写 config 行而不是改代码默认：`src/worker/prizes.ts:45-56` `loadPrizeTable` 先读 `config.get('prize_table')`，生产此前 **0 行** ⇒ 生效值 = 代码默认；本批写入后由 config 覆盖，**S10 起如需再调只改这一行**。

### 1.2 次级入场奖金补发到顶级水平
- 入场奖金 = 赛季末一次性按所属级别发：`season-settle.ts:122-124` 取 `table[type].entry`（顶级 `league_premier.entry` = 20、次级 `league_second.entry` = 7.5，差 2.67 倍 = 设计稿 `memory/design-s9-income-system.md:65` 的 D3 缺陷）。
- 生产 `ledger_entries` 里 `memo LIKE '%入场%'` **0 笔** ⇒ 结算尚未跑、一分未发。
- 补发口径：**现在补差额 12.50 × 7 家 = 87.50M**（不是改 config 的 `entry`）。理由：用户用词是「补发」（支付动词）；补差额与结算基础额 7.5 合计 = 20 = 顶级水平；且设计稿 `design-s9-income-system.md:89` 的 L1 联盟版权池（印钞定额 300）计划**取代**入场奖金，若改 config，将来 entry 被取代时这笔钱就永远发不出去。
- **次级名单（7 家，按 `is_cpu = 0` 过滤）**：1 阿森纳 / 2 阿斯顿维拉 / 14 诺丁汉森林 / 21 拜仁慕尼黑 / 243 皇家马德里 / 280 奥林匹亚科斯 / 112172 RB莱比锡。
  - 来源：`result_confirmations` 去重得 S9 次级（`league_second`）8 队 = 上述 7 家 + **10 曼城(CPU)**；CPU 判据取 **whl-club `clubs.is_cpu`**（仅 10 曼城(CPU)、131681 AC米兰(CPU)），**不是 AUTH_DB 队名**——AUTH_DB `team` 表里 112172 的名字是历史 CPU 期标签「RB莱比锡(CPU)」，而 whl-club 里 `name='RB莱比锡'`、`is_cpu=0`、有账本账户（点球批也给它发过钱）⇒ **在名单内**。
  - 与结算口径一致：`season-settle` 的 `clubMap` 来自 `clubIdByTourTeam`（`src/worker/prizes.ts:60-76`，第 73 行排除 `is_cpu`）⇒ 结算时这 7 家会各拿 7.5，CPU 两家不拿。
- 顶级 12 队（含 CPU 的 131681）**不在本批范围**（它们已是顶级水平）。

## 2. 写入形状

### 2.1 `sql/02-config-pool-patch.sql`（2 条）
1. `INSERT INTO audit_log` —— `action='config_set'`、`target_type='config'`、`target_id=NULL`、before/after 为 `prize_table` 的 JSON（`actor='prod-batch'`）。
2. `INSERT INTO config (key, value, updated_at) VALUES ('prize_table', <json_object 构造>, '2026-10-17T13:41:41Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`

### 2.2 `sql/03-entry-topup.sql`（14 条 = 7 家 × 2）
每家两条（顺序固定，便于重放守卫）：
1. `INSERT INTO ledger_accounts (club_id, balance, updated_at) SELECT <club>, 12.50, '<ts>' WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE ref_type = 'entry_topup' AND club_id = <club>) ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at;`
2. `INSERT INTO ledger_entries (club_id, kind, amount, ref_type, ref_id, memo, created_at) SELECT <club>, 'prize', 12.50, 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '<ts>' WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE ref_type = 'entry_topup' AND club_id = <club>);`

- **重放守卫**：两条都以「该队尚无 `entry_topup` 流水」为闸 ⇒ 重放时 `SELECT` 无行、两条都 changes=0（已实测，见 §5）。
- `kind='prize'` 与 `ref_type='entry_topup'`、`ref_id=9`（= S9 赛季号）便于日后按 `ref_type` 一次性回滚/审计；`memo` 里写明「次级补至顶级水平」。

## 3. 生产预检基线（只读，执行前）

| 项 | 值 |
|---|---|
| `config` 里 `prize_table` 行数 | **0**（生效值 = 代码默认 pool 200） |
| 小组赛 `paid`（按侧、排除 CPU 侧） | **192.50** |
| `ref_type='entry_topup'` 笔数 | **0** |
| 已结算赛事（`stage_settled_at IS NOT NULL`） | **0** |
| 守恒 `Σ余额 − Σ流水` | **0** |
| 全联盟余额合计 | **1287.31** |

7 家批前余额：1 阿森纳 **49.68** / 2 阿斯顿维拉 32.42 / 14 诺丁汉森林 109.05 / 21 拜仁慕尼黑 63.10 / 243 皇家马德里 42.20 / 280 奥林匹亚科斯 49.94 / 112172 RB莱比锡 **−1.71**（欠账，仓内允许负余额）。

> 更正登记：预检初稿把阿森纳写成 32.42（那是阿斯顿维拉的值）；阿森纳不在「点球决胜」批的 7 队变化名单里，批前批后都是 49.68。已更正。

### 3.1 `paid = 192.50` 的构成（CPU 侧口径）
- 小组赛 30 场（`tournament_id=3`、`stage_kind='group'`、round 1/2/3 各 10 场）：比分决胜 25 场 / 平比分（点球）4 场 / 弃权 1 场（match #2：449 皇家贝蒂斯 vs 112172 RB莱比锡，客队弃权 ⇒ 主胜 7.0）。
- 涉及 CPU 的 6 场：#3 利物浦 1-0 曼城(CPU)（主胜计 7.0）、#6 AC米兰(CPU) 2-1 阿森纳（**CPU 方胜 ⇒ 计 0**）、#14 纽卡斯尔联 2-0 曼城(CPU)（计 7.0）、#16 AC米兰(CPU) 1-1 拜仁慕尼黑（平 ⇒ 拜仁计 2.5）、#24 曼城(CPU) 0-4 皇家马德里（客胜计 7.0）、#25 慕尼黑1860 2-0 AC米兰(CPU)（计 7.0）。
- ⇒ 计入 25 胜（24 场非 CPU 胜 + 1 场弃权主胜）× 7.00 = 175.00；7 平（4 场点球平中的非 CPU 侧 4 + 3 场普通平）× 2.50 = 17.50；合计 **192.50**。
- 与账本口径的关系：小组赛 `match_*`/`match_*_fix` 流水 35 笔 / 213.50M，被「点球决胜」批收回的 3 笔 7.00 抵消 ⇒ 净实发 **192.50**，与结算 `paid` 恰好一致。

## 4. 通道约束（本批踩到的坑）

`exec-shards.mjs` 把语句塞进 `wrangler d1 execute --command "…"`，因此：
- 拒绝含 `" % & | < >` 的语句（`RISKY` 检查，exit 3），单条 ≤ 4000 字节 ⇒ ① `prize_table` JSON 用 SQL 侧 `json_object(...)` 构造 ② 守卫写 `NOT EXISTS (...)` 而非 `<>` ③ 胜负判定用 `sign(score_home - score_away)` ④ 不用 `||` 拼接。
- 本地（`--local`）模式 wrangler 不回传 `meta.changes`（恒 0）⇒ **本地演练一律用行数计数判断结果**，重放幂等也靠行数不变来证明。
- 生产 `--remote` 偶发两种瞬时故障（本批首轮两条写入各撞一次，**均已确认零落库**）：
  - `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`（Windows 下 node/libuv 收尾崩溃）；
  - `Proxy environment variables detected…` 之后 fetch 失败。
  - 处置：先只读复核（`prize_table` 0 行、`entry_topup` 0 笔 ⇒ 无部分写入），再 `--retry=3` 重跑，即成功。

## 5. 执行记录与回读（生产，2026-10-17）

| 步骤 | 命令 | 结果 |
|---|---|---|
| 预检 | `node exec-shards.mjs sql/01-precheck.sql --remote` | 6/6 条只读，changes 0，失败 0 |
| ① 池 | `node exec-shards.mjs sql/02-config-pool-patch.sql --remote --retry=3` | **changes 2 / rows_written 5**（= 审计 1 + upsert 1，全中） |
| ② 补发 | `node exec-shards.mjs sql/03-entry-topup.sql --remote --chunk=20 --retry=3` | **changes 14 / rows_written 35**（14 条全中，无 changes=0） |
| 回读 | `node exec-shards.mjs sql/04-verify.sql --remote` | 6/6 条只读，失败 0 |
| 重放 | 02 + 03 各再跑一次 | **16 条全部 changes=0** ⇒ 幂等成立 |

回读值：
- `config.prize_table` 现 1 行，`champions_group` = `{"entry":15,"pool":192.5,"win":7,"draw":2.5}`（其余字段与代码默认一致）。
- `ref_type='entry_topup'`：**7 笔 / 87.50**，逐队各 1 笔。
- 守恒 `Σ余额 − Σ流水` = **0**；全联盟余额合计 1287.31 → **1374.81（+87.50）**。

## 6. 逐队净变化（本次批）

| 俱乐部 | 批前 | 批后 |
|---|---|---|
| 1 阿森纳 | 49.68 | **62.18**（+12.50） |
| 2 阿斯顿维拉 | 32.42 | **44.92**（+12.50） |
| 14 诺丁汉森林 | 109.05 | **121.55**（+12.50） |
| 21 拜仁慕尼黑 | 63.10 | **75.60**（+12.50） |
| 243 皇家马德里 | 42.20 | **54.70**（+12.50） |
| 280 奥林匹亚科斯 | 49.94 | **62.44**（+12.50） |
| 112172 RB莱比锡 | −1.71 | **10.79**（+12.50，转正） |

其余 13 家不变；合计 +87.50。

## 7. 本地演练（`--local`，`.wrangler/rehearsal-pool` = `.wrangler/state` 副本）

- 夹具 `$TEMP/whl-pool-rehearsal/00-seed.sql` 把 7 家置成批前基线（夹具里阿森纳写成 32.42，仅影响演练基线值、不影响结论）。
- 02 → `config` 1 行且 `champions_group.pool = 192.5`（其余字段原样）；03 → 7 笔 / 87.50，5 家新建账户 + 2 家既有账户走 `ON CONFLICT`，7 家各 +12.50（112172 由 −1.71 → 10.79）。
- 重放 02 + 03 → 行数与余额不变（本地 changes 恒 0，按行数判断）；`rollback/01` → 7 笔补偿 −87.50、余额回基线；`rollback/02` → `config` 行 0 行、`config_set` 审计共 2 条（写 1 + 回滚 1）；重放回滚 → 无新增。

## 8. 回滚

```bash
cd scripts/prod-20261017-s9-pool-and-entry-topup
node exec-shards.mjs rollback/01-undo-entry-topup.sql --remote --chunk=20 --retry=3   # 7 笔补偿 −12.50/家
node exec-shards.mjs rollback/02-undo-config-pool.sql --remote --retry=3              # 删 config 行 ⇒ 回代码默认 pool 200
```
- 回滚 01 用 `kind='manual_adjust'` + `ref_type='batch_rollback_entry_topup'` + `ref_id=20261017` 写补偿分录（**不删原流水**），`NOT EXISTS` 守卫防重放。
- 回滚 02 为 `DELETE FROM config WHERE key = 'prize_table'`（附审计行）⇒ 生效值回到 `src/core/config.ts` 默认的 200。
- 回滚后应复核：7 家余额回批前值（1: 49.68 / 2: 32.42 / 14: 109.05 / 21: 63.10 / 243: 42.20 / 280: 49.94 / 112172: −1.71）、守恒 0。

## 9. 工件 sha256（本批冻结）

| 文件 | 字节 | sha256 |
|---|---|---|
| `sql/01-precheck.sql` | 2779 | `7c1ef5dcbdbfd41064ff71a54202f607861b7a3afb70b9e50e8545cf319e3f60` |
| `sql/02-config-pool-patch.sql` | 3769 | `b8696ec2a76f4c91d3bf61ae11da1ca2069b169d25157971b1527de7cc282fea` |
| `sql/03-entry-topup.sql` | 7696 | `7c1fecac8b139b44627b65e4ada960a801352e2a6c7cb15e28a31e620421b2a9` |
| `sql/04-verify.sql` | 1321 | `80e4c0e4bd789f6d66318e60be9561829256d9b7d6df5bcc2ee46cad5630bfc5` |
| `rollback/01-undo-entry-topup.sql` | 9168 | `ad5ec0a91f3b22a1426caacecffc71c7b2244bcb83a546aad229a3883c8b801f` |
| `rollback/02-undo-config-pool.sql` | 815 | `b9ddf112d5bd7c335c6ae6b035051e952fb4e34bc4dfcb8d159fdb09dc4d06cc` |
| `gen-batch.mjs` | — | `f7b59b24b2caa0939aba32dd35d93ef3682cb051d9822abb4d126f92f8bc30bb` |
| `exec-shards.mjs` | — | `1b880ee358d6792a547822f368039e382b53caddc653ffde16cdb90fede343d4`（与 `prod-20261017-s9-pk-draw-fix/exec-shards.mjs` 同源） |

## 10. 遗留与观察项（如实登记）

1. **结算时仍会按 config 发基础入场额**：顶级 20 / 次级 7.5。本批只补了差额 ⇒ 次级球队结算合计 = 20（= 顶级水平），符合用户「补发到顶级水平」的字面要求；S10 起若 L1 联盟版权池取代入场奖金，需另行处理（届时本批的 `ref_type='entry_topup'` 可作为历史追溯线索）。
2. **小组赛结算 `remaining` 现为 0** ⇒ 不会再分配剩余池；若关窗批之前有人把池改回去，剩余池会重新出现（本批不改代码，只改数据）。
3. **`paid` 与账本的关系**：`paid` 是结算时从 `result_confirmations` 现算的（不读账本），账本里的历史发奖只作交叉验证；点球批已把账本侧修到与 `paid` 一致（192.50）。
4. 池 192.5 是「S9 专用」数值（= 本赛季 `paid`）。**S10 起若要 120 或其它目标值，必须与逐场单价（胜 4.0 / 平 1.5）同批下调**，只动池不生效（见 `memory/plan-s9-s10-economy-revolution-rollout.md` 附录 D）。
5. 未做：不改 `src/core/config.ts` 默认值；不改 `league_second.entry`；不动冠军杯淘汰赛（`champions_ko`）与超级杯。
