-- 0003 · 球员状态列索引（§17.1-2：公开列表 GET /api/players?status= 的高频过滤+排序
-- 直接走复合索引区间，避免 1.8 万行全表扫）
CREATE INDEX idx_players_status ON players(status, id);
