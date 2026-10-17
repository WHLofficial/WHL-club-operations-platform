-- 补发：按平局给双方各 2.50M（canonical 键优先，胜者侧已被原 7.00M 占用故走 _fix 键）
--
-- 生成时间：2026-10-17T12:01:26Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20
-- 共 7 笔 / 17.50M
-- 日后代码修订后重放该场不会双发（键与平台发奖同构）

-- 补发 club 280（奥林匹亚科斯）比赛 #10（away）平局奖金 2.50M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, 2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'prize' AND ref_type = 'match_away_fix' AND ref_id = 10)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'prize' AND ref_type = 'match_away_fix' AND ref_id = 10);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'prize', 2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'match_away_fix', 10, '冠军杯小组赛平局奖金（比赛 #10 曼联 vs 奥林匹亚科斯，点球决胜改按平局补发）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'prize' AND ref_type = 'match_away_fix' AND ref_id = 10);
-- 补发 club 11（曼联）比赛 #10（home）平局奖金 2.50M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 11, 2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'prize' AND ref_type = 'match_home' AND ref_id = 10)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'prize' AND ref_type = 'match_home' AND ref_id = 10);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 11, 'prize', 2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 11), 'match_home', 10, '冠军杯小组赛平局奖金（比赛 #10 曼联 vs 奥林匹亚科斯，点球决胜改按平局）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 11 AND kind = 'prize' AND ref_type = 'match_home' AND ref_id = 10);
-- 补发 club 21（拜仁慕尼黑）比赛 #16（away）平局奖金 2.50M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, 2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'prize' AND ref_type = 'match_away' AND ref_id = 16)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'prize' AND ref_type = 'match_away' AND ref_id = 16);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'prize', 2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'match_away', 16, '冠军杯小组赛平局奖金（比赛 #16 AC米兰(CPU) vs 拜仁慕尼黑，点球决胜改按平局）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'prize' AND ref_type = 'match_away' AND ref_id = 16);
-- 补发 club 241（巴塞罗那）比赛 #18（home）平局奖金 2.50M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 241, 2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'prize' AND ref_type = 'match_home_fix' AND ref_id = 18)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'prize' AND ref_type = 'match_home_fix' AND ref_id = 18);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 241, 'prize', 2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 241), 'match_home_fix', 18, '冠军杯小组赛平局奖金（比赛 #18 巴塞罗那 vs 尤文图斯，点球决胜改按平局补发）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 241 AND kind = 'prize' AND ref_type = 'match_home_fix' AND ref_id = 18);
-- 补发 club 45（尤文图斯）比赛 #18（away）平局奖金 2.50M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 45, 2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'prize' AND ref_type = 'match_away' AND ref_id = 18)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'prize' AND ref_type = 'match_away' AND ref_id = 18);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 45, 'prize', 2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 45), 'match_away', 18, '冠军杯小组赛平局奖金（比赛 #18 巴塞罗那 vs 尤文图斯，点球决胜改按平局）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 45 AND kind = 'prize' AND ref_type = 'match_away' AND ref_id = 18);
-- 补发 club 112172（RB莱比锡）比赛 #22（away）平局奖金 2.50M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, 2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'prize' AND ref_type = 'match_away_fix' AND ref_id = 22)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'prize' AND ref_type = 'match_away_fix' AND ref_id = 22);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'prize', 2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'match_away_fix', 22, '冠军杯小组赛平局奖金（比赛 #22 阿斯顿维拉 vs RB莱比锡，点球决胜改按平局补发）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'prize' AND ref_type = 'match_away_fix' AND ref_id = 22);
-- 补发 club 2（阿斯顿维拉）比赛 #22（home）平局奖金 2.50M
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, 2.50, '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'prize' AND ref_type = 'match_home' AND ref_id = 22)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'prize' AND ref_type = 'match_home' AND ref_id = 22);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'prize', 2.50, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'match_home', 22, '冠军杯小组赛平局奖金（比赛 #22 阿斯顿维拉 vs RB莱比锡，点球决胜改按平局）', '2026-10-17T12:01:26Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'prize' AND ref_type = 'match_home' AND ref_id = 22);