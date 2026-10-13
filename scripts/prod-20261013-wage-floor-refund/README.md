# prod-20261013-wage-floor-refund · 取消穷鬼线后的历史多扣退回（S9 第 1 窗 · 3 队）

> **状态：已备未跑（staged, NOT applied）。** 生产一个字未改。执行需当轮明确授权（AGENTS.md：`--remote` 写操作与 `scripts/prod-*/` SQL 工件不自行执行）。

## §0 缘起

用户令（2026-10-13）：**「T3a 提前到此批，并将之前因穷鬼线多扣的退回」**。

- 「取消穷鬼线」的**代码侧**已在发版批 0（v6.47.0）落地：新增 config 白名单键 `wage_floor_gap`，默认 `'0'` ⇒ `src/worker/window-payroll.ts` 的 `floor` 恒为 `null`，扣款 = Σ现行合同工资（`is_active = 1`），不再抬到「级别帽 − 15」。
- 但 **S9 第 1 窗的工资已经按旧下限收过**：2026-10-06T03:08 的 opening-align 补记批次里，3 支球队因 Σ现行合同低于下限被按下限扣（memo 尾注明写「未达顶级/次级下限 N m，按下限扣」）。本批把**差额退回**，使 S9 第 1 窗的实扣额与「取消穷鬼线」口径一致。
- 本批**不含**费率排程（`loyalty_tiers`）与 `stadium_max_open_tier`——那三项在 `scripts/prod-20261013-t0-economy-patch/`（批 A）。两批相互独立、可分别执行。

## §1 影响面

| 表 | 动作 | 行数（changes） |
|---|---|---|
| `ledger_entries` | 3 条 wage 行：`amount` 改回 Σ现行合同、`memo` 尾注改写 | 3 |
| `ledger_entries` | 3 队工资行之后的全部本队流水：`balance_after` 顺移 +Δ | 24（6 / 6 / 12） |
| `ledger_accounts` | 3 队 `balance` 对齐最新 `balance_after`（+Δ） | 3 |
| **合计** | | **30** |

不改的表：`contracts`、`config`、`season_windows`、`fund_holds`、`transfers`、`audit_log`（本批不写审计，改历史行属订正类，口径见 §5）。不新增流水行（**不产生新 faucet 观感**：金额回到「本来应扣多少」，不是「额外发钱」）。

## §2 数值（生产只读实测 2026-10-13）

| 队 | id | Σ现行合同 | 旧实扣 | 退回 | 现金 前 → 后 | wage 行 id | 顺移条数 |
|---|---|---|---|---|---|---|---|
| 切尔西（顶级） | 5 | 49.23 | −53 | **+3.77** | 24.10 → **27.87** | 229 | 6 |
| 奥林匹亚科斯（次级） | 280 | 37.62 | −43 | **+5.38** | 49.06 → **54.44** | 241 | 6 |
| 皇家贝蒂斯（顶级） | 449 | 33.37 | −53 | **+19.63** | 35.71 → **55.34** | 242 | 12 |
| **合计** | | | | **+28.78** | 108.87 → **137.65** | | 24 |

- 其余 15 队 wage 行金额（零波及基线）：−48.37 / −58.25 / −73.55 / −63.68 / −57.48 / −48.62 / −56.98 / −62.53 / −65.56 / −67.57 / −66.44 / −61.48 / −56.77 / −57.49 / −57.69。
- 退回后全联盟 Σ工资口 = **−1022.68 / 窗**（原 −1051.46）。与批 A 落库后的行为一致：下一个窗（S9 中期窗）按 Σ现行合同实扣，不再有下限补扣。

## §3 执行（三条命令，按序）

```bash
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261013-wage-floor-refund/sql/01-precheck.sql   # 只读基线
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261013-wage-floor-refund/sql/02-refund.sql     # 写入，期望 changes 30
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261013-wage-floor-refund/sql/03-verify.sql     # 回读验收
```

前置：**批 A（`scripts/prod-20261013-t0-economy-patch/`）可先可后**；若先跑批 A，注意批 A 只改 `config` 不动任何流水，与本批无交叉。执行前请确认 01-precheck 的账链查询返 **0 行**（全账本 `balance_after` 无断点）；非 0 说明账本已漂移，先排查再跑。

## §4 验收（03-verify 期望）

1. 三队 wage 行：`amount` = **−49.23 / −37.62 / −33.37**，`memo` 含「穷鬼线已取消（用户令 2026-10-13），按现行合同实扣」。
2. 三队 `ledger_accounts.balance` = **27.87 / 54.44 / 55.34**，且逐队等于最新流水的 `balance_after`。
3. 全账本账链查询返 **0 行**（任一行 `balance_after = 前一行 balance_after + amount`）。
4. 零波及：其余 15 队 wage 金额合计不变；三队 wage 合计 = −120.22（原 −149.00）。
5. 三队现金合计 = **137.65**。

## §5 口径与注意

1. **改历史行而非补发新流水**：退回以「还原应扣额」的方式落在原 wage 行上，账本不出现新的入账笔（避免被读成 faucet），但代价是必须**整体顺移该队后续流水的 `balance_after`**，否则账链断裂（本批 24 条顺移即为此）。
2. **幂等**：每条语句都带守卫（wage 行按旧金额 + memo 尾注匹配；顺移按「下一条已相接」检测；账户按等值检测）。重放同一文件 changes = **0**。
3. **本地已验证**（`scratch/verify-refund-sql.mjs`，用 `node:sqlite` 复刻三队真实流水序列）：主件 changes **30** → 重放 **0** → 回滚 **30** → 重放 **0**，账链全程一致，退回合计 +28.78。
4. **回滚**：`rollback/01-restore-floor.sql` 逐语句反做（wage 行回到 −53/−43/−53 与旧 memo、后续流水反向顺移、账户回到 24.10 / 49.06 / 35.71），changes 30、重放 0。
5. **不含审计行**：本批是「订正历史流水」场景（与 `scripts/prod-20261012-*` 天气订正批同类），步进与本批一致的做法是不写 `audit_log`；如需留痕，请在执行记录里登记 changes 与 `03-verify` 回读结果。
6. **后续**：S9 中期窗关窗时，工资按 Σ现行合同实扣（本批口径）；忠诚按 `loyalty_tiers` 新排程扣款 S9 −591.65（批 A 落库 + 发版批 0 上线后生效）。

## §6 文件

| 文件 | 说明 |
|---|---|
| `sql/01-precheck.sql` | 7 条只读基线（含全账本账链与顺移规模） |
| `sql/02-refund.sql` | 主件，9 语句 / 期望 changes 30 |
| `sql/03-verify.sql` | 5 条只读验收 |
| `rollback/01-restore-floor.sql` | 回滚，9 语句 / 期望 changes 30 |
| `sql/manifest.json` | 逐件 sha256 / 语句数 / 期望 changes |
| `gen-refund-sql.mjs` | 主件与回滚件生成器（改参数后重跑即可再生成） |
| `gen-manifest.mjs` | manifest 生成器 |

本地验证脚本：`scratch/verify-refund-sql.mjs`（仓库外可丢弃）；只读探针：`scratch/econ-refund.mjs` → `scratch/econ-refund.out.txt`。
