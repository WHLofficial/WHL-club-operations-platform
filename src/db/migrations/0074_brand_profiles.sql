-- v6.51.0 批 2：品牌企业档案（7 列，全部 TEXT NOT NULL DEFAULT ''）。
-- 全空默认值 = 老行/管理端新建行不写档案也能用；展示层对空值一律不渲染（无档案 = 现状外观）。
-- color 约定 '#RRGGBB'（管理端校验 ^#[0-9A-Fa-f]{6}$；空串放行）；origin ∈ {'', '中资'}（空 = 不渲染「中资」标签）。
-- 数据随后：22 家欧式（origin 留空）属地取欧洲城市，6 家中资（origin='中资'）属地取中国城市。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069/0070/0071 约定）。
-- 回滚：ALTER TABLE brand_pool DROP COLUMN name_en;（full_name/color/slogan/hq/intro/origin 同，SQLite 3.35+）

ALTER TABLE brand_pool ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN slogan TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN hq TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN intro TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN origin TEXT NOT NULL DEFAULT '';

-- 档案配种：品牌名为 0073 改名后（迁移顺序固定 0071 → 0072 → 0073 → 0074）
-- 欧式 22 家（origin 留空 = 不渲染标签）
UPDATE brand_pool SET name_en='OVIEN', full_name='奥维恩科技集团', color='#1E4E8C', slogan='算力所指，皆是主场', hq='都柏林', intro='云计算与智能算力服务商，总部都柏林，数据园区遍布北欧，连续多年冠名欧洲赛场。' WHERE brand='奥维恩';
UPDATE brand_pool SET name_en='CALEON BIO', full_name='凯利昂生物制药集团', color='#6A2C8F', slogan='从实验室到看台', hq='巴塞尔', intro='创新药与疫苗研发企业，总部巴塞尔，长期资助青训与运动医学研究。' WHERE brand='凯利昂生物';
UPDATE brand_pool SET name_en='VILO', full_name='维洛运动用品公司', color='#C8102E', slogan='快一步，就够了', hq='纽伦堡', intro='轻量竞速跑鞋起家的运动品牌，签约多位短跑名将，装备线覆盖足球与田径。' WHERE brand='维洛';
UPDATE brand_pool SET name_en='SKOLL', full_name='斯科尔饮品集团', color='#1F8A70', slogan='一口清凉，半城烟火', hq='格拉斯哥', intro='老牌汽水厂转型品牌，橘子汽水与盐汽水是几代球迷的看球记忆。' WHERE brand='斯科尔汽水';
UPDATE brand_pool SET name_en='NODI', full_name='诺迪运动科技公司', color='#00A6A6', slogan='向前，不停', hq='赫尔辛基', intro='北欧智能穿戴与运动装备品牌，以心率算法与轻量球鞋见长，装备覆盖青训梯队。' WHERE brand='诺迪运动';
UPDATE brand_pool SET name_en='VESLAN', full_name='维斯兰智能科技集团', color='#E4572E', slogan='昼夜算力，从不打盹', hq='埃因霍温', intro='AI 芯片与算力调度平台，服务自动驾驶与体育数据分析，园区毗邻埃因霍温高科技园。' WHERE brand='维斯兰科技';
UPDATE brand_pool SET name_en='VIOLEY', full_name='维奥莱食品饮料集团', color='#1B6CA8', slogan='深海的清爽', hq='维希', intro='气泡水与电解质饮料新锐品牌，水源取自中央高原，年轻球迷看台上的常客。' WHERE brand='维奥莱饮品';
UPDATE brand_pool SET name_en='LOSEN', full_name='洛森餐饮连锁集团', color='#C8402F', slogan='锅开了，人就齐了', hq='柏林', intro='连锁火锅与深夜食堂品牌，把「球迷第二现场」做成招牌，柏林与维也纳均有门店。' WHERE brand='洛森餐饮';
UPDATE brand_pool SET name_en='WALLON', full_name='瓦隆酿造酒业公司', color='#8A5A2B', slogan='麦香入喉，旧事入夜', hq='布鲁塞尔', intro='精酿啤酒与果酒品牌，沿比利时传统工艺，赛前街角小酒馆的常驻供应。' WHERE brand='瓦隆酿造';
UPDATE brand_pool SET name_en='SELA', full_name='塞拉户外装备公司', color='#F2A900', slogan='追着山跑', hq='霞慕尼', intro='户外运动装备品牌，源自阿尔卑斯山谷，主打越野跑与长距离骑行装备。' WHERE brand='塞拉越野';
UPDATE brand_pool SET name_en='NORDIS', full_name='诺德保险集团', color='#11698E', slogan='风浪再大，心里有底', hq='苏黎世', intro='财产与责任险为主的保险集团，主打「赛事延误险」等小众产品，精算团队设在苏黎世。' WHERE brand='诺德保险';
UPDATE brand_pool SET name_en='TERRAMONT', full_name='泰拉蒙新能源汽车公司', color='#1D7874', slogan='越过山丘，看见远方', hq='慕尼黑', intro='新能源 SUV 品牌，以高原续航与越野性能为卖点，工程中心设在慕尼黑近郊。' WHERE brand='泰拉蒙汽车';
UPDATE brand_pool SET name_en='ESLÖ', full_name='埃斯洛通讯设备公司', color='#0F4C81', slogan='信号满格，主场不慌', hq='埃斯波', intro='通信设备与 5G 基站供应商，承建多个球场网络覆盖，研发中心位于埃斯波。' WHERE brand='埃斯洛通讯';
UPDATE brand_pool SET name_en='CERALAN', full_name='瑟兰制药集团', color='#4F7942', slogan='药到心安', hq='萨勒诺', intro='植物药与外用药企业，主打运动损伤理疗贴剂，原料来自南意草本种植园。' WHERE brand='瑟兰制药';
UPDATE brand_pool SET name_en='LORAN', full_name='洛朗烘焙食品公司', color='#D9A441', slogan='刚出炉的，永远最好', hq='里昂', intro='连锁烘焙品牌，法棍与软欧包出名，赛后门店常排长队，凌晨四点开炉。' WHERE brand='洛朗烘焙坊';
UPDATE brand_pool SET name_en='RHÔNA', full_name='罗讷银行', color='#1A3A5C', slogan='稳，是最好的承诺', hq='日内瓦', intro='日内瓦老牌私人银行，主推球迷联名卡与青训公益基金，管理规模居前列。' WHERE brand='罗讷银行';
UPDATE brand_pool SET name_en='BITLAN', full_name='比特兰数据科技公司', color='#7B68EE', slogan='把数据织成云', hq='塔林', intro='数据中台与云原生服务商，源自波罗的海数字城，为体育联盟提供数据可视化系统。' WHERE brand='比特兰科技';
UPDATE brand_pool SET name_en='RHEINS', full_name='莱茵斯重工集团', color='#8C6A4A', slogan='匠心所至，重器自成', hq='杜伊斯堡', intro='老牌装备制造集团，盾构机与球场钢结构工程承包商，厂区在莱茵河畔。' WHERE brand='莱茵斯重工';
UPDATE brand_pool SET name_en='MELZER', full_name='梅尔泽证券', color='#147D64', slogan='看多看远', hq='法兰克福', intro='全能型投行，主打体育产业投研与球迷理财教育，交易席位在法兰克福。' WHERE brand='梅尔泽证券';
UPDATE brand_pool SET name_en='ERBA', full_name='埃尔巴草本医药公司', color='#3B7A57', slogan='老方新配，安心到家', hq='帕多瓦', intro='百年草本堂号转型的连锁药企，主打家庭常备药与草本问诊，药园在帕多瓦近郊。' WHERE brand='埃尔巴草本';
UPDATE brand_pool SET name_en='ALVI', full_name='阿尔维文旅发展公司', color='#2F80ED', slogan='一叶行舟，处处风景', hq='卢塞恩', intro='湖区景区运营与旅行服务商，主打「跟着球队去客场」主题线路，自有游船码头。' WHERE brand='阿尔维文旅';
UPDATE brand_pool SET name_en='OULAVI', full_name='奥拉维文旅集团', color='#4B3F72', slogan='星野之下，皆是远方', hq='罗瓦涅米', intro='拉普兰高端度假与星空营地运营商，冠名过多个城市地标项目，极光季一房难求。' WHERE brand='奥拉维文旅';

-- 中资 6 家（origin='中资' → 展示层渲染「中资」小标签；属地为中国城市；全称用中国公司制式）
UPDATE brand_pool SET name_en='CHANGFENG', full_name='长风汽车集团股份有限公司', color='#2C3E50', slogan='长风破浪，行稳致远', hq='上海', origin='中资', intro='中国老牌车企转型新能源，以电动化出海欧洲，冠名欧洲赛场是其海外第一步。' WHERE brand='长风汽车';
UPDATE brand_pool SET name_en='BAIMA', full_name='白马体育文化发展股份有限公司', color='#4A4E69', slogan='白马过隙，少年如风', hq='晋江', origin='中资', intro='中国体育用品之乡走出的青训与赛事运营公司，以赞助欧洲俱乐部叩开海外市场。' WHERE brand='白马体育';
UPDATE brand_pool SET name_en='QINGYUN', full_name='青云乳业股份有限公司', color='#4C86C6', slogan='一杯青云，步步高升', hq='呼和浩特', origin='中资', intro='中国乳制品企业，以低温鲜奶与运动营养酸奶切入欧洲，冠名主打品牌出海。' WHERE brand='青云乳业';
UPDATE brand_pool SET name_en='JINGWEI', full_name='精卫重工机械集团有限公司', color='#6B7A8F', slogan='填海不止，工程不休', hq='长沙', origin='中资', intro='中国工程机械制造商，挖掘机与起重设备市占率居前，参建球场改建打开欧洲渠道。' WHERE brand='精卫重工';
UPDATE brand_pool SET name_en='XINGHAI', full_name='星海通讯科技股份有限公司', color='#3F51B5', slogan='连接每一场主场', hq='深圳', origin='中资', intro='中国卫星通信与物联网企业，为欧洲赛事转播提供低延迟传输方案。' WHERE brand='星海通讯';
UPDATE brand_pool SET name_en='SHUANGJIANG', full_name='霜降茶业有限公司', color='#6E8B3D', slogan='霜降之后，茶更回甘', hq='杭州', origin='中资', intro='中国红茶与新式茶饮品牌，节气命名系列走红，借欧洲赛场做东方茶文化出海。' WHERE brand='霜降茶业';

-- 回滚：ALTER TABLE brand_pool DROP COLUMN name_en / full_name / color / slogan / hq / intro / origin;
