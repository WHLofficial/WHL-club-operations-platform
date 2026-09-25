-- 遗留项第 5 节（D1 读量治理）下一批次：球员库排序表达式索引 batch 5 —— 可选列面板的三条
--
-- 承 0035（先收 position / growable 两条常驻列）。本批取 web/src/lib/players-library.ts 的
-- COL_DEFS 里排在最前、且表达式最安全的三条：
--   sort=badges  → (COALESCE(badges_silver, 0) + COALESCE(badges_gold, 0))（唯一一条多列相加的，先验这个形态）
--   sort=base_ca → COALESCE(base_ca, 0)
--   sort=foot    → COALESCE(foot, 0)
-- **刻意跳过 growth_gap**：它在默认视图下的表达式是 (COALESCE(pa,0) - COALESCE(ca,0))，看似可静态索引，
-- 但 view=initial 口径下 pa/ca 都被换成另一套表达式（routes/players.ts buildViewExprs），
-- 单独建默认视图那条会让初始视图仍留在 37,635 行/次，等于同一列维护两条索引的一半工作却只覆盖一半场景。
-- 该键与 view=initial 的 pa 变体（报告 §5.3 第 3 条点名的遗留）一起留到下一批，两个口径同轮处理。
-- 同理不在本批的还有 growth_tier / future_star / china_plan / agent_tier / fc_id（表达式同为单列 COALESCE，
-- 只是没排进本批，按天继续分批即可）。
--
-- 表达式取自 buildSortExprs，索引侧写**非限定列名**（SQLite 硬要求），查询侧写限定名；
-- 同源性由 tests/players-sort-indexes.test.ts 的 EXPLAIN 用例锁死。
-- 尾列带 id：keyset 游标是 (排序键, id) 双列比较。
--
-- ⚠️ 部署核查：每条索引远端 apply 一次性写 ≈18,301 行，三条合计 ≈54,903 行
--   （免费档 10 万行/日、按账号计，本仓自留 ≤6 万行/日 ⇒ 一批 3 条正好卡在预算内，与 0029/0034 同规）。
-- 回滚：DROP INDEX idx_players_sort_badges;
--       DROP INDEX idx_players_sort_base_ca;
--       DROP INDEX idx_players_sort_foot;
CREATE INDEX idx_players_sort_badges ON players((COALESCE(badges_silver, 0) + COALESCE(badges_gold, 0)), id);
CREATE INDEX idx_players_sort_base_ca ON players(COALESCE(base_ca, 0), id);
CREATE INDEX idx_players_sort_foot ON players(COALESCE(foot, 0), id);
