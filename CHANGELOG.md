# 变更记录

本项目按**各仓语义化版本**推进（2026-09-25 起；此前为全项目共享增量号，原号与新版本的对照表见 [ROADMAP.md](./ROADMAP.md) 顶部），每次生产部署以 Cloudflare Worker 的 Version id 标记（仓库无 git tag）。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

各版本的裁决、交付清单与验收数字见 [ROADMAP.md](./ROADMAP.md)。

## [v6.33.1] · 特例期一线队/训练营同场参赛：名册含训练营开关 + 注册校验三态 + 全员注册工件 + 全站文案改名（2026-10-05）

**本地完成，未发布（待令）**（提交链 `c9c5bcf` fix(web) + `1bff080` feat + `1f480b7` fix 评审 + `96779c8` docs(test-plans) + `dfd6e87` feat(web) 改名 + `0cc1275` chore(scripts) 注册批工件 + 收口 docs 枚；零迁移）。**上线后执行序（顺序硬约束）**：① push 先上代码 ②开 `squads_include_trainee=true` + 四键豁免 ③执行全员注册批 ④verify（回读 `/api/squads` 前先 bump `cache:epoch:public`）。

**缘起**：用户提出「tour 平台只取一线队人员……由于特殊情况，一线队和训练营都能参赛，如果此时注册有训练营无法参赛的风险」。核查链：注册写 `players.status='trainee'`（`src/worker/routes/registration.ts:366-371`）→ `/api/squads` 只发 `status IN ('normal','listed')` → 赛事仓整点 cron 把该球员从 tour `player` 表删除 → `validateAssign` 失败无法进阵容。规则原文（4.2）：「阵容注册分为一线队注册与训练营注册，所有参赛球员必须完成注册方可出战正式比赛」，两条注册线都可出战。用户拍 **T1 手动开关**。

**交付**：config 注册表 **78 → 80**——`squads_include_trainee`（默认 `'false'`；开关开时名册含 trainee 且每行附 `squad` 字段，缓存键并入开关值防旧口径写进新代际键）+ `registration_check_mode`（**enforce / warn / off 三态**，脏值回落 enforce；warn = 放行但红字在、off = 只做归属与重复校验，隔离 `checkSquad` 全部七条；管理端扫描不受档位影响；审计 `after` 恒带 issues 规则清单）；`GET /club/squad` 下发 `checkMode`，DeskTab 三态横幅与红字同步。**全员注册批工件** `scripts/prod-20261005-s9-all-registrations/`（season=9、20 队 570 行 = 一线队 501 + 训练营 69，CPU 两队全一线队；含生成器 / 分片 SQL / manifest / 回滚 / README runbook；**未执行任何生产写**）。**全站文案改名**：球队中心 → 我的球队、球队 → 球队库。顺带修广告板报价弹层透明（缺 `.card` 类）。

**验收与后效**：测试计划 `docs/test-plans/v6.33.1-trainee-play-allowance.md`（32 TC）；vitest **91 文件 / 1538 例**全绿、typecheck 三份全清；code-review P1-1（缓存键）/ P1-2（off 档七条）已修并变异验证。已知后效：**回 enforce 前先收名单**（否则提交 422）；特例期训练营球员**不记场次 XP**（先观察）；CSV 164 名非平台球员暂不处理。生产迁移现状：本仓已到 `0065`。

## [v6.33.0] · 转会名单公开标价：最低报价转私密 + 广告板报价入口（2026-10-05）

**已上线**（2026-10-05 发布，用户令「发布」；提交 `480a1ee` docs(spec) + `a755cc7` feat 后端 + `fb451b8` feat 前端 + `cbdd7ba` test + `4e5d9f9` docs 收口）。**执行序（顺序未反）**：① 迁移 `0065_list_price.sql` 先 apply 生产——`Executed 3 commands in 3.03ms`，回读台账 head = `0065_list_price.sql`、`players` 四列在场、名单行 2 行全回填（B. Mbeumo 18 / O. Marmoush 18）；② `git push origin main`（`b9cd7a9..4e5d9f9`）触发 CF Workers Builds，约 1 分钟出 Version `69041242-34b7-4500-a6da-269586c0c9d3`（@2026-10-05T07:06:53Z）；③ **bump KV `cache:epoch:public` `17 → 18`**（`/api/market/transfer-board` 与球员详情走 `cachedJson` 代际键，旧形状载荷最长存活 24h）。**上线回读**：线上 `index-Cd07juMr.js` / `index-gjLtH_Uw.css` / `MarketAdBoardPage-MRvBa5OE.js` 与本地构建 sha256 逐字节一致，线上 JS 版本串 `6.33.0`、广告板分块含 `adb-bid-btn`；`/api/health`、`/api/market/transfer-board`（2 行 `listPrice:18`）、`/api/players/67`、`/api/players/142` 全 200 且**全端点 0 处 `minOfferPrice`**（详情只出 `listPrice`）；`GET /api/players/:id/offer-settings` 与 `/api/admin/brands` 匿名 401。生产迁移现状：本仓已到 `0065`。

用户 brainstorming 拍板五条：进转会名单**必填公开标价**（`[1, 1.5×违约金]`）；**最低报价（底线）全系统私密**（公开面零下发）；**同意线改钉标价**（无标价回落底线），达线且对方开了自动同意才直接成交；**低于标价视为砍价**走人工谈判、**低于底线恒自动拒**；广告板卡脚加**圆形报价按钮**（点了直接发起报价，预填标价）。

新增：`players.list_price`（迁移 0065，回填在名单行）+ `GET /api/players/:id/offer-settings`（本队教练，五字段）+ `autoRespondKind` 双线化 + `AdBidModal` 报价弹层 + 报价区块「砍价」徽标；`transferPriced` 改由 `list_price` 派生。收口：公开面（transfer-board / 球员列表与详情 / 报价列表与谈判桌 / 通知 / 审计）全部只出 `listPrice`，「低于对方底线」类文案不再带数额——`minOfferPrice` 仅活在私密端点。测试计划 `docs/test-plans/v6.33.0-list-price.md`；验收 vitest **90 文件 / 1521 例**全绿（净 +20）、typecheck 三份全清、build（`index-Cd07juMr.js` 609.94 kB / gzip 193.74 kB）、e2e **22/22**、变异 **M1–M7 全命中零空转**；code-review P0 0 / P1 0（登记不改 6 条）。

## [v6.32.0] · 转会台页签化 + 市场域信息架构重排（2026-10-05）

**已上线**（2026-10-05 发布，用户令「修复roadmap，随后发布」；**零迁移、零生产数据写**，直接 push 触发 CF 自动部署：push `3306bb3..ed9503d`（7 枚 = v6.32.0 五枚 + v6.30.0 标题补写 1 + 本条）⇒ 生产 Version **`96436df1-de82-4007-bde6-ac59961078a0`** @2026-10-05T03:39:54Z；**上线回读抓到队徽真源缺陷**（transfer-board `logoKey` 全 null——本平台 `clubs.logo_key` 全仓无人写、生产全 NULL，真源在 tour 库）⇒ 热修 push `ed9503d..b9cd7a9` ⇒ 生产 Version **`292d0884-acc2-474f-a2e3-20859fc7376a`** @2026-10-05T03:49:42Z（两次均 Source `wrangler`；CF API 经 `curl --resolve api.cloudflare.com:443:<IP>` 直连取证——wrangler/Node 侧 DNS 间歇失败，`GET /accounts` 订正记录里的 account id 笔误「…a01ccec」→「…a01cec」）。**上线回读**：`/api/health` 200、SPA `/market/desk` 200、入口 `assets/index-C9J6_5Ha.js` sha256 `febfd58d…81cd` 与本地 6.32.0 构建**逐字节一致**（含版本串 `6.32.0`、「自动挂牌」在场 /「自动成交」零命中）、`GET /api/market/transfer-board` 行带 `logoKey` 且热修后与 `/api/clubs` 同源同值（巴黎圣日耳曼 `team/1/1788576927024.png`）、worker 代码直读含 `club_logo_key`→改含 TOUR_DB 合并。push 前硬闸：typecheck 三份全清 + vitest **90 文件 / 1501 例**全绿 + build（`index-C9J6_5Ha.js` 608.69 kB / gzip 193.37 kB，CSS `index-CDCHJSke.css` 与 6.31.0 同 hash=零 CSS 改动）。

缘起：用户 brainstorming「当前我的转会台页面乱，探索整治方案」；三问拍板 = **更大信息架构重排**（页签化 + 跨页归属去重）/ **页签自带计数**（删独立待办速览条）/ **流水线说明条精简一行**。**IA 裁决矩阵**：全站成交公示归情报页（不动）；我队转会队史归球队中心转会页签（唯一历史台账，不动）；**转会台删「已落定的谈判」表**（工作台只放进行中，工资随球员合同页签可查）；出价历史（per-listing）与议价时间线（per-offer）属上下文视图保留；我发出的报价留在报价页签（页签名「收到报价」改「报价」，box in/out 次级切换保留）。

**转会台页签化（/market/desk）**：三区块（签约谈判 / 收到报价 / 我的出价）同屏长滚动改真页签——照球队中心 dossier-tabs 模式（`.seg.dossier-tabs` + `?tab=` + 条件挂载），页签自带计数（谈判 = active 会话数 / 报价 = in+out 两侧 pendingMine 之和 / 出价 = active 出价数，与区块同 query 键缓存复用），待办速览条与滚动对齐机制（rAF 轮询 + wheel/touch/keydown 三重监听约 35 行）退役；`?tab=` 语义全保留（nego/offers/bids + mine alias + 非法值回落不改写 URL），SideOps 深链与旧路由换址不受影响。清理：money() 三份实现收口 shared、死类名 `.row-open` 删除、谈判规则展示常量具名（轮次 3 / 训练营 0.75/5）、`useMyNegotiations` 收编 `lib/queries.ts`（`qk.myNegotiations`）。

**广告板顺带（同轮用户令）**：说明行「出价达线自动成交」→「出价达线自动挂牌」；球员卡左上角队徽接 R2 实图——`GET /api/market/transfer-board` 在 `cachedJson` 计算体内按本页名单 `club_id` 去 **TOUR_DB `team.logo_key`** 点查并合并进载荷（照 `/api/clubs` 同口径；本平台 `clubs.logo_key` 全仓无人写、生产全 NULL——**首发版误读休眠列被上线回读抓出，热修订正**），BoardCard/FeaturedCard 的 TeamLogo 接实图、无徽回队名哈希色块（缓存 TTL 内旧载荷缺字段时同样回退，优雅降级）。

**验收**：typecheck 三份全清、vitest **90 文件 / 1501 例**全绿（基线 89/1491，净 +1 文件 / +10 例）、build 成功（`index-CnFbuqoy.js` 608.69 kB / gzip 193.37 kB）、e2e **22/22**（⑤c 重写后全过、⑫ `/market/desk` 375 零溢出）；变异 **M1–M8 全命中**（M8 首轮空转——前端测试 mock 不到后端映射，补 `tests/ad-board.test.ts` logoKey 双侧断言后命中；M4 证明 search 串断言抓不住同址重复导航，改用 `useLocation().key` 集合探针）；code-review P0 0 / P1 1 已修（settled-only 教练见空区块 → 判空改按 active）。测试计划 `docs/test-plans/v6.32.0-market-desk-tabs.md`。

## [v6.31.0] · 转会广告板：转会名单球员一览 + 着重度预留（2026-10-05）

**已上线**（2026-10-05 发布，用户令「发布」；**迁移 `0064_ad_board.sql`**——发布顺序硬约束执行到位：先 `npm run db:migrate:remote` apply **@2026-10-05T02:08Z**（5 commands / 107.87ms；回读四件套全过 = `players.transfer_listed_at` 列在场（`pragma_table_info` 计数 1）/ `player_promotions` 表在场且 **0 行**（写路径本版不实现）/ `idx_players_transfer_listed` 在场且 SQL 与迁移逐字一致（`CREATE INDEX idx_players_transfer_listed ON players(id) WHERE transfer_listed = 1`）与 `idx_player_promotions_active` 在场 / `d1_migrations` 台账 head = `0064_ad_board.sql`（前两行 0063/0062）；生产转会名单存量 1 人且 `transfer_listed_at` 全 NULL（历史不回填的既定口径））再 push `dc36971..3306bb3`（10 枚 = 本版 spec 1 + A/B/C/D 四枚 + 增补四枚 + 既存 v6.30.0 回写 1）触发 CF 自动部署 ⇒ 生产 Version **`366b2439-51e3-4e46-9d6b-7e51082ded1c`** @2026-10-05T02:09:07.039901Z；上线回读：`/api/health` 三检 ok（d1/tour_db/kv）、入口 `assets/index-CNaikSfR.js`（sha256 `87ece5e5cce8908235762ad1f0929e5c148e80ee7b20ed3f5c5d233b5c94e089`，608517 B）/ CSS `assets/index-CDCHJSke.css`（sha256 `037c245f4092c11c89f5f33a5bc929e943259f4369ab6b5b70a2317c1d78db66`，63810 B）/ 懒加载 `assets/MarketAdBoardPage-DqAVvjIt.js`（sha256 `2124274231a280dad044b5fc18173b6db638c94dbc4951a67bfb9614c61e5c2e`）与本地 `web/dist` **逐字节一致**、worker 代码直读（CF API `workers/scripts/whl-club/content/v2`，1586323 B）含 **`market-transfer-board:${limit}`（旧键形 `${limit}:${bucket}` **0 处**，P1-2 机制修复确已上线）**、`shuffleWithSeed` ×3 / `transferBoardBucket` ×3 / `TRANSFER_BOARD_ROTATE_MS` ×2、公开端点 `GET /api/market/transfer-board` 200（`total=1`、18 字段、样本 `Bryan Mbeumo` id 67 emphasis 0 `minOfferPrice` 18）/ SPA `/market/board`·`/market`·`/players`·`/clubs` 全 200、需登录端点一律 401（`/api/admin/overview`·`/api/admin/clubs`·`/api/admin/config`·`/api/admin/shop/orders`·`/api/admin/m0`·`/api/admin/market/pause-bids`）、**生产真实浏览器探针（Playwright + 系统 Chrome，临时脚本不入库）10/10**：板页说明文案逐字一致 / 1 张普通卡（`Bryan Mbeumo` · 最低报价 18.00 m）/ 「换一批」按规则隐藏（普通档 < 2）/ `/market` teaser 在场 + 文案逐字「各队公开挂出的转会名单。」+ 入口 `查看全部 1 人 →` → `/market/board` + 1 张迷你卡 / 375 宽零横向溢出（scrollWidth 360 / client 375）/ 零未捕获前端错误）。**生产数据现实（如实登记）**：转会名单只有 1 人 ⇒ 广告板只 1 张卡、「换一批」不渲染、置顶带整条不渲染；`player_promotions` 0 行 ⇒ 着重度恒为普通档，三档五杠杆要等「列入转会名单时的有偿选项」付费写路径落地才有真实数据。用户令：brainstorming「增加一个页面用于展示各队列入转会名单的球员（类似广告板），预留不同着重度的展示接口」；四问答复 = 只收转会名单（`players.transfer_listed = 1`，与既有「在售市场」的 listings 挂牌竞价互补）/ 着重度是为「**列入转会名单时的有偿选项**」预留的接口（付费流程本版不实现）/ 转会中心新增项但插入位置不在最末、并在 `/market` 的转会区之上加小卡片兼作入口 / 名单内球员最低报价公开。视觉定稿（brainstorming 视觉伴侣四屏 + 用户四选）：结构 = **顶部置顶带 + 卡栅格**、置顶区**纵向堆叠**（几条通栏就几行）、小卡片 = **三张迷你卡**、命名「**广告板**」、着重度**三档五杠杆**（0 普通 / 1 推荐 = 金色左轨 + 名字加粗 + 橙角标 / 2 置顶 = 金边 + 淡金渐变底 + 名字加大 + 金角标 + 置顶带内通栏；「预留更醒目手段」即这套可扩展的杠杆表）。**迁移 `0064_ad_board.sql`**：`players.transfer_listed_at TEXT`（进名单首戳；重复保存保留原戳；退出名单置 NULL；**历史存量不回填**）+ 表 `player_promotions`（`id/player_id/club_id/tier/cost/ref_type/ref_id/starts_at/ends_at/created_at`，有效 = `ends_at > now`；**本版只有读路径**，付费写路径形态写进设计文档）+ 部分索引 `idx_players_transfer_listed ON players(id) WHERE transfer_listed = 1` + `idx_player_promotions_active (player_id, ends_at)`。**打戳**：`src/worker/offers.ts` 的 `setOfferSettings` 单条 UPDATE 加 `transfer_listed_at = CASE WHEN ? = 1 THEN COALESCE(transfer_listed_at, <now>) ELSE NULL END`，第 5 个绑定值与 `transfer_listed` 同值（复用入参、不新增形参），守卫与审计零改动。**端点 `GET /api/market/transfer-board`**（`src/worker/routes/market.ts`）：公开 + `assertPublicRate('market')` + `cachedJson`（缓存键**含 limit**，TTL 走 market 1h；写路径 `/api/players` 前缀自动 purge 全部公开 scope ⇒ 改报价设置后立即新鲜，不陈旧到 TTL）；只收 `transfer_listed = 1`；`LEFT JOIN clubs` 取队名、`LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1` 取违约金；`ROW_NUMBER()` 取每球员**现行最高档**推广（同档取最晚到期，过期不算，tier 越界按 0）；`ORDER BY 着重度 DESC → 挂出时间 DESC（NULL 当最旧）→ id DESC`；`COUNT(*) OVER ()` 出 `total`（与 limit 解耦）；limit 默认与上限 200、非整数 / ≤0 / 空串一律回落默认；行 19 字段含 `minOfferPrice`（**数值公开**，用户拍板）、`releaseFee`、`listedAt`、`emphasis`、`emphasisUntil`、`notForSale`、`transferPriced`。**前端**：新公开页 `/market/board`（`web/src/pages/market/MarketAdBoardPage.tsx` = h1「转会市场 · 广告板」+ `MarketNav` + 说明行 + 单面板：置顶带（**无置顶整条连标题一起消失**）→ 卡栅格 → 截断提示「共 N 人在名单，这里展示前 M 人」→ 状态图例；空态「现在没有球队挂出转会名单。」）；`MarketNav` 五项 → **六项**（「广告板」插在「在售市场」之后）；`/market` 顶部 `AdBoardTeaser`（三张迷你卡 + 「查看全部 N 人 →」，**无数据整块不渲染**，用 `compareDocumentPosition` 钉在转会区之上）；`web/src/lib/datetime.ts` 新增 `fmtAgo`（今天 / 昨天 / N 天前，按**显示时区**日历日算差，页面不许自算相对时间）；`web/src/styles.css` 新增 ⑨ 区块 `.adb-*`（≤820/≤640 折叠 + reduced-motion；**不引新色**——淡金底取既有 `.badge.gold` 底色 `#f5e8cf`）。**测试**：`tests/ad-board.test.ts`（9 例：名单口径 / 排序三键 / 着重度最高档与过期与越界 / limit 五态 / 行字段 / 缓存与写后新鲜度）、`tests/offers.test.ts` 打戳 3 例（首戳 / 保戳 / 清戳）、`web/src/pages/market/MarketAdBoardPage.test.tsx`（14 例）、`web/src/lib/datetime.test.tsx` fmtAgo 4 例（含「按日历日不是 24 小时差」与换时区口径）、`tests/mobile-baseline.test.ts`（`TSX_BASELINE` 52 → **77** 重设 + MarketNav 六项 + TC-SWP-05 改按 `@media` 块配平取正文，不再尾切）、e2e 新增 **⑤e 场景**（21 → **22** 场景：板页两区 + 置顶带标题两段 DOM + 截断 + 图例 + teaser 位置与空数据双态；⑫ 375 宽零溢出 29 路由）。验收：typecheck 三份全清、vitest **89 文件 / 1482 例**全绿（v6.30.0 基线 87/1452，净 +2 文件 / +30 例）、build 成功 3.86s、e2e **22/22**；测试计划 `docs/test-plans/v6.31.0-ad-board.md`（A 14 / B 4 / C 10 / D 6 / E 6 共 40 TC + 变异 M1–M24）；变异实跑 21 条 **20 条变红且红的都是对应断言**（M1–M14、M16–M20、M22、M24），M11 经 17 类输入实测证明**等价**（`Number('')` 已是 0，被 `parsed > 0` 拒掉，删 `trim` 判断行为不变）、M15 为 SQLite 等价变异（NULL 排序）、M21/M23 只能靠 e2e 375 视口验（已由 ⑫ 全路由零溢出兜底）；判级 **minor**（新增用户可见能力，零跨仓）。设计 spec `docs/superpowers/specs/2026-10-05-transfer-ad-board-design.md`。

**增补（同日收口）· 普通档轮换 + 手动「换一批」**：用户追问「列入转会名单但没有有偿提升优先级的，每次展示顺序随机？」⇒ 三选一答复「**1，也支持用户手动按键变换顺序**」。落地：新纯函数模块 `src/core/ad-board.ts`（`TRANSFER_BOARD_ROTATE_MS = 5 * 60_000`、`transferBoardBucket(nowMs) = Math.floor(nowMs / TRANSFER_BOARD_ROTATE_MS)`、种子化 `shuffleWithSeed`（mulberry32 + Fisher–Yates，返回新数组）—— **必须种子化**：同一份缓存值会被多个 isolate / colo 读到，它们必须算出同一排列，否则同一时刻不同 isolate 顺序不一致、用户刷新一下顺序就变）；**洗牌放在 `cachedJson` 之后、缓存键只有 limit**（`` `market-transfer-board:${limit}` ``）—— 桶号若进键，本端点重读会从 `86400÷1h = 24` 抬到 `86400÷5min = 288` 次/天/形状/colo（**12 倍**，code-review P1-2 判为读量预算违规后改成「洗牌出缓存」；仓库预算模型见 `src/lib/cache-policy.ts:5-7`，`roster` 就是为此拉长 TTL 的先例），出缓存后按 `emphasis !== 0` / `=== 0` 分流并**只洗普通档** `[...paid, ...shuffleWithSeed(unpinned, transferBoardBucket(Date.now()))]`（缓存值不可原地改，必须新建数组）（付费档保持 SQL 序 ⇒ 付费位相对位置与「按到期时间排」语义不受轮换影响；SQL 尾键 `id DESC` 仍是洗牌输入序，保证同桶内跨 isolate 输入一致）；页面说明行改 flex 行 + 「换一批」按钮（`ShuffleIcon` 手绘线稿，仅当普通档 ≥ 2 时渲染），点击用 `Math.random()` **本地**重排普通档（最多试 8 次取第一个与当前不同的排列，兜底 `reverse()`；纯客户端、不打端点、不动付费档），状态 `manualIds` 只存 id 序列并以「长度相等 ∧ id 集包含」守卫，名单增减即回落服务端桶序（重挂载/重取数也回落，属预期）。测试：`tests/ad-board.test.ts` 9 → **14 例**（新增轮换 3 + core 2）、`web/src/pages/market/MarketAdBoardPage.test.tsx` 14 → **18 例**（含「名单变短回落」「名单变长回落」两条守卫用例）、e2e **⑤e 扩夹具**（第 4 行普通档姆巴佩 + route 按 `?limit=` 切片 + 栅格 2→3 + 「展示前 4 人」+ 换序断言）。验收：typecheck 三份清、vitest **89 文件 / 1491 例**全绿（本增量 +9 = 后端 5 + 前端 4）、build 成功 9.95s、e2e **22/22**；变异 M25–M35 **11 条全红**（不洗牌 / 连付费档一起洗 / **桶号进缓存键（P1-2 回归哨兵）** / 洗牌不种子化 / 桶长写错 / reshuffle 空转 / 按钮守卫放宽 / SQL 尾键翻转 / 点击只回落 / 守卫去长度项 / 种子与桶号脱钩；**M34 首轮未逮住**——只测「变短」时 id 集检查已覆盖该分支，补「变长」用例 TC-ADB-69 后判红）；测试计划 `docs/test-plans/v6.31.0-ad-board.md` §7 已按实跑回填（TC-ADB-56–69 + M25–M35 表 + §7.5 执行结果 + **§7.6 code-review 处置**：P0 0 / P1 2 / P2 5，P1-2 改机制、P2-3 `:focus-visible` 与 P1-1/P2-4 文档笔误已修，P2-1 只换顺序不换成员、P2-2 `reshuffle` 闭包语义、P2-5 未跟踪杂物登记不改）；spec 增补 §3.3 排序与轮换口径（§0 裁决第 10 条）。版本仍为 **6.31.0**（同一未发布版本内的增补）。

## [v6.30.0] · 球队中心页签化 + 三类施工开窗闸 + 两表列集重定（2026-10-04）

**已上线**（2026-10-04，用户令「发布」；**零迁移**——本版不碰 `src/db/migrations/`。发布顺序硬约束执行到位：先 `npm run db:migrate:remote` apply 并行流 `0063`（v6.29.0）**@2026-10-04T14:55:43Z**（16 commands / 18.07ms；回读 head 已记该行、`offers.season`/`window_seq` 放开可空、`fund_holds_offer_guard` 触发器与 5 个索引在场、`offers`/`offer_events` 两表 0 行不变）再 push `03b0513..dc36971`（13 枚）触发 CF 自动部署 ⇒ 生产 Version **`b4face69-61fd-4bce-bf5b-b1880552014a`** @2026-10-04T14:57:00.774Z；上线回读：`/api/health` 三检 ok、入口 `assets/index-KVVKruya.js`（sha256 `ebf398e17240fbad938e817dc21d520e3edafce42b0a5afa8a383550245b90fa`）/ CSS `index-DSXwwKYB.css`（sha256 `cd5cfbcfd1ed1132e8df9cee0919dbc82510378a9ca5a1c55b6d277420a3e467`）/ 懒加载 `ShopPage-bcm43L85.js`（sha256 `9bc07ad385a9711d3c2a9439998e3ff672959729db6cec3bb2a674cbe72fe181`，含「转会窗口没开，开窗后才能施工」）与本地 `web/dist` **逐字节一致**、线上版本串 `6.30.0`、线上 CSS 含 `.transfer-status`、worker 代码直读含 `no_window`/`transferPriced`/`transfer_listed`/`not_for_sale`/`markerOf`、SPA 四路由 200、需登录端点一律 401、公开 `GET /api/players` 列表行已带 `transferListed`/`notForSale`/`transferPriced`）。用户 brainstorming「探索球队中心页面信息整理，现在平铺页面太长」+ 追加「顺便修复：球场扩建和升级设施需要开窗才能做」；四问答复 = 自家球队中心优先 / 页签式（Tab + `?tab=` 深链）/ 可激进删减（清单逐条确认）/ 桌面与 375 都要好用。**A 段（球队中心页签化）**：`web/src/pages/ClubDetail.tsx` 544 → 156 行只留页头 + 页签壳（`.seg.dossier-tabs` `role=radiogroup`；自家 `OWN_TABS` 五个 = 工作台/阵容/转会/战绩/主场，访客 `GUEST_TABS` 三个 = 阵容/转会/战绩；默认落第一个可见页签，非法值与无权页签**回落且不改写 URL**；页头常驻队徽·队名·分级/CPU/排名徽章，自家多一行状态 资金·一线队人数·当前窗口），原教练台 `web/src/pages/club/CoachPanel.tsx`（813 行）拆成 `parts.tsx`（共享小件）+ `SquadTab`/`TransfersTab`/`ResultsTab`/`VenueTab`/`DeskTab` 五个页签并删除；**按需加载**——常驻只有 detail/standing/me-club 三个请求，其余端点只在激活页签挂载（自家首屏 4–5 个 vs 改造前恒定 7 个）。删减清单落地：① 删消费中心入口大卡（降级为主场页签一行「去消费中心经营设施 →」）② 删 `.card.club-head` 三格卡（并进页头状态行）③ 删位置分布档内细位明细（四档改一行文字 `.club-position-line`）④（总身价→青训人数）**用户否决、保留总身价** ⑤⑥ 两表列集重定 ⑦ 近期事件表默认折叠 `<details>` ⑧ 保留年龄直方图/CA 堆叠/效力年限图/联赛排名/近期战绩/禁令 banner/页头徽章/名单 >100「查看更多」。**B 段（三类施工开窗闸）**：`expandStadium`（`src/worker/stadium-ops.ts:117-119`）/ `upgradeStadiumTier`（`:189`）/ `upgradeFacilityLevel`（`:255`）在参数与状态校验之后、`payAndRefund` 之前插 `getOpenWindow` 闸 → 409 `no_window`（文案「转会窗口没开，现在不能扩建球场 / 升级球场档位 / 升级设施」，参数非法仍先报 400）；`GET /api/club/stadium/build-info` 下发 `open: win !== null`（与三闸同源），前端 `web/src/pages/shop/venueCards.tsx` 三类按钮按 `open` 置灰 + 卡内提示 `CLOSED_BUILD_HINT`。**C 段（两表列集重定 + 转会状态图标）**：新建 `web/src/lib/club-columns.tsx` 共享列系统——阵容名单 11 固定列（标记/号码/UID/姓名/年龄/位置/CA/PA/违约金/工资/转会状态）+ 注册名单 11 固定列（**分配最左** + 其余同序去掉转会状态）+ 可选列池 16 项（球员库 `COL_DEFS` 去掉工资/解约金；默认全不显示；`?cols=` / `?regcols=` 两个键分开、与 `?tab=` 互不干扰）；新建 `web/src/components/StatusIcons.tsx` 手绘 SVG 线稿四态（拍卖锤 挂牌中 > 清单 转会名单 > 欧元 已标价 > 锁 非卖品；单元格只出图标、全称走 `title`/`aria-label`，窄屏靠表下一行图例）；后端 `GET /api/players` 列表行补 `transferListed`/`notForSale`/`transferPriced`（**`min_offer_price` 数值绝不下发**）、`GET /api/club/squad` 补可选列所需字段（`marker` 走 `markerOf(base_ca ?? ca, pa, growable, ca)`，与详情页逐字同口径）；球员库改从共享模块取渲染器（import + re-export，列集与行为零变化）；窄屏粘性列（阵容 ≤760 钉「标记+号码+姓名」、注册 ≤640 钉「分配+姓名」，`:has()` 认表不误伤同 class 的主场战报表）。验收：typecheck 三份全清、vitest **87 文件 / 1452 例**全绿（v6.29.0 基线 85/1419，本版净 +2 文件 / +33 例）、build 成功 3.99s、e2e **21/21**（⑨ 球队页三视口逐页签、⑮ 粘性几何、⑫ 375 宽零溢出 28 路由）；测试计划 `docs/test-plans/v6.30.0-club-center-rework.md`（A 13 / B 8 / C 12 共 33 TC + 变异 M1–M18）；判级 **minor**（新增用户可见能力 + 三类施工收紧，零迁移零跨仓）。同工作区并行流 v6.29.0「关窗期报价与意向单 + 消费提交开窗闸」已由另一会话收口（两版共用 `409 no_window` 口径、分枚提交互不夹带）。

## [v6.29.0] · 关窗期报价与意向单 + 消费提交开窗闸（2026-10-04）

**本地收口待发布**（迁移 `0063` 生产未 apply，发布顺序 = 先 `npm run db:migrate:remote` 再 push；push 即 CF 自动部署上线）。同工作区并行流「球队中心页签化 + 三类施工开窗闸」经用户裁决另立 **v6.30.0**，两版共用 `409 no_window` 口径、分枚提交互不夹带——本版只落消费工单闸，施工三闸（扩建球场 / 升级档位 / 升级设施）归 v6.30.0。用户令：「消费项目也是开窗才能做，同时未开窗时开放报价，如果成交挂为意向单，开窗时提醒双方。」**范围裁决**（AskUserQuestion）：① 消费与转会两块都改；② 意向单开窗后**只提醒、卖方手动确认**（不自动推进、不直接过户；卖方开窗后手动再点一次同意才生成挂牌，买方随时可撤、卖方开窗后可放弃）；③ 消费闸含五类商品与设施升级同口径（本版落消费工单闸）。

**转会侧（放开关窗期报价）**：`placeOffer`（`src/worker/offers.ts:117`）与 `counterOffer`（`:252`）删掉窗闸；`acceptOffer`（`:563`）按窗态分流——窗口开着照旧 `accepted` + 立即挂牌，窗口关着落 `offers.status='intent'`（**意向单**：不挂牌、不动兄弟 pending 单、买方冻结继续保持），关窗期达线自动同意同样只落意向单（否则会写出 `season`/`window_seq` 为 NULL 的挂牌）；`expireStaleOffers`（`:628-691`）删掉「窗关即过期」条件，只剩球员状态变化自愈（过期 reason 不再有 `window`）。**一球员一意向单两处硬锁**：`enterIntent`（`:524`）带 `NOT EXISTS` 原子闸（已有意向单时同意另一条 pending → 409 `intent_exists`）、挂牌端点（`src/worker/routes/market.ts:240`）同码拦下（窗口开着也不给挂）；非卖方确认 409 `intent_seller_only`、卖方无窗确认 409 `no_window`。**开窗联动**：`src/worker/window-machine.ts:206-224` 开窗批提交成功后双方各排一条 `offer_intent_window_open`（提醒失败只吞异常，不影响开窗已提交）；卖方确认走既有挂牌链路（归到当前开着的窗 + 挂牌 + 兄弟单 `offer_expired`(reason `sold`) + hold 转正 + 领先出价 + `confirm` 事件 + 买方 `offer_intent_confirmed`），买方撤回（`withdraw`）与卖方放弃（`reject`）都释放冻结并给对方 `offer_intent_closed`（`data.action` 区分）；通知模板 4 个（`offer_intent_created` / `offer_intent_window_open` / `offer_intent_confirmed` / `offer_intent_closed`）。

**消费侧（关窗期收紧）**：`POST /api/shop/orders`（`src/worker/routes/shop.ts:97`）在花费逻辑前、403 绑定检查后加 `getOpenWindow` 闸，关窗 409 `no_window`；GET 读路径、管理端代录（external 两步流）、工单审批与拒绝都不受影响（存量 pending 单关窗后照常审批）；档期、冠名等既有动作口径不变。

**迁移与前端**：`src/db/migrations/0063_offers_intent.sql` 重建 `offers` 与 `offer_events`（`season`/`window_seq` 放开可空 + `offer_events.kind` 注释增 `intent`/`confirm`），`fund_holds_offer_guard` 触发器及 4 条索引（`idx_offers_seller` / `idx_offers_buyer` / `idx_offers_player` / 唯一部分索引 `idx_offers_active_pair`）逐字复原，`tests/d1.ts` 的 `MIGRATION_FILES` 显式清单加登记。前端：`OffersSection.tsx` 徽标「意向单·等开窗」+ 谈判桌按角色分派动作（卖方确认挂牌 / 放弃，买方只有撤回）、`SideOps.tsx:696` 报价按钮关窗不再置灰、`MarketDeskPage.tsx`（`OFFER_STATUS_FILTERS` 加 `intent`、「我收到的」页签 `intentsMine` 徽标）、`ShopPage.tsx` 与 `venueCards.tsx` 关窗态提示、`web/src/lib/api.ts`（`OfferStatus` 加 `'intent'` + `intentsMine`）。

**验收与测试**：typecheck 三份全清、vitest **85 文件 / 1419 例**全绿（含并行流用例）。测试计划 `docs/test-plans/v6.29.0-offer-intent-shop-gate.md`（TC-INT 15 / TC-PEND 2 / TC-WIN 1 / TC-D 5 / TC-UI 6 / TC-MIG-03 + 变异 10 条）；新文件 `tests/offer-intents.test.ts`（15 例）、`web/src/pages/market/desk/OffersSection.test.tsx`（6 例）；`tests/shop-orders.test.ts:626` TC-D01–D05、`tests/window-machine.test.ts:139`、`tests/offers.test.ts` 改写两例；`tests/weather-forecast.test.ts` 的 `MIGRATION_FILES` 登记校验由「尾部锁死 0062」改为版本无关（取 `src/db/migrations` 目录按名排序最新一枚比对，加 0063 后原断言必红，已验证非空转）。判级 **minor**。实现动线：后端报价链 / 测试计划与用例 / 前端三个 subagent 并行（文件面不相交），主会话集成验收与提交。

## [v6.28.0] · 影响力体系：级别系数 + 死忠每场演化（2026-10-04）

**A 段（公式）**：球队总影响力改为 **(队壳 + 阵容) × 级别系数 + 奖励分**——级别系数进 config 新键 `influence_tier_coefs`（默认 `{"premier":1.2,"second":1.0}`，逐档兜底、坏 JSON 回出厂值不炸上座钩子）；级别一律按 `deriveClubTier` 报名派生（**不读** `clubs.league_tier` 休眠列），未定级/未报名 → 系数 1.0（CPU 队即此情形）。`teamInfluence(stadium, playerSum, tierCoef)` 第三参**必填**（防漏传静默降级）；上座 demand 的对手系数与死忠目标同源（都用同一 `homeInfluence`），管理端详情/CPU 向导预览/seed-ops 用同一套系数（seed-ops 不拿表单级别当系数）。**B 段（死忠每场演化）**：赛果确认钩子④里死忠即时演化一次（比赛日体感），与上座/收入同批原子落账，系数走 config 新键 `fans_grow_rate_per_match` / `fans_drop_rate_per_match`（默认 `0.2` = 窗系数 `0.5` × 0.4），幂等闸仍是 `match_attendance` 主键；关窗批对**本窗有主场场次**的队不再演化（防双记账，现值即窗末值），只对无主场场次的队按窗系数兜底演化一次；窗级事件信号 `fan_mood` **按窗一次**、放在演化之后（不随每场重复、防放大）。迁移 `0062_stadiums_fans_window_start.sql`（`stadiums` 加列 `fans_window_start`，本窗开始时的 fans）：关窗批每队无条件把快照推进到窗末值，冠名对赌的 `fansGrowth` 按「窗初快照 → 窗末」算（拿现值当基准会把增长率算成 0）——**发布顺序硬约束：先 apply 0062 再 push**。**C 段（生产数据批，独立等授权）**：`scripts/prod-20261004-influence-recalc/`——四步 CLI（snapshot/plan/apply/verify）+ 纯函数重演引擎（逐因子镜像运行期口径）+ 20 队图值 `values.json` + 交叉验证闸 `tests/influence-recalc-engine.test.ts`（19 例：常量镜像、纯函数矩阵、钩子④落库值对拍、链式推进、账本链重放）；apply 默认只打印、`--yes` 才先备份再逐文件执行（**已执行**，见文末）。干跑（初值一律 1800 口径）：fans 28800 → 52024.14、上座 699921 → 972885、比赛日收入 104.96 → 145.96、账本总额 919.16 → 960.16；14 场需求≥容量走 sell_out_fill。执行顺序：**0062 → 代码上线 → `apply --yes` → `verify`**；皇马（`243`）奖励分由用户补值为 0（`values.json` 落 `bonus_source: "given"`，plan 待补条目清零）。**D 段（管理端导航）**：侧栏 12 项归四域（赛事运营 / 球队与名册 / 转会与经营 / 系统，总览不套组标题、`to=` 全不变），「消费」改「消费工单」；**E 段（总览）**：补「待审消费工单」（`shop_orders.status='pending'`）与「待选事件」（`status='pending' AND event_type='choice'`，即发型残留 pending 不计）两卡（6 → 8 张）。评审修复：两处影响力构成文案（教练台主场档案卡 + 管理端球场卡）改为「（球员 + 队壳）× 级别系数 + 奖励分」——旧加法文案在系数 ≠ 1 时与总数对不上，payload 补 `influence.tierCoef` + `web/src/lib/influence.ts` 格式化。测试计划 `docs/test-plans/v6.28.0-influence-system.md`（A–E 五块 42 TC + 变异 M1–M17）；验收：typecheck 三份全清、vitest **82 文件 / 1369 例**全绿（v6.27.0 基线 78/1331，净 +4 文件 / +38 例）、build 成功、e2e **21/21**（⑫ 375 宽零溢出扫描 28 路由）；变异 M1–M17 十九条全命中（M9 含 a/c/d 三变体：丢 mood / 顺序错 / 顺序错+放大）。判级 minor（新增用户可见能力；无跨仓消费）。**已上线**（2026-10-04，用户令「1发布2执行 3皇马奖励分是0」）：迁移 `0062` 先 apply @11:21:42Z（回读：`fans_window_start` 列 `REAL NOT NULL DEFAULT 0`、16 行 `= fans`）→ push `2736413..03b0513`（6 提交）⇒ 本仓 Version **`7ecb15a1-a8f6-4b16-974c-f810bed52370`** @2026-10-04T11:22:42.102Z（deployment `22d383f5-07d1-4632-973e-57067c911612`）。上线回读：`/api/health` 三检 ok；入口 `assets/index-C_-lc4t5.js`、CSS `index-d1JcVntj.css`、懒加载块 `AdminLayout-DlR4_BEm.js` / `OverviewPage-DC5o3RDb.js` 的 sha256 与本地 `web/dist` **逐字节一致**（入口含版本串 `6.28.0`、CSS 含 `.admin-nav-group-title`）；线上 worker 代码（CF API `/content/v2`）含 `influence_tier_coefs` / `fans_window_start` / `fans_grow_rate_per_match`；`/api/admin/*` 未认证一律 401。**C 段数据批已执行**：`apply --yes` @11:26:03.237Z（先全量备份到 `backup/2026-10-04T11-25-23-869Z/` + 落 `applied.marker`，**293 条语句 / 5 个 SQL 文件**全部 `success: true`）→ `verify` **9/9 PASS**；独立通道（CF REST D1 query）回读：fans 合计 **52024.143496**（16 队，`fans_window_start` 同值）、上座 **972885**、比赛日收入 **145.96**、账本总额 **960.16**，16 队壳/奖励分与 `values.json` 图值逐字相等、4 支 CPU 队无 stadium 行；回滚走 `sql/99-rollback.sql`（320 条逐行还原，含新列）。**执行后已 purge 公开读缓存**：本批经 `wrangler d1 execute` 直写 D1、绕过 worker 写路径 ⇒ `purgePublicCaches` 不会自动跑，而公开缓存新鲜度靠写路径 purge（TTL 只是兜底：`fixtures` 1h / `clubs` 24h），故把代际键 `cache:epoch:public` 由 **6 → 7**（CF REST，与任一管理端写操作同效）；purge 后走公开读路径端到端对拍 `GET /api/fixtures`（tournament 1/2/3 × round 1–7，浏览器 UA）取到 **78 场**有上座场次，逐场与 `plan.json` 的 `matchPlans[].after.attendance` **一致 78 / 不一致 0**。

## [v6.27.0] · CPU 队接管向导：管理端五步把 CPU 队转人类队（2026-10-04）

管理端新增「CPU 接管向导」——把生产 4 支 CPU 队（曼城 `10` / 巴塞罗那 `241` / RB莱比锡 `112172` / AC米兰 `131681`）转成人类俱乐部，管理员零 SQL、零跨仓操作。**跨仓（tour 仓 v5.2.0）**：新增 `POST /api/internal/team-rename`——HMAC 与 team-upsert 逐字同口径（签名串 `POST|{path}|{ts}|{raw}` 含路径、±300s 窗口、`timingSafeEqual` 定长比较、未配 503 / 错签 403）；体 `{id,name}`，名已同则早退 `{renamed:false}`，撞名 409 指名占用者，写审计；审计 `actor_user_id` 放开可空 ⇒ 迁移 `0025_audit_actor_nullable.sql` 重建 `audit_log`（**部署顺序硬约束：先 apply 0025 再部署 worker**，否则审计 INSERT 撞 NOT NULL 整批回滚报 500）。**本仓**：`tourClient.pushTeamRename`（永不抛错、10s 超时）+ 四端点全走权限 `club.clubs.manage` 并写审计——`GET cpu-convert`（状态聚合 + 图值预设）、`POST rename-tour`（前置 `is_cpu=1`，代调 tour，失败 502 且本仓零改动可重试）、`POST rename-local`（`UPDATE clubs SET name=?, is_cpu=0 WHERE id=? AND is_cpu=1` 幂等摘标，撞名 409）、`POST seed-ops`（一次 batch 全幂等：主场 12000/0 级/壳奖励按入参/fans 公式现算 + 账本 0 余额 + 五设施 0 级 + 联赛级别）。**前端**：新页 `web/src/pages/admin/CpuConvertPage.tsx`（路由 `/admin/clubs/cpu-convert`，侧栏不加项；五步卡片，步 4 复用 `POST /api/admin/clubs/:id/bindcode` 发认证码、步 5 绑定确认 + 异常解绑兜底），入口两处（球队页 CPU 行「接管向导」按钮 + 总览「CPU 队」卡）；无 `?id=` 时显示 CPU 队选择器。测试计划 `docs/test-plans/v6.27.0-cpu-convert-guide.md`（A/B/C/D 四块 27 TC + 变异 M1–M8）。验收：typecheck 三份全清、vitest **78 文件 / 1331 例**全绿（v6.26.1 基线 75/1298，净 +3 文件 / +33 例）、build 成功、e2e **21/21**（⑫ 375 宽零溢出扫描补 `/admin/clubs/cpu-convert`）；变异 M1–M10 十处全命中。判级 minor（新增用户可见能力）。**已上线**（2026-10-04，用户令「都发布」）：tour 仓先 apply 迁移 `0025` @04:42:14Z（回读 `audit_log` 783 行不变、`actor_user_id` 可空、两索引重建）再 push `65602ff..ecfbecd` ⇒ tour Version `b909e20b-ff8b-4e78-8423-c5165f63e60e` @04:43:42.739Z；本仓零迁移随其后，push `ea0e113..2736413` ⇒ 本仓 Version `41f3aa1a-4f35-420a-931b-0e417f5fc955` @04:45:41.680Z；上线回读：health 三检全 ok、四端点未认证 401、SPA 页 200、线上版本串 `6.27.0`、tour 无签名请求 403。

## [v6.26.1] · 绿标「练满去标」+ 球员库吸底横向滚动条 + 顶栏消费中心入口（2026-10-03）

三项修正。① 🟢 growth 标记判定加「未练满」（现值 `ca < pa`）——`markerOf` 加第 4 参、`markerWeightSql` 同源表达式与注册合规 `checkSquad` growth 名额三处同步（用户拍板：练满球员不显示绿标也不占 🟢 注册名额）；根因是 `growable` 只在赛季结算/建季重算、`applyLevelUp` 抬 CA 不即时归零，练满球员一直挂绿标。判定表达式变更 ⇒ 迁移 `0061` DROP 后按新表达式重建 `idx_players_sort_marker`（apply 写 ≈18.3k 行；不重建则 `sort=marker`/`?marker=` 退化整表扫）；keyset 游标结构不变。语义注：练满球员再买 PA（抬高 PA）后 `ca<pa` 重新成立，绿标回归——设计使然；离队恢复初始 CA 同理。② 球员库表格吸底镜像横向滚动条（visual companion 三方案可操作演示，用户选 A）：`StickyScrollbar` 组件 sticky bottom:0 镜像轨 + 双向 scrollLeft 同步（syncing 标志防回环）+ ResizeObserver，只挂球员库桌面（>900px，窄屏是卡片网格），`.table-wrap` 的 overflow/position 一字不动（e2e ⑪ 依赖、粘列组件靠其滚动上下文）。e2e ⑪/⑧ 表格探针补**双向**同步断言——变异 M4 暴露单向覆盖缺口后补齐，反向微变异恰好红在目标断言。③ TopBar 补「消费中心」NavLink（v6.26.0 漏了顶栏入口）+ CoachPanel 注册规则文案加「且未练满」。测试计划 `docs/test-plans/v6.26.1-marker-scrollbar.md`（15 TC + 变异 M1–M4）；验收：typecheck 三份清、vitest 75 文件 / 1298 例全绿（净 +1）、e2e 21/21、变异 M1–M3 命中 + M4 补探针后命中。判级 patch。**已上线**（2026-10-04 发布：迁移 `0061` 先 apply 到生产（`Executed 3 commands in 63.62ms`，核验 `idx_players_sort_marker` 新表达式含 `AND ca < pa`），push `7381009..ea0e113` 触发 CF 自动部署 Version `3864ac6b-fd57-404b-b4d9-845c6c17ae48` @2026-10-04T02:27:41Z；上线回读含练满语义生产实测——3 名练满球员（Tonali / Szoboszlai / Šeško）`marker` 全 null、`?marker=growth` 全为未练满球员；线上资产与版本串 `6.26.1` 核对一致）。

## [v6.26.0] · 消费中心 + 外部工单：五类商品工单审核制 + 球场消费三卡迁入（2026-10-04）

新增消费中心 `/shop`（B 布局左右分栏：左主栏商品页签 + 球场三卡，右栏我的工单常驻行内展开），教练提交即扣费、管理组审核通过自动改数据 / 拒绝自动退款。五类商品：买 PA（15m/点，上限 `fc26_pa_cap`=95）、徽章（银 4m / 金 8m / 银升金 6m，3 金 12 银，走 `player_playstyles` 明细 source='shop'/'external'）、角色（新增 +5m / ++12m / 单升双 10m / 去除 5m，上限 5 个、只能在注册位置下新增）、位置热区（增 5m / 去除 5m / 替换 8m，主位不可动、GK 三禁、上限 4 个、新增须与现有热区相邻、去除连带清角色）、队壳申请（5m，豪门名单进 `shop_hpremium_clubs` 只拦不收，管理组线下建壳交付绑定码）；**外部工单**（管理端折叠卡代录）：积分兑换 / 奖励等外部增益纯效果单不进账本，创建 → 确认两步。位置相邻关系为固定常量 22 条边（按图像素实测定稿，不用 FC 官方表），前后端同源 + tests 逐值锁。价格全进 `shop_prices` config JSON（12 键）。球场消费三卡（设施经营 / 冠名市场 / 球场档期）自 CoachPanel 整体迁入；账本加「消费」列。迁移 `0060`（shop_orders + player_purchases 台账 + 三 config 键，注册表 72→75）——**发布顺序硬约束：先 apply 迁移再 push**。审批批 = 效果 / 台账 / 审计挂 PENDING_GUARD + 状态流转批末（并发抢单零重复执行）；`ledgerMovement` 语句结构订正（账户批首持守卫、流水以 changes()>0 为闸），修掉带余额守卫时「同批扣款自食流水守卫」的结构缺陷。导入按台账重放保护（PA / 角色 / 位置槽位，整体幂等）。测试计划 `docs/test-plans/v6.26.0-shop.md`；验收：typecheck 三份清、vitest 75 文件 / 1297 例全绿、e2e 21/21、变异 M1–M8 七命中 + M5 覆盖缺口补 TC-A09b2、code-review 修 2 处（zones 定长 4 位防打错槽 / 徽章台账计数钳界）。判级 minor。**已上线**（2026-10-04 发布：迁移 `0060` 先 apply 到生产（`Executed 9 commands in 3.82ms`，核验两表 + 三索引 + 三 config 键在场），push `b75cff5..7381009` 触发 CF 自动部署 Version `9c1eb258-8524-4869-bb0e-9c7369f0a11a` @2026-10-04T00:10:15Z；上线回读 shop 三端点匿名 401、线上资产与版本串 `6.26.0` 核对一致）。

## [v6.25.0] · 显示时区偏好化：内部 UTC 达标 + 外部显示可调默认北京（2026-10-03）

四仓时区普查确认存储层已一致 UTC ISO TEXT ⇒ 内部零改动；本版只做展示层。新增 `web/src/lib/datetime.ts` 共享时区层：偏好三档（北京时间默认 / UTC / 跟随浏览器）存 localStorage 键 `whl.tz`，`whl:tz-change` 自定义事件 + `storage` 事件双同步（本页即切、跨标签页跟随），消费端唯一入口 `useTimeFmt()`（`time/dateTime/date/label`），Intl zh-CN `formatToParts` 短横线格式、null/非法 ISO 统一 `'—'`。顶栏时钟图标下拉（未登录也可见）+ 收件篮信封图标化（未读红点锚图标右上、条数播报不变）。全站时间消费点收敛 22 处：裸切片 18 + 纯日期切片 4 + 浏览器本地 `getHours` 2 处，CoachPanel 硬编码「（UTC）」改随档标注；静态锁 `tests/datetime-display.test.ts` 锁死 Intl 单点化与裸切片清零。倒计时读秒不动（绝对时刻差与时区无关）。e2e ⑰：时钟下拉切 UTC 时间串即变 + 收件篮图标化 + Esc 关闭。验收：typecheck 三份清、vitest 74 文件 / 1271 例全绿、e2e 20/20、code-review 修 4 处（含 ClubsPage 过期时间死分支）。判级 minor（纯展示层，服务端判定零改动）。**已上线**（2026-10-03 与 v6.24.1 同批 push `3842154..b75cff5`，CF 自动部署 Version `cfb72cf3-b23d-45fa-82a0-256110468917` @2026-10-03T16:36:14Z；线上资产与本地构建 sha256 一致、线上版本串 `6.25.0`）。

## [v6.24.1] · 强制拍卖并入统一截止规则（2026-10-03）

用户裁决：除激活首价窗外，一切挂牌都遵循同一套截止时间规则，强制拍卖也不例外（反转 v6.24.0 评审 P0-2 的豁免口径——当时为躲「幻影倒计时」选择不落列不显示，正确做法是创建时补落列）。`bypass.ts` createForcedAuction 创建即按 `bidDeadline` 首算落 `deadline_at`；列表/详情展示条件与结算提前收口同步放开 forced（激活 listed 仍豁免，由首价窗判线）。到期无人出价 → 提前下架 + 10% 下架费；窗尾收口与管理方取消出口保留；`ledgerMovement` 幂等闸防双扣费。验收：typecheck 三份清、vitest 72 文件 / 1259 例全绿、变异 2 处恰好各自目标断言红。判级 minor（同仓语义闭环，无跨仓消费）。**已上线**（2026-10-03 与 v6.25.0 同批 push，生产 Version `cfb72cf3-…` @2026-10-03T16:36:14Z）。

## [v6.24.0] · 转会市场改版：三入口统一竞价 + 卡片浮层改版（2026-10-03）

转会规则闭环改版（brainstorming 多轮拍板 + spec 九节 + 计划含九条用户操作流线）：废除「激活跳过竞价」这唯一例外——激活挂牌先进首价窗（5 分钟、仅激活方、价格锁定激活价）落价后转 `bidding` 公开竞价，截止判定与普通挂牌同轨；竞价截止后按卖方合同类型分流（训练营直进待审 / 正式合同开 24h 匹配窗，**匹配基准=竞价最终最高价**，原为首价）。挂牌创建即落 `deadline_at`（listed 也落、无人出价也显示倒计时）、listed 到期提前收口（activation/forced 例外）。**出价只收整数**（激活首价豁免）、出价框预填符合规则的最低出价（ceil 口径）、成功文案「✓ 出价成功（N m），截止时刻已刷新。」。**归零即拒三层**：客户端倒计时归零禁提交、服务端时钟校验过线 409、触发器 `fund_holds_bid_deadline_guard`（迁移 `0059` 重建，新增激活首价窗过线分支）事务内最后防线；结算兜底收口。**前端**：在售市场卡片改 rail 骨架 A（左栏 CA/PA 大数字、`attrClass` 同源五档色阶、TeamLogo、三态徽标、hh:mm:ss 读秒——`use-countdown` 全局单例 + performance 单调差值防校时回拨）；点击开浮层（桌面居中弹层 / ≤760 底部抽屉，出价历史与匹配决定搬入）；转会台 tab 改「签约谈判 / 收到报价 / 我的出价」并删挂牌表单（`?tab=mine` alias）；激活独立页 `/market/activation`（含首价窗出价入口）；MarketNav 五项；暗黑模式修复（`color-scheme: light` + 显式色）与 375px 防折行。**code-review-skill 评审修 2×P0 + 4×P1 + 4×P2**：非整数激活价首价死锁（ask_price 可为 31.5 类保护期倍率，首价路径脱离整数校验）、强制拍卖单被提前下架收费（listed 收口仅对 normal）、结算批内守卫补齐（players/fund_holds/audit 加 EXISTS 守卫）、listed 无活跃出价卡无单据 pending_review + 审计刷行、`BidPlaceResult` 契约同步（deadlineAt/matchPhase:'bidding'）、文案订正（「按竞价最高价成交」）。测试计划 `docs/test-plans/v6.24.0-market-revamp.md`（qa-test-planner：TC-A/B/C 三组 25 例 + 变异 M1–M10 全红 + 评审增补 TC-R01–R08）。typecheck 三份全清、vitest **72 文件 / 1258 例**全绿（v6.23.0 基线 69/1228，净 +3 文件 / +30 例）、e2e **19/19**、build 成功。判级 minor（新增用户可见能力 + 竞价规则闭环；无跨仓消费）。**本地收口待发布**（迁移 `0059` 生产未 apply，发布顺序 = 先 `npm run db:migrate:remote` 再 push；push 即 CF 自动部署上线）。

## [v6.23.0] · 转会中心：市场 / 报价 / 谈判三域前端合并（2026-10-03）

转会信息架构合并（brainstorming 四问拍板：深合并「我的转会台」/ TopBar 三合一「转会中心」/ 旧路由重定向含 box 映射 / 转会流水线 UI 显式呈现）。**新页 `/market/desk`（我的转会台）**：流水线说明条（五段 挂牌/报价→竞价→管理组审核→签约谈判→成约过户 + 机制句「报价被接受 ≠ 成交，同意后自动生成挂牌继续竞价」）→ 待办速览三计数（轮到我 / 进行中谈判 / 竞价中，从同页区块数据派生零额外请求，点击切区）→ 谈判区 → 报价区 → 挂牌+出价区；`?tab=nego|offers|mine` 深链定位（2 秒对齐窗口，滚轮/触摸/按键即停）。**旧 `Offers.tsx` / `Negotiations.tsx` / `MarketMinePage.tsx` 三页删除**，组件原样搬进 `market/desk/`（git rename 86–88%）；`/offers` → `?tab=offers&box=in|out`、`/negotiations` → `?tab=nego`（replace、重定向路由不挂 RequireUser 由 desk 自己拦）；`/market/mine` 退役。TopBar 三入口合一「转会中心」；MarketNav 四项（「我的」→「我的转会台」）；SideOps「我收到的报价」、Home 入口卡同步。阶段徽标：报价行 accepted 改「已接受·挂牌竞价中」、出价行 won+listing 待审核、谈判卡「第一步 · 定违约金 / 工资谈判 · 剩 N 轮」。**评审修三处**：P0 滚动对齐 effect 的时间闸原只挡循环不挡单次对齐，顶栏未读数每 60s 轮询触发 re-render 会把用户从下方区块拽回区块顶（时间闸挪进 align 首行 + deps 换 `myClub?.id` 原始值）；P1 `/api/me/club` 拉取失败被误诊为「未绑定俱乐部」（按 `MyClubState.failed` 分流文案）；顺手修旧谈判子组件 `useToast` 不渲染 `toastNode` 导致操作成功提示永远不显示（随搬家一并修复）。**零后端改动、零迁移、零生产写。**测试计划 `docs/test-plans/v6.23.0-transfer-hub.md`（TC-RED/NAV/AUTH/DESK/BDG/ACT/RESP/LNK 21 例；变异 V1–V8 全红后还原全绿；TC-BDG-02 的出价行「谈判中」阶段因无数据源落空并已在计划内订正）。typecheck 三份全清、vitest **69 文件 / 1228 例**全绿（v6.22.0 基线 69/1225，净 +3 例 = mobile-baseline 新增「转会中心导航静态契约」describe）、e2e **19/19**（基线 16 + ⑤b 换址 / ⑤c 转会台结构 / ⑤d 匿名软提示含经 `/offers` 重定向路径）、build 成功（`MarketDeskPage` 独立 chunk ≈26.6 kB）。判级 minor（新增用户可见能力与信息架构改版；无跨仓消费——三旧路由同仓同批换址）。**已上线**（2026-10-03 发布，push `4b8acc3..147b170` 触发 CF 自动部署，生产 Version `0b2a6b83-cf28-46eb-8ba8-44de771b3c75` @2026-10-03T02:29:32Z；上线回读 health/rumors/deals/listings 全 200、四路径 SPA 入口全 200、线上资产 `index-CIMWGMJC.js` 与本地 6.23.0 重构建 sha256 逐字节一致、线上版本串 `6.23.0`）。

## [v6.22.0] · 窄屏整治第三批：公开阅读页——球员页事件卡 + 参考型宽表粘列 + 顶栏渐隐提档（2026-10-02）

窄屏整治第三批（spec `docs/superpowers/specs/2026-10-02-mobile-public-reading-design.md`，含用户操作流线九条）。**Player 转会/成长两表 ≤760 卡片化**（`useMediaQuery` 两端 DOM 互斥，桌面 1280 逐字节零变化；卡片字段语义逐条照抄表格版）；**参考型宽表粘前两列** `.table-sticky-2` ≤760（市场情报成交表 / 出价历史 / 阵容名单三张裸表，首列三态定宽 `--stky-c1` + `:has()` 认表逐表覆盖）；**`.dossier` 单列断点 640→900**；**顶栏页签渐隐 mask 提档 ≤640→≤1024**（挪走非复制，中屏同样需要滚动提示；TopBar JS 零改动）；**toast 点击穿透**（`pointer-events:none` + 成长录入汇总条在场时 `body:has()` 上抬）。e2e 15→16（⑯ 公开阅读几何：dossier 单列 + 页签横滑 computed 断言 + 事件卡 fit ±1px + intel 粘列第二列留视口 + 无缝 ≤1px）；`tests/mobile-baseline.test.ts` 增 v6.22.0 五例 + 媒体块归属例。零迁移零生产写。**已上线**（2026-10-02 发布，生产 Version `ec101c38-2920-4203-ba70-26616efec815`——push `928834c..543773f` 后 CF Workers Builds 未触发部署，手工 `wrangler deploy` 补齐）。判级 minor。测试计划 `docs/test-plans/v6.22.0-public-reading-mobile.md`（33 TC + 6 变异）；vitest 69 文件 / 1225 例全绿（v6.21.0 基线 69/1219，净 +6 例）、e2e 16/16、code-review P0 0 / P1 1 / P2 3 / P3 3（修登分明）。

**Added**
- Player.tsx 转会记录/成长事件 ≤760 卡片流（event-cards/event-card/event-card-head/event-card-grid/event-card-foot）。
- 三张参考型宽表挂 `className="table-sticky-2"`（MarketIntelPage / MarketBoardPage / ClubDetail）。
- e2e ⑯ 公开阅读几何；静态闸门 v6.22.0 五例 + 媒体块归属例。

**Changed**
- styles.css 新增五块：≤900 dossier 单列 / ≤760 dossier-tabs 横滑 / ≤760 event-cards 铭牌卡 / ≤760 table-sticky-2 粘前两列（`--stky-c1` 默认 6em + `:has()` 逐表 8em/9em）/ toast pointer-events + `body:has(.entry-sumbar)` 上抬；≤1024 顶栏渐隐 mask 块（自 ≤640 挪入）。
- TopBar 页签渐隐从 ≤640 提档到 ≤1024（mask 规则整体挪移，641–1024 中屏同样生效；TopBar JS 无改动）。
- `.dossier` 单列断点 640→900（>900 双栏 280px+1fr 桌面零变化）。

## [v6.21.0] · 窄屏整治第二批：编辑面板卡片化 + 品牌卡 + 教练台粘性列（2026-10-02）

窄屏整治第二批（spec `docs/superpowers/specs/2026-10-02-mobile-remediation-batch2.md`，含用户操作流线与两轮订正记录）。**成长录入 ≤760px 卡片化**：表格/卡片互斥分支（`useMediaQuery`），铭牌卡语言字段网格 2 列（评分 `inputMode=decimal`），已录/训练营/校验问题/脏行状态语义逐条照抄表格版，进球/助攻只读标「自动」；常驻汇总条（本场合计 XP + 脏行数 + 全部保存）`createPortal` 挂 body、`position:fixed` 贴视口底（sticky 在 `.table-wrap` 滚动容器内无行程，评审期再修面板出宽：`container-type:inline-size` + `width:100cqw`，e2e fit ±1px 断言锁死）。**BrandsPage 赞助表 ≤760 卡片化**：brand-card 四控件网格 + brand-card-meta 来源/状态/生效冠名与桌面 8 列对等 + 窄屏新增品牌表单；桌面表格分支含白名单 96/72/84 逐字节保留。**CoachPanel 财务/花名册表 ≤640 粘性前两列**（`coach-sticky`，显式底色防透底）。ImportsPage 核查零改动。e2e 13→15（⑭ 成长补录卡片流含 fit 几何 + POST 拦截 + 回滚幂等、⑮ coach-sticky 条件几何）；`tests/mobile-baseline.test.ts` 增 TC-SWP-05 与 v6.21.0 五静态例。零迁移零生产写。**已上线**（2026-10-02 发布，与 v6.20.0 同一次 push/部署）。判级 minor。测试计划 `docs/test-plans/v6.21.0-edit-panel-mobile.md`（33 TC + 6 变异）；vitest 69 文件 / 1219 例全绿（v6.20.0 基线 69/1213，净 +6 例）、e2e 15/15、code-review P0 0 / P1 2 / P2 5 / P3 3（修登分明）。

**Added**
- GrowthEntryPage 窄屏卡片分支 + 常驻汇总条（portal 到 body、fixed 贴视口底、脱流 padding 补偿）。
- BrandsPage 窄屏品牌卡（brand-cards/brand-card/brand-card-grid/brand-new-form/brand-card-meta）。
- e2e ⑭ 成长补录卡片流、⑮ coach-sticky 条件几何；静态闸门 TC-SWP-05 + v6.21.0 五例（TC-ENT-03/09、TC-REG-02、TC-BRD-02、TC-IMP-03）。

**Changed**
- styles.css 新增 ≤760 entry 卡片 / ≤380 单列回落 / ≤760 brand 卡片 / ≤760 imports 表单重排 / ≤640 coach-sticky 五块；`.table-wrap` ≤760 加 `container-type:inline-size`（面板 `100cqw` 出宽前提）。

**Fixed**
- 补录面板在主表 td 内随 min-content 出宽（≈1.5× 视口、保存钮出屏）：sticky+100cqw+td padding:0 三层修复；汇总条 sticky 无行程改 fixed；删除零引用死规则 `.brand-card-head` / `.brand-card-foot`（TSX 实际用 `<b>` 与 `.btn-row`）。

## [v6.20.0] · 窄屏整治第一批：管理壳抽屉骨架 + 全站保底横扫（2026-10-02）

全站移动端窄屏整治第一批（设计 spec `docs/superpowers/specs/2026-10-02-mobile-remediation-design.md`，批次路线 v6.21 编辑面板卡片化 + CoachPanel 粘性列、v6.22 公开阅读页 + iOS 真机抽验）。**管理壳 ≤760px 侧栏收抽屉**：切换钮「☰ 管理导航 · 当前页名」+ 固定抽屉（宽 min(280px,85vw)）+ 遮罩，焦点陷阱 / 锁滚 / 焦点归位照球员库抽屉范式，Esc / 遮罩 / × / 路由切换四条关闭路径；>760px 桌面 DOM 零变化。**顶栏 ≤640px 页签横滑**：贴边渐隐 + active 页签 scrollIntoView 居中（尊重 prefers-reduced-motion）。**全站保底横扫**：内联固定宽 10 处收 `min(N,100%)`（其中表格内 4 处经评审回退定宽——百分比分量会改变 ≥761px 桌面列宽分配，窄屏保底由 `.table-wrap` 横滚承担）；48 张表格核实全部已有 `.table-wrap` 包裹（立项探查「约 9 页裸表」系误报）；`.ledger-book` / `.inbox-text` 两处窄屏残余溢出修复。**e2e 11→13**：新增 ⑫ 全路由 375×812 零溢出扫描（26 路由）与 ⑬ 管理抽屉全交互 + 宽屏零变化铁律；静态闸门 `tests/mobile-baseline.test.ts` 把表格包裹 / 固定宽禁令（白名单双向核对）/ 触控 ≥36 固化为 vitest 红线。零迁移零生产写。**已上线**（2026-10-02 发布，与 v6.21.0 同一次 push/部署）。判级 minor。测试计划 `docs/test-plans/v6.20.0-mobile-skeleton-baseline.md`（31 TC + 6 变异）；vitest 69 文件 / 1213 例全绿（v6.19.0 基线 68/1209，净 +1 文件 / +4 例）、e2e 13/13、code-review P0 1 / P1 3 / P2 4 / P3 6（修登分明）。

**Added**
- 管理壳窄屏抽屉（类名契约 `admin-nav-toggle` / `admin-sidebar.open` / `admin-drawer-mask` / `admin-drawer-close`，e2e ⑬ 锁定）。
- `tests/mobile-baseline.test.ts` 静态闸门 4 例（表格保底穷尽扫描 / 内联固定宽禁令 + 允许清单 5 条双向核对 / styles.css 触控 ≥36 规则级锁 / 判据自检）。
- e2e ⑫ 全路由 375 零溢出扫描、⑬ 管理抽屉开合 / 焦点循环 / 四条关闭路径 / 宽屏 DOM 零变化。

**Changed**
- 顶栏 ≤640 页签横滑加贴边渐隐与 active 居中（reduced-motion 降级）；`.search-suggest` 浮层窄屏 min(260px,86vw)。
- BrandsPage / admin MarketPage / OverviewPage / SystemPage / CoachPanel 共 10 处内联固定宽收窄屏保底（表格内 4 处评审后回退定宽，白名单登记）。
- `UI_DESIGN.md` 断点口径订正：「单一 640px」→ 实际三档 640/760/900。

**Fixed**
- `.ledger-book` 窄屏隐式列撑破（`minmax(0,1fr)`）；`.inbox-text` 缺 `min-width:0` 溢出 3px；`.admin-drawer-close` / `.lib-drawer-close` 命中区 <36 补足 36×36。

## [v6.19.0] · 球员库移动端卡片化 + 全仓数值五档分段配色（2026-10-02）

球员库 `/players` 在 ≤900px（与筛选抽屉同断点）把 12 列横向滚动表格整表换成**铭牌卡网格**：左竖轨位置药丸（主位独占 + 副位两枚一行、奇数孤行自动居中）与 CA/PA 大字，卡身姓名（长名换行不出省略号）+ 标记 emoji + 队徽/俱乐部/年龄/状态徽章（自由身灰 chip），下部固定行序属性列表（身价/违约金/徽章 chips/影响力）+ 受筛选项透镜行（attr 筛选优先恰 1 条，排序键/筛选维度按白名单补位，去重上限 2）；窄屏新增排序行（30 键 + attr 动态项 + 升降切换），显示列窄屏隐藏。桌面 >900px DOM 零变化——唯一例外：**标记列从可选列提为固定第二列（UID 后）**，且 CA/PA/初始 CA 列字色随五档变化。**数值分段配色全仓统一**：sofifa.com 实测五档（≤50 红 / ≤60 橙 / ≤70 琥珀金 `#b7892b`——原档黄 `#fcc419` 在奶油底上 ~1.6:1 不可读，唯一替换档 / ≤80 榈绿 / ≥81 绿），`attrClass` 收归 `web/src/lib/players-library.ts` 共享，球员面板头部 CA/PA、六维雷达轴数值、属性页签与分组均值、球员库表格、移动端卡片同源。零迁移零生产写（后端零改动，卡片所需字段列表端点已全部返回）。**已发布**（2026-10-02，push `368a1e0..7e14248` 触发 CF 自动部署，生产 Version `9e371144`，上线回读与资产比对全过）。判级 minor。测试计划 `docs/test-plans/v6.19.0-players-mobile-cards.md`（19 TC + 5 变异全命中）；vitest 68 文件 / 1209 例全绿（v6.18.0 基线 67/1194，净 +1 文件 / +15 例）、e2e 11/11、code-review P0 0 / P1 0 / nit 三条登记。

**Added**
- 窄屏铭牌卡网格 `.lib-cards` 与窄屏排序行 `.lib-sortrow`（`PlayersLibrary.tsx` narrow 分支；类名一律 `lib-card-` 前缀防撞既有规则）。
- `web/src/lib/players-library.ts`：`attrClass` 五档分段、`money`（自页面移入）、`SORT_KEY_LABELS`、`sortLabel`、`LENS_WHITELIST`、`LensChip`/`lensChips` 透镜纯函数。
- `web/src/lib/players-lens.test.ts` 15 例（attrClass 边界 / lensChips 口径 / 排序标签全集 / money）。

**Changed**
- 桌面表格：标记列从可选列提为固定第二列（UID 之后），`COL_DEFS`/`autoColsFor`/`renderCol` 的 marker 行退役。
- `.attr-good/.attr-mid/.attr-low` 三档类改五档 `.attr-bad/attr-weak/attr-mid/attr-solid/attr-good`（sofifa 实测色值，`attr-low` 退役）。
- e2e ⑧ 球员库三视口：窄视口等待与断言切到卡片列（`.lib-cards .lib-card`），宽屏追加卡片/排序行不存在的反向断言。

**Fixed**
- `PlayersLibrary.test.tsx` 的 api mock 缺 `mediaUrl`（窄屏卡片引入 TeamLogo 后取未定义导出直接抛错，9 例红）。

## [v6.18.0] · 市场信息架构改版（2026-10-02）

市场 nav 四项：**在售市场**（原「市场板」改名）/ **海捞**（成交动态与 CPU 捞人榜撤、改海捞区 + 激活球员）/ **市场情报**（新第四 tab，匿名可读）/ 我的。**海捞区** = 输入 ID 或名字搜索（数字点查 / 名字折叠搜索 LIMIT 8），信息条带「可捞 / 不可捞 + 原因」（批量判定与详情 seaSign 同源，一致性测试锁）。**激活球员** = 全部可激活球员（外队 normal+trainee，正式合同缺违约金的行标「缺违约金合同」置灰）+ 保留仅训练营模式；激活补齐证据上传链路（先传 QQ 通知截图拿 `proofMediaKey` 再提交——此前按钮缺该字段必 400）。**市场情报** = 传闻（系统自动派生、真真假假：种子钉 `[season, windowSeq]` 同窗稳定下窗换血，真料按事实方向分族套不确定语气、假料随机组合带不撞真实关系守卫，响应不下发真假字段）+ 已达成交易（全部 completed 单据倒序 50 条，走迁移 `0058` 的 `idx_transfers_status_time` 索引早停，≈150 行/次）。退役三端点：`/api/market/sea-signs`、`/api/market/cpu-board`、`/api/market/trainees`。**未发布**（本地完成，发布时迁移 `0058` 先 apply 生产再 push）。判级 minor。测试计划 `docs/test-plans/v6.18.0-market-ia.md`；vitest 67 文件 / 1194 例全绿（v6.17.0 基线 65/1169，净 +2 文件 / +25 例）、e2e 11/11、变异 V1–V15 全命中、code-review P0 0 / P1 2（已修）/ P2-P3 登记或小修。

**Added**
- `GET /api/market/rumors`（公开 + guard）：传闻生成器 `src/worker/rumors.ts`（seededUnit 确定性抽签；假料球员 seededUnit 随机 id 主键点查，零全表扫）。
- `GET /api/market/deals`（公开 + guard）：全部 completed 转会单据倒序 50 条（transfer/activation/forced_auction/free_agent/rc_change/termination/match，中文标签前端 `TRANSFER_TYPE_LABEL`）。
- `GET /api/market/sea-lookup?q=`（教练）：数字 → `firstPlayerByRef` 点查（fc_id 优先）；名字 → 双列折叠 LIKE；批量可捞判定 4 查询，stage 顺序与文案逐字对齐 `checkSeaSignEligible`（一致性用例锁跨实现相等）。
- `GET /api/market/activatable`（教练）：替换 trainees；`mode=all|trainee` + `q` + `limit` 钳 1..100；行带 activationFee 两口径（trainee 5m / 正式按保护期倍数）、`justSigned`、`activatedThisWindow`（批量）。
- 迁移 **`0058_transfers_status_time.sql`**（transfers 全表扫的治理索引）+ cache scope `'market'`（TTL 1h，PUBLIC_SCOPES 4→5）。

**Fixed**
- 正式合同 `release_fee` NULL/0 的球员曾让 activatable 名单整页 500（`activationFee` 对非正数抛 RangeError 未捕获）→ 行级费用 null + 前端「缺违约金合同」置灰 + 提交链同口径 409（对齐 bypass.ts 既有文案）。
- 激活按钮链路断裂：MarketFreePage 只发 `playerId` 而后端强制 `proofMediaKey`（证据制）⇒ 必 400——补齐截图上传→提交流程（复用 SideOps 的 `apiUpload` 通道）。
- rumors 假料球员查询 `p.club_id` 未别名成 `clubId` ⇒ 「不指向现效力队」守卫因键名不匹配从未生效（被旧池序的抽签运气掩盖，`ORDER BY p.id` 落地后暴露）——别名修复。

## [v6.17.0] · 海捞情报台（2026-10-01，2026-10-02 上线 · Version `e500cbd9-…`）

市场「海捞」tab 从自由球员名单改版为**教练决策情报页**。三段：**成交动态**（全服已完成海捞倒序 30 条：球员+CA / 原东家→捞入队 / 新违约金 / 海捞费 / 窗，本窗行高亮）、**CPU 捞人榜**（CPU 队可捞名单 CA 降序，行内违约金输入实时试算 30% 海捞费，点击进球员页）、**训练营激活原样保留**。球员详情新增 `seaSign`（资格判定与 `createFreeAgent` 守卫链同源：窗口 / 归属 / 状态 / 本窗禁签 / 在途单据，不可签原因原文下发）与 `seaComps`（成交定价锚：现值 CA±5 内最近 ≤5 笔同档成交，无同类回落全局最近 3 笔；仅判定 ok 时计算）。禁签按用户裁决不做内容展示（「这个窗签不了，对经理的意义有限」；CPU 榜天然不含禁签球员）。零迁移、零生产写。**已上线**（2026-10-02 发布：零迁移直接 push `b9ecda1..376ad12` 触发 CF 自动部署，生产 Version `e500cbd9-3da8-4b3e-92ef-8cba9cff1671` @2026-10-01T16:15:38Z；上线回读全过——基础端点 200、两新端点匿名 401、free-agents 404、公开详情出 `seaSign`/`seaComps` 新字段、线上资产与本地逐字节一致）。判级 minor。测试计划 `docs/test-plans/v6.17.0-sea-sign-intel.md`（30 TC = P0 19 / P1 9 / P2 2，8 变异）；vitest 65 文件 / 1169 例全绿（v6.16.0 基线 64/1140，净 +1 文件 / +29 例）、e2e 11/11、code-review P0 0 / P1 1（公开详情面白算参照，一行修）已修、P2/P3 登记（见 ROADMAP v6.17.0 节）。

**Added**
- `GET /api/market/sea-signs`（教练）：全服已完成海捞成交 `ORDER BY completed_at DESC, id DESC` LIMIT 30，透出新违约金（`fee`）与海捞费（`signFee` = 30%）；可选 `?season=&windowSeq=` 过滤（非正整数 400）。
- `GET /api/market/cpu-board`（教练）：CPU 队可捞名单（`is_cpu=1` 且 `status IN ('free','normal')`）按 CA 降序 LIMIT 500（CROSS JOIN clubs 驱动，防优化器塌成扫全部自由身）。
- 球员详情 `GET /api/players/:id` 新增 `seaSign {eligible, reason}` 与 `seaComps {scope: same_tier|global|none, rows}`。

**Changed**
- `src/worker/bypass.ts`：`ensureNotInFlight` 重构为 `findInFlight`（listings → transfers `pending_review`）+ 抛错壳；新增 `checkSeaSignEligible` 判定域（守卫链 window→ownership→status→banned→listing→pending 原顺序原文案）；`createFreeAgent` 改吃判定结果抛错，行为逐字不变（termination / rcChange 共用路径不受影响，变异 V8 座实联动面）。
- 市场页「海捞」→「海捞情报」（`MarketFreePage` 重写三段 + `SideOps` E 态开关改吃后端前置判定——原先只判窗口，其余提交后才知 400/409）。

**Removed**
- `GET /api/market/free-agents`（唯一消费是旧名单段，同批换情报台；原实测 36,274 行/次，为全站最大读放大器）。

**Fixed**（顺带）
- SideOps 海捞费恒显「—」：`apiPost<{fee:number}>` 泛型误用恒 undefined，改用 `FreeAgentResult` 展示。

## [v6.16.0] · 管理端成长批量补录台（2026-10-01）

把「一人一事件」的单人补录表单升级为**按场比赛、花名册行内批量补录**（参照 growth 插件 webui 的 fixtures 页交互）。选一场已确认比赛 → 内嵌面板 → 主/客队花名册一行一人行内编辑（出场 / 评分 / 零封 / 夺回球权 / 扑救，进球助攻只读）→ 本场 XP 实时复算 → 脏检测确认条 → 单行 + 全部保存（只提交脏行）。补录 `matchRef=比赛 id` 与自动通道同锚，`UNIQUE(player_id, match_ref, event_type)` 天然防重复发 XP；已录格锁定（平台无删除/纠正通道，如实标注来源）。零迁移、零生产写。**已上线**（2026-10-01 发布，用户下令「推送」）：push `748803d..7891561`（7 提交 = v6.15.0 发布记录 docs 枚 + v6.16.0 六枚）触发 CF 自动部署，Version `5cddbf5b-…` @2026-10-01T12:38:10Z；上线回读 `/api/health` / `/api/clubs` / 公开 `/api/fixtures` 全 200、匿名探针三个新端点均 401（挂载且守卫生效）、线上资产 `index-DzKR-MbB.js`（sha256 `27ee8e14…`）与本地构建逐字节一致。判级 minor。测试计划 `docs/test-plans/v6.16.0-growth-entry.md`（34 TC = P0 24 / P1 8 / P2 2，5 变异）；vitest 64 文件 / 1140 例全绿（基线 62/1113，净 +2 文件 / +27 例）、e2e 11/11、变异验证 5/5 全命中、code-review 修 2（entries 上限 50 行 / 未保存确认条文案）+ 1 并发边界注释。

**Added**
- 管理端三端点（`src/worker/routes/admin/growth.ts`）：`GET /api/admin/growth/match-entry`（比赛列表：可计 XP 场近 50 场，口径与自动钩子同源 `MATCH_ENTRY_WHERE`——联赛两级全阶段 + 冠军杯小组赛 + 排弃权；每场带已录事件数与双方 clubId/CPU 标记）、`GET /api/admin/growth/match-entry/:matchId`（双方花名册 + 已录事件预填）、`POST /api/admin/growth/match-entry/:matchId`（批量补录：校验全前置、单 `db.batch` 原子、审计 `growth_manual_event_batch` 恰一条、entries ≤50 行）。
- 管理端侧栏第 3 项「成长录入」`/admin/growth`（GrowthEntryPage）+ 前端 XP 复算纯函数 `web/src/lib/growth-xp.ts`（与后端 `xpForEvent` 同口径，头注释互指）。

**Changed**
- PlayersPage 成长引擎卡：移除旧单人补录表单（档位核定/宣告成长期/赛季结算/批量维护不动）。`POST /api/admin/growth/events` 端点保留（校验抽 `manualEventOf` 与批量共用，行为逐字不变），但无比赛关联的补录从此无 UI 入口。

## [v6.15.0] · 场次天气预报（revenue 插件触发口径）+ 预留 tour 展示接口（2026-10-01）

天气从「赛果确认时逐场现掷」改为「管理员按轮手动预报」（参照插件 `fixture_service.forecast_round`），**预报时天气类型与系数 wx 一并提前抽定落库**（用户裁决）；确认钩子按「事件预置 > 场次预报 > 现掷」消费，无预报场次行为逐字不变。概率/区间/上座公式**零数值改动**（40/30/20/10 为 2026-09-16 用户裁决值）。含迁移 `0057_match_weather.sql`。**已上线**（2026-10-01 发布）：迁移 `0057` 先 apply 生产、push `8cf8f12..748803d`（4 提交）触发 CF 自动部署，Version `20c24c71-…` @2026-10-01T11:50:15Z；上线回读 `/api/health` / 公开 `/api/fixtures` 200、匿名探针 401、线上资产 sha256 与本地 6.15.0 重构建逐字节一致。判级 minor。测试计划 `docs/test-plans/v6.15.0-weather-forecast.md`（50 TC = P0 34 / P1 13 / P2 3）；vitest 62 文件 / 1113 例全绿（基线 60/1062，净 +2 文件 / +51 例）、变异验证 5 处全命中、code-review 独立评审 0 blocking（5 important 已修）。

**Added**
- **按轮预报**：`GET/POST /api/admin/weather/forecast?tournament_id=&round=`（预览零 rng 零落库 / 触发对未预报未确认的主队场次逐场抽类型 + `uniform(weather_ranges[weather])` 抽系数落库；定位键 `(tournament_id, round)`，season 由赛季绑定解析，无绑定 409；已预报保留、已确认跳过、CPU 队与无球场队跳过；审计 `weather_forecast` origin='user'）。权限键 `club.registrations.manage`。
- **公开预留接口**：`GET /api/fixtures?tournament_id=&round=`（🌐 匿名 + `assertPublicRate` + `cachedJson`，新 `CacheScope` `'fixtures'` TTL 1h）——该轮主场比赛的天气（已确认取实际、否则预报、都无 null）、球场（名/容量/档位）、上座；收入三件套刻意不在白名单（评审收窄，经营数据只进管理端预览）。供 tour 平台将来拉取展示。
- **管理端「天气预报」卡**（SeasonsPage）：赛事下拉 + 轮次 + 预览表（四态：已确认/已预报/未预报/跳过）+ 生成预报（四段结果横幅）。

**Changed**
- 确认钩子（`home.ts` `matchAttendanceStatements`）：预报命中时天气与 wx 直取 `match_weather` 落库值（rng 剩 perturbation+fill 两口），memo 标「（赛前预报）」；预报行校验 club_id（改期/换边不错配）、消费后保留。事件预置命中时跳过预报点查。
- `cache-policy.ts`：`CacheScope` 加 `'fixtures'`（PUBLIC_SCOPES 3→4，一次 purge 仍只花一次 KV 写）；`rollWeather`/`uniform`/`asRange` 自 home.ts 导出共用。

**Fixed**（评审修复 `3d062fc`）
- 轮次参数严格解析：`Number('')`/`Number(null)` 均为 0——空串 `?round=` 或 body `round:null` 原会真的对第 0 轮抽定落库；改 `parseRoundParams` 严格校验 + round 上界 200，GET/POST 文案统一。
- 公开面/预览的预报行校验 club_id（与消费端同口径），改期/换边后旧预报不再展示（新增 TC-PUB-03b 锁）。
- 审计 after `forecasted` → `attempted`（并发撞闸时 batch 内无法回写实际数）；raced 回读缺行不再给空天气。

**已知不改**
- 淘汰赛/无轮号（`match.round` NULL）场次不在预报范围（触发四段全空，与该轮没排赛不可区分）；`wx_coef`/`weather` 无 CHECK 约束（人工改库文本 wx → 收入整批失败进 needsReview，实测无 NaN 落库）；tour 侧消费端、教练端天气展示未做（本轮只在本仓开口子）。

## [v6.14.0] · C3 招商轮：品牌报价制 + 主动签约退役（2026-09-29）

差异排期 C 块第三块（参照插件 `market_service` / `market_rounds` / `market_offers`）。含迁移 `0055_market_rounds.sql`（`market_rounds` + `market_offers` 两表与三个部分唯一索引；`claim_token` 抢锁列在未 apply 窗口期直接加入本迁移）与 `0056_event_seed_brand_visit.sql`（即发种子「品牌上门」，池 30 → 31）。**已上线**（2026-09-29 发布）：迁移先 apply 生产、push `07f050c..8cf8f12`（7 枚）触发 CF 自动部署，Version `df0640af-…` @2026-09-29T10:09:11Z；上线回读公开端点 200 / 匿名探针 401 / 旧 sign 404 / 线上资产 sha256 与本地一致。判级 minor（新增用户可见能力；`POST /api/club/naming/sign` 退役为同仓 web 客户端同批替换、无跨仓消费）。测试计划 `docs/test-plans/v6.14.0-c3.md`（69 TC = P0 46 / P1 19 / P2 3 / P3 1）；vitest 60 文件 / 1062 例全绿（基线 59/990，净 +1 文件 / +72 例）、e2e 11/11、变异验证 17 处 + 评审修复后 2 处全命中。

**Added**
- **招商轮与定向报价**：关窗批清盘旧轮（`pending` → `expired`；整轮无人签品牌热度 −`ignored` 钳 [0.5,1.5]）+ 开新轮；每品牌每轮向三档挑出的 3 支球队各发 1 份报价（头部盯估值最高的 `min(2, offersPerBrand)` 队 / 新兴盯中游 / 口碑广撒零报价队兜底；估值 = `namingBaseFee` × 行业系数；头部进取 pkg2、其余稳健 pkg1）；TTL 72h（config `market_round_rules {offersPerBrand:3, offerTtlHours:72}`，注册表 71 → 72）；`uq_market_round_open` 部分唯一索引保全局最多一个 open 轮。
- **报价收件箱与 accept 端点**：`GET /club/naming/quote` 改造为「当前合同 + 续约 + 收到的报价」（无约只回 `{offers}`）；新增 `POST /club/naming/offers/:id/accept`——无约直接签约；有约 `mode: queued`（现合同到期后接替，`uq_market_offer_queued` 一队一接班位）或 `mode: terminate`（解除当前合约、赔付沿用既有口径后即签）；queued 转正三触发点（关窗批尾 / 退约路由 / 关窗兜底）。
- **管理端招商轮视图**：`GET /brands/market-round`（轮状态 + 全状态报价流水）+ `POST /brands/market-round/reopen`（手动清盘重开，审计 `market_round_reopen`）；BrandsPage 招商轮区块（四状态徽标 + 手动重开）。
- **`offer_spawn` 真落库**：`brand_visit`「品牌上门」即发种子（新条件键 `requires_no_naming`，池 30 → 31）；事件递价经 `spawnVisitOffer` 挂当前开放轮（无开放轮 / 撞唯一索引走落空播报）；LLM 草稿条件白名单同步。
- **通知**：`naming_offer`（收到报价）与 `naming_offer_activated`（接替生效）两模板。
- **品牌热度**：`market_heat_rules` 加 `deal: 0.02`（签约）/ `ignored: -0.03`（整轮无人签）。

**Fixed**
- **转正批语句顺序缺陷（测试轮实测抓出）**：`activateQueuedStatements` 的 offer 占坑 UPDATE 排在合同 INSERT 之后 ⇒ 守卫读不到本批状态而恒假（offer 永停 queued、审计不落、queued 唯一位永不释放）；改为占坑 UPDATE 提前到合同 INSERT 之前。
- **`acceptOffer` 抢锁闭环（claim_token）**：原抢锁批「抢锁赢家与下游守卫不一致」可半笔提交、抢输方非零改行 ⇒ `market_offers` 加 `claim_token` 列，signed 路径守卫全上提抢锁句、后续语句统一 claim 守卫、批后按抢锁句 `meta.changes` 判 409「报价已被处理或条件已变化」；terminate 赔款改 `ref('offer', offerId)` 幂等 + claim 守卫。
- queued 分支撞 `uq_market_offer_queued` 由 500 改预检 409「已有一份待接替报价」；`spawnVisitOffer` 去重谓词与唯一索引同口径（去 `status` 谓词）；转正语句无条件生成（同批被腾出的冠名位当窗即转正）。

**Changed**
- **签约入口唯一化**：删 `POST /api/club/naming/sign`，冠名获取只走招商轮报价；冠名卡签约区改「收到的报价」（有约换约行内二选一）。
- `offer_spawn` 由「恒落空播报」改真落库（`PENDING_EFFECT_KEYS` 空集，前端展示不再标注「C3 生效」）。
- config 注册表 71 → 72（新键 `market_round_rules`）；事件池种子 30 → 31（`brand_visit`）；`tests/d1.ts` MIGRATION_FILES +2。

**已知不改**
- `spawnVisitOffer` 的 INSERT 在事件批之外（进程中途挂掉留孤儿报价）；queued 转正不复查品牌名额；转正审计双路径重复行；terminate 换约残余竞态（名额预检与抢锁之间名额被抢 → 退约成功而无新约，极小概率）。

## [v6.13.0] · C2 冠名深度：档位性格 + 情绪演化 + 品牌主动解约 + 联赛冠军加成（2026-09-28）

差异排期 C 块第二块。含迁移 `0054_brand_tiers.sql`（`brand_pool` 加 `tier` CHECK 三档 / `tier_locked`，种子按校准规则预设 3 头部 2 新兴）——**已随 2026-09-28 发布批次上线**：`0054` 于 push 前 apply 到生产（`Executed 5 commands in 3.56ms`；只读核验 `brand_pool` 3 头部 / 2 新兴 / 2 口碑、`d1_migrations` 末条 `0054_brand_tiers.sql`），随后 push `77f6eea..07f050c`（14 个提交）触发 CF Workers Builds 自动部署，生产 Version `1e3cc95a-7f43-41ee-8fd4-93fe69169774`（2026-09-28T15:50:43Z）；线上资产 `index-nK5xirMD.js` + `index-BY0ef8kg.css` 与本地 v6.13.0 构建 sha256 逐字节一致（线上 JS 版本串 `6.13.0`），公开端点 200 / 匿名探针 401 回读全过。判级 minor。测试计划首次按 qa-test-planner 约定设计（`docs/test-plans/v6.13.0-c2.md`）。插件只当参照系，可玩性偏离逐条留痕（见 ROADMAP v6.13.0 节）。

**Added**
- **品牌档位**：头部 / 新兴 / 口碑三档（config `market_tier_profiles` 全参数性格：情绪地板 0.7/0.6/0.5、负向敏感 ×1.5/1.0/0.75、活动收入加成 +2%（头部）、死忠涨粉加成 +0.5%（口碑））；config `market_tier_rules`（topSeatRatio 8 / emergingSlots 2 / topHeatFloor 1.0 / emergingHeatFloor 0.9）；关窗批首自动校准——热度降序前 ceil(俱乐部数/8) 家且 heat≥1.0 → 头部、≥0.9 → 新兴、其余口碑；**头部可空缺不注水**；`tier_locked=1` 锁档跳过校准；管理端品牌池页档位下拉 + 锁定开关（审计带前后档位）。
- **品牌方情绪演化**（接管 v6.12.0 的纯展示）：两信号步进——上座（≥goodAttend +1 / ≤badAttend −1 / 无主场场次 0，不借中性上座率拿正向）+ 战绩（窗内胜率 ≥0.55 +1 / ≤0.45 −1，点球按平、弃权按取胜方，与 formPtsOf 同口径）；delta = 0.5×0.05×s_attend + 0.3×0.05×s_result，负向 ×档位 penaltyMult，钳 [0,2] round3；剩 1 窗的合同本窗到期不演化（防与 expire 抢行）；事件情绪即时落库（v6.12.0）保留、不进演化（Q2 裁决，避免双记账）。关窗后教练收 `naming_mood` 站内信（含两信号人话注记）。
- **品牌主动解约**：演化后 satisfaction 跌破当前档位地板 → 同批 terminated（windows_remaining=0、ended 刻定格），无赔偿；`naming_terminated` 站内信；冠名卡 sat ≤ 地板 +0.1 出「低情绪预警」红标（地板随约下发）。
- **签约档位名额**：头部 1 队 / 新兴 2 队 / 口碑不限；预检 409（文案点名档位限数）+ INSERT 原子 COUNT 守卫双保险（并发不超卖）；报价端点透出 `tier` 与 `quotaLeft`（口碑 null），签约列表徽标 + 名额提示、满额禁用。**修复真缺陷**：守卫初版对不限额档 bind 0 使 `COUNT < 0` 恒假——口碑档品牌签约恒 409，由测试抓出并修正（不限额档不加子查询）。
- **联赛冠军加成**（挂既有赛季结算按钮）：`settleSeason` 批内定位 `league_premier` 绑定（0 或 >1 条 → note 进 warnings 走 acknowledged），`result_confirmations` 自算积分表（胜 3 平 1 负 0、点球按平、弃权判负净胜球 3:0、双方弃权不计），榜首 tiebreak 积分 → 净胜球 → 队名（AUTH 目录名，缺行回落队 id）；冠军队有 active 冠名则品牌热度 +`champion`（0.10，钳 [0.5,1.5]）+ 满意度 +`championSatisfaction`（0.10，钳 [0,2]），全部语句挂 `(SELECT status FROM seasons WHERE season=?) != 'settled'` 守卫（重放 / 并发零改行）；审计 `champion_bonus` 同闸；结算返回体带冠军明细；冠军队收 `naming_champion` 站内信（无冠名走「无落点」分支）。
- **buff 生效点**：档期活动收入 ×(1+attendBuff)（头部 +2%，memo 带加成标注）；死忠演化涨粉系数 ×(1+fansBuff)（口碑 +0.5%），掉粉不受影响。

**Fixed**
- `signNaming`：口碑档（不限额）签约恒 409 的真缺陷（名额守卫在不限额档 bind 0，`naming-tiers` TC-QUOTA-04 抓出）。

**Changed**
- config 注册表 68 → 71（`market_satisfy_config` / `market_tier_profiles` / `market_tier_rules`），`market_heat_rules` 默认加 `champion: 0.10`。

## [v6.12.0] · D3 随机事件域：满意度与经营信号消费端 + LLM 草稿工坊 + 种子扩池（2026-09-28）

差异排期 D 块第三块。含迁移 `0051_naming_satisfaction.sql` / `0052_event_seeds_batch2.sql` / `0053_event_drafts.sql`，并直接编辑了尚未 apply 的 `0047_event_pool.sql`（补 satisfaction / signals）。**已随 2026-09-28 发布批次上线**：`0045`–`0053` 共 9 枚迁移于 push 前 apply 到生产，push `68fc154..77f6eea` 触发 CF 自动部署（Version `55a54d84-9ca6-4b7d-999f-27064197238d`，2026-09-28T10:02:19Z）；线上资产 `index-CF1Lyhhj.js` 与本地 v6.12.0 构建逐字节一致。

**Added**
- **品牌方情绪真落库**：`naming_contracts.satisfaction`（`0051`，默认 1.0）；事件 `satisfaction` 效果按 `event_clamps.satisfaction=0.5` 钳幅、`MAX(0, MIN(2, …))` 累加、PENDING_GUARD 幂等，无生效冠名播报落空；冠名卡展示「品牌方情绪：低落 / 平静 / 高涨」（数值 + 状态标签，阈值纯展示）。
- **经营信号三消费点**：config 新键 `event_signals`（`fan_mood` step ±2 / `upkeep` mult 0.5–2 / `fee_mod` mult 0.5–2，同插件 `SIGNAL_DEFAULTS`）；效果值经 `cleanSignals` 清洗后入 `effects_json`，关窗批 `collectWindowSignals` 聚合（step 求和 / mult 连乘后终钳）——维护费 ×upkeep、死忠演化 ×(1+fan_mood/100)、冠名费 ×fee_mod，账本 memo 带信号说明，有非中性信号的队另收 `window_signals` 站内信。
- **LLM 草稿工坊**（管理端 only，不进玩家请求路径）：`src/lib/llm.ts`（OpenAI 兼容通用接入，`LLM_API_BASE` / `LLM_API_KEY`（secret）/ `LLM_MODEL` 三变量，未配 503 旁路、失败 502 带原文）；`event_drafts` 表（`0053`）+ 6 个管理端点：生成（text 改写文案 / struct 结构草稿过 `clampEventDraft` 钳制）、草稿列表、修订（PATCH，struct 重过钳制）、采纳（text 写 `event_pool.template` / struct INSERT 池，event_id 撞车 409）、废弃；全程审计。管理端事件页新增「草稿工坊」区。
- **种子扩池 24 → 30**（`0052`，主题与效果经用户确认）：名宿回访 / 赞助商突击考察（即发）+ 吉祥物出道 / 广告牌争议 / 看台 Wi-Fi 升级 / 城市嘉年华（选择）；存量 `0047` 种子补 satisfaction（brand_crisis / brand_anniv）与 signals（tifo_viral / bad_press / new_wave / merch_hit / scalper_raid / food_fest / derby_buzz）。
- **同队待选上限**：`event_rules.maxPending=3`——随机抽取达上限跳过（计 capped）、点名触发 409。
- `pickEvent` 剔除「选择型无选项且不设时限」的永久 pending 窄口；教练端事件视图 pending 分页口径统一钳 1..50。

**Changed**
- 超时兜底状态改记 **`expired`**（`0048` 列注释原义「expired = 超时兜底」归位；玩家 / 管理员结算仍 `resolved`，读侧 `status <> 'pending'` 兼容），结算回执与流水带「（超时自动结算）」；事件流水状态列加「超时结算」徽标。
- `runSettleTick` 把超时兜底挪到通知补发之后并各自 try/catch（v6.11.0 登记的可选改进兑现：迁移未 apply 类故障只挂兜底一环，不再连坐通知与缓存 purge）。
- 选项概率表的「（v6.12.0 生效）」标注收窄为只剩 `offer_spawn` 带「（C3 生效）」（satisfaction / signals 本版起真落库）。
- `resolveEvent` 白读收敛：无选项 / 选项均无结果的跳过路径不再装队况与效果依赖。

**Fixed**（变异验证 13 处全命中；首轮 2 处空转按最坏情况口径补强测试后命中——维护费信号加金额对账断言、llm-status 加「部分配置 = 未配置」用例；code-review 修复 2 条：非草稿行隐藏无效操作按钮、移除未用的 `loadEventRules` 装载）

**已知不改**：`window_signals` 通知无去重闸（关窗批失败重试可能重发，信号内容幂等）；选择型拖到归档窗关闭后结算的信号不消费（幅度小，登记接受）；`window_signals` 模板名同样待跨仓白名单确认。

## [v6.11.0] · D2 随机事件域：选择型事件 + 玩家互动 + 超时兜底（2026-09-28）

差异排期 D 块第二块（参考 AstrBot 插件 `event_engine.py` 的 `_resolve_choice` / `_roll_option` 与倒计时式选项处理）。含迁移 `0050_event_occurrence_reminded.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0050_event_occurrence_reminded.sql`：`event_occurrences` 加 `reminded_at TEXT NOT NULL DEFAULT ''`——cron 每 5 分钟一跳，靠这一列保证同一条待选只提醒一次。选择型的 `choice_no` / `outcome_json` / `deadline_at` 在 `0048` 一次建全 ⇒ **本版零结构改动**（0048 的设计目标在此兑现）。
- `src/worker/event-ops.ts`：`worstOption`（净额 = `money − maintenance` 取最小，并列按选项号、结果下标升序）/ `rollOptionOutcome`（选项内 `w` 加权选结果，权重 `max(1, trunc(w))`，抽样种子钉在 `[occurrenceId, choiceNo]` 上 ⇒ 「确定性伪随机替代插件的强制重算」在本仓同样成立，重放同结果）/ `renderChoiceText` / `shortDeadline`；`resolveEvent`（玩家选定 / 净额最差兜底 / 选项号越界同样按最差兜底 / 无选项信息跳过；效果语句与状态 UPDATE 放**同一批**，幂等以 occurrence 行的 `pending` 为闸，并发抢行改 0 行 ⇒ 409）/ `expirePendingEvents`（cron 兜底 + 24h 提醒，**只挑 `deadline_at IS NOT NULL`** 的行——D1 已知残留的即发型 `pending` 行不会被误结算）/ `listClubEvents`（教练端待选 + 最近已结）。
- 抽取侧放开选择型：`triggerEventBatch` 的随机路径不再只抽即发型（抽中只挂待选、当刻不落效果），点名触发对选择型同样放行（D1 的「要等 v6.11.0（D2）开放」400 已撤）。
- 端点（权限键 `club.squad.manage`）：`GET /api/club/events`（待选含选项全文 + 最近已结）、`POST /api/club/events/:id/choose`（归属 403 / 已结 409 / 选项号越界 400 在**路由层**拦下；引擎层的宽容兜底留给超时与无效号路径，玩家自己点错号码不该静默吃最差结果）。
- cron 接线（`src/worker/index.ts`）：`runSettleTick` 加 `expirePendingEvents`；`tickChanged` 加 `events.expired > 0`（兜底会落死忠/影响力等公开列）；24h 提醒只写 `notifications` 与 `reminded_at`，**不算公开数据变更**、不触发 purge。
- 通知模板（`src/worker/notify.ts`）：`event_resolved`（结算回执，含口径与效果播报）、`event_deadline`（距时限 24h 提醒）。
- 前端：`web/src/pages/club/CoachPanel.tsx` 新增「事件」卡（待选逐条列选项 + 一键选定、最近已结表，结算后失效刷新）；`web/src/lib/api.ts` / `queries.ts` 补类型与 `qk.events`；管理端 `web/src/pages/admin/EventsPage.tsx` 点名下拉放开选择型并标出「即发 / 选择」。

**Changed**
- `tests/event-ops.test.ts` 两例按 v6.11.0 语义订正：选择型参与随机抽取（D1 断言「池里只有选择型 ⇒ 掷中也不触发」已反转）、点名触发选择型不再 400。
- 超时口径文案统一改为「按**资金**最差结果自动结算」（触发通知 / `event_deadline` 模板 / 教练端卡片两处）：`worstOption` 只比 `money − maintenance` 净额，不含死忠与影响力，原文案说「最差」会让玩家按错预期。
- 选项概率表按权重**归一**后印百分比（原来是「把原始 `w` 当百分数」，只在同一选项内合计 100 时才等价）。

**Fixed**（code-review-skill 只读评审：**无 P0**——不会重复加钱 / 丢钱 / 公开数据错乱；共 2 P1 / 6 P2 / 9 P3）
- 概率表不再把本版**不落账**的三键当卖点：`satisfaction` / `signals` / `offer_spawn` 在展示侧带「（v6.12.0 生效）」标注（种子 `0047_event_pool.sql` 里 brand 系选项就有「65% 品牌满意度 +0.15」，本版一条 SQL 都不产生）。
- 超时扫描加下界 `deadline_at >= now − 7 天`：结算不掉的残行（「俱乐部已不在册」）会永久 pending 且 deadline 已过期，而扫描是 `ORDER BY id LIMIT 50` ⇒ 积满 50 条后整个超时兜底会静默停摆（终态化留 D3）。
- 24h 提醒查询补下界 `deadline_at > now`：否则会给已过期的行推「还有不到 24 小时可选」。
- 结算审计挂 `PENDING_GUARD` 并挪到批次首位（`AuditEntry` 新增可选 `guardSql` / `guardParams`，`src/lib/audit.ts` 带守卫时走 `INSERT…SELECT…WHERE`，与 `src/worker/bypass.ts` 手写那版同形）：原来并发抢输的一方会留下一条 `after` 快照并未生效的审计行。
- 结算 UPDATE 补写 `effects_json`（原来恒 `'{}'`，而 `0048` 的列注释写明「选择型为选中分支的效果」，管理端 occurrences 视图读它）。
- 教练端选定事件后补 invalidate `qk.myClub` + `['club','balance']`：事件效果改死忠 / 影响力，同页「主场档案」卡直接渲染它们，与设施升级 / 冠名同口径。
- `parseEventOptions` 按 `no` 去重丢后者：路由结算用 `find` 取第一个同号选项，重复号会让「按钮显示 A、实际结算到另一个 A」。
- `EVENT_TICK_LIMIT` 由字符串拼进 SQL 改为绑定参数。

**记为已知、本轮不改**：`runSettleTick` 无 try/catch 且 `expirePendingEvents` 排在通知补发之前 ⇒ 若 `0050` 未 apply，引用 `reminded_at` 的普通 SQL 错误会每 5 分钟把整个 tick 打断（**靠「先 apply 再 push」的纪律解决**，可选改进是挪到通知之后 + 各自 try/catch）；新通知模板名是否被插件按白名单拒收**本地无法证实**（插件仓 grep 不到 `/notify` 路由实现）⇒ 待确认；空 `options` + `choiceDeadlineHours <= 0` ⇒ 永久 pending（窄口）；INSERT occurrence 与触发审计分两批；视图分页口径不一（pending 硬编码 `LIMIT 20` vs recent 钳 1..50）；**随机池不再滤即时型**后掷中约 77% 是选择型（`0047` 权重即时型 28 / 选择型 94），且无「同队同时最多 N 条待选」上限 ⇒ D3 一并评估。

**验收**
- `npm run typecheck` 三份全清；`npx vitest run` **57 文件 / 950 例全绿**（v6.10.0 基线 56/916，净 +1 文件 / +34 例，全在新建的 `tests/event-choice.test.ts`）；`npm run build` = `dist/assets/index-DLnw5qCr.js` 608.24 kB / gzip 192.43 kB。
- 变异验证两轮。D2 本体 9 处：**7 处命中**——最差挑成最好 3 红 / 选项内权重被忽略 1 红 / cron 兜底连 `deadline_at IS NULL` 的即发型残留行也吃 1 红 / 路由不拦越界选项号 1 红 / 路由不校验归属 1 红 / 教练端 pending 不看 `event_type` 1 红 / `choiceDeadlineHours=0` 也设时限 1 红。**2 处未命中**（`resolveEvent` 的 UPDATE 闸、24h 提醒的抢闸）：同一不变量各被两道守卫守着（前者有 `row.status !== 'pending'` 早检，后者有查询里的 `reminded_at = ''` 过滤），单线程测试不可独立观测 —— 两处守卫的代码注释均已写明职责是**并发与重放**防线，不因未命中而删除。首轮这两条脚本报 `NO SUMMARY` 是脚本把成功路径的 stdout 清空了，重跑后确认是「变异未被捕获」而非「脚本空转」。评审修复新增 7 处**全命中**：展示标注 1 红 / 7 天下界 1 红 / 提醒下界 1 红 / 审计守卫 1 红 / `effects_json` 1 红 / 概率归一 3 红 / 选项去重 1 红。

**生效面**：迁移 apply + push 后——玩家（教练）在球队中心能看到待选事件并选定，逾期由 cron 按资金最差自动结算并广播回执，距时限 24h 收到提醒。

**后续（详见 `ROADMAP.md` 同名节「下一步（待令）」）**：
- ~~发布需单独授权~~ —— **已于 2026-09-28 随 v6.12.0 发布批次上线**（`0045`–`0050` 先 apply 到生产，再 push `68fc154..77f6eea`，Version `55a54d84-…`）。
- D3（v6.12.0）：`satisfaction` / `signals` / `offer_spawn` 三类消费端落库 + LLM 文案（仅管理端生成 + 落库审校）+ 种子池扩到 ~30；一并评估超时残行终态化与 `expired` 语义、选择型占比 ~77% 是否设待选上限、空 options 窄口、视图分页口径。
- 待确认（跨仓）：`event_resolved` / `event_deadline` 模板名是否被插件按白名单拒收。
- 更远：C2 冠名深度（满意度三信号 / 品牌主动解约 / 档位性格）、C3 招商轮。

## [v6.10.0] · D1 随机事件域：事件池 + 管理端触发 + 11 键效果即时结算（2026-09-28）

差异排期 D 块第一块（参考 AstrBot 插件 `event_engine.py` / `event_effects.py` 搬到本仓）。含迁移 `0047_event_pool.sql` / `0048_event_occurrences.sql` / `0049_stadium_event_pending.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0047_event_pool.sql`：`event_pool (id, event_id UNIQUE, name, category, weight, event_type, conditions_json, effects_json, options_json, soft_conditions, template, source, status, created_at)` + 24 条种子（6 即发 + 18 选择，逐字同插件 `DEFAULT_EVENTS`）。迁移 `0048_event_occurrences.sql`：`event_occurrences`（选择型的 `choice_no` / `outcome_json` / `deadline_at` 一次建全 ⇒ D2 零迁移）+ 两索引。迁移 `0049_stadium_event_pending.sql`：`stadiums` 加 `next_attendance_mod`（默认 1）与 `next_weather`（默认空）。
- config 两键：`event_rules`（命中概率 0.4 / 每队 1 次 / 同事件上限 2 队 / 软条件衰减 0.25 / 选项时限 72h）与 `event_clamps`（money 8、fans_pct 0.05、maintenance 5、brand_heat 0.3、build_credit 5、influence 10、booking_cancel 2）；注册表 65 → **67**。
- `src/worker/event-ops.ts`：条件判定（tier / capacity（**max_capacity 为本仓补**）/ fans / balance / facility_min / `weather_is` 读预置 / `last_result` / `requires_naming` / `requires_activity`）→ 加权单抽（软条件按 `softConditionFactor` 衰减参与、同事件 `maxOccurrences` 上限）→ **11 键效果**（`money` 记 `kind='event'`、`maintenance` 本仓改记 `kind='maintenance'`、`fans_pct` / `attendance_mod` 乘法叠加 / `brand_heat` / `build_credit` / `influence` / `facility` ±1 级 / `booking_cancel` 降序撤档 / `booking_gift` 补空档 / `weather_set`；`satisfaction` / `signals` / `offer_spawn` 留 v6.12.0，本批只播报）。
- **幂等以 occurrence 行自己当闸**（本仓事件没有关窗批可依附）：非账本效果语句一律追加 `AND (SELECT status FROM event_occurrences WHERE id = ?) = 'pending'`，同批末句置 `resolved`；批次自带审计 `action='event_trigger'`（`origin` = `user` / `cron_tick`）。
- 关窗消费：`home.ts matchAttendanceStatements` 读 `next_weather`（合法则替代现掷天气）与 `next_attendance_mod`（乘进需求），同批清零——**一次性，只对下一场主场生效**。
- 端点（权限键 `club.clubs.manage`）：`GET/PATCH /api/admin/events/pool`（池只读 + 启停）、`POST /api/admin/events/trigger`（无参按概率给所有队各掷一次；`clubIds` + `eventId` 点名绕过概率与条件）、`GET /api/admin/events/occurrences`。
- 前端：新建 `web/src/pages/admin/EventsPage.tsx`（侧栏第 10 项「事件」：触发区 + 池表启停 + 流水表）；账本加「事件」列；通知模板 `event_triggered`（即时型触发即广播）。

**评审修复**（code-review-skill）：① `loadEventContexts` 原先给 `clubIds` 里任何 id 都装上下文，管理端点名写错 id 会留下幽灵 occurrence 与流水 ⇒ 改为只给 `clubs` 表里真实存在的 id 装；② `GET /events/occurrences` 的 `?season=` / `?limit=` 空串被 `Number('')` 吃成 0（静默回落空列表 / limit 钳成 1 条）⇒ 空串按没给算。

**口径**：事件**不绑窗口**（两仓窗口语义不同，用户裁决），发生在赛季进行中、可多次触发，occurrence 只归档触发时的 (赛季, 窗)；D1 只开放即发型，选择型点名触发回 400「要等 v6.11.0（D2）开放」。**不做**：自定义事件编辑、招商轮（C3）、品牌主动解约与档位性格（C2 后段）、LLM 进玩家请求路径（D3 只做管理端生成 + 落库审校）。**已知残留**：occurrence 的 INSERT 与效果批不是同一批（先 INSERT 拿 id 再落效果），进程中途挂掉会留 `status='pending'` 的即发型残留行 ⇒ D2 的 `expirePendingEvents` 必须只挑 `deadline_at IS NOT NULL` 的选择型。

**验收**：typecheck 三份全清、vitest **56 文件 / 916 例全绿**（v6.9.0 基线 55/873，净 +1 文件 / +43 例）、build 成功（`dist/assets/index-Txp-AYZf.js` 605.38 kB / gzip 191.68 kB）；变异验证 12 处全命中（`requires_naming` 失效 / `maxOccurrences` 失效 / money 不钳幅 / `PENDING_GUARD` 失效 / 抽取不过滤即发型 / 撤档取最小档位 / 弃权记失败方 / 不消费 `next_weather` / 不乘 `next_attendance_mod` / 幽灵队守卫失效 / `?limit=` 空串 / `?season=` 空串）。



## [v6.9.0] · E 块球场档期：活动预订 + 关窗结算入账（2026-09-28）

差异排期 E 块（参考 AstrBot 插件球场档期域搬到本仓）。含迁移 `0046_venue_bookings.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0046_venue_bookings.sql`：`venue_bookings (id, club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)` + `UNIQUE (club_id, season, window_seq, slot_no)`（唯一约束自带索引，按队+赛季+窗查档期走索引；参考插件无索引）。
- config 两键：`activity_slots`（默认 2，界 0–20）与 `activity_config`（演唱会 3.0–8.0 + 损坏概率 0.15 / 损坏 2.0–5.0、电竞赛事 2.0–4.0、球迷开放日 0.5、青训夏令营 1.0 + 青训系数 0.1、空置 0，逐字同插件）；注册表 63 → **65**。
- `src/worker/venue-ops.ts`：档位活动的确定性结算——`seededUnit(seed, draw)`（FNV-1a + splitmix32）把「收入 / 损坏额 / 损坏判定」三次抽取钉在 `[club_id, season, window_seq, slot_no]` 上；`activityIncome` 与插件 `formula.py:497` 严格同序（先收入 → 草皮损坏（概率 ×(1−0.15×pitch_level)）→ concert 收入 ×(1+0.1×pitch_level) / youth_camp ×(1+0.1×youth_level)）；`bookSlot` 同槽位改订走 `ON CONFLICT DO UPDATE` 并回传原档期。
- 关窗结算：活动收入 `kind='activity'`、草皮损坏 `kind='maintenance'`，**都挂 `ref_type='booking'` `ref_id=档位行 id`**（与基础维护费的 `('maintenance','window',…)` 闸分离，互不干扰）；关窗批内每队结算，临时窗照算；`HomeWindowSummary` 增 `activityClubs` / `activityTotal`。
- 端点：`GET /api/club/bookings`（当前开窗或 `?season=&windowSeq=` 历史查询）+ `POST /api/club/bookings`（201 回 `{booking, previous}`；越界/未知活动 400、非开窗 409），权限键 `club.squad.manage`。
- 前端：教练面板新增「主场档期」卡（每队每窗按 `activity_slots` 排活动，非开窗只读）；账本新增「活动」列；`api.ts` / `queries.ts` 补 `BookingsResponse` / `BookingResult` / `qk.bookings`。

**评审修复**（code-review-skill）：`GET /api/club/bookings` 的显式历史参数原先 `Number('')` → 0、`Number('abc')` → NaN 都静默回落到当前开窗；改为成对校验（缺一参 400、非整数 400），`getOpenWindow` 收敛成一次调用。`tests/ledger-audit-lock.test.ts` 白名单加 `worker/venue-ops.ts`（自动路径并入关窗批，ref 锚回档位行，可重建）。

**口径**：预订免费不收钱，收益只在窗末入账；同一档位重复关窗时账本闸按 `(kind,'booking',档位 id)` 拦下，汇总数是「本窗生成额」口径（与维护费/冠名一致）；活动类型窗内可反复改（同一行、闸不变）。**不做**：插件 `open_day` 的 `fans_pct`（插件自身未实现）、档期与比赛日冲突校验（插件也没有）。

**验收**：typecheck 三份全清、vitest **55 文件 / 873 例全绿**（v6.8.0 基线 54/859，净 +1 文件 / +14 例）、build 成功；变异验证 8 处全命中（草皮减免 / concert 加成 / 青训加成 / `seededUnit` 丢 draw / 损坏挂错闸 / 越界忽略 `activity_slots` / 去开窗校验 / 关窗批不并入档期）。

## [v6.8.0] · C1 冠名活化：品牌池落库 + 行业系数 + 续约 + 热度动态（2026-09-28）

差异排期 C1 块（参考 AstrBot 插件冠名域的深度搬到本仓）。含迁移 `0045_brand_pool.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0045_brand_pool.sql`：`brand_pool (id, brand UNIQUE, heat, source, status, industry, created_at)` + 7 家种子（`INSERT OR IGNORE`，品牌名/热度/行业与插件 `brand_service.py:17-25` 逐字同）。此前 7 家品牌硬编码在 `src/worker/naming-ops.ts` 的 `DEFAULT_BRANDS` 常量里。
- config 两键：`naming_industry_factors`（医疗 1.2 / 运动 1.1 / 科技 1.3 / 饮食 1.0，未登记行业回 1.0）与 `market_heat_rules`（连胜 +0.03 / 连败 −0.02 / 热度钳制 0.5–1.5）；注册表 61 → 63。
- 冠名报价乘行业系数（`baseFee = round3(namingBaseFee(...) × industryFactor)`）；签约改查品牌池，弃用品牌回 400「不在品牌池」。
- `renewNaming`：只剩最后 1 窗可续，按当前队况与品牌现热度重算三套餐、原地换约，审计 `action='naming_renew'`。端点 `POST /api/club/naming/renew`；`GET /api/club/naming/quote` 有现约时多下发 `renewal`（品牌已弃用则 null）。
- 热度动态：关窗时按近 3 场战绩演化品牌热度（全胜 +0.03 / 全败 −0.02 / 其余不动；点球按平、弃权按取胜方），SQL 侧 `MAX/MIN` 钳制，同品牌多队同窗累加互不覆盖。
- 管理端品牌池三端点（`GET/POST /api/admin/brands`、`PATCH /api/admin/brands/:id`，权限键 `club.clubs.manage`）：列表带生效冠名数、新增自定义品牌（热度界内、行业 ≤10 字）、改热度/行业/弃用；**弃用守卫**——还有 active 合同的品牌不可弃用（插件无此校验，本仓补）。
- 前端：新建 `web/src/pages/admin/BrandsPage.tsx`（侧栏第 9 项「品牌池」）；教练端冠名卡在 `windowsRemaining === 1` 时出现续约入口。

**评审修复**（code-review-skill）：`GET /admin/brands` 生效冠名数改一次 `LEFT JOIN` 聚合（原按品牌相关子查询无索引可依）；`PATCH /admin/brands/:id` 空 body → 400（原先落空转 UPDATE + 审计）；`renewNaming` 审计改在 UPDATE 真改行之后写（并发 0 行不再留描述未发生变更的审计）。

**口径**：热度调整无独立幂等闸，靠关窗批首句窗口状态原子闸（失败整批回滚），与 fans UPDATE 同机制；合同费用是签约快照，热度只影响之后的报价与续约。

**验收**：typecheck 三份全清、vitest **54 文件 / 859 例全绿**（v6.7.0 基线 54/847，净 +12）、build 成功；变异验证 5 处（去行业系数 3 红 / 续约放开仅剩 1 窗 2 红 / 热度不钳上限 1 红 / 连败改升温 2 红 / 弃用品牌仍可签约 1 红——末条首轮空转，补测后命中）。

## [v6.7.0] · B 块可见性：近期主场战报 + 窗口财务汇总（2026-09-28）

差异排期 B 块（参考 AstrBot 插件「主场收入系统」的可见性能力搬到网页端）。零迁移、零生产写，纯只读端点 + 前端展示。

**Added**
- `GET /api/club/home-matches`（教练端）：最近 10 场主场的天气 / 上座（含上座率）/ 票务 / 商业 / 转播 / 合计收入与对手比分赛果（胜/平/负/点球/弃权）。对手名用 `result_confirmations.away_team` 确认时快照；`match_id` UNIQUE 保证 JOIN 不放大行。此前 `match_attendance`（迁移 0018）没有任何读端点。
- `GET /api/club/finance-summary?season=`（教练端，缺省当前可见赛季）：比赛日收入按 `match_attendance (season, window_seq)` 精确归窗；其余流水按 `created_at` 折叠进 `season_windows [opened_at, closed_at]`（两端含、在开窗口吃掉其后全部），出每窗 byKind / 净额 / 期末余额；窗外流水进 `outside` 不计入赛季合计。closingBalance 按 `(created_at, id)` 取末笔，不假设 id 与时间同序。
- 前端：教练面板新增「近期主场战报」卡（主场档案卡之后）；财政账本页新增「窗口财务汇总」卡（教练可见，工资/维护费/冠名/富人税固定列 + 其他归并 + 赛季合计行）；`queries.ts` 加 `useHomeMatches` / `useFinanceSummary`。
- 测试 `tests/club-visibility.test.ts` 10 例：六态赛果、上座率、LIMIT 截断、窗端点边界（恰等 opened_at / closed_at）、在开窗口吞流水、窗外归 outside、乱序插入、跨季混入、期末余额回退与浮点尾差收口。

**评审修复**（commit `5327b27`）：金额求和统一 round2（0.1+0.2 尾差）；赛季期末余额回退到最后一笔有流水的窗口；前端「冠名」列补 `naming_penalty`（违约罚金）。

**验收**：typecheck 三份全清、vitest **54 文件 / 847 例全绿**（v6.6.3 基线 53/837）、build 成功；变异验证 4 处（含端改开区间 / closingBalance 退化按 id / matchday 漏赛季过滤 / 胜负判定取反）各恰好 1 红。

## [v6.6.3] · fix 订正：青训等级接入死忠演化 + 战绩查询按 tour 队 id 认人（2026-09-28）

**Fixed**
- **青训设施等级接入死忠演化**（`src/worker/home.ts`）：`windowHomeStatements` 调 `evolveFans` 此前没传 `youthLevel`（默认 0 级），青训设施买到 5 级（累计 44M）对死忠涨粉零作用。现循环前一条批量查询建 Map 传入，涨粉系数 ×(1+0.03n)；掉粉路径不受青训影响（插件 fans_service 同口径）。
- **`clubFormPts` 队 id 语义订正**（`src/worker/home.ts` + `src/worker/prizes.ts` 新增 `tourTeamIdsByClub`）：赛果快照表存比赛系统队 id，函数原先拿 club id 查、靠生产 20/20「两套 id 逐队相等」的巧合命中（米兰 legacy 47 vs 131681 期间恒返中性 4）。现参数改认 tour 队 id：确认钩子直接用主队 tour id（零额外查询），窗末结算走 AUTH_DB 反向映射（**刻意不做 CPU 过滤**——战绩是描述性口径不是发钱闸）；无映射回中性 4 分。

**验收**：零迁移零生产写、无前端改动。typecheck 三份全清；vitest **53 文件 / 837 例全绿**（v6.6.2 台账 53/833，净 +4）；变异验证三处各恰好 1 红。生产当前 20/20 id 相等 ⇒ A2 在生产数值上零变化，纯防将来 rekey/扩队再翻车。**已随 2026-09-28 发布批次上线**（Version `55a54d84-…`）。

## [v6.6.2] · 排序索引 batch 8（`fc_id` 排序侧 + 初始视图 `pa`）+ `fc_id` 筛选保持裸列的实测例外（2026-09-27）

**缘起与裁决**：`scripts/d1-read-audit/README.md` §5.3 / §10 的候选清单只剩 **2** 个可建索引的键（`fc_id` 排序侧 + `view=initial` 的 `pa` 变体，2 × 18,301 = 36,602 行写），本批收口，索引批次到此结束。当日配额（UTC 2026-09-27T09:19）实测：账号合计读 314,949（6.3%）/ 写 1,032（1.0%）⇒ 写余 98,968 行，两条索引占 37%，额度无压力。

**新增**
- 迁移 `0044_players_sort_indexes_batch8.sql`：`idx_players_sort_fc_id`（`COALESCE(fc_id, 0)`）、`idx_players_sort_initial_pa`（`COALESCE(COALESCE(json_extract(game_attrs, '$.PA'), pa), 0)`），均尾列 `id`；`tests/d1.ts` 的 `MIGRATION_FILES` 追加。
- `scripts/d1-read-audit/verify-0044.mjs`（结构 + EXPLAIN 的只读证据生成器，口径同 `verify-0043.mjs`）。

**修正**
- `scripts/measure-d1-reads.mjs`：`sort-fc-id` 与 `sort-pa-initial` 两条标签从「顺延 / 未建索引」改成「0044 表达式索引」。

**两条裁决（均以实测为准）**
- **`fc_id` 筛选保持裸列**：该列自带 UNIQUE 索引（`src/db/migrations/0001_init.sql:23` 的 `fc_id INTEGER UNIQUE`），裸列等值筛选是 **1 行**读（`SEARCH … sqlite_autoindex_players_2 (fc_id=?)`）；按 §8 的「等值键异键时同源」写法改成 `COALESCE(fc_id, 0) = ?` 会认不出 UNIQUE 索引 ⇒ 掉到 **18,301 行**。⇒ 给 §8 规则补一条实测例外：**筛选列自带 UNIQUE 索引时必须保持裸列**。`src/worker/routes/players.ts` 的 fc_id 筛选一行未动，只加测试锁钉住。
- **`fc_id` 排序侧建索引**，而不是把排序表达式改裸列去吃 UNIQUE 索引（方案乙零写、实测纯排序 21 行 / 第 2 页 22 行确实可用）：keyset 游标拿排序表达式当键，裸列遇 NULL 比较恒假会**静默漏行 / 翻页截断**，而 `fc_id` 在 DDL 里可空 ⇒ 按最坏情况取上界；写额度充裕，不值得为省 18,301 行写换这个上界。

**实测与验收**：零配额前置 `scripts/check-sort-index-feasibility.mjs` **17/17 通过**；`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 833 例全绿**（v6.6.1 台账 53/826，净 +7）；`tests/players-sort-indexes.test.ts` 本文件 **98 例全绿**（原 91）。变异验证两处：删掉 0044 的 fc_id `CREATE INDEX` ⇒ **恰好 4 例红**（三条 `sort=fc_id` 计划用例 + schema 计数用例）；把 fc_id 筛选改成同源 ⇒ **恰好 1 例红**（新加的例外锁）；均非空转，改动后还原。

**生产（2026-09-27）**：apply `echo y | npx wrangler d1 migrations apply whl-club --remote` ⇒ 只列 `0044`、`Executed 3 commands in 157.33ms`、状态 ✅；**实写记账 +36,621 行**（当日 `whl-club` 写 268 → **36,889 = 36.9%**；预估 36,602，差 19 是校验开销）。结构核对（`verify-0044.mjs`）：`idx_players_sort_%` **23 → 25**、`tbl_name='players'` 的索引 **28 → 30**、`d1_migrations` **44** 条（末条 `0044`）。计划形状：`sort=fc_id` 与 `view=initial&sort=pa` 两条纯排序均 `SCAN players USING COVERING INDEX <新索引>`，带 keyset 游标的第 2 页 `SEARCH … USING COVERING INDEX <新索引> (<expr><?`（尾列 `id` 确实进了索引，否则仍会临时排序）。收益（`measure-d1-reads.mjs`，增量合并进 `measurements-after.json`）：`sort=fc_id` **36,602 → 24 行/次**、`view=initial&sort=pa` **36,602 → 61 行/次**。

**登记未改**：`view=initial` 只影响排序与显示口径、**不影响 ca/pa 的区间筛选**（`RANGE_PARAMS` 的 `src` 写死为存量列）⇒ 初始视图下按 `ca_min=100` 筛会按存量 CA 过滤、却显示初始 CA。属索引批次之前就有的口径不一致，改它是行为变更，登记待办不顺手改。

**部署（2026-09-27 已执行）**：本批**无 `src/` 运行时改动**（只加两条索引 + 测试锁 + 脚本）⇒ 索引与线上已有的排序表达式同源，**收益在 apply 那一刻就已生效**；push `6925cbd..68fc154` 把攒下的 docs 提交一起带走，CF 自动部署 Version `c15bb1ea-5d3c-4619-9730-687e99fbeaae`（2026-09-27T16:25:37Z）。上线核对：线上入口资产 `assets/index-DkUnWIV2.js` / `assets/index-BY0ef8kg.css` 与本地 6.6.2 构建**逐字同名**、线上 JS 内含 `6.6.2`；`sort=fc_id` 与 `view=initial&sort=pa` 线上 200、`/api/offers` 401。

## [v6.6.1] · 排序索引 batch 7（`china_plan` / `agent_tier` / `growth_gap` 两个口径）+ 成长空间筛选同源（2026-09-26 完成，2026-09-27 上线）

**缘起与裁决**：`scripts/d1-read-audit/README.md` §5.3 的候选清单还剩 4 个可建索引的键，用户裁决「现在是半夜，写额度可以尽可能全用」⇒ 按当日写额度排满 **4 条**（4 × 18,301 = 73,204；5 条必超）。选 `china_plan` / `agent_tier` / `growth_gap` **两个视图口径**；`fc_id` 顺延（`sqlite_autoindex_players_2` 已让筛选侧 seek，只差排序侧）；`growth_gap` 按迁移 `0036` 定下的规矩两个口径同轮建；明确排除 `influence`（排序表达式是运行时参数化的 `influenceExpr(coefs)`，系数取自库表 ⇒ 系数一改索引即失配）与合同维度键（挂 JOIN 的 `contracts` 上，`players` 索引覆盖不到）。

**新增**
- 迁移 `0043_players_sort_indexes_batch7.sql`：`idx_players_sort_china_plan`（`COALESCE(china_plan, 0)`）、`idx_players_sort_agent_tier`（`COALESCE(agent_tier, 0)`）、`idx_players_sort_growth_gap`（`COALESCE(pa, 0) - COALESCE(ca, 0)`）、`idx_players_sort_initial_growth_gap`（初始视图口径的同一差值），均尾列 `id`；`tests/d1.ts` 的 `MIGRATION_FILES` 追加。
- `scripts/d1-read-audit/verify-0043.mjs`（结构 + EXPLAIN 的只读证据生成器，从 `scratch/` 提升为受版本管理的工件）。

**修正**
- `src/worker/routes/players.ts`：`china_plan` / `agent_tier` 从裸列改走 `eqFilter`（同键裸列、异键同源，口径同 v6.4.1）；`growth_gap` 区间从裸差值改成两侧各套 `COALESCE` 的**同源**写法 + 双侧 `IS NOT NULL` 守卫 —— 裸差值任一侧为 NULL 整行被排除，套了 `COALESCE` 会把「两边都没录」的行当成 0 放进来。
- `scripts/measure-d1-reads.mjs`：四条形状标签从「未建索引」改成「0043 表达式索引」，`sort-fc-id` 标注顺延，新增形状 `sort-growth-gap-initial`。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 826 例全绿**（v6.6.0 台账 53/810）。变异验证两处：删掉 growth_gap 的双侧守卫 ⇒ **恰好 2 例红**；删掉 `eqFilter` 的同键分支 ⇒ **恰好 6 例红**。零配额前置 `scripts/check-sort-index-feasibility.mjs` **17/17 通过**。apply（用户已放行当日写额度）：`Executed 5 commands in 215.43ms`；实写 **+73,211 行**（当日写 18,721 → **91,932 = 91.9%**）。生产核对：`idx_players_sort_%` **19 → 23**、`tbl_name='players'` 的索引 **24 → 28**、`d1_migrations` **43** 条；四条纯排序 `SCAN players USING COVERING INDEX <新索引>`（21 行/次），`growth_gap` 区间 + 同键排序在两个视图口径下各自 `SEARCH … USING INDEX`。收益：`sort=china_plan` / `sort=agent_tier` / `sort=growth_gap` / `view=initial&sort=growth_gap` 四条 **37,635 → 22 行/次**。

**部署（2026-09-27 已执行）**：迁移先于 2026-09-26 apply 到生产；代码随后于 **2026-09-27 推送**（`49e6802..6925cbd`，同轮带上尚未推送的 v6.6.0 三枚提交）⇒ CF 自动部署 Version **`1f5498c5-569e-41e9-8544-7901c1beae65`**（Created `2026-09-27T08:11:24Z`）。上线核对：线上入口资产 `assets/index-DWMy6Pr5.js` / `assets/index-BY0ef8kg.css` 与本地在 6.6.1 下构建的产物**逐字同名**、线上 JS 版本串 `6.6.1`；`/api/health`、三个新排序键、`growth_gap_min` 筛选全 200，`/api/offers` 401。部署后按 `scripts/d1-read-audit/README.md` §6 口径重跑了端点级读数：排序侧四格仍 **22 行/次**；另补测筛选面 6 个形状（README §10），其中 `growth_gap` 区间 + 同键排序两个视图口径 **37,635 → 22**。

## [v6.6.0] · 球员库按角色筛选（五槽 OR，不建索引）（2026-09-26 完成，2026-09-27 随 v6.6.1 的推送一起上线）

**新增**
- 球员库：左栏「更多筛选」的 PlayStyle 旁新增「角色」多选下拉（`?role=7,107` 逗号多值），分 `角色 +`（ID 1-49）与 `角色 ++`（ID 101-149）两段、段内按名字首段的位置码分组；摘要条一条 chip「角色：…」（不拆两段）。
- 筛选语义：RoleID1-5 五槽**任一命中即算**（槽位与档位无对应关系，故不像 ps 那样按槽段切分）；`+` 与 `++` 是同一角色的两档但**筛时当两个独立值、互不命中**（照 PlayStyle 银/金裁决），不做家族合并；参数白名单 1-49 ∪ 101-149（100 空档），去重去 0、上限 100 项。
- `src/core/fc26.ts` 角色常量与纯函数（`ROLE_SLOT_COUNT` / `ROLE_SLOT_KEYS` / `ROLE_BASE_MAX` / `ROLE_PLUS_BASE` / `ROLE_PLUS_MIN` / `ROLE_PLUS_MAX` / `isRoleId` / `isRolePlusId` / `ROLE_FILTER_MAX_ITEMS`）。

**裁决：原计划的「索引批」（路线 A）弃用，改走纯 OR（路线 C）**
- 用户下指令「先做索引批」时原定 5 条部分表达式索引 + `sort=id` 惰性 UNION 驱动。动工前三条实测否掉了它：① 计划的驱动形状把「其它筛选」留外层、内层 UNION 带 `LIMIT ?`，**带其它筛选会静默漏行**（翻页跳过角色命中集里第 N 条之后又满足筛选的人），只在「角色是唯一筛选」时正确；② 唯一正确的全量下推变体在带 `ct.*` / 非索引筛选时计划退化（`SCAN ct` / `SCAN p` + `TEMP B-TREE`）；③ 生产只读实测 `role=11`（2,772 人持有）—— 驱动形状 **21,626 行/次**、五槽 OR 靠 `ORDER BY id` 早停只 **188 行/次**，即索引路的收益只覆盖稀有角色、常见角色反慢两个数量级，而代价是 33,742 行写。
- ⇒ **零迁移、零生产写**（省下 33,742 行，当日账号池余量 81,001 行）。索引批登记为「已量化、待配额」的独立候选（`scripts/d1-read-audit/README.md` §5.3）。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 810 例全绿**（v6.5.0 基线 53/803，净 +7 = 新增角色 7 例）；build 成功；e2e **11/11**。变异验证两处 —— role 分支砍成一槽 ⇒ **3 例红**、值清单改成家族匹配（`IN (n, n+100)`）⇒ **4 例红**；还原后 `diff` 逐字一致。生产只读实测（管理通道，零写）：五槽占用 18,301 / 9,670 / 4,850 / 881 / 40；95 个合法值持有中（98 − 3 个 0 持有），46 个持有 <21 人；角色唯一筛选首屏（LIMIT 21）持有 1/5 人 18,301、24 人 4,455、130 人 2,623、490 人 873、2,772 人 188；COUNT 恒 ≈18,301。

**部署边界（等指令）**：无迁移、无生产写 ⇒ push 即自动部署；部署后按 README §6 口径重跑 `scripts/measure-d1-reads.mjs` 补 role 形状到 `measurements-after.json`。

## [v6.5.0] · 球员「标记」属性（🔴🟡🟢）+ 队徽方框修复（2026-09-26，已上线：迁移 `0042` 先 apply，push `e95122c..a8bb833` 后 CF 自动部署 Version `3bea29d7`）

**新增**
- 球员「标记」：把注册合规的三档梯度（规则 4.2.2）互斥切分成 🔴（初始CA≥90）/ 🟡（87-89）/ 🟢（＜87 且 PA≥87 且可成长），不落档无标记。**实时计算不落库**——判定是 `COALESCE(base_ca, ca)` + PA + growable 的纯函数（`src/core/squad-rules.ts` 的 `markerOf`），列表与详情响应由服务端现算（`marker` 字段）。
- 球员库：可选列「标记」（不落档整格空置）、左栏「标记」筛选下拉（`?marker=ge90,ge87` 逗号多值）、表头点排序（`sort=marker` 按权重 🔴→🟡→🟢→无标记）、摘要条 chip。
- 球员页：球员卡右上徽标（悬停出全称）。
- 迁移 `0042`：`idx_players_sort_marker` 权重表达式索引（排序/筛选/索引三处共用 `markerWeightSql` 同源表达式；apply 一次性写 ≈18,301 行）。

**修复**
- 队徽方框：v6.4.0 改动 7 抽走圆形后，`.team-logo` 常驻的 1px 边框在方形徽（球员页/球队详情页）上显形成方框；边框移入 `.team-logo-round`，球队列表圆形徽外观不变。

**实测与验收**：typecheck 三份全清；vitest **53 文件 / 803 例全绿**（v6.4.1 基线 53/789）；`INDEXED_SORTS` 18 → 19 条；build 成功；e2e **11/11**。已知形状：`sort=marker&marker=…` 同键组合落 TEMP B-TREE，但只排等值命中组（≤~120 行）代价可忽略。**部署**：迁移 `0042` 先 apply（`Executed 2 commands in 47.58ms`，索引 SQL 只读核验一致）→ push 后 CF 自动部署 Version `3bea29d7`；上线回读 marker 筛选/排序全 200、线上资产 `index-BdMUWht2.js` 与本地 dist 逐字一致。

## [v6.4.1] · 筛选侧同源化——等值键按排序口径分写法（2026-09-26 完成，随 v6.5.0 的推送上线）

**缘起**：batch 6（迁移 `0038`）把筛选侧无条件改成与排序表达式同源（`COALESCE(col, 0) = ?`），当次只量了 `sort=growth_tier&growth_tier=3` 一格（18,302 → 1）就当成无条件更优。用户要求按最坏情况复核（原话：「`agent_tier` 每个窗口都会重随，总有不是全 2 的时候；`marketvalue` 也会有赋值和改动，重新评估」「测试的时候要以最坏的情况做打算，底线思维」「任何测试都是这样」），复核推翻了原结论。

**修正**
- 区间键保持同源（`SEARCH … (<expr> op ?)`）并加 `AND col IS NOT NULL` 守卫 —— `COALESCE` 会把「没录过」算成 0，`market_value<=500` 不加守卫会把全 NULL 的 18,301 行算成命中。
- 等值键按排序口径分写法：筛选键 ≠ 排序键 → 同源（读量 = 命中行数）；筛选键 = 排序键 → **裸列**（顺索引早停，上界 1 × 表）—— 同源在此时落 `+TEMP B-TREE` 读完整个同值组再排，上界 **2 × 表**（实测 `growth_tier=1` 36,602、`is_future_star=0` 36,395）。逐格有 2 格同源更省（`foot=0` 8,877、`growth_tier=3` 1），但那是命中组小的运气，值域会变 ⇒ 按上界取裸列。
- `src/worker/routes/players.ts`：`RANGE_PARAMS` 每条加 `src`（同源表达式）+ 区间循环改写；新增 `eqFilter(col, key, value, sortKey)` 与 `parseSortKey(c)`；`growable` / `foot` / `growth_tier` / `is_future_star` 改走 `eqFilter`（`china_plan` 保持裸列）；`countPlayers` 传 `'id'`；文件头注释补版本行。
- `tests/players-sort-indexes.test.ts`：新增 describe「筛选侧与排序表达式索引同源（v6.4.1）」= 5 条区间 SEARCH 锁 + 4 条同键等值「写裸列且不得 TEMP B-TREE」+ 异键同源 SEARCH 锁 + 区间守卫文本锁 + NULL 身价端到端语义锁（自建 3 行夹具）；删掉 batch 6 已被设计反转的 2 例。
- `scripts/d1-read-audit/probe-samesource.mjs`（新，只读证据生成器）；`scripts/d1-read-audit/README.md` 追加第八节（机制四条 + 24 行实测矩阵 + 裁决依据 + 净效果逐键 + 语义守卫 + 测试锁 + 复现命令），§5.5 三处订正（两行「已收」数字标为**带条件**、batch 6「配方」补修正）。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 789 例全绿**（v6.4.0 基线 53/779，净 +10 = 新增 12 − 删掉 2）；变异验证两处 —— `eqFilter` 同键分支失效 ⇒ **恰好 4 例红**、区间守卫删掉 ⇒ **恰好 2 例红**。生产只读复测（管理通道，零写）24 格与 README §8 逐格一致。净效果（v6.4.0 线上 → 本版）：`ca>=100` 18,301 → **1**、`prestige>=5` 18,301 → **15**、`base_ca>=100` 18,301 → **1**（同键排序时）、`is_future_star=1`+`sort=id` 924 → **21**、`growth_tier=1`+同键排序 36,602 → **21**、`growable=1`+同键排序 20,948 → **21**、`foot=1`+同键排序 27,726 → **21**、`is_future_star=0`+同键排序 36,395 → **125**；两格变差：`growth_tier=3`+同键排序 1 → 18,301、`foot=0`+同键排序 8,877 → 13,884（按上界取舍，见上）。

**部署边界（等指令）**：无迁移、无生产写 ⇒ push 即自动部署；部署后按 README §6 口径重跑 `scripts/measure-d1-reads.mjs` 更新 `measurements-after.json`（该文件由线上端点产生，未部署前仍是旧代码读数）。

## [v6.4.0] · 报价设置解耦 + 激活通知证据制 + 竞价截止绝对时刻化（2026-09-26，已上线：迁移 `0040`/`0041` 先 apply，push `6dc0eb5..5d5beb6` 后 CF 自动部署 Version `2c4a81e6`）

**缘起**：四项既定整改 + 三项 UI 改动打包。用户裁决逐条：「截止的语义就是经计算后的绝对时刻，不容 5 分钟差错」「没进转会名单的应该也可以设置最低报价和是否自动应答」「低于线都按自动拒绝」「激活通知应当是除了站内信外，激活方要在激活时证明他在 QQ 给被激活方发了激活通知，而且被激活方可以举报（聚宝）」「举报不冻结匹配窗」「去掉『（成交等过户确认）』」「当前最高要带当前最高的队名」「球员被挂牌时左栏下方也该有转会信息与出价途径，不然用户在哪里出价」「右栏默认展示改属性、队徽的圆圈除了球队列表都去掉」。D1 性能逐项算清：新增读面 ≈ 0。

**新增**
- 迁移 `0040_listing_deadline_activation_proof.sql`：listings 加 `deadline_at`（落库的绝对截止时刻）+ `activation_proof`（激活 QQ 通知截图 key）+ 触发器 `fund_holds_bid_deadline_guard`（冻结语句原子拦过线出价，`WHL_BID_REJECT_DEADLINE`）；`0041_players_offer_auto.sql`：players 加 `offer_auto`（达线自动同意开关）。`tests/d1.ts` 追加两者（41 个）。
- **改动 A 截止绝对时刻化**：出价成功即按 `bidDeadline()` 把新静默期的绝对截止落库（普通出价推进带 `deadline_at > now` 过线守卫）；激活推进与结算收口清列；读路径（列表/详情）与惰性结算两级判定——先读列、存量行 NULL 回落实时算（兼容）。
- **改动 B 报价设置解耦**：`autoRespondKind` 重写为 `(minOfferPrice, offerAuto, amount)`——低于线一律 auto_reject（与开关无关、即时退回），达线且 `offer_auto=1` 才 auto_accept，没设线走人工；`transfer_listed` 不再参与判定。`setOfferSettings` 解耦：最低报价/开关不必进名单，进名单仍必填线；无线时开关存 0；非卖品压掉线与开关。PUT 端点加 `offerAuto`，players 详情透出。
- **改动 3 文案**：`offer_accepted` / `offer_auto_accepted` 去「（成交等过户确认）」，auto 两模板去「转会名单」字样。
- **改动 4 激活通知证据制**：`POST /api/media/activation`（本仓首个 R2 写端点：教练鉴权、key 服务端生成 `activation/<clubId>/`、限 png/jpg/webp 与 5MB）；`createActivation` 必填 `proofMediaKey`（两个激活入口同步），落 `listings.activation_proof`；站内信五模板（`activation_notice` 附证据 / `activation_reported` / `activation_matched` / `activation_passed` / `activation_match_expired`）；举报端点 `POST /api/market/listings/:id/activation-report`（仅被激活方）——只建 `activation_report` 核查任务 + 通知激活方，**不改挂牌状态、不冻结匹配窗**；管理端审核队列扩 IN 两值（report 行按 kind 分流渲染 + 截图链接）、`POST /api/admin/reviews/:id/resolve` 收口（裁定不自动改数据，写备注进审计）、overview 计数同步。
- **改动 5**：转会区列表聚合补领先出价方（active 出价每单至多一条），`MarketListing.highestBidder`，卡片「当前最高」显示「队名 · 金额」。
- **改动 6**：`GET /api/market/listings?player_id=` 按球员查现行挂牌；`usePlayerListing` hook；出价表单抽成共享组件 `MarketBidForm`；SideOps 挂牌态换数据源（修 useBoard 客户端 find 的分页截断漏单），B 态（本队挂牌，含训练营球员被别队激活）加举报入口，**新增「外队挂牌中」分支（挂牌信息 + 出价表单）——顺带修掉别队挂牌球员落 C 态、暴露必 4xx 报价/激活按钮的真缺陷**。
- **改动 7**：球员页右栏默认页签改「属性」；`TeamLogo` 加 `circle` prop（默认 true：Clubs 列表照旧圆形；ClubDetail 与球员页传 false 出方形徽）；圆形样式抽 `.team-logo-round`。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 779 例全绿**（v6.3.2 基线 53/772；自动应答 describe 重写四例、解耦设置用例、证据制三例、出价落库 deadline_at + 触发器兜底、列表聚合与 player_id 过滤等新增 7 例）；`npm run build` 成功（主 bundle `index-C68fzOUs.js` 592.10 KB / gzip 188.26 KB）；e2e **11/11**。定向变异已由同源测试锁覆盖（触发器 `WHL_BID_REJECT_DEADLINE` 在用例内直接验证）。**教训**：media 子应用挂在 `/api/media`，新端点路径要写 `/activation`（写 `/media/activation` 会 404）；本地 `.wrangler/state` 的 D1 处于「schema 已在、`d1_migrations` 为空」陈旧态，`npm run db:migrate:local` 必然报错，新列直接 `npx wrangler d1 execute whl-club --local --file …` 落地。

**部署边界（等指令）**：上线序列 = 先 apply 迁移 `0040`/`0041` 到生产 → push（CF 自动部署）；代码读 `deadline_at`/`activation_proof`/`offer_auto` 列，与 v6.3.2 同理有「先迁移后 push」硬约束。

## [v6.3.2] · 审计来源通道（`origin`）与 actor 契约收口（2026-09-26，已上线：迁移 `0039` 先 apply，push `eb7adb7..1f6ea16` 后 CF 自动部署 Version `70ce7423`）

**缘起**：v6.3.1 补齐了「钱动了，谁认领」的人类留痕，但普查暴露两件事：① cron / 惰性结算触发的审计 `actor` 是 NULL 或 0，「无人可归因」与「忘了传 actor」在日志里长得一样；② `actor` 只能回答「谁做的」，回答不了「**哪条入口**触发的」——同一笔惰性结算，可能是管理员关窗顺手跑的，也可能是某个用户 GET 列表顺手跑的，排查时无法区分。本版给 `audit_log` 加 `origin` 列正面回答通道，并把 `actor` 契约统一为「人类行为人 id，机器一律 NULL」。

**新增**
- 迁移 `src/db/migrations/0039_audit_origin.sql`：`ALTER TABLE audit_log ADD COLUMN origin TEXT`（可空）+ `CREATE INDEX idx_audit_log_origin ON audit_log (origin, id DESC)`；`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0039`。
- `src/lib/audit.ts` 导出 `export type AuditOrigin = 'user' | 'cron_tick' | 'lazy_settle' | 'backchannel' | 'machine'`；`AuditEntry.origin` **必填**（TS 层强制，新增审计点漏写编译不过）。
- 管理端审计日志新增 `?origin=` 精确过滤（与既有 `?action=` 前缀过滤并列，AND 语义），响应加 `origin` 字段；前端「来源」下拉 + 五值中文标签（`AUDIT_ORIGIN_LABELS`），操作者单元格改为「操作者 · 来源」。
- `scripts/prod-20260926-audit-origin-backfill/`：历史行回填工件（`01-precheck` / `02-backfill` / `03-verify` / `99-rollback` / README），**已于 2026-09-26 执行：100 行全部回填，`null_origin = 0`、`bad1`–`bad4` 全 0**。
- 同源锁扩 4 例：`src/**` 内 `actor: 0` 哨兵绝迹、两处手写 `INSERT INTO audit_log` 的列清单必须含 `origin`（tsc 管不到手写 SQL）、`AuditOrigin` 五值在场、四个机器常量确实被用上。

**变更**
- **`actor` 契约**：机器行为一律 NULL，`0` 哨兵退役（自动赛果确认与认证中心全端登出原先写 0，现写 NULL）；`result_confirmations.confirmed_by` 新行写 NULL（列可空）。读侧仍兼容显示历史 `0` 为「系统」。
- **全部审计写入点声明来源通道**（约 60 处 / 22 文件）：管理端 / 教练自助 / 玩家操作 ⇒ `user`；`runSettleTick`（cron 与 `POST /api/cron/tick` 共用）与 `autoConfirmResults` ⇒ `cron_tick`；市场 / 报价 / 谈判 GET 顺手结算 ⇒ `lazy_settle`（**actor 保持 NULL，不把惰性结算记到触发用户头上**）；认证中心推送的全端登出 ⇒ `backchannel`；内部机器通道建队 ⇒ `machine`。关窗时管理员触发的惰性结算记 `user`（触发者是人，不新造 `window_close` 值）。
- 共享 helper 一律**穿参**而非硬编码：`settleOverdue` / `settleListingForReview` / `expireStaleOffers` / `finalizeOffer` / `rejectOfferCore` / `confirmResult` / `completeTransfer` / `completeTermination` / `rejectTransfer` / `healSettlement` / `createBypassTransfer` / `createClubFromTourTeam`；两处手写 SQL（`src/lib/audit.ts`、`src/worker/bypass.ts` 的 `chargeBypassFee`）列清单同步加 `origin`。
- 顺带（用户插入的 UI 请求）：市场板与谈判页的「位置 · CA · PA」行改为「位置 · 年龄 岁 · CA · PA」并去掉 CA/PA 文字标签（`web/src/pages/market/MarketBoardPage.tsx`、`web/src/pages/Negotiations.tsx`）。
- 契约写入 `TECH_DESIGN.md` **§17.6 actor / origin 契约**（两列分工表 + 五值判据 + 部署顺序硬约束），§17.5「已知次级缺陷」标为已修；`scripts/ledger-audit/README.md` 覆盖表加 origin 列、§5-1 标已修、§6 补二次普查快照；`coverage.sql` 加 S11 / S12 两条 origin 查询；`scripts/README.md` 加新工件索引；`package.json` 6.3.1 → 6.3.2。

**生产只读预检（2026-09-26，`Rows written = 0`）**：`audit_log` 共 **100 行 / max_id 100**，分布 `result_confirm 74（actor=0）` / `auth_login 15` / `auth_backchannel_logout 3（actor=0）` / `season_bind_tournament 3` / `club_bind 3` / `auth_logout 1` / `season_create 1`；**财政类审计仍 0 条**。回填期望：`lazy_settle 0` / `cron_tick 74` / `backchannel 3` / `user 23`，合计 100 行、回填后无 NULL 残留（第 ④ 条 `actor IS NOT NULL ⇒ user` 的依据：旧代码只有机器路径写 `actor = 0`，没有任何机器路径会传非空 actor）。

**实测**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **53 文件 / 772 例全绿**（v6.3.1 基线 53/767，新增 5 = 同源锁 +4、admin-system +1）；全新内存库跑全部 39 个迁移，`audit_log` 末列为 `origin:TEXT`、`idx_audit_log_origin (origin, id DESC)` 在场；`npm run build` 成功（主 bundle `index-Dx2i3s22.js` 584.87 KB / gzip 186.23 KB；hash 随 `__APP_VERSION__` 注入的版本号变化）。**`npm run db:migrate:local` 未跑成**：本地 `.wrangler/state/v3/d1` 被在跑的 dev server（workerd）占用，且该库处于「schema 已在、`d1_migrations` 为空」的陈旧态（报 `table players already exists`），与本次改动无关 ⇒ 0039 的干净落地改由两条路证明：① 全新内存库跑全部迁移（`tests/d1.ts` 的 `applyMigrations`）；② `npx wrangler d1 migrations apply whl-club --local --persist-to scratch/d1-check` —— 39/39 全 ✅，随后查得 `audit_log` 末列为 `origin:TEXT`、索引 SQL 为 `CREATE INDEX idx_audit_log_origin ON audit_log (origin, id DESC)`。

**上线（2026-09-26 已部署，Version `70ce7423-a61b-44ca-bc1e-b6c58be99370`，08:26:51Z）**：**部署顺序硬约束**——代码引用 `origin` 列，而 CF Workers Builds 只跑 `vite build && wrangler deploy`（**无迁移步骤**）⇒ **先 apply 迁移、再 push**。本轮按此执行：① `npx wrangler d1 migrations list whl-club --remote` 实测待应用项只有 `0039_audit_origin.sql`；② `npm run db:migrate:remote` 报 `Executed 3 commands in 2.13ms`、`0039_audit_origin.sql ✅`；③ 生产只读回读 `audit_log` 末列 `origin:TEXT`、`idx_audit_log_origin (origin, id DESC)` 在场、`COUNT(*) = 100` 且 `origin IS NULL = 100`（历史行待回填）；④ `git push origin main`（`eb7adb7..1f6ea16`）；⑤ 线上首页资产由 `index-Ccub4jvf.js` 变为 `index-Dx2i3s22.js`（= 本地 dist 产物）⇒ 部署落地。

**历史行 `origin` 回填（2026-09-26 已执行，用户授权）**：回填前复跑只读预检，工件假设仍成立（`total = 100`、`max_id = 100`、`origin IS NULL = 100`、`origin IS NOT NULL = 0`、`id > 100` 的 NULL 行 0 条 ⇒ 迁移与新代码上线后尚无新审计行写入，`99-rollback.sql` 的 `id <= 100` 边界仍准确）。`npx wrangler d1 execute whl-club --remote --yes --file=scripts/prod-20260926-audit-origin-backfill/02-backfill.sql` 报 `Total queries executed = 4`、`Rows written = 200`、`sql_duration_ms 4.10`、`changed_db true`；`03-verify.sql` 只读验收**逐项与期望一致**：`total 100` / `null_origin 0` / `user 23` / `cron_tick 74` / `backchannel 3` / `lazy_settle 0` / `machine 0` / `other 0`，反例 `bad1`–`bad4` 全 0。回填后分布：`cron_tick·result_confirm·actor=0` 74（2026-09-20T05:45:06.359Z → 2026-09-25T13:15:37.697Z）、`backchannel·auth_backchannel_logout·actor=0` 3、`user` 23（`auth_login` 15 / `season_bind_tournament` 3 / `club_bind` 3 / `auth_logout` 1 / `season_create` 1）。**刻意未做**：`actor = 0` 的历史哨兵保持原样（`0` 是历史值，读侧按「系统」兼容显示；通道已由 `origin` 说明）。**未执行回滚**（不需要）。

## [v6.3.1] · 财政域留痕补齐与一笔线上订正（2026-09-26，已上线：与 v6.3.2 同轮部署，Version `70ce7423`）

**缘起**：生产普查（报告落 `scripts/ledger-audit/`）发现账本只保证「钱对不对」，不保证「人认不认领」——除自动奖金（`prize`）与自动主场收入（`revenue`）外，生产上唯一一笔支出是慕尼黑1860（club 33）的球场扩建 −0.50M，而 `audit_log` 里**零留痕**，操作人只能靠相邻的 `club_bind` 审计行反推。本版补齐人类触发路径的留痕，并把那笔支出按补偿分录口径订正。

**新增**
- `tests/ledger-audit-lock.test.ts`（5 例，同源锁）：静态扫描 `src/**` 强制四条约束——白名单外凡含 `ledgerMovement(` 的文件必须同时具备审计能力（`createAuditStatement` / `writeAudit`）；白名单文件必须**仍然**在写账本（防豁免区腐烂）；`INSERT INTO audit_log` 只许出现在 `src/lib/audit.ts` 与 `src/worker/bypass.ts`；`src/worker/routes/clubs.ts` 四个自助财政端点必须传 `user.id`，`window_close` 审计必须带 `payroll` / `home` 汇总。
- `scripts/ledger-audit/`：`README.md` 财政域留痕普查报告（每个 kind 的写入点 / 审计 action / actor 来源、白名单理由、已知次级缺陷、生产实证、权威锚点）与 `coverage.sql`（10 条只读复核查询，S3 是 `Σbalance − Σamount = 0` 守恒硬断言）。
- `scripts/prod-20260926-rollback-stadium-expand/`：线上订正工件（`01-precheck.sql` / `02-rollback.sql` / `03-verify.sql` / `99-rollback.sql` / `README.md`）。

**变更**
- **球场三端点留痕**：`expandStadium` / `upgradeStadiumTier` / `upgradeFacilityLevel` 各加必填末参 `actor`，同批写 `stadium_expand` / `stadium_upgrade` / `facility_upgrade` 审计（`target_type='stadium'`，`before` 为改动前三列、`after` 为新值 + `seats`/`cost`/`creditUsed`/`cash`/`refund`）；`src/worker/routes/clubs.ts` 三处端点传 `user.id`。守卫取值改为按语句下标显式定位。
- **冠名解约留痕**：`terminateNaming(env, clubId, actor)` 写 `naming_terminate`（`target_type='naming_contract'`，赔款为 0 也留痕）；路由端点传 `user.id`。
- **审核类附加费留痕**：`chargeBypassFee` 加第 7 参 `actor`，手写条件 INSERT `bypass_fee`——`createAuditStatement` 表达不了 `WHERE`，而该审计必须与账本自己的幂等闸及批内余额/状态守卫**逐字一致**，否则审核重放或并发动用余额时会留下「钱没扣、审计说扣了」的失实行；故排在账本之前落库，守卫取末条 `transfers` UPDATE 的 `meta.changes`。这是全仓第二处手写 `INSERT INTO audit_log`（第一处是 `src/lib/audit.ts` 自己）。
- **关窗批汇总**：`window_close` 审计的 `after` 增两个键 `payroll`（`PayrollSummary`：`wageClubs`/`wageTotal`/`taxClubs`/`taxTotal`）与 `home`（`HomeWindowSummary`：`maintenanceClubs`/`maintenanceTotal`/`fansClubs`/`namingClubs`/`namingTotal`），让自动扣款也归因到「谁关的窗」。
- 留痕判据三档写入 `TECH_DESIGN.md` §17.5（人类触发必留痕 / 自动但可重建锚回业务对象 / 账本原语分层不留痕）；`scripts/README.md` 加 `ledger-audit/` 与 `prod-20260926-*` 两处索引。
- `package.json` 版本 6.3.0 → 6.3.1。

**实测**：typecheck 三份全清；vitest **53 文件 / 767 例全绿**（v6.3.0 基线 52/762，含新增锁测试 5 例与 stadium/naming/window/bypass 四处行为断言）；build 成功（主 bundle `index-D8FGDNfM.js` 584.84 KB / gzip 186.22 KB；前端版本号由 `vite.config.ts` 的 `__APP_VERSION__` 从 package.json 注入，故 hash 随 6.3.0→6.3.1 变化、字节数不变）。

**上线（2026-09-26：生产库已订正；代码与 v6.3.2 同轮部署，Version `70ce7423`）**：`02-rollback.sql` 经 `--file` 执行 `changes=4` / `last_row_id=163`；`03-verify.sql` 十列全中——club 33 容量回到 **12000**、建设券 **0**、余额 **56.51**、`manual_adjust` **1** 条、原 `stadium_expand` 流水**仍在**、**守恒 `drift = 0`**、流水共 **163** 笔（`prize` 103 / `revenue` 58）。订正口径为**补偿分录**：新增 `manual_adjust` +0.5（id=163，memo 指回原流水 id=141），`ledger_accounts.balance` 差额加回，**原流水未删未改**（账本只增，删行会破坏 `balance_after` 链）。不可逆影响面为空：该队历史最大上座 **10140** < 原容量 12000，扩建从未影响过任何一场的上座与收入。

## [v6.3.0] · 报价 / 议价子系统（2026-09-26，已上线：本次 push 前线上 Version `fefd7366`，02:31Z；迁移 `0037` 已 apply 到生产）

**新增**
- 迁移 **`0037_offers.sql`**：`players` 加三列（`transfer_listed` / `min_offer_price` / `not_for_sale`，报价设置）；`offers` 报价单表（多买方可并发同挂一球员，partial unique `idx_offers_active_pair` 只拦同买方重复）+ `offer_events` 谈判桌事件流 + 触发器 `fund_holds_offer_guard`（与 0005 同形：offer 仍 pending / 冻结额与报价单一致 / 可用资金足额，错误码 `WHL_OFFER_REJECT_*`）。
- 纯逻辑 `src/core/offer-rules.ts`：金额边界（下限 1 m、上限 1.5×违约金）、严格抬高、轮次判定、名单自动应答（达线 auto_accept / 低于 auto_reject）。
- 业务编排 `src/worker/offers.ts`：送报价（报价即冻结 + 名单球员立即自动应答）/ 还价（买方还价顶替冻结、卖方还价不动资金）/ **同意即挂牌事务**（占用批 + 履约批：建挂牌 → hold 转正 → 领先出价 → 球员 listed → 兄弟单 expired 释放冻结；幂等可重入，崩溃窗口由 `expireStaleOffers` 自愈补履约）/ 拒绝 / 撤回 / 惰性过期（窗关 / 球员状态变 / 同球员已挂牌三因）/ 报价设置。买方接受卖方抬价后的还价时先补足冻结再占用。
- 路由 `src/worker/routes/offers.ts`：`GET /offers`（box in|out + 状态筛选 + 游标分页 + `pendingMine` 徽标数）、`GET /offers/:id`（含事件时间线，买卖双方可见）、`POST /offers`、`POST /offers/:id/counter|accept|reject|withdraw`、`PUT /players/:id/offer-settings`。触发器兜底裸错（`WHL_OFFER_REJECT_*` / partial unique）在业务层映射为可读 4xx（与 market 的 `WHL_BID_REJECT_*` 同形）。
- 通知 8 模板（`offer_received/countered/accepted/rejected/withdrawn/expired/auto_accepted/auto_rejected`）；「同意即挂牌，成交要等过户确认」口径（用户裁决 2026-09-25）贯穿通知、徽章与按钮文案。
- 前端：`/offers` 转会报价页（两页签 + 状态筛选 + 清单表格 + 谈判桌），顶栏「转会报价」入口；球员页左栏 `SideOps` 五态骨架接线真实端点（拆出 `web/src/pages/player/SideOps.tsx`）——报价设置真实读写、续约/挂牌/解约/报价/激活/海捞全可用、B 态显示真实要价与最高出价、D 态非卖品报价禁用。

**变更**
- `src/worker/market-settle.ts`：`settleOverdue` 开头先跑 `expireStaleOffers`（cron / 窗开关 / 读路径三处调用点全覆盖）。
- `src/lib/cache-policy.ts`：`WRITE_SCOPE_PREFIXES` 加 `/api/offers` 与 `/api/players`（offer-settings 挂后者）。
- `src/worker/routes/players.ts`：球员详情响应加 `transferListed / minOfferPrice / notForSale` 三字段。
- **随批交付（独立改动线）**：迁移 **`0038_players_sort_indexes_batch6.sql`** 两条排序索引（`growth_tier` / `future_star`），并把这两列的等值筛选侧改成与索引同源的 `COALESCE(col, 0) = ?`——一条索引同时收排序与筛选（`tests/players-sort-indexes.test.ts` 新增「seek 不是全索引扫」断言锁死）。

**实测**：typecheck 三份全清；vitest **52 文件 / 762 例全绿**（v6.2.0 基线 51/728，含新增 `tests/offers.test.ts` 26 例与变异验证三件套：删严格抬高 / 删 partial unique / 删触发器各定向变红）；build 成功（主 bundle `index-DFG2gxUk.js` 584.84 KB / gzip 185.35 KB，较 v6.2.0 +2.2 KB）；e2e **11/11**；双会话浏览器手测全链路 PASS（报价 → 收件 → 同意 → 挂牌 B 态 → 非卖品 D 态 → 海捞 E 态 → offer-settings 保存与清回），截图落 `scratch/manual-v63-*.png`。迁移 0037 已在本地 D1 apply。

## [v6.2.0] · 球员页展示层改版（2026-09-25，已上线：本次 push 前线上 Version `fefd7366` 已含本版）

**新增**
- 球员页左栏五态骨架 `SideOps`（`web/src/pages/Player.tsx`）：本队未挂牌 = 报价设置（转会名单 / 最低报价 / 非卖品，全禁用）+ 续约/挂牌/解约 + 「我收到的报价」入口；本队挂牌中 = 「转会区 · 本队挂牌中」信息卡；别队真人 = 报价/激活；非卖品 = 报价禁用（后端暂无字段，运行时不可达）；CPU 队/自由身 = 海捞签入。**控件全部禁用，真实数据与动作接线在 v6.3.0 报价子系统。**
- 属性页签头部两栏：左 = 标题/位置/角色，右 = **队徽 96px**（`TeamLogo`，logoKey 借公开 `GET /api/clubs` 的 `ClubSummary.logoKey`，哈希色块兜底）+ **232×156 光图六维雷达**（轴标签 = 三字母 + 数值；`radar-card` 卡框与文字 legend 整块删除）。

**变更**
- 状态词两表合一：删 `web/src/lib/ref.ts` 的 `STATUS_LABEL`（正常/无归属），全站统一用 `players-library.ts` 那套（在队/自由身）。
- 术语：「挂牌板 / 挂牌单」→「转会区」（市场板 h3 一处界面文案 + 6 处注释；页面大标题「转会市场」不动）。
- **转会窗门控（用户裁决「转会操作只有窗开时开放，管理端可手动开关」）**：球员页左栏接公开 `GET /api/seasons/current`，关窗出「转会窗未开放」提示条（后端六类转会写操作本就有 409 `no_window` 守卫、管理端开/关窗 UI 已存在，均零改动）；**改号也归转会窗管**（用户补令）——`POST /api/club/players/:id/number` 加窗守卫（关窗 409），球员页号码编辑入口关窗收起改只读。
- 队徽与 CPU 判据数据源：球员详情页按需拉公开 `GET /api/clubs`（与球队页共用 `qk.clubsList` 缓存键，服务端 24h scope 缓存）。
- `package.json` 版本 6.1.1 → 6.2.0。

**实测**：typecheck 三份全清；vitest **51 文件 / 728 例全绿**（含新增关窗 409 用例）；build 成功（主 bundle gzip 183.15 KB，较 v6.1.1 +0.7 KB）；e2e **11/11**；五态浏览器手测 + 窗关/窗开两态翻转实测全过（本地夹具临时翻转、测后还原），截图落 `scratch/manual-*.png`。

## [v6.1.1] · Sentry 错误追踪接入（2026-09-25，已上线：Version `b05e86db`）

**新增**
- `wrangler.jsonc`：`compatibility_flags: ["nodejs_compat"]`（Sentry SDK 依赖 AsyncLocalStorage）+ `version_metadata` 绑定（Sentry release 自动 = Cloudflare 部署版本 ID）。
- `src/worker/index.ts`：`@sentry/hono/cloudflare` 的 `sentry()` 中间件挂在一切路由之前（errors-only：`tracesSampleRate: 0`，SDK 默认过滤让带 status 的 3xx/4xx 业务错误不上报）；cron 从 `ctx.waitUntil` 改 `await` 并加 `withMonitor('club-settle-tick')`（Sentry Crons check-in 监控）；新增 `POST /api/cron/sentry-probe`（CRON_KEY 守卫）作上线验证探针。`app.onError` 与全部报错 JSON 形状不动。
- `src/worker/env.ts`：`SENTRY_DSN?`（secret，未配 = SDK 完全不初始化、零上报零网络）、`SENTRY_ENVIRONMENT?`、`CF_VERSION_METADATA?`。
- `web/src/lib/sentry.ts` + `main.tsx`：`@sentry/react` errors-only 初始化（不引 replay/ErrorBoundary）；DSN 空串 = 未接入。
- `tests/sentry.test.ts` 3 例（DSN 未配旁路 / 探针 403 / 探针 500 JSON 形状）。

**变更**
- `tests/media.test.ts`：waitUntil 精确计数 `toHaveLength(1)` 放宽为 `≥1`——Sentry 会在同一 executionCtx 登记自己的 flush drain（生产语义：让 isolate 活到事件发完）。
- `package.json` 版本 6.1.0 → 6.1.1；新增依赖 `@sentry/hono` / `@sentry/cloudflare` / `@sentry/react`（v11.0.0，首个第三方 SaaS 运行时依赖）。

**实测**：typecheck 三份全清；vitest **51 文件 / 727 例全绿**（基线 724）；build 成功且主 bundle `index-BqdBJFJR.js`（477,874 B / gzip 149,563 B）**与改动前逐字节同 hash**——前端 DSN 为空串时 rollup 把整个 SDK 死代码消除，填 DSN 后须实测增量（硬线 ~35KB gzip）；e2e **11/11**；`wrangler deploy --dry-run` worker 打包通过。

**上线（2026-09-25）**：Sentry 账号已建（EU 区 org，6 项目）；生产 `SENTRY_DSN` 已配（Source `Secret Change`，Version `6066268f-…`，10:01:17Z）；前端 DSN 已填（提交 `a502043`）并实测 @sentry/react 进包 gzip 增量 **32.92 KB**（149,563 → 182,479 B，硬线内贴线过）；push 后 Workers Builds 自动部署 Version **`b05e86db-…`**（10:24:56Z），回读 `/api/health` 200、`POST /api/cron/sentry-probe` 无 key 403（该路由只在 v6.1.1 代码 ⇒ 新代码生效）、线上首页资产 `index-DwvQl1O1.js` 与本地 dist 逐字一致。**待回读**：带生产 CRON_KEY 打 probe 在控制台见事件、Crons 页确认 `club-settle-tick` monitor（首个 `*/5` 整点自动创建）。配额口径：errors 5k/月 = org 级共享池（6 项目共用，官方文档核对）；免费档全 org 只含 1 个 cron monitor（check-in 次数不占 errors 额度）。

## [维护] · 排序索引 batch 6：迁移 `0038`（2026-09-25 已 apply 到生产：无运行时行为变化）

**缘起（本批换了选键依据）**：batch 4/5 是「配额能推几条推几条」，本批先查清「这 6 个键到底有没有人用」再选，结果**推翻了原计划**：① `web/src/lib/players-library.ts:273` 的 `DEFAULT_COLS = ['marketValue', 'badges']` ⇒ 这 6 个键**一个都不是默认可见列**，排序要用户先手动挑列才发生；② 用户真正会做的是**筛选**，而筛选侧走**裸列**（`players.growth_tier = ?`，`src/worker/routes/players.ts:295-320`）与排序侧的 `COALESCE(col, 0)`（`:80-88` `buildSortExprs`）**不同源** ⇒ 表达式索引帮不上筛选 —— 这就是「排序降了、筛选没降」的机制。

**设计裁决**：排序侧不动（仍 `COALESCE(col, 0)`），索引建 `(COALESCE(col, 0), id)`，**筛选侧改成 `COALESCE(col, 0) = ?` 与索引同源**。否掉原计划的「排序改裸列 + 普通列索引」：keyset 游标拿排序表达式当键，裸列一旦为 NULL 比较恒为假会**静默漏行**（`src/worker/routes/players.ts:96` 的 years 注释写明这条规矩），而这五列在 `src/db/migrations/0001_init.sql:18-23` 是可空的（生产当前 NULL 数 0，但口径不该依赖数据现状）；两条路的写配额相同。

**交付**
- `src/db/migrations/0038_players_sort_indexes_batch6.sql`（**2026-09-25 已 apply**，报 `Executed 3 commands in 62.85ms`）：`idx_players_sort_growth_tier`（`COALESCE(growth_tier, 0), id`）、`idx_players_sort_future_star`（`COALESCE(is_future_star, 0), id`）。**apply 绕开未授权的 `0037`**：`0037_offers.sql` 是另一会话在途的报价子系统迁移，用仓库配置跑 `d1 migrations apply` 会把它一起 apply ⇒ 临时配置 `scratch/wrangler-0038.jsonc`（`migrations_dir: "migrate-0038"`，目录里只放 0038）先 `migrations list --remote` 确认只剩 0038 再 apply；apply 后账本核对最新 = `0038`、上一条 = `0036` ⇒ 0037 未被 apply。
- `src/worker/routes/players.ts`：筛选侧 `filters.push('COALESCE(players.growth_tier, 0) = ?')` + 循环里 `['is_future_star', 'COALESCE(players.is_future_star, 0)']`。
- 同源锁：`tests/players-sort-indexes.test.ts` 元组加第 4 元素 `filter`、新增 2 条「等值筛选走同一条索引」用例、`INDEXED_SORTS` 16 → **18 条**；`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0038`；`scripts/measure-d1-reads.mjs` 补 **9 条探针**（6 个未建索引键 + `view=initial&sort=pa` + 2 条筛选形状）。

**关键发现（SQLite 计划器）**：索引首列被等值约束时，SQLite **不再用它出 ORDER BY** —— `scratch/probe-0038-plan.mjs` 七种组合实测：只排序 → `SCAN … USING COVERING INDEX`（有序、无临时排序）；筛选 + 同键排序（含 ASC / 无 id 尾列变体）→ `SEARCH … USING COVERING INDEX (…=?)` + **`USE TEMP B-TREE FOR ORDER BY`**。⇒ 筛选侧收益是「读量从全表扫降到命中子集」，不是提前停；用例因此只锁 `SEARCH`，不断言无临时排序。

**收益实测**（读数落 `scripts/d1-read-audit/measurements-after.json`）：`sort=growth_tier` 37,635 → **22**、`sort=future_star` → **22**、`sort=growth_tier&growth_tier=3` 18,302 → **1**、`sort=future_star&is_future_star=1` 18,504 → **307**。未建索引的 `china_plan` / `agent_tier` / `fc_id` / `growth_gap` / `view=initial&sort=pa` 五条仍 37,635（把 §5.1 的类级推断再实测一次）。生产 `sqlite_master` 核对 `idx_players_sort_%` **16 → 18 条**；生产 EXPLAIN：排序 `SCAN players USING COVERING INDEX idx_players_sort_growth_tier`、筛选 `SEARCH players USING COVERING INDEX idx_players_sort_growth_tier (<expr>=?)`。

**写入记账**：本次 apply 实写 **≈36,607 行**（apply 前当日 `whl-club` 写 55,075 → apply 后 **91,682 = 91.7%**）⇒ **当日写额度已贴顶，剩余 ~8,318 行放不下第三条索引（18,301）**，本批到此为止。

**验收**：`npm run typecheck` 三份 tsconfig 全清（当时 16 个错误全落在另一会话在途的 `tests/offers.test.ts`，本批四个文件零错误）；`npx vitest run` **52 文件 / 762 例全绿**（基线 50/724，多出的 2 文件来自另一会话在途的 offers 测试）；`npm run build` 成功。

**还剩**：`china_plan` / `agent_tier` / `fc_id` / `growth_gap` 四个键 + `view=initial` 口径的 `pa` / `growth_gap` 两个变体；这四个键与 `growth_tier` 同性质（排序表达式 + 裸列筛选），可照本批配方用一条索引收两面。**代价**：`players` 索引 21 → **23** 条（upsert 重导成本口径需按同一方法重算，本批未做）。

## [维护] · 排序索引 batch 4/5：迁移 `0035` / `0036`（2026-09-24 / 09-25，两个迁移已 apply 到生产：无运行时行为变化）

用户 m04225 裁决「先看看剩余写限额，能推几条是几条」⇒ 先实测当日配额，再按余量把第 5 节清单上的排序索引推进生产。**不改 `src/` 与 `web/`**：只有两个迁移、测试与文档 ⇒ 运行时代码与前端产物零变化。

**新增**
- `src/db/migrations/0035_players_sort_indexes_batch4.sql`（**2026-09-24T23:54Z apply，UTC 归零前 6 分钟**，报 `Executed 3 commands`）：`idx_players_sort_position`（12 项 `CASE position WHEN 'GK' THEN 1 … ELSE 0 END, id`，逐字等于 `src/worker/routes/players.ts` 的 `POSITION_SORT_CASE`，**索引侧必须去掉 `players.` 限定符**，否则 SQLite 报 `the "." operator prohibited in index expressions`）+ `idx_players_sort_growable`（`COALESCE(growable, 0), id`）。选这两条的理由：它们是 `web/src/lib/players-library.ts` 的 `FIXED_COLUMNS`（位置 / 成长，永远在表头、不可隐藏），暴露面最大，表达式也最安全。
- `src/db/migrations/0036_players_sort_indexes_batch5.sql`（**2026-09-25T00:00Z 归零后 apply**，报 `Executed 4 commands`）：`idx_players_sort_badges`（`(COALESCE(badges_silver, 0) + COALESCE(badges_gold, 0)), id`）、`idx_players_sort_base_ca`（`COALESCE(base_ca, 0), id`）、`idx_players_sort_foot`（`COALESCE(foot, 0), id`）。**刻意跳过 `growth_gap`**（理由写进迁移注释）：它在默认视图下可静态索引，但 `view=initial` 口径下 pa/ca 换成另一套表达式，单独建默认视图那条只覆盖一半场景 ⇒ 与 `view=initial` 的 `pa` 变体同轮处理。
- `scripts/measure-d1-reads.mjs` 补 5 条探针：`sort-position` / `sort-growable` / `sort-badges` / `sort-base-ca` / `sort-foot`（原 SHAPES 里没有这 5 个键，不补就没有「改后」读数可对）。
- `tests/players-sort-indexes.test.ts` 的 `INDEXED_SORTS` 11 → **16 条**（新增 5 条各带 cursor / `order=asc` 三形状），`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0035` / `0036`。

**配额实测**（`scratch/quota-check.mjs`，走 Cloudflare GraphQL `d1AnalyticsAdaptiveGroups`）
- 2026-09-24T23:49Z：`whl-club` 读 221,080（4.4%）/ 写 54,997（55.0%）；**账号池余量 ≈44,541 行 ⇒ 2 条索引（36,602）放得下、3 条（54,903）会超** —— 这是把本批拆成 `0035`（2 条）/ `0036`（3 条）并跨归零点分两次 apply 的根本原因。
- 2026-09-24 终值：`whl-club` 写 **91,604 行 = 91.6%**（`0034` 的 54,919 + `0035` 的 36,602 + 零头），当日写额度贴顶用满。
- 2026-09-25（归零后）：`whl-club` 写 **54,909 行 = 54.9%**（`0036` 的 3 条）。
- 顺带修了脚本里**过期的库名映射**（实际 `whl` = `ec3cc695-70bc-47ab-a454-5ca62ec22dd6`、`whl-auth` = `8f48bd5e-5d1b-4d62-ba4f-bf9b0cdb09eb`、第四个库 `b76d1129-77ae-4844-931c-1c7b00a9b048`；`whl-club` 一直是对的），并支持 `node scratch/quota-check.mjs 2026-09-24` 查指定 UTC 日期。

**收益实测**（`scripts/d1-read-audit/measurements-after.json`，改前 → 改后）

| 形状 | 索引来源 | 改前 | 改后 |
| --- | --- | --- | --- |
| `sort=position` | `0035` | 37,635 | **22** |
| `sort=growable` | `0035` | 37,635 | **22** |
| `sort=badges` | `0036` | 37,635 | **22** |
| `sort=base_ca` | `0036` | 37,635 | **54** |
| `sort=foot` | `0036` | 37,635 | **22** |

**副产品**：`0036` 生效**前**实测 `sort=badges` / `sort=base_ca` / `sort=foot` 三条恰好各 **37,635 行**，把审计报告 §5.1 那句「剩余键各 37,635 行/次」的类级推断变成了直接实测。一次测量假象：`sort=foot` 首跑报 `0 行 [0 + undefined]`（statements 0 条、0ms），重跑即得 22 行 —— 是 wrangler 偶发抓取失败，不是索引问题。

**生产核对**：`sqlite_master` 里 `idx_players_sort_%` **11 → 16 条**（两次只读 `wrangler d1 execute --remote`，`rows_written: 0`）；`players` 表索引总数 **16 → 21**。

**操作技巧（下次复用）**：`wrangler d1 migrations apply` 会把目录里**所有 pending 一次做完**，所以为了在归零前只推 `0035`，先把 `0036` 临时 `mv` 到 `scratch/0036-pending.sql`，`npx wrangler d1 migrations list whl-club --remote` 确认只剩 `0035`，apply 后再 `mv` 回 `src/db/migrations/`。首次 apply 撞了一次 `AuthenticationError`（wrangler 日志 `"errorType":"AuthenticationError"`、`durationMs:2699`），**直接重试同一条命令即成功**（令牌抖动，不是权限问题）。

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **50 文件 / 724 例全绿**（`0034` 批之后是 709，本批 +15 = 5 条形状 × 3）。

**文档同步**：`scripts/d1-read-audit/README.md` 新增 §3.3（三批收益合并表 + 探针口径 + 写入记账）、§5.1 分类行改为「已建 7 / 剩余 6」、§5.3 第 3 条补 2026-09-25 进展、§5.5 补 5 行「已收」、§六 补 `--only=` 只接一个形状与 5 条新探针的说明；`scripts/players-import/README.md` 写入成本口径 **16 → 21 索引**（upsert 重跑 11 → **14 行/人 = 256,214**，全量重导须跨 **5** 个 UTC 日）；`README.md` 迁移 34 → **36**；`ROADMAP.md` 维护节加 batch 4/5 段；`AGENTS.md` 生产迁移段 `0034` → `0036` 与当前状态 bullet。

**下一批待令**：清单上还剩 **6** 个可建索引的键（`growth_gap` / `growth_tier` / `future_star` / `china_plan` / `agent_tier` / `fc_id`），仍按「每天最多 3 条」分批；`view=initial` 口径另欠 `pa` / `growth_gap` 两个变体。

## [维护] · 上线口径订正：push 到 main 会触发 CF 自动部署（2026-09-24，文档：无运行时行为变化）

2026-09-24 实测确认：本仓与 `tour` / `whl-auth` / `whl-guess` 四仓都接了 Cloudflare 的 Git 集成（Workers Builds）—— `git push origin main` 之后约 30–60 秒，CF 在服务端自动构建并部署对应 Worker，不需要任何本地命令。证据：同日三仓推送（用户只下令 push、未下令 deploy）后 `whl-club` 部署 `04:33:27.890Z`（Version `a65570f8-…`）、`whl-auth` `04:33:45.766Z`（`458e0e94-…`）、`whl-guess` `04:34:15.675Z`（`c6d741aa-…`），顺序与 push 顺序一致、间隔 30–60 秒；未推送的 `tour` 无新部署。同轮更早还有一次交叉验证：手动 `npm run deploy` 出的 `a573ade7`（03:37:53Z）两分钟后被 push 触发的 `c5e796f6`（03:40:13Z）顶掉。

排除项与取证边界：四仓都没有 `.github/` ⇒ 不是 GitHub Actions，是 CF 服务端的集成；`wrangler deployments list` 的 Source 字段**不区分**来源（自动部署同样报 `wrangler` / `Unknown (deployment)`，因为构建容器里跑的就是 `wrangler deploy`）；构建日志拿不到 —— OAuth token 缺 `workers_builds` 读权限（`/accounts/<id>/builds/*` 一律 `Authentication error`，wrangler 无 `builds` 子命令）⇒ 构建命令是否含 typecheck 未能验证，只能看 CF 面板 Settings → Builds。

⇒ `AGENTS.md` 危险清单的 `git push` 条与「部署即 push」段已同步订正：**push 即上线，「只推不部署」不存在；已 push 后不必再手动 `npm run deploy`（冗余且会被自动部署顶掉）；push 前必须本地 `npm run typecheck` + `npm test` 全绿。**

## [维护] · players 全量覆盖的写入成本口径订正（2026-09-24，文档：无运行时行为变化）

用户 m02214 问「如果随后更新或者完全覆盖了 players 表，索引需要重写吗」⇒ 结论：走 `INSERT` / `UPDATE` / `DELETE`（含本仓导入用的 `INSERT ... ON CONFLICT(fc_id) DO UPDATE` upsert）时 SQLite 自动维护全部索引，无需 `REINDEX`；`UPDATE` 只为「SET 列表里出现过的列」所属的索引写新条目。唯一例外是 `DROP TABLE players` 式重建 —— 索引一起消失（本条目写作时是 16 条，`0035`/`0036` 之后是 **21 条**），而 `d1_migrations` 仍记着 `0033`–`0036` 已 apply ⇒ `wrangler d1 migrations apply` 不会重跑，必须手工重建。

`scripts/players-import/README.md` 的「写入成本」段此前仍写首灌当时的「4 个索引 / 每人 5 次写入 / 91.5k」，现已拆为「（首灌当时）」+ 新增「重跑成本已随索引增多放大（2026-09-24 实测订正）」小节：16 索引清单（14 条显式 + `uid` / `fc_id` 两个 UNIQUE 自动索引）、四种覆盖方式的成本表（新插入 17 行/人 = 311,117；本文件的 upsert 重跑 11 行/人 = **201,311**；`DELETE FROM players` 全清 17 行/人 = 311,117；全清 + 重灌 34 行/人 = 622,234），以及两条纪律 —— 不要用 `DELETE FROM players;` 做覆盖（中断即半空表、无回滚点，该语句仅作首灌回滚记录保留；upsert 幂等可中断续跑）、不要用 `DROP TABLE` 重建。⇒ 全量重导已不可能一天做完（201k 起，须按 19 个分片跨 3–4 个 UTC 日；首灌当时 91.5k 一天塞得下，该数字已不可复现）。（2026-09-25 起该口径已随 `0035`/`0036` 再订正为 **21 索引**：新插入 22 行/人 = 402,622、upsert 重跑 **14 行/人 = 256,214**、全清 22 行/人、全清+重灌 44 行/人 = 805,244，须跨 5 个 UTC 日；详见本文件同批「排序索引 batch 4/5」条目。）

## [维护] · 遗留项第 5 节最小步 —— 下一批排序索引写成迁移 0034（2026-09-24，迁移 `0034` 已 apply 到生产并部署上线（Version `a573ade7-…`）：无运行时行为变化）

遗留项普查第 5 节（D1 读量治理后续批次）的结论是「主体已在v3.2.0 治完，剩下的是**写配额换读量**的排期清单，属产品判断而非配额判断」（2026-09-22 搁置它的当日理由——写配额被 `0029`+`0030` 吃掉 73.2%——现已不成立：2026-09-24 实测当日写 10 行 / 读 2,969 行）。本轮只走最小步：先做候选表达式的真引擎体检，再写下一批索引与同源测试锁，代码部分**不动生产**（迁移的 apply 于同日单独授权执行，见文末）。

**新增**
- `scripts/check-sort-index-feasibility.mjs`：候选排序表达式体检器（仿 `scripts/check-name-fold-depth.mjs`，`wrangler d1 execute --local --persist-to .wrangler/rehearsal` 逐条 `CREATE INDEX` 后立刻 `DROP`，零配额）。本轮 15 个候选（13 个可建索引键 + 初始视图 `ca` + `attr` 抽样）**15/15 通过** ⇒ D1 表达式树深度上限 100 对这批形态不构成限制（`ps` 的 15 项链可通过），且 **`json_extract` 可以出现在索引表达式里**（索引侧表达式禁止 `.` 限定符，故写非限定列名）。
- `src/db/migrations/0034_players_sort_indexes_batch3.sql`（**2026-09-24 已 apply 到生产**）三条排序索引：
  - `idx_players_sort_uid ON players(COALESCE(CAST(SUBSTR(uid, 3) AS INTEGER), 0), id)`
  - `idx_players_sort_ps ON players(((json_extract(game_attrs, '$.PSID1') IS NOT NULL) + … + (… '$.PSID15' …)), id)`（15 项，逐字与 `src/worker/routes/players.ts` 的 `PS_COUNT_EXPR` 同源，由 `PS_SLOT_COUNT` 生成）
  - `idx_players_sort_initial_ca ON players(COALESCE(COALESCE(base_ca, ca), 0), id)` —— 必须是这层**完整嵌套**：`buildSortExprs` 在初始视图的 `caExpr = COALESCE(players.base_ca, players.ca)` 外还套了一层 `COALESCE(…, 0)`，只建内层匹配不上（这正是 `view=initial&sort=ca` 此前静默失配成 37,635 行/次的原因）。
- `tests/players-sort-indexes.test.ts`：`INDEXED_SORTS` 由 8 条扩到 **11 条**（改三元组 `[sort, index, extra?]`，支持 `&view=initial` 这类附加查询串），每条仍是「真实路由 SQL 的 `EXPLAIN QUERY PLAN` 必须命中指定索引」+ cursor / `order=asc` 三形状；新增 2 条同源锁（`ps` 表达式必须由 `PS_SLOT_COUNT` 生成、initial-ca 必须含完整嵌套 `COALESCE`）。`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0034`。

**验证**
- 定点：`npx vitest run tests/players-sort-indexes.test.ts` **37 例全绿**（原 26 + 新 11）。
- 变异验证（`scratch/mutate-0034.mjs`，已备份还原）：把 initial-ca 索引改成只建内层、`ps` 索引删掉 `PSID15` 一项 ⇒ **8 例变红**（两条形状各 3 条 EXPLAIN + 各 1 条同源锁）⇒ 新锁不是空转。
- `npm run typecheck`（三份 tsconfig）全清；`npx vitest run` **50 文件 / 709 例全绿**（原 698 + 11）。
- 文档同步：`README.md` 迁移 33 → **34**（当时写明 `0034` 已写好未 apply、一次 ≈5.5 万行写须单独占配额日；同日 apply 后已改为「已 apply」并写入实测数字）、测试 698 → **709**；`scripts/d1-read-audit/README.md` §5.3 第 3/4 条与 §5.5 三行订正 —— 顺带查明 §5.5 的 `sort=name` 候选**早已由迁移 `0033`（2026-09-23 apply）完成**，该行此前已过期。

**生产 apply（2026-09-24 已执行，用户授权「0034应用」）**：`0034` 三条索引合计实测 **54,919 行 `rows_written`**（占当日写配额 54.9%，在自留预算 ≤6 万内）；生产侧核对 —— `sqlite_master` 里 `idx_players_sort_%` 共 11 条，三条新索引在 `EXPLAIN QUERY PLAN` 下均为 `SCAN players USING COVERING INDEX`；收益实测（读数落 `scripts/d1-read-audit/measurements-after.json`）：`view=initial&sort=ca` 37,635 → **54**、`sort=uid` → **24**、`sort=ps` → **22** 行/次。worker 已于同日部署上线（Version `a573ade7-b32f-4c85-bbaf-56a07e612281`，2026-09-24T03:37:52Z，Source `Unknown (deployment)`；wrangler 报 `No updated asset files to upload` ⇒ 无运行时代码与产物变化，线上首页资产仍 `index-CpdvAUf3.js` + `index-CgbAjyeh.css`）。清单上还剩 11 个可建索引的键（`base_ca` / `badges` / `growth_gap` / `position` / `growable` / `foot` / `growth_tier` / `future_star` / `china_plan` / `agent_tier` / `fc_id` 一类），按每天最多 3 条继续分批。



## [维护] · 遗留项普查收口（第 0/4/6 节）— 文档订正 + 死代码清理（2026-09-23，**未部署**：无运行时行为变化）

三路深度普查（文档层 / 代码层 / 记忆层）把本仓遗留项按 0–8 节登记；本轮执行其中第 0（过期表述）、4（代码层清理）、6（文档数字漂移）三节。

**文档订正（第 0/6 节）**
- v6.1.0 的「未提交未部署」全部订正为已提交、已推送、已部署：`AGENTS.md`（v6.1.0 bullet 首句、⑩ 部署前置、`npm test` 数字、生产版本链补生效版 `bd467125`）、`ROADMAP.md`（状态行与待办①②）、`CHANGELOG.md`（v6.1.0 节标题与状态段）。
- 数字漂移：`README.md` 迁移 30 → **33**（`0001`…`0033`，含 `0032`/`0033` 于 2026-09-23T09:29Z 同轮 apply）、测试 39 文件 / 539 例 → **50 / 698**、e2e 9 → **11 场景**、生产状态 `627508e5` / 迁移 `0030` → **`bd467125` / `0033`**；密钥补 `TEAM_SYNC_SECRET`、变量补 `TOUR_API_BASE`。
- 「v3.0.0 未部署」残留风险订正：`ROADMAP.md` v3.0.0 台账行与 `scripts/prod-20260920-s9-contracts/README.md` §11.8 首条都改为「2026-09-21 已随 Version `b83ec876` 上线，面板建合同不再落 DDL 默认刻度」。

**代码清理（第 4 节）**
- 删 10 个零引用导出（逐个 `grep -rn "\b名字\b"` 复核，只命中定义行）：`web/src/lib/api.ts` 的 `MeResponse` / `apiPatch` / `ClubDto` / `TransferDetail` / `ReviewDecisionResult`、`web/src/lib/ref.ts` 的 `PlayStyleRow` / `RoleRow`、`src/worker/tourClient.ts` 的 `pushError`（其「出站失败只回报文案不抛」的口径注释移到 `PushResult` 上）、`src/worker/market-settle.ts` 的 `transferTypeFor`、`src/worker/stadium-ops.ts` 的 `FacilityKey`。
- 订正 3 处过期注释：`src/worker/home.ts`（设施扩建/升级已随v2.5.0 落地，见 `src/worker/stadium-ops.ts`）、`src/worker/results.ts`（站内信派发已实现）、`wrangler.jsonc`（cron 逻辑已在 `src/worker/index.ts` 的 `scheduled()` 实现）。`src/db/migrations/0018_home.sql` 的同类过期注释**刻意不动**——该迁移已 apply 到生产，按仓库规矩不得再改。

**验证**：`npm run typecheck`（三份 tsconfig）全清、`npx vitest run` **50 文件 / 698 例全绿**。

## [已上线] · v6.1.0 — 球队与俱乐部双向建档同步（tour + club 两仓）（2026-09-23，本仓 Version `bd467125-2ccb-4516-86b4-f963bdc5fda6` / 赛事仓 Version `02590a8e-f314-4721-a823-147817a5ce17`）

本轮两仓同时改（本仓 `WHL-club-operations-platform` + 赛事仓 `WHL-tournament-management-system`），**两仓均已提交、推送并部署上线**（本仓 4 提交 `be28524` / `ce49e77` / `8379508` / `f250c29`，`origin/main` = `f250c29`；赛事仓 4 提交 `ad80d75` / `588f384` / `1ab678a` / `5f07002`，该仓 `origin/main` = `5f07002`）。部署前两侧都已 `wrangler secret put TEAM_SYNC_SECRET`（同值）；生产实测无签名 `POST /api/internal/team-upsert` 在两个 host 上都回 403 `{"error":"bad_signature","message":"签名校验失败"}` ⇒ 路由在线、密钥在位且 fail-closed 生效（密钥缺失会回 503，故 403 已排除「未配」）。**未验证**：两侧密钥是否同值（无只读 HMAC 端点，唯一验法是一次零写 upsert 探测 = 生产写动作）。

**背景**：球队（`team.id`）与俱乐部（`clubs.id`）本来就是同一个号（游戏内球队编号，两库早前一起 rekey 过），但两边只能各建各的 —— 赛事系统建队不登记俱乐部；本仓建俱乐部又硬性要求「赛事系统里先有这支队」（否则 404「赛事系统里没有这支球队，请先在赛事系统建队」）。谁先建都得手工去另一侧补一次。

**边界调整（v5.0.0 的例外）**：v5.0.0 定下「名册只拉不推」（赛事仓 `worker/lib/clubRoster.ts` 顶部原文），本轮只对**「球队建档」**这一个写动作破例放开对称推送，**名册仍一行都不推**。理由：建档是一次性事件、两侧都可能先发起、且赛事仓读不到本仓库（反向拉不出「本仓有而赛事无」）。赛事仓那段注释已原文保留并补上这次调整的声明。

**新增**
- `src/lib/hmac.ts`：`hmacHex` + `verifyTeamSync`（签名串 `` `POST|${path}|${ts}|${rawBody}` ``、头 `X-Timestamp`/`X-Sign`、HMAC-SHA256 小写 hex、时间窗 ±300s，与认证中心 `machine.ts` 同一口径）。本仓 `src/worker/notify.ts` 原先私有的 `hmacHex` 抽到这里共用。
- `src/worker/tourClient.ts`：`pushTeamToTour`（**永不抛错**，失败回中文口径：未配基址 / 未配密钥 / 对方不可达 / 透传对方 message）。
- `src/worker/routes/internal.ts`：`POST /api/internal/team-upsert`（幂等建档：同 id 已有则 200 `{created:false, nameDiffers}` **不覆写**）。未配密钥 → **503**（写端点 fail-closed，不像 `assertCronKey` 那样「没配就放行」）。
- `src/worker/routes/admin/teamSync.ts`：`GET /api/admin/team-sync` 三段差异（只有赛事有 / 只有本仓有 / 两边名字不同）+ `POST /api/admin/team-sync/apply`（**每次重算 diff 再动手**，防照几分钟前的清单盲写；不匹配当前差异 → 409）。
- 前端 `web/src/pages/admin/ClubsPage.tsx` 新增「球队同步对账」卡片（`web/src/lib/adminQueries.ts` 加 `TEAM_SYNC_KEY` / `fetchTeamSync`）。
- `tests/team-sync.test.ts` 26 例：入站端点（正签建档 + 认证登记 + 审计 actor 留空 / 幂等 nameDiffers / 签名矩阵 错签·缺签·过期·非数字全 403 且不落库 / 换密钥 403 / 未配密钥 503 / 入参校验 400 / 名字被占 409）、公开缓存失效登记、`computeTeamSyncDiff` 纯函数、对账端点、出站 `pushTeamToTour`、**跨仓签名金标准**、**真实风险**各一组。

**变更**
- `src/worker/routes/admin/clubs.ts`：原 `POST /clubs` 的核心抽成导出的 `createClubFromTourTeam()`（名字 ≤40、`leagueTier` 只收 premier/second、id 撞号 409、名字重复 409、审计 `club_create`、`authRegisterTeam` 失败不回滚只置 `authLinked=false`）；`POST /clubs` 改为「赛事系统已有该队 → 原逻辑；没有 → **先推建队，成功再本地建档**；推送失败 → 502 且不建档」。原来的「赛事系统里没有这支球队」404 被自动建队取代。
- `src/worker/env.ts` 加 `TEAM_SYNC_SECRET`；`src/worker/index.ts` 挂 `/api/internal`。
- **`src/lib/cache-policy.ts` 的 `WRITE_SCOPE_PREFIXES` 加 `/api/internal`** —— 否则「建了俱乐部但公开目录最长陈旧 24h」。

**赛事仓侧（tour，权威文档见其 `PRD.md` / `TECH_DESIGN.md` §4.5）**
- 新增 `worker/lib/clubSync.ts`（出站 + 验签）、`worker/lib/teamBulk.ts`（「游戏球队 ID 队名」解析，`NAME_MAX = 40` / `BULK_MAX = 64`）、`worker/routes/internal.ts`（入站端点）。
- `worker/routes/admin/teams.ts`：建队/批量建队改「游戏球队 ID + 队名」并推送（**队名上限 32 → 40** 对齐本仓 `clubs.name`），新增 `POST /:id/sync-club` 重试入口。
- `worker/routes/admin/tournaments.ts`：批量报名同样改「ID + 队名」，**改为按 id 认队**（原先按名字），名字不一致进 `nameMismatch` 报告（登记以库里为准）。
- 前端 `src/pages/AdminTeams.tsx`（游戏球队 ID 输入 + EA 目录软校验：命中显示官方队名、未命中黄字警告但允许建队；同步按钮 + 失败红字）、`src/pages/TournamentManage.tsx`。
- 新增 `shared/fc26Teams.json`（由本仓 `web/assets/ref/team.json` 复制，696 条）+ `shared/fc26Teams.ts`（`fc26TeamName` / `isKnownFc26Team`）。

**验收**
- 本仓 `npm run typecheck` 全清（三个 tsconfig）；`npx vitest run` **50 文件 / 698 例全通过**。
- 赛事仓 `npm run typecheck` 全清；`npx vitest run` **16 文件 204 例通过 + 1 文件 7 例跳过**。
- **跨仓签名金标准**（两仓各一份、逐字同值）：`GOLDEN_SECRET = "increment-37-golden-secret"` / `GOLDEN_TS = 1767225600` / `GOLDEN_RAW = '{"id":700,"name":"Arsenal","operator":1}'` / `GOLDEN_HEX = "1437a305e893ae6c65364c50cc953a178e1edfa38f2f2040ae961966db065d30"`。hex 是 `node:crypto` 独立算出的**死值**（不是用被测代码算的），两侧任一方偷改算法/路径/签名串立刻红；两边还各有「入站接受对面那份金标准签名」的用例证明常量互通。

**已知后果 / 真实风险（已测出并留痕）**
- **推送不可撤销**：从本仓发起时先推、后本地建档；若推送成功而本地名字撞车 409，赛事系统那支队撤不回来，只能靠对账页的「只有赛事有」列出来处理。`tests/team-sync.test.ts` 的「真实风险」describe 钉住了这条可见性。
- 认证中心 `club_id` 已被别的球队占用（`club_taken` 400）**不阻断建档**：`authLinked=false`、俱乐部行照落，管理端可点「重新登记」补。
- 赛事仓 `UNIQUE(org_id, name)`：入站建档前先单查名字占用并 409 点名「队名「X」已被球队 #N 占用」（原 catch 回的是「球队 ID #N 已被占用」，会把本仓操作员带偏）。
- **明确不做**：改名不联动（只在对账页显示 `nameDiffers`）；删队不联动（本仓没有删除端点）；球员名册仍严格只拉；报名、赛果、账目一律不动。

## [已上线] · tour 侧增量 — 赛事仓错误契约收口 + 账号投影对账（tour 单仓，不占本仓版本号）（2026-09-23，Version 9c51052f-a50c-44c8-8078-b318fd7f226b）

本轮**本仓没有任何代码改动**，交付全部落在赛事仓 `WHL-tournament-management-system`（其权威文档是 `PRD.md` / `TECH_DESIGN.md`，后者已随本轮补 §4.2 与 §8）；本节进本仓 CHANGELOG 是因为当时沿用「全项目共享增量号」旧规则（该规则已于 2026-09-25 废止，改用各仓语义化版本 ⇒ 本仓不为这一轮分配版本号，正文一律称它「tour 侧增量」）。赛事仓 2 个提交（`7f4d69a` 代码 + `952f470` 文档）**已 push**（`dee2292..952f470`），连同 v5.0.0 的 4 个提交一并补齐，该仓 `origin/main` = `952f470`。部署：`9c51052f-…`，2026-09-23T13:02:42Z，Source `wrangler`，`Total Upload: 582.96 KiB / gzip: 133.33 KiB`。

**编号**：赛事仓那轮代码注释原写「34」，而 34（apex 域名收口）与 35（显示名与球衣号落库）当日已被本仓占用 ⇒ 当时在共享序列下回填为「36」（改 6 处标签：`worker/index.ts`、`worker/routes/oidc.ts`、`tests/oidc.test.ts`）。

**修复**
- **账号投影（`FOREIGN KEY constraint failed` 致 500 的根因）**：账号真源收口认证中心后赛事库 `user` 表没有写入方，而 14 列外键仍指向 `user(id)`（`tactic.created_by` / `match_event.created_by` / `audit_log.actor_user_id` …）⇒ 新账号「登录一切正常，写存档或报分才 500」。新增 `worker/lib/accountMirror.ts`：`mirrorAccountStmt` 是 `INSERT INTO user (id, name, password_hash, role, locked, created_at) VALUES (?, ?, ?, 'coach', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, locked = excluded.locked, created_at = excluded.created_at`（**`role` 与 `password_hash` 绝不进 updater**，口令写哨兵值 `"!oidc-no-password"`）；`runAccountMirror` 为整点对账入口，只补行与改名、**不删行**。`worker/routes/oidc.ts` 的 callback 把账号投影与 `INSERT INTO oidc_session` 放进同一批 `c.env.DB.batch([...])`（否则症状是「登录成功但一写就撞外键」）。
- **未捕获异常一律回 JSON**：`worker/index.ts` 新增 `app.onError`，回 `c.json({ error: "internal", message: "服务异常，请稍后重试" }, 500)` 并留日志。Hono 默认输出 `text/plain` 的 `Internal Server Error`，前端 `res.json()` 解析失败、只剩一句「请求失败（500）」，报错无明细（2026-09-23 那次只能反查 D1 才定位到外键）。
- **错误文案收口**：`src/api.ts` 新增 `fallbackMessage(status)`（≥500「服务暂时不可用（N），请稍后重试」/ 404「内容不存在或已被删除」/ 401「登录已过期，请重新登录」/ 403「没有权限执行此操作」/ 其余「请求失败（N）」），并把 `TypeError` 转成「网络异常，请检查网络后重试」（WebKit 报 `Load failed`、Chromium 报 `Failed to fetch`，原样抛会把英文糊上界面）；worker 侧统一 `{ error, message }` 形状（`portal.ts`「该比赛暂无战报（仅完赛场自动成文）」「该轮暂无综述」「轮次参数不合法」、`interact.ts`「比赛 id 不合法」、`admin/announcements.ts` 三个 code + 中文 message），19 个页面与组件消费。

**新增**
- `scripts/oidc-user-mirror/20260923-backfill-user-13-17.sql`（幂等 `ON CONFLICT(id) DO NOTHING`）；**实测未执行** —— 整点对账已自行补齐 user 13–17，回填 SQL 已无操作对象，留着当恢复路径。
- `tests/oidc.test.ts` 3 例：登录回调把账号投影进本库 user 表 / 定时对账补没登录过的账号并同步改名与注册时间且不删行 / 未捕获异常 500 回 JSON 且日志留方法与路径。

**验收**
- 赛事仓 `npm run typecheck` 全清；`npx vitest run` **15 文件 / 147 例通过 + 1 文件 7 例跳过**（`tests/admin.live.test.ts` 属基线；v5.0.0 评审后基线 15/144 ⇒ +3 例）；`npm run build` 成功（`dist/assets/index-CR7ktr7d.js` 444.71 kB / gzip 144.17 kB、`index-C4fgwNax.css` 69.80 kB）；`wrangler d1 migrations list whl --remote` ⇒ `✅ No migrations to apply!`。
- 部署后回读：`/api/health` 200、`/api/public/announcement` 200、`/api/public/weekly` 200（`weekStart 2026-09-21` / `played 7` / `goals 20`）；`/api/public/matches/999999/report` ⇒ 404 `{"error":"not_found","message":"该比赛暂无战报（仅完赛场自动成文）"}`、`/api/public/tournaments/999/round/999/1` ⇒ 404 `{"error":"not_found","message":"该轮暂无综述"}` ⇒ 新错误契约在线；线上 `index-CR7ktr7d.js` 内含三条新前端文案。
- 名册同步已实际开跑：赛事库 `whl.player` 实测 `{"total":570,"with_number":570,"distinct_num":71}`，`id 20801 = Cristiano Ronaldo / team 45 / #7`（旧 id 241/243 已因v5.0.0 rekey 不存在）⇒ 赛事库是从本仓拉回显示名与 s901 号码的下游镜像。

**已知后果**
- ~~赛事仓 6 个提交未 push~~ —— **已订正**：2026-09-23 已 push（`dee2292..952f470`）。口径更新：用户同日明确「部署推送都得一块啊」，此后「部署」即同时授权该仓 push。
- 赛事仓当日 **08:37:07Z（`71de6d01-…`）与 08:47:45Z（`49563d64-…`）已部署过两次** ⇒ v5.0.0 + 本轮代码在本地提交之前就已上线（这也是整点 cron 覆盖赛事库号码成立的前提）。
- 门户路由挂在 `/api/public`（`worker/index.ts:32` 的 `app.route("/api/public", portalRoutes)`），**不是 `/api/portal`**；`wrangler deployments list` 列的 id 是 deployment id 而非 version id（版本要读 JSON 的 `versions[].version_id`）。

## [已上线] · v6.0.0 — 显示名与球衣号落库：号码真源迁到 FC26 存档表（s901）+ D1 写通道整改（2026-09-23，Version 835031b5-1ddb-428e-9805-01ce3cc9a3c5）

本轮**没有任何 `src/` 或 `web/src/` 代码改动**（表结构与读端点早在v4.0.0/v5.0.1 上线），改动集中在 `scripts/player-names/` 两个脚本与文档；生产数据落库已执行并生效（不经 HTTP 写路径，早于部署即对用户可见）。`scripts/` 与文档已推送（`3f33aab..d4dcf34`）并随 Version `835031b5-…`（2026-09-23T12:12:42Z）部署上线，线上下发的 Worker 与资产同上一版（wrangler 报 `No updated asset files to upload`）。

**修复**
- **生产 `players` 五列落库**：`scripts/player-names/load.mjs --remote --yes-prod --numbers --purge` 执行 46 条语句（`display_name.sql` 44 条 / `number.sql` 2 条）全部成功、无重试。落库前 `display_name`/`first_name`/`number` 计数全 0，落库后 `total 18301 / display_name 17470 / first_name 17329 / last_name 17099 / common_name 2549 / number 570`。
- **缓存失效（`load.mjs` 新增 `--purge`）**：读 `cache:epoch:public` 现值 +1 写回（实测 **1 → 2**）。这一步不是可选项 —— 脚本直写 D1 不走 HTTP，`src/worker/index.ts:25-42` 的 purge 中间件（判据「非 GET/HEAD + 响应 2xx + 路径命中 `WRITE_SCOPE_PREFIXES`」）不触发，而分级 TTL 是 players 1h / roster 24h / clubs 24h，不 bump 代际键则公开读最长 24h 才看到新值；代际键带版本号（`src/lib/guard.ts:105`），bump 一次 L1 + L2 同时作废。
- **号码真源从赛事库改到 FC26 存档表（s901）**：`derive.mjs` 不再读 `whl.player`。原因见「已知后果」——赛事仓的名册同步按「姓名、号码一律以 club 为准」写库，`/api/squads` 于 2026-09-23T09:29:30Z 首次上线后，下一个整点 cron 用我方当时的**空号码**覆盖了赛事库 `player` 的 570 个号码（`name` 同时被换成我方缩写名，570/570 逐字相同即证据；D1 时间点回读不可用，只能靠外部副本恢复）。
- **`derive.mjs --refresh` 在本机崩溃**：`Error: spawnSync npx.cmd EINVAL`（errno -4071，Node v24.12.0），与v4.0.0 评审在 `load.mjs` 修掉的是同一类 bug（当时只修了 `load.mjs`）⇒ 改用 `execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', …])` 跑 `node_modules/wrangler/bin/wrangler.js`。

**新增**
- 号码派生源 `E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901/splitted`：20 个 xlsx（一队一份，文件名 `<FC26 club_id> - <队名>.xlsx`，表体只有两列无表头：球衣号 + 全名），实测 570 人 / 20 队 / 号码空行 0 / 队内重号 0，与赛事仓 Sep16 独立副本 `players-dump.json` 姓名号码 **570/570 一致**。`readS901()` 用 `xlsx@^0.18.5` 读表；文件名不合规或号码为空一律 `exit 2`。
- 认人四级阶梯（每级只认唯一命中，`claimed` Set 防重复占用）：逐字相同 → 归一化相同 → 同队同姓唯一 → 队内唯一余量。实测 **565 / 3 / 2 / 0**，逐队人数对账 `clubCountMismatch = 0`。
- `load.mjs` 的每条语句失败自动重试 3 次（`sleep(2000)`）+ `cleanForCommand()` 注释行清洗 + `MAX_SQL_CHARS = 30_000` 上限保护。

**变更**
- **D1 写通道由 `--file` 改为 `--command`**：`--file` 走 D1 异步 import 端点，对**合法** SQL 间歇性报假错（已见 `{"D1_RESET_DO":true}`、《SQL code did not contain a statement. [code: 7500]》、`syntax error` 且 offset 比文件本身还长、`X [ERROR] {` 截断），同一条语句隔 30 秒重跑就 `success:true / rows_written:400`；`WRANGLER_LOG_SANITIZE=false` 抓到的请求体完整无误，换随机文件名与 md5 去重无关。`--command` 走同步 /query 端点。
- `derive.mjs` 的 `BATCH` 由 1000 降到 **400**（每批约 22KB，要塞进 Windows 命令行）。
- `derive.mjs` 的 `REMOTE` 删掉 `tour-players`（db `whl`）与 `team-map`（db `whl-auth`），只剩 `players`（db `whl-club`）；审计 CSV 表头 `tour_name,tour_number` → `s901_name,s901_number`。
- `scripts/player-names/README.md` 整篇重写：数据源表加 s901（标注**球衣号真源**）、记「赛事系统 `whl.player` 不再是号码来源」、球衣号四级阶梯、生产落库计数与回读结果、`--purge` 的存在理由、踩坑清单由两条扩到四条。

**验收**
- 预检 `--dry-run --numbers --purge` ⇒ `44 条 / 最大 22645 B` + `2 条 / 最大 7062 B` = **46 条 / 977642 B**；只给 `--remote` ⇒ `拒绝执行：写生产必须同时给 --remote --yes-prod。`；`derive.mjs` 退出码 0。
- 落库 ⇒ `完成 46/46` + `公开缓存版本号 1 → 2`，exit 0；KV 复核 = `2`。
- 点查 fc 20801 ⇒ `Cristiano Ronaldo` / `C. Ronaldo` / `dos Santos Aveiro` / `Cristiano Ronaldo` / `7`；五例同人异名落库正确（200104 `Heung Min Son`#7、226456 `Pablo Fornals`#12、264432 `Abdessamad Ezzalzouli`#15、264846 `Mosquera`#4、276048 `Matias Fernandez-Pardo`#27）。
- 独立复算（按行解析生成 SQL 的 VALUES、处理 `''` 转义）：17,470 数据行、fn 17,329 / ln 17,099 / cn 2,548 / dn 17,470 非 NULL、重复 fc 0；号码侧 570/570 s901 行在 `number.sql` 中都有「同 club_id 且持有该号码」的人，异常 0。
- 公开回读：`GET /api/squads` ⇒ 200 / 30,983 B，20 队 570 人、`number !== null` **570**；`GET /api/players?limit=2` ⇒ 200，含 `name:'Erling Haaland'` + `officialName:'E. Haaland'`（列表小字有真值）。
- 回归：`npm run typecheck` 三份全清；`npx vitest run` **49 文件 / 667 例全绿**，与v5.0.1 基线逐项一致（本轮无 `src`/`web` 改动）。

**已知后果**
- **赛事库自此只是下游镜像**：赛事仓 cron（**已于tour 侧增量 开跑**，实测赛事库 `whl.player` 570/570 已具号码）会把 `/api/squads` 的显示名与号码写回 `whl.player`（方向正确，但本仓是唯一真源，赛事库任何本地改动都会被下一次整点覆写）。
- 831 人回落官方缩写名（FC26 后期补丁新增 `nameid > 41,189`，本机字典没有），本轮未动。
- 两处口径差无影响：`out/display-names.csv` 的 first_name/last_name 非空数（17,897 / 17,198）比落库多（这两列只有 CSV 审计快照在写，全仓无代码读它们，`grep` 只命中 `src/core/player-name.ts:5` 注释）；`common_name` 落库 2,549 比 SQL 多 1 行（那行库里本来就有值，`COALESCE` 按设计不覆盖）。
- `data/tour-players.json` 缓存已被 `--refresh` 覆盖成空号码版本，不再能当交叉校验源。

## [已上线] · v5.0.1 — apex 域名收口（排名代理 530 根因）+ 边缘 504 归因（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

3 个提交（`9506d00` / `ea6d717` / `5ae73e8`）已推送（`2ad239b..5ae73e8`）并部署，**同轮把v4.0.0/v5.0.0 一起带上线**；**生产迁移 0032/0033 同轮 apply**（用户裁决「先 apply 0032+0033 再整条部署」）。

**修复**
- `whleague.win`（主域 apex）不部署任何服务、DNS 也无 A 记录（`nslookup -type=A` 对 8.8.8.8 / 223.5.5.5 / 1.1.1.1 均无答案，`curl` 返回 000），赛事系统正确入口是 `tour.whleague.win`。三处生效引用改 tour 子域：`wrangler.jsonc` 的 `TOUR_API_BASE`、`web/src/lib/api.ts:70` 的 `TOUR_SITE_URL`（6 处外链：`TopBar.tsx:92` / `RequireUser.tsx:27` / `admin/AdminLayout.tsx:45` / `Home.tsx:24`、`:42`、`:81`）、`src/worker/routes/auth.ts:35` 的 `TOUR_HOME`（用在 `:52`/`:83`/`:274`，生产 `AUTH_MODE=oidc` 暂不可达）。
- **生产 5xx 根因**：`TOUR_API_BASE` 配 apex 时，`src/worker/routes/clubs.ts:574-575` 每次都请求 `https://whleague.win/api/public/tournaments/<id>/standings` 并必然 **530**（CF 分析 24h 内 `/2/standings` 17 次、`/1/standings` 15 次）。因 `clubs.ts:604` 只在变量**缺失**时优雅降级（返回「排名暂不可用」），配了死地址反而每次真发请求、每次都失败 ⇒ 球队详情页排名区块永久不可用而其余区块正常，长期不显形。
- 同步 `tests/oidc.test.ts:231`/`:240` 断言与 `src/worker/env.ts:27-29` 注释。

**新增**
- `tests/domains.test.ts`（6 例）域名回归锁：四例锁三个常量（非 apex 且是 `whleague.win` 子域）、一例全仓扫描（`src` + `web/src` + `tests` + `wrangler.jsonc` + `web/index.html`，零排除项）、一例锁 `src/lib/oidc.ts` 不出现真正的 `Domain=` 赋值且 `OIDC_*COOKIE` 都以 `__Host-` 开头。判据 `EFFECTIVE_APEX = /https:\/\/whleague\.win(?![a-z0-9.-])/` 不误伤子域与注释里的裸 apex；本文件自己用 `APEX_URL` 拼接、无连续 apex 字面量，故全仓扫描无需排除自身。

**不改（含理由）**
- `src/lib/oidc.ts:6` 注释里的 `Domain=whleague.win`：cookie 域属性、跨子域共享会话的前提，apex 在此正确（两个 cookie 都是 `__Host-` 前缀，本身不许设 Domain）。
- 赛事仓 `WHL-tournament-management-system/worker/routes/oidc.ts:36` 注释仍写「线上 whleague.win」（实际 tour 子域）：超本仓范围，只报不改。

**边缘 504 归因（结论：不改代码）**：CF 分析 24h 的 `cache.whl-club.internal` 79 次与 `club.whleague.win` 30 次**都不是用户请求**，而是边缘 Cache API 自身的操作记录 —— 前者 host 由 `src/lib/guard.ts:158` 的 `L2_ORIGIN` 合成（无 route、无 DNS，路径即 `l2Key` 输出格式），后者只是键改用真实 URL（`src/worker/routes/media.ts:43`/`:56` 用 `c.req.url`）。这解释了 504 名单按 host 精确二分（club 侧清一色 `/api/media/*`，零 `/api/clubs*` 与 `/api/players*`）。已排除媒体文件缺失（两个 504 样本 URL 在两个 host 上都 200）。**判定：不需要动 `src/lib/cache-policy.ts` 或 `cachedJson`**（standing 300s 是全站最短 TTL、也是它在 `.internal` 占多数的原因，5 分钟是排名产品语义）。登记两处潜伏风险不改：冷回填 `await l2Put` 在响应关键路径（`guard.ts:248`，media 侧已挪进 `waitUntil`）、`l2Match`/`l2Put`/`caches.default.match`/R2 `get`/`arrayBuffer` 全无超时。

**验收**：`npm run typecheck` 三份全清；`npx vitest run` **49 文件 / 667 例全绿**（v5.0.0 基线 48/661 ⇒ +1 文件 / +6 例）；`npm run build` 成功（`index-C6eShBli.js` + `index-CgbAjyeh.css`）；dist 扫描无 apex。变异验证：三个常量各自改回 apex ⇒ 每次**恰好 2 例红**。上线核对：`tour.whleague.win/api/public/tournaments/{1,2}/standings` 均 **200**（3403B / 7131B）、`whleague.win` 仍 000、`/api/health` / `/api/clubs` / `/api/squads` / `/api/players?view=initial` / `/api/players/roster` 全 200、`/api/clubs/1` 与 `/api/clubs/1/standing` 匿名 401、线上资产与本地 dist 逐字一致、线上 JS 内域名只剩 `guess.whleague.win` 与 `tour.whleague.win`。**未验证**：`/api/clubs/:id/standing` 端到端（需登录会话，匿名 401）；CF 分析 530 归零需按 24h 窗口在面板观察。

**已知后果**：~~生产 `players.display_name` 仍全 NULL（落库脚本未跑）⇒ 显示名与球衣号对用户仍不可见（回落缩写名）~~ —— **已在v6.0.0 订正**：生产落库已执行（17,470 显示名 / 570 号码），`/api/squads` 与 `/api/players` 回读已出真值；~~赛事仓未部署 ⇒ `/api/squads` 已上线但赛事侧名册同步尚未开跑~~ —— **已在tour 侧增量 订正**（赛事仓 2026-09-23 部署，整点名册同步已开跑）。

## [已上线] · v5.0.0 — 名册真源归位：全平台一线队名册端点 + 赛事平台拉取同步 + 球员写入口下线（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

本仓 2 个提交（`aed2f67` + 评审 `d84371d`）+ 赛事仓 2 个提交（`ffcbc40` + 评审 `728f523`）。**本仓部分已于 2026-09-23 随v5.0.1 一并推送并部署**（`/api/squads` 生产实测 200 / 29670B）；**赛事仓部分已于 2026-09-23 部署（tour 侧增量；当日 08:37Z / 08:47Z 两次 + 13:02Z 一次）**，名册同步 cron 已开跑（赛事库 `whl.player` 570/570 具号码）。v4.0.0 把球衣号编辑入口搬回本平台后，赛事系统的 `player` 表成了第二份真源（两个写者互相覆盖），本增量把名册真源收到本平台并关掉赛事侧的写路径。

**新增**
- 端点 `GET /api/squads`（`src/worker/routes/squads.ts`）：一次 JOIN 出 20 队 570 人的一线队名册，返回 `{ squads: [{ clubId, clubName, players: [{ fcId, name, number }] }] }`。公开只读，`assertPublicRate` + `cachedJson`（roster scope，24h）；姓名走 `sqlDisplayName()`，`ORDER BY c.name, p.fc_id` 后 JS 线性归并，不做 N+1。
- 赛事仓 `worker/lib/clubRoster.ts`：`fetchClubSquads` / `syncRosters`（三方对账，以 fcId 当 `player.id`）/ `runRosterSync`（cron 入口，失败只记日志不抛）。
- 赛事仓端点 `POST /api/admin/sync-rosters`（`?dryRun=1` 只算不写，非 dryRun 写审计）；`wrangler.jsonc` 加 `triggers.crons = ["0 * * * *"]` 与 `vars.CLUB_API_BASE`（撤掉该行 = 同步整体跳过，即回滚开关）。

**变更**
- **赛事系统球员表转为只读镜像**：`POST /:id/players`、`POST /:id/players/bulk`、`PATCH /:id/players/:pid`、`DELETE /:id/players/:pid` 四个端点删除，`TeamDetail.tsx` 的录入 / 批量导入 / 改名 / 删除 UI 换成只读名单表；队级端点（建队 / 批量建队 / 改名 / 删队 / 队徽）保留。
- 赛事仓同步的三条防御：空快照整体跳过；形状坏抛错不写库；只对快照里出现过的队做删除（一次拉取失败不会清空别队名单）。外键拒绝的删除进 `kept` 报告保留（有比赛事件 / 伤停引用的球员不能删）。

**评审修复（`d84371d` / `728f523`）**
- 本仓 `tests/squads.test.ts` 种子行序改成两队 id 交替 + status 交替：原种子恰好是「插入序 = 期望输出序」，把 `ORDER BY c.name, p.fc_id` 删掉测试照样绿，而归并是「相邻行同 club_id 才并组」、正确性全押在那条 ORDER BY 上。改后删 ORDER BY 或删尾列都能定向变红。
- 赛事仓 `fetchClubSquads` 补 `AbortSignal.timeout(10_000)`（原来没有 signal，对方挂住时 cron 的 catch 永不执行、一行日志都没有）；快照里某队 `players: []` 直接抛错（原来只挡 `squads.length === 0`，挡不住「快照非空但某队名单空」，该队会被当 stale 整队删光）。各补一条测试并变异验证定向变红。

**验收**：本仓 typecheck 三份全清、vitest **48 文件 / 661 例全绿**（v4.0.0 基线 47/659）、build 产物 `index-Bco7kOHW.js` 与v4.0.0 逐字同 hash（只加后端路由）、e2e **11/11**；赛事仓 typecheck 全清、vitest **15 文件 / 144 例通过 + 1 文件跳过**（基线 14/121，评审后 142→144）、build 成功。读量实测走 `idx_players_status` 点查（无 `SCAN p`，约 570 行）。变异验证四处定向变红（空快照守卫、未知队过滤、ORDER BY 整条 / 尾列、拉取超时信号）。

**已知后果（评审查出，本轮不改）**：没有一线队球员的俱乐部整个从 `squads` 数组消失（赛事仓只对快照里出现过的队做删除 ⇒ 被清空的队会留陈旧镜像行，失败方向是保留而非丢数据）；赛事仓自动删除球员后 `tactic.roster_json` / `tactic_submission.assign_json` 会留悬挂 id（JSON 无外键，教练下次保存战术会撞 400，手工删除时代同样存在）；伤停的 CASCADE 实际不可达（伤停必挂 `match_event`，而 `match_event.player_id` 是 NO ACTION ⇒ 删除会失败行进 `kept`）。

## [已上线] · v4.0.0 — 球员名口径改造：FC26 派生显示名 + 球衣号归属转移 + 档案页按 fc_id 寻址（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

用户 m01803「开工」，任务 = 球员名口径改造（显示名取自 FC26 存档）+ 球衣号归属从赛事平台转回本平台 + 球员档案页 URL 改 fc_id + 两系统阵容同步 + D1 读额度优化。8 个提交（`c07c18a` / `54a98ef` / `341c7cd` / `e2d81ed` / `097cd34` / `6135bbc` / `770875b` / `0e6a524`）。**代码已于 2026-09-23 随v5.0.1 一并推送并部署，生产迁移 0032/0033 同轮 apply**（apply 后实测：新增列 5、`idx_players_sort_name` 存在、`display_name` 非空 0 / 总行 18301）；**生产数据落库（`scripts/player-names/load.mjs --remote --yes-prod`）仍未执行** ⇒ 显示名与球衣号功能对用户暂不可见（`COALESCE(display_name, name)` 回落缩写名）。跨仓部分（赛事平台转只读 + 阵容同步）另立v5.0.0。

**新增**
- 迁移 `0032_players_display_name_number.sql`：`players` 加 `first_name` / `last_name` / `common_name` / `display_name` / `number` 五列（全 TEXT）。`players.name` 语义不变（仍是 FC26db 官方缩写名，导入对齐键仍是 fc_id）。
- 迁移 `0033_players_name_sort_index.sql`：`idx_players_sort_name` 姓名排序表达式索引（排序键换成折叠的显示名后同源重建）。
- `scripts/player-names/`：`derive.mjs`（从 FC26 存档 `base_players.csv` + `playernames.txt` + `cards.csv` 派生显示名与球衣号，产出落库 SQL + 审计 CSV）、`load.mjs`（逐条语句写 D1，`--dry-run` / `--local` / `--remote --yes-prod`）、`README.md`。
- 端点 `POST /api/club/players/:id/number`：教练给本队球员定号 / 改号 / 清号（整数 1–99、同俱乐部不重复、写审计）。球衣号数据源由赛事平台 `player.number` 转来（570/570 按 fc_id 归属、归属不一致 0）。
- 前端 `web/src/lib/player-link.ts` 的 `playerPath()`；`src/core/player-name.ts` 的 `sqlDisplayName()` / `rowDisplayName()`；`src/worker/player-ref.ts` 的 `firstPlayerByRef()`。

**变更**
- **球员名显示口径**：所有面向前端的球员名字段改为 FC26 派生的显示名（`COALESCE(display_name, name)`）。派生规则 = `commonname 原样 || 名+姓 || cards.csv 完整人名（矛盾则弃用） || 空回落 players.name`。18,301 人派生成功 17,470（commonname 2,548 / 名+姓 14,527 / cards 兜底 395），**570 名俱乐部球员全部有显示名**。列表行同时出 `officialName`（官方缩写名），前端在两者不同时出小字。
- **姓名搜索改双列 OR**（显示名 + `players.name`，同一 pattern 推两次）：只看显示名则按姓搜不到几百个单词显示名的人（`Ederson`/`Isaac`），只看 `name` 则 `Erling Haaland` 搜不到。
- **球员档案页 URL 改 fc_id**：`GET /players/:id` 与 `/transfers`、`/growth` 先按 `fc_id = ?` 点查、未命中回落内部 `id`（fc_id 空间 19541–279948 与内部 id 1–18301 零重叠，两次都是唯一索引点查）；前端链接统一走 `playerPath()`，旧 id URL 自动 replace 成规范地址。写端点仍只收内部 id。
- **阵容表加只读号码列**；合同页签恒有「球衣号」行（仅本队教练可改）；谈判成约后弹「给新援定号」（可跳过）。
- **比赛结果归属改按 fc_id 认人**：原先靠 `club_id + name` 等值匹配，而赛事平台存完整人名、本库存官方缩写名 ⇒ 两侧写法不同的人会漏；现在先 `WHERE fc_id = ?`（不按 club_id 过滤，转会后旧比赛仍算他的成长），姓名只作回落。

**修复**
- 换队与解约清空球衣号（球衣号属于俱乐部，留着旧号会让「同队不重复」在两个队之间打架）；合同导入的认领 UPDATE 同样清。
- **落库脚本三处跑不通**（评审发现，均实测确认）：`derive.mjs` 产出 `BEGIN;`/`COMMIT;` 而 D1 拒收 SQL 事务控制语句 ⇒ 一条都落不了库（已去掉事务控制，并说明每条语句按 fc_id 独立更新、可整体重跑）；`number.sql` 的 CTE 列数不匹配（声明 6 列只给 2 值）；`load.mjs` 用 `spawnSync('npx.cmd')` 在 Node 24 / Windows 上直接 `EINVAL`（改用 `process.execPath` 跑 `node_modules/wrangler/bin/wrangler.js`）。另修 `load.mjs` 语句计数器（原先传对象、永远 0）并加事务控制语句守卫。

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **47 文件 / 659 例全绿**（v3.4.0 基线 46/642）；`npm run build` 成功（`index-Bco7kOHW.js` 477.77 kB / gzip 150.38 kB）；`npm run test:e2e` **11/11 通过**。变异验证四处定向变红（索引表达式错一字符退化 `TEMP B-TREE`、`fc_id` 归属加 `AND 0`、两处 `number = NULL` 删除、链接回落顺序反转）。落库链路本地端到端跑通且幂等（19 条语句，fc 20801 落成 `Cristiano Ronaldo` / `7`）。

## [已上线] · v3.4.0 — 球队页：公开列表 + 登录详情 + 自家队中心合并 + 只读媒体路由（2026-09-22）

用户 m12793 下达「新增球队页（列表 + 详情）」，并特别要求注意性能、省 D1 额度。17 个提交（`70dc811` / `545ad90` / `e0411de` / `5dbfe41` / `a84c748` / `779ee6b` / `5b90031` / `32068be` / `00092b4` / `57e68a6` / `829063f` / `aa0aea2` / `50e69f5` / `6464d0b` / `5f7c3d6` / `d759b86` / `2ad239b`），**已推送（`466df81..d759b86` 16 个 + `d759b86..2ad239b` 1 个）并部署上线**（生产 Version `7a178d81-dccc-4696-a7d7-7d8c61eaa683` → `64020454-405c-479a-9a62-8197444f4f52` / `adb3a5ae-dbc5-4648-bf62-383e1108923d`）。**本增量零迁移**（计划中的 `0032` 部分索引在步骤 1 实测后被裁掉），故推送无生产 DDL 耦合；生产迁移仍到 0031。

**新增**
- 端点 `GET /api/clubs`（公开）：一次算完 20 队，固定 4 条 whl-club 语句 + AUTH_DB/TOUR_DB 各 1~2 条，**无逐队查询**；clubs scope 缓存 24h + `assertPublicRate`。响应 `{ clubs: [{ id, name, isCpu, tier, logoKey, squad:{senior,trainee}, avgCa, totalValue, totalWage }] }`。
- 端点 `GET /api/clubs/:id`（需登录）+ `GET /api/clubs/:id/standing`（排名代理）：队头 / 阵容结构 / 合同结构 / 转会往来 / 近期战绩；阵容一条语句取全队后在 JS 里算三个维度分布，避免三条 GROUP BY。
- 端点 `GET /api/media/*`（公开）：镜像比赛系统的媒体路由，**只读不写、不碰任何 D1**，是球队页里唯一的零 D1 读面。key 白名单 `/^(team|tournament)\/\d+\//`、边缘缓存命中即返、`immutable` + ETag。
- 前端页面 `web/src/pages/Clubs.tsx`（公开，按顶级/次级/未定级三段卡片）、`web/src/pages/ClubDetail.tsx`（阵容组 / 运营组 / 战绩组，三组结构分析全用 **CSS 自绘图表**，不引图表库）、组件 `web/src/components/TeamLogo.tsx`（有 logoKey 出 `<img>`，否则按队名哈希出首字色块）。
- 入口四处：顶栏「球队」页签、首页 nav-card、球员库归属球队列、球员档案页眉队名；市场页卖方名与出价方名也链到 `/clubs/:id`。

**变更**
- `/club` 从「我的球队中心」页改为**重定向壳**：在途给加载态、未绑定去 `/bind`、已绑定去 `/clubs/<我的队>`。原 897 行内容整体搬进 `web/src/pages/club/CoachPanel.tsx`，只在详情页里、且登录者正是本队教练时渲染。搬迁中故意去掉的只有三处：页面外壳（container + h1）、`!overview?.club` 分支（改 `return null`）、`club-head` 里的队名与分级徽章（详情页页头已给）。
- 球队页 URL 的 id 一律是**平台库 `clubs.id`**（裁决 Q17，已写进 `AGENTS.md`）。
- **详情页结构分析按用户裁决整改**（步骤 11a，用户 m14999 批准；配色只用站点既有调色板变量，不新造颜色）：位置分布改**门将/后卫/中场/前锋四档纯文字**（原 `GK CB CM ST` 是错的，且按裁决不用图示），档内给细位明细；年龄结构改**等宽 3 岁箱 + 竖直直方图**（`≤18 / 19–21 / 22–24 / 25–27 / 28–30 / ≥31`，代价已知：当季 `age_cap` 不再是档界）；CA 结构改 **`90+ / 85–89 / 80–84 / 70–79 / <70` 横向占比条**（分母是全队人数而非各档之和，带 0–100% 刻度轴与行尾人数）；三组指标区由等权 10 格网格改为「**三格主指标 + 一行语义明细**」（能力 / 资产 / 荣誉）。效力年限保持原普通升序横向柱状图。
- **详情页结构分析的样式整改**（步骤 11b，用户 m15308/m15319；用户明确「不是换展示项目，是样式上太割裂」⇒ 只改样式、不增删数据项）：主指标与明细行收进同一块 `.club-summary`（淡奶油底 + 一道左侧焦橙竖线，**去掉逐格竖线与明细行顶部分割线**——那正是「小字与上方割裂」的来源）；年龄直方图去掉 `max-width: 460px` 并把轨道高由 72px 提到 **128px**（原 460×72 是 6.4:1 扁条，现约 370×128 = 2.9:1）；CA 由「逐档横条」改为**一根 100% 堆叠条 + 0–100% 刻度轴 + 逐档图例**（段色是同一 `--terracotta` 的深浅阶梯，**颜色仍只来自 CSS**，只渲染非零档）；阵容组三张图进 `.club-figures` 宽屏三列铺满卡片、运营组用 `.club-split`（左 summary / 右效力年限图，900px 折一列），消掉右侧大片空白。顺带修两处实测缺陷：`.band-label` 宽 4.5em → 6.5em + `nowrap`（「3 赛季及以上」原会折两行）、0 人档不再渲染 `.band-bar`（`min-width: 2px` 会把 0 读成「有一点」，与直方图 0 人不出柱同口径）。

**修复**
- **CSS 类名冲突污染球员档案页**（评审发现）：本增量新追加的 `.pos-chip` 与 `web/src/pages/Player.tsx:568` 在用的 `.pos-chip-main` 同特异性且位置更晚，覆盖其 `background:var(--ink)` 而 `color:var(--paper)` 仍生效，**球员页第一个位置徽章变浅底浅字不可读**。修法是新增类一律带 `club-` 前缀。
- **`/club` 重定向把「请求失败」当成「未绑定」**（评审发现）：`useMyClub` 在 `isError` 时 `club: null`，而全局 `retry: false` ⇒ 一次失败即终态，会把绑着队的教练送去写着「一账号只能绑一支队」的 `/bind`。修法是 `MyClubState` 新增 `failed`，壳在该状态下留在原地报错。
- 订正两处**错误注释**：`src/worker/routes/clubs.ts` 与 `src/worker/home.ts` 里原先写「`clubFormPts` 绑 club id 才恒不命中」——生产实测证伪（见下）。
- **「总身价」全站显示 `0.00 m`**（部署后最小化回读抓到）：`GET /api/clubs` 20 队 `totalValue` 全 0。根因是 `players.market_value` 生产 18,301 行**全 NULL**（该列属运营列，`src/core/import.ts:3` 明写导入「绝不触碰运营列（status/contracts/badges/growth/market_value/agent_tier）」，只有 admin PATCH 会写），而 `CLUB_SQUAD_AGG_SQL` 写的是 `SUM(COALESCE(p.market_value, 0))`，把「没人录过」压成 0 这个具体的假话。修法：聚合改 `SUM(p.market_value)`（全 NULL 时 SUM 出 NULL）、`totalValue` 类型改 `number | null`、前端 `money(null)` 回 `—`（与球员库 `web/src/pages/PlayersLibrary.tsx:58` 同口径）；**`totalWage` 口径不变**（CPU 队无合同 ⇒ 0 是真话）。提交 `2ad239b`，重新部署后生产复验 20 队全部 `null`。

**结论（步骤 9，只读核对，不改代码行为）**
- `result_confirmations.home_team_id / away_team_id` 存的是**比赛系统队 id**（迁移 0017），而 `clubFormPts` 绑的是 club id，语义上确实是两套 id。
- 但生产实测（2026-09-22）AUTH_DB `team` 表 20 行**逐队 `club_id` = `tour_team_id`**，`result_confirmations` 69 行的队 id 全落在这 20 个值内且 20 队各有 6–7 条已确认赛果 ⇒ 函数**算得出真值**，此前「命中恒 0 ⇒ 战绩系数恒 1.0」的结论**是错的**。
- 定性为**潜伏缺陷，非现行故障**：米兰的 `tour_team_id` 曾长期是 legacy 47 而 `club_id` 是 131681，直到 2026-09-19 rekey 才统一，那段时间本函数对米兰恒返中性 4。将来若新增 club 的 id 不等于其 tour 队 id，本函数会静默退化成「永远中性」。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **46 文件 / 642 例全绿**（v3.3.0 基线 40/573）；`npm run build` 成功（`web/dist/assets/index-C7pOcE6p.js` 474.57 kB / gzip 149.44 kB、`index-BT5YAIcz.css` 34.57 kB / gzip 7.58 kB）；`npm run test:e2e` **11/11 通过**（三视口；新增球队页两场景，截图落 `scratch/e2e-clubs-*.png` 与 `scratch/e2e-clubs-detail-*.png`）。
- 上线回读（2026-09-22）：`https://club.whleague.win/` 200 且首页资产与本地 build 逐字一致；匿名 `GET /api/clubs/1` → 401（符合裁决 Q1）；`GET /api/clubs` → 200、20 队、`logoKey` 20/20 非空；生产已配 `TOUR_API_BASE="https://whleague.win"`；生产迁移查得「✅ No migrations to apply!」⇒ 已在 0031。
- 读量（生产实测）：`/api/clubs` 聚合 1,032 行（全表 18,301，SQLite 靠 `WHERE club_id IS NOT NULL` 范围扫跳过 17,731 行 NULL）；`GET /api/clubs/:id` 151 行（club 1）/ 165 行（club 9，生产阵容最大 37 人）；`/api/clubs/:id/standing` 11 行；`/api/media/*` **0 行 D1**。验收线为列表 ≤3,000 行、详情 ≤500 行。
- 变异验证多处均能定向变红（教练区块身份判定、`/club` 两个 Navigate 目标、`failed` 分支、`平均成长空间`、积分榜 TTL、CA 条分母、直方图归一、图表溢出）。
- **本机 e2e 对球队页读端点仍是打桩**：本地 TOUR_DB 的 `team` 表 schema 陈旧（无 `logo_key` / `club_id`，只有 4 行）⇒ 那两个端点在 127.0.0.1 必然 500，属环境陈旧而非代码回归；本地库补到与生产同形后可撤桩。
- 详见 `ROADMAP.md` v3.4.0 节。

## [已上线] · v3.3.0 — 球员面板专项整改：术语三改 + 合同卷宗对齐 + 六维图与 PlayStyles 归位 + 徽章×PlayStyle 合并 + 转会记录页签（2026-09-22，Version d266036d-aa2e-43be-94ac-7f40972df7bb）

用户一次下达六项球员面板整改。前四项是文案与布局，后两项动了数据层：**「徽章」从「只有计数、身份靠管理组在 FC 阵容文件人工落实」改为平台自己记明细**（`player_playstyles`），并补上球员转会记录页签。8 个提交（`f4d4a68` / `e74148f` / `de3c04c` / `60c8dd5` / `1c44506` / `d38b39f` / `6bd9138` / `da7a1f6`），**已推送（`5394268..da7a1f6`）、已部署、生产迁移 `0031` 已 apply**。

**新增**
- `src/core/fc26.ts` 新增 PlayStyle 发放口径：`PS_GRANTABLE_BASE_IDS`（36 项基础 ID：1-8 / 11-16 / 21-26 / 31-35 / 41-45 / 51-56，与 `web/assets/ref/playstyle.json` 银段逐项一致）、`isGrantablePlaystyleId`、`playstyleIdOf(base, kind)`、`playstyleKindOf`、`playstyleSlotRange`（银 1-12 / 金 13-15）、`nextFreePlaystyleSlot`、`playstyleSlotsOf(attrs)`、`mergePlaystyleSlots`、`planPlaystylePicks`（白名单 → 段内重复 → 已拥有 → 银数量 → 金数量 → 落槽，逐层报错）。
- 迁移 `0031_player_playstyles.sql`：明细表 `player_playstyles`（`player_id / slot / kind / psid(基础 ID 1-99) / source(growth|china|manual) / granted_by / created_at`）+ `UNIQUE(player_id,slot)` + `UNIQUE(player_id,kind,psid)` + 段界 CHECK + 索引；末尾把 `config.badge_cap_silver` 由 `15` 改写为 **`12`**。`tests/d1.ts` 的 `MIGRATION_FILES` 已登记。
- 新端点 `POST /api/growth/china-playstyles/:playerId`（本队教练或管理组）：把一直没人读的 `china_badges`（默认 3）落成真发放，名额**一次发满**、`source='china'`，离队即回收。
- 新端点 `GET /api/players/:id/transfers`（公开只读）：只列 `status='completed'` 的单据，LEFT JOIN clubs 出双方队名，按 `completed_at DESC, id DESC` 取最近 50 条。
- 前端：球员详情第 4 页签「**转会记录**」；`web/src/lib/ref.ts` 导出 `TRANSFER_TYPE_LABEL`（从 `web/src/pages/admin/MarketPage.tsx` 抽出共用）；`Player.tsx` 新增 `PlaystylePickGrid` 选择器与中国计划发放块。

**变更**
- **术语三改全系统对齐**（21 文件，纯文案/注释）：「到顶」→「**非成长**」、「经纪人档位」→「**经纪人性格**」、「档案」→「**合同**」（限指代球员合同页签/成长记录的那批）、「效力球队」→「**来源球队**」。**例外保持原貌**：CHANGELOG/ROADMAP 历史条目、`PRD.md:5` 版本行、已 apply 的迁移注释、`scripts/prod-*/README`，以及「主场/球场档案」语义与主题名「复古档案室」、容器名「档案卡 `.dossier`」；摘要条 chip 与球员库表格列名仍叫「经纪人」（沿用v3.1.1 裁决）。
- 合同卷宗排版：新增 `.dossier-table` 作用域 —— 标签列定宽 6.5em、值列统一左对齐、数值列等宽 `tabular-nums`（此前 `td.mono` 三行与 `td.num` 两行字体与对齐不一致，因为全局 `.mono` 规则根本不存在）。
- 六维雷达从属性页**搬到左栏球员卡下方**（`.dossier-side` 纵列 + `.radar-card`），属性页网格第二行空位放 **PlayStyles 卡**（桌面固定 4 列、`.ps-card` 跨两列、900px 以下两列）。
- **徽章 × PlayStyle 合并**：升级方案带徽章时**必须一并交 `picks`**（数量须与方案一致、白名单内、同段不重复、未被 FC 源同段占用、槽位有空），台账 `badges_silver/badges_gold` 与明细 `player_playstyles` 同批写；徽章上限口径**统一为 12 银 / 3 金**（`badge_cap_silver` 默认 15→12，筛选校验与 admin 校验文案同步改 0-12；**DDL CHECK 仍 0..15、历史台账不 clamp**）。
- 回收与折算：转会成约删 `source='china'` 明细并同步减台账；解约删该球员全部明细；大换版（major）按 kind 保留最早 `ceil(n/3)` 行（`FOLD_PLAYSTYLES_SQL`，`generate-sql.ts` 拼在最后一片末尾）。
- `GET /api/players/:id/growth` 返回 `playstyleDetails` 与 `player.chinaPlaystyles {quota,granted,left}`；属性页 PlayStyles 列表 = FC 源槽 ∪ 明细（按 kind+基础 ID 去重，FC 源优先）。
- 文档口径同步：`TECH_DESIGN.md` 决策表第 10 条把「15 与 12 是两个口径，别混」改写为**已统一**并补发放/回收口径，`player_playstyles` DDL 入 §5 建表清单，§10.2/§10.4 补 picks 与明细折算，config 表 `badge_cap_silver` 改 12，端点表加 2 行；`UI_DESIGN.md` 球员详情行改为四页签 + 左栏雷达卡 + PS 卡嵌网格 + 徽章墙 x/12。

**修复**
- **`src/worker/transfers.ts` 海捞签入误回收中国计划徽章**（评审发现）：china 明细回收原先只 gate 在 `!amendment`，于是**海捞真自由身**（`type='free_agent'` 且 `from_club_id IS NULL`）被当成离队 —— 签入即删掉他的 china 明细并扣台账。改为 `amendment || transfer.from_club_id === null ? 0 : (COUNT…)`（从 CPU 队摘人 `from_club_id` 不为空，照旧回收）。回归测试 `tests/bypass-routes.test.ts` 新增「海捞真自由身是签入不是离队」，变异验证（去掉守卫）可复现两行明细被删。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **40 文件 / 573 例全绿**（v3.2.1 基线 39/550）；`npm run build` 成功（`web/dist/assets/index-C56W4cF9.js` 457.55 kB / gzip 145.20 kB）。
- 真浏览器复核（本地 8791，球员 9100 / 9001）：合同页签 7 行全左对齐、数值列等宽；属性页网格恰 4 列、第二行 = DEF/PHY + PS 卡（5 银 + 1 金）；左栏雷达卡常驻；升级方案选满 35 个银选项之一后确认 ⇒ `ca 76→78`、明细落 `{slot:2,silver,psid:2,source:'growth'}`（跳过被 FC PSID1 占用的槽 1）；中国计划发 3 个 ⇒ 徽章墙 🥈 4/12、明细 3 行 `source='china'`；转会页签 6 列无横向溢出。
- 变异验证：海捞守卫（去掉 ⇒ 明细被删）、折算 SQL、槽号口径、白名单过滤均能变红。
- **上线核对（2026-09-22T11:42Z，4 次线上只读请求）**：迁移 `0031` apply 报 `Executed 4 commands`；`player_playstyles` 表与索引各 1、当时 0 行；生产 `config` 无 `badge_cap_silver` 行（迁移那条 `UPDATE` 空转，上限由代码默认值 12 生效）；线上 `/players` HTML 引用 `assets/index-C56W4cF9.js`（与本地产物同名）；`GET /api/players/1/transfers` ⇒ `{"transfers":[]}`；`GET /api/players/1/growth` ⇒ 含 `playstyleDetails` 与 `player.chinaPlaystyles = {quota:3,granted:0,left:3}`；`GET /api/players?badges_silver_min=13` ⇒ 400「badges_silver_min 应为 0-12」（上限 12 已上线）。

**待办**
- 记录不改的遗留：台账可能 > 12（历史 cap 15）会显示「🥈 15/12」；徽章墙分母硬编码 12/3；方案卡 disabled 让「先选满再确认」toast 在 UI 上不可达；双击发放撞 UNIQUE 会让第二个请求 500（不写脏数据）；0 徽章方案多传 picks 被静默忽略。
- PlayStyle 图标资产包仍待供给（`assets/icons/playstyles/{id}.webp`，缺图降级 🥇🥈）。
- 生产 `player_playstyles` 上线时 0 行，首次真实发放（升级选徽章方案 / 中国计划）建议人工跟一单核对明细落槽。

## [已上线] · v3.2.1 — 球员库 UI 缺陷收口：档案页 15 槽徽章 + 多选面板高度上限 + 表格不折行（2026-09-22，Version 627508e5-f7c6-4e6d-90a2-5f95a82466bb）

v3.2.0 上线后，用户 m12257 裁决「建索引先搁置（当日写限额不足）、海捞池后续会有新调整、球员库 UI 小瑕疵可以现在修」，本增量只修三处 UI 缺陷，不建索引、不动海捞池契约、不写生产数据。5 个提交已于 2026-09-22 推送（`76aaeb9..91bc2d3`）并部署为 Version `627508e5-f7c6-4e6d-90a2-5f95a82466bb`，部署后线上 `/players` 的 HTML 引用 `index-C_n2o0KE.js` / `index-D-qmdoLZ.css`，与本地 `web/dist/assets/` 同名。本轮**不跑生产 API 回读**（不涉后端，省 D1 读额度）。

**新增**
- `src/core/fc26.ts` 新增 `PS_SLOT_KEYS`：由 `PS_SLOT_COUNT` 派生的 `PSID1 … PSID15` 槽位键表（此前档案页是手抄数组，与槽数常量无关联）。
- `web/src/lib/ref.ts` 新增 `playstyleBadges(attrs)`（返回 `{ psid, slot, gold }[]`，扫全 15 槽、只收正整数槽值、`slot` 1 起）与 `PlaystyleBadgeSlot` 类型。

**变更**
- 球员档案页（`web/src/pages/Player.tsx`）的 PlayStyles 徽章由手抄的 `PSID1-7` + `PSID13-15` 改为**按槽位扫全 15 槽**（银 `PSID1-12` + 金 `PSID13-15`），只渲染有值的槽、不给空槽占位 —— 落在 `PSID8-12` 的银徽章从此可见（v3.1.1 遗留 ②；生产实测 `PSID8` 有 3 人）。
- 多选下拉面板的高度上限从 CSS 收回到组件：`web/src/components/MultiSelect.tsx` 新增 `PANEL_MAX_PX = 480` / `PANEL_MAX_VH = 0.7`，`place()` 取 `min(可用空间, 480, 0.7 × 视口高)`（不低于兜底 160px）；`web/src/styles.css` 里那条被内联样式顶掉、从未生效的 `.multiselect-panel { max-height: min(70vh, 480px) }` 删除（遗留 ④）。
- 球员库表格单元格**一律不折行**（`.library-main td { white-space: nowrap }`），列宽不够时由外层 `.table-wrap` 横向滚动承担；管理员页表格不受影响（遗留 ⑤）。
- 摘要条「筛选（N）」的计数口径经用户裁决**维持现状**（数 chip 条数，位置选 12 个仍显示 1），文档里「已接受」改写为「已裁决维持现状」（遗留 ③）。
- 文档口径同步：`TECH_DESIGN.md` 徽章决策表把「档案页只渲染 `PSID1-7`+`PSID13-15` ⇒ `PSID8-12` 可筛不可见」整句替换为全 15 槽口径，并点明「槽号是 1 起」与「徽章墙 🥈 x/15 的 15 是 `badge_cap_silver` 台账上限、与 12 个银槽是两个口径，别混」；`UI_DESIGN.md` 补 15 槽渲染（不给空槽占位）、单元格不折行（附实测宽度）与面板上限；`ROADMAP.md` v3.1.1 遗留段落逐条改口径。

**修复**
- `web/src/pages/PlayersLibrary.tsx` 的 `psNames` 把 `.map` 的 **0 起下标**当槽号传给 `playstyleIsGold(psid, slot)`（后者语义是 1 起）⇒ 下标 12（= `PSID13` 金槽）走不到金槽分支，银段 ID 落在金槽时列表显示成银、与档案页 🥇 不一致（仅异常数据可见）。改为 `slot + 1`，并把 `psNames` 导出以便单测。
- `tests/core-zero-import.test.ts` 的依赖判据 `/^\s*(import|export\s+.*from)/` 会把 `export const PS_SLOT_KEYS: readonly string[] = Array.from(` 里的 `Array.from` 误判为依赖（`from` 命中），把零依赖模块判红。改为抽出 `hasStaticDependency(line)`：`import` 行首 ∥ `export … from '…'`（带引号）∥ 任意位置的 `import(`/`require(`（抓动态 import），并补判据自测。
- `web/src/lib/api.ts` 之类的既有契约未动；`GET /api/players` 等接口行为与本增量无关（纯前端 + 文档）。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 550 例全绿**（v3.2.0 基线 39/539 ⇒ 步骤 1 +5、步骤 2 +2、评审修正 +4）；`npm run build` 成功（`web/dist/assets/index-C_n2o0KE.js` 451.12 kB / gzip 143.00 kB + `index-D-qmdoLZ.css` 27.62 kB / gzip 6.36 kB）；本地 8791 + `npm run test:e2e` **9/9 通过**（三视口表格探针：0 个折行单元格、表格最小宽 876px vs 容器 854 / 815 / 290）。
- 三处改动都做过**变异验证**：`flatMap` 改 `slice(0, 7)` ⇒ 2 例红；面板上限改 `Infinity` ⇒ 5 例红；删掉 `white-space: nowrap` ⇒ e2e 报「108 个单元格仍会折行」；`psNames` 改回 0 起下标 ⇒ 1 例红。
- 不跑生产 API 回读（纯前端改动，省 D1 读额度）；部署后只取线上 `/players` HTML 核对 JS hash。

**待办**
- 推送 + 部署 + 线上产物核对（步骤 5）。
- 不在本增量范围（用户已指令搁置或另有安排）：下一批 4 条候选排序索引（`view=initial&sort=ca` / `uid` / `ps` / `name`，写限额不足）、姓名子串 FTS5、`attr:*` 34 键物化子表、海捞池 `LIMIT 300` 无分页无筛选、30 人 `naID`/`FootID` 补录、PlayStyle 图标包待供给。

## [已上线] · v3.2.0 — 球员库 D1 读消耗治理：去整表 COUNT + 两级缓存与代际失效 + 6 条索引 + 全站读面普查（2026-09-22，Version 7c5b5879-0003-421c-9bf2-6026a4674afe）

v3.1.1 收尾时生产 `/api/players*` 全线 500，排查确认是 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起，比部署早约 2 小时）。用户就此立项：「目前球员库相对稳定，现在查找的 D1 读消耗过大！」。先量化再治理——用「真实路由 + 假 D1 抓 SQL」的测量脚本打生产读 `meta.rows_read`，拿到 30 个形状的物理事实，再按写配额（免费档 10 万行/日）排优先级。全部步骤已于 2026-09-22 推送并部署为 Version `7c5b5879-0003-421c-9bf2-6026a4674afe`（步骤 0–5 先上 `91635aca`，步骤 6 再上 `7c5b5879`），部署后 8 请求最小化回读全部符合预期。

- **新增**
  - **测量工具两件**：`scripts/measure-d1-reads.mjs`（球员库 30 形状 + 6 设计探针）与 `scripts/measure-surface-reads.mjs`（全站 21 条读面），共用 `scripts/d1-read-audit/harness.mjs`。核心手法是**用 Hono 的 `app.request()` 调真实路由 + 注入只记录不执行的假 D1**，把路由实际执行的 SQL 与绑定参数原样抓下来内联后打生产 —— 不手抄 SQL，所以路由改了 SQL 复测自动跟着变（步骤 7 的验收复测直接复用）。三个必须知道的约束：每个读面跑在独立进程（`--only=<id>`，否则 `config` 的 isolate 内 60s 缓存把后续读面抹成 0）；只执行 SELECT（`selectOnly`，GET 里也可能藏写语句）；鉴权靠假 D1 回管理员 claims + 探针 cookie。
  - **定标报告** `scripts/d1-read-audit/README.md`（含原始数据 `measurements.json` / `measurements-after.json` / `surface-measurements.json`）：30 形状基线、6 探针、成本模型、阈值判定与候选清单、全站普查、验收表与豁免清单。
  - **内部计数端点 `GET /api/cron/players-count`**：列表去掉整表 COUNT 后，唯一还需要总数的地方（管理端筛选计数）走这里。**fail-closed**：未配 `CRON_KEY` 一律 403；密钥**只认 `X-Cron-Key` 请求头**（不接受 `?key=`，避免密钥进日志）。
  - **分级缓存**：`src/lib/cache-policy.ts` 的 TTL 单一来源表（球员库列表 1h、名册 24h、俱乐部目录 24h；`PUBLIC_CACHE_TTL_MS` 退化为显式覆盖，配 `0` 即旁路、生产**不配**），KV 代际键 `cache:epoch:public`（isolate 记忆 5s）配写路径 purge，`EPOCH_FAIL_SHORT_MS = 60_000` 兜 KV 读失败。
  - **迁移 `0029_players_sort_indexes_batch2.sql`**（声望 / 归属 / 状态三条排序表达式索引）与 **`0030_players_club_ca_index.sql`**（`players(club_id, ca DESC, id)`，为海捞名单驱动表连接备的）。
  - **同源锁死测试**：`tests/players-sort-indexes.test.ts` 断言语义 SQL 的 `EXPLAIN QUERY PLAN` 命中对应索引；`tests/market-routes.test.ts` 新增「海捞名单查询计划」用例（断言含 `idx_players_club_ca`、含 `SCAN cp`、不含 `MULTI-INDEX OR`）；`tests/admin-system.test.ts` 用记录型 D1 断言 overview 的全表 COUNT 一小时内只跑一次。都做了变异验证（改回去立刻红）。
- **变更**
  - **球员库列表去掉整表 COUNT**：`GET /api/players` 响应**不再有 `total`**，只有 `players` + `nextCursor`（keyset 游标；无更多数据时 `nextCursor` 为 `null`）。前端翻页条文案随之改为游标式（「第 N 页 · 已加载 N 名 · 还有更多／已到末页」），不再显示总数。
  - **两级缓存取代单层**：`cachedJson` 由「进程内 Map 单层」改为 **L1 进程内 + L2 边缘 Cache API**（合成 URL 作键、`cache-control: max-age` 管过期、全程 try/catch 旁路）；缓存键 = `${scope}:v${epoch}:${canonicalQuery}`。
  - **失效从 TTL 兜底改为写路径 purge**：挂钩收敛到两处 —— `/api/*` middleware（非 GET/HEAD + 2xx + `scopesForWritePath` 命中）与 `scheduled()`（tick 真改了数据才 purge）；每次 purge 只做一次 KV 写（代际键单版本）。
  - **前端 `staleTime`**：React Query 全局默认 30s、球员库列表 60s，并补两处写后失效。
  - **`/api/market/free-agents` 查询改写**：原 `WHERE (p.club_id IS NULL OR p.club_id IN (CPU 子查询))` 在生产 97% 球员无归属的数据下退化为 `MULTI-INDEX OR` + 临时排序（36,274 行/次），改写为 `UNION ALL` 两分支 + CPU 支用 `FROM clubs cp CROSS JOIN players p ON p.club_id = cp.id` 固定连接顺序 ⇒ **843 行/次（降 97.7%）**，结果集与旧版逐行一致（25 组随机数据 top-300 逐字节比对全等）。
  - **`/api/admin/overview` 的全表 COUNT 接入球员库列表同 scope 的两级缓存**（`countAllPlayers`，冷缓存仍 18,449 行但 1h 内多 isolate 只算一次、命中 0 行）。
  - **`AuthApiError` 去掉 TS 参数属性**（唯一需要代码生成的语法，Node 类型剥离不支持），否则 `authClient` 的六个读面在测量脚本里加载不了。
  - **`public/admin` 三处产物均为本次构建**：`index-DZu3s6Fn.js`（与步骤 5 同 hash，步骤 6 无前端改动）。
- **修复**
  - **生产 `/api/players*` 全线 500 的真因**（v3.1.1 收尾时的悬案）：D1 免费档当日行读配额耗尽，限额按 UTC 零点归零、自动恢复。排查中确立**三个假阳性判据**：`/api/health` 只读 `sqlite_schema`（不计配额）；`wrangler d1 execute --remote` 是管理通道（不受限）；`/api/clubs/directory` 缓存键是固定字符串且 stale 刷新分支吞掉 loader 错误（D1 全挂也回 200）。拿真错误文本的办法：临时给 onError 加 `__diag` 字段 + `wrangler dev --remote`（本地代码 + 生产绑定，不需部署）。
  - **`selectOnly` 原本放行整个 `WITH`**（`WITH … DELETE` 在 SQLite 合法 ⇒ 等于把写语句送上生产）⇒ 收紧为「`SELECT`，或 `WITH` 且不含写动词」并单测 9 种入参。
  - **`?attr=` 单独给会 400**（前端选一个属性就报错）⇒ `attr` 单独给合法、区间空串等同没给。
- **验收**
  - 30 形状生产复测（仅耗 338,980 行）：默认浏览一页 **18,819 → 56 行**（第 5 页 52、初始视图 56、`sort=id` 56）；`sort=ca/pa` 18,821/18,824 → **58/61**、`sort=age`/`market_value` → **22/22**（0027）；`sort=prestige/club/status` 56,398 → **53/43/22**（0029）；筛选各形状全部降到百级（`club_id=5` 64、`club_id=free` 22、`status=normal` 58、`growable=1` 95、`position=ST` 110、`ps=25` 293、`attr≥80` 88、`ca_min=80` 56）。容量推演：默认浏览从 **265 次/日** 升到 **89,285 次/日**。
  - 未达标形状逐条豁免（报告 §5.5）：8 个全表扫排序键 56,398–56,400 → 37,635–37,637（只降 33% = 纯去 COUNT；键在 `contracts`、依赖窗刻度子查询或内联运行时 config 系数的都不能静态索引），姓名查找 36,606 → 18,304（`LIKE '%x%'` 子串匹配用不了 B-tree，只能 FTS5 trigram）。
  - 测试 `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 539 例全绿**；`npm run test:e2e` 9/9；最小化回读 8 请求全符预期（`/api/health` 200、`/api/players?limit=1` 200 且**已无 `total`**、`sort=prestige`/`sort=status` 200、`/api/players/roster` 200、`/api/clubs/directory` 200、`/api/market/free-agents` 与 `/api/admin/overview` 均 401 未登录而非 500）。
  - 额度（UTC 2026-09-22）：读 1,993,427 行（39.9%）、写 73,220 行（73.2%）。
- **待办 / 登记未做**
  - 下一批可建索引（每条 18,301 行写，免费档自留 6 万/日 ⇒ 每天最多 3 条）：`view=initial&sort=ca`（`COALESCE(base_ca, ca)`）、`sort=uid`、`sort=ps`（15 项链，须先过 D1 表达式树深度体检）、`sort=name`。
  - 姓名子串查找的 FTS5 trigram、`attr:*` 34 键的物化子表：独立主题。
  - 海捞池已 17,731 人而 `LIMIT 300` 无分页无筛选（「除 CA 最高 300 人外都看不到」是产品级问题，本增量只治读量、不动契约）。

## [已上线] · v3.1.1 — 球员库左栏 UI 收口：多选下拉替代 chip 墙 + 区间成对 + PlayStyle 银/金分槽（2026-09-21，Version 3455087e-4bdb-4a63-b40f-8df943d80892）

用户对刚上线的v3.1.0 左栏提了 8 条反馈（同行元素未对齐、表格上方空白过多、查找框灰字过长、位置 16 个 chip 太占地方、同一属性的上下限占两行、「属性键」用英文键、「经纪人」叫法、PlayStyle 与显示列也该是多选下拉），另附带要求**修掉金徽筛选**。本轮只改前端与筛选语义，**不写任何生产数据、不碰缓存与限流数值**；生产读消耗的量化与治理被用户明确挪到下一增量（当日 D1 读额度已超限，见 ROADMAP v3.1.1 节的「裁决」与「遗留」）。本增量已于 2026-09-21 推送（`89e039d..30c7cdc`，7 个提交）并部署为 Version `3455087e-4bdb-4a63-b40f-8df943d80892`；部署后生产 `/api/players*` 一律 500，排查确认为 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起全站真实表读失败，比本次部署早约 2 小时；限额按 UTC 零点归零），最小化生产回读顺延到额度归零之后。**回读已于 2026-09-22T00:01:52Z（本地 08:01，归零后 1 分 52 秒）补做**：`/api/health`、`?sort=name`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster` 六个端点全部 200，另用 `?ps=125&limit=3` / `?ps=25&limit=3` 各一次（合计 8 请求）实测银/金分槽语义在生产成立（金值只命中 `PSID13-15`、银值只命中 `PSID1-12`，互不串），cron 自 00:00:34Z 起恢复成功。

- **新增**
  - **`MultiSelect` 多选下拉组件**（`web/src/components/MultiSelect.tsx`）：走原生 **Popover API**（面板进 top layer，不被窄屏抽屉的 `position:fixed + overflow-y:auto` 裁切），自管 open 态（浏览器的 light-dismiss 一勾就关，多选要能连点），三条关闭路（再点触发器 / 点面板外 / Esc——Esc 里 `preventDefault()`，否则一次 Esc 会连抽屉一起关），面板位置按触发器 `getBoundingClientRect()` 现算并随滚动/缩放跟随，**下方不足 220px 就翻到触发器上方贴底**。位置（12 码位）、显示列（18 列）、PlayStyle 三处接入（v3.1.1）。
  - **属性中文名表成为单一来源**：`web/src/lib/ref.ts` 新增导出 `ATTR_LABELS`（34 项中文名）与 `ATTR_GROUPS`（七组：速度 / 射门 / 传球 / 盘带 / 防守 / 体格 / 门将），球员档案页（原来自写两份、未导出）与筛选面板共用同一份，并有 `ref.test.ts` 断言「与 `ATTR_KEYS` 逐序全等、无重复」。
  - **控件行统一**：`:root` 新增 `--control-h: 34px` 与 `.control-row`（工具条与左栏共用），同行控件底边齐平（v3.1.1）。
  - **e2e 探针**（`scripts/e2e/smoke.mjs` ⑧）：多选面板几何与命中测试（整块在视口内、`elementFromPoint` 命中面板内部、与触发器不重叠、高度 ≥160）、同行控件底边逐对对齐（并断言量到非空）、翻页条按线上量级文案量页面横向溢出（v3.1.1）。
- **变更**
  - **区间上下限合并成对**：原先 14 个 `num()` 每个占一行（「CA ≥」「CA ≤」各一行），改为每对一行两列、label 在左、placeholder 标「最低 / 最高」——CA / PA / 成长空间 / 初始 CA / 年龄 / 身价 / 影响力 7 对 + 属性 1 对（选中属性后出现，label 是该属性中文名）+ 合同 3 对（工资 / 解约金 / 效力时长）（v3.1.1）。
  - **位置**：16 个 chip（四个组 chip + 12 个码位）→ 多选下拉，只放 12 个码位（`POSITION_GROUPS` 随之下线）；点选仍是多选，URL 仍是 `position=CB,ST`（v3.1.1）。
  - **PlayStyle**：72 个 chip（银金同列、点金徽必然 400）→ 多选下拉，顶层分「银徽章 / 金徽章」两段、段内按 EA 六类（射门 / 传球 / 防守 / 控球 / 体格 / 门将）分组，各 36 项；不带搜索框（v3.1.1）。
  - **显示列**：`details` + chip 组 → 同一个多选下拉（`恢复自动` 移入面板页脚，仅手动改过时出现）（v3.1.1）。
  - **摘要条与翻页条合并成一行**（chips 靠左、翻页靠右，都在表格正上方），无筛选时不再渲染「未设筛选条件」占位——原先摘要条是全宽独立一行、分页条居中在表格上方，两者叠加出约 150px 空白（v3.1.1）。
  - 搜索框占位由 `按姓名找（支持去变音：sesko → Šeško）` 改为 **`查找`**（`aria-label="按姓名找"` 保留，去变音能力不变，只去掉占位里的教学文案）（v3.1.1）。
  - 筛选面板「属性键」→ **「属性」**，下拉 34 项按七组 `<optgroup>` 分组、选项写中文名（原先 34 个英文键平铺）；「经纪人」→ **「经纪人性格」**（仅筛选面板 label 与档案页的「经纪人性格 🕴」；摘要条 chip 的「经纪人：温和」与表格列名仍叫「经纪人」，用户裁决值此）；（v3.1.1）。
  - **PlayStyle 命中语义收口**：库里 15 个 PS 槽 = **银槽 1-12 + 金槽 13-15**（金徽落库存「基础 ID + 100」）。改为**银值只比银槽、金值只比金槽**，不再「基础 ID 或 其 +100 命中任一槽」——旧语义下筛银徽章会捞出只挂金徽章的球员（v3.1.1）。
  - PlayStyle 筛选参数白名单由「1-99」改为 **「银 1-99 ∪ 金 101-199」**（100 是空档）+ 去重 + 上限 100 项（超限 400）；槽位与段位常量（`PS_SLOT_COUNT=15` / `PS_SILVER_SLOT_COUNT=12` / `PS_GOLD_BASE=100` / `isPlaystyleId` / `isGoldPlaystyleId`）全部落到 `src/core/fc26.ts`，前后端与档案页共用，不再各写写死字面量（v3.1.1）。
- **修复**
  - **点金徽 chip 必然 400**：前端 `filtersToQuery` 序列化 `ps` 时没有任何白名单、后端只收 1-99，而旧面板铺出的金徽 chip 会序列化成 101-156 ⇒ 随本轮语义收口改掉（v3.1.1）。
  - **多选面板掉出视口**（真浏览器实测）：触发器贴近视口底部时，面板落在 806–966 而视口高 800，掉在视口外、点不到也滚不到 ⇒ 落位改为「下方不足 220px 翻到上方贴底」；同时落位**必须在 `showPopover()` 之后**（之前面板是 `display:none`，`offsetWidth` / `scrollHeight` 量到 0，「面板想要多高」恒为 0，翻转几乎永不触发）（v3.1.1）。
  - **窄屏勾选框标签被拆成三行**：375px 抽屉里 `.lib-adv-grid .field.check` 被 flex 压到 96px，「仅未来之星」渲染成「仅未 / 来之 / 星」⇒ 加 `white-space: nowrap`，整条换行而不拆字（v3.1.1）。
  - 两条 e2e 断言被评审指出是空洞的：翻页条原断 `scrollWidth > clientWidth`（CJK 会换行，永不可能失败）、同行判据原按 `top` 归行（`.control-row` 是 `align-items:flex-end`，底边对齐的成对控件顶边本就不同，会被判成不同行而跳过）⇒ 改为「页面级横向溢出」与「纵向相交归行 + 比底边 + 断言量到非空」（v3.1.1）。
- **待办**
  - **球员库 D1 读消耗的量化与治理**（v3.2.0）：本增量原计划的第一步是打生产实测，但 2026-09-21 当日 D1 读额度已超限（免费档按 UTC 零点归零），用户裁决整体挪到下一增量 ⇒ 本增量**未做任何读消耗测量，也未改缓存 / 限流 / 查询行为**。
  - **档案页只渲染银槽 `PSID1-7` 与金槽 `PSID13-15`**，而筛选与导入的口径是银槽 1-12 ⇒ 落在 `PSID8-12` 的银徽章「可筛不可见」（既存问题，v3.1.1 未修；**v3.2.1 已修**）。
  - 摘要条「筛选（N）」数的是 chip 条数：位置选 12 个仍显示 1（chip 粒度按用户裁决合并，计数口径随之如此，已接受）。
  - 1280 宽下表格里「Baseline Utd」「20.00 m」「2金7银」会折行（列宽所致，非本轮引入）。

## [已上线] · v3.0.0–26 — Version b83ec876（2026-09-21）

2026-09-21 推送 39 个提交（`29c8199..d17cbdd`）→ 部署 Worker（v3.1.0 只改代码与文档、无需迁移；v3.0.0 的 `0028` 已于同日随合同导入批 apply）。`wrangler deploy` CLI 回显 Current Version ID `81e93c74-228f-4fee-9d87-9fecf602d360`；`wrangler deployments status` 的 100% 流向为 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（同一批、相隔 5 秒，与v2.3.0–24 的 `90bfd78f` / `c0e0d130` 同形态）。

生产回读：`/api/health` 三资源 ok；`/api/players?limit=1` 200；`/api/players?sort=name` 200（修复前直接 500）；`/api/players?name=sesko` 返回 `B. Šeško`（去变音折叠在线上生效）；`/api/players/roster` 200 / 325262 字节；`ca` / `market_value` / `attr:finishing` / `years` 四个排序键与 `effective_years_min` / `protected` / `attr=finishing&attr_min` 三个筛选查询全 200。

## v3.1.0 — 球员库筛选搬进左栏（2026-09-21 上线，见上方部署记录）

- **新增**
  - **姓名去变音搜索**：新增 `src/core/name-fold.ts`，JS 侧 `foldName` 与 SQL 侧 `sqlFold` 用同一张 `FOLD_SPEC` 映射表（两侧规则同源，避免「折了一侧、另一侧没折」的静默漏搜）；球员库 `?name=` 改 `sqlFold('players.name') LIKE ? ESCAPE '\'`，「sesko」能搜到「Šeško」；导入侧 `warnUnfoldable` 对表外字符只警告不挡行，配套硬闸 `unmappedNameChars` 与只读脚本 `scripts/scan-name-chars.mjs`、链深守卫 `scripts/check-name-fold-depth.mjs`（v3.1.0）。
  - **轻量名册端点** `GET /api/players/roster`：单条 SQL 拼「姓名|俱乐部ID|球员ID」多行文本，5 分钟缓存下限；前端**聚焦搜索框才拉**（从不点搜索框的人不付这个代价），之后本地过滤 + 键盘上下选 + 点条目跳 `/players/:id`（v3.1.0）。
  - **球员库左栏**：筛选与显示列搬进球员列左侧 sticky 定宽栏（260px），桌面可收起且收起态记 `localStorage`；生效条件摘要条常驻、每条 chip 可单独撤销（v3.1.0）。
  - **窄屏筛选抽屉**：900px 断点下左栏改为左侧滑出抽屉，遮罩 / × / Esc 三条关闭路、背景锁滚、焦点陷阱与归位（v3.1.0）。
  - **前端组件测试基建**：devDeps 加 jsdom 与 @testing-library（react / dom / user-event），`vitest.config.ts` 加 react 插件并把 include 扩到 `web/**/*.test.ts(x)`（v3.1.0）。
- **变更**
  - **排序键 6 → 29 个**（表头每一列都可排）：`SORT_KEY_NAMES` 与 `TEXT_SORT_KEYS` 提到零 import 的 `src/core/players-sort.ts`，前后端共用同一份（原来各写一份字面量）；文本键（`name` / `contract_type` / `source`）走文本游标 `decodeTextCursor`；新增 `attr:<属性键>` 排序键，属性白名单与后端同源（`FC26_GAME_ATTR_COLUMNS` 从 `sprintspeed` 起切，34 项 = 29 外场 + 5 门将）（v3.1.0）。
  - 球员库排序交互由下拉框改为**点表头**，两态循环（升 → 降 → 升），`sort`/`order` 继续留 URL；默认态不给任何列打 active（服务端默认按 `players.id ASC`，标「UID ↑」是说假话）（v3.1.0）。
  - `PlayersLibrary.tsx` 853 → 598 行（`a7b92c0` 抽离那一步为 340 行，后续左栏/抽屉/表头排序各步又增回）：筛选控件抽成 `web/src/components/FilterPanel.tsx`（12 props），筛选模型拆到 `web/src/lib/players-library.ts`（Filters / EMPTY_FILTERS / RANGE_URL_KEYS / COL_DEFS / autoColsFor / sortColumnVisible / parseColsParam），行为不变（v3.1.0）。
  - 顶栏高度不再写死：`web/src/components/TopBar.tsx` 用 ResizeObserver（**`box: 'border-box'`**）实测回写 `--topbar-h`，吸顶元素避让顶栏（用户放大字号后顶栏更高，写死的 54px/102px 会压住侧栏）（v3.1.0）。
- **修复**
  - **`sqlFold` 的 REPLACE 链撞 D1 表达式树深度上限**：253 项链在真引擎上报 `D1_ERROR: Expression tree is too large (maximum depth 100)`，`?name=` 与 `sort=name` 直接 500（node:sqlite 上限 1000，本地单测测不出）⇒ 折叠表裁到生产实测 87 项，并加 `SQL_FOLD_DEPTH_LIMIT` / `SQL_FOLD_ENTRY_BUDGET` 与守卫脚本（v3.1.0）。
  - **焦点陷阱漏掉收起 `<details>` 里的元素**：Chrome 对收起 details 内元素不返回 `offsetParent === null`，导致清单末位错位、Tab 逃到 body（375 实测第 25 次）⇒ 显式排除 `details:not([open])` 后代、保留其 summary（v3.1.0）。
  - **关闭抽屉的焦点归位不能在同帧 focus()**：入口按钮所在工具条此时是 inert，`focus()` 被浏览器静默忽略、activeElement 掉到 body ⇒ 改为置标记、由 effect 在 `drawerOpen` 变 false 后再 focus（v3.1.0）。
  - 窄屏吸顶规则按类名裸命中抽屉内的筛选行，把「位置」那组 chip 头两行压住 ⇒ 规则改名 `.lib-toolbar` 并限定作用域；抽屉抬头补 sticky（v3.1.0）。
  - `foldName` 删掉 NFD 与整段 `toLowerCase`（只做查表替换 + ASCII 小写），`unmappedNameChars` 加形状变体判据 `FOLD_SHAPED`（弯引号/花式空格/不可见字符原先被跳过、永不报警）（v3.1.0）。
  - `attrSortExpr` 加 `+ 0`、`growth_gap` 两侧 COALESCE（属性值混字符串会让游标 NaN 或比较恒假）（v3.1.0）。
  - 锁滚在 Windows 经典滚动条下整页横跳 16px ⇒ `html, body { scrollbar-gutter: stable }`（v3.1.0）。
- **待办**
  - ~~本轮只改代码与文档，未 push 未部署~~ → **2026-09-21 已随 Version `b83ec876` 推送并部署**（`29c8199..d17cbdd`，39 个提交）；v3.0.0 的 worker 也一并上线。
  - 窄屏抽屉锁滚靠 `body { overflow: hidden }`，iOS 上不彻底（已加 `overscroll-behavior: contain` 兜底，真机未验）。

## v3.0.0 — 合同期与财政节点改窗刻度（2026-09-21 上线，见上方部署记录）

- **新增**
  - **合同期改窗刻度**（迁移 0028）：`contracts` 加 `service_ticks`（签约基数 = 签约时点已关常规窗数）/`protection_ticks`（保护期结束的绝对窗数）/`signed_season`+`signed_window_seq`（展示），`season_windows` 加 `is_temporary`；效力 = 0.5 × 已关常规窗数（1 常规窗 = 半赛季），保护期 = 签约后 3 个常规窗，解约免费门槛 = 6 个常规窗（3 赛季）；纯函数在 `src/core/bypass-rules.ts`，计数助手 `src/worker/contract-ticks.ts`（v3.0.0）。
  - **窗分型**：开窗 `POST /api/admin/windows/open` body 加 `temporary`；同赛季常规窗上限 2（季初 + 中期，第 3 个非临时窗硬拦 409）；季初/中期不落库，按同赛季非临时窗顺序派生（v3.0.0）。
  - **忠诚奖金改发放点**：从赛季结算按钮移到**赛季中期窗关窗**时发（`kind='loyalty' ref_type='window' ref_id=season*100+windowSeq` 幂等，逐队合并一条流水），关窗响应回显 `loyalty`（v3.0.0）。
  - **导入历史合同**：按 `effective_from` 反查签约基数并落保护期刻度（训练营无保护期），`service_ticks`/`protection_ticks` 随之 upsert（v3.0.0）。
- **变更**
  - 关窗扣款顺序改 **富人税 → 工资**，富人税税基含未扣工资（`资金` 与 `ΣRC+资金` 取多，不再减本窗工资）；临时窗只扣富人税 + 维护费（不扣工资、不收冠名租金也不递减剩余窗数），死忠演化每种窗照做（v3.0.0）。
  - 续约/匹配把保护期收口到审核通过当下：`protection_ticks` 置为当前已关常规窗数（判定恒不成立），`service_ticks` 效力基数不动（v3.0.0）。
  - 球员库/球员详情/球队页的效力与保护期按赛季展示（`serviceSeasons`/`protected`），筛选 `effective_years_*`、`protected=in|out` 改窗刻度 SQL；管理端开窗表单加「临时窗」复选框、窗列表加窗类型列（v3.0.0）。
  - `contracts.protected_until`（旧口径 signed_at + 548 天）保留留档，判定不再读；`loyalty_tiers` 档位单位由「年」改「赛季」（数值不变）（v3.0.0）。
- **修复**
  - 球员库效力筛选原会把无合同的球员按基数 0 当满效力：加 `ct.player_id IS NOT NULL` 闸（v3.0.0）。
  - 空数组求和得到 `-0` 会让关窗响应与断言别扭：`PayrollSummary` 汇总归一为 `0`（v3.0.0）。
- **待办**
  - 迁移 0028 **已于 2026-09-21 随合同导入批 apply 到生产**（生产迁移现到 0028）；~~worker 仍未部署~~ → **2026-09-21 已随 Version `b83ec876` 部署上线**（网页面板建合同不再落 DDL 默认刻度）。
  - 0028 是纯加列迁移（5 条 `ALTER TABLE ADD COLUMN`，无数据回填——apply 时生产 `contracts` 与 `season_windows` 分别为 0 / 1 行），比 0027 的 7.3 万行写轻得多。

## [已上线] · v2.3.0–24 — Version 90bfd78f（2026-09-20）

2026-09-20 推送 50 个提交（`9f05116..fe60273`）→ 生产迁移 apply 0022–0027（生产迁移现到 0027）→ 部署 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`。生产回读：`/api/health` 三资源 ok；0026 的 CPU 回填核对通过（id 10 / 241 / 112172 / 131681 均 `is_cpu=1`）；v2.3.0–23 新增路由在生产返回 401（未登录）而非 404。

### 新增

- **球员库**：接口补 `total` 与整套筛选域（身价/声望/成长空间/初始 CA/惯用脚/成长档位/未来之星/中国计划/经纪人档位/PlayStyle 多选/位置四槽多选/细分属性区间/合同域）；页面改版为 SoFIFA 式可变列 + 更多筛选折叠面板 + URL query 持久化（v2.3.0）。
- **俱乐部目录工具**：新建俱乐部必填游戏队号（赛事库校验 + 队名预填 + 指定 id 建行 + 认证目录 upsert，失败可重试）；`GET /api/clubs/directory`；管理端多教练绑定逐个解绑；换队号 rekey 只读预演工具 `scripts/rekey-team/`（v2.3.0）。
- **站内信收件篮**：`GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`，未读判定用独立列 `read_at`（迁移 0022），赛果确认与升级两处写入点内部改双通道（每个绑定账号一条 web 行进收件篮，绑了 QQ 的另加一条 qq 投递行）（v2.4.0）。
- **设施经营**：球场扩建、档位升级、子设施升级与建设券（迁移 0023 给 `stadiums` 加 `build_credit` 列），用户端 `GET /api/club/stadium/build-info` 与 `expand` / `upgrade` / `facilities/upgrade`，管理端 `GET|POST /api/admin/clubs/:id/stadium`；建设支出按 25% 返券、券只抵后续建设支出（先券后钱），config 新增 `facility_prices` 与 `stadium_max_open_tier` 两键（v2.5.0）。
- **冠名市场**：品牌池报价 / 签约 / 退约 + 窗末收租（迁移 0024 `naming_contracts`，费用条款快照列化 + 部分唯一索引拦一队双签），`GET /api/club/naming/quote` 与 `sign` / `terminate`，config 新增 `naming_params`（v2.6.0）。
- **赛果自动化**：cron 自动确认赛果（每轮上限 20 场，actor=0 系统留痕）、通知钩子重放 `POST /api/admin/results/:id/replay-hooks`、人工复核（迁移 0025 给 `result_confirmations` 加 `needs_review` / `review_note`）与 auth 三事件审计，config 新增 `results_auto_confirm`（v2.7.0）。
- **换版机制**：小换版 / 大换版两种模式（CA 换算与成长清零口径），导入预览警告与合同校验（v2.8.0）。
- **性能与守护**：`players` 四条排序表达式索引（迁移 0027）；公开 GET 的进程内限流与 TTL + stale-while-revalidate 缓存（`src/lib/guard.ts`，`PUBLIC_CACHE_TTL_MS`）；e2e 冒烟脚本 `scripts/e2e/smoke.mjs`（8 场景）与 `npm run test:e2e`（v2.8.1）。

### 变更

- `clubs.is_cpu` 列化（迁移 0026，由队名后缀回填），CPU 队不再靠名称判断（v2.8.0）。
- 顶栏响应式重排：桌面单行，窄屏品牌/用户区与导航分两行横滑（v2.3.0）。
- 公开 GET 的缓存与限流都是 isolate 内 `Map`：重启即清、多 isolate 不共享；KV 方案因免费档写配额否决。

### 修复

- 赛果通知钩子重放会重复发通知：重放跳过通知钩子（v2.7.0 收口审查发现）。
- 确认钩子（XP / 通知 / 奖金 / 上座）原先同步执行且裸奔，任一失败会把已入档的确认炸掉并让重试撞 409：改为逐个吞错收集（v2.7.0）。
- 账本幂等闸原按 `(kind, ref_type, ref_id)` 全局查重，多队同窗结算只有第一队落账：改按 `(club_id, kind, ref_type, ref_id)`（v2.6.0 前置修复，生产未触发）。
- 收件篮「标记已读」在 ids 超过 D1 单查询绑定参数上限 100 时报 500：改按 100 分块 `db.batch`（v2.4.0 收口审查发现）。
- 设施升级批次漏了 `build_credit` 的 UPDATE，建设券只进提示不落库（v2.5.0 冒烟发现）。
- 合同导入的 `clubId` 不存在时预览放行、落库才撞外键 500：preview 与 confirm 都改 404（v2.8.0）。
- 换队号 rekey 在换壳模式下 `tour_team_id` 空闲但认证库 `club_id` 已被占，只在执行期才炸：预演加撞号闸（v2.3.0）。
- 缓存键直接用原始查询串导致 `?a=1&b=2` 与 `?b=2&a=1` 重复装载：改为 `canonicalQuery` 归一；缓存条目无上限（键外部可控）会堆内存：加 64 条上限按插入序淘汰（v2.8.1 收口审查发现）。
- 球员库「上一页」用 `fetchPreviousPage` 会与页码错位，改为页码状态 + 缓存回退；无限查询最后一页按钮仍亮（v5 里 `getNextPageParam` 返回 `null` 仍算有下一页）（v2.2.0 收口审查发现）。

### 文档

- `README.md` 重写（原先只有一行标题）：定位、文档索引、技术栈、快速开始、命令表、绑定资源与权限、迁移纪律、测试、目录结构、部署现状（v2.8.2）。
- 新建项目级 `AGENTS.md`（危险操作清单、开发与测试口径、代码与提交规范）与 `CHANGELOG.md`（本文件）、`scripts/README.md`（脚本性质分级 + 生产工件执行状态）（v2.8.2）。
- `TECH_DESIGN.md` 与代码对齐：§13 补 5 个已落地 config 键并修正 2 个「待定」键、§15 假设加分类口径与编号归位、§17.1 补表达式索引规约、§17.3 按 `src/lib/guard.ts` 现状改写并写明「不用 KV 做 SWR」的裁决、§12 与假设 23 记 web 收件篮落地、附录 A 通知行拆分并标注冻结范围（v2.8.2）。
- 删除过期草稿 `handoff-20260916.md`（停在v1.5.0），其中仍有效的三条（球员库逐队源数据位置与字段口径、导入通道选择、`--file` 通道外键陷阱）已迁入 ROADMAP 与 `scripts/README.md`（v2.8.2）。

### 待办

- push 与部署已于 2026-09-20 完成（见本节开头的部署记录）；0027 的 7.3 万行写已随当日 apply 计入。
- 生产回填已于 2026-09-20 执行完毕：16 队队籍（`scripts/prod-20260919-roster-backfill/`，444 人，只写队籍不造合同），复查全库 assigned 551 = 4 支 CPU 队 107 + 本批 444、free 17750。
- `clubs.is_cpu` 四个 CPU 队（id 10 / 241 / 112172 / 131681）回填已于 2026-09-20 部署后核对通过（均 `is_cpu=1`）。
- 遗留：球员库 30 人缺字段补录未执行（源数据缺 `naID`/`FootID`，`scripts/players-import/overlay-missing.ts`）。

## [已上线] · v2.2.0 用户端重构 — Version 6ed7446c（2026-09-19）

- Market 拆为三页：`/market`（挂牌板 + 详情出价，公开）、`/market/free`（海捞签入 + 训练营激活，需登录）、`/market/mine`（我的挂牌 + 我的出价，需登录）。
- 用户端登录守卫 `RequireUser`（软卡不重定向）与 `AuthContext`（`/api/me` 全站单点拉取，顶栏/首页/管理端的 props 钻透退役）。
- 用户端 8 页数据层接入 TanStack Query，写后精确 invalidate。
- 注册合规逐人标红：按球员展开行级红底 + 规则短标签。

## [已上线] · v2.1.0 管理端重构 — Version 4d03eb57（2026-09-19）

- 管理端从单页拆为左侧栏壳 + 8 个子路由（总览/赛季/球员/导入/转会/俱乐部/财政/系统），React.lazy 分包；后端 `admin.ts` 拆为 `routes/admin/` 八域，URL 零变更。
- 新增暂停出价：全局 config 开关 `market_bid_paused` + 单挂牌列（迁移 0021 `listings.bid_paused`），只挡新出价，不改变结算时刻。
- config 超管全开（独立权限点 `club.config.manage.super`，GET 明文 / PUT 逐键编辑 + 审计 `config_set`）、`GET /api/admin/overview`（isolate 60s 缓存 + `?fresh=1`）、`GET /api/admin/audit-log`。
- 统一两段式确认按钮 `ConfirmButton`，批量维护改结构化逐行预览。

## [已上线] · 早期v0.1.0–14（2026-09-12 ~ 2026-09-19）

- v0.1.0 地基：纯 Worker + 共享登录 + schema + SPA 壳。
- v0.2.0 球队与球员主数据（管理端最小集）。
- v0.3.0 阵容注册与合规。
- v0.4.0 转会市场（挂牌竞价链）。
- v0.5.0 签约谈判（signing）。
- v0.6.0 旁路操作 + 激活匹配 + 窗口。
- v0.7.0 财政、赛季与通知（MVP 收口）；6.1 走查修复与球员库（四裁决落地）。
- v1.0.0 球队绑定上收认证中心（auth + tour + club 三仓，`AUTH_DB` 只读接入）。
- v1.1.0 球员库统一 + FC26 ID 对齐。
- v1.2.0 分级派生（报名定级，club 单仓）。
- v1.3.0 异常告警 + 管理介入 + 批量维护。
- v1.4.0 赛季结算域。
- v1.5.0 主场收入域（存量主场数据迁移）。
- v1.6.0 成长域校准（成长期 / 解约清零 / 中国计划闸门）。
- v2.0.0 CPU 队与队籍口径（`clubs.is_cpu` 代码侧与球员库首灌）。

早期各次的部署 Version 记录见 `wrangler deployments list --name whl-club` 与 ROADMAP 对应章节。
