# 球员对比 · 设计定稿（2026-10-05）

状态：**定稿（visual companion 五类屏迭代收敛）**，实现等令。视觉参数与界面文案以 brainstorm session `43039-1791178761` 的终稿屏为准：`compare-desktop-v4.html`（A＋E＋F 结合态）、`compare-winmark-v2.html`（胜负标记四小样）、`compare-3p-mobile-v4.html`（第 2 屏·桌面 3 人＋移动端，第 5 版）、`compare-entry-v3.html`（第 3 屏·库勾选＋详情页入口）、`compare-states-v2.html`（第 4 屏·状态全谱＋窄屏）。**本 spec 的界面文案均为口径性描述，实现轮直接抄终稿屏。**

> **时点说明**：spec 落盘时（2026-10-05）package.json 6.33.0 在途，HEAD `56f2462`（并行会话在推）。本文行号经当日复核（`web/src/pages/Player.tsx`、`web/src/pages/PlayersLibrary.tsx`、`src/worker/routes/players.ts`、`web/src/lib/ref.ts`、`web/src/lib/queries.ts`、`web/src/App.tsx`），实现轮开工时必须以当时 HEAD 复核一遍再动手。版本号不预设（见 §14）。

## 0. 裁决链（用户指令留痕）

1. 功能从零立项（全仓零「球员对比」先例），走 brainstorming（visual companion 过屏），实现等批准。
2. 内容＝**纯能力**（雷达 / 34 属性 / 体型·位置·花式·逆足·惯用脚 / 角色 / PlayStyles·徽章 / 影响力）；成长与经济不算。用户先答「全维度」，随后主动要求重选改判为纯能力。
3. 人数 2–3（上限 3）：2 人＝双色叠图雷达＋左右热区图；3 人＝三张并排小雷达（同刻度、单人单色、图下不挂文字、不出热区图）。
4. 门将口径三转：禁混比 → 混比统一外场轴 → **定稿：混比（门将＋外场任意组合）全员统一外场六维、单张叠图；纯门将（2 或 3 人全部门将）用门将六轴**。
5. 入口三件全量：独立对比页 ＋ 详情页「对比」入口 ＋ 球员库勾选。
6. **URL 即事实源**：`/players/compare?ids=…` 必须含全部参与球员的 id（fc_id），改 id 即改对比球员。
7. 桌面骨架 **A＋E＋F**（A 单列纵向 ＋ E 宽屏双栏 ＋ F 吸顶雷达条）。v2 屏量化 A 单栏 ≈2.6 屏（属性表占 ~1.7 屏）后用户批准组合，组合后 2 人 ≈1.8 屏。
8. 胜负标记：甲（败方灰）乙（胜方加粗）对照 → 定**乙＝胜方加粗、数字保留球员本命色**；日间模式（奶油纸浅色）复核后维持乙；**等值两侧都加粗**（粗体语义＝至少不落下风）；值列定宽防偏移。
9. 第 2 屏连续修订（均已落屏）：身高/体重/逆足/花式拆行；六维图下文字去掉；球员卡与吸顶条补 CA/PA；对比区补位置/角色/PlayStyles/徽章；两人态六维图左右放位置热区图（三人不出、手机不出）；组头去「组均」二字；数字与分隔符纵向对齐（含定宽重定）；第一位置 chip 拉长条修复（类名冲突）；吸顶长名两行（姓名一行、CA/PA 一行）；身高/体重/逆足/花式也标胜负；第三人色**深紫 #6d4aa8**；两人数值间距收紧；杂项区惯用脚提到最前、**国际声望换球员影响力字段（不是只改名）**并标优胜；杂项区解释文字去掉；手机端角色按球员仍两列、同一球员 chips 逐行；PlayStyles→「**徽章**」、徽章→「**徽章数**」（金在前）且列定宽；「档案与球风」→「**杂项**」。
10. 第 3 屏：详情页入口定 **B（球员卡内 CA/PA 数字行下方）**；库勾选**跨筛选/排序/翻页保留**。
11. 第 4 屏：超过 3 人＝**按 URL 顺序取前 3**＋提示；单人拉取失败＝**留可重试槽位**（重试只重拉失败者）。
12. 会话卫生（非功能）：ACP 折叠一律带 `stripImages`，旧截图字节真释放；能文本级验证就不截图。

## 1. 入口与 URL

- 三个入口：
  1. **独立对比页** `/players/compare?ids=<fc_id>,<fc_id>[,<fc_id>]`——公开路由（不要求登录），可直接分享/手改；
  2. **详情页「对比」入口**（入口 B）：`web/src/pages/Player.tsx` 球员卡内 CA/PA 数字行下方（`.player-card-numbers` 之后）加按钮，点击跳 `/players/compare?ids=<本球员 fcId>`，落在 1 人态（不重定向）；
  3. **球员库勾选**：表格勾选列 ＋ 吸底收集栏（详见 §9）。
- URL 规则：`ids` 为**逗号分隔的 fc_id 列表**（球员 URL 一律 fc_id 寻址，与详情页 `playerPath` 口径一致）。解析与降级链见 §8；**任何情况都不自动改写 URL**（多余 id 不删、非法 id 不清洗）。
- 路由落点：`web/src/App.tsx` 新增 `/players/compare`（建议写在 `/players/:id` 之前；React Router v6 静态段优先于动态段，调序非必需但更稳）。现有 `/players`（`web/src/App.tsx:100`）、`/players/:id`（:101）均公开（无 RequireUser），全表无 catch-all。
- 「编辑名单」按钮（对比页顶栏）→ 跳 `/players?compare=<ids>` 带名单打开球员库，库页按该参数预置勾选与收集栏。

## 2. 页面结构（A＋E＋F）

桌面（≥1100px）自上而下：

1. **顶栏**：页名「球员对比」＋ URL chip（显示当前 `/players/compare?ids=…`）＋「编辑名单」按钮。
2. **身份卡 ×2/×3**：色点＋姓名＋主位置 chip（深底）＋副位 chips＋CA/PA 右挂（字母 CA/PA 小字）＋体型行（俱乐部 · 身高/体重 · 惯用脚 · 逆足 · 花式）＋角色 chips。
3. **雷达区**：2 人＝左热区图 ｜ 双色叠图大雷达 ｜ 右热区图（三栏）；3 人＝三张并排小雷达（不出热区图）。雷达下方图例（色点＋姓名；3 人态靠卡面/图例色点对号，图下不挂文字）。
4. **吸顶雷达条 F**：桌高 44–56px；雷达底部滚出视口时吸附，页尾消失；内容＝迷你六边形雷达＋**姓名一行 · CA/PA 一行**（长名两行也能放下）；3 人＝三枚迷你六边形点＋姓名。
5. **属性表 E 双栏**：左 PAC/SHO/PAS（14 项属性）、右 DRI/DEF/PHY（15 项属性）＋ GKP 组（5 项，右栏末）；组头随列走。组头行只留组名（无「组均」字样）。
6. **杂项区**、**位置·角色·徽章·徽章数 四行**（§6/§7）。

页高实测（1080p、视口高 900px，2 人）：≈1.8 屏 ＝ 顶栏＋身份 ≈0.25 ＋ 雷达 ≈0.42 ＋ 属性表双栏 ≈0.75 ＋ 杂项与四行 ≈0.31；E 关（单栏）≈2.5 屏。F 不改页高。

断点：≥1100px 全开（上表基准）；约 1000–1100px 仍双栏（E 折点实现取 ~1000px 校准）；≤840px 回落单栏、吸顶条压 ~32px；窄屏（手机）形态另见 §10（站点既有窄屏口径 ≤760px，实现轮与 `Player.tsx` 的 `PLAYER_CARDS_QUERY` 对齐校准）。

## 3. 数据来源与后端增量

- **请求**：并发 2–3 次 `GET /api/players/:id`（2 人 2 次、3 人 3 次），fc_id 寻址。零新端点。
- **缓存**：复用详情页现有键 `['player', id]`（现状 `Player.tsx:206-210` inline 定义）——**收进 `web/src/lib/queries.ts` 的 `qk`**（详情页与对比页共用同一键，跨页零重复请求）。
- 字段来源（`GET /api/players/:id` 响应，`players.ts:1066-1123`）：

| 对比项 | 来源字段 |
|---|---|
| 姓名 / 官方名 / fc_id / 俱乐部 | `player.name` / `player.officialName` / `player.fcId` / `club.name` |
| CA / PA | `player.ca` / `player.pa` |
| 主位置（isGk 判据） | `player.position`（`'GK'` 即门将） |
| 位置 chips | `gameAttrs.PosID1-4` → `positionName` |
| 角色 chips | `gameAttrs.RoleID1-5` → `roleChs` |
| 花式 / 逆足 | `gameAttrs.skillmoves` / `gameAttrs.weakfoot`（`starText` 显示） |
| 身高 / 体重 | `gameAttrs.height` / `gameAttrs.weight` |
| 惯用脚 | `player.foot`（`foot === 1 ? '右脚' : '左脚'`，Player.tsx:431 同口径） |
| 34 属性 | `gameAttrs` 各属性键（`ATTR_LABELS` / `ATTR_KEYS` 口径） |
| 徽章（PlayStyles 清单） | `gameAttrs` 的 PSID 槽 → `playstyleBadges(attrs)`（ref.ts:60，扫 15 槽、金徽＝基础 ID+100） |
| 徽章数（金/银） | `player.badgesGold` / `player.badgesSilver`（台账计数，详情端点已下发） |
| **影响力** | **缺失——唯一后端增量**（见下） |

- **唯一后端增量**：`GET /api/players/:id` 响应的 `player` 补 `influence`（两位小数；口径＝v2.3.0 规则 4.1.3＝系数 × 能力等级 × 国际声望，与球员库列表端点同源）。复用 `influenceExpr()` / `influenceOf(coefs, ca, pa, growable, prestige)` / `influenceCoefs(db)`（`src/worker/routes/players.ts:173/184/189`；`influenceCoefs` 读 config `influence_coef_growable` / `influence_coef_static`），不得另写一份算法；**同值口径**＝列表端点吃的是原始列 `players.ca AS cur_ca` / `players.pa AS cur_pa`（players.ts:668、:778 传入 `influenceOf`），与属性 view 口径无关，详情用 `p.ca` / `p.pa` 即同值。同一处把 `web/src/lib/api.ts` 的 `PlayerDetail.player` 类型同步补两个字段：`influence: number` 与 `fcId: number | null`（后者运行时响应已回 `fcId`，players.ts:1069，只是类型没声明；不补则对比页类型化访问报 TS 错）。零迁移、零生产写。
- 不拉取的端点：`/growth`（成长域）、`/transfers`、`/offer-settings`、`/api/clubs`（对比页无队徽需求）——除非 §13-1 改判。

## 4. 雷达与配色

- **轴选择**：混比（含任意门将＋外场组合）→ 全员统一**外场六维**＝`ATTR_GROUPS.slice(0,6)`（PAC/SHO/PAS/DRI/DEF/PHY）组均；**纯门将**（全部 `position === 'GK'`）→ **门将六轴**（`GK_RADAR`，Player.tsx:73-80）：DIV 扑救＝gkdiving、HAN 手型＝gkhandling、KIC 开球＝gkkicking、REF 反应＝gkreflexes、POS 站位＝gkpositioning、SPD 速度＝均(sprintspeed, acceleration)。组均口径＝`groupAverage`（组内有效值 Math.round 均值，无有效值 null，轴照画）。
- **形态**：2 人＝单张**叠图**（两条多边形）；3 人＝三张**并排小雷达**（同刻度、单人单色）。
- **网格**：外框实线 `#e6dcc8` ＋ 内环虚线 `#c8bba2`（dasharray 3 3，＝50 分位）。小雷达 mockup 几何：viewBox `0 0 120 104`、中心 (60,52)、R=40、桌面 3 列 grid（`minmax(0,236px)`）居中、svg max-width 178px、手机 max-width 112px；大雷达 mockup 几何：viewBox `170 176`（translate(85,88)）、R=62。归一分母沿用 `AttrRadar` 口径 **99**（mockup 屏上「0–100」为示意）。轴标只出三字母键名，不带数值。
- **多边形**：描边 2px 球员色、填充球员色 opacity .22。
- **与详情页雷达的差异（有意）**：详情页按热区图轮 spec 改五档环带；对比页保持简化网格（三张并排/叠色下环带会糊）。若审阅要求统一，实现轮可换（见 §12-2）。
- **球员色（奶油纸浅色底）**：按**首次加入顺序**分配——第 1 焦橙深 `#8e5426`（5.6:1）· 第 2 深蓝灰 `#37505e`（7.8:1）· 第 3 深紫 `#6d4aa8`（6.0:1）。**色随人走**：移除中间一人后其余人不换色；直接开 URL 时按 URL 顺序分配。深紫需在 `styles.css` 新增站点变量（建议 `--plum-deep`，命名实现轮定）。站点唯一主题＝奶油纸浅色（`web/src/styles.css:34` `color-scheme: light`），颜色结论一律以该底色核对。
- **热区图**（仅 2 人桌面态）：复用热区图轮 spec §1.1 定稿参数（`docs/superpowers/specs/2026-10-05-player-heatmap-radar-ticks-design.md`）：viewBox 245×200、渲染宽 ~147；三列 x=5/85/165 各宽 75；中列 ST(y5)/CAM(y37)/CM(y69)/CDM(y101)/CB(y133) 各高 27；左右列 LW·RW 跨两块（y5 h59）、LM·RM 跨两块（y69 h59）、LB·RB 单块（y133 h27）；GK 梯形带 y164–196、块 ~69×26；**12 块全在场**——主位（PosID1）`#2b8a3e` 白字、副位（PosID2-4）`#66a80f`、未踢 `#faf6ef` opacity .55 字 `#c3b294`。**依赖**：热区图组件属热区图轮产出（先落），对比页复用；对比页先出时该两位置留占位不渲染，不阻塞其余部分。

## 5. 属性表与胜负标记

- **表格内容**：6 组组头（PAC/SHO/PAS/DRI/DEF/PHY）＋ 34 属性行（含 GKP 5 项，列在右栏末）＋ 杂项 6 行（§6）。组头行：只留组名、行底纹 `rgba(230,220,200,.4)`、700 字重。
- **胜负标记（乙）**：只标**可比高低**的行——34 属性行、6 组头行、身高、体重、逆足、花式、影响力。胜方**加粗**、数字**保留球员本命色**；**等值（平手）两侧都加粗**（三平＝三粗）；一行中只有落败方是常规字重。**不标**：惯用脚、位置、角色、徽章、徽章数、CA/PA。界面**不写**任何「不标胜负」提示（该口径只在本 spec）。
- **值列排版（对齐定稿）**：`.v{display:inline-block;width:2.5em;text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}`；分隔点 `.dt{display:inline-block;width:.44em;text-align:center;color:#c8bba2}`；组头行与属性行**同字号、同内边距** ⇒ 各列数字上下对齐、加粗零位移、右值紧贴分隔点。2 人 2 个值格、3 人 3 个值格。
- 属性表数字**不分五档色**（对比语义由本命色＋加粗承载；五档色 `attr-bad #e03131` / `weak #fd7e14` / `mid #b7892b` / `solid #66a80f` / `good #2b8a3e` 仍用于其它页面与雷达轴）。

## 6. 杂项区

- 组头「**杂项**」；行序：**惯用脚 / 身高 / 体重 / 逆足 / 花式 / 影响力**；块内无任何解释文字。
- 标优胜：身高、体重、逆足、花式、影响力（惯用脚不标）。
- 影响力＝**球员影响力数值**（两位小数，mockup 示例 8.13 / 5.60 / 3.50），**不是**详情页「国际声望」★数（prestige 不进对比页）。

## 7. 位置 · 角色 · 徽章 · 徽章数

- 四行成组，左侧标签列定宽（~5.4em，四行标签左缘对齐）；值列按球员分列（桌面 3 人 3 列 / 2 人 2 列）。
- **位置**：主位置 chip 深底（复用 `pos-chip pos-chip-main` 口径）+ 副位 chips；来源 `gameAttrs.PosID1-4`。
- **角色**：复用 `role-chip` / `role-plus` / `role-plusplus` 口径；来源 `RoleID1-5`。
- **徽章**＝PlayStyles 清单（复用 `playstyleBadges(attrs)`（ref.ts:60）与 `PlaystyleBadge`（ps-badge / ps-gold）显示口径）；**口径＝FC 源槽**，不含成长域发放明细（发放明细在 `player_playstyles`、只有 growth 端点下发；见 §12-1）。
- **徽章数**＝`player.badgesGold` / `badgesSilver`，显示 `金 n · 银 n`（**金在前**）。
- 手机端：**角色行仍按球员分两列**，但同一球员的 chips **逐行竖排**（每行一个）；位置 / 徽章 / 徽章数保持横排。

## 8. 状态与边界（URL 即事实源）

**处理链（按序）**：`ids` 逗号切分 → 非法项（非整数）忽略并提示「已忽略 N 个无效 id（…）」→ 重复去重（提示「重复的球员已自动去重」）→ 超过 3 个按 **URL 顺序取前 3**（提示「最多同时对比 3 人，已只取前 3 位」）→ 并发拉详情 → 404 丢弃（提示「未找到 id … 对应的球员，已忽略」）→ 其他失败**留可重试槽位** → 按存活人数渲染 0/1/2/3 人形态。

| 状态 | 表现 |
|---|---|
| 0 人（无 `ids` 或全被丢弃） | 页面级空态：「还没有选择球员」＋「去球员库选人」；**不重定向** |
| 1 人 | 合法**单人态**（不重定向）：单人雷达＋虚线空槽「还差 1 名球员」＋「＋ 从球员库选」；不出对比表 |
| 2 / 3 人 | 桌面形态见 §2；移动端见 §10 |
| 加载中 | 骨架屏（「正在调阅球员数据…」） |
| 部分人失败 | 失败者留**可重试槽位**（只该槽可重试；重试**只重拉失败者**，命中缓存的成功者不重发） |
| 全部失败 | 页面级错误态（提示＋重试） |
| 重复 id | 去重＋提示 |
| 语法非法 id | 忽略＋提示 |
| 超过 3 人 | 取前 3＋提示 |
| 未知 id（404） | 丢弃＋提示 |

- **不自动改写 URL**；选择不落库；跨页由 URL 承载。
- 颜色按**存活后**顺序（即 URL 顺序）分配。
- 公开路由，不要求登录。
- 缓存复用 `['player', id]`（收进 `qk`，见 §3）。

## 9. 库勾选与收集栏

- **桌面球员库**：表格最左新增勾选列（贴 ID 之前；勾中行淡橙底；**表头不设全选**）。
- **收集栏**：`position:sticky; bottom:0` 吸底；0 人不出现；内容＝已选 chips（色点＋姓名，可移除）＋「清空」（桌面文字按钮）＋「对比（n）」（**n≥2 才可点**，不足置灰）；满 3 人时未勾选框改虚线＋提示「最多同时对比 3 人」。
- **窄屏**：卡片左上角圈选；收集栏压一行（姓名只留姓、去「清空」文字按钮）。
- **勾选保留**：跨筛选 / 排序 / 翻页保留；已选而不在当前筛选的 chips 标「不在当前筛选」。
- 「编辑名单」→ `/players?compare=<ids>` 带名单开库；库页按该参数预置勾选与收集栏。

## 10. 移动端（约 390px）

- 身份卡 ×2/×3 紧凑三行；雷达：2 人叠图 / 3 人三张并排（~112px）；属性行单行多值（2–3 值）；吸顶条压 32px；**不出热区图**；角色行按球员两列且 chips 逐行（§7）。
- 0 人态／1 人态照桌面口径缩放。

## 11. 代码落点与复用

| 改动 | 落点 |
|---|---|
| 新页面 | `web/src/pages/PlayerCompare.tsx`（组装＋URL 消费；目录细节实现轮定） |
| 纯函数 | `web/src/lib/compare.ts`（建议）：`parseCompareIds`（切分/去重/取前 3/非法剔除）、颜色分配（色随人走）、轴选择——均配 `web/src/lib/*.test.ts`（tests/ 是 node 语义不能 import 用 window 的模块，测试落 web/src/lib 先例） |
| 提取复用 | `AttrRadar`（Player.tsx:89-123 模块私有）＋ `GK_RADAR` / `groupAverage`（:73-85）＋ `starText`（:67-70）提取为共用组件/模块（详情页同步改用，避免两份口径漂移） |
| 路由 | `web/src/App.tsx` 加 `/players/compare`（写在 `/players/:id` 前） |
| 详情页入口 | `Player.tsx` 球员卡内 `.player-card-numbers` 之后加「对比」按钮（入口 B） |
| 库勾选 | `PlayersLibrary.tsx`（勾选列＋吸底收集栏＋跨筛选保留＋`?compare=` 预置） |
| 缓存键 | `['player', id]` 收进 `web/src/lib/queries.ts` 的 `qk` |
| 后端 | `src/worker/routes/players.ts` 详情响应补 `influence`（§3）；`web/src/lib/api.ts` 类型同步 |
| 样式 | `web/src/styles.css` 增对比页类名（带前缀防连坐）＋新色变量（第三人深紫） |

## 12. 不做与已知边界

- 成长域、经济域（身价/工资/违约金/合同）不进对比。
- 不做账号级收藏/保存名单、不做图片导出、除 URL 外不做持久化。
- 不引图表库（内联 SVG 手绘，与 `AttrRadar` 同先例）。
- 门将专属能力只在 34 属性表逐行可见；雷达混比统一外场轴（§4）。
- 热区图本体属热区图轮；对比页只负责 2 人桌面态的两个位置。
- GKP 组对外场球员照常显示低值（不隐藏、不替换）。
- 属性表数字不分五档色（§5）。

## 13. 未决与待审阅（实现轮前请用户拍板或默认执行）

建议开工前先拍 **1（徽章清单口径）与 3（双栏实启阈值）**——它们影响请求次数与属性区布局；其余按默认口径执行即可。

1. **徽章清单口径**：本 spec 取 **FC 源槽**（零额外请求）；若要含成长发放明细（与详情页完全一致），需每球员 +1 `GET /api/players/:id/growth`。默认执行本 spec。
2. **雷达网格样式**：本 spec 为对比页简化网格（外框＋50 分位虚线内环）；是否与详情页统一成五档环带，待审阅。
3. **双栏实启阈值**：mockup 出现过 ~1000px 与 1100px 两个口径，实现轮用真机校准（1100 为三人桌面态描述基准）。
4. **窄屏断点**：840px 与站内既有 760px（`PLAYER_CARDS_QUERY`）对齐校准。
5. **GKP 组位置**：默认右栏末；高度差明显时实现轮决定是否挪左栏末。
6. **第三人色 CSS 变量命名**（建议 `--plum-deep`）。
7. **身份卡体型行是否带声望★**：mockup 曾含「声望★」；本 spec 定稿移除（国际声望已换影响力、只在杂项行）——如需保留声望★请告知。
8. **influence 后端字段**：实现轮补响应字段＋单测（值口径与列表端点逐值一致）。

## 14. 测试与验收

- 测试计划：qa-test-planner 出 `docs/test-plans/v6.34.0-player-compare.md`（实现轮开工时）。
- 纯函数单测：`parseCompareIds`（切分/去重/取前 3/非法/空）、颜色分配与「色随人走」、轴选择（混比/纯门将）、组均（含 null）。
- 页面测试：2 人/3 人形态、纯门将叠图轴、混比统一轴、等值双粗/胜方加粗、1 人态、0 人态、超 3 人取前 3、部分失败留槽与重试、URL 不改写、勾选跨筛选保留。
- 后端：详情响应含 `influence`（与列表端点同值口径）＋既有端点回归。
- e2e（`scripts/e2e/smoke.mjs`）：库勾选 → 对比页 → URL 直达 → 改 id 即改对比 的链路补断言。
- 回归基线：typecheck 三份全清、vitest 全绿（以实现轮开工实测为准）、build 成功、e2e 全过。
- code-review-skill 审查修复到绿。

## 15. 版本

判级 **minor**（新页面＋新入口，新增用户可见能力）；唯一后端增量＝详情响应补字段（零迁移、零生产写）。版本号不预设：开工时取当时 HEAD 版本号 +1（spec 时点 package.json 6.33.0 在途 ⇒ 预计 **6.34.0**，以实测为准）。
