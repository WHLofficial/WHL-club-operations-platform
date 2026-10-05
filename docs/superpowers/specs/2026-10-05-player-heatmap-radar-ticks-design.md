# 球员热区图 + 六维雷达刻度五档对齐 · 设计定稿（2026-10-05）

状态：**定稿（visual companion 两屏迭代收敛）**，实现等令。实现版本目标 v6.20.0（minor，零迁移零后端，纯前端）。视觉参数以 brainstorm session `43039-1791178761` 的 `heatmap-flatten-v2.html` 终稿屏为准。

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

- 测试计划：qa-test-planner 出 `docs/test-plans/v6.20.0-player-heatmap-radar.md`（实现轮开工时）。
- 纯函数测试：拓扑完整性（12 位置全覆盖、坐标在界内、无块重叠）、三态类名/填色映射（主/副/未踢）、雷达环带半径公式（v/99×R）。
- 页面测试：mock 数据渲染热区图（主位/副位/未踢各至少一块）与雷达环带数量（5 带 5 线）；fill 修复后雷达轴数值档色断言。
- e2e ⑯（scripts/e2e/smoke.mjs:1771 起）补属性页签断言：点「属性」页签 → 热区图在 DOM、雷达 svg 在 DOM（现状零覆盖）。
- 回归基线：typecheck 三份全清、vitest **68 文件 / 1209 例**全绿（v6.19.0 基线）、build 成功、e2e **11/11**。
- code-review-skill 审查修复到绿。

## 6. 版本

v6.20.0，判级 minor（新增用户可见能力）；零迁移、零生产写、后端零改动。
