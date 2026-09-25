-- v2.0.0（2026-09-19 生产执行）：认证中心目录补 4 支 CPU 队的 club_id
-- 裁决 Q6：auth 目录「补上但禁止入账」——目录里登记 club_id 供赛程/展示，平台入账侧
--   （prizes.ts clubIdByTourTeam）用 cpuClubIds 过滤，奖金与主场收入不发。
-- 跑库：auth 生产库 whl-auth（在 WHL-auth-service 仓执行，或用 club 仓的 AUTH_DB 绑定名 whl-auth）。
-- 生产现状（实测）：team 表 20 行，其中 tour_team_id 10 / 47 / 241 / 112172 四行 club_id 为 NULL、name 分别为
--   '曼城(CPU)' / 'AC米兰(CPU)' / '巴塞罗那(CPU)' / 'RB莱比锡(CPU)'。
-- 注意米兰：tour 侧队 id 仍是 legacy 47，平台 club 行是游戏真号 131681 —— 映射要跨号写 131681
--   （写成 47 会绕开 cpuClubIds 过滤，等于给不存在的俱乐部记账）。
-- 执行：cd ../WHL-auth-service && npx wrangler d1 execute whl-auth --remote --file <本文件绝对路径>
-- 期望：changes=4（四行各 1）
-- 回滚：UPDATE team SET club_id = NULL WHERE tour_team_id IN (10, 47, 241, 112172);
UPDATE team SET club_id = 10     WHERE tour_team_id = 10     AND name = '曼城(CPU)';
UPDATE team SET club_id = 241    WHERE tour_team_id = 241    AND name = '巴塞罗那(CPU)';
UPDATE team SET club_id = 112172 WHERE tour_team_id = 112172 AND name = 'RB莱比锡(CPU)';
UPDATE team SET club_id = 131681 WHERE tour_team_id = 47     AND name = 'AC米兰(CPU)';
