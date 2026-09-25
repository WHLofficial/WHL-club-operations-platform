-- v2.4.0 站内信：web 收件篮已读状态
-- 回滚：ALTER TABLE notifications DROP COLUMN read_at;
ALTER TABLE notifications ADD COLUMN read_at TEXT;
