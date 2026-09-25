-- v2.1.0：单挂牌暂停出价开关（管理端干预工具）
-- 语义：bid_paused=1 时该挂牌拒绝新出价（423），已出的价、到期结算、管理干预均不受影响；
-- 只对 listed/bidding 状态有意义，结算后的状态行该值不再被读。
ALTER TABLE listings ADD COLUMN bid_paused INTEGER NOT NULL DEFAULT 0;
