-- 执行前预检（只读）。执行：node exec-shards.mjs sql/01-precheck.sql --remote
-- 期望：A prize_table 0 行（生效值 = 代码默认 pool 200）；B group_paid = 192.5（⇒ 池降到 192.5 时 remaining = 0）；
--       C 本批键 0 笔；D 7 队余额基线（执行后各 +12.50）；E 守恒 0；F 已结算赛事 0 行（小组赛尚未结算）。
-- 注：本文件走 --command 通道 ⇒ 不写 || 、<> 、> 、< 、" 、% 等会被 shell 抢先解释的字符；
--     胜负判定改用 sign(score_home - score_away)（1 主胜 / -1 客胜 / 0 平）。

-- A prize_table 现值（0 行 = 代码默认；>0 行则应先看是不是别的批写的）
SELECT 'prize_table_rows' AS k, COUNT(*) AS v FROM config WHERE key = 'prize_table';

-- B 冠军杯小组赛 paid 口径（= 25 胜 × 7.0 + 7 平 × 2.5，CPU 侧不计；与 season-settle.aggregateRecords 同式）
SELECT 'group_paid' AS k,
       (7.0 * ((SELECT COUNT(*) FROM result_confirmations WHERE tournament_id = 3 AND COALESCE(walkover_side, '') = '' AND sign(score_home - score_away) = 1 AND home_team_id NOT IN (10, 131681))
             + (SELECT COUNT(*) FROM result_confirmations WHERE tournament_id = 3 AND COALESCE(walkover_side, '') = '' AND sign(score_home - score_away) = -1 AND away_team_id NOT IN (10, 131681))
             + (SELECT COUNT(*) FROM result_confirmations WHERE tournament_id = 3 AND COALESCE(walkover_side, '') = 'home' AND home_team_id NOT IN (10, 131681))
             + (SELECT COUNT(*) FROM result_confirmations WHERE tournament_id = 3 AND COALESCE(walkover_side, '') = 'away' AND away_team_id NOT IN (10, 131681)))
       + 2.5 * ((SELECT COUNT(*) FROM result_confirmations WHERE tournament_id = 3 AND COALESCE(walkover_side, '') = '' AND sign(score_home - score_away) = 0 AND home_team_id NOT IN (10, 131681))
             + (SELECT COUNT(*) FROM result_confirmations WHERE tournament_id = 3 AND COALESCE(walkover_side, '') = '' AND sign(score_home - score_away) = 0 AND away_team_id NOT IN (10, 131681)))) AS v;

-- C 本批键占用（应 0 笔：账户 + 流水都未写过）
SELECT 'entry_topup_n' AS k, COUNT(*) AS v FROM ledger_entries WHERE ref_type = 'entry_topup';

-- D 7 队余额基线（执行后各应 +12.50）
SELECT club_id, ROUND(balance, 2) AS bal FROM ledger_accounts
 WHERE club_id IN (1, 2, 14, 21, 243, 280, 112172) ORDER BY club_id;

-- E 守恒基线（Σ余额 − Σ流水，应恒为 0）
SELECT 'conserve' AS k, ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2) AS v;

-- F 已结算赛事数（0 行 = 小组赛剩余池尚未结算；池值可在结算前任何时刻改）
SELECT 'settled_n' AS k, COUNT(*) AS v FROM season_tournaments WHERE stage_settled_at IS NOT NULL;
