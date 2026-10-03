-- 0059 · 首价窗冻结闸门（v6.24.0 转会市场改版批次 A）
-- 缘起：激活挂牌进入首价窗后，激活方的首价冻结仍走 fund_holds 插入。出价处理器的过线预检
-- 与 settleOverdue 的 voidExpiredActivation 之间存在竞态：预检通过后、冻结落库前，
-- 首价窗若被判定过期，挂牌已被 void（delisted），冻结会挂到一个已作废的挂牌上。
-- 0040 的 fund_holds_bid_deadline_guard 只认 deadline_at（激活首价窗内该列为 NULL），
-- 故重建该触发器，追加 activation_deadline 过线分支：激活首价窗已过线的冻结一律 ABORT，
-- 与处理器预检同码（WHL_BID_REJECT_DEADLINE）——预检给可读 409，触发器是并发竞态下的最后防线。
-- 注：D1 迁移文件内不使用 BEGIN/COMMIT（迁移执行器自行包事务）。
DROP TRIGGER fund_holds_bid_deadline_guard;

CREATE TRIGGER fund_holds_bid_deadline_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'listing'
BEGIN
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_DEADLINE')
  WHERE (
      (SELECT deadline_at FROM listings WHERE id = NEW.ref_id) IS NOT NULL
      AND (SELECT deadline_at FROM listings WHERE id = NEW.ref_id) <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    OR (
      (SELECT activation_deadline FROM listings WHERE id = NEW.ref_id) IS NOT NULL
      AND (SELECT activated_by FROM listings WHERE id = NEW.ref_id) IS NOT NULL
      AND (SELECT activation_deadline FROM listings WHERE id = NEW.ref_id) <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
END;
