-- 增量 14（2026-09-19 生产执行）：105 名球员的 game_attrs.TeamID 重键到游戏真队 id
-- 背景：这 4 支队在 EA 未授权名单里，游戏里用假名 + 新号；我们的数据源（第三方 fixed 版）用的是
--       已从游戏里消失的 legacy 号（39 亚特兰大 / 44 国米 / 46 拉齐奥 / 47 米兰）。
-- 平台口径统一到游戏真号：39→115845(Bergamo Calcio) / 44→131682(Lombardia FC) / 46→115841(Latium) / 47→131681(Milano FC)。
--   core/fc26.ts 的 FC26_TEAM_ID_ALIASES 与 normalizeTeamId 在导入侧做同一件事，本脚本只补存量。
-- 实到行数（实测）：亚特兰大 39→27 / 国米 44→24 / 拉齐奥 46→30 / 米兰 47→24 = 105 人（与上面 107 人只在米兰 24 人重叠）。
-- 顺序：必须在 02-backfill-cpu-club-id.sql 之后跑（回填靠 47 这个旧号认米兰，重键后就认不出了）。
-- 执行：npx wrangler d1 execute whl-club --remote --file scripts/prod-20260919-increment14/03-rekey-teamid.sql
-- 期望：changes=105
-- 回滚（反向 CASE）：
--   UPDATE players SET game_attrs = json_set(game_attrs, '$.TeamID',
--     CASE json_extract(game_attrs,'$.TeamID') WHEN 115845 THEN 39 WHEN 131682 THEN 44
--          WHEN 115841 THEN 46 WHEN 131681 THEN 47 END)
--   WHERE json_extract(game_attrs,'$.TeamID') IN (115845, 131682, 115841, 131681);
UPDATE players
SET game_attrs = json_set(game_attrs, '$.TeamID',
      CASE json_extract(game_attrs, '$.TeamID')
        WHEN 39 THEN 115845
        WHEN 44 THEN 131682
        WHEN 46 THEN 115841
        WHEN 47 THEN 131681
      END),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE json_extract(game_attrs, '$.TeamID') IN (39, 44, 46, 47);
