-- 补发：联赛 2 级 7 家俱乐部各 12.50M（入场奖金 次级 7.5 → 顶级 20 的差额）
--
-- 生成时间：2026-10-17T13:41:41Z
-- 执行：node exec-shards.mjs sql/03-entry-topup.sql --remote --chunk=20
-- 共 7 笔 / 87.50M（CPU 队 10 曼城 不在内：不入账）
-- 与结算的关系：season-settle.ts:122-124 仍按 prize_table.league_second.entry = 7.5 发基础额
--   ⇒ 次级球队本赛季入场奖金合计 20 = 顶级水平；本批**不改** league_second.entry（S10 版权池 300 将取代入场奖金）
-- 键 = (club_id, kind='prize', ref_type='entry_topup', ref_id=9)：重放 changes 0；与平台发奖键（match_*/stage）不重叠

-- 补发 club 1（阿森纳）联赛入场奖金差额 12.50M（次级 7.5 → 顶级 20）
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 1, 12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 1, 'prize', 12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 1), 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 1 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
-- 补发 club 2（阿斯顿维拉）联赛入场奖金差额 12.50M（次级 7.5 → 顶级 20）
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 2, 12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 2, 'prize', 12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 2), 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 2 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
-- 补发 club 14（诺丁汉森林）联赛入场奖金差额 12.50M（次级 7.5 → 顶级 20）
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 14, 12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 14, 'prize', 12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 14), 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 14 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
-- 补发 club 21（拜仁慕尼黑）联赛入场奖金差额 12.50M（次级 7.5 → 顶级 20）
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 21, 12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 21, 'prize', 12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 21), 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 21 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
-- 补发 club 243（皇家马德里）联赛入场奖金差额 12.50M（次级 7.5 → 顶级 20）
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 243, 12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243, 'prize', 12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 243), 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 243 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
-- 补发 club 280（奥林匹亚科斯）联赛入场奖金差额 12.50M（次级 7.5 → 顶级 20）
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 280, 12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 280, 'prize', 12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 280), 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 280 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
-- 补发 club 112172（RB莱比锡）联赛入场奖金差额 12.50M（次级 7.5 → 顶级 20）
INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT 112172, 12.50, '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9)
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 112172, 'prize', 12.50, (SELECT balance FROM ledger_accounts WHERE club_id = 112172), 'entry_topup', 9, '联赛入场奖金差额补发（S9，次级补至顶级水平）', '2026-10-17T13:41:41Z'
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = 112172 AND kind = 'prize' AND ref_type = 'entry_topup' AND ref_id = 9);
