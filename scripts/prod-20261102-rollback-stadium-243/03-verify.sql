-- 执行后复查（只读）。本文件由 --file 通道执行，见 README。
--
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261102-rollback-stadium-243/03-verify.sql
--
-- 断言（前 16 列与订正结果一一对应，后 4 列是恒等式/信息位）：
--   cap_243        = 12000        球场回到扩建前
--   tier_243       = 0
--   bal_243        = 21.58        club 243 加回 9.80（11.78 → 21.58）
--   vouchers_243   = 0.0          券清零（0.45 + 1.20 − 1.20 − 0.45）
--   cash_rows      = 2            补偿流水两条
--   cash_sum       = 9.80         两笔合计
--   orig_ledger    = 2            原流水 702/703 保留
--   orig_vouchers  = 3            原券流水 83/84/85 保留
--   voucher_rows   = 3            券补偿三条
--   voucher_sum    = -0.45        券净变动
--   audit_rows     = 1            审计一条
--   ledger_after   = 2            702/703 之后 club 243 新增账本流水 = 本批两条
--   voucher_after  = 3            83–85 之后 club 243 新增券流水 = 本批三条
--   conserve_cash  = 0            Σ(balance) == Σ(amount)
--   conserve_vouch = 0            Σ(vouchers) == Σ(voucher_entries.amount)
--   audit_origin   = user
--   audit_actor_null = 1
--
-- 注：conserve 两列是与时间无关的硬断言；余额列用 ROUND，因为现金账户走
--     `balance + delta` 不 ROUND（与 ledgerMovement 一致），会留浮点尾数。

SELECT
  (SELECT capacity FROM stadiums         WHERE club_id = 243) AS cap_243,
  (SELECT tier     FROM stadiums         WHERE club_id = 243) AS tier_243,
  (SELECT ROUND(balance, 2)  FROM ledger_accounts WHERE club_id = 243) AS bal_243,
  (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = 243) AS vouchers_243,
  (SELECT COUNT(*) FROM ledger_entries
    WHERE club_id = 243 AND kind = 'manual_adjust'
      AND ref_type = 'stadium' AND ref_id = 243
      AND memo LIKE '回滚 2026-11-02%') AS cash_rows,
  (SELECT ROUND(COALESCE(SUM(amount), 0), 2) FROM ledger_entries
    WHERE club_id = 243 AND kind = 'manual_adjust'
      AND ref_type = 'stadium' AND ref_id = 243
      AND memo LIKE '回滚 2026-11-02%') AS cash_sum,
  (SELECT COUNT(*) FROM ledger_entries WHERE id IN (702, 703) AND club_id = 243) AS orig_ledger,
  (SELECT COUNT(*) FROM voucher_entries WHERE id IN (83, 84, 85) AND club_id = 243) AS orig_vouchers,
  (SELECT COUNT(*) FROM voucher_entries
    WHERE club_id = 243 AND ref_type = 'stadium' AND ref_id = 243
      AND memo LIKE '撤销球场%') AS voucher_rows,
  (SELECT ROUND(COALESCE(SUM(amount), 0), 2) FROM voucher_entries
    WHERE club_id = 243 AND ref_type = 'stadium' AND ref_id = 243
      AND memo LIKE '撤销球场%') AS voucher_sum,
  (SELECT COUNT(*) FROM audit_log
    WHERE action = 'stadium_rollback' AND target_type = 'stadium' AND target_id = 243) AS audit_rows,
  (SELECT COUNT(*) FROM ledger_entries
    WHERE club_id = 243 AND id > 703) AS ledger_after,
  (SELECT COUNT(*) FROM voucher_entries
    WHERE club_id = 243 AND id > 85) AS voucher_after,
  (SELECT ROUND((SELECT SUM(balance)  FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve_cash,
  (SELECT ROUND((SELECT SUM(vouchers) FROM ledger_accounts) - (SELECT SUM(amount) FROM voucher_entries), 2)) AS conserve_vouch,
  (SELECT origin FROM audit_log
    WHERE action = 'stadium_rollback' AND target_type = 'stadium' AND target_id = 243
    ORDER BY id DESC LIMIT 1) AS audit_origin,
  (SELECT actor IS NULL FROM audit_log
    WHERE action = 'stadium_rollback' AND target_type = 'stadium' AND target_id = 243
    ORDER BY id DESC LIMIT 1) AS audit_actor_null;

-- 信息位：本批新增的五条流水（不作断言，供 README 记录）。
SELECT 'ledger_new' AS probe, id, kind, amount, ROUND(balance_after, 2) AS balance_after, memo, created_at
  FROM ledger_entries
 WHERE club_id = 243 AND id > 703
 ORDER BY id;

SELECT 'voucher_new' AS probe, id, kind, amount, ROUND(balance_after, 2) AS balance_after, memo, created_at
  FROM voucher_entries
 WHERE club_id = 243 AND id > 85
 ORDER BY id;

SELECT 'audit_new' AS probe, id, actor, action, target_type, target_id, origin, before, after, at
  FROM audit_log
 WHERE action = 'stadium_rollback' AND target_type = 'stadium' AND target_id = 243
 ORDER BY id;
