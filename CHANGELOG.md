# 变更记录

本项目按「增量」推进，每次生产部署以 Cloudflare Worker 的 Version id 标记（仓库无 git tag）。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

各增量的裁决、交付清单与验收数字见 [ROADMAP.md](./ROADMAP.md)。

## [未上线] · 增量 33 — 名册真源归位：全平台一线队名册端点 + 赛事平台拉取同步 + 球员写入口下线（2026-09-23）

本仓 1 个提交（`aed2f67`）+ 赛事仓 1 个提交（`ffcbc40`），**未推送未部署**。增量 32 把球衣号编辑入口搬回本平台后，赛事系统的 `player` 表成了第二份真源（两个写者互相覆盖），本增量把名册真源收到本平台并关掉赛事侧的写路径。

**新增**
- 端点 `GET /api/squads`（`src/worker/routes/squads.ts`）：一次 JOIN 出 20 队 570 人的一线队名册，返回 `{ squads: [{ clubId, clubName, players: [{ fcId, name, number }] }] }`。公开只读，`assertPublicRate` + `cachedJson`（roster scope，24h）；姓名走 `sqlDisplayName()`，`ORDER BY c.name, p.fc_id` 后 JS 线性归并，不做 N+1。
- 赛事仓 `worker/lib/clubRoster.ts`：`fetchClubSquads` / `syncRosters`（三方对账，以 fcId 当 `player.id`）/ `runRosterSync`（cron 入口，失败只记日志不抛）。
- 赛事仓端点 `POST /api/admin/sync-rosters`（`?dryRun=1` 只算不写，非 dryRun 写审计）；`wrangler.jsonc` 加 `triggers.crons = ["0 * * * *"]` 与 `vars.CLUB_API_BASE`（撤掉该行 = 同步整体跳过，即回滚开关）。

**变更**
- **赛事系统球员表转为只读镜像**：`POST /:id/players`、`POST /:id/players/bulk`、`PATCH /:id/players/:pid`、`DELETE /:id/players/:pid` 四个端点删除，`TeamDetail.tsx` 的录入 / 批量导入 / 改名 / 删除 UI 换成只读名单表；队级端点（建队 / 批量建队 / 改名 / 删队 / 队徽）保留。
- 赛事仓同步的三条防御：空快照整体跳过；形状坏抛错不写库；只对快照里出现过的队做删除（一次拉取失败不会清空别队名单）。外键拒绝的删除进 `kept` 报告保留（有比赛事件 / 伤停引用的球员不能删）。

**验收**：本仓 typecheck 三份全清、vitest **48 文件 / 661 例全绿**（增量 32 基线 47/659）、build 产物 `index-Bco7kOHW.js` 与增量 32 逐字同 hash（只加后端路由）、e2e **11/11**；赛事仓 typecheck 全清、vitest **15 文件 / 142 例通过 + 1 文件跳过**（基线 14/121）、build 成功。读量实测走 `idx_players_status` 点查（无 `SCAN p`，约 570 行）。变异验证两处定向变红（空快照守卫、未知队过滤）。

## [未上线] · 增量 32 — 球员名口径改造：FC26 派生显示名 + 球衣号归属转移 + 档案页按 fc_id 寻址（2026-09-23）

用户 m01803「开工」，任务 = 球员名口径改造（显示名取自 FC26 存档）+ 球衣号归属从赛事平台转回本平台 + 球员档案页 URL 改 fc_id + 两系统阵容同步 + D1 读额度优化。8 个提交（`c07c18a` / `54a98ef` / `341c7cd` / `e2d81ed` / `097cd34` / `6135bbc` / `770875b` / `0e6a524`），**未推送未部署**，生产迁移仍到 0031。跨仓部分（赛事平台转只读 + 阵容同步）另立增量 33。

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

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **47 文件 / 659 例全绿**（增量 31 基线 46/642）；`npm run build` 成功（`index-Bco7kOHW.js` 477.77 kB / gzip 150.38 kB）；`npm run test:e2e` **11/11 通过**。变异验证四处定向变红（索引表达式错一字符退化 `TEMP B-TREE`、`fc_id` 归属加 `AND 0`、两处 `number = NULL` 删除、链接回落顺序反转）。落库链路本地端到端跑通且幂等（19 条语句，fc 20801 落成 `Cristiano Ronaldo` / `7`）。

## [已上线] · 增量 31 — 球队页：公开列表 + 登录详情 + 自家队中心合并 + 只读媒体路由（2026-09-22）

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
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **46 文件 / 642 例全绿**（增量 30 基线 40/573）；`npm run build` 成功（`web/dist/assets/index-C7pOcE6p.js` 474.57 kB / gzip 149.44 kB、`index-BT5YAIcz.css` 34.57 kB / gzip 7.58 kB）；`npm run test:e2e` **11/11 通过**（三视口；新增球队页两场景，截图落 `scratch/e2e-clubs-*.png` 与 `scratch/e2e-clubs-detail-*.png`）。
- 上线回读（2026-09-22）：`https://club.whleague.win/` 200 且首页资产与本地 build 逐字一致；匿名 `GET /api/clubs/1` → 401（符合裁决 Q1）；`GET /api/clubs` → 200、20 队、`logoKey` 20/20 非空；生产已配 `TOUR_API_BASE="https://whleague.win"`；生产迁移查得「✅ No migrations to apply!」⇒ 已在 0031。
- 读量（生产实测）：`/api/clubs` 聚合 1,032 行（全表 18,301，SQLite 靠 `WHERE club_id IS NOT NULL` 范围扫跳过 17,731 行 NULL）；`GET /api/clubs/:id` 151 行（club 1）/ 165 行（club 9，生产阵容最大 37 人）；`/api/clubs/:id/standing` 11 行；`/api/media/*` **0 行 D1**。验收线为列表 ≤3,000 行、详情 ≤500 行。
- 变异验证多处均能定向变红（教练区块身份判定、`/club` 两个 Navigate 目标、`failed` 分支、`平均成长空间`、积分榜 TTL、CA 条分母、直方图归一、图表溢出）。
- **本机 e2e 对球队页读端点仍是打桩**：本地 TOUR_DB 的 `team` 表 schema 陈旧（无 `logo_key` / `club_id`，只有 4 行）⇒ 那两个端点在 127.0.0.1 必然 500，属环境陈旧而非代码回归；本地库补到与生产同形后可撤桩。
- 详见 `ROADMAP.md` 增量 31 节。

## [已上线] · 增量 30 — 球员面板专项整改：术语三改 + 合同卷宗对齐 + 六维图与 PlayStyles 归位 + 徽章×PlayStyle 合并 + 转会记录页签（2026-09-22，Version d266036d-aa2e-43be-94ac-7f40972df7bb）

用户一次下达六项球员面板整改。前四项是文案与布局，后两项动了数据层：**「徽章」从「只有计数、身份靠管理组在 FC 阵容文件人工落实」改为平台自己记明细**（`player_playstyles`），并补上球员转会记录页签。8 个提交（`f4d4a68` / `e74148f` / `de3c04c` / `60c8dd5` / `1c44506` / `d38b39f` / `6bd9138` / `da7a1f6`），**已推送（`5394268..da7a1f6`）、已部署、生产迁移 `0031` 已 apply**。

**新增**
- `src/core/fc26.ts` 新增 PlayStyle 发放口径：`PS_GRANTABLE_BASE_IDS`（36 项基础 ID：1-8 / 11-16 / 21-26 / 31-35 / 41-45 / 51-56，与 `web/assets/ref/playstyle.json` 银段逐项一致）、`isGrantablePlaystyleId`、`playstyleIdOf(base, kind)`、`playstyleKindOf`、`playstyleSlotRange`（银 1-12 / 金 13-15）、`nextFreePlaystyleSlot`、`playstyleSlotsOf(attrs)`、`mergePlaystyleSlots`、`planPlaystylePicks`（白名单 → 段内重复 → 已拥有 → 银数量 → 金数量 → 落槽，逐层报错）。
- 迁移 `0031_player_playstyles.sql`：明细表 `player_playstyles`（`player_id / slot / kind / psid(基础 ID 1-99) / source(growth|china|manual) / granted_by / created_at`）+ `UNIQUE(player_id,slot)` + `UNIQUE(player_id,kind,psid)` + 段界 CHECK + 索引；末尾把 `config.badge_cap_silver` 由 `15` 改写为 **`12`**。`tests/d1.ts` 的 `MIGRATION_FILES` 已登记。
- 新端点 `POST /api/growth/china-playstyles/:playerId`（本队教练或管理组）：把一直没人读的 `china_badges`（默认 3）落成真发放，名额**一次发满**、`source='china'`，离队即回收。
- 新端点 `GET /api/players/:id/transfers`（公开只读）：只列 `status='completed'` 的单据，LEFT JOIN clubs 出双方队名，按 `completed_at DESC, id DESC` 取最近 50 条。
- 前端：球员详情第 4 页签「**转会记录**」；`web/src/lib/ref.ts` 导出 `TRANSFER_TYPE_LABEL`（从 `web/src/pages/admin/MarketPage.tsx` 抽出共用）；`Player.tsx` 新增 `PlaystylePickGrid` 选择器与中国计划发放块。

**变更**
- **术语三改全系统对齐**（21 文件，纯文案/注释）：「到顶」→「**非成长**」、「经纪人档位」→「**经纪人性格**」、「档案」→「**合同**」（限指代球员合同页签/成长记录的那批）、「效力球队」→「**来源球队**」。**例外保持原貌**：CHANGELOG/ROADMAP 历史条目、`PRD.md:5` 版本行、已 apply 的迁移注释、`scripts/prod-*/README`，以及「主场/球场档案」语义与主题名「复古档案室」、容器名「档案卡 `.dossier`」；摘要条 chip 与球员库表格列名仍叫「经纪人」（沿用增量 27 裁决）。
- 合同卷宗排版：新增 `.dossier-table` 作用域 —— 标签列定宽 6.5em、值列统一左对齐、数值列等宽 `tabular-nums`（此前 `td.mono` 三行与 `td.num` 两行字体与对齐不一致，因为全局 `.mono` 规则根本不存在）。
- 六维雷达从属性页**搬到左栏球员卡下方**（`.dossier-side` 纵列 + `.radar-card`），属性页网格第二行空位放 **PlayStyles 卡**（桌面固定 4 列、`.ps-card` 跨两列、900px 以下两列）。
- **徽章 × PlayStyle 合并**：升级方案带徽章时**必须一并交 `picks`**（数量须与方案一致、白名单内、同段不重复、未被 FC 源同段占用、槽位有空），台账 `badges_silver/badges_gold` 与明细 `player_playstyles` 同批写；徽章上限口径**统一为 12 银 / 3 金**（`badge_cap_silver` 默认 15→12，筛选校验与 admin 校验文案同步改 0-12；**DDL CHECK 仍 0..15、历史台账不 clamp**）。
- 回收与折算：转会成约删 `source='china'` 明细并同步减台账；解约删该球员全部明细；大换版（major）按 kind 保留最早 `ceil(n/3)` 行（`FOLD_PLAYSTYLES_SQL`，`generate-sql.ts` 拼在最后一片末尾）。
- `GET /api/players/:id/growth` 返回 `playstyleDetails` 与 `player.chinaPlaystyles {quota,granted,left}`；属性页 PlayStyles 列表 = FC 源槽 ∪ 明细（按 kind+基础 ID 去重，FC 源优先）。
- 文档口径同步：`TECH_DESIGN.md` 决策表第 10 条把「15 与 12 是两个口径，别混」改写为**已统一**并补发放/回收口径，`player_playstyles` DDL 入 §5 建表清单，§10.2/§10.4 补 picks 与明细折算，config 表 `badge_cap_silver` 改 12，端点表加 2 行；`UI_DESIGN.md` 球员详情行改为四页签 + 左栏雷达卡 + PS 卡嵌网格 + 徽章墙 x/12。

**修复**
- **`src/worker/transfers.ts` 海捞签入误回收中国计划徽章**（评审发现）：china 明细回收原先只 gate 在 `!amendment`，于是**海捞真自由身**（`type='free_agent'` 且 `from_club_id IS NULL`）被当成离队 —— 签入即删掉他的 china 明细并扣台账。改为 `amendment || transfer.from_club_id === null ? 0 : (COUNT…)`（从 CPU 队摘人 `from_club_id` 不为空，照旧回收）。回归测试 `tests/bypass-routes.test.ts` 新增「海捞真自由身是签入不是离队」，变异验证（去掉守卫）可复现两行明细被删。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **40 文件 / 573 例全绿**（增量 29 基线 39/550）；`npm run build` 成功（`web/dist/assets/index-C56W4cF9.js` 457.55 kB / gzip 145.20 kB）。
- 真浏览器复核（本地 8791，球员 9100 / 9001）：合同页签 7 行全左对齐、数值列等宽；属性页网格恰 4 列、第二行 = DEF/PHY + PS 卡（5 银 + 1 金）；左栏雷达卡常驻；升级方案选满 35 个银选项之一后确认 ⇒ `ca 76→78`、明细落 `{slot:2,silver,psid:2,source:'growth'}`（跳过被 FC PSID1 占用的槽 1）；中国计划发 3 个 ⇒ 徽章墙 🥈 4/12、明细 3 行 `source='china'`；转会页签 6 列无横向溢出。
- 变异验证：海捞守卫（去掉 ⇒ 明细被删）、折算 SQL、槽号口径、白名单过滤均能变红。
- **上线核对（2026-09-22T11:42Z，4 次线上只读请求）**：迁移 `0031` apply 报 `Executed 4 commands`；`player_playstyles` 表与索引各 1、当时 0 行；生产 `config` 无 `badge_cap_silver` 行（迁移那条 `UPDATE` 空转，上限由代码默认值 12 生效）；线上 `/players` HTML 引用 `assets/index-C56W4cF9.js`（与本地产物同名）；`GET /api/players/1/transfers` ⇒ `{"transfers":[]}`；`GET /api/players/1/growth` ⇒ 含 `playstyleDetails` 与 `player.chinaPlaystyles = {quota:3,granted:0,left:3}`；`GET /api/players?badges_silver_min=13` ⇒ 400「badges_silver_min 应为 0-12」（上限 12 已上线）。

**待办**
- 记录不改的遗留：台账可能 > 12（历史 cap 15）会显示「🥈 15/12」；徽章墙分母硬编码 12/3；方案卡 disabled 让「先选满再确认」toast 在 UI 上不可达；双击发放撞 UNIQUE 会让第二个请求 500（不写脏数据）；0 徽章方案多传 picks 被静默忽略。
- PlayStyle 图标资产包仍待供给（`assets/icons/playstyles/{id}.webp`，缺图降级 🥇🥈）。
- 生产 `player_playstyles` 上线时 0 行，首次真实发放（升级选徽章方案 / 中国计划）建议人工跟一单核对明细落槽。

## [已上线] · 增量 29 — 球员库 UI 缺陷收口：档案页 15 槽徽章 + 多选面板高度上限 + 表格不折行（2026-09-22，Version 627508e5-f7c6-4e6d-90a2-5f95a82466bb）

增量 28 上线后，用户 m12257 裁决「建索引先搁置（当日写限额不足）、海捞池后续会有新调整、球员库 UI 小瑕疵可以现在修」，本增量只修三处 UI 缺陷，不建索引、不动海捞池契约、不写生产数据。5 个提交已于 2026-09-22 推送（`76aaeb9..91bc2d3`）并部署为 Version `627508e5-f7c6-4e6d-90a2-5f95a82466bb`，部署后线上 `/players` 的 HTML 引用 `index-C_n2o0KE.js` / `index-D-qmdoLZ.css`，与本地 `web/dist/assets/` 同名。本轮**不跑生产 API 回读**（不涉后端，省 D1 读额度）。

**新增**
- `src/core/fc26.ts` 新增 `PS_SLOT_KEYS`：由 `PS_SLOT_COUNT` 派生的 `PSID1 … PSID15` 槽位键表（此前档案页是手抄数组，与槽数常量无关联）。
- `web/src/lib/ref.ts` 新增 `playstyleBadges(attrs)`（返回 `{ psid, slot, gold }[]`，扫全 15 槽、只收正整数槽值、`slot` 1 起）与 `PlaystyleBadgeSlot` 类型。

**变更**
- 球员档案页（`web/src/pages/Player.tsx`）的 PlayStyles 徽章由手抄的 `PSID1-7` + `PSID13-15` 改为**按槽位扫全 15 槽**（银 `PSID1-12` + 金 `PSID13-15`），只渲染有值的槽、不给空槽占位 —— 落在 `PSID8-12` 的银徽章从此可见（增量 27 遗留 ②；生产实测 `PSID8` 有 3 人）。
- 多选下拉面板的高度上限从 CSS 收回到组件：`web/src/components/MultiSelect.tsx` 新增 `PANEL_MAX_PX = 480` / `PANEL_MAX_VH = 0.7`，`place()` 取 `min(可用空间, 480, 0.7 × 视口高)`（不低于兜底 160px）；`web/src/styles.css` 里那条被内联样式顶掉、从未生效的 `.multiselect-panel { max-height: min(70vh, 480px) }` 删除（遗留 ④）。
- 球员库表格单元格**一律不折行**（`.library-main td { white-space: nowrap }`），列宽不够时由外层 `.table-wrap` 横向滚动承担；管理员页表格不受影响（遗留 ⑤）。
- 摘要条「筛选（N）」的计数口径经用户裁决**维持现状**（数 chip 条数，位置选 12 个仍显示 1），文档里「已接受」改写为「已裁决维持现状」（遗留 ③）。
- 文档口径同步：`TECH_DESIGN.md` 徽章决策表把「档案页只渲染 `PSID1-7`+`PSID13-15` ⇒ `PSID8-12` 可筛不可见」整句替换为全 15 槽口径，并点明「槽号是 1 起」与「徽章墙 🥈 x/15 的 15 是 `badge_cap_silver` 台账上限、与 12 个银槽是两个口径，别混」；`UI_DESIGN.md` 补 15 槽渲染（不给空槽占位）、单元格不折行（附实测宽度）与面板上限；`ROADMAP.md` 增量 27 遗留段落逐条改口径。

**修复**
- `web/src/pages/PlayersLibrary.tsx` 的 `psNames` 把 `.map` 的 **0 起下标**当槽号传给 `playstyleIsGold(psid, slot)`（后者语义是 1 起）⇒ 下标 12（= `PSID13` 金槽）走不到金槽分支，银段 ID 落在金槽时列表显示成银、与档案页 🥇 不一致（仅异常数据可见）。改为 `slot + 1`，并把 `psNames` 导出以便单测。
- `tests/core-zero-import.test.ts` 的依赖判据 `/^\s*(import|export\s+.*from)/` 会把 `export const PS_SLOT_KEYS: readonly string[] = Array.from(` 里的 `Array.from` 误判为依赖（`from` 命中），把零依赖模块判红。改为抽出 `hasStaticDependency(line)`：`import` 行首 ∥ `export … from '…'`（带引号）∥ 任意位置的 `import(`/`require(`（抓动态 import），并补判据自测。
- `web/src/lib/api.ts` 之类的既有契约未动；`GET /api/players` 等接口行为与本增量无关（纯前端 + 文档）。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 550 例全绿**（增量 28 基线 39/539 ⇒ 步骤 1 +5、步骤 2 +2、评审修正 +4）；`npm run build` 成功（`web/dist/assets/index-C_n2o0KE.js` 451.12 kB / gzip 143.00 kB + `index-D-qmdoLZ.css` 27.62 kB / gzip 6.36 kB）；本地 8791 + `npm run test:e2e` **9/9 通过**（三视口表格探针：0 个折行单元格、表格最小宽 876px vs 容器 854 / 815 / 290）。
- 三处改动都做过**变异验证**：`flatMap` 改 `slice(0, 7)` ⇒ 2 例红；面板上限改 `Infinity` ⇒ 5 例红；删掉 `white-space: nowrap` ⇒ e2e 报「108 个单元格仍会折行」；`psNames` 改回 0 起下标 ⇒ 1 例红。
- 不跑生产 API 回读（纯前端改动，省 D1 读额度）；部署后只取线上 `/players` HTML 核对 JS hash。

**待办**
- 推送 + 部署 + 线上产物核对（步骤 5）。
- 不在本增量范围（用户已指令搁置或另有安排）：下一批 4 条候选排序索引（`view=initial&sort=ca` / `uid` / `ps` / `name`，写限额不足）、姓名子串 FTS5、`attr:*` 34 键物化子表、海捞池 `LIMIT 300` 无分页无筛选、30 人 `naID`/`FootID` 补录、PlayStyle 图标包待供给。

## [已上线] · 增量 28 — 球员库 D1 读消耗治理：去整表 COUNT + 两级缓存与代际失效 + 6 条索引 + 全站读面普查（2026-09-22，Version 7c5b5879-0003-421c-9bf2-6026a4674afe）

增量 27 收尾时生产 `/api/players*` 全线 500，排查确认是 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起，比部署早约 2 小时）。用户就此立项：「目前球员库相对稳定，现在查找的 D1 读消耗过大！」。先量化再治理——用「真实路由 + 假 D1 抓 SQL」的测量脚本打生产读 `meta.rows_read`，拿到 30 个形状的物理事实，再按写配额（免费档 10 万行/日）排优先级。全部步骤已于 2026-09-22 推送并部署为 Version `7c5b5879-0003-421c-9bf2-6026a4674afe`（步骤 0–5 先上 `91635aca`，步骤 6 再上 `7c5b5879`），部署后 8 请求最小化回读全部符合预期。

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
  - **生产 `/api/players*` 全线 500 的真因**（增量 27 收尾时的悬案）：D1 免费档当日行读配额耗尽，限额按 UTC 零点归零、自动恢复。排查中确立**三个假阳性判据**：`/api/health` 只读 `sqlite_schema`（不计配额）；`wrangler d1 execute --remote` 是管理通道（不受限）；`/api/clubs/directory` 缓存键是固定字符串且 stale 刷新分支吞掉 loader 错误（D1 全挂也回 200）。拿真错误文本的办法：临时给 onError 加 `__diag` 字段 + `wrangler dev --remote`（本地代码 + 生产绑定，不需部署）。
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

## [已上线] · 增量 27 — 球员库左栏 UI 收口：多选下拉替代 chip 墙 + 区间成对 + PlayStyle 银/金分槽（2026-09-21，Version 3455087e-4bdb-4a63-b40f-8df943d80892）

用户对刚上线的增量 26 左栏提了 8 条反馈（同行元素未对齐、表格上方空白过多、查找框灰字过长、位置 16 个 chip 太占地方、同一属性的上下限占两行、「属性键」用英文键、「经纪人」叫法、PlayStyle 与显示列也该是多选下拉），另附带要求**修掉金徽筛选**。本轮只改前端与筛选语义，**不写任何生产数据、不碰缓存与限流数值**；生产读消耗的量化与治理被用户明确挪到下一增量（当日 D1 读额度已超限，见 ROADMAP 增量 27 节的「裁决」与「遗留」）。本增量已于 2026-09-21 推送（`89e039d..30c7cdc`，7 个提交）并部署为 Version `3455087e-4bdb-4a63-b40f-8df943d80892`；部署后生产 `/api/players*` 一律 500，排查确认为 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起全站真实表读失败，比本次部署早约 2 小时；限额按 UTC 零点归零），最小化生产回读顺延到额度归零之后。**回读已于 2026-09-22T00:01:52Z（本地 08:01，归零后 1 分 52 秒）补做**：`/api/health`、`?sort=name`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster` 六个端点全部 200，另用 `?ps=125&limit=3` / `?ps=25&limit=3` 各一次（合计 8 请求）实测银/金分槽语义在生产成立（金值只命中 `PSID13-15`、银值只命中 `PSID1-12`，互不串），cron 自 00:00:34Z 起恢复成功。

- **新增**
  - **`MultiSelect` 多选下拉组件**（`web/src/components/MultiSelect.tsx`）：走原生 **Popover API**（面板进 top layer，不被窄屏抽屉的 `position:fixed + overflow-y:auto` 裁切），自管 open 态（浏览器的 light-dismiss 一勾就关，多选要能连点），三条关闭路（再点触发器 / 点面板外 / Esc——Esc 里 `preventDefault()`，否则一次 Esc 会连抽屉一起关），面板位置按触发器 `getBoundingClientRect()` 现算并随滚动/缩放跟随，**下方不足 220px 就翻到触发器上方贴底**。位置（12 码位）、显示列（18 列）、PlayStyle 三处接入（增量 27）。
  - **属性中文名表成为单一来源**：`web/src/lib/ref.ts` 新增导出 `ATTR_LABELS`（34 项中文名）与 `ATTR_GROUPS`（七组：速度 / 射门 / 传球 / 盘带 / 防守 / 体格 / 门将），球员档案页（原来自写两份、未导出）与筛选面板共用同一份，并有 `ref.test.ts` 断言「与 `ATTR_KEYS` 逐序全等、无重复」。
  - **控件行统一**：`:root` 新增 `--control-h: 34px` 与 `.control-row`（工具条与左栏共用），同行控件底边齐平（增量 27）。
  - **e2e 探针**（`scripts/e2e/smoke.mjs` ⑧）：多选面板几何与命中测试（整块在视口内、`elementFromPoint` 命中面板内部、与触发器不重叠、高度 ≥160）、同行控件底边逐对对齐（并断言量到非空）、翻页条按线上量级文案量页面横向溢出（增量 27）。
- **变更**
  - **区间上下限合并成对**：原先 14 个 `num()` 每个占一行（「CA ≥」「CA ≤」各一行），改为每对一行两列、label 在左、placeholder 标「最低 / 最高」——CA / PA / 成长空间 / 初始 CA / 年龄 / 身价 / 影响力 7 对 + 属性 1 对（选中属性后出现，label 是该属性中文名）+ 合同 3 对（工资 / 解约金 / 效力时长）（增量 27）。
  - **位置**：16 个 chip（四个组 chip + 12 个码位）→ 多选下拉，只放 12 个码位（`POSITION_GROUPS` 随之下线）；点选仍是多选，URL 仍是 `position=CB,ST`（增量 27）。
  - **PlayStyle**：72 个 chip（银金同列、点金徽必然 400）→ 多选下拉，顶层分「银徽章 / 金徽章」两段、段内按 EA 六类（射门 / 传球 / 防守 / 控球 / 体格 / 门将）分组，各 36 项；不带搜索框（增量 27）。
  - **显示列**：`details` + chip 组 → 同一个多选下拉（`恢复自动` 移入面板页脚，仅手动改过时出现）（增量 27）。
  - **摘要条与翻页条合并成一行**（chips 靠左、翻页靠右，都在表格正上方），无筛选时不再渲染「未设筛选条件」占位——原先摘要条是全宽独立一行、分页条居中在表格上方，两者叠加出约 150px 空白（增量 27）。
  - 搜索框占位由 `按姓名找（支持去变音：sesko → Šeško）` 改为 **`查找`**（`aria-label="按姓名找"` 保留，去变音能力不变，只去掉占位里的教学文案）（增量 27）。
  - 筛选面板「属性键」→ **「属性」**，下拉 34 项按七组 `<optgroup>` 分组、选项写中文名（原先 34 个英文键平铺）；「经纪人」→ **「经纪人性格」**（仅筛选面板 label 与档案页的「经纪人性格 🕴」；摘要条 chip 的「经纪人：温和」与表格列名仍叫「经纪人」，用户裁决值此）；（增量 27）。
  - **PlayStyle 命中语义收口**：库里 15 个 PS 槽 = **银槽 1-12 + 金槽 13-15**（金徽落库存「基础 ID + 100」）。改为**银值只比银槽、金值只比金槽**，不再「基础 ID 或 其 +100 命中任一槽」——旧语义下筛银徽章会捞出只挂金徽章的球员（增量 27）。
  - PlayStyle 筛选参数白名单由「1-99」改为 **「银 1-99 ∪ 金 101-199」**（100 是空档）+ 去重 + 上限 100 项（超限 400）；槽位与段位常量（`PS_SLOT_COUNT=15` / `PS_SILVER_SLOT_COUNT=12` / `PS_GOLD_BASE=100` / `isPlaystyleId` / `isGoldPlaystyleId`）全部落到 `src/core/fc26.ts`，前后端与档案页共用，不再各写写死字面量（增量 27）。
- **修复**
  - **点金徽 chip 必然 400**：前端 `filtersToQuery` 序列化 `ps` 时没有任何白名单、后端只收 1-99，而旧面板铺出的金徽 chip 会序列化成 101-156 ⇒ 随本轮语义收口改掉（增量 27）。
  - **多选面板掉出视口**（真浏览器实测）：触发器贴近视口底部时，面板落在 806–966 而视口高 800，掉在视口外、点不到也滚不到 ⇒ 落位改为「下方不足 220px 翻到上方贴底」；同时落位**必须在 `showPopover()` 之后**（之前面板是 `display:none`，`offsetWidth` / `scrollHeight` 量到 0，「面板想要多高」恒为 0，翻转几乎永不触发）（增量 27）。
  - **窄屏勾选框标签被拆成三行**：375px 抽屉里 `.lib-adv-grid .field.check` 被 flex 压到 96px，「仅未来之星」渲染成「仅未 / 来之 / 星」⇒ 加 `white-space: nowrap`，整条换行而不拆字（增量 27）。
  - 两条 e2e 断言被评审指出是空洞的：翻页条原断 `scrollWidth > clientWidth`（CJK 会换行，永不可能失败）、同行判据原按 `top` 归行（`.control-row` 是 `align-items:flex-end`，底边对齐的成对控件顶边本就不同，会被判成不同行而跳过）⇒ 改为「页面级横向溢出」与「纵向相交归行 + 比底边 + 断言量到非空」（增量 27）。
- **待办**
  - **球员库 D1 读消耗的量化与治理**（增量 28）：本增量原计划的第一步是打生产实测，但 2026-09-21 当日 D1 读额度已超限（免费档按 UTC 零点归零），用户裁决整体挪到下一增量 ⇒ 本增量**未做任何读消耗测量，也未改缓存 / 限流 / 查询行为**。
  - **档案页只渲染银槽 `PSID1-7` 与金槽 `PSID13-15`**，而筛选与导入的口径是银槽 1-12 ⇒ 落在 `PSID8-12` 的银徽章「可筛不可见」（既存问题，增量 27 未修；**增量 29 已修**）。
  - 摘要条「筛选（N）」数的是 chip 条数：位置选 12 个仍显示 1（chip 粒度按用户裁决合并，计数口径随之如此，已接受）。
  - 1280 宽下表格里「Baseline Utd」「20.00 m」「2金7银」会折行（列宽所致，非本轮引入）。

## [已上线] · 增量 25–26 — Version b83ec876（2026-09-21）

2026-09-21 推送 39 个提交（`29c8199..d17cbdd`）→ 部署 Worker（增量 26 只改代码与文档、无需迁移；增量 25 的 `0028` 已于同日随合同导入批 apply）。`wrangler deploy` CLI 回显 Current Version ID `81e93c74-228f-4fee-9d87-9fecf602d360`；`wrangler deployments status` 的 100% 流向为 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（同一批、相隔 5 秒，与增量 17–24 的 `90bfd78f` / `c0e0d130` 同形态）。

生产回读：`/api/health` 三资源 ok；`/api/players?limit=1` 200；`/api/players?sort=name` 200（修复前直接 500）；`/api/players?name=sesko` 返回 `B. Šeško`（去变音折叠在线上生效）；`/api/players/roster` 200 / 325262 字节；`ca` / `market_value` / `attr:finishing` / `years` 四个排序键与 `effective_years_min` / `protected` / `attr=finishing&attr_min` 三个筛选查询全 200。

## 增量 26 — 球员库筛选搬进左栏（2026-09-21 上线，见上方部署记录）

- **新增**
  - **姓名去变音搜索**：新增 `src/core/name-fold.ts`，JS 侧 `foldName` 与 SQL 侧 `sqlFold` 用同一张 `FOLD_SPEC` 映射表（两侧规则同源，避免「折了一侧、另一侧没折」的静默漏搜）；球员库 `?name=` 改 `sqlFold('players.name') LIKE ? ESCAPE '\'`，「sesko」能搜到「Šeško」；导入侧 `warnUnfoldable` 对表外字符只警告不挡行，配套硬闸 `unmappedNameChars` 与只读脚本 `scripts/scan-name-chars.mjs`、链深守卫 `scripts/check-name-fold-depth.mjs`（增量 26）。
  - **轻量名册端点** `GET /api/players/roster`：单条 SQL 拼「姓名|俱乐部ID|球员ID」多行文本，5 分钟缓存下限；前端**聚焦搜索框才拉**（从不点搜索框的人不付这个代价），之后本地过滤 + 键盘上下选 + 点条目跳 `/players/:id`（增量 26）。
  - **球员库左栏**：筛选与显示列搬进球员列左侧 sticky 定宽栏（260px），桌面可收起且收起态记 `localStorage`；生效条件摘要条常驻、每条 chip 可单独撤销（增量 26）。
  - **窄屏筛选抽屉**：900px 断点下左栏改为左侧滑出抽屉，遮罩 / × / Esc 三条关闭路、背景锁滚、焦点陷阱与归位（增量 26）。
  - **前端组件测试基建**：devDeps 加 jsdom 与 @testing-library（react / dom / user-event），`vitest.config.ts` 加 react 插件并把 include 扩到 `web/**/*.test.ts(x)`（增量 26）。
- **变更**
  - **排序键 6 → 29 个**（表头每一列都可排）：`SORT_KEY_NAMES` 与 `TEXT_SORT_KEYS` 提到零 import 的 `src/core/players-sort.ts`，前后端共用同一份（原来各写一份字面量）；文本键（`name` / `contract_type` / `source`）走文本游标 `decodeTextCursor`；新增 `attr:<属性键>` 排序键，属性白名单与后端同源（`FC26_GAME_ATTR_COLUMNS` 从 `sprintspeed` 起切，34 项 = 29 外场 + 5 门将）（增量 26）。
  - 球员库排序交互由下拉框改为**点表头**，两态循环（升 → 降 → 升），`sort`/`order` 继续留 URL；默认态不给任何列打 active（服务端默认按 `players.id ASC`，标「UID ↑」是说假话）（增量 26）。
  - `PlayersLibrary.tsx` 853 → 598 行（`a7b92c0` 抽离那一步为 340 行，后续左栏/抽屉/表头排序各步又增回）：筛选控件抽成 `web/src/components/FilterPanel.tsx`（12 props），筛选模型拆到 `web/src/lib/players-library.ts`（Filters / EMPTY_FILTERS / RANGE_URL_KEYS / COL_DEFS / autoColsFor / sortColumnVisible / parseColsParam），行为不变（增量 26）。
  - 顶栏高度不再写死：`web/src/components/TopBar.tsx` 用 ResizeObserver（**`box: 'border-box'`**）实测回写 `--topbar-h`，吸顶元素避让顶栏（用户放大字号后顶栏更高，写死的 54px/102px 会压住侧栏）（增量 26）。
- **修复**
  - **`sqlFold` 的 REPLACE 链撞 D1 表达式树深度上限**：253 项链在真引擎上报 `D1_ERROR: Expression tree is too large (maximum depth 100)`，`?name=` 与 `sort=name` 直接 500（node:sqlite 上限 1000，本地单测测不出）⇒ 折叠表裁到生产实测 87 项，并加 `SQL_FOLD_DEPTH_LIMIT` / `SQL_FOLD_ENTRY_BUDGET` 与守卫脚本（增量 26）。
  - **焦点陷阱漏掉收起 `<details>` 里的元素**：Chrome 对收起 details 内元素不返回 `offsetParent === null`，导致清单末位错位、Tab 逃到 body（375 实测第 25 次）⇒ 显式排除 `details:not([open])` 后代、保留其 summary（增量 26）。
  - **关闭抽屉的焦点归位不能在同帧 focus()**：入口按钮所在工具条此时是 inert，`focus()` 被浏览器静默忽略、activeElement 掉到 body ⇒ 改为置标记、由 effect 在 `drawerOpen` 变 false 后再 focus（增量 26）。
  - 窄屏吸顶规则按类名裸命中抽屉内的筛选行，把「位置」那组 chip 头两行压住 ⇒ 规则改名 `.lib-toolbar` 并限定作用域；抽屉抬头补 sticky（增量 26）。
  - `foldName` 删掉 NFD 与整段 `toLowerCase`（只做查表替换 + ASCII 小写），`unmappedNameChars` 加形状变体判据 `FOLD_SHAPED`（弯引号/花式空格/不可见字符原先被跳过、永不报警）（增量 26）。
  - `attrSortExpr` 加 `+ 0`、`growth_gap` 两侧 COALESCE（属性值混字符串会让游标 NaN 或比较恒假）（增量 26）。
  - 锁滚在 Windows 经典滚动条下整页横跳 16px ⇒ `html, body { scrollbar-gutter: stable }`（增量 26）。
- **待办**
  - ~~本轮只改代码与文档，未 push 未部署~~ → **2026-09-21 已随 Version `b83ec876` 推送并部署**（`29c8199..d17cbdd`，39 个提交）；增量 25 的 worker 也一并上线。
  - 窄屏抽屉锁滚靠 `body { overflow: hidden }`，iOS 上不彻底（已加 `overscroll-behavior: contain` 兜底，真机未验）。

## 增量 25 — 合同期与财政节点改窗刻度（2026-09-21 上线，见上方部署记录）

- **新增**
  - **合同期改窗刻度**（迁移 0028）：`contracts` 加 `service_ticks`（签约基数 = 签约时点已关常规窗数）/`protection_ticks`（保护期结束的绝对窗数）/`signed_season`+`signed_window_seq`（展示），`season_windows` 加 `is_temporary`；效力 = 0.5 × 已关常规窗数（1 常规窗 = 半赛季），保护期 = 签约后 3 个常规窗，解约免费门槛 = 6 个常规窗（3 赛季）；纯函数在 `src/core/bypass-rules.ts`，计数助手 `src/worker/contract-ticks.ts`（增量 25）。
  - **窗分型**：开窗 `POST /api/admin/windows/open` body 加 `temporary`；同赛季常规窗上限 2（季初 + 中期，第 3 个非临时窗硬拦 409）；季初/中期不落库，按同赛季非临时窗顺序派生（增量 25）。
  - **忠诚奖金改发放点**：从赛季结算按钮移到**赛季中期窗关窗**时发（`kind='loyalty' ref_type='window' ref_id=season*100+windowSeq` 幂等，逐队合并一条流水），关窗响应回显 `loyalty`（增量 25）。
  - **导入历史合同**：按 `effective_from` 反查签约基数并落保护期刻度（训练营无保护期），`service_ticks`/`protection_ticks` 随之 upsert（增量 25）。
- **变更**
  - 关窗扣款顺序改 **富人税 → 工资**，富人税税基含未扣工资（`资金` 与 `ΣRC+资金` 取多，不再减本窗工资）；临时窗只扣富人税 + 维护费（不扣工资、不收冠名租金也不递减剩余窗数），死忠演化每种窗照做（增量 25）。
  - 续约/匹配把保护期收口到审核通过当下：`protection_ticks` 置为当前已关常规窗数（判定恒不成立），`service_ticks` 效力基数不动（增量 25）。
  - 球员库/球员详情/球队页的效力与保护期按赛季展示（`serviceSeasons`/`protected`），筛选 `effective_years_*`、`protected=in|out` 改窗刻度 SQL；管理端开窗表单加「临时窗」复选框、窗列表加窗类型列（增量 25）。
  - `contracts.protected_until`（旧口径 signed_at + 548 天）保留留档，判定不再读；`loyalty_tiers` 档位单位由「年」改「赛季」（数值不变）（增量 25）。
- **修复**
  - 球员库效力筛选原会把无合同的球员按基数 0 当满效力：加 `ct.player_id IS NOT NULL` 闸（增量 25）。
  - 空数组求和得到 `-0` 会让关窗响应与断言别扭：`PayrollSummary` 汇总归一为 `0`（增量 25）。
- **待办**
  - 迁移 0028 **已于 2026-09-21 随合同导入批 apply 到生产**（生产迁移现到 0028）；~~worker 仍未部署~~ → **2026-09-21 已随 Version `b83ec876` 部署上线**（网页面板建合同不再落 DDL 默认刻度）。
  - 0028 是纯加列迁移（5 条 `ALTER TABLE ADD COLUMN`，无数据回填——apply 时生产 `contracts` 与 `season_windows` 分别为 0 / 1 行），比 0027 的 7.3 万行写轻得多。

## [已上线] · 增量 17–24 — Version 90bfd78f（2026-09-20）

2026-09-20 推送 50 个提交（`9f05116..fe60273`）→ 生产迁移 apply 0022–0027（生产迁移现到 0027）→ 部署 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`。生产回读：`/api/health` 三资源 ok；0026 的 CPU 回填核对通过（id 10 / 241 / 112172 / 131681 均 `is_cpu=1`）；增量 17–23 新增路由在生产返回 401（未登录）而非 404。

### 新增

- **球员库**：接口补 `total` 与整套筛选域（身价/声望/成长空间/初始 CA/惯用脚/成长档位/未来之星/中国计划/经纪人档位/PlayStyle 多选/位置四槽多选/细分属性区间/合同域）；页面改版为 SoFIFA 式可变列 + 更多筛选折叠面板 + URL query 持久化（增量 17）。
- **俱乐部目录工具**：新建俱乐部必填游戏队号（赛事库校验 + 队名预填 + 指定 id 建行 + 认证目录 upsert，失败可重试）；`GET /api/clubs/directory`；管理端多教练绑定逐个解绑；换队号 rekey 只读预演工具 `scripts/rekey-team/`（增量 17）。
- **站内信收件篮**：`GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`，未读判定用独立列 `read_at`（迁移 0022），赛果确认与升级两处写入点内部改双通道（每个绑定账号一条 web 行进收件篮，绑了 QQ 的另加一条 qq 投递行）（增量 18）。
- **设施经营**：球场扩建、档位升级、子设施升级与建设券（迁移 0023 给 `stadiums` 加 `build_credit` 列），用户端 `GET /api/club/stadium/build-info` 与 `expand` / `upgrade` / `facilities/upgrade`，管理端 `GET|POST /api/admin/clubs/:id/stadium`；建设支出按 25% 返券、券只抵后续建设支出（先券后钱），config 新增 `facility_prices` 与 `stadium_max_open_tier` 两键（增量 19）。
- **冠名市场**：品牌池报价 / 签约 / 退约 + 窗末收租（迁移 0024 `naming_contracts`，费用条款快照列化 + 部分唯一索引拦一队双签），`GET /api/club/naming/quote` 与 `sign` / `terminate`，config 新增 `naming_params`（增量 20）。
- **赛果自动化**：cron 自动确认赛果（每轮上限 20 场，actor=0 系统留痕）、通知钩子重放 `POST /api/admin/results/:id/replay-hooks`、人工复核（迁移 0025 给 `result_confirmations` 加 `needs_review` / `review_note`）与 auth 三事件审计，config 新增 `results_auto_confirm`（增量 21）。
- **换版机制**：小换版 / 大换版两种模式（CA 换算与成长清零口径），导入预览警告与合同校验（增量 22）。
- **性能与守护**：`players` 四条排序表达式索引（迁移 0027）；公开 GET 的进程内限流与 TTL + stale-while-revalidate 缓存（`src/lib/guard.ts`，`PUBLIC_CACHE_TTL_MS`）；e2e 冒烟脚本 `scripts/e2e/smoke.mjs`（8 场景）与 `npm run test:e2e`（增量 23）。

### 变更

- `clubs.is_cpu` 列化（迁移 0026，由队名后缀回填），CPU 队不再靠名称判断（增量 22）。
- 顶栏响应式重排：桌面单行，窄屏品牌/用户区与导航分两行横滑（增量 17）。
- 公开 GET 的缓存与限流都是 isolate 内 `Map`：重启即清、多 isolate 不共享；KV 方案因免费档写配额否决。

### 修复

- 赛果通知钩子重放会重复发通知：重放跳过通知钩子（增量 21 收口审查发现）。
- 确认钩子（XP / 通知 / 奖金 / 上座）原先同步执行且裸奔，任一失败会把已入档的确认炸掉并让重试撞 409：改为逐个吞错收集（增量 21）。
- 账本幂等闸原按 `(kind, ref_type, ref_id)` 全局查重，多队同窗结算只有第一队落账：改按 `(club_id, kind, ref_type, ref_id)`（增量 20 前置修复，生产未触发）。
- 收件篮「标记已读」在 ids 超过 D1 单查询绑定参数上限 100 时报 500：改按 100 分块 `db.batch`（增量 18 收口审查发现）。
- 设施升级批次漏了 `build_credit` 的 UPDATE，建设券只进提示不落库（增量 19 冒烟发现）。
- 合同导入的 `clubId` 不存在时预览放行、落库才撞外键 500：preview 与 confirm 都改 404（增量 22）。
- 换队号 rekey 在换壳模式下 `tour_team_id` 空闲但认证库 `club_id` 已被占，只在执行期才炸：预演加撞号闸（增量 17）。
- 缓存键直接用原始查询串导致 `?a=1&b=2` 与 `?b=2&a=1` 重复装载：改为 `canonicalQuery` 归一；缓存条目无上限（键外部可控）会堆内存：加 64 条上限按插入序淘汰（增量 23 收口审查发现）。
- 球员库「上一页」用 `fetchPreviousPage` 会与页码错位，改为页码状态 + 缓存回退；无限查询最后一页按钮仍亮（v5 里 `getNextPageParam` 返回 `null` 仍算有下一页）（增量 16 收口审查发现）。

### 文档

- `README.md` 重写（原先只有一行标题）：定位、文档索引、技术栈、快速开始、命令表、绑定资源与权限、迁移纪律、测试、目录结构、部署现状（增量 24）。
- 新建项目级 `AGENTS.md`（危险操作清单、开发与测试口径、代码与提交规范）与 `CHANGELOG.md`（本文件）、`scripts/README.md`（脚本性质分级 + 生产工件执行状态）（增量 24）。
- `TECH_DESIGN.md` 与代码对齐：§13 补 5 个已落地 config 键并修正 2 个「待定」键、§15 假设加分类口径与编号归位、§17.1 补表达式索引规约、§17.3 按 `src/lib/guard.ts` 现状改写并写明「不用 KV 做 SWR」的裁决、§12 与假设 23 记 web 收件篮落地、附录 A 通知行拆分并标注冻结范围（增量 24）。
- 删除过期草稿 `handoff-20260916.md`（停在增量 12），其中仍有效的三条（球员库逐队源数据位置与字段口径、导入通道选择、`--file` 通道外键陷阱）已迁入 ROADMAP 与 `scripts/README.md`（增量 24）。

### 待办

- push 与部署已于 2026-09-20 完成（见本节开头的部署记录）；0027 的 7.3 万行写已随当日 apply 计入。
- 生产回填已于 2026-09-20 执行完毕：16 队队籍（`scripts/prod-20260919-roster-backfill/`，444 人，只写队籍不造合同），复查全库 assigned 551 = 4 支 CPU 队 107 + 本批 444、free 17750。
- `clubs.is_cpu` 四个 CPU 队（id 10 / 241 / 112172 / 131681）回填已于 2026-09-20 部署后核对通过（均 `is_cpu=1`）。
- 遗留：球员库 30 人缺字段补录未执行（源数据缺 `naID`/`FootID`，`scripts/players-import/overlay-missing.ts`）。

## [已上线] · 增量 16 用户端重构 — Version 6ed7446c（2026-09-19）

- Market 拆为三页：`/market`（挂牌板 + 详情出价，公开）、`/market/free`（海捞签入 + 训练营激活，需登录）、`/market/mine`（我的挂牌 + 我的出价，需登录）。
- 用户端登录守卫 `RequireUser`（软卡不重定向）与 `AuthContext`（`/api/me` 全站单点拉取，顶栏/首页/管理端的 props 钻透退役）。
- 用户端 8 页数据层接入 TanStack Query，写后精确 invalidate。
- 注册合规逐人标红：按球员展开行级红底 + 规则短标签。

## [已上线] · 增量 15 管理端重构 — Version 4d03eb57（2026-09-19）

- 管理端从单页拆为左侧栏壳 + 8 个子路由（总览/赛季/球员/导入/转会/俱乐部/财政/系统），React.lazy 分包；后端 `admin.ts` 拆为 `routes/admin/` 八域，URL 零变更。
- 新增暂停出价：全局 config 开关 `market_bid_paused` + 单挂牌列（迁移 0021 `listings.bid_paused`），只挡新出价，不改变结算时刻。
- config 超管全开（独立权限点 `club.config.manage.super`，GET 明文 / PUT 逐键编辑 + 审计 `config_set`）、`GET /api/admin/overview`（isolate 60s 缓存 + `?fresh=1`）、`GET /api/admin/audit-log`。
- 统一两段式确认按钮 `ConfirmButton`，批量维护改结构化逐行预览。

## [已上线] · 早期增量 0–14（2026-09-12 ~ 2026-09-19）

- 增量 0 地基：纯 Worker + 共享登录 + schema + SPA 壳。
- 增量 1 球队与球员主数据（管理端最小集）。
- 增量 2 阵容注册与合规。
- 增量 3 转会市场（挂牌竞价链）。
- 增量 4 签约谈判（signing）。
- 增量 5 旁路操作 + 激活匹配 + 窗口。
- 增量 6 财政、赛季与通知（MVP 收口）；6.1 走查修复与球员库（四裁决落地）。
- 增量 7 球队绑定上收认证中心（auth + tour + club 三仓，`AUTH_DB` 只读接入）。
- 增量 8 球员库统一 + FC26 ID 对齐。
- 增量 9 分级派生（报名定级，club 单仓）。
- 增量 10 异常告警 + 管理介入 + 批量维护。
- 增量 11 赛季结算域。
- 增量 12 主场收入域（存量主场数据迁移）。
- 增量 13 成长域校准（成长期 / 解约清零 / 中国计划闸门）。
- 增量 14 CPU 队与队籍口径（`clubs.is_cpu` 代码侧与球员库首灌）。

早期各次的部署 Version 记录见 `wrangler deployments list --name whl-club` 与 ROADMAP 对应章节。
