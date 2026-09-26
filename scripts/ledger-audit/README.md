# 财政域留痕覆盖（ledger-audit）

**性质：只读。** 本目录不含任何写库脚本，只有一份可随时复跑的复核 SQL（[`coverage.sql`](./coverage.sql)）与本报告。

## 1. 这份报告解决什么问题

v6.3.0 之前，账本（`ledger_entries`）只保证**钱对不对**（流水 + 余额 + 守恒），不保证**人认不认领**。
2026-09-26 的生产普查发现：唯一一笔非自动支出（球场扩建 −0.50M）在 `audit_log` 里**一条痕都没有**，
操作人只能靠相邻的 `club_bind` 审计行反推。这就是本报告的缘起，v6.3.1 把该缺口补齐并把结论锁进测试。

## 2. 底座事实（先看清分工，别在错的地方找审计）

- 账本原语 `ledgerMovement(db, input)`（`src/worker/ledger.ts:28`）返回**两条**语句：`ledger_accounts` 差额 upsert + `ledger_entries` 流水（同批读更新后的余额作 `balance_after`）。**它自己不含审计**，留痕一律由调用点负责。
- 审计语句工厂 `createAuditStatement(db)`（`src/lib/audit.ts:11`）返回一个 `(input) => D1PreparedStatement`，SQL 固定为
  `INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at) VALUES (?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`，`before`/`after` 走 `JSON.stringify`。
- `writeAudit`（`src/lib/audit.ts:28`）是批外补记的便捷封装。
- 纪律（`TECH_DESIGN.md` §17.3-1）：**一笔业务（流水 + 余额 + 审计）合并进单个 `db.batch`**，不许两段式——所以审计语句要 `push` 进同一个语句数组，不是事后补写。

## 3. 覆盖表（v6.3.1 现状，origin 列 v6.3.2 补）

「留痕」列写 `—（白名单）` 的表示**有意不留**，理由见 §4。「origin」列是 v6.3.2 新增的来源通道（`AuditOrigin`，见 `TECH_DESIGN.md` §17.6），白名单行没有审计行 ⇒ 无 origin。

| 账本 kind | 写入点 | 审计 action（落点） | actor 来源 | origin |
|---|---|---|---|---|
| `revenue` | `src/worker/home.ts:311` | —（白名单） | 自动：赛果确认触发 | — |
| `maintenance` | `src/worker/home.ts:376` | —（白名单） | 自动：关窗批 | — |
| `prize`（逐场） | `src/worker/prizes.ts:172` | —（白名单） | 自动：赛果确认触发 | — |
| `prize`（赛季阶段） | `src/worker/season-settle.ts:157` | `tournament_stage_settle`（`season-settle.ts:159`） | 触发结算的管理员 | `user` |
| `loyalty` | `src/worker/season-settle.ts:279` | `loyalty_bonus`（`season-settle.ts:289`） | 同上传入的 actor | `user` |
| `wage` / `luxury_tax` | `src/worker/window-payroll.ts:95` | —（白名单，汇总进 `window_close`） | 关窗管理员 | — |
| `naming_fee` / `naming_bonus` | `src/worker/naming-ops.ts:239` / `:266` | —（白名单，汇总进 `window_close`） | 关窗管理员 | — |
| `naming_penalty` | `src/worker/naming-ops.ts:200` | **`naming_terminate`**（`naming-ops.ts:215`，v6.3.1 新增） | 自助端点传入的 `user.id`；赔款为 0 也留痕 | `user` |
| `stadium_expand` | `src/worker/stadium-ops.ts:118` | **`stadium_expand`**（`stadium-ops.ts:141`，v6.3.1 新增） | 自助端点传入的 `user.id` | `user` |
| `stadium_upgrade` | `src/worker/stadium-ops.ts:185` | **`stadium_upgrade`**（`stadium-ops.ts:206`，v6.3.1 新增） | 同上 | `user` |
| `facility_upgrade` | `src/worker/stadium-ops.ts:248` | **`facility_upgrade`**（`stadium-ops.ts:278`，v6.3.1 新增） | 同上 | `user` |
| `rc_change_fee` / `free_agent_fee` / `match_diff_burn` | `src/worker/bypass.ts:89`（`chargeBypassFee`） | **`bypass_fee`**（`bypass.ts:83` 手写 INSERT，v6.3.1 新增） | `approveTransferDeal(env, id, actor, review)` 的管理员 actor（唯一调用点 `src/worker/routes/admin/reviews.ts:291`） | `user` |
| `rc_change_refund` | `src/worker/bypass.ts:681` | `rc_change_rollback`（`bypass.ts:694`） | 同上 | `user` |
| `transfer_in` / `transfer_out` / `transfer_tax` | `src/worker/transfers.ts:166` / `:179` / `:190` | `transfer_complete`（`transfers.ts:319`） | 过户确认者 | 调用方传入：人类入口 `user`，谈判 GET 自愈扫描 `lazy_settle` |
| `termination_fee` | `src/worker/transfers.ts:363` | `transfer_complete`（`transfers.ts:410`，note 里 `type: 'termination'`） | 同上 | `user` |
| `delist_fee` | `src/worker/market-settle.ts:156` | `listing_delist`（`market-settle.ts:172`） | 无人类行为人 ⇒ `actor` 为 NULL（见 §5-1） | 调用方传入：cron tick `cron_tick`、业务 GET 顺手结算 `lazy_settle`、管理员干预 `user` |
| `opening_import` | `src/worker/routes/admin/finance.ts:66-73`（**手写** `ledger_accounts` + `ledger_entries` INSERT，不走 `ledgerMovement`） | `ledger_opening_import`（`finance.ts:77`） | 管理员 | `user` |
| `manual_adjust` / `prize_*` | `src/worker/routes/admin/finance.ts:113` | `ledger_manual`（`finance.ts:124`，kind 白名单正则 `MANUAL_KIND_RE` 在 `:89`，`idempotent:false`） | 管理员 | `user` |

**不在范围里的**：`signNaming`（`src/worker/naming-ops.ts:150-174`）只插 `naming_contracts` 行、**不写任何账本** ⇒ 签约不属财政写入，故没有留痕要求。管理端改球场（`src/worker/routes/admin/clubs.ts:331`）早有 `stadium_update` 审计，本次未动。

## 4. 白名单：为什么这三处自动路径故意不留痕

用户 2026-09-26 裁决的口径是「补齐**人类触发**的财政写入」，自动路径不补 actor，登记为「接受设计」：

| 文件 | 理由 |
|---|---|
| `src/worker/ledger.ts` | 账本原语自身，留痕是调用点的责任（分层） |
| `src/worker/home.ts` | 比赛日收入与球场维护：`ref_type='match'`／`'window'` 已把业务锚回赛果与窗口，收入可逐场重建；无人类操作语义 |
| `src/worker/prizes.ts` | 逐场奖金：赛果确认即触发（`result_confirm` 已有审计），`ref_type` 指向该场，可重建 |
| `src/worker/window-payroll.ts` | 工资/富人税：并入关窗批，逐类汇总已写进 `window_close` 审计的 `after`（`{ payroll: payroll.summary, home: home.summary }`），可归因到关窗操作 |

## 5. 已知次级缺陷（第 1 条已修，第 2 条仍登记）

1. **~~cron 触发的审计 actor 为 NULL/0~~（v6.3.2 已修）**：`listing_delist` / `listing_settle` / `bid_pattern_alert` / `activation_void` 走 `settleOverdue`（原 `src/worker/market-settle.ts:224` 的 `actor = opts.actor ?? null`），cron 调用点 `src/worker/index.ts:173` 不传 actor ⇒ NULL；自动赛果确认（原 `src/worker/results.ts:407`）写 `actor = 0`。没有操作人可归因是**事实**（确实没有人类），但排查时会把它们和「忘了传 actor」混在一起。**v6.3.2 起**：`actor` 统一为 NULL（`0` 哨兵退役），通道由新增的 `origin` 列正面回答——cron 走 `cron_tick`、业务 GET 顺手结算走 `lazy_settle`、管理员干预走 `user`；`GET /api/admin/audit-log?origin=` 可直接过滤。契约见 `TECH_DESIGN.md` §17.6。
2. **`bypass_fee` 是手写 INSERT 的唯一例外**（`src/worker/bypass.ts:83`）：因为 `createAuditStatement` 表达不了 `WHERE`，而这条审计必须与账本自己的幂等闸（同 `kind`+`ref_type`+`ref_id` 是否已有流水）**以及批内余额/状态守卫逐字一致**，否则审核重放或并发动用余额时会留下「钱没扣、审计说扣了」的失实行。审计排在账本**之前**落库，两者评估同一份库存状态；守卫取值改为 `results[statements.length - 1]?.meta.changes`（末条是 `transfers` 的 UPDATE）。

## 6. 生产实证（2026-09-26，生产库只读）

- 订正前：`ledger_entries` 162 笔 / 16 户 / 余额合计 **715.56**；kind 分布 `prize=103`、`revenue=58`、`stadium_expand=1`。
- 唯一非自动流水：`id=141`，`club_id=33`（慕尼黑1860），`stadium_expand`，`amount=-0.5`，`balance_after=49.01`，`ref_type='stadium'`/`ref_id=33`，memo「球场扩建 +500 座（费用 0.50M）」，`created_at=2026-09-21T07:38:46.192Z`；操作人由邻行 `audit_log` 的 `club_bind actor=13 target_id=33 @2026-09-21T07:38:28.546Z` 推定（该队教练自助操作）。
- `audit_log` 96 行，action 分布 `result_confirm 71 / auth_login 14 / season_bind_tournament 3 / club_bind 3 / auth_backchannel_logout 3 / season_create 1 / auth_logout 1` ⇒ **财政类审计 0 条**（`stadium_update` 也没有——管理端从未改过球场）。
- 该笔扩建的实际影响面：`club 33` 历史最大上座 **10140** < 原 `capacity 12000` < 扩建后 `12500` ⇒ 从未影响过任何一场的上座或收入，回滚的业务影响为零。
- 订正后（v6.3.1 已在生产执行，见 `scripts/prod-20260926-rollback-stadium-expand/README.md`）：`stadiums` club 33 回到 `capacity=12000`/`build_credit=0`；`ledger_entries` 163 笔，新增补偿流水 `id=163`（`manual_adjust` +0.5，`balance_after=56.51`，memo 指回原流水 `id=141`）；**原流水 id=141 未删未改**（账本只增，删行会破坏 `balance_after` 链）；守恒断言 `Σbalance − Σamount = 0`。
- `audit_log` 二次普查（2026-09-26，v6.3.2 回填预检，只读 `Rows written = 0`）：共 **100 行 / max_id 100**，action 分布 `result_confirm 74（actor=0）` / `auth_login 15` / `auth_backchannel_logout 3（actor=0）` / `season_bind_tournament 3` / `club_bind 3` / `auth_logout 1` / `season_create 1`；**财政类审计仍为 0 条**（v6.3.1 的三处人类留痕尚未在生产产生过数据，因为此后没有球场/冠名/审核类操作）。origin 回填口径与期望值见 `scripts/prod-20260926-audit-origin-backfill/README.md`。

## 7. 权威锚点

- `TECH_DESIGN.md` §17.3-1：「钱的原子性比比赛系统更严：一笔业务（流水 + 余额 + 审计）合并进单个 `db.batch`（隐式事务）一次提交」。
- `TECH_DESIGN.md` §17.5（v6.3.1 新增）：「财政域留痕覆盖」小节，与本报告同源。
- `TECH_DESIGN.md` 管理端球场章节：「GET/POST /clubs/:id/stadium（球场名/容量/档位/队壳影响力/奖励分，**stadium_update 审计**）」——自助端点此前漏的正是这一条对等要求。
- `PRD.md` 管理组权限与审计：「所有敏感操作进审计日志」。

## 8. 同源锁：把结论钉成可自动检查的约束

`tests/ledger-audit-lock.test.ts`（9 例）静态扫描 `src/**`，四条留痕约束：

1. 白名单里的文件必须**仍然**在写账本（防止白名单腐烂成万能豁免），并断言 `stadium-ops` / `naming-ops` / `bypass` 三个已知人类触发路径在场；
2. 白名单之外凡含 `ledgerMovement(` 的文件必须同时含 `createAuditStatement(` 或 `writeAudit(`；
3. `INSERT INTO audit_log` 只允许出现在 `src/lib/audit.ts` 与 `src/worker/bypass.ts`（后者是 §5-2 的例外）；
4. `src/worker/routes/clubs.ts` 里四个自助财政端点（`expandStadium` / `upgradeStadiumTier` / `upgradeFacilityLevel` / `terminateNaming`）的调用必须把 `user.id` 传下去；`src/worker/window-machine.ts` 的 `window_close` 审计 600 字符内必须出现 `payroll: payroll.summary` 与 `home: home.summary`。

另有 v6.3.2 的来源通道四条（同文件，共 9 例）：

5. `src/**` 内 `actor: 0` 哨兵绝迹（正则前后收紧，避开 `factor: 0.85` 这类误伤）；
6. 上面两处手写 `INSERT INTO audit_log` 的列清单都必须含 `origin`（tsc 管不到手写 SQL，只能靠这条）；
7. `AuditOrigin` 声明含五个取值；
8. 四个机器常量（`cron_tick` / `lazy_settle` / `backchannel` / `machine`）确实在 `src/lib/audit.ts` 之外被用上（防「声明了却没人用」）。

行为侧另有断言兜底：`tests/stadium-ops.test.ts`（含端点 actor=1、before/after 形状与落库 `origin: 'user'`）、`tests/naming-ops.test.ts`（赔款 0 也留痕）、`tests/window-machine.test.ts`（`window_close.after` 的汇总与逐 kind 流水对账）、`tests/bypass-routes.test.ts`（通过留一条、驳回零留痕）、`tests/admin-system.test.ts`（`?origin=` 精确过滤与 `origin` 字段）、`tests/results.test.ts` / `tests/oidc.test.ts`（机器行为 `actor = null` + `origin` 为 `cron_tick` / `backchannel`）。

## 9. 怎么复跑

```bash
# 只读复核：逐条取出 coverage.sql 里的 SELECT，压成单行后执行（--file 通道不回结果集）
npx wrangler d1 execute whl-club --remote --json --command "<单行 SELECT>"
```

`coverage.sql` 里 S3 是守恒硬断言（`drift` 必须为 0），S4 是留痕覆盖计数（人类触发的 kind 都应出现），S2 是「需要人工解释的每一笔」清单——**新增任何非 prize/revenue 流水时先跑 S2**。S11 / S12 是 v6.3.2 的来源通道分布（S11 全表按 `origin` 分组，S12 把财政类 action 按 `origin` 拆开）。
