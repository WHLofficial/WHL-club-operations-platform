-- 回滚：S9 季初窗基线（把生产恢复成「零窗、62 场 window_seq=0」的原状）
--
-- 前提（否则不要跑）：此后**没有**经应用开过/关过任何窗，也没有新的比赛确认。
--   一旦应用侧开过窗，DELETE 的 opened_at 守卫会保护它不被删，但 02 的复位会把
--   本批归窗之外的新数据一并改回 0 —— 那种情况下请改用定向 UPDATE（按 confirmed_at 区间）。
--
-- 顺序：先复位比赛（让数据回到无窗口径），再删窗行。

UPDATE result_confirmations SET window_seq = 0 WHERE season = 9 AND window_seq = 1;  -- 期望 62
UPDATE match_attendance     SET window_seq = 0 WHERE season = 9 AND window_seq = 1;  -- 期望 50

-- 守卫：只删本批造的那一行（时点是本批独有标识），避免误删应用建的窗。
DELETE FROM season_windows
 WHERE season = 9 AND window_seq = 1
   AND status = 'closed'
   AND opened_at = '2026-09-18T01:00:00.000Z'
   AND closed_at = '2026-09-18T01:01:00.000Z';  -- 期望 1
