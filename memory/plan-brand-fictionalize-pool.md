# 实施计划：品牌池全虚构化 + 欧洲化（22 家欧式改名 · 6 家中资特色 · 池 16→28 · 迁移 0073）

关联设计：`memory/design-brand-pool-structure.md`（§1 批次表）。批 1 计划：`memory/plan-v6.51.0-brand-venue-naming.md`。批 2/3 计划：`memory/plan-brand-profile-and-style.md`。行号 = 当前工作区现状（v6.51.0 未发布），动手前以 grep 复核。

## 0. 现状与前提

- `src/db/migrations/0071_brand_pool_expand.sql` 已提交（commit 73f32e4），内容 = 池 7→16（CVS Health → 西维斯健康 + 9 家新增），尚未 apply 生产。
- 因此**不改 0071**（本地/CI 库可能已应用，改已入库文件会让各环境静默分叉）；本轮批次独立开 **0073**。
- 生产 `naming_contracts` 0 行；`market_offers` 走 `brand_id`（0055）⇒ 改名影响面 = `brand_pool` + `naming_contracts.brand` 文本兜底。
- 热度/行业/档位全不动 ⇒ 档位校准、名额、行业系数零变化。
- 迁移不写 BEGIN/COMMIT（同 0059/0069/0070/0071 约定）；独立文件用 `IN ('CVS Health','西维斯健康')` 兜底（新库经 0071 已改名也无害，幂等重跑安全）。

**本轮两项指令（2026-10-15，用户 m00932 + 追补）**

1. 品牌名**欧洲化改造**：联赛 20 队为欧洲真实俱乐部（`design-growth-tier-auto.md`:53-63），属地已改欧洲城市（`plan-brand-profile-and-style.md` §2），名字仍是中国古典语义（天枢/烛龙/精卫/济世堂）会穿帮 ⇒ 22 家改欧洲造词名（中文译名 + 拉丁英文名配对）。
2. 作为**特色加入中国化品牌**：保留 6 家中国品牌（4 家既有 + 2 家新增），属地为中国城市、简介写「中资出海赞助欧洲赛场」，构成「大部分欧洲品牌 + 少量中资品牌」的真实结构；`origin` 列标记（见批 2 `plan-brand-profile-and-style.md` §1/§2）。
3. 中国化品牌全部落在**口碑档**（低热度），与真实世界「中资多为中腰部赞助」观感一致；头部 3 家（1.0 以上）仍为欧洲品牌。

## 1. 28 家全池清单（改名 + 扩编后）

| 档位 | 品牌 | 字数 | 英文名 | 行业 | 热度 | 属地 | 归属 | 来源 |
|---|---|---|---|---|---|---|---|---|
| 头部 | 奥维恩（原亚马逊） | 3 | OVIEN | 科技 | 1.3 | 都柏林 | 欧洲 | 改名 |
| 头部 | 凯利昂生物（原麒麟生物） | 5 | CALEON BIO | 医疗 | 1.2 | 巴塞尔 | 欧洲 | 改名 |
| 头部 | 维洛（原阿迪达斯） | 2 | VILO | 运动 | 1.1 | 纽伦堡 | 欧洲 | 改名 |
| 新兴 | 斯科尔汽水（原可口可乐） | 5 | SKOLL | 饮食 | 1.0 | 格拉斯哥 | 欧洲 | 改名 |
| 新兴 | 诺迪运动（原极星运动） | 4 | NODI | 运动 | 0.95 | 赫尔辛基 | 欧洲 | 改名 |
| 新兴 | 维斯兰科技 | 5 | VESLAN | 科技 | 0.93 | 埃因霍温 | 欧洲 | 新增 |
| 新兴 | 维奥莱饮品（原鲸涛饮品） | 5 | VIOLEY | 饮食 | 0.91 | 维希 | 欧洲 | 改名 |
| 新兴 | 洛森餐饮（原海底捞） | 4 | LOSEN | 饮食 | 0.9 | 柏林 | 欧洲 | 改名 |
| 新兴 | 瓦隆酿造 | 4 | WALLON | 饮食 | 0.90 | 布鲁塞尔 | 欧洲 | 新增 |
| 口碑 | 塞拉越野 | 4 | SELA | 运动 | 0.89 | 霞慕尼 | 欧洲 | 新增 |
| 口碑 | 长风汽车 | 4 | CHANGFENG | 汽车 | 0.88 | 上海 | **中资** | 既存 |
| 口碑 | 诺德保险 | 4 | NORDIS | 金融 | 0.87 | 苏黎世 | 欧洲 | 新增 |
| 口碑 | 白马体育 | 4 | BAIMA | 运动 | 0.86 | 晋江 | **中资** | 既存 |
| 口碑 | 泰拉蒙汽车 | 5 | TERRAMONT | 汽车 | 0.86 | 慕尼黑 | 欧洲 | 新增 |
| 口碑 | 埃斯洛通讯（原迅达通讯） | 5 | ESLÖ | 科技 | 0.84 | 埃斯波 | 欧洲 | 改名 |
| 口碑 | 瑟兰制药 | 4 | CERALAN | 医疗 | 0.84 | 萨勒诺 | 欧洲 | 新增 |
| 口碑 | 洛朗烘焙坊 | 5 | LORAN | 饮食 | 0.83 | 里昂 | 欧洲 | 新增 |
| 口碑 | 青云乳业 | 4 | QINGYUN | 饮食 | 0.82 | 呼和浩特 | **中资** | 既存 |
| 口碑 | 精卫重工 | 4 | JINGWEI | 制造 | 0.81 | 长沙 | **中资** | 新增 |
| 口碑 | 星海通讯 | 4 | XINGHAI | 科技 | 0.8 | 深圳 | **中资** | 既存 |
| 口碑 | 罗讷银行（原磐石银行） | 4 | RHÔNA | 金融 | 0.79 | 日内瓦 | 欧洲 | 改名 |
| 口碑 | 霜降茶业 | 4 | SHUANGJIANG | 饮食 | 0.78 | 杭州 | **中资** | 新增 |
| 口碑 | 比特兰科技 | 5 | BITLAN | 科技 | 0.76 | 塔林 | 欧洲 | 新增 |
| 口碑 | 莱茵斯重工（原天工重工） | 5 | RHEINS | 制造 | 0.74 | 杜伊斯堡 | 欧洲 | 改名 |
| 口碑 | 梅尔泽证券 | 5 | MELZER | 金融 | 0.74 | 法兰克福 | 欧洲 | 新增 |
| 口碑 | 埃尔巴草本（原西维斯健康） | 5 | ERBA | 医疗 | 0.7 | 帕多瓦 | 欧洲 | 改名 |
| 口碑 | 阿尔维文旅 | 4 | ALVI | 文旅 | 0.70 | 卢塞恩 | 欧洲 | 新增 |
| 口碑 | 奥拉维文旅（原星野文旅） | 5 | OULAVI | 文旅 | 0.68 | 罗瓦涅米 | 欧洲 | 改名 |

- 构成：**22 家欧洲品牌 + 6 家中资品牌**（长风汽车/白马体育/青云乳业/精卫重工/星海通讯/霜降茶业），中资全部在口碑档。
- 字数错落：2 字×1（维洛）/ 3 字×1（奥维恩）/ 4 字×14 / 5 字×12。
- 本轮改名顺带消掉两处「同名异行当」：极星运动（Polestar 中文名）→ 诺迪运动、迅达通讯（迅达电梯）→ 埃斯洛通讯；**星海通讯保留**（已拍板不换；中资身份下「星海」读作中国企业名，与星海钢琴的同名风险维持原状）。
- 中英配对：欧洲品牌用拉丁造词（非真实公司名），中资品牌用拼音（CHANGFENG/BAIMA/QINGYUN/JINGWEI/XINGHAI/SHUANGJIANG）。22 家欧式名均为造词，无撞名核查渠道（见 §5）。

## 2. 迁移 0073（新建 `src/db/migrations/0073_brand_fictionalize.sql`）

```sql
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
```

## 3. 落地同步清单（引用点已逐个核过）

- `tests/d1.ts`：`MIGRATION_FILES` 数组（:84 起）末尾注册 `'0073_brand_fictionalize.sql'`（0072 若先合入则排其后）。
- `tests/naming-ops.test.ts`：:98 种子名单断言 + fixture 里的 亚马逊/阿迪达斯/可口可乐/海底捞 → 新名（奥维恩/维洛/斯科尔汽水/洛森餐饮）；16 家计数 → 28。
- `tests/market-rounds.test.ts`：亚马逊（:293/:404/:408/:484/:512）→ 奥维恩、阿迪达斯（:410/:430/:434）→ 维洛、可口可乐（:444–455/:527/:533）→ 斯科尔汽水、海底捞（:534）→ 洛森餐饮、西维斯健康（:482/:545）→ 埃尔巴草本，以及 offerCount 相关口径（16→28）。
- `tests/event-ops.test.ts`：可口可乐 8 处（:324/:552/:575/:736–747/:830/:1224）→ 斯科尔汽水（含热度断言 1.05/1.35/1.5 保持不变）。
- `scripts/e2e/smoke.mjs`：:3556 标题「16 家中文品牌」→ 28 家；:3613–3620 `includes('西维斯健康') && !includes('CVS Health')` → 改为虚构名口径（断言全池无真实品牌名 + 含中资 6 家之一）。
- 文档：`AGENTS.md`:119、`CHANGELOG.md`（并入 v6.51.0 未发布条目，不改历史条目）、`ROADMAP.md`:119/:276/:528/:1513、`memory/plan-v6.51.0-forced-auction-and-brand-pool.md`:11/:48。
- 批 2/3 档案与性格 SQL 用新名书写（`plan-brand-profile-and-style.md` §2/§4），迁移顺序固定 `0071 → 0072 → 0073 → 0074 → 0075`。

## 4. 实施步骤与验收

1. 新建迁移 0073 → `tests/d1.ts` 注册 → `npm run test`（vitest run，含迁移重放）/ `npm run typecheck` / `npm run db:migrate:local` 全绿。
2. 按 §3 同步测试与文档 → 复测全绿 → 按全局规则跑 code-review-skill 审查、修复后复测。
3. 上线：`npx wrangler d1 migrations list whl-club --remote` 核对 → `npm run db:migrate:remote`（**已拍板并入 v6.51.0**：一次带上待应用的 0071→0072→0073，顺序固定）→ push（先核该仓是否接 Cloudflare Git 自动部署）/ `npm run deploy`。
4. 回读：`/api/admin/brands` 见 28 家（22 欧式 + 6 中资）、全为虚构名；grep 生产数据无 `亚马逊|阿迪达斯|可口可乐|海底捞|CVS`。
5. 回滚：按迁移尾部注释反向执行（纯数据操作，无结构变更）。

## 5. 悬置（如实提醒）

- 撞名核查渠道仍未打通（WebFetch 证书错误 / cn.bing RSS 不可靠）。22 家欧式名全部为造词（OVIEN/VILO/SKOLL/CALEON/NODI/VESLAN/VIOLEY/LOSEN/WALLON/SELA/NORDIS/TERRAMONT/ESLÖ/CERALAN/LORAN/RHEINS/RHÔNA/MELZER/ERBA/ALVI/OULAVI/BITLAN），按构造不指向真实公司，但**未经商标库核验**；建议上线后用商标渠道抽查 3–5 个。
- 中资 6 家为中国风格命名（长风汽车/白马体育/青云乳业/精卫重工/星海通讯/霜降茶业），其中 星海（星海钢琴）、精卫（无同名公司）——**星海通讯保留**为已拍板项；如后续仍想全池零碰瓷可再开一轮（未做）。
