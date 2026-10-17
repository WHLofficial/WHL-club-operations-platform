-- 收回：点球决胜错发的胜场奖金（补偿分录 kind=manual_adjust，保留原流水）
--
-- 生成时间：2026-10-17T12:01:26Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20
-- 共 3 笔 / 21.00M
-- memo 指回原流水 id；重放 changes=0

-- 收回 club 280（奥林匹亚科斯）比赛 #10 胜场奖金 7.00M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, -7.00, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 10)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 10);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', -7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'pk_rollback_prize', 10, '点球决胜改按平局·收回胜场奖金（比赛 #10 曼联 vs 奥林匹亚科斯，客队点球胜；原流水 id=83，-7.00M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 10);
-- 收回 club 241（巴塞罗那）比赛 #18 胜场奖金 7.00M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -7.00, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 18)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 18);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'pk_rollback_prize', 18, '点球决胜改按平局·收回胜场奖金（比赛 #18 巴塞罗那 vs 尤文图斯，主队点球胜；原流水 id=256，-7.00M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 18);
-- 收回 club 112172（RB莱比锡）比赛 #22 胜场奖金 7.00M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, -7.00, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 22)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 22);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', -7.00, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'pk_rollback_prize', 22, '点球决胜改按平局·收回胜场奖金（比赛 #22 阿斯顿维拉 vs RB莱比锡，客队点球胜；原流水 id=264，-7.00M）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize' AND ref_id = 22);