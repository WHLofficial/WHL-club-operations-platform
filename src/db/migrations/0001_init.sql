-- 0001 · 平台库全量建表（TECH_DESIGN §5）+ §17 读配额索引
-- 身份边界：user 真源在比赛系统 TOUR_DB user 表，平台不建本地 users 表、不写 user（§3.1/§4）

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  uid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  club_id INTEGER,                    -- NULL = 无归属（可海捞）
  position TEXT,                      -- GK/CB/LB/RB/CDM/CM/LM/RM/...（防守位置判定用）
  foot INTEGER DEFAULT 1,             -- 惯用脚 0=左脚 1=右脚（导入归一化：FootID 1右/2左，§5.2）
  age INTEGER,
  ca INTEGER,
  pa INTEGER,
  growable INTEGER DEFAULT 1,         -- 可成长标记
  prestige REAL DEFAULT 0,            -- 国际声望 1-5（FC26db internationalrep 导入映射）
  market_value REAL,                  -- 身价：管理员赋值（无公式）
  status TEXT DEFAULT 'normal',       -- normal/listed/trainee/free/retired
  growth_tier INTEGER DEFAULT 1,      -- 成长档位 1-5
  growth_xp REAL DEFAULT 0,           -- 当前成长经验
  is_future_star INTEGER DEFAULT 0,   -- 未来之星（档位+2；源=Growth+ 名单+管理组核定）
  china_plan INTEGER DEFAULT 0,       -- 中国球员加强计划（naID=155 China PR 自动判定）
  agent_tier INTEGER DEFAULT 2,       -- 经纪人档位 1温和/2普通/3苛刻（公开属性；窗口推进重掷，§6.8）
  fc_id INTEGER UNIQUE,               -- EA 球员 ID，导入对齐键（§5.4 upsert ON CONFLICT(fc_id) 要求唯一）
  badges_silver INTEGER DEFAULT 0 CHECK (badges_silver BETWEEN 0 AND 15),
  badges_gold INTEGER DEFAULT 0 CHECK (badges_gold BETWEEN 0 AND 3),
  game_attrs TEXT,                    -- 当季 FC 源 JSON（ID-only 口径，§5.2 存储裁决）
  base_ca INTEGER,                    -- 非成长所得 CA，换版折算基准（§10.4；导入时=CA）
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE clubs (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  league_tier TEXT,                   -- premier/second
  logo_key TEXT,
  status TEXT,
  created_at TEXT
);

CREATE TABLE club_bindings (
  club_id INTEGER REFERENCES clubs,
  user_id INTEGER UNIQUE,             -- 一账号一队（user_id = 比赛系统 user.id）
  bound_at TEXT
);

CREATE TABLE qq_links (
  user_id INTEGER PRIMARY KEY,
  qq TEXT UNIQUE,
  verified_at TEXT
);

CREATE TABLE contracts (
  id INTEGER PRIMARY KEY,
  player_id INTEGER UNIQUE REFERENCES players,  -- 一球员一份现行合同
  club_id INTEGER REFERENCES clubs,
  release_fee REAL,                   -- RC（m）
  wage REAL,                          -- 工资（m/半赛季）
  contract_type TEXT DEFAULT 'formal',          -- formal/trainee
  source TEXT,                        -- 成约方式 negotiation/forced/direct/import（§6.7）
  signed_at TEXT,
  effective_from TEXT,                -- 效力起点（解约费/忠诚奖金计算基准）
  protected_until TEXT,               -- 保护期至（前 1.5 赛季）
  is_active INTEGER DEFAULT 1
);

CREATE TABLE registrations (
  season INTEGER,
  club_id INTEGER,
  player_id INTEGER,
  squad TEXT,                         -- first_team/trainee
  PRIMARY KEY (season, club_id, player_id)
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  player_id INTEGER,
  seller_club_id INTEGER,
  type TEXT DEFAULT 'normal',         -- normal/forced（强制拍卖）
  ask_price REAL,
  status TEXT,                        -- 状态机见 §6.1/§6.2
  listed_at TEXT,
  listed_day TEXT,                    -- N 日（挂牌日）
  last_bid_at TEXT,                   -- 静默计时基准
  deadline_note TEXT,                 -- 顺延记录
  window_seq INTEGER,
  season INTEGER
);

CREATE TABLE bids (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings,
  club_id INTEGER,
  amount REAL,
  created_at TEXT,
  status TEXT,                        -- active/superseded/withdrawn/won
  hold_id INTEGER                     -- 资金冻结引用
);

CREATE TABLE fund_holds (
  id INTEGER PRIMARY KEY,
  club_id INTEGER,
  amount REAL,
  status TEXT,                        -- held/released/settled
  ref_type TEXT,
  ref_id INTEGER,
  created_at TEXT
);

CREATE TABLE transfers (
  id INTEGER PRIMARY KEY,
  type TEXT,                          -- transfer/activation/match/free_agent/termination/rc_change/forced_auction（rc_change 展示名「续约」）
  player_id INTEGER,
  from_club_id INTEGER,
  to_club_id INTEGER,
  fee REAL,                           -- 成交价
  tax REAL,                           -- 交易税
  extra_fee REAL,                     -- 附加费（下架费/解约费/改RC费/匹配差额）
  matched INTEGER DEFAULT 0,
  status TEXT,                        -- pending_review/completed/rejected/cancelled
  evidence TEXT,                      -- 截图/备注（人工审依据）
  review_task_id INTEGER,
  season INTEGER,
  window_seq INTEGER,
  idempotency_key TEXT UNIQUE,        -- 过户幂等
  created_at TEXT,
  completed_at TEXT
);

CREATE TABLE review_tasks (
  id INTEGER PRIMARY KEY,
  type TEXT,
  ref_id INTEGER,
  payload TEXT,
  status TEXT,                        -- open/approved/rejected
  requested_by INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  note TEXT
);

CREATE TABLE negotiation_sessions (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER UNIQUE REFERENCES transfers,  -- transfer 单即案例，审核通过自动创建（§6.7）
  player_id INTEGER,
  club_id INTEGER,                    -- 签约方（买方/匹配方/海捞方/本队）
  expected_wage REAL,                 -- 基础快照 E（重设新 RC 时更新；续约单含加薪）
  attempt_count INTEGER DEFAULT 0,
  status TEXT,                        -- active/settled/cancelled
  created_at TEXT,
  settled_at TEXT
);

CREATE TABLE negotiation_attempts (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES negotiation_sessions,
  attempt_no INTEGER,
  offered_wage REAL,
  eff_expected REAL,                  -- 仅服务端可见，API/日志不回传（§6.10）
  result TEXT,                        -- success/fail/direct_fail
  created_at TEXT,
  UNIQUE (session_id, attempt_no)
);

CREATE TABLE seasons (
  season INTEGER PRIMARY KEY,
  status TEXT,                        -- preparing/running/settled（§11）
  created_at TEXT,
  settled_at TEXT
);

CREATE TABLE season_windows (
  id INTEGER PRIMARY KEY,
  season INTEGER,
  window_seq INTEGER,
  status TEXT,                        -- open/closed
  tournament_id INTEGER,              -- 每赛季从比赛系统赛事列表选择绑定
  competition_type TEXT,              -- league_premier/league_second/champions_cup/super_cup/qualifying
  opened_at TEXT,
  closed_at TEXT,
  UNIQUE (season, window_seq)
);

CREATE TABLE ledger_accounts (
  club_id INTEGER PRIMARY KEY,
  balance REAL NOT NULL,
  updated_at TEXT
);

CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY,
  club_id INTEGER,
  kind TEXT NOT NULL,                 -- 枚举见 §7.1
  amount REAL NOT NULL,               -- 正=入账 负=出账
  balance_after REAL NOT NULL,        -- 防错账
  ref_type TEXT,
  ref_id INTEGER,
  memo TEXT,
  created_at TEXT
);

CREATE TABLE growth_events (
  id INTEGER PRIMARY KEY,
  player_id INTEGER,
  match_ref TEXT,                     -- 比赛系统 match id
  season INTEGER,
  window_seq INTEGER,
  event_type TEXT,                    -- 出场/评分/进球/助攻/零封/夺权/扑救/里程碑
  value REAL,
  xp REAL,
  source TEXT,                        -- auto(比赛系统事件)/manual(管理组补录)
  recorded_by INTEGER,
  created_at TEXT,
  UNIQUE (player_id, match_ref, event_type)  -- 防重复记 XP（§10.1）
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  club_id INTEGER,
  user_id INTEGER,
  channel TEXT,                       -- qq/web
  template TEXT,
  payload TEXT,
  status TEXT,                        -- pending/sent/failed
  created_at TEXT,
  sent_at TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor INTEGER,
  action TEXT,
  target_type TEXT,
  target_id INTEGER,
  before TEXT,                        -- 涉密 config 键不记值，仅记「已修改」（§6.10-4）
  after TEXT,
  at TEXT
);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

-- §17.1-1 只增表上线即建（比赛系统配额报警后才补的教训）
CREATE INDEX idx_ledger_entries_club ON ledger_entries (club_id, id);
CREATE INDEX idx_ledger_entries_kind ON ledger_entries (kind, id);
CREATE INDEX idx_ledger_entries_ref ON ledger_entries (ref_type, ref_id);
CREATE INDEX idx_audit_log_target ON audit_log (target_type, target_id, id);

-- §17.1-2 高频过滤+排序复合索引（最新 N 条与 cron 扫描只走索引区间）
CREATE INDEX idx_listings_status_listed ON listings (status, listed_at DESC);
CREATE INDEX idx_listings_status_last_bid ON listings (status, last_bid_at);
CREATE INDEX idx_bids_listing_amount ON bids (listing_id, amount DESC);
CREATE INDEX idx_bids_club ON bids (club_id, id);
CREATE INDEX idx_bids_hold ON bids (hold_id);
CREATE INDEX idx_review_tasks_status ON review_tasks (status, id);
CREATE INDEX idx_review_tasks_ref ON review_tasks (type, ref_id);
CREATE INDEX idx_notifications_status ON notifications (status, id);

-- §17.1-3 外键列全配索引
CREATE INDEX idx_players_club ON players (club_id);
CREATE INDEX idx_contracts_club ON contracts (club_id);
CREATE INDEX idx_registrations_player ON registrations (player_id);
CREATE INDEX idx_listings_player ON listings (player_id);
CREATE INDEX idx_listings_seller ON listings (seller_club_id);
CREATE INDEX idx_fund_holds_club ON fund_holds (club_id, status);
CREATE INDEX idx_fund_holds_ref ON fund_holds (ref_type, ref_id);
CREATE INDEX idx_transfers_player ON transfers (player_id);
CREATE INDEX idx_transfers_from ON transfers (from_club_id);
CREATE INDEX idx_transfers_to ON transfers (to_club_id);
CREATE INDEX idx_transfers_review_task ON transfers (review_task_id);
CREATE INDEX idx_negotiation_sessions_player ON negotiation_sessions (player_id);
CREATE INDEX idx_negotiation_sessions_club ON negotiation_sessions (club_id);
CREATE INDEX idx_season_windows_tournament ON season_windows (tournament_id);
CREATE INDEX idx_notifications_club ON notifications (club_id, id);
CREATE INDEX idx_notifications_user ON notifications (user_id, id);
CREATE INDEX idx_club_bindings_club ON club_bindings (club_id);
