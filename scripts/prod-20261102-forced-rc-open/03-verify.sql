-- v6.67.0 一次性放开强制拍卖的新违约金（回读）
-- 期望：三单 expected_wage 全为 NULL、release_fee 保持 28 / 15 / 10、会话仍 active。
SELECT s.id AS session_id, s.transfer_id, s.status, s.release_fee, s.expected_wage
FROM negotiation_sessions s
WHERE s.transfer_id IN (139, 140, 141)
ORDER BY s.transfer_id;

-- 不该被误伤：其它在途会话的 expected_wage 一条都不许变
SELECT COUNT(*) AS other_active_with_e
FROM negotiation_sessions
WHERE status = 'active' AND expected_wage IS NOT NULL AND transfer_id NOT IN (139, 140, 141);
