-- 验收（只读）：分布须与 agent-reroll-report.md 的「随机化后」逐档一致；nulls/out_of_range 须为 0
SELECT COUNT(*) AS players_total, SUM(CASE WHEN agent_tier IS NULL THEN 1 ELSE 0 END) AS nulls, SUM(CASE WHEN agent_tier NOT IN (1, 2, 3) THEN 1 ELSE 0 END) AS out_of_range FROM players;
SELECT agent_tier, COUNT(*) AS n FROM players GROUP BY agent_tier ORDER BY agent_tier;
