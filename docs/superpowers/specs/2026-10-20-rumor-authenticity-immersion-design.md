# 转会中心「传闻」真实性与沉浸感改造设计

- 状态：待评审（设计稿，不含实现）
- 日期：2026-10-21（**rev9**：owner m00744 决定允许「球队 × 非本队球员」的买方传闻——ADR-0003 被 ADR-0009 取代、主张族从三族扩为四族、假料改为按公开阵容数据确定性匹配；rev8 按第七轮独立复核的 2 条 medium 修订——行号口径与三族种子 helper；rev7 按第六轮 7 条；rev6 按第五轮 10 条；rev5 按第四轮 7 条；rev4 按第三轮 17 条；rev3 按第二轮 10 条；rev2 按第一轮 14 条与作者侧 21 条整理；rev1 为 788 行初稿）
- 范围：`src/worker/rumors.ts`、`GET /api/market/rumors`、`web/src/pages/market/MarketIntelPage.tsx`、`web/src/lib/queries.ts`、`web/src/lib/api.ts`
- 不改：数据库结构（P0/P1）、成交表列结构、MarketNav、`/clubs/:id` 的登录策略

---

## 0. rev9 决定摘要（owner m00744，2026-10-21）

> 本节是 rev9 的权威摘要。旧章节中凡与「主体恒为球员 + 现东家」冲突的表述，以本节、ADR-0009、5.1A、5.4 与 §12.14 为准；旧文字保留为历史诊断，不再代表当前设计。

### 0.1 主体

- 传闻主体从 `(playerId, 现东家)` 改为 `(clubId, playerId, clubRole)`；`clubRole ∈ current | buyer`。
- `current`：卖方/现东家视角（可谈、在挂、留队）。
- `buyer`：买方视角，俱乐部不是球员现东家（出价/报价）。
- P0 纳入自由身球员：`currentClubId=0`、`currentClubName='自由身'`；自由身只出现在买方族（卖方三族仍要求有现东家），真料只来自内部 `offers`，玩家不可公开核对（见 §2.1、§5.1A）；实现前置 P0-0 见 §5.1A/§11 #15。

### 0.2 真料来源

- 卖方：`transfer_listed`（可谈）、`listings` 三态（在挂）、`match`/`rc_change`（留队）。
- 买方：公开 `bids`（listing 详情页可见；`bids.status='active'`）与内部 `offers`（`status IN ('pending','intent')`；P0 即查，公开页查不到，标 internal；自由身真料只来自这里，需 P0-0 扩展 offers 写入路径）。`offers` 不满足 ADR-0008 的公开窗口，是已知代价。
- 假料主体不按 CA 硬切，而是按真料锚点的公开协变量（位置 × CA 分层）做**分层抽样**：目标比例用 Dirichlet 平滑（`α=0.5`），每层保留非零概率；低 CA 仍可能出现，只是概率由真料分布决定。真料锚点不按 CA 过滤。候选帧 `M=256`，按 `season:windowSeq` 缓存 1h，不随市场写 purge；详见 §5.1B/§5.1C。
- 已完成跨队转会仍由成交表承担，不作为传闻族。

### 0.3 主张族与真假

- `FULL = [可谈, 在挂, 留队, 出价]`（4 族）；`family(slot)` 用盐位 4 在固定全集上抽。
- 真假仍由盐位 0 的位决定；同族同角色共用模板；买方假料不设专用模板。
- 冷窗（四族全空）按 `slot % 2` 固定分到可谈/出价，全部无据；这是槽位函数，不读位。

### 0.4 假料匹配（不是随机配对）

- 卖方假料：主体仍是球员现东家；排除该族真实锚点。
- 买方假料：先为每名球员按公开阵容数据选一个 active/non-CPU、非现东家的俱乐部：
  - `positionNeed = 1 / (1 + 该俱乐部同位置人数)`；
  - `qualityFit = 1` 若球员 CA 落在该队主力 CA 带内，否则 0.6；
  - `ageFit = 1` 若 18-30，否则 0.6；
  - `jitter = 1 + 0.1 * seededUnit([...seed, playerId, clubId], 11)`；
  - `weight = positionNeed * qualityFit * ageFit * jitter`，取最大值，平手按 clubId 升序。
- 排除 `(clubId, playerId)` 的真实 bid/offer 与已完成跨队成交；排除 CPU/非 active；买方允许自由身（`currentClubId=0`，只配 `已报价` 变体）；不读位。俱乐部画像查询（clubs + registrations + players 聚合，≤20 行）随帧缓存，**不增加每次请求的查询**，匹配在内存里做。

### 0.5 载荷与 UI

- `RumorItem` 从五键扩为九键：`id/text/playerId/playerName/clubId/clubName/clubRole/currentClubId/currentClubName`；P1-3 再加 `phase`。
- 买方行：`clubId` 是买方，`currentClubId` 是现东家；UI 显示「买方 · 现东家 · 球员档案」三个链接（自由身买方只有「买方 · 球员档案」两个链接）；卖方行两个链接（现东家 · 球员档案）。
- 缓存键 P0 升 `market-rumors:v3`；P1-3 加 `phase` 再升 v4。
- 不显示真假/可信度；`clubRole` 是族的属性，不是真假标记。

### 0.6 分期

- 阶段一：卖方三族 + 买方 bids（公开）+ 内部 offers（P0；自由身真料，不可公开查）+ 四族 + 九键载荷 + 买方假料匹配（含自由身）+ 文案/测试；原 P1-1 clubId 并入阶段一。
- 阶段二：rendezvous/去重/core 抽取。
- 阶段三：phase 字段与冷窗文案（缓存键 v4）。
- 阶段四：俱乐部上限。
- 阶段五：P2。

---

## 1. 现状诊断

### 1.1 机制事实（读码所得）

| 事实 | 证据 |
| --- | --- |
| 种子只含 `[season, windowSeq]`，头注释承诺「同窗 8 条逐字稳定、刷新不变」 | `src/worker/rumors.ts:2-3`、`:187` |
| 载荷五键：`id/text/playerId/playerName/clubName`，无时间、无来源、无 clubId | `src/worker/rumors.ts:29-37`、`web/src/lib/api.ts:965-971` |
| 响应类型是 `{ rumors }`，没有第二个字段 | `web/src/lib/api.ts:973-974` |
| 前端 `useRumors` 的 queryFn 只取 `.rumors`，响应里多出来的字段会被直接丢弃 | `web/src/lib/queries.ts:254-260` |
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

- `GET /api/market/listings` 返回空列表；市场类成交 0 条；`transfer_listed = 1` 的球员 18 名，来自 4 家俱乐部。
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

事实索引是 `pool[floor(seededUnit([...seed, slot], 4) * pool.length)]`（`:206`、`:215`），池长一变全部真料槽整体位移；而任意一次市场写入都会让缓存键失效（`src/lib/guard.ts:218`），所以本窗内「换人」是常态。反方向：无开窗时种子退化成 `(visibleSeason, 0)`（`:22-27`），整段无开窗期（赛季进行中）内容冻结，页面却写着「下窗换血」。

另外端点把 `resolveRumorWindow` 放在 `cachedJson` 之前（`src/worker/routes/market.ts:331`），缓存命中仍要打 1 次 D1（无开窗 2 次）。1h 缓存只覆盖事实池。

### 1.4 现有测试的边界

`tests/market-intel.test.ts` 有 26 个用例。rev4 实跑 `npx vitest run tests/market-intel.test.ts` → **26 passed，6.31s**；rev5 复核轮再跑一次 → **26 passed，6.26s**（`tests 2301ms`，20:53）；rev6 又跑一次 → **26 passed，7.14s**（`tests 2607ms`，21:18）。上一轮独立复核的记录是 26 passed / 6.55s，rev3 在 1.4 与 12.2 两处写 6.13s 属引用偏差。四次结果一致，差异只在机器负载。

TC-RUMOR-01..10 锁的是确定性、结构、守卫三件事，不锁叙事质量与文案创意（`docs/test-plans/v6.18.0-market-ia.md:21` 明确 out of scope）。这意味着改文案、改种子、改池子不会有测试变红，也意味着「更真实」不能靠测试全绿来证明，只能靠结构约束加人工语料评审。

TC-RUMOR-08（`:513-529`）用直插 SQLite 的方式测缓存命中，不触发 epoch purge，因此没有覆盖「写路径导致重算」这条真实路径。

前端测试基建是存在的：`vitest.config.ts:12-17` 的 include 含 `web/**/*.test.tsx`，`web/src/pages/market/MarketCard.test.tsx` 与 `MarketAdBoardPage.test.tsx` 都用 jsdom + `@testing-library/react`。rev1 沿用的「不写 web 渲染测试」只对 v6.18.0 那一轮成立（`docs/test-plans/v6.18.0-market-ia.md:20` 的原话是「本轮仓库无 web 测试基建」），rev2 已纠正。

---

## 2. 术语与边界

本节是 GLOSSARY 候选，不直接改 `GLOSSARY.md`。写法遵循 domain-modeling 的收窄方法：每个词给出边界，而不是给出实现。

### 2.1 传闻（rumor）

一条关于「某家俱乐部与某名球员之间正在发生或即将发生什么」的公开消息。俱乐部可以是球员的现东家（`clubRole = current`，卖方视角），也可以不是（`clubRole = buyer`，买方视角）。

边界：
- **主体是 `(clubId, playerId, clubRole)`，不是「球员 + 现东家」的固定组合。** 买方主体允许球队谈论一名不属于自己的球员；卖方主体仍是现东家。`clubRole` 是族的属性，不是真假的标记（见 2.10）。
- 自由身球员（`club_id` 为空）纳入 P0 买方族：`currentClubId=0`、`currentClubName='自由身'`；真料只来自内部 `offers`（`COALESCE(seller_club_id,0) = COALESCE(p.club_id,0)`，自由身为 0；玩家不可公开核对）；卖方三族仍要求有现东家。
- 传闻与成交表的分工：成交表列已完成结果；传闻谈仍在进行/刚发生且主体仍在现东家的状态（可谈/在挂/留队），以及买方对非本队球员的进行中兴趣（出价/报价）。已完成的跨队结果仍由成交表承担，不作为传闻族。
- 卖方族（可谈/在挂/留队）的主体是现东家；买方族（出价）的主体是买方，文本同时给出球员现东家。买方行的「球队」不是球员现东家，这是 rev9 的核心变化。
- 买方侧的真实来源分两层：公开 `bids`（`GET /market/listings/:id` 可见，玩家可查）与内部 `offers`（`GET /offers` 需教练/绑定俱乐部，公开页查不到；标 `internal`，见 2.4）。卖方侧仍是 `transfer_listed` / `listings` / `match` + `rc_change`。

### 2.2 主张（claim）

传闻陈述的命题，分两层。

- **状态主张**：可被公开记录或内部单据核对。卖方例：已列入可谈名单、已挂牌、刚完成续约或匹配留队；买方例：已对某球员出价（公开 bid 记录）、已向现东家报价（内部 offer 记录）。
- **意图主张**：不可被公开记录核对。例：愿意听报价、球探到场、正在关注。

边界：意图主张必须归因（「据一位经纪人称」），平台自己的口吻只陈述「有人这么说」。归因措辞对真假一视同仁，不做可信度分级。买方状态主张的「有据」可以是公开的（bid）或内部的（offer）；内部有据不宣称公开可查，见 2.4 与 ADR-0009。

### 2.3 锚点（anchor）

能证明某条状态主张「有据」的记录。P0 有四个族；卖方三族、买方一族；公开窗口硬约束见 5.1 与 ADR-0008（内部 offers 例外，见下）。

1. 可谈（卖方/current）：`players.transfer_listed = 1`（公开出现在 `/api/players`（`src/worker/routes/players.ts:785`）与广告板 `/market/board`，后者上限 200 条、当前 18 人）。
2. 在挂（卖方/current）：`listings.status ∈ (listed, bidding, matched_pending)`，且落在 `/api/market/listings` 可见的最新 50 条窗口内（`src/worker/routes/market.ts:126`）。
3. 留队（卖方/current）：`transfers.status = completed` 且 `type ∈ (match, rc_change)`、`from_club_id = to_club_id = players.club_id`，且落在 `/api/market/deals` 可见的最新 50 条窗口内（`src/worker/routes/market.ts:363`）。
4. 出价（买方/buyer）：`bids.club_id ≠ players.club_id`，该 bid 属于 `/api/market/listings` 可见窗口内的 listing（玩家可在 listing 详情页看到；`src/worker/routes/market.ts:799`、`:819-893`），且 `bids.status = 'active'`；以及内部 `offers` 中 `buyer_club_id ≠ COALESCE(players.club_id,0)`、`COALESCE(seller_club_id,0) = COALESCE(players.club_id,0)`、`status IN ('pending','intent')` 的记录（P0；公开页查不到，标 internal；自由身 `players.club_id=0` 时 `seller_club_id=0`）。

**不列为锚点**：已完成的跨队转会（`transfer`/`activation`/`forced_auction`/`free_agent`）。这类记录继续由成交表承担；买方族谈的是「进行中的出价/报价」，不是「已经完成的转会」。这与 ADR-0003 的旧结论不同：旧结论把「买方」整个排除，rev9 只排除「已完成结果」。

**公开窗口与内部锚点**：可谈/在挂/留队/出价（bids）都必须落在公开页可见窗口（ADR-0008）；`offers` 没有公开查证面，是 `internal` 锚点，不走 ADR-0008 的公开窗口，也不能被当成「玩家可查」的宣传。

### 2.4 有据 / 无据（grounded / ungrounded）

这是本设计对「真 / 假」的正式替换，也是最重要的一条定义。

- **有据**：该 `(clubId, playerId)` 在所选主张族的锚点集合里存在一条记录。锚点可以是 `public`（玩家可在公开页核对）或 `internal`（内部单据，玩家查不到；仅 offers）。
- **无据**：不存在。

关键边界：**有据不等于这条消息属实，无据也不等于这条消息是假的。** 记录只说明「有这笔出价/报价/挂牌」，不说明「会成交」；不在记录里也不说明「俱乐部没在谈」。玩家查证得到的是「有公开记录 / 没有公开记录」，判断仍由玩家做。内部有据的行在公开面查不到，这是买方报价族的已知代价（ADR-0009）；不能把它宣传成「可查证」。

`src/worker/rumors.ts:5-7` 的原设计口径就是「真传闻查有实据、假传闻查无此事」，本设计只是把它从注释里的说法变成可实现的模型，并把「真 / 假」这对会误导的措辞换掉。

### 2.5 主张族（claim family）

四族：`可谈`、`在挂`、`留队`（卖方/current），`出价`（买方/buyer；含公开 bid 与内部 offer 两个变体）。族是生成侧概念，**不上屏、不下发**；`clubRole` 会随载荷下发，因为 UI 需要区分「买方」与「现东家」，但它是族的属性，不是真假位。

边界：只有真料池非空的族才参与抽样。四族全空时走冷窗回退（见 5.0/2.9）。`FULL` 的长度从 3 变 4 是 rev9 的破坏性变更：它会让所有槽的族重排；必须在阶段一开工前定稿，事后再加族等于换一套卡片。

### 2.6 位（truth bit）

每槽独立的 50% 种子抽签结果。它只决定「用有锚点的主体还是无锚点的主体」，不参与族选择、事实选择、条数、顺序、版面。

边界：任何新增的公开可观测维度都不得读取位。盐位分配写在 `src/worker/rumors.ts` 头注释里，见 7.3。

### 2.7 窗口（window）与期（edition）

- **窗口**：`(season, window_seq)` 构成的种子身份。它不是日历。无开窗时回退 `(visibleSeason, 0)`（`src/worker/rumors.ts:22-27`），整段无开窗期（赛季进行中）共用同一身份。
- **期（edition）**：一个窗口对应的一份载荷。本设计 P0/P1 不落库，P2 才考虑快照。

边界：不做「本窗第 N 天」、不做关窗倒计时、不做逐条发稿时间。生产 `season_windows` 只有 1 行且该行只存在 1 分钟，没有日历可言。

### 2.8 查证面（verification surface）

公开可访问、能核对锚点的页面。

- `/players/:id` 球员档案（公开，`web/src/App.tsx:108`）
- `/players?club_id=N` 该队名单（公开，`web/src/App.tsx:105`；参数解析见 `web/src/lib/players-library.ts:225`）
- `/market` 卡柜与在售（公开，`web/src/App.tsx:118`）
- `/market/board` 可谈名单（公开，`web/src/App.tsx:119`）
- `/market/listings/:id` listing 详情（公开；bids 列表见 `src/worker/routes/market.ts:799`、`:819-893`）

**不在查证面内**：`/clubs/:id`。该路由包在 `RequireUser` 里（`web/src/App.tsx:110-117`），端点也先 `requireUser`（`src/worker/routes/clubs.ts:313`）。传言页是公开页，把公开读者推进登录墙不算查证。

**族 → 查证面的对应关系（rev4 补，rev3 把落点写成 ADR-0005 是错的，ADR-0005 讲时间与信源）**：

| 族 | 查证面 | 为什么不是别处 |
| --- | --- | --- |
| 可谈 | `/market/board`（可谈名单，公开，上限 200） | `transfer_listed` 只出现在广告板与 `/api/players`，不是卡柜 |
| 在挂 | `/market` 卡柜（`/api/market/listings`，三态、`ORDER BY l.id DESC LIMIT 50`） | 挂牌走 `listings`，与 `transfer_listed` 是两套字段：挂牌时只 `UPDATE players SET status='listed'`，不改 `transfer_listed`（`src/worker/routes/market.ts:299-305`） |
| 留队 | `/market/deals`（`GET /api/market/deals`，**不按 type 过滤**、最新 50 条，`src/worker/routes/market.ts:347-363`） | `match`/`rc_change` 只在成交表里；卡柜看不到 |

rev9 增补：买方族 `出价` 的公开查证面是 `/market` 卡柜 → listing 详情页的 bids（公开，`src/worker/routes/market.ts:799`、`:819-893`）；内部 `offers` 没有公开查证面，标 internal，不能宣称「玩家可查」。

### 2.9 冷窗

**术语**：开窗期（转会窗开启）就是休赛期——没有联赛、市场活跃；无开窗期是赛季进行中——联赛进行、市场冷清。「冷窗」指四族锚点全空的市场状态；无开窗期不等于冷窗（当前生产无开窗但 seller N=46）。术语表见 `GLOSSARY.md`。

可谈、在挂、留队、出价四族锚点全空。此时走 5.0 定义的冷窗回退：全部无据、8 条照发；族不再固定为可谈，而是按槽位的奇偶确定性地分到「可谈」与「出价」两族（`slot % 2 === 0 ? 可谈 : 出价`），让冷窗也同时有卖方与买方行。这个分配只读槽位、不读位，所以族仍不携带位信息。注意区分两种空：**单族**为空只做槽级回退、保位（5.0），只有**四族全空**才强制无据。

**无开窗期（赛季进行中）按日换血（owner m01521，P0）**：无开窗时种子加日期桶 `dayKey`（`YYYY-MM-DD`，与窗口解析同一时区）；同一天内逐字稳定、跨日换血；开窗期（休赛期）仍用 `[season, windowSeq]`，不受影响。响应缓存键在冷窗变成 `market-rumors:v3:{season}:0:{dayKey}`，开窗仍是 `market-rumors:v3:{season}:{windowSeq}`（实现须再带 `:{secretVersion}`，见 5.4）；帧缓存键统一为 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`（开窗 `dayKey=''`，冷窗上海日期 `shanghaiDateStr()`；**全链路不混用 UTC 日期**）；帧 TTL：开窗期 1h，冷窗（无开窗期）24h，跨日自然 miss；响应缓存仍 1h。

### 2.10 侧信道（tell）

任何让人不查证就能分类的公开特征。主体归属（是现东家还是买方）、语气方向、变体选择、具体度、版面位置、徽标都算——但 rev9 后 `clubRole` 是族的一部分，真假在同族内共用模板与角色，所以「买方 ⇒ 假」不再成立。所有侧信道都纳入「与位独立」的测试面，但**按可测性分流**：能在单条上切分、且真的逐条变化的只有**主张族**，进 TC-RUMOR-12 的统计检验；变体维度由 TC-RUMOR-04 的「同族两侧变体集合相等」覆盖；归因措辞与是否含数字在本设计中是常量（6.3），不构成侧信道，也不进检验（8.1）；卡片级指标（涉及俱乐部数、位置分布）不能按条切分，只能进人工语料回归（8.7）。

---

## 3. 设计原则

### 3.1 不泄漏真假

位只影响「用哪条主体」，不影响任何上屏维度。这条纪律要变成可执行的东西，不能只写在注释里：

- 四族模板对真假完全共用。假料不设专用模板，靠守卫与「同族同角色」匹配保证该条状态主张无锚点；买方假料不是「随便找个队」，而是按公开阵容数据匹配出来的买方主体。
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

每条传闻至少一个可点主体，点开后能看到锚点所在页（买方行有两个：买方队与现东家）。

- 球员名 → `/players/{playerId}`
- 队名 → `/players?club_id={clubId}`（P0；买方行同时给买方队与现东家）
- 内部 offers 行没有公开锚点页；这是 ADR-0009 接受的代价，UI 不额外标注
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

- `seededUnit`：现在住在 `src/worker/venue-ops.ts`（`seededUnit` 定义，HEAD `:105` / 工作区 `:270`），而该文件 import 了 `Env`、`HttpError`、`ledgerMovement`、`createConfigService`、`isWindowOpen`、`assertOpOpen` 等 IO 依赖（`src/worker/venue-ops.ts:8-13`）。`src/core/` 不能反向依赖 `src/worker/`，所以抽到 `src/core/deterministic-random.ts`，`venue-ops.ts` 改为 re-export，调用方不变。
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

**决定（历史，已推翻）**：B。

**状态：Superseded by ADR-0009（owner m00744，2026-10-21）**。本条保留原文，作为「旧设计为什么错」的记录；rev9 起主体允许买方，不再恒为现东家。

**后果**：传闻语义收敛为「这名球员与这家俱乐部之间正在发生什么」，不存在角色歧义。代价是失去「已成交」这条叙事线，但成交由同页的成交表承担（`web/src/pages/market/MarketIntelPage.tsx:78-128`），并不缺。A 会让载荷多一个字段、UI 多一层角色标注，收益只是保住一条本可以由成交表讲的故事。C 会产生事实错误。

**rev9 更正**：ADR-0003 的「主体恒为现东家」被 owner 直接推翻。它把买方侧整个让给假料，导致「队名 == 现东家 ⇒ 真」成为构造性答案；这不是可接受的代价，是设计错误。买方侧的取舍见 ADR-0009。

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

**rev2 补丁（变体的对称性）**：有据行的变体由锚点子状态决定（挂牌中 / 已谈拢 / 已续约 / 已匹配），否则文本会与公开卡柜状态自相矛盾。无据行的变体由HMAC-SHA256 大整数 `mod n` 在该族的**全部变体**上均匀抽取。两侧共享同一变体集合，因此「已谈拢」不是有据标记，只是无据行也会说的话。副作用是「已谈拢」的条数会多于真实谈拢的人数——这正是「查无此事」的体验，玩家去卡柜核对时会发现有几条对不上。这个副作用是特性，不是缺陷，写在这里以免以后被当成 bug 修掉。

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

### ADR-0009 买方侧主体与假料匹配

**状态**：Accepted（owner decision m00744，2026-10-21）。本 ADR 的「接受」来自 owner，不是架构师自批；以后凡改变产品语义（主体边界、公开 API、玩家可见规则）的 ADR，架构师只能写 `Proposed` + 推荐，`Accepted` 只能由 owner 确认。

**背景**：ADR-0003 把传闻主体锁死为「球员 + 现东家」，买方侧只能由假料承担。owner 指出这是错的：球队应当能与不属于自己的球员产生传闻；真实传闻来自报价、挂牌、出价等；虚假传闻应当按算法匹配，而不是随机配对。

**选项**
- A 保持 ADR-0003（只做卖方；买方全假）。
- B 买方侧只用公开 `bids`（listing 详情可见）；`offers` 不纳入。
- C 买方侧 = 公开 `bids` + 内部 `offers`（offers 标 internal，公开页查不到）；成交仍由成交表承担（推荐）。
- D C + 已完成跨队转会也作为回顾式买方族。

**决定**：C。主体改为 `(clubId, playerId, clubRole)`；`clubRole ∈ current/buyer`；真料四族 = 可谈/在挂/留队/出价；出价族含公开 bid 与内部 offer 两个变体；假料按同族角色匹配（买方：位置需求/CA 带/年龄；卖方：现东家），不再是随机 player × club。D 暂不做，成交继续由成交表承担；自由身纳入 P0 买方族，真料只来自内部 `offers`（见 §2.1/§5.1A）。

**后果**
- `RumorItem` 需要 `clubId/clubName/clubRole/currentClubId/currentClubName`；这是 P0 的破坏性契约变更，缓存键升 v3，前端同批发布。
- 买方假料不再是随机俱乐部：需要 `clubs`（active/non-CPU）与球员公开属性（position/ca/pa/age），按确定性匹配分选；多一次 active clubs 查询，D1 预算增加。
- 内部 offers 没有公开查证面；「有据」分 public/internal 两层，UI 不标注；玩家对报价族只能看归因，不能公开核对。这是 C 的代价。
- ADR-0008 的公开窗口只约束 public 锚点；internal offers 不走公开窗口，也不能被宣传成「可查」。
- ADR-0003 标 Superseded；§2.1/2.3/2.4/2.5/2.9/5.0/5.1/5.1A/5.4/6.3/7.3/7.4/8/9/10/11 同步改。
- 若 owner 后续要把 offers 变成公开可查，需要新增公开投影端点/字段，另开 ADR；不在本 ADR 内偷偷做。

---

## 5. 推荐方案

方案名：**主张-锚点传闻改造包**。

一句话：每条传闻只谈「这名球员与这家俱乐部之间正在发生什么」，有据与无据共用同一套主张族与变体集合，位只决定锚点有无。

### 5.0 生成顺序（rev2 定稿，替换 rev1 的模糊描述）

```
seed = [season, windowSeq]                                  // rumors.ts:187
FULL = [可谈, 在挂, 留队, 出价]                               // 卖方三族 + 买方一族，长度恒为 4
family(slot) = FULL[floor(seededUnit([...seed, slot], 4) * FULL.length)]
const secretIdx = hmacIndex(env.RUMOR_SECRET, 'rumor-variant', season, windowSeq, slot, dayKey) // HMAC-SHA256 大整数，再 mod n
grounded(slot) = secretBit(env.RUMOR_SECRET, season, windowSeq, slot, dayKey)  // HMAC-SHA256 1 bit；冷窗 dayKey 进消息，见下
if anchor(family(slot)) 为空:                                 // 该族池空 → 槽级回退（保位）
  family(slot) = firstNonEmpty(FULL)                          // FULL 顺序下第一个非空族
if firstNonEmpty(FULL) 为空:                                   // 四族全空 = 冷窗
  family(slot) = slot % 2 === 0 ? 可谈 : 出价                  // 槽位决定，不读位
  grounded(slot) = false                                     // 只有这一刻才强制无据
pool = grounded ? anchor(family) : complement(family)         // complement 见 5.1/5.1A 守卫矩阵
// 出价无据的 complement 在构造阶段就已是 (player,buyerClub) pair：
// 先对全部候选做 matchBuyerFake、剔除无合法买方者，再进入 pickFact。
fact = pickFact(pool, seed, slot, grounded ? 5 : 6)           // 4 参，rendezvous；出价族直接选 pair
sub  = grounded ? subOfAnchor(fact) : (fact.player.currentClubId === 0 ? '已报价' : SUB[family][secretIdx % n])
text = TEMPLATE[family][sub](fact)
```

**H-4 侧信道（review 7；review 11 加强）**：truth bit 不能只用公开的 `[season, windowSeq, slot]`。`id=r{season}-{windowSeq}-{slot}` 仍公开 slot，若 bit 的 seed 不含服务端 secret，任何拿到 id 的人都能用同一 `seededUnit` 反推真假。P0 用 `env.RUMOR_SECRET` 的 HMAC-SHA256：`grounded(slot)=secretBit(secret, season, windowSeq, slot, dayKey)`（取 HMAC 首字节最低位；`windowSeq===0` 时 dayKey 进消息，避免整季同向量），变体直接用 HMAC-SHA256 大整数 `mod n`（`hmacIndex`），不落回 32 位 salt/seed。**不要用 32 位 FNV 作为安全边界**（2^32 可离线穷举）；secret 至少 32 字节，防的是随手反推，不是有标签的离线穷举。**fail-closed**：`Env.RUMOR_SECRET` 未配/空串时 `/market/rumors` 直接 503，不降级成公开 seed；`src/worker/env.ts` 加 `RUMOR_SECRET?: string` 与 `RUMOR_SECRET_VERSION?: string`（运行时 `requireRumorSecret(env)` 判空 503；不要写成必填，否则测试的 `Env` 字面量会 typecheck 失败），阶段一清单补测试 env 工厂；部署清单加 `wrangler secret put RUMOR_SECRET`，secret 不进 `wrangler.jsonc`。测试换 secret 后断言 **8 个 slot 的 bit 向量至少一位变化**（不保证单槽翻转）。响应缓存键带 `secretVersion`（`RUMOR_SECRET_VERSION`，默认 `v1`；轮换时 bump），帧键不含 bit 可不带；轮换时 bump 版本即可让旧响应失效，L2 per-colo 不依赖 purge。`id` 本身仍按 7.4 的公开格式，不改成 hash；安全性来自 HMAC secret，不来自 id 的不可读。

五条必须一起读的性质：

- `family` 只由 `(seed, slot)` 与固定全集决定，既不读位，也不读池长。rev2 用「非空族列表 `F` 的下标」抽族，`F` 的长度一变就重排所有槽的族；改成固定全集后，`floor(u × 4)` 在任何池状态下都落在同一组槽。rev9 把长度从 3 改成 4 是破坏性变更，会让全部槽重排，必须在阶段一开工前定稿。
- 空族回退是**槽级**的，且**不改位**；实现顺序固定为「先 `firstNonEmpty` 定渲染族，再按渲染族排除锚点」：落在空族的槽改走 `firstNonEmpty(FULL)`（按 FULL 顺序取第一个非空族），位为真就出该族有据行、为假就出该族无据行。回退目标只由**池状态**决定、不由槽决定，所以它不携带位信息。
- **只有四族全空（冷窗）才强制无据**，且这是全局唯一的例外：此时按 `slot % 2` 分到可谈/出价，族是槽位的函数、不是位的函数，不携带位信息。**冷窗 8 条全无据是明示边界**：冷窗没有任何锚点，本来就不可能有有据行；但 UI 不能暗示冷窗也有真料——提示语写「窗口关闭/无活跃市场，以下仅为传闻」，并显式标「冷窗」；P0 定为 **8 条全无据 + 卡头明示「冷窗/仅为传闻」**；空态方案移出 P0（要做另立 P2），不再作为二选一。
- `grounded` 只读位，且是唯一的读取点；`clubRole` 是族的属性，不读位。
- `sub` 在有据侧由锚点决定、在无据侧由 HMAC-SHA256 大整数 `mod n` 均匀抽取，两侧共享同一变体集合。买方假料的 `matchBuyerFake` 只改「选哪个买方俱乐部」，不改族、不改位、不改条数。

同窗去重：按 `playerId`，撞了用盐位 7 重抽一次，仍撞则丢槽；买方 pair 也按 `playerId` 全局唯一。

### 5.1 P0-1 主张-锚点重构

**现状问题**
- 假料主语 96.9% 是自由身（假料池只过滤 `status != 'retired'`，`src/worker/rumors.ts:154-175`）。
- 真料 `{club}` 恒为现东家，假料被 `:235` 禁止点名现东家，主体归属即答案。
- 真/假模板互不相交（`:49-73`），句式即答案。
- 成交类型白名单不含 `match`/`rc_change`（`:147`），线上 28 条成交一条都用不上，真料池结构性为空（`:202`）。
- `matched_pending` 被当成「仍在听报价」，与挂牌板公开状态矛盾（`:132`、`:50-51`）。

**设计做法**

1. 卖方三族的主体统一为「球员 + 现东家」（`clubRole='current'`）；买方族见 5.1A，主体是「买方 + 球员」，`clubRole='buyer'`。卖方三族主张问的是「这名球员与现东家之间在发生什么」；买方族问的是「这家买方俱乐部与这名非本队球员之间在发生什么」。
2. 抽签顺序按 5.0：先定族、再抽位、再选事实、最后定变体。
3. 每族的变体集合与模板（**可谈族只有一条变体，没有「未列入名单」这种按位选模板的写法**——rev1 那句已删）：

| 族 | 变体 | 模板（真假共用） | 有据侧的子状态 |
| --- | --- | --- | --- |
| 可谈 | 唯一 | 「{club} 愿意听对 {player} 的报价，据一位经纪人称。」 | `transfer_listed = 1`（无子状态可分） |
| 在挂 | 挂牌中 | 「{club} 已经把 {player} 挂上了，据一位经纪人称。」 | `listed` / `bidding` |
| 在挂 | 已谈拢 | 「{club} 与 {player} 已经谈拢，只等审核，据一位经纪人称。」 | `matched_pending` |
| 留队 | 已续约 | 「{club} 与 {player} 把续约敲定了，据一位经纪人称。」 | `rc_change` |
| 留队 | 已匹配 | 「{club} 匹配了外部报价，把 {player} 留下，据一位经纪人称。」 | `match` |

- 无据行的变体：在挂族从 {挂牌中, 已谈拢} 均匀抽，留队族从 {已续约, 已匹配} 均匀抽（HMAC-SHA256 大整数 `mod n`）。因此「已谈拢」出现在无据行是正常输出，不是脏数据。
- 可谈族只有一条变体，所以「愿听报价」出现在两侧是必然的——这正是它不能携带答案的原因。

4. 假料主体按**族**取锚点补集，不是全局「无任何锚点」。在挂族的无据主体可以是一个已在可谈名单上、但没有挂牌的球员。这样「在可谈名单上 ⇒ 这条为真」不再成立。
5. 删除没有锚点支撑的两条真料情节（`src/worker/rumors.ts:52` 更衣室、`:54` 物色替代者）；`matched_pending` 用完成时（「已谈拢，只等审核」），不再说「仍在听报价」。

**冷窗回退（rev2 新增，rev1 缺失）**

四族全空时 5.0 的每个槽都会按 `slot % 2` 分到可谈或出价，且 `grounded` 被强制为 false（冷窗）。定义冷窗回退：

- 族按 `slot % 2` 落在**可谈 / 出价**（各半），`grounded` 一律为 false。可谈补集 = 有俱乐部、`transfer_listed = 0` 的球员；出价补集 = `matchBuyerFake` 产出的买方 pair；两者都非空。
- 变体：可谈只有一条，出价有三条（已出价/正在竞价/已报价），所以 8 条不完全同构，但主语各不相同。
- 8 条照发，id 仍是 `r{season}-{seq}-0..7`（TC-RUMOR-01/10 的断言不用改）。
- 卡头可写「本窗市场冷清，暂无挂牌与出价。」这描述公开池为空，不泄漏逐条位。
- 回退不看位，也不看族长：从「四族全空」恢复到「可谈非空」时，只有原本落在可谈的槽改变形态，落在在挂/留队的槽仍走回退——因为它们的族池还是空；出价槽同理。

**守卫矩阵**

| 假料主张族 | 必须排除的公开关系 | 依据 |
| --- | --- | --- |
| 卖方三族 | 自由身（`club_id` 为空） | 主体不成立（买方见 5.1A） |
| 全部 | `clubs.is_cpu = 1`（CPU 队不该发消息）；`clubs.status = 'active'` 之外的行 | `0026_clubs_is_cpu.sql:3`；`clubs.status` 无 CHECK（`0001_init.sql:37`），夹具与种子用 `active`（`tests/market-intel.test.ts:80`） |
| 可谈 | `players.transfer_listed = 1` | 锚点为假 |
| 在挂 | 该球员存在 `listings` 三态之一 | 锚点为假 |
| 留队 | 该球员存在 `match`/`rc_change` 且 `to_club_id = club_id` | 锚点为假 |
| 出价 | `(clubId, playerId)` 已有真实 bid/offer，或该球员与该买方有已完成的**跨队**成交（`transfer`/`activation`/`forced_auction`/`free_agent`） | 锚点为假；避免「刚买过又买」的矛盾；不再全局排除有跨队成交的球员（rev9 修正：旧守卫会误杀合法买方行） |

最后一行的查询在 rev1 里没有对应的集合（rev1 只查了三个集合），所以预算数对不上。rev2 明确补第 4 条集合查询，见下面的查询清单。

**数据 / API**

`loadFactPool`（`src/worker/rumors.ts:122-180`）重写为 4 个池查询 + 4 个集合查询 + 买方 bids 查询 + offers 查询 + 买方俱乐部画像查询 = **11 条 P0 查询**；offers 是第 10 条（内部、不可公开查），俱乐部画像是第 11 条（随帧缓存，见 5.1A）。

**两条硬约束，先写在查询之前：**

1. **列名必须 AS 成 camelCase 键**。`src/worker/rumors.ts:126-127` 的注释就是 v6.18.0 踩过的坑：「列名一律 AS 成接口里的 camelCase 键——D1 按 SQL 列名给键，不别名时 `SaleFact.playerId` 读出来是 undefined（真料文本会直接渲染 "undefined"）」。四条池查询统一写 `p.id AS playerId`、`${sqlDisplayName('p')} AS playerName`；显示名口径只能走 `src/core/player-name.ts:16`（`COALESCE(display_name, name)`），不要手写 COALESCE，否则会把显示名退回 FC26 缩写名（`E. Haaland`）。
2. **锚点窗口必须与公开端点同源**。ADR-0008 承诺「玩家能查到的就是系统能引用的」，所以池查询要先取公开端点的那个 50 条窗口（子查询），再 JOIN 球员与俱乐部做主体过滤。先按主体过滤再 `LIMIT 50` 会取到公开页之外的行：`/market/listings` 默认只取三态后 `ORDER BY l.id DESC LIMIT 50`（`src/worker/routes/market.ts:82-87`、`:123-126`），`/market/deals` 不按 type 过滤、直接取全部 completed 的最新 50 条（`:356-363`）。

1. 可谈池（**窗口 = 广告板前 200，与 `/market/transfer-board` 同一排序**）：
   `WITH pm AS (SELECT player_id, tier FROM (SELECT player_id, tier, ends_at, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY tier DESC, ends_at DESC, id DESC) AS rn FROM player_promotions WHERE ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE rn = 1), win AS (SELECT p.id FROM players p LEFT JOIN pm ON pm.player_id = p.id WHERE p.transfer_listed = 1 ORDER BY CASE WHEN pm.tier IN (1, 2) THEN pm.tier ELSE 0 END DESC, p.transfer_listed_at IS NULL, p.transfer_listed_at DESC, p.id DESC LIMIT 200) SELECT p.id AS playerId, ${sqlDisplayName('p')} AS playerName, p.club_id AS clubId, c.name AS clubName, p.position AS position, p.ca AS ca FROM win w JOIN players p ON p.id = w.id JOIN clubs c ON c.id = p.club_id WHERE p.club_id > 0 AND c.is_cpu = 0 AND c.status = 'active' ORDER BY p.id`。
   **窗口先取、过滤后做**：`win` 子查询的 `WHERE` 只有 `transfer_listed = 1`、排序与上限逐字对齐 `src/worker/routes/market.ts:453-474`（`pm` 子查询取未过期 promotion 的 `tier`、`ORDER BY` 三段、`LIMIT ?` 默认/最大 200）；`p.club_id > 0`、`c.is_cpu = 0`、`c.status = 'active'` 三个过滤放在**窗口之后**。顺序不能反：先过滤再 `LIMIT 200` 会把窗口平移到广告板排 200 名之后的人（卡片引用了玩家在广告板前 200 里查不到的球员，ADR-0008 破功）；后过滤只会**缩小**锚点集合，锚点仍 ⊂ 广告板可见窗口，可查证性不受影响，也和 8.4 守卫矩阵「全部」行的 `is_cpu`/`status` 守卫一致。广告板在缓存之外还会按 5 分钟桶洗牌（`src/core/ad-board.ts:28` 的 `shuffleWithSeed`），洗的是**可见顺序**，不改变「是否落在前 200」，所以锚点取洗牌前的窗口序即可。rev4 只写「将来超过 200 就截断」，没有 SQL 也没有用例，已按 ADR-0008 补成窗口查询，并加 TC-RUMOR-20c。
2. 在挂池（原 `:128-134` 重写，**主体必须等于现东家**，**窗口取自公开卡柜**）：
   `WITH win AS (SELECT l.id, l.player_id, l.seller_club_id, l.status FROM listings l WHERE l.status IN ('listed','bidding','matched_pending') ORDER BY l.id DESC LIMIT 50) SELECT w.id, p.id AS playerId, ${sqlDisplayName('p')} AS playerName, p.club_id AS clubId, c.name AS clubName, w.status AS listingStatus, p.position AS position, p.ca AS ca FROM win w JOIN players p ON p.id = w.player_id AND p.club_id = w.seller_club_id JOIN clubs c ON c.id = p.club_id WHERE c.is_cpu = 0 AND c.status = 'active' AND p.status != 'retired'`。
   `p.club_id = w.seller_club_id` 这个条件不能省：只 JOIN `clubs` 时队名取的是挂牌俱乐部，球员换队后主体就不是现东家。它放在窗口之后，所以只会缩小结果，不会把窗口平移。
3. 留队池（原 `:140-149` 重写，**窗口取自公开成交表**）：`WITH win AS (SELECT t.id, t.player_id, t.type, t.from_club_id, t.to_club_id FROM transfers t WHERE t.status = 'completed' ORDER BY t.completed_at DESC, t.id DESC LIMIT 50) SELECT w.id, p.id AS playerId, ${sqlDisplayName('p')} AS playerName, p.club_id AS clubId, c.name AS clubName, w.type, p.position AS position, p.ca AS ca FROM win w JOIN players p ON p.id = w.player_id AND p.club_id = w.to_club_id JOIN clubs c ON c.id = p.club_id WHERE w.type IN ('match','rc_change') AND w.from_club_id = w.to_club_id AND c.is_cpu = 0 AND c.status = 'active' AND p.status != 'retired'`。
   注意 `type IN (...)` 放在窗口之后：公开成交表不按 type 过滤，若把它放进窗口子查询，会取到「公开页第 51-60 条」这类玩家翻不到的行。
4. 假料候选帧：按 §5.1B 的 20 层（`position` × CA 带）分层抽样，`M=256`，每层 `m_s` 行；层内哈希**统一按 §5.1B 的 `((p.id * 1103515245 + seed) & 2147483647)`**，`seed = seededUnit(windowSeq===0 ? [season,0,dayKey] : [season,windowSeq], 12)` 的整数化，不再写独立的 `hash(playerId, season, windowSeq)`；不按 CA 硬切。帧缓存在 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`，不随市场写 purge；候选表见 §5.1C。
5. 可谈集合：**复用查询 1 的 `win` 窗口**（同一 `ORDER BY` + `LIMIT 200`），不再写无窗口的全表 SELECT：
   `WITH pm AS (SELECT player_id, tier FROM (SELECT player_id, tier, ends_at, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY tier DESC, ends_at DESC, id DESC) AS rn FROM player_promotions WHERE ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE rn = 1), win AS (SELECT p.id FROM players p LEFT JOIN pm ON pm.player_id = p.id WHERE p.transfer_listed = 1 ORDER BY CASE WHEN pm.tier IN (1, 2) THEN pm.tier ELSE 0 END DESC, p.transfer_listed_at IS NULL, p.transfer_listed_at DESC, p.id DESC LIMIT 200) SELECT w.id FROM win w JOIN players p ON p.id = w.id WHERE p.club_id > 0`（`transfer_listed = 1` 命中 `idx_players_transfer_listed`，`0064_ad_board.sql:16`；`club_id > 0` 放在窗口之后，只会缩小集合）。
   rev5 这里写的是 `SELECT id FROM players WHERE transfer_listed = 1 AND club_id > 0`——无 `ORDER BY`、无 `LIMIT`，与紧邻的「集合 5 必须与查询 1 同一窗口」和 8.6 的「集合 5 ≤ 200（窗口）」直接矛盾。上一轮只改了正文描述、没改 SQL，rev6 补。
6. 在挂集合：`SELECT DISTINCT player_id FROM (SELECT player_id FROM listings WHERE status IN ('listed','bidding','matched_pending') ORDER BY id DESC LIMIT 50)`——**与锚点同窗口**。若用全表 DISTINCT，会出现「该球员有挂牌但不在窗口内」：既不能当有据（不在窗口），又被排除在无据之外，槽只能空掉。
7. 留队集合：`SELECT DISTINCT player_id FROM (SELECT player_id FROM transfers WHERE status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 50)` 再加 `match`/`rc_change` 与 `from = to` 的过滤，同窗口。
8. 跨队集合：`SELECT DISTINCT player_id FROM transfers WHERE status = 'completed' AND type IN ('transfer','activation','forced_auction','free_agent')`（**无窗口**：守卫要排除的是「该球员有过任何跨队成交」，见下条的理由——**不是**「公开页永远查得到」）。

- 集合 5-8 的行数都远小于表规模（当前 18 名可谈、CA≥80 16；0 条在挂；28 条留队记录；0 条跨队成交），可以一次带出后在内存里做补集减法。集合 5 **必须与查询 1 同一窗口**（同一 `ORDER BY` + `LIMIT 200`），否则锚点在可见窗口内、补集却在窗口外，两侧不同源；集合 6/7 与查询 2/3 同窗口（≤50）；集合 8 **没有 LIMIT，但改为 EXISTS 半连接**：只判断球员是否有过跨队成交，不把 `transfers` 全表带出，读量按索引点查计——**它不与公开窗口对齐，理由不是「公开页永远查得到」**：`/api/market/deals` 没有 cursor、只取最新 50 条（`src/worker/routes/market.ts:356-363`；对比 listings 有 cursor，`:103-108`、`:206`），更早的跨队成交在公开页上翻不到。真正的理由是**排除方向保守**：多排除只会少出无据行，而无据行不引用任何公开锚点、不产生对外主张，所以不需要满足 ADR-0008 的可查证性；反过来若按 50 条窗口收紧，反而会让「有跨队成交但不在最新 50 条」的球员落进无据池，制造一条本可避免的侧信道。若将来给 deals 加翻页，再讨论是否收紧。rev3 写「全量规模下上限各 200」没有任何 SQL 支撑，已删（见 8.6，rev5 把可谈族的 200 落成查询 1 的 `LIMIT 200`）。rev2 另有一处把 28 条 `rc_change` 写成「28 条成交」，也已改：线上市场类成交为 0。
- **P0 阶段 `RumorItem` 直接是九键**（`id/text/playerId/playerName/clubId/clubName/clubRole/currentClubId/currentClubName`）；原计划的「P0 五键、P1-1 六键」在 rev9 合并为一次破坏性契约变更，见 5.4。缓存键必须同批升 v3（5.5）。
- 路由注释 `src/worker/routes/market.ts:326` 的「6~8 条」改成「0-8 条」。

**前端 / 文案**：只换服务端模板与词表，渲染结构不动（结构改动在 P0-3）。

**真假安全**
- 位仍取 `seededUnit([...seed, slot], 0) < 0.5`（`:200`），语义从「选池子」变成「选有无锚点」，位置不变。
- 族选择用盐位 4，事实索引用盐位 5（rev2 强制：原来事实索引也用 4，P0-1 就必须挪开，不能留到 P0-2），变体用 HMAC 域标签 `'rumor-variant'`（不再用盐 10），假料主体用盐位 6，去重用盐位 7，买方假料匹配用盐位 11，假料帧/候选构建哈希用盐位 12。盐位 1/2/3 是 rev1 的模板洗牌，已退役（每族变体固定，句序不再洗），见 7.3。
- 四族模板对位共用；假料不设专用模板；变体集合两侧相同（有据侧由锚点决定，无据侧均匀）。买方假料的俱乐部由 `matchBuyerFake` 选，但族、位、条数不变。
- 族抽签在固定全集上进行，族池空的槽落槽级回退——回退到 `firstNonEmpty(FULL)` 并**保留位**，所以「某个族出现在卡片上」只说明该族锚点非空，不携带本窗真假比例；也不会因为某个族从空变非空而重排其它槽。
- 冷窗（四族全空）回退不看位，全部无据；这是唯一例外，此时族按 `slot % 2` 落在可谈/出价，是槽位的函数、不携带位信息。

**测试 / 验收**
- TC-RUMOR-04（`:412-444`）改写为「族内真假对称」，并新增断言：同一族内有据行与无据行使用的变体集合相同；无据变体不能由公开 `[season,windowSeq,slot]` 复算（输入必须含 `RUMOR_SECRET` 的 HMAC）（这直接控住 rev1 的「未列入名单」类错误）。
- TC-RUMOR-05（`:446-469`）改写为新守卫矩阵，删除「假料不是甲队」断言（那是要拆掉的侧信道）；**跨队成交只按「该球员与该买方」的 pair 排除，不再加「假料不出现在跨队成交球员上」的全局断言**。**段一不再用 `fakeIdPool` 识别假料**：`tests/market-intel.test.ts:452-459` 用 `fakeIdPool(4,1,3) ∪ fakeIdPool(4,0,1)` 认假料并 `toHaveLength(3)`，绑的是本次要删掉的 id 池机制；改成按族判定——同一族内、主体不在该族锚点集合里的行即无据行。**段二**：补一条 listing 后该球员不再以无据身份出现；若 complement 有替代则原 id 全在，否则允许掉槽并显式断言槽数；不要声称“转为有据”（grounded 由盐 0 固定）；`expect(after).toHaveLength(7)` 与「ids 不含 `r4-1-1`」仍旧删除。rev5 只写了「改写为新守卫矩阵」，没改这两处，P0-1 落地后这条用例必红。
- TC-RUMOR-06（`:471-497`）段一改为「四族锚点全空 ⇒ 8 条、族按 `slot % 2` 分可谈/出价、全部无据」，段二改为「仅可谈池非空 ⇒ 有据行全部指向可谈名单，族只能是可谈」。**段二的夹具必须换**：现在是 `seedRumors({ listings: false, dealFallback: true })`（`tests/market-intel.test.ts:291-299`），而 `dealFallback` 写的是 `type: 'transfer'`——新设计删了成交族，留队锚点只认 `match`/`rc_change`，跨队 `transfer` 又被守卫排除，所以这组夹具在新设计下是**冷窗**（四族全空），不是 8.2 写的「仅可谈非空」。改法：给段二注入 `transfer_listed = 1` 的种子（8.4 新增 helper `seedTransferListed`），并把 `dealFallback` 选项整体删掉，免得读者以为成交还能兜底。rev5 只在 8.2 写了段二语义、没写夹具改法。
- 新增 TC-RUMOR-11 假料主语合法性：所有行主体合法；卖方行 `club_id` 非空、所在俱乐部 active 且非 CPU；买方行 `club_id>0`（买方俱乐部 active 且非 CPU），自由身由 `currentClubId=0` 表达，**不是 `clubId=0`**；**不设 CA 硬门槛**（CA 分布由 TC-27 的统计平衡覆盖）。
- 新增 TC-RUMOR-27 统计分层（按 §8.2 口径）：帧覆盖 §5.1B 的所有非空层（空层在 target 记 0）；各层帧行数/目标比例与 `p_s` 一致（非空层 ≥1）；**球员级 CA/年龄置换 `p>0.05` + 层内 KS + 低 CA 覆盖**；卡方/SMD 只作配额算术自检，不作帧 vs 锚点 oracle；cap 层只断言 `actual_s=cap`；帧同窗逐字节相等、换窗变化；**市场写后帧仍 hit，新 `buildId`/换日才 miss**。
- TC-RUMOR-01/02/03/07/09/10 保持（前提是夹具下限满足，见 8.4）。

**风险**
- 假料候选帧 `M=256`（20 层，按真料锚点做 Dirichlet 平滑），8 槽去重后可能掉到 5-6 条（0-8 口径允许）；低 CA 球员保留非零概率，不设硬门槛，见 5.1B/8.6。
- 线上 18 名在列球员（CA≥80 16 名）只来自 4 家俱乐部，有据行会集中在这几家。P1-4 加俱乐部级上限。
- 模板重写是文案工作，质量不在自动化口径内，需人工评审一轮。
- 买方侧恢复后（ADR-0009），失去的不是叙事而是「单一主体」：买方行有两个队名，窄屏折行与读句成本需要实机确认；内部 offers 不可公开查证，是 C 方案的已知代价。
- 冷窗回退会让无开窗期的 8 条高度同构（同一条模板），阅读体验偏硬。要么接受，要么在 5.9（P0 无开窗期按日换血）里解决，rev2 不新增模板。

### 5.1A 买方侧主体与假料匹配（rev9 增补）

**范围**：本节只定义买方族（出价）；卖方三族仍按 5.1。四族共用 5.0 的固定全集、盐位 0 的位与同窗去重。

**主体与族**
- 买方族 `出价`：`clubRole='buyer'`，`clubId` = 出价/报价的俱乐部，`currentClubId` = 球员现东家（自由身为 0，`currentClubName='自由身'`）；`clubId != currentClubId`。
- 变体：
  - `已出价`：公开 `bids`（active）可用；文案「{club} 已经向 {currentClub} 出价，想要 {player}，据一位经纪人称。」
  - `正在竞价`：公开 `bids` active 且该 listing 的 `status='bidding'`（不要求 ≥2 条 active bids）；文案「{club} 正在和 {currentClub} 争 {player}，据一位经纪人称。」
  - `已报价`：内部 `offers`（pending/intent；P0）；文案「{club} 已经向 {currentClub} 报价，目标是 {player}，据一位经纪人称。」
  - 自由身球员只有 `已报价` 变体（没有 listing 可出价/竞价），文案「{club} 已经向自由身球员 {player} 报价，据一位经纪人称。」
- 非自由身假料共用上述三个变体，自由身假料只用 `已报价`；无据侧由HMAC-SHA256 大整数 `mod n` 在可用变体里均匀抽。

**买方真料查询（P0 做 bids + offers；offers 内部、不可公开查）**
- 公开窗口：listing 必须落在 `/api/market/listings` 的 50 条可见窗口内；bid 属于该 listing，玩家在 listing 详情页可见（`src/worker/routes/market.ts:799`、`:819-893`）。
- 查询 9（bids）：
```sql
WITH win AS (
  SELECT l.id, l.player_id, l.seller_club_id
  FROM listings l
  WHERE l.status IN ('listed','bidding','matched_pending')
  ORDER BY l.id DESC LIMIT 50
)
SELECT b.id, b.club_id AS clubId, c.name AS clubName,
       p.id AS playerId, COALESCE(p.display_name, p.name) AS playerName,
       p.club_id AS currentClubId, cc.name AS currentClubName,
       b.status AS bidStatus, l.status AS listingStatus,
       p.position AS position, p.ca AS ca
FROM win w
JOIN listings l ON l.id = w.id
JOIN bids b ON b.listing_id = w.id AND b.status = 'active'
JOIN players p ON p.id = l.player_id AND p.club_id = w.seller_club_id
JOIN clubs c ON c.id = b.club_id
JOIN clubs cc ON cc.id = p.club_id
WHERE b.club_id != p.club_id AND c.is_cpu = 0 AND c.status = 'active' AND p.status != 'retired'
  AND cc.is_cpu = 0 AND cc.status = 'active'
ORDER BY b.id
```
（显示名口径仍走 `src/core/player-name.ts:16` 的 `sqlDisplayName`；这里写 COALESCE 只是示意，落地用 helper。）
- 查询 10（offers，P0，内部）：
```sql
SELECT o.id, o.buyer_club_id AS clubId, c.name AS clubName,
       p.id AS playerId, COALESCE(p.display_name, p.name) AS playerName,
       COALESCE(p.club_id, 0) AS currentClubId, COALESCE(cc.name, '自由身') AS currentClubName,
       o.status AS offerStatus, p.position AS position, p.ca AS ca
FROM offers o
JOIN players p ON p.id = o.player_id
JOIN clubs c ON c.id = o.buyer_club_id
LEFT JOIN clubs cc ON cc.id = p.club_id
WHERE o.status IN ('pending','intent')
  AND ((o.status = 'intent' AND o.season = :season AND o.window_seq >= :windowSeq - 1 AND julianday(o.updated_at) >= julianday('now','-48 hours'))
       OR (o.status != 'intent' AND ((o.season IS NULL AND julianday(o.created_at) >= julianday('now','-48 hours')) OR (o.season = :season AND o.window_seq = :windowSeq) OR (o.status = 'pending' AND o.season = :season AND o.window_seq = :windowSeq - 1 AND julianday(o.created_at) >= julianday('now','-48 hours')))))
  AND COALESCE(o.seller_club_id, 0) = COALESCE(p.club_id, 0)
  AND o.buyer_club_id != COALESCE(p.club_id, 0)
  AND c.is_cpu = 0 AND c.status = 'active'
  AND (cc.id IS NULL OR (cc.is_cpu = 0 AND cc.status = 'active'))
  AND p.status != 'retired' AND (p.club_id IS NOT NULL OR p.status = 'free')
ORDER BY o.id
```
（自由身行 `COALESCE(p.club_id,0)=0`、`currentClubName='自由身'`；`LEFT JOIN` 不能写成 `JOIN`，否则自由身全被丢掉。**关窗期/未归窗的 offers `season/window_seq` 为 NULL**（`offers.ts:190` 绑定 `win?.season ?? null`；开窗期写入的是当前 season/window），查询把 **`pending` 的 NULL** 视为当前窗口锚点，但加 **48 小时年龄上界**（`julianday(created_at) >= julianday('now','-48 hours')`）；非 NULL 的旧窗 `pending`：上一窗且 48h 内的仍算（`window_seq = :windowSeq-1` + 年龄上界），更早的排除。**`intent` 不适用 NULL 分支**：`enterIntent` 只改 status，不重置 season/window，所以 P0-0 必须让它在转为 intent 时回填 season/window（或增加 `intent_created_at` 年龄上界），否则关窗期产生的 NULL intent 在 season 分支不可见（NULL 比较为 NULL，第二分支 `status != 'intent'` 也不成立），不会绕过上界；TC-30 断言它不被任何锚点读取。现东家 `cc` 也必须是 active/non-CPU（`LEFT JOIN` 时自由身 `cc.id IS NULL` 例外），否则 `currentClubName` 会指向 CPU/冻结队。查询 9 的 bids 没有自由身，因为自由身没有 listing。**查询 8/10 必须有界（review 12 M1）**：查询 10 加 `ORDER BY o.id LIMIT 200`，查询 8 保持无 LIMIT，但改为 EXISTS 半连接（只判断该球员是否有过跨队成交，不把 `transfers` 全表带出）；预算按 10 条有界 + 1 条 EXISTS 索引读计。**状态过滤（review 12 M7）**：查询 2/3/9/10 统一加 `p.status != 'retired'`；查询 10 自由身分支加 `p.status='free'`；补退役球员负例。

**P0-0 前置（自由身真料，owner 已批准扩展 offers，2026-10-21）**：现有路径不止 `offers.ts:153` 一处会挡住自由身，P0-0 必须按完整清单改，否则自由身真料在第一次惰性结算就会被清掉：

- **写入守卫**：`:153`（`club_id` 空或 `status='free'` 直接 400）放开为 `seller_club_id=0 AND player.status='free'`；`:160`（`status !== 'normal'`；`:159` 是 trainee 守卫，不拦自由身）允许 `'free'`；`:161` 的 `not_for_sale=1` 对自由身**放行**（解约 SQL 不清 `not_for_sale/offer_auto/min_offer_price/transfer_listed`，自由身会带着这些 flag，不能靠清 flag 解决）；`:163` 对自由身不走 `validateOfferAmount(amount, release_fee)`（自由身无现行合同、`release_fee=NULL`），改用独立规则：`amount` 为正整数、只作意向金额，`hold_id=NULL`、`listing_id=NULL`（`listing_id` 在两版迁移里本来就可空，不需要迁移），不做资金冻结与预算扣减；`:172-175` 的余额预检**保留**（报价仍要求可用余额足够，只是不冻结）；`:187-190` 的 INSERT 必须把 `seller_club_id` 绑 0（不能绑 `p.club_id`，自由身为 NULL，撞 `seller_club_id NOT NULL`）；`:192-196` 的 `fund_holds` INSERT 对自由身**跳过**（否则 `fund_holds_offer_guard` 会按 pending 冻结资金）；`:226-247` 的 `autoRespondKind`/auto_accept 对自由身**跳过**，不得走 `acceptOfferCore`/`fulfillAcceptedOffer`（`:372-386`、`:394-494` 的 `EXISTS ... p.club_id = offers.seller_club_id` 对 0 恒假，会 409 且报价已入库）；`:254` 向 club 0 发通知是 no-op，跳过；`remindDueOffers`/`OFFER_EXPIRED_TAIL` 的「冻结已退回」文案对自由身**不适用**：`notify.ts:32-36`/`:57-58` 按 `hold_id IS NULL` 或 `seller_club_id=0` 改成无冻结尾句（或跳过催办），`expireDueOffers:924-925`/`withdraw:765` 对 club 0 的通知同样处理；TC-25/26 加正文断言，不得出现「冻结」。P0 自由身 offer 只允许人工处理，`status` 只落 `pending`（free 没有 intent）。**读侧**：`routes/offers.ts:73` 的 `box='out'` 和 `:172-178` 的详情都用 `JOIN clubs`，`seller_club_id=0` 会在「我的报价」消失、`GET /offers/:id` 404；P0-0 必须把这两处改 `LEFT JOIN` + `COALESCE(cs.name,'自由身')`，并补 `POST /offers → GET /offers box=out → GET /offers/:id → withdraw` 的验收。**batch 索引（review 7 M-3）**：实际 `db.batch` 是 5 条语句（offers INSERT、`fund_holds` INSERT、`UPDATE offers SET hold_id`、`offer_events`、audit），`results[1]` 是 `fund_holds`，`results[2]` 才是 hold 回写；自由身跳过 `fund_holds`/回写后索引整体前移，固定检查 `results[1]` 会误判（可能 `undefined` 或 `meta.changes=0`）。P0-0 必须**只按 `results[0]` 判 offer INSERT 成功**，再回读断言自由身 `hold_id IS NULL`、非自由身 `hold_id` 非空；若拆成自由身专用 batch，同样改成检查 `results[0]`，不能沿用 `results[1]`。
- **生命周期**：`expireStaleOffers`（`offers.ts:836-839`）的 stale 判定对 `seller_club_id=0 AND player_status='free'` 豁免；否则 `player_club_id != seller_club_id` 与 `status != 'normal'` 必中，5 分钟内 expired。但豁免不等于永久：自由身 offer 的 NULL `pending` 只在**48 小时**内有效（跨窗可见但有年龄上界），查询 10 已带 `o.season/o.window_seq`/`created_at` 过滤（intent 另加 `updated_at` 48h 上界），旧窗口 offer 不成为锚点，**不写 DB 置 expired**；买家撤回走既有 withdraw 置 `withdrawn`；到期由**现有 `expireDueOffers` 统一收口**（它已对所有 `status='pending'` 生效，自由身 pending 与普通 pending 一样处理；**不要加 `seller_club_id=0` 过滤**，否则普通 pending 永不过期、冻结资金和轮次会卡死）；`intent` 与 `pending` 同一口径收口（`src/worker/offers.ts:809-813`），P0-0 只豁免 `seller_club_id=0 AND status='pending'`；intent 存续期间被球员换队/挂牌/非 normal 收口后不再作锚点，TC-30 补这条负例。自由身球员签约后由查询 10 的 `COALESCE(p.club_id,0)=0` 读取时过滤，**不在签约路径写 expired**。因为不冻结资金，无需释放 hold。
- **intent 回填（review 10 H6）**：`enterIntent` 转 intent 时必须写 season/window，且两者来自同一行 `SELECT season, MAX(window_seq) FROM season_windows ...`（不能一个取当前可见赛季、一个取全局 MAX；无窗口赛季用 `(season,0)`），保证首窗 `window_seq >= :windowSeq-1` 可见，不能写 `resolveRumorWindow` 的冷窗 `(season,0)`——否则下一开窗 `window_seq >= :windowSeq-1` 会变成 `0>=1` false，intent 立刻不可见。把 `enterIntent` 加进本清单；TC-30 加进阶段一验收，并补「intent 跨到下一开窗仍可见」与「S8 W6 → S9 W1 跨赛季」用例。
- **验收**：TC-25/26 必须通过 `POST /api/offers` 创建自由身 offer，再触发一次惰性结算（`/api/market/listings` 或 `/api/offers` 的 `coalesceMs`）后读 rumors，断言锚点仍在；不能只直插 `offers` 表。另加一条夹具：自由身 `not_for_sale=1` 与 `offer_auto=1 + min_offer_price`，断言 POST 200、`seller_club_id=0`、`hold_id IS NULL`、无 `fund_holds` 行、无自动 accept、无 club 0 通知。P0-0 与阶段一同批交付；不设隐藏开关，未实现则阶段一不验收，不能以「只在夹具里成立」上线。补跨窗用例：NULL `pending` 在 48h 内可见、49h 不可见。**前端入口（review 12 M9）**：自由身球员页 `SideOps` 只有海捞签入，没有报价入口；P0-0 必须在自由身页加「仅意向报价」按钮（POST /offers，展示不冻结），补 jsdom 用例；否则生产买方无法创建自由身 offer，自由身真料仍为 0。

见 §11 #15。

- 查询 11（买方俱乐部画像，买方假料匹配用；**随帧缓存，不是每次请求都跑**）：
```sql
WITH first11 AS (
  SELECT r.club_id, p.ca,
         ROW_NUMBER() OVER (PARTITION BY r.club_id ORDER BY p.ca DESC, p.id) AS rn
  FROM registrations r
  JOIN players p ON p.id = r.player_id AND p.status != 'retired'
  WHERE r.season = :season AND r.squad = 'first_team'
), profile AS (
  SELECT r.club_id,
         SUM(CASE WHEN p.position IN ('GK') THEN 1 ELSE 0 END) AS n_gk,
         SUM(CASE WHEN p.position IN ('CB','RB','LB') THEN 1 ELSE 0 END) AS n_df,
         SUM(CASE WHEN p.position IN ('CDM','CM','CAM','LM','RM') THEN 1 ELSE 0 END) AS n_mf,
         SUM(CASE WHEN p.position IN ('ST','RW','LW') THEN 1 ELSE 0 END) AS n_fw
  FROM registrations r
  JOIN players p ON p.id = r.player_id AND p.status != 'retired'
  WHERE r.season = :season AND r.squad = 'first_team'
  GROUP BY r.club_id
)
SELECT c.id AS clubId, c.name AS clubName, pr.n_gk, pr.n_df, pr.n_mf, pr.n_fw,
       COALESCE((SELECT f.ca FROM first11 f WHERE f.club_id = c.id AND f.rn = 11),
                (SELECT MAX(f.ca) FROM first11 f WHERE f.club_id = c.id)) AS first11Ca
FROM clubs c JOIN profile pr ON pr.club_id = c.id
WHERE c.is_cpu = 0 AND c.status = 'active'
ORDER BY c.id
```
返回 ≤20 行；`positionNeed = 1 / (1 + 该位置组人数)`；`qualityFit = 1` 若球员 CA 落在该队 `first_team` top-11 的 CA 带内（按 `first11Ca` 所在 5 档带比较），否则 0.6；`first11Ca IS NULL`（first_team <11）时取该队最高 CA，仍 NULL（无 first_team）时 `qualityFit=0.6`，夹具补一队 first_team 只有 9 人的用例。**主力 CA 带口径写死为 `registrations.squad='first_team'` 按 CA 降序第 11 名（top-11 的最低 CA）所在带**，与 SQL 的 `rn = 11` 一致，不读 `players` 全队。查询 11 每帧构建一次（1h/冷窗 24h）；**返回 ≤20 行，但 `rows_read` 是 `first11` + `profile` 两次扫该赛季 registrations（约 2×500 行/帧）**，预算按 F×1k 单列，不能只按 20 行算；见 §8.6。
- 假料球员池来自 §5.1B 的分层帧（`M=256`，`position` × CA 带，无硬 CA 门槛）；卖方假料只用 `clubId>0` 的有队行，买方假料可用 `clubId=0` 的自由身。
- 买方假料匹配在内存里：按 §0.4 的 `weight = positionNeed * qualityFit * ageFit * jitter` 选最高；若最高俱乐部与该球员已有真实 bid/offer、**与该买方**有已完成跨队成交，或就是现东家，则取次高；全被排除则该球员不进买方补集。平手按 clubId 升序。
- 买方补集只保留「球员 + 匹配买方」的 pair；`pickFact(comp, seed, slot, 6)` 选 pair；`dedupeByPlayer` 仍按 playerId 全局唯一。
- 卖方补集逻辑不变（现东家）。

**守卫矩阵（rev9 取代 5.1 的旧表；卖方行保留）**

| 假料族 | 必须排除 | 依据 |
| --- | --- | --- |
| 卖方三族 | 自由身、CPU、非 active | 主体/俱乐部不成立（卖方必须有现东家） |
| 买方 | CPU、非 active；自由身允许（`currentClubId=0`） | 买方可以对自由身报价；非 active 俱乐部不该发消息 |
| 可谈 | `transfer_listed=1` | 锚点为假 |
| 在挂 | listings 三态 | 锚点为假 |
| 留队 | match/rc_change 且 to=club | 锚点为假 |
| 出价 | `clubId=currentClubId`；`(clubId,playerId)` 在真实 bids/offers 里；球员与该买方有已完成跨队成交 | 主体必须是买方；锚点为假；避免「刚买过又买」的矛盾 |
| 全部 | 不再全局排除「有任何跨队成交」 | 旧守卫会把合法买方行误杀；跨队成交只约束同买方 pair |

**载荷 / UI**
- 买方行：`clubName` 是买方，`currentClubName` 是现东家；`text` 同时出现两个队名；meta 链接「买方 · 现东家 · 球员档案」。
- 卖方行：`clubName` = `currentClubName`，meta 只显示「现东家 · 球员档案」。
- 不给 `clubRole` 加颜色/图标/排序；它只是族的一部分。
- `RumorItem` 九键见 §7.4；P0 缓存键 v3。

**测试 / 验收**
- TC-05 扩展：卖方无据行 `clubId=currentClubId`；买方无据行 `clubId != currentClubId`，且 `(clubId,playerId)` 不在真实 bids/offers；两类都不得因「主体归属」被判真。
- TC-11 扩展：买方假料俱乐部 active/non-CPU；卖方球员有现东家，买方球员可有现东家或自由身；pair 无真实关系。
- TC-12 扩为 2×4；买方族在线上/夹具有 bids 时必须被观测到；冷窗组按 `slot%2` 两族。
- 新增 TC-23 买方锚点窗口：不在公开 50 条 listing 内的 bid 不得成为买方有据行；TC-24 买方假料确定性：同窗重复相同、匹配俱乐部不是现东家/真实关系、评分不读位；`正在竞价` 只由 `listing.status='bidding'` 触发；TC-25 报价内部锚点（P0）：offers 行可出「已报价」，但公开页查不到时文案不承诺可查；TC-26 自由身买方：offers 的 `seller_club_id=0` 可出「已报价」有据行，自由身假料只出 `已报价`，`currentClubId=0/currentClubName='自由身'`，UI 不渲染现东家链接。
- 夹具：新增 `seedBids(fx, 12)`（**另建 12 条 listing + 12 条 active bids，球员取 37..48、俱乐部取 active 非现东家**，不复用 `seedListed`/默认 listings）与 `seedOffers(fx, 12)`（P0；含 2 条 `seller_club_id=0` 的自由身）；默认夹具四族各 ≥12 条锚点；四组种子球员不相交。

### 5.1B 假料池的统计分层与缓存（rev9，owner m01383）

**不再用 CA_FLOOR**：硬切会把 CA 分布截断，制造「低 CA 永不出现」的人为边界；真料锚点若出现一条 CA 75，就会与假料池不相交，反而成为真伪侧信道。改为按真料锚点的公开协变量做分层抽样，CA 只是分层变量之一，低 CA 保留非零概率。

**分层与目标**：
- 层 = `position`（GK/DEF/MID/FWD，4）× `ca_band`（<70、70-74、75-79、80-84、≥85，5）= 20 层；`age_band` 不单独分层，作为平衡检验的协变量。
- 源表是 12 个细位置（GK/CB/RB/LB/CM/CDM/LM/CAM/RM/ST/RW/LW），先归并：GK=GK；DEF=CB/RB/LB；MID=CM/CDM/LM/CAM/RM；FWD=ST/RW/LW。不归并会变成 60 层。**落库与代码统一用 `src/core/fc26.ts:28-41` 的单一真源 `GK/DF/MF/FW`**（`:44-48` 的 `POSITION_GROUPS`）；本文表格的 `DEF/MID/FWD` 只是可读别名（DEF=DF、MID=MF、FWD=FW），`rumor_candidates.position_group` 的 CHECK 和 SQL CASE 必须写 `GK/DF/MF/FW`，不能另造一套枚举。
- 锚点**按子帧各自去重**：seller 在 `transfer_listed`/`listings`/`match`/`rc_change` 内按 `playerId` 去重，buyer 在 `bids`/`offers` 内按 `playerId` 去重；同一球员跨子帧各计一次（`46` 只是合并后的唯一球员数，用于最终 8 条的全局去重，不是 buyer 的分母）。`n_s` = 本子帧锚点落在层 s 的数量，`N_seller=46`、`K_seller=12`；`N_buyer=5`、`K_buyer=5`（该子帧非空层数）。**目标按子帧分开**：seller 用卖方族锚点（`transfer_listed` + `listings` + `match`/`rc_change`），buyer 用 `bids` + `offers`（自由身变体只用 free offers）。生产 seller N=46、buyer N=5；buyer 锚点 <5 时退化为 seller target 并记 `targetSource='seller-fallback'`，不静默共用。
- 目标比例 `p_s = (n_s + 0.5) / (N + 0.5·K)`（对称 Dirichlet 先验；空层 p=0，不参与；不再做二次重归一）。若 owner 要更强的高 CA 先验，把 0.5 换成 `α_s ∝ exp(λ·ca_center)` 且 `α_s > 0`，默认不换。**冷窗 `N=0` 时退化：`p_s=1/K'`（K'=候选非空层数），`m_s` 用最大余数分配使 `Σm_s=256`；`M_eff=Σ actual_s` 可低于 256；不参与锚点卡方/置换。**
- 帧大小目标 `M=256`；`m_s_raw = max(1, round(M·p_s))`（仅非空层）；硬容量分池：**seller 子帧 `cap_club=56`；buyer 子帧 `cap_club=56`、`cap_free=8`（同层两池合计 ≤64）**。seller 的 `m_s = min(m_s_raw, 56)`。buyer 的 `m_s` 拆两个分量：按该层 `n_s_club/n_s_free` 的比例分 `m_s_raw`，`m_s_club = n_s_club === 0 ? 0 : min(56, max(1, round(...)))`、`m_s_free = n_s_free === 0 ? 0 : min(8, max(1, round(...)))`，`m_s = m_s_club + m_s_free`；不能用一个合并 `LIMIT m_s` 让自由身被 club 行挤掉，也不能在该层 free 锚点为 0 时硬塞 1 条自由身假料。若 cap 绑定或层内候选不足，**不补位、不重分配**：`avail_s` 是该层实际可用候选数，`actual_s = min(m_s, avail_s)`；定义 `M_eff = Σ actual_s`，`p*_s = actual_s / M_eff` **只用于配额/容量说明，不作为 TC-27 的卡方期望；卡方期望必须用锚点侧独立 `p_s`**。`M=256` 只是目标，`M_eff` 随非空层数 K′ 变化，典型 168–255；买方 N=5 正常 `m_s≈51`、`M_eff≈255` 只在 5 个锚点全在 club 池时成立；有 free 锚点时 free 封 8，`M_eff` 可明显低于 255，必须按 club/free 拆分计算；只有层内候选不足到 1 时才 `actual_s=1, M_eff=5`，不得为 0。**为简洁，以下 §5.1B/§8 里 `M_eff=Σ m_s`、`p*_s=m_s/M_eff` 的 `m_s` 均指 `actual_s`；cap 层 `actual_s=m_s=cap`，短池 `actual_s<m_s`。**不能把 `p*_s` 定义为 `m_s/256`，否则概率和小于 1，卡方期望无法构造。
- 空层（无候选）跳过，p=0；非空层直接用上面的 `p_s`，不再二次归一。下表的 `p'_s` 即非空层 `p_s`。
- 帧内均匀抽即得目标分布（分层随机抽样）；同层内不再按 CA 加权。

**帧查询**：
- **直算帧必须按子帧分开**：seller 20 支，每支 `WHERE p.position IN (/* 组内细位置列表：GK 1、DF 3、MF 5、FW 3，见下 */) AND p.ca BETWEEN ? AND ? AND p.status != 'retired' AND p.club_id IS NOT NULL AND EXISTS (SELECT 1 FROM clubs c WHERE c.id=p.club_id AND c.status='active' AND c.is_cpu=0) ORDER BY ((p.id * 1103515245 + :seed) & 2147483647) LIMIT m_s`；buyer **每层拆成 club 与 free 两支**：club 支 `p.club_id IS NOT NULL ... LIMIT m_s_club`，free 支 `p.club_id IS NULL AND p.status='free' ... LIMIT m_s_free`，`m_s=m_s_club+m_s_free`；不能用一个 `LIMIT m_s` 的合并查询，否则哈希序可能 64 行全是 club，自由身整层缺席。不能用一个不带 club 过滤的查询同时喂两个子帧：卖方会被 17,731 自由身淹没，买方又缺自由身。直算只作候选表不可用 fallback，按 2 个子帧各 20 支构建（2×18.3k）；生产容量门要求候选表 `ready`，不把直算计入常态预算。位置组→细位置列表：GK=`('GK')`（1 个）、DF=`('CB','RB','LB')`（3）、MF=`('CDM','CM','CAM','LM','RM')`（5）、FW=`('ST','RW','LW')`（3）；从 `src/core/fc26.ts` 的 `POSITION_GROUP_BY_POSITION` 生成 IN 列表，不能写 `p.position = ?`；GK 与 MF 各加一条直算帧断言（GK 不能为空、MF 必须覆盖 5 个细位置）。`:seed` = `seededUnit(windowSeq === 0 ? [season, 0, dayKey] : [season, windowSeq], 12)` 的整数化，冷窗按日换帧。
- 建议 P0-0 迁移 `0079_rumor_frame_index.sql`：`CREATE INDEX idx_players_position_ca ON players(position, ca);` 索引只能把每支限定到 `(position 组, ca 带)` 区间；`ORDER BY hash` 无法用索引排序，20 支合计仍会读该区间的全部候选（最坏 ≈18.3k 行/miss，不是 M=256）。没有索引时退化为一次全池 `ROW_NUMBER()`；两种都只在帧缓存 miss 时发生。
- 帧行带 `playerId/playerName/clubId/clubName/position/ca/pa/age`；卖方假料用 `clubId>0`，买方假料可用 `clubId=0` 的自由身。

**2026-10-21 生产实测**（`whl-club`，v3-prod APAC/KIX，`changed_db=false`）：卖方子帧去重后 **N=46**（`transfer_listed` 18 + `match`/`rc_change` 28；`listings` 0），非空 **12 层**；买方子帧 **N=5**（`offers` 5；`bids` 0），与卖方锚点有 5 名球员重叠，合并去重仍是 46。空层 8 层（GK <80 三、DEF <75 两、MID <70 与 75-79 两、FWD <70 一）跳过。**28 是窗口内计数**：最新 50 条 completed 恰好是 24 条 `match` + 4 条 `rc_change`（全部 same_club），所以当前 N=46 成立；实现必须按查询 3 的窗口实时重算 N/p_s，不能把 46 写死，窗口一变表就过期。卖方表按 `p'_s = (n_s + 0.5) / (46 + 0.5×12) = (n_s + 0.5)/52`（下表是 seller 子帧；buyer 子帧单独按 N=5 算，target 不共用）：

| 位置组 | CA 带 | n_s | p'_s | m_s≈ |
| --- | --- | --- | --- | --- |
| GK | 80-84 | 1 | 2.9% | 7 |
| GK | ≥85 | 1 | 2.9% | 7 |
| DEF | 75-79 | 1 | 2.9% | 7 |
| DEF | 80-84 | 8 | 16.3% | 42 |
| DEF | ≥85 | 7 | 14.4% | 37 |
| MID | 70-74 | 1 | 2.9% | 7 |
| MID | 80-84 | 5 | 10.6% | 27 |
| MID | ≥85 | 7 | 14.4% | 37 |
| FWD | 70-74 | 1 | 2.9% | 7 |
| FWD | 75-79 | 1 | 2.9% | 7 |
| FWD | 80-84 | 5 | 10.6% | 27 |
| FWD | ≥85 | 8 | 16.3% | 42 |

`m_s` 按 round 后 12 层合计 254，**`M_eff=254`，`p*_s=m_s/254`，不补满 256**。空层 `p_s=0`，不参与；非空层分母是 52（46 + 0.5×12），与上表一致。

**缓存**：
- 键统一 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`（开窗 `dayKey=''`，冷窗上海日期），值 `{buildId, seller, buyer, buyerClubs, target, cappedStrata, builtAt}`，约 80-120 KB（seller/buyer 两个子帧；`buyerClubs` 是 §5.1A 查询 11 的 ≤20 行画像，随帧缓存，不每次响应重跑；候选表不可用时退回单个 `frame`）。**不能复用 `cachedJson` 的全局 epoch**：`guard.ts:215-218` 是「传了 `env` 才拼 `epoch`」，帧要走 L2 必然传 env，市场写 bump 全局 epoch 后帧必 miss；所以新增 `cachedFrame()`：直接写 `caches.default`（L2）+ 一个独立 L1；`scope='rumor-frame'` 只作命名空间，不拼 epoch。**`cachedFrame()` 必须先过 `l2Available()`**（`guard.ts:164-166`）：vitest 下 `typeof caches === 'undefined'`，裸写 `caches.default` 会 ReferenceError；无 L2 时只走 frame L1（同进程内仍可命中），TC-22/29 不依赖 `caches.default` 存在。**帧 L1 必须在 `resetGuards()`（`guard.ts:269-274`）里一并清**，否则同一测试文件里 TC-22 ①②③ 会互相命中；`cachedFrame` 的 L1 不要复用 `cacheStore`（它会被 `cacheStore.clear()` 清，但保留独立表）。市场写不清帧；新 `buildId`/换日才 miss。`caches.default` 是 per-colo，容量门的 F 要乘实测 colo 数（APAC/KIX 2 → 96/日），或改用跨 colo 的 KV/D1 版本。**F=96 只覆盖 2 个正赛窗；临时窗 3/4 需单独审批并按实际 F 重算（review 12 M10），容量门不把 96 当临时窗上界。**TTL：开窗期（休赛期）1h；冷窗（无开窗期，`dayKey` 键）24h。
- **帧不随每次市场写 purge**：独立 scope + 键含 `buildId`；新锚点由当窗锚点集合（`familyAnchors`）守卫在选槽时排除，统计目标最多滞后 1h（开窗）/1 天（冷窗）。**响应缓存 P0 改用 `cachedRumorResponse()`：开窗键 `market-rumors:v3:{season}:{windowSeq}`、冷窗键 `market-rumors:v3:{season}:0:{dayKey}`，直接写 `caches.default`（L2）+ 独立 L1，不传 `env`、不拼全局 epoch；TTL 1h，不随市场写 purge、也不按 buildId 删键**——市场写只清 L1，L2 最多旧 1h，这是可接受的传闻新鲜度。`cachedRumorResponse` 必须复用 `cacheStore`（与 `purgePublicCaches` 同一 L1，写请求中间件自动清）；不新增 `clearRumorResponseL1()`；L2 写前过 `l2Available()`，vitest 无 `caches` 时跳过 L2 不抛；补一条“无 caches 环境仍返回 200”的用例。否则 `cachedJson` 的全局 epoch 被每次市场写 bump，2 个 colo 各 miss 一次，`2×W×380 = 2×2000×380 = 1.52M/天`，叠加峰值 2.03M ≈4.03M，直接破 4M 门。若 owner 坚持每次市场写立即刷新，则 W 必须降到 ≤1000/colo 并重跑容量门；二者不能同时保留 W=2000 和全局 epoch。
- 响应缓存仍 `market-rumors:v3`，与帧缓存分开；帧 miss 时才跑 20 支查询。**响应键带 `secretVersion`**：开窗 `market-rumors:v3:{season}:{windowSeq}:{secretVersion}`、冷窗 `market-rumors:v3:{season}:0:{dayKey}:{secretVersion}`；本文其余键简写省略该后缀，实现必须带。`secretVersion` 取 `RUMOR_SECRET_VERSION`（默认 `v1`），轮换 secret 时 bump；帧键不含 bit，不需要。
- **为什么开窗期是 1h**：候选表帧每次 miss 读 3.8k；**每 colo 每活动窗口 24 次/日；保守按 2 个窗口 × 2 colo = 96 次/日（同一时刻只有一个开窗，实际 F=48；容量门仍用 96 的保守上界）**，每次 3.8k ≈0.365M/天，加响应 0.02M + query 11 买方画像 0.10M + 构建/重试 0.073M，合计 ≈0.56M/天；直算 fallback 18.3k/次不是单子帧：每次是 2 子帧×18.3k，96 次≈3.51M/天，再叠加响应 0.02M + 画像 0.10M≈3.63M/天（48 次/日/colo 已是两窗口合计，不能再乘 2）。低于 Free 5M/天（5M 是账户级共享，开窗前容量门见 §8.6）。1h 是「统计目标最多旧 1 小时」的上界，不是定时任务；没有请求就不会重建。缩到 15m 也还在约 2.5M/天以内，但 P0 没有证据表明分布漂移需要 15m；冷窗锚点冻结，用 24h 日更，避免每小时空重建。

**验收**：
- TC-RUMOR-27（配额与低 CA 覆盖，review 12 修正）：卡方/SMD **不再作为帧 vs 锚点的 oracle**——帧每层行数就是 `m_s`，期望同源，卡方只剩四舍五入误差，无论候选池实际分布如何都会 p≈1。只断言：① 非 cap 层 `m_s=round(256·p_s)`，cap 层 `actual_s=cap` 且 `cappedStrata` 非空；② 低 CA 覆盖：候选池含 `ca<70` 的层，帧内可出现（至少 1 条），不要求特定 CA65 锚点；③ 年龄只做描述性统计，不做显著性；④ buyer cap 用 `n_s=4`（3 club+1 free）夹具同时命中 56/8/64。TC-27 用专用大夹具（每层 ≥64），不进入 §8.7 的 200 窗口集；最终 8 条载荷只断言每族≥1 无据、至少 2 个位置组非空。
- 帧确定性与缓存：同窗两次帧逐字节相等；换窗/新 `buildId` 帧变化；一次市场写后帧仍 hit（`cachedFrame` 不拼全局 epoch），新 `buildId`/冷窗换 `dayKey` 后 miss。

### 5.1C 日预计算候选表（rev9 增补，owner m01936）

**结论**：推荐「单表 + 窗口键（冷窗日键）+ 5 分钟 ensure」，不预计算完整帧。候选表只存每层 64 名候选（56 有队 + 8 自由身），帧构建时再按当窗真料锚点算目标、选 256 行。理由：帧目标随锚点变，预计算整帧会每天/每窗过期；候选表只提供稳定候选池，目标在帧构建时算一次并随帧缓存，兼顾读量与小样本偏差。

**为什么不是固定 00:00 cron**：开窗/跨日可能发生在任意时刻；`scheduledTick` 每 5 分钟已经存在，用 `ensureRumorCandidates` 检查当前 `(season, window_seq, day_key)`，没有 ready build 就构建。效果是「每个日键预计算一次」，窗口一开最多 5 分钟内补上，不依赖固定 cron，也不引入新触发器。

**开窗首请求只读，不同步构建（review 12 修正）**：`season_windows` 没有计划开窗时间字段，不能假设「开窗前 15 分钟」自动预构建；改为**开窗后首个 tick 构建**，请求路径只读 ready/旧 ready/503：`ensureRumorCandidates` 不在请求里跑 20 支 SQL，也不在请求里写 1,280 行；开窗首请求未 ready 时返回旧 ready 或 `503 rumor_unavailable`，禁止直算。开窗前预构建只能由运营手动触发 ensure（管理端或后台任务），不依赖新字段。TC 断言“开窗首请求命中旧 ready/503、不触发 build、不直算”。

**表**

```sql
CREATE TABLE rumor_candidate_builds (
  build_id      TEXT PRIMARY KEY,
  season        INTEGER NOT NULL,
  window_seq    INTEGER NOT NULL,
  day_key       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('building','ready','failed','superseded')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  row_count     INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  error         TEXT,
  next_attempt_at TEXT
);

-- building 与 ready 分开：允许旧 ready 与新 building 并存
CREATE UNIQUE INDEX idx_rumor_candidate_building
  ON rumor_candidate_builds(season, window_seq, day_key)
  WHERE status = 'building';

CREATE UNIQUE INDEX idx_rumor_candidate_ready
  ON rumor_candidate_builds(season, window_seq, day_key)
  WHERE status = 'ready';

CREATE INDEX idx_rumor_candidate_builds_key
  ON rumor_candidate_builds(season, window_seq, day_key, status, finished_at);

CREATE TABLE rumor_candidates (
  build_id        TEXT NOT NULL,
  pool            TEXT NOT NULL CHECK (pool IN ('club','free')),
  position_group  TEXT NOT NULL CHECK (position_group IN ('GK','DF','MF','FW')),
  ca_band         TEXT NOT NULL CHECK (ca_band IN ('<70','70-74','75-79','80-84','>=85')),
  rank            INTEGER NOT NULL CHECK (rank BETWEEN 0 AND 63),
  player_id       INTEGER NOT NULL,
  PRIMARY KEY (build_id, pool, position_group, ca_band, rank)
);
```

- `pool='club'`：有队、俱乐部 active/non-CPU、非退役；卖方假料与买方假料的俱乐部主体都用它。
- `pool='free'`：`club_id IS NULL` 且 `status='free'`；只给买方自由身变体与买方假料。
- 每层目标 56 有队 + 8 自由身 = 64；**这是硬 cap，不是观测上界**：`m_s_raw` 超过 cap 时按 §5.1B 截断，**不补位、不重分配**，记 `cappedStrata`；不能拿当前 max `m_s=42` 当容量依据。任一池不足时少插，不补位；`rank 0..63`。
- 不存 `club_id/name`：候选表只是 ID 池；帧构建时 join `players`/`clubs` 并重新校验，避免球员当日转会/俱乐部失效后仍用旧队名。

**构建**

- `ensureRumorCandidates(env)` 在 `scheduledTick` 里、`runSettleTick` 之后调用，但必须放在 `if (!tickChanged) return` **之前**，并各自包 try/catch（`settleOverdue` 也可能抛错）；复用现有 `club-settle-tick` monitor，用 `captureMessage`/breadcrumb 记录 ensure 结果；**不新增第二个 Sentry cron monitor**，免费档全 org 只允许 1 个，见 AGENTS.md:93；失败不影响结算。
- key = `resolveRumorWindow` 的 `(season, windowSeq)` + **开窗 `dayKey=''`（同窗一个 build）、冷窗 `dayKey=上海日期`**（`shanghaiDateStr()`，与窗口解析同一时区；不混用 UTC 日期）；候选 seed 与直算帧一致：开窗 `[season, windowSeq]`、冷窗 `[season, 0, dayKey]`。帧键统一带 `dayKey` 占位（开窗为空串、冷窗上海日期），避免候选表与 fallback 产出不同集合。
- 有 `ready` → 返回；有 `building` 且 `started_at` 在 10 分钟内 → 返回；stale building 超过 10 分钟 → 先 `UPDATE ... SET status='failed', error='stale lease' WHERE ... AND status='building' AND started_at < now-10min` 原子抢占，再重试。
- 读同 key 的 `MAX(attempt_count)` 与 `next_attempt_at`，谓词拆成两条，退避只作用于前两次：
  - `if (maxAttempt >= 3) return unavailable;`——**当天封顶**：`maxAttempt` 只数同 key 且 `started_at >= :dayStart` 的 build（`dayStart = new Date(`${shanghaiDateStr(now)}T00:00:00+08:00`).toISOString()`，是 UTC `...Z` 时间戳，与 `started_at` 同格式；不要直接绑 `shanghaiDateStr()` 的 `YYYY-MM-DD`，否则日界会落到上海 08:00；加上海 00:30 / 07:30 边界用例）；第 3 次失败后当天不再插入第 4 个 build，**次日 00:00 后重置**。开窗 `day_key=''` 也按上海日重置，不是整窗永久封顶，避免一次部署抖动把整个开窗期打成 fallback。
  - `if (maxAttempt >= 1 && now < nextAttemptAt) return unavailable;`——只拦 1→2、2→3 的提前重试；退避到期可继续下一次，但当天 3 之后不再放行。
  - 否则 `INSERT ... attempt_count = maxAttempt + 1`；首次为 1，失败不额外自增，靠下一次插入递增；第 3 次失败后 `maxAttempt=3`，**当天**返回 `unavailable`（旧 ready/503），不直算，并记 `rumor_candidates_failed`，次日重新计数。
- 否则生成 `buildId = crypto.randomUUID()`，用 `INSERT ... (build_id, ..., attempt_count) VALUES (?, ..., (SELECT COALESCE(MAX(attempt_count),0)+1 FROM rumor_candidate_builds WHERE season=? AND window_seq=? AND day_key=? AND started_at >= ?)) ON CONFLICT DO NOTHING RETURNING build_id`（最后一个 ? 是同一个 UTC `...Z` 时间戳 `dayStart`，与 `maxAttempt` 的 `:dayStart` 同口径；否则次日首次插入会拿到 4，日过滤后立刻 >=3，当天只剩一次机会）；building/ready 两个部分唯一索引允许旧 `ready` 与新 `building` 并存；没有返回行就重查 ready/building；**禁止使用 `last_row_id`**（被忽略的插入不会更新它）。
- SQL 形状（20 层 × 56 有队 + 8 自由身；`position_group`/`ca_band` 的 CASE 与 §5.1B 相同）：

```sql
WITH base AS (
  SELECT p.id AS player_id,
         CASE WHEN p.position = 'GK' THEN 'GK'
              WHEN p.position IN ('CB','RB','LB') THEN 'DF'
              WHEN p.position IN ('CM','CDM','LM','CAM','RM') THEN 'MF'
              WHEN p.position IN ('ST','RW','LW') THEN 'FW'
              ELSE NULL END AS position_group,
         CASE WHEN p.ca < 70 THEN '<70'
              WHEN p.ca < 75 THEN '70-74'
              WHEN p.ca < 80 THEN '75-79'
              WHEN p.ca < 85 THEN '80-84'
              ELSE '>=85' END AS ca_band,
         p.club_id,
         ((p.id * 1103515245 + :seed) & 2147483647) AS h
  FROM players p
  LEFT JOIN clubs c ON c.id = p.club_id
  WHERE p.status != 'retired'
    AND p.ca IS NOT NULL
    AND p.position IS NOT NULL
    AND p.position IN ('GK','CB','RB','LB','CM','CDM','LM','CAM','RM','ST','RW','LW')
    AND ((p.club_id IS NOT NULL AND c.status = 'active' AND c.is_cpu = 0)
         OR (p.club_id IS NULL AND p.status = 'free'))
),
ranked AS (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY pool, position_group, ca_band ORDER BY h, player_id) AS rn
  FROM (
    SELECT *, CASE WHEN club_id IS NULL THEN 'free' ELSE 'club' END AS pool FROM base
  )
)
INSERT INTO rumor_candidates(build_id, pool, position_group, ca_band, rank, player_id)
SELECT :build_id, pool, position_group, ca_band, rn - 1, player_id
FROM ranked
WHERE (pool = 'club' AND rn <= 56) OR (pool = 'free' AND rn <= 8);
```

- `:seed` = `seededUnit(windowSeq === 0 ? [season, 0, dayKey] : [season, windowSeq], 12)` 的整数化；开窗同窗稳定，冷窗按日换血；与 §5.1B 直算帧共用**盐 12**（不要再用 13），避免候选表与 fallback 出不同集合。
- 成功：batch 里先把同 key 旧 `ready` 置 `superseded`，再把新 build 置 `ready`，写 `row_count/finished_at`；失败：置 `failed` + error + `next_attempt_at=now+15/30/60min`，**保留旧 `ready`**；同一 key **每上海日**最多 3 次尝试（`attempt_count`），第 3 次失败后当天不再插入新 build，返回旧 ready/503 并记 `rumor_candidates_failed`，**次日 00:00 后重置**；开窗 `day_key=''` 也按 `started_at` 的上海日计数，不是整窗封顶。容量门必须按失败路径 3×18.3k≈55k/天计，不能只算 1 次。**失败熔断（review 10）**：同一 `(season,window_seq,day_key)` 连续 3 次 failed 后，生产回退顺序固定为「旧 ready（即使已过期）→ 空态/503 + 告警」；直算只允许测试/本地/应急开关（`RUMOR_ALLOW_DIRECT=1`），生产默认关闭，不能把 3.63M/天的直算当自动回退。熔断状态在 1h 后或新 `build_id` 成功时解除；断路器打开期间 `/market/rumors` 返回旧 ready 或 `503 rumor_unavailable`，不返回 8 条直算。
- 每次构建读 ≈18.3k、写 ≤1,280 行；构建耗时与 D1 写都在 cron，不在请求路径。失败路径最多 3 次构建≈55k/天，不叠加直算。
- 保留 7 天：构建成功后删 `started_at < now-7d` 的 candidates + builds；D1 无 FK，先删 candidates 再删 builds。
- `row_count = 0` 视为失败（不 ready），避免空帧掩盖问题。

**读取**

- `loadRumorFrame` 先找当前 key 的 `ready` build；没有 → 生产按失败熔断顺序：旧 `ready`（可过期）→ 空态 `503 rumor_unavailable` + 告警；直算帧只允许测试/本地/应急开关，键用 `buildId='direct'`；打日志 `rumor_candidates_missing`，不阻塞请求；下一次 tick 会补。
- 有 → 读 `rumor_candidates` + join `players`/`clubs`，重新校验 `status != 'retired'`、club active/non-CPU、free 仍 free，并**重新比对 `position_group`/`ca_band`/`pool` 与当前球员**；换位置/CA 跨层或换池（自由身签约、球员变自由身）**直接丢弃该候选并记 `cappedStrata:{layer,reason:'discard',requested,actual}`；不回填、不补读**，保持一次 miss ≤3.8k 行。**候选表只在帧缓存 miss 时读**（命中时 0 次候选表查询）；一次 miss 读 1,280 候选 + 最多 2×1,280 join ≈3.8k 行。
- 目标 `n_s/p_s/m_s` 在帧构建时按 §5.1B 算一次并随帧缓存；但读取时按实际可用候选重算 `actual_s/M_eff` 与 `cappedStrata`（reason=`cap`/`discard`），响应使用重算后的 target，不拿缓存 target 自证；`targetVersion` 随帧缓存值返回。**seller 子帧用卖方族锚点，buyer 子帧用 `bids`+`offers`（free 变体只用 free offers），不共用 target**；卖方从 `pool='club'` 取 `m_s`，买方从 club+free 取，自由身变体从 `free` 取。若某层可用候选 < `m_s`，取全层并记 `cappedStrata`。
- 帧缓存值 `{buildId, seller, buyer, buyerClubs, target, cappedStrata, builtAt}`，约 80-120 KB；键统一 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`（开窗 `dayKey=''`，冷窗上海日期）；用 `cachedFrame()` 直接写 `caches.default`，不拼全局 epoch；市场写不清帧，新 `buildId`/换日才 miss。响应缓存仍 1h。
- `M=256` 是每个子帧的目标候选行数；cap 后实际 `M_eff=Σ m_s`，可能小于 256（尤其买方 N=5）；TC-27 的 cap 层只断言 `actual_s=cap`，非 cap 层用锚点 `p_s`，不拿 `p*_s` 自证；最终 8 条假料仍从子帧里抽。

**预算**

- 构建 18.3k/天（失败重试最坏 3×≈55k/天）+ ensure 288 次小 SELECT/天 + 帧 48×3.8k≈182k/天（**per colo**；APAC/KIX 2 colo 按 96 次≈365k/天）+ 响应 0.02M/天 ≈**0.56M/天**（失败路径最坏≈0.60M，3 次构建比 1 次多 2×18.3k）；仍低于 §8.6 的 **1.3M 增量门**，账户峰值 2.03M+0.60M≈2.63M <4M。若 4h TTL 方案：帧是 2 子帧×18.3k=36.6k/次，6×2×36.6k×2 colo≈0.878M + 0.02M + 0.10M + 0.055M≈**1.05M/天**，**低于 1.3M 门，可作候选表不可用时的降级**。
- 若 4h TTL 方案先上，候选表可后置；两者不叠加：候选表 `ready` 时帧不再直算。

**失败与降级**

- 无 `ready` / `building` 未完成 / `failed` → 旧 `ready`（可过期）→ 空态 `503 rumor_unavailable` + 告警；直算只允许 `RUMOR_ALLOW_DIRECT=1` 的 dev/应急开关，生产默认禁止；日志 + Sentry breadcrumb；不把错误抛给玩家。
- 候选不足 / 层被 cap → 该层取 cap，**不补位、不重分配**；`M_eff=Σ m_s`，`p*_s=m_s/M_eff`；TC-27 的 cap 层只断言 `actual_s=cap`/`cappedStrata`，不参与卡方；非 cap 层用锚点 `p_s`，TC-29 锁 cap 后不重分配。
- 构建超时/租约过期 → 由 ensure 原子抢占 stale building（`started_at < now-10min` → failed），下一 tick 重试；每天最多 3 次；不删除旧 `ready`，直到新 `ready` 原子替换。
- 候选表/索引迁移失败 → `503 rumor_unavailable` + 告警，禁止直算；容量门不通过不能上线。

**迁移与测试**

- `0080_rumor_candidates.sql`（若 0079/0080 已被占用则按清单顺延，edition 再顺延）：两张表 + 三个索引；P0-0 的 `0079_rumor_frame_index.sql` 仍保留，直算 fallback 需要 `idx_players_position_ca`。**两个文件都要在 `tests/d1.ts` 的 `MIGRATION_FILES` 里、0078 之后追加（0081 留给 edition，P0 跳过并在清单注释说明顺序）**，否则 D1 测试先报 `no such table: rumor_candidate_builds`。
- TC-RUMOR-29：构建 20×64（56/8，buyer 同层 club 56 + free 8 合计 ≤64）、无退役/失效俱乐部、free 只在 free 池（`status='free'`、`ca/position NOT NULL`）；同 key 幂等、冷窗不同 `dayKey` 换血、开窗同窗稳定、单 `ready`；**seller 直算帧不含自由身，buyer 直算帧含 club+free**；cap 后 `M_eff=Σ m_s`、`p*_s=m_s/M_eff`、不补位/不重分配；有候选表帧与直算帧同 target/同统计（TC-27）；缺表返回 503、不直算；构建失败保留旧 `ready`、每上海日最多 3 次尝试，**同日把 `next_attempt_at` 拨到过去后重跑 ensure 仍不产生第 4 个 build；把 `started_at` 拨到前一日后允许新 build，且次日起可连续 3 次；无 ready 时返回 503，不 direct（日重置，不整窗封顶）**；候选跨层/换池丢弃并记 cappedStrata；清理 7 天；`EXPLAIN` 确认候选查询走主键、不扫 `players` 全表。
- TC-RUMOR-30 `intent` 窗口（review 9）：关窗期 `POST /offers` → 卖方接受进入 intent → 断言 `offers.season/window_seq` 已回填且查询 10 能取到；手工造一条 `season IS NULL` 的 intent，断言它不被任何锚点读取（不是当前窗口锚点）；再造上一窗 `pending`（`created_at` 30h 前）断言仍作锚点、49h 前不作。
- 现有 TC-27 继续跑；TC-29 不替代它。

**备选（已比较，不推荐）**

- 预计算整帧：帧目标随锚点变，每天/每窗过期；候选表更灵活。
- JSON 缓存存 1,280 行：约 100KB，无查询/索引，evict 后重建，排查困难；D1 表更稳。
- 拆 seller/buyer 两张表：56+8 单表已够，拆表只增加写入和一致性面。
- 不预计算、只把帧 TTL 拉到 4h：实现最小，但分布最多旧 4h；作为候选表未就绪时的退路，不替代候选表。

**实施顺序（阶段一内）**

1. 迁移 0080 + `ensureRumorCandidates` + cron hook + logs。
2. `loadRumorFrame` 读候选表 + fallback + seller/buyer 子帧。
3. TC-29 + TC-27 重跑；容量门报告用候选表数字（≈0.56M），通过后才继续。
4. 若容量门仍不过，退 4h TTL + W 去抖，不再加表。

### 5.2 P0-2 rendezvous 与主体去重

**现状问题**
- 索引 `pool[... * pool.length]`（`:206`、`:215`）在池长变化时整体位移。
- 写路径 purge 保证池会变（`src/worker/index.ts:59-68`）。
- 有放回抽样让同一球员可跨槽重复（`:206`、`:232-233`）。
- `seededUnit` 住在 `src/worker/venue-ops.ts`（`seededUnit` 定义，HEAD `:105` / 工作区 `:270`），该文件有 IO 依赖，core 无法复用。

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
- 新增 TC-RUMOR-13 最小扰动：池子造到 ≥20 条事实，加一条后 8 条正文变动 ≤2 条（池太小会让期望变化超过阈值，夹具必须够大）。**「≤2」是固定夹具 + 固定种子上的快照锁，不是不变量**：rendezvous 是逐槽取最大权重，新增的那条事实可能同时成为多个槽的最大值，≥20 只降低概率、不给上界；换夹具或换种子必须重算这条期望，校验时在用例注释里写明夹具指纹。
- 新增 TC-RUMOR-14 同窗 `playerId` 唯一。
- 新增 TC-RUMOR-18 写路径，按 8.3 拆成两条：**18a 不改变族集合的写**（原有 id 是新的子集、正文变动 ≤2 条，与 TC-13 一样是固定夹具快照锁）、**18b 补空族**（把原本为空的族补到非空）。5.0 改成固定全集之后族抽签不再读「非空族数」，所以 18b 的断言语义是「只有落在该族的槽变化，其余槽的族与正文逐字不变」，与「非空族数从 2 变 3」无关——rev5 这里还留着 `|F|` 2→3 的旧措辞，会让读者以为机制仍依赖族数，rev6 删。
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
- **新增 `web/src/pages/market/MarketIntelPage.test.tsx`（jsdom）**：三态各一条，断言现有三态文案（`传闻打不开了，稍后再试` / `正在打听消息…` / `这个窗口暂时没有传闻。`）、每条主句里有到 `/players/{id}` 的链接；重试按钮/`role="status"`/空态广告板链接不在 P0、卡头数字等于 `rumors.length` 与去重俱乐部数。
- 手工 e2e 三视口（375/768/1280）× 匿名/登录，只补自动化测不到的排版与焦点。
- grep 断言页面源码不含「系统」「自动生成」「下窗换血」。

**风险**：文案需一轮审校；移除行尾队名后行内信息密度下降，需 P1 的链接组补回。

### 5.4 P0-3 双侧主体载荷与链接（rev9 取代原 P1-1）

**现状问题**
- `RumorItem` 无 `clubId`（`src/worker/rumors.ts:29-37`），队名是纯文本（`MarketIntelPage.tsx:54`），只有球员名可点（`:70`）。
- 买方主体需要同时给出「买方队」与「现东家」；只加 `clubId` 不够，必须加 `clubRole` 与 `currentClubId/currentClubName`。
- 球员链接走 `player-link.ts:14-16` 的 `fcId ?? id` 回落分支。

**设计做法**
- `RumorItem` 五键 → 九键：`id/text/playerId/playerName/clubId/clubName/clubRole/currentClubId/currentClubName`；`playerId` 继续用于球员链接（两种编号空间零重叠，`src/worker/player-ref.ts:2`）。**不加 fcId**。
- 买方行：`clubId/clubName` 是买方，`currentClubId/currentClubName` 是现东家；卖方行：`clubRole='current'`，`clubId=currentClubId`、`clubName=currentClubName`。
- 行尾改为链接组：买方有现东家行「买方 · 现东家 · 球员档案」三个链接；**自由身买方行两链接（买方 · 球员档案，不渲染现东家）**；卖方行「现东家 · 球员档案」两个链接。队名不链 `/clubs/:id`（匿名撞登录墙）。
- 该契约变更并入阶段一（原 P1-1 取消）；P0 缓存键 `market-rumors:v3`。

**数据 / API**：四个池查询都带出 `club_id`；买方查询 9/10 带出 `club_id` 与 `currentClubId`；键集契约变更，TC-RUMOR-01/07 同 PR 更新（属故意变红的契约变更，不是回归）。

**真假安全**：`clubId`/`clubRole` 是公开事实，与位无关；不得在链接或角色标签上加真假样式、aria-label、排序；不得用「是否在可谈名单」做徽标。

**测试 / 验收**
- 后端：`clubId` 非空且非 0；`currentClubId` 可为 0（自由身），此时 `currentClubName='自由身'`，非自由身时必须非 0；`clubRole` 只能是 `current|buyer`；买方行 `clubId != currentClubId`（自由身时 `currentClubId=0` 也满足）。
- 前端（jsdom，`MarketIntelPage.test.tsx`）：卖方行两个链接；买方有现东家行三个链接，自由身买方行两个链接（不渲染现东家）；href 分别为 `/players?club_id=N` 与 `/players/{playerId}`；断言 href 里没有 `/clubs/`。

**风险**：键集变更必须与前端同批发布；买方行有两个队名，窄屏折行需要实机确认。

### 5.5 P0-4 缓存键版本（rev9：键集并入阶段一）

**现状问题**：键集变更后，1h TTL 内新前端可能拿到旧五键/六键载荷（九键缺失，`clubId`/`clubRole` 为 `undefined`）。

**设计做法**：缓存键改 `market-rumors:v3:{season}:{windowSeq}`；冷窗按 2.9 用 `market-rumors:v3:{season}:0:{dayKey}`。**不写「部署后手动 purge 一次」**——仓库里没有 HTTP 手动 purge 入口：`purgePublicCaches`（`src/lib/guard.ts:139`）的调用方只有写请求中间件（`src/worker/index.ts:64`）与 cron（`:259`），所以「手动 purge」不可执行。换 v3 键本身就够了：旧键不再被读取，1 小时 TTL 到期后自然失效；键集变更与前端同批发布，旧键残留不会产生错误载荷。**不做 60 秒 window 缓存**——它会打破 TC-RUMOR-08（`:514` 用 `ttl: '60000'`，`:525` 在同一用例内 `advanceWindow`，`:526-528` 断言新 id），而收益只是每请求少 1-2 次点查。P1 的 `phase` 字段另升 v4（见 5.6）。

**数据 / API**：缓存键常量。

**真假安全**：无影响。

**测试 / 验收**：TC-RUMOR-08 的测试意图保持（缓存命中不穿透、换窗出新载荷），但它的 id 期望要按新机制重写（旧期望绑定在被删除的假料 id 池上），见 8.2；D1 成本不塞进 TC-08，拆成 TC-RUMOR-22（8.3）。

**风险**：每请求 1-2 次点查的成本保留。限流仍是 60/60s/IP，与 D1 无关，不构成风险。

### 5.6 P1-3 窗口 phase 与冷窗文案

**现状问题**：无开窗时回退 `(visibleSeason, 0)` 且整段无开窗期（赛季进行中）内容不变，页面却承诺「下窗换血」；`phase` 如果只服务端生成，前端根本拿不到——`RumorsResponse` 只有 `rumors`（`web/src/lib/api.ts:973-974`），`useRumors` 的 queryFn 又只返回 `.rumors`（`web/src/lib/queries.ts:254-260`）。

**设计做法**
1. `resolveRumorWindow` 返回值加公开的 `phase: 'open' | 'closed'`，随载荷一起缓存（不单独查询）。
2. **响应类型改成 `{ rumors: RumorItem[]; phase: 'open' | 'closed' }`**（`web/src/lib/api.ts:973-974`），`useRumors` 改成返回整个响应（`queryFn: async () => await api<RumorsResponse>('/api/market/rumors')`），调用方解构 `{ data }` 后取 `.rumors` 与 `.phase`。
3. 卡头分叉「本窗情报」/「赛季情报」；冷窗追加一行「本窗市场冷清，暂无挂牌与出价。」+ 广告板入口。
4. 阶段归属：`phase` 是 **P1-3** 的整卡字段；P0 已经是九键载荷，P1 只在载荷外加 `phase`，缓存键从 v3 升 v4。不要把它写成 P0 的前置条件。

**数据 / API**：`phase` 作为整卡字段下发（对 8 条同值，不携带逐条位）；TC-RUMOR-01 增加 `phase` 断言。

**真假安全**：`phase` 与位完全无关；「市场冷清」只说公开池为空。

**测试 / 验收**：新增 TC-RUMOR-17（开窗时 `phase='open'`；无开窗时 `phase='closed'` 且 id 仍为 `r{season}-0-{slot}`）；TC-RUMOR-10（`:546-555`）保持。前端在 `MarketIntelPage.test.tsx` 里补一条「phase=closed 时卡头含『赛季情报』」。

**风险**：赛季进行中可能持续很久，内容不随日更；若要日更，见 5.9（P0）。

### 5.7 P1-4 俱乐部级上限（rev2 新增）

**现状问题**：线上 18 名在列球员（CA≥80 16 名）只来自 4 家俱乐部，有据行会挤在这几家，形成「有据行集中在头部俱乐部」的统计侧信道；rev1 在风险里承诺「P1 加俱乐部级上限」，但 P1-1..P1-3 都没有这条逻辑，承诺没有落点。

**设计做法（rev6 重写：上限只改「选哪条」，不改「有没有锚点」）**
- `grounded` 由 5.0 的位定死，5.7 **不读也不改**它。上限只作用于 `pickFact` 的候选权重：按本窗已出现次数给同俱乐部的候选降权，仍在**同族、同侧**的池里挑，挑不到别的就保留原选中项（**软上限**）。
- **降权公式必须读常量**（rev7 修 rev6 的漏洞）：`weight × 1/(1 + max(0, count − M + 1))`，其中 `M = MAX_SAME_CLUB_PER_CARD`、`count` 是本窗同俱乐部**同侧**已出条数。`count < M` 时不降权（前 M 条照常选），从第 M 条起每多一条再除 2。rev6 写的是 `weight × 1/(1+count)`，**公式里没有 `M`**，于是「把 `M` 改成 99」这个变异在行为上完全没有变化，V22 不可能红——常量、公式、用例三者互相矛盾，这条是复核指出的。注意这是**软**上限：池里挑不到别家就保留原选中项，所以「各 ≤ M」只在**夹具提供了足够替代**时成立，不是无条件不变量（见 TC-19 的口径）。
- **两侧同时施加**：有据侧与无据侧都降权。rev5 只对有据侧设限，会造出比原来更硬的侧信道——「同一俱乐部出现 ≥3 条 ⇒ 必是无据」。两侧同待遇之后这条读法失效。
- 常量改名 `MAX_SAME_CLUB_PER_CARD = 2`（原来叫 `MAX_GROUNDED_PER_CLUB`，名字本身就在暗示它会改位），写在 `src/worker/rumors.ts` 顶部。
- 执行顺序：5.0 全部走完（族、位、rendezvous、去重）之后才轮到 5.7 的降权重选；重选不得换族、不得换侧、不得与已用 `playerId` 撞车，任一条不满足就放弃本次降权。

**数据 / API**：无接口改动。

**真假安全**：上限对两侧同待遇，不改变条数、顺序与有据/无据比例；俱乐部计数不上屏（上屏的是「涉及 M 家俱乐部」，对真假同待遇）。5.0 的「`grounded` 只读位、且是唯一读取点」因此仍然成立——rev5 的「有据槽降级为无据」写法与它直接冲突，rev6 删。

**测试 / 验收**：TC-RUMOR-19 分两段（rev7 改，见 8.3）——**段一（结构）**：同一夹具下 8 条仍在、id 仍 0..7、有据/无据的位分布不变（上限只改选哪条、不改位的与条数，这是与 5.0 的兼容点）；**段二（快照锁）**：在「1 家俱乐部 5 名可谈球员 + 除它之外还有 ≥2 家俱乐部各 ≥3 条可替代事实」的固定夹具上，单侧同俱乐部条数 ≤ `MAX_SAME_CLUB_PER_CARD`，用例注释记夹具指纹。变异「删掉降权逻辑」或「把 `M` 改成 99」应让段二红（这只在公式读 `M` 时成立，见上条）；变异「恢复成有据槽降级为无据」应让 TC-RUMOR-12 的线上形态组红。阶段五验收因此加一条「TC-RUMOR-12 不回归」。rev6 在这里写的「各 ≤2 当无条件不变量」，与小池挑不到替代时的合法保留冲突，已改。

**风险**：软上限在小池（4 家俱乐部、17 人）下常常挑不到替代，实际不生效——这是可接受的：它只在池子够大时才真正压分布，而且不生效时也不会把有据行变成无据。rev5 写「会更容易丢有据行、条数降低」，是「降级为无据」写法的副作用，随本轮改写一起消失。

### 5.8 P1 期档快照（可选）

**现状问题**：要支持「上一期情报」「球员传闻档案」，缓存做不到——旧载荷不落库就永远拿不回来。

**设计做法**：`rumor_editions(season, window_seq, rev, pool_hash, payload_json, created_at)`，只在真料池非空时落库，快照在窗口开启/关窗批里预写，不在 GET 里写库。

**数据 / API**：迁移 **0081**（`0077` 是当前已提交的最新，`0078_venue_slots_p0.sql` 已被并行分支的场地档占号并在 `tests/d1.ts`（**工作区** `:162`；HEAD 只到 `:161` 的 `0077`，`0078` 与 `0078_venue_slots_p0.sql` 都还未提交）登记，再顺手用 0078 会撞号；若 0081 到落地时也被占，按当时的 `MIGRATION_FILES` 顺延取下一个未被占用的号），文件名必须加进 `tests/d1.ts` 的 `MIGRATION_FILES`；生产 apply 属危险动作，需单独授权。

**真假安全**：`rev`/`pool_hash` 整期共享，不下发；载荷仍不带真假字段。

**测试 / 验收**：同池两次生成逐字相等且 `rev` 不变；池变后 `rev + 1` 且 id 集不变。

**风险**：快照会让情报滞后于最新挂牌（这是目的）；繁忙窗口版本号可能涨到几十版，像 bug，需要时间窗合并，而时间窗是新的隐藏状态。

### 5.9 P0 无开窗期（赛季进行中）按日换血

**现状问题**：无开窗时整段无开窗期（赛季进行中）种子不变，内容冻结；冷窗回退还会让 8 条同构。

**设计做法**：无开窗期（赛季进行中）种子加日期分桶（`[season, 0, dayBucket]`），每日换一批。

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
| 卡头（无开窗） | 赛季情报 · {N} 条 · 涉及 {M} 家俱乐部。 | 与 `phase` 一致 |
| 冷窗追加 | 本窗市场冷清，暂无挂牌与出价。 | 只说公开池为空 |
| 加载 | 正在打听消息… | `role="status"` `aria-live="polite"` |
| 空 | 本窗还没有情报。 | 配 `/market/board` 链接 |
| 错误 | 情报没取到。 | 配「再打听一次」按钮 |
| 空态 CTA | 去可谈名单看看谁在等人出价 → | 指向 `/market/board` |

**禁止上屏的词**：系统、自动生成、算法、真真假假、可信度、已证实、辟谣、暂无可靠消息、下窗换血。

### 6.3 状态句的写法

九条模板（卖方五条 + 买方四条，自由身只走已报价），真假共用；有据行的变体由锚点决定，无据行由HMAC-SHA256 大整数 `mod n` 抽。买方行同时出现 `{club}`（买方）与 `{currentClub}`（现东家，自由身为「自由身」）。

| 族 / 变体 | 文案 |
| --- | --- |
| 可谈 | 「{club} 愿意听对 {player} 的报价，据一位经纪人称。」 |
| 在挂 / 挂牌中 | 「{club} 已经把 {player} 挂上了，据一位经纪人称。」 |
| 在挂 / 已谈拢 | 「{club} 与 {player} 已经谈拢，只等审核，据一位经纪人称。」 |
| 留队 / 已续约 | 「{club} 与 {player} 把续约敲定了，据一位经纪人称。」 |
| 留队 / 已匹配 | 「{club} 匹配了外部报价，把 {player} 留下，据一位经纪人称。」 |
| 出价 / 已出价 | 「{club} 已经向 {currentClub} 出价，想要 {player}，据一位经纪人称。」 |
| 出价 / 正在竞价 | 「{club} 正在和 {currentClub} 争 {player}，据一位经纪人称。」 |
| 出价 / 已报价 | 「{club} 已经向 {currentClub} 报价，目标是 {player}，据一位经纪人称。」 |
| 出价 / 自由身 | 「{club} 已经向自由身球员 {player} 报价，据一位经纪人称。」 |

归因措辞**只有一种**：「据一位经纪人称」，逐条一致，不按条、不按族、不按位变化。rev3 在这里写「统一为『据一位经纪人称』与『据接近俱乐部的人士称』两种」但模板里只有一种、盐位表也没有给归因分配 draw——那两句自相矛盾，而且把「归因」写成了一个并不存在的第二维度。现在只保留一种，并在 8.1 明确：归因与数字在本设计里是常量，因此不构成侧信道，也不进入 TC-RUMOR-12 的统计检验。

**可谈族只有一条变体**，不存在「未列入名单」之类的第二句——rev1 那句是泄漏点，已删。

### 6.4 空态、错误、加载

三态都必须给下一步，且不暗示真假。

- 加载：3 行占位，mono 线条，`role="status"`。
- 空：一句陈述 + 一个公开去向。
- 错误：一句陈述 + 手动重试；不自动重试（`web/src/lib/queries.ts:254-260` 已是 `retry: false`，保持）。
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

- **接缝**：`seededUnit` 从 `src/worker/venue-ops.ts`（`seededUnit` 定义，HEAD `:105` / 工作区 `:270`） 抽到 core，`venue-ops.ts` 改为 re-export。这是一个真接缝，按现有依赖面（`rumors`、`event-ops`、`naming-ops` 三个模块 import 它，`venue-ops` 自己也在用）判断有多处复用；`src/core/ad-board.ts` 用的是自己的 `mulberry32`（`:16`），不参与。
  模块图里 `cachedJson` 归 `src/lib/guard.ts`：定义在 `src/lib/guard.ts:207`，`src/lib/http.ts` 只有 `HttpError`，`src/worker/routes/market.ts:9` 也是从 `../lib/guard.ts` import 的。rev3 把它写成 `src/lib/http.ts`，实现者会去改错文件。
- **深模块**：`pickFact` 的接口是 4 个参数（pool / seed / slot / salt）与一个可空返回，藏在里面的是「确定性 + 最小位移 + tie-break」三条性质。测试可以直接断言性质，不必知道实现。
- **删除测试**：删掉 `rumor-select.ts`，`rumors.ts` 里要重新长出一段选事实的代码，说明它留得住。反之，族选择不做成模块，因为删掉后 `buildRumors` 里只剩一行 switch，长不回来。

### 7.3 盐位表（写进 `rumors.ts` 头注释）

| draw | 用途 | 是否影响公开字段 |
| --- | --- | --- |
| 0 | 位（有据/无据） | 否（只选主体） |
| 1/2/3 | **退役**（rev1 的模板洗牌已删除：每族变体固定，句序不再洗） | — 保留编号不是为了复用，而是为了明确「不要再分配出去」：一旦有新维度拿 1/2/3，旧注释会误导实现者以为句序还在洗 |
| 4 | 族选择（固定全集 `FULL` 长度 4 上的均匀抽） | 是（族可见），但与位无关；族池为空时该槽回退到 `firstNonEmpty(FULL)` 并**保留位**（5.0），回退同样不读位 |
| 5 | 有据事实（rendezvous 权重） | 是（主体），但与位无关 |
| 6 | 无据事实（rendezvous 权重，补集） | 是（主体），但与位无关 |
| 7 | 去重重抽 | 是（主体），但与位无关 |
| 8 | 保留 | — |
| 9 | 旧假料 id 采样（废弃，不可复用） | — |
| 10 | 无据侧变体选择 | 是（变体），与位无关；有据侧变体由锚点决定，不读盐位 |
| 11 | 买方假料匹配（`matchBuyerFake` 的候选次序/tie-break） | 是（买方队名），但与位无关；只改「选哪个买方」，不改族、位、条数 |
| 12 | 假料帧/候选构建的确定性哈希（与直算 fallback 共用） | 否（只决定帧内顺序，不直接下发；与位/族无关） |
| 13+ | 未来维度 | 必须进入可测面：能按条切分的进 TC-RUMOR-12，变体类进 TC-RUMOR-04 的集合相等，卡片级进人工语料回归 |

**rev2 修正**：rev1 让族选择（4）与事实索引（4）共用一个 draw，同时把索引迁移推到 P0-2（阶段二）。这不成立——P0-1 上线当天，族与索引会读同一个数，两维强相关。rev2 把「事实索引迁到 5」写进 P0-1 的验收条件，阶段一就要做完。

### 7.4 接口契约

```ts
type RumorItem = {
  id: string;             // r{season}-{windowSeq}-{slot}
  text: string;
  playerId: number;
  playerName: string;
  clubId: number;         // 卖方=现东家；买方=出价俱乐部
  clubName: string;
  clubRole: 'current' | 'buyer';
  currentClubId: number;  // 卖方=clubId；买方=球员现东家；自由身=0
  currentClubName: string; // 自由身固定为「自由身」
};

type RumorsResponse = {
  rumors: RumorItem[];
  phase: 'open' | 'closed';   // P1-3 新增
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
| TC-RUMOR-01 载荷结构与 id 序列 | `tests/market-intel.test.ts:370-386` | 保持（8 条、id 0..7），P0 九键（`clubId/clubRole/currentClubId/currentClubName`）、P1 加 `phase` 断言同 PR 更新；买方行 `clubId != currentClubId`。**新增一条**：夹具里把某名球员的 `display_name` 设成 `Erling Haaland`、`name` 设成 `E. Haaland`，断言载荷的 `playerName` 是前者——这是 5.1 硬约束 1 的守卫，缺了它 `AS playerName` 被删掉也不会红（P0-1 同批） |
| TC-RUMOR-02 同窗逐字相等 | `:388-394` | 保持，追加「重复 5 次逐字相同」 |
| TC-RUMOR-03 换窗换血 | `:396-410` | **重写（rev7）**：现有两条断言都绑在被删除的假料 id 点查上——`expect(idsOf(after)).toEqual(['r4-2-5','r4-2-6','r4-2-7'])`（注释写明「(4,2) 抽出的假料 id 不在库里 ⇒ 假料槽全丢」）与随后「换窗后每一行都是真料」的循环（`rel.has(playerId:clubName)` 全成立）。新设计里 id 恒为槽位（`src/worker/rumors.ts:199`）且假料改从补集 rendezvous 取现成球员，换到 (4,2) 仍是 8 条、仍含无据行，两条都会红。改成与 TC-08 同口径：**仍 8 条、id 恰为 `slots(4,2)` 的 `r4-2-0`..`r4-2-7`、正文至少 4 条（共 8 条）与 (4,1) 不同**；删掉「只剩真料」的循环，改按族对账有据行（有据行的 `playerId:clubId` 必须在该族锚点集合里）。rev6 只写「槽位期望按新抽取重算」，覆盖不到这条语义变化。 |
| TC-RUMOR-04 真假混排与模板不重复 | `:412-444` | 改写为族内真/无据对称 + 变体集合相等。**必须在固定 200 个窗口上聚合**：单窗 8 条上四族不一定都被抽中，某族的有据/无据也未必同时出现，无据侧更是未必覆盖该族全部变体——按单窗断言基线就会红。聚合口径：每族有据行 > 0 且无据行 > 0；无据侧出现的变体集合等于该族全集，且每个变体至少出现一次。单窗做不到这一点是夹具问题，不是实现问题。 |
| TC-RUMOR-05 守卫 | `:446-469` | 重写为新守卫矩阵，删除「假料不是甲队」断言。**段一**：删掉 `fakeIdPool(4,1,3) ∪ fakeIdPool(4,0,1)` 识别假料的写法与 `toHaveLength(3)`，改成**按族判定**——无据行 = 渲染族内、`playerId:clubId` 不在渲染族锚点集合（回退形态同样按渲染族断言）（`familyAnchors(fx, family)`）里的行；**不按 `clubId` 是否等于 `currentClubId` 判无据**（主体归属是侧信道），卖方/买方统一用该族锚点集合。有据行 = `(playerId, clubId)` 在该族锚点集合内。**段二**：删掉 `expect(after).toHaveLength(7)` 与 `not.toContain('r4-1-1')`——补一条 listing 后该球员不再以无据身份出现；若 complement 有替代则原 id 全在，否则允许掉槽并显式断言槽数；不要声称“转为有据”（grounded 由盐 0 固定）。rev9 复核指出旧句仍按 club 归属判无据，本行已同步 |
| TC-RUMOR-06 空池 | `:471-497` | 段一改为冷窗回退（8 条、族按 `slot % 2` 分可谈/出价、全无据、正文互不相同、id 仍 0..7）；段二改为「仅可谈非空」——落在可谈的槽**按位**出有据行（位真）或落在可谈补集（位假），落在在挂/留队/出价的槽走槽级回退到 `firstNonEmpty(FULL)`（今天即可谈族）、**位不变**，断言仍是 8 条且无占位符。rev4 这里写「落在可谈的槽出有据行」，把 50% 的位假行也要求成有据，按字面会判红一半合法行（rev5 修） |
| TC-RUMOR-07 不泄漏 | `:499-511` | 保持；P0 九键同 PR 更新（不得泄漏 `isTruth`/`variant`/内部 offers 标记） |
| TC-RUMOR-08 缓存命中 | `:513-529` | 测试意图保持，**断言必须改口径**：换窗后的旧期望 `['r4-2-5','r4-2-6','r4-2-7']` 来自被删除的假料 id 池机制（`src/worker/rumors.ts:40-44` 的 `FAKE_PLAYER_POOL`/`FAKE_ID_RANGE` 与 `:159-166` 的随机 id 点查），P0-1 之后必然变化；改成「换窗后仍为 8 条、id 恰为 `slots(4,2)` 的 `r4-2-0`..`r4-2-7`、正文与本窗至少一条不同、窗口键变化生效」。只写「id 前缀 `r4-2-`」不够：`every()` 对空数组真空通过，缓存换窗退化成 0 条也能绿（rev6 补）。D1 成本断言拆成 TC-RUMOR-22 |
| TC-RUMOR-09 限流 60/61 | `:531-544` | 保持 |
| TC-RUMOR-10 无开窗回退 | `:546-555` | 保持（P1-3 只加 `phase`，不改回退语义） |
- TC-RUMOR-10 补断言（review 12 H4）：无开窗但 `familyAnchors(FULL)` 非空 ⇒ 至少 1 条 grounded；只有四族全空才允许 `grounded=false` 全无据；补“无开窗有锚点”夹具（当前生产 seller N=46），不能假设无开窗=冷窗。

- 新增 TC-RUMOR-28 无开窗期（赛季进行中）按日换血：固定 `now = day1/day2`，同一天两次请求逐字相等，跨日不同；开窗期跨日不变；响应缓存键在冷窗含 `dayKey`，跨日 miss；帧缓存同理。

### 8.3 新增用例

| 编号 | 断言 |
| --- | --- |
| TC-RUMOR-11 | 假料主语合法性：所有行主体合法；卖方行 `club_id` 非空、所在俱乐部 active 且非 CPU；买方行 `clubId>0`（买方俱乐部 active 且非 CPU）、`currentClubId>=0`；`currentClubId=0` 时 `currentClubName='自由身'`，`currentClubId>0` 时该俱乐部必须 active/non-CPU；**不设 CA 硬门槛**（由 TC-27 统计平衡覆盖）；**不按 `clubId` 是否等于 `currentClubId` 判无据**（按族锚点集合判定，见 TC-05）；另加一条非自由身买方行（`currentClubId>0`）的显式断言，防止把“买方”误写成“自由身” |
| TC-RUMOR-12 | 判定 oracle 与 TC-05 相同：有据/无据都用 `familyAnchors(fx,family)` 的 `playerId:clubId` 集合（同窗口/同 LIMIT）。与位独立（只测能在单条上切分、且真的逐条变化的维度）：在 200 个固定窗口上，对**主张族**做有据/无据的 2×4 卡方检验，`p > 0.05`，且每格 lift（有据比例 ÷ 无据比例）落在 [0.67, 1.5]。**只有族这一个维度**：归因措辞在所有条上都是常量「据一位经纪人称」（6.3），是否含数字在所有条上都是常量「不含」（模板里没有任何数字），拿常量做卡方检验永远通过，是无效覆盖——rev3 把这两项留在用例里，等于给读者一个「测了三项」的假象。变体与句长同样不参与：有据侧变体由锚点子态决定（`listed`/`bidding` → 挂牌中，`matched_pending` → 已谈拢，5.1 表），这是设计规定的差异，要求「无显著差异」会让基线直接红。变体只断言「同族两侧变体集合相等」（TC-RUMOR-04）。卡片级指标（涉及俱乐部数）不能按条切分，不进入本用例。<br>**rev5 追加**：同一检验必须在**线上形态夹具**上再跑一遍（`transfer_listed` 有、在挂为空、留队 28 条，即 5.0 槽级回退被真实触发的形态）。默认夹具四族都非空，走不到回退分支；若回退写成「可谈 + 无据」，这组会立刻红（可谈有据率≈25% vs 留队 50%，lift≈0.5）。<br>**建表口径（rev5 回查补）**：卡方的列按**实际出现在载荷里的族**取，不写死三列——线上形态（在挂为空）下，落在在挂的槽全部回退到 `firstNonEmpty(FULL)`（即可谈），卡片上只可能出现可谈与留队两族，硬套 2×4 会得到一列计数恒为 0，卡方退化、永远通过。所以线上形态组用**观测族数**建表（夹具清掉 offers 时 2×2；保留生产形态的 5 条 offers 时 2×3，不能把出价族计数丢掉），并对每个出现的族分别断言「有据/无据两档都出现」且 lift ∈ [0.67, 1.5]；某族只剩一档即判红（说明回退把位洗掉了）。 |
| TC-RUMOR-13 | rendezvous 最小扰动：池 ≥20 条事实，加一条后正文变动 ≤2 条。**这是固定夹具 + 固定种子上的快照锁，不是不变量**（新增事实可能同时成为多个槽的最大权重，≥20 只降概率）；用例注释必须记夹具指纹，换夹具/换种子就要重算期望 |
| TC-RUMOR-14 | 同窗 `playerId` 唯一 |
| TC-RUMOR-15 | 每个 `clubId`/`currentClubId` 非空（自由身 `currentClubId=0`）；`clubRole ∈ current/buyer`，卖方 `clubId=currentClubId`、买方 `clubId != currentClubId`；前端卖方两个链接、买方非自由身三个链接、自由身买方两个链接（买方 · 球员档案），href 为 `/players?club_id=N` 且不含 `/clubs/`；`currentClubName='自由身'` 不渲染链接 |
| TC-RUMOR-16 | 留队族主体：`to == from` 时 `clubName` 取本队；`rc_change` 文本不含「转会」「报价」 |
| TC-RUMOR-17 | 开窗 `phase='open'`；无开窗 `phase='closed'` 且 id 仍为 `r{season}-0-{slot}` |
| TC-RUMOR-18 | 写路径 epoch bump 后重算，拆成两条（rev3 把两件互相打架的事写在一条里，只给了一个夹具）：<br>**18a 不改变族集合的写**（例如给已在挂的球员补一条成交、或改一条留队记录的 `from`）：原 id 是新的子集（允许去重丢槽），正文变动 ≤2 条——与 TC-13 一样是**固定夹具快照锁**，不是 rendezvous 的不变量（新增/改写的事实可能成为多个槽的最大权重，只有「不影响别的族」是结构性的）。<br>**18b 补空族**（把原本为空的那一族补到非空）：只有落在该族的槽变化，其余槽的族与正文逐字不变（5.0 固定全集，抽签不读「非空族数」，这个数字只是夹具动作的描述）。<br>两条各自有夹具与写入动作，不能共用一个 `advanceWindow`。 |
| TC-RUMOR-19 | 俱乐部上限（rev7 重写，修 rev6 的「各 ≤2 当硬上界」）：**分两段，口径不同**。<br>**段一（结构）：软上限只改选哪条，不改位的与条数**——同一夹具下 8 条仍在、id 仍 0..7、有据/无据的位分布不变（这就是 5.7 与 5.0 的兼容点，也是 V27 要钉的）。<br>**段二（快照锁，不是不变量）：在提供了足够替代的固定夹具上，单侧单俱乐部的条数 ≤ `MAX_SAME_CLUB_PER_CARD`**——夹具必须写清三件事：窗口与种子、每家俱乐部在池里的候选数、以及「除目标俱乐部外还有 ≥2 家俱乐部各 ≥3 条可替代事实」，否则挑不到替代时保留原选中项是合法行为，硬断言会在正确实现上晃。用例注释记夹具指纹，换夹具/换种子要重算期望（与 TC-13/18a 同一套口径）。<br>rev6 把「各 ≤2」写成无条件不变量、又用小池（4 家俱乐部、17 人）当夹具，是上一轮 #9 在 TC-13 上指出过的同一类错误，只是换了小节。 |
| TC-RUMOR-20 | 锚点窗口边界，两侧各一条：<br>**20a 卡柜**：造 60 条 listings、其中最早 10 条对应的球员不得成为在挂族有据行（它们不在公开页 50 条窗口内）。<br>**20b 成交表**：造 60 条 completed，其中 10 条较老的 `match`/`rc_change` 落在公开成交表最新 50 条之外——这 10 人不得成为留队族有据行，即使它们在 5.1 的留队池筛选条件下完全合格。20b 是 ADR-0008 的成交侧对照：公开端点不按 `type` 过滤，所以窗口必须先取、type 后筛（5.1 查询 3）。<br>**20c 广告板（可谈族，rev5 新增）**：造 201 条 `transfer_listed = 1`，用与 `/market/transfer-board` 同构的 `ORDER BY`（`CASE pm.tier …` → `transfer_listed_at` → `id`）算出前 200，断言排在第 201 位的球员不得成为可谈族有据行（它不在广告板窗口内）。这条同时锁住「查询 1 的 `LIMIT 200` 不能被实现漏掉」——rev4 只在正文写了这条边界，没有 SQL 也没有用例。 |
| TC-RUMOR-21 | 在挂池主体一致性：listing 的 `seller_club_id` 与球员 `club_id` 不一致时，该行不出现在载荷（负例夹具） |
| TC-RUMOR-22 | 缓存成本分三档：① **帧+响应都命中**：`loadFactPool` 与 `loadRumorFrame` 均不被调用（`vi.spyOn` 计数 0），只有窗口解析 1-2 次点查；② **帧命中、响应 miss**：`loadFactPool` 的 **9 条**事实查询各执行一次（1/2/3/5/6/7/8/9/10；query 4 是帧构建本身、query 11 的画像已在帧缓存 `buyerClubs` 里，不重跑），候选表 0 次；③ **帧 miss**：候选表读 1,280 + join ≈3.8k 行，之后 **9 条**事实查询各一次（1/2/3/5/6/7/8/9/10；再 +query 11；query 4 仍不计入事实查询）；不能把「11 条各执行一次」写成每次请求都发生。若 harness 无法 spy 内部函数，退化为「命中返回体与首次逐字相同 + 候选表查询计数 0」，并在用例注释写明近似口径。无候选表时直算 fallback 2×18.3k 只在失败/开发用例断言，不作为生产常态 |
| TC-RUMOR-23 | 买方锚点窗口：造 60 条 listings 与对应 active bids，最早 10 条 listing 对应的 bid 不在公开 50 条窗口内——这些 bid 不得成为出价族有据行；窗口内且 `bid.club_id != player.club_id` 的 bid 可以成为有据行 |
| TC-RUMOR-24 | 买方假料确定性：同一窗口重复生成逐字相等；买方假料的 `clubId != currentClubId`、俱乐部 active 且非 CPU、`(clubId,playerId)` 不在真实 bids/offers；`matchBuyerFake` 的评分不读位，换位不改变选中的买方（同一 pair 下） |
| TC-RUMOR-25 | 内部 offers（P0-0 后）：俱乐部 offer `status IN ('pending','intent')`；自由身只 `pending`（没有 intent）；`COALESCE(o.seller_club_id,0) = COALESCE(p.club_id,0)`、`o.buyer_club_id != COALESCE(p.club_id,0)` 时可出「已报价」有据行；公开页查不到时文案只说归因，不写「可在报价页查证」；不把 offers 行下发给前端；**P0-0 已定：只扩展写入 `pending`，不扩展 seller 接受链；自由身 `COALESCE(p.club_id,0)=0`、`seller_club_id=0` 成立；P0-0 与阶段一同批交付，不设隐藏开关；未实现则阶段一不验收** |

### 8.4 夹具改造（rev4 重写；rev8 补三族、rev9 补四族种子 helper）

- **分层帧进夹具（rev9，owner m01383）**：默认夹具覆盖 20 层（position × CA 带），每层至少 1 名候选；不设 `ca >= 80` 默认。TC-27 用低 CA 锚点（如 CA 65）验证非零概率，并用球员级置换/KS 检查平衡（卡方只作配额算术自检）；帧缓存测试用 `rumor-frame:*`。默认假料帧仍按 §5.1B 的 20 层抽样，夹具只需保证每层有候选，不再要求 64 名假料池球员 CA≥80。
- **统计验收专用大夹具（rev9 复核补）**：TC-27/TC-29 另建 `seedRumorFrameFixture`，20 层每层 ≥ 64 候选（club 56 + free 8；买方子帧每层 ≥ `m_s`）；默认夹具只做普通回归，不承担统计验收，避免默认每层 1 人导致全部 cap。

rev1 只写「在挂种子已有 2 条可复用」，这不够：默认夹具只有 2 名**锚点候选**球员（另有最多 **64** 名假料池球员 = `fakeIdPool(4,1,3)` 的 48 个 ∪ `fakeIdPool(4,0,1)` 的 16 个，去重后略少，全部挂在 `CLUB_A`；`tests/market-intel.test.ts:248-256` 每轮 16 个、`:281` 取并集、`:282-286` 逐个 `addPlayer(..., clubId: CLUB_A)`）、2 条 listing、0 条 `transfer_listed`、0 条留队（`:268-301`，`addPlayer` 在 `:132-153`），而 TC-RUMOR-01/02/10 都断言 8 条且 id 为 0..7（`:373`、`:553` 等）。同窗去重按 `playerId` 全局唯一，8 个槽最坏情况全落在同一族（族抽签逐槽独立，8 连中同一族的概率是 4·(1/4)^8 = 6.1e-5；TC-RUMOR-12 要在 200 个固定窗口上跑，撞到的概率约 1.2%），所以「每族唯一锚点数 ≥ 该族被抽中的槽数」才是 8 条不掉的条件。rev4 这里写「最多 16 名假料池球员」是错的（16 只是单轮池大小）。

rev2 原文「8 个槽里只要有 3 个以上落在同一族就会掉条」把门槛写错了：掉条的条件是该族唯一锚点数少于落在该族的槽数，与「3 个以上」无关。**下限取 ≥12 是为了同时覆盖跨族撞车**（同一球员既是可谈又在挂时只能出一条）。

**硬性下限**：默认 `seedRumors` 必须给每个族 ≥12 条唯一锚点。

| 族 | 需要的种子 | 数量 |
| --- | --- | --- |
| 可谈 | `transfer_listed = 1` 且有俱乐部的球员 | ≥12 |
| 在挂 | `listings` 三态、`seller_club_id = players.club_id` | ≥12（三态各 4） |
| 留队 | `match` 与 `rc_change`、`from = to = club` | ≥12（各 6） |
| 出价 | `bids` active、listing 在公开 50 条窗口、`bids.club_id != players.club_id`；P0 加 `offers` pending/intent | ≥12（bids；P0 offers 各 6，含 2 自由身） |
| 假料补集 | `club_id > 0`、非 CPU 队、无任何锚点；买方 pair 另做匹配 | ≥24（卖方）+ 买方 pair ≥12 |

- TC-RUMOR-06 段一需要新的夹具开关 `seedRumors({ anchors: false })`：同时清掉 **四类**锚点（`transfer_listed`、listings、留队 `match/rc_change`、买方 bids/offers），而不是现在的 `listings: false`（`:287-291` 只处理 listings）；`anchors:false` 后必须显式断言四类锚点计数全为 0。
- **新增 helper `seedTransferListed(fx, ids)`**（rev6）：写 `UPDATE players SET transfer_listed = 1, transfer_listed_at = '...'`，默认 `seedRumors` 用它给可谈族灌 ≥12 人——**它只覆盖可谈那一行，不覆盖在挂/留队**（rev7 修 rev6 的过度声明：rev6 在这里写「同时满足上表的硬性下限」，但一个 helper 不可能给三族都灌锚点；照那句实现，默认夹具在在挂=2、留队=0，TC-01/02/03/06/08/10 会先卡在下限上）。**`dealFallback` 选项整体删掉**：它写的是 `type: 'transfer'` 的成交（`tests/market-intel.test.ts:291-299`），而新设计删了成交族、留队锚点只认 `match`/`rc_change`、跨队 `transfer` 又被守卫排掉——留着它，TC-RUMOR-06 段二在 `{ listings: false, dealFallback: true }` 下会变成**冷窗**，而不是 8.2 写的「仅可谈非空」。
- **四族各自的种子 helper（rev8 新增三族，rev9 补出价）**：默认 `seedRumors` 必须同时落四组种子，缺一族就等于该族锚点为 0：
  - 可谈：`seedTransferListed(fx, ids12)` → `UPDATE players SET transfer_listed = 1, transfer_listed_at = ?`（≥12 人，跨 `CLUB_A` / `CLUB_B` 两家俱乐部；TC-19 需要「除目标俱乐部外还有 ≥2 家各 ≥3 条可替代」时，由该用例自己再补种子，不指望默认夹具满足，见 8.3）。
  - 在挂：`seedListed(fx, n = 12, states)` → 每 4 条 `listed` / `bidding` / `matched_pending`，`seller_club_id` 必须等于该球员的 `club_id`（5.1 查询 2 的锚点条件），`listed_at` 递增以保证窗口稳定；**这三条与现有默认夹具的 2 条 listing 是叠加不是替换**（`:288-291` 的 `STAR_A@甲队`、`STAR_B@乙队` 保留，正好当跨族撞车的负例）。
  - 留队：`seedTeamMoves(fx, n = 12)` → 6 条 `match` + 6 条 `rc_change`，全部 `from_club_id = to_club_id =` 该球员现东家（5.1 查询 3 的锚点条件）；**不能再借 `type: 'transfer'` 的成交来凑**（那是跨队记录，会被守卫排掉，见上条）。
  - 出价：`seedBids(fx, n = 12)` → **另建 12 条 listing（球员 37..48，`seller_club_id` 与球员 `club_id` 一致）和 12 条 `bids.status='active'`**，`bids.club_id` 取 `CLUB_C`/`CLUB_D` 等非现东家、active 的俱乐部；不复用 `seedListed` 的 13..24。**注意：这 12 条 bid-listing 必然也会被查询 2 选为「在挂」锚点（查询 2 与查询 9 用同一个 50 条窗口），所以在挂/出价两族按结构允许重叠**；不要再写「bid-listing 不计入在挂」或「两族锚点不相交」这种做不到的断言。P0 的 `seedOffers(fx, n = 12)` 同理写 `offers.status='pending'|'intent'`、`COALESCE(seller_club_id,0) = COALESCE(players.club_id,0)`；**P0-0 已定：自由身 offers 可写**（`seller_club_id=0`、`players.club_id IS NULL`）；P0-0 未实现前夹具只造有队 offers。**可谈/在挂(seedListed)/留队/出价四组球员 id 必须不相交**；出价球员 37..48 允许同时有 listing 和 bid，但不得同时是 `seedListed`/`transfer_listed`/留队锚点。`seedOffers` 必须写当前测试窗口的 `season/window_seq`（不能留 NULL）；另加一条 `season/window_seq IS NULL` 的自由身 offer 夹具，锁住**关窗期/未归窗**路径（查询 10 的 NULL 分支），不能只测非 NULL 分支。**review 12 M6 夹具细节**：`seedRumorFrameFixture` 用 30,000–31,279 共 1,280 个球员 id（每层 56 club + 8 free），显式 `ca/position/status/club_id`；id 与 `fakeIdPool`/`seedClubs`/`seedListed`/`seedBids` 不相交；seller 锚点至少 11 条、buyer 3 club + 1 free，保证 buyer cap 的 56/8/64 三档同时可断言。
  - 四组种子都带幂等守卫（同 id 重复插入直接跳过），并由 `seedRumors({ anchors: false })` 一并清空；写用例时若只要某一族非空，就单独调对应 helper，不要靠「关掉别的选项」。
  - **四组种子用互不重叠的球员 id 段**（可谈 `1..12`、在挂 `13..24`、留队 `25..36`、出价 `37..48`、假料补集 `1000+`），但**在挂/出价两族的锚点允许重叠**：出价必须挂 listing，`seedBids` 的 12 条 bid-listing 必然进查询 2 的在挂窗口，这是结构约束，不是夹具错误。因此断言只做「四段 id 不相交」+「bid-listing 存在且 active bid 指向合法买方」，不再断言「同一球员不能同时是在挂与出价锚点」；按 `playerId` 去重时让出价先占位，剩余在挂仍有 14 条（`seedListed` 12 + 原有 2），不影响可谈/留队的 12 条下限。
  - **默认夹具的预期形态**（实现时照此核对，避免 TC-01/02/03 等在夹具阶段就红）：可谈 ≥12、在挂 ≥26（`seedListed` 14 + bid-listing 12，其中 12 条与出价重叠）、留队 ≥12、出价 ≥12、假料补集 ≥24（卖方）+ 买方 pair ≥12。
  - **夹具基础设施补齐（review 6）**：`seedClubs` 增加 `CLUB_C`/`CLUB_D`（active、non-CPU），否则 `seedBids` 的买方不存在；`addPlayer` 的 1..48 显式分配 `position/ca` 覆盖 20 层（不能默认 ST/70 全落一层），`seedBids` 至少一条 listing 设 `status='bidding'`；`seedRumorFrameFixture` 每层 ≥64 候选（club 56 + free 8），默认夹具只做回归、不承担统计验收。
  - **买方画像夹具（review 7，H-1）**：`seedSeason` 只插 `seasons`/`season_windows`，`addPlayer` 只插 `players`，全文件没有 `registrations`；query 11 的 `first11`/`profile` 都 `FROM registrations`，所以 `frame.buyerClubs` 必为空，买方假料和 TC-12/24/26/27/29 的「买方 pair ≥12」根本构造不出来。新增 `seedRegistrations(fx, clubs, firstTeam = 11)`：写当前赛季、`registrations.squad='first_team'` 每队 11 人、显式给 `ca`（覆盖 5 个 CA 带，每队至少 2 带）；**用独立球员段 21000..21043（4 队×11=44 人），落在 `FAKE_ID_RANGE` 1..20000 之外，绝不与 1..48 四族锚点、64.. 假料池、200.. 现有段冲突**；必须断言 `21000..21043` 与 `fakeIdPool(4,1,3) ∪ fakeIdPool(4,0,1)` 交集为空；`registrations` 没有球员 FK，必须断言实际插入 44 行（缺球员会静默丢行）；`seedRumors` 与 `seedRumorFrameFixture` 默认调用；补断言 `frame.buyerClubs.length >= 4`、每队 `first11Ca` 非 NULL。没有 `registrations` 的用例不得声称测过买方匹配。
- **TC-RUMOR-06 两段的夹具必须分开写（rev7 修 rev6 的错）**：rev6 让段二用 `seedRumors({ listings: false })`，但按上表「硬性下限」，默认夹具**每族**都有 ≥12 条锚点，`listings: false` 只清单数（`:287-291`），留队池仍在——段二于是变成「可谈 + 留队」非空，落在留队的槽会走自己的族并出有据行，而 8.2 与 5.1 要求「族只能是可谈 / 有据行全部指向可谈名单」，按字面必红。正确写法：**段一** `seedRumors({ anchors: false })`（四类锚点全清，冷窗）；**段二** `seedRumors({ anchors: false })` 之后调 `seedTransferListed(fx, 12)`（可谈非空、在挂/留队/出价为空），再按位断言 8 条。等价写法是给 `seedRumors` 加 `transferListed: number` 参数，总之必须**只有可谈族非空**。
- 新增负例夹具：一条 `seller_club_id ≠ players.club_id` 的 listing（TC-RUMOR-21）；一名与该买方有已完成跨队成交的球员（买方守卫的「刚买过又买」负例）；一条 `bids.club_id = players.club_id` 的 bid（买方主体负例，不得进入买方锚点）。
- TC-RUMOR-02 只要求同窗稳定，可以继续用默认夹具；TC-RUMOR-09 只看状态码与限流文案，不关心条数；TC-RUMOR-08 仍可用默认夹具加窗口切换，但它的 id 期望要按新机制重写（见 8.2）。
- **helper 迁移（rev3 的改法仍然是错的，rev4 重写）**：`tests/market-intel.test.ts:317-343` 的 `realRelations(fx)` 现在只收 listings 三态与四类跨队成交，不收 `match`/`rc_change`；`:352-360` 的 `expectNoContradiction` 原文是 `if (rel.has(\`${r.playerId}:${r.clubName}\`)) continue; expect(currentClubName(fx, r.playerId)).not.toBe(r.clubName)`。
  - **要删掉的是这条断言本身**：旧设计里每条无据行的 `clubName` 都来自 `c.id = p.club_id`（5.1 假料池）；rev9 买方主体下买方假料的 `clubId` 是买方、`currentClubId` 才是现东家（§7.4），旧断言「无据行不得指向现效力队」既误伤买方正确实现、也仍是侧信道，故整条删除。rev3 写「对 `grounded=false` 的行执行原断言」，等于让正确的实现全军覆没。
  - 改法：新增 `familyAnchors(fx, family)`，按查询 1/2/3/9/10 的**同一窗口、同一 LIMIT、同一 club active 过滤**生成四族锚点集合（可谈 = `transfer_listed` 200 窗口；在挂 = listings 三态 50；留队 = `match`/`rc_change` 且 `from = to` 的 50；出价 = active bids + pending/intent offers 的窗口）。`expectNoContradiction` 换成按族两条断言：有据行 `playerId:clubId ∈ familyAnchors(fx,family)`；无据行 `playerId:clubId ∉ familyAnchors(fx,family)`；两族都按 pair 键，不按裸 `playerId`。`realRelations` 不再参与任何有据/无据判定；旧的「不得指向现队」断言已删。
  - **全局「撞组合」断言要一并删掉（rev5）**：`realRelations(fx)` 是**全族合并**的集合（listings 三态 + 四类跨队成交，迁移后还要加 `match`/`rc_change`），而 5.1 的守卫矩阵只按族排除——可谈无据只排 `transfer_listed = 1`、留队无据只排 `match`/`rc_change`。于是三类**合法**的无据行必然撞上全局集合：① `transfer_listed = 0` 但有 active listing 的球员落在可谈无据；② 有留队记录的球员落在可谈无据；③ 有 listing 的球员落在留队无据。它们的 `playerId:clubId` 都在 `realRelations` 里，保留这条断言就把正确实现判红（rev4 一边写「其余两族不约束」一边保留它，自相矛盾，12.8 #1 也重复了这一句）。
  - 所以只保留**按族**的成员关系断言；`realRelations` 不再使用，有据行的正向核对也直接用 `familyAnchors(fx, family)` 的 pair 集合。键仍用 `playerId:clubId`（或 `playerId:clubName`）而不是只有 `playerId`：同一球员对两个俱乐部可以分别是「有据」与「无据」的对象。
  - **受影响的既有用例逐条点名**（rev5 补「8.4 没列 helper 迁移」；rev7 补 TC-03/TC-08）：TC-RUMOR-03（换窗后期望重写，见 8.2）、TC-RUMOR-04（族内对称 + 变体集合相等，需要 `familyAnchors` 的按族过滤版）、TC-RUMOR-05（守卫改按族，删除「假料不是甲队」断言）、TC-RUMOR-06（空池两段夹具分开，见上）、TC-RUMOR-08（id 期望从假料点查改成正序槽位）。这条迁移与 P0-1 同批；不做的话 TC-03/04/05/08 必然判红，TC-RUMOR-06 段二会误杀一半合法行。

### 8.5 变异清单（新增）

| 变异 | 期望 |
| --- | --- |
| V16 删除可谈族补集过滤 | TC-RUMOR-05 红 |
| V17 族选择复用盐位 0 | TC-RUMOR-12 红 |
| V18 假料池去掉 `club_id` 过滤 | TC-RUMOR-11 红 |
| V19 rendezvous 换回取模 | TC-RUMOR-13 红 |
| V20 无据侧改用专用模板集合（或恢复「未列入名单」变体） | TC-RUMOR-04 红（变体集合相等断言）。TC-RUMOR-12 抓不到它：变体维度的分布差异是设计规定的（有据侧由锚点子态决定），不进入那个检验 |
| V21 在挂池去掉 `p.club_id = l.seller_club_id` | TC-RUMOR-21 红 |
| V22 删掉降权逻辑（`pickFact` 不读 `MAX_SAME_CLUB_PER_CARD`；等价变异是把 `M` 改成 `99`） | TC-RUMOR-19 段二红（提供了足够替代的夹具上出现单侧 ≥3 家同俱乐部）。注意：**只有公式读 `M` 时这条才成立**，rev6 的 `weight × 1/(1+count)` 不读常量，改 `M` 行为不变、V22 永远绿（rev7 已把常量接进公式，见 5.7） |
| V23 锚点不按 50 条窗口截断 | TC-RUMOR-20 红 |
| V24 可谈锚点不按广告板前 200 截断（查询 1 漏 `LIMIT 200`） | TC-RUMOR-20c 红 |
| V25 槽级回退写成 `family = 可谈; grounded = false`（rev4 前半稿的写法） | TC-RUMOR-12 的线上形态组红（族×位相关）；默认夹具组不红——这正是必须加那组夹具的原因 |
| V26 恢复全局「撞组合」断言（`realRelations` 套到无据行） | TC-RUMOR-05 红（三类合法无据行被误杀） |
| V27 俱乐部上限改回「有据槽降级为无据」（rev5 的写法） | TC-RUMOR-12 的线上形态组红（有据侧被压成 ≤2/家，族×位相关）+ TC-RUMOR-19 红（8 条掉条）；这条钉住「上限只改选哪条、不改有没有锚点」 |
| V28 冷窗不把 `family` 落回可谈（保留 `firstNonEmpty(FULL)` 的 `undefined`） | TC-RUMOR-06 段一红（`complement(undefined)` 抛错或出空池）；P0-1 阶段直接崩，不需要别的夹具 |

V20 的期望在 rev1 里挂错了对象：TC-RUMOR-04 原来只断言 id、互不相同、占位符填满，不锁模板集合，所以那个变异不会红。rev2 把「变体集合相等」写进 TC-RUMOR-04，这条是对的、也是唯一有效的一条；同一版又把「变体 ID」写进 TC-RUMOR-12，那是错的——有据侧变体由锚点子态决定，分布差异是设计要求，基线自己就会红。rev3 删掉 TC-RUMOR-12 的变体维度，V20 只指 TC-RUMOR-04。rev5 新增 V24/V25/V26，分别钉住可谈窗口、回退保位、按族断言这三处；rev6 新增 V27/V28，钉住俱乐部上限「不改位」与冷窗「族落回可谈」两处本轮新修的机制。

### 8.6 D1 预算（当前线上档 / 上界档）

**查询条数与索引归属**（P0 11 条：1-11；**5-8 是卖方集合锚点，N=46 依赖，不能下放 P1**；P1 只加 club 过滤/翻页锚点窗口，不减少 P0 查询；每次缓存未命中）：

| # | 查询 | 走哪个索引 |
| --- | --- | --- |
| 1 | 可谈池（`transfer_listed = 1`，窗口 `LIMIT 200`） | `idx_players_transfer_listed`（`0064_ad_board.sql:16`，部分索引 `WHERE transfer_listed = 1`）能定位候选，但**不满足** 5.1 查询 1 的 `ORDER BY`（`CASE pm.tier …` → `transfer_listed_at` → `id`），需对候选集在内存排序（当前 18 行，CA≥80 16 仅作数据、不是过滤条件；上界 200 行，可接受）；按 id 排序的行数在候选集内，不需要全表扫 |
| 2 | 在挂池（窗口子查询 `ORDER BY l.id DESC LIMIT 50`） | 窗口子查询按 `status IN (...)` 三值 + 主键倒序，`idx_listings_status_listed`（`0001_init.sql:253`，`status, listed_at DESC`）只能覆盖 status 过滤、不覆盖 `id` 序；实现时以 `EXPLAIN QUERY PLAN` 为准。外层的 `p.club_id = w.seller_club_id` 走 `idx_players_club`（`:263`） |
| 3 | 留队池（窗口子查询 `ORDER BY t.completed_at DESC, t.id DESC LIMIT 50`） | `idx_transfers_status_time`（`0058_transfers_status_time.sql:7`，`status, completed_at DESC, id DESC`）正好匹配窗口子查询 |
| 4 | 假料候选帧（20 层，`M=256`；§5.1B） | 20 支 `UNION ALL`，每支 `position IN (...)` + `ca` 范围走 `idx_players_position_ca`（P0-0 `0079`）；`ORDER BY hash` 不能索引排序，一次帧构建 miss 仍读该区间全部候选 ≈18.3k 行，不是 256；帧缓存开窗 1h、冷窗 24h，不随每次市场写 purge；开窗 ≤24 次/日；没有索引时退化为全池 `ROW_NUMBER()` |
| 5-8 | 四个集合（可谈/在挂/留队/跨队） | 可谈集合与查询 1 同一窗口（`LIMIT 200`）、走 `idx_players_transfer_listed`；在挂集合走 status 索引（`0001_init.sql:253`）而不是 `idx_listings_player`（`:266` 只覆盖 `player_id`，不覆盖 `status` 过滤）；留队/跨队集合走 `idx_transfers_status_time`（`0058`：`status, completed_at DESC, id DESC`）或 `idx_transfers_player`（`:270`）——**这些是候选，不是结论**，最终以 `EXPLAIN QUERY PLAN` 为准 |
| 9 | 买方 bids（公开窗口 + `bids.status='active'`） | 窗口子查询同查询 2；`bids` 侧按 `listing_id` 走现有索引（`0001_init.sql:90-98` 只给表结构，索引以 `EXPLAIN` 为准）；外层 `b.club_id != p.club_id` 是过滤，不负责定位 |
| 10 | offers（P0，内部；`status IN ('pending','intent')`） | 按 `offers.status`/`player_id` 的现有索引候选，最终以 `EXPLAIN` 为准；P0 执行，但结果不下发 |
| 11 | 买方俱乐部画像（clubs + registrations + players 聚合；≤20 行；随帧缓存） | `registrations` 按 `(club_id, season)`、`players` 按主键；不引入新索引；只在帧 miss 时读 |

rev9 查询 9/10/11 都属 P0，已计入下表；帧构建 miss ≈18.3k（不是 256），预算按此重算。上界 = 公开 50 条 listing 窗口内的 active bids（≤ 窗口内 bids 总数）+ offers 的 pending/intent + 买方俱乐部画像（≤20 行/帧，缓存），不按 `bids`/`offers` 全表计。

rev1 把这些查询统一写成 `idx_listings_player` / `idx_transfers_player`，rev2 改了一半，rev3 又把 `idx_players_club_ca` 写成「可省排序」——那一句是错的，已按上表更正。索引归属一律标成候选，不当作结论。

**数字**（分两档，上界档按表规模推导，不再用「当前行数 + LIMIT 上限」混加）：

| 档位 | 可谈 | 在挂 | 留队 | 假料池 | 四个集合 | 单次未命中读量 |
| --- | --- | --- | --- | --- | --- | --- |
| 当前线上（2026-10 实测：`transfer_listed = 1` 18 人、CA≥80 16；`listings` 空；`offers` pending/intent 5、CA≥80 4；`bids` active 0；`match`/`rc_change` 28 条） | 18 | 0 | 28 | 帧构建 18.3k | ≤45 | ≈ 18.7k 行 |
| 上界档（可谈/在挂/留队按窗口，假料帧 `M=256`） | ≤ 200（窗口） | ≤ 50（窗口） | ≤ 50（窗口） | 帧构建 ≈18.3k | 集合 5 ≤ 200、集合 6/7 ≤ 50、集合 8 改 EXISTS 半连接（索引读，不整表带出） | ≈ 19.3k |

- 上界档的口径：查询 1/2/3 都是**公开端点的同一窗口**（5.1），上界分别是 200/50/50；查询 4 改为 §5.1B 的分层帧（`M=256`，20 层），不再有 `CA_FLOOR`、543 或 18,301 的硬切档。帧查询 20 支各走 `idx_players_position_ca`（P0-0 `0079`），但 `ORDER BY hash` 不能索引排序，帧构建 miss ≈18.3k；缓存后 ≤48 次/日。没有索引时退化为一次全池扫描，只在帧缓存 miss 时发生。rev3 的「全量规模 = 570 / ≤200」把当前实测值当成了上界；rev4 又把可谈族写成「≤ 18,301」，两者都错过——rev5 给查询 1 落了 `LIMIT 200`；rev9 改成统计分层帧。
- **直算 fallback** 的帧构建 miss 读 ≈18.3k：开窗按每 colo 每活动窗口 24 次/日、两个窗口共 48 次/colo，2 colo 合计 96 次；候选表常态只读 3.8k/次，96×3.8k≈0.37M。响应查询 W×380 ≈0.76M（W=2000；这是**单 colo、全 miss** 的上界；若保留 `cachedJson` 全局 epoch，2 colo 各 miss 一次 =1.52M，叠加峰值 4.03M，破 4M；P0 已改 `cachedRumorResponse()` 1h TTL、不按 buildId purge，实际约 0.02M，0.76M 只作保守上界）。直算 fallback 每次 2 子帧 × 20 支 = 2×18.3k；96 次 = 3.51M + 响应 0.02M + 画像 0.10M ≈3.63M/天（2 colo），叠加峰值 2.03M ≈5.66M，单独就破 5M。候选表常态 96×3.8k≈0.37M + 响应 0.02M + query 11 画像≈0.10M + 构建/重试 0.073M ≈0.56M/天（含构建/ensure 余量），叠加峰值约 2.59M。**fallback 只能应急，不能作为容量档；容量门必须保证候选表 ready**。5M/天是账户级共享额度，近 10 天账户总读 0.36–2.03M/天；候选表叠加峰值约 2.59M（52%），直算叠加约 5.66M（126%）——**直算路径不允许生产常开**；**开窗前容量门见 §8.6 / §11 #8**。帧 `M=256`（20 层，按真料锚点做 Dirichlet 平滑），缓存键 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`、开窗 TTL 1h、冷窗 24h、不随每次市场写 purge（新锚点由 当窗锚点集合守卫排除）；P0 读量主要由窗口查询、帧 miss 与集合 8 的 EXISTS 索引读决定。阶段一开工前的降增量路径见 §8.6 容量门（日预计算候选表或 4h TTL + W 去抖）；减 `M`、加大 `α`、合并 CA 带都会改变统计平衡，不作为容量门手段，若采用必须重跑 TC-27 的球员级置换/KS 与低 CA 覆盖（卡方只作配额自检）。
- rev2 原文的 `570 + 50 + 50 + ≤200 ≈ 900` 一边用 LIMIT 上限（50/50/200）一边用当前行数（17/28），两档都不是，所以删掉重列。
- 每次命中读量 = 1-2 次 `season_windows` 点查 ≈ 2 行。
- 日读量：口径 B（P0，响应 1h 缓存、不随写 purge）≈ `F × 3.8k + H × 2`，`W` 不进 D1 公式；口径 A（`cachedJson` 全局 epoch）≈ `W_A × R + F × 3.8k + H × 2`，`W_A` = 触发响应 purge 的写请求数；直算 fallback 把 `3.8k` 换成 `2 × 18.3k`。`R` = 响应查询单次未命中读量（当前档 ≈380，上界档 ≈0.9 千；集合 8 改 EXISTS 半连接，不再加 `transfers` 行数），`F` = 帧重建次数 × **实测 colo 数**（≤24 × 活动窗口数 × colo；APAC/KIX 2 colo，通常 ≤96），`H` = 当日命中数。**容量门按口径 B 的 `F × 3.8k` 算，不把 W 算进去；W 去抖只属于口径 A。**
- 算例（`W = 2,000`，候选表 `F = 48×2 colo = 96`）：响应查询缓存后 0.02M + 帧 96×3.8k≈0.37M + 画像 0.10M + 构建/重试 0.073M ≈0.56M 行/天（0.76M 是缓存全 miss 的保守上界）；直算 fallback 是 2×18.3k/次 ×96 = 3.51M + 0.02M + 0.10M ≈3.63M/天，叠加峰值 5.66M，直接破 5M；容量门不允许生产常态 fallback。若帧随每次市场写 purge，才会回到 36M 档；本设计已改为不随写 purge，新锚点由当窗锚点集合（`familyAnchors`）守卫在选槽时排除，统计目标最多滞后 1h。D1 读行额度按 Free 最严档 5M/天核对；见 §11 第 8 问。

**预算两种口径（review 8 修正）**：
- **口径 A（保留 `cachedJson` 全局 epoch、每次市场写刷新响应）**：响应 2 colo × W×380 = 1.52M/天；候选表 0.365M + 1.52M + query 11 0.10M + 构建/重试 0.073M ≈2.06M/天，**已破 1.3M 增量门**；4h TTL 0.88M + 1.52M + 0.10M + 0.055M ≈2.56M/天，同样破门。**口径 A 不可签阶段一。**
- **口径 B（P0 采用：响应缓存 `cachedRumorResponse()` 1h TTL、不按 buildId purge，不掺全局 epoch）**：响应 ≈0.02M/天；候选表 0.365M + 0.02M + 0.10M + 0.073M ≈**0.56M/天**；4h TTL 0.88M + 0.02M + 0.10M + 0.055M ≈**1.05M/天**；直算 fallback 3.51M + 0.02M + 0.10M ≈**3.63M/天**（叠加峰值 5.66M，仍不可常开）。容量门按口径 B：候选 0.6M、4h 1.1M；两者都低于 1.3M，但候选表优先，4h 只作候选表不可用时的降级。

**开窗前容量门（P0，不是上线后监控）**：5M/天是账户级硬上限，不是本功能预算；直算 fallback 3.63M 增量叠加峰值日 2.03M ≈5.66M，候选表 0.56M 叠加约 2.59M；开窗期账户其他流量再涨，直算路径会先顶到 4M 以上。因此**不允许把“上线后监控 >4M 再降档”当作容量方案**，阶段一开工前必须先过容量门：

1. 用开窗期流量模型（W、帧重建次数 F、账户其他库日读）做一次容量验收；门槛是**账户总读 ≤4M/天（80%）**，预留 1M 给开窗期增长；5M 是绝对上限，不是目标。
2. 直算 fallback 3.63M 单独不破 4M，但叠加峰值 5.66M 破 5M；候选表 0.56M 在账户其他 ≥3.44M 时破 4M；阶段一**默认按 §5.1C 日预计算候选表（迁移 0080，TC-29）实现**；4h TTL + W 去抖只作为候选表不可用时的降级，不改变阶段一验收，若走降级必须另立用例并重跑 TC-27。
   - **日预计算候选表（推荐，见 §5.1C）**：`rumor_candidates` 每层 56 有队 + 8 自由身 = 64 行 × 20 层 = 1,280 行；`ensureRumorCandidates` 在 5 分钟 tick 里按 `(season, window_seq, day_key)` 每键构建一次（一次读 ≈18.3k）；帧 miss 读 1,280 候选 + join ≈3.8k；本功能增量 ≈0.56M/天（含 join），低于 1.3M 门。
   - **帧 TTL 4h + W 去抖/上限**：每次是 2 子帧×18.3k=36.6k（6×2×36.6k≈0.44M/colo、2 colo≈0.88M）；口径 A（全局 epoch）≈2.56M/天，**破 1.3M 门**；口径 B（`cachedRumorResponse()` 1h、不按 buildId purge）≈1.05M/天，可作为候选表不可用时的降级，但不能替代候选表。
3. 响应查询缓存全 miss 的保守上界 0.76M（W=2000×380；实际缓存后 0.02M）不是第二大项，第二大项是候选/帧增量；口径 A 下开窗期 W 若超过 2,000 才需去抖/上限；口径 B（P0）响应缓存不随写 purge，W 不进 D1 公式，不需要 W 去抖。
4. 容量门通过才进入阶段一实现；上线后 GraphQL 监控只作告警，不作为降档依据。若开窗前实测账户总读已 >4M，先减 W/加 TTL/改候选表，仍不达标则不发。容量门还必须演练三条：运营手动预构建（开窗前触发 ensure）、开窗首请求命中 ready 或 503（不直算）、构建连续 3 次失败后回到旧 ready/503 而不是直算。

### 8.7 验收标准

- P0 用例全过；P1 用例通过率 ≥90%（qa-test-planner 的通过标准）。
- `npm test` 与 `npm run typecheck` 全绿（`AGENTS.md:46`）。
- **窗口覆盖改在夹具里做**：固定 4 个窗口（例如 `(4,1)`、`(4,2)`、`(5,0)`、`(9,1)`）跑同一套断言，**但只覆盖结构类与换窗类用例**（TC-01/02/03/06/07/08/10/17/18）。**统计类用例的口径仍是 200 个固定窗口**（TC-RUMOR-04 的族内对称与变体覆盖、TC-RUMOR-12 的卡方与 lift），4 个窗口在那两条上样本量根本不够，两者是不同层级、不能互相替代（rev7 补这句：rev5 只说「覆盖改在夹具里做」，读者会以为统计类也只跑 4 个）。rev1 写的「线上抽查 4 个不同窗口」在无开窗的生产环境不存在——`resolveRumorWindow` 对所有请求都返回 `(visibleSeason, 0)`（`src/worker/rumors.ts:22-27`），四个窗口只有拿到临时开窗授权才可能。
- 线上只验两件可执行的事：① 同一窗口多次请求逐字相同；② 抽出的有据行，点进球员页或对应公开页能在**该公开端点自己的窗口**内找到对应记录——可谈族对 `/market/board`（前 200，`ORDER BY CASE pm.tier …`）、在挂族对 `/market` 卡柜（三态、`ORDER BY l.id DESC`，50 条）、留队族对 `/market/deals`（**不按 type 过滤**，50 条）、出价族对 `/market/listings/:id` 的 bids 区（公开 bid）。「在自己的窗口内」是 ADR-0008 的实现口径（窗口先取、后筛），不是「在通过主体/type 过滤后的 50 条里」。内部 offers 不承诺公开可查，线上只验「文案不写可查」，不验公开页存在。
- 语料回归（人工）：导出 30 个窗口 240 条文案，逐条判「状态主张是否有锚点」「意图主张是否归因」「有没有把违约金说成转会费」。

---

## 9. 分阶段落地

| 阶段 | 内容 | 独立验收 |
| --- | --- | --- |
| 一 | P0-1 主张-锚点重构（四族，含事实索引迁到盐位 5）+ 买方 bids + 内部 offers（P0，含自由身）+ 匹配 + P0-3 九键载荷与双/三链接 + P0-4 缓存键 v3 + 无开窗期（赛季进行中）按日换血（`dayKey`） + `MarketIntelPage.test.tsx`（新建） + 8.4 helper 迁移（`realRelations`/`expectNoContradiction`） | **阶段一全集**：TC-RUMOR-01/02/03/04/05/06/07/08/09/10/11/12/15/16/20/21/22/23/24/25/26/28/29/30 绿（08 按 8.2 新口径，20 含 20a/20b/20c，12 含线上形态组与 2×4）；TC-27 统计绿；三态 jsdom 绿；线上验收两条可执行项通过；**原 P1-1 clubId 已并入本阶段** |
| 二 | P0-2 rendezvous + 去重 + core 抽取 | TC-RUMOR-13/14/18 绿；02/03 不回归 |
| 三 | P1-3 窗口 phase 与冷窗文案（缓存键 v4） | TC-RUMOR-17 绿；10 不回归 |
| 四 | P1-4 俱乐部上限（主体分布降权，不改位） | TC-RUMOR-19 绿；TC-RUMOR-12（含线上形态组）不回归 |
| 五 | P2 三项择一 | 各自单独评审 |

阶段一与阶段二可以并行开发，上线顺序固定。阶段一必须自带「索引迁到 5」，因为族选择当天就要占住盐位 4；九键载荷与买方族也在阶段一，不能把 `clubId` 再拖到 P1。offers 是 P0（自由身真料依赖它），阶段一查内部表；不公开。

**阶段一内容必须包含 P0-0 点位清单**：offers 写入/生命周期（§5.1A）、读侧 `routes/offers.ts:73/:172-178` 的 LEFT JOIN、通知文案、自由身页「仅意向报价」入口、`enterIntent` 回填；不能只写「内部 offers（P0，含自由身）」一行。

**阶段一开工前置**：§8.6 开窗前容量门必须先通过（账户总读 ≤4M/天，且帧构建走候选表：1,280 候选 + join ≈3.8k/次，见 §5.1C；或 4h TTL + W 去抖）；容量门报告作为阶段一的开工附件，不通过不进入实现。上线后监控只告警，不能替代这道门。

---

## 10. 不做什么

- 不做逐条发稿时间、电头时间、关窗倒计时、「本窗第 N 天」。
- 不做逐条信源角色字段，不设虚构记者、编辑部署名，不写「截稿前未获俱乐部回应」。
- 不设头条、导语分级、热度、可信度徽标、已证实标记、辟谣状态。
- 不做合同年/续约停滞真料族——`contracts` 没有到期或年限列（`0001_init.sql:53-65`）。
- 不做 edition 快照迁移（本轮），不公开 `rev`/`pool_hash`。
- 不拆 `market` 限流桶，不改 60 次/60 秒口径。
- 不做公开的 offers 投影/可查页（P0 的 offers 只作内部锚点；自由身真料不可公开核对）；不做把 `clubRole` 变成筛选器、徽标或独立二级页。
- 不做公开俱乐部摘要页，`/clubs/:id` 维持登录可见。
- 不改成交表 7 列结构、不动 MarketNav、不改表格 sticky 口径。
- 不引入实时依赖（推送、外部 feed、WebSocket、定时刷新）。
- 不按池大小调条数。
- 不给 `/market/transfer-board` 加 club 参数（会按俱乐部数放大缓存键）。

---

## 11. 需要用户拍板

1. ~~接受「统一现东家视角」、放弃「某队想买 X」的买方传闻吗？~~ **已定（owner m00744）**：接受买方侧主体（ADR-0009）；ADR-0003 标 Superseded。这里不再需要拍板。
2. **已定（owner）**：保留 `players.transfer_listed` 作为可谈族真料锚点（当前 18 人、CA≥80 16 人仅作数据；不设 CA 门槛，只来自 4 家俱乐部）。
3. **已定（owner）**：`match`（匹配留队）与 `rc_change`（续约）保留在 P0 留队族，按本设计进 `FULL`、查询 3、模板与夹具；原「若答案是否」的降级分支不再需要。
4. **已定（owner m01521）**：P0 队名先链 `/players?club_id=N` 名单页；P1 新建公开俱乐部摘要页（简介、近期转会、传闻，**以及主场/球场相关信息**），队名改链摘要页。
5. **已定（owner m01521）**：P1 预留 edition 快照（迁移 0081；`0078` 已被 `0078_venue_slots_p0.sql` 占号）；P0 不做，载荷保留 edition 扩展位。
6. **已定（owner m01521）**：P0 按日换血；无开窗期（赛季进行中）种子加日期分桶，同一天内稳定、跨日换血；冷窗不再整段同构。
7. **已定（owner m01564）**：目标版本 **v6.54.0**；测试计划 `docs/test-plans/v6.54.0-rumor-claim-anchor.md`（**已创建，2026-10-21；仅计划，未实现未运行**）。
8. **已定（owner m01564；2026-10-21 复核账户级额度）**：生产 `whl-club` 24h `rows_read=371,144`、`read_queries=13,468`、库 34.2 MB。**5M 行/天是账户级 Free 上限，不是本功能独占**：近 10 天账户总读（`whl-club` + `whl` + `whl-auth` + `whl-guess`）为 **0.36M–2.03M/天（7.2%–40.5%）**，峰值 2026-10-12 为 2.03M。本功能增量候选表 0.56M/天、4h TTL ≈1.05M/天（低于 1.3M 门，可作降级）；直算 fallback 2×18.3k×96 + 响应 0.02M + 画像 0.10M≈3.63M/天，叠加峰值 5.66M，直接破 5M，**不能作为容量档**；候选表叠加峰值约 2.59M（52%），余量约 1.8M。**不把“上线后监控”当容量方案**：开窗前必须用开窗期流量模型做容量门（见 8.6），账户总读目标 ≤4M/天（80%），预留 1M 给开窗期增长；当前候选表 0.56M 在峰值日 2.59M，若退到直算 3.63M 则 5.66M，故阶段一必须先把帧构建降到候选表 1,280 候选 + join ≈3.8k/次（见 §5.1C；候选表后增量≈0.56M/天）。4h TTL 低于 1.3M 门，但只作候选表不可用时的降级，不能替代候选表。上线后监控只作告警，不作为降档依据。
9. **已定（owner m01521）**：P1 再做 `/api/market/listings` 与 `/api/market/deals` 的俱乐部过滤 + 翻页锚点窗口；P0 维持现有 50 条窗口，不改公开分页语义。
10. **已核实（2026-10-21，生产 `whl-club`）**：`SELECT status, COUNT(*) FROM clubs GROUP BY status` 只有 `active`，20 家（`served_by=v3-prod`，APAC/KIX，`changed_db=false`）。守卫按 `status='active'` 写死；若后续出现其它状态，再补白名单。
11. **已定（owner）**：`offers` 保持不能公开查，不新增公开投影；报价族只写归因，不承诺可查。
12. **已定（owner）**：自由身纳入 P0 买方族；`currentClubId=0`、`currentClubName='自由身'`；真料只来自内部 `offers`，玩家不可公开核对（已知代价）。
13. **已定（owner）**：已完成跨队转会不做回顾式买方族；成交仍只由成交表承担。
14. **已定（owner）**：`正在竞价` 用 `listing.status='bidding'`，不用「≥2 条 active bids」。
15. **自由身真料前置（P0-0，已定：扩展 offers 写入 pending）**：现有 `offers` 写入/接受路径拒绝自由身（`offers.ts:153` 对 `club_id` 空/`status='free'` 直接 400；`seller_club_id` NOT NULL；接受路径要求 `player.club_id = seller_club_id`）。owner 2026-10-21 已选扩展 offers：阶段一先允许 `seller_club_id=0` + `players.status='free'` 的 offer **写入 `pending`**（自由身没有 intent）；**不扩展 seller 接受链**，签约走既有 free-agent bypass；到期/撤回沿用 offers；`amount` 只作意向金额。不再保留「自由身只作假」的侧信道，也不删除自由身 P0。

---

## 12. 附录

### 12.1 本次诊断读过的文件

`src/worker/rumors.ts`、`src/worker/routes/market.ts`、`src/worker/routes/players.ts`、`src/worker/routes/clubs.ts`、`src/worker/index.ts`、`src/worker/venue-ops.ts`、`src/lib/guard.ts`、`src/lib/cache-policy.ts`、`src/core/ad-board.ts`、`src/worker/player-ref.ts`、`web/src/pages/market/MarketIntelPage.tsx`、`web/src/pages/market/MarketAdBoardPage.tsx`、`web/src/App.tsx`、`web/src/lib/api.ts`、`web/src/lib/queries.ts`、`web/src/lib/player-link.ts`、`web/src/lib/players-library.ts`、`web/src/styles.css`、`vitest.config.ts`、`src/db/migrations/0001_init.sql`、`0006_activation_negotiation.sql`、`0026_clubs_is_cpu.sql`、`0030_players_club_ca_index.sql`、`0037_offers.sql`、`0058_transfers_status_time.sql`、`0064_ad_board.sql`、`tests/market-intel.test.ts`、`docs/test-plans/v6.18.0-market-ia.md`、`UI_DESIGN.md`、`AGENTS.md`。

### 12.2 跑过什么

- 只读 grep / sed 若干次：`seededUnit` 位置与 import（`venue-ops.ts:105`、`:9-14`，**行号按 HEAD**；工作区已被并行场地档会话改动到 `:270`）、`shuffleWithSeed` 与 `mulberry32`（`ad-board.ts:28`、`:16`）、`clubs.ts` 的 `requireUser`（`312`/`313`/`581`）、`App.tsx` 路由行号（`105`/`108`/`109`/`110-117`/`118`/`119`/`137`）、`players.ts` 的 `transferListed`（`:785`、`:1219`）、`market.ts` 的两个公开窗口（`:126`、`:363`）、`useRumors` 的 queryFn（`queries.ts:254-260`，HEAD）、`RumorItem`/`RumorsResponse`（`api.ts:965-971`、`:973-974`）、`vitest.config.ts:12-17` 的 include、`web/src/pages/market/*.test.tsx` 的存在、`tests/market-intel.test.ts` 的 `seedClubs`/`addPlayer`/`seedRumors`（`:77-85`、`:132-153`、`:268-301`）与 8 条断言位置（`:373`、`:553`）、索引定义（`0001_init.sql:253/263/266/270`、`0026:3`、`0030:15`、`0058:7`、`0064:16`）、`players.status` 取值（`0001_init.sql:17`）。
- `npx vitest run tests/market-intel.test.ts` **rev4 实跑**：`26 passed`，`Duration 6.31s`（`tests 2326ms`）；**rev5 复核轮实跑**：`26 passed`，`Duration 6.26s`（`tests 2301ms`）；**rev6 实跑**：`26 passed`，`Duration 7.14s`（`tests 2607ms`）；**rev7 实跑**：`26 passed`，`Duration 5.99s`（`tests 2239ms`）；**rev8 实跑**：`26 passed`，`Duration 11.10s`（`tests 4561ms`，collect 5.05s，本机同时跑着别的会话，耗时偏高但与断言无关）。五次都是 vitest `v3.2.7`，Node 报 `SQLite is an experimental feature` 警告（既有，与本次无关）。这是本任务唯一实跑的测试，`npm test` 全量与 `npm run typecheck` **五轮都未跑**。
- rev6 另跑了两条只读核对：`sed -n '240,300p' tests/market-intel.test.ts`（确认 `dealFallback` 写的是 `type: 'transfer'`、`toClubId: CLUB_A`）与 `sed -n '446,500p'`（确认 TC-05 段二是 `toHaveLength(7)` + `idsOf` 不含 `r4-1-1`、TC-06 段二依赖 `dealFallback` 的五个真料槽），这两段就是本轮 #1/#5 的证据；`grep -n useRumors -A 6 web/src/lib/queries.ts` 得 `257:export function useRumors()`、`260: queryFn`（**工作区**行号；HEAD 是 `254` 与 `257`）；`grep -n "0077\|0078" tests/d1.ts` 得 `161:'0077_growth_nongrowable_reset.sql'`、`162:'0078_venue_slots_p0.sql'`，据此把 P2 的迁移号改成 0081。
- rev7 另跑了三条只读核对：`sed -n '396,410p' tests/market-intel.test.ts`（TC-03 现有断言：`expect(idsOf(after)).toEqual(['r4-2-5','r4-2-6','r4-2-7'])` 与「换窗后每行都是真料」的循环，是 #1 的证据）；`grep -n "export function seededUnit" src/worker/venue-ops.ts` 与 `git show HEAD:src/worker/venue-ops.ts | grep -n …`（HEAD `105` / 工作区 `270`，是 #7 的证据）；`grep -n "venue-ops.ts:105"` 定位到 4 处过期引用。
- **行号约定（rev8 修正，rev7 那句「一律按 HEAD」是说过头了）**：**默认按 `HEAD`（`4ac3ab2`）**；工作区里有并行场地档会话的未提交改动，涉及它的两处行号已实测偏移，文档里按「HEAD / 工作区」双写：
  - `src/worker/venue-ops.ts` 的 `seededUnit`：HEAD `:105` / 工作区 `:270`。
  - `web/src/lib/queries.ts` 的 `useRumors`：HEAD `:254-260`（`queryFn` 在 `:257`）/ 工作区 `:257-263`（`queryFn` 在 `:260`）。文档正文统一按 HEAD 写 `254-260`。
  - **工作区独有的事实**（HEAD 里根本不存在），已在引用处就地标注「工作区」而不是硬套 HEAD 口径：`tests/d1.ts` 里的 `0078_venue_slots_p0.sql` 登记项（HEAD 只到 `:161` 的 `0077`，该文件与 `0078` 迁移本身都还未提交）。
  - 其余行号（`market.ts`、`players.ts`、`App.tsx`、`api.ts`、索引定义等）复核时以 HEAD 为准且未被并行会话触碰。开工前仍建议按**符号**（函数名、常量名、SQL 片段）重核，不要只按行号跳转。

### 12.3 没覆盖什么

- 未连生产 D1 复核 17/0/0/28 这组数字。
- 未跑 `npm test` 全量、未跑 `npm run typecheck`。
- 未做浏览器实机验证（375/768/1280 三视口），新写的 `MarketIntelPage.test.tsx` 也只是计划，尚未创建。
- 未验证 `/players?club_id=N` 在 UI 上是否有可见的筛选回显。
- 未评估新模板文案的实际阅读效果。
- 未用 `EXPLAIN QUERY PLAN` 确认在挂/留队两条查询最终走哪个索引（8.6 给的是候选与判断，不是实测计划）。
- 未查 D1 套餐额度数值。
- 8.5 的 V16-V28 **未实测**：它们是设计期望（「这个变异应该让哪条用例红」），不是跑过的结论；v6.18.0 测试计划里实测过的是旧机制的 V1-V15（`docs/test-plans/v6.18.0-market-ia.md:294-314`），不能当作本设计的变异证据。
- 未确认 P2 迁移号 0081 在落地时是否仍空闲（只核到 `0078_venue_slots_p0.sql` 已占 0078）。

### 12.4 本次使用的 skill

`brainstorming`、`grilling`、`news-writing`、`frontend-design`、`codebase-design`、`architecture-designer`、`domain-modeling`、`qa-test-planner`、`code-review-skill`、`humanizer-zh`。

### 12.5 rev1 → rev2 的处理（21 条，作者侧整理）

> 溯源更正：这一张表是 rev1 改写成 rev2 时的自述处理清单，**不是独立复核**，编号与 12.6、12.7 的两套独立复核互不通用，不能相加。下文 12.6 是本轮之前的 14 条复核，12.7 是这一轮的 10 条。

| # | 复核意见 | 处置 |
| --- | --- | --- |
| 1 | 可谈族「愿听报价 / 未列入名单」与对位共用冲突 | **修**：可谈族只留一条变体（5.1 表、6.3 表）；TC-RUMOR-04 增加「同族两侧变体集合相同」断言 |
| 2 | 无据行子模板未定义，可能成新 tell | **修**：有据侧变体由锚点决定，无据侧由HMAC-SHA256 大整数 `mod n` 在全集上均匀抽；两侧共享同一变体集合；ADR-0006 补丁 + TC-RUMOR-12 变体维度（rev3 已把变体维度从 TC-12 移回 TC-04，见 12.7 #1） |
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
| 9 | core 引用 venue-ops 破坏分层 | `seededUnit` 抽到 `src/core/deterministic-random.ts`，`src/worker/venue-ops.ts`（`seededUnit` 定义，HEAD `:105` / 工作区 `:270`） 改为 re-export | 7.0、8.6 |
| 10 | rendezvous「≤2 条变化」在小池不成立 | 用例池造到 ≥20 条；「原 id 是子集」的断言落在 **TC-RUMOR-18a**（rev3 在本表把它错挂到 TC-13；8.3 的 TC-13 是「池 ≥20，加一条后正文变动 ≤2」） | 8.3 TC-13、TC-18a |
| 11 | `market-window` scope 不在 `PUBLIC_SCOPES`；429 归因 | 取消 window cache；429 来自 `assertPublicRate(c,'market')`（`src/lib/guard.ts:29-34`），不是 D1 | 5.5、8.7 |
| 12 | 在挂族与广告板不同源 | 在挂族查证面是 `/market` 卡柜，可谈族才是 `/market/board`（rev3 落点写成 ADR-0005 是错的：ADR-0005 讲时间与信源，锚点与查证面的分工在 2.3/2.8） | 2.3、2.8、6.3 |
| 13 | 夹具缺 `transfer_listed`/`match`/`fcId` | 8.4 给每族 ≥12 锚点 + `anchors:false` 开关 + 负例夹具 | 8.4、`tests/market-intel.test.ts:268-301` |
| 14 | 小错：`.form-row` 定性、`clubs.ts` 行号、函数名 | `.form-row` 是 flex 行；`app.get('/clubs/:id'` 在 `:312`、`requireUser` 在 `:313`；函数名 `shuffleWithSeed`（`src/core/ad-board.ts:28`） | 6.1、7.0 |

本表编号与第一轮复核意见的编号一一对应（1-14），可按编号逐条核销；后续轮次对本表的更正写在同一行的「处置」列内、不改编号（如 #10 的落点由 TC-13 改为 TC-18a）。

### 12.7 第二轮独立复核（10 条，rev3 处理）

| # | 复核意见 | 处置 | 落点 |
| --- | --- | --- | --- |
| 1 | TC-RUMOR-12 六维度不可通过（变体/句长差异是设计规定的，俱乐部数不能按条切分） | 按建议收窄，但**分两步落地**：rev3 先按「主张族、归因措辞、是否含数字」三项写，rev4 的 12.8 #3 又指出后两项在本设计里是常量（归因只有一种、模板里没有数字），常量做卡方永远通过，于是最终只留**主张族**一项。检验口径不变：2×3 卡方 `p > 0.05` + 每格 lift ∈ [0.67, 1.5]；变体只保留「同族两侧集合相等」（TC-04，200 窗口聚合）；卡片级指标（涉及俱乐部数）移到 8.7 人工语料回归 | 8.3 TC-12、8.1、8.5 V20 |
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

溯源的分工不变：12.5 是作者侧整理，12.6 与 12.7 与 12.8 与 12.9 是四个独立复核轮次，12.10 是对 12.7 那 10 条的逐条核销（不是第五份意见清单），条数不可相加。

### 12.9 对第四轮独立复核的处理（rev5，7 条）

| # | 意见 | 处置 | 落点 |
| --- | --- | --- | --- |
| 1 | 8.4 一边写「其余两族不约束」一边保留全局「撞组合」断言，自相矛盾，按字面会把三类合法无据行判红 | **修**：删掉全局断言，只留按族成员关系；`realRelations` 降级为有据行的正向核对，并列出三类必然撞车的合法行作为理由；新增 V26 变异钉住 | 8.4、8.5 V26 |
| 2 | 5.0 的空族回退把位强制为无据，线上（在挂为空）导致族×位相关（lift≈0.5），而默认夹具三族都非空、TC-12 测不到 | **修**：回退改为「回退到 `firstNonEmpty(FULL)`、**位不变**」，只有三族全空（冷窗）才强制无据；`grounded` 仍是唯一读位点。TC-12 追加「线上形态夹具」一组（在挂为空），8.5 新增 V25 让「回退强制无据」必红 | 5.0、5.1、2.9、8.3 TC-12、8.5 V25 |
| 3 | §11 第 3 问未拍板，但留队族已进 P0-1；阶段表与门禁都没体现 | **修**：把第 3 问写成阶段一的**前置拍板项**，并给出「否」的降级口径（`FULL` 两元素会重排全部槽，所以必须开工前定；删查询 3/模板/留队夹具，TC-16/20b 进 P1） | §11 #3、§9 |
| 4 | §9 阶段一验收漏 TC-11/12/16/20/21/22 | **修**：阶段一独立验收改为「P0-1 的全部用例」并逐条列出；注明 20 含 20a/20b/20c、12 含线上形态组 | §9 阶段一 |
| 5 | 8.4 写「最多 16 名假料池球员」，实际是 48+16 的并集（最多 64） | **修**：改为 64 并给出 `fakeIdPool(4,1,3)` ∪ `fakeIdPool(4,0,1)` 的推导与行号；12.8 #9 保留原文作为历史记录，由本条更正 | 8.4 |
| 6 | 可谈族的广告板 200 窗口只有一句承诺，没有 SQL、索引归属与用例 | **修**：查询 1 落成与 `/market/transfer-board` 同排序同上限的窗口 SQL（`LIMIT 200`），集合 5 同步同窗口，8.6 上界档随之从 5.5 万收到 1.9 万，新增 TC-20c 与 V24，§11 #8 同步 | 5.1 查询 1、5.1 集合、8.3 TC-20c、8.5 V24、8.6、§11 #8 |
| 7 | 8.2 TC-06 段二写「落在可谈的槽出有据行」，位为假的槽仍是可谈无据，按字面判红一半合法行 | **修**：改为「按位：位真出有据、位假落在可谈补集」，并注明回退槽保留位 | 8.2 TC-06、8.3 TC-16 |

未采纳的处置：无。七条全部按复核方给的方向修进文档；只有第 2 条在两种做法（保位 / 加 production-like 夹具）之间**两条都做了**——保位是机制修复，夹具是回归锁，缺一条都会在下一轮复现。

### 12.10 第五轮：对 12.7 那 10 条的逐条核销（rev5 回查）

本轮收到的复核意见与 §12.7 是同一套 10 条（其 verdict 里给的基线是 965 行的 rev2 稿，本章当时是 rev5）。逐条回查的结论：**10 条里有 8 条在 rev5 时已完全落地，2 条当时只落到一半**——#2 的机制改了但 5.2 还留着「非空族数从 2 变 3」的旧措辞、#7 的正文改了但 5.1 集合 5 的 SQL 仍是没有窗口的全表 SELECT；这两处已在 rev6 补完（见 §12.11 #2、#7），#3 的措辞在 rev7 又对齐了一次 8.2 的精确口径（见 §12.12 #4），所以下表的「状态」列按**rev7 的现稿**写。12.7 那行保留为历史记录，不删。本节只按小节定位、不写行号——行号在这份文档里已经漂移过两轮（12.8 #17 记过一次），再写一次只会制造新的漂移。

| # | 现稿的修法 | 状态 |
| --- | --- | --- |
| 1 TC-12 六维度 | 8.3 TC-RUMOR-12 只测**主张族**：2×3 卡方 `p > 0.05`，每格 lift ∈ [0.67, 1.5]，200 个固定窗口聚合，另加线上形态夹具一组（该组按**观测到的族数**建表：在挂为空时只有可谈/留队两族上屏，硬套 2×3 会有一列恒为 0、检验退化）；8.1「常量维度不进统计检验」写明归因与数字是常量、不进检验的理由；变体归 8.2 TC-04 的「同族两侧集合相等」；卡片级指标（涉及俱乐部数）移到 8.7 人工语料回归 | 已修，最终形态见 12.8 #3 |
| 2 族抽签依赖「非空族数」 | 5.0 伪码 `FULL = [可谈, 在挂, 留队]`、`family(slot) = FULL[floor(seededUnit([...seed,slot],4) × FULL.length)]`，长度恒为 3；5.0 正文第一条性质把「rev2 用非空族列表下标抽族、加第一条挂牌会让约 1/6 槽换族」写成根因；空族走**槽级回退且保位**，回退目标只由池状态决定 | rev5 已修机制；**5.2 的 TC-18 措辞拖到 rev6 才改**（原文仍写「同一用例 非空族数 从 2 变 3」），现指向 8.3 的 18a/18b。核销以 rev6 为准（§12.11 #4） |
| 3 TC-08「保持原样」 | 8.2 TC-08 改成「换窗后**仍 8 条**、id 恰为 `slots(4,2)` 的 `r4-2-0`..`r4-2-7`、正文与本窗至少一条不同、窗口键变化生效」，并点名旧期望 `['r4-2-5','r4-2-6','r4-2-7']` 来自已删除的假料 id 池；D1 成本断言拆成 8.3 TC-RUMOR-22；8.4 里「TC-08/09 不关心条数」的笼统说法已删。**本节 rev6 版这里还写着「id 前缀 `r4-2-`」，与 8.2 的精确口径不一致，rev7 改正** | 已修 |
| 4 阶段一漏 TC-08 | §9 阶段一验收逐条列出 TC-RUMOR-01/02/03/06/07/08/09/10/11/12/16/20/21/22，并注明 08 按 8.2 新口径、20 含 20a/20b/20c、12 含线上形态组 | 已修 |
| 5 §12.5 与 14 条不是同一套 | 12.5 标题改为「rev1 → rev2 的处理（21 条，作者侧整理）」；12.6/12.7/12.8/12.9/12.10 各自标轮次与条数；12.6 补「编号即第一轮意见编号，可逐条核销」；12.8 末尾那句溯源分工已改为「条数不可相加」，并点名本节是核销而非第五份意见清单；上一轮 14 条里的 #4/#10/#11 分别在 12.6 的第 4/10/11 行 | 已修 |
| 6 8.4 未列 helper 迁移 | 8.4 的 helper bullet 给出 `realRelations` 与 `expectNoContradiction` 的改写、要删的那条旧断言（「无据行不得指向现效力队」正是要拆的侧信道）、三类必然撞车的合法无据行；rev5 补「受影响用例 TC-04/05/06」逐条点名 | 已修；rev4 的 `groundedIds` 改法被 12.8 #1 否决后改为按族断言 |
| 7 8.6「最坏情况」实为当前数据 | 8.6 标题改为「当前线上档 / 上界档」；表头写明当前实测（17 / 0 / 28 / 570）与上界口径（200 / 50 / 50 / 有俱乐部的球员数）；570 标注为 `club_id > 0` 的当前实测；查询 1 落了 `LIMIT 200`；「570+50+50+≤200 ≈ 900」这句自相矛盾的旧算被删并注明原因 | rev5 改了正文与 8.6，但 5.1 集合 5 的 SQL 仍是 `SELECT id FROM players WHERE transfer_listed = 1 AND club_id > 0`（无窗口）；**rev6 才把它换成复用 `win` CTE 的窗口查询**（§12.11 #3） |
| 8 五键 / 六键前后相反 | 5.1 写「P0 阶段保持五键，没有迁移；六键是 P1-1 的契约变更，见 5.4」；5.4 只讲六键；§9 把 P1-1 排在阶段三、P0-1 在阶段一 | 已修 |
| 9「3 个以上同族就掉条」 | 8.4 重写门槛：掉条条件是该族唯一锚点数少于落在该族的槽数，与「3 个以上」无关；并说明 ≥12 的下限是为同时覆盖跨族撞车 | 已修 |
| 10「部署后手动 purge」 | 5.5 明写「不写这句」，给出依据：`purgePublicCaches`（`src/lib/guard.ts:139`）的调用方只有写请求中间件（`src/worker/index.ts:64`）与 cron（`:259`），没有 HTTP 入口；换 v2 键后旧键不再被读取，1h TTL 到期自然失效 | 已修 |

**唯一未采纳的建议**：本轮 #1 建议把「归因措辞」「是否含数字」也放进 TC-12。未采纳，理由有证据而非口味：这两项在本设计里是常量（6.3 归因只有一种「据一位经纪人称」，模板里没有任何数字），常量做卡方检验永远通过，属无效覆盖——这正是后续一轮独立复核（12.8 #3）主动要求删掉的。因此不写进 openQuestions：它不是待拍板项，而是一个已有依据的取舍。

**本轮新增的验证**：实跑 `npx vitest run tests/market-intel.test.ts` → `26 passed`、`Duration 6.26s`（`tests 2301ms`，vitest `v3.2.7`），与 rev4 的 6.31s、复核实跑的 6.55s 一致；`npm test` 全量与 `npm run typecheck` 仍未跑。本轮未改任何源码、未建迁移、未新增用例。文档改动只有三处：§1.4/§12.2 补一次实跑记录，§12.7 #1 的处置按最终形态更正，§8.4 补受影响用例点名，外加本节。

### 12.11 第六轮：对第五轮独立复核 10 条的处置（rev6）

本轮 10 条全部接受，9 条改机制/改夹具、1 条核实后改行号。**没有只改说法不改机制的条目**——上一轮的教训就在这里（#2/#7 当时改了正文、留着旧子句，被同一条意见再打一次），所以每条都同时改了「机制/夹具」与「引用它的用例」，并在下表的「落点」列写清是哪几节。

| # | 复核意见 | 处置 | 落点 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | TC-05 段二断言 7 条、`r4-1-1` 消失，段一用 `fakeIdPool` 认假料 | 段二删 `toHaveLength(7)` 与「ids 不含 `r4-1-1`」（补一条 listing 后该球员不再以无据身份出现；若 complement 有替代则原 id 全在，否则允许掉槽并显式断言槽数；不要声称“转为有据”）；段一改为按族判定（不在该族锚点集合即无据），不再用 `fakeIdPool(4,1,3) ∪ fakeIdPool(4,0,1)` + `toHaveLength(3)` | 5.1 测试 bullet、8.2 TC-05 行（rev6 只落了 5.1，8.2 那一行仍是旧句，**rev7 补进 8.2**） | 已修（rev7 补齐落点） |
| 2 | 5.2 仍写「同一用例 非空族数 从 2 变 3」 | 删掉「非空族数」措辞，改为指向 8.3 的 18a/18b；18b 的语义写成「只有落在该族的槽变化，其余槽逐字不变」 | 5.2 测试 bullet、8.3 TC-18 行 | 已修 |
| 3 | 5.1 集合 5 是无窗口全表 SELECT，与紧邻的「同一窗口」和 8.6 的「集合 5 ≤ 200」矛盾 | 集合 5 换成复用查询 1 的 `win` CTE（同一 `ORDER BY` + `LIMIT 200`），`club_id > 0` 放在窗口之后；并注明 rev5 只改正文没改 SQL | 5.1 查询 5 | 已修 |
| 4 | 5.0 冷窗伪码没把 `family` 落回可谈，`complement(undefined)` 不可执行 | 伪码在 `firstNonEmpty(FULL)` 为空的分支补 `family(slot) = 可谈`，与 2.9/5.1 的「冷窗族固定可谈」对齐 | 5.0 伪码 | 已修 |
| 5 | TC-06 段二用 `dealFallback`（`type: 'transfer'`）当锚点，新设计下它既非留队锚点、又被跨队守卫排除，夹具实际是冷窗 | 8.4 新增 helper `seedTransferListed(fx, ids)`（默认夹具给可谈族灌 ≥12 人），**`dealFallback` 选项整体删除**；段二改为 `seedRumors({ anchors: false })` + `seedTransferListed(fx, 12)` + 按位断言 8 条（rev6 这里写的是 `listings: false`，那份夹具只关在售、留队池仍在，段二会变成「可谈+留队」两个非空族，与段一要的冷窗形态不符，**rev7 改正**） | 8.4 夹具改造、8.2 TC-06 行、5.1 测试 bullet | 已修（rev7 改正夹具写法） |
| 6 | 5.7 把已抽中的有据槽降级为无据，与 5.0「`grounded` 只读位」冲突，且 TC-12 不覆盖 | 5.7 重写为「只改选哪条、不改有没有锚点」：按本窗同俱乐部计数给候选降权（`weight × 1/(1+count)`），同族同侧重选，选不到就保留（软上限）；**两侧同时施加**（原写法会造出「同俱乐部 ≥3 条 ⇒ 必是无据」这个更硬的侧信道）；常量改名 `MAX_SAME_CLUB_PER_CARD`；阶段五验收加「TC-12 不回归」，TC-19 重写 | 5.7、8.3 TC-19 行、§9 阶段五 | 已修 |
| 7 | 12.10 声称 10 条全部已修，属过度声明 | 12.10 开头改为「8 条已完全落地、2 条当时只落一半」，#2/#7 两行的状态列改成「rev5 部分 / rev6 才补完」并指向本节 | 12.10 引言 + #2/#7 行 | 已修 |
| 8 | 迁移 0078 与工作区的 `0078_venue_slots_p0.sql` 撞号 | 5.8 与 §11 第 5 问都改成 **0081**，并写明依据：`tests/d1.ts`（**工作区** `:162`；HEAD 无此行）已登记 `0078_venue_slots_p0.sql`；再加一句「若 0081 落地时也被占则顺延」 | 5.8、§11 Q5 | 已修 |
| 9 | TC-13/18a 的「正文变动 ≤2」不是 rendezvous 的不变量 | 两处都改成**固定夹具 + 固定种子上的快照锁**，写明「新增事实可能同时成为多个槽的最大权重，≥20 只降概率」，要求用例注释记夹具指纹；结构性断言只保留「不影响别的族」 | 8.3 TC-13/18a 行、5.2 测试 bullet | 已修（口径改写） |
| 10 | TC-08 新断言只写 id 前缀，空数组会真空通过 | 改成「仍 8 条、id 恰为 `slots(4,2)` 的 `r4-2-0`..`r4-2-7`、正文与本窗至少一条不同」 | 8.2 TC-08 行 | 已修 |

**顺带修的一处行号**：`useRumors` 在 **HEAD** 是 `web/src/lib/queries.ts:254-260`（`queryFn` 在 `:257`），工作区因并行改动是 `:257-263`（`queryFn` 在 `:260`）；文档里 4 处旧写 `253-260` 已统一成 HEAD 口径 `254-260`（§1 机制表、5.6 现状、6.5 错误态、§12.2），工作区的偏移写在 §12.2 的行号约定里（rev8 修：rev7 那句「一律按 HEAD」与工作区引用矛盾，复核已指出）。

**本轮不修、也不进 openQuestions 的两条**（理由都是「复核意见与代码/设计不符」或「不是本文档能决定的约束」）：

1. 复核意见把 TC-12 的「2×3」当成现稿的写法，但现稿已经写明「线上形态组按观测族数建表（此处 2×2）」——这一条是上一轮我自己发现并修的，不在本轮 10 条里，此处只做澄清，不改。
2. 「`npm test` 全量与 `typecheck` 未跑」是复核者与本稿共同的事实，不构成意见；它留在 §12.3 的未覆盖清单里，属于交接项，不是待拍板项。

**本轮验证**：`npx vitest run tests/market-intel.test.ts` → `26 passed`，`Duration 7.14s`（`tests 2607ms`，vitest `v3.2.7`）；这是本轮唯一的实跑检查。`npm test` 全量与 `npm run typecheck` 未跑（见 §12.3）。本轮对源码零写操作，只改了本文件；`git status` 里 `src/core/config.ts`、`tests/d1.ts` 与 `src/core/venue.ts`、`0078_venue_slots_p0.sql`、`tests/venue-*.test.ts` 来自并行的场地档会话，不是本任务。

### 12.12 第七轮：对第六轮独立复核 7 条的处置（rev7）

本轮 7 条全部接受。4 条是**上一轮改机制后没同步到用例**（TC-03/TC-06/TC-19/V22），3 条是**文档内部的过期声明或过期行号**。这轮的共同病根与前两轮一样：「机制改了，引用它的用例/约束句没跟着改」，所以每条都把「机制、用例、变异」三处一起改，并在下表的「落点」列写清节号。

| # | 复核意见 | 处置 | 落点 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | **high** TC-03 没随假料 id 池迁移：现有断言把「换窗后只剩 `r4-2-5`/`6`/`7`」写死，而新设计里假料不再来自 `fakeIdPool` 的点查、池子也不再只有那 48 人 | TC-03 从「保持，槽位期望按新抽取重算」改为**重写**：仍 8 条、id 恰为 `slots(4,2)` 的 `r4-2-0`..`r4-2-7`、正文至少 4 条（共 8 条）与本窗不同，再按族对账（每族的有据/无据条数与 5.0 的位分布一致）。原断言的两处具体位置（`tests/market-intel.test.ts:396-410`）写进行文，免得实现时照抄旧期望 | 8.2 TC-03 行 | 已修 |
| 2 | **high** TC-06 段二在 8.4 的新默认夹具（可谈族灌了 12 人）下不再是「仅可谈非空」 | 8.4 把两段夹具分开写：段一 `seedRumors({ anchors: false })`；段二在 `anchors: false` 之后再 `seedTransferListed(fx, 12)`。并注明 **rev6 写的 `listings: false` 是错的**——那份夹具只关在售、留队池仍在，段二会变成两个非空族 | 8.4、8.2 TC-06 行 | 已修 |
| 3 | **medium** 5.7 的公式不读 `MAX_SAME_CLUB_PER_CARD`，导致 V22（把常量改成 99）永远绿；TC-19 的「各 ≤2」又被写成无条件硬上界 | 公式接常量：`weight × 1/(1 + max(0, count − M + 1))`，`M = MAX_SAME_CLUB_PER_CARD`（`M = 1` 时退化为原来的 `1/(1+count)`，`M = 99` 时完全不降权）；TC-19 拆两段——段一结构（8 条在、id 0..7、位分布不变），段二快照锁（**提供了足够替代的固定夹具**上单侧 ≤ M，并在行文里写明夹具必须交代的三件事）；V22 改成「删掉降权逻辑或把 M 改成 99 → TC-19 段二红」并注明「公式读常量时才成立」 | 5.7、8.3 TC-19 行、8.5 V22 | 已修 |
| 4 | 12.10 #3 与 12.11 #1 的落点/状态还是 rev6 的措辞（#3 写「id 前缀 `r4-2-`」；#1 只落 5.1 没落 8.2，却标已修） | 12.10 #3 改成与 8.2 相同的精确口径并留改判痕迹；12.11 #1 的落点列补「rev6 只落 5.1，rev7 补进 8.2」、状态改「已修（rev7 补齐落点）」 | 12.10 #3、12.11 #1 | 已修 |
| 5 | **low** 8.7 只跑 4 个窗口，与 TC-04/TC-12 的 200 个窗口不对接 | 8.7 写明：固定 4 个窗口只覆盖**结构类与换窗类**（TC-01/02/03/06/07/08/10/17/18），**统计类（TC-04、TC-12）仍是 200 个固定窗口**，两者不同层级、不能互相替代 | 8.7 | 已修 |
| 6 | **low** 5.1 集合 8 的理由「历史记录在公开成交表上永远查得到」不成立：`/api/market/deals` 没有 cursor、只取最新 50（`src/worker/routes/market.ts:356-363`） | 理由换成**排除方向保守**：多排除只会少出无据行，而无据行不引用任何公开锚点、不产生对外主张，所以不需要满足 ADR-0008；反过来按 50 条收窄反而会让「有跨队成交但不在最新 50」的人落进无据池，制造本可避免的侧信道。集合 8 与 5.1 正文两处同步改 | 5.1 查询 8 与下方 bullet | 已修 |
| 7 | **low** `seededUnit` 的行号 `venue-ops.ts:105` 已在工作区过期（并行会话把定义移到 `:270`） | 四处 `src/worker/venue-ops.ts:105` 改成**符号定位**：`src/worker/venue-ops.ts`（`seededUnit` 定义，HEAD `:105` / 工作区 `:270`）；§12.2 的 grep 清单补「行号按 HEAD」。理由：本文档所有代码行号都按 `HEAD` 记，工作区有未提交的并行改动，写成绝对行号会随会话漂移 | 正文 4 处、§12.2 | 已修 |

**本轮判定口径**：只改本文件，不碰源码；7 条里没有「只改说法不改机制」的条目，也没有「必须拍板才能动」的条目，所以不必进 §11。

**本轮验证**：见 §12.2 的 rev7 记录（`npx vitest run tests/market-intel.test.ts` 结果、文档结构校验）。`npm test` 全量与 `npm run typecheck` 仍未跑，属交接项。

### 12.13 第八轮：对第七轮独立复核 2 条 medium 的处置（rev8）

本轮只有 2 条 medium，都是上一轮新引入的口径问题：一条是我给「行号按 HEAD」这句约定说得太绝对（`queries.ts` 与 `tests/d1.ts` 的引用其实是工作区行号），一条是我给 8.4 加「每族 ≥12 锚点」的硬性下限时，只写了可谈族的种子 helper，在挂/留队没有对应改造。两条都修了，没有新增 high/medium。

| # | 复核意见 | 处置 | 落点 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | **medium** §12.2 的「所有代码行号按 HEAD」约定与文档里 `queries.ts` / `tests/d1.ts` 的引用不符：`queries.ts:257-262` 是工作区行号（HEAD 是 `:254-260`，`useRumors` 在 `:254`、`queryFn` 在 `:257`）；`tests/d1.ts:162` 的 `0078` 登记项 HEAD 里根本不存在（HEAD 只到 `:161` 的 `0077`） | 约定改成**默认 HEAD + 就地标注工作区**三段式：① 默认按 HEAD；② 两处已实测偏移的引用（`seededUnit` HEAD `:105` / 工作区 `:270`；`useRumors` HEAD `:254-260` / 工作区 `:257-263`）双写；③ 工作区独有的事实（`tests/d1.ts` 的 `0078` 行）就地标「工作区；HEAD 无此行」。同时把正文 4 处 `queries.ts:257-262` 统一改成 HEAD 口径 `254-260`，`tests/d1.ts:162` 两处补「工作区」标注，§12.11 #8 的落点与 12.11 的「顺带修的一处行号」一并重写 | §12.2 行号约定、§1 机制表、5.6、6.5、5.8、§12.11 #8 与随附说明 | 已修 |
| 2 | **medium** 8.4 的「默认 `seedRumors` 每族 ≥12 条唯一锚点」硬性下限，只由 `seedTransferListed` 覆盖了可谈族；在挂/留队没有对应种子，现有夹具直接跑是在挂 2 条、留队 0 条，TC-01/02/03/06/08/10 会先卡在下限上 | 8.4 新增「三族各自的种子 helper」：`seedTransferListed`（可谈 ≥12）、`seedListed`（在挂 12 条、三态各 4、`seller_club_id = players.club_id`，与原默认的 2 条 listing **叠加**）、`seedTeamMoves`（留队 `match`/`rc_change` 各 6、`from = to`）；并给出默认夹具的预期形态（可谈 ≥12、在挂 ≥14、留队 ≥12、假料补集 ≥24）与幂等要求。`seedTransferListed` 那句「同时满足上表的硬性下限」改成「**只覆盖可谈那一行**」——一个 helper 不可能给四族灌锚点，这正是本条的被指之处 | 8.4（新增 bullet 与预期形态）、§12.12 #2 的口径 | 已修 |

**本轮判定口径**：2 条都只改本文件，不碰源码；都不涉及机制取舍，所以不进 §11 的待拍板清单，也不需要新 ADR。

**本轮验证**：`npx vitest run tests/market-intel.test.ts` 与文档结构校验见 §12.2 的 rev8 记录；`npm test` 全量与 `npm run typecheck` 仍未跑，属交接项。

### 12.14 第九轮：owner 决定买方侧主体（rev9）

**触发**：User said (m00744): "主体恒为球员与其现东家的边界是错误的，应当允许球队与非本队球员产生传闻，真实传闻来自报价、挂牌、出价等，虚假传闻按照一定算法匹配"。这不是架构师的取舍，是 owner 对产品边界的直接裁决；ADR-0003 的「决定：B」因此作废。

**处置**
- ADR-0003 标 **Superseded by ADR-0009**；新增 ADR-0009，Status **Accepted by owner m00744**。以后凡改变产品语义（主体边界、公开 API、玩家可见规则）的 ADR，架构师只能写 `Proposed` + 推荐，`Accepted` 只能由 owner 确认。
- 主体改为 `(clubId, playerId, clubRole)`，`clubRole ∈ current/buyer`；四族 `FULL=[可谈,在挂,留队,出价]`；卖方三族保留，出价族含公开 `bids`（P0）与内部 `offers`（P0；自由身真料，不可公开查）。
- 假料不再是随机 `player × club`：买方假料按 `matchBuyerFake`（位置需求/CA 带/年龄 + 盐位 11）确定性匹配；卖方假料仍从现东家取。同族真假共用模板，`clubRole` 是族属性、不携带位。
- 载荷九键（`clubId/clubName/clubRole/currentClubId/currentClubName` + 原五键）；P0 缓存键升 v3；前端卖方两链接、买方有现东家三链接、自由身买方两链接。
- 测试：TC-05/11 扩买方守卫；TC-12 由 2×3 改 2×4；新增 TC-23（买方锚点窗口）、TC-24（买方假料确定性）、TC-25（内部 offers，P0）、TC-26（自由身买方）；8.4 新增 `seedBids`/`seedOffers` 与四族 ≥12 锚点。
- 分期：阶段一含买方 bids/内部 offers/自由身/九键/匹配；阶段二 rendezvous；阶段三 phase；阶段四上限；阶段五 P2。
- §10 删「不做买方视角传闻」；§11 #1 标已定，#11-14 已定（#10 已核实生产 status）；新增 §12.15 拍板记录。

**验证口径**：本轮只改本文件，不碰源码；`npx vitest run tests/market-intel.test.ts` 的 rev8 记录（26 passed）仍是最后一次实测，rev9 的新行为（买方锚点/匹配/九键）**没有实现、没有测试证据**。文档当前是未提交的工作区改动。行号因本轮编辑大幅漂移，后续核对请按标题/符号，不要只按行号跳转。

**未决**：§11 #4-#9；#2/#3 已定（transfer_listed / match+rc_change 保留），#10 已核实（生产只有 active），#11-14 已定（见 §12.15）。

### 12.15 rev9 拍板记录（owner m01017–m01258，2026-10-21）

**触发**：rev9 初稿把自由身、offers、成交族、竞价判定、clubs.status 留在 §11 待拍板；owner 要求逐项用 AskUserQuestion 问，并给出裁决。

**裁决**
- 留队族：保留在 P0（#3 的上半段已定；match/rc_change 仍按原设计进四族）。
- `transfer_listed`：保留，继续作为可谈族真料锚点（#2 已定）。
- `offers`：保持不能公开查，不新增公开投影（#11）。因此自由身真料只能是 internal，玩家不可公开核对；这是 owner 明确接受的代价。
- 自由身：纳入 P0 买方族（#12）；`currentClubId=0`、`currentClubName='自由身'`；卖方三族仍要求有现东家；买方假料可用自由身，但只出 `已报价` 变体。
- 成交族：已完成跨队转会不做回顾式买方族（#13）；成交仍只由成交表承担。
- 竞价判定：`正在竞价` 用 `listing.status='bidding'`，不用「≥2 条 active bids」（#14）。
- `clubs.status`：#10 的生产核实为只有 `active`，20 家（`SELECT status, COUNT(*) FROM clubs GROUP BY status`，`whl-club`，`served_by=v3-prod`，APAC/KIX，`changed_db=false`）；守卫按 `status='active'` 写死，后续出现其它状态再补白名单。
- **假料统计分层（owner m01383）**：owner 否决 `CA_FLOOR=80` 一刀切，要求用统计学方法并把假料池缓存纳入计划。改为 §5.1B：按真料锚点的公开协变量分层（`position` × 5 个 CA 带 = 20 层），`p_s = (n_s + 0.5)/(N + 0.5K)`（锚点按 `playerId` 去重，`K` 为非空层数），帧 `M=256`，层内哈希抽样；帧缓存 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`、开窗 TTL 1h、冷窗 24h、**不随每次市场写 purge**（新锚点由当窗锚点集合（`familyAnchors`）守卫排除；响应缓存仍 purge）；真料不按 CA 过滤，低 CA 保留非零概率；验收 TC-27 用卡方/KS/|SMD|<0.1 与低 CA 覆盖，不设硬门槛。生产基线（2026-10-21）：normal 505/avg 81.3、trainee 65/75.3、free 17,731/65.3；合计 18,301；真料锚点 transfer_listed 18、offers 5、listings/bids 0。

**同步落点**：§0.1/0.2/0.4/0.6、§2.1/2.3、ADR-0009、§5.1 查询 1/2/3/4/9/10、§5.1A、**§5.1B**、§6.3、§7.4、§8.2/8.3/8.4（TC-15/25/26、seedOffers P0）、§8.6（帧 M=256/缓存）、§9、§10、§11 #2/#8/#10-#14。

**第二轮拍板（owner m01521）**
- 队名：P0 用 `/players?club_id=N` 名单页；P1 新建俱乐部摘要页，含主场/球场相关信息。
- edition：P1 预留；P0 不做 0081。
- 无开窗期（赛季进行中）：P0 按日换血（种子加 `dayKey`，冷窗缓存键含 `dayKey`）。
- 版本：**v6.54.0**（owner m01564）；测试计划 `docs/test-plans/v6.54.0-rumor-claim-anchor.md`（计划文件，阶段一创建；当前不存在）。
- D1：已查 `whl-club` 生产读量（`rows_read_24h=371,144`、`read_queries_24h=13,468`、库 34.2 MB）与 Free 5M 行/天、Paid 25B 行/月额度；**5M 是账户级共享额度**，近 10 天账户总读 0.36–2.03M/天，本功能增量候选表 0.56M/天、4h TTL ≈1.05M/天（低于 1.3M 门，可作降级）；直算 fallback 2×18.3k×96 + 响应 0.02M + 画像 0.10M≈3.63M/天（不可常态），叠加峰值约 候选表 2.59M / 直算 5.66M；**开窗前必须过 §8.6 容量门（账户总读 ≤4M/天）**，上线后监控只告警，不作为降档依据。
- 端点：P1 再加 club 过滤 + 翻页锚点窗口；P0 维持 50 条窗口。

**验证口径**：本轮仍只改本文件，不碰源码；没有新增测试；rev8 的 26 passed 是最后一次实测，rev9 的新行为仍无测试证据。

**阅读提示**：§12.5-12.14 是历史轮次记录，其中出现的「三族」「五键」「2×3」描述的是当时版本，不是 rev9 现稿；§12.15 是 rev9 的拍板记录，§12.16 是 rev9 独立复核与修复记录。以 §0、§2、§5、§6.3、§7.4、§8、§9、§10、§11 的当前表述为准。

### 12.16 第十轮：rev9 独立复核与修复（rev9，2026-10-21）

**触发**：owner m01564 的「做123」第 3 步，fresh reviewer 读文档 + 代码，只找 high/medium，不改文件。

**verdict**：`readyForApproval=false`（复核当时）。4 条 high、3 条 medium；均已修；P0-0 由 owner 于 2026-10-21 定为「扩展 offers」，阻塞已关闭。

**high**
1. **自由身 offers 在现有写入路径不可能**：`src/worker/offers.ts:153` 对 `club_id` 空/`status='free'` 直接 400；`seller_club_id` NOT NULL；接受路径 `:277/:424/:589` 要求 `player.club_id=seller_club_id`。§5.1A 已加 P0-0 前置：只扩展 offers 写入 `pending`（自由身没有 intent），允许 `seller_club_id=0` + `players.status='free'`；**不扩展 seller 接受链**，签约走 free-agent bypass；owner 2026-10-21 已选扩展 offers，§11 #15 关闭。
2. **留队 28 是否在窗口**：生产最新 50 条 completed = 24 match + 4 rc_change（全部 `same_club`），当前 N=46 成立；§5.1B 已注明 28 是窗口内计数，实现须按窗口重算，不能写死 46。
3. **帧构建读量**：`ORDER BY hash` 不能索引排序，20 支合计读该区间全部候选 ≈18.3k/次，不是 256；§5.1B/§8.6 已改。帧改为不随每次市场写 purge（开窗 TTL 1h、冷窗 24h；开窗 ≤48 次/日上界），新锚点由当窗锚点集合（familyAnchors）守卫排除；响应 0.02M + 直算 3.51M + 画像 0.10M ≈3.63M/天（fallback，不可常态）是本功能增量，5M 为账户级共享额度。owner 2026-10-21 明确**不以上线后监控为容量方案**：§8.6 已加开窗前容量门（账户总读 ≤4M/天；帧构建走候选表 1,280+join≈3.8k/次，见 §5.1C；或 4h TTL + W 去抖），阶段一开工前必须通过。
4. **位置 SQL**：`p.position = ?` 只覆盖 4/12 个细位置；已改 `p.position IN (?, ?, ?)`（GK/DEF/MID/FWD 组各 3 个细位置）。

**medium**
1. TC-27 的 |SMD|<0.1 在 20 层 `n_s=1` 时不可达；改为 SMD 按 5 CA 带/4 位置组聚合，卡方仍按 20 层。
2. 冷窗帧种子缺 `dayKey`；已改 `seededUnit(windowSeq===0 ? [season,0,dayKey] : [season,windowSeq],12)`。
3. P0 查询数 10 vs 11：统一为 **11 条（1-11）**；5-8 是卖方集合锚点（N=46 依赖），不能下放 P1；预算计入 9/10/11；帧缓存用 `cachedFrame` 直写 `caches.default`、不拼全局 epoch；§5.8 标题改 P1，§5.9 标题改 P0。

**复核后补修**
- TC-05/11 删除「卖方无据行 clubId=currentClubId、买方无据行 clubId != currentClubId」的归属断言，改为只按该族锚点集合判定无据行（主体归属是侧信道）。
- TC-25/26 与 §8.4 `seedOffers` 的自由身分支改为「P0-0 已定，按扩展 offers 实现；未实现前测试只造有队 offers」。
- §5.9 标题 P2-2 → P0；§12.16 本记录。

**验证口径**：本轮仍只改本文件，不碰源码；没有新增测试；rev8 的 26 passed 是最后一次实测，rev9 的新行为仍无测试证据。

### 12.17 第十一轮：日预计算候选表（rev9 增补，owner m01936）

**触发**：owner 问「日预计算候选表如何实现」，要求头脑风暴并纳入文档。

**方案比较**：预计算整帧（帧目标随锚点变，会过期）、JSON 缓存（无索引/evict 后重建）、拆 seller/buyer 两张表（多一致性面）、不预计算只拉 4h TTL（分布最多旧 4h）。选「单表 + 窗口键（冷窗日键）+ 5 分钟 ensure」：`rumor_candidate_builds` + `rumor_candidates`，每层 56 有队 + 8 自由身 = 64，20 层 1,280 行；`ensureRumorCandidates` 在 5 分钟 tick 检查 `(season, window_seq, day_key)`（开窗 `day_key=''`，冷窗上海日期），无 ready 才构建；帧 miss 读 1,280 候选 + join ≈3.8k；增量 ≈0.56M/天；无表/构建失败时直算 2×18.3k/次 fallback（≈3.63M/天，不可常态）。

**落地**：新增 §5.1C；§8.6 候选表数字改为 1,280/≈0.56M；§9 阶段一前置；§11 #8；§5.1B 帧缓存值加 seller/buyer 子帧；迁移 0080 + TC-29。**源码零改动；未提交；未跑新测试。**

### 12.18 第十二轮：rev9 独立复核与修复（2026-10-21，owner m02015）

**触发**：owner 确认 §5.1C 与容量门后，要求独立审查员复核并修复。复核员为未参与文档的新 agent，只读文档与代码；verdict `readyForApproval=false`，7 条 high、8 条 medium。

**high 修复**
1. 帧缓存：`scope='market'` 会被市场写全局 epoch bump；改为 `cachedFrame()` 直接写 `caches.default`（不拼 epoch），键统一 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`（开窗 `dayKey=''`），市场写后帧仍命中，新 buildId/换日才 miss；per-colo 的 F 乘实测 colo 数；TC-27 同步。
2. 自由身 P0-0：不承诺走 seller 接受链；只扩展 offers 写入 `pending`（自由身没有 intent），签约走 free-agent bypass，`amount` 只作意向金额；§5.1A/§11 #15/§12.16/TC-25 同步。
3. 构建竞态：`build_id` 改 TEXT UUID，`INSERT ... ON CONFLICT DO NOTHING RETURNING build_id`，禁止 `last_row_id`；stale building 由 ensure 原子抢占为 failed；每天最多 3 次尝试。
4. 层容量：56/8 是硬 cap，不是观测上界；`m_s` 超 cap 时截断，`M_eff=Σ m_s`、`p*_s=m_s/M_eff`；TC-27 的 cap 层只断言 `actual_s=cap`，不参与卡方；非 cap 层用锚点 `p_s`，cap 层不得跳过。
5. P0 查询：统一 11 条（1-11）；5-8 是卖方集合锚点，N=46 依赖，不能下放 P1；TC-22/§12.16 同步。
6. Sentry：不新增第二个 cron monitor（免费档限制）；`ensureRumorCandidates` 复用 `club-settle-tick`，用 `captureMessage`/breadcrumb。
7. 开窗/冷窗种子：候选构建与直算共用 seed；开窗 `[season,windowSeq]`、`day_key=''`；冷窗 `[season,0,dayKey]`；避免候选表与 fallback 出不同集合。

**medium 修复**
- §5.4 自由身行 `currentClubId=0` 特判；自由身买方两链接，非自由身三链接；TC-15/26 同步。
- `p_s` 统一为 `(n_s+0.5)/(N+0.5K)`，锚点按 `playerId` 去重；空层 p=0；删除 `N+20α`/`N+10` 两套分母。
- 卡方只对非空且期望≥5 的层做；期望不足合并 CA 带或精确检验；空层不进检验。
- 默认夹具只做回归；TC-27/29 用 `seedRumorFrameFixture`，20 层每层 ≥64 候选。
- 失败重试计入容量门：每天最多 3 次，最坏 3×≈55k/天；总增量 ≈0.56M（失败路径最坏≈0.60M，3 次构建比 1 次多 2×18.3k）。
- 候选表读时重新校验 `position_group/ca_band/pool`，跨层/换池回填，读取阶段也记 `cappedStrata`。
- seller/buyer target 分开：seller 用卖方锚点，buyer 用 bids+offers，free 变体用 free offers；不共用 target。
- v6.54.0 测试计划与 `MarketIntelPage.test.tsx` 标记为阶段一计划/新建，不作为现有文件引用。

**未决**：复核员的 3 个 open question 已在文档内采用明确口径（自由身只写 pending、开窗同窗稳定、P0 11 条）；如 owner 不同意，按 §0.6/§9 的阶段一前置再调。**源码零改动；未提交；未跑新测试；rev8 的 26 passed 仍是最后一次实测。**

### 12.19 第十三轮：第二轮独立复核与修复（2026-10-21，owner m02158）

**触发**：owner 要求继续独立复核并修复。新 agent 只读文档+代码，verdict `readyForApproval=false`，6 条 high、2 条 medium。

**high 修复**
1. 自由身 offer 生命周期：P0-0 扩到完整清单——`:153` 放开、`:160` 允许 `free`、`:163` 不走 `release_fee` 校验、`expireStaleOffers` 豁免、窗口关闭/签约只做读取过滤、到期/撤回置终态、不冻结资金；验收必须走 `POST /offers` + 惰性结算（§5.1A）。
2. 候选表唯一索引：拆 `building`/`ready` 两个 partial unique，允许旧 ready + 新 building；`attempt_count/next_attempt_at`，第 3 次失败不再插入；`INSERT ... RETURNING`、禁止 `last_row_id`。
3. 帧缓存：统一 `rumor-frame:{buildId}:{season}:{windowSeq}:{dayKey}:v1`；`cachedFrame()` 直接写 `caches.default`，不拼全局 epoch；per-colo 的 F 乘 colo 数。
4. 买方 cap：`M=256` 只是目标；cap 后 `M_eff=Σ m_s`、`p*_s=m_s/M_eff`；TC-27 的 cap 层只断言 `actual_s=cap`，非 cap 层用锚点 `p_s`。
5. 直算帧按子帧过滤：seller 只取 `club_id>0 + active/non-CPU`，buyer 取 club+free；不能一个不带 club 过滤的查询同时喂两个子帧；直算仅 fallback。
6. 阶段一验收补 TC-04/05/15，和 TC-27/29 一起进 §9 阶段一 green。

**medium 修复**
- 候选 SQL：`p.ca/position IS NOT NULL`；free 分支必须 `status='free'`；salt 统一 12 并登记 §7.3（12=帧/候选哈希，13 起预留）。
- 候选表只在帧缓存 miss 时读；F 是 2 colo 合计（APAC/KIX 2 → 96/日；单 colo 48），TC-22 分「帧+响应命中 / 帧命中响应 miss / 帧 miss」三档，不再写「每次请求 11 条各执行一次」。
- 容量数字同步：候选表常态 ≈0.56M/天、4h TTL ≈1.05M/天（低于 1.3M 门，可作降级）、直算 fallback ≈3.63M/天（不可常态）；增量门 1.3M/天，账户总读门 ≤4M/天。

**状态**：只改设计文档；源码零改动；未提交；未跑新测试。

### 12.20 第十四轮：第三轮独立复核与修复（2026-10-21，owner m02406）

**触发**：owner 要求「继续独立复核并修复」。新 agent 只读文档+代码，verdict `readyForApproval=false`，3 条 high、7 条 medium。

**high 修复**
1. `m_s/M_eff` 口径收口：删「最大余数法补 2 行到 256」和「按非 cap 层重分配」；统一 `m_s_raw→cap→M_eff=Σm_s`（`p*_s=m_s/M_eff` 只配额，TC-27 非 cap 用锚点 `p_s`），12 层合计 254、`M_eff=254`；seller cap 56，buyer 按 club 56 + free 8 分池 cap（同层合计 ≤64），buyer 的 `m_s` 拆 `m_s_club/m_s_free`，**该层 free 锚点 `n_s_free=0` 时 `m_s_free=0`**，不能硬塞 1 行。
2. 候选表重试谓词：拆成 `maxAttempt>=3` 无条件封顶 + `maxAttempt>=1 && now<nextAttemptAt` 只拦前两次；首次插入 `attempt_count=1`，失败不自增，靠下一次插入递增；TC-29 增加「拨回 `next_attempt_at` 仍不产生第 4 个 build」。
3. 自由身 P0-0 完整清单：补 `:161 not_for_sale`、`:172-175` 余额预检保留、`:187-190 seller_club_id 绑 0`、`:192-196` 跳过 `fund_holds`、`:226-247` 跳过 auto/auto_accept、`:372-386/:394-494` 不走 seller 接受、`:254` 跳过 club 0 通知；新增 `not_for_sale=1` + `offer_auto=1+min_offer_price` 的自由身夹具验收。

**medium 修复**
- 查询 1/2/3/9/10 投影补 `p.position/p.ca`，让 `n_s` 可直接算；查询 10 补 `o.season/o.window_seq` 过滤。
- 假料层内哈希统一到 §5.1B 的 `((p.id*1103515245+seed)&2147483647)`，seed 含 `dayKey`，删除查询 4 的 `hash(playerId,season,windowSeq)` 旧写法。
- `cachedFrame()` 补 `l2Available()` 守卫（vitest 无 `caches.default` 时只走 frame L1）与 `resetGuards()` 清 frame L1；`guard.ts:215-218` 的 epoch 只在传 env 时拼接，引用措辞已校正。
- F 口径统一为「每 colo 每活动窗口 24 次/日，2 窗 2 colo=96 次/日≈0.365M」，删 0.18M/colo 的重复乘 2。
- 位置组落库统一 `GK/DF/MF/FW`（`src/core/fc26.ts:28-48`），正文 DEF/MID/FWD 只是别名，DDL CHECK 与 SQL CASE 已改。
- `seedBids` 改为另建 12 条 listing + active bids（球员 37..48），不复用 `seedListed` 13..24，四组不相交断言可成立。
- 自由身生命周期改为「窗口关闭/签约读取过滤、到期/撤回置终态、不写签约 expired」；自由身 pending 由现有 `expireDueOffers` 统一收口（它已收所有 pending，**不加 free-only 过滤**），不动 v6.29.0 跨窗 intent。

**状态**：只改设计文档；源码零改动；未提交；未跑新测试；修后稿尚未再复核，下一轮继续独立评审。


### 12.21 第十五轮：第四轮独立复核与修复（2026-10-21，owner m03515）

review 12 独立复核 5 high + 9 medium，均已修入本稿：

- H1 `ensureRumorCandidates` 必须在 `scheduledTick` 的 `if (!tickChanged) return` 之前调用，并各自 try/catch；H2 开窗首请求只读 ready/旧 ready/503，不同步构建；H3 TC-27 删除帧 vs 锚点卡方/SMD，改为配额 + 低 CA 覆盖；H4 冷窗=四族全空，无开窗≠冷窗，TC-10 加 grounded 断言；H5 失败路径只回旧 ready/503，直算需 `RUMOR_ALLOW_DIRECT=1` 仅应急。
- M1 查询 10 加 `LIMIT 200`；查询 8 改 EXISTS 半连接；M2 变体改用 HMAC-SHA256 大整数 `mod n`，不落回 32 位 salt/seed；M3 `secretBit` 加 `dayKey`；M4 冷窗 `p_s=1/K'`；M5 读取时重算 `actual_s/M_eff`；M6 专用夹具 30,000–31,279；M7 查询 2/3/9/10 加 retired/free 过滤；M8 NULL intent 在 season 分支不可见，`COALESCE(MAX(window_seq),0)`；M9 自由身页加「仅意向报价」入口；M10 F=96 只覆盖 2 个正赛窗。
- 只改设计文档；源码零改动；未提交；未跑测试。
