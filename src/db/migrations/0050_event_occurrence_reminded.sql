-- 0050_event_occurrence_reminded.sql · v6.11.0 选择型事件（D 块 D2）
-- 选择型的其他字段（choice_no / outcome_json / deadline_at）在 0048 一次建全，这里只补「距时限 24h
-- 提醒」的去重闸：cron 每 5 分钟一跳，靠这一列保证同一条待选只提醒一次（并发/重放安全）。
-- 空串 = 还没提醒过；非空 = 已提醒的时刻（UTC ISO，与 deadline_at 同格式）。
-- 回滚：ALTER TABLE event_occurrences DROP COLUMN reminded_at;
ALTER TABLE event_occurrences ADD COLUMN reminded_at TEXT NOT NULL DEFAULT '';
