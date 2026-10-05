-- v6.33.0 标价：转会名单公开标价（players.list_price）。
--
-- 语义（2026-10-05 用户裁决）：进转会名单必须给一个公开标价（1 ≤ 标价 ≤ 1.5×RC，与最低报价同区间），
-- 广告板/球员详情/报价列表只下发标价；最低报价转为全系统私密（拒线仍钉最低报价）。
-- 自动同意线 = 标价 ?? 最低报价：名单内用标价判达线，名单外（只有私密最低报价）回落最低报价（v6.4.0 语义不变）。
-- 标价 < 最低报价视为砍价区间（买方可见标价、不可见底线），必进人工谈判。
--
-- 回填：已挂牌且设过最低报价的球员，标价取现行最低报价（生产现仅 1 行：Bryan Mbeumo 18）。
-- 最低报价 min_offer_price 列保留原位（私密真源），公开面不再下发。
--
-- 回滚：ALTER TABLE 不便回滚，list_price 为附加列，保留不影响旧代码。
ALTER TABLE players ADD COLUMN list_price REAL;
UPDATE players SET list_price = min_offer_price
WHERE transfer_listed = 1 AND min_offer_price IS NOT NULL AND list_price IS NULL;
