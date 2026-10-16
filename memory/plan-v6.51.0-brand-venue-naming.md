# 实施计划：批 1 冠名上球场（v6.51.0 增量 · 迁移 0072）

关联设计：`memory/design-brand-pool-structure.md`（批 1 已锁版；批 2/3 详稿）。本文供实施 session 直接执行；行号 = 当前工作区现状（v6.51.0 未发布），动手时以 grep 复核。

## 0. 前提与铁律

- 仓库：`C:\Users\bhdjb\whlprogram\WHL-club-operations-platform`，package.json 版本 `6.51.0`。
- `0071_brand_pool_expand.sql` 尚未 apply 生产；`naming_contracts` 生产实测 0 行 ⇒ 0072 无回填、无存量风险。
- 迁移不写 BEGIN/COMMIT（执行器自包事务）；只加列；不追改历史快照。
- 全字段可空、空即回退现状（老合同 venue_name='' 展示回退，天然兼容）。
- 小步提交；完成后按用户全局规则跑 code-review-skill 审查、修复后复测全绿。

## 1. 命令

| 用途 | 命令 |
|---|---|
| 单测 | `npm run test`（vitest run） |
| 类型 | `npm run typecheck`（tsc ×3：根 / worker / tests） |
| e2e | `npm run test:e2e`（node scripts/e2e/smoke.mjs） |
| 本地迁移 | `npm run db:migrate:local` |
| 生产迁移 | `npm run db:migrate:remote` |
| 生产状态核对 | `npx wrangler d1 migrations list whl-club --remote` |

## 2. 步骤

### S1 迁移 0072 + 注册

- 新建 `src/db/migrations/0072_brand_venue_naming.sql`：

```sql
ALTER TABLE naming_contracts ADD COLUMN venue_name TEXT NOT NULL DEFAULT '';
```

- `tests/d1.ts` 的 `MIGRATION_FILES` 数组（:84 起，现止于 :155 `'0071_brand_pool_expand.sql'`）末尾追加 `'0072_brand_venue_naming.sql'`。
- 验收：`npm run test` 全绿（含迁移重放）；`npm run db:migrate:local` 通过。

### S2 组合规则 helper

- `src/worker/naming-ops.ts` 新增导出（建议放 `namingBaseFee` :61 附近）：

```ts
export function composeVenueName(brand: string, stadiumName: string): string {
  return stadiumName ? `${brand}·${stadiumName}` : '';
}
```

- 放 naming-ops.ts 的理由：market-ops.ts :20-33 已 import 该文件一批函数，无需新依赖方向。
- 验收：单测断言 `composeVenueName('天枢', '工人体育场') === '天枢·工人体育场'`、空球场名返回 `''`。

### S3 写入点 3 处（签约/转正/续约时点取当刻球场名）

3a **新签** `src/worker/market-ops.ts:437 acceptOffer`（INSERT 在 :602）：
- offer 查询（:447 已 join brand_pool）补 join `stadiums`，取 `s.name`；INSERT 列序与 :602 现状对齐，末尾增 `venue_name` = compose 结果。

3b **接班转正** `src/worker/market-ops.ts:297 activateQueuedStatements`（SELECT :310，INSERT :343）：
- :310 的 SELECT 补 join stadiums；INSERT 增 `venue_name`；`activated[]`（:330 附近）条目加 `venueName`（S4e 通知供料用）。

3c **续约** `src/worker/naming-ops.ts:179 renewNaming`（UPDATE :214）：
- 该函数已持有球场参数（容量/死忠），补取 `stadiums.name`；UPDATE 增 `venue_name = ?`。
- 验收：三个写入点由 S6 测试断言覆盖。

### S4 读侧后端

- 4a **主场档案** `src/worker/routes/clubs.ts:679-700`：返回体加 `namingVenueName`（类型行 :679 同步）= `naming ? (naming.venue_name || composeVenueName(naming.brand, home.name)) : null`。
- 4b **合同 DTO** `namingContractDto`（:1099）加 `venueName: row.venue_name`。
- 4c **报价预览** `quoteBrands`（naming-ops.ts:157）增 `stadiumName` 入参，返回项加 `venueName`；调用点全集 grep `quoteBrands` 同步（含 routes/clubs.ts:1157 续约预览；quote 路由 :1143 已取 capacity/fans，一并取 stadiums.name）。
- 4d **收到的报价** `listClubOffers`（market-ops.ts:92，已 join brand_pool）补 join stadiums 并 compose；`offerDto`（routes/clubs.ts:1120）加 `venueName`。
- 4e **站内信** `src/worker/notify.ts:109-110`：文案改

```
✅ 品牌接替生效：「${data.venueName}」正式启用（${data.pkgName}套餐，${data.feePerWindow}M/窗 × ${data.windows} 窗）。
```

  供料点 `src/worker/home.ts:767` 与 `src/worker/routes/clubs.ts:1200` 补 `venueName`；venueName 为空（球场名空）时文案回落现状「「${brand}」冠名 ${club}」。（`naming_offer` :760 招商期开启文案不动。）
- 4f **fixtures 公开面** `src/worker/weather-ops.ts:81 buildRoundView`（球场 SELECT 在 :94）：加查本场次 club 的 active 冠名（`naming_contracts` WHERE status='active'），stadium 对象新增 `venueName`（快照 ‖ compose；无冠名 `''`）；`name` 语义不变。类型定义同步。消费点 routes/fixtures.ts:29/:38 不改逻辑。
- 4g 管理端（BrandsPage/ClubsPage）与账本不动。
- 验收：`npm run typecheck` 三连通过 + S6 测试。

### S5 前端

- 5a `web/src/lib/api.ts`：HomeProfile（:107 `namingBrand` 处）加 `namingVenueName: string | null`；`NamingContract`（:1352）加 `venueName`；BrandQuote 与报价行类型加 `venueName`；fixtures 消费类型如有同步。
- 5b `web/src/pages/club/VenueTab.tsx:23`：显示改为 `home.namingVenueName || home.name || '未冠名'`（不再前端自拼）。
- 5c `web/src/pages/shop/venueCards.tsx`：冠名市场合同卡标题用 `contract.venueName || contract.brand`；报价卡在 `venueName` 非空时加一行「签下将命名为 {venueName}」。
- 5d `web/src/pages/ClubDetail.test.tsx:287` fixture 加 `namingVenueName: null`，并补一条有冠名时显示冠名名的断言。
- 验收：`npm run test` 的 web 用例全绿 + `npm run typecheck`。

### S6 测试断言（后端）

- `tests/market-rounds.test.ts`：签约（acceptOffer）后 `naming_contracts.venue_name` = 「品牌·球场名」；queued 接班转正同断言。
- `tests/naming-ops.test.ts`：续约后 venue_name 按当刻球场名刷新；解约后读侧回原名。
- `tests/event-ops.test.ts`：fixtures/主场档案带 `venueName` 字段（按现有事件用例就近补）。
- `scripts/e2e/smoke.mjs`：补一步——签约（或接班转正）后 `/me/club` 的 `namingVenueName` 含「·」且等于「品牌·球场名」。

### S7 文档同步

- `CHANGELOG.md`（v6.51.0 未发布条目：冠名上球场一行）、`AGENTS.md`、`ROADMAP.md`、`TECH_DESIGN.md`、`memory/plan-v6.51.0-forced-auction-and-brand-pool.md`；本文件与 design 文档标注状态。

## 3. 上线与回滚（生产）

1. `npx wrangler d1 migrations list whl-club --remote` 核对 0071 已否 apply。
2. 未 apply ⇒ `npm run db:migrate:remote`（改名批次已拍板同版并入：一次带上 `0071→0072→0073`，顺序固定；**若同一发布内也落批 2/3 则顺序 `0071 → 0072 → 0073 → 0074 → 0075`**）；已 apply ⇒ 跑剩余的 0072 起。
3. push 前核对该仓是否接 Cloudflare Git 自动部署：接了则 push 即生产（部署后回读验证）；没接则 `npm run deploy`。
4. 回读：`/api/fixtures` 见 `venueName`、有冠名球队 `/me/club` 见 `namingVenueName`。
5. 回滚：`git revert` 代码提交即可；新增列留空无害（展示回退现状格式）。

## 4. 未决项（不阻塞本批）

- 改名批次（`plan-brand-fictionalize-pool.md`，迁移 0073）——**已拍板并入本次上线**（一次 apply `0071→0072→0073`；0071 已提交 73f32e4 故不改）；**已拍板（用户 m01064）：全池欧洲化 22 家欧式造词名 + 6 家中资特色，池 16→28**（新名表见该文件 §1）。
- 批 2 企业档案（0074，含 `origin` 列共 7 列）、批 3 招商性格（0075：`style`/`prefer` + `naming_contracts.bet_terms` 三列；对赌指标改抽签、不建 `brand_pool.bet_terms`）详稿已完成（design 文档 §3/§4/§4.8）——**28 家配种 + 抽签参数 + 硬护栏 已全部拍板（用户 m01064）**，实施计划见 `plan-brand-profile-and-style.md`，可交实施 session。
- 品牌属地：欧式 22 家为欧洲城市、中资 6 家为中国城市（用户 m00783 + m00932）——**已拍板**，数据随 0074（`plan-brand-profile-and-style.md` §2）。
- 撞名核查渠道未打通（WebFetch 证书错误 / cn.bing RSS 不可靠）——欧式 22 名为造词、**未经商标库核验**；极星/迅达 已随改名消解同名，星海通讯（中资）保留为已拍板项。
- ~~用户曾提批 1 设计「有几处要改」未指出位置~~——**已拍板「没有了」**，无修订。
- 站内信 `naming_offer_activated` 署名行——**已拍板：加**（落点见 `plan-brand-profile-and-style.md` §1 S5）。
- 对赌 `bonusRate` 0.7→0.5 —— **已拍板 0.5**；对赌指标多样化 + 随机化抽签（prefer 加权）+ 按队概率反解阈值 + **四层硬护栏** —— **已拍板（用户 m01064）**，首版参数照 design §4.8 B/C/D/G 落地。
- **实施提示词已备**：`memory/prompt-brand-pool-implementation.md`（0072–0075 全链，可直接交新实施 session；含硬约束、护栏、验收与「不 push/不部署」边界）。
