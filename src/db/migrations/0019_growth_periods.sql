-- v1.6.0（成长域口径，用户规则 2026-09-18）：成长期 growth_periods
-- 一个赛季可以有多个成长期（通常夹在两个窗口之间 = 半赛季，也可能临时改变，所以不与窗口绑定）。
-- 里程碑（进+攻累计 5/10/15/20…）只累计「当前成长期内」的事件：
--   当前成长期 = id 最大的一行；界 = start_event_id，只算 growth_events.id > start_event_id 的行。
-- 解约清零还会写一条 reset 划断（growth_events.event_type='reset'），单名球员的实际界取两者较晚的一个。
-- 无行 = 全生涯口径（id 0 / 界 0），上线前的老数据不受影响。宣告方式：管理端手动宣告，或开窗时勾选自动宣告。
CREATE TABLE growth_periods (
  id INTEGER PRIMARY KEY,
  season INTEGER,                            -- 宣告时的赛季（展示用，判定不读它）
  start_event_id INTEGER NOT NULL,           -- 界：宣告时点 growth_events 的 MAX(id)（无事件为 0）
  source TEXT NOT NULL DEFAULT 'manual',     -- manual=管理端手动宣告 / window_open=开窗勾选
  note TEXT,
  declared_by INTEGER,
  declared_at TEXT
);
