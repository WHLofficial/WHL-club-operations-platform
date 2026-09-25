-- v3.2.0 步骤 4：球员库排序表达式索引第二批（报告 scripts/d1-read-audit/README.md §5.1/§5.3 的第一批）
-- 0027 已覆盖 ca / pa / age / market_value；步骤 1 实测里全表扫最贵的是 11 个排序键（各 56,398 行/次），
-- 本批按「表达式最安全 + 前端默认暴露面」选三条（不按热度：系统未正式投用，频次分布无意义）：
--   sort=prestige → COALESCE(players.prestige, 0)
--   sort=club     → COALESCE(players.club_id, 0)          （club_id 列索引匹配不上，表达式才是排序键）
--   sort=status   → CASE players.status WHEN …（= players.ts STATUS_SORT_CASE，前端默认列之一）
-- 表达式必须与 src/worker/routes/players.ts buildSortExprs 逐字一致，否则优化器静默不用它（退回全表扫 + 临时排序）。
-- tests/players-sort-indexes.test.ts 用真实路由抓下来的 SQL 跑 EXPLAIN QUERY PLAN 锁死这条同源性。
-- 尾列一律带 id：keyset 游标是 (排序键, id) 双列比较，缺了它带 cursor 的页仍会临时排序。
-- ⚠️ 部署核查：每条索引远端 apply 一次性写 ≈ 18301 行，三条 ≈ 54,903 行（免费档 10 万/日，本增量自留 6 万/日）。
-- 其余候选（uid / view=initial 的 ca / ps 计数 / name / attr:* 34 键）见报告 §5.1-5.3，按天分批，不在本批。
CREATE INDEX idx_players_sort_prestige ON players(COALESCE(prestige, 0), id);
CREATE INDEX idx_players_sort_club ON players(COALESCE(club_id, 0), id);
CREATE INDEX idx_players_sort_status ON players(CASE status
  WHEN 'normal' THEN 1 WHEN 'listed' THEN 2 WHEN 'trainee' THEN 3 WHEN 'free' THEN 4 WHEN 'retired' THEN 5
  ELSE 0 END, id);

-- 回滚：DROP INDEX idx_players_sort_prestige; 同理其余两条
