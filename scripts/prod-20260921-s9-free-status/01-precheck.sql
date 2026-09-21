-- 01-precheck.sql —— 执行前只读快照（行尾注释 = 2026-09-21T01:09Z 实测值）
-- 跑法：npx wrangler d1 execute whl-club --remote --file <本文件绝对路径>
--   （--file 只回「N commands executed successfully」+ 聚合；要看结果列须改用 --command 且 SQL 必须单行）

SELECT COUNT(*) AS total FROM players;                                                            -- 18301
SELECT COUNT(*) AS null_club FROM players WHERE club_id IS NULL;                                  -- 17731
SELECT status, COUNT(*) AS n FROM players WHERE club_id IS NULL GROUP BY status;                  -- free 304 / normal 17427
SELECT COUNT(*) AS rostered FROM players WHERE club_id IS NOT NULL;                               -- 570
SELECT status, COUNT(*) AS n FROM players WHERE club_id IS NOT NULL GROUP BY status;              -- normal 570
SELECT COUNT(*) AS bad_free_with_club FROM players WHERE club_id IS NOT NULL AND status = 'free'; -- 0

-- 守卫表：改 status 若与在途单据共存会语义错位，执行前必须全 0
SELECT (SELECT COUNT(*) FROM contracts) AS contracts,
       (SELECT COUNT(*) FROM listings) AS listings,
       (SELECT COUNT(*) FROM registrations) AS registrations,
       (SELECT COUNT(*) FROM negotiation_sessions) AS negotiation_sessions,
       (SELECT COUNT(*) FROM transfers) AS transfers,
       (SELECT COUNT(*) FROM bids) AS bids;                                                        -- 全 0
