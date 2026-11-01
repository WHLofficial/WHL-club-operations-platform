-- v6.67.0 一次性放开强制拍卖的新违约金（只读预检）
-- 三张 2026-11-01T13:00:17Z 同时成交的强制拍卖单：旧口径把 RC 定死成成交价，
-- 会话里落了 release_fee = 成交价 + expected_wage；新口径要它们回到「第一步 · 定违约金」。
-- 预检只看现状，不改任何东西。
SELECT s.id          AS session_id,
       s.transfer_id,
       s.status      AS session_status,
       s.release_fee,
       s.expected_wage,
       t.type,
       t.status      AS transfer_status,
       t.fee,
       t.from_club_id,
       t.to_club_id,
       p.id          AS player_id,
       p.name        AS player_name,
       (SELECT COUNT(*) FROM contracts c WHERE c.player_id = s.player_id AND c.is_active = 1) AS active_contracts
FROM negotiation_sessions s
JOIN transfers t ON t.id = s.transfer_id
JOIN players p ON p.id = s.player_id
WHERE s.transfer_id IN (139, 140, 141)
ORDER BY s.transfer_id;

-- 期望：3 行，session_status = 'active'、transfer_status = 'signing'、
--       release_fee = 28 / 15 / 10（= fee）、expected_wage = 4.66 / 2.73 / 2.27、active_contracts = 0
