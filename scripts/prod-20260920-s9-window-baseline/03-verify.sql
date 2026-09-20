-- 执行后复查（只读，单行多标量）。本文件由 --command 通道执行，见 README。
--
-- 期望值：windows_s9=1 / w1_closed=1 / open_windows=0 / rc_one=62 / rc_zero=0 /
--        ma_one=50 / ma_zero=0 / season_status=preparing / contracts=0

SELECT
  (SELECT COUNT(*) FROM season_windows WHERE season = 9)                                            AS windows_s9,
  (SELECT COUNT(*) FROM season_windows WHERE season = 9 AND window_seq = 1 AND status = 'closed')   AS w1_closed,
  (SELECT COUNT(*) FROM season_windows WHERE status = 'open')                                       AS open_windows,
  (SELECT COUNT(*) FROM result_confirmations WHERE season = 9 AND window_seq = 0)                   AS rc_zero,
  (SELECT COUNT(*) FROM result_confirmations WHERE season = 9 AND window_seq = 1)                   AS rc_one,
  (SELECT COUNT(*) FROM match_attendance     WHERE season = 9 AND window_seq = 0)                   AS ma_zero,
  (SELECT COUNT(*) FROM match_attendance     WHERE season = 9 AND window_seq = 1)                   AS ma_one,
  (SELECT status FROM seasons WHERE season = 9)                                                     AS season_status,
  (SELECT COUNT(*) FROM contracts)                                                                  AS contracts;
