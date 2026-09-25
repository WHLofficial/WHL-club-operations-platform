-- 16 队队籍回填（v2.3.0，2026-09-19 预检通过；生产执行等管理组明确下令）
--
-- 口径：players.game_attrs 的快照 TeamID == clubs.id（16 支人控队逐一核对成立，
--       参照 web/assets/ref/team.json；AC米兰 TeamID=47 是 CPU 特例，v2.0.0 已入籍 24 人，不在本批）。
--       只写队籍（club_id），不造合同、不动 CPU 队与自由身。
--
-- 预检实测（2026-09-19，生产 whl-club）：
--   16 队按 TeamID 合计 444 人，club_id 全部为 NULL；
--   4 支 CPU 队 107 人 club_id 已全部写好（v2.0.0）；
--   其余 629 个 TeamID 共 17750 人是自由身/非联赛球员，保持 club_id IS NULL 不动。
--   每条 UPDATE 都带 club_id IS NULL 守卫：重复执行不会覆盖任何既有队籍（幂等）。
--
-- 期望 changes（逐条）：见各行尾注释；合计 444 行。
-- 回滚：UPDATE players SET club_id = NULL WHERE club_id IN (1,2,5,9,11,13,14,21,33,45,66,73,243,280,449,110374);
--   ——仅在确认这 444 个 club_id 全部来自本批且没有新转会发生时才可整批回滚，否则按队逐队回滚。

UPDATE players SET club_id = 1      WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 1;      -- 阿森纳 24
UPDATE players SET club_id = 2      WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 2;      -- 阿斯顿维拉 24
UPDATE players SET club_id = 5      WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 5;      -- 切尔西 30
UPDATE players SET club_id = 9      WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 9;      -- 利物浦 28
UPDATE players SET club_id = 11     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 11;     -- 曼联 26
UPDATE players SET club_id = 13     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 13;     -- 纽卡斯尔联 29
UPDATE players SET club_id = 14     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 14;     -- 诺丁汉森林 28
UPDATE players SET club_id = 21     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 21;     -- 拜仁慕尼黑 27
UPDATE players SET club_id = 33     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 33;     -- 慕尼黑1860 29
UPDATE players SET club_id = 45     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 45;     -- 尤文图斯 26
UPDATE players SET club_id = 66     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 66;     -- 里昂 27
UPDATE players SET club_id = 73     WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 73;     -- 巴黎圣日耳曼 25
UPDATE players SET club_id = 243    WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 243;    -- 皇家马德里 31
UPDATE players SET club_id = 280    WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 280;    -- 奥林匹亚科斯 29
UPDATE players SET club_id = 449    WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 449;    -- 皇家贝蒂斯 31
UPDATE players SET club_id = 110374 WHERE club_id IS NULL AND json_extract(game_attrs, '$.TeamID') = 110374; -- 佛罗伦萨 30
