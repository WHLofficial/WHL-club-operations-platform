-- 过户提前到审核通过（v6.66.0 第 3 期）：单据一旦 completed 就代表「钱已付、人已走」，
-- 之后的签约谈判只落合同条款，不再改归属。四列都挂在 transfers 上：
--   pre_settle_snapshot  过户前的合同/球员快照（JSON），撤销与 B 分支买回的物理面取值来源
--   terms_applied        条款是否已落（会话 settled 后由 applyContractTerms 置 1，幂等闸）
--   reverted_at / revert_reason  撤销留痕（管理组特权动作，理由必填）
ALTER TABLE transfers ADD COLUMN pre_settle_snapshot TEXT;
ALTER TABLE transfers ADD COLUMN terms_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transfers ADD COLUMN reverted_at TEXT;
ALTER TABLE transfers ADD COLUMN revert_reason TEXT;

-- 撤销是管理组动作，量极小；按球员回查「此后没有新成交」时走这条索引。
CREATE INDEX IF NOT EXISTS idx_transfers_player_status ON transfers(player_id, status);
