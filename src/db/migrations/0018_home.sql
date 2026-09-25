-- v1.5.0（主场收入域，TECH_DESIGN §8 + 主规则 v5.2 §4.1.2/4.1.3/5.1-5.2）：
-- stadiums          球场/主场域主档（一 club 一行；容量/档位初始 20000/0，规则 5.2.1 初始 20000 座；
--                   shell_influence=队壳影响力、bonus_points=奖励分（主规则 §5.1 管理组维护），
--                   球员影响力总和按规则公式即时计算不落列）
-- club_facilities   五类设施 0-5 级（商业区/灯光转播/草皮/青训中心/医疗中心；本期只建模型+初始导入，
--                   扩建/升级操作留远期）
-- match_attendance  上座快照（赛果确认时算定：天气/上座/三分收入；match_id 主键=幂等闸，锚 tour match）
CREATE TABLE stadiums (
  club_id INTEGER PRIMARY KEY REFERENCES clubs(id),
  name TEXT NOT NULL DEFAULT '',             -- 球场名（可空=未冠名）
  capacity INTEGER NOT NULL DEFAULT 20000,
  tier INTEGER NOT NULL DEFAULT 0,           -- 球场档位 0-4（tier_table）
  shell_influence REAL NOT NULL DEFAULT 0,   -- 队壳影响力（管理组维护，§5.1）
  bonus_points REAL NOT NULL DEFAULT 0,      -- 奖励分（过往赛季成绩，管理组维护）
  fans REAL NOT NULL DEFAULT 1800,           -- 死忠球迷数（当前值）
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE club_facilities (
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  facility_key TEXT NOT NULL,                -- commercial/broadcast/pitch/youth/medical
  level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
  updated_at TEXT,
  UNIQUE (club_id, facility_key)
);

CREATE TABLE match_attendance (
  match_id INTEGER PRIMARY KEY,              -- tour match id；重复确认撞主键=幂等闸
  club_id INTEGER NOT NULL,                  -- 主场俱乐部
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,               -- 确认时点窗口号（与赛果快照同口径，假设 25）
  weather TEXT,                              -- 晴/多云/雨/雪（确认时掷出固化，假设 30）
  attendance INTEGER NOT NULL,
  ticket REAL NOT NULL,
  commercial REAL NOT NULL,
  broadcast REAL NOT NULL,
  created_at TEXT
);

CREATE INDEX idx_match_attendance_club ON match_attendance(club_id, season, window_seq);
