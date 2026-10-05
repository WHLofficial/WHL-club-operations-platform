-- 回滚：把名字退回占位「巴塞罗那主场」（守卫：仅当现值是本次写入的「诺坎普球场」时才退）
UPDATE stadiums SET name = '巴塞罗那主场', updated_at = '2026-10-05T08:25:47.000Z' WHERE club_id = 241 AND name = '诺坎普球场';
