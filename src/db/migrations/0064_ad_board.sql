-- v6.31.0 转会广告板：列入转会名单的时间戳 + 着重度（置顶/推荐）预留表。
--
-- players.transfer_listed_at = 进入转会名单的时刻：首次进名单打戳（offers.ts 的 setOfferSettings），
-- 重复保存保留原戳，退出名单置 NULL；历史存量不回填（NULL = 未知，广告板排序里当最旧处理）。
-- 部分索引只覆盖在名单行，脱离名单的球员不进索引（同 0003 的 status 部分索引思路）。
--
-- player_promotions = 着重度真源，为将来「列入转会名单时的有偿选项」预留：
--   有效 = ends_at > now；一名球员可能有多条（历史 + 现行），读取取最高档、同档取最晚到期；
--   tier 只存 1（推荐）/ 2（置顶），读取时钳 0..2、越界按 0（普通）处理；
--   cost / ref_type / ref_id 是付费流程的落点（金额与流水/单据引用），本版只留列不写。
--   本版只有读路径（GET /api/market/transfer-board），付费写路径不实现 ⇒ 新表 apply 后为空。
--
-- 回滚：DROP TABLE player_promotions; DROP INDEX idx_players_transfer_listed;
--       （transfer_listed_at 为附加列，SQLite 不便回滚，保留不影响旧代码）
ALTER TABLE players ADD COLUMN transfer_listed_at TEXT;
CREATE INDEX idx_players_transfer_listed ON players(id) WHERE transfer_listed = 1;
CREATE TABLE player_promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  tier INTEGER NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  ref_type TEXT,
  ref_id INTEGER,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_player_promotions_active ON player_promotions (player_id, ends_at);
