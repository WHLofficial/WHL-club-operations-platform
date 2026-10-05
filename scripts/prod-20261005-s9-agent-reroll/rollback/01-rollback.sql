-- 回滚：前态为全库统一值 agent_tier=2（生成器与预检双重断言）⇒ 单条还原本批写过的两档。
-- 注意：只在「无人改动档位」的前提下有效；改动后请按 sql/manifest.json 的 old 列重建逐行还原。
UPDATE players SET agent_tier = 2, updated_at = '2026-10-05T08:06:11.584Z' WHERE agent_tier IN (1, 3);
