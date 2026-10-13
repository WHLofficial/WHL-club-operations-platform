-- 生产批 prod-20261013-t0-economy-patch · 03 验收回读（只读）
-- 期望：三键均命中目标值；config_rows = 11（写前 8 行 + 三键）；audit_log 恰好多 3 条 config_set。

-- 1) 三键目标值
SELECT key, value, updated_at FROM config
 WHERE key IN ('loyalty_tiers', 'wage_floor_gap', 'stadium_max_open_tier') ORDER BY key;

-- 2) config 行数（8 → 11）
SELECT COUNT(*) AS config_rows FROM config;

-- 3) 审计（最后 3 条应为本批三键，before = NULL ⇒ 落库前无行）
SELECT id, actor, action, target_type, origin, before, after, at
  FROM audit_log WHERE action = 'config_set' ORDER BY id DESC LIMIT 6;

-- 4) 未越界校验：账本与赛季窗口不得被本批改动（行数/状态应与 01-precheck 完全一致）
SELECT (SELECT COUNT(*) FROM ledger_entries) AS ledger_rows,
       (SELECT COUNT(*) FROM season_windows) AS window_rows,
       (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'loyalty') AS loyalty_entries;
