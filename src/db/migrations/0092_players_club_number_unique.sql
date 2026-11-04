-- v6.76.0：一线队号码批量分配
-- 号码的唯一性从「应用层先查后写」升级为数据库兜底；部分唯一索引不约束 NULL（未分配）。
-- 生产数据已核：同队重复 0、非法号 0、空串 0，可直接建索引。
-- 回滚：DROP INDEX IF EXISTS idx_players_club_number;
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_club_number
  ON players(club_id, number)
  WHERE number IS NOT NULL;
