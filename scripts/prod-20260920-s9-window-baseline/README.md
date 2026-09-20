# S9 窗基线：季初窗已关、中期窗未开（2026-09-20）

> **状态：未执行（等管理组明确下令）**。本目录只交付预检 + SQL 工件，不写任何库。

## 一、要做什么（用户裁决 2026-09-20）

用户原话：「对生产库计划做如下改动，开一个窗并马上关闭，把现在已确认的比赛全放在该窗后面。」
澄清后定下来的状态是：**制造一个赛季初窗口已关闭、中期窗未开的状态，现在已确认的 62 场比赛就在这期间。**

落到生产就是两件事：

1. 写一条 `season=9 / window_seq=1` 的**常规窗**，直接是 `status='closed'`（等于「开一个窗并马上关闭」，但不经应用开窗，见下）；
2. 把 62 场已确认比赛的 `window_seq` 从 0 改到 **1**（季初窗的窗号）。

62 场落 1 而不是别的数字，理由是与代码自身的兜底口径一致：`confirmMatch`（`src/worker/results.ts:218-262`）取不到在开窗时，会退到「最新 season/window_seq 的窗」；生产当时一条窗都没有，才落成了 0。空档期内以后新确认的比赛也会同样落 1。

## 二、现场快照（2026-09-20 实测，全部只读查询）

| 项 | 值 |
|---|---|
| `season_windows` | **0 行**（S9 窗从未开过） |
| `seasons` | 1 行：season 9 / `status='preparing'` / `age_cap=25` / created 2026-09-18T00:32:17.537Z |
| `result_confirmations` | **62 行**，全部 `(season=9, window_seq=0)`，`confirmed_at` 2026-09-20T05:45:06.359Z … 06:01:05.403Z，覆盖 3 个赛事（tid1 30 场 / tid2 20 场 / tid3 12 场） |
| `match_attendance` | **50 行**，全部 `(season=9, window_seq=0)`（62 场里 12 场主队无 `stadiums` 行被跳过） |
| `season_tournaments` | 3 行（S9 已绑 league_premier / league_second / champions_cup） |
| `contracts` | **0 行** |
| `registrations` | **0 行** |
| `clubs` / `players` | 20 队（16 人控 + 4 CPU）/ 18301 人（有队籍 551） |

## 三、为什么不走应用的开窗/关窗端点

`openWindow`（`src/worker/window-machine.ts:68-190`）与 `closeWindow`（同文件 `:218-325`）都会带一串用户没要的副作用：

| 副作用 | 出处 | 影响面 |
|---|---|---|
| **全库经纪人档位重掷** | `window-machine.ts`（`agent_reroll_prob` 缺省 0.3，逐 500 行扫 `players` 后分批 UPDATE） | 生产 18301 人 ⇒ 约数千行 UPDATE，档位随机变化，不可逆（原值不留档） |
| 赛季状态翻 running | `window-machine.ts:164` | 见下节「为什么不翻 running」 |
| 关窗批结算 | `closeWindow` 的 payroll / home / loyalty 语句 | 见下节「财政缺口」 |
| 审计行 | 开窗 `window_open` / 关窗 `window_close` | 审计里会留下「真的开过一次窗」的记录，与本意不符 |

用户当时的答复是「常规，但可以避免上面的后果吗」+「直接 SQL 造一条已关窗行」，所以本批**只写 SQL**：经纪人档位不动、赛季状态不动、审计不写、关窗批不跑。

## 四、为什么不改进 `seasons.status`（保持 `preparing`）

真实路径下，S9 季初窗一开，`openWindow` 就会把 `seasons.status` 从 `preparing` 翻成 `running`。本批刻意**不**翻，理由是：

- **注册闸门**：提交 S9 名单要求赛季处于备赛期 —— `src/worker/routes/registration.ts:185` 调 `getRegistrableSeason`，而后者只认 `status='preparing'`（`src/worker/seasons.ts:5-10`），取不到就 409「当前没有开放注册的赛季（只有备赛期能提交名单）」。翻了 running，20 队就**不能提交名单**了。
- 自愈：将来从中期窗正常开窗时，`openWindow`（`window-machine.ts:164`）会自己把状态翻成 running，不需要本批预设。
- 少一次写：不动 `seasons` 就少一处不可逆面。

代价：状态上看不出「窗开过」。展示端 `GET /api/seasons/current`（`src/worker/routes/seasons.ts:7-47`）读的是**最新窗行**（含 status/opened_at/closed_at），它照样会显示「9 赛季 · 第 1 窗 · 已关闭」，所以页面上该有的信息都在。

## 五、财政缺口（本批的代价，必须知情）

关窗批从来不跑 ⇒ **季初窗该收的钱一分都不会收**（没有任何后续流程会补收：中期窗的批只看 `window_seq=2` 的行）。

若按「一个含这 62 场的季初窗正常关窗」估算，`windowHomeStatements`（`src/worker/home.ts:340-407`）会收：

| 档位 | 队 | 场地容量 | 场内主场次 | 维护费 |
|---|---|---:|---:|---:|
| tier0（base 2.0，0.8/万座·场） | 阿森纳 | 12000 | 2 | 3.92 |
| | 阿斯顿维拉 / 纽卡斯尔联 / 诺丁汉森林 / 慕尼黑1860 / 皇家马德里 | 12000 | 各 3 | 各 4.88 |
| | 里昂 | 12000 | 4 | 5.84 |
| | 奥林匹亚科斯 | 12000 | 2 | 3.92 |
| | 皇家贝蒂斯 | 17000 | 3 | 6.08 |
| **tier0 小计** | | | 26 | **44.16** |
| tier1（base 5.0，0.55/万座·场） | 切尔西 | 22000 | 3 | 8.63 |
| | 佛罗伦萨 | 22000 | 3 | 8.63 |
| | 曼联 | 22000 | 5 | 11.05 |
| | 利物浦 | 35000 | 4 | 12.70 |
| | 巴黎圣日耳曼 | 35000 | 4 | 12.70 |
| | 尤文图斯 | 35000 | 3 | 10.775 |
| | 拜仁慕尼黑 | 35000 | 2 | 8.85 |
| **tier1 小计** | | | 24 | **73.335** |
| **合计（16 队）** | | | 50 | **≈117.5** |

拆开看：**地基维护费 53.0**（tier0 9 队 ×2.0 + tier1 7 队 ×5.0）+ **按场维护费 ≈64.5**。

同一次关窗批里其余各项在本批口径下本来就是 0：工资（`contracts` 0 行）、富人税（余额最高 54.14m，远低于 `luxury_cash_threshold=125`，且 ΣRC=0）、冠名收租（`naming_contracts` 0 条）、忠诚奖金（只在赛季中期窗即 `regularWindowOrdinal==2` 发，窗 1 不发）。

另外两处被跳过的演化：`evolveFans`（死忠球迷数按上座演化）与池化项的余额变动都不会发生。

> **要不要补收、补多少（53.0 还是 117.5）是用户裁决项，本批不写补收工件。** 若决定补收，最干净的路子是另行产出定向 `ledger_entries` 工件（`kind='maintenance'`、`ref_type='window'`、`ref_id = season*100+windowSeq = 901`，幂等闸按 `(club_id, kind, ref_type, ref_id)`），或把该窗按应用口径重开一次再关（但那会触发经纪人重掷，不推荐）。

## 六、执行步骤（等令）

```bash
# 0) 执行前复查（数字变了先停下查原因）
npx wrangler d1 execute whl-club --remote --json --command "SELECT (SELECT COUNT(*) FROM season_windows) AS windows, (SELECT COUNT(*) FROM seasons) AS seasons, (SELECT COUNT(*) FROM result_confirmations WHERE season=9 AND window_seq=0) AS rc0, (SELECT COUNT(*) FROM match_attendance WHERE season=9 AND window_seq=0) AS ma0"
#    期望 windows=0 / seasons=1 / rc0=62 / ma0=50

# 1) 造季初窗（期望 changes: 1）
npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-window-baseline/01-window-baseline.sql

# 2) 62 场归窗 0→1（期望 changes: 62 + 50 = 112）
npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-window-baseline/02-restamp-matches.sql

# 3) 复查（期望 windows_s9=1 / w1_closed=1 / open_windows=0 / rc_one=62 / rc_zero=0 / ma_one=50 / ma_zero=0 / season_status=preparing / contracts=0）
npx wrangler d1 execute whl-club --remote --json --command "$(cat scripts/prod-20260920-s9-window-baseline/03-verify.sql)"
```

**通道选择**：01/02 都是纯单表 INSERT/UPDATE，无外键依赖，`--file` 可用（与 `prod-20260919-roster-backfill` 同性质）。若日后把 01/02 合并成大事务再跑，按 `scripts/README.md` 的执行纪律改用 `--command`。

**配额**：两条合计 `rows_written` ≈ 113（1 + 112）+ 索引写（`idx_result_confirmations_window`、`idx_match_attendance_club` 各一次），远低于免费档日配额。

## 七、回滚

见 `99-rollback.sql`。前提：此后没有经应用开过/关过窗、也没有新比赛确认。

## 八、行为影响（执行后系统会怎样）

- **市场/转会全线下闸**：无在开窗 ⇒ 续约/解约/海捞/激活/冠名等一律 409「转会窗口没开」（`code='no_window'`；`src/worker/bypass.ts:186,268,349`、`src/worker/activations.ts:41`、`src/worker/naming-ops.ts:140,180`、`src/worker/routes/market.ts:180,263,311`）。这正是「中期窗未开」应有的表现。
- **合同导入不受影响**：通道 C（名单合同导入）不校验窗状态，备赛期可直接导入；但刻度基数由已关常规窗决定 —— `closedRegularTicks(effective_from)` 数的是 `closed_at <= effective_from` 的已关常规窗（`src/worker/contract-ticks.ts:30-45`，字符串比较）。本批窗 `closed_at = 2026-09-18T01:01:00Z`：`effective_from` 取 2026-09-20 时基数为 **1**（protection_ticks=4），取 2026-07-01 之类更早日期时基数为 **0**（protection_ticks=3）。合同导入计划须先定 `effective_from` 口径。
- **0028 apply 后**：本行自动获得 `is_temporary=0`（常规窗），无需补写。
- **⚠️ 赛季结算闸门**：`checkSeasonSettle`（`src/worker/season-settle.ts:189-233`）的 blocker 只有「还有 N 个窗没关」（查的是 `status='open'`）—— 本状态下一条在开窗也没有，**S9 会被判定为可结算**。管理端赛季页的结算按钮会变成可点，需人工克制，别在中期窗之前误点。

## 九、后续联动

本批只解决窗基线。之后按用户指令还有两件独立的生产数据导入（各自的探索/计划另出）：16 队名单合同导入、20 队球员能力导入。两者都不依赖本批，但**合同导入的刻度基数**与本批窗行的 `closed_at` 有关（见上）。
