-- 0054_brand_tiers.sql · v6.13.0 C2 品牌档位性格
-- brand_pool 加 tier（三档：头部/新兴/口碑，性格参数见 config market_tier_profiles）
-- 与 tier_locked（管理端锁档；锁定=1 的品牌跳过关窗批自动校准，改档即生效、合同不存档位副本）。
-- 种子按自动校准同规则预设初始档位：热度降序前 ceil(20/8)=3 且 heat≥1.0 → 头部；
-- heat≥0.9 → 新兴；其余口碑 ⇒ 亚马逊 1.3 / 麒麟生物 1.2 / 阿迪达斯 1.1 → 头部，
-- 可口可乐 1.0 / 海底捞 0.9 → 新兴，星海通讯 0.8 / CVS Health 0.7 → 口碑。
-- 自定义品牌默认 '口碑'，下一个关窗批自动校准接管。
-- 回滚：ALTER TABLE 不可回滚，SQLite 3.35+ 可 DROP COLUMN;
ALTER TABLE brand_pool ADD COLUMN tier TEXT NOT NULL DEFAULT '口碑' CHECK (tier IN ('头部', '新兴', '口碑'));
ALTER TABLE brand_pool ADD COLUMN tier_locked INTEGER NOT NULL DEFAULT 0;

UPDATE brand_pool SET tier = '头部' WHERE brand IN ('亚马逊', '麒麟生物', '阿迪达斯');
UPDATE brand_pool SET tier = '新兴' WHERE brand IN ('可口可乐', '海底捞');
