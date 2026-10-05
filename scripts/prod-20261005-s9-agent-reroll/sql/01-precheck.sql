-- 预检（只读）：期望 players_total=18301 / nulls=0 / out_of_range=0，且（本批前提）distinct_tiers=1
SELECT COUNT(*) AS players_total, COUNT(DISTINCT agent_tier) AS distinct_tiers, SUM(CASE WHEN agent_tier IS NULL THEN 1 ELSE 0 END) AS nulls, SUM(CASE WHEN agent_tier NOT IN (1, 2, 3) THEN 1 ELSE 0 END) AS out_of_range FROM players;
SELECT agent_tier, COUNT(*) AS n FROM players GROUP BY agent_tier ORDER BY agent_tier;
