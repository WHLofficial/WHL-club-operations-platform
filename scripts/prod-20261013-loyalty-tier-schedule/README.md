# 生产批：忠诚奖金费率排程落库（prod-20261013-loyalty-tier-schedule）

> 状态：**已备未跑（staged, not applied）** —— 生产 `whl-club` 一个字都没改。执行需用户明确一句话授权（AGENTS.md §危险清单：任何 `--remote` 写操作、`scripts/prod-*/` 下 SQL 工件）。
> 目标库：`whl-club`（`database_id 73154873-d5ae-42b0-a630-25f5ef60053d`）

## 1. 缘起

- 用户 m01326 定稿费率排程：**效力 0.5/1 → 5%、1.5/2 → 10%、2.5/3 → 20%，其余（<0.5 或 ≥3.5）不收**。
- 用户 m01389 确认**扣款时点不变**：每赛季第 2 个正式窗（中期窗）关窗时发一次。
- 落地 = 纯 config、零发版：`src/worker/season-settle.ts:273` 取满足的最高档、`:274` `rate <= 0 ⇒ continue`（收官 0% 档干净跳过，不写 0 金额流水）。

## 2. 影响面（执行前评估）

| 项 | 值 |
| --- | --- |
| 写入行数 | `config` 1 行 upsert（键此前不存在 ⇒ 实为 INSERT）+ `audit_log` 1 行（`action='config_set'`、`origin='machine'`、`actor=NULL`） |
| 触及的其他表 | **无**（不动账本/赛季/窗口/俱乐部/合同） |
| 读取行数 | 4 条 SELECT（config 全表 8 行 + audit 最近 5 行），对免费档行读配额影响可忽略 |
| 不可逆点 | **无**。回滚件 `rollback/01-unset-loyalty-tiers.sql` 一条命令删行；键删掉即回代码默认（三档永久 20%） |
| 生效时点 | 下一次「赛季第 2 个正式窗」关窗（S9 中期窗，尚未开）⇒ 本批落在首次扣款之前 |
| 幂等 | 两条语句共用「当前值 ≠ 目标值」守卫，重放 changes 均为 0 |

## 3. 数值（`scratch/econ-loyalsched.mjs` → `.out.txt`，生产 517 份合同逐球员）

| 季（中期窗刻度） | 现行（默认三档永久 20%） | 本排程 |
| --- | --- | --- |
| S9（T=2） | −950.45 | **−591.65**（次级 −199.25 / 顶级 −392.40） |
| S10（T=4） | −1165.10 | **−429.30** |
| S11（T=6） | −1412.20 | **−494.20** |
| S12（T=8） | −1412.20 | **0**（阶梯走完） |

- 季净额：次级 −519.75/−604.80/−751.50/−751.50 → **−448.75/−419.60/−542.90/−249.50**；顶级 −217.44/… → **+70.36/+203.56/+261.96/+462.76（四季全正）**。
- 每份合同终身 **35% × RC（3 期）**（扣款只在中窗、刻度每季 +2 ⇒ 两次扣款间隔效力 +1.0）；现有合同剩余终身合计 **1515.15**。
- 豁免 90 人（S9 即 ≥3.5 赛季，ΣRC 1794）：S9 少收的 358.80 全部来自这里。

## 4. 执行与验收

```bash
# ① 前置体检（只读）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261013-loyalty-tier-schedule/sql/01-precheck.sql
# ② 主件（写入）
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261013-loyalty-tier-schedule/sql/02-set-loyalty-tiers.sql
# ③ 回读验收（只读）：config_rows 应从 8 → 9，loyalty_tiers 值 = 目标串
npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261013-loyalty-tier-schedule/sql/03-verify.sql
```

## 5. ⚠️ 本批不改方向（重要）

源码 `src/worker/season-settle.ts:296` 是 `delta: agg.amount`（**正数 = 入俱乐部账 = faucet**，与 `wage` 的负号相反），而用户已裁决忠诚是**俱乐部支出**。本批只改费率，方向修正属**代码改动（发版）**，另有三个连带决定：

1. 账本能否透支（`src/worker/ledger.ts:29-63` 无余额下限）——按支出扣，S9 有 4 支次级队（阿森纳 −17.37 / 维拉 −27.42 / 拜仁 −6.30 / RBL −47.14）同窗现金不足，需要「允许负余额 / 归零 / 记欠款」三选一。
2. 措辞与文档口径：`memo='忠诚奖金…'`、审计 `action='loyalty_bonus'`、`TECH_DESIGN.md:541`（列在「发行」）、`:633/:705/:754`、`PRD.md:137`、`ROADMAP.md:422`。
3. 测试：`tests/season-settle.test.ts` 现存断言按入账方向写。

⇒ 在本改完成前，S9 中期窗关窗会**按 −591.65 的量级给俱乐部发钱**（比不写本键的 −950.45 少发 358.80）。
