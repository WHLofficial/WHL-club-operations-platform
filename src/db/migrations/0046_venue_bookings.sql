-- 0046_venue_bookings.sql · v6.9.0 球场档期（E 块）
-- 每窗「非比赛日档位」的预订：一槽一活动，同窗同槽唯一（改订即覆盖）。
-- slot_no 是窗口内非比赛日的抽象序号（1..activity_slots，界 0-20），与真实赛历无关。
-- 收益/草皮损坏在窗末结算（venue-ops.ts 的确定性伪随机，随关窗批入账），此处只存预订意图。
-- UNIQUE(club_id, season, window_seq, slot_no) 自动带索引，列表查询（按队+赛季+窗）走前缀。
CREATE TABLE IF NOT EXISTS venue_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  slot_no INTEGER NOT NULL,
  activity_type TEXT NOT NULL,
  booked_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (club_id, season, window_seq, slot_no)
);

-- 回滚：DROP TABLE venue_bookings;
