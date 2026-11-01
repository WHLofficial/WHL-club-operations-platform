-- v6.66.0 一次性数据修复 · 回读
-- 期望：fixable_completed = 0（全部收口）；wait_signing 保持原数（等它们按新路径成交）；
-- 且没有任何一个球员还被 pending_review 挂单挡在 findInFlight 里。
SELECT COUNT(*) AS pending_review_left FROM listings WHERE status = 'pending_review';

SELECT COUNT(*) AS still_blocking
  FROM listings l
  JOIN transfers t ON t.idempotency_key = 'listing:' || l.id
 WHERE l.status = 'pending_review'
   AND t.status = 'completed';

-- 抽查修复行：status 必须是 delisted，note 带「历史收口」，且球员归属早已在买方
SELECT l.id AS listing_id, l.status, l.deadline_note, l.player_id, p.club_id AS player_club, t.status AS transfer_status
  FROM listings l
  LEFT JOIN players p ON p.id = l.player_id
  LEFT JOIN transfers t ON t.idempotency_key = 'listing:' || l.id
 WHERE l.deadline_note = '已成交（历史收口 2026-11-01）'
 ORDER BY l.id;
