-- 03 · 回填后验收（只读）
--
-- 期望（2026-09-26 快照，100 行）：total = 100、null_origin = 0、
--   user = 23、cron_tick = 74、backchannel = 3、lazy_settle = 0、machine = 0、其它 = 0，
--   bad1 / bad2 / bad3 / bad4 全为 0。
-- 若你跑 02 的时间晚于 2026-09-26，total 与 user 桶会更大（新增的人类行），其余不变。
-- 2026-09-26 实测（回填后）：total 100、null_origin 0、user 23、cron_tick 74、backchannel 3、
--   lazy_settle 0、machine 0、other 0，bad1–bad4 全 0 —— 与期望逐项一致。

SELECT
  (SELECT COUNT(*) FROM audit_log) AS total,
  (SELECT COUNT(*) FROM audit_log WHERE origin IS NULL) AS null_origin,
  (SELECT COUNT(*) FROM audit_log WHERE origin = 'user') AS user_rows,
  (SELECT COUNT(*) FROM audit_log WHERE origin = 'cron_tick') AS cron_tick_rows,
  (SELECT COUNT(*) FROM audit_log WHERE origin = 'lazy_settle') AS lazy_settle_rows,
  (SELECT COUNT(*) FROM audit_log WHERE origin = 'backchannel') AS backchannel_rows,
  (SELECT COUNT(*) FROM audit_log WHERE origin = 'machine') AS machine_rows,
  (SELECT COUNT(*) FROM audit_log WHERE origin IS NOT NULL AND origin NOT IN ('user','cron_tick','lazy_settle','backchannel','machine')) AS other_rows,
  -- 规则 ② 的反例：自动确认必须记成定时任务
  (SELECT COUNT(*) FROM audit_log WHERE actor = 0 AND action = 'result_confirm' AND COALESCE(origin, '') <> 'cron_tick') AS bad1,
  -- 规则 ③ 的反例：全端登出必须记成认证中心推送
  (SELECT COUNT(*) FROM audit_log WHERE actor = 0 AND action = 'auth_backchannel_logout' AND COALESCE(origin, '') <> 'backchannel') AS bad2,
  -- 规则 ① 的反例：actor 为 NULL 的惰性结算 action 必须记成惰性结算
  (SELECT COUNT(*) FROM audit_log WHERE actor IS NULL AND action IN ('listing_settle','listing_delist','activation_void','bid_pattern_alert') AND COALESCE(origin, '') <> 'lazy_settle') AS bad3,
  -- 规则 ④ 的反例：actor 非空的行不许留 NULL
  (SELECT COUNT(*) FROM audit_log WHERE actor IS NOT NULL AND origin IS NULL) AS bad4;

-- 分布明细：每条 (origin, action, actor) 组合的行数与时间跨度，肉眼核对。
SELECT COALESCE(origin, '（NULL 历史行）') AS origin, action, actor, COUNT(*) AS n, MIN(at) AS first_at, MAX(at) AS last_at
FROM audit_log
GROUP BY origin, action, actor
ORDER BY origin, n DESC;
