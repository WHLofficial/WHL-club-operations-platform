-- v6.51.0 批 3：招商性格（brand_pool.style / brand_pool.prefer）+ 对赌条款快照（naming_contracts.bet_terms）。
-- style ∈ {'', '稳健', '进取', '对赌'}：决定该品牌在招商轮与事件上门里主推哪档套餐（空 = 回落原档位映射 packageNoForTier）。
-- prefer = 逗号分隔的偏好标签（∈ 冠军相/高上座/死忠规模/大场馆，空 = 不偏），用于队况排序加成与对赌指标抽签权重。
-- bet_terms = 对赌合同的抽签快照 JSON（v2）；空串或旧格式(v1) ⇒ 结算回落旧的 bet_attend/bet_fans 绝对线。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069/0070/0071 约定）。
-- 回滚：ALTER TABLE brand_pool DROP COLUMN style; / DROP COLUMN prefer; ALTER TABLE naming_contracts DROP COLUMN bet_terms;

ALTER TABLE brand_pool ADD COLUMN style TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN prefer TEXT NOT NULL DEFAULT '';
ALTER TABLE naming_contracts ADD COLUMN bet_terms TEXT NOT NULL DEFAULT '';

-- 性格配种：品牌名为 0073 改名后（迁移顺序固定 0071 → 0072 → 0073 → 0074 → 0075）
-- 首版配种：28 家 = 7 家对赌（维斯兰科技/洛森餐饮/塞拉越野/泰拉蒙汽车/洛朗烘焙坊/霜降茶业/比特兰科技）+ 6 家进取 + 15 家稳健。
UPDATE brand_pool SET style='进取', prefer='冠军相,大场馆' WHERE brand='奥维恩';
UPDATE brand_pool SET style='稳健', prefer='高上座,死忠规模' WHERE brand='凯利昂生物';
UPDATE brand_pool SET style='进取', prefer='冠军相,高上座' WHERE brand='维洛';
UPDATE brand_pool SET style='稳健', prefer='高上座,死忠规模' WHERE brand='斯科尔汽水';
UPDATE brand_pool SET style='进取', prefer='高上座,冠军相' WHERE brand='诺迪运动';
UPDATE brand_pool SET style='对赌', prefer='大场馆,冠军相' WHERE brand='维斯兰科技';
UPDATE brand_pool SET style='进取', prefer='高上座,大场馆' WHERE brand='维奥莱饮品';
UPDATE brand_pool SET style='对赌', prefer='死忠规模,高上座' WHERE brand='洛森餐饮';
UPDATE brand_pool SET style='稳健', prefer='大场馆,死忠规模' WHERE brand='瓦隆酿造';
UPDATE brand_pool SET style='对赌', prefer='冠军相,高上座' WHERE brand='塞拉越野';
UPDATE brand_pool SET style='稳健', prefer='大场馆,冠军相' WHERE brand='长风汽车';
UPDATE brand_pool SET style='稳健', prefer='死忠规模,高上座' WHERE brand='诺德保险';
UPDATE brand_pool SET style='稳健', prefer='死忠规模,冠军相' WHERE brand='白马体育';
UPDATE brand_pool SET style='对赌', prefer='大场馆,高上座' WHERE brand='泰拉蒙汽车';
UPDATE brand_pool SET style='稳健', prefer='大场馆,死忠规模' WHERE brand='埃斯洛通讯';
UPDATE brand_pool SET style='稳健', prefer='死忠规模,高上座' WHERE brand='瑟兰制药';
UPDATE brand_pool SET style='对赌', prefer='死忠规模,高上座' WHERE brand='洛朗烘焙坊';
UPDATE brand_pool SET style='稳健', prefer='高上座,大场馆' WHERE brand='青云乳业';
UPDATE brand_pool SET style='稳健', prefer='大场馆,冠军相' WHERE brand='精卫重工';
UPDATE brand_pool SET style='稳健', prefer='大场馆,高上座' WHERE brand='星海通讯';
UPDATE brand_pool SET style='稳健', prefer='死忠规模,大场馆' WHERE brand='罗讷银行';
UPDATE brand_pool SET style='对赌', prefer='高上座,死忠规模' WHERE brand='霜降茶业';
UPDATE brand_pool SET style='对赌', prefer='冠军相,大场馆' WHERE brand='比特兰科技';
UPDATE brand_pool SET style='稳健', prefer='大场馆,冠军相' WHERE brand='莱茵斯重工';
UPDATE brand_pool SET style='进取', prefer='冠军相,死忠规模' WHERE brand='梅尔泽证券';
UPDATE brand_pool SET style='稳健', prefer='死忠规模,高上座' WHERE brand='埃尔巴草本';
UPDATE brand_pool SET style='进取', prefer='高上座,大场馆' WHERE brand='阿尔维文旅';
UPDATE brand_pool SET style='稳健', prefer='高上座,死忠规模' WHERE brand='奥拉维文旅';

-- 回滚：UPDATE brand_pool SET style='', prefer=''; UPDATE naming_contracts SET bet_terms='';
