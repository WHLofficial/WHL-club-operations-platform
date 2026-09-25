-- v0.7.0：赛果确认（TECH_DESIGN §11）。平台只读同步比赛系统（TOUR_DB）完赛场次，
-- 管理组确认时把比分快照落平台库——此后比赛系统改判不影响已确认记录（对账以快照为准）。
-- 奖金 P0 走手动记账；XP 事件由确认钩子写入 growth_events（match_ref = 比赛系统 match id）。
CREATE TABLE result_confirmations (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  tournament_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL UNIQUE,          -- 比赛系统 match.id
  competition_type TEXT,                     -- 确认时窗口绑定的竞赛类型
  stage_name TEXT,                           -- 阶段名（比赛系统 stage.name，NULL 时前端按赛制兜底）
  round INTEGER,
  home_team TEXT,                            -- 队名快照（比赛系统只存 team_id，展示名随确认定格）
  away_team TEXT,
  score_home INTEGER,
  score_away INTEGER,
  pen_home INTEGER,
  pen_away INTEGER,
  walkover_side TEXT,                        -- ''=普通场 home/away/both=弃权判负
  winner_team TEXT,
  finished_at TEXT,
  confirmed_by INTEGER,
  confirmed_at TEXT
);
CREATE INDEX idx_result_confirmations_window ON result_confirmations (season, window_seq);

-- 一座赛事只能绑一个窗口（重复绑会把同一场比赛双份放进赛果队列）；
-- 0001 的同名非唯一索引退役，唯一部分索引同时覆盖查询
DROP INDEX IF EXISTS idx_season_windows_tournament;
CREATE UNIQUE INDEX idx_season_windows_tournament ON season_windows (tournament_id) WHERE tournament_id IS NOT NULL;
