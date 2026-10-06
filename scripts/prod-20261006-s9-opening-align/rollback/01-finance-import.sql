-- 回滚 ② 期初财政导入（补偿分录：kind=manual_adjust 反向冲回，保留原流水）
-- 期望 changes = 32（16 队 × （账户 −、补偿流水 +））
-- club 73 巴黎圣日耳曼：撤回 119.75 m
UPDATE ledger_accounts SET balance = balance - 119.75, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 73 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 73);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', -119.75, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 73）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 73);

-- club 66 里昂：撤回 72.9 m
UPDATE ledger_accounts SET balance = balance - 72.9, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 66 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 66);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 66, 'manual_adjust', -72.9, (SELECT balance FROM ledger_accounts WHERE club_id = 66), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 66）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 66);

-- club 9 利物浦：撤回 119.37 m
UPDATE ledger_accounts SET balance = balance - 119.37, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 9 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 9);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', -119.37, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 9）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 9);

-- club 11 曼联：撤回 60.49 m
UPDATE ledger_accounts SET balance = balance - 60.49, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 11 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 11);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', -60.49, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 11）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 11);

-- club 33 慕尼黑1860：撤回 60.83 m
UPDATE ledger_accounts SET balance = balance - 60.83, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 33 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 33);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 33, 'manual_adjust', -60.83, (SELECT balance FROM ledger_accounts WHERE club_id = 33), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 33）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 33);

-- club 13 纽卡斯尔联：撤回 53.59 m
UPDATE ledger_accounts SET balance = balance - 53.59, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 13 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 13);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', -53.59, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 13）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 13);

-- club 45 尤文图斯：撤回 92.46 m
UPDATE ledger_accounts SET balance = balance - 92.46, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 45 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 45);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', -92.46, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 45）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 45);

-- club 110374 佛罗伦萨：撤回 20.16 m
UPDATE ledger_accounts SET balance = balance - 20.16, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 110374 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 110374);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', -20.16, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 110374）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 110374);

-- club 5 切尔西：撤回 2.05 m
UPDATE ledger_accounts SET balance = balance - 2.05, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 5 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 5);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 5, 'manual_adjust', -2.05, (SELECT balance FROM ledger_accounts WHERE club_id = 5), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 5）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 5);

-- club 449 皇家贝蒂斯：撤回 44.78 m
UPDATE ledger_accounts SET balance = balance - 44.78, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 449 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 449);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', -44.78, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 449）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 449);

-- club 2 阿斯顿维拉：撤回 40.79 m
UPDATE ledger_accounts SET balance = balance - 40.79, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 2 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 2);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', -40.79, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 2）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 2);

-- club 21 拜仁慕尼黑：撤回 78.66 m
UPDATE ledger_accounts SET balance = balance - 78.66, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 21 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 21);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', -78.66, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 21）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 21);

-- club 1 阿森纳：撤回 51.76 m
UPDATE ledger_accounts SET balance = balance - 51.76, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 1 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 1);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', -51.76, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 1）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 1);

-- club 280 奥林匹亚科斯：撤回 45.66 m
UPDATE ledger_accounts SET balance = balance - 45.66, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 280 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 280);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', -45.66, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 280）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 280);

-- club 14 诺丁汉森林：撤回 84.1 m
UPDATE ledger_accounts SET balance = balance - 84.1, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 14 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 14);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', -84.1, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 14）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 14);

-- club 243 皇家马德里：撤回 20.9 m
UPDATE ledger_accounts SET balance = balance - 20.9, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 243 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 243);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'manual_adjust', -20.9, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'batch_rollback_finance', 20261006, '回滚期初余额导入（S9 期初对齐批，club 243）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_finance' AND ref_id = 20261006 AND club_id = 243);
