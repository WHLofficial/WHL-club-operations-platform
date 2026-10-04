-- 球员「标记」索引重建（v6.26.1）：🟢 growth 加「未练满」条件，表达式变了必须删旧建新
--
-- v6.26.0 及以前：growable 只在赛季结算/建季重算，练满球员（现值 ca >= pa）会一直挂绿标。
-- v6.26.1 起绿标判定（以及 growth 名额计数）要求**未练满**：现值 ca < pa。表达式变了，
-- 旧索引 idx_players_sort_marker 与 markerWeightSql 不再同源 → 同源锁会红，故 DROP 后按新表达式重建。
-- 索引侧写**非限定列名**（SQLite 硬要求：索引表达式里出现 `players.` 会报
-- `the "." operator prohibited in index expressions`），查询侧写限定名；
-- 同源性由 tests/players-sort-indexes.test.ts 的 EXPLAIN QUERY PLAN 用例锁死。
-- 尾列带 id：keyset 游标是 (排序键, id) 双列比较，缺了它带 cursor 的页仍会临时排序。
--
-- 初始CA 口径 = COALESCE(base_ca, ca)（与 squad-rules 三档计数一致）；初始CA 为 NULL 的行
-- 三个 WHEN 全部落空得权重 0 = 无标记，与 JS 侧 markerOf(null) 一致。练满时 ca < pa 为假
-- （ca 为 NULL 时亦为 NULL→ELSE 0），都落权重 0。
--
-- ⚠️ 部署核查：apply 一次性写 ≈18,301 行（免费档 10 万行/日按账号计，占 18.3%）。
-- 回滚：DROP INDEX idx_players_sort_marker;（旧表达式可用迁移 0042 的 CREATE INDEX 原样重建）
DROP INDEX IF EXISTS idx_players_sort_marker;
CREATE INDEX idx_players_sort_marker ON players(CASE WHEN COALESCE(base_ca, ca) >= 90 THEN 3 WHEN COALESCE(base_ca, ca) >= 87 THEN 2 WHEN COALESCE(base_ca, ca) < 87 AND pa >= 87 AND growable = 1 AND ca < pa THEN 1 ELSE 0 END, id);
