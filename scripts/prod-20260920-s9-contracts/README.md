# S9 一线队合同导入（数据源 `E:\Downloads\一线队-S9.csv`）

> **状态：未执行。** 等生产写令（`scripts/README.md` 纪律：写生产需明确指令，一次授权不延续）。
> 前置批：`scripts/prod-20260920-s9-window-baseline/`（季初窗 seq=1 已关、中期窗未开，已于 2026-09-20 执行）→ **`scripts/prod-20260920-s9-club-align/`（已于 2026-09-21 执行完毕：570 人队籍已按 s901 对齐，含 4 支 CPU 队）**。
> 本文档是计划书，不含可执行 SQL；工件（`gen-contracts-sql.ts` + SQL 分片）待许可后产。
>
> ✅ 队籍对齐批跑完后，本文档 §5 的「84 行异队冲突」已全部归零（那些球员的平台队籍现在就是对齐的目标），16 人控队 **462 行全部可导入**（实测全库入籍 874 = 570 s901 对齐 + 304 遗留）。

## 1. 要做什么

用户指令：依照 `E:\Downloads\一线队-S9.csv` 导入现有 **16 支人控队**的合同。

## 2. 现场快照（2026-09-20 只读实测）

| 项 | 值 |
| --- | --- |
| 生产 `contracts` | **0 行** |
| 生产 `clubs` | 20（16 人控 + 4 CPU：`10` 曼城 / `241` 巴塞罗那 / `112172` RB莱比锡 / `131681` AC米兰，表名带 `(CPU)` 后缀） |
| 16 人控队队籍人数 | 444（`prod-20260919-roster-backfill` 已执行） |
| CSV 有效球员行 | 734（判定规则：第 5 列为 5–6 位纯数字；24 组队名 = 23 俱乐部 + 「在解约」池 73 人） |
| CSV ↔ 生产 `players` | **734/734 命中**（按 `fc_id` 匹配，无一人缺失） |

## 3. 硬前置（顺序不能反）

1. **迁移 `0028_contract_window_ticks.sql` 必须已 apply**：`contracts.service_ticks` / `contracts.protection_ticks` 是增量 25 新增列，未 apply 时写不进去（`no such column`）。
2. **增量 25 的 worker 必须已部署**：未部署时线上 `upsertContractStatement`（`src/worker/contracts-import.ts:185-213`）的 INSERT 不含刻度列，先导的合同会在 0028 apply 后落 DDL 默认值 `service_ticks = 0` / `protection_ticks = NULL`（= **无保护期**，语义错）。
3. **窗基线批先执行**：`windowBaseTicks(db, effective_from)` 数的是「`closed_at <= effective_from` 的已关常规窗」。基线的季初窗 `closed_at = 2026-09-18T01:01:00.000Z`，故 `effective_from >= 2026-09-18` 的合同基数 = 1 tick。
4. **队籍对齐批先执行**（建议顺序：窗基线 → 队籍对齐 → 合同）：`classify` 规则②会把「球员现属队 ≠ 目标队且非 CPU」判为错误（`src/worker/contracts-import.ts:82-152`）。对齐后这 84 行变成普通 `create`，16 队 462 行零冲突。若不做对齐，只能按 §6-② 跳过 84 行。

## 4. 映射规则（CSV → 通道 C 五列）

通道 C 只吃 5 个字段（`web/src/lib/imports.ts:8`：`uid / releaseFee / wage / effectiveFrom / contractType`）。

| 目标列 | 来源 | 规则 |
| --- | --- | --- |
| `uid` | col5 ID | `fc{ID}`（后端 `/^(?:fc)?(\d+)$/i`，`src/core/import.ts:287`） |
| `releaseFee` | col19 违约金 | 整数 1–80 直填；「训练营」字样行 → `5`（`TRAINEE_RC`，`src/core/squad-rules.ts:7`）；`>0 && <=1000` 才过 |
| `wage` | col20 工资 | trim 后直填（0.25–10.01）；「训练营」/「海捞训练营」→ `0.75`（`TRAINEE_WAGE`，`src/core/squad-rules.ts:6`）；`0–100` 才过 |
| `contractType` | col19/col20 判定 | 含「训练营」字样 → `trainee`；其余 → `formal` |
| `effectiveFrom` | **待裁决** | 见 §6-④ |

### 训练营类行实测（93 行）

- 85 行：违约金列与工资列**都**写「训练营」。
- 7 行：工资列 `海捞训练营`、违约金列 = 5（巴黎 1 / 里昂 4 / 拜仁 2）——**全部落在 16 队内**。
- 1 行：布鲁日 id `79399`（工资列「训练营」、违约金 5）——布鲁日在平台无 club 行，本批不导。

⇒ `trainee` 语义与平台硬约束天然吻合（wage 0.75 / RC 5），映射无歧义。落在 16 队内的训练营行 **63 行**（其余在：在解约 13 / 布鲁日 4 / 牛津联 3 / 国米 2 / 巴萨 6 / AC米兰 2）。

### 原始 CSV 不能直接喂

- 工资列非数值 **94 行**（93 行训练营字样 + 1 行畸形 `*2.10`：慕尼黑1860 id `204525` Iñigo Martínez）；违约金列非整数 **85 行**。原样喂会被逐行挡（「违约金 RC 须为 0-1000 之间的数值（m）」「工资须为 0-100 之间的数值（m/半赛季）」）。
- 5,523 处尾随空格（工资 640 处），解析前必须 trim。
- 效力年（col27）空 2 行（两行都在佛罗伦萨），本批按 0 赛季处理。

## 5. 分类预测（按 `classify` 真实规则离线重算，`src/worker/contracts-import.ts:82-152`）

| 队（目标 club id） | CSV 行 | 异队冲突 | claim | create | 可导入 |
| --- | --- | --- | --- | --- | --- |
| 阿森纳 (1) | 30 | 3 | 24 | 3 | 27 |
| 阿斯顿维拉 (2) | 30 | 9 | 13 | 8 | 21 |
| 切尔西 (5) | 31 | 2 | 16 | 13 | 29 |
| 利物浦 (9) | 37 | 7 | 25 | 5 | 30 |
| 曼联 (11) | 25 | 5 | 15 | 5 | 20 |
| 纽卡斯尔联 (13) | 23 | 6 | 13 | 4 | 17 |
| 诺丁汉森林 (14) | 23 | 6 | 16 | 1 | 17 |
| 拜仁慕尼黑 (21) | 37 | 4 | 30 | 3 | 33 |
| 慕尼黑1860 (33) | 26 | 5 | 21 | 0 | 21 |
| 尤文图斯 (45) | 31 | 5 | 15 | 11 | 26 |
| 里昂 (66) | 31 | 10 | 20 | 1 | 21 |
| 巴黎圣日耳曼 (73) | 29 | 6 | 17 | 6 | 23 |
| 皇家马德里 (243) | 23 | 4 | 12 | 7 | 19 |
| 奥林匹亚科斯 (280) | 30 | 1 | 27 | 2 | 29 |
| 皇家贝蒂斯 (449) | 25 | 4 | 13 | 8 | 21 |
| 佛罗伦萨 (110374) | 31 | 7 | 21 | 3 | 24 |
| **16 队合计** | **462** | **84** | **298** | **80** | **378** |
| （含 CPU）曼城 (10) | 28 | 1 | 27 | 0 | 27 |
| （含 CPU）巴塞罗那 (241) | 29 | 7 | 22 | 0 | 22 |
| （含 CPU）RB莱比锡 (112172) | 26 | 12 | 14 | 0 | 14 |
| （含 CPU）AC米兰 (131681) | 25 | 5 | 20 | 0 | 20 |
| **20 队合计** | **570** | **109** | **381** | **80** | **461** |

- 无目标队 **164 行**：布鲁日 28 / 国际米兰 26 / 牛津联 37 / 在解约 73（平台无这些 `clubs` 行）。
- claim 的来源：自由身 `club_id IS NULL` **261 人**、从 CPU 队挖走 **37 人**（`241` 巴萨 12 / `10` 曼城 11 / `112172` RB莱比锡 9 / `131681` AC米兰 5）。
- **没有任何一队能零冲突整队导入**（最少 1 行）。根因：CSV 是联盟自己在游戏里转过会的世界，平台 `club_id` 是 EA 原始队籍 + roster-backfill。样例：CSV 把 Kane 放 AC米兰、Mbappé 放利物浦，平台分别在拜仁、皇马。

**队籍对齐批跑完后的分类（已裁决路径）**：570 行 CSV 的队籍与 s901 完全一致（570/570），对齐后 16 队 462 行的 `club_id` 已等于目标队 ⇒ `classify` 全判 `create`（无冲突、无 claim），**16 队 462 行全可导**（原本 378 = 298 claim + 80 create）。两种路径写出的 `contracts` 行完全相同（`claim` 与 `create` 只是 `players.club_id` 认领分支的差别，合同字段同源同值）。

## 6. 裁决点

**① 导入范围**
- A（推荐）：只导 16 人控队，378 行。
- B：含 4 支 CPU 队，461 行。
- 影响：B 会额外给 CPU 队建合同，且让 CPU 队球员有工资支出（CPU 队不入账逻辑见增量 11 口径），本批指令只说「16 队」。

**② 84 行异队冲突怎么处置 —— 已裁决：先跑队籍对齐批**
- **已选（2026-09-20）**：单开 `scripts/prod-20260920-s9-club-align/` 按 s901 对齐 570 人队籍，排在合同批之前；对齐后本批 462 行零冲突全可导（见 §5 末段）。这正是「先队籍对齐、再合同、后能力」顺序的来源。
- 备选（若不做对齐）：跳过 84 行只导 378 行，或逐条人工核对。

**③ 164 行无目标队（布鲁日 / 国际米兰 / 牛津联 / 在解约）**
- A（推荐）：本批不导。
- B：先在平台建这 3 支俱乐部（+「在解约」池的处置口径），再导——那是另一个批。

**④ `effectiveFrom` 与「效力年」口径（金额敏感）**

CSV 有 `效力年`（col27，分布：0→232、0.5→16、1→85、1.5→170、2→113、2.5→116、空 2），这是球员在现队的真实效力赛季数。平台表达为 `service_ticks`，当前刻度 = **1 tick**（基线季初窗已关），效力赛季 = `round2((1 - service_ticks) * 0.5)`。

- **通道 C 表达不了历史效力**：导入只能落 `service_ticks = closedRegularTicks(effective_from)`，即选 `effective_from = 2026-09-17`（窗关前）得 0 tick → 效力一律 **0.5 赛季**；选窗后得 1 tick → 效力 0。
- 要还原 CSV 的效力年，必须**另写定向 SQL**：效力赛季 `E` → `service_ticks = 1 - 2E`（效力 0 → 1；效力 2.5 → -4），`protection_ticks = service_ticks + 3`。
- **为什么金额敏感**：解约满 3 赛季（6 ticks）免费（`src/core/bypass-rules.ts:52-57`）。统一按 0.5 赛季导入 ⇒ 399 名「效力 ≥1.5 赛季」的球员解约成本被大幅高估（本该已可自由走人）；保护期也一并变长。
- 推荐：**generator 直接算 `service_ticks = 1 - 2 * 效力年`**（效力年空的 2 行按 0 处理），不依赖通道 C 的 `effective_from` 推导；`effective_from` 仍按 CSV 口径落一个值（见下），只用于展示。

**⑤ 执行通道**
- A（推荐）：**离线 SQL 工件**。理由：(a) 通道 C 表达不了效力年；(b) 生产导入要走管理端点，需要 admin OIDC 会话 + 逐队 16 轮预览/确认；(c) 仓库既有生产批全是 SQL 工件（合同导入没有离线先例，但 upsert 语句文本可以像 `scripts/players-import/generate-sql.ts:62-81` 那样用假 DB 捕获，与生产函数逐字节同源）。
- B：走通道 C 网页导入（16 轮）+ 一条补齐刻度的定向 UPDATE。好处是走产品路径、有 audit；代价是两步且要会话。

**⑥ 是否写 `audit_log`**
离线 SQL 不写 audit（`prod-20260919-*` 批的惯例是靠 README 记录）。要留痕可另插一条 `action = 'contracts_import_offline'`。

## 7. 执行步骤（推荐方案，许可后产工件再执行）

1. 产工件：`gen-contracts-sql.ts`（读 CSV → 按 §4 映射 + §5 分类 → 产 SQL 与报告）。
2. 报告里逐行列出：目标队 / 分类（claim|create|skip-冲突|skip-无队）/ `releaseFee` / `wage` / `contractType` / `service_ticks` / `protection_ticks` / `effective_from`。
3. 执行前复查（只读）：`contracts` = 0 行、`season_windows` 有 1 条已关常规窗、`0028` 已 apply（`PRAGMA table_info(contracts)` 含 `service_ticks`）。
4. 执行 `01-contracts-16.sql`（含 claim 的 `UPDATE players SET club_id`）。
5. 跑 `02-verify.sql`。

**执行命令纪律**（`scripts/README.md` 第 66 行）：含外键或大事务的工件必须走 `--command` 或 D1 REST `/query`，`--file` 会让 `PRAGMA defer_foreign_keys` 失效。本批 `contracts.club_id REFERENCES clubs(id)`，属含外键。
预期写入量：378 行合同 + 298 行球员队籍 ≈ 4 条索引 × 676 ≈ **约 2.7k rows_written**（免费档 10 万/天，安全）。

## 8. 验收

```
SELECT COUNT(*) FROM contracts;                              -- 期望 378（或 461）
SELECT source, COUNT(*) FROM contracts GROUP BY source;      -- 期望 import 378
SELECT COUNT(*) FROM contracts WHERE service_ticks IS NULL;  -- 期望 0
SELECT COUNT(*) FROM players WHERE club_id = 10;             -- 期望 26-27（被挖走 11 后）
SELECT COUNT(*) FROM contracts WHERE protection_ticks IS NULL AND contract_type = 'formal';  -- 期望 0
```

## 9. 回滚

```sql
DELETE FROM contracts WHERE source = 'import';
-- 队籍回滚需事先存 claim 行（player_id + 原 club_id）快照，见工件 README
```

## 10. 风险

- **保护期语义**：`protection_ticks = service_ticks + 3`，效力越老保护期越早结束（效力 2.5 → `protection_ticks = -1` → 已无保护期）。这是增量 25 的既有口径，符合直觉。
- **认领会改变 16 队人数**（+378 行里的 298 人来自自由身池与 CPU 队）。导入后建议跑一次报名体检（`initialCa = base_ca ?? ca`，`src/core/squad-rules.ts:17-20`）。
- **CSV 与 roster-backfill 的口径冲突**：roster 按 EA 队籍灌 444 人，CSV 是联盟转会后的世界；本批只补合同，不解决谁权威。
- **`releaseFee = 0` 与文案不一致**：后端要求 `>0`，文案写「0-1000」，CSV 无 0 值，不受影响。
