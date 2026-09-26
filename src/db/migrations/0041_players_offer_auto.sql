-- 0041 · 报价设置与转会名单解耦（v6.4.0，改动 B）
-- offer_auto：达线自动同意开关（用户裁决 2026-09-25：「没进转会名单的应该也可以设置
-- 最低报价和是否自动应答」「低于线都按自动拒绝」）。语义：设了 min_offer_price 即生效——
-- 低于线一律自动拒（与开关无关）；≥ 线且 offer_auto=1 才自动同意，否则进人工谈判。
-- 开关与最低报价都不再要求先进转会名单；进名单仍必须给最低报价（原有校验不变）。
ALTER TABLE players ADD COLUMN offer_auto INTEGER NOT NULL DEFAULT 0;
