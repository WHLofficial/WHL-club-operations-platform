-- 0005 · 出价冻结防双花闸（§16 并发测试约定，TECH_DESIGN §7.4）
-- D1 单写者 + batch 隐式事务：出价 batch 的第一条语句是 INSERT fund_holds，
-- 本触发器在同一事务内校验「挂牌仍在竞价 / 金额达到步长 / 可用资金足额」，
-- 任一不满足即 ABORT 回滚整批，杜绝「先冻结后校验」窗口期的双花与孤儿冻结。
-- 应用层仍先做可读校验；触发器是并发竞态下的最后防线（错误码 WHL_BID_REJECT_*）。
CREATE TRIGGER fund_holds_bid_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'listing'
BEGIN
  -- 挂牌必须处于 listed/bidding（待审、已下架、已成交的挂牌不再收新冻结）
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_CLOSED')
  WHERE (SELECT status FROM listings WHERE id = NEW.ref_id) NOT IN ('listed', 'bidding');

  -- 首笔出价 ≥ 挂牌价；抬价 ≥ 当前最高活跃出价 + 最小步长（config bid_step_min，缺省 1m）
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_AMOUNT')
  WHERE NEW.amount < COALESCE(
          (SELECT MAX(amount) + CAST(COALESCE((SELECT value FROM config WHERE key = 'bid_step_min'), '1') AS REAL)
           FROM bids WHERE listing_id = NEW.ref_id AND status = 'active'),
          (SELECT ask_price FROM listings WHERE id = NEW.ref_id)
        );

  -- 可用余额 = 账户余额 − 全部现行冻结 + 本人在这单上的现行冻结（抬价顶替，净差额校验）≥ 本次出价
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_FUNDS')
  WHERE (SELECT COALESCE(balance, 0) FROM ledger_accounts WHERE club_id = NEW.club_id)
          - (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = NEW.club_id AND status = 'held')
          + COALESCE(
              (SELECT amount FROM fund_holds
               WHERE club_id = NEW.club_id AND status = 'held' AND ref_type = 'listing' AND ref_id = NEW.ref_id),
              0
            )
          < NEW.amount;
END;
