-- S9 天气订正批 · 回滚（还原上座行 + 反向分录）
--
-- 生成时间：2026-10-12T11:45:00Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20 --retry=2
-- 对应 sql/02-recalc.sql 的 78 场；上座行守卫看新值、账本锚 ref_type='wx_fix_undo'
-- 只跑了 02a 的情况下，未跑场次这里守卫不通过 ⇒ 自动 no-op


-- match 1｜还原 11175→9788｜差额 -0.21｜精确
UPDATE match_attendance SET weather = '雨', attendance = 9788, ticket = 1.47, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 1 AND attendance = 11175 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 66, -0.21, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 1)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 1);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 66, 'manual_adjust', -0.21, (SELECT balance FROM ledger_accounts WHERE club_id = 66), 'wx_fix_undo', 1, '天气订正回滚·match:1（撤销 wx_fix 分录；上座 11175→9788；天气 多云→雨；差额 -0.21）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 1);

-- match 3｜还原 16197→19682｜差额 0.52｜精确
UPDATE match_attendance SET weather = '晴', attendance = 19682, ticket = 2.95, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 3 AND attendance = 16197 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 9, 0.52, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 3)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 3);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', 0.52, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'wx_fix_undo', 3, '天气订正回滚·match:3（撤销 wx_fix 分录；上座 16197→19682；天气 多云→晴；差额 +0.52）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 3);

-- match 4｜还原 8949→11423｜差额 0.37｜精确
UPDATE match_attendance SET weather = '晴', attendance = 11423, ticket = 1.71, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 4 AND attendance = 8949 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 13, 0.37, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 4)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 4);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', 0.37, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'wx_fix_undo', 4, '天气订正回滚·match:4（撤销 wx_fix 分录；上座 8949→11423；天气 多云→晴；差额 +0.37）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 4);

-- match 5｜还原 9243→10600｜差额 0.20｜精确
UPDATE match_attendance SET weather = '多云', attendance = 10600, ticket = 1.59, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 5 AND attendance = 9243 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 33, 0.20, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 5)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 5);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 33, 'manual_adjust', 0.20, (SELECT balance FROM ledger_accounts WHERE club_id = 33), 'wx_fix_undo', 5, '天气订正回滚·match:5（撤销 wx_fix 分录；上座 9243→10600；天气 雨→多云；差额 +0.20）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 5);

-- match 7｜还原 14835→15254｜差额 0.06｜精确
UPDATE match_attendance SET weather = '晴', attendance = 15254, ticket = 2.29, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 7 AND attendance = 14835 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 110374, 0.06, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 7)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 7);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', 0.06, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'wx_fix_undo', 7, '天气订正回滚·match:7（撤销 wx_fix 分录；上座 14835→15254；天气 晴→晴；差额 +0.06）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 7);

-- match 9｜还原 11391→12719｜差额 0.20｜精确
UPDATE match_attendance SET weather = '雨', attendance = 12719, ticket = 1.91, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 9 AND attendance = 11391 AND weather = '雪';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 73, 0.20, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', 0.20, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'wx_fix_undo', 9, '天气订正回滚·match:9（撤销 wx_fix 分录；上座 11391→12719；天气 雪→雨；差额 +0.20）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 9);

-- match 10｜还原 16779→21824｜差额 0.75｜精确
UPDATE match_attendance SET weather = '晴', attendance = 21824, ticket = 3.27, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 10 AND attendance = 16779 AND weather = '雪';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 11, 0.75, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 10)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 10);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', 0.75, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'wx_fix_undo', 10, '天气订正回滚·match:10（撤销 wx_fix 分录；上座 16779→21824；天气 雪→晴；差额 +0.75）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 10);

-- match 11｜还原 6942→7629｜差额 0.10｜精确
UPDATE match_attendance SET weather = '多云', attendance = 7629, ticket = 1.14, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 11 AND attendance = 6942 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, 0.10, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 11)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 11);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', 0.10, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'wx_fix_undo', 11, '天气订正回滚·match:11（撤销 wx_fix 分录；上座 6942→7629；天气 雨→多云；差额 +0.10）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 11);

-- match 13｜还原 11549→11904｜差额 0.06｜精确
UPDATE match_attendance SET weather = '晴', attendance = 11904, ticket = 1.79, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 13 AND attendance = 11549 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 243, 0.06, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 13)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 13);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'manual_adjust', 0.06, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'wx_fix_undo', 13, '天气订正回滚·match:13（撤销 wx_fix 分录；上座 11549→11904；天气 多云→晴；差额 +0.06）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 13);

-- match 14｜还原 10919→10843｜差额 -0.01｜精确
UPDATE match_attendance SET weather = '多云', attendance = 10843, ticket = 1.63, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 14 AND attendance = 10919 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 13, -0.01, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 14)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 14);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', -0.01, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'wx_fix_undo', 14, '天气订正回滚·match:14（撤销 wx_fix 分录；上座 10919→10843；天气 多云→多云；差额 -0.01）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 14);

-- match 15｜还原 6715→5299｜差额 -0.22｜精确
UPDATE match_attendance SET weather = '雨', attendance = 5299, ticket = 0.79, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 15 AND attendance = 6715 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 1, -0.22, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 15)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 15);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', -0.22, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'wx_fix_undo', 15, '天气订正回滚·match:15（撤销 wx_fix 分录；上座 6715→5299；天气 晴→雨；差额 -0.22）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 15);

-- match 17｜还原 11010→9760｜差额 -0.19｜精确
UPDATE match_attendance SET weather = '多云', attendance = 9760, ticket = 1.46, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 17 AND attendance = 11010 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, -0.19, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 17)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 17);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', -0.19, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'wx_fix_undo', 17, '天气订正回滚·match:17（撤销 wx_fix 分录；上座 11010→9760；天气 晴→多云；差额 -0.19）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 17);

-- match 19｜还原 8038→7317｜差额 -0.11｜精确
UPDATE match_attendance SET weather = '雨', attendance = 7317, ticket = 1.10, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 19 AND attendance = 8038 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, -0.11, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 19)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 19);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', -0.11, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'wx_fix_undo', 19, '天气订正回滚·match:19（撤销 wx_fix 分录；上座 8038→7317；天气 多云→雨；差额 -0.11）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 19);

-- match 21｜还原 11904→11904｜差额 0.00｜精确
UPDATE match_attendance SET weather = '多云', attendance = 11904, ticket = 1.79, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 21 AND attendance = 11904 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 66, 0.00, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 21)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 21);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 66, 'manual_adjust', 0.00, (SELECT balance FROM ledger_accounts WHERE club_id = 66), 'wx_fix_undo', 21, '天气订正回滚·match:21（撤销 wx_fix 分录；上座 11904→11904；天气 晴→多云；差额 0.00）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 21);

-- match 22｜还原 8780→11904｜差额 0.47｜精确
UPDATE match_attendance SET weather = '晴', attendance = 11904, ticket = 1.79, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 22 AND attendance = 8780 AND weather = '雪';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, 0.47, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 22)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 22);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', 0.47, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'wx_fix_undo', 22, '天气订正回滚·match:22（撤销 wx_fix 分录；上座 8780→11904；天气 雪→晴；差额 +0.47）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 22);

-- match 23｜还原 17396→17377｜差额 0.00｜精确
UPDATE match_attendance SET weather = '多云', attendance = 17377, ticket = 2.61, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 23 AND attendance = 17396 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 9, 0.00, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 23)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 23);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', 0.00, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'wx_fix_undo', 23, '天气订正回滚·match:23（撤销 wx_fix 分录；上座 17396→17377；天气 多云→多云；差额 0.00）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 23);

-- match 25｜还原 11904→11904｜差额 0.00｜精确
UPDATE match_attendance SET weather = '雨', attendance = 11904, ticket = 1.79, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 25 AND attendance = 11904 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 33, 0.00, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 25)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 25);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 33, 'manual_adjust', 0.00, (SELECT balance FROM ledger_accounts WHERE club_id = 33), 'wx_fix_undo', 25, '天气订正回滚·match:25（撤销 wx_fix 分录；上座 11904→11904；天气 多云→雨；差额 0.00）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 25);

-- match 26｜还原 11052→14687｜差额 0.54｜精确
UPDATE match_attendance SET weather = '晴', attendance = 14687, ticket = 2.20, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 26 AND attendance = 11052 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, 0.54, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 26)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 26);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', 0.54, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'wx_fix_undo', 26, '天气订正回滚·match:26（撤销 wx_fix 分录；上座 11052→14687；天气 雨→晴；差额 +0.54）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 26);

-- match 28｜还原 16143→17221｜差额 0.16｜精确
UPDATE match_attendance SET weather = '多云', attendance = 17221, ticket = 2.58, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 28 AND attendance = 16143 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, 0.16, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 28)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 28);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', 0.16, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'wx_fix_undo', 28, '天气订正回滚·match:28（撤销 wx_fix 分录；上座 16143→17221；天气 多云→多云；差额 +0.16）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 28);

-- match 29｜还原 30025→28786｜差额 -0.18｜精确
UPDATE match_attendance SET weather = '晴', attendance = 28786, ticket = 4.32, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 29 AND attendance = 30025 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 73, -0.18, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 29)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 29);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', -0.18, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'wx_fix_undo', 29, '天气订正回滚·match:29（撤销 wx_fix 分录；上座 30025→28786；天气 晴→晴；差额 -0.18）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 29);

-- match 30｜还原 15531→17112｜差额 0.24｜精确
UPDATE match_attendance SET weather = '多云', attendance = 17112, ticket = 2.57, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 30 AND attendance = 15531 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 5, 0.24, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 30)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 30);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 5, 'manual_adjust', 0.24, (SELECT balance FROM ledger_accounts WHERE club_id = 5), 'wx_fix_undo', 30, '天气订正回滚·match:30（撤销 wx_fix 分录；上座 15531→17112；天气 雨→多云；差额 +0.24）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 30);

-- match 32｜还原 10456→13157｜差额 0.40｜精确
UPDATE match_attendance SET weather = '晴', attendance = 13157, ticket = 1.97, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 32 AND attendance = 10456 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, 0.40, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 32)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 32);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', 0.40, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'wx_fix_undo', 32, '天气订正回滚·match:32（撤销 wx_fix 分录；上座 10456→13157；天气 多云→晴；差额 +0.40）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 32);

-- match 33｜还原 13733→9554｜差额 -0.63｜精确
UPDATE match_attendance SET weather = '雨', attendance = 9554, ticket = 1.43, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 33 AND attendance = 13733 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 5, -0.63, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 33)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 33);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 5, 'manual_adjust', -0.63, (SELECT balance FROM ledger_accounts WHERE club_id = 5), 'wx_fix_undo', 33, '天气订正回滚·match:33（撤销 wx_fix 分录；上座 13733→9554；天气 晴→雨；差额 -0.63）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 33);

-- match 34｜还原 9205→10724｜差额 0.23｜精确
UPDATE match_attendance SET weather = '多云', attendance = 10724, ticket = 1.61, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 34 AND attendance = 9205 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 73, 0.23, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 34)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 34);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', 0.23, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'wx_fix_undo', 34, '天气订正回滚·match:34（撤销 wx_fix 分录；上座 9205→10724；天气 雨→多云；差额 +0.23）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 34);

-- match 36｜还原 9191→10834｜差额 0.25｜精确
UPDATE match_attendance SET weather = '多云', attendance = 10834, ticket = 1.63, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 36 AND attendance = 9191 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 9, 0.25, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 36)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 36);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', 0.25, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'wx_fix_undo', 36, '天气订正回滚·match:36（撤销 wx_fix 分录；上座 9191→10834；天气 雨→多云；差额 +0.25）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 36);

-- match 39｜还原 15534→13855｜差额 -0.25｜精确
UPDATE match_attendance SET weather = '多云', attendance = 13855, ticket = 2.08, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 39 AND attendance = 15534 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 11, -0.25, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 39)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 39);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', -0.25, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'wx_fix_undo', 39, '天气订正回滚·match:39（撤销 wx_fix 分录；上座 15534→13855；天气 晴→多云；差额 -0.25）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 39);

-- match 40｜还原 8283→7789｜差额 -0.07｜估计
UPDATE match_attendance SET weather = '多云', attendance = 7789, ticket = 1.17, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 40 AND attendance = 8283 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 33, -0.07, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 40)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 40);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 33, 'manual_adjust', -0.07, (SELECT balance FROM ledger_accounts WHERE club_id = 33), 'wx_fix_undo', 40, '天气订正回滚·match:40（撤销 wx_fix 分录；上座 8283→7789；天气 多云→多云；差额 -0.07）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 40);

-- match 41｜还原 12856→13068｜差额 0.03｜精确
UPDATE match_attendance SET weather = '雨', attendance = 13068, ticket = 1.96, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 41 AND attendance = 12856 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 5, 0.03, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 41)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 41);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 5, 'manual_adjust', 0.03, (SELECT balance FROM ledger_accounts WHERE club_id = 5), 'wx_fix_undo', 41, '天气订正回滚·match:41（撤销 wx_fix 分录；上座 12856→13068；天气 雨→雨；差额 +0.03）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 41);

-- match 42｜还原 6495→8682｜差额 0.33｜精确
UPDATE match_attendance SET weather = '晴', attendance = 8682, ticket = 1.30, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 42 AND attendance = 6495 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 66, 0.33, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 42)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 42);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 66, 'manual_adjust', 0.33, (SELECT balance FROM ledger_accounts WHERE club_id = 66), 'wx_fix_undo', 42, '天气订正回滚·match:42（撤销 wx_fix 分录；上座 6495→8682；天气 雨→晴；差额 +0.33）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 42);

-- match 43｜还原 12313→13938｜差额 0.24｜精确
UPDATE match_attendance SET weather = '多云', attendance = 13938, ticket = 2.09, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 43 AND attendance = 12313 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 9, 0.24, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 43)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 43);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', 0.24, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'wx_fix_undo', 43, '天气订正回滚·match:43（撤销 wx_fix 分录；上座 12313→13938；天气 雨→多云；差额 +0.24）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 43);

-- match 44｜还原 8381→11225｜差额 0.42｜精确
UPDATE match_attendance SET weather = '晴', attendance = 11225, ticket = 1.68, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 44 AND attendance = 8381 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 73, 0.42, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 44)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 44);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', 0.42, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'wx_fix_undo', 44, '天气订正回滚·match:44（撤销 wx_fix 分录；上座 8381→11225；天气 雨→晴；差额 +0.42）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 44);

-- match 45｜还原 9385→9916｜差额 0.08｜精确
UPDATE match_attendance SET weather = '多云', attendance = 9916, ticket = 1.49, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 45 AND attendance = 9385 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 66, 0.08, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 45)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 45);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 66, 'manual_adjust', 0.08, (SELECT balance FROM ledger_accounts WHERE club_id = 66), 'wx_fix_undo', 45, '天气订正回滚·match:45（撤销 wx_fix 分录；上座 9385→9916；天气 多云→多云；差额 +0.08）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 45);

-- match 46｜还原 16434→11532｜差额 -0.74｜精确
UPDATE match_attendance SET weather = '雨', attendance = 11532, ticket = 1.73, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 46 AND attendance = 16434 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, -0.74, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 46)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 46);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', -0.74, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'wx_fix_undo', 46, '天气订正回滚·match:46（撤销 wx_fix 分录；上座 16434→11532；天气 晴→雨；差额 -0.74）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 46);

-- match 47｜还原 7076→5860｜差额 -0.18｜精确
UPDATE match_attendance SET weather = '雪', attendance = 5860, ticket = 0.88, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 47 AND attendance = 7076 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 13, -0.18, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 47)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 47);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', -0.18, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'wx_fix_undo', 47, '天气订正回滚·match:47（撤销 wx_fix 分录；上座 7076→5860；天气 多云→雪；差额 -0.18）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 47);

-- match 49｜还原 13279→8658｜差额 -0.69｜精确
UPDATE match_attendance SET weather = '雪', attendance = 8658, ticket = 1.30, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 49 AND attendance = 13279 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 11, -0.69, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 49)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 49);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', -0.69, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'wx_fix_undo', 49, '天气订正回滚·match:49（撤销 wx_fix 分录；上座 13279→8658；天气 晴→雪；差额 -0.69）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 49);

-- match 50｜还原 12462→11502｜差额 -0.14｜精确
UPDATE match_attendance SET weather = '多云', attendance = 11502, ticket = 1.73, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 50 AND attendance = 12462 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, -0.14, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 50)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 50);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', -0.14, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'wx_fix_undo', 50, '天气订正回滚·match:50（撤销 wx_fix 分录；上座 12462→11502；天气 晴→多云；差额 -0.14）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 50);

-- match 51｜还原 16150→12929｜差额 -0.48｜精确
UPDATE match_attendance SET weather = '雨', attendance = 12929, ticket = 1.94, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 51 AND attendance = 16150 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 110374, -0.48, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 51)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 51);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', -0.48, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'wx_fix_undo', 51, '天气订正回滚·match:51（撤销 wx_fix 分录；上座 16150→12929；天气 晴→雨；差额 -0.48）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 51);

-- match 52｜还原 15359→15668｜差额 0.05｜精确
UPDATE match_attendance SET weather = '晴', attendance = 15668, ticket = 2.35, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 52 AND attendance = 15359 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 5, 0.05, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 52)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 52);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 5, 'manual_adjust', 0.05, (SELECT balance FROM ledger_accounts WHERE club_id = 5), 'wx_fix_undo', 52, '天气订正回滚·match:52（撤销 wx_fix 分录；上座 15359→15668；天气 晴→晴；差额 +0.05）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 52);

-- match 54｜还原 9730→9699｜差额 -0.01｜精确
UPDATE match_attendance SET weather = '多云', attendance = 9699, ticket = 1.45, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 54 AND attendance = 9730 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 13, -0.01, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 54)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 54);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', -0.01, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'wx_fix_undo', 54, '天气订正回滚·match:54（撤销 wx_fix 分录；上座 9730→9699；天气 多云→多云；差额 -0.01）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 54);

-- match 55｜还原 14902→15123｜差额 0.03｜精确
UPDATE match_attendance SET weather = '多云', attendance = 15123, ticket = 2.27, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 55 AND attendance = 14902 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, 0.03, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 55)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 55);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', 0.03, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'wx_fix_undo', 55, '天气订正回滚·match:55（撤销 wx_fix 分录；上座 14902→15123；天气 多云→多云；差额 +0.03）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 55);

-- match 56｜还原 25205→24419｜差额 -0.12｜精确
UPDATE match_attendance SET weather = '多云', attendance = 24419, ticket = 3.66, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 56 AND attendance = 25205 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 9, -0.12, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 56)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 56);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', -0.12, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'wx_fix_undo', 56, '天气订正回滚·match:56（撤销 wx_fix 分录；上座 25205→24419；天气 多云→多云；差额 -0.12）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 56);

-- match 59｜还原 10300→10283｜差额 -0.01｜精确
UPDATE match_attendance SET weather = '雪', attendance = 10283, ticket = 1.54, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 59 AND attendance = 10300 AND weather = '雪';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 66, -0.01, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 59)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 59);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 66, 'manual_adjust', -0.01, (SELECT balance FROM ledger_accounts WHERE club_id = 66), 'wx_fix_undo', 59, '天气订正回滚·match:59（撤销 wx_fix 分录；上座 10300→10283；天气 雪→雪；差额 -0.01）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 66 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 59);

-- match 60｜还原 20105→17269｜差额 -0.43｜精确
UPDATE match_attendance SET weather = '雨', attendance = 17269, ticket = 2.59, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 60 AND attendance = 20105 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 73, -0.43, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 60)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 60);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', -0.43, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'wx_fix_undo', 60, '天气订正回滚·match:60（撤销 wx_fix 分录；上座 20105→17269；天气 多云→雨；差额 -0.43）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 60);

-- match 62｜还原 18881→16374｜差额 -0.37｜精确
UPDATE match_attendance SET weather = '多云', attendance = 16374, ticket = 2.46, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 62 AND attendance = 18881 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 5, -0.37, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 62)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 62);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 5, 'manual_adjust', -0.37, (SELECT balance FROM ledger_accounts WHERE club_id = 5), 'wx_fix_undo', 62, '天气订正回滚·match:62（撤销 wx_fix 分录；上座 18881→16374；天气 晴→多云；差额 -0.37）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 5 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 62);

-- match 63｜还原 19590→21824｜差额 0.33｜精确
UPDATE match_attendance SET weather = '晴', attendance = 21824, ticket = 3.27, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 63 AND attendance = 19590 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 110374, 0.33, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 63)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 63);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', 0.33, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'wx_fix_undo', 63, '天气订正回滚·match:63（撤销 wx_fix 分录；上座 19590→21824；天气 多云→晴；差额 +0.33）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 63);

-- match 65｜还原 13116→12641｜差额 -0.07｜精确
UPDATE match_attendance SET weather = '晴', attendance = 12641, ticket = 1.90, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 65 AND attendance = 13116 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, -0.07, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 65)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 65);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', -0.07, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'wx_fix_undo', 65, '天气订正回滚·match:65（撤销 wx_fix 分录；上座 13116→12641；天气 晴→晴；差额 -0.07）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 65);

-- match 66｜还原 11904→11904｜差额 0.00｜精确
UPDATE match_attendance SET weather = '晴', attendance = 11904, ticket = 1.79, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 66 AND attendance = 11904 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 13, 0.00, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 66)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 66);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', 0.00, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'wx_fix_undo', 66, '天气订正回滚·match:66（撤销 wx_fix 分录；上座 11904→11904；天气 雨→晴；差额 0.00）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 66);

-- match 68｜还原 21824→19934｜差额 -0.28｜精确
UPDATE match_attendance SET weather = '雪', attendance = 19934, ticket = 2.99, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 68 AND attendance = 21824 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 11, -0.28, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 68)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 68);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', -0.28, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'wx_fix_undo', 68, '天气订正回滚·match:68（撤销 wx_fix 分录；上座 21824→19934；天气 雨→雪；差额 -0.28）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 68);

-- match 69｜还原 11904→11904｜差额 0.00｜精确
UPDATE match_attendance SET weather = '雨', attendance = 11904, ticket = 1.79, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 69 AND attendance = 11904 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 33, 0.00, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 69)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 69);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 33, 'manual_adjust', 0.00, (SELECT balance FROM ledger_accounts WHERE club_id = 33), 'wx_fix_undo', 69, '天气订正回滚·match:69（撤销 wx_fix 分录；上座 11904→11904；天气 多云→雨；差额 0.00）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 69);

-- match 70｜还原 17408→17341｜差额 -0.01｜精确
UPDATE match_attendance SET weather = '多云', attendance = 17341, ticket = 2.60, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 70 AND attendance = 17408 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, -0.01, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 70)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 70);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', -0.01, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'wx_fix_undo', 70, '天气订正回滚·match:70（撤销 wx_fix 分录；上座 17408→17341；天气 多云→多云；差额 -0.01）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 70);

-- match 71｜还原 21795→25762｜差额 0.59｜精确
UPDATE match_attendance SET weather = '晴', attendance = 25762, ticket = 3.86, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 71 AND attendance = 21795 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 9, 0.59, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 71)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 71);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 9, 'manual_adjust', 0.59, (SELECT balance FROM ledger_accounts WHERE club_id = 9), 'wx_fix_undo', 71, '天气订正回滚·match:71（撤销 wx_fix 分录；上座 21795→25762；天气 多云→晴；差额 +0.59）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 9 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 71);

-- match 73｜还原 8457→11980｜差额 0.53｜估计
UPDATE match_attendance SET weather = '晴', attendance = 11980, ticket = 1.80, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 73 AND attendance = 8457 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 13, 0.53, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 73)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 73);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 13, 'manual_adjust', 0.53, (SELECT balance FROM ledger_accounts WHERE club_id = 13), 'wx_fix_undo', 73, '天气订正回滚·match:73（撤销 wx_fix 分录；上座 8457→11980；天气 雨→晴；差额 +0.53）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 13 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 73);

-- match 75｜还原 10314→8334｜差额 -0.30｜估计
UPDATE match_attendance SET weather = '多云', attendance = 8334, ticket = 1.25, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 75 AND attendance = 10314 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 449, -0.30, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 75)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 75);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 449, 'manual_adjust', -0.30, (SELECT balance FROM ledger_accounts WHERE club_id = 449), 'wx_fix_undo', 75, '天气订正回滚·match:75（撤销 wx_fix 分录；上座 10314→8334；天气 晴→多云；差额 -0.30）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 449 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 75);

-- match 76｜还原 21683→21683｜差额 0.00｜估计
UPDATE match_attendance SET weather = '多云', attendance = 21683, ticket = 3.25, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 76 AND attendance = 21683 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 110374, 0.00, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 76)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 76);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 110374, 'manual_adjust', 0.00, (SELECT balance FROM ledger_accounts WHERE club_id = 110374), 'wx_fix_undo', 76, '天气订正回滚·match:76（撤销 wx_fix 分录；上座 21683→21683；天气 晴→多云；差额 0.00）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 110374 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 76);

-- match 77｜还原 34965→24011｜差额 -1.64｜估计
UPDATE match_attendance SET weather = '雨', attendance = 24011, ticket = 3.60, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 77 AND attendance = 34965 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 73, -1.64, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 77)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 77);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 73, 'manual_adjust', -1.64, (SELECT balance FROM ledger_accounts WHERE club_id = 73), 'wx_fix_undo', 77, '天气订正回滚·match:77（撤销 wx_fix 分录；上座 34965→24011；天气 晴→雨；差额 -1.64）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 73 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 77);

-- match 78｜还原 11988→8184｜差额 -0.57｜估计
UPDATE match_attendance SET weather = '雪', attendance = 8184, ticket = 1.23, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 78 AND attendance = 11988 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, -0.57, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 78)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 78);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'manual_adjust', -0.57, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'wx_fix_undo', 78, '天气订正回滚·match:78（撤销 wx_fix 分录；上座 11988→8184；天气 晴→雪；差额 -0.57）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 78);

-- match 80｜还原 21710→21710｜差额 0.00｜估计
UPDATE match_attendance SET weather = '多云', attendance = 21710, ticket = 3.26, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 80 AND attendance = 21710 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 11, 0.00, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 80)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 80);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'manual_adjust', 0.00, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'wx_fix_undo', 80, '天气订正回滚·match:80（撤销 wx_fix 分录；上座 21710→21710；天气 晴→多云；差额 0.00）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 80);

-- match 83｜还原 19196→15050｜差额 -0.62｜估计
UPDATE match_attendance SET weather = '多云', attendance = 15050, ticket = 2.26, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 83 AND attendance = 19196 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, -0.62, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 83)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 83);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'manual_adjust', -0.62, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'wx_fix_undo', 83, '天气订正回滚·match:83（撤销 wx_fix 分录；上座 19196→15050；天气 晴→多云；差额 -0.62）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 83);

-- match 163｜还原 7350→7374｜差额 0.01｜精确
UPDATE match_attendance SET weather = '多云', attendance = 7374, ticket = 1.11, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 163 AND attendance = 7350 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, 0.01, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 163)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 163);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', 0.01, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'wx_fix_undo', 163, '天气订正回滚·match:163（撤销 wx_fix 分录；上座 7350→7374；天气 多云→多云；差额 +0.01）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 163);

-- match 164｜还原 6838→6303｜差额 -0.08｜精确
UPDATE match_attendance SET weather = '雨', attendance = 6303, ticket = 0.95, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 164 AND attendance = 6838 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, -0.08, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 164)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 164);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', -0.08, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'wx_fix_undo', 164, '天气订正回滚·match:164（撤销 wx_fix 分录；上座 6838→6303；天气 多云→雨；差额 -0.08）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 164);

-- match 167｜还原 7008→8727｜差额 0.26｜精确
UPDATE match_attendance SET weather = '晴', attendance = 8727, ticket = 1.31, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 167 AND attendance = 7008 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 1, 0.26, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 167)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 167);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', 0.26, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'wx_fix_undo', 167, '天气订正回滚·match:167（撤销 wx_fix 分录；上座 7008→8727；天气 多云→晴；差额 +0.26）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 167);

-- match 170｜还原 6787→8636｜差额 0.28｜精确
UPDATE match_attendance SET weather = '晴', attendance = 8636, ticket = 1.30, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 170 AND attendance = 6787 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, 0.28, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 170)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 170);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', 0.28, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'wx_fix_undo', 170, '天气订正回滚·match:170（撤销 wx_fix 分录；上座 6787→8636；天气 多云→晴；差额 +0.28）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 170);

-- match 171｜还原 8412→7863｜差额 -0.08｜精确
UPDATE match_attendance SET weather = '多云', attendance = 7863, ticket = 1.18, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 171 AND attendance = 8412 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, -0.08, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 171)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 171);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', -0.08, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'wx_fix_undo', 171, '天气订正回滚·match:171（撤销 wx_fix 分录；上座 8412→7863；天气 多云→多云；差额 -0.08）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 171);

-- match 173｜还原 7228→8091｜差额 0.13｜精确
UPDATE match_attendance SET weather = '多云', attendance = 8091, ticket = 1.21, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 173 AND attendance = 7228 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, 0.13, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 173)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 173);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', 0.13, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'wx_fix_undo', 173, '天气订正回滚·match:173（撤销 wx_fix 分录；上座 7228→8091；天气 雨→多云；差额 +0.13）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 173);

-- match 174｜还原 5869→7419｜差额 0.23｜精确
UPDATE match_attendance SET weather = '多云', attendance = 7419, ticket = 1.11, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 174 AND attendance = 5869 AND weather = '雪';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 243, 0.23, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 174)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 174);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'manual_adjust', 0.23, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'wx_fix_undo', 174, '天气订正回滚·match:174（撤销 wx_fix 分录；上座 5869→7419；天气 雪→多云；差额 +0.23）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 174);

-- match 175｜还原 7660→11610｜差额 0.59｜精确
UPDATE match_attendance SET weather = '晴', attendance = 11610, ticket = 1.74, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 175 AND attendance = 7660 AND weather = '雪';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 243, 0.59, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 175)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 175);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'manual_adjust', 0.59, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'wx_fix_undo', 175, '天气订正回滚·match:175（撤销 wx_fix 分录；上座 7660→11610；天气 雪→晴；差额 +0.59）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 175);

-- match 178｜还原 4637→5205｜差额 0.08｜精确
UPDATE match_attendance SET weather = '雨', attendance = 5205, ticket = 0.78, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 178 AND attendance = 4637 AND weather = '雪';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 1, 0.08, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 178)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 178);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', 0.08, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'wx_fix_undo', 178, '天气订正回滚·match:178（撤销 wx_fix 分录；上座 4637→5205；天气 雪→雨；差额 +0.08）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 178);

-- match 179｜还原 6836→6921｜差额 0.01｜精确
UPDATE match_attendance SET weather = '多云', attendance = 6921, ticket = 1.04, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 179 AND attendance = 6836 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, 0.01, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 179)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 179);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', 0.01, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'wx_fix_undo', 179, '天气订正回滚·match:179（撤销 wx_fix 分录；上座 6836→6921；天气 多云→多云；差额 +0.01）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 179);

-- match 180｜还原 9494→10410｜差额 0.14｜精确
UPDATE match_attendance SET weather = '多云', attendance = 10410, ticket = 1.56, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 180 AND attendance = 9494 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, 0.14, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 180)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 180);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', 0.14, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'wx_fix_undo', 180, '天气订正回滚·match:180（撤销 wx_fix 分录；上座 9494→10410；天气 雨→多云；差额 +0.14）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 180);

-- match 181｜还原 10643→8465｜差额 -0.33｜精确
UPDATE match_attendance SET weather = '雨', attendance = 8465, ticket = 1.27, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 181 AND attendance = 10643 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, -0.33, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 181)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 181);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', -0.33, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'wx_fix_undo', 181, '天气订正回滚·match:181（撤销 wx_fix 分录；上座 10643→8465；天气 晴→雨；差额 -0.33）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 181);

-- match 183｜还原 8195→7316｜差额 -0.13｜精确
UPDATE match_attendance SET weather = '多云', attendance = 7316, ticket = 1.10, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 183 AND attendance = 8195 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, -0.13, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 183)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 183);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'manual_adjust', -0.13, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'wx_fix_undo', 183, '天气订正回滚·match:183（撤销 wx_fix 分录；上座 8195→7316；天气 晴→多云；差额 -0.13）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 183);

-- match 184｜还原 14949→11274｜差额 -0.55｜精确
UPDATE match_attendance SET weather = '雨', attendance = 11274, ticket = 1.69, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 184 AND attendance = 14949 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, -0.55, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 184)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 184);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'manual_adjust', -0.55, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'wx_fix_undo', 184, '天气订正回滚·match:184（撤销 wx_fix 分录；上座 14949→11274；天气 晴→雨；差额 -0.55）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 184);

-- match 185｜还原 11609→10453｜差额 -0.17｜精确
UPDATE match_attendance SET weather = '雨', attendance = 10453, ticket = 1.57, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 185 AND attendance = 11609 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 243, -0.17, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 185)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 185);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'manual_adjust', -0.17, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'wx_fix_undo', 185, '天气订正回滚·match:185（撤销 wx_fix 分录；上座 11609→10453；天气 多云→雨；差额 -0.17）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 185);

-- match 186｜还原 5003→7037｜差额 0.31｜精确
UPDATE match_attendance SET weather = '晴', attendance = 7037, ticket = 1.06, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 186 AND attendance = 5003 AND weather = '雨';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 1, 0.31, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 186)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 186);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'manual_adjust', 0.31, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'wx_fix_undo', 186, '天气订正回滚·match:186（撤销 wx_fix 分录；上座 5003→7037；天气 雨→晴；差额 +0.31）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 186);

-- match 187｜还原 11988→9802｜差额 -0.33｜估计
UPDATE match_attendance SET weather = '雨', attendance = 9802, ticket = 1.47, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 187 AND attendance = 11988 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, -0.33, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 187)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 187);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'manual_adjust', -0.33, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'wx_fix_undo', 187, '天气订正回滚·match:187（撤销 wx_fix 分录；上座 11988→9802；天气 晴→雨；差额 -0.33）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 187);

-- match 189｜还原 10874→11882｜差额 0.15｜估计
UPDATE match_attendance SET weather = '晴', attendance = 11882, ticket = 1.78, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 189 AND attendance = 10874 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, 0.15, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 189)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 189);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', 0.15, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'wx_fix_undo', 189, '天气订正回滚·match:189（撤销 wx_fix 分录；上座 10874→11882；天气 晴→晴；差额 +0.15）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 189);

-- match 190｜还原 3017→2367｜差额 -0.09｜估计
UPDATE match_attendance SET weather = '多云', attendance = 2367, ticket = 0.36, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 190 AND attendance = 3017 AND weather = '晴';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, -0.09, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 190)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 190);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'manual_adjust', -0.09, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'wx_fix_undo', 190, '天气订正回滚·match:190（撤销 wx_fix 分录；上座 3017→2367；天气 晴→多云；差额 -0.09）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 190);

-- match 192｜还原 9963→11843｜差额 0.29｜估计
UPDATE match_attendance SET weather = '晴', attendance = 11843, ticket = 1.78, commercial = 0.00, broadcast = 0.00
 WHERE match_id = 192 AND attendance = 9963 AND weather = '多云';
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, 0.29, '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 192)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 192);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'manual_adjust', 0.29, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'wx_fix_undo', 192, '天气订正回滚·match:192（撤销 wx_fix 分录；上座 9963→11843；天气 多云→晴；差额 +0.29）', '2026-10-12T11:45:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'manual_adjust' AND ref_type = 'wx_fix_undo' AND ref_id = 192);
