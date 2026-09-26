-- 01 · 审计来源回填预检（只读，跑在迁移 0039 之前）
--
-- 本批给 audit_log 的机器行补 origin，让「哪条入口触发的」这一列从今往后完整。
-- 迁移 0039 之前生产还没有 origin 列，所以本文件只用现有列（action / actor / at）。
-- 顺序：跑本文件 → npm run db:migrate:remote（加 origin 列）→ 02-backfill.sql → 03-verify.sql

-- ① 全表按 (action, actor) 分组：看清哪些 action 是机器写的（actor = 0 是历史哨兵）
SELECT action, actor, COUNT(*) AS n, MIN(at) AS first_at, MAX(at) AS last_at
FROM audit_log
GROUP BY action, actor
ORDER BY n DESC;

-- ② 本次会被回填的三类机器行计数（与 02-backfill.sql 的三条规则一一对应），
--    外加 total / max_id（max_id 给 99-rollback.sql 当边界用）
SELECT
  (SELECT COUNT(*) FROM audit_log WHERE actor IS NULL
     AND action IN ('listing_settle', 'listing_delist', 'activation_void', 'bid_pattern_alert')) AS r1_lazy_settle,
  (SELECT COUNT(*) FROM audit_log WHERE actor = 0 AND action = 'result_confirm') AS r2_cron_tick,
  (SELECT COUNT(*) FROM audit_log WHERE actor = 0 AND action = 'auth_backchannel_logout') AS r3_backchannel,
  (SELECT COUNT(*) FROM audit_log) AS total,
  (SELECT MAX(id) FROM audit_log) AS max_id;

-- ③ 回填后仍会是 NULL 的行：认不出触发通道的历史行。
--    刻意留 NULL（NULL = 历史行 / 未知），不替历史猜一个通道。
SELECT action, actor, COUNT(*) AS n
FROM audit_log
WHERE NOT (
  (actor IS NULL AND action IN ('listing_settle', 'listing_delist', 'activation_void', 'bid_pattern_alert'))
  OR (actor = 0 AND action = 'result_confirm')
  OR (actor = 0 AND action = 'auth_backchannel_logout')
)
GROUP BY action, actor
ORDER BY n DESC;
