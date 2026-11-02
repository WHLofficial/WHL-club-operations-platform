-- v6.69.0 期三：关窗核验存档（设计稿 §3.4）
-- 每次关窗给每支球队留一行体检结果（CPU 也写：pass=1、issues='[]'，供看板/历史对齐）。
-- 不阻断关窗（D6），只记录；红字与通知都从这里派生。
CREATE TABLE IF NOT EXISTS squad_audits (
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  pass INTEGER NOT NULL,
  issues_json TEXT NOT NULL DEFAULT '[]',
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season, window_seq, club_id)
);
CREATE INDEX IF NOT EXISTS idx_squad_audits_season ON squad_audits(season, window_seq);
