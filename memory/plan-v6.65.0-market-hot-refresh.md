# 计划 · v6.65.0 转会区提速 + 热刷新按钮

- 日期：2026-10-31
- 状态：已 grilling 定稿（当日六问全裁决，见文末），待开工
- 分支：`feat/v6.65.0-market-hot-refresh`（从 `origin/main` 切，不携带另一会话未推送的 v6.64.4 `f0384da`）
- 优先级：P0 = 热刷新按钮（用户点名）；P1 = 读路径提速

## 目标

转会区（`/market` 卡柜）打开慢：① 加一个手动「热刷新」按钮，点了立刻拿到最新挂牌与出价；② 压掉读路径里可省的 D1 往返与阻塞段，让首载与刷新本身变快。

## 基线测量与根因确认（2026-10-31 步骤 0 实测）

- 生产 TTFB×5：`/api/market/listings` **12.1–15.7s**；`/api/clubs`（24h 缓存）0.92–1.10s；`/api/health` 1.25–1.96s；404 无 DB 请求 1.02–1.91s ⇒ 网络+Worker 基线 ~1–2s，**服务端 D1 工作占 ~10–14s**。
- 合并窗反证：并发 3 连发后 3 秒内紧接一发仍 12.8s ⇒ 30s 合并窗跨 isolate 无效，**每个请求都全量跑结算**。
- **真凶（根因坐实）**：`runSettleOverdue` 的 active 挂牌循环（market-settle.ts:472-535）对每张在售单**串行**跑一条 `UPDATE listings SET deadline_note`（未到期单子全走这条，多数是空转写）。生产现状 bidding 18 + listed 17 = **35 张** ⇒ 35 个串行往返 × ~350ms ≈ 12s，与实测精确吻合。它拖慢的不止转会区读端点——出价 POST（market.ts:962 无 coalesce）每次也先吃这 12s。
- 次要确认：`expireStaleOffers` 生产候选仅 1 行（pending/intent），不是大头；D1 主库 APAC（KIX），Worker↔D1 每往返 ~350–450ms（由 12s÷~30 趟反推）。
- 复测口径：P1 完成后**须待部署授权后**才能同口径复测（本地测不出生产 RTT）。

## 诊断（代码层，先行核实）

1. **板子端点零缓存、串行 7–9 个 D1 往返**。`GET /api/market/listings`（`src/worker/routes/market.ts:99-216`）完全不走 `cachedJson`，每次请求：
   - `await settleOverdue(...)`（market.ts:103）先阻塞——30s 合并窗（`market-settle.ts:364-382`）只对同一 isolate 生效，低流量下 isolate 频繁更替 ⇒ 常走全量结算（config 装配 + `expireStaleOffers` + 三扫批 + 有到期时的收口批）；
   - 主查询 1 条（market.ts:124-136，CASE 排序物化，现网非终态挂牌仅 24 条，2026-10-30 实测）；
   - 出价聚合 2 条（market.ts:146-159，按 90 分片，一页 50 只 1 片 = 2 条串行）；
   - `loadMarketContext` 11 条 config 单键 SELECT（`market-context.ts:26-38`；`config.ts:422-435` 进程内 TTL 60s，冷 isolate 全冷）。结算内部还会再装配一次同样的 ctx。
2. **详情端点同款**：`GET /api/market/listings/:id`（market.ts:839）也 `await settleOverdue`。
3. **写路径各自同步跑全量结算**：挂牌 POST（market.ts:233，origin user）、出价 POST（market.ts:962，无 coalesceMs ⇒ 每次全量）、报价写端点（offers.ts:247/271/292/304/316）——读端点上的结算只是「显示层及时性」，挪出响应关键路径不伤写正确性：用户从旧板子发起任何操作，写路径会重新结算再校验。
4. **前端无手动刷新入口**：`MarketBoardPage.tsx` 挂载并发 5 个 query（`['me','club']`、`['market','my-bids']`、`['market','board',status]`、`['clubs','list']`、`['club','balance']`），全局 staleTime 30s（`main.tsx:17-25`）、`refetchOnWindowFocus` 关死；30s 内进页零请求（快），超 30s 或首载必等全链路；唯一刷新触发是出价成功后的 invalidate（MarketBoardPage.tsx:105-108）。板子已是 `keepPreviousData`（queries.ts:212-218）⇒ 刷新期间旧卡保留不闪空。
5. **历史读量基线**：listings 11 行 / 17 语句（`scripts/d1-read-audit/README.md:343`，2026-09-22 实测）——读配额无压力，**问题是延迟不是行数**。
6. 另有网络 RTT（国内 → CF 边缘 + D1 主库跨区）代码改不了；本计划只压「服务端可省段」并靠热刷新改善感知。

## 交付物

### P0 · 热刷新按钮（主交付）
- `MarketBoardPage.tsx` 转会区标题行（`<h3>转会区</h3>` 同行，flex 布局）加「↻ 刷新」按钮（`btn btn-ghost`，复用 `admin/TierPage.tsx:304-306` 模式）：
  - onClick = `boardQuery.refetch()` + `refreshMine()`（我的出价）+ 教练态顺带 invalidate `['club','balance']`；
  - `boardQuery.isFetching` 时禁用、文案「刷新中…」；
  - 按钮旁小字「更新于 HH:MM:SS」（`boardQuery.dataUpdatedAt`）。
- 服务端 listings 本就零缓存 ⇒ 前端 refetch 即真·热刷新，**无需任何后端旁路参数**。

### P1 · 读路径提速（2026-10-31 按根因修订；往返 ~40 → 2–3，读端点目标 TTFB 12–16s → 2–3s）
1. **（真凶修复）`deadline_note` 批量化**（market-settle.ts:460-535）：active SELECT 补 `deadline_note` 列，JS 里算好 note 与现值比对，**只把变更行**收进一次 `db.batch`——常态（note 未变）0 次写、有变 1 趟往返，替换掉逐行 35 连发。settle 语义不变（note 文本口径、`status IN ('listed','bidding')` 写闸原样保留在批内每条语句）。
2. `loadMarketContext`（market-context.ts）：11 条 config 单键 SELECT 合并成 1 条 `key IN (…)`，`CONFIG_DEFAULTS` 回落与解析逻辑不变；受益所有市场读写端点。
3. listings handler：出价聚合**折进主查询**（LEFT JOIN 分组子查询 + `MAX(CASE WHEN status='active' …)` 取领先方，JOIN clubs 保留；bids 全表 83 行，物化无压力），ctx 与主查询 `Promise.all` 并行 ⇒ 响应路径 1–2 趟往返。
4. 读端点结算挪 `waitUntil`：market.ts:103 与 :839 两处 `lazy_settle` 改 `waitUntilOf(c)`（guard.ts:259 现成先例，测试无 executionCtx 时退化就地 await，行为与现状一致）；`.catch` 兜底。**挂牌/出价/报价写端点保持 await 不动**（修了第 1 条后它们也从 12s 降到 ~2s）。
   - **语义取舍（已裁决接受）**：读侧显示允许「一个刷新周期」的结算延迟；卡片倒计时按落库 `deadline_at` 前端自算，不受影响。
5. （**已裁决要做**）首载骨架卡替代「正在翻卡柜…」一行字——纯感知提速。
5. （可选顺手项，默认不做）offers 读端点两处（offers.ts:61 列表 / :166 详情）同款挪 waitUntil——同样一行改法，留给用户点名，避免扩大本轮面。

## 步骤

0. **基线测量**：生产 curl TTFB×5 对比三端点（`/api/market/listings?status=active`、`/api/clubs`（24h 缓存）、`/api/health`），拆「网络 RTT vs 服务端耗时」占比；P1 完成后同口径复测，数字写进验收。
1. qa-test-planner 出 `docs/test-plans/v6.65.0-market-hot-refresh.md`（TC 编号 + 前置/步骤/预期/优先级 + 回归套件）。
2. P0 前端 + CSS（标题行 flex）。
3. P1 后端（market-context.ts + market.ts 两处）。
4. `npm run typecheck` 三份 + `npm test` 全绿；变异验证两处恰红：ctx 合并拆回 11 单键、聚合拆回两条。
5. 版本号 bump + ROADMAP.md / CHANGELOG.md；code-review-skill 审查。
6. push / 部署本轮不做；docs: 枚照例只本地 commit，攒到下次授权随代码走。

## 验收口径

- 按钮行为逐条过测试计划：存在可点、刷新期禁用 + 文案、旧卡不闪空、更新时间刷新后变化、非教练不触发余额失效。
- P1 复测：同口径 TTFB 对比有可量改善（至少压掉冷 isolate 的结算阻塞段）；listings 响应字段逐格不变（纯执行计划改动）。
- 回归：market 相关 vitest 套件（market-routes / market-rounds / market-intel / market-activatable / market-listing-order 等）全绿。

## 风险与边界

- **多会话共仓**（2026-10-31 现状）：另一会话在同一工作区开发 v6.64.x，HEAD 上有未推送的 `f0384da`，工作区有未提交改动（`src/lib/oidc.ts`、`tests/oidc.test.ts`、`GLOSSARY.md` 等）——本增量从 `origin/main` 切独立分支，不碰上述文件，每次 commit 前 `git branch --show-current` 核对（v6.62.0 发布轮教训）。
- **waitUntil 语义**：读侧显示允许一个刷新周期的结算延迟（已列取舍）；若 grilling 后用户不接受，退回「只做 P0 + ctx 合并 + 聚合合一」，仍砍掉大半往返。
- **明确不做**：listings 加边缘缓存（实时竞价语义，风险大收益存疑，后续单议）、5 个挂载请求合并、网络 RTT 本身、offers 读端点（除非点名）。
- 改动面预计 4 文件：`market-context.ts`、`market.ts`、`MarketBoardPage.tsx`、（CSS/样式文件），零迁移、零生产写。

## grilling 裁决（2026-10-31，六问全收敛）

1. **waitUntil 取舍：接受**——读侧显示允许「一个刷新周期的结算延迟」（刚过期的单子状态标签旧一拍、刷新一次即正），换掉冷 isolate 上最大的阻塞段。
2. **热刷新范围：三样一起刷**——板子 + 我的出价 + （教练态）可支配余额。
3. **不加自动轮询**，只做手动按钮（将来要加是十行的事）。
4. **骨架卡：做**；**offers 读端点同款：不做**（留下次点名）。
5. **版本号合一个 v6.65.0**（按钮 feat + 提速 perf 同轮）。
6. **基线测量保留**（步骤 0），P1 后同口径复测给数字；若实测服务端占比过小（大头是网络 RTT），P1 预期收益按实数重估后再收口。
