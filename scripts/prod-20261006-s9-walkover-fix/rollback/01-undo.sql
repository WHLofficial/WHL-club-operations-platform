-- 回滚：撤销本批全部写入（补偿分录，保留本批流水）
--
-- 生成时间：2026-10-06T04:23:06Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20
-- 顺序与本批相反：先撤差额、再撤补发、最后撤收回；
-- ref_type='batch_rollback_wo'、ref_id=20261006，每笔一句 NOT EXISTS 守卫，重放 changes=0

INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 110374, -3.80, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #38）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #38）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', -3.80, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'batch_rollback_wo', 20261006, '回滚弃权场胜负订正差额（比赛 #38）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #38）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 1, -3.80, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #166）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #166）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', -3.80, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'batch_rollback_wo', 20261006, '回滚弃权场胜负订正差额（比赛 #166）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #166）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, -3.80, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #169）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #169）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', -3.80, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'batch_rollback_wo', 20261006, '回滚弃权场胜负订正差额（比赛 #169）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #169）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, -3.80, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #172）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #172）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', -3.80, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'batch_rollback_wo', 20261006, '回滚弃权场胜负订正差额（比赛 #172）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #172）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, -3.80, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #176）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #176）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', -3.80, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'batch_rollback_wo', 20261006, '回滚弃权场胜负订正差额（比赛 #176）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场胜负订正差额（比赛 #176）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, -7.00, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #2，7.00M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #2，7.00M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', -7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #2，7.00M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #2，7.00M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -8.50, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #31，8.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #31，8.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -8.50, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #31，8.50M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #31，8.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -7.00, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #18，7.00M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #18，7.00M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #18，7.00M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #18，7.00M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -7.00, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #27，7.00M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #27，7.00M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #27，7.00M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #27，7.00M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -4.70, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #37，4.70M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #37，4.70M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -4.70, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #37，4.70M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #37，4.70M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -4.70, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #44，4.70M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #44，4.70M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -4.70, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #44，4.70M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #44，4.70M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -4.70, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #51，4.70M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #51，4.70M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -4.70, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #51，4.70M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #51，4.70M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -4.70, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #57，4.70M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #57，4.70M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -4.70, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #57，4.70M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #57，4.70M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -8.50, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #61，8.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #61，8.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -8.50, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #61，8.50M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #61，8.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -6.60, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #70，6.60M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #70，6.60M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -6.60, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #70，6.60M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #70，6.60M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, -7.00, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #22，7.00M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #22，7.00M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', -7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #22，7.00M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #22，7.00M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, -4.80, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #183，4.80M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #183，4.80M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', -4.80, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'batch_rollback_wo', 20261006, '回滚弃权场补发（比赛 #183，4.80M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场补发（比赛 #183，4.80M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, 8.50, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #31，原流水 id=23，+8.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #31，原流水 id=23，+8.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', 8.50, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #31，原流水 id=23，+8.50M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #31，原流水 id=23，+8.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, 8.50, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #38，原流水 id=40，+8.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #38，原流水 id=40，+8.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', 8.50, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #38，原流水 id=40，+8.50M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #38，原流水 id=40，+8.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, 8.50, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #48，原流水 id=60，+8.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #48，原流水 id=60，+8.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', 8.50, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #48，原流水 id=60，+8.50M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #48，原流水 id=60，+8.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, 6.70, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #165，原流水 id=31，+6.70M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #165，原流水 id=31，+6.70M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', 6.70, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #165，原流水 id=31，+6.70M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #165，原流水 id=31，+6.70M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, 1.36, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #2，原流水 id=97，+1.36M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #2，原流水 id=97，+1.36M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', 1.36, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #2，原流水 id=97，+1.36M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #2，原流水 id=97，+1.36M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, 1.08, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #31，原流水 id=24，+1.08M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #31，原流水 id=24，+1.08M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', 1.08, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #31，原流水 id=24，+1.08M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #31，原流水 id=24，+1.08M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 110374, 1.91, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #38，原流水 id=42，+1.91M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #38，原流水 id=42，+1.91M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', 1.91, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #38，原流水 id=42，+1.91M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #38，原流水 id=42，+1.91M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, 1.90, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #165，原流水 id=32，+1.90M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #165，原流水 id=32，+1.90M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', 1.90, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #165，原流水 id=32，+1.90M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #165，原流水 id=32，+1.90M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, 1.29, '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #172，原流水 id=63，+1.29M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #172，原流水 id=63，+1.29M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', 1.29, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'batch_rollback_wo', 20261006, '回滚弃权场回收（比赛 #172，原流水 id=63，+1.29M）', '2026-10-06T04:23:06Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = 20261006 AND memo = '回滚弃权场回收（比赛 #172，原流水 id=63，+1.29M）');