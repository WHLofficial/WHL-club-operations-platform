-- v6.50.0 海捞两阶段·暗标段（设计见 memory/design-sea-two-phase.md）
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069 约定）。
--
-- 段制：每个转会窗最多一个暗标批次（UNIQUE(season, window_seq)）。开窗后暗标段由时刻表
-- transfer_sea_sealed 行界定；批次在「暗标段首次被访问」时惰性创建（deadline = 该行解析出的终点），
-- 关窗时批次仍是 sealed ⇒ 由关窗流程立即开标（不阻塞关窗）。
-- 明标段零新增机制：仍是 POST /api/transfers/free-agent（闸 transfer_sea_open）。
CREATE TABLE IF NOT EXISTS sea_batches (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sealed', -- sealed 收标中 | settling 开标中（claim 防并发）| opened 已开标 | cancelled 已取消
  sealed_at TEXT,                        -- 暗标段开始（批次创建时刻）
  deadline_at TEXT NOT NULL,             -- 统一截止（时刻表终点解析值，UTC ISO）
  reminded_at TEXT NOT NULL DEFAULT '',  -- 截止前 24h 提醒（批次级抢占，一窗只发一次）
  opened_at TEXT,
  opened_by INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sea_batches_window ON sea_batches(season, window_seq);
-- 到期扫描只看收标中的批次（cron 每 5 分钟一跳）
CREATE INDEX IF NOT EXISTS idx_sea_batches_due ON sea_batches(status, deadline_at);

-- 密封标：一份标 = 一支球队对一个球员的一次出价（同球员同队限一份）。
-- 金额与出标方保密（只有出标方自己与管理组可见）；截止前可改（替换刷新冻结）可撤（解冻）。
CREATE TABLE IF NOT EXISTS sea_sealed_bids (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  new_release_fee INTEGER NOT NULL,
  hold_id INTEGER,                       -- fund_holds.id（ref_type='sea_sealed'，ref_id=本表 id）
  status TEXT NOT NULL DEFAULT 'sealed', -- sealed 收标中 | won 开标胜出 | lost 未胜出 | void 作废 | withdrawn 已撤回
  submitted_at TEXT,
  updated_at TEXT,
  resolved_at TEXT,
  void_reason TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sea_sealed_bids_pair ON sea_sealed_bids(batch_id, player_id, club_id);
CREATE INDEX IF NOT EXISTS idx_sea_sealed_bids_batch ON sea_sealed_bids(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_sea_sealed_bids_player ON sea_sealed_bids(player_id, status);

-- 冻结守卫（与 0005_market_bid_guard / 0037_offers 同形）：
-- ① 只有还收着标的批次能冻结（开标/作废后一律拒绝）② 金额必须 = 新违约金 × 30%（= 签入费，
-- 与 core/bypass-rules.ts 的 freeAgentFee 同口径，故 SQL 侧直接 ROUND(x*0.3, 2)）
-- ③ 可用余额（balance − 在途冻结）＋ 本标已有冻结的加回 ≥ 本次冻结额。
CREATE TRIGGER IF NOT EXISTS fund_holds_sea_sealed_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'sea_sealed'
BEGIN
  SELECT RAISE(ABORT, 'WHL_SEA_REJECT_CLOSED')
  WHERE (SELECT b.status FROM sea_batches b JOIN sea_sealed_bids s ON s.batch_id = b.id WHERE s.id = NEW.ref_id) != 'sealed';

  SELECT RAISE(ABORT, 'WHL_SEA_REJECT_AMOUNT')
  WHERE NEW.amount != ROUND((SELECT new_release_fee FROM sea_sealed_bids WHERE id = NEW.ref_id) * 0.3, 2);

  SELECT RAISE(ABORT, 'WHL_SEA_REJECT_FUNDS')
  WHERE (SELECT COALESCE(balance, 0) FROM ledger_accounts WHERE club_id = NEW.club_id)
          - (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = NEW.club_id AND status = 'held')
          + COALESCE(
              (SELECT amount FROM fund_holds
               WHERE club_id = NEW.club_id AND status = 'held' AND ref_type = 'sea_sealed' AND ref_id = NEW.ref_id),
              0
            )
          < NEW.amount;
END;

-- 密封标胜出单的回链：开标时建的海捞单记住自己从哪份标来（解冻与公示都靠它）。
ALTER TABLE transfers ADD COLUMN sealed_bid_id INTEGER;

-- 一份密封标最多只能长出一张单：开标里是「先查既存单再建单」的自愈逻辑，并发双开标时
-- 唯一索引是最后一道保险（NULL 不参与唯一性，普通海捞/挂牌单不受影响）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_sealed_bid ON transfers(sealed_bid_id) WHERE sealed_bid_id IS NOT NULL;

-- 冻结不长期占用（设计 §7 资金守恒）：胜出单一旦走到终态就自动放掉还挂着的冻结，
-- 并把那份标标成作废——不依赖某条业务分支记得解冻，任何终态写法都覆盖得到。
-- （审核扣费时冻结已由 chargeBypassFee 在同一个批里转成 settled；此处是兜底。）
CREATE TRIGGER IF NOT EXISTS transfers_sea_sealed_release
AFTER UPDATE OF status ON transfers
WHEN NEW.sealed_bid_id IS NOT NULL AND NEW.status IN ('rejected', 'completed')
BEGIN
  UPDATE fund_holds
     SET status = CASE WHEN NEW.status = 'completed' THEN 'settled' ELSE 'released' END
   WHERE status = 'held' AND ref_type = 'sea_sealed' AND ref_id = NEW.sealed_bid_id;

  UPDATE sea_sealed_bids
     SET status = 'void',
         void_reason = '单据未成约',
         resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = NEW.sealed_bid_id AND status = 'won' AND NEW.status = 'rejected';
END;
