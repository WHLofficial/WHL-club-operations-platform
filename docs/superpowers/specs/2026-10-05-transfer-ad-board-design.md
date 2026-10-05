# 转会广告板（Ad Board）设计（2026-10-05）

状态：待用户终审。本文档是脑暴（brainstorming）产物，记录「转会广告板」的最终裁决与改动口径；实施计划另出（/plan）。

一句话：转会中心新增一个公开页面，把**各队挂出的「转会名单」**（`players.transfer_listed = 1`）像广告板一样展示出来，并预留**着重度**（置顶 / 推荐）的展示接口——着重度是为将来的「列入转会名单时的有偿选项」准备的，本版只做读路径，不做付费流程。

## 0. 需求清单与裁决记录

| # | 需求 | 裁决 | 来源 |
| --- | --- | --- | --- |
| 1 | 新页面展示各队「列入转会名单」的球员（类似广告板） | 只收 `players.transfer_listed = 1`；与在售市场（listings 挂牌竞价）互补，不合并挂牌球员 | 用户令 + 四问答复① |
| 2 | 预留不同着重度的展示接口 | 档位 `0 / 1 / 2`（普通 / 推荐 / 置顶）+ 五个视觉杠杆；**为「列入转会名单时的有偿选项」预留**，付费购买流程本版不实现 | 四问答复② + 「展示方式预留上也可以增加例如加粗等的醒目方式」 |
| 3 | 页面位置 | 转会中心导航**第 2 项**（不放最末）；并在在售市场页顶部加一张小卡片（部分球员 + 广告板入口） | 四问答复③ |
| 4 | 价格口径 | 名单内球员的**最低报价数值公开**（新端点下发；区别于 `/api/players` 列表只给布尔位） | 四问答复④ |
| 5 | 命名 | 「转会板」→ **「广告板」**（导航项、页标题、小卡片标题全案统一） | 用户答「2，转会板改广告板，前三位xxxxx文案去掉」 |
| 6 | 页面结构 | **B：顶部精选条（置顶区）+ 普通卡栅格**；无置顶时整条精选带连标题一起消失，不留空 | 用户答「B，但是为什么不能放多个置顶呢？」 |
| 7 | 多个置顶怎么排 | **纵向堆叠**：几条通栏就几行（3 个 = 290px，最省高度） | 用户答「1 纵向堆叠（推荐）」 |
| 8 | 小卡片形态 | **三张迷你卡**（各自名字/队伍/CA·PA/最低报价 + 置顶·推荐角标）；说明文案只留「各队公开挂出的转会名单。」 | 用户答「2，转会板改广告板，前三位xxxxx文案去掉」 |
| 9 | 置顶数量上限 | 本版不设限（接口按档位渲染，几个置顶就几行）；上限属付费流程的产品规则，留给那一步定 | 设计问答记录 |
| 10 | 普通档（无付费加权）的顺序 | **服务端 5 分钟时间桶种子化轮换 + 页面「换一批」手动换序**；付费档（推荐 / 置顶）不参与轮换，位置语义不变 | 用户答「1，也支持用户手动按键变换顺序」（2026-10-05 增补，见 §3.3） |

视觉定稿过程（三屏样张 + 截图）在 brainstorming 视觉伴侣里走完：屏 1 结构三选一、屏 2 置顶区三排法、屏 3 小卡片三形态；下面 §4 是定稿规格，实施时按它写 CSS。

## 1. 页面与入口

### 1.1 广告板页 `/market/board`

- 公开懒加载路由（`web/src/App.tsx`），与 `/market/intel` 等同级。
- 页头：`<h1>转会市场 · 广告板</h1>` + `<MarketNav />`（导航第 2 项「广告板」）。
- 一行说明：「各队公开挂出的转会名单：标价公开，出价达线自动成交，低于自动拒。」
- 正文：
  1. **置顶区**（精选带）：仅当存在 `emphasis = 2` 的行时渲染；标题「置顶 N 个 · 付费位，按到期时间排」+ 通栏卡纵向堆叠。
  2. **普通卡栅格**：`emphasis = 0 / 1` 的行（含全部推荐位）。
  3. 底部图例：复用 `TransferStatusLegend`（清单/拍卖锤/欧元/锁 四态）。
- 空态：「现在没有球队挂出转会名单。」+ 一行「球员被列入转会名单后就会出现在这里。」
- 截断提示：`total > players.length` 时出「共 N 人在名单，这里展示前 M 人」。

### 1.2 在售市场页顶部小卡片（teaser）

- 位置：`web/src/pages/market/MarketBoardPage.tsx` 的 `<MarketNav />` 与「转会区」`<section className="card">` 之间（约 `:38` 与 `:40` 之间）。
- 结构：卡头「广告板」+ 灰角标「N 人在名单」+ 右侧「查看全部 N 人 →」（链 `/market/board`）；说明一行「各队公开挂出的转会名单。」；下面三张迷你卡（排序前 3 位）。
- 迷你卡 → 球员档案（`playerPath`）；迷你卡右上角的清单图标是**状态标记**（`title="转会名单"`），不是链接。
- 无数据（`players.length === 0`）→ **整块不渲染**（不留空卡）。
- 窄屏（≤640px）：只显示前 2 张。

## 2. 数据模型（迁移 `0064_ad_board.sql`）

```sql
-- v6.31.0 转会广告板：列入转会名单的时间戳 + 着重度（置顶/推荐）预留表。
-- 回滚：DROP TABLE player_promotions; DROP INDEX idx_players_transfer_listed;
--       （transfer_listed_at 为附加列，SQLite 不便回滚，保留不影响旧代码）
ALTER TABLE players ADD COLUMN transfer_listed_at TEXT;
CREATE INDEX idx_players_transfer_listed ON players(id) WHERE transfer_listed = 1;
CREATE TABLE player_promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  tier INTEGER NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  ref_type TEXT,
  ref_id INTEGER,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_player_promotions_active ON player_promotions (player_id, ends_at);
```

- `players.transfer_listed_at`：球员**进入**转会名单的时刻（本版只在进名单时打戳；退出置 NULL）。历史存量**不回填**（NULL = 未知，排序里当最旧处理）。
- `player_promotions`：着重度的真源。有效 = `ends_at > now`；一名球员可能有多条（历史 + 现行），读取时取**最高档**，同档取最晚到期。
  - `tier`：1 = 推荐、2 = 置顶（读取时钳到 `0..2`，越界按 0 处理；0 不入表，表里只存 1/2）。
  - `cost / ref_type / ref_id`：付费流程的落点（金额与流水/单据引用），本版只留列不写。
  - `starts_at / ends_at`：付费时长窗口，本版只读。
- `tests/d1.ts` 的 `MIGRATION_FILES` 是**显式数组**（非字典序扫描），必须追加本条。
- 迁移号占用：若并行会话已占用 `0064`，顺延取号并在 docs 留痕。

### 2.1 打戳（写路径，本版唯一）

`src/worker/offers.ts` 的 `setOfferSettings` 单条 UPDATE（约 `:896-899`）改成：

```sql
UPDATE players SET transfer_listed = ?, min_offer_price = ?, offer_auto = ?, not_for_sale = ?,
  transfer_listed_at = CASE WHEN ? = 1 THEN COALESCE(transfer_listed_at, <now>) ELSE NULL END,
  updated_at = <now>
WHERE id = ? AND club_id = ? AND status = 'normal'
```

- 语义：**首次进名单打戳，重复保存保留原戳，退出名单清空**。
- 绑定参数个数 +1（`transfer_listed` 复用同一个值，不新增入参）；`wasNotForSale` 等既有守卫与审计**零改动**。
- 时间字面量沿用本仓口径 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`（与 `src/worker/routes/admin/shared.ts:2` 同字面量）。

### 2.2 本版不做的写路径（留给付费流程）

未来形态二选一（都不在本版）：① `setOfferSettings` 加可选 `promotionTier` 入参；② 新端点 `POST /api/players/:id/promotion`（教练 + 必须开窗 + 扣款走账本 + 审计）。价格与时长**不落 config 键**——本版不编造数字。

## 3. 接口

### 3.1 `GET /api/market/transfer-board?limit=`

写在 `src/worker/routes/market.ts`（公开市场分区，与 `/market/rumors`、`/market/deals` 同段）。

- 公开 + `assertPublicRate(c, 'market')` + `cachedJson('market-transfer-board:<limit>', ttlForScope('market', c.env.PUBLIC_CACHE_TTL_MS), loader, {scope:'market', env, ctx: waitUntilOf(c)})`（**键只有 limit**，不含轮换桶，见 §3.3）。
  - 新鲜度：改报价设置走 `PUT /api/players/:id/offer-settings`，`WRITE_SCOPE_PREFIXES` 里的 `/api/players` 命中 ⇒ 自动 purge 全部公开 scope（含 market）；1h TTL 只是兜底。
- `limit`：默认 200、上限 200（越界钳住，非法值回落默认）。
- 过滤：只取 `players.transfer_listed = 1`。
- 排序：`emphasis DESC` → `transfer_listed_at DESC`（NULL 当最旧）→ `id DESC`；**缓存里存的就是这个 SQL 序**，出缓存后再把 `emphasis = 0` 的普通档按时间桶洗牌（§3.3），付费档保持本序。
- 载荷：`{ players: TransferBoardRow[], total: number }`（`total` = 名单总人数，用于「查看全部 N 人」与截断提示）。

行字段（`TransferBoardRow`）：

| 字段 | 来源 | 备注 |
| --- | --- | --- |
| `id` / `uid` / `fcId` | `players` | 链接走 `playerPath` |
| `name` | 派生显示名（与列表同口径） | 前端标题行 |
| `positions` | `position + pos1..pos4` 去重去空 | 位置码，如 `ST` |
| `age` / `ca` / `pa` | `players` | 卡内大数字 |
| `clubId` / `clubName` | `clubs` | 副标题「ST · 24 岁 · 曼城」+ 队徽 |
| `minOfferPrice` | `players.min_offer_price` | **数值公开**（本版口径） |
| `releaseFee` | 现行合同 `contracts.release_fee`（`is_active = 1`，LEFT JOIN） | 无合同 → null → 显示「—」 |
| `listedAt` | `players.transfer_listed_at` | 「挂出 …」 |
| `emphasis` | `player_promotions` 现行最高档 | `0 / 1 / 2` |
| `emphasisUntil` | 同上的 `ends_at` | 仅 `emphasis = 2` 显示「置顶到 MM-DD」 |
| `status` / `notForSale` / `transferPriced` | `players` | 与 `/api/players` 列表行**同名字段**，供前端复用 `transferStatusOf` 渲染状态图标 |

`emphasis` 取现行的 SQL（`<now>` = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`）：

```sql
LEFT JOIN (
  SELECT player_id, tier, ends_at FROM (
    SELECT player_id, tier, ends_at,
           ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY tier DESC, ends_at DESC, id DESC) AS rn
    FROM player_promotions WHERE ends_at > <now>
  ) WHERE rn = 1
) pm ON pm.player_id = p.id
```

### 3.2 不做的接口改动

- `/api/players` 列表**不下发**最低报价数值（既有口径不变，v6.30.0 注释「隐藏门槛不进公开面」仍成立）；广告板是唯一的公开数值出口。
- 挂牌球员（listings）不合并进广告板。

### 3.3 普通档轮换与「换一批」（2026-10-05 增补）

来源：用户问「列入转会名单但没有有偿提升优先级的，每次展示顺序随机？」⇒ 裁决 = **服务端时间桶轮换 + 页面手动换序**（§0 第 10 条）。

- **为什么随机必须种子化**：同一份缓存值会被多个 isolate / colo 读到，而「换桶」并不经过缓存失效（见下条）。若用 `Math.random()`，同一时刻不同 isolate 会给出不同排列 ⇒ 同一用户在相邻两次请求里看到顺序抖动。种子 = 时间桶号，任何 isolate 在同一桶内必得同一排列。
- `src/core/ad-board.ts`（新文件，纯函数、可单测）：
  - `TRANSFER_BOARD_ROTATE_MS = 5 * 60_000`；
  - `transferBoardBucket(nowMs) = Math.floor(nowMs / TRANSFER_BOARD_ROTATE_MS)`（约 5 分钟一桶，整桶内顺序稳定）；
  - `shuffleWithSeed(rows, seed)`：`mulberry32(seed)` 驱动的 Fisher–Yates，返回新数组、不改入参。
- 端点（`src/worker/routes/market.ts`）：**缓存键只有 limit**（`market-transfer-board:<limit>`），洗牌放在 `cachedJson` 之后做 —— 读缓存拿到 SQL 序，再按 `emphasis !== 0` / `emphasis === 0` 分流，**只洗普通档**：`[...paid, ...shuffleWithSeed(unpinned, transferBoardBucket(Date.now()))]`。付费档（推荐 / 置顶）保持 SQL 序 —— 付费位的相对位置与「按到期时间排」语义不受轮换影响。
  - **为什么洗牌不进 loader、桶号不进缓存键**：读量预算是硬纪律（`src/lib/cache-policy.ts:5-7`：每天最坏重读 = 86400 ÷ TTL，按形状、按 colo）。桶号进键会把本端点重读从 `86400 ÷ 1h = 24` 抬到 `86400 ÷ 5min = 288` 次/天/形状/colo（**12 倍**）。洗牌是 O(名单人数) 的纯函数，放在缓存之外后重读回到 24 次基线；代价是每次请求多一次数组复制与分流（可忽略）。
  - 代价（登记不改）：`limit` 形状无白名单，对抗性枚举 `limit=1..200` 时最坏读量 = 288 × 200 × L 行/天/colo（详见测试计划 §7.4 读量核算）。
- SQL 的 `... id DESC` 尾键是洗牌的**输入序**：它保证任何 isolate 从缓存/库里拿到同一输入；洗牌是纯函数 ⇒ 输出一致。
- 页面（`web/src/pages/market/MarketAdBoardPage.tsx`）：说明行右侧「换一批」按钮（`ShuffleIcon`，仅当普通档 ≥ 2 时渲染）。点击用 `Math.random()` 重排**本地**普通档（最多试 8 次取第一个与当前不同的排列，兜底 `reverse()`）—— 纯客户端、不打端点、不动付费档。
  - 状态只存 id 序列（`manualIds`）而非行对象；守卫 `manualIds.length === unpinned.length && manualIds.every((id) => byId.has(id))` 不成立即回落服务端桶序 ⇒ 名单变长/变短都不会丢卡、错位或重复。
  - 重挂载或重新取数后回到服务端桶序（手动序不持久化，属预期行为）。
- 本版不承诺的：轮换不保证「每桶人人换位」（2 人档洗牌可能恰好同序）、不承诺跨桶公平分布；桶长 5 分钟是产品口径，不是排序公平性保证。

## 4. 视觉规格（定稿）

### 4.1 卡片骨架（类名前缀实施时用 `.adb-*`）

```
.adb-card
├─ .adb-card-head   [队徽 22px] [名字]  …右…  [角标 置顶/推荐] [状态图标 16px]
├─ .adb-sub         ST · 24 岁 · 曼城
├─ .adb-body        ├─ .adb-rail  CA 94 / PA 95（大数字，左侧竖线）
│                   └─ 最低报价 180.00 M / 违约金 240.00 M（右对齐，金额加粗）
└─ .adb-card-foot   挂出 2 天前                    置顶到 10-12
```

- 栅格：`repeat(auto-fill, minmax(min(100%, 250px), 1fr))`，gap 12px（照 `.mkt-grid`）。
- 卡片：`--card` 底、1px `--border`、radius 14px、padding 12px 14px；hover 边框 `--terracotta` + `0 6px 18px rgba(43,29,18,.12)` + `translateY(-1px)`（照 `.mkt-card`）。
- CA/PA 大数字沿用既有 `.attr-*` 色阶；金额用 `--gold-deep` 加粗；「挂出 / 置顶到」用 `--muted`（置顶到期用 `--gold-deep`）。
- 时间显示：**只走 `web/src/lib/datetime.ts`**（守 `tests/datetime-display.test.ts` 的单点化不变量）。相对时间新增 `fmtAgo(iso)`（今天 / 昨天 / N 天前）+ `TimeFmt.ago`，页面不得自己算；「置顶到」用 `fmtDate`。

### 4.2 着重度：三档、五个视觉杠杆

| 档位 | 名字 | 视觉（杠杆组合） |
| --- | --- | --- |
| 0 | 普通 | 奶白底 + 细边框 + 名字 600（站内既有卡片的默认态） |
| 1 | 推荐 | **① 名字加粗 800** + **② 金色左轨**（`border-left: 3px solid var(--gold)`）+ **③ 橙色角标「推荐」**（`.badge.orange`） |
| 2 | 置顶 | **④ 移入置顶区**（通栏卡：金色描边 + 淡金渐变底 + 队徽 40px + 名字 21px/800）+ **③ 金色角标「置顶」**（`.badge.gold`）+ 脚部「置顶到 MM-DD」 |

**⑤ 排序权重**（`emphasis DESC`）是第五个杠杆：档位越高越靠前，置顶还额外被提到独立区块。

五个杠杆都是**独立开关**：未来加档（例如 tier 3）只需加一个 CSS 类 + 一处映射，不改数据模型；付费流程将来只负责往 `player_promotions` 写行。

### 4.3 置顶区（精选带）

- 标题行：`置顶 N 个 · 付费位，按到期时间排`（`--muted` 小字），**无置顶时整条带子连标题一起消失**。
- 排法：**纵向堆叠**——每个置顶一张通栏卡，几条就几行（实测 3 个 = 290px）。
- 通栏卡内部横向排布：队徽 + 名字 + 角标 | CA/PA | 最低报价 / 违约金 | 挂出 + 置顶到（右侧）。

### 4.4 小卡片（teaser）

- 卡头：「广告板」+ 灰角标「N 人在名单」+ 右侧「查看全部 N 人 →」。
- 说明：`各队公开挂出的转会名单。`（**不要**「前 3 位按着重度排」）。
- 三张迷你卡：`grid 3 列`；每张 = 名字 + 角标（置顶/推荐）+ 状态图标 / 队伍 · 位置 · 年龄 / CA·PA + 最低报价。
- 迷你卡的着重度照 §4.2 的杠杆降级复用：推荐 = 金色左轨 + 角标；置顶 = 金色描边 + 淡金底 + 角标。

### 4.5 窄屏（375）

- 页签条：`MarketNav` 已有横滑形态（`.seg`），新增第 2 项后仍横滑，不换行。
- 广告板：栅格自动降为 1 列；置顶通栏卡内部数字换行，不横溢。
- teaser：只留前 2 张迷你卡（第 3 张隐藏），报价允许换行。
- 375 零横溢是 e2e 闸（`scripts/e2e/smoke.mjs` ⑫ 的路由清单要加 `/market/board`）。

## 5. 复用与既有约束

- 状态图标与图例：`web/src/components/StatusIcons.tsx`（`TransferStatusCell` / `TransferStatusLegend`，v6.30.0）。
- 状态判定：`web/src/lib/club-columns.tsx` 的 `transferStatusOf`（非卖品 > 挂牌中 > 转会名单 > 已标价）。
- 球员链接：`web/src/lib/player-link.ts` 的 `playerPath`（禁止手写模板串）。
- 队徽：既有球队 logo 组件（与 `.mkt-card` 同款用法）。
- 查询层：`web/src/lib/queries.ts` 加 `qk.transferBoard` + `useTransferBoard(limit)`（`staleTime 60s`、`retry: false`）。
- 时间：`web/src/lib/datetime.ts`（新增 `fmtAgo`）。
- 迁移登记：`tests/d1.ts` 的 `MIGRATION_FILES` 显式数组。

## 6. 明确不做（本版）

1. **付费购买流程**（买着重度）：不写 `player_promotions`、不加价格/时长 config 键、不做下单入口。
2. 挂牌球员（listings）合并进广告板；筛选 / 搜索 / 排序控件；分页（超 200 只提示不翻页）。
3. `/api/players` 列表下发最低报价数值。
4. 历史 `transfer_listed_at` 回填。
5. 置顶数量上限的产品规则（付费流程时再定）。

## 7. 验收口径（细节留给实施计划）

- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` 全绿（基线 87 文件 / 1452 例）；`npm run build` 成功；dev 8791 + `npm run test:e2e` 21/21（含 ⑫ 375 零溢出新路由）。
- 测试计划：`docs/test-plans/v6.31.0-ad-board.md`（qa-test-planner）。
- 变异验证：至少覆盖「进名单不打戳 / 重复保存覆盖原戳 / 退出不清戳 / 排序丢着重度 / 现行推广判定去掉 `ends_at > now` / 取最高档改成取最低档 / teaser 空态仍渲染 / 置顶区无数据仍留标题 / 375 溢出」。
- 评审：code-review-skill；docs 收口（CHANGELOG / ROADMAP / AGENTS + `package.json` bump 6.31.0）；分枚本地 commit（**不 push**，发布等令；发布顺序：先 `npm run db:migrate:remote` apply `0064` 再 push）。
- **2026-10-05 收口实测**（含 §3.3 轮换增补，及评审 P1-2 后的机制复跑）：`npm run typecheck` 三份全清；`npx vitest run` 89 文件 / 1491 例全绿；`npm run build` 成功（4.02s，入口 608.52 kB / gzip 193.33 kB）；e2e **22/22**（新增 ⑤e 广告板场景、⑫ 375 零溢出 29 路由）；变异 M1–M24（测试计划 §3）+ M25–M35（§7.3，轮换与手动换序）全部判红。
