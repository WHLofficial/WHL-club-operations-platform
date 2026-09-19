-- 米兰队 id 统一：认证中心（whl-auth，b76d1129-77ae-4844-931c-1c7b00a9b048）team.tour_team_id 47 → 131681
--
-- 背景：auth.team 表 20 行，米兰那行是 id=20 / tour_team_id=47 / club_id=131681 / name='AC米兰(CPU)'。
--       增量 14 补链时 club_id 已写成平台真号 131681，只有 tour_team_id 还留着 legacy 47。
--       这一列是「赛事系统队 id → 平台俱乐部」的桥；留着 47 会让平台按 tour id 反查不到米兰
--       （平台 ClubRef 过滤/映射用的是 131681 这一侧）。
--
-- 执行前实测（2026-09-19，生产）：tour_team_id=47 唯一命中米兰一行；131681 未被别的行占用（club_id 有 UNIQUE）。
--   auth 侧 team.id（内部序号 1..20）被 team_bind_code.team_id / team_binding.team_id 引用，本轮不动它。
--   club_id 已是 131681，无需 UPDATE。
--
-- 期望 changes：1 行。
-- 回滚：UPDATE team SET tour_team_id = 47 WHERE tour_team_id = 131681 AND name = 'AC米兰(CPU)';
--   （带 name 守卫：万一 131681 将来被别的队占用，回滚也不会误改）

UPDATE team SET tour_team_id = 131681 WHERE tour_team_id = 47 AND name = 'AC米兰(CPU)';
