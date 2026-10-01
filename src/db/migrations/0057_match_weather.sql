-- v6.15.0：场次天气预报（revenue 插件 forecast_round 口径：管理员按轮触发、逐场随机、已预报保留）。
-- 天气类型与系数 wx 一并在预报时抽定落库（用户裁决 2026-10-01：不仅是类型，整个系数就预先抽），
-- 赛果确认时按「事件预置 > 场次预报 > 现掷」消费（home.ts matchAttendanceStatements）。
-- match_id = 比赛系统 match.id，与 result_confirmations / match_attendance 同键对齐，
-- 主键即幂等闸（重复触发/并发触发都撞 UNIQUE，已预报保留）。
CREATE TABLE match_weather (
  match_id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL,                  -- 主队平台 clubs.id（消费端校验用，防改期/换边错配）
  season INTEGER NOT NULL,                   -- season_tournaments 绑定解析（与赛果确认同口径）
  tournament_id INTEGER NOT NULL,            -- 比赛系统赛事 id（按轮定位键之一）
  round INTEGER,                             -- 比赛系统 match.round
  weather TEXT NOT NULL,                     -- 晴/多云/雨/雪（attendance_model.weather_probabilities 键内）
  wx_coef REAL NOT NULL,                     -- 预报时抽定的天气系数（uniform(weather_ranges[weather])）
  forecast_by INTEGER,                       -- 触发的管理员 user id（审计另有 weather_forecast 行）
  created_at TEXT NOT NULL
);
CREATE INDEX idx_match_weather_round ON match_weather (tournament_id, round);
