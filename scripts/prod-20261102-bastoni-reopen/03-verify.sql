-- 1860 重开 Bastoni 合同谈判：执行后只读回读。
-- 期望：
--   session 78 status=active / release_fee=28（预填）/ expected_wage=NULL / settled_at=NULL
--   transfer 139 terms_applied=0 / pre_settle_snapshot 非空
--   合同 545 未被改动（仍是 28 / 4 / is_active=1）
--   其它在途会话数量不变（本脚本只碰 id 78）

SELECT '1. session 78' AS step,
       id, status, release_fee, expected_wage, attempt_count, settled_at, settled_wage, settle_source, expiry_anchor_at
  FROM negotiation_sessions WHERE id = 78;

SELECT '2. transfer 139' AS step,
       id, type, status, fee, terms_applied, pre_settle_snapshot
  FROM transfers WHERE id = 139;

SELECT '3. 合同 545 未动' AS step,
       id, player_id, club_id, release_fee, wage, is_active, signed_at
  FROM contracts WHERE player_id = 43 AND is_active = 1;

SELECT '4. 球员 43 归属未动' AS step, id, name, club_id, status
  FROM players WHERE id = 43;

SELECT '5. 全站在途会话（应与执行前一致，仅 78 从 settled 变 active）' AS step,
       COUNT(*) AS active_sessions
  FROM negotiation_sessions WHERE status = 'active';

SELECT '6. attempt_count 与历史条数（新报价应拿到 attempt_no=2）' AS step,
       (SELECT attempt_count FROM negotiation_sessions WHERE id = 78) AS attempt_count,
       (SELECT COUNT(*) FROM negotiation_attempts WHERE session_id = 78) AS attempts;
