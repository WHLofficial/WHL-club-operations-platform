-- 01-precheck.sql —— 只读预检（S9 期初对齐：财政导入 / 扣工资 / 效力 +0.5 / 标记球员状态）
-- 全部为 SELECT，不改任何数据。执行通道：npx wrangler d1 execute whl-club --remote --json --command "<单条>"
-- 语句本身不含 shell 元字符（无 " % & | < >），可直接走 --command。

-- A 目标俱乐部与当前余额（16 支导入队 + 2 支排除队一并列出，便于核对）
SELECT c.id, c.name, c.league_tier, c.is_cpu, ROUND(COALESCE(a.balance, 0), 2) AS balance
FROM clubs c
LEFT JOIN ledger_accounts a ON a.club_id = c.id
ORDER BY c.id;

-- B 各队现行合同工资和（②扣工资的 delta 来源；口径同 src/worker/window-payroll.ts）
SELECT ct.club_id, ROUND(SUM(ct.wage), 2) AS wage_sum, COUNT(*) AS n
FROM contracts ct
WHERE ct.is_active = 1 AND ct.club_id IS NOT NULL AND ct.wage IS NOT NULL
GROUP BY ct.club_id
ORDER BY ct.club_id;

-- C 现行合同逐行（③效力 +0.5 的逐行守卫来源：id + service_ticks 快照）
SELECT id, club_id, player_id, service_ticks, protection_ticks, release_fee, wage, contract_type
FROM contracts
WHERE is_active = 1
ORDER BY club_id, player_id;

-- D 写入前守卫自检（都应为 0 / 517）
SELECT (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'opening_import') AS opening_import_n,
       (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901) AS wage_901_n,
       (SELECT COUNT(*) FROM transfers) AS transfers_n,
       (SELECT COUNT(*) FROM season_windows WHERE status = 'closed' AND is_temporary = 0) AS closed_regular,
       (SELECT COUNT(*) FROM contracts WHERE is_active = 1) AS active_contracts,
       (SELECT COUNT(*) FROM contracts WHERE is_active = 1 AND club_id IS NULL) AS active_contracts_no_club;

-- E 窗口全表（口径核对：S9 第 1 窗已关、无临时窗）
SELECT id, season, window_seq, status, is_temporary, opened_at, closed_at FROM season_windows ORDER BY season, window_seq;

-- F 标记球员（CSV col28 = 已匹配/已续约1）的合同现状（④保护期收口 + 补录单的依据）
SELECT p.fc_id, p.id AS player_id, p.status AS player_status, c.id AS club_id, c.name AS club_name,
       ct.id AS contract_id, ct.contract_type, ct.release_fee, ct.wage, ct.service_ticks, ct.protection_ticks, ct.is_active,
       ct.signed_at
FROM players p
LEFT JOIN clubs c ON c.id = p.club_id
LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
WHERE p.fc_id IN (235212, 252145, 272834, 247635, 268889, 239231, 231747, 264453, 273651, 264652, 204525, 158023,
                  271421, 277954, 272505, 251570, 215441, 278901, 247819, 254022, 254243, 261865, 251566, 71351,
                  264309, 246430, 209331, 207865, 208128, 210413)
ORDER BY p.fc_id;
