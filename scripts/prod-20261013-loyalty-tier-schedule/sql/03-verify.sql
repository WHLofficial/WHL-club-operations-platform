-- 生产批 prod-20261013-loyalty-tier-schedule · 03 验收回读（只读）
SELECT key, value, updated_at FROM config WHERE key = 'loyalty_tiers';

-- 审计应恰好多出一行 config_set（before = NULL ⇒ 键此前不存在；after = 新排程）
SELECT id, actor, action, target_type, origin, before, after, at
  FROM audit_log WHERE action = 'config_set' ORDER BY id DESC LIMIT 3;

-- config 行数应 = 9（写前 8 行 + 本键）
SELECT COUNT(*) AS config_rows FROM config;
