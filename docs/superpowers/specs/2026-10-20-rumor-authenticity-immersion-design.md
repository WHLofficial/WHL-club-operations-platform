# 转会中心「传闻」真实性与沉浸感改造设计

- 状态：待评审（设计稿，不含实现）
- 日期：2026-10-20（**rev4**：按第三轮独立复核 17 条修订；rev3 按第二轮 10 条；rev2 按第一轮 14 条与作者侧 21 条整理；rev1 为 788 行初稿）
- 范围：`src/worker/rumors.ts`、`GET /api/market/rumors`、`web/src/pages/market/MarketIntelPage.tsx`、`web/src/lib/queries.ts`、`web/src/lib/api.ts`
- 不改：数据库结构（P0/P1）、成交表列结构、MarketNav、`/clubs/:id` 的登录策略

---

## 1. 现状诊断

### 1.1 机制事实（读码所得）

| 事实 | 证据 |
| --- | --- |
| 种子只含 `[season, windowSeq]`，头注释承诺「同窗 8 条逐字稳定、刷新不变」 | `src/worker/rumors.ts:2-3`、`:187` |
| 载荷五键：`id/text/playerId/playerName/clubName`，无时间、无来源、无 clubId | `src/worker/rumors.ts:29-37`、`web/src/lib/api.ts:965-971` |
| 响应类型是 `{ rumors }`，没有第二个字段 | `web/src/lib/api.ts:973-974` |
| 前端 `useRumors` 的 queryFn 只取 `.rumors`，响应里多出来的字段会被直接丢弃 | `web/src/lib/queries.ts:253-260` |
| id 规则 `r{season}-{windowSeq}-{slot}`，槽位 0..7 | `src/worker/rumors.ts:39`、`:199` |
| 每槽独立 50% 判真 | `src/worker/rumors.ts:200` |
| 真料只认在售池（`listed/bidding/matched_pending`）与近 30 条四类成交；在售非空时成交池不可达 | `src/worker/rumors.ts:128-134`、`:140-149`、`:202`、`:204` |
| 成交类型白名单不含 `match` / `rc_change` | `src/worker/rumors.ts:147` |
| 两条事实查询都不按 season/window 过滤，也不按锚点对齐公开页窗口 | `src/worker/rumors.ts:128-134`、`:140-149` |
| 假料球员按 id 抽样、3 轮、只过滤 `p.status != 'retired'`；假料队名从整张 clubs 表抽 | `src/worker/rumors.ts:154-175`、`:177`、`:40-44`、`:232-233` |
| 假料守卫：禁现东家 + 与两池撞组合 | `src/worker/rumors.ts:235`、`:238-243` |
| 三轮撞真实关系则丢槽，条数 0-8 | `src/worker/rumors.ts:255` |
| 端点先 `assertPublicRate(c,'market')`，再 `resolveRumorWindow`（在 `cachedJson` 之前），缓存键 `market-rumors:{season}:{windowSeq}`、TTL 1h | `src/worker/routes/market.ts:330-337`、`src/lib/cache-policy.ts:24` |
| 写路径（`/api/market`、`/api/players` 前缀的非 GET 2xx）会 bump 代际并 purge 公开缓存 | `src/worker/index.ts:59-68`、`src/lib/cache-policy.ts:58-70`、`src/lib/guard.ts:218` |
| 无开窗时回退 `(visibleSeason ?? 0, 0)` | `src/worker/rumors.ts:22-27` |
| 前端 8 行复用 `.form-row`（flex 行），行尾再渲染一次句中出现过的队名 | `web/src/pages/market/MarketIntelPage.tsx:48-56`、`web/src/styles.css:3903` |
| 卡头写「传闻由系统按窗口自动生成，真真假假，请自行查证 · 下窗换血。」 | `web/src/pages/market/MarketIntelPage.tsx:40` |
| 错误/加载/空态均无 `role`，错误态无重试 | `web/src/pages/market/MarketIntelPage.tsx:41-46` |
| 公开卡柜 `/api/market/listings` 按 status 过滤、只返回最新 50 条 | `src/worker/routes/market.ts:126` |
| 公开成交表 `/api/market/deals` 返回全部类型的 completed、最新 50 条 | `src/worker/routes/market.ts:363` |
| 限流桶是 isolate 内存 Map，60 次/60 秒 | `src/lib/guard.ts:7`、`:10-26`、`:29-33` |

### 1.2 线上状态（本次未亲自复核，按引用处理）

这组数字是设计前提，来自侦察与上一轮复核员的只读查询：

- `GET /api/market/listings` 返回空列表；市场类成交 0 条；`transfer_listed = 1` 的球员 17 名，来自 4 家俱乐部。
- 成交表 28 条全部是 `match`（24）与 `rc_change`（4），`completed_at` 全是 `2026-10-06T03:08:00.611Z`。
- `season_windows` 只有 1 行：S9 W1，`opened_at = 2026-09-18T01:00Z`，1 分钟后关闭。
- 球员 18,301 人，其中 17,731 人是自由身（`club_id` 为空）。

把这两组放在一起，线上 8 条只可能是假料：在售池为空、成交池被类型白名单挡空（`src/worker/rumors.ts:147`），`:202` 的真料条件恒不成立，8 个槽全部落入假料分支。这不是掷签运气，是结构性结果。

### 1.3 三个真问题

**问题一：真假被「主体归属」和「句式」编码了，不是被藏起来了。**

真料的 `{club}` 恒等于球员现东家（在售池取挂牌俱乐部，成交池取 `toClubName ?? fromClubName`，`src/worker/rumors.ts:216`），假料被 `:235` 明令禁止点名现东家。于是「队名 == 该球员现东家 ⇒ 真」是构造性事实：球员页公开现东家（`src/worker/routes/players.ts:1219`）与 `transferListed`（`:785`），点一次就能验。

句式同样分家。真料五条是卖方陈述（`:49-55`），假料六条是买方与社交传闻（`:66-73`）。「说挂牌 = 真，说饭局 = 假」是玩家不用查数据就能总结出的规则。

**问题二：假料主语大面积不成立。**

假料池只过滤 `status != 'retired'`（`:154-175`；`players.status` 取值含 `free`，见 `0001_init.sql:17`），96.9% 的自由身球员全在池里。文案「慕尼黑1860 更衣室都在讨论 X」（`:52`）里的 X 根本不属于该队；`player.clubId === club.id` 这条守卫对 `clubId = null` 永远不成立。玩家点开球员页看到的第一个词是「自由身」。

**问题三：确定性承诺与实现不符，且缓存只覆盖一半。**

事实索引是 `pool[floor(seededUnit([...seed, slot], 4) * pool.length)]`（`:206`、`:215`），池长一变全部真料槽整体位移；而任意一次市场写入都会让缓存键失效（`src/lib/guard.ts:218`），所以本窗内「换人」是常态。反方向：无开窗时种子退化成 `(visibleSeason, 0)`（`:22-27`），整段休赛期内容冻结，页面却写着「下窗换血」。

另外端点把 `resolveRumorWindow` 放在 `cachedJson` 之前（`src/worker/routes/market.ts:331`），缓存命中仍要打 1 次 D1（无开窗 2 次）。1h 缓存只覆盖事实池。

### 1.4 现有测试的边界

`tests/market-intel.test.ts` 有 26 个用例。rev4 本轮实跑 `npx vitest run tests/market-intel.test.ts` → **26 passed，6.31s**（vitest 3.2.7）。上一轮独立复核实跑记录是 26 passed / 6.55s，rev3 在 1.4 与 12.2 两处写 6.13s 属引用偏差，已按本轮实跑更正。

TC-RUMOR-01..10 锁的是确定性、结构、守卫三件事，不锁叙事质量与文案创意（`docs/test-plans/v6.18.0-market-ia.md:21` 明确 out of scope）。这意味着改文案、改种子、改池子不会有测试变红，也意味着「更真实」不能靠测试全绿来证明，只能靠结构约束加人工语料评审。

TC-RUMOR-08（`:513-529`）用直插 SQLite 的方式测缓存命中，不触发 epoch purge，因此没有覆盖「写路径导致重算」这条真实路径。

前端测试基建是存在的：`vitest.config.ts:12-17` 的 include 含 `web/**/*.test.tsx`，`web/src/pages/market/MarketCard.test.tsx` 与 `MarketAdBoardPage.test.tsx` 都用 jsdom + `@testing-library/react`。rev1 沿用的「不写 web 渲染测试」只对 v6.18.0 那一轮成立（`docs/test-plans/v6.18.0-market-ia.md:20` 的原话是「本轮仓库无 web 测试基建」），rev2 已纠正。

---

## 2. 术语与边界

本节是 GLOSSARY 候选，不直接改 `GLOSSARY.md`。写法遵循 domain-modeling 的收窄方法：每个词给出边界，而不是给出实现。

### 2.1 传闻（rumor）

一条关于「某球员与其现东家之间正在发生或即将发生什么」的公开消息。

边界：
- **主体恒为球员与其现东家。** 不写「某队想买某球员」，因为买方需要一个新的公开事实源，否则买方语气本身成为侧信道。
- 自由身球员（`club_id` 为空）不得出现在传闻里。
- 传闻与成交表的分工按「是否仍在队内」切，而不是按「是否已发生」切：
  - 成交表（`/market/deals`）列全部已完成交易，包括跨队转会、激活、强制拍卖、自由身签约、匹配留队、续约。
  - 传闻只谈**球员仍在现东家队内**的那些状态（可谈、在挂、刚续约/刚匹配留队），不谈任何跨队结果。跨队结果一律由成交表承担。
- 因此传闻可以陈述「刚发生」的状态主张（留队族），但它必须与「这名球员现在还在这个队」一致；rev1 写的「传闻只承担态度与打算」与留队族自相矛盾，此处按上述分工修正。

### 2.2 主张（claim）

传闻陈述的命题，分两层。

- **状态主张**：可被公开记录核对。例：已列入可谈名单、已挂牌、刚完成续约或匹配留队。
- **意图主张**：不可被公开记录核对。例：愿意听报价、球探到场。

边界：意图主张必须归因（「据一位经纪人称」），平台自己的口吻只陈述「有人这么说」。归因措辞对真假一视同仁，不做可信度分级。

### 2.3 锚点（anchor）

能证明某条状态主张「有据」的公开记录。

三类，**且必须落在公开页可见的那个窗口里**（这是 rev2 新增的硬约束，理由见 5.1 与 ADR-0008）：

1. 可谈：`players.transfer_listed = 1`（迁移 `0037_offers.sql:6`，公开出现在 `/api/players`（`src/worker/routes/players.ts:785`）与广告板 `/market/board`，后者上限 200 条、当前 17 人）。
2. 在挂：`listings.status ∈ (listed, bidding, matched_pending)` 且该记录落在 `/api/market/listings` 可见的最新 50 条窗口内（`src/worker/routes/market.ts:126`）。
3. 留队：`transfers.status = completed` 且 `type ∈ (match, rc_change)`、`from_club_id = to_club_id = players.club_id`，且该记录落在 `/api/market/deals` 可见的最新 50 条窗口内（`src/worker/routes/market.ts:363`）。

**不列为锚点**：已完成的跨队转会（`transfer`/`activation`/`forced_auction`/`free_agent`）。原因见 ADR-0003——这类记录里的俱乐部是买方，与「现东家态度」不同一个命题。

### 2.4 有据 / 无据（grounded / ungrounded）

这是本设计对「真 / 假」的正式替换，也是最重要的一条定义。

- **有据**：该（球员, 现东家）在所选主张族的锚点集合里存在一条记录。
- **无据**：不存在。

关键边界：**有据不等于这条消息属实，无据也不等于这条消息是假的。** 记录只说明「他在名单上」，不说明「他愿意走」；不在名单上也不说明「俱乐部没在听」。玩家查证得到的是「有记录 / 无记录」，判断仍由玩家做。

`src/worker/rumors.ts:5-7` 的原设计口径就是「真传闻查有实据、假传闻查无此事」，本设计只是把它从注释里的说法变成可实现的模型，并把「真 / 假」这对会误导的措辞换掉。

### 2.5 主张族（claim family）

可谈 / 在挂 / 留队。族是生成侧概念，**不上屏、不下发**。

边界：只有真料池非空的族才参与抽样。三族全空时走冷窗回退（见 5.1 与 2.9），不是「随机抽一个空族」。

### 2.6 位（truth bit）

每槽独立的 50% 种子抽签结果。它只决定「用有锚点的主体还是无锚点的主体」，不参与族选择、事实选择、条数、顺序、版面。

边界：任何新增的公开可观测维度都不得读取位。盐位分配写在 `src/worker/rumors.ts` 头注释里，见 7.3。

### 2.7 窗口（window）与期（edition）

- **窗口**：`(season, window_seq)` 构成的种子身份。它不是日历。无开窗时回退 `(visibleSeason, 0)`（`src/worker/rumors.ts:22-27`），整段休赛期共用同一身份。
- **期（edition）**：一个窗口对应的一份载荷。本设计 P0/P1 不落库，P2 才考虑快照。

边界：不做「本窗第 N 天」、不做关窗倒计时、不做逐条发稿时间。生产 `season_windows` 只有 1 行且该行只存在 1 分钟，没有日历可言。

### 2.8 查证面（verification surface）

公开可访问、能核对锚点的页面。

- `/players/:id` 球员档案（公开，`web/src/App.tsx:108`）
- `/players?club_id=N` 该队名单（公开，`web/src/App.tsx:105`；参数解析见 `web/src/lib/players-library.ts:225`）
- `/market` 卡柜与在售（公开，`web/src/App.tsx:118`）
- `/market/board` 可谈名单（公开，`web/src/App.tsx:119`）

**不在查证面内**：`/clubs/:id`。该路由包在 `RequireUser` 里（`web/src/App.tsx:110-117`），端点也先 `requireUser`（`src/worker/routes/clubs.ts:313`）。传言页是公开页，把公开读者推进登录墙不算查证。

**族 → 查证面的对应关系（rev4 补，rev3 把落点写成 ADR-0005 是错的，ADR-0005 讲时间与信源）**：

| 族 | 查证面 | 为什么不是别处 |
| --- | --- | --- |
| 可谈 | `/market/board`（可谈名单，公开，上限 200） | `transfer_listed` 只出现在广告板与 `/api/players`，不是卡柜 |
| 在挂 | `/market` 卡柜（`/api/market/listings`，三态、`ORDER BY l.id DESC LIMIT 50`） | 挂牌走 `listings`，与 `transfer_listed` 是两套字段：挂牌时只 `UPDATE players SET status='listed'`，不改 `transfer_listed`（`src/worker/routes/market.ts:299-305`） |
| 留队 | `/market/deals`（`GET /api/market/deals`，**不按 type 过滤**、最新 50 条，`src/worker/routes/market.ts:347-363`） | `match`/`rc_change` 只在成交表里；卡柜看不到 |

### 2.9 冷窗

可谈、在挂、留队三族锚点全空。此时走 5.1 定义的固定回退：族固定为可谈、全部无据、8 条照发，卡头可以写「本窗市场冷清」。这句话描述的是公开池为空，不是对单条消息的自白，不泄漏任何位信息。

### 2.10 侧信道（tell）

任何让人不查证就能分类的公开特征。主体归属、语气方向、变体选择、具体度、版面位置、徽标都算。所有侧信道都纳入「与位独立」的测试面，但**按可测性分流**：能在单条上切分、且真的逐条变化的只有**主张族**，进 TC-RUMOR-12 的统计检验；变体维度由 TC-RUMOR-04 的「同族两侧变体集合相等」覆盖；归因措辞与是否含数字在本设计中是常量（6.3），不构成侧信道，也不进检验（8.1）；卡片级指标（涉及俱乐部数、位置分布）不能按条切分，只能进人工语料回归（8.7）。

---

## 3. 设计原则

### 3.1 不泄漏真假

位只影响「用哪条主体」，不影响任何上屏维度。这条纪律要变成可执行的东西，不能只写在注释里：

- 三族模板对真假完全共用。假料不设专用模板，靠守卫保证该条状态主张无锚点。
- 归因措辞、句长、是否含数字、序号位置对真假同分布。
- 卡头统计（条数、涉及俱乐部数）对真假同待遇。
- 不下发真/假/可信度/已证实字段，也不用颜色、图标、排序、置顶编码（沿用 `src/worker/rumors.ts:5` 与 TC-RUMOR-07 的红线）。

**必须写清楚的边界**：没有平台贴的真假标签，也没有句式可猜。但可谈族有一条一字段捷径——球员页公开 `transferListed`（`src/worker/routes/players.ts:785`、`:1219`），查一次就能核对可谈族的状态主张。这不是缺陷，是「可查证」这条玩法本身的入口；它被明确写进 ADR-0001 的接受代价，而不是被说成「不可判定」。

### 3.2 同窗稳定、下窗换血

稳定性来自「窗口种子 × 事实池」，不是来自冻结。

- 同一窗口、同一事实池，正文逐字相同（TC-RUMOR-02 已锁）。
- 池里新增一条事实，只影响少数条（rendezvous 最小位移，见 P0-2）。
- 下架或成交导致的事实消失会让对应条换人或丢槽，这是事实变化的必然结果，不做假。
- 文案不再承诺「本窗不变」「下窗换血」，改成陈述事实的「本窗情报 · N 条 · 涉及 M 家俱乐部」。

### 3.3 事实可追溯

每条传闻至少一个可点主体，点开后能看到锚点所在页。

- 球员名 → `/players/{playerId}`
- 队名 → `/players?club_id={clubId}`（P1）
- 冷窗 / 错误 / 空态给去向，不给情绪

不允许出现查不到的主语。自由身球员进「更衣室」就是这类错误的典型。

### 3.4 玩家有求证动机

问卷式设计：一句话能走到一条记录。

- 查到记录 → 有据
- 查不到 → 查无此事

两端都闭环，但风险只落在玩家自己身上，不由系统提示。不引入需要等待的实时依赖（推送、外部 feed、定时刷新），所有内容都是请求时由 D1 加缓存算出的确定值。

### 3.5 codebase-design 视角：把「选事实」做成深模块

`rumors.ts` 现在是「SQL + 抽签 + 模板 + 守卫」四件事挤在一个 259 行文件里，接口只有一个 `buildRumors`。抽签逻辑与 SQL 结果形状耦合，导致任何选择策略的改动都要动 SQL 上下文。

本设计把两件纯逻辑挪到 `src/core/`：

- `seededUnit`：现在住在 `src/worker/venue-ops.ts:105`，而该文件 import 了 `Env`、`HttpError`、`ledgerMovement`、`createConfigService`、`isWindowOpen`、`assertOpOpen` 等 IO 依赖（`src/worker/venue-ops.ts:8-13`）。`src/core/` 不能反向依赖 `src/worker/`，所以抽到 `src/core/deterministic-random.ts`，`venue-ops.ts` 改为 re-export，调用方不变。
  抽取的理由是**分层与复用**，不是调用方数量：`seededUnit` 当前有四个依赖模块——`venue-ops.ts`（定义处，`:166-168` 使用）、`rumors.ts`（`:12` import）、`event-ops.ts`（`:26` import）、`naming-ops.ts`（`:22` import，`:605` 调用）。rev3 写「抽走之后仍是两个调用方」，与代码不符，已改。`src/core/ad-board.ts:28` 的 `shuffleWithSeed` 用的是自己的 `mulberry32`（`:16`），不调用 `seededUnit`，不算依赖方。
- `pickFact` / `dedupeByPlayer`：纯函数，放进 `src/core/rumor-select.ts`。

删除测试：删掉 `src/core/rumor-select.ts`，剩下的 `rumors.ts` 仍然要做「从池里挑一条」这件事，代码会重新长回来。所以这个模块留得住。反过来，如果把「族选择」也做成模块，删掉它以后 `buildRumors` 里只剩一行 switch，长不回来，那就不值得单独成模块——族选择留在 `rumors.ts`。

接口即测试面：`pickFact` 是纯函数，扰动性质（池加一条，变动 ≤2）可以直接单测，不需要起 D1 夹具。

### 3.6 news-writing 视角：只把有据的写进正文

沿用新闻素材清单的做法：每个可写入的命题先问「来源是什么、能不能核」。

- 状态主张只有三种来源（三类锚点），有则写，无则不能写成平台口吻。
- 意图主张一律进「待确认」，在文本里以归因形式出现。
- 倒金字塔不适用单句话，但适用整卡：目录级信息（本窗多少条、涉及几家）放在卡头，单条信息放列表。不做头条分级，因为头条选择一旦与「重要性」相关就与位相关。

### 3.7 frontend-design 视角：结构编码真实信息

- 卡头统计（N 条、M 家俱乐部）是真实计算值，不是装饰。
- 层级只有两层（主句 + 元信息），序号、徽标、相对时间都不进卡片——它们要么编码真实信息，要么就会编码侧信道。
- 三态文案给方向不给情绪，且不暗示真假。

---

## 4. 备选方案与取舍

### ADR-0001 「真假」的语义

**背景**：原实现把真假定义为「这个球员×球队关系在不在两池里」，同时承诺「真假对用户不可见」。复核指出这组承诺互相矛盾：只要锚点公开可枚举，真假就是公开可判定的。

**选项**
- A 保持「关系在两池」的定义，不改。
- B 改成「主张对应的公开锚点存在」，明确承诺从「不可判定」降级为「可查证」。
- C 改成不可核实的意图真值（例如内部抛硬币），保证不可判定，但查证退化成无意义动作。

**决定**：B。并把术语从「真/假」改成「有据/无据」，把文案的承诺限定在「有据」这一层。

**后果**
- 没有平台贴的真假标签，句式也不能反推答案；但可谈族存在一字段捷径：球员页公开 `transferListed`（`src/worker/routes/players.ts:785`、`:1219`），点进球员档案即可核对状态主张。这是接受的代价，不是遗漏。
- 主动枚举全部公开面的玩家能判出有据/无据。同样是接受的代价。
- 换来的是一条可用的玩法闭环：看消息 → 去查 → 有记录或没记录 → 形成判断。
- C 被否掉，因为它让「点球员名自行查证」变成没有反馈的点击，等于删掉玩法。
- 遗留：文案必须避免把「有据」说成「属实」。状态主张不得逐字复述数据库字段（否则变成朗读），要停在「态度」层。

### ADR-0002 主张骨架是否真假共用

**背景**：真料五条模板、假料六条模板是两套互不相交的字符串（`src/worker/rumors.ts:49-73`），同一句模板既生成文案也生成答案。

**选项**
- A 保持两套模板。
- B 共用骨架 + 每族假镜像（假料也写状态主张，但归因）。
- C 只给假料加强断言来打散「具体=真」。

**决定**：B。

**后果**：句式不再携带答案；「具体=真」的元规则失效。C 被否，因为它只是把假料写得更像真的，会让玩家第一反应相信，点开才发现没有记录——更高质量的假新闻，不是更真实的平台。

**rev2 补丁**：共用骨架必须是「同一族、同一变体集合」，不是「同一族但真假各用一半变体」。rev1 把可谈族写成「愿听报价 / 未列入名单」并声明对位共用，这两句互相矛盾；现改为可谈族只有一条变体（5.1）。

### ADR-0003 是否保留买方视角与成交族

**背景**：真料成交族把「甲队签下他」写进传闻。复核指出这里的俱乐部是买方，与「现东家态度」不是同一个命题；球员之后再次转会，文本里的队名也不再是现东家。

**选项**
- A 保留成交族，加 `counterpartyClub` 字段并在 UI 标注角色。
- B 删掉成交族，只保留主体恒为现东家的三族。
- C 统一改成现东家视角，强行把成交说成现东家的事。

**决定**：B。

**后果**：传闻语义收敛为「这名球员与这家俱乐部之间正在发生什么」，不存在角色歧义。代价是失去「已成交」这条叙事线，但成交由同页的成交表承担（`web/src/pages/market/MarketIntelPage.tsx:78-128`），并不缺。A 会让载荷多一个字段、UI 多一层角色标注，收益只是保住一条本可以由成交表讲的故事。C 会产生事实错误。

### ADR-0004 同窗稳定做到什么程度

**背景**：取模索引在池变化时整体位移；写路径 purge 保证池会变。

**选项**
- A 保持取模。
- B rendezvous（最高随机权重）替换索引。
- C 整窗冻结（edition 快照）。

**决定**：B；C 推迟到 P2，且只在真料池非空时落库。

**后果**：新增一条事实只影响少数条；下架/成交仍会让对应条换人或丢槽，文案不再承诺「本窗不变」。C 的「首次生成即冻结」在当前生产会把这 8 条全假永久化，是明确的失败模式；繁忙窗口的版本号还会涨到几十版，像 bug。

### ADR-0005 不伪造时间与信源

**背景**：窗口不是日历（生产 `season_windows` 只有 1 行且只开 1 分钟）；真实时间只有真料侧有，会成为新侧信道；平台没有采编动作，「截稿前未获俱乐部回应」是对自身流程的假断言。

**选项**
- A 逐条发稿时间 + 逐条信源角色。
- B 卡片级窗口标识 + 文本内归因。
- C 只加整体发稿时间。

**决定**：B。

**后果**：缺少新闻的「何时」要素，用卡头「本窗情报 · N 条 · M 家俱乐部」补；若将来要时间，只能做整期同值，不能逐条。

### ADR-0006 假料是否也说可核查的话

**背景**：如果只有真料说「已挂牌/已谈拢」，具体断言本身就是答案；如果假料用平台口吻断言，平台就在公开面撒谎。

**选项**
- A 假料只写不可核实的意图。
- B 假料也写状态主张，但统一归因给信源。

**决定**：B。

**后果**：玩家查证会得到「查无此事」，这是设计想要的结果；平台自己的口吻只陈述「有人说」。守卫必须保证假料的状态主张确实无锚点，否则「假料成真」会击穿「查无此事」。

**rev2 补丁（变体的对称性）**：有据行的变体由锚点子状态决定（挂牌中 / 已谈拢 / 已续约 / 已匹配），否则文本会与公开卡柜状态自相矛盾。无据行的变体由独立盐位 10 在该族的**全部变体**上均匀抽取。两侧共享同一变体集合，因此「已谈拢」不是有据标记，只是无据行也会说的话。副作用是「已谈拢」的条数会多于真实谈拢的人数——这正是「查无此事」的体验，玩家去卡柜核对时会发现有几条对不上。这个副作用是特性，不是缺陷，写在这里以免以后被当成 bug 修掉。

### ADR-0007 查证入口的落点

**背景**：`/clubs/:id` 匿名撞登录墙（`web/src/App.tsx:110-117`、`src/worker/routes/clubs.ts:313`）；广告板不接受俱乐部参数，只有 `limit`（`src/worker/routes/market.ts:422-470`）。

**选项**
- A 队名链 `/clubs/:id`。
- B 队名链 `/players?club_id=N`。
- C 新建公开俱乐部摘要页。

**决定**：B。C 记入 nonGoals。

**后果**：匿名读者能看该队名单与球员档案，看不到转会往来。给广告板加 club 参数会按俱乐部数放大缓存键与 D1 读量（该路由注释已标注键放大风险），不在本轮。

### ADR-0008 锚点必须与公开页窗口一致

**背景**：rev1 把在挂锚点定义为「所有 listings 三态」、留队锚点定义为「近 30 条成交里的 match/rc_change」，但公开卡柜只返回最新 50 条（`src/worker/routes/market.ts:126`），公开成交表只返回最新 50 条（`:363`）。锚点落在公开页之外时，玩家查证会查不到，「有据」变成不可核实的断言。

**选项**
- A 锚点全集，让公开页加按球员/俱乐部分页。
- B 锚点 = 公开页可见窗口内的记录。

**决定**：B。

**实现口径（rev4 补）**：窗口必须**先取、后筛**。公开端的窗口是「按它自己的过滤条件排序取 50 条」，锚点若先按主体（`p.club_id = l.seller_club_id`、`p.club_id = t.to_club_id`）或按类型（`type IN ('match','rc_change')`）过滤再 `LIMIT 50`，取到的就是另一个集合，会包含公开页查不到的行。所以 5.1 的查询 2/3 都写成 `WITH win AS (SELECT ... WHERE <公开端点的同一组过滤> ORDER BY <公开端点的序> LIMIT 50)`，再 `JOIN players` 做主体过滤、在窗口结果上筛 `type`。成交侧的窗口不按 type 过滤（`src/worker/routes/market.ts:356-363`），这一点尤其容易写反。TC-RUMOR-20b 就是这条口径的对照用例。

**后果**：玩家能查到的就是系统能引用的，两边窗口一一对应。代价是极老的续约记录（落在最新 50 条之外）不再作为锚点，对应的传闻变成无据；在挂超过 50 条的繁忙窗口里，最早的挂牌不再作为锚点。当前生产只有 28 条成交、0 条在挂，两者都不构成现实约束。A 被推到 openQuestion（见 §11），因为它要改两个公开端点的分页语义。

---

## 5. 推荐方案

方案名：**主张-锚点传闻改造包**。

一句话：每条传闻只谈「这名球员与这家俱乐部之间正在发生什么」，有据与无据共用同一套主张族与变体集合，位只决定锚点有无。

### 5.0 生成顺序（rev2 定稿，替换 rev1 的模糊描述）

```
seed = [season, windowSeq]                                  // rumors.ts:187
FULL = [可谈, 在挂, 留队]                                     // 固定全集，长度恒为 3
family(slot) = FULL[floor(seededUnit([...seed, slot], 4) * FULL.length)]
grounded(slot) = seededUnit([...seed, slot], 0) < 0.5
if anchor(family(slot)) 为空:                                 // 该族池空 → 槽级固定回退
  family(slot) = 可谈; grounded(slot) = false
pool = grounded ? anchor(family) : complement(family)         // complement 见 5.1 守卫矩阵
fact = pickFact(pool, seed, slot, grounded ? 5 : 6)           // 4 参，rendezvous
sub  = grounded ? subOfAnchor(fact) : SUB[family][floor(seededUnit([...seed, slot], 10) * n)]
text = TEMPLATE[family][sub](fact.playerName, clubOf(fact).name)
```

四条必须一起读的性质：

- `family` 只由 `(seed, slot)` 与固定全集决定，既不读位，也不读池长。rev2 用「非空族列表 `F` 的下标」抽族，`F` 的长度一变就重排所有槽的族：线上今天 `F = [可谈, 留队]`（17 人 `transfer_listed` 保证可谈非空、listings 空），第一条挂牌会让 `|F|` 从 2 变 3，约 1/6 的槽换族，这是 rev2 里「加挂牌只影响 ≤2 条」不成立的根因。改成固定全集后，`floor(u × 3)` 在任何池状态下都落在同一组槽。
- 空族回退是**槽级**的，不是全局重排：只有落在空族的那些槽改走「可谈 + 无据」，其余槽的族不动。
- `grounded` 只读位，且是唯一的读取点。
- `sub` 在有据侧由锚点决定、在无据侧由盐位 10 均匀抽取，两侧共享同一变体集合。

同窗去重：按 `playerId`，撞了用盐位 7 重抽一次，仍撞则丢槽。

### 5.1 P0-1 主张-锚点重构

**现状问题**
- 假料主语 96.9% 是自由身（假料池只过滤 `status != 'retired'`，`src/worker/rumors.ts:154-175`）。
- 真料 `{club}` 恒为现东家，假料被 `:235` 禁止点名现东家，主体归属即答案。
- 真/假模板互不相交（`:49-73`），句式即答案。
- 成交类型白名单不含 `match`/`rc_change`（`:147`），线上 28 条成交一条都用不上，真料池结构性为空（`:202`）。
- `matched_pending` 被当成「仍在听报价」，与挂牌板公开状态矛盾（`:132`、`:50-51`）。

**设计做法**

1. 主体统一为「球员 + 现东家」。三族主张都问同一件事：这名球员与这家俱乐部之间在发生什么。
2. 抽签顺序按 5.0：先定族、再抽位、再选事实、最后定变体。
3. 每族的变体集合与模板（**可谈族只有一条变体，没有「未列入名单」这种按位选模板的写法**——rev1 那句已删）：

| 族 | 变体 | 模板（真假共用） | 有据侧的子状态 |
| --- | --- | --- | --- |
| 可谈 | 唯一 | 「{club} 愿意听对 {player} 的报价，据一位经纪人称。」 | `transfer_listed = 1`（无子状态可分） |
| 在挂 | 挂牌中 | 「{club} 已经把 {player} 挂上了，据一位经纪人称。」 | `listed` / `bidding` |
| 在挂 | 已谈拢 | 「{club} 与 {player} 已经谈拢，只等审核，据一位经纪人称。」 | `matched_pending` |
| 留队 | 已续约 | 「{club} 与 {player} 把续约敲定了，据一位经纪人称。」 | `rc_change` |
| 留队 | 已匹配 | 「{club} 匹配了外部报价，把 {player} 留下，据一位经纪人称。」 | `match` |

- 无据行的变体：在挂族从 {挂牌中, 已谈拢} 均匀抽，留队族从 {已续约, 已匹配} 均匀抽（盐位 10）。因此「已谈拢」出现在无据行是正常输出，不是脏数据。
- 可谈族只有一条变体，所以「愿听报价」出现在两侧是必然的——这正是它不能携带答案的原因。

4. 假料主体按**族**取锚点补集，不是全局「无任何锚点」。在挂族的无据主体可以是一个已在可谈名单上、但没有挂牌的球员。这样「在可谈名单上 ⇒ 这条为真」不再成立。
5. 删除没有锚点支撑的两条真料情节（`src/worker/rumors.ts:52` 更衣室、`:54` 物色替代者）；`matched_pending` 用完成时（「已谈拢，只等审核」），不再说「仍在听报价」。

**冷窗回退（rev2 新增，rev1 缺失）**

三族全空时 5.0 的每个槽都会落到「可谈 + 无据」的槽级回退。定义固定回退：

- 族固定为**可谈**，`grounded` 一律为 false（补集 = 有俱乐部、`transfer_listed = 0` 的球员，非空）。
- 变体只有一条，因此 8 条文案同构、主语各不相同。
- 8 条照发，id 仍是 `r{season}-{seq}-0..7`（TC-RUMOR-01/10 的断言不用改）。
- 卡头可写「本窗市场冷清，暂无挂牌与成交。」这描述公开池为空，不泄漏逐条位。
- 回退不看位，也不看族长：从「三族全空」恢复到「可谈非空」时，只有原本落在可谈的槽改变形态，另外两族槽仍走回退——因为它们的族池还是空。

**守卫矩阵**

| 假料主张族 | 必须排除的公开关系 | 依据 |
| --- | --- | --- |
| 全部 | 自由身（`club_id` 为空） | 主体不成立 |
| 全部 | `clubs.is_cpu = 1`（CPU 队不该发消息）；`clubs.status = 'active'` 之外的行 | `0026_clubs_is_cpu.sql:3`；`clubs.status` 无 CHECK（`0001_init.sql:37`），夹具与种子用 `active`（`tests/market-intel.test.ts:80`） |
| 可谈 | `players.transfer_listed = 1` | 锚点为假 |
| 在挂 | 该球员存在 `listings` 三态之一 | 锚点为假 |
| 留队 | 该球员存在 `match`/`rc_change` 且 `to_club_id = club_id` | 锚点为假 |
| 全部 | 该球员有任何已完成的**跨队**市场类成交（`transfer`/`activation`/`forced_auction`/`free_agent`） | 历史冲突，`/market/deals` 公开可查 |

最后一行的查询在 rev1 里没有对应的集合（rev1 只查了三个集合），所以预算数对不上。rev2 明确补第 4 条集合查询，见下面的查询清单。

**数据 / API**

`loadFactPool`（`src/worker/rumors.ts:122-180`）重写为 4 个池查询 + 4 个集合查询，共 8 条。

**两条硬约束，先写在查询之前：**

1. **列名必须 AS 成 camelCase 键**。`src/worker/rumors.ts:126-127` 的注释就是 v6.18.0 踩过的坑：「列名一律 AS 成接口里的 camelCase 键——D1 按 SQL 列名给键，不别名时 `SaleFact.playerId` 读出来是 undefined（真料文本会直接渲染 "undefined"）」。四条池查询统一写 `p.id AS playerId`、`${sqlDisplayName('p')} AS playerName`；显示名口径只能走 `src/core/player-name.ts:16`（`COALESCE(display_name, name)`），不要手写 COALESCE，否则会把显示名退回 FC26 缩写名（`E. Haaland`）。
2. **锚点窗口必须与公开端点同源**。ADR-0008 承诺「玩家能查到的就是系统能引用的」，所以池查询要先取公开端点的那个 50 条窗口（子查询），再 JOIN 球员与俱乐部做主体过滤。先按主体过滤再 `LIMIT 50` 会取到公开页之外的行：`/market/listings` 默认只取三态后 `ORDER BY l.id DESC LIMIT 50`（`src/worker/routes/market.ts:82-87`、`:123-126`），`/market/deals` 不按 type 过滤、直接取全部 completed 的最新 50 条（`:356-363`）。

1. 可谈池：`SELECT p.id AS playerId, ${sqlDisplayName('p')} AS playerName, p.club_id AS clubId, c.name AS clubName FROM players p JOIN clubs c ON c.id = p.club_id WHERE p.transfer_listed = 1 AND p.club_id > 0 AND c.is_cpu = 0 AND c.status = 'active' ORDER BY p.id`。
   可谈族没有分页窗口，但 `/market/board` 有 200 条上限（`src/worker/routes/market.ts:422-470`，排序 emphasis → transfer_listed_at → id）。当前 17 人远低于上限；若将来超过 200，锚点按广告板同一排序截断到前 200，TC-RUMOR-20 增加这条边界。
2. 在挂池（原 `:128-134` 重写，**主体必须等于现东家**，**窗口取自公开卡柜**）：
   `WITH win AS (SELECT l.id, l.player_id, l.seller_club_id, l.status FROM listings l WHERE l.status IN ('listed','bidding','matched_pending') ORDER BY l.id DESC LIMIT 50) SELECT w.id, p.id AS playerId, ${sqlDisplayName('p')} AS playerName, p.club_id AS clubId, c.name AS clubName, w.status AS listingStatus FROM win w JOIN players p ON p.id = w.player_id AND p.club_id = w.seller_club_id JOIN clubs c ON c.id = p.club_id WHERE c.is_cpu = 0 AND c.status = 'active'`。
   `p.club_id = w.seller_club_id` 这个条件不能省：只 JOIN `clubs` 时队名取的是挂牌俱乐部，球员换队后主体就不是现东家。它放在窗口之后，所以只会缩小结果，不会把窗口平移。
3. 留队池（原 `:140-149` 重写，**窗口取自公开成交表**）：`WITH win AS (SELECT t.id, t.player_id, t.type, t.from_club_id, t.to_club_id FROM transfers t WHERE t.status = 'completed' ORDER BY t.completed_at DESC, t.id DESC LIMIT 50) SELECT w.id, p.id AS playerId, ${sqlDisplayName('p')} AS playerName, p.club_id AS clubId, c.name AS clubName, w.type FROM win w JOIN players p ON p.id = w.player_id AND p.club_id = w.to_club_id JOIN clubs c ON c.id = p.club_id WHERE w.type IN ('match','rc_change') AND w.from_club_id = w.to_club_id AND c.is_cpu = 0 AND c.status = 'active'`。
   注意 `type IN (...)` 放在窗口之后：公开成交表不按 type 过滤，若把它放进窗口子查询，会取到「公开页第 51-60 条」这类玩家翻不到的行。
4. 假料池：`SELECT p.id AS playerId, ${sqlDisplayName('p')} AS playerName, p.club_id AS clubId, c.name AS clubName FROM players p JOIN clubs c ON c.id = p.club_id WHERE p.club_id > 0 AND p.status IN ('normal','trainee') AND c.is_cpu = 0 AND c.status = 'active' ORDER BY p.id`（**无 LIMIT**，见 8.6 上界）。
5. 可谈集合：`SELECT id FROM players WHERE transfer_listed = 1 AND club_id > 0`（命中 `idx_players_transfer_listed`，`0064_ad_board.sql:16`）。
6. 在挂集合：`SELECT DISTINCT player_id FROM (SELECT player_id FROM listings WHERE status IN ('listed','bidding','matched_pending') ORDER BY id DESC LIMIT 50)`——**与锚点同窗口**。若用全表 DISTINCT，会出现「该球员有挂牌但不在窗口内」：既不能当有据（不在窗口），又被排除在无据之外，槽只能空掉。
7. 留队集合：`SELECT DISTINCT player_id FROM (SELECT player_id FROM transfers WHERE status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 50)` 再加 `match`/`rc_change` 与 `from = to` 的过滤，同窗口。
8. 跨队集合：`SELECT DISTINCT player_id FROM transfers WHERE status = 'completed' AND type IN ('transfer','activation','forced_auction','free_agent')`（**无窗口**：守卫要排除的是「任何历史跨队成交」，历史记录在公开成交表上永远查得到，不需要与 50 条窗口对齐）。

- 集合 5-8 的行数都远小于表规模（当前 17 名可谈、0 条在挂、28 条留队记录、0 条跨队成交），可以一次带出后在内存里做补集减法。集合 5 与 8 **没有 LIMIT**，上界是表规模而不是 200——rev3 这里写「全量规模下上限各 200」，没有任何 SQL 支撑，已删（见 8.6）。rev2 另有一处把 28 条 `rc_change` 写成「28 条成交」，也已改：线上市场类成交为 0。
- **P0 阶段 `RumorItem` 保持五键**（`id/text/playerId/playerName/clubName`），没有迁移；六键（加 `clubId`）是 P1-1 的契约变更，见 5.4。rev2 在这里写「五键不变」又在 5.4 写「五键 → 六键」，没有标阶段，实现者会按前者把 P0-1 做成五键。
- 路由注释 `src/worker/routes/market.ts:326` 的「6~8 条」改成「0-8 条」。

**前端 / 文案**：只换服务端模板与词表，渲染结构不动（结构改动在 P0-3）。

**真假安全**
- 位仍取 `seededUnit([...seed, slot], 0) < 0.5`（`:200`），语义从「选池子」变成「选有无锚点」，位置不变。
- 族选择用盐位 4，事实索引用盐位 5（rev2 强制：原来事实索引也用 4，P0-1 就必须挪开，不能留到 P0-2），变体用盐位 10，假料主体用盐位 6，去重用盐位 7。盐位 1/2/3 是 rev1 的模板洗牌，已退役（每族变体固定，句序不再洗），见 7.3。
- 三族模板对位共用；假料不设专用模板；变体集合两侧相同（有据侧由锚点决定，无据侧均匀）。
- 族抽签在固定全集上进行，族池空的槽落槽级回退（可谈 + 无据），因此「某个族出现在卡片上」只说明该族锚点非空，不携带本窗真假比例；也不会因为某个族从空变非空而重排其它槽。
- 冷窗回退不看位，全部无据。

**测试 / 验收**
- TC-RUMOR-04（`:412-444`）改写为「族内真假对称」，并新增断言：同一族内有据行与无据行使用的变体集合相同（这直接控住 rev1 的「未列入名单」类错误）。
- TC-RUMOR-05（`:446-469`）改写为新守卫矩阵，删除「假料不是甲队」断言（那是要拆掉的侧信道）；新增「假料不出现在跨队成交球员上」。
- TC-RUMOR-06（`:471-497`）段一改为「三族锚点全空 ⇒ 8 条、族固定可谈、全部无据」，段二改为「仅可谈池非空 ⇒ 有据行全部指向可谈名单，族只能是可谈」。
- 新增 TC-RUMOR-11 假料主语合法性：`club_id` 非空、`status ∈ normal/trainee`、所在俱乐部 active 且非 CPU。
- TC-RUMOR-01/02/03/07/09/10 保持（前提是夹具下限满足，见 8.4）。

**风险**
- 假料池从 18k 缩到约 570，8 槽足够，但去重后可能掉到 5-6 条（0-8 口径允许）。
- 线上 17 名在列球员只来自 4 家俱乐部，有据行会集中在这几家。P1-4 加俱乐部级上限。
- 模板重写是文案工作，质量不在自动化口径内，需人工评审一轮。
- 主体收敛为「现东家」后，失去买方叙事，这是产品口径，已在 ADR-0003 记录。
- 冷窗回退会让休赛期的 8 条高度同构（同一条模板），阅读体验偏硬。要么接受，要么在 P2-2（休赛期按日换血）里解决，rev2 不新增模板。

### 5.2 P0-2 rendezvous 与主体去重

**现状问题**
- 索引 `pool[... * pool.length]`（`:206`、`:215`）在池长变化时整体位移。
- 写路径 purge 保证池会变（`src/worker/index.ts:59-68`）。
- 有放回抽样让同一球员可跨槽重复（`:206`、`:232-233`）。
- `seededUnit` 住在 `src/worker/venue-ops.ts:105`，该文件有 IO 依赖，core 无法复用。

**设计做法**
1. `seededUnit` 抽到 `src/core/deterministic-random.ts`，`venue-ops.ts` 改为 re-export（调用方零改动）。
2. 新增 `src/core/rumor-select.ts`，两个导出：

```ts
// 4 参：池、窗口种子、槽位、盐位。取「权重最大」的一条，权重相等时 playerId 升序 tie-break。
export function pickFact<T extends { playerId: number }>(
  pool: readonly T[], seed: number[], slot: number, salt: number,
): T | null;

export function dedupeByPlayer<T extends { playerId: number }>(rows: readonly T[]): T[];
```

3. **假料主体也走 rendezvous，不用下标**：`pickFact(complement, seed, slot, 6)`。rev1 只写了「盐位 6 = 假料主体偏移」，没有给算法，而补集数组没有 `ORDER BY` 时下标选择在不同查询计划下会漂移，同窗稳定就没了。rev2 用 rendezvous 把「选哪条」变成对每条算权重，与数组顺序无关；补集池仍然加 `ORDER BY p.id`，作为第二道保险。
4. 同窗按 `playerId` 去重：撞了用盐位 7 重抽一次，仍撞则丢该槽。

**数据 / API**：无接口改动，无迁移。

**真假安全**：rendezvous 不读位，只决定「选哪条事实」；去重对真假一视同仁；假料的 rendezvous 盐位（6）与真料（5）不同，避免两侧在同一池序下选中同一条。

**测试 / 验收**
- 新增 TC-RUMOR-13 最小扰动：池子造到 ≥20 条事实，加一条后 8 条正文变动 ≤2 条（池太小会让期望变化超过阈值，夹具必须够大）。
- 新增 TC-RUMOR-14 同窗 `playerId` 唯一。
- 新增 TC-RUMOR-18 写路径：HTTP 触发 epoch bump 后重算，原有 id 是新的子集（允许去重丢槽），正文变动 ≤2 条；同一用例里把某个原本为空的族补到非空（`|F|` 从 2 变 3 的那条路径），断言其余槽的族与正文不变。rev2 的族抽签依赖 `|F|`，这条路径在默认夹具（三族都非空）上测不到，线上却一定会遇到。
- TC-RUMOR-02 增加一条「同一窗口重复请求 5 次、每次都逐字相同」，把「查询顺序无关」写进断言。
- TC-RUMOR-03 保持。

**风险**
- 小池下 rendezvous 可能长期偏爱同一条，需要固定窗口集采样确认分布。
- 去重会掉条，前端必须能兜住 0 条（现有空态可用）。
- 「加挂牌」不再重排族（5.0 固定全集），只让原本落在该族、且正在走回退的槽多一个候选；「下架/成交」仍会让对应条换人或丢槽，不做假。rev2 写「治加挂牌」，在`|F|`驱动的抽签下并不成立，这一条随 5.0 一起改。

### 5.3 P0-3 卡片文案与三态

**现状问题**
- 卡头「传闻由系统按窗口自动生成，真真假假，请自行查证 · 下窗换血。」（`MarketIntelPage.tsx:40`）把工程词写在上屏，违反 `UI_DESIGN.md:114` §4.4。
- 「下窗换血」与实现不符（无开窗回退 `(visibleSeason, 0)`）。
- 行尾重复句中出现过的队名（`:54`）。
- 错误态无重试（`:41-42`），空态无下一步（`:45-46`），三态均无 `role`。
- 路由注释写「6~8 条」（`src/worker/routes/market.ts:326`），实现是 0-8（`src/worker/rumors.ts:255`）。

**设计做法**
- 卡头改事实性统计：「本窗情报 · N 条 · 涉及 M 家俱乐部。点球员名查看档案。」N、M 由载荷实时计算。
- 行尾去掉重复队名（P1 换成链接组）。
- 错误态给动作：「情报没取到。」+「再打听一次」。
- 空态给去向：「本窗还没有情报。」+ `/market/board` 链接。
- 加载态保留「正在打听消息…」，补 `role="status"` `aria-live="polite"`。
- 路由注释统一为 0-8。

**数据 / API**：无接口改动。

**真假安全**：三态文案不得暗示真假（禁「暂无可靠消息」「已核实」「可信度」）；统计数字对真假同待遇。

**测试 / 验收**
- **新增 `web/src/pages/market/MarketIntelPage.test.tsx`（jsdom）**：三态各一条，断言重试按钮可点、空态含 `/market/board` 链接、加载态有 `role="status"`、每条主句里有到 `/players/{id}` 的链接、卡头数字等于 `rumors.length` 与去重俱乐部数。
- 手工 e2e 三视口（375/768/1280）× 匿名/登录，只补自动化测不到的排版与焦点。
- grep 断言页面源码不含「系统」「自动生成」「下窗换血」。

**风险**：文案需一轮审校；移除行尾队名后行内信息密度下降，需 P1 的链接组补回。

### 5.4 P1-1 clubId 与双主体链接

**现状问题**
- `RumorItem` 无 `clubId`（`src/worker/rumors.ts:29-37`），队名是纯文本（`MarketIntelPage.tsx:54`），只有球员名可点（`:70`）。
- 球员链接走 `player-link.ts:14-16` 的 `fcId ?? id` 回落分支。

**设计做法**
- `RumorItem` 五键 → 六键（新增 `clubId`），`playerId` 继续用于球员链接（两种编号空间零重叠，`src/worker/player-ref.ts:2`）。**不加 fcId**。
- 行尾改为链接组：「所属球队」（`/players?club_id=N`）·「球员档案」（`/players/{playerId}`）。
- 队名不链 `/clubs/:id`（匿名撞登录墙）。

**数据 / API**：四个池查询都带出 `club_id`；键集契约变更，TC-RUMOR-01/07 同 PR 更新（属故意变红的契约变更，不是回归）。

**真假安全**：`clubId` 是公开事实，与位无关；不得在链接上加真假样式或 aria-label；不得用「是否在可谈名单」做徽标或排序。

**测试 / 验收**
- 后端：每个 `clubId` 非空且非 0。
- 前端（jsdom，`MarketIntelPage.test.tsx`）：每条渲染出两个链接，href 分别为 `/players?club_id=N` 与 `/players/{playerId}`；断言 href 里没有 `/clubs/`。

**风险**：键集变更必须与前端同批发布（配合 P1-2 的缓存键版本）。

### 5.5 P1-2 缓存键版本

**现状问题**：键集变更后，1h TTL 内新前端可能拿到旧五键载荷（`clubId` 为 `undefined`）。

**设计做法**：缓存键改 `market-rumors:v2:{season}:{windowSeq}`。**不写「部署后手动 purge 一次」**——仓库里没有 HTTP 手动 purge 入口：`purgePublicCaches`（`src/lib/guard.ts:139`）的调用方只有写请求中间件（`src/worker/index.ts:64`）与 cron（`:259`），所以「手动 purge」不可执行。换 v2 键本身就够了：旧键不再被读取，1 小时 TTL 到期后自然失效；键集变更与前端同批发布，旧键残留不会产生错误载荷。**不做 60 秒 window 缓存**——它会打破 TC-RUMOR-08（`:514` 用 `ttl: '60000'`，`:525` 在同一用例内 `advanceWindow`，`:526-528` 断言新 id），而收益只是每请求少 1-2 次点查。

**数据 / API**：缓存键常量。

**真假安全**：无影响。

**测试 / 验收**：TC-RUMOR-08 的测试意图保持（缓存命中不穿透、换窗出新载荷），但它的 id 期望要按新机制重写（旧期望绑定在被删除的假料 id 池上），见 8.2；D1 成本不塞进 TC-08，拆成 TC-RUMOR-22（8.3）。

**风险**：每请求 1-2 次点查的成本保留。限流仍是 60/60s/IP，与 D1 无关，不构成风险。

### 5.6 P1-3 窗口 phase 与冷窗文案

**现状问题**：无开窗时回退 `(visibleSeason, 0)` 且整段休赛期内容不变，页面却承诺「下窗换血」；`phase` 如果只服务端生成，前端根本拿不到——`RumorsResponse` 只有 `rumors`（`web/src/lib/api.ts:973-974`），`useRumors` 的 queryFn 又只返回 `.rumors`（`web/src/lib/queries.ts:253-260`）。

**设计做法**
1. `resolveRumorWindow` 返回值加公开的 `phase: 'open' | 'offseason'`，随载荷一起缓存（不单独查询）。
2. **响应类型改成 `{ rumors: RumorItem[]; phase: 'open' | 'offseason' }`**（`web/src/lib/api.ts:973-974`），`useRumors` 改成返回整个响应（`queryFn: async () => await api<RumorsResponse>('/api/market/rumors')`），调用方解构 `{ data }` 后取 `.rumors` 与 `.phase`。
3. 卡头分叉「本窗情报」/「休赛期情报」；冷窗追加一行「本窗市场冷清，暂无挂牌与成交。」+ 广告板入口。

**数据 / API**：`phase` 作为整卡字段下发（对 8 条同值，不携带逐条位）；TC-RUMOR-01 增加 `phase` 断言。

**真假安全**：`phase` 与位完全无关；「市场冷清」只说公开池为空。

**测试 / 验收**：新增 TC-RUMOR-17（开窗时 `phase='open'`；无开窗时 `phase='offseason'` 且 id 仍为 `r{season}-0-{slot}`）；TC-RUMOR-10（`:546-555`）保持。前端在 `MarketIntelPage.test.tsx` 里补一条「phase=offseason 时卡头含『休赛期情报』」。

**风险**：休赛期可能持续很久，内容不随日更；若要日更，另开增量（P2-2）。

### 5.7 P1-4 俱乐部级上限（rev2 新增）

**现状问题**：线上 17 名在列球员只来自 4 家俱乐部，有据行会挤在这几家，形成「有据行集中在头部俱乐部」的统计侧信道；rev1 在风险里承诺「P1 加俱乐部级上限」，但 P1-1..P1-3 都没有这条逻辑，承诺没有落点。

**设计做法**
- 一轮内按俱乐部计有据行，单个俱乐部超过 2 条时，后续有据槽改用同族补集（等价于该槽降级为无据），空出的名额不补。
- 上限常量 `MAX_GROUNDED_PER_CLUB = 2`，写在 `src/worker/rumors.ts` 顶部。
- 只在有据侧生效，无据侧不设上限（无据主体的俱乐部分布本来就更散）。

**数据 / API**：无接口改动。

**真假安全**：上限只作用于主体分布，不改变条数与顺序；俱乐部计数不上屏（上屏的是「涉及 M 家俱乐部」，对真假同待遇）。

**测试 / 验收**：新增 TC-RUMOR-19：造 1 家俱乐部 5 名可谈球员 + 若干其它可谈球员，断言该俱乐部的有据行 ≤2；`MAX_GROUNDED_PER_CLUB = 1` 的变异应让该用例红。

**风险**：小池（只有 4 家俱乐部、17 人）下会更容易丢有据行，条数降低；这与「0-8 条」口径一致。

### 5.8 P2-1 期档快照（可选）

**现状问题**：要支持「上一期情报」「球员传闻档案」，缓存做不到——旧载荷不落库就永远拿不回来。

**设计做法**：`rumor_editions(season, window_seq, rev, pool_hash, payload_json, created_at)`，只在真料池非空时落库，快照在窗口开启/关窗批里预写，不在 GET 里写库。

**数据 / API**：迁移 0078（当前最新 0077），文件名必须加进 `tests/d1.ts` 的 `MIGRATION_FILES`；生产 apply 属危险动作，需单独授权。

**真假安全**：`rev`/`pool_hash` 整期共享，不下发；载荷仍不带真假字段。

**测试 / 验收**：同池两次生成逐字相等且 `rev` 不变；池变后 `rev + 1` 且 id 集不变。

**风险**：快照会让情报滞后于最新挂牌（这是目的）；繁忙窗口版本号可能涨到几十版，像 bug，需要时间窗合并，而时间窗是新的隐藏状态。

### 5.9 P2-2 休赛期按日换血（可选）

**现状问题**：无开窗时整段休赛期种子不变，内容冻结；冷窗回退还会让 8 条同构。

**设计做法**：休赛期种子加日期分桶（`[season, 0, dayBucket]`），每日换一批。

**风险**：与 TC-RUMOR-10 的 `(season, 0)` 语义冲突，需要同步改测试计划与文案；日期分桶依赖 `Date.now()`，测试要注入时钟。

### 5.10 P2-3 球员页情报回响（可选）

**现状问题**：情报页是孤岛，球员页看不到「有人在议论他」。

**设计做法**：球员页侧栏「情报台提到这名球员」（按 `playerId` 筛同一份载荷），点击回 `/market/intel#r9-0-3` 并高亮。

**风险**：球员页多一个请求；hash 滚动在窄屏可能被顶栏挡住（需要 `scroll-margin-top`）。

---

## 6. UI / UX 与文案

### 6.1 信息层级

沿用现有奶油纸感与 `.card` 容器，只改卡片内部结构。不复用 `.form-row`——它是为战绩设计的 flex 行（`web/src/styles.css:3903`），承载 30 字消息没有开口。新增 `.rumor-*` 前缀类。

```
┌ card ─────────────────────────────────────┐
│ 本窗情报 · 8 条 · 涉及 6 家俱乐部            │  ← 14px ink，事实统计
│ 点球员名查看档案。                            │  ← 12px muted
├───────────────────────────────────────────┤
│ 曼城愿意听对 Daniel Barrea 的报价，          │  ← 15px ink，主句
│ 据一位经纪人称。                              │
│ 所属球队 · 球员档案                          │  ← 12px muted 链接组
├ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┤
│ … 其余 7 条，同样的结构 …                     │
└───────────────────────────────────────────┘
```

层级只有两层：主句（唯一正文）与元信息（链接组）。不做头条、不做序号、不做徽标、不做相对时间。

### 6.2 文案规格

| 位置 | 文案 | 说明 |
| --- | --- | --- |
| 卡头（开窗） | 本窗情报 · {N} 条 · 涉及 {M} 家俱乐部。点球员名查看档案。 | N/M 实时计算，对真假同待遇 |
| 卡头（无开窗） | 休赛期情报 · {N} 条 · 涉及 {M} 家俱乐部。 | 与 `phase` 一致 |
| 冷窗追加 | 本窗市场冷清，暂无挂牌与成交。 | 只说公开池为空 |
| 加载 | 正在打听消息… | `role="status"` `aria-live="polite"` |
| 空 | 本窗还没有情报。 | 配 `/market/board` 链接 |
| 错误 | 情报没取到。 | 配「再打听一次」按钮 |
| 空态 CTA | 去可谈名单看看谁在等人出价 → | 指向 `/market/board` |

**禁止上屏的词**：系统、自动生成、算法、真真假假、可信度、已证实、辟谣、暂无可靠消息、下窗换血。

### 6.3 状态句的写法

五条模板，真假共用；有据行的变体由锚点决定，无据行由盐位 10 抽。

| 族 / 变体 | 文案 |
| --- | --- |
| 可谈 | 「{club} 愿意听对 {player} 的报价，据一位经纪人称。」 |
| 在挂 / 挂牌中 | 「{club} 已经把 {player} 挂上了，据一位经纪人称。」 |
| 在挂 / 已谈拢 | 「{club} 与 {player} 已经谈拢，只等审核，据一位经纪人称。」 |
| 留队 / 已续约 | 「{club} 与 {player} 把续约敲定了，据一位经纪人称。」 |
| 留队 / 已匹配 | 「{club} 匹配了外部报价，把 {player} 留下，据一位经纪人称。」 |

归因措辞**只有一种**：「据一位经纪人称」，逐条一致，不按条、不按族、不按位变化。rev3 在这里写「统一为『据一位经纪人称』与『据接近俱乐部的人士称』两种」但模板里只有一种、盐位表也没有给归因分配 draw——那两句自相矛盾，而且把「归因」写成了一个并不存在的第二维度。现在只保留一种，并在 8.1 明确：归因与数字在本设计里是常量，因此不构成侧信道，也不进入 TC-RUMOR-12 的统计检验。

**可谈族只有一条变体**，不存在「未列入名单」之类的第二句——rev1 那句是泄漏点，已删。

### 6.4 空态、错误、加载

三态都必须给下一步，且不暗示真假。

- 加载：3 行占位，mono 线条，`role="status"`。
- 空：一句陈述 + 一个公开去向。
- 错误：一句陈述 + 手动重试；不自动重试（`web/src/lib/queries.ts:253-260` 已是 `retry: false`，保持）。
- 429 与其它错误用同一句文案，不单独区分——区分反而暴露限流桶行为。

### 6.5 动效与无障碍

不新增 keyframe；沿用现有盖章 `scale-in`；`prefers-reduced-motion` 下不变。链接触达高度 ≥44px；≤760px 元信息折到下一行；焦点环沿用全局样式。

---

## 7. 模块与接口设计

### 7.1 现有结构的深度问题

`buildRumors(db, win)` 一个接口承担四件事：取池、抽签、模板、守卫。它对测试暴露的只有「给定 D1，输出 8 条」，所以任何抽签策略的改动都要先造 D1 夹具。这是浅模块：接口没有比实现更简单，也没把变化点包住。

### 7.2 切分与接缝

```
src/core/deterministic-random.ts   seededUnit(seed, draw)      ← 无 IO，可被 core 复用
src/core/rumor-select.ts           pickFact / dedupeByPlayer   ← 无 IO，扰动性质可单测
src/worker/rumors.ts               loadFactPool / buildRumors  ← 只碰 D1 与载荷
src/lib/guard.ts                   cachedJson（既有接缝，不改）
```

- **接缝**：`seededUnit` 从 `src/worker/venue-ops.ts:105` 抽到 core，`venue-ops.ts` 改为 re-export。这是一个真接缝，按现有依赖面（`rumors`、`event-ops`、`naming-ops` 三个模块 import 它，`venue-ops` 自己也在用）判断有多处复用；`src/core/ad-board.ts` 用的是自己的 `mulberry32`（`:16`），不参与。
  模块图里 `cachedJson` 归 `src/lib/guard.ts`：定义在 `src/lib/guard.ts:207`，`src/lib/http.ts` 只有 `HttpError`，`src/worker/routes/market.ts:9` 也是从 `../lib/guard.ts` import 的。rev3 把它写成 `src/lib/http.ts`，实现者会去改错文件。
- **深模块**：`pickFact` 的接口是 4 个参数（pool / seed / slot / salt）与一个可空返回，藏在里面的是「确定性 + 最小位移 + tie-break」三条性质。测试可以直接断言性质，不必知道实现。
- **删除测试**：删掉 `rumor-select.ts`，`rumors.ts` 里要重新长出一段选事实的代码，说明它留得住。反之，族选择不做成模块，因为删掉后 `buildRumors` 里只剩一行 switch，长不回来。

### 7.3 盐位表（写进 `rumors.ts` 头注释）

| draw | 用途 | 是否影响公开字段 |
| --- | --- | --- |
| 0 | 位（有据/无据） | 否（只选主体） |
| 1/2/3 | **退役**（rev1 的模板洗牌已删除：每族变体固定，句序不再洗） | — 保留编号不是为了复用，而是为了明确「不要再分配出去」：一旦有新维度拿 1/2/3，旧注释会误导实现者以为句序还在洗 |
| 4 | 族选择（固定全集 `FULL` 上的均匀抽） | 是（族可见），但与位无关；族池为空时该槽回退到「可谈 + 无据」，回退也不读位 |
| 5 | 有据事实（rendezvous 权重） | 是（主体），但与位无关 |
| 6 | 无据事实（rendezvous 权重，补集） | 是（主体），但与位无关 |
| 7 | 去重重抽 | 是（主体），但与位无关 |
| 8 | 保留 | — |
| 9 | 旧假料 id 采样（废弃，不可复用） | — |
| 10 | 无据侧变体选择 | 是（变体），与位无关；有据侧变体由锚点决定，不读盐位 |
| 11+ | 未来维度 | 必须进入可测面：能按条切分的进 TC-RUMOR-12，变体类进 TC-RUMOR-04 的集合相等，卡片级进人工语料回归 |

**rev2 修正**：rev1 让族选择（4）与事实索引（4）共用一个 draw，同时把索引迁移推到 P0-2（阶段二）。这不成立——P0-1 上线当天，族与索引会读同一个数，两维强相关。rev2 把「事实索引迁到 5」写进 P0-1 的验收条件，阶段一就要做完。

### 7.4 接口契约

```ts
type RumorItem = {
  id: string;        // r{season}-{windowSeq}-{slot}
  text: string;
  playerId: number;
  playerName: string;
  clubName: string;
  clubId: number;    // P1 新增
};

type RumorsResponse = {
  rumors: RumorItem[];
  phase: 'open' | 'offseason';   // P1-3 新增
};
```

不新增 `isTruth`、`source`、`filedAt`、`score`、`family`、`variant`。`variant` 只在服务端存在，不上屏也不下发（下发就会变成新的可观测维度）。

---

## 8. 测试计划与验收

### 8.1 范围

**In scope**：生成器的确定性、族与位的关系、变体与位的关系、守卫面、载荷结构、缓存与 purge、限流；`MarketIntelPage` 的三态与链接（jsdom，基建已有）。
**Out of scope**：文案创意与叙事合理性的自动化判定（沿用 `docs/test-plans/v6.18.0-market-ia.md:21`）；视觉排版与焦点顺序（手工 e2e）。

**常量维度不进统计检验**：归因措辞（全部「据一位经纪人称」）、是否含数字（模板里没有数字）、句长都只由族的变体决定，逐条不变或由锚点子态决定。它们不构成侧信道，也不进 TC-RUMOR-12——拿常量做卡方检验永远通过，写进去只会让人误以为测过。真正逐条变化的只有主张族与变体两项，前者进 TC-12，后者进 TC-04 的集合相等。

### 8.2 回归映射

| 用例 | 位置 | 处置 |
| --- | --- | --- |
| TC-RUMOR-01 载荷结构与 id 序列 | `tests/market-intel.test.ts:370-386` | 保持（8 条、id 0..7），P1 键集改六键、加 `phase` 断言同 PR 更新。**新增一条**：夹具里把某名球员的 `display_name` 设成 `Erling Haaland`、`name` 设成 `E. Haaland`，断言载荷的 `playerName` 是前者——这是 5.1 硬约束 1 的守卫，缺了它 `AS playerName` 被删掉也不会红（P0-1 同批） |
| TC-RUMOR-02 同窗逐字相等 | `:388-394` | 保持，追加「重复 5 次逐字相同」 |
| TC-RUMOR-03 换窗换血 | `:396-410` | 保持，槽位期望按新抽取重算 |
| TC-RUMOR-04 真假混排与模板不重复 | `:412-444` | 改写为族内真/无据对称 + 变体集合相等。**必须在固定 200 个窗口上聚合**：单窗 8 条上三族不一定都被抽中，某族的有据/无据也未必同时出现，无据侧更是未必覆盖该族全部变体——按单窗断言基线就会红。聚合口径：每族有据行 > 0 且无据行 > 0；无据侧出现的变体集合等于该族全集，且每个变体至少出现一次。单窗做不到这一点是夹具问题，不是实现问题。 |
| TC-RUMOR-05 守卫 | `:446-469` | 改写为新守卫矩阵，删除「假料不是甲队」断言 |
| TC-RUMOR-06 空池 | `:471-497` | 段一改为冷窗回退（8 条、族固定可谈、全无据、正文互不相同、id 仍 0..7）；段二改为「仅可谈非空」——落在可谈的槽出有据行，落在在挂/留队的槽走槽级回退（可谈族 + 无据），断言仍是 8 条且无占位符 |
| TC-RUMOR-07 不泄漏 | `:499-511` | 保持；P1 键集同 PR 更新 |
| TC-RUMOR-08 缓存命中 | `:513-529` | 测试意图保持，**断言必须改口径**：换窗后的旧期望 `['r4-2-5','r4-2-6','r4-2-7']` 来自被删除的假料 id 池机制（`src/worker/rumors.ts:40-44` 的 `FAKE_PLAYER_POOL`/`FAKE_ID_RANGE` 与 `:159-166` 的随机 id 点查），P0-1 之后必然变化；改成「换窗后 id 前缀为 `r4-2-`、正文与本窗不同、窗口键变化生效」。D1 成本断言拆成 TC-RUMOR-22 |
| TC-RUMOR-09 限流 60/61 | `:531-544` | 保持 |
| TC-RUMOR-10 无开窗回退 | `:546-555` | 保持（P1-3 只加 `phase`，不改回退语义） |

### 8.3 新增用例

| 编号 | 断言 |
| --- | --- |
| TC-RUMOR-11 | 假料主语合法性：`club_id` 非空、`status ∈ normal/trainee`、俱乐部 active 且非 CPU、该球员无跨队成交 |
| TC-RUMOR-12 | 与位独立（只测能在单条上切分、且真的逐条变化的维度）：在 200 个固定窗口上，对**主张族**做有据/无据的 2×3 卡方检验，`p > 0.05`，且每格 lift（有据比例 ÷ 无据比例）落在 [0.67, 1.5]。**只有族这一个维度**：归因措辞在所有条上都是常量「据一位经纪人称」（6.3），是否含数字在所有条上都是常量「不含」（模板里没有任何数字），拿常量做卡方检验永远通过，是无效覆盖——rev3 把这两项留在用例里，等于给读者一个「测了三项」的假象。变体与句长同样不参与：有据侧变体由锚点子态决定（`listed`/`bidding` → 挂牌中，`matched_pending` → 已谈拢，5.1 表），这是设计规定的差异，要求「无显著差异」会让基线直接红。变体只断言「同族两侧变体集合相等」（TC-RUMOR-04）。卡片级指标（涉及俱乐部数）不能按条切分，不进入本用例。 |
| TC-RUMOR-13 | rendezvous 最小扰动：池 ≥20 条事实，加一条后正文变动 ≤2 条 |
| TC-RUMOR-14 | 同窗 `playerId` 唯一 |
| TC-RUMOR-15 | 每个 `clubId` 非空；前端 href 为 `/players?club_id=N` 且不含 `/clubs/` |
| TC-RUMOR-16 | 留队族主体：`to == from` 时 `clubName` 取本队；`rc_change` 文本不含「转会」「报价」 |
| TC-RUMOR-17 | 开窗 `phase='open'`；无开窗 `phase='offseason'` 且 id 仍为 `r{season}-0-{slot}` |
| TC-RUMOR-18 | 写路径 epoch bump 后重算，拆成两条（rev3 把两件互相打架的事写在一条里，只给了一个夹具）：<br>**18a 不改变族集合的写**（例如给已在挂的球员补一条成交、或改一条留队记录的 `from`）：原 id 是新的子集（允许去重丢槽），正文变动 ≤2 条。<br>**18b 补空族**（把原本为空的那一族补到非空，非空族数从 2 变 3）：只有落在该族的槽变化，其余槽的族与正文逐字不变（5.0 固定全集）。<br>两条各自有夹具与写入动作，不能共用一个 `advanceWindow`。 |
| TC-RUMOR-19 | 俱乐部上限：同一俱乐部有据行 ≤ `MAX_GROUNDED_PER_CLUB` |
| TC-RUMOR-20 | 锚点窗口边界，两侧各一条：<br>**20a 卡柜**：造 60 条 listings、其中最早 10 条对应的球员不得成为在挂族有据行（它们不在公开页 50 条窗口内）。<br>**20b 成交表**：造 60 条 completed，其中 10 条较老的 `match`/`rc_change` 落在公开成交表最新 50 条之外——这 10 人不得成为留队族有据行，即使它们在 5.1 的留队池筛选条件下完全合格。20b 是 ADR-0008 的成交侧对照：公开端点不按 `type` 过滤，所以窗口必须先取、type 后筛（5.1 查询 3）。 |
| TC-RUMOR-21 | 在挂池主体一致性：listing 的 `seller_club_id` 与球员 `club_id` 不一致时，该行不出现在载荷（负例夹具） |
| TC-RUMOR-22 | 缓存成本：命中时 `loadFactPool` 不被调用（`vi.spyOn` 计数为 0），窗口解析点查 1-2 次；未命中时 8 条事实查询各执行一次。若 harness 无法 spy 模块内部函数，退化为「命中返回体与首次逐字相同」，并在用例注释里写明这是近似口径 |

### 8.4 夹具改造（rev4 重写）

rev1 只写「在挂种子已有 2 条可复用」，这不够：默认夹具只有 2 名**锚点候选**球员（另有最多 16 名假料池球员，全部挂在 CLUB_A）、2 条 listing、0 条 `transfer_listed`、0 条留队（`tests/market-intel.test.ts:279-289` 灌 `fakeIdPool`、`:268-301`，`addPlayer` 在 `:132-153`），而 TC-RUMOR-01/02/10 都断言 8 条且 id 为 0..7（`:373`、`:553` 等）。同窗去重按 `playerId` 全局唯一，8 个槽最坏情况全落在同一族（族抽签逐槽独立，8 连中同一族的概率是 3·(1/3)^8 = 4.57e-4；TC-RUMOR-12 要在 200 个固定窗口上跑，撞到的概率约 8.7%），所以「每族唯一锚点数 ≥ 该族被抽中的槽数」才是 8 条不掉的条件。

rev2 原文「8 个槽里只要有 3 个以上落在同一族就会掉条」把门槛写错了：掉条的条件是该族唯一锚点数少于落在该族的槽数，与「3 个以上」无关。**下限取 ≥12 是为了同时覆盖跨族撞车**（同一球员既是可谈又在挂时只能出一条）。

**硬性下限**：默认 `seedRumors` 必须给每个族 ≥12 条唯一锚点。

| 族 | 需要的种子 | 数量 |
| --- | --- | --- |
| 可谈 | `transfer_listed = 1` 且有俱乐部的球员 | ≥12 |
| 在挂 | `listings` 三态、`seller_club_id = players.club_id` | ≥12（三态各 4） |
| 留队 | `match` 与 `rc_change`、`from = to = club` | ≥12（各 6） |
| 假料补集 | `club_id > 0`、非 CPU 队、无任何锚点 | ≥24 |

- TC-RUMOR-06 段一需要新的夹具开关 `seedRumors({ anchors: false })`：同时清掉 `transfer_listed`、listings、留队三类，而不是现在的 `listings: false`（`:287-291` 只处理 listings）。
- 新增负例夹具：一条 `seller_club_id ≠ players.club_id` 的 listing（TC-RUMOR-21）；一名有跨队成交、无留队记录的球员（守卫矩阵最后一行）。
- TC-RUMOR-02 只要求同窗稳定，可以继续用默认夹具；TC-RUMOR-09 只看状态码与限流文案，不关心条数；TC-RUMOR-08 仍可用默认夹具加窗口切换，但它的 id 期望要按新机制重写（见 8.2）。
- **helper 迁移（rev3 的改法仍然是错的，rev4 重写）**：`tests/market-intel.test.ts:317-343` 的 `realRelations(fx)` 现在只收 listings 三态与四类跨队成交，不收 `match`/`rc_change`；`:352-360` 的 `expectNoContradiction` 原文是 `if (rel.has(\`${r.playerId}:${r.clubName}\`)) continue; expect(currentClubName(fx, r.playerId)).not.toBe(r.clubName)`。
  - **要删掉的是这条断言本身**：它断言「无据行不得指向现效力队」，而新设计里每条无据行的 `clubName` 都来自 `c.id = p.club_id`（5.1 假料池），即必然等于现东家——那条断言正是要被拆掉的侧信道。rev3 写「对 `grounded=false` 的行执行原断言」，等于让正确的实现全军覆没。
  - 改法：`realRelations(fx)` 补留队关系（`from = to` 的 `rc_change` 与 `match`，双方队名都是本队）；`expectNoContradiction` 换成**按族**的两条断言——有据行：`playerId` 必须在该族的锚点集合里（可谈 = `transfer_listed`、在挂 = listings 三态且在 50 条窗口内、留队 = `match`/`rc_change` 且 `from = to`）；无据行：`playerId` **不得**在该族锚点集合里（其余两族不约束，因为族是逐槽抽的）。
  - 保留「不得与该球员的真实关系撞组合」这一条，键必须是 `playerId:clubId`（或 `playerId:clubName`），不能只有 `playerId`：同一球员对两个不同俱乐部可以分别是「有据」与「无据」的对象，只按 `playerId` 建集合会把合法行判红。
  - 这条迁移与 P0-1 同批；不做的话 TC-RUMOR-05 必然判红。

### 8.5 变异清单（新增）

| 变异 | 期望 |
| --- | --- |
| V16 删除可谈族补集过滤 | TC-RUMOR-05 红 |
| V17 族选择复用盐位 0 | TC-RUMOR-12 红 |
| V18 假料池去掉 `club_id` 过滤 | TC-RUMOR-11 红 |
| V19 rendezvous 换回取模 | TC-RUMOR-13 红 |
| V20 无据侧改用专用模板集合（或恢复「未列入名单」变体） | TC-RUMOR-04 红（变体集合相等断言）。TC-RUMOR-12 抓不到它：变体维度的分布差异是设计规定的（有据侧由锚点子态决定），不进入那个检验 |
| V21 在挂池去掉 `p.club_id = l.seller_club_id` | TC-RUMOR-21 红 |
| V22 `MAX_GROUNDED_PER_CLUB` 改成 `99` | TC-RUMOR-19 红 |
| V23 锚点不按 50 条窗口截断 | TC-RUMOR-20 红 |

V20 的期望在 rev1 里挂错了对象：TC-RUMOR-04 原来只断言 id、互不相同、占位符填满，不锁模板集合，所以那个变异不会红。rev2 把「变体集合相等」写进 TC-RUMOR-04，这条是对的、也是唯一有效的一条；同一版又把「变体 ID」写进 TC-RUMOR-12，那是错的——有据侧变体由锚点子态决定，分布差异是设计要求，基线自己就会红。rev3 删掉 TC-RUMOR-12 的变体维度，V20 只指 TC-RUMOR-04。

### 8.6 D1 预算（当前线上档 / 上界档）

**查询条数与索引归属**（每次缓存未命中）：

| # | 查询 | 走哪个索引 |
| --- | --- | --- |
| 1 | 可谈池（`transfer_listed = 1`） | `idx_players_transfer_listed`（`0064_ad_board.sql:16`，部分索引 `WHERE transfer_listed = 1`，以 `id` 为键，`ORDER BY p.id` 顺带满足） |
| 2 | 在挂池（窗口子查询 `ORDER BY l.id DESC LIMIT 50`） | 窗口子查询按 `status IN (...)` 三值 + 主键倒序，`idx_listings_status_listed`（`0001_init.sql:253`，`status, listed_at DESC`）只能覆盖 status 过滤、不覆盖 `id` 序；实现时以 `EXPLAIN QUERY PLAN` 为准。外层的 `p.club_id = w.seller_club_id` 走 `idx_players_club`（`:263`） |
| 3 | 留队池（窗口子查询 `ORDER BY t.completed_at DESC, t.id DESC LIMIT 50`） | `idx_transfers_status_time`（`0058_transfers_status_time.sql:7`，`status, completed_at DESC, id DESC`）正好匹配窗口子查询 |
| 4 | 假料池（`club_id > 0`） | `idx_players_club`（`0001_init.sql:263`）范围扫。**不能**靠 `idx_players_club_ca`（`0030_players_club_ca_index.sql:15`，`club_id, ca DESC, id`）省排序：那是「同一 club 内按 ca 再按 id」的序，不是全局 `p.id` 序。要么去掉 `ORDER BY p.id` 在内存里排，要么改成 `ORDER BY p.club_id, p.id` 让索引真正可用 |
| 5-8 | 四个集合（可谈/在挂/留队/跨队） | 可谈集合走 `idx_players_transfer_listed`；在挂集合走 status 索引（`0001_init.sql:253`）而不是 `idx_listings_player`（`:266` 只覆盖 `player_id`，不覆盖 `status` 过滤）；留队/跨队集合走 `idx_transfers_status_time`（`0058`：`status, completed_at DESC, id DESC`）或 `idx_transfers_player`（`:270`）——**这些是候选，不是结论**，最终以 `EXPLAIN QUERY PLAN` 为准 |

rev1 把这些查询统一写成 `idx_listings_player` / `idx_transfers_player`，rev2 改了一半，rev3 又把 `idx_players_club_ca` 写成「可省排序」——那一句是错的，已按上表更正。索引归属一律标成候选，不当作结论。

**数字**（分两档，上界档按表规模推导，不再用「当前行数 + LIMIT 上限」混加）：

| 档位 | 可谈 | 在挂 | 留队 | 假料池 | 四个集合 | 单次未命中读量 |
| --- | --- | --- | --- | --- | --- | --- |
| 当前线上（2026-10 实测：`transfer_listed = 1` 17 人、`listings` 空、市场类成交 0、`match`/`rc_change` 28 条） | 17 | 0 | 28 | 570 | ≤45 | ≈ 660 行 |
| 上界档（按表规模，不按 LIMIT） | ≤ 有俱乐部的球员数（≤ 18,301） | ≤ 50（窗口） | ≤ 50（窗口） | ≤ 18,301 | 集合 5 ≤ 18,301、集合 6/7 ≤ 50、集合 8 ≤ `transfers` 行数 | ≈ 5.5 万 + `transfers` 行数 |

- 上界档的口径：查询 1 与 4 **没有 LIMIT**（5.1），所以它们的上界是「有俱乐部的球员数」（`players` 共 18,301 行，自由身 17,731，剩 570 是目前 `club_id > 0` 的实测值），不是 200。rev3 的「全量规模 = 570 / ≤200」把当前实测值当成了上界，且没有任何 SQL 支撑，已删。查询 2/3 有窗口，上界就是 50。
- 若实际要把上界压下来，可选动作有两个（都不在本轮）：给查询 1/4 加 `LIMIT`（会牺牲补集完整性，需要重新论证去重下限）或改成「按俱乐部抽样」（`ORDER BY random()` 等价物在 D1 上不可控）。这条留到 §11 第 8 问一起拍。
- rev2 原文的 `570 + 50 + 50 + ≤200 ≈ 900` 一边用 LIMIT 上限（50/50/200）一边用当前行数（17/28），两档都不是，所以删掉重列。
- 每次命中读量 = 1-2 次 `season_windows` 点查 ≈ 2 行。
- 日读量 ≈ `W × R + H × 2`，其中 `R` = 单次未命中读量（当前档 660，上界档 5.5 万 + `transfers` 行数），`W` = 触发 purge 的写请求数（`/api/market`、`/api/players` 前缀非 GET 2xx，`src/lib/cache-policy.ts:58-73`），`H` = 当日命中数。
- 算例（`W = 2,000`）：当前档约 1.3M 行/天；上界档约 1.1 亿行/天 + `transfers` 行数 × 2000。两档差三个数量级，这正是必须把 1/4 的扫描面钉清楚的原因。D1 的读行额度随套餐而定，本次未查套餐数值，所以只给公式与算例，不宣称「一定在额度内」——见 §11 第 8 问。

### 8.7 验收标准

- P0 用例全过；P1 用例通过率 ≥90%（qa-test-planner 的通过标准）。
- `npm test` 与 `npm run typecheck` 全绿（`AGENTS.md:46`）。
- **窗口覆盖改在夹具里做**：固定 4 个窗口（例如 `(4,1)`、`(4,2)`、`(5,0)`、`(9,1)`）跑同一套断言。rev1 写的「线上抽查 4 个不同窗口」在无开窗的生产环境不存在——`resolveRumorWindow` 对所有请求都返回 `(visibleSeason, 0)`（`src/worker/rumors.ts:22-27`），四个窗口只有拿到临时开窗授权才可能。
- 线上只验两件可执行的事：① 同一窗口多次请求逐字相同；② 抽出的有据行，点进球员页或卡柜能在**公开端点自己的 50 条窗口**内找到对应记录——在挂族对 `/market` 卡柜（三态、`ORDER BY l.id DESC`），留队族对 `/market/deals`（**不按 type 过滤**）。「在 50 条窗口内」是 ADR-0008 的实现口径（窗口先取、type 后筛），不是「在通过 type 过滤后的 50 条里」。
- 语料回归（人工）：导出 30 个窗口 240 条文案，逐条判「状态主张是否有锚点」「意图主张是否归因」「有没有把违约金说成转会费」。

---

## 9. 分阶段落地

| 阶段 | 内容 | 独立验收 |
| --- | --- | --- |
| 一 | P0-1 主张-锚点重构（**含事实索引迁到盐位 5**）+ P0-3 卡片文案与三态 + `MarketIntelPage.test.tsx` + 8.4 的两个 helper 迁移（`realRelations`/`expectNoContradiction`） | TC-RUMOR-01/02/03/06/07/08/09/10 绿（08 按 8.2 新口径），04/05 改写后绿，三态 jsdom 绿；线上验收两条可执行项通过 |
| 二 | P0-2 rendezvous + 去重 + core 抽取 | TC-RUMOR-13/14/18 绿；02/03 不回归 |
| 三 | P1-1 clubId + 双主体链接（含 P1-2 缓存键 v2 同批） | TC-RUMOR-15 绿；键集断言更新 |
| 四 | P1-3 窗口 phase 与冷窗文案 | TC-RUMOR-17 绿；10 不回归 |
| 五 | P1-4 俱乐部上限 | TC-RUMOR-19 绿 |
| 六 | P2 三项择一 | 各自单独评审 |

阶段一与阶段二可以并行开发，上线顺序固定。阶段一必须自带「索引迁到 5」，因为族选择当天就要占住盐位 4。

---

## 10. 不做什么

- 不做逐条发稿时间、电头时间、关窗倒计时、「本窗第 N 天」。
- 不做逐条信源角色字段，不设虚构记者、编辑部署名，不写「截稿前未获俱乐部回应」。
- 不设头条、导语分级、热度、可信度徽标、已证实标记、辟谣状态。
- 不做合同年/续约停滞真料族——`contracts` 没有到期或年限列（`0001_init.sql:53-65`）。
- 不做 edition 快照迁移（本轮），不公开 `rev`/`pool_hash`。
- 不拆 `market` 限流桶，不改 60 次/60 秒口径。
- 不做买方视角传闻，不做 `counterpartyClub` 字段。
- 不做公开俱乐部摘要页，`/clubs/:id` 维持登录可见。
- 不改成交表 7 列结构、不动 MarketNav、不改表格 sticky 口径。
- 不引入实时依赖（推送、外部 feed、WebSocket、定时刷新）。
- 不按池大小调条数。
- 不给 `/market/transfer-board` 加 club 参数（会按俱乐部数放大缓存键）。

---

## 11. 需要用户拍板

1. 接受「统一现东家视角」、放弃「某队想买 X」的买方传闻吗？（ADR-0003）
2. 真料锚点用 `players.transfer_listed`（当前 17 人，只来自 4 家俱乐部）。接受它，还是宁可继续 0 真？
3. `match`（匹配留队）与 `rc_change`（续约）算不算传闻主题？「续约」进传闻是本设计的一个假设。
4. 匿名读者点队名去 `/players?club_id=N`（该队名单）够不够？还是要公开俱乐部摘要页？
5. 要不要 edition 快照（迁移 0078）以支持「上一期情报 / 球员传闻档案」？
6. 休赛期要不要按日换血（种子加日期分桶）？现在整段休赛期内容不变，冷窗回退还会让 8 条同构。
7. 版本归属：这轮算 v6.53.x 增量还是独立 v6.54.0？按 `AGENTS.md:47` 需要先落 `docs/test-plans/<版本>-rumor-claim-anchor.md`。
8. D1 套餐的读行/日额度是多少？8.6 只给了公式与两档算例（`W=2000` 时当前线上档约 1.3M 行/天、上界档约 1.1 亿行/天 + `transfers` 行数 × 2000），没有额度数值无法判断是否超限。两档差三个数量级，原因是查询 1/4 没有 LIMIT（5.1、8.6），上一版把当前 570 当成上界，低估了。
9. 是否给 `/api/market/listings` 与 `/api/market/deals` 加**俱乐部过滤**与**可翻页的锚点窗口**？`player_id` 参数在 listings 上已经存在（`src/worker/routes/market.ts:110-115`），缺的是 club 过滤与翻页——加了就能让锚点回到全集（ADR-0008 的选项 A），但要动两个公开端点的分页语义。rev3 把这一问写成「加按球员的分页入口」，比实际更「从零开始」，已改。
10. `clubs.status` 的生产取值有哪些？守卫暂按 `= 'active'` 写，依据只是夹具（`tests/market-intel.test.ts:80`）；如果生产存在别的取值，要么放宽守卫，要么补一张状态白名单。

---

## 12. 附录

### 12.1 本次诊断读过的文件

`src/worker/rumors.ts`、`src/worker/routes/market.ts`、`src/worker/routes/players.ts`、`src/worker/routes/clubs.ts`、`src/worker/index.ts`、`src/worker/venue-ops.ts`、`src/lib/guard.ts`、`src/lib/cache-policy.ts`、`src/core/ad-board.ts`、`src/worker/player-ref.ts`、`web/src/pages/market/MarketIntelPage.tsx`、`web/src/pages/market/MarketAdBoardPage.tsx`、`web/src/App.tsx`、`web/src/lib/api.ts`、`web/src/lib/queries.ts`、`web/src/lib/player-link.ts`、`web/src/lib/players-library.ts`、`web/src/styles.css`、`vitest.config.ts`、`src/db/migrations/0001_init.sql`、`0006_activation_negotiation.sql`、`0026_clubs_is_cpu.sql`、`0030_players_club_ca_index.sql`、`0037_offers.sql`、`0058_transfers_status_time.sql`、`0064_ad_board.sql`、`tests/market-intel.test.ts`、`docs/test-plans/v6.18.0-market-ia.md`、`UI_DESIGN.md`、`AGENTS.md`。

### 12.2 跑过什么

- 只读 grep / sed 若干次：`seededUnit` 位置与 import（`venue-ops.ts:105`、`:9-14`）、`shuffleWithSeed` 与 `mulberry32`（`ad-board.ts:28`、`:16`）、`clubs.ts` 的 `requireUser`（`312`/`313`/`581`）、`App.tsx` 路由行号（`105`/`108`/`109`/`110-117`/`118`/`119`/`137`）、`players.ts` 的 `transferListed`（`:785`、`:1219`）、`market.ts` 的两个公开窗口（`:126`、`:363`）、`useRumors` 的 queryFn（`queries.ts:253-260`）、`RumorItem`/`RumorsResponse`（`api.ts:965-971`、`:973-974`）、`vitest.config.ts:12-17` 的 include、`web/src/pages/market/*.test.tsx` 的存在、`tests/market-intel.test.ts` 的 `seedClubs`/`addPlayer`/`seedRumors`（`:77-85`、`:132-153`、`:268-301`）与 8 条断言位置（`:373`、`:553`）、索引定义（`0001_init.sql:253/263/266/270`、`0026:3`、`0030:15`、`0058:7`、`0064:16`）、`players.status` 取值（`0001_init.sql:17`）。
- `npx vitest run tests/market-intel.test.ts` **rev4 本轮实跑**：`26 passed`，`Duration 6.31s`（`tests 2326ms`），vitest `v3.2.7`，Node 报 `SQLite is an experimental feature` 警告（既有，与本次无关）。这条是本次唯一实跑的测试，`npm test` 全量与 `npm run typecheck` **本轮未跑**。

### 12.3 没覆盖什么

- 未连生产 D1 复核 17/0/0/28 这组数字。
- 未跑 `npm test` 全量、未跑 `npm run typecheck`。
- 未做浏览器实机验证（375/768/1280 三视口），新写的 `MarketIntelPage.test.tsx` 也只是计划，尚未创建。
- 未验证 `/players?club_id=N` 在 UI 上是否有可见的筛选回显。
- 未评估新模板文案的实际阅读效果。
- 未用 `EXPLAIN QUERY PLAN` 确认在挂/留队两条查询最终走哪个索引（8.6 给的是候选与判断，不是实测计划）。
- 未查 D1 套餐额度数值。

### 12.4 本次使用的 skill

`brainstorming`、`grilling`、`news-writing`、`frontend-design`、`codebase-design`、`architecture-designer`、`domain-modeling`、`qa-test-planner`、`code-review-skill`、`humanizer-zh`。

### 12.5 rev1 → rev2 的处理（21 条，作者侧整理）

> 溯源更正：这一张表是 rev1 改写成 rev2 时的自述处理清单，**不是独立复核**，编号与 12.6、12.7 的两套独立复核互不通用，不能相加。下文 12.6 是本轮之前的 14 条复核，12.7 是这一轮的 10 条。

| # | 复核意见 | 处置 |
| --- | --- | --- |
| 1 | 可谈族「愿听报价 / 未列入名单」与对位共用冲突 | **修**：可谈族只留一条变体（5.1 表、6.3 表）；TC-RUMOR-04 增加「同族两侧变体集合相同」断言 |
| 2 | 无据行子模板未定义，可能成新 tell | **修**：有据侧变体由锚点决定，无据侧由盐位 10 在全集上均匀抽；两侧共享同一变体集合；ADR-0006 补丁 + TC-RUMOR-12 变体维度（rev3 已把变体维度从 TC-12 移回 TC-04，见 12.7 #1） |
| 3 | 三族全空时无回退 | **修**：5.1 定义冷窗回退（族固定可谈、全无据、8 条照发）；TC-RUMOR-06 段一按此写 |
| 4 | 夹具只有 2 条锚点，TC-01/02/10 会掉条 | **修**：8.4 给每族 ≥12 条锚点下限 + `anchors:false` 开关；保留 TC-01/02/10 的 8 条断言 |
| 5 | 假料主体算法未定义、补集无 ORDER BY | **修**：假料主体也走 rendezvous（盐位 6）+ 池子 `ORDER BY p.id`；7.3 写明；TC-RUMOR-02 加「重复 5 次」 |
| 6 | 全局守卫「有已完成市场类成交」没有查询 | **修**：补第 8 条集合查询（跨队成交），预算改 8 条；8.5 增加对应负例 |
| 7 | 阶段一盐位 4 与事实索引撞车 | **修**：事实索引迁到盐位 5 写进 P0-1 与阶段一验收 |
| 8 | 「线上抽查 4 个窗口」不可执行 | **修**：8.7 改为夹具内固定 4 窗口 + 两条可执行线上验收 |
| 9 | 「不写 web 测试」依据过时 | **修**：5.3 新增 `MarketIntelPage.test.tsx` 计划，TC-RUMOR-15 拆后端/前端；依据 `vitest.config.ts:12-17` 与既有两个 jsdom 测试 |
| 10 | V20 变异抓不到 | **修**：TC-RUMOR-04 加变体集合断言、TC-RUMOR-12 加变体维度，V20 指过去（rev3 收窄为只指 TC-04，见 12.7 #1） |
| 11 | 锚点集合与公开页 LIMIT 50 不一致 | **修**：新增 ADR-0008，锚点限定在公开页可见窗口内；留队池 LIMIT 30 → 50；TC-RUMOR-20 锁边界 |
| 12 | 留队族与「只承担态度与打算」自相矛盾 | **修**：2.1 改成按「是否仍在队内」分工，明确允许「刚发生」的状态主张 |
| 13 | 在挂池「锁定现东家」没落成 SQL | **修**：加 `p.club_id = l.seller_club_id`；TC-RUMOR-21 用负例锁住 |
| 14 | phase 被 `useRumors` 丢掉 | **修**：`RumorsResponse` 改 `{ rumors, phase }`，`useRumors` 返回整个响应；5.6 写明，TC-RUMOR-17 断言 |
| 15 | P1 俱乐部上限没有对应增量 | **修**：新增 P1-4 + TC-RUMOR-19 + V22 |
| 16 | 索引归属错、日预算无数字 | **修**：8.6 按查询分别标索引（并标为候选，以 `EXPLAIN QUERY PLAN` 为准）并给公式与两档算例；具体数字以 8.6 为唯一来源，本表不重复（rev3 在这里写死 `W=2000 → 1.8M 行/天`，与 8.6 的两档算例打架，已改为指针）；额度数值进 §11 第 8 问 |
| 17 | 行号漂移与内部不一致 | **修**：`api.ts:965-971`、`App.tsx:105/108/109/110-117`、`addPlayer:132-153`；`pickFact` 统一 4 参；删除 ad-board 是第三调用方的说法（它用 `mulberry32`，`ad-board.ts:16`） |
| 18 | §12.5 两处过度声明 | **修**：留队池仍 `LIMIT 50`（不是 30），「问题随之消失」改成「假料守卫不再依赖 30 天边界」；fcId 一项删除 |
| 19 | 「没有捷径标签」措辞过强 | **修**：3.1 与 ADR-0001 改成「没有平台贴的真假标签，但可谈族可由球员页的 `transfer_listed` 一字段核对」 |
| 20 | （同 1/2 的变体泄漏，合并处置） | 见 #1、#2 |
| 21 | 验收口径「线上 4 窗口」与无窗生产矛盾 | 见 #8 |

未被采纳、只写进 openQuestions 的两项：ADR-0008 的选项 A（公开端点加分页，让锚点回到全集）与 D1 套餐额度，因为前者要改两个公开端点的分页语义，后者只有运行方能提供数值。

### 12.6 第一轮独立复核（14 条，rev2 已处理，rev3 复核）

| # | 复核意见 | 处置 | 落点 |
| --- | --- | --- | --- |
| 1 | 「真假不可见」与「真假 = 公开锚点存在」互斥 | 术语改「有据/无据」，承诺从「不可判定」降为「可查证」 | ADR-0001、2.1、TC-RUMOR-12 |
| 2 | 主体俱乐部语义错位（成交行 `{club}` 是买家） | 删成交族，三族主体恒为现东家 | 2.1、5.1、`src/worker/rumors.ts:216` |
| 3 | 族级真假对称不可能（在挂/成交族真行恒 0） | 固定全集抽样 + 空族走槽级回退 | 5.0、5.1 |
| 4 | 60s window cache 会打破 TC-RUMOR-08 | 取消 window cache，保留每请求 1-2 次点查 | 5.5、`tests/market-intel.test.ts:514-528` |
| 5 | 六键 DTO 没有 `fcId` 却要 fcId 链接 | 不加 `fcId`，球员链接用 `playerId` | 5.4、7.1 |
| 6 | 假料池全表扫 + `NOT EXISTS` 读放大 | 改 `club_id > 0` 走 `idx_players_club`（`0001_init.sql:263`） | 5.1、8.6 |
| 7 | 「`LIMIT 30` 天然近期窗」不成立 | 守卫改为排除该球员全部已完成市场类成交，不设 30 天边界 | `src/worker/rumors.ts:140-149`、5.1 |
| 8 | 成交/留队行的现东家是事后推断 | 留队池加 `p.club_id = t.to_club_id` | 5.1 |
| 9 | core 引用 venue-ops 破坏分层 | `seededUnit` 抽到 `src/core/deterministic-random.ts`，`src/worker/venue-ops.ts:105` 改为 re-export | 7.0、8.6 |
| 10 | rendezvous「≤2 条变化」在小池不成立 | 用例池造到 ≥20 条；「原 id 是子集」的断言落在 **TC-RUMOR-18a**（rev3 在本表把它错挂到 TC-13；8.3 的 TC-13 是「池 ≥20，加一条后正文变动 ≤2」） | 8.3 TC-13、TC-18a |
| 11 | `market-window` scope 不在 `PUBLIC_SCOPES`；429 归因 | 取消 window cache；429 来自 `assertPublicRate(c,'market')`（`src/lib/guard.ts:29-34`），不是 D1 | 5.5、8.7 |
| 12 | 在挂族与广告板不同源 | 在挂族查证面是 `/market` 卡柜，可谈族才是 `/market/board`（rev3 落点写成 ADR-0005 是错的：ADR-0005 讲时间与信源，锚点与查证面的分工在 2.3/2.8） | 2.3、2.8、6.3 |
| 13 | 夹具缺 `transfer_listed`/`match`/`fcId` | 8.4 给每族 ≥12 锚点 + `anchors:false` 开关 + 负例夹具 | 8.4、`tests/market-intel.test.ts:268-301` |
| 14 | 小错：`.form-row` 定性、`clubs.ts` 行号、函数名 | `.form-row` 是 flex 行；`app.get('/clubs/:id'` 在 `:312`、`requireUser` 在 `:313`；函数名 `shuffleWithSeed`（`src/core/ad-board.ts:28`） | 6.1、7.0 |

### 12.7 第二轮独立复核（10 条，rev3 处理）

| # | 复核意见 | 处置 | 落点 |
| --- | --- | --- | --- |
| 1 | TC-RUMOR-12 六维度不可通过（变体/句长差异是设计规定的，俱乐部数不能按条切分） | 只测主张族、归因措辞、是否含数字；2×k 卡方 `p > 0.05` + lift ∈ [0.67, 1.5]；变体只保留「同族两侧集合相等」 | 8.3 TC-12、8.5 V20 |
| 2 | 族抽签依赖「非空族列表的长度」，加一条挂牌会重排所有槽 | 族固定全集 `FULL = [可谈, 在挂, 留队]`（盐位 4 取 `floor(u*3)`），族池空的槽走槽级回退 | 5.0、5.1、5.2、8.3 TC-18 |
| 3 | TC-RUMOR-08 的「保持原样」不成立（旧期望绑在被删的假料 id 池上） | 意图保持，id 断言改口径；D1 成本拆成 TC-RUMOR-22 | 8.2、5.5、8.3 |
| 4 | 阶段一漏了 TC-RUMOR-08 | 已补进阶段一验收，并把 helper 迁移写进同阶段 | §9、8.4 |
| 5 | §12.5 声称 21 条，与上一轮的 14 条不是同一套 | 拆成 12.5（作者侧 21 条）/12.6（第一轮 14 条）/12.7（本轮 10 条），注明不可相加 | 本节 |
| 6 | 8.4 没列 helper 迁移 | 新增 bullet：`realRelations` 补留队关系，`expectNoContradiction` 加 `groundedIds` 参数（rev4 更正：这个改法本身是错的，见 12.8 #1） | 8.4、`tests/market-intel.test.ts:317-360` |
| 7 | 8.6「最坏情况」实为当前数据且自相矛盾 | 分两档表：当前线上 ≈660 行、全量规模 ≈1070 行；日读量给两个算例（rev4 更正：1070 不是上界，见 12.8 #5） | 8.6、5.1 |
| 8 | `RumorItem` 键集表述前后相反 | P0 阶段五键、P1-1 才加 `clubId`，写明阶段 | 5.1、5.4 |
| 9 | 8.4「3 个以上同族就掉条」与 ≥12 锚点矛盾 | 重写门槛：掉条条件是该族唯一锚点 < 落在该族的槽数 | 8.4 |
| 10 | 「部署后手动 purge 一次」不可执行 | 删该条；仅靠 v2 键 + 1h TTL 收尾，并给出 `purgePublicCaches` 的唯一调用点作为依据 | 5.5、`src/lib/guard.ts:139`、`src/worker/index.ts:64`/`:259` |

### 12.8 第三轮独立复核（17 条，rev4 处理）

| # | 复核意见 | 处置 | 落点 |
| --- | --- | --- | --- |
| 1 | `expectNoContradiction` 的迁移改法仍把正确实现判红（无据行的队名本来就等于现东家） | 删掉「无据行不得指向现效力队」这条断言（它就是要拆的侧信道），改为按族断言：有据行在该族锚点集合内、无据行不在该族锚点集合内；保留撞组合断言，键必须是 `playerId:clubId` | 8.4 helper bullet、`tests/market-intel.test.ts:317-343`/`:352-360` |
| 2 | 5.1 重写后的四条池查询丢了 `AS playerId`/`AS playerName` 与 `sqlDisplayName`，会渲染 undefined 或退回缩写名 | 四条查询统一 `p.id AS playerId`、`${sqlDisplayName('p')} AS playerName`；5.1 新增两条硬约束（列名一律 AS camelCase、锚点窗口与公开端点同源），并写明显示名口径来自 `src/core/player-name.ts:16`；P0-1 加一条「载荷里的 `playerName` 不是缩写名」的断言 | 5.1、8.2 TC-01、`src/worker/rumors.ts:126-128` |
| 3 | TC-12 三项里「归因措辞」「是否含数字」是常量，等于无效覆盖 | 二选一取 ②：只留主张族；6.3 归因统一为一种并删掉「两种」的自相矛盾句；8.1 新增「常量维度不进统计检验」；2.1 的分流句同步 | 6.3、8.1、8.3 TC-12、2.1 |
| 4 | ADR-0008 承诺锚点 ≡ 公开页 50 条窗口，但 5.1 先按主体/type 过滤再 LIMIT，窗口不同源 | 查询 2/3 改成 `WITH win AS (… ORDER BY … LIMIT 50)` 先取公开窗口、再 JOIN 与 type 过滤；ADR-0008 补「实现口径」段；TC-20 拆 20a（卡柜）/20b（成交表，公开侧不按 type 过滤）；8.7 线上验收同步口径 | ADR-0008、5.1、8.3 TC-20、8.7 |
| 5 | 8.6「全量规模」仍不是上界：查询 1/4/5-8 没有 LIMIT，570 是当前实测 | 档位改名「上界档」，可谈/假料池上界改为「有俱乐部的球员数（≤18,301）」，集合 8 上界为 `transfers` 行数；单次读量 ≈5.5 万 + `transfers` 行数；日读量给 1.3M 与 1.1 亿两个算例；§11 第 8 问同步 | 8.6、5.1、§11 第 8 问 |
| 6 | TC-04 改成「族内对称 + 变体集合相等」但没写窗口数，单窗 8 条基线就会红 | TC-04 明写「在固定 200 个窗口上聚合」，并给聚合口径（每族两侧 >0、无据侧变体集合等于全集且各自出现） | 8.2 TC-04 |
| 7 | 3.5/7.2 说 `seededUnit` 只有两个调用方，实际四个模块 | 改为四个依赖模块（`venue-ops`/`rumors`/`event-ops`/`naming-ops`），抽取理由改为分层与复用 | 3.5、7.2 |
| 8 | 7.2 把 `cachedJson` 归到 `src/lib/http.ts`，实际在 `src/lib/guard.ts:207` | 模块图与接缝说明都改为 `src/lib/guard.ts`，并注明 `http.ts` 只有 `HttpError` | 7.2 |
| 9 | 8.4「默认夹具只有 2 名球员」不准确 | 改为「2 名锚点候选 + 最多 16 名假料池球员」，并指出只有 2 名是锚点候选 | 8.4 |
| 10 | 8.4 的 `3·(1/3)^8 ≈ 1.5e-4` 算错 | 改为 4.57e-4，并补「200 窗口撞到概率约 8.7%」 | 8.4 |
| 11 | 8.6 索引归属错：`idx_players_club_ca` 不能省 `ORDER BY p.id`；集合 6/7/8 应看 status/type 索引 | 索引表逐条重写，删「可省排序」并给两个替代写法；集合行改 status/type 索引起步；全表标「候选，以 EXPLAIN QUERY PLAN 为准」 | 8.6 |
| 12 | 7.3 仍把盐位 1/2/3 写成「模板洗牌」 | 标为退役（rev1 的模板洗牌已删除），并说明保留编号是为了防止被误复用 | 7.3、5.1 |
| 13 | 12.5 #16 的 `W=2000 → 1.8M` 与 8.6 不一致 | 12.5 改为指针（数字以 8.6 为唯一来源），不再写死算例 | 12.5 #16 |
| 14 | 12.6 #10 把「原 id 是子集」错挂 TC-13；#12 落点写 ADR-0005 | #10 改指 TC-18a；#12 落点改 2.3/2.8（ADR-0005 讲时间与信源） | 12.6 #10、#12 |
| 15 | TC-18 把「≤2 条变化」与「补空族」放在一条里，两个断言互相打架 | 拆 TC-18a（不改族集合的写：原 id 是子集、正文变动 ≤2）与 TC-18b（补空族：只有该族槽变化、其余逐字不变），注明不能共用 `advanceWindow` | 8.3 TC-18 |
| 16 | §11 第 9 问说「加按球员的分页入口」，但 listings 已有 `player_id` | 改为「加俱乐部过滤与可翻页的锚点窗口」，并注明 `player_id` 已存在（`src/worker/routes/market.ts:110-115`） | §11 第 9 问 |
| 17 | 12.2 写 6.13s，上一轮实跑是 6.55s | rev4 本轮实跑得 26 passed / 6.31s，两处按本轮结果改写并注明上一轮的 6.55s 与 rev3 的 6.13s 偏差来源 | 1.4、12.2 |

三套溯源的分工不变：12.5 是作者侧整理、12.6 与 12.7 与 12.8 是三独立轮次，条数不可相加。
