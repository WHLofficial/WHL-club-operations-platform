-- v2.6.0 冠名市场：俱乐部与品牌的冠名合同（费用条款按签约时快照列化，整约锁定）
-- 回滚：DROP TABLE naming_contracts;
CREATE TABLE naming_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL,
  brand TEXT NOT NULL,
  brand_heat REAL NOT NULL,
  base_fee REAL NOT NULL,
  package_no INTEGER NOT NULL,
  pkg_name TEXT NOT NULL,
  fee_per_window REAL NOT NULL,
  windows_total INTEGER NOT NULL,
  windows_remaining INTEGER NOT NULL,
  bonus_amount REAL NOT NULL DEFAULT 0,
  bet_attend REAL,
  bet_fans REAL,
  status TEXT NOT NULL DEFAULT 'active',
  started_season INTEGER NOT NULL,
  started_window INTEGER NOT NULL,
  ended_season INTEGER,
  ended_window INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- 一队同时只能有一份生效冠名（部分唯一索引，历史约不拦）
CREATE UNIQUE INDEX uq_naming_active ON naming_contracts (club_id) WHERE status = 'active';
