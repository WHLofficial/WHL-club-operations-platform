-- 增量 21 赛果自动化：钩子异常标人工复核（cron 自动确认后 prize/xp/revenue 出错或 XP 未解析的场次）
-- 回滚：ALTER TABLE result_confirmations DROP COLUMN review_note; DROP COLUMN needs_review;
ALTER TABLE result_confirmations ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE result_confirmations ADD COLUMN review_note TEXT;
