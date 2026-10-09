-- 05-verify-cpu-undo.sql —— 2026-10-09 订正复查（只读）
-- 背景：用户 2026-10-09 指出 241 巴塞罗那 / 112172 RB莱比锡「已经不是 CPU 球队」，04 件
-- （CPU 期工资冲正）属误冲 ⇒ 已执行 rollback/02-cpu-refund-optional.sql 还原扣款。
-- 本件判据（v1–v5），全部期望值见批 report.md §8。
-- v1：两队工资行应恢复为 amount = -61.48 / -57.69，memo 尾回到「 人现行合同）」（无「已冲正」尾注）
SELECT 'v1-两行工资行' AS tag, club_id, id, ROUND(amount, 2) AS amount, ROUND(balance_after, 2) AS bal, substr(memo, -12) AS memo_tail FROM ledger_entries WHERE club_id IN (241, 112172) AND kind = 'wage';
-- v2：两队账户余额 = 本队最新流水 balance_after（期望 241 = 24.92、112172 = -4.63；负值合规）
SELECT 'v2-两队账户对账' AS tag, a.club_id, ROUND(a.balance, 2) AS acct, ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1), 2) AS tail, CASE WHEN ROUND(a.balance, 2) = ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1), 2) THEN 'consistent' ELSE 'MISMATCH' END AS invariant FROM ledger_accounts a WHERE a.club_id IN (241, 112172);
-- v3：全队工资行对照（charged 应 = Σ 现行合同工资，或按下限；只有 is_cpu = 1 的队不出现在本表）
SELECT 'v3-全队工资行对照' AS tag, w.club_id, c.name, c.is_cpu, ROUND(w.amount, 2) AS charged, ROUND(COALESCE((SELECT SUM(ct.wage) FROM contracts ct WHERE ct.club_id = w.club_id AND ct.is_active = 1), 0), 2) AS sum_wage, substr(w.memo, -14) AS memo_tail FROM ledger_entries w JOIN clubs c ON c.id = w.club_id WHERE w.kind = 'wage' ORDER BY w.club_id;
-- v4：全账链断点自检（按 club 分区 LAG；期望 0 行 = 无断点）
SELECT 'v4-账链断点' AS tag, club_id, COUNT(*) AS breaks FROM (SELECT club_id, balance_after, amount, LAG(balance_after) OVER (PARTITION BY club_id ORDER BY id) AS prev FROM ledger_entries) WHERE prev IS NOT NULL AND ROUND(prev + amount, 2) != ROUND(balance_after, 2) GROUP BY club_id;
-- v5：真 CPU 两队应无任何流水（不入账）
SELECT 'v5-CPU队流水' AS tag, c.id, c.name, c.is_cpu, (SELECT COUNT(*) FROM ledger_entries e WHERE e.club_id = c.id) AS ledger_rows FROM clubs c WHERE c.is_cpu = 1;
