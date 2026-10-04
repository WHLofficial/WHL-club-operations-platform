-- 0063 · 关窗期报价与「意向单」（v6.29.0）
-- 关窗期也能报价 / 还价 / 同意：同意时不挂牌，改落一条 status='intent' 的意向单（season/window_seq
-- 为 NULL = 关窗期发起、尚未归窗）；开窗后由卖方确认，确认时把 season/window_seq 写回当前开着的窗，
-- 再走原有的「占用 → 挂牌 → 冻结转正 → 领先出价 → 兄弟单过期」链路。
--
-- 本迁移两件事（都走 SQLite 表重建 12 步，数据原样搬移、id 保留）：
--   ① offers：season / window_seq 放开为可空（status 注释补 intent、turn 注释补 intent 语义）；
--   ② offer_events：kind 注释补 intent / confirm 两个新取值（表结构不变，只为注释同源）。
-- 无外键指向这两张表、无视图依赖，故省去 PRAGMA foreign_keys 开关；但 0037 的
-- fund_holds_offer_guard 触发器引用 offers——SQLite 在 DROP TABLE 时会重解析全部触发器并以
-- 「no such table: main.offers」报错，所以必须先 DROP 该触发器，重建 offers 后再逐字复原。
-- 索引与 0037 逐字一致地重建（含 partial unique idx_offers_active_pair，依旧只覆盖 pending：
-- 同一买方可以同时持有一条 pending 与一条 intent，意向单的唯一性由服务层「球员级唯一」守卫保证）。
--
-- ⚠️ 部署核查：一次性写 ≈ offers 行数 + offer_events 行数（复制 + 删旧）；两表均为谈判量级小表。
-- 回滚：SQLite 无「收紧回 NOT NULL」的反向 DDL；如需回退，先把 season/window_seq IS NULL 的单子
-- 终态化（expired），再按 0037 的 DDL 原样重建两表。保留可空也与 0037 语义兼容。
DROP TRIGGER fund_holds_offer_guard;
CREATE TABLE offers_new (
  id             INTEGER PRIMARY KEY,
  player_id      INTEGER NOT NULL,
  buyer_club_id  INTEGER NOT NULL,
  seller_club_id INTEGER NOT NULL,
  amount         REAL NOT NULL,              -- 当前有效报价额（含最新一次还价）
  init_amount    REAL NOT NULL,              -- 首报价（展示用）
  round          INTEGER NOT NULL DEFAULT 0, -- 还价次数
  note           TEXT,                       -- 最近一条附言
  status         TEXT NOT NULL,              -- pending / intent / accepted / rejected / withdrawn / expired
  turn           TEXT NOT NULL,              -- buyer / seller：status='pending' 时轮到谁；intent 不看 turn（只有卖方能确认）
  hold_id        INTEGER,                    -- 冻结：fund_holds.ref_type='offer'（intent 期间保持 held）
  listing_id     INTEGER,                    -- 同意后生成的挂牌（intent 期为 NULL）
  season         INTEGER,                    -- NULL = 关窗期发起、尚未归窗
  window_seq     INTEGER,                    -- 同上；卖方开窗确认时写回当前窗口
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  resolved_at    TEXT
);
INSERT INTO offers_new (id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, note, status, turn, hold_id, listing_id, season, window_seq, created_at, updated_at, resolved_at)
SELECT id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, note, status, turn, hold_id, listing_id, season, window_seq, created_at, updated_at, resolved_at
FROM offers;
DROP TABLE offers;
ALTER TABLE offers_new RENAME TO offers;
CREATE INDEX idx_offers_seller ON offers (seller_club_id, status, updated_at);
CREATE INDEX idx_offers_buyer  ON offers (buyer_club_id, status, updated_at);
CREATE INDEX idx_offers_player ON offers (player_id, status);
-- 同一买方对同一球员只能有一条活跃报价（多买方并发不受限）
CREATE UNIQUE INDEX idx_offers_active_pair ON offers (player_id, buyer_club_id) WHERE status = 'pending';

CREATE TABLE offer_events_new (
  id            INTEGER PRIMARY KEY,
  offer_id      INTEGER NOT NULL,
  actor_club_id INTEGER,      -- NULL = 系统（过期 / 名单自动应答）
  kind          TEXT NOT NULL, -- open / counter / accept / reject / withdraw / expire / auto_accept / auto_reject / intent / confirm
  amount        REAL,
  note          TEXT,
  at            TEXT NOT NULL
);
INSERT INTO offer_events_new (id, offer_id, actor_club_id, kind, amount, note, at)
SELECT id, offer_id, actor_club_id, kind, amount, note, at FROM offer_events;
DROP TABLE offer_events;
ALTER TABLE offer_events_new RENAME TO offer_events;
CREATE INDEX idx_offer_events_offer ON offer_events (offer_id, id);

-- 复原 0037 的 offer 冻结防双花闸（与 0037 逐字一致；DROP TABLE 前被迫跟着拆掉）
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
