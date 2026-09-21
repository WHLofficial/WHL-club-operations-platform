-- S9 队籍收尾 · 执行前复查（只读；用 --file 跑，多行 SELECT 在 --command 下会报 incomplete input）
-- 生成器 scripts/prod-20260921-s9-free-leftover/gen-free-leftover-sql.ts；生成时点 2026-09-21T00:14:45.780Z
-- 判据：rostered_now = 874（570 联盟世界 + 304 遗留）、null_club = 17427、free_now = 0、守卫表全 0

SELECT (SELECT COUNT(*) FROM players WHERE club_id IS NOT NULL) AS rostered_now,
       (SELECT COUNT(*) FROM players WHERE club_id IS NULL) AS null_club,
       (SELECT COUNT(*) FROM players WHERE status = 'free') AS free_now;

SELECT COUNT(*) AS contracts FROM contracts;
SELECT COUNT(*) AS listings FROM listings;
SELECT COUNT(*) AS registrations FROM registrations;
SELECT COUNT(*) AS negotiation_sessions FROM negotiation_sessions;
SELECT COUNT(*) AS transfers FROM transfers;
SELECT COUNT(*) AS bids FROM bids;

-- 全库 status 分布（执行后应多出 304 行 free）
SELECT status, COUNT(*) AS n FROM players GROUP BY status ORDER BY status;

-- 各队现有名单规模（释放后这些队会各自减少对应人数）
SELECT c.id AS club_id, c.name, (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS roster_now
  FROM clubs c ORDER BY c.id;
