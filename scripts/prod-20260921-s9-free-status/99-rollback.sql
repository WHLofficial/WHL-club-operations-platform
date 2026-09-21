-- 99-rollback.sql —— 本批回滚（把本批标成 'free' 的 17427 行还原为 'normal'）
--
-- 圈定方式：本批 UPDATE 把触达行的 updated_at 统一写成 '2026-09-21T01:10:00.000Z'，
--   故按 (club_id IS NULL AND status = 'free' AND updated_at = 本批时间戳) 三重条件精确定位，
--   不会误伤前一批 prod-20260921-s9-free-leftover 释放的 304 人（它们的 updated_at 是那批的时间戳）。
-- 注意：updated_at 本身不能还原成执行前的原值（原值未留档），回滚会把触达行的 updated_at 写成 '2026-09-21T01:15:00.000Z'。
-- 期望 changes = 17427。重放（或部分重放后再次整体执行）changes = 0 或仅剩未还原行。
--
-- 执行：npx wrangler d1 execute whl-club --remote --file <本文件绝对路径>

UPDATE players SET status = 'normal', updated_at = '2026-09-21T01:15:00.000Z' WHERE club_id IS NULL AND status = 'free' AND updated_at = '2026-09-21T01:10:00.000Z';
