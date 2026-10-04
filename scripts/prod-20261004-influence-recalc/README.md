# v6.28.0 C 段数据批：影响力图值导入 + 死忠重算 + 历史链式重演

> **授权状态：未授权执行（只交付脚本 + 离线干跑证据）**
> 本目录除 `snapshot` 的**只读**查询外，没有对生产库执行过任何写操作；`apply` 未运行、`applied.marker` 不存在。
> 真正落库需要用户单独下令。生产三库：`whl-club`（唯一可写，`73154873-d5ae-42b0-a630-25f5ef60053d`）、`whl`（tour，只读）、`whl-auth`（只读）。

---

## 0. 交付物

| 文件 | 作用 |
| --- | --- |
| `engine.mjs` | 纯函数重演引擎（**逐因子镜像 `src/worker/home.ts`**，零 I/O、零依赖，可离线/在测试里直接 import） |
| `values.json` | 20 队影响力图值（shell_influence / bonus_points / 级别 / 是否 CPU / 待补标记） |
| `recalc.mjs` | CLI：`snapshot` / `plan` / `apply` / `verify` 四个子命令 |
| `snapshot.json` | 只读拉取的生产现状（2026-10-04T06:32:04Z） |
| `plan.json` · `report.md` · `sql/` | 离线干跑产物（**未执行**），口径 `--initials=default`（初值一律 1800） |
| `sql/01..05` + `sql/99-rollback.sql` | apply 用的分步 SQL（01 stadiums / 02 上座+收入 / 03 流水金额 / 04 余额链 / 05 账户余额 / 99 回滚） |
| `../tests/influence-recalc-engine.test.ts` | **交叉验证闸**：engine 与运行期 `home.ts` 逐位对拍（17 测试） |

---

## 1. 口径（为什么这么算）

- 影响力 =（`shell_influence` + Σ球员影响力）× 级别系数 + `bonus_points`；级别系数 `premier 1.2 / second 1.0`（`influence_tier_coefs`）。
- 级别真源 = **报名派生**（`season_tournaments` + tour `entry`），不是图值里写的级别；plan 阶段已断言 16/16 与图值一致。
- 上座 = `fans × 乘数(4.0×(1+0.35×档位)) × 档位系数 × form × wx × 对手系数 × next_attendance_mod × perturbation`；需求 ≥ 容量时取 `floor(容量 × fill)`。
- 收入：`ticket = 上座/万 × 1.5`；`commercial = 上座/万 × 0.1 × 商设等级`；`broadcast = 0.3 × 播设等级`；三者各自与 total 均四舍五入到 2 位（生产设施全 0 级 ⇒ 本批 commercial/broadcast 恒为 0）。
- 死忠：每场走 **per-match 系数**（`fans_grow_rate_per_match` / `fans_drop_rate_per_match`，生产未配置 ⇒ 出厂默认 0.2/0.2；B 段已定义），**不消费** `fan_mood`。
- 关窗收尾：按 B 段「本窗有主场的队不再演化」防双记账；生产 16 队**全部有主场** ⇒ `fans` = 窗末值、`fans_window_start` = 窗末值。
- **重演取期望而非复现历史随机**：`perturbation` 取 [0.97,1.03] 中点 1.0、`sell_out_fill` 取 [0.985,0.999] 中点 0.992、`wx` 取该天气区间中点；**天气不重掷**，直接用 `match_attendance` 已记录的 weather 值。因此新值与旧值不是同一组随机数下的对照，个别场次可能略低于旧值（见 §4）。
- form 按「**本场确认那一刻**」可见的历史算（`result_confirmations.id < 本场 RC id`）：`results.ts` 是「先 INSERT RC 再跑钩子」，而 `autoConfirmResults` 按 `finished_at` 顺序逐场确认 ⇒ RC id 序就是真实确认/演化序。运行期天然满足该视图，重演必须显式切时间面。
- 对手系数用**新**影响力（主客两侧都按新公式）；客队是 CPU 队（无 stadium 行）⇒ `default_influence = 90`。
- 账本「**重记替换**」：按 `kind='revenue' AND ref_type='match' AND ref_id=<match_id> AND club_id=<club_id>` 定位那一场的一条流水，**直接改 amount + memo + balance_after**，不冲销、不新增行；其余流水金额一律不动，只按入账序重放 `balance_after`；`ledger_accounts.balance` 写链末值。
- `balance_after` 用**裸 binary64** 累加（生产里本来就存在 `31.759999999999998` 这类值），**不做 2 位四舍五入**，否则 verify 逐位对不上。

### 图值来源与待补

- 图值由用户 2026-10-04 拍板（20 队 = 级别 / 队壳影响力 / 奖励分），写在 `values.json`。
- `bonus_points` 为空的队（诺丁汉森林 14、RB莱比锡 112172）按 **0** 处理。
- **皇家马德里（club 243）的奖励分在图值里被截断** ⇒ 缺 `--allow-missing` 时 `plan` 直接中止并报「243 奖励分待用户补值」；带 flag 时按 0 处理并在 `report.md` §3 显著标注（该队影响力/死忠/上座会**偏低**，补值后必须重跑本批）。
- 4 支 CPU 队（10 / 241 / 112172 / 131681）**不写库**，只做与 `src/worker/routes/admin/clubs.ts:25` 的 `CPU_SEED_PRESETS` **逐字一致性断言**（不一致则中止）。

---

## 2. 前置条件与执行顺序

1. **迁移 0062 必须先 apply**：本批 `01` 会写 `stadiums.fans_window_start`，而快照显示生产**还没有这一列**。没有该列且未加 `--assume-migrated` 时 `plan` 直接中止。
2. **先上线 v6.28.0 代码（A/B 段）再执行本批**：本批把历史重记成新公式的值；代码未上线时管理端/公开面仍按旧公式解读这些数据，且新比赛的钩子仍按旧口径写库。
3. `snapshot`（只读）→ `plan`（离线）→ **人工复核 `report.md`** → `apply --yes`（先备份 + 落 marker）→ `verify`（只读守恒断言）。
4. 243 补值后重跑（`UPDATE` 是绝对赋值，可重复收敛；也可先 `99-rollback.sql` 再重跑）。

---

## 3. 四步命令

```bash
cd <repo>

# ① 只读快照（会写 snapshot.json，不碰生产数据）
node scripts/prod-20261004-influence-recalc/recalc.mjs snapshot

# ② 离线计划（纯本地计算，出 plan.json / report.md / sql/）
node scripts/prod-20261004-influence-recalc/recalc.mjs plan \
  --assume-migrated --allow-missing        # 只用于"0062 未落地时先看数"

# ③ 执行（默认只打印；必须显式 --yes 才会跑 wrangler）
node scripts/prod-20261004-influence-recalc/recalc.mjs apply --yes

# ④ 只读回读校验（FAIL 时 exit 2）
node scripts/prod-20261004-influence-recalc/recalc.mjs verify
```

- flags：`--account`、`--token`（否则依次读 `WRANGLER_OAUTH_TOKEN` → wrangler 配置）、`--allow-missing`（243 按 0）、
  `--initials=default|prod`（初值一律 1800 / 用生产现值）、`--assume-migrated`（仅离线看数）、`--yes`、`--force`。
  参数支持 `--name=value` 与 `--name value` 两种写法，**推荐一律用 `=`**（早期版本空格形式会被静默忽略，已修）。
- `apply` 行为：无 `--yes` 只打印将要执行的 SQL；有 `--yes` 时先把 `stadiums / match_attendance / ledger_entries / ledger_accounts` 全量导出到 `backup/<ISO时间戳>/`（含 `manifest.json`），再逐文件 `npx wrangler d1 execute whl-club --remote --file=<abs>`，成功后落 `applied.marker` 并自动跑一次 `verify`。
- **防重**：`applied.marker` 存在时 `apply` 直接中止，需 `--force`。
- SQL 文件里**不写 `BEGIN/COMMIT`**（沿用仓内既有 apply 模式，`wrangler d1 execute --file` 逐文件提交）。

---

## 4. 离线干跑实测（只读，2026-10-04）

口径 `--initials=default`（fans 初值一律 1800），除「0062 未 apply」「243 待补」两条 FAIL 外，其余 **17 项断言全 PASS**（含空表断言、窗口 1 行、16 队 stadium 齐、CPU 4 队无 stadium 行且与 `CPU_SEED_PRESETS` 逐字一致、级别派生 16/16、生产账本链 210 行自洽、守恒断言 ①-⑥⑥b）。

**联盟合计**

| 指标 | 旧 | 新 |
| --- | --- | --- |
| fans（16 队） | 28800 | **52024.14349594394** |
| 上座 | 699921 | **972885** |
| 比赛日收入 | 104.96 | **145.96** |
| 账本总额 | 919.16 | **960.16**（+41.00） |

- `fans` 窗末 min/max：**1968.02 / 4600.97**；窗末 `fans_window_start` 同值。
- 每场系数实际取值：`growRate 0.2 / dropRate 0.2`；级别系数 `{premier 1.2, second 1.0}`。

**异常显著项（重点复核，未自行改图值或口径）**

- **14 场需求 ≥ 容量，走 `sell_out_fill`**：如 #10 曼联 21824/22000、#53 慕尼黑1860 11904/12000、#58 曼联、#13 皇家马德里。#27 佛罗伦萨 21824/22000、#21 里昂 11904/12000、#22 阿斯顿维拉 11904/12000、#25 慕尼黑1860 11904/12000 等。
- **19 场上座 > 旧值 1.5 倍**（新影响力把顶级队的需求推得很高，多数被容量截断成"满座"）。
- **仅 2 场略低于旧值**：`#32 13186 → 13157`、`#38 12927 → 12735`——旧值当时抽到 `fill ≈ 0.999`，重演取中点 0.992 的结果，属预期内。
- 余额差额最大的队：利物浦 +6.68、曼联 +6.55、巴黎 +4.03、切尔西 +3.38。
- **未发现"爆容量"超界**（78 场全部 ≤ 容量，含 fill 口径，旧值对照同样 ≤ 容量）。

**`--initials=prod` 口径对照**（用生产现值作初值，仅 4 队不同：11=1764、21=1782、45=1836、73=1872）

| 指标 | default | prod |
| --- | --- | --- |
| fans | 28800 → 52024.14349594394 | 28854 → 52055.92445978304 |
| 上座 | 972885 | 974607 |
| 比赛日收入 | 145.96 | 146.22 |
| 账本总额 | 960.16 | 960.42 |

prod 口径下 4 队的窗末 fans：曼联 4410.9 / 拜仁 2590.52 / 尤文 3323.98 / 巴黎 3961.38。

> **口径取舍说明**：任务要求「S9 W1 初值一律 1800」，所以**留档产物用的是 default 口径**（`plan.json` / `report.md` / `sql/` 当前均为 default）。

---

## 5. 回滚

- `sql/99-rollback.sql`（320 条语句）按 `snapshot.json` 把四张表**逐行还原**（stadiums 取值、match_attendance 上座/收入、ledger_entries 金额+memo+balance_after、ledger_accounts 余额），可反复执行。
- `apply --yes` 前已自动落 `backup/<ISO时间戳>/` 全量 JSON 备份 + `manifest.json`；两条路都可用，`backup/` 更贴近"执行那一刻"的真值。
- 恢复后建议跑一次 `verify`（会报 plan 与实际不一致，属正常）或直接对比 `snapshot.json`。
- 二次执行：删掉 `applied.marker` 或用 `--force`（`UPDATE` 绝对赋值 ⇒ 收敛到同一结果）。

---

## 6. 已知近似与限制

1. **重演取期望而非复现历史随机**（见 §1），因此新旧不是同随机数对照；个别场次受 `fill` 中点影响略降。
2. **初值与生产现值的差异**：生产 4 队 fans 非 1800（11=1764、21=1782、45=1836、73=1872）来自导入工件 `scripts/revenue-import/stadium-import-prod.sql` 的原文，**不是**旧口径关窗演化的结果；任务口径仍从 1800 全部重演，差异见 §4 对照表。
3. 生产配置表只有 3 个无关键（`fc26_pa_cap` / `shop_hpremium_clubs` / `shop_prices`）⇒ `attendance_model`、`tier_table`、`influence_tier_coefs`、per-match 系数**全部走出厂默认**；脚本打印的是实际取值。
4. 生产 `match_weather` / `naming_contracts` / `event_occurrences` / `venue_bookings` 均为空 ⇒ wx 无预报、`fansBuff = 0`、无档期活动乘数、关窗无事件中性项。若执行前出现行数据，`snapshot` 会直接中止。
5. 账本里**没有任何 maintenance 流水**（关窗批未产生），本批不补记（口径外）。
6. 边界（不做）：对赌奖金追溯、CPU 队历史收入、赔率/竞猜。
7. 4 支 CPU 队历史主场从未入账（无 stadium 行 ⇒ 钩子跳过），不在重演范围；96 场 RC 中 78 场有收入行，差额 18 场即 CPU 主场。

---

## 7. 交叉验证测试（交付子代理自证）

```bash
npx vitest run tests/influence-recalc-engine.test.ts   # 17 passed
npx tsc -p tsconfig.tests.json --noEmit                # 类型干净
```

覆盖：①`attendance_model` 镜像**双向键集合相等 + 逐键相等**（防日后新增因子漏搬）＋ tier_table / influence_tier_coefs / per-match 系数对拍；②纯函数矩阵（`abilityTier` 边界含 null、`playerAbilityLevel`、`playerInfluenceSum` 对库内实算、`diehardTarget` 0..600 全扫含 120/160/200 阶梯、`evolveFans` 10080 组合逐位相等、`formPtsOf`/`rollWeather`/`uniform`/`asRange`）；③钩子级场景 A-E（晴/premier/3 胜、雨/second/3 败+青训 3、雪/premier/中性+冠名口碑 buff 0.005+带球员、多云/premier/容量 3000 爆仓、多云/second/掉粉侧）+ 容量 0 退化场，断言 `attendance/ticket/commercial/broadcast/流水 amount/stadiums.fans` 全部 `toBe`；④`formPtsBefore` 时间切面；⑤关窗两条分支 + `fan_mood` 修正。

踩过的坑（改测试时注意）：`engine.mjs` 的相对路径是 `../scripts/...`（从 `tests/` 出发）；容量 0 场景 engine 必须**显式**传 per-match 系数 0.2（否则走窗系数 0.5）；想测「钳回 0」必须给 `dropRate: 1`（默认 0.5 时 coef ≤ 0.9 算不出负数）；`formPtsOf` 里**弃权场次也占 3 场名额**（胜 3 + 平 1 + 弃权负 0 = 4 分）。

---

## 8. 相关真源（改口径时同步改这里）

- 上座/收入/每场演化/关窗：`src/worker/home.ts`（`matchAttendanceStatements`、`evolveFans`、`diehardTarget`、`windowHomeStatements`）
- 账本：`src/worker/ledger.ts`（`ledgerMovement`）· 迁移 `src/db/migrations/0018_home.sql`、`0062_*.sql`（`fans_window_start`）
- 配置出厂默认：`src/core/config.ts` · 级别派生：`src/worker/tier.ts` · CPU 图值：`src/worker/routes/admin/clubs.ts:25`
- 既有同形态脚本：`scripts/prod-20260926-audit-origin-backfill/`（precheck/backfill/verify/rollback + README）
