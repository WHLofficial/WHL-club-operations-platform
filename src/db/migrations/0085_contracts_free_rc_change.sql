-- v6.62.0：普通续约免费机会（规则 5.6，rev22 转正）。
-- 每份合同一次免费改违约金（RC）续约：free_rc_change_used = 0 时，下一张普通续约单（rc_change）
-- 自动走免费通道——提价免收差额 30%（审核侧跳过扣款）、不收口保护期（pending 写
-- protection_ticks_new = NULL = 该项不变）；关窗 apply 成功即置 1；降价同消耗；
-- 换队/买回新签时随 completeTransfer upsert 归 0（转会后刷新）；match 与闹涨薪不消耗。
-- 0079 的 contract_pending_changes.free_rc_change（DEFAULT 0，此前零写入）自本版启用为「当次是否免费」标记。
ALTER TABLE contracts ADD COLUMN free_rc_change_used INTEGER NOT NULL DEFAULT 0;

-- 回滚（机会是状态非资产，丢列只回到「已用」，可接受；历史 pending 的 free_rc_change 标记失真不影响资金）：
-- ALTER TABLE contracts DROP COLUMN free_rc_change_used;
