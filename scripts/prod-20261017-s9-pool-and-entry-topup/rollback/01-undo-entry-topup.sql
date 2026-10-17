-- 回滚 ①：撤销 7 笔次级入场奖金差额补发（补偿分录，保留本批流水）
--
-- 生成时间：2026-10-17T13:41:41Z
-- 执行：node exec-shards.mjs rollback/01-undo-entry-topup.sql --remote --chunk=20
-- 共 7 笔；ref_type='batch_rollback_entry_topup'、ref_id=20261017，每笔一句 NOT EXISTS 守卫，重放 changes=0

INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 1, -12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 1，-12.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 1，-12.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', -12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'batch_rollback_entry_topup', 20261017, '回滚次级入场奖金差额补发（S9，club 1，-12.50M）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 1，-12.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, -12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 2，-12.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 2，-12.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', -12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'batch_rollback_entry_topup', 20261017, '回滚次级入场奖金差额补发（S9，club 2，-12.50M）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 2，-12.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, -12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 14，-12.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 14，-12.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', -12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'batch_rollback_entry_topup', 20261017, '回滚次级入场奖金差额补发（S9，club 14，-12.50M）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 14，-12.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, -12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 21，-12.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 21，-12.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', -12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'batch_rollback_entry_topup', 20261017, '回滚次级入场奖金差额补发（S9，club 21，-12.50M）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 21，-12.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 243, -12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 243，-12.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 243，-12.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'manual_adjust', -12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'batch_rollback_entry_topup', 20261017, '回滚次级入场奖金差额补发（S9，club 243，-12.50M）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 243，-12.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, -12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 280，-12.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 280，-12.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', -12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'batch_rollback_entry_topup', 20261017, '回滚次级入场奖金差额补发（S9，club 280，-12.50M）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 280，-12.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, -12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 112172，-12.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 112172，-12.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', -12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'batch_rollback_entry_topup', 20261017, '回滚次级入场奖金差额补发（S9，club 112172，-12.50M）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_entry_topup' AND ref_id = 20261017 AND memo = '回滚次级入场奖金差额补发（S9，club 112172，-12.50M）');
