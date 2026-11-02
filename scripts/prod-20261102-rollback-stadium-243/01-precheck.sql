-- 只读预检：确认皇马（club 243）两笔球场支出的当前形态，以及回滚会碰到的面。
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261102-rollback-stadium-243/01-precheck.sql
--
-- 期望（2026-11-02 17:2x 实测）：
--   ① stadiums 243 = capacity 20000 / tier 1 / build_credit 0 / updated_at 2026-11-02T08:36:35.378Z
--   ② ledger_accounts 243 = balance 11.78 / vouchers 0.45
--   ③ 原流水 702 stadium_expand -8.00 / 703 stadium_upgrade -1.80，两笔都在
--   ④ 券流水 83/84/85 = +1.20 / -1.20 / +0.45
--   ⑤ 两笔之后无新账本流水、无主场出勤、设施全 0、无冠名合同
--   ⑥ 双守恒：Σbalance = Σamount，Σvouchers = Σvoucher_entries.amount

SELECT 'stadium_243' AS probe,
       club_id, name, capacity, tier, build_credit, fans, updated_at
  FROM stadiums
 WHERE club_id = 243;

SELECT 'account_243' AS probe,
       club_id, ROUND(balance, 2) AS balance, ROUND(vouchers, 2) AS vouchers, updated_at
  FROM ledger_accounts
 WHERE club_id = 243;

SELECT 'ledger_702_703' AS probe,
       id, club_id, kind, amount, ROUND(balance_after, 2) AS balance_after,
       ref_type, ref_id, memo, created_at
  FROM ledger_entries
 WHERE id IN (702, 703)
 ORDER BY id;

SELECT 'voucher_83_85' AS probe,
       id, club_id, kind, amount, ROUND(balance_after, 2) AS balance_after,
       ref_type, ref_id, memo, created_at
  FROM voucher_entries
 WHERE club_id = 243 AND id BETWEEN 83 AND 85
 ORDER BY id;

SELECT 'entries_after_upgrade' AS probe,
       COUNT(*) AS n, GROUP_CONCAT(DISTINCT kind) AS kinds
  FROM ledger_entries
 WHERE club_id = 243 AND created_at > '2026-11-02T08:36:35.378Z';

SELECT 'attendance_after_expand' AS probe,
       COUNT(*) AS n, MAX(attendance) AS max_attendance
  FROM match_attendance
 WHERE club_id = 243 AND created_at > '2026-11-02T08:25:13.933Z';

SELECT 'facilities_243' AS probe,
       facility_key, level, updated_at
  FROM club_facilities
 WHERE club_id = 243
 ORDER BY facility_key;

SELECT 'naming_243' AS probe, COUNT(*) AS n
  FROM naming_contracts
 WHERE club_id = 243;

SELECT 'conserve' AS probe,
       ROUND((SELECT SUM(balance)  FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)  AS cash,
       ROUND((SELECT SUM(vouchers) FROM ledger_accounts) - (SELECT SUM(amount) FROM voucher_entries), 2) AS voucher;
