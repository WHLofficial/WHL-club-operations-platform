-- 执行后回读（只读）。执行：node exec-shards.mjs sql/04-verify.sql --remote
-- 期望：A 1 行且含 pool 192.5；B 7 笔 / 87.50；C 7 队余额 = 预检基线 + 12.50（112172 应转正）；
--       D 全联盟合计 = 预检合计 + 87.50；E 守恒 0；F 重放检测（本批键各恰好 1 笔）。

-- A prize_table 现值（应 1 行；value 里 champions_group.pool 为 192.5）
SELECT key AS k, value AS v FROM config WHERE key = 'prize_table';

-- B 本批流水（应 7 笔 / 87.50）
SELECT 'entry_topup' AS k, COUNT(*) AS n, ROUND(COALESCE(SUM(amount), 0), 2) AS s FROM ledger_entries WHERE ref_type = 'entry_topup';

-- C 7 队余额（应 = 预检基线 + 12.50）
SELECT club_id, ROUND(balance, 2) AS bal FROM ledger_accounts
 WHERE club_id IN (1, 2, 14, 21, 243, 280, 112172) ORDER BY club_id;

-- D 全联盟合计
SELECT 'league_total' AS k, ROUND(SUM(balance), 2) AS v FROM ledger_accounts;

-- E 守恒（Σ余额 − Σ流水，应恒为 0）
SELECT 'conserve' AS k, ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2) AS v;

-- F 重放检测（应全 1：每队恰好一笔；大于 1 说明重放没被守卫挡住）
SELECT club_id, COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'entry_topup' GROUP BY club_id ORDER BY club_id;
