-- v2.8.0：CPU 队判定列化——clubs.is_cpu 代替运行时队名后缀扫描（substr(name,-5)='(CPU)'）。
-- 回滚：ALTER TABLE clubs DROP COLUMN is_cpu;
ALTER TABLE clubs ADD COLUMN is_cpu INTEGER NOT NULL DEFAULT 0;
-- 回填沿用队名口径（与判定来源一致）：比赛系统 4 支 CPU 队（曼城/巴塞罗那/RB莱比锡/AC米兰）
UPDATE clubs SET is_cpu = 1 WHERE substr(name, -5) = '(CPU)';
