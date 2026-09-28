-- 0049_stadium_event_pending.sql · v6.10.0 随机事件（D 块）
-- 事件对「下一场主场比赛」的预置修正。本仓上座与天气是**赛果确认时现掷**的
-- （home.ts matchAttendanceStatements），没有提前掷好的天气行，所以插件的
-- attendance_mod / weather_set 只能把修正提前写在这两列上，等下一场主场结算时消费并清零（一次性）。
-- next_weather 为空串 = 无预置（照常现掷）；非空则替代掷出的天气（取值需在 attendance_model.weather_probabilities 内）。
-- 回滚：ALTER TABLE stadiums DROP COLUMN next_attendance_mod; / ALTER TABLE stadiums DROP COLUMN next_weather;
ALTER TABLE stadiums ADD COLUMN next_attendance_mod REAL NOT NULL DEFAULT 1;
ALTER TABLE stadiums ADD COLUMN next_weather TEXT NOT NULL DEFAULT '';
