# 生产批 · 2026-10-11 S9 天气订正（权威天气/系数回填 + 已结算上座与收入重算）

## 1 缘起与范围

用户令（原文）：

1. 「天气真源改为插件 → 平台，粒度是天气类型 + 系数。」
2. 「回填时，如果缺少系数，则在天气档内重随，注意重算顺序。」
3. 「已结算的错误历史账，两侧都订正。」
4. 「不要我手动触发重算 —— 插件侧一条命令全量自动（含自家冲正），平台侧一次授权全量一批（不逐轮）。」

范围：生产库 `whl-club`，S9 窗 1 全部有 `match_attendance` 行的 **90 场**（含 5 场已被弃权批清零）。

**前置条件（本批 SQL 不能先于它们生成）**：

| 前置 | 版本 | 作用 |
| --- | --- | --- |
| 平台端点 `POST /api/internal/weather-sync` | v6.44.0 | 接收插件推送，写 `match_weather`（`forecast_by='revenue-plugin'`） |
| 平台 env `WEATHER_SYNC_SECRET` | — | 与 `TEAM_SYNC_SECRET` **分开**的一把钥匙；未配 = 503 fail-closed |
| 插件 `/主场天气推送` | v2.12.0 | 补抽缺失系数 → 推送平台 → 冲正插件自家已结算账（`revenue_transactions`） |

推送前本批**只出盘点**（`inventory.json`），推送后才出订正 SQL（`sql/02*`、`rollback/`、`report-data.json`）。

## 2 口径

### 2.1 为什么要订正（这是「输入差异」，不是「算错」）

两侧各掷各的随机：平台 `src/worker/home.ts` 结算时内联 `rollWeather` + `uniform(range[weather])`，插件 `services/formula.py` 同构但独立掷。同一场比赛两边抽到的天气类型与系数不同 ⇒ 上座与比赛日收入不同。

可证的差异只有两处：

- **天气类型**：`match_attendance.weather` 是平台结算时固化的类型（`0018_home.sql:33`），与插件权威类型逐场可比。
- **系数**：平台侧**无处可查** —— 预检 B 段 `match_weather` 全库 **0 行**，S9 全部 90 场都是内联现掷，那一掷的值没有落任何地方。⇒ 只能从结果反推，故分两档（§2.2）。

### 2.2 两档重算（exact / estimate）

**exact（精确重算）** —— 靠 `scripts/prod-20261004-influence-recalc/` 留下的 `plan.json`：

那批（2026-10-04）用**期望口径**重写过 S9 窗 1 的 78 行（`README.md:34-40`：perturbation 取中点 1.0、`sell_out_fill` 取中点 0.992、`wx` 取该天气区间中点、天气不重掷），`plan.json.matchPlans[]` 逐场留了**未截断的原始需求** `factors.demand = K0 × mid(w_p)` ⇒ **K0 已知**。这批只 `UPDATE match_attendance` 不 `INSERT`（`recalc.mjs:700-704`）⇒ 行还在，`created_at` 保留原值。

判据（三者同时成立才入 exact 档）：① 计划行天气 == 库中天气；② 计划 `after.attendance` == 库中上座；③ 计划行确实是中点口径（`factors.wx == mid(range[weather])`）。本批实测 **72 行**可精确重算（78 − 5 弃权清零 − 1 计划文件天气字段损坏，逐条见 `inventory.json.planRowNotes`）。

重算：`demand_new = K0 × coef_a`，`A_new = demand_new >= capacity ? floor(capacity × 0.992) : floor(max(0, demand_new))`。误差 = 两次 floor 的取整差 ⇒ **≤1 席**。

**estimate（期望中性归一）** —— 其余行（12 行是 2026-10-07…10-11 实时结算的，不在计划里；1 行计划文件损坏）：

```
A_new = round( A_old × coef_a / mid(range[w_p]) )
```

理由：平台那一掷 `A_old = K × wx_p × ε_p`，`E[A] = K × mid(range)`，把未知的 `wx_p` 归一到区间中点后乘上权威系数。残余 = `(wx_p/mid) × ε_p − 1`：`wx_p` 在区间内均匀 ⇒ 上界 = 半宽/中点 + 3%（扰动），最宽的是晴 `[1.05,1.25]` ⇒ **±8.7% + 3% ≈ ±12%**（其余类型更窄：多云 ±7.2%、雨 ±5.3%、雪 ±2.6%）。

**满座守卫**：需求 ≥ 容量时上座 = `floor(capacity × fill)`，`fill ∈ [0.985,0.999]` 与天气**无关** ⇒ 天气订正只能让上座**向下**，取 `A_new = min(A_new, A_old)`，另加 `floor(capacity × 0.999)` 封顶。exact 档按 `demand_new` 与容量现比大小（生产 14 场满座里 #69 需求只超容量 4.3%，系数一降就掉出满座，不能硬套 min）。

**不动的东西**：K 里的球迷数、球场容量、设施等级、影响力 —— 这些在结算后被演化过，史实时点状态不可复现（球迷每场确定性演化但依赖当窗起点，见平台 `stadiums.fans_window_start`），本批不重放，只订「输入差异」能解释的部分。

### 2.3 收入与账本

收入**按平台算式重算**，不按上座比例缩放：

```
ticket     = round2(上座/10000 × 1.5)
commercial = round2(上座/10000 × 0.1 × commercial_level)
broadcast  = round2(0.3 × broadcast_level)
```

生产 `club_facilities` 18 队 × commercial/broadcast **等级全 0** ⇒ 商/播恒 0，合计 = `round2(票)`。`config` 表无 `attendance_model` 覆盖（预检 I 段 0 行）⇒ 全用 `src/core/config.ts` 的 `CONFIG_DEFAULTS`。

账本写入形状（与 `src/worker/ledger.ts:29-63` 的 `ledgerMovement` 同形，每场两句相邻）：

- 账户：`INSERT INTO ledger_accounts ... ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance`（**加减，绝不 SET 绝对值**）；
- 流水：`INSERT INTO ledger_entries ... balance_after` = 同批更新后的余额，**追加不回改**（不打断链）；
- 键：`kind='manual_adjust'`、`ref_type='wx_fix'`、`ref_id=matchId`，memo 前缀 `天气订正·match:<id>（…）`；幂等闸 = 同键 `NOT EXISTS`（离线批会被通道拆批，故不用 `changes()>0`）；
- 回滚键：`ref_type='wx_fix_undo'`。

> memo 里**不能用 `|`** —— `exec-shards.mjs` 拒绝含 `" % & | < >` 的语句（经 shell 的 `--command`）。分隔符统一用 `·`、比较用 `!=`、引号只用单引号。

### 2.4 跳过与守卫（逐场顺序）

| 序 | 判据 | 处置 |
| --- | --- | --- |
| ① | 无权威记录（插件未预报该场） | 只报告，进 `uncovered` |
| ② | 上座 0 或收入合计 0（弃权场已被弃权批清零） | 天气类型不一致 ⇒ 只改天气；一致 ⇒ 跳过 |
| ③ | 上座行合计 ≠ 该场 `kind='revenue'`/`ref_type='match'` 流水金额 | 交人工（`anomalies`），不订 |
| ③b | 用旧上座 + 现行设施等级复算旧收入 ≠ 库中收入（逐分） | 交人工 —— 说明等级或配置在结算后漂移过 |
| ④ | `abs(delta) < 0.005` | 跳过（系数归一后无变化） |

写入侧守卫：上座行 `UPDATE ... WHERE match_id = ? AND attendance = 旧值 AND weather = 旧天气` ⇒ 重放 = no-op；账本看锚 ⇒ 重放 = no-op。**02 与 02a 重叠安全**：02a 订过的场次在 02 里守卫不通过，自动 no-op。

## 3 工件表

| 文件 | 内容 |
| --- | --- |
| `sql/01-precheck.sql` | 只读预检 A–I 段（season_tournaments / match_weather / match_attendance / stadiums / club_facilities / result_confirmations / 账本 / config） |
| `capture-snapshot.mjs` | 逐条 `wrangler d1 execute whl-club --remote --json` 抓 A–I ⇒ `snapshot.json` |
| `00-plugin-forensics.sql` | 插件服务器侧取证（用户代跑）：`matches`/`league_state`/`weather` 分布/`wx_coef` 缺失面/已结算轮次 |
| `capture-authoritative.mjs` | 推送后抓 `match_weather WHERE forecast_by='revenue-plugin'` ⇒ `authoritative.json`（0 行 exit 2） |
| `gen-recalc-sql.ts` | 生成器：读快照 + 权威 + `plan.json` ⇒ 全部 SQL + `manifest.json` + `report-data.json`；带 `selfCheck()` 硬断言、`--ts=<ISO>` 固定工件时间戳、`--out=<dir>` 写到别处（只读复核做法：重跑到临时目录比对 sha256） |
| `sql/02-recalc.sql` | **全量收敛**（推荐）：每场 1 句上座行 UPDATE + 2 句账本 |
| `sql/02a-type-only.sql` | **保守子集**：只订天气类型不一致的场次（输入差异 100% 可证），不含「类型一致仅系数不同」的估计档 |
| `sql/03-verify-balance.sql` | 逐队余额 = 基线 + 净变化、`wx_fix` 笔数/合计、`wx_undo` 笔数、`conserve` |
| `sql/03a-verify-rows.sql` | 旧值/旧天气是否已消失（算术编码 `match_id*1000000+attendance`，避开 `\|\|` 连接符） |
| `rollback/01-undo.sql` | 逆序补偿：账户加减 + 反向流水（`ref_type='wx_fix_undo'`），每句带守卫 |
| `sql/manifest.json` | 逐文件 sha256 / 语句数 / 期望 changes |
| `inventory.json` | 推送前盘点（§5） |
| `report-data.json` | 推送后逐场明细（tier/demandNew/新旧上座/新旧收入/差额/满座/类型变更） |
| `report.md` | 方法学 + 逐场明细 + 两侧对账（推送后写） |

## 4 执行顺序

> **执行状态（2026-10-13T01:32Z：①②③④⑤ 全部完成）**：插件 v2.12.0 已部署（服务器 Docker，schema 12→13）、
> 全量推送完成（116 场，平台落库 103，插件自家冲正 23 场 +26.1945）、权威数据已抓（103 行）、
> 工件已生成（`--ts=2026-10-12T11:45:00Z`，自检与分片演练通过）。
> **⑤ 已执行** —— `sql/02-recalc.sql` 237/237 句提交（changes 237 / rows_written 471 / 失败批 0）；
> 复查：18 队余额 = 基线 + 净变化、账本 `wx_fix` 78 行合计 +0.63、守恒位 0、81 场与权威存证逐场一致。
> 执行记录、执行前漂移（match 194）与工件口径订正见 [`report.md`](./report.md) §10。

```bash
# ① 插件侧（用户服务器）：部署 v2.12.0 → 配置 club_sync_url/club_sync_secret → 推送
/主场天气推送 预览      # 只算不写：看缺系数场次、将订正的场次与差额
/主场天气推送           # 补抽落库 + 推送平台 + 冲正插件自家已结算账
#    回执要点：「平台落库 N/M 场」（N>0 才继续）；unmatched / skipped_no_stadium 要点名排查

# ② 平台侧：抓权威数据（本仓）
node scripts/prod-20261011-s9-weather-recalc/capture-authoritative.mjs

# ③ 生成（--ts 固定工件时间戳；补生成必须传回同一时间戳）
#    本批实际用的时间戳（工件已按此生成，重跑可逐字节复现）：
node scripts/prod-20261011-s9-weather-recalc/gen-recalc-sql.ts --ts=2026-10-12T11:45:00Z

# ④ 演练（只读）：分片计划；只读复核 = 重跑到临时目录比对 sha256
node .../exec-shards.mjs scripts/prod-20261011-s9-weather-recalc/sql/02-recalc.sql --remote --dry
node scripts/prod-20261011-s9-weather-recalc/gen-recalc-sql.ts --ts=2026-10-12T11:45:00Z --out=/tmp/wx-regen

# ⑤ 执行（2026-10-13T01:32Z 已执行，用户授权后）
node .../exec-shards.mjs scripts/prod-20261011-s9-weather-recalc/sql/02-recalc.sql --remote --chunk=20 --retry=2
#    合计：已提交 237/237 条，changes 237，rows_written 471，失败批 0
node .../exec-shards.mjs scripts/prod-20261011-s9-weather-recalc/sql/03-verify-balance.sql --remote
node .../exec-shards.mjs scripts/prod-20261011-s9-weather-recalc/sql/03a-verify-rows.sql --remote
```

保守路线（未采用）：把 ⑤ 的 `02-recalc.sql` 换成 `sql/02a-type-only.sql`（只订类型不一致，钱只动可证输入差异那部分）；两者可先后跑，重叠场次自动 no-op。

## 5 推送前盘点（`inventory.json`，快照 `--remote @ 2026-10-12T02:19:36Z`）

| 项 | 值 |
| --- | --- |
| 已结算上座行 | 90（全 `window_seq=1`） |
| 比赛日收入合计 | **162.23** |
| 天气分布 | 晴 29 / 多云 37 / 雨 19 / 雪 5 |
| 已清零行 | 5（全部弃权场：#2 #31 #38 #165 #172，与弃权批 §3.1 一一对应） |
| 满座行 | 20（含 14 场 `floor(capacity×0.992)` = 11904 / 21824） |
| 账实不符 / 缺赛果确认 / 缺球场 / 异常 | 0 / 0 / 0 / 0 |
| 平台预报行（B 段） | **0** ⇒ 平台从未有预报行 |
| 可精确重算 | **72 行**（计划 78 行；6 行不可用 = 5 弃权清零 + 1 计划文件天气字段损坏，见 `planRowNotes`） |
| 其余 | 12 行实时结算（match 73/75/76/77/78/80/83/187/189/190/191/192）+ 1 行损坏 ⇒ 走期望归一 |
| 敏感度（权威系数取遍 0.75–1.25） | 合计 162.23 → 变化区间 **−38.79 … +43.51**（授权参考的最坏上下界） |

收入流水 memo 里留有结算时点的容量与天气（如 `比赛日收入（比赛 #33，上座 9554/22000，雨；票 1.43/商 0/播 0）`），可作历史容量旁证；48/90 笔 `created_at` 集中在 `2026-09-20T05:45`（批量回填），其余分散到 2026-10-11（实时结算）。

## 6 两侧对账口径

订正后两侧**不会逐分相同** —— 平台重算与插件冲正各自重抽扰动 `perturbation`、满座 `fill`（`home.ts:391-392` / 插件同构），这是设计如此（用户裁决：两侧各自掷各自结算，要收敛需两侧都冲正）。对账口径：

1. **输入一致**：天气类型 + 系数逐场相同（平台 `match_weather.forecast_by='revenue-plugin'` vs 插件 `matches.weather/wx_coef`）；
2. **量级一致**：`|A_平台 / A_插件 − 1| ≤ 12%`（estimate 档理论残余上界）或 `≤ 1 席`（exact 档）。

插件侧导出走 `00-plugin-forensics.sql`（用户代跑）。

## 7 执行器通道纪律

`exec-shards.mjs`（自 `scripts/prod-20261006-s9-walkover-fix/` 复用）：

- 用法 `node exec-shards.mjs <sql> --remote [--chunk=20] [--dry] [--retry=N]`；不带 `--remote` 默认 `--local`；
- **单条语句 > 4000 字节 exit 3**；语句含 `"` `%` `&` `|` `<` `>` exit 3 ⇒ 本批 SQL 不用 `||`、不用双引号、memo 不用 `|`；
- `--retry` 只对带守卫、重放 `changes=0` 的工件安全；
- 只读取值逐条走 `npx wrangler d1 execute whl-club --remote --json --command "SELECT …"`（`--file` 只回汇总）。

## 8 回滚（未使用，保持备用）

```bash
node .../exec-shards.mjs scripts/prod-20261011-s9-weather-recalc/rollback/01-undo.sql --remote --chunk=20 --retry=2
```

逆序补偿（每场两句：账户按差额加减 + 反向流水 `ref_type='wx_fix_undo'`，memo 指回原笔；另含 3 场只改天气的还原，共 237 句）；上座行写回旧值（守卫看本批写入后的值）。原流水一律保留 —— 删流水会打断 `balance_after` 链（仓内先例 `scripts/prod-20260926-rollback-stadium-expand/`）。
