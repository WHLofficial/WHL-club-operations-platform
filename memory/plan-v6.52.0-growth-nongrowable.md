# 计划 · 非成长球员不计成长 XP（数据照收）（v6.52.0）

## 0. 用户拍板

- **m06019**：「1growable = 0，2后者，3非成长的xp清零，给我计划」⇒ 判定口径 = `growable = 0`；**从源头挡**；存量 XP **清零**。
- **m06100（更正）**：「不，是非成长不计XP，但数据仍然接收，因为有别的功能要用这些数据」
  ⇒ **不是禁行、不拒收**：录入台的录入照收（事件行照写、value 照存），只是**不计 XP**。上一版计划里「行内禁行 + 后端 400 拒收 + OCR 跳过」作废。
- **用户最新追加（本次修订）**：**三类结算也过滤** —— 训练营 / 中国计划 / 里程碑在查询层加 `growable` 过滤，非成长球员不再产生这三类事件行。原「事件照写、xp=0」方案作废。
- **本次修订（2026-10-19）**：迁移号 `0076` → **`0077_growth_nongrowable_reset.sql`**（`0076` 已被 v6.51.10 的 `0076_growth_events_match_ref_index.sql` 占用并已 apply 生产）；本轮仍只交付计划，代码/迁移待令。
- **§9.9 已定案（2026-10-19 用户裁决）**：改值重放保持现状（当前非成长跳过 replay；当前可成长仍按现有 `replayEventChain` 正常重放）；`loadCumulativeBases` 仍按全部历史 `value` 求和。进球/助攻的单事件 XP 与里程碑 XP 两条路径都已覆盖（单事件走主闸归零，里程碑走查询层过滤）。
- 本轮交付 = 计划（本文件）；代码/迁移待令。

---

## 1. 现状（只读，已实测）

### 1.1 XP 是真入账，且升级链无闸门

- **唯一落库点**：`recordGrowthEventStatements`（`src/worker/growth.ts:140-157`）= UPDATE `players SET growth_xp = growth_xp + ?`（带 NOT EXISTS 幂等闸）+ INSERT `growth_events`（`ON CONFLICT (player_id, match_ref, event_type) DO NOTHING`）。**全程无 `growable` 判定**。便捷封装 `recordGrowthEvent`（`:160-163`）；解约划断 `growthResetStatements`（`:170-180`，`eventType='reset'`、xp=0）。
- **7 条 XP 来源**：①录入台批量 `src/worker/routes/admin/growth.ts:687-714` → `:775`；②单人补录 `POST /growth/events`（`:127-175`）；③自动钩子 `src/worker/results.ts:700`（含 `retryUnresolvedResults` 重放）；④训练营固定 XP（`src/worker/growth.ts:320-326`，`JOIN contracts … contract_type = 'trainee'`）；⑤中国计划（`:346-352`，`t.china_plan = 1`）；⑥里程碑（`:388-399` 按 `growth_events` 的 goal/assist 汇总 + `:404-413` 补发）；⑦改值重放差额（`src/worker/routes/admin/growth.ts:793-805`，`UPDATE players SET growth_xp = growth_xp + ?`，**独立于落库点**）。
- **本次修订后的分工**：④⑤⑥ 在**查询层过滤**（§4.3）—— 非成长球员根本不会被扫到，连事件行都不产生；①②③⑦ 仍走 §4.1 主闸「事件照写、`xp=0`」。主闸同时是所有路径的兜底。
- **升级链无闸门**：`applyLevelUp`（`src/worker/growth.ts:575-660`）只判 `pending = floor(growth_xp / xpPerLevel) - levels_applied > 0`（否则 409）+ `getUpgradePlans(db)[growth_tier] ?? DEFAULT_UPGRADE_PLANS[growth_tier]`（键 1–5、无 0）⇒ **既不查 growable 也不查 pa ⇒ ca 可被加过 pa**。

### 1.2 生产实测（`wrangler d1 execute --remote`，只读）

- 球员 18,301；`growable = 0` **7,827**（全部 `growth_tier >= 1`）；其中 **116 名 `growth_xp > 0`，合计 372 XP**（自动 305 条/207.5 XP/83 人；补录 277 条/164.5 XP/98 人；33 人 48 XP 仅来自补录）。
- **6 名非成长球员已可升级**（`levels_applied` 全 0、`growth_tier` 全 1、`status` 全 `normal`）：Mbappé(id 2, 26 岁, 91/92, 13.5 XP)、Lewandowski(22, 36, 88/88, 11.5)、Osimhen(34, 26, 87/89, 10)、Son Heung Min(65, 32, 85/85, 10.5)、Benzema(72, 37, 85/85, 11)、Pedro Gonçalves(154, 27)。
- `config` 无 `xp_per_level` 行 ⇒ 默认 10。

### 1.3 growth_events 的消费方（**数据必须照收的理由**）

| 消费方 | 用途 |
|---|---|
| `src/worker/player-matches.ts:62` | 球员「比赛」tab —— 按 `match_ref` 读 `event_type / value`（**主要一处：录进去的进球/助攻/出场数据在这展示**） |
| `src/worker/routes/growth.ts:88` | 球员成长史最近 50 条事件 |
| `src/worker/growth.ts:391` | 里程碑汇总（goal/assist 的 `value` 合计） |
| `src/worker/routes/admin/growth.ts:51-58` / `:403` | `duels_won` / `saves` 跨场累计基数（补录/批量算 XP 用）/ 录入台已录事件回读 |
| `src/worker/routes/admin/growth.ts:106` | 改值重放的基准值（读 `value, xp`） |
| `src/worker/routes/admin/growth.ts:369` / `:725` | 录入台「已录条数」/ 批量幂等去重锚 |

⇒ 拦掉 ①②③ 的事件写入会打断上面全部功能，所以这些事件行与 `value` 一律照存，只把 XP 一栏归零。④⑤⑥ 是纯 XP 合成事件、不承载比赛数据（`value` 只是固定 XP 标记或进球助攻汇总），改为查询层过滤、不产生行：**不影响消费方的读取能力，但成长史（`routes/growth.ts:88`）今后不再出现这三类新行（历史行保留）** —— 这是本次规则变更的预期结果，不违反「比赛数据照收」。

### 1.4 设计口径

- `PRD.md:115/119/121/122/123/124`：XP 闸门只有「赛事可计 XP / 在册有归属 / 非 CPU 队」，**从未把 growable 当 XP 门槛**（CPU 队口径 = 整队静默跳过）。本次是**规则变更**，需在 PRD 补一条。
- `growable` 现用途：训练营准入与体检（`src/core/squad-rules.ts:119-136/179/199`）、🟢 标记（`:125/:136`）、影响力系数（`src/worker/influence.ts:8-10`）、球员库筛选（`web/src/lib/players-library.ts:93/320/432`）。
- 列定义 `src/db/migrations/0001_init.sql:14`（`INTEGER DEFAULT 1`）+ 0004 backfill（age<=25）+ 赛季重判/管理端 PATCH；索引侧口径：`0035_players_sort_indexes_batch4.sql:32` 用 `COALESCE(growable, 0)`，`0042_players_marker_index.sql:15` / `0061_players_marker_index_rebuild.sql:18` 用 `growable = 1`（NULL 同落非成长侧，两者语义等价）。

---

## 2. 判定口径

- **可成长** = `COALESCE(players.growable, 0) = 1`；**非成长** = 其余（含 NULL）。
- 理由：与既有索引口径一致；NULL 归非成长侧是保守方向。生产实测 18,301 行 `growable ∈ {0,1}`，无 NULL。
- **两类处理（统一同一判定）**：
  - ④⑤⑥ 训练营 / 中国计划 / 里程碑：**查询层过滤**（`COALESCE(growable, 0) = 1`），非成长球员不产生事件行（§4.3）。
  - ①②③⑦ 录入台批量 / 单人补录 / 自动钩子 / 改值重放：**主闸归零** —— 事件行与 `value` 照写，`growth_events.xp` 存 0、`players.growth_xp` 不累加（§4.1、§4.2）。
- **进球/助攻的两条 XP 都覆盖**：单事件 XP（`goal` / `assist` 各 0.5/个）走主闸归零（事件行与 `value` 照存、`growth_events.xp=0`）；里程碑 XP 走 §4.3 的里程碑查询过滤（非成长球员不产生 `milestone` 事件）。两条路径都不给非成长球员发 XP。
- **数据与 XP 分开**：①②③⑦ 的事件行、`value`、幂等锚、去重、汇总一律照旧，只把 `players.growth_xp` 的累加与 `growth_events.xp` 的存值对非成长球员归零（后者是为了让成长史里显示的行 XP 与实际入账一致，不出现「+20 但总数没动」）；④⑤⑥ 不产生行。两种处理都只按 `COALESCE(players.growable, 0) = 1` 判定，没有第三套口径。
- 球员从可成长变非成长（age>25 重判 / PATCH）：历史事件与历史 XP 不追溯（存量由 §3 迁移清零）；反之翻回可成长后，**过去那些 `xp=0` 的行不会补发**（不追溯口径，如实登记）；④⑤⑥ 例外，见 §9.4。

---

## 3. 迁移 `0077_growth_nongrowable_reset.sql`

`0076` 已被 `0076_growth_events_match_ref_index.sql`（v6.51.10 已 apply 生产）占用，本迁移顺延为 **0077**；`tests/d1.ts` 注册 0077。

```sql
-- v6.52.0：非成长球员（growable = 0）不再参与成长 XP —— 存量清零（用户 m06019 拍板）。
-- 判定口径与既有索引一致：COALESCE(growable, 0) = 1 才算可成长。
-- 事件行留档不删（成长史/球员比赛 tab 仍要读这些数据）；levels_applied 不动
-- （生产实测非成长球员 levels_applied 全为 0 ⇒ 清零后 pending 自然归 0）。
UPDATE players SET growth_xp = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE COALESCE(growable, 0) = 0
   AND COALESCE(growth_xp, 0) <> 0;
-- 回滚：不可精确还原（清零前的 growth_xp ≠ SUM(growth_events.xp)：解约/导入清零不删事件、改值重放会改事件 xp），
-- 只能近似重算：
--   UPDATE players SET growth_xp = (SELECT COALESCE(SUM(xp),0) FROM growth_events WHERE player_id = players.id)
--    WHERE COALESCE(growable, 0) = 0;
```

- 文件内不写 `BEGIN/COMMIT`（仓规）；`tests/d1.ts` 的 `MIGRATION_FILES` 追加注册 `0077_growth_nongrowable_reset.sql`（排在末项 `0076_growth_events_match_ref_index.sql` 之后）。
- **写量**：`WHERE COALESCE(growable, 0) = 0` 会匹配 **7,827 行**，即使值没变 SQLite 也把匹配行计入 `rows_written`（node:sqlite 实测：同一条 UPDATE 连跑两次，`changes` 均为 2/2）⇒ 迁移必须带 `AND COALESCE(growth_xp, 0) <> 0`，只写真正有 XP 的 **116 行**；其余 7,711 行的 `updated_at` 不刷新（本来也无变化）。带守卫后重放为 0 行。生产 apply 的 D1 写配额按 **≈116 行**登记（不按 7,827）。
- 预期影响：116 名球员的 372 XP 归零（`rows_written ≈ 116`）；6 人「待升级」消失（本来也不该升）。
- 上线顺序：**先 apply 迁移再 push**（push 即 CF 自动部署）。

---

## 4. 代码落点

### 4.1 主闸 —— 覆盖 ①②③⑦；三类结算另在 §4.3 过滤

`recordGrowthEventStatements`（`src/worker/growth.ts:140-157`）仍是所有路径的兜底：即使 §4.3 的过滤漏了一处，非成长球员的 XP 也不会入账。

```sql
-- ① XP 累加加守卫（偶数位 changes：1=XP 已入账 / 0=没入账（非成长或重放））
UPDATE players SET growth_xp = growth_xp + ?, updated_at = ...
 WHERE id = ?
   AND COALESCE(growable, 0) = 1
   AND NOT EXISTS (SELECT 1 FROM growth_events WHERE player_id = ? AND match_ref IS ? AND event_type IS ?)

-- ② 事件照写（VALUES 形式不动、不加 WHERE），只把 xp 一栏按 growable 归零
INSERT INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
VALUES (?, ?, ?, ?, ?, ?, CASE WHEN COALESCE((SELECT growable FROM players WHERE id = ?), 0) = 1 THEN ? ELSE 0 END, ?, ?, ...)
ON CONFLICT (player_id, match_ref, event_type) DO NOTHING
```

- 语义：非成长球员**事件行照写（`value` 照存）、`xp` 栏存 0、`growth_xp` 不动**；可成长球员完全不变。
- `meta.changes` 位序不变（偶数位=XP 是否入账、奇数位=事件是否新入账）—— 注意偶数位 0 现在也可能是「非成长」而非「重放」；批量统计只看奇数位，不受影响。
- 零额外查询（子查询在语句内），不动批内顺序与幂等锚。
- 事件 INSERT 的 `CASE` 多一个绑定参数：bind 链顺序要变成 `playerId, matchRef, season, windowSeq, eventType, value, playerId, xp, source, recordedBy`（`growth.ts:155` 需多传一次 `e.playerId`）。
- **已实测（node:sqlite，2026-10-19）**：`growable=1` → XP 语句 1 / 事件语句 1、事件 xp=4；`growable=0` → XP 语句 **0** / 事件语句 **1**、事件 `value=2, xp=0`、`growth_xp` 不变；`growable IS NULL` → 同非成长；同锚重放事件语句 0（幂等保持）。

### 4.2 录入台（XP 统计不虚报 + 标记）

批量端点的「入账 XP」是按**事件语句**的 changes 判定的（`src/worker/routes/admin/growth.ts:833-859`，`applied = sig.index >= 0 && results[sig.index].meta.changes === 1`；插入信号 `sig.index = at + 1` 指向事件 INSERT `:787`，更新信号 `:806`）⇒ 主闸让事件照写后，**非成长行会被误算进 `totalXp` / 每行 `xp`**（响应取 `e.xp` / `sig.deltaXp`，`:846`/`:848`，不取 SQL 结果）。所以端点层必须自己把 XP 归零：

- 球员查询与 DTO 增 `growable`：`EntryPlayerRow` 接口（`:280-288`）、批量端点 SELECT（`:668-672`）、单人补录 SELECT（`:132-135`）、花名册 SQL（`:419-424`）+ `rosterRows` 映射（`:429-437`，`growable: p.growable === 1`，与既有 `suspended` 同点）。比较一律 `p.growable === 1` —— 漏字段即 `undefined ⇒ false`，整队会被静默当非成长。
- 批量端点**构造 events 时**就按 `growable` 归零（`:707-715`）：`xp: growable ? e.xp : 0` —— 响应 `totalXp` / 逐行 `xp` 与审计 `detail` 都取构造值，只在 SQL 里归零会虚报。
- 单人补录（`:127-186`）：显式引入 **`creditedXp = player.growable === 1 ? xp : 0`**，同时用于 `recordGrowthEvent` 的 `xp`（`:166-176`）、审计 `after.xp`（`:183`）与响应 `xp`（`:185`）。三处必须共用同一个局部量 —— 只改传给 `recordGrowthEvent` 的对象，响应与审计仍读外层 `xp`，非成长球员会回一个没入账的 XP 值。
- 自动钩子的 `granted`（`src/worker/results.ts:752-760`，按**事件 INSERT** 的奇数位计数）：非成长球员的进球/助攻/零封仍会让 `granted++`，确认响应（`routes/admin/seasons.ts:183`）与管理端 toast（`web/src/pages/admin/SeasonsPage.tsx:392`）会多报。**口径**：`granted` 保留为「新入账的成长事件条数」（字段名与 `web/src/lib/api.ts:1868` 的类型不变），只把注释与文案统一改成「自动记了 N 条成长事件」，不再宣称 XP 条数；不新增 `xpGranted`。
- 改值重放（`:791-807`）：非成长球员**跳过 replay**，`replay.delta = 0`、不更新链上其他行（`replay.extra` 整体丢弃）；被改行按**它自己现有的 `xp`** 分支：
  - 原 `xp = 0`（非成长时期录的）⇒ 保持 0；
  - 原 `xp > 0`（成长期录的）⇒ **保持原 `xp` 不变**，只改 `value` / `recorded_by`。不能一律置 0 —— 那会把其可成长时期的历史 XP 抹掉，且 `growth_xp` 不动（delta=0）会让行显示与账本更不一致。
  - 被改行现有 `xp` 已由 `existingByAnchor` 的 SELECT（`:727`，取 `id, player_id, event_type, value, xp, source`）带回，直接分支即可；`UPDATE players … :804` 再加 `AND COALESCE(growable, 0) = 1` 兜底。
  - `loadCumulativeBases`（`:51-62`，按 `value` 求和、不看 `xp`）已按 §9.9 定案处理（保持现状：全部历史值计入）。
- `recordGrowthEvent`（`growth.ts:160-163`）改按 **`results[1]`（事件 INSERT）** 判入账。主闸给 XP 语句加守卫后，非成长球员的新事件 XP 语句 `changes=0`，若仍看 `results[0]`，单人补录（`routes/admin/growth.ts:166-185`）会把新事件误报 `duplicate:true`（200 而非 201）。
- **不拒收、不禁行、OCR 照常预填**（`web/src/pages/admin/GrowthEntryPage.tsx:825/:868` 调 `mergeOcrEntries` 不动）。

### 4.3 赛季结算三类（查询层过滤，连事件行都不产生）

用户最新追加：训练营 / 中国计划 / 里程碑对非成长球员**不产生事件行**（原「三类也走主闸、事件照写」方案作废）。三处都在查询层加 `COALESCE(growable, 0) = 1`，非成长球员根本不会被扫到：

① 训练营（`src/worker/growth.ts:320-326`）：

```sql
SELECT t.id FROM players t JOIN contracts c ON c.player_id = t.id AND c.is_active = 1
 WHERE c.contract_type = 'trainee'
   AND COALESCE(t.growable, 0) = 1
```

② 中国计划（`src/worker/growth.ts:346-352`）：

```sql
SELECT t.id FROM players t JOIN contracts c ON c.player_id = t.id AND c.is_active = 1
 WHERE t.china_plan = 1
   AND COALESCE(t.growable, 0) = 1
```

③ 里程碑内层聚合（`src/worker/growth.ts:388-399`）：

```sql
SELECT x.id AS id, x.total AS total FROM (
  SELECT ge.player_id AS id, SUM(ge.value) AS total FROM growth_events ge
  JOIN players p ON p.id = ge.player_id AND COALESCE(p.growable, 0) = 1
  WHERE ge.event_type IN ('goal', 'assist')
    AND ge.id > ?
    AND ge.id > COALESCE((SELECT MAX(r.id) FROM growth_events r WHERE r.player_id = ge.player_id AND r.event_type = 'reset'), 0)
  GROUP BY ge.player_id
) x WHERE x.id > 0
```

- `scanRows` 仍会在末尾拼 `AND x.id > ? ORDER BY x.id LIMIT 500`（`growth.ts:464-478`，cursorCol 保持 `'x.id'`），绑定参数顺序仍是 `[period.startEventId, lastId]`；JOIN 必须留在派生表内层（外层 WHERE 里 `p` 不在作用域），`GROUP BY ge.player_id` 不能丢。若把 `growable` 条件写成带参形式，参数顺序会整体错位。
- 内层 INNER JOIN `players` 会顺带排除球员已不存在的孤儿事件（`growth_events.player_id` 无外键）。
- **影响**：`SettlementSummary` 的 `traineeCount` / `chinaCount` 直接取过滤后数组长度（`growth.ts:453-454`）并写进 audit after（`:445`），`milestonesGranted` 只计插入成功的事件 ⇒ 三者都只统计可成长球员；`pendingLevelUps`（`:430-437`）不按 `growable` 收窄 —— 迁移清零后非成长球员本来 pending 为 0。
- **历史事件保留**：已经产生的 `trainee_season` / `china_plan` / `milestone` 行不追溯删除；只是今后不再为 `growable = 0` 的球员新增，重放同样不产生。
- 这三类是纯 XP 合成事件、不承载比赛数据（`value` 只是固定 XP 标记或进球助攻汇总），不产生行不影响 §1.3 消费方的读取能力；但成长史今后不再出现这三类新行（历史行保留），是本次规则变更的预期结果，不违反 m06100「比赛数据照收」。
- **进球/助攻有两条 XP，均已覆盖**：① 单事件 XP（`goal` / `assist` 各 0.5/个，`src/worker/growth.ts:51-54`）由自动钩子经主闸写入 —— 非成长球员事件行与 `value` 照存、`growth_events.xp=0`、`growth_xp` 不累加（§4.1 / NG-02 / NG-04）；② 里程碑 XP（`milestoneThresholds` / `milestoneXp`）由上面的里程碑查询过滤 —— 非成长球员不产生 `milestone` 事件（NG-03）。两条路径都不给非成长球员发 XP。

### 4.4 升级闸门（兜底）

`applyLevelUp`（`src/worker/growth.ts:575-660`）：SELECT（`:589-602`）与 TS 类型增 `growable`；取到球员后、判 `pending <= 0`（`:605-608`）**之前**先判 `growable === 1`，非成长 → 409（文案「非成长球员不能消费升级」）。

顺序不能反：迁移清零后非成长球员 `pending` 本来为 0，先判 pending 会永远命中「没有待处理的升级」，新文案不可观测。这是兜底（清零后正常路径走不到）；前端升级按钮因 `pending = 0` 本来就不显示，球员页无需改。

### 4.5 前端 `web/src/pages/admin/GrowthEntryPage.tsx`

- 行内加灰徽标「非成长 · 不计 XP」：落点是卡片头 `:1171-1175`（已有「训练营」`:1172` 与停赛红徽标 `:1173`）；赛事口径的 `noXp` 徽标在 `:1060-1070`。**输入不禁用、照常可录**。
- `rowXp`（`:230`）对非成长行**在累加 `extraXp` 之前直接 `return 0`**（`extraXp` 来自已录进球/助攻的 `rec.xp`，`:311`/`:315`/`:346` —— 只把草稿 XP 归零会漏掉这部分）；`totalXp`（`:791`）与四处渲染（`:1060-1063` 头部、`:1313-1316` 卡片脚、`:1496` 表格 XP 列、`:1532-1535` 窄屏汇总条）都经 `rowXp`，不需要各改一遍。
- 顶部提示条加一句：非成长球员的录入照收（比赛数据要用），只是不计成长 XP。
- 静态锁注意：`tests/mobile-baseline.test.ts:123` 对该文件的 `width` 字面量计数为 2 ⇒ 徽标不加内联宽度。（`tests/ops-schedule.test.ts:394-395` 的 `useOpsGate` 锁只扫 `web/src/pages/shop/venueCards.tsx` 与 `web/src/pages/market/MarketActivationPage.tsx`，本页不涉及，不作约束。）

---

## 5. 测试计划（新增 `tests/growth-nongrowable.test.ts` + 前端用例）

| TC | 断言 |
|---|---|
| NG-01 | 迁移锁：0077 apply 后 `growable=0` 的 `growth_xp` 全 0、`growable=1` 的 XP 不动、`growth_events` 行数与 `value` 不变 |
| NG-02 | 主闸：非成长球员 XP 语句 `changes=0` / 事件语句 `changes=1`、事件 `xp=0` 且 `value` 照存、`growth_xp` 不变；可成长球员照常 1/1 且 `xp` 照存；同锚重放仍幂等 |
| NG-03 | 三类结算：`growable=0` 的球员（训练营合同 / `china_plan=1` / 有成长期内 goal+assist）**不产生任何事件行**（重放同样 0 行）；`growable=1` 的球员照常产生；`SettlementSummary` 的 `traineeCount` / `chinaCount` / `milestonesGranted` 只计可成长球员；历史已产生的行不删除 |
| NG-04 | 自动钩子：赛果确认后非成长球员有事件（数据在）、`growth_xp` 不变；确认响应 `xp.granted` 仍按**事件条数**计数（非成长球员也计数），前端 toast 文案为「自动记了 N 条成长事件」（不再宣称 XP）；`retryUnresolvedResults` 重放同口径 |
| NG-05 | 录入台批量：非成长行新事件 **201**（`written > 0`）、事件入账、响应 `totalXp` 与逐行 `xp` **为 0**（不虚报）、可成长行照常；同批全部重复时 **200** 且 `duplicates` 计数正确；面板 DTO 带 `growable` |
| NG-06 | 单人补录：非成长球员 **201**（`duplicate:false`）、事件入账、响应 `xp=0`、审计 `after.xp=0`、`growth_xp` 不变；同锚重放 200（`duplicate:true`） |
| NG-07 | 改值重放：非成长球员 —— 原 `xp=0` 的行维持 0；原 `xp>0` 的成长期行保持原 `xp`（只改 `value` / `recorded_by`）；链上其他行不动、`growth_xp` 不变；可成长球员差额照常 |
| NG-08 | 升级闸门：非成长 + 有 XP ⇒ 409；清零后 `pending = 0` |
| NG-09 | 消费方不回归：球员「比赛」tab（`src/worker/player-matches.ts:62`）与成长史（`src/worker/routes/growth.ts:88`）对非成长球员仍能读到事件与 `value` |
| NG-10 | 前端：非成长行显示徽标、输入可用、行 XP 显示 0、不计合计；可成长行不变 |
| NG-11 | 迁移注册与隔离：`tests/d1.ts` 的 `MIGRATION_FILES` 已追加 `0077_growth_nongrowable_reset.sql` 且排在 `0076_growth_events_match_ref_index.sql` 之后；0077 带 `AND COALESCE(growth_xp, 0) <> 0` 重放为 **0 行**且数据不变（幂等）；`0076` 的索引迁移不受影响（`idx_growth_events_match_ref` 仍在册） |

- 回归面：growth 相关 fixture 用裸 INSERT 不写 `growable` ⇒ 默认 1，**既有用例预计不受影响**；显式 `growable: 0` 只在 `tests/home.test.ts:139/419`、`tests/influence-recalc-engine.test.ts:218-219/349`、`tests/players-library.test.ts:1093-1099`、`tests/shop-orders.test.ts:170`、`tests/squad-rules.test.ts:79/151`（均非 XP 入账路径）。**新增过滤后需显式构造 `growable=0` 的球员覆盖三类结算**（裸 INSERT 默认 1，不显式写就测不到过滤）；另注意 `rejudgeGrowable`（`season-settle.ts:183-193`）要求 `ca<pa AND pa IS NOT NULL AND age<=cap`，触达建季/结算的用例若夹具 `pa` 为空会被判成 `growable=0` —— growth 相关测试不要在建季后再断言这三类计数；`tests/growth.test.ts:361-364/378-379` 直接断言 `traineeCount` / `chinaCount`，夹具若出现 `growable=0` 会变红。需复跑：`tests/growth-match-entry.test.ts`、`tests/growth.test.ts`、`tests/results.test.ts`、`tests/season-settle.test.ts`、`tests/growth-ocr-endpoint.test.ts`、`tests/player-matches*.test.ts`。
- 闸门：`npm run test` 全量 + `npm run typecheck`（三份）+ `npm run build` + `npm run db:migrate:local` + `npm run test:e2e`（dev 8791；`scripts/e2e/smoke.mjs` 的成长步骤按新口径核对）。

---

## 6. 文档与版本

- 版本 **v6.52.0**（minor：规则变更 + 迁移 + 存量数据订正）。
- `CHANGELOG.md` v6.52.0 条目、`ROADMAP.md` 加节、`AGENTS.md` 当前状态 bullet、`docs/test-plans/v6.52.0-growth-nongrowable.md`（qa-test-planner 产出）、本计划文件 + 记忆目录索引行。
- `PRD.md` 的 XP 闸门清单补一条「非成长球员（`growable = 0`）不计 XP，但比赛数据照收；训练营 / 中国计划 / 里程碑三类结算不为非成长球员产生事件行」。
- 记忆目录 `MEMORY.md` 的 v6.52.0 索引行同步新口径（迁移号 `0077` + 三类结算过滤）。

---

## 7. 验收口径

- **本地**：迁移 apply 后回读「非成长球员 `growth_xp` 全 0、可成长球员 XP 未动、事件行数与 value 不变」；录入台非成长行可录且响应 XP 为 0；球员比赛 tab 仍显示非成长球员的比赛数据；升级 409；**三类结算（训练营 / 中国计划 / 里程碑）对非成长球员无新事件行（重放同样 0）**。
- **生产（待令）**：`npm run db:migrate:remote` apply **0077** → 回读 116 名 / 372 XP 归零、6 人 pending 归 0、可成长球员 XP 未动、事件行数不变、**三类结算对非成长球员无新事件行（重放同样 0）** → push（先核 CF 自动部署）→ 部署核对 Version + 端点体检。

---

## 8. 回滚

- 代码：回退 commit 即恢复「照记 XP」；**已清零的 XP 不能精确还原**（只能按 §3 注释近似重算）。
- 迁移：无 down 脚本（纯数据订正）。

---

## 9. 如实登记（取舍与悬置）

1. **规则变更**：设计文档从未把 growable 当 XP 门槛，本次新增该门槛 —— 非成长球员成长曲线归零；①②③⑦ 的事件仍在、行 XP 显示 0，④⑤⑥ 不再产生事件行。
2. **数据照收的边界**：①②③⑦ 的事件行 / `value` / 幂等锚 / 去重 / 汇总 / 球员比赛 tab 全部照旧（只改 `growth_xp` 累加与 `growth_events.xp` 存值）；④⑤⑥ 是纯 XP 合成事件，改为查询层过滤、不产生行 —— 这是「数据照收」的唯一例外，比赛数据一类都不丢。
3. **三类结算事件不再产生**：训练营 / 中国计划 / 里程碑对 `growable = 0` 的球员不再写事件行；**历史已经产生的行保留、不追溯删除**（成长史里仍能看到旧行）。
4. **翻回可成长**：球员日后被改回 `growable = 1`，此前 `xp=0` 的 ①②③⑦ 事件行不会追溯补 XP（与「存量清零」同向）；但 ④⑤⑥ 会按当前 `growable = 1` 恢复产生事件（里程碑按当前成长期内历史 goal/assist 汇总，可能一次性补发多档）—— 1→0 立即停发、0→1 追溯计入，这个不对称如实登记。（用户 2026-10-19 裁决：保持现状，该不对称作为已知边界保留。）
5. **训练营里的非成长球员是违规态**（体检 `trainee_growth` 会报），本轮不额外处理。
6. 生产 372 XP 归零是**不可逆的数据订正**，apply 前会再向用户确认一次。
7. 存量事件（582 条）保留 ⇒ `SUM(growth_events.xp)` 与清零后的 `growth_xp` 不再一致（既有口径差异，非本次引入）。
8. **迁移号从 `0076` 顺延为 `0077`**（`0076` 已被 v6.51.10 的 `0076_growth_events_match_ref_index.sql` 占用并已 apply 生产）；不修改任何既有迁移。
9. **已定案（2026-10-19 用户裁决：保持现状）**：改值重放对历史 `xp=0` 行不做额外拦截 —— 当前非成长球员跳过 replay（被改行保持现有 xp、链上其他行不动）；当前可成长球员仍按现有 `replayEventChain` 正常重放（历史 `xp=0` 行可能因改值补 XP，仅管理端可触发，登记为已知边界）。`loadCumulativeBases` 仍按全部历史 `value` 求和（非成长时期的数值计入累计基数；它是表现统计而非 XP 账本，且 `xp=0` 无法区分「非成长」与「不计 XP 赛事」）。

---

## 10. 实施步骤（交付序，待令）

1. 迁移 `0077_growth_nongrowable_reset.sql` + `tests/d1.ts` 注册（追加在 `0076_growth_events_match_ref_index.sql` 之后）。
2. worker：`src/worker/growth.ts`（主闸 + 三类结算查询加 `growable` 过滤（训练营 / 中国计划 + 里程碑 JOIN）+ 升级闸门）、`src/worker/routes/admin/growth.ts`（DTO/批量/单人/重放 + 花名册）、`src/worker/routes/growth.ts`（升级文案）。
3. 前端 `GrowthEntryPage.tsx`（徽标 + 行 XP 归零 + 合计）、`SeasonsPage.tsx`（赛果确认 toast 文案改为「成长事件」）。
4. 测试（§5 表）+ 既有用例复跑 + 全量闸门 + `db:migrate:local` + e2e。
5. 文档（§6）+ code-review-skill 复审 + 修复后复测。
6. **待令**：apply 生产 **0077** → push → 部署核对 → 生产回读 → 上线记录回写（本地 commit 不 push）。

---

## 11. 交付记录（2026-10-20）

**状态**：代码、迁移、测试、文档全部落本地；**生产 0077 未 apply、未 push、未部署**（待令）。

**改动文件**

| 文件 | 改动 |
|---|---|
| `src/db/migrations/0077_growth_nongrowable_reset.sql`（新） | 非成长球员存量 `growth_xp` 清零；尾守卫 `AND COALESCE(growth_xp, 0) <> 0`（只写有 XP 的 ≈116 行、重放 0 行）；事件行与 `levels_applied` 不动 |
| `src/worker/growth.ts` | 主闸 XP 语句加 `COALESCE(growable, 0) = 1`；事件 INSERT 的 `xp` 按 growable 归零（bind 链多一次 `playerId`）；`recordGrowthEvent` 改按事件 INSERT（`results[1]`）判新入账；三类结算查询过滤（训练营 `:334` / 中国计划 `:362` / 里程碑 `:406`）；结算待办表按 `growable` 收窄（`:449-455`）；`applyLevelUp` 增 `growable` 并与 `pending` 判定之前抛 409（`:631`） |
| `src/worker/routes/admin/growth.ts` | 面板 DTO / 批量 SELECT / 单人 SELECT / 花名册 SQL 增 `growable`；批量在构造 events 时归零（`xpOn`）；单人 `creditedXp` 一处供入账 / 审计 / 响应；非成长改值重放跳过 replay（只改 `value` / `recorded_by`，保留现有 `xp`）；`growth_xp` UPDATE 加 growable 兜底 |
| `src/worker/results.ts` | `granted` 语义注释改为「新入账的成长事件条数」（非成长事件也计数，字段名不变） |
| `src/worker/routes/growth.ts` | 球员成长载荷补 `growable`；非成长球员 `pendingLevelUps` 恒 0 |
| `web/src/lib/api.ts` | `MatchEntryPlayer.growable` 字段 + `ConfirmResultResult.xp.granted` 注释 |
| `web/src/pages/admin/GrowthEntryPage.tsx` | 非成长行灰徽标「非成长 · 不计 XP」（卡片头 + 表格）、`rowXp` 在 `extraXp` 前归零、提示条说明录入照收 |
| `web/src/pages/admin/SeasonsPage.tsx` | 赛果确认 toast 改「自动记了 N 条成长事件」 |
| `web/src/pages/admin/GrowthEntryPage.test.tsx` | 夹具补 `growable: true`（旧用例默认球员都可成长） |
| `tests/d1.ts` | `MIGRATION_FILES` 追加 `0077_growth_nongrowable_reset.sql`（排在 0076 之后） |
| `tests/growth-nongrowable.test.ts`（新） | NG-01..NG-11 共 22 例 |
| `docs/test-plans/v6.52.0-growth-nongrowable.md`（新） | qa-test-planner 设计的测试计划 |
| `CHANGELOG.md` / `ROADMAP.md` / `AGENTS.md` / `PRD.md` / `package.json` | v6.52.0 条目 / 加节 / 当前状态 bullet / 4.6 规则行 / 版本号 6.51.13 → 6.52.0 |

**测试用例数**：新增 `tests/growth-nongrowable.test.ts` **22 例**（TC-NG-01a/b、02a/b、03a/b、04a/b/c、05a/b、06a/b、07a/b、08a/b、09、10a/b、11a/b）。全量 `npm test` **139 文件 / 2278 例全绿**（v6.51.13 基线 138 文件 / 2256 例，净 **+1 文件 / +22 例**；耗时 99.50s）。

**闸门结果**：`npm test` 全量全绿（本轮实测输出）；`npm run typecheck`（三份 tsconfig）、`npm run build`、`npm run db:migrate:local`、`npm run test:e2e` **本轮未跑（未验证）**。

**生产**：apply 0077、生产回读、push、部署核对 **均未做**；写量按 ≈116 行登记（不按 7,827）。

**实施偏差（如实登记）**：计划 §4.3 原写「`pendingLevelUps` 不按 `growable` 收窄」，实现改为**一并收窄** —— `season-settle` 的重判只改 `growable`、不清 `growth_xp`，不收窄时超龄/练满球员会长期显示「N 次待升级」而点下去必 409；迁移清零只覆盖 apply 那一刻，收窄才覆盖之后的重判。

