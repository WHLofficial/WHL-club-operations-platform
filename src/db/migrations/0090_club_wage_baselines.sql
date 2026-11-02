-- v6.69.0 期二：窗口期薪资三段（设计稿 §3.3）
-- 开窗瞬间给每支非 CPU 球队记一行工资基线，工作台据此显示「窗初 → 现在 → 待生效」。
-- 只增表，不动 registrations（后者降级为关窗存档，期三恢复写入）。
CREATE TABLE IF NOT EXISTS club_wage_baselines (
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  wage_total REAL NOT NULL,
  player_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season, window_seq, club_id)
);
