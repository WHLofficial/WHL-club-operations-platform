# 名单镜像与窗口期薪资可视化（v6.67.0）

**状态**：设计待复核（2026-11-02）
**缘起**（用户原文）："现在注册是怎么做的？教练不能在转会期调整注册名单，没办法直观看到自己薪资变化啊"

---

## 1. 现状（代码事实）

### 1.1 注册是一次性作业

- 提交口：`POST /api/club/registrations`（`src/worker/routes/registration.ts:347`），整份名单快照替换（`DELETE` + 逐行 `INSERT`）。
- 时点闸：`getRegistrableSeason()`（`src/worker/seasons.ts:5-10`）只认 `seasons.status = 'preparing'`；赛季一开首窗就转 `running`（`src/worker/window-machine.ts:190`），此后提交一律 409「只有备赛期能提交名单」。
- 另有级别闸：未在赛事平台报名定级赛事时 `deriveClubTier` 返回 `null`，提交 400 `tier_pending`（`routes/registration.ts:366-369`）。
- 校验：`checkSquad`（`src/core/squad-rules.ts:151`）9 条规则 —— `squad_size` / `gk` / `trainee_size` / `trainee_growth` / `trainee_contract` / `first_team_contract` / `ca_pa` / `wage_cap` / `contract`；`enforce` 档不过就 422（`routes/registration.ts:393-395`）。

### 1.2 名单其实不影响谁上场

`registrations` 全仓只有三个消费方：

| 消费方 | 用途 |
|---|---|
| `GET /club/squad`（`routes/registration.ts:134`） | 教练工作台的名单与合规体检 |
| `GET /api/admin/registrations`（`routes/admin/reviews.ts:26/43/110`） | 管理端注册快照报表 |
| `src/worker/demand-ops.ts:293` + `src/core/demand-rules.ts:72` | 涨薪诉求资格里的"是否注册一线队"标记 |

比赛阵容、上场判定、赛事报名都不读这张表。它是一份**纸面合规快照**。

### 1.3 工资是两套口径

- 工作台 cap bar：只算"已分配进名单"的人（`web/src/pages/club/DeskTab.tsx:263-288`，`wageTotal` 来自 `assign`，未分配球员不计）。
- 实际扣费：`window-payroll.ts:53` 按 `contracts.club_id` 汇总**全部**现行合同，不看 `registrations`。
- 富人税是另一套（现金 >125m 收 20%、球队价值 >700m 收 5%，`window-payroll.ts:7`），与工资帽无关。

**后果**：窗口期买入的球员**立刻**计入窗末扣费，但工作台看不见（未进名单、不计入 `wageTotal`），注册页也改不了。工资帽规则在窗口期事实上被完全绕过 —— 不提交名单就永远不触发 `wage_cap`。

---

## 2. 决策（用户裁决，2026-11-02）

| # | 决策 |
|---|---|
| D1 | 名单改为**合同推导的镜像**：正式合同→一线队，训练营合同→训练营；不给教练任何手动开关 |
| D2 | 无合同球员单开「未签约」区：不占人数、不计工资、挂红字 |
| D3 | `registrations` 降级为**关窗存档**：只在关窗时写一次，供审计与历史查询 |
| D4 | 窗口期只红字，不打扰交易：超帽/超名额不拦转会、不拦签约 |
| D5 | 核验时点 = 关窗（开赛）时一次 |
| D6 | 核验不过**只记录、不阻断**：不卡关窗、不卡结算、不卡下一窗 |
| D7 | 结构走 A 案：纯推导 + 关窗快照 + 一张工资基线表，不建"活名单"表 |
| D8 | **写入侧零拦截**：超帽、超名额不拦签约/报价/关窗；系统只提供红字与数字（用户 2026-11-02：「不要超帽禁止交易。我们要自由度高而不是低」） |
| D9 | 红字收敛在**聚合层**：超帽只出现「超 X m」，人数/门将/训练营/CA 名额各一行；逐人性质的问题收进所属分区标题旁一句话（点名，可跳球员页） |
| D10 | 关窗核验不通过 → **给该队教练发站内信**（同批写入、按窗口去重、内容只含金额与规则名，不含球员姓名） |
| D11 | CPU 队**也写** `registrations` 存档与 `squad_audits` 行（`pass=1`、`issues=[]`、`stats` 真实）；存档/看板逐队全出，是否灰显由前端按 `clubs.is_cpu` 判断 |
| D12 | 上线当期**不补部署基线**：本期 `baseline=null`，CapBar 直接退成两段（现在 / 待生效），不加解释文案；下一窗起三段 |
| D13 | `inCount`/`outCount` = `transfer` / `activation` / `forced_auction` / `free_agent` / **`termination`**；排除 `rc_change` / `match`（留队改条款，人数没变） |
| D14 | `projected` 只预估**已过户、条款未定**（`terms_applied=0`）的球员；在途 `pending_review` / 在谈单不预估 |

---

## 3. 设计

### 3.1 名单视图（新模块 `src/worker/squad-view.ts`）

```
loadSquadView(db, clubId) -> {
  firstTeam: SquadViewRow[]   // contract_type='formal' 且 is_active=1
  trainee:   SquadViewRow[]   // contract_type='trainee'
  unsigned:  OwnedPlayerRow[] // 本队、未退役、但没有本队 active 合同
}
```

- 数据源：`players`（`club_id = ?`、`status <> 'retired'`）LEFT JOIN `contracts`（`is_active = 1 AND club_id = ?`）。
- `SquadViewRow` 复用现有 `SquadPlayer` 形状（`playerId/name/position/ca/pa/initialCa/growable/hasContract/contractType/wage`），另带 `status`、`releaseFee` 供展示。
- 在售（`listed`/`bidding`）球员仍在名单内、照算工资 —— 归属没变。
- 未签约区不参与 `checkSquad`，只把 `playerIds` 塞进 `contract` 规则的红字里（复用既有规则名，不新增规则）。

### 3.2 消费方迁移（期一必须全改，否则名单冻结后报表跟着冻）

| 位置 | 现在 | 改为 |
|---|---|---|
| `GET /club/squad` | 读 `registrations` 分组 | `loadSquadView` 现算；`compliance` 去掉 `regRows.length > 0` 前置条件 |
| `GET /api/admin/registrations` | 读 `registrations` | 同视图 SQL 现算（按 club 分组）；`season` 早于当前季时读 `registrations` 存档 |
| `demand-ops.ts:293` | `LEFT JOIN registrations r` 取 `r.squad` | 由 `contracts.contract_type` 推导（`formal`→first_team、`trainee`→trainee） |
| `demand-rules.ts:72` `registered` | 由 `registrations.squad` 布尔化 | 由 `contractType === 'formal'` 推导 |

退役项：
- 删除 `POST /api/club/registrations` 路由与 `sendRegistration` 相关前端调用；`DeskTab` 的"提交名单"按钮改为只读提示（"名单随合同自动更新"）。
- `registration_check_mode`（`enforce/warn/off`）退役：没有提交闸之后它只剩"红字显不显示"的作用，不值得保留一个能静默关掉合规提示的开关。config 行保留不读，代码删除 `loadRegistrationCheckMode`。
- `checkSquad` 本身保留（教练端实时红字、关窗核验、管理端体检三处共用）。

> 分期注意：期一上线后到三期上线前，`registrations` 不再被写入（最后一次是备赛期旧快照）。这段窗口里所有"当前季"读取都走视图（本表第一行与第二行），历史赛季仍读存档，因此不产生功能空洞；三期上线后由关窗批恢复写入。

### 3.3 薪资三段（期二）

`GET /club/squad` 新增 `wages` 字段：

```
wages: {
  cap: number | null            // 级别帽值（顶级 68 / 次级 58）
  baseline: number | null       // 窗开时该队工资（本窗无基线行则 null）
  now: number                   // Σ 当前 active 合同（= 窗末扣费基数）
  projected: number             // now + 待生效合同增量（hasPending）
  delta: number | null          // now - baseline
  inCount: number               // 本窗转入人数
  outCount: number              // 本窗转出人数
  overspend: number             // max(0, now - cap)
}
```

- `now` 与 `window-payroll.ts:53` 同源（全部 active 合同，含训练营 0.75），**注册口径与扣费口径从此是同一个数**。
- 基线表（迁移 0089）：

```sql
CREATE TABLE club_wage_baselines (
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  wage_total REAL NOT NULL,
  player_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season, window_seq, club_id)
);
```

- 写入点：`openWindow` 的 `openBatch`（`window-machine.ts:181-196`）追加一条 `INSERT ... SELECT ... FROM contracts WHERE is_active = 1 AND club_id IS NOT NULL GROUP BY club_id`，排除 CPU 队。
- `inCount`/`outCount`：`transfers` 里 `completed_at` 落在本窗区间、且 `type` 属于换队类的单据计数。金额拆解暂不做（YAGNI：三段数字已经解决"看不见变化"）。
- 前端 `CapBar`（`web/src/pages/club/CapBar.tsx`）：三段并列 `窗初 → 现在 → 待生效`，超帽段标红并在右侧显示"超 X m"；基线缺失时退化为两段（不显示假的 0）。

### 3.4 关窗核验与关窗页实时看板（期三）

**关窗页实时看板**（用户要求 2026-11-02："关窗的同一页上可以实时看到各队状况"）：`web/src/pages/admin/SeasonsPage.tsx` 的关窗面板（提交口 `POST /api/admin/window/close`，`src/worker/routes/admin/market.ts:140`）在按钮上方渲染一张全联盟表，数据来自新端点 `GET /api/admin/window/overview`：

```
[{ clubId, name, tier, firstTeam, trainee, unsigned, wageNow, wageCap, overspend,
   pass, issues: [{rule, message}], pendingTransfers, activeSessions }]
```

- 现算、不落表、不缓存：每次打开页面/点"刷新"重新算，关窗前看到的就是关窗时会核验的口径。
- 同时把"会挡住关窗"的两类计数前置显示：`pendingTransfers`（`status='pending_review' AND type != 'promotion'`）与 `activeSessions`（`negotiation_sessions.status='active'`），免得管理员点了才发现 409。
- CPU 队灰显、不计入合计。

关窗批（`window-machine.ts:441` 的 `db.batch`）追加两类语句：

> 时点口径：赛季首窗关闭 = 用户说的"开赛"。此后每个窗关闭都跑同一套核验（同一函数、同一份 `issues` 结构），所以 `squad_audits` 每季会有多条（按 `window_seq` 区分），看板默认显示最近一窗。



1. **名单存档**：对每个非 CPU 队 `DELETE FROM registrations WHERE season = ? AND club_id = ?` + 按当窗末镜像逐行 `INSERT`。这是 `registrations` 唯一的写入点。
2. **核验结果**（迁移 0089）：

```sql
CREATE TABLE squad_audits (
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  pass INTEGER NOT NULL,
  issues_json TEXT NOT NULL,   -- [{rule, message, playerIds}] 只留 rule 与人数，message 截断
  stats_json TEXT NOT NULL,    -- {firstTeam, trainee, goalkeepers, ge90, ge87, growthPa87, wageTotal}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season, window_seq, club_id)
);
```

- 读取：关窗批之前现算（`deriveClubTiers` + `loadSquadContext` + `loadSquadView` + `checkSquad`）。
- **不阻断**：核验失败不进任何 `if (issues) throw`；关窗批照常提交，`window_close` 审计里带 `squadAudit: { fail: n, clubs: [clubId...] }`。
- 幂等：`INSERT ... ON CONFLICT(season, window_seq, club_id) DO UPDATE`，重复触发不产生重复行。
- 管理端：`GET /api/admin/squad-audits?season=&windowSeq=` 返回历史；工作台与管理端各显示"最近一次关窗核验"。
### 3.6 交互与展示细则（grilling 定稿）

- **未签约区可点**：整行跳 `/players/:fcId`，球员页能看到完整档案与合同状态。
- **红字布局**：工作台顶部一条「体检」区，逐条列不过的规则（超帽 / 人数 / 门将 / 训练营人数 / CA 名额各一行）；CapBar 只负责工资三段与「超 X m」。逐人问题（`trainee_growth` / `trainee_contract` / `first_team_contract` / `contract`）收在所属分区标题旁，格式「训练营 8 人 · 其中 2 人不合格（张三、李四）」，名字可点。
- **关窗看板**：逐队全列（含 CPU，前端按 `isCpu` 灰显）；默认排序 = 不通过的队在前、按超帽金额降序，其余按队名。
- **核验通知**：`notify.ts` 与 `core/notify-meta.ts` 双写模板 `squad_audit_failed`；关窗批内同批写入，去重键 `(season, window_seq, club_id)`；内容含超帽金额与不过的规则名，不含球员姓名。
- **管理端历史名单报表**：默认全出（含 CPU 行），DTO 带 `isCpu`，前端灰显；`?includeCpu=0` 可关。
- **`registration_check_mode`**：代码删除读取，`config` 表里的行保留不删。

### 3.5 迁移 0089

只新增两张表（`club_wage_baselines` / `squad_audits`）+ 索引 `idx_squad_audits_season`。`registrations` 表结构不动，`tests/d1.ts` 的 `MIGRATION_FILES` 追加文件名。

---

## 4. 不做的事

- 不做"活名单表"，不做名单版本历史（`registrations` 每窗覆盖一次，历史按 season/window 天然分版本）。
- 不做转出金额拆解（只给人数）。
- 不在转会/签约/上调路径加任何工资帽或 CA 名额闸（D4/D6/D8：**写入侧零拦截**，这一条是用户明确裁决的高优先级边界，不接受任何形式的"软拦截"或"二次确认"）。
- 不动 `checkSquad` 的 9 条规则本身，也不改 `wage_cap` 数值。
- 不给教练"不报名"开关（D1）。
- CPU 队不参与核验与基线（`cpuClubIds`）。

---

## 5. 分期（单版本号 v6.67.0，三个提交）

| 期 | 内容 | 可独立上线 |
|---|---|---|
| 一 | `squad-view.ts` + `GET /club/squad` 改现算 + 三项消费方迁移 + 退役提交接口与 `check_mode` + 前端未签约区 | 是（行为变化：不再有提交动作） |
| 二 | 迁移 0089 的 `club_wage_baselines` + `openWindow` 写基线 + `wages` 字段 + `CapBar` 三段 | 是（迁移须先 apply） |
| 三 | `GET /api/admin/window/overview` 实时看板 + 关窗页全联盟表 + 关窗写 `registrations` 存档 + `squad_audits` + 管理端体检页 + 工作台"最近一次核验" | 是 |

---

## 6. 测试

单元/集成（新增）：

- `tests/squad-view.test.ts`：正式/训练营分栏、无合同进 unsigned、退役不进、在售仍在、跨队合同不算。
- `tests/squad-wages.test.ts`：`now` 与 `window-payroll` 汇总一致（同一 fixture 两个口径对拍）、基线缺失时 `delta=null`。
- `tests/squad-audit.test.ts`：关窗写存档 + `squad_audits` 行、超帽时不阻断关窗、重复关窗幂等。
- `tests/squad-notify.test.ts`：不通过的队收到通知、通过的队收不到、同窗重跑不重复发、内容不含球员姓名。
- `tests/window-overview.test.ts`：看板逐队数与关窗核验同口径（同 fixture 下 `GET /api/admin/window/overview` 的 `pass/issues` 与关窗后 `squad_audits` 行一致）、`pendingTransfers`/`activeSessions` 与关窗 409 条件一致。
- 既有 `tests/registration*.test.ts` 全面改写：提交类用例删除，改为"镜像正确性 + 红字正确性"。
- 变异验证：① 让 `loadSquadView` 忽略 `is_active` ⇒ 用例红；② 关窗核验改成 `throw` ⇒ "不阻断"用例红；③ 基线 SQL 漏 `GROUP BY club_id` ⇒ 工资对拍用例红。

回归口径：`npm run typecheck` 三份 tsconfig 全清、`npm test` 全绿、`npm run build` 通过。

---

## 7. 风险与边界

| 风险 | 处置 |
|---|---|
| 现网本季已有 `registrations` 快照，与新视图可能不一致 | 上线后管理端报表改读视图；`registrations` 只在新关窗时被覆盖，旧行保留可查 |
| 前端删除提交入口后教练找不到"名单" | `DeskTab` 顶部加一行说明："名单随合同自动更新；转会/下放/上调即时生效" |
| 训练营人数、CA 名额在窗口期可能长期超限 | 只红字（D4/D6）。若后续要收紧，另开增量，不在本设计里偷加闸 |
| 关窗核验读全联盟合同，关窗时长增加 | 两次查询（contracts join players、clubs）+ 内存聚合；关窗本身已是重操作，可接受；必要时按 club 分页 |
| `demand-rules.registered` 语义变化影响涨薪诉求 | 迁移时对拍：同一球员在旧口径（registrations）与新口径（contract_type）下的布尔值一致；不一致的存量行在测试里列出 |
