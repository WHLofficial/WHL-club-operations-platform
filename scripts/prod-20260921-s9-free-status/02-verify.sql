-- 02-verify.sql —— 执行后验收（期望值见行尾注释）
--
-- 跑法（远端必须用 --command，因为 --file 取不到结果行）：
--   把下面那行长 SQL 整行复制进 --command 的双引号里执行：
--   npx wrangler d1 execute whl-club --remote --json --command "<本文件最后一行>"
--
-- 判据：null_club = 17731、free_now = 17731（自由身全部为 free）、rostered = 570、
--   rostered_not_normal = 0、touched = 17427（= 本批实际触达行数）、free_total = 17731、
--   bad_free_with_club = 0；守卫表仍全 0。

SELECT (SELECT COUNT(*) FROM players WHERE club_id IS NULL) AS null_club, (SELECT COUNT(*) FROM players WHERE club_id IS NULL AND status = 'free') AS free_now, (SELECT COUNT(*) FROM players WHERE club_id IS NOT NULL) AS rostered, (SELECT COUNT(*) FROM players WHERE club_id IS NOT NULL AND status <> 'normal') AS rostered_not_normal, (SELECT COUNT(*) FROM players WHERE updated_at = '2026-09-21T01:10:00.000Z') AS touched, (SELECT COUNT(*) FROM players WHERE status = 'free') AS free_total, (SELECT COUNT(*) FROM players WHERE club_id IS NOT NULL AND status = 'free') AS bad_free_with_club;
