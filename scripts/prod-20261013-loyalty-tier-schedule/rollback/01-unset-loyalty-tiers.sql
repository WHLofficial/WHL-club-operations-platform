-- 回滚件：撤销 loyalty_tiers 行（回到代码默认 [[0.5,0.05],[1.5,0.10],[2.5,0.20]] = 永久 20%）
-- 用 03-verify.sql 的两次回读确认：config_rows 回到 8、loyalty_tiers 无行。
-- 顺序：先写审计镜像（before = 当前值、after = NULL ⇒ 键已移除），再 DELETE 行。

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'loyalty_tiers', 'value', (SELECT value FROM config WHERE key = 'loyalty_tiers')),
       json_object('key', 'loyalty_tiers', 'value', NULL),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE EXISTS (SELECT 1 FROM config WHERE key = 'loyalty_tiers');

DELETE FROM config WHERE key = 'loyalty_tiers';
