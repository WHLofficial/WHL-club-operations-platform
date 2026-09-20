-- 62 场已确认比赛归入季初窗（window_seq 0 → 1）（2026-09-20；生产执行等管理组明确下令）
--
-- 口径：这批比赛在「无窗」状态下被确认，confirmMatch 取不到在开窗时按代码兜底取
--   最新 season/window_seq 的窗（src/worker/results.ts:218-262），生产当时一条窗都没有 ⇒ 落 0。
--   季初窗建好后（01-window-baseline.sql），把 result_confirmations 与 match_attendance
--   的 window_seq 0 一并归到 1，与代码兜底口径一致。
--
-- 为什么这两张表：带 window_seq 且生产有数据的表只有它们（growth_events 0 行；
--   ledger_entries 无 window_seq 列；contracts.signed_window_seq 由未 apply 的 0028 添加）。
--
-- 预检实测（2026-09-20）：result_confirmations (season=9, window_seq=0) = 62 行；
--   match_attendance (season=9, window_seq=0) = 50 行（62 场里 12 场主队无 stadiums 行被跳过，未落上座）。
--
-- 期望 changes：62 行 + 50 行 = 112 行（幂等：重复执行时 window_seq=0 已无行，changes = 0）。
-- 回滚：见 99-rollback.sql。

UPDATE result_confirmations SET window_seq = 1 WHERE season = 9 AND window_seq = 0;  -- 期望 62
UPDATE match_attendance     SET window_seq = 1 WHERE season = 9 AND window_seq = 0;  -- 期望 50
