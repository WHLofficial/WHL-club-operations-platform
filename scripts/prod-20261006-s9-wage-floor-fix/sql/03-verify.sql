-- 03 复查（只读，可在 --file 或 --command 通道跑）：期望每条 probe 的 hits 与 expected 相等

-- v1 三队工资行已触底且带下限尾注（期望 3/3）
SELECT 'v1 三队工资行触底 + 尾注' AS probe,
  (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53 AND instr(memo, '，按下限扣）') != 0)
+ (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -43 AND instr(memo, '，按下限扣）') != 0)
+ (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53 AND instr(memo, '，按下限扣）') != 0) AS hits,
  3 AS expected;

-- v2 三队账户与最新流水一致（期望 3 行全 consistent）
SELECT a.club_id, ROUND(a.balance, 2) AS account_balance,
       (SELECT ROUND(e.balance_after, 2) FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS tail_balance,
       CASE WHEN ROUND(a.balance, 2) = ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1), 2) THEN 'consistent' ELSE 'DRIFT' END AS invariant
FROM ledger_accounts a WHERE a.club_id IN (5, 280, 449) ORDER BY a.club_id;

-- v3 三队工资行合计（期望 -149.00：53 + 43 + 53；旧值 -120.22，差额 -28.78）
SELECT 'v3 三队工资行合计' AS probe, ROUND(SUM(amount), 2) AS sum_now, COUNT(*) AS rows_now, -149.0 AS expected_sum
FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id IN (5, 280, 449);

-- v4 其余 15 队工资行（期望 n = 15、合计 -902.46：本批零波及）
SELECT 'v4 其余 15 队零波及' AS probe, COUNT(*) AS n, ROUND(SUM(amount), 2) AS sum_others, -902.46 AS expected_sum, 15 AS expected_n
FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id NOT IN (5, 280, 449);

-- v5 CPU 两行现状（参考，本批不动；执行可选件 04 后再看这里）
SELECT club_id, ROUND(amount, 2) AS amount, balance_after, memo
FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND club_id IN (241, 112172) ORDER BY club_id;
