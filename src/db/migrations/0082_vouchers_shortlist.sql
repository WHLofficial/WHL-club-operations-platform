-- 0082 · 候选名单 + 消费券（v6.58.0）
--
-- 消费券 = 既有「建设券」（stadiums.build_credit，只能抵球场建设）升格为俱乐部级券余额：
--   ledger_accounts.vouchers 存余额，voucher_entries 存流水（与 ledger_entries 同构，
--   balance_after 逐行可复算）；抵扣范围扩到「建设支出 + 消费中心工单」。
--   stadiums.build_credit 列**保留但弃用**（不 DROP，下批清理）；存量搬运见 0083
--   （幂等数据迁移，与本文件分开是为了让「重放搬运不重复入账」可独立测）。
-- 候选名单 = FM shortlist：俱乐部私有的球员跟踪名单，UNIQUE(club_id, player_id) 兼做重复闸。
--
-- 回滚：DROP TABLE player_shortlist / voucher_entries；
--       ALTER TABLE ledger_accounts DROP COLUMN vouchers；ALTER TABLE shop_orders DROP COLUMN voucher_used。
--       回滚前须先把 vouchers 余额反向搬回 stadiums.build_credit（本文件不含回滚数据脚本）。
ALTER TABLE ledger_accounts ADD COLUMN vouchers REAL NOT NULL DEFAULT 0;

-- 工单里的券抵额：amount 仍是锁定总价，实付现金 = amount − voucher_used（老单默认 0 天然兼容）
ALTER TABLE shop_orders ADD COLUMN voucher_used REAL NOT NULL DEFAULT 0;

CREATE TABLE voucher_entries (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  kind TEXT NOT NULL,                -- migrate / build_refund / build_use / shop_use / shop_refund / admin_grant / event_grant
  amount REAL NOT NULL,              -- 正=入账 负=出账（与 ledger_entries 同口径）
  balance_after REAL NOT NULL,       -- 防错账：按 (club, id) 顺序可复算
  ref_type TEXT,
  ref_id INTEGER,
  memo TEXT,
  created_at TEXT
);

-- 券流水翻页（新→旧）与逐俱乐部对账（SUM(amount)）共用
CREATE INDEX idx_voucher_entries_club ON voucher_entries (club_id, id);

CREATE TABLE player_shortlist (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  player_id INTEGER NOT NULL REFERENCES players(id), -- players.id 内部 id
  note TEXT,
  added_by INTEGER,                                  -- 添加人用户 id（审计展示用，可空）
  created_at TEXT NOT NULL,
  UNIQUE (club_id, player_id)
);

-- 名单列表按加入时间倒序；UNIQUE 索引前缀只能服务 club_id，排序要单建
CREATE INDEX idx_player_shortlist_club ON player_shortlist (club_id, id DESC);
