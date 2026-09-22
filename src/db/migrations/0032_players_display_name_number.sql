-- 增量 32：球员显示名与球衣号
--
-- 显示名（display_name）：三系统显示口径统一为「FC26 commonname → FC26 名+姓 → 现有缩写名」，
-- 由 scripts/player-names/ 从 FC26 存档的 base_players.csv + playernames.txt 派生后回填。
-- 库里的 players.name 语义不变（FC26db 官方缩写名，导入对齐键仍是 fc_id），
-- 显示处一律 COALESCE(display_name, name)（core/player-name.ts 的 sqlDisplayName）——
-- 没回填到的行自动回落，调用方不需要分支。
-- first_name / last_name / common_name 存派生中间结果：球员档案的「官方名」小字与复核派生是否正确
-- 都要它，不留就只能重跑脚本。
--
-- 球衣号（number）：数据源自增量 32 起从赛事平台转到本平台（tour 只显示）。
-- 用 TEXT 而不是 INTEGER：赛事平台原列就是 TEXT，允许空（未赋号），号码前导零/字母不做假设；
-- 「必须是整数、同俱乐部不重复」的校验在端点里做（worker/players-number.ts），不靠列类型。
ALTER TABLE players ADD COLUMN first_name TEXT;
ALTER TABLE players ADD COLUMN last_name TEXT;
ALTER TABLE players ADD COLUMN common_name TEXT;
ALTER TABLE players ADD COLUMN display_name TEXT;
ALTER TABLE players ADD COLUMN number TEXT;

-- 回滚：ALTER TABLE players DROP COLUMN first_name; 同理其余四列
