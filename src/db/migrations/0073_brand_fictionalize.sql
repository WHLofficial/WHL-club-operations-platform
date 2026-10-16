-- 品牌池全虚构化 + 欧洲化：既有 16 家中 12 家改欧式造词名，保留 4 家中资（长风汽车/白马体育/青云乳业/星海通讯）；
-- 新增 12 家（10 家欧式 + 2 家中资：精卫重工/霜降茶业）⇒ 池 16 → 28，全池 22 欧式 + 6 中资。
-- 热度/行业/档位全不动 ⇒ 档位校准、名额、行业系数零变化。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069/0070/0071 约定）。
UPDATE brand_pool SET brand = '奥维恩'     WHERE brand = '亚马逊';
UPDATE brand_pool SET brand = '凯利昂生物' WHERE brand = '麒麟生物';
UPDATE brand_pool SET brand = '维洛'       WHERE brand = '阿迪达斯';
UPDATE brand_pool SET brand = '斯科尔汽水' WHERE brand = '可口可乐';
UPDATE brand_pool SET brand = '洛森餐饮'   WHERE brand = '海底捞';
UPDATE brand_pool SET brand = '诺迪运动'   WHERE brand = '极星运动';
UPDATE brand_pool SET brand = '维奥莱饮品' WHERE brand = '鲸涛饮品';
UPDATE brand_pool SET brand = '埃斯洛通讯' WHERE brand = '迅达通讯';
UPDATE brand_pool SET brand = '罗讷银行'   WHERE brand = '磐石银行';
UPDATE brand_pool SET brand = '莱茵斯重工' WHERE brand = '天工重工';
UPDATE brand_pool SET brand = '埃尔巴草本' WHERE brand IN ('CVS Health', '西维斯健康');
UPDATE brand_pool SET brand = '奥拉维文旅' WHERE brand = '星野文旅';

-- 冠名合同表文本兜底（生产 0 行；新库/历史数据同样收敛）
UPDATE naming_contracts SET brand = '奥维恩'     WHERE brand = '亚马逊';
UPDATE naming_contracts SET brand = '凯利昂生物' WHERE brand = '麒麟生物';
UPDATE naming_contracts SET brand = '维洛'       WHERE brand = '阿迪达斯';
UPDATE naming_contracts SET brand = '斯科尔汽水' WHERE brand = '可口可乐';
UPDATE naming_contracts SET brand = '洛森餐饮'   WHERE brand = '海底捞';
UPDATE naming_contracts SET brand = '诺迪运动'   WHERE brand = '极星运动';
UPDATE naming_contracts SET brand = '维奥莱饮品' WHERE brand = '鲸涛饮品';
UPDATE naming_contracts SET brand = '埃斯洛通讯' WHERE brand = '迅达通讯';
UPDATE naming_contracts SET brand = '罗讷银行'   WHERE brand = '磐石银行';
UPDATE naming_contracts SET brand = '莱茵斯重工' WHERE brand = '天工重工';
UPDATE naming_contracts SET brand = '埃尔巴草本' WHERE brand IN ('CVS Health', '西维斯健康');
UPDATE naming_contracts SET brand = '奥拉维文旅' WHERE brand = '星野文旅';

-- 新增 12 家：tier 直接写校准后的档位（不等下次重算），heat 在 clamp 0.5~1.5 内；
-- source='builtin' = 随代码入库的池内容（区别于管理端新增的 custom）。
INSERT OR IGNORE INTO brand_pool (brand, heat, source, status, industry, tier, created_at) VALUES
  ('维斯兰科技', 0.93, 'builtin', 'adopted', '科技', '新兴', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('瓦隆酿造',   0.90, 'builtin', 'adopted', '饮食', '新兴', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('塞拉越野',   0.89, 'builtin', 'adopted', '运动', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('诺德保险',   0.87, 'builtin', 'adopted', '金融', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('泰拉蒙汽车', 0.86, 'builtin', 'adopted', '汽车', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('瑟兰制药',   0.84, 'builtin', 'adopted', '医疗', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('洛朗烘焙坊', 0.83, 'builtin', 'adopted', '饮食', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('精卫重工',   0.81, 'builtin', 'adopted', '制造', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('霜降茶业',   0.78, 'builtin', 'adopted', '饮食', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('比特兰科技', 0.76, 'builtin', 'adopted', '科技', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('梅尔泽证券', 0.74, 'builtin', 'adopted', '金融', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('阿尔维文旅', 0.70, 'builtin', 'adopted', '文旅', '口碑', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 回滚：12 处改名反向 UPDATE（brand_pool 与 naming_contracts 各 12 条，末条 WHERE brand IN ('CVS Health','西维斯健康')）
--   + DELETE FROM brand_pool WHERE brand IN
--   ('维斯兰科技','瓦隆酿造','塞拉越野','诺德保险','泰拉蒙汽车','瑟兰制药','洛朗烘焙坊','精卫重工','霜降茶业','比特兰科技','梅尔泽证券','阿尔维文旅');
