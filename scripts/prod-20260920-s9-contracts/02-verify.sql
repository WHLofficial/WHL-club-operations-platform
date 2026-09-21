-- 只读验收：执行后跑一次（node scratch/run-verify.mjs 本文件）
-- 批次标记口径：本批全部语句写 signed_at = '2026-09-21T01:46:58.647Z'，该时刻全库唯一 ⇒ 范围收窄为「本批落库的行」。
-- 预期：rows_total = rows_import = 462、formal = 399、trainee = 63，
--       其余 bad_* / null_* / off_grid 全为 0（formal 行 protection_ticks 必须 = service_ticks + 3；
--       trainee 行 wage = 0.75 / release_fee = 5 / protection_ticks IS NULL；刻度跨度 1 − service_ticks 必须 ∈ 0…5 的整数）。
-- 效力年分布期望：0 赛季 163、0.5 赛季 14、1 赛季 69、1.5 赛季 82、2 赛季 55、2.5 赛季 79。

SELECT
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z') AS rows_total,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND source = 'import') AS rows_import,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND contract_type = 'formal') AS formal,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND contract_type = 'trainee') AS trainee,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND contract_type NOT IN ('formal','trainee')) AS bad_type,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND service_ticks IS NULL) AS null_service_ticks,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND contract_type = 'formal' AND protection_ticks <> service_ticks + 3) AS bad_protection,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND contract_type = 'trainee' AND (wage <> 0.75 OR release_fee <> 5 OR protection_ticks IS NOT NULL)) AS bad_trainee,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND (release_fee <= 0 OR release_fee > 1000 OR wage < 0 OR wage > 100)) AS bad_money,
  (SELECT COUNT(*) FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' AND (1 - service_ticks) NOT IN (0,1,2,3,4,5)) AS off_grid,
  (SELECT COUNT(*) FROM contracts c LEFT JOIN players p ON p.id = c.player_id WHERE c.signed_at = '2026-09-21T01:46:58.647Z' AND (p.id IS NULL OR p.club_id <> c.club_id)) AS club_mismatch;

-- 逐队条数（期望与报告 §2 的「可导行」列一致）：
SELECT c.club_id, COUNT(*) AS n FROM contracts c WHERE c.signed_at = '2026-09-21T01:46:58.647Z' GROUP BY c.club_id ORDER BY c.club_id;

-- 效力年分布（期望与报告 §2 合计行的分布一致）：
SELECT (1 - service_ticks) AS tick_span, ROUND((1 - service_ticks) * 0.5, 1) AS seasons, COUNT(*) AS n
FROM contracts WHERE signed_at = '2026-09-21T01:46:58.647Z' GROUP BY service_ticks ORDER BY service_ticks DESC;

-- 落在 16 支目标队之外的合同（期望空集）：合计 462 条分布在 16 支队
SELECT c.club_id, COUNT(*) AS n FROM contracts c WHERE c.signed_at = '2026-09-21T01:46:58.647Z' AND c.club_id NOT IN (1,2,5,9,11,13,14,21,33,45,66,73,243,280,449,110374) GROUP BY c.club_id;
