-- v6.68.2（审核工作台 期 C）：活跃出价查询要按 status 过滤。
-- 生产 bids 现网仅百余行（active 19），加索引不是为了当下，而是把「每次打开工作台都全表物化」
-- 变成命中行——工作台是运营高频页，且 Q9-B 裁决明确要指数。
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids (status);
