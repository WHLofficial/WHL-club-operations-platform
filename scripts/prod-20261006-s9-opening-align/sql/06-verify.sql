-- ⑥ 落库后复查（只读；期望：余额合计 905.73、期初流水 16 笔合计 968.25、工资 18 笔合计 -1022.68、效力合计 -1109、保护期收口 24 人、match 24 行、rc_change 4 行）
-- 期望 changes = 0（只读，不改任何数据）
SELECT
  (SELECT ROUND(SUM(balance), 2) FROM ledger_accounts) AS sum_balances,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'opening_import') AS oi_n,
  (SELECT ROUND(SUM(amount), 2) FROM ledger_entries WHERE kind = 'opening_import') AS oi_sum,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901) AS wage_n,
  (SELECT ROUND(SUM(amount), 2) FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901) AS wage_sum,
  (SELECT ROUND(SUM(service_ticks), 2) FROM contracts WHERE is_active = 1) AS stk_sum,
  (SELECT COUNT(*) FROM contracts WHERE is_active = 1 AND player_id IN (49, 90, 45, 57, 5, 263, 35, 2, 16, 84, 31, 58, 286, 41, 385, 181, 97, 460, 66, 882, 51, 1701, 401, 1002) AND protection_ticks = 1) AS ptk1_n,
  (SELECT COUNT(*) FROM transfers WHERE type = 'match' AND status = 'completed' AND substr(idempotency_key, 1, 15) = 's9-league-match') AS rec_match,
  (SELECT COUNT(*) FROM transfers WHERE type = 'rc_change' AND status = 'completed' AND substr(idempotency_key, 1, 19) = 's9-league-rc_change') AS rec_rc,
  (SELECT COUNT(*) FROM transfers WHERE status = 'completed') AS rec_all;
