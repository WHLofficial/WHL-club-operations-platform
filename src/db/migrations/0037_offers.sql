-- 0037 · 报价 / 议价子系统（v6.3.0，设计见记忆 design-v6.3.0-offer-negotiation.md）
-- ① 球员级三个标记（报价设置）：转会名单 / 最低报价 / 非卖品（互斥：置其一时自动清另一个）
-- ② offers 报价单（多个买方可同时对同一球员报价，谁先被同意谁成交，其余转 expired）
-- ③ offer_events 谈判桌事件流（列表不拉 events，点开详情才读）
-- ④ fund_holds_offer_guard：offer 冻结的最后一道闸，与 0005_market_bid_guard 同形同层级
ALTER TABLE players ADD COLUMN transfer_listed INTEGER NOT NULL DEFAULT 0;  -- 转会名单（公开「欢迎来谈」）
ALTER TABLE players ADD COLUMN min_offer_price REAL;                        -- 最低报价（进名单必填，1 ≤ 价 ≤ 1.5×RC）
ALTER TABLE players ADD COLUMN not_for_sale INTEGER NOT NULL DEFAULT 0;     -- 非卖品（一切报价自动拒）

CREATE TABLE offers (
  id             INTEGER PRIMARY KEY,
  player_id      INTEGER NOT NULL,
  buyer_club_id  INTEGER NOT NULL,
  seller_club_id INTEGER NOT NULL,
  amount         REAL NOT NULL,              -- 当前有效报价额（含最新一次还价）
  init_amount    REAL NOT NULL,              -- 首报价（展示用）
  round          INTEGER NOT NULL DEFAULT 0, -- 还价次数
  note           TEXT,                       -- 最近一条附言
  status         TEXT NOT NULL,              -- pending / accepted / rejected / withdrawn / expired
  turn           TEXT NOT NULL,              -- buyer / seller：status='pending' 时轮到谁
  hold_id        INTEGER,                    -- 冻结：fund_holds.ref_type='offer'
  listing_id     INTEGER,                    -- 同意后生成的挂牌
  season         INTEGER NOT NULL,
  window_seq     INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  resolved_at    TEXT
);
CREATE INDEX idx_offers_seller ON offers (seller_club_id, status, updated_at);
CREATE INDEX idx_offers_buyer  ON offers (buyer_club_id, status, updated_at);
CREATE INDEX idx_offers_player ON offers (player_id, status);
-- 同一买方对同一球员只能有一条活跃报价（多买方并发不受限）
CREATE UNIQUE INDEX idx_offers_active_pair ON offers (player_id, buyer_club_id) WHERE status = 'pending';

CREATE TABLE offer_events (
  id            INTEGER PRIMARY KEY,
  offer_id      INTEGER NOT NULL,
  actor_club_id INTEGER,      -- NULL = 系统（过期 / 名单自动应答）
  kind          TEXT NOT NULL, -- open / counter / accept / reject / withdraw / expire / auto_accept / auto_reject
  amount        REAL,
  note          TEXT,
  at            TEXT NOT NULL
);
CREATE INDEX idx_offer_events_offer ON offer_events (offer_id, id);

-- offer 冻结防双花闸（与 0005 逐字同形：触发器是并发竞态下的最后防线，错误码 WHL_OFFER_REJECT_*）；
-- 服务层预检给可读报错，这里兜底「offer 仍 pending / 冻结额与报价单一致 / 可用资金足额」
CREATE TRIGGER fund_holds_offer_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'offer'
BEGIN
  -- 报价必须仍处于 pending（同意/拒绝/撤回/过期后不再收新冻结；offer 不存在同样拦截）
  SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_CLOSED')
  WHERE IFNULL((SELECT status FROM offers WHERE id = NEW.ref_id), '') != 'pending';

  -- 冻结额必须等于报价单当前有效报价额（防串账：还价后旧额的冻结落不进来）
  SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_AMOUNT')
  WHERE NEW.amount != (SELECT amount FROM offers WHERE id = NEW.ref_id);

  -- 可用余额 = 账户余额 − 全部现行冻结 + 本人在这条报价上的现行冻结（还价顶替，净差额校验）≥ 冻结额
  SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_FUNDS')
  WHERE (SELECT COALESCE(balance, 0) FROM ledger_accounts WHERE club_id = NEW.club_id)
          - (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = NEW.club_id AND status = 'held')
          + COALESCE(
              (SELECT amount FROM fund_holds
               WHERE club_id = NEW.club_id AND status = 'held' AND ref_type = 'offer' AND ref_id = NEW.ref_id),
              0
            )
          < NEW.amount;
END;
