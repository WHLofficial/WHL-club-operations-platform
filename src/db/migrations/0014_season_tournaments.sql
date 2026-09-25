-- v0.7.1：赛事绑定层级修订（需求方裁决 2026-09-14）——赛季是上级，赛事与窗口是并列下级：
-- 赛事绑定到赛季（一座赛事全库只能进一个赛季，重复绑会把同一场比赛双份放进赛果队列），窗口只管转会准入。
-- season_windows.tournament_id / competition_type 两列休眠（SQLite 不便 DROP COLUMN），代码停用。
CREATE TABLE season_tournaments (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  tournament_id INTEGER NOT NULL UNIQUE,
  competition_type TEXT,                 -- league_premier/league_second/champions_cup/super_cup/qualifying
  created_at TEXT
);
CREATE INDEX idx_season_tournaments_season ON season_tournaments (season);

-- 回填：旧窗口行上的绑定平移到赛季行
INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at)
SELECT season, tournament_id, competition_type, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM season_windows WHERE tournament_id IS NOT NULL;

-- 旧唯一索引退役（绑定不再写 season_windows）
DROP INDEX IF EXISTS idx_season_windows_tournament;
