-- v6.28.0 死忠每场演化：窗初死忠快照。
-- 每场演化即时改写 stadiums.fans 后，关窗批无法再从 fans 现值反推窗初值，而对赌奖金
-- （naming_contracts.bet_fans，naming-ops.ts windowNamingStatements 的 fansGrowth 入参）
-- 需要「本窗死忠增长率」。列语义：本窗开始时的 fans（关窗时写为窗末值，供下一窗使用）。
-- 老数据/新插入行默认 0 = 无窗初快照，关窗批按「现值当窗初」处理（= 本窗无增长，口径在 home.ts）。
-- 回滚：ALTER TABLE stadiums DROP COLUMN fans_window_start;
ALTER TABLE stadiums ADD COLUMN fans_window_start REAL NOT NULL DEFAULT 0;
UPDATE stadiums SET fans_window_start = fans;
