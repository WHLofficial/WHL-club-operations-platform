-- v6.51.0 品牌池扩编：品牌名统一为中文（CVS Health → 西维斯健康）+ 新增 9 家中文品牌（v6.8.0 建池后首次加料）。
-- 生产改名影响面实测为零：naming_contracts 0 行、market_offers 走 brand_id（0055 唯一索引），
-- 故只需兜底更新合同表的 brand 文本（新库/历史数据同样收敛）。
-- 新品牌热度全部落在既有校准口径内：仅 极星运动 0.95 / 鲸涛饮品 0.91 ≥ emergingHeatFloor(0.9) 记「新兴」，
-- 其余 < 0.9 记「口碑」；头部（亚马逊 1.3 / 麒麟生物 1.2 / 阿迪达斯 1.1）不动 ⇒ 档位校准与名额口径零变化。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069/0070 约定）。
-- 回滚：UPDATE brand_pool SET brand = 'CVS Health' WHERE brand = '西维斯健康';
--       UPDATE naming_contracts SET brand = 'CVS Health' WHERE brand = '西维斯健康';
--       DELETE FROM brand_pool WHERE brand IN ('青云乳业','长风汽车','白马体育','极星运动','天工重工','鲸涛饮品','磐石银行','迅达通讯','星野文旅');

-- 中文名统一（幂等：已是中文名时不命中；冠名合同表兜底同步）
UPDATE brand_pool SET brand = '西维斯健康' WHERE brand = 'CVS Health';
UPDATE naming_contracts SET brand = '西维斯健康' WHERE brand = 'CVS Health';

-- 新增 9 家：tier 直接写校准后的档位（不等下次重算），heat 在 clamp 0.5~1.5 内；
-- source='builtin' = 随代码入库的池内容（区别于管理端新增的 custom）。
INSERT OR IGNORE INTO brand_pool (brand, heat, source, status, industry, tier, created_at) VALUES
  ('青云乳业', 0.82, 'builtin', 'adopted', '饮食', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('长风汽车', 0.88, 'builtin', 'adopted', '汽车', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('白马体育', 0.86, 'builtin', 'adopted', '运动', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('极星运动', 0.95, 'builtin', 'adopted', '运动', '新兴', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('天工重工', 0.74, 'builtin', 'adopted', '制造', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('鲸涛饮品', 0.91, 'builtin', 'adopted', '饮食', '新兴', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('磐石银行', 0.79, 'builtin', 'adopted', '金融', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('迅达通讯', 0.84, 'builtin', 'adopted', '科技', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('星野文旅', 0.68, 'builtin', 'adopted', '文旅', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
