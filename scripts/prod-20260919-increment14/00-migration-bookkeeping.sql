-- v2.0.0（2026-09-19 生产执行）：补齐 d1_migrations 账目
-- 背景：0016/0017/0018 当初是直接 --file 执行的（未走 wrangler 记账），
--       生产库 d1_migrations 只到 0015，而 schema 里三个迁移的效果（clubs.transfer_banned、
--       seasons.age_cap、result_confirmations.home/away_team_id+stage_kind、
--       season_tournaments.stage_settled_at、stadiums/club_facilities/match_attendance 表）实测都在。
--       不补这三行，`wrangler d1 migrations apply` 会从 0016 重跑并因对象已存在而失败，走不到 0019/0020。
-- 执行：npx wrangler d1 execute whl-club --remote --file scripts/prod-20260919-increment14/00-migration-bookkeeping.sql
-- 回滚：DELETE FROM d1_migrations WHERE name IN ('0016_transfer_ban.sql','0017_season_settle.sql','0018_home.sql');
INSERT INTO d1_migrations (name) VALUES
  ('0016_transfer_ban.sql'),
  ('0017_season_settle.sql'),
  ('0018_home.sql');
