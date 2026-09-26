# 生产数据订正 · audit_log.origin 历史行回填

**状态：已执行（2026-09-26）。** 100 行全部回填，验收 `null_origin = 0`、`bad1`–`bad4` 全 0（见「执行结果」）。回滚见 `99-rollback.sql`。

## 背景

v6.3.2 给 `audit_log` 加了 `origin` 列（迁移 `src/db/migrations/0039_audit_origin.sql`），回答「这条审计是哪条入口触发的」。
新代码的所有审计写入点都声明了来源通道，但**迁移之前已有的行 `origin` 为 NULL**（NULL = 历史行 / 未知，列刻意可空）。
本目录把其中「按旧代码能确凿认定触发通道」的行回填，让管理端审计日志（`GET /api/admin/audit-log`）的「来源」列不再大面积显示「—（历史行）」。

五个取值（`src/lib/audit.ts` 的 `AuditOrigin`）：

| origin | 含义 |
| --- | --- |
| `user` | 人类请求直接触发（管理端、教练自助、玩家操作） |
| `cron_tick` | 定时任务兜底（`runSettleTick`，cron 与 `POST /api/cron/tick` 共用） |
| `lazy_settle` | 业务请求顺手结算过期项（读市场 / 报价 / 谈判列表时触发，不是人类主动要求结算） |
| `backchannel` | 认证中心推送的全端登出 |
| `machine` | 内部机器通道（无人类行为人） |

## 预检快照（2026-09-26，只读实测，`Rows written = 0`）

`audit_log` 共 **100 行，max_id = 100**。按 (action, actor) 分布：

| action | actor | 行数 | 时间跨度 |
| --- | --- | --- | --- |
| `result_confirm` | 0 | 74 | 2026-09-20T05:45:06.359Z → 2026-09-25T13:15:37.697Z |
| `auth_login` | 1 / 13 / 14 / 18 | 7 / 6 / 1 / 1 | 2026-09-20T05:49:36.836Z → 2026-09-26T05:08:41.884Z |
| `auth_backchannel_logout` | 0 | 3 | 2026-09-20T05:49:18.629Z → 2026-09-23T04:52:49.193Z |
| `season_bind_tournament` | 1 | 3 | 2026-09-18T00:32:30.356Z → 2026-09-18T00:32:41.709Z |
| `auth_logout` | 1 | 1 | 2026-09-20T05:49:14.804Z |
| `club_bind` | 13 / 14 / 18 | 1 / 1 / 1 | 2026-09-21T07:38:28.546Z → 2026-09-24T04:50:13.677Z |
| `season_create` | 1 | 1 | 2026-09-18T00:32:17.537Z |

规则命中：`lazy_settle` **0** 条、`cron_tick` **74** 条、`backchannel` **3** 条、`user` **23** 条 —— 合计 100 条，**回填后无 NULL 残留**。

## 回填口径

四条 UPDATE（`02-backfill.sql`），每条都带 `origin IS NULL` 守卫，重跑 changes 全为 0：

1. `actor IS NULL AND action IN ('listing_settle','listing_delist','activation_void','bid_pattern_alert')` → `lazy_settle`
   旧代码这条路径的 actor 本来就是 NULL（`settleOverdue` 手上没有 actor）。生产上命中 0 条（尚无市场成交）。
2. `actor = 0 AND action = 'result_confirm'` → `cron_tick`
   旧代码的 `autoConfirmResults` 写哨兵 `0`；人工确认写的是管理员 id，不会被这条命中。
3. `actor = 0 AND action = 'auth_backchannel_logout'` → `backchannel`
4. `actor IS NOT NULL` → `user`
   推理依据：旧代码里**只有机器路径会写 `actor = 0`**（即上面 ②③ 两处），没有任何机器路径会把人类 id 传下来 ⇒ actor 非空即人类请求直接触发。
   生产实测命中 `auth_login` / `auth_logout` / `club_bind` / `season_create` / `season_bind_tournament` 五类，都是人点出来的（登录回调、教练绑定球队、管理端建赛季 / 绑赛事）。
   不加这条的话 100 行里 23 行永远是「未知」，与本次「审计要说清通道」的目标不符。

**刻意不做**：不把 `actor = 0` 改成 NULL。`0` 是历史哨兵，前端按「系统」兼容显示（`web/src/pages/admin/SystemPage.tsx` 的 `e.actor === null || e.actor === 0`），改它会动到既有行的语义；通道已由 `origin` 说明，新代码不再写 `0`（由 `tests/ledger-audit-lock.test.ts` 钉住）。

## 不可逆影响面

- 只改 `audit_log.origin` 一列，**不碰 actor、不碰其它列、不碰其它表**。
- 影响 100 行（截至 2026-09-26）。没有触发器、没有外键、没有下游缓存依赖这一列（读侧只有管理端审计日志端点）。
- 可逆：`99-rollback.sql` 把 `id <= 100` 的 origin 清回 NULL。

## 执行顺序

```bash
# 1) 先加列：代码引用 origin，迁移没跑之前任何审计 INSERT 都会报 no such column: origin
npm run db:migrate:remote

# 2) 预检（只读）：看分布、三条规则计数、残余
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-audit-origin-backfill/01-precheck.sql

# 3) 回填（写）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-audit-origin-backfill/02-backfill.sql

# 4) 验收（只读）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-audit-origin-backfill/03-verify.sql
```

注意：`--file` **只回 summary**（Total queries executed / Rows read / Rows written），**不回各语句结果集**。要看 01 / 03 的数据，逐条改用 `--command=` 配 `--json`（输出前面有 wrangler banner，解析时取第一个 `[` 到最后一个 `]`，行数组在 `o[0].results`）：

```bash
npx wrangler d1 execute whl-club --remote --json \
  --command="SELECT (SELECT COUNT(*) FROM audit_log WHERE origin IS NULL) AS null_origin"
```

远程单次查询约 1 分钟；**不要**把 wrangler 输出接 `| tail`（管道缓冲，进程结束前一直是空的，会误判成卡死），直接 `> 文件` 重定向。

## 验收期望（2026-09-26 口径）

`03-verify.sql` 第一条应回：

| 字段 | 期望 |
| --- | --- |
| `total` | 100（跑得晚则更大，多出来的是新代码写的行） |
| `null_origin` | **0** |
| `user_rows` | 23 |
| `cron_tick_rows` | 74 |
| `backchannel_rows` | 3 |
| `lazy_settle_rows` | 0 |
| `machine_rows` | 0 |
| `other_rows` | 0 |
| `bad1` / `bad2` / `bad3` / `bad4` | 全 0 |

## 执行结果（2026-09-26，已落地生产）

回填前再次只读预检，确认工件假设仍成立：`total = 100`、`max_id = 100`、`origin IS NULL = 100`、`origin IS NOT NULL = 0`（⇒ 迁移与新代码上线后还没有新审计行写入）、`id > 100` 的 NULL 行 **0** 条（⇒ `99-rollback.sql` 的 `id <= 100` 边界仍准确）。

`02-backfill.sql` 执行（`npx wrangler d1 execute whl-club --remote --yes --file=…`）：

```
Total queries executed: 4    Rows read: 452    Rows written: 200    Database size: 31.37 MB
sql_duration_ms 4.10   changed_db true   served_by v3-prod (APAC / KIX)
```

`03-verify.sql` 第一条回读（只读，`Rows written = 0`）：**与期望逐项一致**。

| 字段 | 期望 | 实测 |
| --- | --- | --- |
| `total` | 100 | **100** |
| `null_origin` | 0 | **0** |
| `user_rows` | 23 | **23** |
| `cron_tick_rows` | 74 | **74** |
| `backchannel_rows` | 3 | **3** |
| `lazy_settle_rows` | 0 | **0** |
| `machine_rows` | 0 | **0** |
| `other_rows` | 0 | **0** |
| `bad1` / `bad2` / `bad3` / `bad4` | 全 0 | **全 0** |

回填后按 (origin, action, actor) 的分布（回填后实测）：

| origin | action | actor | 行数 | 时间跨度 |
| --- | --- | --- | --- | --- |
| `backchannel` | `auth_backchannel_logout` | 0 | 3 | 2026-09-20T05:49:18.629Z → 2026-09-23T04:52:49.193Z |
| `cron_tick` | `result_confirm` | 0 | 74 | 2026-09-20T05:45:06.359Z → 2026-09-25T13:15:37.697Z |
| `user` | `auth_login` | 1 / 13 / 14 / 18 | 7 / 6 / 1 / 1 | 2026-09-20T05:49:36.836Z → 2026-09-26T05:08:41.884Z |
| `user` | `season_bind_tournament` | 1 | 3 | 2026-09-18T00:32:30.356Z → 2026-09-18T00:32:41.709Z |
| `user` | `auth_logout` | 1 | 1 | 2026-09-20T05:49:14.804Z |
| `user` | `club_bind` | 13 / 14 / 18 | 1 / 1 / 1 | 2026-09-21T07:38:28.546Z → 2026-09-24T04:50:13.677Z |
| `user` | `season_create` | 1 | 1 | 2026-09-18T00:32:17.537Z |

**未执行**：`99-rollback.sql`（不需要）。**未做**：`actor = 0` 的历史哨兵保持原样（见「回填口径」的刻意不做）。

## 回滚

```bash
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-audit-origin-backfill/99-rollback.sql
```

`99-rollback.sql` 用 `id <= 100` 作边界（2026-09-26 的 max_id），所以它**只清本次回填碰过的行**，不会抹掉迁移 0039 之后新代码正常写入的 origin。若执行时间晚于 2026-09-26，先把边界换成当时的 max_id。

## 执行状态

| 步骤 | 状态 |
| --- | --- |
| 工件（01/02/03/99 + 本 README） | ✅ 已就绪 |
| 只读预检（本 README 的快照） | ✅ 已跑（2026-09-26，Rows written = 0） |
| `npm run db:migrate:remote`（加 origin 列） | ✅ 已执行（2026-09-26T08:26Z 前，`Executed 3 commands in 2.13ms`；回读 `audit_log` 末列 `origin:TEXT`、`idx_audit_log_origin (origin, id DESC)` 在场，100 行 `origin` 全 NULL） |
| `02-backfill.sql`（写生产） | ✅ 已执行（2026-09-26，`Rows written = 200`、`Total queries executed = 4`、`changed_db true`） |
| `03-verify.sql`（只读验收） | ✅ 已执行（2026-09-26，`null_origin = 0`、五个桶 23/74/3/0/0、`bad1`–`bad4` 全 0） |
| `99-rollback.sql` | ⬜ 未执行（无需回滚） |
