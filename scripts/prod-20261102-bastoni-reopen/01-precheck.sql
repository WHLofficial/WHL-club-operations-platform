-- 1860 重开 Bastoni 合同谈判：执行前只读核对（不改任何数据）。
-- 期望：session 78 是 settled、transfer 139 completed 且 terms_applied=1、
--       合同 545 仍是 28/4、窗口 open、球员在 33、快照为空。

SELECT '1. session / transfer' AS step,
       s.id AS session_id, s.status AS session_status, s.release_fee, s.expected_wage,
       s.attempt_count, s.settled_at, s.settled_wage, s.settle_source,
       t.id AS transfer_id, t.type, t.status AS transfer_status, t.fee, t.terms_applied,
       t.from_club_id, t.to_club_id,
       CASE WHEN t.pre_settle_snapshot IS NULL THEN 'NULL' ELSE 'present' END AS snapshot
  FROM negotiation_sessions s
  JOIN transfers t ON t.id = s.transfer_id
 WHERE s.id = 78 AND t.id = 139;

SELECT '2. 现行合同' AS step, c.id, c.club_id, c.release_fee, c.wage, c.contract_type,
       c.source, c.signed_at, c.service_ticks, c.protection_ticks, c.is_active
  FROM contracts c
 WHERE c.player_id = 43 AND c.is_active = 1;

SELECT '3. 球员归属' AS step, p.id, p.name, p.club_id, p.status
  FROM players p WHERE p.id = 43;

SELECT '4. 谈判历史条数' AS step, COUNT(*) AS attempts, MAX(attempt_no) AS max_attempt_no
  FROM negotiation_attempts WHERE session_id = 78;

SELECT '5. 转会窗' AS step, id, season, window_seq, status, opened_at
  FROM season_windows WHERE status = 'open';

SELECT '6. 这笔单的账' AS step, id, club_id, kind, amount, balance_after, created_at
  FROM ledger_entries WHERE ref_type = 'transfer' AND ref_id = 139 ORDER BY id;
