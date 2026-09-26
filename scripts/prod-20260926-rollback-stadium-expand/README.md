# prod-20260926-rollback-stadium-expand

撤销 2026-09-21 俱乐部 33（慕尼黑1860）在线上发生的**唯一一笔非自动财政流水**：球场扩建支出 0.50M。

- 执行日期：2026-09-26
- 授权：用户 2026-09-26 指令「检查财政项目审计留痕，并回滚此 stadium_expand」，口径经确认选**补偿分录、保留原流水**
- 状态：见文末「执行状态」

## 背景

生产 `ledger_entries` 全表原只有三类：`prize`（逐场自动奖金）、`revenue`（比赛日自动收入）、以及 **1 笔 `stadium_expand`**。这第三笔是唯一由人触发、动了真金白银的流水：

| 字段 | 值 |
|---|---|
| `id` | 141 |
| `club_id` | 33（慕尼黑1860） |
| `kind` / `amount` / `balance_after` | `stadium_expand` / −0.50 / 49.01 |
| `ref_type` / `ref_id` | `stadium` / 33 |
| `memo` | 球场扩建 +500 座（费用 0.50M） |
| `created_at` | 2026-09-21T07:38:46.192Z |

同一操作还把 `stadiums` 的 `capacity` 从 12000 改成 12500、`build_credit` 从 0 改成 0.13（`voucher_refund` 25% 返还），与 `expandStadium`（`src/worker/stadium-ops.ts:96-137`）的算法逐项吻合：`cost = 500/100 × 0.1 = 0.50`、`creditUsed = 0`、`cash = 0.50`、`refund = round2(0.50 × 0.25) = 0.13`。

**这笔操作没有任何账号级留痕**：审计表 `audit_log` 里 0 条 `ledger_*` / `stadium_*` 行，当时只能靠邻行的 `club_bind`（actor=13 TiAmo、target_id=33、@2026-09-21T07:38:28.546Z）推定是队内教练自助操作。这正是本次一并修复的缺陷，见 `scripts/ledger-audit/README.md`。

## 预检快照（2026-09-26 实测，只读）

`01-precheck.sql` 结果：

| 项 | 值 |
|---|---|
| 原流水 id=141 | club 33 / stadium_expand / −0.5 / balance_after 49.01 / `stadium`#33 / 2026-09-21T07:38:46.192Z ✔ |
| `stadiums` club 33 | capacity **12500** / tier 0 / build_credit **0.13** / fans 1800 |
| `ledger_accounts` club 33 | balance **56.01** |
| 全表 | **162** 笔流水 / **16** 户 / 合计 **715.56** |
| 扩建之后关过的窗 | **0**（唯一关过的窗在 2026-09-18T01:01，早于扩建）⇒ wage / luxury_tax / maintenance / naming 五类仍全为 0 |
| 扩建之后 club 33 的流水 | **1** 笔 = id=142 自动奖金（prize 7.00 / match_away #15 / 2026-09-21T08:26:01.152Z），非人工 |
| 扩建之后 club 33 的主场 | **0** 场；历史最大上座 **10140** |

club 33 历史上全部 4 笔流水 = id=100 `revenue` / id=123 `prize` / id=141 `stadium_expand` / id=142 `prize`；**没有 `manual_adjust`**，故补偿分录的 `NOT EXISTS` 守卫不会撞车。

## 不可逆影响面（只报告，本次不改）

- **上座从未触顶**：`home.ts:299` 的上座硬顶是 `attendance = demand >= capacity ? floor(capacity * fill) : floor(max(0, demand))`，而 club 33 历史最大上座 10140 < 12000 < 12500，且扩建后一场主场都没有。因此这次扩建**没有影响过任何一场比赛的上座、门票/商业/转播收入或球迷增速**，回滚不产生需要重算的派生数据。
- 不改 `match_attendance` / `revenue`：`memo` 里字面写着「上座 x/12000」，回滚后 capacity 变回 12000，反而与 id=100 那条 memo 一致。
- 不改 `club_facilities` / `naming_contracts`：`expandStadium` 只写 `stadiums` 与账本两张表，扩建本身没碰它们。
- 不追溯重算 `naming_base_fee`：`naming-ops.ts:56-58` 的 `namingBaseFee` 含 `perCapacityWan × capacity/10000` 一项，但生产 `naming_contracts` 为 0 行、命名险也从未触发，无影响。

## 为什么不 bump 缓存代际

`cache:epoch:public` 只需在公开 GET 的响应内容变化时才推。逐项核对：`capacity` 与账本数据**不在任何 `cachedJson` 公开端点**的响应里——`clubs:directory`（`src/worker/routes/clubs.ts:29`）、`clubs:list`（`:110`，`CLUB_SQUAD_AGG_SQL` `:55-63` 只 SUM `players.market_value`、`totalWage` 取 `contracts.wage`）、`clubs:detail`（`:336`，注释 `:328-330` 明确「不含财政与主场」）、`clubs:standing`（`:607`）、`squads:all`（`src/worker/routes/squads.ts:35`）、`players`（`src/worker/routes/players.ts:207`/`:743`/`:768`）。`capacity` 只出现在非缓存端点：`clubs.ts:692`（GET /me/club）、`:821`（GET /club/stadium/build-info）、`:926`（GET /club/naming/quote）；账本只出现在 `clubs.ts:782-783`（GET /club/ledger）与 `:678`/`:747`（余额），同样非缓存。**故本批不需要 `wrangler kv key put cache:epoch:public`**。

## 执行

```bash
# 1) 预检（只读）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-rollback-stadium-expand/01-precheck.sql

# 2) 正向订正（写生产：3 句，一个事务）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-rollback-stadium-expand/02-rollback.sql

# 3) 验收（只读）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-rollback-stadium-expand/03-verify.sql
```

走 `--file` 而不是 `--command`：本批三句都在同一批里、彼此有顺序依赖（补偿流水的 `balance_after` 要取加回后的余额），且不涉及外键父子行顺序。`--file` 通道整批是一个事务（`ROADMAP.md:217`），要么全成要么全回滚。

口径：**补偿分录，保留原流水**。`ledger_entries` 是只增账本，删 id=141 会打断 `balance_after` 链，所以原行不动；改为账面加回 0.50 并补一条 `kind='manual_adjust'` 的反向流水（前端 `LEDGER_KIND_LABELS`（`web/src/lib/api.ts:937-962`）已有「手动调整」标签，`routes/admin/finance.ts:89` 的 `MANUAL_KIND_RE` 也认它），`memo` 指回原流水 id。

三句都带守卫，重跑 `changes` 全为 0：① 只命中「扩建后」状态（capacity 12500 且 build_credit 0.13）；② 只加差额、不 SET 绝对值；③ `NOT EXISTS` 防重复入账。

## 验收期望（`03-verify.sql`）

| 探针 | 期望 |
|---|---|
| `cap_33` | 12000 |
| `credit_33` | 0.0 |
| `bal_33` | 56.51（56.01 + 0.50） |
| `ma33` | 1 |
| `expand33` | 1（原流水保留） |
| `newest33` | `manual_adjust` |
| `conserve` | 0（Σbalance − Σamount = 0，与增长无关的硬断言） |
| `entries` / `prize` / `revenue` | 信息位，随比赛确认持续增长，不作断言 |

## 回滚本批

`99-rollback.sql`：删本批插的 `manual_adjust` 流水 → 账面扣回 0.50 → 球场改回 12500 / 0.13。形状与 `02` 对称，每句尾注释期望 `changes`。原流水 id=141 全程未动，故回滚后账面与订正前一致。前提：本批之后没有再次扩建覆盖 club 33 的 capacity/build_credit，也没有他人手工调过该户账；`③` 的守卫会保护「已被再次扩建」的球场不被改回。

## 执行状态

- [x] 01 预检 —— 2026-09-26 已跑（快照见上「预检快照」），只读未写入
- [x] 02 订正 —— 2026-09-26 已执行，`last_row_id=163`
- [x] 03 验收 —— 全项通过

### 订正后实测（2026-09-26T02:51:32Z）

```
cap_33 = 12000   credit_33 = 0   bal_33 = 56.51   ma33 = 1
expand33 = 1     newest33 = manual_adjust        conserve = 0
entries = 163    prize = 103     revenue = 58
```

新增的补偿流水：

| 字段 | 值 |
|---|---|
| `id` | 163 |
| `kind` / `amount` / `balance_after` | `manual_adjust` / +0.50 / 56.51 |
| `ref_type` / `ref_id` | `stadium` / 33 |
| `memo` | 回滚 2026-09-21 球场扩建（原流水 id=141，-0.50M；capacity 12500→12000、build_credit 0.13→0） |
| `created_at` | 2026-09-26T02:51:32.296Z |

原流水 id=141 未被改动；`stadiums` club 33 已回到 capacity 12000 / build_credit 0.00。全表守恒式 `Σ(balance) − Σ(amount) = 0` 成立。
