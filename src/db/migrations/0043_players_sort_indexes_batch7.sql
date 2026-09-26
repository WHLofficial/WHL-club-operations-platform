-- 遗留项第 5 节（D1 读量治理）下一批次：球员库排序表达式索引 batch 7 —— 三条键 / 四条索引
--
-- 承 0035 / 0036（batch 4/5）。本批取 web/src/lib/players-library.ts 的 COL_DEFS 里仍无索引、且用户能点到的排序键：
--   sort=china_plan → COALESCE(china_plan, 0)             （「中国计划」列）
--   sort=agent_tier → COALESCE(agent_tier, 0)             （「经纪人」列）
--   sort=growth_gap → (COALESCE(pa, 0) - COALESCE(ca, 0)) （「成长空间」列 = PA − CA 差值）
--
-- **growth_gap 按 0036 定下的规矩两个口径同轮处理**：默认视图取现值（pa / ca），view=initial 换成另一套表达式
-- （json PA / COALESCE(base_ca, ca)，见 routes/players.ts 的 buildViewExprs）⇒ 同一列两条索引。只建默认视图
-- 那条等于「同一列维护两条索引的一半工作、却只覆盖一半场景」（0036 正是因此刻意跳过该键）。
-- fc_id 仍不在本批：它自带 UNIQUE 索引（sqlite_autoindex_players_2），筛选侧已经 seek，只差排序侧；
-- 与 view=initial 的 pa 变体一起留到下一批。
--
-- 表达式取自 buildSortExprs，索引侧写**非限定列名**（SQLite 硬要求：索引表达式里出现 `players.` 会报
-- `the "." operator prohibited in index expressions`），查询侧写限定名；同源性由
-- tests/players-sort-indexes.test.ts 的 EXPLAIN QUERY PLAN 用例锁死。
-- 尾列带 id：keyset 游标是 (排序键, id) 双列比较，缺了它带 cursor 的页仍会临时排序。
--
-- ⚠️ 部署核查：每条索引远端 apply 一次性写 ≈18,301 行，四条合计 ≈73,228 行（免费档 10 万行/日、按账号计；
--   2026-09-26 当日已用 18.7%，本批推到 ≈91.9% —— 用户裁决「半夜，写额度尽可能全用」）。
-- 回滚：DROP INDEX idx_players_sort_china_plan;
--       DROP INDEX idx_players_sort_agent_tier;
--       DROP INDEX idx_players_sort_growth_gap;
--       DROP INDEX idx_players_sort_initial_growth_gap;
CREATE INDEX idx_players_sort_china_plan ON players(COALESCE(china_plan, 0), id);
CREATE INDEX idx_players_sort_agent_tier ON players(COALESCE(agent_tier, 0), id);
CREATE INDEX idx_players_sort_growth_gap ON players((COALESCE(pa, 0) - COALESCE(ca, 0)), id);
CREATE INDEX idx_players_sort_initial_growth_gap ON players((COALESCE(COALESCE(json_extract(game_attrs, '$.PA'), pa), 0) - COALESCE(COALESCE(base_ca, ca), 0)), id);
