-- 回滚件：撤销 T0 三个 config 键（回到代码默认）
-- 语义：loyalty_tiers / wage_floor_gap 删行 ⇒ 回代码默认（与目标值相同，故「删行不影响行为」，只是取消固化）；
--       stadium_max_open_tier 删行 ⇒ 回代码默认 '1' = 关回 2 档（这是本批唯一的真实行为回滚点）。
-- 顺序：每个键先写审计镜像（before = 当前值、after = NULL ⇒ 键已移除），再 DELETE 行。
-- 幂等：审计带 EXISTS 守卫、DELETE 对不存在行 changes 0。
-- 验收：用 sql/03-verify.sql 回读 —— config_rows 回到 8、三键无行。

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'loyalty_tiers', 'value', (SELECT value FROM config WHERE key = 'loyalty_tiers')),
       json_object('key', 'loyalty_tiers', 'value', NULL),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE EXISTS (SELECT 1 FROM config WHERE key = 'loyalty_tiers');
DELETE FROM config WHERE key = 'loyalty_tiers';

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'wage_floor_gap', 'value', (SELECT value FROM config WHERE key = 'wage_floor_gap')),
       json_object('key', 'wage_floor_gap', 'value', NULL),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE EXISTS (SELECT 1 FROM config WHERE key = 'wage_floor_gap');
DELETE FROM config WHERE key = 'wage_floor_gap';

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'stadium_max_open_tier', 'value', (SELECT value FROM config WHERE key = 'stadium_max_open_tier')),
       json_object('key', 'stadium_max_open_tier', 'value', NULL),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE EXISTS (SELECT 1 FROM config WHERE key = 'stadium_max_open_tier');
DELETE FROM config WHERE key = 'stadium_max_open_tier';
