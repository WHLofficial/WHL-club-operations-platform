-- v2.0.0（CPU 队与队籍口径，裁决 4）：删除 players.initial_club_id
-- 该字段自 0015 起只有两个消费者：球员库「初始视图」的归属列、档案卡「初始归属」一行字；
-- 成长判「本队」一律看 players.club_id（results.ts 出场解析 / growth.ts 训练营 / routes/growth.ts 升级方案），
-- 从未有任何业务逻辑读它，而「初始视图」靠 CA=base_ca、PA=导入 json 值就已经成立。用户 2026-09-18 裁定去掉。
-- 回滚：ALTER TABLE players ADD COLUMN initial_club_id INTEGER;（已写入的历史值不恢复）
ALTER TABLE players DROP COLUMN initial_club_id;
