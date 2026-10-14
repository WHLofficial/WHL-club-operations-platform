-- v6.49.0 运营时刻表 + 统一到期引擎（设计见 memory/design-ops-schedule-expiry.md）
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059 约定）。
--
-- ① ops_schedule：每一种转会操作 + 消费中心各一行。锚默认 none ⇒ 行为与上线前逐条一致
--    （闸门只保留现有窗口检查）；运营在管理端「运营时刻表」页填了才生效。
--    锚只两种取值：随窗（window_open / window_close）或具体时间（absolute），不做「开窗 + N 小时」偏移。
CREATE TABLE IF NOT EXISTS ops_schedule (
  op_key TEXT PRIMARY KEY,
  start_anchor TEXT NOT NULL DEFAULT 'none',  -- none | window_open | absolute
  start_at TEXT,                              -- start_anchor='absolute' 时的 UTC ISO（北京时间输入换算）
  end_anchor TEXT NOT NULL DEFAULT 'none',    -- none | window_close | absolute
  end_at TEXT,
  requires_window INTEGER NOT NULL DEFAULT 1, -- 是否仍受现有窗口闸门约束（1=是；报价/谈判为 0，对齐 v6.29.0）
  close_inflight INTEGER NOT NULL DEFAULT 1,  -- 终点到点是否由到期引擎收口在途物（0=只关新操作）
  note TEXT NOT NULL DEFAULT '',
  updated_by INTEGER,
  updated_at TEXT
);

INSERT OR IGNORE INTO ops_schedule (op_key, requires_window) VALUES
  ('transfer_listing', 1),
  ('transfer_offer', 0),
  ('transfer_negotiation', 0),
  ('transfer_sea_sealed', 1),
  ('transfer_sea_open', 1),
  ('transfer_activation', 1),
  ('transfer_match', 1),
  ('transfer_termination', 1),
  ('transfer_rc_change', 1),
  ('transfer_forced_auction', 1),
  ('consumption', 1);

-- ② 到期锚与提醒（v6.49.0 引擎适配器①②，长在 offers / negotiation_sessions 上）：
--    expiry_anchor_at 空 = 存量行未标；首次扫描按 now 回填（存量宽限：上线不批量误杀存量单据）。
--    有效期锚 = MAX(expiry_anchor_at, updated_at)（报价回合）/ MAX(expiry_anchor_at, created_at, 末次出价)（谈判静默）。
ALTER TABLE offers ADD COLUMN expiry_anchor_at TEXT NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN reminded_at TEXT NOT NULL DEFAULT '';
ALTER TABLE negotiation_sessions ADD COLUMN expiry_anchor_at TEXT NOT NULL DEFAULT '';
ALTER TABLE negotiation_sessions ADD COLUMN reminded_at TEXT NOT NULL DEFAULT '';

-- ③ 扫描索引（cron 每 5 分钟一跳；两表都只扫活跃行）
--    报价只收口 pending：intent（关窗期意向单）按 v6.29.0 不设时限、跨窗存活。
CREATE INDEX IF NOT EXISTS idx_offers_expiry ON offers(updated_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_negotiation_sessions_active ON negotiation_sessions(status, created_at);
