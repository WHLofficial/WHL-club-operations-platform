# prod-20261102-rollback-stadium-243

回滚皇马（`clubs.id = 243`，圣地亚哥·伯纳乌球场）2026-11-02 下午的两笔球场支出：扩建 +8000 座（−8.00M）与升级到地区级（现金 −1.80M + 消费券 −1.20M）。

- 执行日期：2026-11-02
- 授权：用户 2026-11-02 指令「将这两个回滚掉」（m00079）
- 状态：**已执行**（2026-11-02T09:34:32.004Z，D1 bookmark `000034bc-…`）

## 背景

两笔操作由账号 8「鲸落」在消费中心自助完成，原流水：

| 时间（UTC） | 流水 | 金额 | 内容 |
|---|---|---|---|
| 2026-11-02T08:25:13.933Z | `ledger_entries` 702 `stadium_expand` | −8.00M | 球场扩建 +8000 座，capacity 12000 → 20000；返还消费券 +1.20（15%） |
| 2026-11-02T08:36:35.378Z | `ledger_entries` 703 `stadium_upgrade` | −1.80M | 球场升级 → 地区级，tier 0 → 1；标价 3.00M，券抵 1.20，返还券 +0.45 |

对应券流水：`voucher_entries` 83 `build_refund` +1.20、84 `build_use` −1.20、85 `build_refund` +0.45。

## 预检快照（2026-11-02T09:2xZ，只读）

`01-precheck.sql` 跑通（9 条语句、877 行读、0 行写），关键值：

| 项 | 值 |
|---|---|
| `stadiums` 243 | capacity **20000** / tier **1** / build_credit 0 / updated_at 2026-11-02T08:36:35.378Z |
| `ledger_accounts` 243 | balance **11.779999999999994** / vouchers **0.45** |
| 原流水 | 702 `stadium_expand` −8.00、703 `stadium_upgrade` −1.80，均在 |
| 原券流水 | 83 +1.20 / 84 −1.20 / 85 +0.45，均在 |
| 两笔之后 | 账本新增 **0** 条、主场出勤 **0** 场、设施五键全 **0** 级、冠名合同 **0** 条 |
| 双守恒 | `Σbalance − Σamount = 0`、`Σvouchers − Σvoucher_entries.amount = 0` |

## 回滚口径

**补偿分录，保留原流水**（与 `scripts/prod-20260926-rollback-stadium-expand` 同口径）。`ledger_entries` / `voucher_entries` 都是只增账本，删 702/703/83–85 会打断 `balance_after` 链；原行不动，补反向流水：

| 新增 | 内容 |
|---|---|
| `ledger_entries` 704 `manual_adjust` +8.00 | 回滚扩建，balance_after 19.78 |
| `ledger_entries` 705 `manual_adjust` +1.80 | 回滚升级，balance_after 21.58 |
| `voucher_entries` 86 `build_refund` +1.20 | 退回升级时抵扣的 1.20（原 84），balance_after 1.65 |
| `voucher_entries` 87 `build_use` −1.20 | 收回扩建返还的 1.20（原 83），balance_after 0.45 |
| `voucher_entries` 88 `build_use` −0.45 | 收回升级返还的 0.45（原 85），balance_after 0 |
| `audit_log` 3845 `stadium_rollback` | actor NULL / origin user，before/after 记录两支原流水与券流水 id |

`stadiums` 回到 capacity **12000** / tier **0**（`updated_at` 改为执行时刻）。

为什么不删原行：删 702/703 会让后续 `balance_after` 链断裂；券流水同理。补偿分录后全表双守恒仍为 0。

## 影响面

- 只动 club 243 的 `stadiums`、`ledger_accounts`、2 条账本、3 条券流水、1 条审计。
- 两笔之后 **0 场主场**、**0 条新账本流水**、设施五键全 0、冠名合同 0 条 ⇒ 不需要重算上座、门票/商业/转播收入、球迷增速或设施上限。
- `capacity` / `tier` 不在任何 `cachedJson` 公开端点（先例 README 已逐项核对）⇒ **不 bump `cache:epoch:public`**。
- 不发站内信；账号 8「鲸落」不会收到自动通知。

## 执行

```bash
# 1) 预检（只读）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261102-rollback-stadium-243/01-precheck.sql

# 2) 正向订正（写生产：12 条语句，D1 import 整批）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261102-rollback-stadium-243/02-rollback.sql

# 3) 验收：远端 --file 走 import 不返回结果行；把 03-verify.sql 的首个 SELECT
#    作为 --command 执行（本次实测用的就是该 SELECT，返回值见下表）
npx wrangler d1 execute whl-club --remote --json --command "<03-verify.sql 的首个 SELECT>"
```

执行回执：`Processed 12 queries` / `Executed 12 queries` / `104 rows read` / `23 rows written` / `last_row_id 3845` / bookmark `000034bc-0000000a-00005117-3e128d4632f2dd4f6edda43026465eaf`。

口径说明：远端 `--file` 在 wrangler 4.131 走 D1 import 通道，只回执汇总、不打印 SELECT 结果；02 的守卫因此不依赖批内 `changes()`，而是按「前一步余额/券余额 + 前一步流水已存在」串链（见 02 头部注释）。

## 验收结果（2026-11-02T09:34:32.004Z 后回读）

| 探针 | 期望 | 实测 |
|---|---|---|
| `cap_243` | 12000 | **12000** |
| `tier_243` | 0 | **0** |
| `bal_243` | 21.58 | **21.58** |
| `vouchers_243` | 0 | **0** |
| `cash_rows` / `cash_sum` | 2 / 9.80 | **2 / 9.8** |
| `orig_ledger` / `orig_vouchers` | 2 / 3 | **2 / 3** |
| `voucher_rows` / `voucher_sum` | 3 / −0.45 | **3 / −0.45** |
| `audit_rows` | 1 | **1** |
| `ledger_after` / `voucher_after` | 2 / 3 | **2 / 3** |
| `conserve_cash` / `conserve_vouch` | 0 / 0 | **0 / 0** |
| `audit_origin` / `audit_actor_null` | user / 1 | **user / 1** |

新增流水（同一 import 批，时间均为 2026-11-02T09:34:32.004Z）：

```
ledger 704 manual_adjust  +8.00  balance_after 19.78
ledger 705 manual_adjust  +1.80  balance_after 21.58
voucher 86 build_refund   +1.20  balance_after 1.65
voucher 87 build_use      -1.20  balance_after 0.45
voucher 88 build_use      -0.45  balance_after 0
audit 3845 stadium_rollback
```

## 回滚本批

`99-rollback.sql`：删本批 5 条补偿流水、现金扣回 9.80、券加回 0.45、球场改回 20000 / tier 1，并补一条 `stadium_rollback_undo` 审计。前提：本批之后没有新的账本/券流水、没有再次改过球场；守卫按 id 上界与余额状态保护。已在临时 SQLite 夹具上验证：首次执行回到 11.78 / 0.45 / 20000 / tier1，重跑 changes 全 0。

## 执行状态

- [x] 01 预检 —— 2026-11-02 已跑，只读（9 queries / 877 rows read / 0 written）
- [x] 02 订正 —— 2026-11-02T09:34:32.004Z 已执行（12 queries / 23 rows written / last_row_id 3845）
- [x] 03 验收 —— 全部断言通过（见上表）
