-- 99 · 回滚（把本次回填的 origin 清回 NULL）
--
-- 边界用 `id <= 100`：2026-09-26 预检时 audit_log 的 max_id = 100，回填只可能碰过这些行。
-- 如果你跑 02 的时间晚于 2026-09-26，先跑 01-precheck.sql 看 max_id，把下面的 100 换成当时的 max_id。
-- 之所以不用 `origin IS NOT NULL` 全清：那会把 0039 迁移之后新代码正常写入的 origin 一起抹掉。
-- 刻意不做：不动 actor（回填只改 origin，actor 的历史值保持原样，包括 0 哨兵）。
UPDATE audit_log SET origin = NULL WHERE id <= 100;
