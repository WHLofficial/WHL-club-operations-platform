-- 增量 23：球员库排序表达式索引（§17.3-5 性能加固）
-- 球员库排序走 COALESCE(col, 0) 表达式 + players.id（players.ts SORT_EXPRS），普通列索引匹配不上，
-- 用 SQLite 表达式索引让 ORDER BY 直接走索引避免 18301 行全扫排序。
-- influence 排序（表达式内联 config 系数）与 view=initial 排序无法静态索引，保持全扫（低频可接受）。
-- ⚠️ 部署核查：远端 apply 一次性写 ≈ 18301×4 ≈ 73k rows_written，当天避免叠加其他写。
CREATE INDEX idx_players_sort_ca ON players(COALESCE(ca, 0), id);
CREATE INDEX idx_players_sort_pa ON players(COALESCE(pa, 0), id);
CREATE INDEX idx_players_sort_age ON players(COALESCE(age, 0), id);
CREATE INDEX idx_players_sort_market_value ON players(COALESCE(market_value, 0), id);

-- 回滚：DROP INDEX idx_players_sort_ca; 同理其余三条
