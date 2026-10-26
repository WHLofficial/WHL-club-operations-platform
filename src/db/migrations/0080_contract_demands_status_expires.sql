-- 0080_contract_demands_status_expires.sql · v6.54.0 闹涨薪 cron 扫描索引
-- 评审修复（P1 · D1 读量）：0079 只建了 (club_id, status, expires_at) 与 (player_id, season,
-- window_seq)（0079_renewal_demand.sql:43-46），expireDemands 的两条 cron 扫描（每 5 分钟
-- tick 各一次）——due：WHERE status IN ('pending','countered') AND expires_at <= ?；
-- remindable：同前 + reminded_at = '' AND expires_at 区间——都无前导列可用，EXPLAIN 实测
-- 『SCAN d』全表扫。contract_demands 终局行永不删、每季 ≈1000 行，按最坏情况全量口径
-- 三季 ~3000 行时 ≈ 288 tick/日 × 2 × 3000 ≈ 1.7M 行/日，单表吃掉免费档 5M/日三分之一以上
-- 且线性增长。补 (status, expires_at)：两条查询共用（reminded_at 选择性差，不进索引键、
-- 走回表过滤），对齐事件域 0048 的 (status, deadline_at) 先例。只读扫描零写放大顾虑：
-- 索引建一次 ≈ 当年 contract_demands 总行数的写额度，量级千行。
-- 回滚：DROP INDEX idx_contract_demands_status_expires;

CREATE INDEX idx_contract_demands_status_expires
  ON contract_demands (status, expires_at);
