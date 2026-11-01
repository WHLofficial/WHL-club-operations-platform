-- v6.66.0 一次性数据修复 · 只读预检
-- 背景：挂牌截止把挂单写成 pending_review（market-settle.ts 设计如此），但成交路径从不回写 listings，
-- 于是「球员已过户、钱已划转」的挂单永久钉在 pending_review。findInFlight 把它当「还在市场流程里」，
-- 这些球员的续约/解约/海捞/上调全被 400 一票否决。
-- 先看一眼总数与逐条明细，再跑 02-apply.sql。
SELECT COUNT(*) AS pending_review_total FROM listings WHERE status = 'pending_review';

SELECT l.id AS listing_id,
       l.player_id,
       p.name AS player_name,
       p.club_id AS player_now_club,
       c.name AS player_now_club_name,
       l.seller_club_id,
       t.id AS transfer_id,
       t.status AS transfer_status,
       t.completed_at,
       l.deadline_at
  FROM listings l
  LEFT JOIN transfers t ON t.idempotency_key = 'listing:' || l.id
  LEFT JOIN players p ON p.id = l.player_id
  LEFT JOIN clubs c ON c.id = p.club_id
 WHERE l.status = 'pending_review'
 ORDER BY l.id;

-- 只应修「联单已 completed」的那些；signing 的等它们按新路径自己收口（不得手工改）
SELECT SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS fixable_completed,
       SUM(CASE WHEN t.status = 'signing' THEN 1 ELSE 0 END) AS wait_signing,
       SUM(CASE WHEN t.id IS NULL THEN 1 ELSE 0 END) AS orphan_no_transfer
  FROM listings l
  LEFT JOIN transfers t ON t.idempotency_key = 'listing:' || l.id
 WHERE l.status = 'pending_review';
