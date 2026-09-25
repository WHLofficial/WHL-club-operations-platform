-- 遗留项第 5 节（D1 读量治理）下一批次：球员库排序表达式索引 batch 4 —— 两条**常驻列**
--
-- 排期依据：scripts/d1-read-audit/README.md §5.1 把 11 个单表排序键登记为「形态允许静态索引、只差写配额」
-- （每条 ≈18,301 行写）。这 11 条实测都是 37,635 行/次全表扫，而系统未正式投用、频次分布无意义，
-- 所以选择依据是「前端暴露面 × 表达式安全度」而不是热度：
--   · position 与 growable 在 web/src/lib/players-library.ts 的 FIXED_COLUMNS 里 —— **永远在表头**
--     （不可隐藏、不可关闭），每个进球员库的用户都能点到；
--   · 其余 9 条（badges/base_ca/growth_gap/foot/growth_tier/future_star/china_plan/agent_tier/fc_id）
--     都在可选列面板里，要用户主动打开列开关才会出现 ⇒ 排在后面批（见 0036）。
-- 表达式也都是单列 COALESCE / 简单 CASE，没有 ps 那种 15 项链、name 那种 87 项链的深度风险。
--
-- 表达式取自 src/worker/routes/players.ts buildSortExprs，索引侧一律写**非限定列名**
-- （SQLite 硬要求：索引表达式里出现 `players.` 会报 `the "." operator prohibited in index expressions`），
-- 查询侧仍写 `players.` 限定名；两者被优化器认作同一表达式这件事由
-- tests/players-sort-indexes.test.ts 的 EXPLAIN QUERY PLAN 用例锁死（表达式一漂移，用例立刻红）。
--   sort=position → CASE position WHEN 'GK' THEN 1 … ELSE 0 END（= POSITION_SORT_CASE，无外层 COALESCE）
--   sort=growable → COALESCE(growable, 0)
-- 尾列一律带 id：keyset 游标是 (排序键, id) 双列比较，缺了它带 cursor 的页仍会临时排序。
--
-- ⚠️ 部署核查：每条索引远端 apply 一次性写 ≈18,301 行，两条合计 ≈36,602 行
--   （免费档 10 万行/日且**按账号计**、四个库共享同一池；本仓自留 ≤6 万行/日）。
--   本批刻意只放 2 条而不是常规的 3 条：apply 时点距 UTC 归零只剩几分钟，当日账号池余量约 4.45 万行
--   —— 2 条（3.66 万）放得下，3 条（5.49 万）会超 ⇒ 会把当日额度打穿、撞上 2026-09-21 那类整站 500。
-- 回滚：DROP INDEX idx_players_sort_position;
--       DROP INDEX idx_players_sort_growable;
CREATE INDEX idx_players_sort_position ON players(CASE position
  WHEN 'GK' THEN 1
  WHEN 'RB' THEN 2 WHEN 'CB' THEN 2 WHEN 'LB' THEN 2
  WHEN 'CDM' THEN 3 WHEN 'RM' THEN 3 WHEN 'CM' THEN 3 WHEN 'LM' THEN 3 WHEN 'CAM' THEN 3
  WHEN 'RW' THEN 4 WHEN 'ST' THEN 4 WHEN 'LW' THEN 4
  ELSE 0 END, id);
CREATE INDEX idx_players_sort_growable ON players(COALESCE(growable, 0), id);
