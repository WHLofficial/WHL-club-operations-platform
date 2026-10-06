-- 执行后复查（只读，单行多标量）
--
-- 生成时间：2026-10-06T04:23:06Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20
-- 逐队余额应等于 BASELINE + 净变化（见 README 表）；
-- wo_rollback_* / _fix 计数应分别为 9 / 5；守恒位 conserve 应恒为 0。

SELECT
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 1) AS bal_1,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 2) AS bal_2,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 14) AS bal_14,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 21) AS bal_21,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 241) AS bal_241,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 449) AS bal_449,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 110374) AS bal_110374,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 112172) AS bal_112172,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type LIKE 'wo_rollback%') AS wo_rollback_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND (ref_type = 'match_home_fix' OR ref_type = 'match_away_fix')) AS fix_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type IN ('match_home', 'match_away') AND ref_id IN (2,18,22,27,31,37,38,44,48,51,57,61,70,165,166,169,172,176,182,183) AND club_id IN (1,2,14,21,241,449,110374,112172)) AS wo_prize_n,
  (SELECT COUNT(*) FROM match_attendance a JOIN result_confirmations rc ON rc.match_id = a.match_id WHERE rc.walkover_side IS NOT NULL AND rc.walkover_side != '') AS wo_att_n,
  (SELECT COUNT(*) FROM match_attendance a JOIN result_confirmations rc ON rc.match_id = a.match_id WHERE rc.walkover_side IS NOT NULL AND rc.walkover_side != '' AND (a.attendance != 0 OR a.ticket != 0 OR a.commercial != 0 OR a.broadcast != 0)) AS wo_att_dirty_n,
  (SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve;
