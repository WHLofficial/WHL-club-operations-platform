-- 米兰队 id 统一：tour 库（whl，ec3cc695-70bc-47ab-a454-5ca62ec22dd6）legacy 47 → 游戏真号 131681
--
-- 背景：平台侧 clubs.id=131681、players.club_id=131681、auth.team.club_id=131681 都已是 FC26 真号；
--       唯独 tour 侧仍是 47——2026-09-16 的 fc26-id-rekey 只做了 tour 1..21 → FC id 的队映射，
--       当时把米兰映到 47（米兰在 FC26 的 TeamID 是 131681，47 是 legacy 占位）。
--
-- 执行前实测（2026-09-19，生产）：
--   team 表 20 行，含 id=47、不含 131681（目标 id 未被占用，无冲突）；
--   全库无 trigger / view（sqlite_master 查 type IN ('trigger','view') 为空）；
--   引用 team(id) 的列：player.team_id=25 行、entry.team_id=2 行；
--   team_member / auth_code / tactic / tactic_submission / injury / lineup_proxy_grant 的 team_id 在 47 上均 0 行
--   （仍一并写上，作幂等保障——将来这些表若有 47 会被一起搬走）；
--   audit_log.target_id=47 有 10 行，但全部是 target_type='match'（match id 撞号），**不得修改**。
--
-- 执行方式：必须走 --command / REST /query —— D1 的 PRAGMA defer_foreign_keys 在 --file 导入通道下失效，
--   FK 会立刻拦下「先改父行、子行暂时悬空」的顺序并整批回滚。
--   npx wrangler d1 execute whl --remote --command "<本文件去掉注释后的语句序列>"
--
-- 期望 changes：team 1 行；player 25 行；entry 2 行；其余表 0 行。
-- 回滚：同结构反向 UPDATE（131681 → 47），同样必须带 PRAGMA defer_foreign_keys = ON 走 --command。

PRAGMA defer_foreign_keys = ON;
UPDATE player SET team_id = 131681 WHERE team_id = 47;
UPDATE team_member SET team_id = 131681 WHERE team_id = 47;
UPDATE auth_code SET team_id = 131681 WHERE team_id = 47;
UPDATE entry SET team_id = 131681 WHERE team_id = 47;
UPDATE tactic SET team_id = 131681 WHERE team_id = 47;
UPDATE tactic_submission SET team_id = 131681 WHERE team_id = 47;
UPDATE injury SET team_id = 131681 WHERE team_id = 47;
UPDATE lineup_proxy_grant SET team_id = 131681 WHERE team_id = 47;
UPDATE team SET id = 131681 WHERE id = 47;
