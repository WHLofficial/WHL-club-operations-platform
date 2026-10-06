-- 执行前预检（只读）。执行：npx wrangler d1 execute whl-club --remote --file=sql/01-precheck.sql
-- 期望：A 10 行（全 season 9 弃权场）/ B 9 行（弃权方胜场奖金 4 + 弃权场比赛日收入 5）/ C 8 队余额 / D 守恒 0 / E 键占用全 0。

-- A 全库弃权场（tour 侧 walkover_side = 弃权方，生产 note 逐场写「主队弃权」/「客队弃权」、winner 一律是对手）
SELECT rc.match_id, rc.competition_type, rc.stage_kind, rc.round, rc.home_team, rc.away_team,
       rc.score_home, rc.score_away, rc.walkover_side, rc.winner_team, rc.confirmed_at
  FROM result_confirmations rc
 WHERE rc.walkover_side IS NOT NULL AND rc.walkover_side != ''
 ORDER BY rc.match_id;

-- B 这些场次上的全部流水（应只有 9 笔：弃权方胜场奖金 4 + 弃权场比赛日收入 5）
SELECT e.id, e.club_id, e.kind, e.amount, e.ref_type, e.ref_id, e.memo, e.created_at
  FROM ledger_entries e
 WHERE e.ref_id IN (2,31,38,48,165,166,169,172,176,182) AND e.kind IN ('prize','revenue')
 ORDER BY e.ref_id, e.club_id;

-- C 受影响 8 队余额（执行前基线）
SELECT club_id, ROUND(balance, 2) AS bal FROM ledger_accounts
 WHERE club_id IN (1,2,14,21,241,449,110374,112172) ORDER BY club_id;

-- D 守恒基线（Σ余额 − Σ流水，应恒为 0）
SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2) AS conserve;

-- E 本批将占用的键（应全为 0；非 0 说明本批已跑过或键被占）
SELECT
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type LIKE 'wo_rollback%') AS wo_rollback_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND (ref_type = 'match_home_fix' OR ref_type = 'match_away_fix')) AS fix_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND club_id = 241 AND ref_id IN (18,27,31,37,44,51,57,61,70)) AS barca_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND club_id = 112172 AND ref_id IN (22,183)) AS leipzig_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND club_id = 449 AND ref_id = 2) AS betis_m2_n;
