-- v6.18.0：transfers 按 (status, 完成时刻) 的倒序索引。
-- 治理对象：市场情报「已达成交易」（GET /api/market/deals）与传闻事实池的成交查询——
-- 此前 `WHERE status='completed' ORDER BY completed_at DESC, id DESC LIMIT 50` 只能全表扫
-- transfers + TEMP B-TREE（0001 的四条索引全是 player/from/to/review_task 维度）。
-- 改走本索引后按时间倒序读 completed 行 LIMIT 早停（deals ≈50 行索引条目 + 50 次 players 点查）。
-- 写侧：每笔交易单据 +1 条索引条目，可忽略；apply 一次性写 ≈ transfers 现有行数。
CREATE INDEX idx_transfers_status_time ON transfers (status, completed_at DESC, id DESC);
