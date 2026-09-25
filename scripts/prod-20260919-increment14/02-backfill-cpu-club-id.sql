-- v2.0.0（2026-09-19 生产执行）：存量 107 名 CPU 队球员的 club_id 回填
-- 裁决 Q2：导入逻辑写 club_id + 一次性 SQL 回填存量。
-- 实到行数（导入前实测，生产 players 表）：巴萨 241→28 / 曼城 10→26 / 莱比锡 112172→29 / 米兰 47→24 = 107 人。
-- 注意米兰：源 game_attrs.TeamID 是 legacy 47，平台 club 行是 131681，所以 CASE 里 47→131681。
-- 幂等护栏：`club_id IS NULL` —— 已被认领/被海捞过的球员不再被本脚本改写。
-- 执行：npx wrangler d1 execute whl-club --remote --file scripts/prod-20260919-increment14/02-backfill-cpu-club-id.sql
-- 期望：changes=107
-- 回滚：UPDATE players SET club_id = NULL WHERE club_id IN (10, 241, 112172, 131681);
UPDATE players
SET club_id = CASE json_extract(game_attrs, '$.TeamID')
      WHEN 241    THEN 241
      WHEN 10     THEN 10
      WHEN 112172 THEN 112172
      WHEN 47     THEN 131681
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE club_id IS NULL
  AND json_extract(game_attrs, '$.TeamID') IN (241, 10, 112172, 47);
