-- 回滚 ⑤ 标记球员落点（删 28 行补录单 + 保护期还原到快照值）
-- 期望 changes = 52（删 28 行 + 还原 24 条）
DELETE FROM transfers WHERE idempotency_key IN ('s9-league-match:230', 's9-league-match:16', 's9-league-match:41', 's9-league-match:51', 's9-league-match:31', 's9-league-match:460', 's9-league-match:84', 's9-league-match:2', 's9-league-match:181', 's9-league-match:1701', 's9-league-match:97', 's9-league-match:90', 's9-league-match:49', 's9-league-match:66', 's9-league-match:401', 's9-league-match:882', 's9-league-match:286', 's9-league-match:35', 's9-league-match:1002', 's9-league-match:58', 's9-league-match:385', 's9-league-match:339', 's9-league-match:282', 's9-league-match:5707', 's9-league-rc_change:5', 's9-league-rc_change:45', 's9-league-rc_change:57', 's9-league-rc_change:263');

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 16 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 41 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 51 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 0 WHERE player_id = 31 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 460 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 0 WHERE player_id = 5 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 0 WHERE player_id = 45 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 0 WHERE player_id = 57 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 1 WHERE player_id = 84 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 263 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 1 WHERE player_id = 2 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 0 WHERE player_id = 181 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 0 WHERE player_id = 1701 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 1 WHERE player_id = 97 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 1 WHERE player_id = 90 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 1 WHERE player_id = 49 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 66 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 401 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 882 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 286 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 1 WHERE player_id = 35 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 1002 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = -1 WHERE player_id = 58 AND is_active = 1 AND protection_ticks = 1;

UPDATE contracts SET protection_ticks = 0 WHERE player_id = 385 AND is_active = 1 AND protection_ticks = 1;
