-- 生产批 prod-20261013-wage-floor-refund · 01 前置只读体检（不写任何一行）
-- 目标库：whl-club（生产，--remote）。执行通道：npx wrangler d1 execute whl-club --remote --file=<本文件>

-- 1) 三队 wage 行现值（应仍为 −53 / −43 / −53，memo 带「未达…下限 … 按下限扣」尾注）
SELECT id, club_id, kind, amount, balance_after, memo, created_at
  FROM ledger_entries
 WHERE club_id IN (5, 280, 449) AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
 ORDER BY club_id;

-- 2) 三队 Σ现行合同工资（= 退回目标值；应与 wage 行金额差出 3.77 / 5.38 / 19.63）
SELECT club_id, ROUND(SUM(wage), 2) AS sum_wage, COUNT(*) AS n
  FROM contracts WHERE is_active = 1 AND club_id IN (5, 280, 449) GROUP BY club_id ORDER BY club_id;

-- 3) 顺移规模（工资行之后本队流水条数；期望 6 / 6 / 12 ⇒ 主件 changes ≈ 3 + 24 + 3 = 30）
SELECT w.club_id, COUNT(*) AS rows_after_wage
  FROM ledger_entries w
  JOIN ledger_entries e ON e.club_id = w.club_id AND e.id > w.id
 WHERE w.club_id IN (5, 280, 449) AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901
 GROUP BY w.club_id ORDER BY w.club_id;

-- 4) 账户余额 vs 最新流水 balance_after（应逐队相等；不等说明账本与账户已漂移，先查再跑）
SELECT a.club_id, ROUND(a.balance, 2) AS balance, a.updated_at,
       (SELECT ROUND(e.balance_after, 2) FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS last_after,
       (SELECT MAX(e.id) FROM ledger_entries e WHERE e.club_id = a.club_id) AS last_id
  FROM ledger_accounts a WHERE a.club_id IN (5, 280, 449) ORDER BY a.club_id;

-- 5) 全账本账链完整性（应为 0 行：任一行 balance_after ≠ 前一行 balance_after + 本行 amount）
SELECT club_id, id, amount, balance_after, prev_after
  FROM (SELECT club_id, id, amount, balance_after,
               LAG(balance_after) OVER (PARTITION BY club_id ORDER BY id) AS prev_after
          FROM ledger_entries)
 WHERE prev_after IS NOT NULL AND ROUND(balance_after, 2) <> ROUND(prev_after + amount, 2)
 LIMIT 20;

-- 6) 其余 15 队 wage 行（本批零波及断言基线）
SELECT club_id, ROUND(amount, 2) AS amount FROM ledger_entries
 WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id NOT IN (5, 280, 449) ORDER BY club_id;

-- 7) 三队是否有冻结（held）——本批不动 fund_holds，仅确认不影响账户对账
SELECT club_id, status, COUNT(*) AS n, ROUND(SUM(amount), 2) AS amt
  FROM fund_holds WHERE club_id IN (5, 280, 449) GROUP BY club_id, status;
