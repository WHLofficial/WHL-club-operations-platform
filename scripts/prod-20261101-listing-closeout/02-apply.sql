-- v6.66.0 一次性数据修复 · 写入
-- 只动 listings 一个字段：把「联单已 completed」的 pending_review 挂单收成 delisted。
-- 不动 transfers / players / contracts / 账本 —— 那四张表在过户时已经是正确状态。
-- 关联键是 transfers.idempotency_key 的 listing:<id> 形态（transfers.ts listingIdFromTransfer）。
-- 执行前先跑 01-precheck.sql 记下命中行数（2026-11-01 生产预期 14 行）。
UPDATE listings
   SET status = 'delisted',
       deadline_note = '已成交（历史收口 2026-11-01）'
 WHERE status = 'pending_review'
   AND EXISTS (
     SELECT 1 FROM transfers t
      WHERE t.idempotency_key = 'listing:' || listings.id
        AND t.status = 'completed'
   );
