-- 执行后复查（只读，单行多标量）
--
-- 生成时间：2026-10-17T12:01:26Z
-- 逐队余额应等于基线 + 净变化（见 README 表）：280 −4.50 / 11 +2.50 / 241 −4.50 / 45 +2.50 / 112172 −4.50 / 2 +2.50 / 21 +2.50
-- pk_rollback_n 应为 3；pk_fix_n 应为 3；canonical_prize_n 应为 7（原 3 笔 7.00M + 本批 4 笔对手侧 2.50M）；守恒位应恒为 0。

SELECT
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 280) AS bal_280,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 11) AS bal_11,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 241) AS bal_241,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 45) AS bal_45,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 112172) AS bal_112172,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 2) AS bal_2,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 21) AS bal_21,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize') AS pk_rollback_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type LIKE 'match_home_fix' AND ref_id IN (10,16,18,22)) AS fix_home_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type LIKE 'match_away_fix' AND ref_id IN (10,16,18,22)) AS fix_away_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type IN ('match_home','match_away') AND ref_id IN (10,16,18,22)) AS canonical_prize_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_id IN (10,16,18,22) AND amount = 2.5) AS draw_2_5_n,
  (SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve;
