-- 回滚本批：撤销 2026-11-02 的球场回滚，让生产回到回滚前的账面
-- （capacity 20000 / tier 1 / 现金 11.78 / 券 0.45）。
--
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261102-rollback-stadium-243/99-rollback.sql
--
-- 前提（否则不要跑）：本批之后没有新的账本/券流水、没有再次改过球场。
--   ①③ 的 `NOT EXISTS (id > 本批最大 id)` 会保护「已有后续流水」的账户不被改回；
--   ⑤ 只在账面已恢复到 11.78 / 0.45 时才改球场。
--
-- 口径：删本批插的 5 条补偿流水、按差额把现金扣回 9.80、券加回 0.45，
--   球场改回 20000/tier 1。原流水 702/703、券 83–85 全程未动，所以完成后
--   账面与 2026-11-02 回滚前逐字节一致。
--
-- 顺序：先券后现金，最后球场；每步都带守卫，重跑 changes 全为 0。

-- ① 删本批插的三条券补偿流水。期望 changes = 3。
--    守卫：球场仍是回滚后的 12000/tier0、券已清零、三条都在、之后无新券流水。
DELETE FROM voucher_entries
 WHERE club_id = 243
   AND ref_type = 'stadium'
   AND ref_id = 243
   AND memo LIKE '撤销球场%'
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND (SELECT COUNT(*) FROM voucher_entries
         WHERE club_id = 243 AND ref_type = 'stadium' AND ref_id = 243
           AND memo LIKE '撤销球场%') = 3
   AND (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = 243) = 0
   AND NOT EXISTS (SELECT 1 FROM voucher_entries
                    WHERE club_id = 243 AND id > (SELECT MAX(id) FROM voucher_entries
                                                   WHERE club_id = 243 AND ref_type = 'stadium'
                                                     AND ref_id = 243 AND memo LIKE '撤销球场%'));

-- ② 券加回 0.45（三条补偿净额 −0.45 的反向）。期望 changes = 1。
UPDATE ledger_accounts
   SET vouchers   = ROUND(vouchers + 0.45, 2),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND changes() > 0
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0);

-- ③ 删本批插的两条现金补偿流水。期望 changes = 2。
--    守卫：现金余额仍是回滚后的 21.58、两条都在、之后无新账本流水。
DELETE FROM ledger_entries
 WHERE club_id = 243
   AND kind = 'manual_adjust'
   AND ref_type = 'stadium'
   AND ref_id = 243
   AND memo LIKE '回滚 2026-11-02%'
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND (SELECT COUNT(*) FROM ledger_entries
         WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'stadium'
           AND ref_id = 243 AND memo LIKE '回滚 2026-11-02%') = 2
   AND (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = 243) = 21.58
   AND NOT EXISTS (SELECT 1 FROM ledger_entries
                    WHERE club_id = 243 AND id > (SELECT MAX(id) FROM ledger_entries
                                                   WHERE club_id = 243 AND kind = 'manual_adjust'
                                                     AND ref_type = 'stadium' AND ref_id = 243
                                                     AND memo LIKE '回滚 2026-11-02%'));

-- ④ 现金扣回 9.80（两笔补偿合计的反向）。期望 changes = 1。
UPDATE ledger_accounts
   SET balance    = balance - 9.80,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND changes() > 0
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0);

-- ⑤ 球场改回回滚前状态。期望 changes = 1。
UPDATE stadiums
   SET capacity   = 20000,
       tier       = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND capacity = 12000
   AND tier = 0
   AND (SELECT ROUND(balance, 2)  FROM ledger_accounts WHERE club_id = 243) = 11.78
   AND (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = 243) = 0.45;

-- ⑥ 审计：本批回滚被撤销。期望 changes = 1。
INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL,
       'stadium_rollback_undo',
       'stadium',
       243,
       'user',
       '{"capacity":12000,"tier":0,"vouchers":0,"balance":21.58}',
       '{"capacity":20000,"tier":1,"vouchers":0.45,"balance":11.78,"reason":"撤销 2026-11-02 的球场回滚，恢复原扩建/升级状态"}',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 20000 AND tier = 1)
   AND (SELECT ROUND(balance, 2)  FROM ledger_accounts WHERE club_id = 243) = 11.78
   AND (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = 243) = 0.45
   AND NOT EXISTS (SELECT 1 FROM audit_log
                    WHERE action = 'stadium_rollback_undo' AND target_type = 'stadium' AND target_id = 243);
