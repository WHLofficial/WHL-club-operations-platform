-- v2.5.0 设施经营：建设券余额（建设支出 25% 返还，仅可抵扣后续建设支出）
-- 回滚：ALTER TABLE stadiums DROP COLUMN build_credit;
ALTER TABLE stadiums ADD COLUMN build_credit REAL NOT NULL DEFAULT 0;
