-- 执行前预检（只读）。执行：npx wrangler d1 execute whl-club --remote --file=sql/01-precheck.sql
-- 期望：A 4 行（全为冠军杯小组赛 stage_kind=group）/ B 3 笔 prize 7.00M（#10→280、#18→241、#22→112172；#16 无）/
--       C 7 队余额 / D 守恒 0 / E 本批键全 0 且「对手侧 canonical 键」全空。

-- A 4 场点球决胜（tour 侧 winner 记点球胜方）
SELECT match_id, competition_type, stage_kind, home_team, away_team, score_home, score_away, pen_home, pen_away, winner_team
  FROM result_confirmations WHERE match_id IN (10,16,18,22) ORDER BY match_id;

-- B 这些场次上的全部流水（应只有 3 笔 prize 7.00M；wx_fix 属天气订正批，与本批无关）
SELECT id, club_id, kind, amount, ref_type, ref_id, memo FROM ledger_entries
 WHERE ref_id IN (10,16,18,22) AND kind IN ('prize','manual_adjust') ORDER BY id;

-- C 受影响 7 队余额（执行前基线）
SELECT club_id, ROUND(balance, 2) AS bal FROM ledger_accounts
 WHERE club_id IN (280,11,241,45,112172,2,21) ORDER BY club_id;

-- D 守恒基线（Σ余额 − Σ流水，应恒为 0）
SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2) AS conserve;

-- E 键占用（本批键应全 0；对手侧 canonical 键应为空，胜者侧被原 7.00M 占用）
SELECT
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize') AS pk_rollback_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND (ref_type LIKE 'match_home_fix' OR ref_type LIKE 'match_away_fix') AND ref_id IN (10,16,18,22)) AS pk_fix_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type IN ('match_home','match_away') AND ref_id IN (10,16,18,22)) AS canonical_prize_n;
