-- S9 天气订正批 · 执行后复查（一）：余额与分录
--
-- 生成时间：2026-10-12T11:45:00Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20 --retry=2
-- 逐队余额应等于基线 + 净变化（下表）；wx_fix 计数应为 78（含差额为 0 的 7 场——零差额同样留痕）、合计应为 0.63；守恒位应恒为 0。
-- club 1：基线 46.03 + -0.43 = 45.60
-- club 2：基线 29.99 + -0.07 = 29.92
-- club 5：基线 23.42 + 0.68 = 24.10
-- club 9：基线 124.32 + -1.48 = 122.84
-- club 11：基线 92.15 + 0.47 = 92.62
-- club 13：基线 70.27 + -0.70 = 69.57
-- club 14：基线 109.38 + -0.33 = 109.05
-- club 21：基线 54.03 + -0.13 = 53.90
-- club 33：基线 89.62 + -0.13 = 89.49
-- club 45：基线 109.81 + 0.78 = 110.59
-- club 66：基线 84.71 + -0.19 = 84.52
-- club 73：基线 139.02 + 1.40 = 140.42
-- club 241：基线 39.35 + 0.57 = 39.92
-- club 243：基线 42.91 + -0.71 = 42.20
-- club 280：基线 48.75 + 0.31 = 49.06
-- club 449：基线 35.30 + 0.41 = 35.71
-- club 110374：基线 40.89 + 0.09 = 40.98
-- club 112172：基线 -4.63 + 0.09 = -4.54


SELECT
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 1) AS bal_1,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 2) AS bal_2,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 5) AS bal_5,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 9) AS bal_9,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 11) AS bal_11,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 13) AS bal_13,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 14) AS bal_14,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 21) AS bal_21,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 33) AS bal_33,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 45) AS bal_45,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 66) AS bal_66,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 73) AS bal_73,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 241) AS bal_241,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 243) AS bal_243,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 280) AS bal_280,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 449) AS bal_449,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 110374) AS bal_110374,
  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 112172) AS bal_112172,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'wx_fix') AS wx_fix_n,
  (SELECT ROUND(COALESCE(SUM(amount), 0), 2) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'wx_fix') AS wx_fix_sum,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'wx_fix_undo') AS wx_undo_n,
  (SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve;