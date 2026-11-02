# 实施计划 · v6.67.0 名单镜像与窗口期薪资可视化

设计稿：`docs/superpowers/specs/2026-11-02-squad-mirror-design.md`（提交 `2094d30`）
版本：单版本 **v6.67.0**，三期 = 三个提交，每期可独立上线。
硬约束：未授权不 push / 不 deploy / 不跑 `--remote` 写；迁移 0089 须**先 apply 再 push**。

## 现状锚点（改动前必须对的坐标）

- `GET /club/squad`：`src/worker/routes/registration.ts:134`；契约映射 `loadContractMap`（:82-115）；分栏在 :172-180
- `POST /club/registrations`：`routes/registration.ts:347`；时点闸 `getRegistrableSeason`（`src/worker/seasons.ts:5-10`）
- 校验引擎：`src/core/squad-rules.ts:151` `checkSquad`（9 条规则）
- 规则上下文：`src/worker/squad-context.ts:17` `loadSquadContext(db, tier)`
- 级别派生：`src/worker/tier.ts:184` `deriveClubTiers(env, season, clubIds)`
- 管理端报表：`src/worker/routes/admin/reviews.ts:26`（`GET /api/admin/registrations`）
- 涨薪诉求资格：`src/worker/demand-ops.ts:293`（`LEFT JOIN registrations`）、`src/core/demand-rules.ts:72`（`registered`）
- 开窗批：`src/worker/window-machine.ts:181-196`（`openBatch`），提交在 :235
- 关窗批：`src/worker/window-machine.ts:441-464`
- 工资口径：`src/worker/window-payroll.ts:53`
- 前端工作台：`web/src/pages/club/DeskTab.tsx:263-288`（`stats`）、`:423-424`（cap bar）、`web/src/pages/club/CapBar.tsx`
- 管理端关窗页：`web/src/pages/admin/SeasonsPage.tsx`；接口 `src/worker/routes/admin/market.ts:140`（`POST /window/close`）

---

## 期一 · 名单改视图（提交 1）

**新文件 `src/worker/squad-view.ts`**

```ts
export interface SquadViewRow extends SquadPlayer { status: string; releaseFee: number | null }
export interface SquadView {
  firstTeam: SquadViewRow[];
  trainee: SquadViewRow[];
  unsigned: SquadViewRow[];   // 本队、未退役、无本队 active 合同
}
export async function loadSquadView(env: Env, clubId: number): Promise<SquadView>
```

- SQL 一次取回：`players p LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1 AND ct.club_id = p.club_id`，`WHERE p.club_id = ? AND p.status <> 'retired'`
- 分栏：`ct.contract_type = 'trainee'` → trainee；`ct.contract_type = 'formal'` → firstTeam；`ct.player_id IS NULL` → unsigned
- 复用 `routes/registration.ts` 的 `ContractInfo` 口径（service_ticks/protection_ticks/free_rc_change_used）；把 `loadContractMap` 的字段并入同一查询

**改 `GET /club/squad`**
- 用 `loadSquadView` 代替 `loadOwnedPlayers` + `regRows` 分组
- `compliance` 去掉 `regRows.length > 0` 前置：只要 `tier !== null` 就现算
- `unsigned` 的 playerIds 并进 `contract` 规则红字（`issues` 里已有该规则时合并 playerIds，没有时新增一条）
- 响应结构不变（`players[].squad` 由视图给出），只去掉"未分配"这种取值

**消费方迁移**
- `routes/admin/reviews.ts:26`：当前季（`season === getVisibleSeason`）改走视图 SQL；历史季仍读 `registrations`
- `demand-ops.ts:293`：删 `LEFT JOIN registrations`，改成 `CASE ct.contract_type WHEN 'trainee' THEN 'trainee' ELSE 'first_team' END AS squad`
- `core/demand-rules.ts:72`：`registered` 由调用方传 `contractType`，函数内为 `contractType === 'formal'`

**退役**
- 删 `POST /club/registrations` 与 `parseIdList`（若仅此处用）
- 删 `loadRegistrationCheckMode` / `RegistrationCheckMode` / `parseRegistrationCheckMode` / config 读取（`squad-rules.ts:31-46`）
- 前端：`DeskTab.tsx` 移除提交按钮与 `useSubmitRegistration`；顶部加说明"名单随合同自动更新"
- `web/src/lib/queries.ts` 对应类型与 hook 同步

**测试**
- 新 `tests/squad-view.test.ts`（≥5 例）：正式/训练营分栏、无合同进 unsigned、退役不进、在售仍在、跨队合同不算
- 改 `tests/registration*.test.ts`：删提交类用例，保留/改写校验类
- 变异：`loadSquadView` 去掉 `is_active = 1` ⇒ 必红

**验收**：`npx tsc --noEmit -p tsconfig.worker.json` 清、`npm test` 全绿、`npm run build` 通过

---

## 期二 · 薪资三段（提交 2，含迁移 0089 前半）

**迁移 `src/db/migrations/0089_squad_wages_audit.sql`**

```sql
CREATE TABLE IF NOT EXISTS club_wage_baselines (
  season INTEGER NOT NULL, window_seq INTEGER NOT NULL, club_id INTEGER NOT NULL,
  wage_total REAL NOT NULL, player_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season, window_seq, club_id)
);
```

同步 `tests/d1.ts` 的 `MIGRATION_FILES`。

**开窗写基线**（`window-machine.ts` 的 `openBatch`）
- 追加 `INSERT INTO club_wage_baselines (season, window_seq, club_id, wage_total, player_count) SELECT ?, ?, ct.club_id, ROUND(SUM(ct.wage), 2), COUNT(*) FROM contracts ct WHERE ct.is_active = 1 AND ct.club_id IS NOT NULL AND ct.club_id NOT IN (${cpuList}) GROUP BY ct.club_id ON CONFLICT(season, window_seq, club_id) DO NOTHING`
- CPU 列表用 `cpuClubIds(env)`（`src/worker/growth.ts`）；空列表时退化为不排除

**`GET /club/squad` 新增 `wages`**
- `now`：与 payroll 同口径 `SELECT ROUND(SUM(wage),2), COUNT(*) FROM contracts WHERE club_id = ? AND is_active = 1`
- `baseline`：查本窗基线行（`currentWindow` 的 season/windowSeq），无行 → `null`
- `projected`：`now + Σ(pendingWage − wage)`（沿用现有 `pendingWageDelta` 逻辑）
- `cap`：`loadSquadContext(db, tier).wageCap`
- `inCount`/`outCount`：`transfers` 本窗区间内 `completed` 且换队类（`type IN ('transfer','activation','forced_auction','free_agent')`）按 `to_club_id`/`from_club_id` 计数
- `overspend = max(0, now - cap)`

**前端**
- `CapBar.tsx` 改三段：`窗初 → 现在 → 待生效`；`baseline === null` 只渲染两段
- 超帽：数字标红 + `超 X m`；距帽内：`剩余 Y m`
- `DeskTab.tsx` 的 `stats` 改用 `wages.now`（不再前端累加 `assign`），未签约区单列显示人数

**测试**
- 新 `tests/squad-wages.test.ts`：同一 fixture 下 `wages.now` 与 `window-payroll` 汇总相等；基线缺失 → `delta=null`；`inCount/outCount` 正确
- 变异：基线 SQL 漏 `GROUP BY` ⇒ 对拍用例红

---

## 期三 · 关窗看板 + 核验存档（提交 3，含迁移 0089 后半）

**迁移补表**

```sql
CREATE TABLE IF NOT EXISTS squad_audits (
  season INTEGER NOT NULL, window_seq INTEGER NOT NULL, club_id INTEGER NOT NULL,
  pass INTEGER NOT NULL, issues_json TEXT NOT NULL, stats_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season, window_seq, club_id)
);
CREATE INDEX IF NOT EXISTS idx_squad_audits_season ON squad_audits(season, window_seq);
```

**新端点 `GET /api/admin/window/overview`**（`src/worker/routes/admin/market.ts`）
- 鉴权 `requireAdmin(..., 'club.registrations.manage')`
- 逐队：`firstTeam/trainee/unsigned` 计数、`wageNow`、`wageCap`、`overspend`、`pass`、`issues[{rule,message}]`、`pendingTransfers`、`activeSessions`
- CPU 队标 `isCpu: true`，不进合计
- 与关窗核验共用同一函数：`buildSquadAudit(env, clubIds, season)` → `Map<clubId, SquadCheckResult>`

**关窗批追加**（`window-machine.ts:441` 的 `db.batch`）
- 关窗前算 `audits`
- 每队：`DELETE FROM registrations WHERE season=? AND club_id=?` + 按镜像逐行 `INSERT`
- 每队：`INSERT INTO squad_audits ... ON CONFLICT DO UPDATE`
- `window_close` 审计 after 加 `squadAudit: { fail, clubs }`
- **不抛错**：任何 `!pass` 都不进 `if` 抛错分支

**管理端页**
- `SeasonsPage.tsx` 关窗面板上方渲染全联盟表（列：球队/级别/一线队/训练营/未签约/工资/帽值/超帽/不过的规则/待审单/在谈）
- 新增 `GET /api/admin/squad-audits?season=&windowSeq=` 历史查询；面板底部显示"最近一窗核验"结果
- 教练端 `DeskTab` 显示"最近一次关窗核验"（只读，含失败规则）

**测试**
- 新 `tests/window-overview.test.ts`：看板 `pass/issues` 与关窗后 `squad_audits` 一致；`pendingTransfers/activeSessions` 与 409 条件一致
- 新 `tests/squad-audit.test.ts`：关窗写存档 + 审计行、超帽不阻断（关窗仍 200）、重复关窗幂等
- 变异：核验改成 `throw` ⇒ "不阻断"用例红

---

## 上线顺序（获得授权后）

1. `npx wrangler d1 migrations apply whl-club --remote`（0089）
2. `git push origin HEAD:main` → CF 自动部署
3. 回读：`/api/health` 200、入口 bundle 版本串 `6.67.0`、`GET /club/squad` 的 `wages` 字段存在

## 回滚

- 0089 只新增表，回滚 = 代码回退，表保留不影响旧代码（旧代码不读这两张表）
- 期一回退后 `registrations` 仍为旧快照，提交接口随代码一起回来

## 风险

| 风险 | 处置 |
|---|---|
| 删提交接口后，前端仍有入口调用 → 404 | 同期删 hook/按钮/测试；`grep -rn "club/registrations"` 清零作为验收项 |
| `demand-rules.registered` 语义变化 | 期一对拍用例：旧口径与新口径布尔值一致的球员集合断言 |
| 关窗批变长 | 核验在批外先算；批内只加 INSERT/DELETE（每队 ~1 + N 条） |
| 基线表首窗缺失（历史数据） | `baseline=null` → 前端退化为两段，不显示 0 |
