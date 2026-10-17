-- v6.51.10：growth_events 补 match_ref 单列索引（成长录入页的取数热点）。
-- 缘起：成长录入页两处都按场次过滤——列表的 recorded 计数（WHERE ge.match_ref = CAST(match_id AS TEXT)）
-- 与面板的「已录事件」（WHERE match_ref = ?）。表上原只有 UNIQUE(player_id, match_ref, event_type)
-- 的隐式索引，前缀是 player_id ⇒ 单查 match_ref 用不上，只能整表扫（列表一次要跑 N 场次）。
-- 第二列带 player_id：面板那条查询还有 ORDER BY player_id, id —— 非唯一索引的末键是 rowid，
-- 所以 match_ref 等值段内天然按 (player_id, id) 有序，排序白拿（只建 (match_ref) 的话每次都要 TEMP B-TREE）。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069/0070/0071 约定）。
-- 回滚：DROP INDEX idx_growth_events_match_ref;

CREATE INDEX IF NOT EXISTS idx_growth_events_match_ref ON growth_events (match_ref, player_id);
