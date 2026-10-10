-- v6.40.2 结算扫描索引：把「整轮惰性结算」里几条固定扫描从全表扫变成索引扫。
--
-- 语义：只加索引，不动表结构、不动任何判定公式。背景——整轮结算要跑十几条 D1 语句，生产实测
-- 每条约 220ms（Worker 与 D1 主库不同区），往返条数就是延迟主导项；本迁移让其中四条扫描按
-- (等值列…, 范围列) 走索引，且扫不到行时几乎不读数据页。
-- 对应查询（`src/worker/offers.ts` 的 expireStaleOffers 两扫 / `src/worker/market-settle.ts` 三段扫描）：
--   ① offers   WHERE status = 'accepted' AND listing_id IS NULL ORDER BY id LIMIT 50
--   ② offers   WHERE status IN ('pending','intent') ORDER BY id LIMIT 200
--   ③ listings WHERE type = 'activation' AND status = 'listed'          AND activation_deadline < ? ORDER BY id
--   ④ listings WHERE type = 'activation' AND status = 'matched_pending' AND match_deadline      < ? ORDER BY id
-- ③④ 的列序取 (等值列…, 范围列)：先把 status/type 两列定死，再在 deadline 上做范围 seek。
--
-- 回填：无（纯索引，不写数据）。
-- 回滚：DROP INDEX 三条即可——行为与索引前逐字一致，只是退化成全表扫。
CREATE INDEX idx_offers_status_id ON offers(status, id);
CREATE INDEX idx_listings_status_type_activation_deadline ON listings(status, type, activation_deadline);
CREATE INDEX idx_listings_status_type_match_deadline ON listings(status, type, match_deadline);
