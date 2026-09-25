-- v2.0.0（2026-09-19 生产执行）：为 4 支 CPU 队建 clubs 行
-- 裁决（用户 2026-09-18 CPU 六问）：
--   Q1 队名 = tour 队名逐字一致（半角「(CPU)」后缀，判定复用 isCpuTeam）；
--   Q3 队 id 用游戏真队 id——巴萨 241 / 曼城 10 / 莱比锡 112172 与 FC 号相同，
--      米兰因 EA 未授权必须假名，游戏真号 131681（legacy 47 在游戏里已不存在）。
-- 列形状镜像现有 16 支联盟队：league_tier/logo_key 为 NULL，status='active'，transfer_banned 走默认 0。
-- 执行：npx wrangler d1 execute whl-club --remote --file scripts/prod-20260919-increment14/01-cpu-clubs.sql
-- 期望：changes=4
-- 回滚：DELETE FROM clubs WHERE id IN (10, 241, 112172, 131681);
INSERT INTO clubs (id, name, league_tier, logo_key, status, created_at) VALUES
  (10,     '曼城(CPU)',     NULL, NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (241,    '巴塞罗那(CPU)', NULL, NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (112172, 'RB莱比锡(CPU)', NULL, NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (131681, 'AC米兰(CPU)',   NULL, NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
