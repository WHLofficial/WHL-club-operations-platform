-- 回滚：还原弃权场上座行（收入四件套写回原值）
--
-- 生成时间：2026-10-06T04:23:06Z
-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20
-- 共 5 行，与 sql/06-attendance-cleanup.sql 一一对应
-- 守卫：只在四列全为 0 时命中（即只撤本批的清零），重放 changes=0

-- 还原 club 449（皇家贝蒂斯）比赛 #2：上座 9081、门票 1.36M
UPDATE match_attendance SET attendance = 9081, ticket = 1.36, commercial = 0.00, broadcast = 0.00 WHERE match_id = 2 AND club_id = 449 AND attendance = 0 AND ticket = 0 AND commercial = 0 AND broadcast = 0;
-- 还原 club 449（皇家贝蒂斯）比赛 #31：上座 7202、门票 1.08M
UPDATE match_attendance SET attendance = 7202, ticket = 1.08, commercial = 0.00, broadcast = 0.00 WHERE match_id = 31 AND club_id = 449 AND attendance = 0 AND ticket = 0 AND commercial = 0 AND broadcast = 0;
-- 还原 club 110374（佛罗伦萨）比赛 #38：上座 12735、门票 1.91M
UPDATE match_attendance SET attendance = 12735, ticket = 1.91, commercial = 0.00, broadcast = 0.00 WHERE match_id = 38 AND club_id = 110374 AND attendance = 0 AND ticket = 0 AND commercial = 0 AND broadcast = 0;
-- 还原 club 21（拜仁慕尼黑）比赛 #165：上座 12699、门票 1.90M
UPDATE match_attendance SET attendance = 12699, ticket = 1.90, commercial = 0.00, broadcast = 0.00 WHERE match_id = 165 AND club_id = 21 AND attendance = 0 AND ticket = 0 AND commercial = 0 AND broadcast = 0;
-- 还原 club 2（阿斯顿维拉）比赛 #172：上座 8575、门票 1.29M
UPDATE match_attendance SET attendance = 8575, ticket = 1.29, commercial = 0.00, broadcast = 0.00 WHERE match_id = 172 AND club_id = 2 AND attendance = 0 AND ticket = 0 AND commercial = 0 AND broadcast = 0;