-- S9 季初窗基线（2026-09-20 预检通过；生产执行等管理组明确下令）
--
-- 口径（用户裁决 2026-09-20）：制造「季初窗已关闭、中期窗未开」的状态——
--   写入一条 season=9 / window_seq=1 的**常规窗**，直接落 status='closed'（= 开一个窗并马上关闭），
--   窗口时点早于 62 场已确认比赛的最早确认时点（2026-09-20T05:45:06.359Z），
--   使这批比赛落在「季初窗已关、中期窗未开」的空档里，其 window_seq 归 1（见 02-restamp-matches.sql）。
--
-- 为什么不写 is_temporary：迁移 0028（contracts 窗刻度）**尚未 apply**，生产 season_windows 没有该列。
--   0028 apply 时 ALTER 的 DEFAULT 0 会把本行回填为 is_temporary=0，正是「常规窗」，与裁决一致。
--
-- 为什么不改进 seasons.status（保持 'preparing'）：
--   registration 提交闸门要求赛季处于备赛期（src/worker/routes/registration.ts:185 → src/worker/seasons.ts:5
--   getRegistrableSeason），而翻 running 的唯一触发点是 window-machine.ts:164 的 openWindow。
--   本批不经应用开窗，因此 seasons 保持 preparing —— 20 队仍能提交 S9 名单；
--   将来从中期窗开窗时会由 openWindow 自己把它翻成 running。详见 README「为什么不翻 running」。
--
-- 预检实测（2026-09-20，生产 whl-club，全部只读查询）：
--   season_windows = 0 行；
--   seasons 仅 season 9（status='preparing'，age_cap=25，created_at 2026-09-18T00:32:17.537Z）；
--   result_confirmations = 62 行，全部 (season=9, window_seq=0)，
--     confirmed_at 2026-09-20T05:45:06.359Z … 2026-09-20T06:01:05.403Z；
--   match_attendance = 50 行，全部 (season=9, window_seq=0)；
--   contracts = 0 行；registrations = 0 行；season_tournaments = 3 行（S9 三赛事已绑定）。
--
-- 期望 changes：1 行。WHERE NOT EXISTS 守卫 ⇒ 重复执行 changes = 0（幂等）。
-- 回滚：见 99-rollback.sql。

INSERT INTO season_windows (season, window_seq, status, opened_at, closed_at)
SELECT 9, 1, 'closed', '2026-09-18T01:00:00.000Z', '2026-09-18T01:01:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM season_windows WHERE season = 9 AND window_seq = 1);
