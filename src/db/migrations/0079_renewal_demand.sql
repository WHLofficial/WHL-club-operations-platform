-- 0079_renewal_demand.sql · v6.54.0 球员主动要求续约/涨薪（闹涨薪）
-- 设计文档：docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md §6（数据模型）/ §5.7（生效时点）。
-- 四张新表 + transfers 三列快照；contracts 不加列（protection_ticks / signed_at 已有，见 0001 与 0028）。
-- 生效时点不变式（§5.7）：所有合同变更（闹涨薪接受、普通续约改 RC）只写 contract_pending_changes，
-- contracts.wage/release_fee/protection_ticks 在窗口关闭前保持旧值；关窗批对仍在原队的 pending
-- 逐条 apply（不再扣款，接受时已扣），已离队球员的 pending 置 void（demand 不退费）。
-- 回滚：ALTER TABLE transfers DROP COLUMN src_service_ticks;（另两列同理，SQLite 3.35+）
--       DROP TABLE transfer_requests; DROP TABLE contract_demand_attempts;
--       DROP INDEX idx_pending_one_per_player; DROP INDEX idx_pending_club_status;
--       DROP TABLE contract_pending_changes;
--       DROP INDEX idx_contract_demands_club_status; DROP INDEX idx_contract_demands_player;
--       DROP TABLE contract_demands;

-- ① 闹涨薪要求主表：一球员同窗最多一条（UNIQUE 三键）；status 六态见设计 §11.1 状态机
CREATE TABLE contract_demands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','countered','accepted','rejected','expired','void')),
  current_wage REAL NOT NULL,        -- 提要求时的现行工资
  expected_wage REAL NOT NULL,       -- 按 RC 派生的预期工资（谈判锚）
  target_wage REAL NOT NULL,         -- 接受即按此值写 pending（§5.2）
  floor_wage REAL NOT NULL,          -- 底线：还价低于它直接谈崩（§5.4 lowball 档）
  raise_pct REAL NOT NULL,
  rc_current REAL NOT NULL DEFAULT 0,
  rc_floor REAL NOT NULL DEFAULT 0,  -- 接受时一并生效的最低违约金 floor（§5.5）
  rc_fee REAL NOT NULL DEFAULT 0,    -- 接受时已扣金额（闹涨薪恒 0）；apply 不重复扣；未来普通续约非免费时 30% 在接受时即时扣
  round INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,          -- 生成时算好：min(created_at+3d, window_close)
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  reminded_at TEXT NOT NULL DEFAULT '', -- 24h 截止提醒一次性闸（空串=未提醒，同 0050 event_occurrences 模式）
  applied_at TEXT,
  void_reason TEXT,
  seed INTEGER NOT NULL,             -- 生成概率的确定性种子；还价判定用 seededUnit([demand_id, round], 21)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (player_id, season, window_seq)
);
CREATE INDEX idx_contract_demands_club_status
  ON contract_demands(club_id, status, expires_at);
CREATE INDEX idx_contract_demands_player
  ON contract_demands(player_id, season, window_seq);

-- ② 待生效合同变更：关窗批 apply 之前唯一的事实记录；pending 对 transfer/activation 逻辑不可见（§5.7）
CREATE TABLE contract_pending_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('demand','renewal','rejection')),
  demand_id INTEGER,
  wage_new REAL NOT NULL,
  release_fee_new REAL,
  -- rev19：S4′ 直拒后果需要（保护期置已过写 0；降档写新 RC；NULL=该项不变）
  protection_ticks_new INTEGER,
  rc_fee REAL NOT NULL DEFAULT 0,    -- 接受时已扣；apply 不重复扣
  rc_fee_charged_at TEXT,
  free_rc_change INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','void')),
  effective_window_seq INTEGER NOT NULL,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT
);
-- 一球员同时最多 1 条 pending；第二条（闹涨薪或普通续约）返回 409（§5.7）——部分唯一索引在库层兜底
CREATE UNIQUE INDEX idx_pending_one_per_player
  ON contract_pending_changes(player_id) WHERE status='pending';
CREATE INDEX idx_pending_club_status
  ON contract_pending_changes(club_id, status, effective_window_seq);

-- ③ 逐轮还价记录：round 从 0 起，UNIQUE (demand_id, round) 钉轮次
CREATE TABLE contract_demand_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demand_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  wage REAL NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (demand_id, round)
);

-- ④ 转会申请（§5.4 拒绝后果梯度）：released = 「不满」徽章存续标记，重签/离队置 resolved
CREATE TABLE transfer_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  demand_id INTEGER,
  -- 终局来源（§5.4 梯度）：direct=经理明确放人（走硬后果）；collapse=3 轮谈崩；lowball=还价低于 floor
  source TEXT NOT NULL CHECK (source IN ('direct','collapse','lowball')),
  listing_id INTEGER,                -- 仅经理手动挂牌后回填（软档）；未挂牌为 NULL
  last_listing_window_seq INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','listed','released','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE (player_id, club_id, demand_id)
);

-- ⑤ transfers 三列快照（rev20）：换队分支覆盖合同行前，把效力/保护期/签约时刻快照进 transfer 行，
-- 买回原队时恢复（「当作人没走过」，§5.4 回原队）。列类型对齐 contracts（0028）：
-- service_ticks INTEGER / protection_ticks INTEGER（NULL=无保护期）/ signed_at TEXT。
-- 三列均可空 = 历史行与未走快照分支维持 NULL，不改旧读路径。
ALTER TABLE transfers ADD COLUMN src_service_ticks INTEGER;
ALTER TABLE transfers ADD COLUMN src_protection_ticks INTEGER;
ALTER TABLE transfers ADD COLUMN src_signed_at TEXT;
