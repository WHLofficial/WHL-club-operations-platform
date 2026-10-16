# 实施计划：批 2 企业档案（0074）+ 批 3 招商性格（0075）

关联设计：`memory/design-brand-pool-structure.md` §3/§4（详稿）。命令表与铁律同 `memory/plan-v6.51.0-brand-venue-naming.md` §0/§1。改名批次见 `memory/plan-brand-fictionalize-pool.md`（0073，**先于本批 apply**，本文件品牌名均按改名后书写）。行号 = 当前工作区现状（v6.51.0 未发布），动手前以 grep 复核。

## 0. 拍板结论

**2026-10-15（用户 m00691）**

- 改名批次同版并入 v6.51.0（`0071→0072→0073→0074→0075` 一次 apply）；不改已提交的 0071（73f32e4）。
- 「一线城市」标签确定改「大场馆」（`clubs` 无地理字段，`src/db/migrations/0001_init.sql`:32-39）。
- ~~池内 极星/迅达/星海 同名异行当——不换~~ → 见下条（欧洲化后 极星→诺迪运动、迅达→埃斯洛通讯 自然消解；星海通讯保留为中资品牌）。
- 站内信 `naming_offer_activated` **加**品牌署名行（S5 已含）。
- 批 1 设计「有几处要改」——**没有了**（无修订）。
- preferBonus/Cap 经经济评估修订为 **0.02/0.04**（design 文档 §4.7）。

**2026-10-15 追加（用户 m00783 / m00815 / m00821）**

- 对赌 `bonusRate` 0.7 → **0.5 已拍板**（摊到每项指标 0.25，两项全达 = 0.5 × 底价）。
- 品牌**属地改欧洲城市**（联赛为欧洲俱乐部，原中国城市不合理）：见 §2。
- 对赌**指标多样化**（指标库 6 条）；阈值**按签约队自身基线相对化**（防难度过低/过高）；**强队加难、弱队降难**（目标概率三档）——机制与经济评估见 design 文档 §4.8。
- 批 2/3 详稿与实施仍按流程门槛先经用户确认（28 家配种已提交用户审阅）。

**2026-10-15 追加（用户 m00932 + 追补「作为特色，也加入一些中国化品牌」）**

- 品牌名**欧洲化改造**：22 家改欧式造词名（中文译名 + 拉丁英文名配对），映射与 SQL 见 `plan-brand-fictionalize-pool.md` §1/§2（0073）。
- **中资品牌 6 家**（长风汽车/白马体育/青云乳业/精卫重工/星海通讯/霜降茶业）：保留中国风格命名、属地为中国城市、简介写「中资出海」，`origin='中资'` 渲染小标签；全部落在口碑档。
- 对赌指标**取消逐品牌硬编码**（`brand_pool.bet_terms` 不建列）：改为签约时按品牌 `prefer` 加权 + 确定性抽签抽 2 条（不同相关族），阈值按目标概率反解，回测再纠偏——见 §3 S7 与 design §4.8 A–E。
- 本批新增 `origin` 列（0074 第 7 列），管理端可改（空 / 中资）。

**2026-10-15 拍板收口（用户 m01064：「最好还是有个上下限来防护；其他没改的了」）**

- 28 家新名表、抽签权重表、p 三档 0.34/0.42/0.50、回测带 [0.30,0.55]±0.06 —— **全部通过，照本文件落地**。
- 追加要求：对赌**必须有上下限防护** → 落成 design §4.8 **G 节四层护栏**（G1 阈值 / G2 单窗支出 `[0.70,1.20]×底价` / G3 合同期 ≤ `4.80×底价` / G4 结算 `homePlayed=0` 判不达 / G5 `guard` 记录），本文件 S7 与 §4.5 已同步。

**2026-10-15 护栏精修（用户 m01131「G1·上限太松了」+ m01155「万一没有适用的怎么办」）**

- 首版上限确实松（`points` 每场 2.4 分、`sellout` 允许全季满座、`attend` 让弱队涨 10 个点）⇒ **G1 上限二次收紧**：`attend` ≤ `min(0.90, B+0.05, B×1.15)`、`fans` ≤ `min(0.06, B+0.02)`、`points` ≤ `floor(n×2.2)`、`goals` ≤ `floor(n×2.4)`、`cleansheet` ≤ `ceil(n/3)`、`sellout` ≤ `max(1, ceil(n×0.7))`。
- **方向修正（重要）**：护栏触顶时**不得把线钳低**（钳低 = 写进一条人人都能过的要求 = 白送奖金）⇒ 改「剔除此指标、重新抽」，剔除名单记 `dropped`（G1b）。
- **少池/空池兜底链（G1c）**：可行池 ≥2 抽 2 条 / =1 抽 1 条 / =0 取触界最轻一条钳到上限（`guard='ceil'`）；无基线且 `n=0` 走池默认基线（`pool_default`）；结算侧 `items` 空或无主场 ⇒ 零奖金不倒扣（`no_data`）；**任何情形不回退旧绝对线**。
- 已同步：design §4.8 G1/G1b/G1c + A 表 + B 节 + E 节 JSON、本文件 S7 与测试项、项目记忆。

## 1. 批 2 步骤（企业档案 · 0074）

- **S1 迁移**：新建 `src/db/migrations/0074_brand_profiles.sql`（7 条 ADD COLUMN，全 `TEXT NOT NULL DEFAULT ''`：`name_en`、`full_name`、`color`、`slogan`、`hq`、`intro`、`origin`）→ `tests/d1.ts` `MIGRATION_FILES` 末尾注册。
- **S2 配种**：§2 的 28 条 UPDATE 附在迁移尾部（幂等，空值不清洗已有数据）。
- **S3 后端**：
  - `src/worker/routes/admin/brands.ts`：GET `/brands` SELECT（:32-36）增 7 列；POST（:43-75）可选带 7 字段，INSERT（:55-57）增列；PATCH（:77-152）入参联合类型（:95）、"至少给一个字段" 判断（:96-98）、UPDATE（:139）增列；audit before/after（:72/:148-149）带字段；校验：name_en ≤40 / full_name ≤30 / slogan ≤20 / hq ≤20 / intro ≤80 字，color 空或 `^#[0-9A-Fa-f]{6}$`，origin 空串或 `中资`。
  - `src/worker/naming-ops.ts`：`BrandPoolRow`（:21-31）与 `loadAdoptedBrands`（:130-136）SELECT 增 7 列。
  - `src/worker/market-ops.ts`：`listClubOffers`（:92）与 `ClubOfferRow`（:100-107）增 `b.slogan, b.hq, b.name_en, b.color, b.origin`（join brand_pool 已有）。
  - `src/worker/routes/clubs.ts`：`namingContractDto`（:1099）增档案字段；GET `/club/naming/quote`（:1133）加一次品牌档案查询 `SELECT brand, name_en, color, slogan, hq, intro, origin FROM brand_pool WHERE brand IN (合同 + 报价品牌)`，平铺进 contract / offers；`offerDto`（:1120）增同名字段；:1200 `naming_offer_activated` 供料增 hq。
- **S4 前端**：`web/src/lib/api.ts` 类型（BrandQuote / NamingContract / ClubOffer / 报价行）增档案字段；`web/src/pages/shop/venueCards.tsx`：offerRow（:300-341）品牌名后 slogan 小字 + 「hq · 行业」hint + origin 非空时「中资」小标签，现约段（:352-430）品牌名后 slogan、intro 折叠展开、「中资」标签同报价卡；`web/src/pages/admin/BrandsPage.tsx`：行内编辑区（:240-270）与新增表单（:295-306）各加 7 输入（color 用 `<input type="color">` + 文本兜底，intro 用 textarea，origin 用 select = 空 / 中资），列表行显示 color 色块 + name_en + 中资标签。
- **S5 站内信**：`src/worker/notify.ts`:109-110 `naming_offer_activated` 文案尾附署名行「—— {brand}{hq ? `（${hq}）` : ''}」；供料点 `src/worker/home.ts`:767 补 hq。
- **S6 测试与文档**：tests/market-rounds.test.ts（offerDto/合同 DTO 带 slogan/hq/origin）、tests/naming-ops.test.ts（quoteBrands 透出档案）、管理端校验用例（color 非法 400、origin 非法 400）；web 侧类型 fixture 补字段；CHANGELOG/AGENTS.md/ROADMAP/TECH_DESIGN 同步。

## 2. 批 2 配种 SQL（28 家 · 品牌名为 0073 改名后）

```sql
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
```

## 3. 批 3 步骤（招商性格 · 0075）

- **S1 迁移**：新建 `src/db/migrations/0075_brand_style.sql`（3 条 ADD COLUMN，全 `TEXT NOT NULL DEFAULT ''`：`brand_pool.style`、`brand_pool.prefer`、`naming_contracts.bet_terms`）→ `tests/d1.ts` 注册。**不建 `brand_pool.bet_terms`**（指标改抽签，见 S7）。
- **S2 配种**：§4 的 28 条 UPDATE 附迁移尾部。
- **S3 后端**：
  - `src/worker/market-ops.ts`：:112 新增 `packageNoForBrand(tier, style): 1|2|3`（稳健→1、进取→2、对赌→3；空/未登记 → 现 `packageNoForTier(tier)`）；调用点 :220 改用；`spawnVisitOffer`（:656 附近，现固定递稳健套餐）改按 style 选套餐（空回退 1）。
  - `loadClubSignals(db)`（置 market-ops.ts）：返回每队匹配标签集合 —— 死忠规模 = `stadiums.fans` 前 25%；大场馆 = `capacity` 前 25%；高上座 = 上赛季 `match_attendance` 平均上座率（attendance ÷ 当刻 capacity）前 25%（无数据不匹配）；冠军相 = 上赛季 `league_premier` 冠军（standings 聚合，口径参照 `src/worker/season-settle.ts:392` championBonusStatements；无数据不匹配）。样本 <4 队退化为「取最高 1 队」。
  - `buildRoundStatements`（:155）：valuations 排序键（现 :216 附近仅 fee desc）改为 `(prefer 命中数 desc, fee desc)`；名额/套餐/金额/offeredTeams 去重（:219）口径不变。
  - `src/worker/naming-ops.ts`：`SatisfyConfig`（:449-454）增 `preferBonus`（默认 **0.02**）、`preferBonusCap`（默认 **0.04**，经济评估修订值，见 design 文档 §4.7）；`DEFAULT_SATISFY`（:466）同步；`loadSatisfyConfig`（:522）finiteOr 兜底（config 键 `market_satisfy_config` 已注册，无需动 CONFIG_KEYS）；`evolveSatisfactionForClub`（:658）在 `satisfactionDelta`（:685）前算 prefer 项 = `min(命中数 × preferBonus, cap)`，并入 delta（prefer 为空 = 现状）。
  - `src/worker/home.ts`:664：调用点把该品牌的 prefer 标签传入（`loadAdoptedBrands` 已载 prefer 列，就近取）。
  - `src/worker/routes/admin/brands.ts`：GET SELECT（:32-36）增 2 列；POST/PATCH 校验（style ∈ 三枚举或空串；prefer 去重、1–3 个、标签 ∈ {冠军相, 高上座, 死忠规模, 大场馆}、空串清空）；audit 带字段。**无 bet_terms 校验**。
- **S4 前端**：`web/src/pages/admin/BrandsPage.tsx` 行内编辑加 style（select）+ prefer（文本，占位「冠军相,高上座」）；`venueCards.tsx` 报价卡可展示 style 徽标（可选）。
- **S5 测试**：tests/market-rounds.test.ts（对赌品牌递 `package_no=3`；prefer 命中队优先入选——构造 fans/capacity 极端值）；tests/naming-ops.test.ts（prefer 命中 delta 含 +0.02/+0.04；prefer 空与现状一致）；管理端校验用例。
- **S6 文档同步**：同批 2。
- **S7 对赌条款引擎（2026-10-15 追加 · v2 随机化）**：
  - 数据：只有 `naming_contracts.bet_terms`（签约快照 JSON）；`brand_pool` 无对赌指标列。
  - 抽签 helper `buildBetTerms(db, clubId, brand, season, windowSeq)` 置 `src/worker/naming-ops.ts`（紧邻 `buildPackages` :75-88）。流程：① 适用性过滤（design §4.8 A 表；`points/goals/cleansheet/sellout` 需本窗主场 n ≥ 3）；② **prefer 加权轮盘抽第一条 → 排除同相关族后重抽第二条**（族 `A={attend,sellout}`、`B={points,goals}`、`C={fans}`、`D={cleansheet}`；权重表 = design §4.8 B）；③ 按队伍强度三分位定目标 p（强 0.34 / 中 0.42 / 弱 0.50）并**反解阈值**（计数型泊松/二项求最小整数 T，比率型 `B + z_p × σ`）；④ 近 3 窗回测纠偏（hitRate ∉ [0.30,0.55] → p ±0.06，最多两档）；⑤ 快照。
  - **随机源 = `seededUnit`**（`src/worker/venue-ops.ts`:104，FNV-1a + splitmix32；注释即「确定性伪随机 [0,1)：同 seed + draw 恒定（关窗批重跑必须逐字一致）」）；`seed = [season, windowSeq, clubId, hash(brand)]`，draw 依次取 0/1/2… ⇒ 同签名同结果（关窗批重跑/测试可复现），换季换窗重抽（池内多样性），合同内不重抽。
  - 阈值：③ 反解后**再过 G 节硬护栏**（收紧后上限：`attend` `[max(B+0.01,0.30), min(0.90, B+0.05, B×1.15)]`、`fans` `[0.010, min(0.060, B+0.02)]`+σ 封顶 0.02、`points` `[max(1,round(n×0.4)), floor(n×2.2)]`、`goals` `[max(1,round(n×0.3)), floor(n×2.4)]`、`cleansheet` `[1, ceil(n/3)]`、`sellout` `[1, max(1,ceil(n×0.7))]`）。
  - **触界处理 = 剔除重抽（不是钳低）**：`可行池 = 适用性通过 且 反解阈值落在上下限内`；可行池 ≥ 2 → 抽 2 条；= 1 → 只抽 1 条（奖金按条数 ×0.25）；= 0 → 取触界最轻的一条钳到上限并记 `guard='ceil'`。被剔指标记进快照 `dropped:[...]`，`items[].guard` 记 `''`/`floor`/`ceil`/`pool_default`（design §4.8 G1/G1b/G5）。
  - **少池/空池兜底（design §4.8 G1c，必须落）**：**任何情况都要抽得出条款，且不得回退旧绝对线**（旧 bet_attend 0.8 / bet_fans 3% 是本轮淘汰的线）。空池 = 取触界最轻一条钳上限（单条 ⇒ 单窗支出 `0.95 × 底价`）；无基线且 `n=0` ⇒ 池默认基线 + `guard='pool_default'`；结算侧 `items` 空或无主场场次 ⇒ 本窗零奖金、审计 `no_data`。`n` = 签约当刻该窗**已排定**的主场场次。
  - 写入：签约 / 接班转正 / 续约三处与 `pkgJson` 同点算条款并快照（行号见批 1 S3）。
  - 结算：`windowNamingStatements`（`src/worker/naming-ops.ts`:296-351）对赌分支改双路——`bet_terms` 非空 → 逐条评估（新增窗级统计查询：`result_confirmations` 聚合窗内积分/进球/零封 + `match_attendance` 满座计数，一次 SQL，口径见 design §4.8 A 表）；空/旧格式 → 旧 `bet_attend/bet_fans` 逻辑（向后兼容；生产 `naming_contracts` 现 0 行）。memo 改「{brand} 对赌奖金（{label} 达线：实 X / 线 Y）」。
  - **结算护栏（design §4.8 G4，必须实现）**：结算侧要把**本窗主场场次 `homePlayed`** 一并算出并传入（`home.ts:585-664` 的 `attendRate` 无主场时缺省为 `1`，那是给情绪等机制用的，对赌判定不得沿用）⇒ `homePlayed = 0` 时 `attend` 判**不达**；计数型在 n=0 时 λ=0 ⇒ T ≥ 1 天然不达。审计行带 `guard`。**单窗支出护栏（G2）由奖金基数保证**：`fee = 0.70 × 底价`、两条各 `0.25 × 底价` ⇒ 单窗 ≤ `1.20 × 底价 < 进取 1.25`（不加含 `fee_mod` 的现金封顶，见 G2 口径限定）。
  - 展示：`src/worker/routes/clubs.ts` `namingContractDto`(:1099)/`offerDto`(:1120) 透出条款与指标展示名；`web/src/pages/shop/venueCards.tsx` 报价卡一行「对赌：签约时按品牌偏好随机抽 2 条指标（偏向 {prefer}）」、现约段显示实际两条与每窗进度；`web/src/pages/admin/BrandsPage.tsx` 不加 bet_terms 选择器（无该列）。
  - 测试：`tests/naming-ops.test.ts` —— **固定 seed 断言抽签结果稳定**（同 seed 同结果、换 seed 可不同）；权重偏向（同 prefer 品牌大量抽样时偏好指标占比显著高）；阈值反解（给定基线样本 → 期望 T）；p 三档 + 回测调档；**护栏边界**（反解超上限的指标被剔进 `dropped` 且不出现为条款、可行池=1 只抽 1 条、可行池=0 时钳到上限且 `guard='ceil'`、**无基线且 n=0 走池默认（`pool_default`）、结算侧 items 空/无主场 ⇒ 零奖金不倒扣（`no_data`）、任何情形都不回退旧 bet_attend/bet_fans 绝对线**；触下限同样剔除；`attend` 在 `homePlayed=0` 的窗判不达；单窗支出 ≤ `1.20 × 底价`；`B ≥ 0.85` 抽不到 `attend`、`B > 0.05` 抽不到 `fans`）；双条命中发两笔 `naming_bonus`；`bet_terms` 空走旧逻辑；满座识别（attendance fill 0.985–0.999）。

## 4. 批 3 配种 SQL（28 家 · 品牌名为 0073 改名后）

```sql
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
```

## 4.5 对赌抽签权重（取代原「7 家 bet_terms 配种」）

指标不再逐品牌配种，**只由 `prefer` 决定权重**（design §4.8 B）；7 家 `style='对赌'` 品牌（维斯兰科技/洛森餐饮/塞拉越野/泰拉蒙汽车/洛朗烘焙坊/霜降茶业/比特兰科技）签约时各抽 2 条。

| prefer 标签 | 加权（未列出的指标 = 1.0） |
|---|---|
| 冠军相 | `points` 2.4 / `goals` 1.9 / `cleansheet` 0.7 |
| 高上座 | `attend` 2.4 / `sellout` 1.7 / `fans` 1.1 |
| 死忠规模 | `fans` 2.6 / `attend` 1.1 |
| 大场馆 | `sellout` 2.3 / `attend` 1.6 / `points` 0.9 |

- 多家标签乘性叠加（例：`'冠军相,大场馆'` ⇒ `points` 2.16、`sellout` 2.3）；第一条与第二条**不同相关族**（族见 S7 ②）⇒ 两条近似独立。
- 不适用指标不进池，由适用性过滤自然收口（design §4.8 A 表）；池内可选项 < 2 时只抽 1 条（奖金基数按实际条数 × 0.25）。
- **硬护栏**（用户 m01064「最好还是有个上下限来防护」，m01131「上限太松了」二次收紧）：阈值上下限（收紧值见 S7）、**触界剔除重抽**（G1b：不许把线钳低——钳低 = 写进一条人人都能过的要求 = 白送）、单窗支出 `[0.70, 1.20] × 底价`、合同期累计 ≤ `4.80 × 底价`、结算 `homePlayed=0` 判不达 —— 全部见 design §4.8 G（G1/G1b/G2–G5），实施时按该表逐条落，不得放宽。

## 5. 上线与回滚

- 0074 / 0075 各自独立 apply；同一发布内顺序固定 `0071 → 0072 → 0073 → 0074 → 0075`。
- 回滚 = 代码回退；新增列留空即回现状行为（批 3 的空 prefer 无加成、空 style 回档位映射、空 `bet_terms` 走旧 bet_attend/bet_fans）。
- 回读：`/api/admin/brands` 见档案字段（欧式属地 + 中资 6 家 origin）、style/prefer；招商轮报价卡见 slogan 与「中资」标签；对赌品牌出现 `package_no=3`，报价卡见「按品牌偏好随机抽 2 条指标」文案。

## 6. 悬置

- 批 3 的 28 家 style/prefer 与分位阈值（top 25%）是首版配种，可按观感调；preferBonus/Cap 已按经济评估修订（0.02/0.04，design 文档 §4.7）。
- 对赌抽签首版参数（prefer 权重表、p 三档 0.34/0.42/0.50、回测带 [0.30,0.55]±0.06、池默认基线）是首版取值，**待用户拍板**；全部可改（权重/阈值常数在代码内，池默认基线在 helper 内），不动迁移即可调。
- 生产首季仅 1 窗数据（S9 W1，114 场）⇒ 首轮签约多数走「单窗基线 + 计数指标池默认」，随窗数积累自动转准。
- 撞名复核见 `plan-brand-fictionalize-pool.md` §5；22 家欧式造词名未过商标库；星海通讯（中资）保留为已拍板项。

## 7. 交付记录（v6.51.0 品牌池三批 · 本地完成，**未发布 / 未提交 / 未 apply 生产**）

**交付物（全部落盘、未 commit）**：

- 迁移 4 个（`tests/d1.ts` 的 `MIGRATION_FILES` 已按 `0072 → 0073 → 0074 → 0075` 追加）：`src/db/migrations/0072_brand_venue_naming.sql`（`naming_contracts.venue_name`）、`0073_brand_fictionalize.sql`（12 改名 × 2 表 + 12 新增，池 16 → 28）、`0074_brand_profiles.sql`（7 档案列 + 28 配种）、`0075_brand_style.sql`（`brand_pool.style` / `brand_pool.prefer` / `naming_contracts.bet_terms` + 28 配种）。均无 `BEGIN/COMMIT`、幂等、尾部带回滚注释。
- Worker：`src/worker/naming-ops.ts`（`composeVenueName` / `venueNameOf`、对赌引擎全套纯函数 `betGuardBounds` / `deriveOne` / `deriveBetPool` / `chooseBetItems` / `betWeights` / `normalQuantile` / `parseBetTerms` / `parsePreferTags`、`buildBetTerms`、`loadNamingWindowCounts`、结算双路 `windowNamingStatements`、`SatisfyConfig` 增 `preferBonus` / `preferBonusCap`、`evolveSatisfactionForClub(..., preferHits)`、`renewNaming` 写 `venue_name` + `bet_terms`）；`src/worker/market-ops.ts`（`packageNoForBrand`、`preferHitCount`、`loadClubSignals`、招商轮排序键 `(preferHits desc, fee desc)`、`spawnVisitOffer` 按性格、`acceptOffer` / `activateQueuedStatements` 写 `venue_name` + `bet_terms`、`listClubOffers` / `ClubOfferRow` 带档案、`acceptOffer` 带 `stadium_name`）；`src/worker/routes/clubs.ts`（`home.namingVenueName`、`namingContractDto.venueName` / `betTerms` / `brandProfile`、`offerDto` 带档案与 `venueName`）；`src/worker/routes/admin/brands.ts`（GET 9 列 / POST / PATCH 校验 + 审计全字段）；`src/worker/weather-ops.ts`（`stadium.venueName`）；`src/worker/notify.ts`（接替站内信落点名 + 署名行）；`src/worker/home.ts`（偏好命中供料 + `windowNamingStatements` 传本窗主场场次）。
- 前端：`web/src/lib/api.ts`（`StadiumInfo.namingVenueName`、`NamingContractBase.venueName` / `betTerms` / `brandProfile`、`ClubOffer` 档案字段）；`web/src/pages/club/VenueTab.tsx`（球场标题落点名）；`web/src/pages/shop/venueCards.tsx`（报价卡与现约卡的档案展示、`betThresholdText`、`BetTags`）；`web/src/pages/admin/BrandsPage.tsx`（档案 + 性格 + 偏好编辑）；`web/src/styles.css`（`.brand-profile-grid` / `.brand-color-chip`）。
- 测试：新增 `tests/naming-bet-terms.test.ts`（22 例）、`tests/naming-brand-profile.test.ts`（11 例）；同步 `tests/naming-ops.test.ts` / `market-rounds.test.ts` / `event-ops.test.ts` / `naming-tiers.test.ts` / `fixtures.test.ts` / `weather-forecast.test.ts` / `web/src/pages/ClubDetail.test.tsx` / `tests/mobile-baseline.test.ts` / `tests/ops-schedule.test.ts`；`scripts/e2e/smoke.mjs` ㉓ 改新口径。
- 文档：`CHANGELOG.md` v6.51.0 条目扩展、`ROADMAP.md` 本节扩展、`AGENTS.md` 当前状态行扩展、`docs/test-plans/v6.51.0-brand-pool-fictionalize-profile-style.md` 新建。

**闸门**：`npm run typecheck` 三份 0 error；`npx vitest run` **135 文件 / 2195 例**全绿（+`web/src/pages/admin/BrandsPage.test.tsx` 3 例：品牌池档案区默认收起）；`npm run build` 成功。`npm run test:e2e` 已在本地 dev（8791）跑完：**27 / 28**（本版 ㉓ 通过；唯一失败 ㉒ 为 v6.48.0 存量缺陷，见下）。

**独立复审（code-review-skill）与三处实现修正**：① 🔴 **样本场次 `n` 的来源**——原实现读 `season_windows.tournament_id` 取本窗赛程，该列在 `0014` 迁移后**休眠**（全仓唯一写点 `src/worker/window-machine.ts:170`），生产 `n` 恒 0 ⇒ `sellout`/`points`/`goals`/`cleansheet` 永久出池；改由新增的 `expectedWindowScale(samples): BetScale`（`src/worker/naming-ops.ts:461-482`）给**近 3 窗同尺度场次均值取整**（`home` 主场 / `all` 已确认全部；无历史 `{0,0}`），`buildBetTerms` 改用它。② 🔴 **反解尺度 = 结算尺度**——`attend`/`sellout` 是主场尺度、`points`/`goals`/`cleansheet` 是全窗尺度（结算只读 `result_confirmations`，无主客区分）；`scaleN(m, scale)` 按指标取尺度，`deriveBetPool`/`chooseBetItems` 接受 `number | BetScale`。③ 🟡→加固 **G3**：每项奖金 = `min(0.25, 1 / windows_total) × 底价`（4 窗仍 0.25；窗数调大也不破 G2 ≤ 1.20× / G3 ≤ 2.0× 底价），结算不再读 `bonus_amount`（配置 `naming_params.bet.bonusRate = 0.7` 保留为旧展示口径：`0.7 × 对赌费 ≈ 0.49 × 底价`，故配置不改）。测试夹具随之重写（删 `seedSchedule` 改 `seedHistory`：3 个历史窗 + 每窗 4 主场 / 8 场赛果 ⇒ 尺度 `{home:4, all:8}`），新增 `tests/naming-bet-scale.test.ts` **8 例**（尺度来源回归锁 / 反解尺度反向锁与蒙特卡洛达线率带 / 签约→结算闭环 / G3 任意窗数）。**复审列为 🟡/🟢 而按现状保留的项**：续约绕开品牌性格、`windows_remaining` 无本窗守卫、`PATCH` 等值无 no-op、`namingContractDto` 老合同 `venueName: null` 与 `/api/me/club` 现拼口径不一致、`loadNamingWindowCounts` 与 `home.ts` 重复读 `capacity`/`match_attendance` —— 全部如实登记在 `docs/test-plans/v6.51.0-brand-pool-fictionalize-profile-style.md` 的「登记」段。

**本地迁移回读（先在隔离全新本地 D1 上做，后修好仓库本地库复做）**：从零 apply 全部迁移后 —— `brand_pool` **28 行**、`origin='中资'` **6**、`style='对赌'` **7**、`name_en` / `color` / `prefer` 28 行齐备、13 个真实品牌名残留 **0**；`naming_contracts` 新列 `venue_name` 与 `bet_terms` 均在；抽样 奥维恩 `OVIEN / 都柏林 / #1E4E8C / 进取 / 冠军相,大场馆`、星海通讯 `origin='中资'`、维斯兰科技 与 比特兰科技 `style='对赌'`。**仓库本地 D1（`.wrangler/state`）已就地修好并复验**（全程 `--local`，未触碰生产）：原先 `d1_migrations` 只记录 29 条（`0022`–`0065`，其中三条漏 `.sql` 后缀）⇒ `npm run db:migrate:local` 会从 `0001_init.sql` 重放并报 `table players already exists: SQLITE_ERROR`；**更正**：先前「该库没有 `brand_pool` 表」是 `tail` 截断输出的误判，实测 `brand_pool` 存在（9 列 / 7 行，停在 `0066`）。用 `node:sqlite` 直读 sqlite 文件做指纹比对（表名 + 列定义 + 索引/触发器/视图）定位：schema 与「重放 `0001`–`0066`」逐字一致，唯一差异是 `0038_players_sort_indexes_batch6.sql` 的两条索引（`idx_players_sort_growth_tier`、`idx_players_sort_future_star`，全仓无 drop）。处置：① 补建两条索引；② 补记 `0001`–`0066` 进 `d1_migrations` 并规范化三条漏后缀记录；③ `npm run db:migrate:local` 应用 `0067`–`0075`（32 条语句全 ✅）；④ 复比指纹 —— 与参考库**完全一致**（49 表）；⑤ 回读 `brand_pool` 28 行 / 中资 6 / 对赌 7 / 真实名 0、`naming_contracts` 新列齐、`d1_migrations` 75 条。dev 服务器已起在 8791。

**实测发现（如实登记，均已写进 CHANGELOG / ROADMAP / 测试计划）**：① `guard='ceil'`（可行池 = 0）在当前参数下生产不可达（`fans` 恒可入池：池默认 0.03、σ 0.02、`z ∈ [−0.202, 0.583]` ⇒ 线 ∈ [0.026, 0.042] ⊂ G1 [0.01, 0.05]），仅由合成状态用例锁定；② `z ≤ 0`（弱队）时 `attend` 线 = B < G1 下限 `B+0.01` ⇒ 必然触界剔除（护栏优先于「弱队更易达线」）；③ 无 fans 历史表 ⇒ `fans` 恒走池默认基线；④ 计数型反解取 `(1−p)` 分位（与设计「最小整数 T」字面不符，按经济意图落地并注释）；⑤ `bonus_amount`（≈ 0.49 × 底价）与实发上限（0.5 × 底价）不逐分相等（展示字段差异）。

**`npm run test:e2e`（dev 8791，本机实测）**：**27 / 28 通过**；本版新增与改动的 ㉓（检查名以「④ 强制拍卖人选解禁 + 品牌池全虚构化扩编（v6.51.0）」开头）通过。唯一失败 ㉒ 成长档位（v6.48.0）为**存量缺陷、与本版无关**：断言（`scripts/e2e/smoke.mjs:3540-3544`）要求 `/api/admin/growth/tier-changes` 返回 `action='club_country_set'`，而端点（`src/worker/routes/admin/growth-tier.ts:113`）过滤条件为 `action LIKE 'growth_tier%'`，两者同出自 commit `1593362` ⇒ 该断言恒不可能通过（实证：`audit_log` `id=188 action='club_country_set'` 已写入，端点只返回 `id=189–192` 的 `growth_tier_set`）。未擅自改端点过滤（属 v6.48.0 范围）。

**生产 schema 体检（只读 `--remote` SELECT）**：因本地库出现过「手工 apply 漏对象」，apply `0071`–`0075` 前对生产做了对象级 + 列级比对（基准 = 从零重放 `0001`–`0070` 的参考库）：对象清单 147 条全中（生产另有 infra 表 `_cf_KV`）、47 张表列清单逐表一致、`idx_players_sort_growth_tier` 与 `idx_players_sort_future_star` 生产**存在**、29 条 `idx_players%` 索引逐条相同 ⇒ 生产无同类缺口。手法备忘：D1 远端 `pragma_table_info(m.name)` 关联调用被拒 `SQLITE_AUTH`（须字面量表名）、compound SELECT term 数上限实测 ≤ 5（需分批）。

**待令（一句不做）**：迁移 `0071 → 0072 → 0073 → 0074 → 0075` 按序 apply 生产、push、部署、生产回读；本地 dev 8791 的人工验收。

**回滚口径**：代码回退 + 新增列留空即回现状行为（`venue_name` / `bet_terms` 空走旧逻辑、`style` 空回档位映射、`prefer` 空无加成、7 档案列空不渲染）；数据侧按各迁移尾部注释反向执行（0073 为反向 `UPDATE` + `DELETE` 12 家）。

