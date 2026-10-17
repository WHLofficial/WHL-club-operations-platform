-- 回滚 ②：撤销 prize_table 行（删行 ⇒ 生效值回代码默认 pool 200）——2 条语句
--
-- 生成时间：2026-10-17T13:41:41Z
-- 执行：node exec-shards.mjs rollback/02-undo-config-pool.sql --remote --chunk=20
-- 先写审计（before = 当前行值，after = null）再删行；重放时行已不存在 ⇒ 审计与删行 changes 均为 0。

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'prize_table', 'value', (SELECT value FROM config WHERE key = 'prize_table')),
       json_object('key', 'prize_table', 'value', NULL),
       '2026-10-17T13:41:41Z'
 WHERE EXISTS (SELECT 1 FROM config WHERE key = 'prize_table');

DELETE FROM config WHERE key = 'prize_table';
