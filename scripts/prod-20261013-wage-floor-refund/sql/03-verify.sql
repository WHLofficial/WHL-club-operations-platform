-- 生产批 prod-20261013-wage-floor-refund · 03 验收回读（只读）
-- 期望：三队 wage 行回到 Σ现行合同（−49.23 / −37.62 / −33.37）、memo 尾注改写、账户余额各 +Δ、
--       全账本账链 0 断点、其余 15 队 wage 行金额与合计不变。

-- 1) 三队 wage 行（amount 应为 −49.23 / −37.62 / −33.37；memo 含「穷鬼线已取消」）
SELECT id, club_id, amount, balance_after, memo
  FROM ledger_entries WHERE club_id IN (5, 280, 449) AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
 ORDER BY club_id;

-- 2) 三队账户余额（期望 27.87 / 54.44 / 55.34，且与最新流水 balance_after 相等）
SELECT a.club_id, ROUND(a.balance, 2) AS balance,
       (SELECT ROUND(e.balance_after, 2) FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS last_after
  FROM ledger_accounts a WHERE a.club_id IN (5, 280, 449) ORDER BY a.club_id;

-- 3) 全账本账链完整性（应为 0 行）
SELECT club_id, id, amount, balance_after, prev_after
  FROM (SELECT club_id, id, amount, balance_after,
               LAG(balance_after) OVER (PARTITION BY club_id ORDER BY id) AS prev_after
          FROM ledger_entries)
 WHERE prev_after IS NOT NULL AND ROUND(balance_after, 2) <> ROUND(prev_after + amount, 2)
 LIMIT 20;

-- 4) 零波及断言：其余 15 队 wage 金额不变，且三队退回差额合计 = +28.78
SELECT 'other15' AS scope, ROUND(SUM(amount), 2) AS sum_amount, COUNT(*) AS n
  FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id NOT IN (5, 280, 449)
UNION ALL
SELECT 'three', ROUND(SUM(amount), 2), COUNT(*)
  FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id IN (5, 280, 449);

-- 5) 三队现金合计（退回前 24.10+49.06+35.71 = 108.87 ⇒ 退回后 137.65）
SELECT ROUND(SUM(balance), 2) AS three_clubs_cash FROM ledger_accounts WHERE club_id IN (5, 280, 449);
