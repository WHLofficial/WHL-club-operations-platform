# 球员热区图 + 六维雷达刻度五档对齐 · 设计定稿（2026-10-05）

状态：**已实现**（v6.35.0，2026-10-06 本地完成，未发布；落地形态、对比页落点与有意偏差见 §7）。视觉参数以 brainstorm session `43039-1791178761` 的 `heatmap-flatten-v2.html` 终稿屏为准。

> **时点说明**：spec 落盘时（2026-10-05）仓库已被并行会话推进到 v6.32.0（package.json 已 bump 6.33.0 在途）；本文行号与代码事实经同日复核仍成立（`posChips` Player.tsx:735、`.attr-head` styles.css:2566、`.attr-*` :2515-2527、`.radar-axis-val` fill 缺陷未修），但实现轮开工时必须以当时 HEAD 复核一遍再动手。版本号不预设（见 §6）。

## 0. 裁决链（用户指令留痕）

1. 属性页签头部红框空白区（「FC 属性」标题右侧、队徽左侧）加**球员热区图**；六维雷达**刻度**与属性分档五段对齐并套档配色；visual companion 定稿。
2. 配色订正：「第一位置的主色 = 属性分档配色**第一档**（即最高档）绿 `#2b8a3e`，其他位置 = **第二高档**榈绿 `#66a80f`」（首轮我按红/橙理解，用户订正为绿系两档）。
3. 位置拓扑：用户提供参考图（sofifa 风格 3 列网格：中列 ST/CAM/CM/CDM/CB 五等分，左右列 LW·RW 跨两格 / LM·RM 跨两格 / LB·RB 单格，底部梯形 + GK），「只是位置关系，样式可以不完全遵循」——拓扑照抄、样式本仓化。
4. 形态：三变体（网格铺满 / 浮块 / 泡泡，全部「未踢位置都得出现」）→ 用户点选**浮块**（browser events：先 bubble 后 float）。
5. 雷达环带：浅带 / 深带对照 → 用户点选**深带（20%）**；附加项（刻度数字、图例）均未选 ⇒ 不加。
6. sofifa 探查（用户令「探查一下 sofifa 是怎么做的」）：详情页有 Cloudflare 人机验证墙，但 `static.sofifa.net` CDN 域未拦，从 `js/awsm.min.js` 挖到完整 echarts radar 配置（一手证据，见 §4）。用户拍板：「数据多边形改白点 + 虚线边（sofifa 招牌质感），其他不变」——即档界对齐（比 sofifa 的均分五段精确）+ 白点虚线边；轴名保持墨色（只数值套档色，与 sofifa 的「轴名数值全档色」不同）。
7. 尺寸：用户指出「六维图相比热区图有点小」，两案（雷达放大 / 标签重排）后裁决「**改热区图吧，六维图不动**」→ 热区图压扁适配雷达（260×200）；再令「宽度略降」→ **245×200**（渲染 ~147×120，与雷达渲染 ~178×120 等高）。
8. 「定稿」确认收尾。

## 1. 定稿视觉参数

### 1.1 热区图（浮块形态）

- viewBox **245×200**，页面渲染宽 ~147（与雷达等高 ~120）；图底 `#f3ead9`、圆角 8、轻投影。
- 拓扑（参考图）：三列各 75 宽（x = 5 / 85 / 165，列缝 5）；中列 5 等分行高 27：ST(y5) / CAM(y37) / CM(y69) / CDM(y101) / CB(y133)；左右列：LW·RW 跨两块高 59（y5）、LM·RM 跨两块高 59（y69）、LB·RB 单块 27（y133）；底部梯形 GK 带（y164–196，透视收拢），GK 块居中 ~69×26。
- 浮块：块缝 5、圆角 7（悬浮感）。
- **12 块全在场**（用户令「未踢都得出现」）：主位（PosID1）`#2b8a3e` 白字 700；副位（PosID2-4）`#66a80f` 白字 700；未踢 `#faf6ef` opacity .55 + 字 `#c3b294`；位置缩写 11px 700 居中。
- GK 特例：纯门将（`isGk`）只有 GK 块填主位绿，其余 11 块照常在场淡显；GK 兼场员（PosID2-4 有场员位）照常铺绿。
- 空态：`posChips` 为空（PosID 全无效）不渲染热区图，头部回退两列。

### 1.2 六维雷达（样式改造，结构不动）

- viewBox **232×156、cx=116 cy=78 R=48、归一分母 99、六轴与标签横排布局——结构全部不动**。
- **环带**：五档色 20% 透明度层层内叠（外→内：`#2b8a3e` / `#66a80f` / `#b7892b` / `#fd7e14` / `#e03131`），边界 = 档界值 **50 / 60 / 70 / 80**（半径 = v/99 × R），顶环 = 外框 = 99。环带按六边形 polygon 层层内叠绘制（非圆环）。
- **边界环线**：各档界六边形描边对应档色 55% 不透明、1px；轴线保持现有纸灰 `#d9c6ad`。
- **数据多边形**：填充 `rgba(62,96,111,.22)`（现状）+ 描边 `#3e606f` 1.5px **虚线 4.5-3** + **白色数据点 r3.2、描边 #3e606f 1.4px**（sofifa 招牌质感）。
- **轴标签**：轴名墨色 700、数值套五档色——**修 fill 缺陷后才真生效**（现状 `.radar-axis-val` 设 `fill: var(--ink)`，`.attr-*` 类只设 `color`，SVG text 吃 fill 不吃 color，v6.19.0 的雷达轴套色实际未生效；修法：给 `.attr-*` 五类补同值 `fill`（HTML 中无害），或给 `.radar-axis-val.attr-*` 加五条 fill 规则，实现轮二选一）。
- 无刻度数字、无图例。
- GK 雷达（GK 组六轴）同配方。
- 数值 null 的轴：数值 tspan 不套色（现状守卫保留）。

### 1.3 布局

- 宽屏：`.attr-head` 从两列 grid 改**三列**：`minmax(0,1fr) auto auto`——标题/位置 chips/角色 chips ｜ 热区图 ｜ 队徽 96px + 雷达。
- ≤760px：折行堆叠（标题/位置行 → 热区图 + 雷达并排居中 → 星级行），沿用现有 `.attr-head` 单列断点；星级行、属性卡、PlayStyles 不动。

## 2. 技术实现口径

- **数据源（零后端）**：`AttrSheet` 现算的 `posChips`（`['PosID1'..'PosID4'].map(positionName)`，Player.tsx:735-737）——首位即主位，顺序即优先级；`isGk = player.position === 'GK'`（Player.tsx:739 现成）。
- **拓扑坐标**：新建静态数据（12 位置 → viewBox 坐标 + 宽高）+ 几何纯函数，落 `web/src/lib/`（纯数据可测；tests/ 是 node+workers-types 语义不能 import 用 `window` 的模块——v6.19.0 踩坑先例，测试落 `web/src/lib/*.test.ts`）。
- **组件**：热区图 SVG 手绘（不引 echarts/库），内联 `Player.tsx` 与 `AttrRadar` 同先例。
- **布局**：`styles.css` `.attr-head`（:2566-2577）改三列 grid + ≤760px 堆叠规则；新增热区图类名带 `player-`/`attr-` 前缀防连坐。
- **fill 修复**：见 §1.2 最后一条。

## 3. 不做与已知边界

- 不做比赛实际跑动热图（需比赛事件数据）——本图语义是「可踢位置分布」（sofifa position map 一族）。
- 不引 echarts；不照抄 sofifa 的均分五段环带（刻度不对应档界，用户拍板档界对齐更精确）；不照抄 sofifa 的「轴名数值全档色」（轴名保持墨色）。
- 热区图块高差（LW 跨两块 vs LB 单块）是拓扑示意，不代表位置权重；数值/能力不进热区图。
- sofifa 环带透明度是 hex alpha `bb`（≈73%），本设计用 20% 深带（用户点选），不一致属有意为之。

## 4. sofifa 雷达一手配置存档（static.sofifa.net/js/awsm.min.js，2026-10-05 抓取）

```js
radar: {
  startAngle: 60, radius: "65%", name: { fontSize: FONT },
  indicator: [ // 轴名 + "\n\r" + 数值 两行，整块 color = color(POINT)（五档函数）
    {name: LABEL_SHO+"\n\r"+POINT_SHO, max: 99, color: color(POINT_SHO)}, /* …PAC/PHY/DEF/DRI/PAS 同构 */
  ],
  splitArea: { areaStyle: { color: [COLOR_0_50+"bb", COLOR_50_60+"bb", COLOR_60_70+"bb", COLOR_70_80+"bb", COLOR_80_99+"bb"] } },
  axisLine: {show:false}, splitLine: {show:false}, nameGap: 10
},
series: [{ type:"radar", data:[[POINT_SHO,POINT_PAC,POINT_PHY,POINT_DEF,POINT_DRI,POINT_PAS]],
  itemStyle:{normal:{color:"#FFFFFF",borderWidth:2}}, areaStyle:{normal:{opacity:.4}}, lineStyle:{type:"dashed"} }]
```

要点：splitArea 五档色但 splitNumber 未配（echarts 默认 5 ⇒ 0-99 均分，环界 19.8/39.6/59.4/79.2，**不在档界上**）；网格线/轴线全隐藏；数据多边形白点 + 虚线边 + 40% 填充；startAngle 60。本设计采纳其「白点 + 虚线边」质感与「环带五档色」思路，其余按用户裁决偏离（档界对齐、20% 透明度、轴名墨色、实色填充墨青）。

## 5. 测试与验收（实现轮）

- 测试计划：qa-test-planner 出 `docs/test-plans/v6.35.0-heatmap-radar-badge.md`（实际版本号 6.35.0；本轮与「雷达共享件统一」「徽章/PlayStyle 统一」合并执行，计划一份覆盖三主题）。
- 纯函数测试：拓扑完整性（12 位置全覆盖、坐标在界内、无块重叠）、三态类名/填色映射（主/副/未踢）、雷达环带半径公式（v/99×R）。
- 页面测试：mock 数据渲染热区图（主位/副位/未踢各至少一块）与雷达环带数量（5 带 5 线）；fill 修复后雷达轴数值档色断言。
- e2e ⑯（`scripts/e2e/smoke.mjs:2007` 起）补属性页签断言：点「属性」页签 → 热区图在 DOM、雷达 svg 在 DOM（原零覆盖）。落地为两态：取样球员无存档 ⇒ 只锁空态闸门（`.attr-head` 零个）；另用探到的「有存档球员」在末段验头部几何（5 环带、白点 = 数据多边形 × 6、热区两态自洽）。⑤f 另按数据驱动补对比页热区/雷达断言（见 §7）。
- 回归基线：typecheck 三份全清、vitest 全绿（开工基线 98 文件 / 1622 例 ⇒ 收口 101 文件 / 1681 例）、build 成功、e2e **23/23**（场景数已由并行会话扩到 23，spec 时点的 11/11 是 v6.19.0 旧基线）。
- code-review-skill 审查修复到绿。

## 6. 版本

判级 minor（新增用户可见能力）；零迁移、零生产写。版本号实际落 **6.35.0**（开工时 HEAD 已是 v6.34.0 球员对比 ⇒ 顺延一版；spec 时点预估 6.34.0 未采用）。后端本 spec 范围零改动，但同轮顺带修了一处读路径缺陷：`/api/players/:id` 的 seaComps `signFee` 对 `fee ≤ 0` 的历史成交行抛 `RangeError` 打成 500（`src/worker/routes/players.ts`，提交 `029043e`）。

## 7. 实现轮落地与偏差登记（2026-10-06 · v6.35.0）

**落地形态**

- 纯函数 `web/src/lib/heatmap.ts`：`HEAT_VIEW = { w: 245, h: 200 }`、`HEAT_CODES`（12 码，`['GK','RB','CB','LB','CDM','RM','CM','LM','CAM','RW','ST','LW']`）、`HEAT_SLOTS`（12 块坐标）、`HEAT_GK_BAND = '4,164 241,164 204,196 41,196'`、`heatPositionsOf(posCodes)`（清非法 / 去重 / 保序）、`heatStateOf(posCodes, isGk)`（主 / 副 / 未踢 + 纯门将特例）、`heatToneClass(state)`。
- 共享组件 `web/src/components/PositionHeatmap.tsx`：props `{ posCodes, isGk, className }`；12 个 `<rect class="heat-block …">` 与 12 个 `<text class="heat-code …">` 恒在场；aria 摘要两态（主位清单 / 无位置数据）。
- 落点一（本 spec §1.3 原定）：球员页属性页签头部 `.attr-head` 三列（`minmax(0,1fr) auto auto`，≤760px 堆叠）；位置码取 `PosID1..4` 经 `positionName` 归一（空槽护栏见下）。
- 落点二（**本轮新增口径**）：球员对比页 2 人态身份卡下方 `.cmp-radarzone` 两侧各一张（`HeatSide`，宽度走布局类 `.cmp-heatmap`，不套 `.cmp-radar-big` 的 196px）；3 人态不出（每行 3 值格已够密）；吸顶条不出。

**雷达共享件（本 spec §1.2 参数 + 泛化）**

- `web/src/lib/radar.ts` 扩 `RADAR_BAND_BOUNDS = [99, 80, 70, 60, 50]`、`bandFrac(v)`（分母 99、钳 [0,99]）、`tierColorOf(v)`（与既有 `attrClass` 同阈值，五档边界两侧一一对应）。
- `web/src/components/AttrRadar.tsx` 泛化：`variant: 'head' | 'big' | 'small' | 'mini'` + `bands: 'tier' | 'neutral'` + `ariaHidden`。几何：head 232×156 cx116 cy78 R48（本 spec §1.2 原值）/ big 170×176 cx85 cy88 R62 / small 120×104 cx60 cy52 R40 / mini 同 small 但无文字、无白点、`aria-hidden`。
- **唯一有意视觉差异（登记）**：对比页用 `bands="neutral"` —— 只画 55% 环线与档界、不铺五档底色。理由：对比页是多人对拍场合，五档底色会与球员本命色抢注意力；球员页保持 `tier` 五档色（本 spec §1.2 终稿）。
- **有意行为变化（登记）**：`AttrRadar` 跳过「全空序列」（`raw.some((v) => (v ?? 0) > 0)` 不成立即不画数据多边形与白点）。被替换掉的对比页私有实现（`RadarChart` / `MiniRadar` / `dataPoints`）是**无条件**画多边形（null 经 `axisValue` 归 0 ⇒ 退化到圆心），长尾球员（`game_attrs = null`）会出「塌成一点」的假图。统一后：无存档球员不出多边形，图例与属性表「—」仍在 ⇒ e2e ⑤f 断言改为数据驱动期望（见下）。

**同轮顺带修复**

- `web/src/lib/ref.ts` `positionName` 补空槽护栏：原实现 `Number(null) === 0`，而 `position.json` 的 id 0 是 GK ⇒ 空槽被错译成门将，热区图会凭空给 GK 块上主位绿、球员页多一枚 GK 芯片。新口径与后端同款（`src/worker/routes/market.ts:465-467` 的 `slotNames`、`src/worker/shop-ops.ts:157-161` 的 `hotZonesOf` 都是「槽位缺失归 null」）。
- `.attr-*` 缺 `fill` 修复（本 spec §1.2 登记的缺陷）：`web/src/styles.css` 的 `.attr-*` 只设 `color`，SVG `<text>` 不吃 `color` ⇒ 轴数值套档色未生效；补同值 `fill`。
- 徽章 / PlayStyle 统一（同轮另一主题，另见 `docs/superpowers/specs/2026-10-06-badge-playstyle-unification-design.md`）：与热区图无耦合，仅共用 `.attr-head` 三列布局。

**e2e 口径（⑤f / ⑯）**

- ⑤f 改为「探针取样」：`/api/players?limit=30` 全量拉详情，判据与渲染同源 —— 「有可上雷达的存档」= 内联六组轴键表（照抄 `web/src/lib/ref.ts` 的 `ATTR_GROUPS`）与门将六轴表（照抄 `web/src/lib/radar.ts` 的 `GK_RADAR`）逐轴算**组均 > 0**（`drawsWith` 照抄 `groupAverage`，含 `Number(null) === 0` 算有效值），「有位置数据」= `PosID1..4` 任一命中 `web/assets/ref/position.json` 里 `name !== '-'` 的 id 集（与 `positionName` 护栏、后端 `hotZonesOf` 同口径）。期望值由数据推、取样优先有存档球员；本地只有 1 名有存档 ⇒ 多边形断言按实际期望降级并 `console.warn` 备注（不再硬钉 2/3 条，否则「本地无存档」会假红）。评审 P2-3：此前探针判据（任一非元数据数值 > 0 / `PosID ≥ 0`）宽于渲染判据，真数据一变就假红。
- ⑯ 补 375 属性页签断言（空态闸门：无存档 ⇒ `.attr-head` 零个）＋末段「有存档球员」头部几何（375：5 环带、白点 = 数据多边形 × 6、热区两态自洽、零横向溢出；1280：有位置数据三列 / 无位置数据两列）。

**收口轮评审修正（2026-10-06 · code-review-skill 审 `38e5a5c..HEAD`，无 P0）**

- **登记（P3-6）**：单人对比页的雷达 aria-label 由「六维雷达（双色叠图）」改为「六维雷达」——「双色叠图」只在 2 人态成立，1 人态说叠图是错的；2 人态文案不变。
- **登记（P3-7）**：`heatStateOf` 注释原写「其余（≤3）副位」与实现不符（不封顶），已改「其余副位（不封顶，超出 3 个位置码也照铺 —— 属性表能存满 4 槽）」。
- **P3-9**：`web/src/lib/radar.ts` 的 `axisValue` 与 `bandFrac` 重复 clamp 收成模块私有 `clamp99`（行为不变，`axisValue` 仍导出供测试与对比页表格用）。
