-- 回滚 ③ 扣工资（补偿分录：kind=manual_adjust 反向退回）
-- 期望 changes = 36（18 队 × （账户 +、补偿流水 +））
-- club 1：退回 48.37 m
UPDATE ledger_accounts SET balance = balance + 48.37, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 1 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 1);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', 48.37, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 1）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 1);

-- club 2：退回 58.25 m
UPDATE ledger_accounts SET balance = balance + 58.25, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 2 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 2);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', 58.25, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 2）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 2);

-- club 5：退回 49.23 m
UPDATE ledger_accounts SET balance = balance + 49.23, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 5 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 5);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 5, 'manual_adjust', 49.23, (SELECT balance FROM ledger_accounts WHERE club_id = 5), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 5）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 5);

-- club 9：退回 73.55 m
UPDATE ledger_accounts SET balance = balance + 73.55, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 9 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 9);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', 73.55, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 9）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 9);

-- club 11：退回 63.68 m
UPDATE ledger_accounts SET balance = balance + 63.68, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 11 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 11);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', 63.68, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 11）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 11);

-- club 13：退回 57.48 m
UPDATE ledger_accounts SET balance = balance + 57.48, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 13 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 13);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', 57.48, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 13）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 13);

-- club 14：退回 48.62 m
UPDATE ledger_accounts SET balance = balance + 48.62, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 14 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 14);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', 48.62, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 14）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 14);

-- club 21：退回 56.98 m
UPDATE ledger_accounts SET balance = balance + 56.98, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 21 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 21);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', 56.98, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 21）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 21);

-- club 33：退回 62.53 m
UPDATE ledger_accounts SET balance = balance + 62.53, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 33 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 33);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 33, 'manual_adjust', 62.53, (SELECT balance FROM ledger_accounts WHERE club_id = 33), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 33）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 33);

-- club 45：退回 65.56 m
UPDATE ledger_accounts SET balance = balance + 65.56, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 45 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 45);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', 65.56, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 45）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 45);

-- club 66：退回 67.57 m
UPDATE ledger_accounts SET balance = balance + 67.57, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 66 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 66);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 66, 'manual_adjust', 67.57, (SELECT balance FROM ledger_accounts WHERE club_id = 66), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 66）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 66);

-- club 73：退回 66.44 m
UPDATE ledger_accounts SET balance = balance + 66.44, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 73 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 73);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', 66.44, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 73）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 73);

-- club 241：退回 61.48 m
UPDATE ledger_accounts SET balance = balance + 61.48, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 241 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 241);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', 61.48, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 241）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 241);

-- club 243：退回 56.77 m
UPDATE ledger_accounts SET balance = balance + 56.77, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 243 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 243);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'manual_adjust', 56.77, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 243）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 243);

-- club 280：退回 37.62 m
UPDATE ledger_accounts SET balance = balance + 37.62, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 280 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 280);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', 37.62, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 280）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 280);

-- club 449：退回 33.37 m
UPDATE ledger_accounts SET balance = balance + 33.37, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 449 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 449);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', 33.37, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 449）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 449);

-- club 110374：退回 57.49 m
UPDATE ledger_accounts SET balance = balance + 57.49, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 110374 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 110374);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', 57.49, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 110374）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 110374);

-- club 112172：退回 57.69 m
UPDATE ledger_accounts SET balance = balance + 57.69, updated_at = '2026-10-06T03:08:00.611Z' WHERE club_id = 112172 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 112172);

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', 57.69, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'batch_rollback_wage', 20261006, '回滚 S9 第 1 窗工资扣减（club 112172）', '2026-10-06T03:08:00.611Z'
WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'batch_rollback_wage' AND ref_id = 20261006 AND club_id = 112172);
