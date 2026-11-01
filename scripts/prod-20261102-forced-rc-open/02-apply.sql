-- v6.67.0 一次性放开强制拍卖的新违约金（写操作，需单独授权）
-- 只清 expected_wage：release_fee 留着当第一步的预填值。
-- 判据必须与前端一致（src/worker 里也不清 release_fee）：
--   1) 会话还在 active；
--   2) 联单确实是 forced_auction；
--   3) expected_wage 本来有值（幂等：跑第二遍影响 0 行）。
-- 不能清 release_fee：settleActiveSession 的兜底是 session.release_fee ?? TRAINEE_RELEASE_FEE，
-- 清成 NULL 会在关窗强制结算时被落成 5m。
UPDATE negotiation_sessions
   SET expected_wage = NULL
 WHERE status = 'active'
   AND expected_wage IS NOT NULL
   AND transfer_id IN (SELECT id FROM transfers WHERE type = 'forced_auction')
   AND transfer_id IN (139, 140, 141);
