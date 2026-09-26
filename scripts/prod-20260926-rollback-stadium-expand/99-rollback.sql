-- 回滚本批：把 2026-09-26 的球场扩建订正撤销，让生产回到订正前的账面。
--
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-rollback-stadium-expand/99-rollback.sql
--
-- 前提（否则不要跑）：本批之后没有新的扩建覆盖过 club 33 的 capacity/build_credit，
--   且没有其他人手工调过 club 33 的账。① 的守卫会保护「已被再次扩建」的球场不被改回；
--   ③ 按本批独有价值（amount 0.50 + memo 前缀）圈定，只删本批插的那一条。
--
-- 口径：反向也走补偿 —— 删本批新增的 manual_adjust 流水、按差额扣回 0.50、球场改回 12500/0.13。
--   原流水 id=141 全程未动，所以 ①③ 完成后账面与订正前逐字节一致。
--
-- 顺序：先扣账（对应 02 的第②③句要一起撤），再把球场改回去。

-- ① 删本批插的补偿流水。期望 changes = 1。
DELETE FROM ledger_entries
 WHERE club_id = 33
   AND kind = 'manual_adjust'
   AND ref_type = 'stadium'
   AND ref_id = 33
   AND amount = 0.50;

-- ② 账面扣回 0.50。期望 changes = 1。
UPDATE ledger_accounts
   SET balance    = balance - 0.50,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 33;

-- ③ 球场改回扩建后状态。期望 changes = 1。
UPDATE stadiums
   SET capacity     = 12500,
       build_credit = 0.13,
       updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 33
   AND capacity = 12000
   AND build_credit = 0.00;
