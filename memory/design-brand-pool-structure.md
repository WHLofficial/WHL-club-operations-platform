# 设计定稿：品牌条目结构改造（批 1 冠名上球场 · 批 2 企业档案 · 批 3 招商性格）

来源：用户 2026-10-15 多轮裁决（brainstorming 全流程）：改造 `brand_pool` 条目结构以满足真实性与实用性 → 「全都要，先出全表」→「全上，按 1→2→3」→「球队已经有自己的初始球场名，要合理地把品牌加入其中」→ 分隔用中点（上汽·上海文化广场 同规格）→ 批 1 锁版 →「后续批次也让我确认」→ 批 2/3 详稿补齐。本文件三批均为详稿；实施计划：批 1 `plan-v6.51.0-brand-venue-naming.md`、改名批次 `plan-brand-fictionalize-pool.md`、批 2/3 `plan-brand-profile-and-style.md`（批 2/3 与改名批次待用户确认后实施）。

## 0. 总原则

- 只加列，不改列、不动既有数据语义。
- **全字段可空，空即回退现状**：老数据、老测试、老合同零炸。
- 三批独立可上线、独立回滚（回滚 = 代码回退，新增列留空不影响现状行为）。
- 文中行号基于 v6.51.0 未发布工作区现状，实施时以 grep 复核。

## 1. 三批总览

| 批 | 内容 | 迁移 | 状态 |
|---|---|---|---|
| 1 | 冠名上球场：冠名名 = 品牌·球场原名 | `0072_brand_venue_naming.sql` | 设计已锁，计划已备 |
| 改名 | 品牌池全虚构化 + 欧洲化：16 家中 12 家改欧式造词名 + 新增 12 家（池 16→28；22 欧式 + **6 家中资特色**） | `0073_brand_fictionalize.sql` | 计划已备（已拍板并入 v6.51.0） |
| 2 | 企业档案：英文名/全称/主色/口号/属地/简介 + `origin` 归属标记 | `0074_brand_profiles.sql` | 详稿 |
| 3 | 招商性格：谈判风格 + 偏好标签，联动招商轮 | `0075_brand_style.sql` | 详稿 |

`0071_brand_pool_expand.sql`（池 7→16，已提交 73f32e4）尚未 apply 生产。改名批次原拟并进 0071，但 0071 已入库（本地/CI 库可能已应用，改已入库文件会让各环境静默分叉），故独立为 0073。同一发布内上线顺序固定：0071 → 0072 → 0073 → 0074 → 0075。

## 2. 批 1 · 冠名上球场（详稿）

### 2.1 数据层：迁移 0072（只加一列）

```sql
ALTER TABLE naming_contracts ADD COLUMN venue_name TEXT NOT NULL DEFAULT '';
```

- 语义 = 签约那一刻的冠名名快照；空串 = 老合同/未生成，展示层回退现状。
- 生产 `naming_contracts` 实测 0 行，无需回填 UPDATE；迁移不写 BEGIN/COMMIT（执行器自包事务）。
- `tests/d1.ts:84` 的 `MIGRATION_FILES` 数组注册 0072（现行 `:155` 已注册 0071）。

### 2.2 组合规则（唯一一处 helper）

`composeVenueName(brand, stadiumName)` = `` `${brand}·${stadiumName}` ``；`stadiumName` 为空 ⇒ 返回 `''`（不造名）。置于 `src/worker/naming-ops.ts` 导出（`src/worker/market-ops.ts` 已在 import 该文件的 namingBaseFee/buildPackages/industryFactor）。

### 2.3 写入点（3 处，签约时点取当刻球场名）

| 场景 | 位置 | 改动 |
|---|---|---|
| 新签 | `src/worker/market-ops.ts:602`（acceptOffer 的 INSERT INTO naming_contracts） | 查询多取 `stadiums.name`，INSERT 增 `venue_name` |
| 接班转正 | `src/worker/market-ops.ts:343`（activateQueuedStatements 的 INSERT，`:310` 已 join brand_pool） | 加 join stadiums，INSERT 增 `venue_name`；activated[] 通知供料同步带 venueName |
| 续约 | `src/worker/naming-ops.ts:214-225`（renewNaming 的 UPDATE） | 该处已在读球场参数（容量/死忠），补取 name，UPDATE 增 `venue_name` |

不做追改：签约后管理端改球场名不动快照，续约时刷新。`market_offers` 不存冠名名——报价预览按当刻拼。

### 2.4 读取与展示（6 点）

1. **主场档案** `src/worker/routes/clubs.ts:679-700`：加 `namingVenueName`（= 快照 ‖ 现拼「品牌·原名」；无冠名 null）。前端 `web/src/pages/club/VenueTab.tsx:23` 改用它，空则回原名——老合同快照为空时回退格式恰好就是现状显示（品牌·未冠名→品牌·原名），无缝兼容。
2. **合同 DTO** `src/worker/routes/clubs.ts:1099`（namingContractDto）加 `venueName`；`web/src/lib/api.ts` 的 NamingContract 类型同步；冠名市场合同卡（`web/src/pages/shop/venueCards.tsx`）标题显示冠名名。
3. **报价预览**：BrandQuote（`src/worker/naming-ops.ts:157` quoteBrands 返回）与 offerDto（`src/worker/routes/clubs.ts:1120`）各加 `venueName`（按当刻球场名拼）→ venueCards 报价卡一行「签下将命名为 天枢·工人体育场」。
4. **站内信「冠名生效」**：`src/worker/notify.ts:110` 文案改用冠名名；两个供料点 `src/worker/home.ts:767` 与 `src/worker/routes/clubs.ts:1200` 补字段（直接签 acceptOffer 现状不发此通知，不扩）。
5. **fixtures 公开面**：`src/worker/weather-ops.ts:81-135`（buildRoundView）加查 active 冠名（LEFT JOIN `naming_contracts` WHERE status='active'），stadium 对象新增 `venueName` 字段；`name` 语义不变 → `src/worker/routes/fixtures.ts:38` 对外只加字段（赛事平台侧零影响）。无冠名场次该字段缺省，查询成本 +1 LEFT JOIN。
6. **管理端不动**：BrandsPage / ClubsPage 均不改。账本不动（Ledger 仍品牌名，净额口径不变）。

### 2.5 采过的形式与取舍

- 选定：**品牌·原名（中点）**——中文场馆冠名常规（上汽·上海文化广场、凯迪拉克·上海音乐厅）。
- 否决：无分隔「天枢工人体育场」（边界靠语感）；后置括号「工人体育场（天枢冠名）」（像系统标注，无真实感）。
- 否决并砍字段：`brand_pool.venue_suffix`（品牌后缀）与 `stadiums.venue_type`（球场类型）——品牌是「并入」球队已有球场名，不另造名。

### 2.6 测试与同步面

- 后端断言：`tests/naming-ops.test.ts`、`tests/market-rounds.test.ts`、`tests/event-ops.test.ts` 补——签约出「品牌·原名」、续约刷新、解约后回原名、fixtures 带 `venueName`。
- 前端：`web/src/pages/ClubDetail.test.tsx:287` 等类型与断言补齐；venueCards 相关测试如有。
- e2e：`scripts/e2e/smoke.mjs` 补一步（签约后 `/me/club` 的 namingVenueName）。
- 文档：`CHANGELOG.md`（并入 v6.51.0 未发布条目或新版本条目）、`AGENTS.md`、`ROADMAP.md`、`TECH_DESIGN.md`、`memory/plan-v6.51.0-forced-auction-and-brand-pool.md` 同步。
- 上线：0071 尚未 apply 生产 ⇒ 一次 apply（**已拍板顺序 0071→0072→0073→0074→0075，同版 v6.51.0**）→ push → 部署 → 回读；回滚 = 代码回退即恢复现状展示，列留空无害。

## 3. 批 2 · 企业档案（详稿 · 迁移 `0074_brand_profiles.sql`）

### 3.1 数据层

```sql
ALTER TABLE brand_pool ADD COLUMN name_en   TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN color     TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN slogan    TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN hq        TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN intro     TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN origin    TEXT NOT NULL DEFAULT '';
```

空串 = 未配种，展示层不渲染（老数据/老测试零炸）。`origin` 语义 = 归属标签，当前仅取值 `''`（不渲染）与 `'中资'`（渲染「中资」小标签）；6 家中资品牌（长风汽车/白马体育/青云乳业/精卫重工/星海通讯/霜降茶业，属地为中国城市 + 出海赞助欧洲赛场的简介）标 `'中资'`，其余 22 家留空。28 家配种 UPDATE 随迁移（SQL 见 `plan-brand-profile-and-style.md` §2）。

### 3.2 字段与校验

| 字段 | 语义 | 上限 | 校验（400） |
|---|---|---|---|
| name_en | 英文名 | ≤40 字 | 长度；空串 = 清空 |
| full_name | 企业全称 | ≤30 字 | 长度 |
| color | 主色 HEX | 7 字符 | 空 或 `^#[0-9A-Fa-f]{6}$` |
| slogan | 口号 | ≤20 字 | 长度 |
| hq | 属地 | ≤20 字 | 长度 |
| intro | 简介 | ≤80 字 | 长度 |
| origin | 归属标签 | ≤10 字 | 空串 或枚举（现行仅 `中资`） |

### 3.3 落点

1. 管理端 `src/worker/routes/admin/brands.ts`：GET SELECT（:32-36）增 7 列；POST（:43-75）可选带 7 字段；PATCH（:77-152）增字段与「至少给一个」判断（:96-98）；audit 带字段。`web/src/pages/admin/BrandsPage.tsx` 行内编辑（:240-270）与新增表单（:295-306）各加 7 输入（color 色板 + 文本兜底，intro textarea，origin select = 空 / 中资）；列表行显示色块 + name_en + `中资` 标签。
2. 品牌行读取：`BrandPoolRow`（`src/worker/naming-ops.ts:21-31`）与 `loadAdoptedBrands`（:130-136）增 6 列 ⇒ 报价链（quoteBrands，:157）与招商轮（buildRoundStatements）自然可读。
3. 报价卡：`BrandQuote` 透出档案字段 + `offerDto`（`src/worker/routes/clubs.ts:1120`）/ `ClubOfferRow`（`src/worker/market-ops.ts:100-107`，:92 SELECT 增 `b.name_en, b.color, b.slogan, b.hq, b.origin`）→ `web/src/pages/shop/venueCards.tsx` offerRow（:300-341）品牌名后 slogan 小字 + 「hq · 行业」hint + origin 非空时「中资」小标签。
4. 合同卡：`namingContractDto`（`src/worker/routes/clubs.ts:1099`）增档案字段；`getActiveNaming` 只读 naming_contracts ⇒ 在 GET `/club/naming/quote`（:1133）加一次 `SELECT brand, name_en, color, slogan, hq, intro, origin FROM brand_pool WHERE brand IN (合同 + 报价品牌)`，平铺进 contract / offers；venueCards 现约段（:352-430）品牌名后 slogan、intro 折叠展开、「中资」标签同报价卡。
5. 站内信：`naming_offer_activated`（`src/worker/notify.ts`:109-110）文案尾附署名行「—— {brand}{hq ? `（${hq}）` : ''}」；供料点 `src/worker/home.ts`:767 补 hq（routes/clubs.ts:1200 同）。其余通知文案不动。
6. 账本与 fixtures 公开面不动（对外契约零变更）。

### 3.4 测试与同步面

- 后端：tests/market-rounds.test.ts（offerDto / 合同 DTO 带 slogan/hq）、tests/naming-ops.test.ts（quoteBrands 透出档案）、管理端校验用例（color 非法 400）。
- 前端：类型 fixture 补字段（web 侧类型为必填 string 时全 fixture 需补）。
- 文档：CHANGELOG（随所属版本条目）、AGENTS.md 品牌池规则行、ROADMAP/TECH_DESIGN 同步。
- 上线：0074 独立 apply；回滚 = 代码回退（列留空无害）。

## 4. 批 3 · 招商性格（详稿 · 迁移 `0075_brand_style.sql`）

### 4.1 数据层

```sql
ALTER TABLE brand_pool ADD COLUMN style  TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_pool ADD COLUMN prefer TEXT NOT NULL DEFAULT '';
ALTER TABLE naming_contracts ADD COLUMN bet_terms TEXT NOT NULL DEFAULT '';
```

- `style` ∈ '' / 稳健 / 进取 / 对赌；`prefer` = 逗号分隔 1–3 个标签 ∈ 冠军相 / 高上座 / 死忠规模 / 大场馆。
- `naming_contracts.bet_terms` = 签约时对赌条款快照 JSON（机制见 §4.8）。
- 空串 = 现状行为（style 空回退档位映射；prefer 空 = 无挑队加权、无情绪加成、抽签权重全 1；bet_terms 空走旧 `bet_attend/bet_fans` 逻辑）。
- 设计修订 ①：原「一线城市」标签改为「大场馆」——`clubs` 表无地理字段（0001_init.sql:32-39 仅 id/name/league_tier/logo_key/status/created_at），无数据落点；capacity 可算。
- 设计修订 ②（2026-10-15，用户 m00932「对赌指标项目不要硬编码，要随机化但要偏向所性格偏好」）：**取消 `brand_pool.bet_terms` 列**——对赌指标不再逐品牌硬编码，改为签约时按 `prefer` 加权的确定性抽签（§4.8 B）；`prefer` 一列两用（招商挑队权重 + 抽签权重）。
- 28 家 style/prefer 配种随迁移（SQL 见 `plan-brand-profile-and-style.md` §4）。

### 4.2 style → 递价套餐

- 新增 `packageNoForBrand(tier, style): 1|2|3`（`src/worker/market-ops.ts:112` 旁；稳健→1、进取→2、对赌→3；空/未登记 → 现 `packageNoForTier(tier)`）。
- 调用点：buildRoundStatements（:220）改用；`spawnVisitOffer`（:656 附近，「品牌上门」现固定递稳健套餐）改按 style（空回退 1）。
- 影响：`market_offers.package_no` 首次出现 3（对赌 = 4 窗 ×0.7 + 达线奖金，`bonusRate` 经拍板 0.7→**0.5**，摊到两条指标各 0.25 × 底价，见 §4.7 第 3 条与 §4.8）；acceptOffer / 接班转正 / 续约链已支持 1–3（buildPackages 三套餐 + pkgJson 快照）。

### 4.3 prefer → 挑队加权

- 新增 `loadClubSignals(db)`（置 `src/worker/market-ops.ts`）返回每队匹配标签：
  - 死忠规模 = `stadiums.fans` 前 25%；大场馆 = `capacity` 前 25%；
  - 高上座 = 上赛季 `match_attendance` 平均上座率（attendance ÷ 当刻 capacity）前 25%（无数据不匹配）；
  - 冠军相 = 上赛季 `league_premier` 冠军（standings 聚合，口径参照 `src/worker/season-settle.ts:392` championBonusStatements；无数据不匹配）。
  - 样本 <4 队时退化「取最高 1 队」。
- buildRoundStatements（:155）valuations 排序键（现 :216 附近仅 fee desc）改为 `(prefer 命中数 desc, fee desc)`；名额/套餐/金额/offeredTeams 去重（:219）口径不变。

### 4.4 prefer → 情绪演化

- `SatisfyConfig`（`src/worker/naming-ops.ts:449-454`）增 `preferBonus`（默认 **0.02**）与 `preferBonusCap`（默认 **0.04**）——原定 0.05/0.10 经经济评估下调，理由见 §4.7；`DEFAULT_SATISFY`（:466）同步；`loadSatisfyConfig`（:522）finiteOr 兜底 ⇒ 生产老 JSON 无字段也安全（键 `market_satisfy_config` 已注册，不动 CONFIG_KEYS）。
- `evolveSatisfactionForClub`（:658）在 `satisfactionDelta`（:685）之前算 prefer 项 = `min(命中数 × preferBonus, cap)` 并入 delta；prefer 空 = 现状。调用点 `src/worker/home.ts`:664 传入该品牌 prefer（`loadAdoptedBrands` 已载该列，就近取）。

### 4.5 管理端与展示

- admin/brands.ts：GET SELECT 增 2 列；POST/PATCH 校验（style 三枚举或空串；prefer 去重、1–3 个、标签枚举、空串清空）；audit 带字段。**无 `bet_terms` 校验**（该列已取消，指标由抽签产生，不经管理端）。
- BrandsPage.tsx：行内编辑加 style（select）+ prefer（文本，占位「冠军相,高上座」）；venueCards 报价卡可加 style 徽标（可选）。
- 对赌条款展示：报价卡一行「对赌：签约时按品牌偏好随机抽 2 条指标（偏向 {prefer}）」；合同卡显示实际抽出的两条指标与每窗进度（key → 中文展示名映射见 §4.8 A）。

### 4.6 测试与上线

- tests/market-rounds.test.ts：对赌品牌递 `package_no=3`；prefer 命中队优先入选（构造 fans/capacity 极端值）。tests/naming-ops.test.ts：prefer 命中 delta 含 +0.02/+0.04；prefer 空与现状一致。管理端校验用例。
- 上线 0075 独立 apply；回滚 = 代码回退（列留空即回现状）。

### 4.7 经济评估（game-economy-designer 口径，2026-10-15）

基准量（已核）：`satisfactionDelta` = attendWeight 0.5 × lineBuffer 0.05 × sAttend + resultWeight 0.3 × 0.05 × sResult ⇒「满正窗」**+0.04**、「满负窗」−0.04（头部 ×1.5 = −0.06）；地板 头部 0.7 / 新兴 0.6 / 口碑 0.5（`src/worker/naming-ops.ts:449-475`）。

1. **preferBonus 0.05/0.10 → 0.02/0.04（已按评估修订）**：0.05/项已超过一次满正窗（+0.04）；命中 2 项（+0.10）可把最差窗（−0.06）翻正 ⇒ 等于对已匹配品牌关闭「品牌主动解约」。修订后 1 项 = 半窗、2 项封顶 = 1 窗，负窗仍有侵蚀。该值在 `market_satisfy_config` 内可配置（finiteOr 兜底），首版不理想改配置即可。
2. **top 25% 分位**：20 支俱乐部中 16 支有球场行（4 支 CPU 队无球场、不参与冠名）⇒ 每标签约 4 队，数量级合理；冠军相 = 上赛季 `league_premier` 冠军（仅 1 队，11 家品牌偏好它）——稀有标签可接受，若要更常命中可改「上赛季积分榜前 3」。标签重叠让强队被多家偏好（马太方向正确，集中度由 cap 收口）。
3. **对赌套餐启用（批 3 顺带激活既有 config）**：`naming_params.bet`（`src/core/config.ts:196`）= 4 窗 × 0.7 费 + 奖金 0.49 × 底价/达线窗；达线 = 窗上座率 ≥ 0.8 **或** 窗内死忠增长 ≥ 3%（OR、逐窗判定逐窗发，`src/worker/naming-ops.ts:336-343`）。现役 16 队（默认容量 2 万、死忠 1800 起步）单场上座率 ≈ fans×4.0×tierCoef/容量 ≈ 0.35 ⇒ 0.8 线早中期基本不可达；死忠单窗增长 ≈ 0.37 × 距目标差（influence 90 档目标 2340）⇒ 成长期约 +5~11%/窗（>3% 必达）、饱和后 <3%（自动失效）。⇒ 对赌实际是「成长期补贴」：成长期 0.7+0.49 = 1.19/窗 > 稳健 0.85，饱和期 0.7/窗 < 稳健。**建议（一处 config 值，待拍板）**：bonusRate 0.7 → 0.5，对赌区间收成 0.7–1.05，正夹在稳健 0.85 与进取 1.25 之间，保住「头部品牌付得多」的档位差（现值达线 1.19 ≈ 进取 1.25 的 95%）。生效路径待实施时确认（生产 config 行是否已固化该键，【未验证】）；生产 naming_contracts 现 0 行 ⇒ 改动零影响面。
4. **style 覆盖档位映射的副作用**：`packageNoForBrand` 生效后，tier 映射（头部→进取、其余→稳健，`src/worker/market-ops.ts:112`）实际被 style 取代 ⇒ 头部 3 家中 麒麟生物（稳健）由「进取 2 窗」变「稳健 6 窗」；「头部只做短约」旧不变量消失，CHANGELOG 需一句说明。

### 4.8 对赌指标多样化、随机化与难度校准（2026-10-15 追加 · 用户 m00783/m00815/m00821 + m00932）

需求四轮：① 指标不止上座/死忠（m00783）；② 阈值必须考虑**所签约队自身实际**，防难度过低/过高（m00815/m00821）；③ **强队加难、弱队降难**起平衡作用（同）；④ **指标不硬编码，签约时随机化，但偏向品牌性格偏好**（m00932）。经济口径仍走 game-economy-designer。

**A. 指标库（6 条，全窗级口径）**

| key | 展示名 | 口径 | 抽签适用性 | 阈值（按目标 p 反解） |
|---|---|---|---|---|
| `attend` | 上座率 | 窗内 `SUM(attendance) ÷ (capacity × 主场场次)` | 恒可（无历史走池默认）；**结算窗无主场 ⇒ 判不达**（G 节） | `B + z_p × σ`，钳 `[B+0.01, min(0.95, B+0.10)]` |
| `sellout` | 满座场次 | 窗内 `attendance ≥ capacity × 0.98` 的场次数（满座由 `attendance.ts` fill 0.985–0.999 判定，可靠） | 本窗主场 n ≥ 3 | 二项反解最小整数 T，钳 `[1, n]` |
| `fans` | 死忠增长 | `(窗末 − 窗初) ÷ 窗初` | 恒可（无历史走池默认）；`B > 0.05` 触 G1b 剔除 | `B + z_p × σ`，钳 `[0.01, min(0.06, B+0.02)]`（G1） |
| `points` | 窗内积分 | 胜 3 平 1 负 0（弃权判负） | n ≥ 3 | 泊松反解，钳 `[1, n × 2.4]` |
| `goals` | 窗内进球 | `score_*` 求和（弃权按 3:0 记） | n ≥ 3 | 泊松反解，钳 `[1, n × 2.8]` |
| `cleansheet` | 零封场次 | 对手进球 = 0 的场次数 | n ≥ 3 | 二项反解，钳 `[1, ceil(n ÷ 2)]` |

- 基线 B = 该队**近 3 窗**窗级均值（不足用现有全部）；`n` = 本窗已排主场场次；不适用的指标**不进抽签池**。
- 阈值的**最终上下限一律以 G1 为准**（本表「钳」栏与 G1 同值，G1 是唯一实现点；下限取在正常反解值之外，只在极端基线/少样本时兜底）。
- 数据不足（首赛季首窗、新队、无赛果）→ 池默认基线：`attend 0.60 / fans 0.03 / points 1.3/场 / goals 1.2/场 / cleansheet 1/3 场 / sellout 1/4 场`，按同一反解法给阈值。

**B. 抽签引擎（取代逐品牌硬编码指标）**

- 抽签池 = **可行指标**（A 表适用性 **且** 反解阈值落在 G1 上下限之内；触界处理见 G1b：剔除重抽，可行池=1 抽 1 条、=0 钳到上限并记 `guard`）；权重 = 基础 1.0 × **品牌 `prefer` 标签命中倍率（乘性叠加）**：

  | prefer 标签 | 加权（未列出的指标 = 1.0） |
  |---|---|
  | 冠军相 | `points` 2.4 / `goals` 1.9 / `cleansheet` 0.7 |
  | 高上座 | `attend` 2.4 / `sellout` 1.7 / `fans` 1.1 |
  | 死忠规模 | `fans` 2.6 / `attend` 1.1 |
  | 大场馆 | `sellout` 2.3 / `attend` 1.6 / `points` 0.9 |

  例：`prefer='冠军相,大场馆'` ⇒ `points` = 2.4 × 0.9 = 2.16、`sellout` 2.3、`goals` 1.9；`prefer` 空 ⇒ 全 1（等概率）。
- 第一条按权重轮盘抽出；第二条**重新归一化后再抽，但排除与第一条同相关族的指标**。相关族：`A={attend, sellout}`、`B={points, goals}`、`C={fans}`、`D={cleansheet}` ⇒ 两条近似独立 ⇒ 双达概率 ≈ p²（经济式成立的前提）。
- 随机源 = 仓内既有 **`seededUnit(seed: number[], draw: number): number`**（`src/worker/venue-ops.ts`:104，FNV-1a + splitmix32；注释即「确定性伪随机 [0,1)：同 seed + draw 恒定（关窗批重跑必须逐字一致）」）；seed = `(season, windowSeq, clubId, brand 字符串哈希)` 四元组。
- 因此：同一签名恒同结果 ⇒ **关窗批重跑逐字一致、测试可复现**；换季/换窗重抽 ⇒ 池内指标多样性；**单份合同内不重抽**（抽签结果进快照）。
- `style='对赌'` 仍是对赌套餐的开关（§4.2），与指标抽签解耦：抽签只在对赌合同签约时发生。

**C. 目标概率 p 与阈值反解（取代旧固定倍率）**

- 队伍强度三分位（近 3 窗场均积分 PPM；无赛果 → 死忠规模分位；再退化中位）→ 目标单条达线概率 **强 0.34 / 中 0.42 / 弱 0.50**，钳 `[0.30, 0.55]`。
- 计数型（`points/goals/cleansheet/sellout`）：λ = 每场均值 × n（cs/so 用二项 rate），取**最小整数 T 使 P(X ≥ T) ≥ p**，再按 A 表钳制。
- 比率型（`attend/fans`）：`T = B + z_p × σ`；σ = 近 3 窗样本标准差（样本 < 2 窗 → attend σ = 0.06 / fans σ = 0.02）；`z_p`：p=0.34 → 0.41、p=0.42 → 0.20、p=0.50 → 0.00。
- 方向：对赌奖金是品牌付给俱乐部 ⇒ 强队达线更难 = 强队从对赌拿到的期望更少、弱队更多 = 温和**再分配阀**（±10% 量级），与 S9 互助基金同向但幅度小，避免与富人税叠加过罚。

**D. 签约时回测纠偏（防难度过低/过高）**

- 签约时用该队近 3 窗数据回放两条指标历史达线率 `hitRate`：不在 `[0.30, 0.55]` → 判偏难/偏易，p 反向调 `±0.06`（最多两档），钳 `[0.28, 0.58]`；数据 < 2 窗 → 跳过回测。
- 结果（p、阈值、基线、样本窗数、hitRate）快照进 `naming_contracts.bet_terms`，**赛季内不随基线漂移**（防签约后难度变化）。

**E. 快照、兼容与展示**

- `naming_contracts.bet_terms` JSON：`{v:2, seed, p, strength, backtest:{hitRate, windows}, dropped:[m...], items:[{m, threshold, baseline, nBase, pTarget, guard}]}`（`dropped` = 被 G1b 剔除的指标；`guard` = `''` / `floor` / `ceil` / `pool_default`，少池/空池兜底见 G1c）。
- 空串 / 旧格式（v1）→ 回退既有 `bet_attend/bet_fans` 逻辑（老合同零炸；生产现 0 行）。
- 展示：报价卡一行「对赌：签约时按品牌偏好随机抽 2 条指标（偏向 {prefer}）」；签约后合同卡显示实际两条与每窗进度（key → 中文展示名映射见 A 表）。

**F. 经济目标与校验（game-economy-designer 口径）**

- 单条目标达线概率 **p ≈ 0.40**（可接受 0.35–0.48，C/D 保证多数落带内）；两条独立 ⇒ 双达 ≈ 0.16，每窗「至少一条」≈ 0.64，4 窗内至少达线 1 窗 ≈ 0.98（对赌不会空跑成纯低租）。
- 每项奖金 = 底价 × **0.25**（两项全达 = 0.5 × 底价 = 拍板 `bonusRate`）。
- 对赌期望收入 = `0.70 + 2 × p × 0.25` ≈ **0.90 × 底价/窗** ⇒ 相对稳健 0.85 溢价 ≈ 6%（波动对价）；下界 0.70（低于稳健 18%）、上界 1.20（低于进取 1.25）——区间仍夹在稳健与进取之间，档位差不破。
- 平衡阀落地后：强队（p=0.34）≈ 0.87、中位（0.42）≈ 0.91、弱队（0.50）≈ 0.95。弱队理性选对赌、强队理性选稳健 ⇒ 再分配自然发生，无需硬规则。
- 生产实况校验（S9 W1，已核）：16 队上座率 0.25（RB莱比锡）～0.905（慕尼黑1860）跨度极大 ⇒ 旧绝对阈值（上座率 0.8 / 死忠 3%）对一半球队不可达、对另一半天生达标；相对化后同池 p 才收敛到 0.4——这是本轮的核心理由。
- 生产首季仅 1 窗数据（S9 W1，114 场）⇒ 首轮签约多数走「单窗基线 + 计数指标池默认」，随窗数积累自动转准。

**G. 硬护栏（上下限防护 · 用户 m01064 追加）**

四层护栏：单条指标的线 / 单窗支出 / 整份合同累计 / 结算判定。任一护栏触发都不得让结果越出区间，触发来源记进快照 `guard` 便于排查。

**G1 阈值护栏**（2026-10-15 二次收紧，用户 m01131「上限太松了」；A 表与之同值处即唯一实现点）

| 指标 | 下限 | 上限（收紧后） | 不进抽签池 |
|---|---|---|---|
| `attend` | `max(B + 0.01, 0.30)` | `min(0.90, B + 0.05, B × 1.15)` | `B ≥ 0.85` |
| `fans` | `0.010`（1% / 窗） | `min(0.060, B + 0.02)`；σ 封顶 `0.02` | `B < 0.005` 或 `B > 0.05` |
| `points` | `max(1, round(n × 0.4))` | `floor(n × 2.2)` | `n < 3` |
| `goals` | `max(1, round(n × 0.3))` | `floor(n × 2.4)` | `n < 3` |
| `cleansheet` | `1` | `ceil(n ÷ 3)` | `n < 3` |
| `sellout` | `1` | `max(1, ceil(n × 0.7))` | `n < 3` 或 池内满座率 `> 0.5` |

首版上限（已被本轮收紧取代，留档对比）：`attend min(0.95, B+0.10)`、`fans 0.08`、`points n×2.4`、`goals n×2.8`、`cleansheet ceil(n/2)`、`sellout n`。下限故意取在「任何队的合理中位之下」（`points` 0.4 分/场、`goals` 0.3 球/场），正常反解值碰不到。

**G1b 触界处理 = 剔除重抽，**不是**把线钳到边界**（本轮关键修正）

- 上限的语义是「不许把合同写成接近满分的要求」，**不是**「把线压到上限」——钳低等于把人人都能过的要求写进合同 = 白送奖金，方向反了。
- 护栏因此作用在**抽签阶段**：`可行池 = 通过 A 表适用性 且 反解阈值落在 [下限, 上限] 区间内` 的指标。
  - 可行池 `≥ 2` → 正常抽 2 条（不同相关族，B 节）；
  - `= 1` → 只抽 1 条（奖金按实际条数 × 0.25，与既有规则一致）；
  - `= 0`（全部触上限，仅 PPM 接近满分级别的队伍可能出现）→ 取「触界最轻」的一条，钳到上限并记 `guard='ceil'`。
- 触**下限**（反解线低于下限）同样说明该指标对该队无意义（如 `attend` 基线贴近 0）→ 一并剔除、重抽。
- 余量校验（确保护栏不常态化触发）：池内上限处的最坏反解线 = `attend` ≈ 0.875（B=0.85 + 0.41×0.06）、`fans` ≈ 0.058（B=0.05 + 0.41×0.02）⇒ 均在收紧后的上限之内；护栏只在极端基线/少样本时触发。
- 取舍（如实记录）：超强队可能因触顶被剔掉计数指标 ⇒ 拿到的要求反而更宽，与「强队加难」方向相反。护栏优先级更高（用户 m01131 明确要防过高），且此类队伍极少；若上线后发现常态化触发，应调上限数值，**不得退掉护栏**。

**G1c 少池与空池兜底链（用户 m01155「万一没有适用的怎么办」）**

前提：适用性过滤 + G1 区间筛选后，可行池可能是 0 或 1 条。**任何情况下都必须抽得出条款，且不得回退旧绝对线**（旧 `bet_attend 0.8 / bet_fans 3%` 正是本轮要淘汰的、对半数队伍不可达的线，回退比"偏松"更糟）。

| 情形 | 处理 | 钱 |
|---|---|---|
| 可行池 ≥ 2 | 正常抽 2 条（不同族） | `0.70 + 2 × 0.25 = 1.20 × 底价`（上界） |
| 可行池 = 1 | 只抽 1 条 | `0.70 + 0.25 = 0.95 × 底价` |
| 可行池 = 0（全部触上限） | 取「触界最轻」的一条（目标线超上限最少者），**钳到上限**并记 `guard='ceil'` | `0.95 × 底价` |
| 无任何基线 且 本窗主场 `n = 0`（首季新队） | 用池默认基线算线，取 `min(默认线, 上限)`，记 `guard='pool_default'` | 同上 |
| 结算侧：`items` 为空 或 该窗无主场场次 | 本窗**零奖金**（不倒扣），审计记 `no_data` | `0.70 × 底价` |

- 空池兜底出的那一条**必然 ≤ 上限** ⇒ 不会出现过高的要求；代价只是"偏松"，且只发 `0.25 × 底价`。这比"没有条款→回退绝对线"和"钳低多条"都更可控。
- `n` 的口径：签约当刻该窗**已排定**的主场场次；排期未出（`n = 0`）⇒ 计数型出池、比率型照用（池默认兜底），与首季实况吻合。
- 调参信号：`dropped` 含量或 `guard='ceil'` 占比长期偏高（说明某指标在池内被系统性剔除）⇒ 调上限数值，**不得退掉护栏、不得回退旧绝对线**。

**G2 单窗支出护栏**（现金口径 · 对赌套餐）

- 下界 `0.70 × 底价`：对赌窗最低就是合同价，不达线不倒扣。
- 上界 `1.20 × 底价`（`0.70 + 2 × 0.25`）：**任何一窗的总支出都低于进取 1.25 × 底价**。
- 口径限定：护栏只钳「套餐费率 × 底价」，**不并入 `fee_mod` 等既有经营乘子**（那是另一套机制，混进来会互相抵消）；若要现金绝对封顶需另立账目，本期不做。

**G3 合同期护栏**（对赌 4 窗）

- 累计奖金 `≤ 4 × 0.5 = 2.0 × 底价`；累计支出 `≤ 4 × 1.20 = 4.80 × 底价`，仍低于同样 4 窗按进取价付的 `5.00 × 底价`。
- 每窗命中条数天然 `≤ 2`（抽签只抽 2 条），单条每窗最多发一次。

**G4 判定护栏（防「白送 / 不可能」，实现层必须处理）**

- **无主场场次的窗**：窗结算里的 `attendRate` 在无主场时缺省为 `1`（`src/worker/home.ts:585-664`，那是给情绪等其他机制用的缺省），对赌判定**不得沿用** ⇒ 结算必须同时拿到本窗主场场次 `homePlayed`，`homePlayed = 0` 时 `attend` 判**不达**。
- 计数型 `n = 0` ⇒ λ = 0 ⇒ 反解 T 被钳到 `≥ 1` ⇒ 天然不达（无需特判）。
- 弃权判负、缺比分按 `0` 计（沿用 A 表口径）。
- 回测纠偏 ≤ 2 档、最终钳 `[0.28, 0.58]`（D 节）——难度不会被回测推出护栏。

**G5 记录与排查**：`dropped` 记被剔除的指标，`items[].guard` 记触发来源（`''` / `floor` / `ceil` / `pool_default`）；结算审计带一行「{brand} 对赌 {label}：实 X / 线 Y（guard: …）」。护栏触发率（尤其 `dropped` 是否常态化）是上线后回看「相对化与上限调准没有」的第一手指标。**G2/G3（钱）是硬钳，不适用剔除重抽**。

### 4.9 实施修正（v6.51.0 落地实测，2026-10-15 · code-review 复审后回写）

本节是**落地事实**对上面 A–G 的修正，代码以本节为准；A–G 原文字未改（保留设计意图与拍板过程）。

- **修正 1 · `n` 的来源**：A 表 :188 写的 `n` = 本窗已排主场场次，落地时先按 `season_windows.tournament_id` 取赛程，复审查明该列**休眠**（`0014_season_tournaments.sql:3` 明确注释「两列休眠、代码停用」；全仓唯一写点是 `src/worker/window-machine.ts:170` 的建窗，且窗口与赛程解耦 —— `src/worker/results.ts:195` 的 §15 假设 25「窗口只管转会准入、赛果归属赛季不归属窗口」）⇒ 生产 `n` 恒 0 ⇒ 四个计数型指标永久出池。**改法**：`n` 由 `expectedWindowScale(samples): {home, all}` 给出 —— 近 3 窗样本的**同尺度场次均值取整**（`home` = 该窗主场场次、`all` = 该窗已确认全部场次；无历史 → `{0,0}`）。
- **修正 2 · 反解尺度 = 结算尺度**：A 表口径里 `attend`/`sellout` 是**主场**尺度、`points`/`goals`/`cleansheet` 是**全窗**尺度（结算只读 `result_confirmations`，无主客区分）。落地必须同一尺度反解，否则线被顶到 0.916–0.974、破 F 节经济式与 G2/G3 支出界。实现：`scaleN(m, scale)` 按指标取 `scale.home`（`attend`/`sellout`）或 `scale.all`（其余），`deriveBetPool` / `chooseBetItems` 接受 `number | BetScale`（传 `number` = 两尺度相同，兼容用例）。
- **修正 3 · 计数型反解方向**：C 节「取最小整数 T 使 P(X ≥ T) ≥ p」字面理解会得到 p 过小的线；落地取**最大的 T**（即 `(1−p)` 分位），单条达线概率 ≈ p，与 F 节经济式一致（代码注释已说明）。
- **修正 4 · G3 加固**：每项奖金 = `min(0.25, 1 / windows_total) × 底价`（4 窗仍是 0.25；`windows_total` 被调大时仍保 G2 ≤ 1.20× / G3 ≤ 2.0× 底价）。结算**不再读 `bonus_amount`**（配置 `naming_params.bet.bonusRate = 0.7` 是旧展示口径：`0.7 × 对赌费 ≈ 0.49 × 底价`，恰好对应「两项全达 0.5 × 底价」，故配置不改；展示字段与实际发放不逐分相等属已登记差异）。
- **A 表「钳」栏**（:181–186）是首版数值，**唯一实现点是 G1**（:236 起），本表仅供追溯；`attend` 钳栏的 `min(0.95, B+0.10)` 已被 G1 的 `min(0.90, B+0.05, B×1.15)` 取代。
- **落点索引（代码）**：`src/worker/naming-ops.ts` —— `BET_METRICS` :133、`BET_LABELS` :137、`BET_FAMILY` :147、`PREFER_TAGS` :165、`BRAND_STYLES` :168、`BET_P_BY_STRENGTH` :184、`BetTermsItem` :190、`BetTerms` :204、`BetHistorySample` :216、`NamingWindowCounts` :232、`normalQuantile` :275、`brandHash` :358、`betWeights` :372、`betGuardBounds` :386（G1 唯一实现点）、`deriveOne` :410、`BetScale`/`expectedWindowScale`/`scaleN` :461/:472/:479、`drawBetItems` :615、`deriveBetPool` :668（含 G1b 剔除）、`chooseBetItems` :711（G1c 兜底链）、`buildBetTerms` :731、`parseBetTerms` :780、`loadNamingWindowCounts` :807、`evaluateBetItem` :847、`windowNamingStatements` :1108（结算双路 + 审计 + 奖金现算）。
- **验证**：`tests/naming-bet-terms.test.ts`（22 例：反解 / G1 逐条 / 池装配 / 端到端确定性 / 结算双路）、`tests/naming-bet-scale.test.ts`（8 例：尺度来源回归锁 / 蒙特卡洛达线率带 / 签约→结算闭环 / G3 任意窗数）。

## 5. 明确砍掉（不再讨论）

- 竞品排斥：单队单约，无场景。
- 企业体量/预算：与热度 + 档位名额重复。
- 成立年：无落点。

## 6. 开放问题与拍板记录

1. ~~改名批次与批 1 是否并入同一版本上线~~ → **已拍板（2026-10-15，用户 m00691）：并入 v6.51.0**，一次 apply `0071→0072→0073`（顺序固定）；不改已提交的 0071（73f32e4）。迁移号 0073 及理由见 §1。
2. 撞名核查渠道未打通（WebFetch 证书错误 / cn.bing RSS 不可靠）→ 全虚构池仍可能存在同名异行当。~~已拍板：池内 极星/迅达/星海 不换~~ → **本轮部分消解（2026-10-15，用户 m00932）**：极星运动 → 诺迪运动、迅达通讯 → 埃斯洛通讯（改欧式名后同名问题自然消失）；**星海通讯保留**（中资品牌，拍板不换，与星海钢琴的同名风险维持原状）。天枢/赤兔/鼎沸/济世堂 已随本轮改名下架；新池 22 家欧式名均为造词，**仍未过商标库核验**（建议上线后抽查 3–5 个）。
3. 批 2/3 详稿已完成（本文 §3/§4），实施计划见 `plan-brand-profile-and-style.md`；**待用户审过 28 家配种后确认实施**。
4. 流程门槛（用户 2026-10-15）：「后续批次也让我确认」——批 2、批 3（含改名批次）的详稿与实施都必须先交用户确认，确认前不动手。
5. ~~用户曾提批 1 设计「有几处要改」未指出位置~~ → **已拍板（2026-10-15）：没有了，无修订**。
6. 站内信 `naming_offer_activated` 品牌署名行 → **已拍板：加**（落点见 `plan-brand-profile-and-style.md` §1 S5）。
7. ~~对赌 `bonusRate` 0.7→0.5~~ → **已拍板（2026-10-15，用户 m00783）：0.5**（摊到两项指标各 0.25；§4.7 第 3 条、§4.8 F）。
8. 对赌指标多样化 / 阈值按队相对化 / 强弱平衡（§4.8）→ 设计已两轮：v1 为「逐品牌硬编码指标 + 固定倍率 + 强度系数 k」，v2（现行，用户 m00932「不要硬编码，要随机化但偏向所性格偏好」）= **prefer 加权抽签 + 目标概率反解 + 回测纠偏 + G 节硬护栏**（§4.8 A–G）→ **已拍板（2026-10-15，用户 m01064：「最好还是有个上下限来防护；其他没改的了」）**：首版参数照 §4.8 B（权重表）/C（p 三档 0.34/0.42/0.50）/D（回测带 [0.30,0.55]±0.06）/G（四层护栏）落地。
9. 批 2/3/对赌条款的 28 家配种（档案 + style/prefer）已并入 `plan-brand-profile-and-style.md`（§2/§4），**待用户审过 → 交实施 session 落 0072–0075**；原 §4.5「7 家 bet_terms 配种」随 ④ 取消（改为权重表）。
10. ~~品牌属地（批 2 `hq`）原写中国城市~~ → **已拍板（2026-10-15，用户 m00783）：改欧洲城市**（联赛 20 队为欧洲真实俱乐部，见 `design-growth-tier-auto.md`:53-63）；22 家欧式品牌 28 城映射见 `plan-brand-profile-and-style.md` §2（中资 6 家为中国城市）。
11. 品牌名欧洲化 + 中资特色（§1 改名行）→ **已拍板（2026-10-15，用户 m01064「其他没改的了」）**：22 家改欧式造词名（中文译名 + 拉丁英文名配对）、保留共 6 家中资品牌（全在口碑档，属地中国城市 + 出海叙事）、池 16→28；映射与 SQL 见 `plan-brand-fictionalize-pool.md`。
12. `origin` 归属标记列（批 2 第 7 列）→ **已拍板**（本文 §3.1/§3.2）：管理端 origin select（空 / 中资），随批 2 一并实施。
13. 对赌硬护栏（§4.8 G）→ 用户 m01064 追加「最好还是有个上下限来防护」，**m01131 二次收紧上限（G1）并改触界语义为「剔除重抽」（G1b）**、**m01155 追问「万一没有适用的怎么办」⇒ 新增 G1c 少池/空池兜底链**；四层护栏已定稿（G1/G1b 阈值 / G2 单窗支出 / G3 合同期 / G4 判定 + G5 `dropped`/`guard` 记录），无待拍项。
