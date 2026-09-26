-- 0040 · 竞价截止绝对时刻化 + 激活通知证据（v6.4.0，改动 A / 改动 4）
-- ① deadline_at：出价成功即按 bidDeadline() 公式落库的绝对截止时刻（用户裁决 2026-09-25：
--    「截止的语义就是经计算后的绝对时刻，不容 5 分钟差错」）。此前截止只在读路径实时计算，
--    展示与结算之间最多漂移一个刷新周期。NULL = 未进竞价 / 存量行：读路径与惰性结算
--    两级判定（先读列、NULL 回落实时算，兼容存量），出价推进时写列。
--    触发器 fund_holds_bid_deadline_guard 挂在冻结语句上原子拦过线出价（WHL_BID_REJECT_DEADLINE），
--    与 0005 同形同层级：预检给可读 409，触发器是并发竞态下的最后防线。
-- ② activation_proof：激活方上传的 QQ 通知截图（R2 key，activation/ 前缀）。
--    证据制（用户裁决）：激活方须在激活时证明已在 QQ 给被激活方发了激活通知。
ALTER TABLE listings ADD COLUMN deadline_at TEXT;
ALTER TABLE listings ADD COLUMN activation_proof TEXT;

CREATE TRIGGER fund_holds_bid_deadline_guard
BEFORE INSERT ON fund_holds
WHEN NEW.status = 'held' AND NEW.ref_type = 'listing'
BEGIN
  SELECT RAISE(ABORT, 'WHL_BID_REJECT_DEADLINE')
  WHERE (SELECT deadline_at FROM listings WHERE id = NEW.ref_id) IS NOT NULL
    AND (SELECT deadline_at FROM listings WHERE id = NEW.ref_id) <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
