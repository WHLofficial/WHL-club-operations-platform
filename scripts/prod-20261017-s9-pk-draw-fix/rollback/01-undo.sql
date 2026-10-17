-- 回滚：撤销本批全部写入（补偿分录，保留本批流水）
--
-- 生成时间：2026-10-17T12:01:26Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20
-- 共 10 笔；ref_type='batch_rollback_pk'、ref_id=20261017，每笔一句 NOT EXISTS 守卫，重放 changes=0

INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, 7.00, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 280，-7.00M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 280，-7.00M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', 7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #10，club 280，-7.00M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 280，-7.00M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, -2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 280，+2.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 280，+2.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', -2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #10，club 280，+2.50M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 280，+2.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 11, -2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 11，+2.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 11，+2.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', -2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #10，club 11，+2.50M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #10，club 11，+2.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, -2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #16，club 21，+2.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #16，club 21，+2.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', -2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #16，club 21，+2.50M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #16，club 21，+2.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, 7.00, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 241，-7.00M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 241，-7.00M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', 7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #18，club 241，-7.00M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 241，-7.00M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 241，+2.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 241，+2.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #18，club 241，+2.50M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 241，+2.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, -2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 45，+2.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 45，+2.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', -2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #18，club 45，+2.50M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #18，club 45，+2.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, 7.00, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 112172，-7.00M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 112172，-7.00M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', 7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #22，club 112172，-7.00M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 112172，-7.00M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, -2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 112172，+2.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 112172，+2.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', -2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #22，club 112172，+2.50M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 112172，+2.50M）');
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, -2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 2，+2.50M）')
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 2，+2.50M）');
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', -2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'batch_rollback_pk', 20261017, '回滚点球决胜订正（比赛 #22，club 2，+2.50M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = 20261017 AND memo = '回滚点球决胜订正（比赛 #22，club 2，+2.50M）');